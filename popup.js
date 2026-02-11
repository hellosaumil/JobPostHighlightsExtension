// popup.js - Controller for the extension popup

document.addEventListener('DOMContentLoaded', () => {
    // Elements
    const mainView = document.getElementById('mainView');
    const settingsView = document.getElementById('settingsView');
    const summarizeBtn = document.getElementById('summarizeBtn');
    const btnText = summarizeBtn.querySelector('.btn-text');
    const btnLoader = summarizeBtn.querySelector('.btn-loader');
    const settingsBtn = document.getElementById('settingsBtn');
    const themeBtn = document.getElementById('themeBtn');
    const backBtn = document.getElementById('backBtn');
    const saveSettingsBtn = document.getElementById('saveSettingsBtn');
    const apiKeyInput = document.getElementById('apiKey');
    const resultsDiv = document.getElementById('results');
    const resizeHandle = document.querySelector('.resize-handle');

    // Load saved settings
    chrome.storage.local.get(['geminiApiKey', 'theme'], (result) => {
        if (result.geminiApiKey) {
            apiKeyInput.value = result.geminiApiKey;
        }
        if (result.theme === 'light') {
            document.body.setAttribute('data-theme', 'light');
            themeBtn.textContent = '☀️';
        }
    });

    // Theme Toggle
    themeBtn.addEventListener('click', () => {
        const isLight = document.body.getAttribute('data-theme') === 'light';
        if (isLight) {
            document.body.removeAttribute('data-theme');
            themeBtn.textContent = '🌙';
            chrome.storage.local.set({ theme: 'dark' });
        } else {
            document.body.setAttribute('data-theme', 'light');
            themeBtn.textContent = '☀️';
            chrome.storage.local.set({ theme: 'light' });
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

    // Resize functionality
    let isResizing = false;
    resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const newWidth = e.clientX;
        const newHeight = e.clientY;
        if (newWidth > 320 && newWidth < 600) {
            document.body.style.width = newWidth + 'px';
        }
        if (newHeight > 200 && newHeight < 800) {
            document.body.style.minHeight = newHeight + 'px';
        }
    });

    document.addEventListener('mouseup', () => {
        isResizing = false;
    });

    // Summarize Logic
    summarizeBtn.addEventListener('click', async () => {
        const dummyMode = document.getElementById('dummyMode').checked;

        // Show inline loader
        btnText.classList.add('hidden');
        btnLoader.classList.remove('hidden');
        resultsDiv.classList.add('hidden');
        summarizeBtn.disabled = true;

        try {
            let analysis;

            if (dummyMode) {
                // Simulate a short delay for realism
                await new Promise(resolve => setTimeout(resolve, 800));
                analysis = {
                    title: "Senior Python Infrastructure Engineer",
                    salary: "$160,000 - $210,000",
                    team: "Developer Experience & Automation",
                    expReq: "3-5 years",
                    relevanceScore: 92,
                    summary: "• Build high-performance backends with FastAPI and Pydantic\n• Design distributed task queues using RabbitMQ & Redis\n• Automate GPU testing infrastructure on Kubernetes\n• Maintain core Python libraries used across the org"
                };
            } else {
                const result = await chrome.storage.local.get(['geminiApiKey']);
                const apiKey = result.geminiApiKey;

                if (!apiKey) {
                    alert('Please set your Gemini API key in settings first.');
                    return;
                }

                // 1. Get current tab
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

                // 2. Extract content using content script
                const [{ result: contentResult }] = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: () => {
                        const selectors = ['#job-description', '.job-description', '#jobDescriptionText', 'main', 'article'];
                        for (const s of selectors) {
                            const el = document.querySelector(s);
                            if (el && el.innerText.length > 200) return el.innerText;
                        }
                        return document.body.innerText;
                    }
                });

                if (!contentResult) throw new Error("Could not extract page content.");

                analysis = await summarizeJob(apiKey, contentResult);
            }

            updateUI(analysis);

        } catch (error) {
            alert("Error: " + error.message);
        } finally {
            btnText.classList.remove('hidden');
            btnLoader.classList.add('hidden');
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

        // Set initial state for animation
        ring.style.strokeDasharray = circumference;
        const offset = circumference - (score / 100) * circumference;
        ring.style.strokeDashoffset = offset;

        text.textContent = `${score}%`;

        // Color code based on score
        if (score > 80) {
            ring.style.stroke = "var(--success-color)";
        } else if (score === 0) {
            ring.style.stroke = "var(--error-color)";
        } else {
            ring.style.stroke = "var(--accent-color)";
        }
    }
});
