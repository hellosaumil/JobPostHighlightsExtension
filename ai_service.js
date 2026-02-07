const RESUME_DATA = `
Saumil Shah
Senior Graphics Software Engineer at Qualcomm
Location: San Diego, CA | Email: ssh.saumil@gmail.com
Skills: Python, FastAPI, Redis, RabbitMQ, Docker, Kubernetes, C++, Graphics, GPGPU, PySpark, TensorFlow, PyTorch.
Experience:
- Qualcomm (2021-Present): Senior Graphics SWE. Automation frameworks, performance monitoring, regression tracking.
- KORE Wireless (2020-2021): Data Science Developer. Anomaly detection, ETL pipelines, ML lifecycle.
- MBARC (2019-2020): Associate Researcher. Deep Learning for bio-acoustics, GANs, PyTorch.
- HireValley (2016-2017): Research Engineering Intern. Recommendation systems, NLP, Ontology.
Projects: Android XR 3D Apps, Phoneme Recognition (LSTM), Satellite Image Classification (Spark).
Education: MS in CS (SDSU, GPA 3.8), B.Tech in ICT.
`;

async function summarizeJob(apiKey, pageText) {
    const prompt = `
    You are an expert recruitment assistant. I will provide you with a job description and a resume summary.
    Analyze the job description and return a JSON object with the following fields:
    - title: The job title.
    - salary: The salary range or "Not specified".
    - team: The team or department name or "Not specified".
    - expReq: Required years of experience (e.g., "3-5 years").
    - relevanceScore: A percentage (0-100) based on how well the resume matches the job requirements.
    - summary: A concise 3-4 bullet point summary of the most important aspects of the job.

    Resume Summary:
    ${RESUME_DATA}

    Job Description Text:
    ${pageText}

    Return ONLY the JSON object.
  `;

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
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
