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

    // Model Provider Elements
    const providerSelect = document.getElementById('provider');
    const geminiSettings = document.getElementById('geminiSettings');
    const ollamaSettings = document.getElementById('ollamaSettings');
    const ollamaUrlInput = document.getElementById('ollamaUrl');
    const ollamaModelSelect = document.getElementById('ollamaModel');
    const refreshOllamaBtn = document.getElementById('refreshOllamaBtn');

    // Navigation
    settingsBtn.addEventListener('click', () => {
        mainView.classList.add('hidden');
        settingsView.classList.remove('hidden');
        if (providerSelect.value === 'ollama') {
            loadOllamaModels();
        }
    });

    backBtn.addEventListener('click', () => {
        settingsView.classList.add('hidden');
        mainView.classList.remove('hidden');
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

    // Provider Toggle
    providerSelect.addEventListener('change', (e) => {
        toggleProviderSettings(e.target.value);
        if (e.target.value === 'ollama') {
            loadOllamaModels();
        }
    });

    function toggleProviderSettings(provider) {
        if (provider === 'gemini') {
            geminiSettings.classList.remove('hidden');
            ollamaSettings.classList.add('hidden');
        } else {
            geminiSettings.classList.add('hidden');
            ollamaSettings.classList.remove('hidden');
        }
    }

    async function loadOllamaModels() {
        const baseUrl = ollamaUrlInput.value.trim();
        const models = await fetchOllamaModels(baseUrl);

        ollamaModelSelect.innerHTML = '';
        if (models.length === 0) {
            const option = document.createElement('option');
            option.value = "";
            option.textContent = "No models found.";
            ollamaModelSelect.appendChild(option);
            return;
        }

        models.forEach(m => {
            const option = document.createElement('option');
            option.value = m;
            option.textContent = m;
            ollamaModelSelect.appendChild(option);
        });

        chrome.storage.local.get(['ollamaModel'], (result) => {
            if (result.ollamaModel && models.includes(result.ollamaModel)) {
                ollamaModelSelect.value = result.ollamaModel;
            }
        });
    }

    refreshOllamaBtn.addEventListener('click', loadOllamaModels);

    // Load saved settings
    chrome.storage.local.get(['geminiApiKey', 'theme', 'provider', 'ollamaUrl', 'ollamaModel'], (result) => {
        if (result.geminiApiKey) apiKeyInput.value = result.geminiApiKey;
        if (result.provider) providerSelect.value = result.provider;
        if (result.ollamaUrl) ollamaUrlInput.value = result.ollamaUrl;

        toggleProviderSettings(result.provider || 'ollama');

        if (result.theme === 'light') {
            document.body.setAttribute('data-theme', 'light');
            themeBtn.textContent = '☀️';
        }

        if (result.provider === 'ollama') {
            loadOllamaModels();
        }
    });

    // Save Settings
    saveSettingsBtn.addEventListener('click', () => {
        const key = apiKeyInput.value.trim();
        const provider = providerSelect.value;
        const ollamaUrl = ollamaUrlInput.value.trim();
        const ollamaModel = ollamaModelSelect.value;

        chrome.storage.local.set({
            geminiApiKey: key,
            provider: provider,
            ollamaUrl: ollamaUrl,
            ollamaModel: ollamaModel
        }, () => {
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

        btnText.classList.add('hidden');
        btnLoader.classList.remove('hidden');
        resultsDiv.classList.add('hidden');
        summarizeBtn.disabled = true;

        try {
            let analysis;

            if (dummyMode) {
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
                const config = await chrome.storage.local.get(['geminiApiKey', 'provider', 'ollamaUrl', 'ollamaModel']);
                const provider = config.provider || 'ollama';

                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

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

                analysis = await summarizeJob(config, contentResult);
            }

            updateUI(analysis);

        } catch (error) {
            alert("Error: " + (error.message || error));
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

        // Update Square Scale
        const score = data.relevanceScore || 0;
        const scale = Math.max(1, Math.ceil(score / 20)); // 0-100 -> 1-5 scale
        const container = document.getElementById('scoreSquares');
        const squares = container.querySelectorAll('.square');
        const text = document.getElementById('scoreText');

        // Determine color based on scale
        let color = '#ef4444'; // Red for 1/5
        let glow = 'rgba(239, 68, 68, 0.5)';

        if (scale === 2) { color = '#f97316'; glow = 'rgba(249, 115, 22, 0.5)'; }
        else if (scale === 3) { color = '#eab308'; glow = 'rgba(234, 179, 8, 0.5)'; }
        else if (scale === 4) { color = '#84cc16'; glow = 'rgba(132, 204, 22, 0.5)'; }
        else if (scale === 5) { color = '#10b981'; glow = 'rgba(16, 185, 129, 0.5)'; }

        container.style.setProperty('--scale-color', color);
        container.style.setProperty('--scale-glow', glow);

        squares.forEach((sq, idx) => {
            if (idx < scale) {
                sq.classList.add('active');
            } else {
                sq.classList.remove('active');
            }
        });

        text.textContent = `${scale}/5`;
        text.style.color = color;
    }
});
