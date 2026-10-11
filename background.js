// background.js - Service worker for Side Panel and Pop-out coordination

// Track which windows have the side panel open
const openPanelWindows = new Set();

// Toggle side panel when extension icon is clicked (or Cmd+J / Ctrl+J)
chrome.action.onClicked.addListener(async (tab) => {
    const windowId = tab.windowId;
    if (openPanelWindows.has(windowId)) {
        try {
            await chrome.sidePanel.close({ windowId });
        } catch (e) {
            // Panel wasn't actually open — state was stale
        }
        openPanelWindows.delete(windowId);
    } else {
        await chrome.sidePanel.open({ windowId, tabId: tab.id });
        openPanelWindows.add(windowId);
    }
});

// Track panel close via port disconnect from sidepanel.js
chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'sidepanel') {
        port.onDisconnect.addListener(() => {
            // Panel was closed (user clicked ✕ or navigated away)
            openPanelWindows.clear();
        });
    }
});

// Handle messages for pop-out/dock transitions
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'popout') {
        chrome.windows.create({
            url: chrome.runtime.getURL('window.html'),
            type: 'popup',
            width: 500,
            height: 600,
            focused: true
        }, (newWindow) => {
            sendResponse({ success: true, windowId: newWindow.id });
        });
        return true; // Keep channel open for async response
    }

    if (request.action === 'dock') {
        chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
            if (tabs[0]) chrome.sidePanel.open({ tabId: tabs[0].id });
        });
        if (sender.tab) chrome.windows.remove(sender.tab.windowId);
        sendResponse({ success: true });
        return true;
    }
});

// ── declarativeNetRequest rule builder ──────────────────────────────────────
// Shared header modifications applied to all matched URLs.
const CORS_REQUEST_HEADERS = [
    { header: 'ngrok-skip-browser-warning', operation: 'set',    value: 'true' },
    { header: 'origin',          operation: 'remove' },
    { header: 'referer',         operation: 'remove' },
    { header: 'sec-fetch-mode',  operation: 'remove' },
    { header: 'sec-fetch-site',  operation: 'remove' },
];
const CORS_RESPONSE_HEADERS = [
    { header: 'Access-Control-Allow-Origin',  operation: 'set', value: '*' },
    { header: 'Access-Control-Allow-Methods', operation: 'set', value: '*' },
    { header: 'Access-Control-Allow-Headers', operation: 'set', value: '*' },
    { header: 'Access-Control-Max-Age',       operation: 'set', value: '3600' },
];

function buildCORSRule(id, regexFilter) {
    return {
        id,
        priority: 100,
        action: {
            type: 'modifyHeaders',
            requestHeaders:  CORS_REQUEST_HEADERS,
            responseHeaders: CORS_RESPONSE_HEADERS,
        },
        condition: {
            regexFilter,
            resourceTypes: ['xmlhttprequest', 'other'],
        },
    };
}

// Set up declarativeNetRequest rules to allow talking to Ollama without CORS issues
// and to bypass ngrok's browser warning.
async function setupOllamaRules() {
    try {
        const { ollamaUrl } = await chrome.storage.local.get(['ollamaUrl']);

        // Clear existing dynamic rules to avoid conflicts
        const existing = await chrome.declarativeNetRequest.getDynamicRules();
        const existingIds = existing.map(r => r.id);

        const rules = [
            buildCORSRule(1, '^https?://localhost:11434/.*'),
            buildCORSRule(2, '^https?://[^/]+\\.ngrok-free\\.app/.*'),
            buildCORSRule(3, '^https?://[^/]+\\.ngrok\\.io/.*'),
        ];

        // Add rule for any custom Ollama URL that isn't already covered above
        if (ollamaUrl &&
            !ollamaUrl.includes('localhost') &&
            !ollamaUrl.includes('ngrok-free.app') &&
            !ollamaUrl.includes('ngrok.io')) {
            try {
                const { host, protocol } = new URL(ollamaUrl);
                rules.push(buildCORSRule(4, `^${protocol}//${host}/.*`));
            } catch (e) {
                console.warn('[OllamaRules] Invalid ollamaUrl for DNR rule:', ollamaUrl);
            }
        }

        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: existingIds,
            addRules: rules,
        });
        console.log(`[OllamaRules] Registered ${rules.length} rules (Ollama + ngrok CORS support).`);
    } catch (e) {
        console.error('[OllamaRules] Failed to register rules:', e);
    }
}

// Run setup on install/startup and whenever the Ollama URL setting changes
chrome.runtime.onInstalled.addListener(setupOllamaRules);
chrome.runtime.onStartup.addListener(setupOllamaRules);
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.ollamaUrl) setupOllamaRules();
});
