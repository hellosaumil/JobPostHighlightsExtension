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

async function summarizeJob(config, pageText) {
    const provider = config.provider || 'ollama';

    console.log(`Summarizing with provider: ${provider}`);

    if (provider === 'gemini') {
        if (!config.geminiApiKey) throw new Error("Gemini API key is missing.");
        return summarizeWithGemini(config.geminiApiKey, pageText);
    } else {
        const model = config.ollamaModel;
        const url = config.ollamaUrl;
        console.log(`Ollama Config - Model: ${model || 'default (llama3)'}, URL: ${url}`);
        return summarizeWithOllama(url, model, pageText);
    }
}

async function summarizeWithGemini(apiKey, pageText) {
    const resumeBase64 = await loadResumePDF();
    const prompt = await fetchPrompt(pageText, true);

    const parts = [{ text: prompt }];
    if (resumeBase64) {
        parts.unshift({
            inline_data: {
                mime_type: "application/pdf",
                data: resumeBase64
            }
        });
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: parts }]
        })
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

async function summarizeWithOllama(baseUrl, model, pageText) {
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
        })
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
