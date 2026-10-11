// window.js - Controller for the pop-out window (mode-specific code only)
// Shared logic lives in shared.js, which is loaded before this script.

document.addEventListener('DOMContentLoaded', () => {
    // Initialize all shared UI (settings, theme, ollama, summarize runner, etc.)
    const { runSummarize } = initSharedUI('window');

    // ── Window-only: Tab selector ──
    const tabSelect      = document.getElementById('tabSelect');
    const refreshTabsBtn = document.getElementById('refreshTabsBtn');

    async function loadTabs() {
        const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
        const allTabs = [];
        for (const win of windows) {
            const tabs = await chrome.tabs.query({ windowId: win.id });
            allTabs.push(...tabs);
        }
        tabSelect.innerHTML = '';
        for (const tab of allTabs) {
            const opt = document.createElement('option');
            opt.value = tab.id;
            opt.textContent = tab.title.length > 40 ? tab.title.substring(0, 40) + '...' : tab.title;
            if (tab.active) opt.selected = true;
            tabSelect.appendChild(opt);
        }
    }

    loadTabs();
    refreshTabsBtn.addEventListener('click', loadTabs);

    // ── Window-only: Dock back to side panel ──
    document.getElementById('dockBtn')?.addEventListener('click', async () => {
        const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
        if (windows.length > 0) {
            const tabs = await chrome.tabs.query({ active: true, windowId: windows[0].id });
            if (tabs[0]) await chrome.sidePanel.open({ tabId: tabs[0].id });
        }
        window.close();
    });

    // ── Window-only: Resize handle ──
    const resizeHandle = document.querySelector('.resize-handle');
    if (resizeHandle) {
        let isResizing = false;
        resizeHandle.addEventListener('mousedown', (e) => {
            isResizing = true;
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            if (e.clientX > 280 && e.clientX < 900) document.body.style.width = e.clientX + 'px';
            if (e.clientY > 150 && e.clientY < 900) document.body.style.minHeight = e.clientY + 'px';
        });
        document.addEventListener('mouseup', () => { isResizing = false; });
    }

    // ── Window-only: Summarize button uses the selected tab ──
    document.getElementById('summarizeBtn').addEventListener('click', () => {
        runSummarize(async () => {
            const tabId = parseInt(tabSelect.value);
            if (!tabId) throw new Error('Please select a tab first.');
            return tabId;
        });
    });
});
