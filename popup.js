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
    const resetSettingsBtn = document.getElementById('resetSettingsBtn');
    const statusMsg = document.getElementById('statusMsg');

    let initialSettings = {};

    // Navigation
    settingsBtn.addEventListener('click', () => {
        // Store current state for reset
        initialSettings = {
            provider: providerSelect.value,
            apiKey: apiKeyInput.value,
            ollamaUrl: ollamaUrlInput.value,
            ollamaModel: ollamaModelSelect.value
        };

        mainView.classList.add('hidden');
        settingsView.classList.remove('hidden');
        statusMsg.classList.add('hidden');

        if (providerSelect.value === 'ollama') {
            loadOllamaModels();
        }
    });

    backBtn.addEventListener('click', () => {
        saveSettings(true); // silent save
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

    async function loadOllamaModels(selectedModel = null) {
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

        const targetModel = selectedModel || (await chrome.storage.local.get(['ollamaModel'])).ollamaModel;
        if (targetModel && models.includes(targetModel)) {
            ollamaModelSelect.value = targetModel;
        }
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
            loadOllamaModels(result.ollamaModel);
        }
    });

    // Save Settings
    function saveSettings(silent = false) {
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
            if (!silent) {
                statusMsg.classList.remove('hidden');
                setTimeout(() => {
                    statusMsg.classList.add('hidden');
                }, 2000);
            }
        });
    }

    saveSettingsBtn.addEventListener('click', () => {
        saveSettings();
    });

    resetSettingsBtn.addEventListener('click', () => {
        if (initialSettings.provider) {
            providerSelect.value = initialSettings.provider;
            apiKeyInput.value = initialSettings.apiKey;
            ollamaUrlInput.value = initialSettings.ollamaUrl;
            toggleProviderSettings(initialSettings.provider);

            if (initialSettings.provider === 'ollama') {
                loadOllamaModels(initialSettings.ollamaModel);
            }
        }
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

    let lastResponseRaw = '';
    const copyPayloadBtn = document.getElementById('copyPayloadBtn');

    copyPayloadBtn.addEventListener('click', () => {
        if (lastResponseRaw) {
            navigator.clipboard.writeText(lastResponseRaw).then(() => {
                const originalInner = copyPayloadBtn.innerHTML;
                copyPayloadBtn.innerHTML = '✅';
                setTimeout(() => { copyPayloadBtn.innerHTML = originalInner; }, 2000);
            });
        }
    });

    // Summarize Logic
    summarizeBtn.addEventListener('click', async () => {
        const dummyMode = document.getElementById('dummyMode').checked;

        btnText.classList.add('hidden');
        btnLoader.classList.remove('hidden');
        resultsDiv.classList.add('hidden');
        copyPayloadBtn.classList.add('hidden');
        summarizeBtn.disabled = true;

        try {
            let analysis;
            const startTime = performance.now();

            if (dummyMode) {
                await new Promise(resolve => setTimeout(resolve, 800));
                analysis = {
                    parsed: {
                        title: "Senior Python Infrastructure Engineer",
                        salary: "$160,000 - $210,000",
                        team: "Developer Experience & Automation",
                        expReq: "3-5 years",
                        relevanceScore: 4.5,
                        summary: {
                            primaryStatus: {
                                match: "FULL-MATCH",
                                reason: "Alignment on Python distributed systems and high-scale Kubernetes orchestration."
                            },
                            levelingNote: "Score capped at 4.6 for Staff title alignment.",
                            fullMatches: ["FastAPI", "RabbitMQ", "Kubernetes"],
                            partialMissing: ["Go (Preferred)", "AWS (Secondary)"],
                            uniqueInsight: "Core focus on GPU orchestration aligns with search backend background."
                        }
                    },
                    raw: "Dummy response text"
                };
            } else {
                const config = await chrome.storage.local.get(['geminiApiKey', 'provider', 'ollamaUrl', 'ollamaModel']);
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

            lastResponseRaw = analysis.raw;
            const endTime = performance.now();
            const duration = ((endTime - startTime) / 1000).toFixed(2);
            updateUI(analysis.parsed, duration);
            copyPayloadBtn.classList.remove('hidden');

        } catch (error) {
            alert("Error: " + (error.message || error));
        } finally {
            btnText.classList.remove('hidden');
            btnLoader.classList.add('hidden');
            summarizeBtn.disabled = false;
        }
    });

    function updateUI(data, duration) {
        resultsDiv.classList.remove('hidden');

        if (duration) {
            const timeEl = document.getElementById('timeTaken');
            timeEl.textContent = `Response in ${duration}s`;
            timeEl.classList.remove('hidden');
        }

        document.getElementById('jobTitle').textContent = data.title || "---";
        document.getElementById('salary').textContent = data.salary || "---";
        document.getElementById('team').textContent = data.team || "---";
        document.getElementById('expReq').textContent = data.expReq || "---";

        const summaryContent = document.getElementById('summaryContent');
        summaryContent.innerHTML = '';

        if (data.summary && typeof data.summary === 'object' && !Array.isArray(data.summary)) {
            const s = data.summary;

            // Primary Status
            if (s.primaryStatus) {
                const statusDiv = document.createElement('div');
                const matchClass = (s.primaryStatus.match || '').toLowerCase().replace(/[^a-z]/g, '');
                statusDiv.className = `highlight-item primary-status-box ${matchClass}`;
                statusDiv.innerHTML = `
                    <div class="status-badge ${matchClass}">${s.primaryStatus.match}</div>
                    <div class="status-reason">${formatMarkdown(s.primaryStatus.reason)}</div>
                `;
                summaryContent.appendChild(statusDiv);
            }

            // Leveling Note
            if (s.levelingNote && s.levelingNote !== 'NULL' && s.levelingNote !== 'N/A') {
                summaryContent.appendChild(createHighlightItem('Leveling Note', formatMarkdown(s.levelingNote), 'level-note'));
            }

            // Full Matches
            if (s.fullMatches && s.fullMatches.length > 0) {
                const list = `<ul>${s.fullMatches.map(m => `<li>${formatMarkdown(m)}</li>`).join('')}</ul>`;
                summaryContent.appendChild(createHighlightItem('Full Matches', list, 'matches'));
            }

            // Partial & Missing
            if (s.partialMissing && s.partialMissing.length > 0) {
                const list = `<ul>${s.partialMissing.map(m => `<li>${formatMarkdown(m)}</li>`).join('')}</ul>`;
                summaryContent.appendChild(createHighlightItem('Partial & Missing', list, 'gaps'));
            }

            // Unique Insight
            if (s.uniqueInsight) {
                summaryContent.appendChild(createHighlightItem('Unique Insight', formatMarkdown(s.uniqueInsight), 'insight'));
            }
        } else if (Array.isArray(data.summary)) {
            summaryContent.innerHTML = '<ul>' + data.summary.map(item => `<li>${formatMarkdown(item)}</li>`).join('') + '</ul>';
        } else {
            summaryContent.textContent = data.summary || "No highlights provided.";
        }

        // Update Square Scale
        const score = data.relevanceScore || 0;
        const scale = Math.max(1, Math.floor(score)); // 1-5 scale
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

        text.textContent = `${score}/5`;
        text.style.color = color;
    }

    function createHighlightItem(label, content, className) {
        const div = document.createElement('div');
        div.className = `highlight-item ${className}`;
        div.innerHTML = `
            <div class="highlight-label">${label}</div>
            <div class="highlight-content">${content}</div>
        `;
        return div;
    }

    function formatMarkdown(text) {
        if (!text) return '';
        return text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code>$1</code>');
    }
});
