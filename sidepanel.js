// sidepanel.js - Controller for the side panel (mode-specific code only)
// Shared logic lives in shared.js, which is loaded before this script.

// Connect to background to track panel open/close state
const panelPort = chrome.runtime.connect({ name: 'sidepanel' });

document.addEventListener('DOMContentLoaded', () => {
    // Initialize all shared UI (settings, theme, ollama, summarize runner, etc.)
    const { runSummarize } = initSharedUI('sidepanel');

    // ── Sidepanel-only: Pop-out button ──
    const popoutBtn = document.getElementById('popoutBtn');
    popoutBtn?.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'popout' }, (response) => {
            if (response?.success) window.close();
        });
    });

    // ── Sidepanel-only: Resize handle ──
    const resizeHandle = document.querySelector('.resize-handle');
    if (resizeHandle) {
        let isResizing = false;
        resizeHandle.addEventListener('mousedown', (e) => {
            isResizing = true;
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            if (e.clientX > 280 && e.clientX < 600) document.body.style.width = e.clientX + 'px';
            if (e.clientY > 150 && e.clientY < 800) document.body.style.minHeight = e.clientY + 'px';
        });
        document.addEventListener('mouseup', () => { isResizing = false; });
    }

    // ── Sidepanel-only: Summarize button wires to the active tab ──
    document.getElementById('summarizeBtn').addEventListener('click', () => {
        runSummarize(async () => {
            const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
            if (!tab) throw new Error('Could not find active tab.');
            return tab.id;
        });
    });
});
