// ai_service.js - Support for Gemini and Ollama (Local)

// ── Debug flag — match the one in shared.js ──
const AI_DEBUG = false;
function aiLog(...args)  { if (AI_DEBUG) console.log(...args); }
function aiWarn(...args) { if (AI_DEBUG) console.warn(...args); }

// ── Prompt caching (load from .md files) ──
const promptCache = {};

async function loadPromptFromFile(filename) {
    if (promptCache[filename]) return promptCache[filename];

    try {
        const url = chrome.runtime.getURL(`prompts/${filename}`);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to load ${filename}`);
        const content = await response.text();
        promptCache[filename] = content;
        return content;
    } catch (err) {
        console.error(`[Prompts] Error loading ${filename}:`, err);
        return null;
    }
}

async function getStage1SystemPrompt() {
    const fullContent = await loadPromptFromFile('stage_1.md');
    if (!fullContent) return STAGE1_SYSTEM_PROMPT_FALLBACK;

    // Extract just the extraction rules section (lines with dashes and bullet points)
    const lines = fullContent.split('\n');
    const ruleStart = lines.findIndex(l => l.includes('Extraction Rules'));
    const ruleEnd = lines.findIndex((l, i) => i > ruleStart && l.includes('### Examples'));

    if (ruleStart === -1 || ruleEnd === -1) return STAGE1_SYSTEM_PROMPT_FALLBACK;

    const rules = lines.slice(ruleStart + 1, ruleEnd)
        .join('\n')
        .trim();

    return `Extract these fields from the job posting and return a JSON object. Be concise. If a field is missing, output "Not specified".

JSON Keys:
- title: job title
- salary: compensation range or "Not specified"
- team: team name + 1 sentence on what they own/build
- location: location + remote policy
- experience: years required
- roleFocus: Backend/Frontend/Full-Stack/Mobile/Data/ML/AI/DevOps/Embedded/etc.
- primaryLanguages: required languages, in order of emphasis
- requiredSkills: comma-separated must-have tech skills
- preferredSkills: comma-separated nice-to-have skills
- keyResponsibilities: 2-3 main things you'll build or own
- aboutRole: IC vs manager, scope, team size, or what's unique

${rules}`;
}

// ── Truncation limits (chars) ── 1 token ≈ 4 chars (English) ──
const INPUT_LIMITS = {
    PAGE_EXTRACT: 15000,  // content.js — raw DOM text cap (~3,750 tok), covers all job posts
    STAGE1_NANO: 4000,    // Gemini Nano — tight limit keeps Stage 1 fast (~1K tok input)
    STAGE1_SUMMARIZER: 8000,  // Summarizer API — initial rough cut, then dynamic via measureInputUsage()
    STAGE1_CLOUD: 6000,   // Gemini Cloud — extraction doesn't need more
    STAGE2_DEFAULT: 10000, // Gemini Cloud — 1M tok context, 10K chars is cost-efficient
    STAGE2_ON_DEVICE: 6000, // Gemini Nano Stage 2 — after ~3.2K prompt template overhead
    STAGE2_OLLAMA: 8000,  // Ollama — 8192 context window
    OLLAMA_CTX: 8192,     // Ollama context window (tokens)
    OLLAMA_S1_PREDICT: 1024, // Ollama max output tokens
};

// Fallback Stage 1 system prompt (used if .md file fails to load)
const STAGE1_SYSTEM_PROMPT_FALLBACK = `Extract these fields from the job posting and return a JSON object. Be concise. If a field is missing, output "Not specified".

JSON Keys:
- title: job title
- salary: range or "Not specified"
- team: team name + 1 sentence on what they own/build
- location: location + remote policy
- experience: years required
- roleFocus: Backend/Frontend/Full-Stack/Mobile/Data/ML/AI/DevOps/Embedded/etc.
- primaryLanguages: required languages, in order of emphasis
- requiredSkills: comma-separated must-have tech skills
- preferredSkills: comma-separated nice-to-have skills
- keyResponsibilities: 2-3 main things you'll build or own, comma-separated
- aboutRole: IC vs manager, scope, team size, or what's unique — 1 sentence

Rules: skills as comma lists; narratives as 1 sentence max; required vs preferred must stay separate; ignore benefits/EOE/culture/application instructions.`;

let STAGE1_SYSTEM_PROMPT = STAGE1_SYSTEM_PROMPT_FALLBACK; // Will be replaced by loadPromptFromFile() at runtime

// Initialize prompts on startup (populate cache), then kick off on-device model init
async function initializePrompts() {
    try {
        const stage1Prompt = await getStage1SystemPrompt();
        if (stage1Prompt && stage1Prompt !== STAGE1_SYSTEM_PROMPT_FALLBACK) {
            STAGE1_SYSTEM_PROMPT = stage1Prompt;
            console.log('[Prompts] Stage 1 prompt loaded from stage_1.md');
        }

        const stage2Prompt = await loadPromptFromFile('stage_2.md');
        if (stage2Prompt) {
            console.log('[Prompts] Stage 2 prompt loaded from stage_2.md');
        }
    } catch (err) {
        console.warn('[Prompts] Initialization warning:', err);
    }

    // Start on-device model init immediately after prompts are ready
    initOnDeviceModel().then(result => {
        if (result.success) console.log('[OnDevice] Pre-warmed and ready.');
        else console.log(`[OnDevice] Pre-warm skipped: ${result.reason}`);
    });
}

// Start loading prompts in background when extension loads
if (typeof chrome !== 'undefined' && chrome.runtime) {
    initializePrompts().catch(err => console.warn('[Prompts] Failed to initialize:', err));
}

// JSON schema for Stage 1 extraction — guarantees valid JSON from Prompt API
const STAGE1_RESPONSE_SCHEMA = {
    type: "object",
    properties: {
        title: { type: "string" },
        salary: { type: "string" },
        team: { type: "string" },
        location: { type: "string" },
        experience: { type: "string" },
        roleFocus: { type: "string" },
        primaryLanguages: { type: "string" },
        requiredSkills: { type: "string" },
        preferredSkills: { type: "string" },
        keyResponsibilities: { type: "string" },
        aboutRole: { type: "string" }
    },
    required: ["title", "salary", "team", "location", "experience", "roleFocus", "primaryLanguages", "requiredSkills", "preferredSkills", "keyResponsibilities", "aboutRole"]
};

// ── Ollama Structured Output Schemas & Helpers ("Make LLM Extract, Make Code Decide") ──

const FACTS_SCHEMA = {
    type: "object",
    properties: {
        title: { type: "string", description: "Exact job title" },
        seniority: { type: "string", enum: ["intern", "junior", "mid", "senior", "staff", "principal", "manager", "unknown"] },
        minYears: { type: ["number", "null"], description: "Minimum years of experience required, or null" },
        locationType: { type: "string", enum: ["remote_us", "hybrid_us", "onsite_us", "non_us", "unknown"] },
        roleFocus: { type: "string", enum: ["backend", "infra", "ml", "data", "frontend", "mobile", "embedded", "hardware", "firmware", "wireless", "kernel_driver", "other"] },
        primaryLanguages: { type: "array", items: { type: "string" }, maxItems: 6 },
        requiredSkills: { type: "array", items: { type: "string" }, maxItems: 15 },
        preferredSkills: { type: "array", items: { type: "string" }, maxItems: 10 },
        salary: { type: "string", description: "Compensation range or Not specified" },
        team: { type: "string", description: "Team name and mission, or Not specified" },
        vagueJD: { type: "boolean", description: "True if JD only mentions high-level concepts without specific technologies" }
    },
    required: ["title", "seniority", "minYears", "locationType", "roleFocus", "primaryLanguages", "requiredSkills", "preferredSkills", "salary", "team", "vagueJD"]
};

const SYNTHESIS_SCHEMA = {
    type: "object",
    properties: {
        reason: { type: "string", description: "Top alignment or disqualifier. Maximum 15 words." },
        uniqueInsight: { type: "string", description: "Team's core challenge or unique aspect. Maximum 15 words." },
        levelingNote: { type: ["string", "null"], description: "Leveling gap explanation if applicable, or null." }
    },
    required: ["reason", "uniqueInsight", "levelingNote"]
};

const DEFAULT_RESUME_PROFILE = {
    title: "Senior Backend Engineer",
    yearsExp: 5,
    degree: "Masters",
    skills: [
        "python", "fastapi", "fastmcp", "langgraph", "pika", "pandas", "pydantic",
        "tensorflow", "pytorch", "keras", "scikit", "pyspark", "sparkml", "bash",
        "html", "css", "javascript", "redis", "rabbitmq", "artifactory", "docker",
        "kubernetes", "k8s", "mcp", "chromadb", "mongodb", "postgres", "postgresql",
        "duckdb", "gcp", "gke", "aws", "emr", "ec2", "s3", "jenkins", "langchain",
        "distributed systems", "rest", "api"
    ]
};

const SKILL_ALIASES = {
    "k8s": "kubernetes",
    "postgres": "postgresql",
    "golang": "go",
    "py": "python",
    "js": "javascript",
    "ts": "typescript",
    "reactjs": "react",
    "vuejs": "vue",
    "gcp": "google cloud",
    "aws": "amazon web services",
    "fast-api": "fastapi",
    "es": "elasticsearch",
    "mongo": "mongodb"
};

function normSkill(skill) {
    if (!skill || typeof skill !== 'string') return '';
    const s = skill.toLowerCase().replace(/[\s\-_.]+/g, '');
    return SKILL_ALIASES[s] || s;
}

let _lastOllamaFacts = null;

async function ollamaJSON({ baseUrl, model, system, user, schema, numPredict = 1024, signal = null }) {
    const url = (baseUrl || 'http://localhost:11434').replace(/\/$/, '') + '/api/chat';

    async function makeRequest(temp = 0.0) {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                stream: false,
                think: false,
                format: schema,
                keep_alive: "10m",
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: user }
                ],
                options: {
                    temperature: temp,
                    seed: 42,
                    num_ctx: INPUT_LIMITS.OLLAMA_CTX,
                    num_predict: numPredict
                }
            }),
            signal
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            let errMsg = response.statusText;
            try {
                const errJson = JSON.parse(errText);
                if (errJson.error) errMsg = errJson.error;
            } catch (_) {
                if (errText) errMsg = errText;
            }
            throw new Error(`Ollama request failed (${response.status}): ${errMsg}`);
        }

        const data = await response.json();
        let content = data.message?.content || '';
        if (content.includes('</think>')) {
            content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        } else if (content.includes('<think>')) {
            const thinkIdx = content.indexOf('<think>');
            content = content.substring(0, thinkIdx).trim();
        }
        content = content.replace(/```(?:json)?\n?/gi, '').replace(/```/g, '').trim();

        const start = content.indexOf('{');
        const end = content.lastIndexOf('}');
        if (start === -1 || end === -1) {
            throw new Error('No JSON object returned by model.');
        }
        let jsonStr = content.substring(start, end + 1);
        try {
            return JSON.parse(jsonStr);
        } catch (_) {
            // Strip trailing commas before closing braces/brackets
            jsonStr = jsonStr.replace(/,\s*([\]}])/g, '$1');
            return JSON.parse(jsonStr);
        }
    }

    try {
        return await makeRequest(0.0);
    } catch (err) {
        if (signal?.aborted) throw err;
        console.warn('[Ollama] First attempt failed, retrying with temperature 0.3...', err);
        return await makeRequest(0.3);
    }
}

// ── tev1 System One Decision API ──

/**
 * Call the /v1/systemone endpoint for fast multi-question decisions.
 * @param {Object} opts
 * @param {string} opts.baseUrl - Ollama base URL
 * @param {string} opts.model  - Decision model name (e.g., 'tev1:4b')
 * @param {string} opts.state  - Context string for the decision
 * @param {Object} opts.questions - Map of question_id → { type, instructions, criteria }
 * @param {AbortSignal} [opts.signal]
 * @returns {Object} { answers: { [qid]: { type, choice|score, probabilities, confidence } }, usage }
 */
async function systemOneDecide({ baseUrl, model, state, questions, signal = null }) {
    const url = (baseUrl || 'http://localhost:11434').replace(/\/$/, '') + '/v1/systemone';

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, state, questions }),
        signal
    });

    if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`SystemOne request failed (${response.status}): ${errText || response.statusText}`);
    }

    return await response.json();
}

// ── tev1 Decision Questions ──
// Builds dynamic questions for /v1/systemone based on candidate resume profile.

function getTev1Questions(resumeProfile = DEFAULT_RESUME_PROFILE) {
    const profile = resumeProfile || DEFAULT_RESUME_PROFILE;
    const title = profile.title || DEFAULT_RESUME_PROFILE.title;
    const yearsExp = profile.yearsExp ?? DEFAULT_RESUME_PROFILE.yearsExp;
    const degree = profile.degree || DEFAULT_RESUME_PROFILE.degree;
    const skills = (profile.skills || DEFAULT_RESUME_PROFILE.skills).slice(0, 20).join(', ');

    return {
        // Q1: Overall relevance score (continuous 0-5)
        relevance: {
            type: "score",
            instructions: `Rate this job's relevance for a ${title} with ~${yearsExp} years experience, ${degree} degree. Skills: ${skills}.`,
            criteria: [
                "Level 0: NO-MATCH — Any hard disqualifier: Python not required/listed, role outside US, frontend/mobile/embedded/hardware/firmware/RF/wireless/kernel focus, or requires >7 years experience.",
                "Level 1: WEAK — Minimal overlap, mostly irrelevant stack or domain.",
                "Level 2: SEMI-MATCH LOW — Some skill overlap but significant gaps in core requirements.",
                "Level 3: SEMI-MATCH — Partial alignment, missing preferred skills or vague JD without concrete tech. Staff+ title caps here.",
                "Level 4: SEMI-MATCH HIGH — Good alignment, minor leveling gap or 1-2 missing preferred skills.",
                "Level 5: FULL-MATCH — Strong alignment with all hard requirements met, Senior/Mid-Senior level, core skills matched."
            ]
        },

        // Q2: Role focus classification
        role_focus: {
            type: "choice",
            instructions: "Classify this role's primary engineering focus area.",
            criteria: {
                backend: "Server-side APIs, microservices, infrastructure, distributed systems.",
                frontend: "Client-side UI, browser, React/Angular/Vue, CSS.",
                ml_ai: "Machine learning, AI/ML engineering, model training/serving.",
                data: "Data engineering, ETL pipelines, analytics, data platform.",
                infra_devops: "Infrastructure, DevOps, SRE, cloud platform engineering.",
                mobile: "iOS or Android native/cross-platform development.",
                embedded_hw: "Embedded systems, firmware, hardware, FPGA, kernel, drivers.",
                other: "None of the above or unclear."
            }
        },

        // Q3: Match classification
        match_type: {
            type: "choice",
            instructions: `Classify overall candidate match status for a ${title}. Disqualifiers (no_match): Python is not a primary language, role is frontend/mobile/hardware/embedded, or outside US. Full match requires Python backend alignment with core skills.`,
            criteria: {
                full_match: `${title} role matching candidate stack and experience.`,
                semi_match: "Partial overlap in tech stack, minor leveling differences, or related backend/data/ML role.",
                no_match: "Disqualified: not Python backend, wrong engineering discipline (frontend, mobile, hardware), non-US, or over-qualified."
            }
        },

        // Q4: Seniority assessment
        seniority: {
            type: "choice",
            instructions: `Assess the seniority level of this role. The candidate has ~${yearsExp} years of experience with a ${degree} degree.`,
            criteria: {
                junior_mid: "Junior to mid-level, 0-3 years experience required.",
                senior: `Senior level, 3-7 years experience required. Good fit for ~${yearsExp} years candidate.`,
                staff_plus: `Staff, Principal, or Director level. >7 years typically needed. Over-leveled for ~${yearsExp} years candidate.`,
                unclear: "Seniority not clearly specified in the posting."
            }
        }
    };
}

/**
 * Score extracted facts using tev1's /v1/systemone API.
 * Replaces scoreFromFacts() + synthesizeOllamaSummary() with one multi-question call.
 */
async function scoreWithSystemOne(baseUrl, facts, signal, resumeProfile = DEFAULT_RESUME_PROFILE, decisionModel = 'tev1:4b') {
    const profile = resumeProfile || DEFAULT_RESUME_PROFILE;
    const model = decisionModel || 'tev1:4b';

    // Build state string from extracted facts
    const state = [
        `Job Title: ${facts.title || 'Not specified'}`,
        `Seniority: ${facts.seniority || 'unknown'}`,
        `Min Years Experience: ${facts.minYears != null ? facts.minYears : 'Not specified'}`,
        `Location: ${facts.locationType || 'unknown'}`,
        `Role Focus: ${facts.roleFocus || 'unknown'}`,
        `Primary Languages: ${(facts.primaryLanguages || []).join(', ') || 'Not specified'}`,
        `Required Skills: ${(facts.requiredSkills || []).join(', ') || 'Not specified'}`,
        `Preferred Skills: ${(facts.preferredSkills || []).join(', ') || 'None'}`,
        `Salary: ${facts.salary || 'Not specified'}`,
        `Team: ${facts.team || 'Not specified'}`,
        `Vague JD: ${facts.vagueJD ? 'Yes' : 'No'}`
    ].join('\n');

    const questions = getTev1Questions(profile);

    const result = await systemOneDecide({
        baseUrl,
        model,  // Configured decision model
        state,
        questions,
        signal
    });

    const answers = result.answers;
    const relevance = answers.relevance;
    const roleFocus = answers.role_focus;
    const matchType = answers.match_type;
    const seniorityAns = answers.seniority;

    // Log detailed probabilities
    console.log(`[tev1] Decision Results:
  Relevance:  ${relevance.score.toFixed(2)}/5 (confidence: ${(relevance.confidence * 100).toFixed(1)}%)
  Role Focus: ${roleFocus.choice} (${(roleFocus.probabilities[roleFocus.choice] * 100).toFixed(1)}%)
  Match Type: ${matchType.choice} (${(matchType.probabilities[matchType.choice] * 100).toFixed(1)}%)
  Seniority:  ${seniorityAns.choice} (${(seniorityAns.probabilities[seniorityAns.choice] * 100).toFixed(1)}%)
  Tokens:     ${result.usage?.input_tokens ?? 0} input, ${result.usage?.output_tokens ?? 0} output`);

    // Map tev1 score (0-5 continuous) to 1 decimal place
    const rawScore = relevance.score;
    const score = Math.round(rawScore * 10) / 10;

    // Derive match classification combining score rubric and classification choices
    const isDisqualifiedFocus = ['frontend', 'mobile', 'embedded_hw'].includes(roleFocus.choice);
    const isZeroProbHigh = relevance.probabilities && (relevance.probabilities['0'] > 0.5);

    let match;
    if (score < 1.5 || isZeroProbHigh || isDisqualifiedFocus || matchType.choice === 'no_match') {
        match = 'NO-MATCH';
    } else if (score >= 4.0 && matchType.choice === 'full_match') {
        match = 'FULL-MATCH';
    } else {
        match = 'SEMI-MATCH';
    }

    // Override: if disqualified / no_match, force score to 0
    const finalScore = match === 'NO-MATCH' ? 0.0 : score;

    // Build leveling note from seniority answer
    let levelingNote = null;
    if (seniorityAns.choice === 'staff_plus') {
        const staffProb = (seniorityAns.probabilities.staff_plus * 100).toFixed(0);
        levelingNote = `Staff+ role (${staffProb}% confidence). Candidate has ~${profile.yearsExp || 5} yrs exp — may be over-leveled.`;
    }

    // Derive skill matches/gaps from facts
    const resumeSkills = new Set((profile.skills || DEFAULT_RESUME_PROFILE.skills).map(normSkill));
    const fullMatches = [];
    const partialMissing = [];
    const jdTech = [...(facts.primaryLanguages || []), ...(facts.requiredSkills || [])];
    for (const tech of jdTech) {
        if (!tech) continue;
        if (resumeSkills.has(normSkill(tech))) fullMatches.push(tech);
        else partialMissing.push(tech);
    }
    for (const tech of (facts.preferredSkills || [])) {
        if (tech && !resumeSkills.has(normSkill(tech))) partialMissing.push(tech);
    }

    // Build reason from tev1 context
    const focusLabel = roleFocus.choice.replace(/_/g, ' ');
    const focusConf = (roleFocus.probabilities[roleFocus.choice] * 100).toFixed(0);
    const matchConf = (matchType.probabilities[matchType.choice] * 100).toFixed(0);
    const relevanceConf = (relevance.confidence * 100).toFixed(0);

    let reason;
    if (match === 'NO-MATCH') {
        const noMatchProb = (matchType.probabilities.no_match * 100).toFixed(0);
        reason = `Disqualified (${noMatchProb}% confidence). Focus: ${focusLabel}.`;
    } else if (match === 'FULL-MATCH') {
        reason = `Strong alignment (${matchConf}% confidence). ${focusLabel} role matches core skills.`;
    } else {
        reason = `Partial alignment (${matchConf}% confidence). ${focusLabel} role, score ${finalScore}/5.`;
    }

    const uniqueInsight = facts.team && facts.team !== 'Not specified'
        ? `${facts.team} — ${focusLabel} (${focusConf}% focus confidence).`
        : `${focusLabel} role with ${relevanceConf}% relevance confidence.`;

    return {
        score: finalScore,
        match,
        reason,
        uniqueInsight,
        levelingNote,
        fullMatches: [...new Set(fullMatches)].slice(0, 3),
        partialMissing: [...new Set(partialMissing)].slice(0, 3),
        // tev1-specific metadata
        tev1: {
            relevance: { score: relevance.score, confidence: relevance.confidence, probabilities: relevance.probabilities },
            roleFocus: { choice: roleFocus.choice, confidence: roleFocus.confidence, probabilities: roleFocus.probabilities },
            matchType: { choice: matchType.choice, confidence: matchType.confidence, probabilities: matchType.probabilities },
            seniority: { choice: seniorityAns.choice, confidence: seniorityAns.confidence },
            usage: result.usage
        }
    };
}


function mergeFacts(f1, f2) {
    return {
        title: f1.title || f2.title || 'Not specified',
        seniority: (f1.seniority && f1.seniority !== 'unknown') ? f1.seniority : (f2.seniority || 'unknown'),
        minYears: f1.minYears != null ? f1.minYears : f2.minYears,
        locationType: (f1.locationType && f1.locationType !== 'unknown') ? f1.locationType : (f2.locationType || 'unknown'),
        roleFocus: (f1.roleFocus && f1.roleFocus !== 'other') ? f1.roleFocus : (f2.roleFocus || 'backend'),
        primaryLanguages: [...new Set([...(f1.primaryLanguages || []), ...(f2.primaryLanguages || [])])].slice(0, 6),
        requiredSkills: [...new Set([...(f1.requiredSkills || []), ...(f2.requiredSkills || [])])].slice(0, 15),
        preferredSkills: [...new Set([...(f1.preferredSkills || []), ...(f2.preferredSkills || [])])].slice(0, 10),
        salary: (f1.salary && f1.salary !== 'Not specified') ? f1.salary : (f2.salary || 'Not specified'),
        team: (f1.team && f1.team !== 'Not specified') ? f1.team : (f2.team || 'Not specified'),
        vagueJD: Boolean(f1.vagueJD && f2.vagueJD)
    };
}

async function extractOllamaFacts(baseUrl, model, pageText, signal) {
    const system = "You are a concise job posting extractor. Extract exact facts from the job posting strictly into the required schema.";
    const cleaned = cleanJobText(pageText);

    if (cleaned.length <= 12000) {
        return await ollamaJSON({
            baseUrl,
            model,
            system,
            user: `Job Posting:\n${cleaned}`,
            schema: FACTS_SCHEMA,
            signal
        });
    }

    const chunk1 = cleaned.substring(0, 9000);
    const chunk2 = cleaned.substring(7000, 16000);
    const [f1, f2] = await Promise.all([
        ollamaJSON({ baseUrl, model, system, user: `Job Posting (Part 1):\n${chunk1}`, schema: FACTS_SCHEMA, signal }),
        ollamaJSON({ baseUrl, model, system, user: `Job Posting (Part 2):\n${chunk2}`, schema: FACTS_SCHEMA, signal })
    ]);
    return mergeFacts(f1, f2);
}

function scoreFromFacts(f, resumeProfile = DEFAULT_RESUME_PROFILE) {
    const primaryLangs = Array.isArray(f.primaryLanguages) ? f.primaryLanguages : [];
    const reqSkills = Array.isArray(f.requiredSkills) ? f.requiredSkills : [];
    const prefSkills = Array.isArray(f.preferredSkills) ? f.preferredSkills : [];

    // Hard fails
    const hasPython = primaryLangs.some(l => /python/i.test(l)) || reqSkills.some(s => /python/i.test(s));
    const isNonUS = f.locationType === 'non_us';
    const disallowedFocus = ["frontend", "mobile", "embedded", "hardware", "firmware", "wireless", "kernel_driver"];
    const isDisallowedFocus = disallowedFocus.includes(f.roleFocus);
    const isUnderQualified = (f.minYears != null && f.minYears > 7);

    const failReasons = [];
    if (!hasPython) failReasons.push("Python is not a primary language or required skill");
    if (isNonUS) failReasons.push("Role is outside the US");
    if (isDisallowedFocus) failReasons.push(`Role focus (${f.roleFocus}) is not backend/infra`);
    if (isUnderQualified) failReasons.push(`Required experience (${f.minYears} yrs) exceeds 7 years`);

    if (failReasons.length > 0) {
        return {
            score: 0.0,
            match: "NO-MATCH",
            failReason: failReasons.join("; "),
            levelingNote: null,
            fullMatches: [],
            partialMissing: []
        };
    }

    const resumeSkills = new Set((resumeProfile.skills || DEFAULT_RESUME_PROFILE.skills).map(normSkill));
    const fullMatches = [];
    const partialMissing = [];

    const jdTech = [...primaryLangs, ...reqSkills];
    for (const tech of jdTech) {
        if (!tech) continue;
        if (resumeSkills.has(normSkill(tech))) {
            fullMatches.push(tech);
        } else {
            partialMissing.push(tech);
        }
    }

    const missingPreferred = [];
    for (const tech of prefSkills) {
        if (!tech) continue;
        if (!resumeSkills.has(normSkill(tech))) {
            missingPreferred.push(tech);
            partialMissing.push(tech);
        }
    }

    const dedupMatches = [...new Set(fullMatches)].slice(0, 3);
    const dedupMissing = [...new Set(partialMissing)].slice(0, 3);

    let score = 5.0;
    let levelingNote = null;

    if (f.seniority === 'staff' || f.seniority === 'principal') {
        score = Math.min(score, 4.0);
        levelingNote = `Staff+ role capped at 4.0 (candidate has ${resumeProfile.yearsExp || 5} yrs exp).`;
    }

    if (missingPreferred.length > 0) {
        score = Math.min(score, 3.5);
    }

    if (f.vagueJD) {
        score = Math.min(score, 3.5);
    }

    const match = score >= 4.5 ? "FULL-MATCH" : "SEMI-MATCH";

    return {
        score,
        match,
        levelingNote,
        fullMatches: dedupMatches,
        partialMissing: dedupMissing
    };
}

function renderFactsToStage1Text(f) {
    const locMap = {
        remote_us: 'Remote (US)',
        hybrid_us: 'Hybrid (US)',
        onsite_us: 'Onsite (US)',
        non_us: 'International / Non-US',
        unknown: 'Not specified'
    };
    const reqSkills = Array.isArray(f.requiredSkills) ? f.requiredSkills.join(', ') : (f.requiredSkills || 'Not specified');
    const prefSkills = Array.isArray(f.preferredSkills) ? f.preferredSkills.join(', ') : (f.preferredSkills || 'None specified');
    const langs = Array.isArray(f.primaryLanguages) ? f.primaryLanguages.join(', ') : (f.primaryLanguages || '');
    const combinedReq = langs ? `${langs}${reqSkills && reqSkills !== 'Not specified' ? ', ' + reqSkills : ''}` : reqSkills;

    return [
        `TITLE: ${f.title || 'Not specified'}`,
        `SALARY: ${f.salary || 'Not specified'}`,
        `LOCATION: ${locMap[f.locationType] || f.locationType || 'Not specified'}`,
        `EXPERIENCE: ${f.minYears != null ? f.minYears + '+ years' : 'Not specified'}`,
        `ROLE FOCUS: ${f.roleFocus ? f.roleFocus.toUpperCase() : 'Not specified'}`,
        `TEAM: ${f.team || 'Not specified'}`,
        `PRIMARY LANGUAGES: ${langs || 'Not specified'}`,
        `REQUIRED SKILLS: ${combinedReq || 'Not specified'}`,
        `PREFERRED SKILLS: ${prefSkills || 'None specified'}`,
        `KEY RESPONSIBILITIES: ${f.keyResponsibilities || f.title || 'Not specified'}`,
        `ABOUT ROLE: Seniority: ${f.seniority || 'unknown'}. ${f.vagueJD ? 'Vague JD.' : ''}`
    ].join('\n');
}

async function synthesizeOllamaSummary(baseUrl, model, facts, scored, signal) {
    const system = "You are a technical recruiter. Write a max 15-word reason and a max 15-word uniqueInsight based on the facts and score.";
    const user = `Facts:
Title: ${facts.title}
Team: ${facts.team}
Role Focus: ${facts.roleFocus}
Computed Score: ${scored.score}/5.0 (${scored.match})
Full Matches: ${scored.fullMatches.join(', ') || 'None'}
Gaps: ${scored.partialMissing.join(', ') || 'None'}
${scored.failReason ? `Disqualifier: ${scored.failReason}` : ''}

Generate the concise summary strictly into the schema.`;

    try {
        return await ollamaJSON({
            baseUrl,
            model,
            system,
            user,
            schema: SYNTHESIS_SCHEMA,
            numPredict: 512,
            signal
        });
    } catch (e) {
        console.warn('[Ollama] Synthesis call failed, using deterministic fallback:', e);
        return {
            reason: scored.failReason || (scored.match === 'FULL-MATCH' ? 'Strong alignment with core required backend technologies.' : 'Partial alignment with some skill or leveling gaps.'),
            uniqueInsight: facts.team !== 'Not specified' ? `${facts.team} ownership and architecture.` : 'Core backend infrastructure and scaling.',
            levelingNote: scored.levelingNote || null
        };
    }
}

async function checkProviderConnection(config) {
    const provider = config.provider || 'ondevice';

    if (provider === 'ondevice') {
        let aiAPI = null;
        if (typeof LanguageModel !== 'undefined') aiAPI = LanguageModel;
        else if (window.ai?.languageModel) aiAPI = window.ai.languageModel;
        if (!aiAPI) throw new Error("On-Device AI is not available. Enable #prompt-api-for-gemini-nano in chrome://flags.");

    } else if (provider === 'gemini') {
        if (!config.geminiApiKey) throw new Error("Gemini API key is missing. Add it in Settings.");
        const testUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${config.geminiApiKey}`;
        const res = await fetch(testUrl).catch(() => { throw new Error("Cannot reach Gemini API. Check your internet connection."); });
        if (!res.ok) throw new Error(`Gemini API error: ${res.status}. Check your API key in Settings.`);

    } else if (provider === 'ollama') {
        if (!config.ollamaModel) throw new Error("No Ollama model selected. Choose one in Settings.");
        const baseUrl = (config.ollamaUrl || 'http://localhost:11434').replace(/\/$/, '');
        // Note: ngrok-skip-browser-warning handled by background.js declarativeNetRequest
        const res = await fetch(`${baseUrl}/api/tags`).catch(() => { throw new Error(`Cannot reach Ollama at ${baseUrl}. Is Ollama running?`); });
        if (!res.ok) throw new Error(`Ollama server error: ${res.status}. Is Ollama running at ${baseUrl}?`);

        // Check if decision model is available
        const decisionModel = config.ollamaDecisionModel || 'tev1:4b';
        if (decisionModel !== 'none') {
            try {
                const checkRes = await fetch(`${baseUrl}/api/show`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: decisionModel })
                });
                if (checkRes.ok) {
                    const info = await checkRes.json();
                    const hasDecision = info.capabilities?.includes('decision') ?? false;
                    console.log(`[Connection] Decision model '${decisionModel}' ${hasDecision ? 'available ✓' : 'present (non-decision capability)'}`);
                } else {
                    console.log(`[Connection] Decision model '${decisionModel}' not found in Ollama — fallback will be used`);
                }
            } catch (_) {
                console.log(`[Connection] Decision model '${decisionModel}' check failed — fallback will be used`);
            }
        }
    }
}

function smartTruncate(text, maxLen) {
    if (text.length <= maxLen) return text;
    const truncated = text.substring(0, maxLen);
    const lastNewline = truncated.lastIndexOf('\n');
    if (lastNewline > maxLen - 200) {
        return truncated.substring(0, lastNewline);
    }
    return truncated;
}

// Convert Stage 1 JSON to labeled plain-text format for Stage 2 consumption
function formatStage1JSON(jsonObj) {
    const labels = {
        title: "TITLE",
        salary: "SALARY",
        team: "TEAM",
        location: "LOCATION",
        experience: "EXPERIENCE",
        roleFocus: "ROLE FOCUS",
        primaryLanguages: "PRIMARY LANGUAGES",
        requiredSkills: "REQUIRED SKILLS",
        preferredSkills: "PREFERRED SKILLS",
        keyResponsibilities: "KEY RESPONSIBILITIES",
        aboutRole: "ABOUT ROLE"
    };

    let output = "";
    for (const [key, label] of Object.entries(labels)) {
        if (jsonObj[key]) {
            output += `${label}: ${jsonObj[key]}\n`;
        }
    }
    return output.trim();
}

// Convert Summarizer API key-points markdown to Stage 1 JSON format
function formatSummarizerToStage1JSON(markdownText) {
    const json = {};

    // Try to extract fields from markdown bullet points
    const lines = markdownText.split('\n');
    for (const line of lines) {
        const match = line.match(/^[-*]\s*(.+?):\s*(.+)$/);
        if (match) {
            const [, key, value] = match;
            const normalizedKey = key.toLowerCase()
                .replace(/\s+/g, '')
                .replace(/role\s*focus/, 'roleFocus')
                .replace(/primary\s*languages/, 'primaryLanguages')
                .replace(/required\s*skills/, 'requiredSkills')
                .replace(/preferred\s*skills/, 'preferredSkills')
                .replace(/key\s*responsibilities/, 'keyResponsibilities')
                .replace(/about\s*role/, 'aboutRole');

            const fieldMap = {
                'title': 'title',
                'salary': 'salary',
                'team': 'team',
                'location': 'location',
                'experience': 'experience',
                'rolefocus': 'roleFocus',
                'primarylanguages': 'primaryLanguages',
                'requiredskills': 'requiredSkills',
                'preferredskills': 'preferredSkills',
                'keyresponsibilities': 'keyResponsibilities',
                'aboutrole': 'aboutRole'
            };

            const jsonKey = fieldMap[normalizedKey] || normalizedKey;
            if (value.trim() && value.trim() !== 'Not specified') {
                json[jsonKey] = value.trim();
            }
        }
    }

    // DEBUG
    aiLog(`[Summarizer Parsed Fields] ${JSON.stringify(json)}`);
    aiLog(`[Missing Fields] ${['salary', 'team', 'keyResponsibilities', 'aboutRole'].filter(f => !json[f]).join(', ')}`);

    return formatStage1JSON(json);
}


function cleanJobText(text) {
    // Strip boilerplate sections that waste tokens
    const boilerplatePhrases = [
        /about (the )?company[\s\S]{0,2000}?(requirements|responsibilities|qualifications|what you)/gi,
        /equal opportunity employer[\s\S]{0,500}/gi,
        /we are an equal[\s\S]{0,500}/gi,
        /benefits[\s\S]{0,800}?(requirements|responsibilities|qualifications|\n\n)/gi,
        /perks[\s\S]{0,500}?(requirements|responsibilities|qualifications|\n\n)/gi,
        /our mission[\s\S]{0,400}?\n\n/gi,
        /our (culture|values)[\s\S]{0,400}?\n\n/gi
    ];

    let cleaned = text;
    for (const re of boilerplatePhrases) {
        cleaned = cleaned.replace(re, ' ');
    }
    // Collapse excessive whitespace
    cleaned = cleaned.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    aiLog(`[cleanJobText] ${text.length} chars → ${cleaned.length} chars`);
    return cleaned;
}

async function preParseWithProvider(config, pageText, signal) {
    const s1Start = performance.now();
    const truncated = smartTruncate(pageText, INPUT_LIMITS.STAGE1_CLOUD);
    const systemPrompt = await getStage1SystemPrompt();
    const extractionPrompt = `${systemPrompt}\n\nJob Posting:\n${truncated}`;

    if (config.provider === 'gemini' && config.geminiApiKey) {
        const modelName = config.geminiModel || 'gemini-3.1-flash-lite';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${config.geminiApiKey}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: extractionPrompt }] }],
                generationConfig: {
                    responseSchema: STAGE1_RESPONSE_SCHEMA,
                    responseMimeType: "application/json"
                }
            }),
            signal
        });
        if (!response.ok) throw new Error(`Gemini Stage 1 failed: ${response.statusText}`);
        const data = await response.json();
        let jsonText = data.candidates[0].content.parts[0].text;
        jsonText = jsonText.replace(/```json\n?|```/g, '').trim();
        const parsed = JSON.parse(jsonText);
        const s1Dur = ((performance.now() - s1Start) / 1000).toFixed(2);
        console.log(`[${new Date().toLocaleTimeString()}] ⏱️ Gemini Stage 1 completed in ${s1Dur}s`);
        return { text: formatStage1JSON(parsed), processedCount: truncated.length };
    }

    if (config.provider === 'ollama') {
        if (!config.ollamaModel) throw new Error("No Ollama model selected. Please choose a model in Settings.");
        const facts = await extractOllamaFacts(config.ollamaUrl, config.ollamaModel, pageText, signal);
        _lastOllamaFacts = facts;
        const text = renderFactsToStage1Text(facts);
        const s1Dur = ((performance.now() - s1Start) / 1000).toFixed(2);
        console.log(`[${new Date().toLocaleTimeString()}] ⏱️ Ollama Stage 1 completed in ${s1Dur}s`);
        return { text, processedCount: pageText.length };
    }

    // Fallback to regex cleaner
    const cleaned = cleanJobText(pageText);
    const s1Dur = ((performance.now() - s1Start) / 1000).toFixed(2);
    console.log(`[${new Date().toLocaleTimeString()}] ⏱️ Regex cleaner Stage 1 completed in ${s1Dur}s`);
    return { text: cleaned, processedCount: pageText.length };
}

async function preParseJobText(pageText, useStage1 = true, signal = null, config = null) {
    if (!useStage1 || !pageText || pageText.length < 500) {
        console.log("Step 1 Skip.");
        return { text: pageText, provider: null, processedCount: 0 };
    }

    const preparseProvider = config?.preparseProvider || 'ondevice';

    if (preparseProvider === 'modelProvider' && config.provider !== 'ondevice') {
        console.log(`[${new Date().toLocaleTimeString()}] Step 1: Model Provider extraction...`);
        const { text, processedCount } = await preParseWithProvider(config, pageText, signal);
        aiLog(`Step 1 complete (Model Provider). ${pageText.length} → ${text.length} chars`);
        aiLog(`[Stage 1 Output]\n${text}`);
        return { text, provider: (config.provider === 'gemini') ? 'Gemini Stage 1' : 'Ollama Stage 1', processedCount };
    }

    const onDeviceAPI = config?.onDeviceAPI || 'summarizer';

    if (onDeviceAPI === 'prompt') {
        console.log(`[${new Date().toLocaleTimeString()}] Step 1: Prompt API extraction...`);
        const { text, processedCount } = await extractWithOnDevice(pageText, signal);
        if (!text || text.length <= 100) {
            throw new Error("Stage 1 failed: Prompt API returned insufficient output.");
        }
        aiLog(`Step 1 complete (Prompt API). ${pageText.length} → ${text.length} chars`);
        aiLog(`[Stage 1 Output]\n${text}`);
        return { text, provider: 'Prompt API (Gemini Nano)', processedCount };
    }

    // Summarizer API — streams chunks live via onChunk callback
    console.log(`[${new Date().toLocaleTimeString()}] Step 1: Summarizer API extraction (streaming)...`);
    const { text, processedCount } = await extractWithSummarizer(pageText, signal);
    if (!text || text.length <= 100) {
        throw new Error("Stage 1 failed: Summarizer API returned insufficient output.");
    }
    aiLog(`Step 1 complete (Summarizer API). ${pageText.length} → ${text.length} chars`);
    aiLog(`[Stage 1 Output]\n${text}`);
    return { text, provider: 'Summarizer API (Gemini Nano)', processedCount };
}

// Helper: Detect missing critical fields in Stage 1 output
function detectMissingFields(stage1Text) {
    const fields = {};
    const lines = stage1Text.split('\n');

    for (const line of lines) {
        const match = line.match(/^([A-Z\s]+):\s*(.+)$/);
        if (match) {
            const [, label, value] = match;
            const key = label.trim().toLowerCase().replace(/\s+/g, '');
            fields[key] = value.trim();
        }
    }

    const CRITICAL_FIELDS = ['salary', 'team', 'keyresponsibilities', 'aboutrole'];
    const missing = CRITICAL_FIELDS.filter(field =>
        !fields[field] || fields[field] === 'Not specified' || fields[field].length < 5
    );

    return missing;
}

// Helper: Refine Stage 1 output with chosen provider for missing fields
async function refineStage1WithProvider(config, fullPageText, missingFields, signal, offset = 0) {
    if (missingFields.length === 0) return null;

    // Focus on the text that wasn't processed in the first pass
    const restOfPage = fullPageText.substring(offset).trim();
    if (restOfPage.length < 200) {
        console.log(`[Refinement] Remaining text too short (${restOfPage.length} chars). Skipping.`);
        return null;
    }

    const refinementPrompt = `Extract ONLY these missing fields from the job posting. Return as JSON.
Fields needed: ${missingFields.join(', ')}

Job posting: ${smartTruncate(restOfPage, 10000)}`;

    const refinementSchema = {
        type: "object",
        properties: missingFields.reduce((acc, field) => {
            acc[field] = { type: "string" };
            return acc;
        }, {})
    };

    const provider = config?.provider || 'ondevice';

    try {
        if (provider === 'gemini' && config.geminiApiKey) {
            const modelName = config.geminiModel || 'gemini-3.1-flash-lite';
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${config.geminiApiKey}`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: refinementPrompt }] }],
                    generationConfig: {
                        responseSchema: refinementSchema,
                        responseMimeType: "application/json"
                    }
                }),
                signal
            });
            if (!response.ok) throw new Error(`Gemini Refinement failed: ${response.statusText}`);
            const data = await response.json();
            let jsonText = data.candidates[0].content.parts[0].text;
            jsonText = jsonText.replace(/```json\n?|```/g, '').trim();
            return JSON.parse(jsonText);
        }

        if (provider === 'ollama') {
            if (!config.ollamaModel) throw new Error("No Ollama model selected.");
            return await ollamaJSON({
                baseUrl: config.ollamaUrl,
                model: config.ollamaModel,
                system: "Extract only the requested missing fields from the job posting strictly into JSON.",
                user: `Job posting excerpt:\n${smartTruncate(restOfPage, 8000)}`,
                schema: refinementSchema,
                signal
            });
        }

        // Default to ondevice
        if (!_onDeviceSession) return null; // Skip if base session not initialized
        const session = await _onDeviceSession.clone({ signal });
        try {
            const response = await session.prompt(refinementPrompt, {
                responseConstraint: refinementSchema,
                signal
            });
            return JSON.parse(response);
        } finally {
            if (session && typeof session.destroy === 'function') session.destroy();
        }
    } catch (err) {
        console.error(`[Refinement] ${provider} Failed:`, err);
        return null;
    }
}

// Helper: Merge refined fields back into Stage 1 output
function mergeRefinedFields(stage1Text, refinedData) {
    if (!refinedData) return stage1Text;

    const labels = {
        salary: 'SALARY',
        team: 'TEAM',
        keyresponsibilities: 'KEY RESPONSIBILITIES',
        aboutrole: 'ABOUT ROLE'
    };

    let output = stage1Text;

    for (const [field, value] of Object.entries(refinedData)) {
        if (value && value.trim()) {
            const label = labels[field.toLowerCase()] || field;
            const regex = new RegExp(`^${label}:.*$`, 'mi');

            if (regex.test(output)) {
                // Replace existing (empty) field
                output = output.replace(regex, `${label}: ${value}`);
            } else {
                // Append new field
                output += `\n${label}: ${value}`;
            }
        }
    }

    return output;
}

async function summarizeJob(config, pageText, signal, onStage1Done = null, onStage2Start = null) {
    const provider = config.provider || 'ondevice';
    const overallStartTime = performance.now();

    console.log(`[${new Date().toLocaleTimeString()}] AI Evaluation Started - Provider: ${provider}`);
    aiLog(`[${new Date().toLocaleTimeString()}] Step 1: Pre-parsing started. Input: ${pageText.length} chars`);

    const preParseStart = performance.now();
    const useStage1 = config.useSummarizer === true; // Default to false — re-enable when on-device is stable
    const parseResult = await preParseJobText(pageText, useStage1, signal, config);
    let processedText = parseResult.text;
    const stage1Provider = parseResult.provider;

    // HYBRID: Detect and refine missing fields (always attempt, works with any Stage 2 provider)
    if (useStage1) {
        const missing = detectMissingFields(processedText);
        if (missing.length > 0) {
            console.log(`[Hybrid] Missing fields detected: ${missing.join(', ')}. Offset: ${parseResult.processedCount || 0}`);
            const refined = await refineStage1WithProvider(config, pageText, missing, signal, parseResult.processedCount || 0);
            if (refined) {
                processedText = mergeRefinedFields(processedText, refined);
                console.log(`[Hybrid] Refinement complete. Fields now present.`);
            } else {
                console.log(`[Hybrid] Refinement skipped (Prompt API unavailable, failed, or no new text).`);
            }
        }
    }

    const preParseEnd = performance.now();
    const preParseDuration = ((preParseEnd - preParseStart) / 1000).toFixed(2);

    console.log(`[${new Date().toLocaleTimeString()}] ⏱️ Stage 1 (${stage1Provider || (useStage1 ? 'Pre-parsing' : 'Bypassed')}): ${preParseDuration}s (Output: ${processedText.length} chars)`);

    // Notify the UI that Stage 1 is done (skipped flag = true when Stage 1 was bypassed)
    if (onStage1Done) onStage1Done(processedText, preParseDuration, !useStage1, stage1Provider);

    // If request was cancelled during pre-parsing, stop here
    if (signal && signal.aborted) {
        console.log(`[${new Date().toLocaleTimeString()}] Evaluation aborted by user step 1.`);
        throw new DOMException('Aborted', 'AbortError');
    }

    if (onStage2Start) onStage2Start();

    console.log(`[${new Date().toLocaleTimeString()}] Step 2: Relevance Analysis started. Input: ${processedText.length} chars`);
    const relevanceStart = performance.now();

    let result;
    if (provider === 'ondevice') {
        result = await summarizeWithOnDevice(processedText, signal, config.onDeviceAPI);
    } else if (provider === 'gemini') {
        if (!config.geminiApiKey) throw new Error("Gemini API key is missing.");
        result = await summarizeWithGemini(config.geminiApiKey, config.geminiModel, processedText, signal);
    } else {
        const model = config.ollamaModel;
        if (!model) throw new Error("No Ollama model selected. Please choose a model in Settings.");
        const url = config.ollamaUrl;
        console.log(`[${new Date().toLocaleTimeString()}] Ollama Config - Model: ${model}, URL: ${url}`);
        result = await summarizeWithOllama(url, model, processedText, signal, config);
    }

    const relevanceEnd = performance.now();
    const relevanceDuration = ((relevanceEnd - relevanceStart) / 1000).toFixed(2);
    const outputLength = result.raw ? result.raw.length : 0;

    console.log(`[${new Date().toLocaleTimeString()}] ⏱️ Stage 2 (Relevance Analysis): ${relevanceDuration}s (Output: ${outputLength} chars)`);

    const overallDuration = ((performance.now() - overallStartTime) / 1000).toFixed(2);

    // Timing summary breakdown (always visible in console)
    console.log(`\n╔════════════════════════════════════════╗
║        ⏱️  TIMING BREAKDOWN             ║
╠════════════════════════════════════════╣
║ Stage 1 (Pre-parsing):    ${preParseDuration.padStart(6)}s  │
║ Stage 2 (Relevance):      ${relevanceDuration.padStart(6)}s  │
║ ─────────────────────────────────────  │
║ Total Time:               ${overallDuration.padStart(6)}s  │
╚════════════════════════════════════════╝\n`);
    console.log(`[${new Date().toLocaleTimeString()}] AI Evaluation Complete in ${overallDuration}s.`);

    result.preParsed = processedText;
    result.timings = {
        stage1: preParseDuration,
        stage2: relevanceDuration,
        total: overallDuration
    };
    return result;
}

async function summarizeWithGemini(apiKey, model, pageText, signal) {
    const geminiStart = performance.now();
    const prompt = await fetchPrompt(pageText, false);
    const parts = [{ text: prompt }];

    const modelName = model || 'gemini-3.1-flash-lite';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: parts }]
        }),
        signal: signal
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Gemini analysis failed');
    }

    const data = await response.json();
    const resultText = data.candidates[0].content.parts[0].text;
    const geminiDur = ((performance.now() - geminiStart) / 1000).toFixed(2);
    console.log(`[${new Date().toLocaleTimeString()}] ⏱️ Gemini Relevance Analysis completed in ${geminiDur}s`);
    return {
        parsed: parseAIResponse(resultText),
        raw: resultText
    };
}

async function summarizeWithOllama(baseUrl, model, pageText, signal, config = null) {
    if (!model) throw new Error("No Ollama model selected. Please choose a model in Settings.");

    const ollamaTotalStart = performance.now();
    // Check if Stage 1 already extracted facts
    let facts = _lastOllamaFacts;
    _lastOllamaFacts = null; // consume cached facts

    if (!facts) {
        console.log(`[${new Date().toLocaleTimeString()}] Step 1: Ollama extracting facts via structured schema...`);
        const extractStart = performance.now();
        facts = await extractOllamaFacts(baseUrl, model, pageText, signal);
        const extractDur = ((performance.now() - extractStart) / 1000).toFixed(2);
        console.log(`[${new Date().toLocaleTimeString()}] ⏱️ Ollama Fact Extraction completed in ${extractDur}s`);
    } else {
        console.log(`[${new Date().toLocaleTimeString()}] ⏱️ Ollama Fact Extraction: Reused cached Stage 1 facts`);
    }

    // Load candidate resume profile from config/storage or use default
    let resumeProfile = config?.resumeProfile || DEFAULT_RESUME_PROFILE;
    if (!config?.resumeProfile && typeof chrome !== 'undefined' && chrome.storage?.local) {
        try {
            const stored = await chrome.storage.local.get(['resumeProfile']);
            if (stored.resumeProfile) resumeProfile = stored.resumeProfile;
        } catch (_) {}
    }

    // Step 2: Decision scoring via System One or Deterministic Code
    const decisionModel = config?.ollamaDecisionModel ?? 'tev1:4b';
    let scored;

    if (decisionModel === 'none') {
        // Explicitly set to none: use deterministic scoring in code
        console.log(`[${new Date().toLocaleTimeString()}] Step 2: Deterministic Code Scoring (Decision model set to 'none')...`);
        const scoreStart = performance.now();
        scored = scoreFromFacts(facts, resumeProfile);
        const scoreDur = (performance.now() - scoreStart).toFixed(2);
        console.log(`[${new Date().toLocaleTimeString()}] ⏱️ Deterministic Code Scoring completed in ${scoreDur}ms (Score: ${scored.score}/5, ${scored.match})`);

        console.log(`[${new Date().toLocaleTimeString()}] Step 2b: Ollama synthesizing recruiter highlights...`);
        const synthStart = performance.now();
        const synth = await synthesizeOllamaSummary(baseUrl, model, facts, scored, signal);
        const synthDur = ((performance.now() - synthStart) / 1000).toFixed(2);
        console.log(`[${new Date().toLocaleTimeString()}] ⏱️ Ollama Recruiter Synthesis completed in ${synthDur}s`);

        scored.reason = synth.reason || (scored.failReason ? scored.failReason : 'Evaluated against candidate profile.');
        scored.uniqueInsight = synth.uniqueInsight || 'Core team challenges and engineering scope.';
        scored.levelingNote = scored.levelingNote || synth.levelingNote || null;
    } else {
        // System One decision model (e.g. tev1:4b) with graceful fallback
        console.log(`[${new Date().toLocaleTimeString()}] Step 2: System One decision scoring using ${decisionModel}...`);
        try {
            const decisionStart = performance.now();
            scored = await scoreWithSystemOne(baseUrl, facts, signal, resumeProfile, decisionModel);
            const decisionDur = ((performance.now() - decisionStart) / 1000).toFixed(2);
            console.log(`[${new Date().toLocaleTimeString()}] ⏱️ ${decisionModel} Decision Scoring completed in ${decisionDur}s ` +
                `(Score: ${scored.score}/5, ${scored.match}, Confidence: ${(scored.tev1.relevance.confidence * 100).toFixed(0)}%)`);
        } catch (err) {
            console.warn(`[SystemOne] Decision model '${decisionModel}' failed or unavailable, falling back to deterministic + chat synthesis:`, err);
            const scoreStart = performance.now();
            scored = scoreFromFacts(facts, resumeProfile);
            const scoreDur = (performance.now() - scoreStart).toFixed(2);
            console.log(`[${new Date().toLocaleTimeString()}] ⏱️ Deterministic Code Scoring completed in ${scoreDur}ms (Score: ${scored.score}/5, ${scored.match})`);

            console.log(`[${new Date().toLocaleTimeString()}] Step 2b: Ollama synthesizing recruiter highlights...`);
            const synthStart = performance.now();
            const synth = await synthesizeOllamaSummary(baseUrl, model, facts, scored, signal);
            const synthDur = ((performance.now() - synthStart) / 1000).toFixed(2);
            console.log(`[${new Date().toLocaleTimeString()}] ⏱️ Ollama Recruiter Synthesis completed in ${synthDur}s`);

            scored.reason = synth.reason || (scored.failReason ? scored.failReason : 'Evaluated against candidate profile.');
            scored.uniqueInsight = synth.uniqueInsight || 'Core team challenges and engineering scope.';
            scored.levelingNote = scored.levelingNote || synth.levelingNote || null;
        }
    }

    const ollamaTotalDur = ((performance.now() - ollamaTotalStart) / 1000).toFixed(2);
    console.log(`[${new Date().toLocaleTimeString()}] ⏱️ Total Ollama Pipeline completed in ${ollamaTotalDur}s`);

    const parsed = {
        title: facts.title || 'Not specified',
        salary: facts.salary || 'Not specified',
        team: facts.team || 'Not specified',
        expReq: (facts.minYears != null ? `${facts.minYears}+ years` : 'Not specified'),
        relevanceScore: scored.score,
        summary: {
            primaryStatus: {
                match: scored.match,
                reason: scored.reason
            },
            levelingNote: scored.levelingNote,
            fullMatches: scored.fullMatches,
            partialMissing: scored.partialMissing,
            uniqueInsight: scored.uniqueInsight
        }
    };

    return {
        parsed,
        raw: JSON.stringify(parsed, null, 2),
        facts,
        tev1: scored.tev1 || null
    };
}

async function fetchOllamaModels(baseUrl) {
    const url = (baseUrl || 'http://localhost:11434').replace(/\/$/, '') + '/api/tags';
    try {
        const response = await fetch(url);
        if (!response.ok) {
            const errBody = await response.text().catch(() => '');
            throw new Error(`Failed to fetch Ollama models (${response.status}): ${errBody || response.statusText}`);
        }
        const data = await response.json();
        const rawModels = data.models || [];

        // Filter for chat/completion-capable models (exclude embedding-only models)
        const chatModels = rawModels.filter(m => {
            if (Array.isArray(m.capabilities) && m.capabilities.length > 0) {
                return m.capabilities.includes('completion') || m.capabilities.includes('tools') || m.capabilities.includes('thinking');
            }
            const name = (m.name || '').toLowerCase();
            return !name.startsWith('embedding') && !name.includes('embed') && !name.includes('bge-') && !name.includes('minilm') && !name.includes('tev1');
        });

        // Filter for decision models (models with 'decision' capability or known decision models like tev1)
        const decisionModels = rawModels.filter(m => {
            if (Array.isArray(m.capabilities) && m.capabilities.length > 0) {
                return m.capabilities.includes('decision');
            }
            const name = (m.name || '').toLowerCase();
            return name.includes('tev1');
        });

        const chatNames = (chatModels.length > 0 ? chatModels : rawModels).map(m => m.name).sort();
        const decisionNames = decisionModels.map(m => m.name).sort();

        // Return array of chat names with attached classification properties for backward compatibility
        const result = chatNames;
        result.chat = chatNames;
        result.decision = decisionNames;
        result.all = rawModels.map(m => m.name).sort();
        return result;
    } catch (error) {
        console.error("fetchOllamaModels error:", error);
        return [];
    }
}

// Persistent on-device session — created once at startup, reused via clone()
let _onDeviceSession = null;

async function initOnDeviceModel() {
    const aiAPI = await getOnDeviceAPI();
    if (!aiAPI) return { success: false, reason: 'On-Device AI not available. Enable #prompt-api-for-gemini-nano in chrome://flags.' };

    if (_onDeviceSession) return { success: true }; // already initialized

    try {
        // Query model limits first — topK and temperature must be within allowed ranges
        const params = typeof aiAPI.params === 'function' ? await aiAPI.params() : null;
        const maxTopK = params?.maxTopK ?? 128;
        const maxTemperature = params?.maxTemperature ?? 2;

        console.log('[OnDevice] Initializing model...');
        _onDeviceSession = await aiAPI.create({
            systemPrompt: "You are a concise job posting parser.",
            expectedInputLanguages: ['en'],
            expectedOutputLanguage: 'en',
            // Low temperature + topK = greedy decoding: deterministic, fast, ideal for structured extraction
            temperature: Math.min(0.1, maxTemperature),
            topK: Math.min(1, maxTopK)
        });
        console.log(`[OnDevice] Model ready. temperature=0.1, topK=1 (max: ${maxTemperature}, ${maxTopK})`);
        return { success: true };
    } catch (err) {
        if (err.message?.includes('space')) {
            return { success: false, reason: 'Not enough disk space (~1.5GB needed). Free up space or use a different provider.' };
        }
        return { success: false, reason: err.message };
    }
}

async function getOnDeviceAPI() {
    let aiAPI = null;
    if (typeof LanguageModel !== 'undefined') {
        aiAPI = LanguageModel;
    } else if (window.ai && window.ai.languageModel) {
        aiAPI = window.ai.languageModel;
    }
    if (!aiAPI) return null;

    if (typeof aiAPI.capabilities !== 'function' && typeof aiAPI.availability !== 'function') {
        return null;
    }

    const capabilities = typeof aiAPI.availability === 'function' ?
        await aiAPI.availability() :
        await aiAPI.capabilities();

    const isAvailable = capabilities === 'readily' || capabilities.available === 'readily' ||
        capabilities === 'after-download' || capabilities.available === 'after-download' ||
        capabilities === 'downloadable' || capabilities.available === 'downloadable' ||
        capabilities === 'available' || capabilities.available === 'available';

    return isAvailable ? aiAPI : null;
}

async function extractWithOnDevice(pageText, signal) {
    if (!_onDeviceSession) {
        const init = await initOnDeviceModel();
        if (!init.success) throw new Error(init.reason);
    }

    const truncated = smartTruncate(pageText, INPUT_LIMITS.STAGE1_NANO);
    const systemPrompt = await getStage1SystemPrompt();
    const prompt = `${systemPrompt}\n\nJob Posting:\n${truncated}`;

    // Clone from persistent base session — fast, no re-init needed
    const session = await _onDeviceSession.clone({ signal });
    try {
        const response = await session.prompt(prompt, { responseConstraint: STAGE1_RESPONSE_SCHEMA, signal });
        const parsed = JSON.parse(response);
        return { text: formatStage1JSON(parsed), processedCount: truncated.length };
    } finally {
        if (typeof session.destroy === 'function') session.destroy();
    }
}

async function getSummarizerAPI() {
    let summarizerAPI = null;
    if (typeof Summarizer !== 'undefined') {
        summarizerAPI = Summarizer;
    } else if (window.ai && window.ai.summarizer) {
        summarizerAPI = window.ai.summarizer;
    }
    if (!summarizerAPI) return null;

    if (typeof summarizerAPI.availability !== 'function') return null;

    const availability = await summarizerAPI.availability();
    const isAvailable = availability === 'readily' || availability === 'after-download' ||
        availability === 'downloadable' || availability === 'available';

    return isAvailable ? summarizerAPI : null;
}

async function extractWithSummarizer(pageText, signal) {
    const summarizerAPI = await getSummarizerAPI();
    if (!summarizerAPI) {
        throw new Error("Summarizer API is not available. Please ensure #summarization-api-for-gemini-nano is enabled in chrome://flags.");
    }

    let summarizer;
    try {
        summarizer = await summarizerAPI.create({
            type: 'key-points',
            format: 'markdown',
            length: 'long',
            signal: signal
        });
    } catch (err) {
        if (err.message && err.message.includes('space')) {
            throw new Error("Not enough disk space to download the Gemini Nano model (~1.5GB needed). Please free up space or use a different AI Provider.");
        }
        throw err;
    }

    try {
        let truncated = smartTruncate(pageText, INPUT_LIMITS.STAGE1_SUMMARIZER); // initial rough cut

        // Dynamically fit within the summarizer's actual token quota
        if (typeof summarizer.measureInputUsage === 'function' && summarizer.inputQuota) {
            const quota = summarizer.inputQuota;
            let inputUsage = await summarizer.measureInputUsage(truncated);

            while (inputUsage > quota && truncated.length > 500) {
                const ratio = quota / inputUsage;
                truncated = smartTruncate(truncated, Math.floor(truncated.length * ratio * 0.9));
                inputUsage = await summarizer.measureInputUsage(truncated);
            }

    aiLog(`[Summarizer] Token usage: ${inputUsage} / ${quota} (${Math.round((inputUsage / quota) * 100)}% of quota)`);
        } else {
            truncated = smartTruncate(truncated, INPUT_LIMITS.STAGE1_CLOUD);
        }

        const summaryText = await summarizer.summarize(truncated, { signal });

        // DEBUG: raw Summarizer output
        aiLog(`[Summarizer Raw Output]\n${summaryText}`);
        aiLog(`[Summarizer Output Length] ${summaryText.length} chars`);

        // Summarizer returns key-points markdown; convert to Stage 1 JSON format
        return { text: formatSummarizerToStage1JSON(summaryText), processedCount: truncated.length };
    } finally {
        if (typeof summarizer.destroy === 'function') {
            summarizer.destroy();
        }
    }
}

async function summarizeWithOnDevice(pageText, signal, onDeviceAPI = 'prompt') {
    // Route to Summarizer API (key-points) or Prompt API (full scoring rubric)
    if (onDeviceAPI === 'summarizer') {
        console.log(`[${new Date().toLocaleTimeString()}] Step 2: On-device via Summarizer API`);
        const text = await extractWithSummarizer(pageText, signal);
        // Summarizer returns plain-text key-points, not JSON — wrap it so the UI can display it
        return {
            parsed: {
                title: 'N/A',
                salary: 'N/A',
                team: 'N/A',
                expReq: 'N/A',
                relevanceScore: 0,
                summary: {
                    primaryStatus: { match: 'SEMI-MATCH', reason: 'On-device Summarizer API used — no scoring rubric applied.' },
                    levelingNote: null,
                    fullMatches: [],
                    partialMissing: [],
                    uniqueInsight: text
                }
            },
            raw: text
        };
    }

    // Default: Prompt API with full scoring rubric + structured JSON output
    const prompt = await fetchPrompt(pageText, false);
    console.log(`[${new Date().toLocaleTimeString()}] Step 2: Prompt size ${prompt.length} chars`);

    const aiAPI = await getOnDeviceAPI();
    if (!aiAPI) {
        throw new Error("On-Device AI is not available. Please ensure #prompt-api-for-gemini-nano is enabled in chrome://flags.");
    }

    // JSON Schema matching our expected output — guarantees valid JSON from the model
    const responseSchema = {
        type: "object",
        properties: {
            title: { type: "string" },
            salary: { type: "string" },
            team: { type: "string" },
            expReq: { type: "string" },
            relevanceScore: { type: "number" },
            summary: {
                type: "object",
                properties: {
                    primaryStatus: {
                        type: "object",
                        properties: {
                            match: { type: "string", enum: ["NO-MATCH", "SEMI-MATCH", "FULL-MATCH"] },
                            reason: { type: "string" }
                        },
                        required: ["match", "reason"]
                    },
                    levelingNote: { type: ["string", "null"] },
                    fullMatches: { type: "array", items: { type: "string" } },
                    partialMissing: { type: "array", items: { type: "string" } },
                    uniqueInsight: { type: "string" }
                },
                required: ["primaryStatus", "fullMatches", "partialMissing", "uniqueInsight"]
            }
        },
        required: ["title", "salary", "team", "expReq", "relevanceScore", "summary"]
    };

    let session;
    try {
        session = await aiAPI.create({
            systemPrompt: "You are an expert technical recruiter analyzing job descriptions.",
            expectedInputLanguages: ['en'],
            expectedOutputLanguage: 'en',
            signal: signal
        });
    } catch (err) {
        if (err.message && err.message.includes('space')) {
            throw new Error("Not enough disk space to download the Gemini Nano model (~1.5GB needed). Please free up space or use a different AI Provider.");
        }
        throw err;
    }

    try {
        const promptStart = performance.now();
        const response = await session.prompt(prompt, { responseConstraint: responseSchema });
        const promptDur = ((performance.now() - promptStart) / 1000).toFixed(2);
        console.log(`[${new Date().toLocaleTimeString()}] ⏱️ Prompt API inference completed in ${promptDur}s`);
        // responseConstraint guarantees valid JSON — no regex stripping needed
        const parsed = JSON.parse(response);
        return { parsed, raw: response };
    } finally {
        if (typeof session.destroy === 'function') {
            session.destroy();
        }
    }
}

async function fetchPrompt(pageText, includePDFRef) {
    try {
        let template = await loadPromptFromFile('stage_2.md');
        if (!template) throw new Error("Could not load stage_2.md");

        // Limit page text to prevent context window blowup
        // Ollama is further truncated at call site; Gemini Cloud has 1M tok budget
        const limitedText = smartTruncate(pageText, INPUT_LIMITS.STAGE2_DEFAULT);

        // 2. Handle Resume Source
        let resumeSource = "";
        if (includePDFRef) {
            resumeSource = "A PDF of my resume (attached)";
        } else {
            // If using Ollama/Local, we MUST inject the resume as text because they don't support PDF attachments
            try {
                // We'll try to find a resume.txt or use a default string for now
                // Ideally, we should have a way to extract text from the PDF locally
                // For now, let's warn that Ollama needs a text fallback or just tell it to assume Saumil's background
                resumeSource = "Saumil Shah (Senior Backend Engineer, 5 years exp, Python/FastAPI/Distributed Systems/Postgres/Redis/Kubernetes expertise).";
            } catch (e) {
                resumeSource = "My skills and experience (Candidate profile)";
            }
        }

        return template
            .replace('{{resumeSource}}', resumeSource)
            .replace('{{pageText}}', limitedText);
    } catch (error) {
        console.error("Failed to load prompt template:", error);
        throw new Error("Could not load prompt template.");
    }
}

function parseAIResponse(text) {
    try {
        // Strip markdown fences if present (e.g. ```json ... ```)
        const stripped = text.replace(/```(?:json)?\n?/g, '').trim();
        // Find the outermost JSON object
        const start = stripped.indexOf('{');
        const end   = stripped.lastIndexOf('}');
        if (start === -1 || end === -1) throw new Error('No JSON object found in response');
        return JSON.parse(stripped.substring(start, end + 1));
    } catch (e) {
        console.error('Failed to parse AI response. Raw text:', text);
        throw new Error('AI returned invalid JSON. Try again or check your model settings.');
    }
}
