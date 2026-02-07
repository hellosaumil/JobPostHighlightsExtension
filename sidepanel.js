// sidepanel.js - Controller for the side panel

document.addEventListener('DOMContentLoaded', () => {
    // Elements
    const mainView = document.getElementById('mainView');
    const settingsView = document.getElementById('settingsView');
    const summarizeBtn = document.getElementById('summarizeBtn');
    const btnText = summarizeBtn.querySelector('.btn-text');
    const btnLoader = summarizeBtn.querySelector('.btn-loader');
    const settingsBtn = document.getElementById('settingsBtn');
    const themeBtn = document.getElementById('themeBtn');
    const popoutBtn = document.getElementById('popoutBtn');
    const backBtn = document.getElementById('backBtn');
    const saveSettingsBtn = document.getElementById('saveSettingsBtn');
    const apiKeyInput = document.getElementById('apiKey');
    const resultsDiv = document.getElementById('results');

    // Load saved settings
    chrome.storage.local.get(['geminiApiKey', 'theme'], (result) => {
        if (result.geminiApiKey) {
            apiKeyInput.value = result.geminiApiKey;
        }
        if (result.theme === 'light') {
            document.body.setAttribute('data-theme', 'light');
            themeBtn.querySelector('.sun-icon')?.classList.add('hidden');
            themeBtn.querySelector('.moon-icon')?.classList.remove('hidden');
        }
    });

    // Theme Toggle
    const sunIcon = themeBtn.querySelector('.sun-icon');
    const moonIcon = themeBtn.querySelector('.moon-icon');

    themeBtn.addEventListener('click', () => {
        const isLight = document.body.getAttribute('data-theme') === 'light';
        if (isLight) {
            document.body.removeAttribute('data-theme');
            sunIcon.classList.remove('hidden');
            moonIcon.classList.add('hidden');
            chrome.storage.local.set({ theme: 'dark' });
        } else {
            document.body.setAttribute('data-theme', 'light');
            sunIcon.classList.add('hidden');
            moonIcon.classList.remove('hidden');
            chrome.storage.local.set({ theme: 'light' });
        }
    });

    // Font Size Controls
    const fontIncBtn = document.getElementById('fontIncBtn');
    const fontDecBtn = document.getElementById('fontDecBtn');
    let fontSize = 100; // percentage

    chrome.storage.local.get(['fontSize'], (result) => {
        if (result.fontSize) {
            fontSize = result.fontSize;
            document.documentElement.style.fontSize = fontSize + '%';
        }
    });

    fontIncBtn.addEventListener('click', () => {
        if (fontSize < 150) {
            fontSize += 10;
            document.documentElement.style.fontSize = fontSize + '%';
            chrome.storage.local.set({ fontSize });
        }
    });

    fontDecBtn.addEventListener('click', () => {
        if (fontSize > 70) {
            fontSize -= 10;
            document.documentElement.style.fontSize = fontSize + '%';
            chrome.storage.local.set({ fontSize });
        }
    });

    // Pop-out to separate window
    popoutBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: "popout" }, (response) => {
            if (response && response.success) {
                window.close();
            }
        });
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
    const resizeHandle = document.querySelector('.resize-handle');
    if (resizeHandle) {
        let isResizing = false;
        resizeHandle.addEventListener('mousedown', (e) => {
            isResizing = true;
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const newWidth = e.clientX;
            const newHeight = e.clientY;
            if (newWidth > 280 && newWidth < 600) {
                document.body.style.width = newWidth + 'px';
            }
            if (newHeight > 150 && newHeight < 800) {
                document.body.style.minHeight = newHeight + 'px';
            }
        });

        document.addEventListener('mouseup', () => {
            isResizing = false;
        });
    }

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
                await new Promise(resolve => setTimeout(resolve, 800));
                analysis = {
                    title: "Senior Software Engineer",
                    salary: "$150,000 - $200,000",
                    team: "Platform Infrastructure",
                    expReq: "5+ years",
                    relevanceScore: 78,
                    summary: [
                        "Build distributed systems at scale",
                        "Python, Go, Kubernetes experience preferred",
                        "Opportunity to lead technical initiatives",
                        "Remote-friendly with quarterly on-sites"
                    ]
                };
            } else {
                const result = await chrome.storage.local.get(['geminiApiKey']);
                const apiKey = result.geminiApiKey;

                if (!apiKey) {
                    alert('Please set your Gemini API key in settings first.');
                    btnText.classList.remove('hidden');
                    btnLoader.classList.add('hidden');
                    summarizeBtn.disabled = false;
                    return;
                }

                const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

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

        // Render summary as a list if it's an array, otherwise display as text
        const summaryEl = document.getElementById('summaryText');
        if (Array.isArray(data.summary)) {
            summaryEl.innerHTML = '<ul>' + data.summary.map(item => `<li>${item}</li>`).join('') + '</ul>';
        } else {
            summaryEl.textContent = data.summary || "No summary provided.";
        }

        const score = data.relevanceScore || 0;
        const ring = document.getElementById('scoreRing');
        const text = document.getElementById('scoreText');

        const radius = ring.r.baseVal.value;
        const circumference = 2 * Math.PI * radius;

        ring.style.strokeDasharray = circumference;
        const offset = circumference - (score / 100) * circumference;
        ring.style.strokeDashoffset = offset;

        text.textContent = `${score}%`;

        if (score >= 80) {
            ring.style.stroke = "var(--success-color)";
        } else if (score >= 50) {
            ring.style.stroke = "var(--accent-color)";
        } else {
            ring.style.stroke = "var(--error-color)";
        }
    }
});
