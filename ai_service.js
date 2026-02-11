// ai_service.js - Gemini API integration with PDF resume support

async function loadResumePDF() {
    try {
        const response = await fetch(chrome.runtime.getURL('resume.pdf'));
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                // Remove the data URL prefix to get pure base64
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

async function summarizeJob(apiKey, pageText) {
    const resumeBase64 = await loadResumePDF();

    const prompt = `
    You are an expert recruitment assistant. I will provide you with:
    1. A PDF of my resume (attached)
    2. A job description text

    Analyze the job description and compare it against my resume.

    CRITICAL FILTERS:
    - PRIMARY LANGUAGE: If the primary programming language for this role is NOT Python, it is NOT a match.
    - EXPERIENCE CAP: If the job requires more than 5 years of experience (e.g., 6+, 8+, or "Senior" roles specifically requiring 6-10+ years), it is NOT a match.

    Return a JSON object with:
    - title: The job title (string).
    - salary: The salary range or "Not specified" (string).
    - team: The team or department name or "Not specified" (string).
    - expReq: Required years of experience, e.g., "3-5 years" (string).
    - relevanceScore: A percentage (0-100). Set to 0 if any CRITICAL FILTER is triggered (number).
    - summary: An array of 3-4 strings. 
        * If a CRITICAL FILTER is triggered, the first string MUST be the reason (e.g., "NOT A MATCH: Primary language is not Python" or "NOT A MATCH: Experience requirement exceeds 5 years").
        * Otherwise, provide key highlights/requirements of the job focusing on alignment with my Python expertise and infrastructure experience.

    SKILLS TO MATCH (if filters pass):
    - Core Python Stack: FastAPI, FastMCP, LangGraph, Pika, Pydantic, Pandas, TensorFlow/PyTorch.
    - Infrastructure & Automation: Docker, Kubernetes, CI/CD, GKE, AWS (EMR/S3), LSF clusters.
    - Distributed Systems: Redis, RabbitMQ, Asynchronous reporting pipelines.
    - Backend & ML: RAG pipelines, ChromaDB, Anomaly Detection, Speech Recognition, Computer Vision, ETL pipelines.

    Job Description Text:
    ${pageText}

    Return ONLY the JSON object, do not include any other text or markdown outside the JSON.
  `;

    try {
        // Build the request parts
        const parts = [{ text: prompt }];

        // Add resume PDF if loaded successfully
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
            throw new Error(error.error?.message || 'AI analysis failed');
        }

        const data = await response.json();
        const resultText = data.candidates[0].content.parts[0].text;

        // Clean potential markdown code blocks
        const jsonStr = resultText.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(jsonStr);
    } catch (error) {
        console.error("AI Service Error:", error);
        throw error;
    }
}
