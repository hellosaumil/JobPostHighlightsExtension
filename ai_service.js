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
    const provider = config.provider || 'gemini';

    if (provider === 'gemini') {
        return summarizeWithGemini(config.geminiApiKey, pageText);
    } else {
        return summarizeWithOllama(config.ollamaUrl, config.ollamaModel, pageText);
    }
}

async function summarizeWithGemini(apiKey, pageText) {
    const resumeBase64 = await loadResumePDF();
    const prompt = getPrompt(pageText, true);

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
    return parseAIResponse(resultText);
}

async function summarizeWithOllama(baseUrl, model, pageText) {
    const prompt = getPrompt(pageText, false);
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
        throw new Error(`Ollama failed: ${response.statusText}. Make sure Ollama is running and has the model loaded.`);
    }

    const data = await response.json();
    return parseAIResponse(data.response);
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

function getPrompt(pageText, includePDFRef) {
    const resumeSource = includePDFRef ? "A PDF of my resume (attached)" : "My skills and experience (listed below)";

    return `
    You are an expert recruitment assistant. I will provide you with:
    1. ${resumeSource}
    2. A job description text

    Analyze the job description and compare it against my resume and skills.

    CRITICAL CONSTRAINTS:
    - PRIMARY LANGUAGE: If the primary programming language for this role is NOT Python, set relevanceScore to 0.
    - EXPERIENCE CAP: If the job requires more than 5 years of experience (e.g., 6+, 8+, or "Senior" roles specifically requiring 6-10+ years), set relevanceScore to 0.
    - SEMI-MATCH LOGIC: If the role is Python-focused but the "Preferred Qualifications" list several advanced technologies not in my skillset (below), treat it as a "Semi-Match". Limit the relevanceScore to a maximum of 60%.

    Return a JSON object with:
    - title: The job title (string).
    - salary: The salary range or "Not specified" (string).
    - team: The team or department name or "Not specified" (string).
    - expReq: Required years of experience, e.g., "3-5 years" (string).
    - relevanceScore: A percentage (0-100) based on alignment. Must be 0 if a critical failure occurs, and max 60 if a semi-match occurs (number).
    - summary: An array of 3-4 concise strings. 
        * If a constraint (Python or Experience) is triggered, the first string MUST clearly state the reason (e.g., "NOT A MATCH: Experience requirement exceeds 5 years").
        * If it is a Semi-Match, the first string should be "SEMI-MATCH: Missing preferred advanced skills [list them]".
        * Otherwise, highlight the best alignment points between the job and my Python/Infrastructure background.

    MY SKILLS & BACKGROUND:
    - Core Python Stack: FastAPI, FastMCP, LangGraph, Pika, Pydantic, Pandas, TensorFlow, PyTorch.
    - Infrastructure & Automation: Docker, Kubernetes, CI/CD, GKE, AWS (EMR/S3), LSF clusters.
    - Distributed Systems: Redis, RabbitMQ, Asynchronous pipelines.
    - Backend & ML: RAG pipelines, ChromaDB, Anomaly Detection, Speech Recognition, Computer Vision, ETL.
    - Professional History: Senior Graphics Software Engineer at Qualcomm, Data Science Developer.

    Job Description Text:
    ${pageText}

    Return ONLY the JSON object. No markdown, no conversational text.
  `;
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
