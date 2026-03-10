// ai_service.js - Support for Gemini and Ollama (Local)

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
    STAGE1_NANO: 4000,  // Gemini Nano — tight limit keeps Stage 1 fast (~1K tok input)
    STAGE1_SUMMARIZER: 8000,  // Summarizer API — initial rough cut, then dynamic via measureInputUsage()
    STAGE1_CLOUD: 6000,  // Gemini Cloud — extraction doesn't need more
    STAGE2_DEFAULT: 10000,  // Gemini Cloud — 1M tok context, 10K chars is cost-efficient
    STAGE2_ON_DEVICE: 6000,  // Gemini Nano Stage 2 — after ~3.2K prompt template overhead
    STAGE2_OLLAMA: 4000,  // Ollama — 4096 default ctx minus prompt overhead minus output
    OLLAMA_CTX: 4096,  // Default Ollama context window (tokens)
    OLLAMA_S1_PREDICT: 400,  // Stage 1 max output tokens — keep tight for speed
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

    // DEBUG: Show what was extracted from Summarizer
    console.log(`[Summarizer Parsed Fields] ${JSON.stringify(json)}`);
    console.log(`[Missing Fields] ${['salary', 'team', 'keyResponsibilities', 'aboutRole'].filter(f => !json[f]).join(', ')}`);

    return formatStage1JSON(json);
}

async function loadResumePDF() {
    try {
        const response = await fetch(chrome.runtime.getURL('resume.pdf'));
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64 = reader.result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.error("Failed to load resume PDF:", error);
        return null;
    }
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
    console.log(`[cleanJobText] ${text.length} chars → ${cleaned.length} chars`);
    return cleaned;
}

async function preParseWithProvider(config, pageText, signal) {
    // const truncated = smartTruncate(pageText, INPUT_LIMITS.STAGE1_CLOUD);
    const truncated = pageText;
    const systemPrompt = await getStage1SystemPrompt();
    const extractionPrompt = `${systemPrompt}\n\nJob Posting:\n${truncated}`;

    if (config.provider === 'gemini' && config.geminiApiKey) {
        const modelName = config.geminiModel || 'gemini-2.5-flash';
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
        return { text: formatStage1JSON(parsed), processedCount: truncated.length };
    }

    if (config.provider === 'ollama') {
        if (!config.ollamaModel) throw new Error("No Ollama model selected. Please choose a model in Settings.");
        const url = (config.ollamaUrl || 'http://localhost:11434').replace(/\/$/, '') + '/api/chat';
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: config.ollamaModel,
                messages: [{ role: 'user', content: extractionPrompt }],
                stream: false,
                format: STAGE1_RESPONSE_SCHEMA,
                options: { num_ctx: INPUT_LIMITS.OLLAMA_CTX, temperature: 0.1, num_predict: INPUT_LIMITS.OLLAMA_S1_PREDICT },
                keep_alive: "5m"
            }),
            signal
        });
        if (!response.ok) throw new Error(`Ollama Stage 1 failed: ${response.statusText}`);
        const data = await response.json();
        let jsonText = data.message?.content || '';
        jsonText = jsonText.replace(/```json\n?|```/g, '').trim();
        const parsed = JSON.parse(jsonText);
        return { text: formatStage1JSON(parsed), processedCount: truncated.length };
    }

    // Fallback to regex cleaner
    return { text: cleanJobText(pageText), processedCount: pageText.length };
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
        console.log(`Step 1 complete (Model Provider). ${pageText.length} → ${text.length} chars`);
        console.log(`[Stage 1 Output]\n${text}`);
        return { text, provider: (config.provider === 'gemini') ? 'Gemini Stage 1' : 'Ollama Stage 1', processedCount };
    }

    const onDeviceAPI = config?.onDeviceAPI || 'summarizer';

    if (onDeviceAPI === 'prompt') {
        console.log(`[${new Date().toLocaleTimeString()}] Step 1: Prompt API extraction...`);
        const { text, processedCount } = await extractWithOnDevice(pageText, signal);
        if (!text || text.length <= 100) {
            throw new Error("Stage 1 failed: Prompt API returned insufficient output.");
        }
        console.log(`Step 1 complete (Prompt API). ${pageText.length} → ${text.length} chars`);
        console.log(`[Stage 1 Output]\n${text}`);
        return { text, provider: 'Prompt API (Gemini Nano)', processedCount };
    }

    // Summarizer API — streams chunks live via onChunk callback
    console.log(`[${new Date().toLocaleTimeString()}] Step 1: Summarizer API extraction (streaming)...`);
    const { text, processedCount } = await extractWithSummarizer(pageText, signal);
    if (!text || text.length <= 100) {
        throw new Error("Stage 1 failed: Summarizer API returned insufficient output.");
    }
    console.log(`Step 1 complete (Summarizer API). ${pageText.length} → ${text.length} chars`);
    console.log(`[Stage 1 Output]\n${text}`);
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
            const modelName = config.geminiModel || 'gemini-2.5-flash';
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
            const url = (config.ollamaUrl || 'http://localhost:11434').replace(/\/$/, '') + '/api/chat';
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: config.ollamaModel,
                    messages: [{ role: 'user', content: refinementPrompt }],
                    stream: false,
                    format: refinementSchema,
                    options: { num_ctx: INPUT_LIMITS.OLLAMA_CTX, temperature: 0.1, num_predict: INPUT_LIMITS.OLLAMA_S1_PREDICT },
                    keep_alive: "5m"
                }),
                signal
            });
            if (!response.ok) throw new Error(`Ollama Refinement failed: ${response.statusText}`);
            const data = await response.json();
            let jsonText = data.message?.content || '';
            jsonText = jsonText.replace(/```json\n?|```/g, '').trim();
            return JSON.parse(jsonText);
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
    console.log(`[${new Date().toLocaleTimeString()}] Step 1: Pre-parsing started. Input: ${pageText.length} chars`);

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

    console.log(`[${new Date().toLocaleTimeString()}] Step 1: Pre-parsing finished in ${preParseDuration}s. Output: ${processedText.length} chars`);

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
        result = await summarizeWithOllama(url, model, processedText, signal);
    }

    const relevanceEnd = performance.now();
    const relevanceDuration = ((relevanceEnd - relevanceStart) / 1000).toFixed(2);
    const outputLength = result.raw ? result.raw.length : 0;

    console.log(`[${new Date().toLocaleTimeString()}] Step 2: Relevance Analysis finished in ${relevanceDuration}s. Output: ${outputLength} chars`);

    const overallDuration = ((performance.now() - overallStartTime) / 1000).toFixed(2);

    // Timing breakdown
    console.log(`
╔════════════════════════════════════════╗
║        ⏱️  TIMING BREAKDOWN             ║
╠════════════════════════════════════════╣
║ Stage 1 (Pre-parsing):    ${preParseDuration.padStart(6)}s  │
║ Stage 2 (Relevance):      ${relevanceDuration.padStart(6)}s  │
║ ─────────────────────────────────────  │
║ Total Time:               ${overallDuration.padStart(6)}s  │
╚════════════════════════════════════════╝
    `);
    console.log(`[${new Date().toLocaleTimeString()}] AI Evaluation Complete.`);

    result.preParsed = processedText;
    return result;
}

async function summarizeWithGemini(apiKey, model, pageText, signal) {
    const prompt = await fetchPrompt(pageText, false);
    const parts = [{ text: prompt }];

    const modelName = model || 'gemini-2.5-flash';
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
    return {
        parsed: parseAIResponse(resultText),
        raw: resultText
    };
}

async function summarizeWithOllama(baseUrl, model, pageText, signal) {
    if (!model) throw new Error("No Ollama model selected. Please choose a model in Settings.");

    // Truncate before building prompt — Ollama default ctx is 4096 tokens
    const truncatedText = smartTruncate(pageText, INPUT_LIMITS.STAGE2_OLLAMA);
    const prompt = await fetchPrompt(truncatedText, false);
    const url = (baseUrl || 'http://localhost:11434').replace(/\/$/, '') + '/api/chat';

    console.log(`[${new Date().toLocaleTimeString()}] Step 2: Prompt size ${prompt.length} chars (~${Math.round(prompt.length / 4)} tokens)`);

    // Split into system (rubric) + user (JD context) for better model perf
    const systemStopIdx = prompt.indexOf("### Context");
    const system = systemStopIdx > 0 ? prompt.substring(0, systemStopIdx).trim() : "";
    const user = systemStopIdx > 0 ? prompt.substring(systemStopIdx).trim() : prompt;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: model,
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: user }
            ],
            stream: true,
            format: 'json',
            options: {
                num_ctx: INPUT_LIMITS.OLLAMA_CTX,
                temperature: 0.1,
                num_predict: -1  // Stage 2: unlimited output for full JSON
            },
            keep_alive: "5m"
        }),
        signal: signal
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("Ollama API Error:", errorText);
        throw new Error(`Ollama failed: ${response.statusText}. Status: ${response.status}`);
    }

    // Stream the response and accumulate tokens
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let stats = {};

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n').filter(l => l.trim())) {
            try {
                const parsed = JSON.parse(line);
                if (parsed.message?.content) fullText += parsed.message.content;
                if (parsed.done) stats = parsed;
            } catch (_) { }
        }
    }

    console.log(`[${new Date().toLocaleTimeString()}] Step 2: Ollama done — prompt: ${stats.prompt_eval_count} tokens, output: ${stats.eval_count} tokens, time: ${(stats.eval_duration / 1e9).toFixed(1)}s`);
    console.log(`[Step 2 Raw Output]\n${fullText}`);
    return {
        parsed: parseAIResponse(fullText),
        raw: fullText
    };
}

async function fetchOllamaModels(baseUrl) {
    const url = (baseUrl || 'http://localhost:11434').replace(/\/$/, '') + '/api/tags';
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Failed to fetch Ollama models");
        const data = await response.json();
        return data.models.map(m => m.name).sort();
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

            console.log(`[Summarizer] Token usage: ${inputUsage} / ${quota} (${Math.round((inputUsage / quota) * 100)}% of quota)`);
        } else {
            truncated = smartTruncate(truncated, INPUT_LIMITS.STAGE1_CLOUD);
        }

        const summaryText = await summarizer.summarize(truncated, { signal });

        // DEBUG: Log raw Summarizer output to see what it extracts
        console.log(`[Summarizer Raw Output]\n${summaryText}`);
        console.log(`[Summarizer Output Length] ${summaryText.length} chars`);

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
        const response = await session.prompt(prompt, { responseConstraint: responseSchema });
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
        // Find the first '{' and last '}' to extract the potential JSON block
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        
        if (start === -1 || end === -1) {
            throw new Error("No JSON object found in response");
        }
        
        const jsonStr = text.substring(start, end + 1);
        return JSON.parse(jsonStr);
    } catch (e) {
        console.error("Failed to parse AI response. Raw text:", text);
        throw new Error("AI returned invalid JSON. Try again or check your model settings.");
    }
}
