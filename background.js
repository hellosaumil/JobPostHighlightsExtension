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

console.log("Job Post Highlights extension loaded.");
