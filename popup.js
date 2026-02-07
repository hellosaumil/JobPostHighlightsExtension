// popup.js - Controller for the extension popup

document.addEventListener('DOMContentLoaded', () => {
    // Elements
    const mainView = document.getElementById('mainView');
    const settingsView = document.getElementById('settingsView');
    const summarizeBtn = document.getElementById('summarizeBtn');
    const settingsBtn = document.getElementById('settingsBtn');
    const backBtn = document.getElementById('backBtn');
    const saveSettingsBtn = document.getElementById('saveSettingsBtn');
    const apiKeyInput = document.getElementById('apiKey');
    const resultsDiv = document.getElementById('results');
    const loader = document.getElementById('loader');

    // Load saved API Key
    chrome.storage.local.get(['geminiApiKey'], (result) => {
        if (result.geminiApiKey) {
            apiKeyInput.value = result.geminiApiKey;
        }
    });

    // Navigation
    settingsBtn.addEventListener('click', () => {
        mainView.classList.add('hidden');
        settingsView.classList.remove('hidden');
    });

    backBtn.addEventListener('click', () => {
        settingsView.classList.add('hidden');
        mainView.classList.remove('hidden');
    });

    // Save Settings
    saveSettingsBtn.addEventListener('click', () => {
        const key = apiKeyInput.value.trim();
        chrome.storage.local.set({ geminiApiKey: key }, () => {
            alert('Settings saved!');
            settingsView.classList.add('hidden');
            mainView.classList.remove('hidden');
        });
    });

    // Summarize Logic
    summarizeBtn.addEventListener('click', async () => {
        const result = await chrome.storage.local.get(['geminiApiKey']);
        const apiKey = result.geminiApiKey;

        if (!apiKey) {
            alert('Please set your Gemini API key in settings first.');
            return;
        }

        loader.classList.remove('hidden');
        resultsDiv.classList.add('hidden');
        summarizeBtn.disabled = true;

        try {
            // 1. Get current tab
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            // 2. Extract content using content script
            const [{ result: contentResult }] = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                    // Inline extraction logic as a fallback/primary
                    const selectors = ['#job-description', '.job-description', '#jobDescriptionText', 'main', 'article'];
                    for (const s of selectors) {
                        const el = document.querySelector(s);
                        if (el && el.innerText.length > 200) return el.innerText;
                    }
                    return document.body.innerText;
                }
            });

            if (!contentResult) throw new Error("Could not extract page content.");

            // 3. Import AI service logic (using a hack since popups don't support ES modules easily without build tools)
            // We'll fetch the ai_service.js content or just have it included in popup.html
            // For simplicity in this local setup, I've added ai_service.js manually to popup.html if needed,
            // but here I'll assume it's loaded because of the script tag (I need to add it to popup.html)

            const analysis = await summarizeJob(apiKey, contentResult);
            updateUI(analysis);

        } catch (error) {
            alert("Error: " + error.message);
        } finally {
            loader.classList.add('hidden');
            summarizeBtn.disabled = false;
        }
    });

    function updateUI(data) {
        resultsDiv.classList.remove('hidden');

        document.getElementById('jobTitle').textContent = data.title || "---";
        document.getElementById('salary').textContent = data.salary || "---";
        document.getElementById('team').textContent = data.team || "---";
        document.getElementById('expReq').textContent = data.expReq || "---";
        document.getElementById('summaryText').textContent = data.summary || "No summary provided.";

        // Update Progress Ring
        const score = data.relevanceScore || 0;
        const ring = document.getElementById('scoreRing');
        const text = document.getElementById('scoreText');

        const radius = ring.r.baseVal.value;
        const circumference = 2 * Math.PI * radius;
        const offset = circumference - (score / 100) * circumference;

        ring.style.strokeDashoffset = offset;
        text.textContent = `${score}%`;

        // Color code based on score
        if (score >= 80) ring.style.stroke = "var(--success-color)";
        else if (score >= 50) ring.style.stroke = "var(--accent-color)";
        else ring.style.stroke = "var(--error-color)";
    }
});
