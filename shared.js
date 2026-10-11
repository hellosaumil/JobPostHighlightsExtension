// shared.js - Shared UI logic for sidepanel and window views
// Loaded by both sidepanel.html and window.html before their own scripts.

// ── Debug flag — set to true during development to see verbose logs ──
const DEBUG = false;
function dbg(...args) { if (DEBUG) console.log(...args); }

// ── XSS-safe HTML escaping ──
function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ── Markdown renderer (runs on already-escaped HTML) ──
function formatMarkdown(text) {
    if (!text) return '';
    return escapeHTML(text)
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`(.*?)`/g, '<code>$1</code>');
}

// ── Parse Stage 1 labeled-text output into a key→value map ──
function parseStage1Output(text) {
    const fields = {};
    for (const line of text.split('\n')) {
        const match = line.match(/^([A-Z\s]+):\s*(.+)$/);
        if (match) {
            const key = match[1].trim().toLowerCase().replace(/\s+/g, '');
            fields[key] = match[2].trim();
        }
    }
    return fields;
}

// ── Create a highlight card element ──
function createHighlightItem(label, content, className) {
    const div = document.createElement('div');
    div.className = `highlight-item ${className}`;
    // label is a static string from our code — safe to set directly
    // content is already sanitized (either escaped or built from safe elements)
    div.innerHTML = `
        <div class="highlight-label">${escapeHTML(label)}</div>
        <div class="highlight-content">${content}</div>
    `;
    return div;
}

// ── Extract job content from a tab by messaging content.js ──
// Falls back to chrome.scripting.executeScript with the same selector set if
// the content script hasn't loaded yet (e.g. on extension-owned pages).
async function extractTabContent(tabId) {
    // Try messaging content.js first (preferred — uses richer selector set)
    try {
        const response = await chrome.tabs.sendMessage(tabId, { action: 'extractJobContent' });
        if (response && response.text && response.text.length > 50) {
            dbg('[Content] Extracted via content.js messaging', response.text.length, 'chars');
            return response.text;
        }
    } catch (_) {
        // Content script not injected yet — fall through to scripting API
    }

    // Fallback: inject the same extraction logic on demand
    const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
            const selectors = [
                '#job-description',
                '.job-description',
                '.job-description--wrapper',
                '#jobDescriptionText',
                '.show-more-less-html__snippet',   // LinkedIn
                '#content',                         // Greenhouse
                '.posting-page',                    // Lever
                'main',
                'article',
            ];
            for (const s of selectors) {
                const el = document.querySelector(s);
                if (el && el.innerText.length > 200) return el.innerText;
            }
            return document.body.innerText;
        }
    });
    dbg('[Content] Extracted via scripting fallback', result?.length, 'chars');
    return result;
}

// ── Shared UI initializer ──
// mode: 'sidepanel' | 'window'
// Each mode's own script calls this after adding its unique listeners.
function initSharedUI(mode) {
    // ── Element references (shared across both modes) ──
    const mainView              = document.getElementById('mainView');
    const settingsView          = document.getElementById('settingsView');
    const summarizeBtn          = document.getElementById('summarizeBtn');
    const btnText               = summarizeBtn.querySelector('.btn-text');
    const btnLoader             = summarizeBtn.querySelector('.btn-loader');
    const btnCancel             = summarizeBtn.querySelector('.btn-cancel');
    const settingsBtn           = document.getElementById('settingsBtn');
    const themeBtn              = document.getElementById('themeBtn');
    const backBtn               = document.getElementById('backBtn');
    const saveSettingsBtn       = document.getElementById('saveSettingsBtn');
    const resetSettingsBtn      = document.getElementById('resetSettingsBtn');
    const apiKeyInput           = document.getElementById('apiKey');
    const resultsDiv            = document.getElementById('results');
    const providerSelect        = document.getElementById('provider');
    const geminiSettings        = document.getElementById('geminiSettings');
    const ollamaSettings        = document.getElementById('ollamaSettings');
    const ollamaUrlInput        = document.getElementById('ollamaUrl');
    const ollamaModelSelect     = document.getElementById('ollamaModel');
    const refreshOllamaBtn      = document.getElementById('refreshOllamaBtn');
    const statusMsg             = document.getElementById('statusMsg');
    const useSummarizerCheckbox = document.getElementById('useSummarizer');
    const geminiModelSelect     = document.getElementById('geminiModel');
    const ondeviceSettings      = document.getElementById('ondeviceSettings');
    const onDeviceAPISelect     = document.getElementById('onDeviceAPI');
    const preparseProviderSelect = document.getElementById('preparseProvider');
    const errorBanner           = document.getElementById('errorBanner');
    const statusBanner          = document.getElementById('statusBanner');
    const sunIcon               = themeBtn.querySelector('.sun-icon');
    const moonIcon              = themeBtn.querySelector('.moon-icon');
    const fontIncBtn            = document.getElementById('fontIncBtn');
    const fontDecBtn            = document.getElementById('fontDecBtn');
    const stage1Modal           = document.getElementById('stage1Modal');

    // Disable until model is ready
    summarizeBtn.disabled = true;

    // State
    let initialSettings = {};
    let lastResponseRaw = '';
    let lastSummarizerOutput = '';
    let currentAbortController = null;
    let fontSize = 100;

    // ── Banner helpers ──
    function showError(msg) {
        errorBanner.textContent = msg;
        errorBanner.classList.remove('hidden');
        hideStatus();
    }
    function hideError() {
        errorBanner.classList.add('hidden');
        errorBanner.textContent = '';
    }
    function showStatus(msg, type = 'status-loading') {
        statusBanner.textContent = msg;
        statusBanner.className = `status-banner ${type}`;
        statusBanner.classList.remove('hidden');
    }
    function hideStatus() {
        statusBanner.classList.add('hidden');
        statusBanner.textContent = '';
    }

    // ── On-device model init ──
    (async () => {
        const config = await chrome.storage.local.get(['provider']);
        if ((config.provider || 'ondevice') === 'ondevice') {
            showStatus('Initializing on-device model...', 'status-loading');
            const result = await initOnDeviceModel();
            summarizeBtn.disabled = false;
            if (result.success) {
                showStatus('AI model ready.', 'status-info');
                setTimeout(hideStatus, 2000);
            } else {
                showStatus(`On-device AI unavailable: ${result.reason}`, 'status-warn');
            }
        } else {
            summarizeBtn.disabled = false;
        }
    })();

    // ── Provider panel toggle ──
    function toggleProviderSettings(provider) {
        geminiSettings.classList.toggle('hidden', provider !== 'gemini');
        ollamaSettings.classList.toggle('hidden', provider !== 'ollama');
        ondeviceSettings.classList.toggle('hidden', provider !== 'ondevice');
    }

    providerSelect.addEventListener('change', (e) => {
        toggleProviderSettings(e.target.value);
        hideError();
        if (e.target.value === 'ollama') loadOllamaModels();
    });

    useSummarizerCheckbox.addEventListener('change', (e) => {
        preparseProviderSelect.disabled = !e.target.checked;
    });

    // ── Ollama model list ──
    async function loadOllamaModels(selectedModel = null) {
        const baseUrl = ollamaUrlInput.value.trim();
        const models = await fetchOllamaModels(baseUrl);

        ollamaModelSelect.innerHTML = '';
        if (models.length === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = 'No models found. Check URL.';
            ollamaModelSelect.appendChild(opt);
            return;
        }
        for (const m of models) {
            const opt = document.createElement('option');
            opt.value = m;
            opt.textContent = m;
            ollamaModelSelect.appendChild(opt);
        }
        const targetModel = selectedModel || (await chrome.storage.local.get(['ollamaModel'])).ollamaModel;
        if (targetModel && models.includes(targetModel)) ollamaModelSelect.value = targetModel;
    }

    refreshOllamaBtn.addEventListener('click', () => loadOllamaModels());
    ollamaUrlInput.addEventListener('blur', () => {
        if (providerSelect.value === 'ollama' && ollamaUrlInput.value.trim()) loadOllamaModels();
    });

    // ── Theme toggle ──
    themeBtn.addEventListener('click', () => {
        const isLight = document.body.getAttribute('data-theme') === 'light';
        if (isLight) {
            document.body.removeAttribute('data-theme');
            sunIcon?.classList.remove('hidden');
            moonIcon?.classList.add('hidden');
            chrome.storage.local.set({ theme: 'dark' });
        } else {
            document.body.setAttribute('data-theme', 'light');
            sunIcon?.classList.add('hidden');
            moonIcon?.classList.remove('hidden');
            chrome.storage.local.set({ theme: 'light' });
        }
    });

    // ── Font size controls ──
    fontIncBtn?.addEventListener('click', () => {
        if (fontSize < 150) {
            fontSize += 10;
            document.documentElement.style.fontSize = fontSize + '%';
            chrome.storage.local.set({ fontSize });
        }
    });
    fontDecBtn?.addEventListener('click', () => {
        if (fontSize > 70) {
            fontSize -= 10;
            document.documentElement.style.fontSize = fontSize + '%';
            chrome.storage.local.set({ fontSize });
        }
    });

    // ── Settings navigation ──
    settingsBtn.addEventListener('click', () => {
        initialSettings = {
            provider: providerSelect.value,
            apiKey: apiKeyInput.value,
            geminiModel: geminiModelSelect.value,
            ollamaUrl: ollamaUrlInput.value,
            ollamaModel: ollamaModelSelect.value,
            onDeviceAPI: onDeviceAPISelect.value,
            useSummarizer: useSummarizerCheckbox.checked,
            preparseProvider: preparseProviderSelect.value,
        };
        mainView.classList.add('hidden');
        settingsView.classList.remove('hidden');
        statusMsg.classList.add('hidden');
        if (providerSelect.value === 'ollama') loadOllamaModels();
    });

    backBtn.addEventListener('click', () => {
        saveSettings(true);
        settingsView.classList.add('hidden');
        mainView.classList.remove('hidden');
        hideError();
    });

    // ── Load saved settings ──
    chrome.storage.local.get([
        'geminiApiKey', 'geminiModel', 'theme', 'fontSize',
        'provider', 'ollamaUrl', 'ollamaModel',
        'useSummarizer', 'onDeviceAPI', 'preparseProvider'
    ], (result) => {
        if (result.geminiApiKey) apiKeyInput.value = result.geminiApiKey;
        if (result.geminiModel) geminiModelSelect.value = result.geminiModel;

        const currentProvider = result.provider || 'ondevice';
        providerSelect.value = currentProvider;
        if (result.ollamaUrl) ollamaUrlInput.value = result.ollamaUrl;
        if (result.onDeviceAPI) onDeviceAPISelect.value = result.onDeviceAPI;
        useSummarizerCheckbox.checked = result.useSummarizer !== false;
        preparseProviderSelect.value = result.preparseProvider || 'ondevice';
        preparseProviderSelect.disabled = !useSummarizerCheckbox.checked;

        toggleProviderSettings(currentProvider);

        if (result.theme === 'light') {
            document.body.setAttribute('data-theme', 'light');
            sunIcon?.classList.add('hidden');
            moonIcon?.classList.remove('hidden');
        }
        if (result.fontSize) {
            fontSize = result.fontSize;
            document.documentElement.style.fontSize = fontSize + '%';
        }
        if (result.provider === 'ollama') loadOllamaModels(result.ollamaModel);
    });

    // ── Save settings ──
    function saveSettings(silent = false) {
        chrome.storage.local.set({
            geminiApiKey:    apiKeyInput.value.trim(),
            geminiModel:     geminiModelSelect.value,
            provider:        providerSelect.value,
            ollamaUrl:       ollamaUrlInput.value.trim(),
            ollamaModel:     ollamaModelSelect.value,
            onDeviceAPI:     onDeviceAPISelect.value,
            useSummarizer:   useSummarizerCheckbox.checked,
            preparseProvider: preparseProviderSelect.value,
        }, () => {
            if (!silent) {
                statusMsg.classList.remove('hidden');
                setTimeout(() => statusMsg.classList.add('hidden'), 2000);
            }
        });
    }

    saveSettingsBtn.addEventListener('click', () => saveSettings());

    resetSettingsBtn.addEventListener('click', () => {
        if (!initialSettings.provider) return;
        providerSelect.value = initialSettings.provider;
        apiKeyInput.value = initialSettings.apiKey;
        geminiModelSelect.value = initialSettings.geminiModel;
        ollamaUrlInput.value = initialSettings.ollamaUrl;
        useSummarizerCheckbox.checked = initialSettings.useSummarizer !== false;
        if (initialSettings.preparseProvider) preparseProviderSelect.value = initialSettings.preparseProvider;
        if (onDeviceAPISelect && initialSettings.onDeviceAPI) onDeviceAPISelect.value = initialSettings.onDeviceAPI;
        preparseProviderSelect.disabled = !useSummarizerCheckbox.checked;
        toggleProviderSettings(initialSettings.provider);
        if (initialSettings.provider === 'ollama') loadOllamaModels(initialSettings.ollamaModel);
    });

    // ── Stage 1 modal ──
    document.getElementById('viewStage1Btn').addEventListener('click', () => {
        document.getElementById('stage1Output').textContent = lastSummarizerOutput;
        stage1Modal.classList.remove('hidden');
    });
    document.getElementById('closeStage1Modal').addEventListener('click', () => {
        stage1Modal.classList.add('hidden');
    });
    stage1Modal.addEventListener('click', (e) => {
        if (e.target === stage1Modal) stage1Modal.classList.add('hidden');
    });

    // ── Loading state helpers ──
    function setLoadingState(loading) {
        summarizeBtn.classList.toggle('loading', loading);
        btnText.classList.toggle('hidden', loading);
        btnLoader.classList.toggle('hidden', !loading);
        btnCancel.classList.add('hidden');
        summarizeBtn.disabled = false;
    }
    function resetLoadingState() {
        summarizeBtn.classList.remove('loading');
        btnText.classList.remove('hidden');
        btnLoader.classList.add('hidden');
        btnCancel.classList.add('hidden');
        summarizeBtn.disabled = false;
    }

    // ── Stage 1 detail display ──
    function displayStage1Details(text, provider) {
        const fields = parseStage1Output(text);
        const set = (id, key) => {
            const el = document.getElementById(id);
            if (el) el.textContent = fields[key] || '---';
        };
        set('stage1Title',              'title');
        set('stage1Salary',             'salary');
        set('stage1Location',           'location');
        set('stage1Experience',         'experience');
        set('stage1RoleFocus',          'rolefocus');
        set('stage1Team',               'team');
        set('stage1RequiredSkills',     'requiredskills');
        set('stage1PreferredSkills',    'preferredskills');
        set('stage1KeyResponsibilities','keyresponsibilities');
        set('stage1AboutRole',          'aboutrole');

        if (provider) {
            const header = document.querySelector('.stage1-details-grid')?.parentElement;
            if (header && !header.querySelector('.stage1-provider')) {
                const label = document.createElement('div');
                label.className = 'stage1-provider';
                label.textContent = `Provider: ${provider}`;
                header.insertBefore(label, header.firstChild);
            }
        }
        document.getElementById('stage1Details')?.classList.remove('hidden');
    }

    // ── Update results UI ──
    function updateUI(data, duration, timings) {
        resultsDiv.classList.remove('hidden');
        document.getElementById('stage1Details').classList.add('hidden');
        hideStatus();

        const timeEl = document.getElementById('timeTaken');
        if (timings) {
            timeEl.textContent = `S1: ${timings.stage1}s | S2: ${timings.stage2}s | Total: ${timings.total}s`;
            timeEl.classList.remove('hidden');
        } else if (duration) {
            timeEl.textContent = `Response in ${duration}s`;
            timeEl.classList.remove('hidden');
        }

        const stage1Btn = document.getElementById('viewStage1Btn');
        stage1Btn.classList.toggle('hidden', !lastSummarizerOutput);

        document.getElementById('jobTitle').textContent = data.title  || '---';
        document.getElementById('salary').textContent   = data.salary || '---';
        document.getElementById('team').textContent     = data.team   || '---';
        document.getElementById('expReq').textContent   = data.expReq || '---';

        const summaryContent = document.getElementById('summaryContent');
        summaryContent.innerHTML = '';

        if (data.summary && typeof data.summary === 'object' && !Array.isArray(data.summary)) {
            const s = data.summary;

            if (s.primaryStatus) {
                const matchClass = (s.primaryStatus.match || '').toLowerCase().replace(/[^a-z]/g, '');
                const statusDiv = document.createElement('div');
                statusDiv.className = `highlight-item primary-status-box ${matchClass}`;

                const badge = document.createElement('div');
                badge.className = `status-badge ${matchClass}`;
                badge.textContent = s.primaryStatus.match;  // textContent — XSS safe

                const reason = document.createElement('div');
                reason.className = 'status-reason';
                reason.innerHTML = formatMarkdown(s.primaryStatus.reason);

                statusDiv.appendChild(badge);
                statusDiv.appendChild(reason);
                summaryContent.appendChild(statusDiv);
            }

            if (s.levelingNote && s.levelingNote !== 'NULL' && s.levelingNote !== 'N/A') {
                summaryContent.appendChild(createHighlightItem('Leveling Note', formatMarkdown(s.levelingNote), 'level-note'));
            }
            if (s.fullMatches?.length > 0) {
                const ul = document.createElement('ul');
                s.fullMatches.forEach(m => {
                    const li = document.createElement('li');
                    li.innerHTML = formatMarkdown(m);
                    ul.appendChild(li);
                });
                summaryContent.appendChild(createHighlightItem('Full Matches', ul.outerHTML, 'matches'));
            }
            if (s.partialMissing?.length > 0) {
                const ul = document.createElement('ul');
                s.partialMissing.forEach(m => {
                    const li = document.createElement('li');
                    li.innerHTML = formatMarkdown(m);
                    ul.appendChild(li);
                });
                summaryContent.appendChild(createHighlightItem('Partial & Missing', ul.outerHTML, 'gaps'));
            }
            if (s.uniqueInsight) {
                summaryContent.appendChild(createHighlightItem('Unique Insight', formatMarkdown(s.uniqueInsight), 'insight'));
            }

        } else if (Array.isArray(data.summary)) {
            const ul = document.createElement('ul');
            data.summary.forEach(item => {
                const li = document.createElement('li');
                li.innerHTML = formatMarkdown(item);
                ul.appendChild(li);
            });
            summaryContent.appendChild(ul);
        } else {
            summaryContent.textContent = data.summary || 'No highlights provided.';
        }

        // Score squares
        const score = data.relevanceScore || 0;
        const scale = Math.max(1, Math.floor(score));
        const container = document.getElementById('scoreSquares');
        const squares = container.querySelectorAll('.square');
        const scoreText = document.getElementById('scoreText');

        const scoreColors = [
            null,
            { color: '#ef4444', glow: 'rgba(239,68,68,0.5)' },
            { color: '#f97316', glow: 'rgba(249,115,22,0.5)' },
            { color: '#eab308', glow: 'rgba(234,179,8,0.5)' },
            { color: '#84cc16', glow: 'rgba(132,204,22,0.5)' },
            { color: '#10b981', glow: 'rgba(16,185,129,0.5)' },
        ];
        const { color, glow } = scoreColors[Math.min(scale, 5)] || scoreColors[1];
        container.style.setProperty('--scale-color', color);
        container.style.setProperty('--scale-glow', glow);
        squares.forEach((sq, i) => sq.classList.toggle('active', i < scale));
        scoreText.textContent = `${score}/5`;
        scoreText.style.color = color;
    }

    // ── Core summarize handler ──
    // getTargetTabId: async fn returning the tab ID to analyse (different per mode)
    async function runSummarize(getTargetTabId) {
        if (currentAbortController) {
            currentAbortController.abort();
            currentAbortController = null;
            resetLoadingState();
            hideStatus();
            hideError();
            return;
        }

        setLoadingState(true);
        resultsDiv.classList.add('hidden');
        document.getElementById('stage1Details')?.classList.add('hidden');
        hideError();
        hideStatus();
        showStatus('Summarizing...', 'status-loading');

        currentAbortController = new AbortController();

        try {
            const config = await chrome.storage.local.get([
                'geminiApiKey', 'geminiModel', 'provider', 'ollamaUrl',
                'ollamaModel', 'useSummarizer', 'onDeviceAPI', 'preparseProvider'
            ]);

            await checkProviderConnection(config);

            const tabId = await getTargetTabId();
            const contentResult = await extractTabContent(tabId);
            if (!contentResult) throw new Error('Could not extract page content.');

            const stage1OutputEl = document.getElementById('stage1Output');
            const stage1Btn      = document.getElementById('viewStage1Btn');

            const onStage1Done = (text, duration, skipped, stage1Provider) => {
                if (skipped) { showStatus('Extraction skipped', 'status-warn'); return; }
                lastSummarizerOutput = text;
                stage1OutputEl.textContent = text;
                stage1Btn.classList.remove('hidden');
                displayStage1Details(text, stage1Provider);
                showStatus(`Extraction done (${stage1Provider}). ${duration}s`, 'status-info');
            };
            const onStage2Start = () => showStatus('Finding job highlights...', 'status-loading');

            const startTime = performance.now();
            const analysis = await summarizeJob(config, contentResult, currentAbortController.signal, onStage1Done, onStage2Start);

            lastResponseRaw      = analysis.raw    || '';
            lastSummarizerOutput = analysis.preParsed || '';
            const duration = ((performance.now() - startTime) / 1000).toFixed(2);
            updateUI(analysis.parsed, duration, analysis.timings);

        } catch (error) {
            if (error.name === 'AbortError') {
                dbg('Evaluation cancelled by user.');
            } else {
                console.error('Evaluation error:', error);
                showError(error.message || 'An unexpected error occurred.');
            }
        } finally {
            currentAbortController = null;
            setLoadingState(false);
        }
    }

    // Expose helpers needed by mode-specific scripts
    return { runSummarize, showError, hideError, showStatus, hideStatus, loadOllamaModels };
}
