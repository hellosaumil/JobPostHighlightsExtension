// ai_service.js - Support for Gemini and Ollama (Local)

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


async function preParseJobText(pageText, useSummarizer = true) {
    if (!useSummarizer) {
        console.log("Step 1 Skip: User disabled On-Device Summarizer in settings.");
        return pageText;
    }

    if (!pageText || pageText.length < 500) return pageText; // Too short to need summarizing

    let summarizerAPI = null;
    if (typeof ai !== 'undefined' && ai.summarizer) {
        summarizerAPI = ai.summarizer;
    } else if (typeof window !== 'undefined' && window.ai && window.ai.summarizer) {
        summarizerAPI = window.ai.summarizer;
    }

    if (!summarizerAPI) {
        console.log("Step 1 Skip: Summarizer API object not found. Ensure #summarization-api-for-gemini-nano is enabled.");
        return pageText;
    }

    try {
        const capabilities = await summarizerAPI.capabilities();
        if (capabilities.available === 'no') {
            console.log("Step 1 Skip: Summarizer API available: 'no'. Model may not be downloaded.");
            return pageText;
        }

        console.log(`[${new Date().toLocaleTimeString()}] Step 1: Actually pre-parsing with ${capabilities.available} availability...`);
        const summarizer = await summarizerAPI.create({
            type: 'key-points',
            format: 'plain-text',
            length: 'long'
        });

        const summary = await summarizer.summarize(pageText);
        console.log("Pre-parsing complete. Original length:", pageText.length, "New length:", summary.length);

        if (typeof summarizer.destroy === 'function') {
            summarizer.destroy();
        }

        return summary;
    } catch (error) {
        console.error("Failed to pre-parse job text. Falling back to raw text.", error);
        return pageText;
    }
}

async function summarizeJob(config, pageText, signal) {
    const provider = config.provider || 'ondevice';
    const overallStartTime = performance.now();

    console.log(`[${new Date().toLocaleTimeString()}] AI Evaluation Started - Provider: ${provider}`);
    console.log(`[${new Date().toLocaleTimeString()}] Step 1: Pre-parsing started. Input: ${pageText.length} chars`);

    const preParseStart = performance.now();
    const useSummarizer = config.useSummarizer !== false; // Default to true if not set
    const processedText = await preParseJobText(pageText, useSummarizer);
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
        result = await summarizeWithGemini(config.geminiApiKey, processedText, signal);
    } else {
        const model = config.ollamaModel;
        const url = config.ollamaUrl;
        console.log(`[${new Date().toLocaleTimeString()}] Ollama Config - Model: ${model || 'default (llama3)'}, URL: ${url}`);
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

async function summarizeWithGemini(apiKey, pageText, signal) {
    // const resumeBase64 = await loadResumePDF();
    const prompt = await fetchPrompt(pageText, false); // Changed to false to avoid referring to a PDF that isn't attached

    const parts = [{ text: prompt }];
    /*
    if (resumeBase64) {
        parts.unshift({
            inline_data: {
                mime_type: "application/pdf",
                data: resumeBase64
            }
        });
    }
    */

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${apiKey}`, {
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
    const prompt = await fetchPrompt(pageText, false);
    const url = (baseUrl || 'http://localhost:11434').replace(/\/$/, '') + '/api/generate';

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: model || 'llama3',
            prompt: prompt,
            stream: false,
            format: 'json'
        }),
        signal: signal
    });

    if (!response.ok) {
        throw new Error(`Ollama failed: ${response.statusText}. Status: ${response.status}`);
    }

    const data = await response.json();
    return {
        parsed: parseAIResponse(data.response),
        raw: data.response
    };
}

async function fetchOllamaModels(baseUrl) {
    const url = (baseUrl || 'http://localhost:11434').replace(/\/$/, '') + '/api/tags';
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Failed to fetch Ollama models");
        const data = await response.json();
        return data.models.map(m => m.name);
    } catch (error) {
        console.error("fetchOllamaModels error:", error);
        return [];
    }
}

async function summarizeWithOnDevice(pageText, signal) {
    const prompt = await fetchPrompt(pageText, false);

    let aiAPI = null;
    if (typeof LanguageModel !== 'undefined') {
        aiAPI = LanguageModel;
    } else if (window.ai && window.ai.languageModel) {
        aiAPI = window.ai.languageModel;
    } else {
        throw new Error("On-Device AI is not available. Please ensure #prompt-api-for-gemini-nano is enabled in chrome://flags.");
    }

    if (typeof aiAPI.capabilities !== 'function' && typeof aiAPI.availability !== 'function') {
        throw new Error("Found the AI object, but it is missing the expected availability verification functions!");
    }

    const capabilities = typeof aiAPI.availability === 'function' ?
        await aiAPI.availability() :
        await aiAPI.capabilities();

    const isAvailable = capabilities === 'readily' || capabilities.available === 'readily' ||
        capabilities === 'after-download' || capabilities.available === 'after-download' ||
        capabilities === 'downloadable' || capabilities.available === 'downloadable' ||
        capabilities === 'available' || capabilities.available === 'available';

    if (!isAvailable) {
        throw new Error("On-Device AI model is not ready. You may need to enable #optimization-guide-on-device-model or run a prompt in console.");
    }

    const session = await aiAPI.create({
        systemPrompt: "You are an expert technical recruiter analyzing job descriptions.",
        expectedInputLanguage: 'en',
        expectedValueLanguage: 'en',
        signal: signal
    });

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

        // 1. Limit page text to prevent context window blowup
        const limitedText = pageText.substring(0, 10000);

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
