// background.js - Service worker for Side Panel and Pop-out coordination

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
    chrome.sidePanel.open({ tabId: tab.id });
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
