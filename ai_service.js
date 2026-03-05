// ai_service.js - Support for Gemini and Ollama (Local)

const STAGE1_SYSTEM_PROMPT = `You are a job posting data extractor. Given a job posting, extract ONLY the following fields in a concise, structured plain-text format. Omit any field not found in the posting.

FORMAT (use these exact headers):
TITLE: [exact job title]
SALARY: [compensation range or "Not specified"]
TEAM: [department/team name or "Not specified"]
LOCATION: [location and remote policy]
EXPERIENCE: [required years of experience]
ROLE FOCUS: [primary domain: e.g., Backend, Frontend, Full-Stack, Mobile, Data, ML/AI, DevOps, Embedded, etc.]
PRIMARY LANGUAGES: [programming languages listed as required, in order of emphasis]
REQUIRED SKILLS: [comma-separated technical skills, frameworks, tools explicitly required]
PREFERRED SKILLS: [comma-separated skills listed as "nice to have" or "preferred"]

RULES:
- Be extremely concise. Use comma-separated lists, not sentences.
- Only include information explicitly stated in the job posting.
- Distinguish between "required" and "preferred/nice-to-have" skills.
- For ROLE FOCUS, identify the primary engineering domain from the responsibilities section.
- Ignore: benefits, company culture, equal opportunity statements, application instructions.`;

function smartTruncate(text, maxLen) {
    if (text.length <= maxLen) return text;
    const truncated = text.substring(0, maxLen);
    const lastNewline = truncated.lastIndexOf('\n');
    if (lastNewline > maxLen - 200) {
        return truncated.substring(0, lastNewline);
    }
    return truncated;
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
    const truncated = smartTruncate(pageText, 6000);
    const extractionPrompt = `${STAGE1_SYSTEM_PROMPT}\n\nJob Posting:\n${truncated}`;

    if (config.provider === 'gemini' && config.geminiApiKey) {
        const modelName = config.geminiModel || 'gemini-1.5-flash-lite-latest';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${config.geminiApiKey}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: extractionPrompt }] }] }),
            signal
        });
        if (!response.ok) throw new Error(`Gemini Stage 1 failed: ${response.statusText}`);
        const data = await response.json();
        return data.candidates[0].content.parts[0].text;
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
                options: { num_ctx: 4096, temperature: 0.1, num_predict: 400 },
                keep_alive: "5m"
            }),
            signal
        });
        if (!response.ok) throw new Error(`Ollama Stage 1 failed: ${response.statusText}`);
        const data = await response.json();
        return data.message?.content || '';
    }

    // Fallback to regex cleaner
    return cleanJobText(pageText);
}

async function preParseJobText(pageText, useStage1 = true, signal = null, config = null) {
    if (!useStage1 || !pageText || pageText.length < 500) {
        console.log("Step 1 Skip.");
        return pageText;
    }

    // Fallback chain: on-device → provider → regex cleaner

    // 1. Try on-device (Gemini Nano)
    try {
        console.log(`[${new Date().toLocaleTimeString()}] Step 1: On-device extraction...`);
        const result = await extractWithOnDevice(pageText, signal);
        if (result && result.length > 100) {
            console.log(`Step 1 complete. ${pageText.length} → ${result.length} chars`);
            console.log(`[Stage 1 Output]\n${result}`);
            return result;
        }
        console.log("Step 1: Insufficient output from on-device, trying fallback...");
    } catch (e) {
        console.warn("Step 1: On-device failed —", e.message, "trying fallback...");
    }

    // 2. Try selected provider (Gemini Cloud or Ollama)
    const ENABLE_STAGE1_PROVIDER_FALLBACK = false;
    if (ENABLE_STAGE1_PROVIDER_FALLBACK && config && (config.provider === 'gemini' || config.provider === 'ollama')) {
        try {
            console.log(`[${new Date().toLocaleTimeString()}] Step 1: Fallback to ${config.provider}...`);
            const result = await preParseWithProvider(config, pageText, signal);
            if (result && result.length > 100) {
                console.log(`Step 1 complete (via ${config.provider}). ${pageText.length} → ${result.length} chars`);
                console.log(`[Stage 1 Output]\n${result}`);
                return result;
            }
        } catch (e) {
            console.warn(`Step 1: ${config.provider} fallback failed —`, e.message, "using regex cleaner...");
        }
    }

    // 3. Fall back to regex-based boilerplate removal
    console.log(`[${new Date().toLocaleTimeString()}] Step 1: Using regex cleaner...`);
    const cleaned = cleanJobText(pageText);
    console.log(`Step 1 complete (regex). ${pageText.length} → ${cleaned.length} chars`);
    return cleaned;
}

async function summarizeJob(config, pageText, signal) {
    const provider = config.provider || 'ondevice';
    const overallStartTime = performance.now();

    console.log(`[${new Date().toLocaleTimeString()}] AI Evaluation Started - Provider: ${provider}`);
    console.log(`[${new Date().toLocaleTimeString()}] Step 1: Pre-parsing started. Input: ${pageText.length} chars`);

    const preParseStart = performance.now();
    const useStage1 = config.useSummarizer !== false; // Default to true
    const processedText = await preParseJobText(pageText, useStage1, signal, config);
    const preParseEnd = performance.now();
    const preParseDuration = ((preParseEnd - preParseStart) / 1000).toFixed(2);

    console.log(`[${new Date().toLocaleTimeString()}] Step 1: Pre-parsing finished in ${preParseDuration}s. Output: ${processedText.length} chars`);

    // If request was cancelled during pre-parsing, stop here
    if (signal && signal.aborted) {
        console.log(`[${new Date().toLocaleTimeString()}] Evaluation aborted by user step 1.`);
        throw new DOMException('Aborted', 'AbortError');
    }

    console.log(`[${new Date().toLocaleTimeString()}] Step 2: Relevance Analysis started. Input: ${processedText.length} chars`);
    const relevanceStart = performance.now();

    let result;
    if (provider === 'ondevice') {
        result = await summarizeWithOnDevice(processedText, signal);
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
    console.log(`[${new Date().toLocaleTimeString()}] AI Evaluation Complete. Total time: ${overallDuration}s`);

    result.preParsed = processedText;
    return result;
}

async function summarizeWithGemini(apiKey, model, pageText, signal) {
    const prompt = await fetchPrompt(pageText, false);
    const parts = [{ text: prompt }];

    const modelName = model || 'gemini-1.5-flash-lite-latest';
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

    // Truncate aggressively before building prompt — reduces pre-fill tokens
    const truncatedText = smartTruncate(pageText, 4000);
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
                num_ctx: 4096,
                temperature: 0.1,
                num_predict: 800
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
    const aiAPI = await getOnDeviceAPI();
    if (!aiAPI) return null;

    let session;
    try {
        session = await aiAPI.create({
            systemPrompt: STAGE1_SYSTEM_PROMPT,
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
        const truncated = smartTruncate(pageText, 6000);
        const response = await session.prompt(
            `Extract the key job details from this posting:\n\n${truncated}`
        );
        return response;
    } finally {
        if (typeof session.destroy === 'function') {
            session.destroy();
        }
    }
}

async function summarizeWithOnDevice(pageText, signal) {
    const prompt = await fetchPrompt(pageText, false);
    console.log(`[${new Date().toLocaleTimeString()}] Step 2: Prompt size ${prompt.length} chars`);

    const aiAPI = await getOnDeviceAPI();
    if (!aiAPI) {
        throw new Error("On-Device AI is not available. Please ensure #prompt-api-for-gemini-nano is enabled in chrome://flags.");
    }

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
        const response = await session.prompt(prompt);
        return {
            parsed: parseAIResponse(response),
            raw: response
        };
    } finally {
        if (typeof session.destroy === 'function') {
            session.destroy();
        }
    }
}

async function fetchPrompt(pageText, includePDFRef) {
    try {
        const response = await fetch(chrome.runtime.getURL('prompt.md'));
        let template = await response.text();

        // Limit page text to prevent context window blowup
        // For Ollama this is further truncated at call site, for Gemini 10k is fine
        const limitedText = smartTruncate(pageText, 10000);

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
        const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(jsonStr);
    } catch (e) {
        console.error("Failed to parse AI response:", text);
        throw new Error("AI returned invalid JSON. Try again or check your model settings.");
    }
}
