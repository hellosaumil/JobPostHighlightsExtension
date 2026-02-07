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

    Analyze the job description and compare it against my resume. Return a JSON object with:
    - title: The job title (string).
    - salary: The salary range or "Not specified" (string).
    - team: The team or department name or "Not specified" (string).
    - expReq: Required years of experience, e.g., "3-5 years" (string).
    - relevanceScore: A percentage (0-100) based on how well my resume matches the job requirements (number).
    - summary: An array of 3-4 strings, each being a key highlight/requirement of the job.

    Job Description Text:
    ${pageText}

    Return ONLY the JSON object, no markdown.
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
