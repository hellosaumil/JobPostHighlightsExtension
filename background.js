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
    if (port.name === "sidepanel") {
        port.onDisconnect.addListener(() => {
            // Panel was closed (user clicked ✕ or navigated away)
            openPanelWindows.clear();
        });
    }
});

// Handle messages for pop-out/dock transitions
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "popout") {
        // Create a new window with window.html
        chrome.windows.create({
            url: chrome.runtime.getURL("window.html"),
            type: "popup",
            width: 500,
            height: 600,
            focused: true
        }, (newWindow) => {
            sendResponse({ success: true, windowId: newWindow.id });
        });
        return true; // Keep channel open for async response
    }

    if (request.action === "dock") {
        // Close the current window and open side panel
        chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.sidePanel.open({ tabId: tabs[0].id });
            }
        });
        // Close the popup window
        if (sender.tab) {
            chrome.windows.remove(sender.tab.windowId);
        }
        sendResponse({ success: true });
        return true;
    }
});

// Set up declarativeNetRequest rules to allow talking to Ollama without CORS issues
// and to bypass ngrok's browser warning
async function setupOllamaRules() {
    try {
        const { ollamaUrl } = await chrome.storage.local.get(['ollamaUrl']);
        
        // Clear all existing dynamic rules to start fresh and avoid conflicts
        const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
        const existingRuleIds = existingRules.map(r => r.id);
        
        const rules = [
            {
                id: 1,
                priority: 100,
                action: {
                    type: 'modifyHeaders',
                    requestHeaders: [
                        { header: 'ngrok-skip-browser-warning', operation: 'set', value: 'true' },
                        { header: 'origin', operation: 'remove' },
                        { header: 'referer', operation: 'remove' },
                        { header: 'sec-fetch-mode', operation: 'remove' },
                        { header: 'sec-fetch-site', operation: 'remove' }
                    ],
                    responseHeaders: [
                        { header: 'Access-Control-Allow-Origin', operation: 'set', value: '*' },
                        { header: 'Access-Control-Allow-Methods', operation: 'set', value: '*' },
                        { header: 'Access-Control-Allow-Headers', operation: 'set', value: '*' },
                        { header: 'Access-Control-Max-Age', operation: 'set', value: '3600' }
                    ]
                },
                condition: {
                    regexFilter: "^https?://localhost:11434/.*",
                    resourceTypes: ['xmlhttprequest', 'other']
                }
            },
            {
                id: 2,
                priority: 100,
                action: {
                    type: 'modifyHeaders',
                    requestHeaders: [
                        { header: 'ngrok-skip-browser-warning', operation: 'set', value: 'true' },
                        { header: 'origin', operation: 'remove' },
                        { header: 'referer', operation: 'remove' },
                        { header: 'sec-fetch-mode', operation: 'remove' },
                        { header: 'sec-fetch-site', operation: 'remove' }
                    ],
                    responseHeaders: [
                        { header: 'Access-Control-Allow-Origin', operation: 'set', value: '*' },
                        { header: 'Access-Control-Allow-Methods', operation: 'set', value: '*' },
                        { header: 'Access-Control-Allow-Headers', operation: 'set', value: '*' },
                        { header: 'Access-Control-Max-Age', operation: 'set', value: '3600' }
                    ]
                },
                condition: {
                    regexFilter: "^https?://[^/]+\\.ngrok-free\\.app/.*",
                    resourceTypes: ['xmlhttprequest', 'other']
                }
            },
            {
                id: 3,
                priority: 100,
                action: {
                    type: 'modifyHeaders',
                    requestHeaders: [
                        { header: 'ngrok-skip-browser-warning', operation: 'set', value: 'true' },
                        { header: 'origin', operation: 'remove' },
                        { header: 'referer', operation: 'remove' },
                        { header: 'sec-fetch-mode', operation: 'remove' },
                        { header: 'sec-fetch-site', operation: 'remove' }
                    ],
                    responseHeaders: [
                        { header: 'Access-Control-Allow-Origin', operation: 'set', value: '*' },
                        { header: 'Access-Control-Allow-Methods', operation: 'set', value: '*' },
                        { header: 'Access-Control-Allow-Headers', operation: 'set', value: '*' }
                    ]
                },
                condition: {
                    regexFilter: "^https?://[^/]+\\.ngrok\\.io/.*",
                    resourceTypes: ['xmlhttprequest', 'other']
                }
            }
        ];

        // Custom URL catch-all rule
        if (ollamaUrl && !ollamaUrl.includes('localhost') && !ollamaUrl.includes('ngrok-free.app') && !ollamaUrl.includes('ngrok.io')) {
             try {
                const url = new URL(ollamaUrl);
                rules.push({
                    id: 4,
                    priority: 100,
                    action: {
                        type: 'modifyHeaders',
                        requestHeaders: [
                            { header: 'ngrok-skip-browser-warning', operation: 'set', value: 'true' },
                            { header: 'origin', operation: 'remove' },
                            { header: 'referer', operation: 'remove' },
                            { header: 'sec-fetch-mode', operation: 'remove' },
                            { header: 'sec-fetch-site', operation: 'remove' }
                        ],
                        responseHeaders: [
                            { header: 'Access-Control-Allow-Origin', operation: 'set', value: '*' },
                            { header: 'Access-Control-Allow-Methods', operation: 'set', value: '*' },
                            { header: 'Access-Control-Allow-Headers', operation: 'set', value: '*' }
                        ]
                    },
                    condition: {
                        regexFilter: `^${url.protocol}//${url.host}/.*`,
                        resourceTypes: ['xmlhttprequest', 'other']
                    }
                });
            } catch (e) {
                console.warn("Invalid ollamaUrl for DNR rule:", ollamaUrl);
            }
        }

        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: existingRuleIds,
            addRules: rules
        });
        console.log(`[OllamaRules] Registered ${rules.length} rules with regex filters (with preflight & ngrok support).`);
    } catch (e) {
        console.error("Failed to register Ollama rules:", e);
    }
}

// Run setup on install/startup
chrome.runtime.onInstalled.addListener(setupOllamaRules);
chrome.runtime.onStartup.addListener(setupOllamaRules);

// Update rules when Ollama settings change
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.ollamaUrl) {
        setupOllamaRules();
    }
});

console.log("Job Post Highlights extension loaded.");
