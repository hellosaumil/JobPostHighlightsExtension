const fs = require('fs');
const path = require('path');

// Mock chrome and fetch for Node environment
global.chrome = {
    runtime: {
        getURL: (file) => path.join(__dirname, file)
    }
};

global.fetch = async (url) => {
    // If it's a local file (chrome-extension://), read from disk
    if (!url.startsWith('http')) {
        const filePath = url.replace('chrome-extension://', '');
        return {
            text: async () => fs.readFileSync(filePath, 'utf8'),
            blob: async () => ({
                arrayBuffer: async () => fs.readFileSync(filePath)
            })
        };
    }
    // For API calls (Gemini/Ollama)
    const https = require('https');
    return new Promise((resolve, reject) => {
        const options = {
            method: 'GET',
            headers: { 'User-Agent': 'Node.js' }
        };
        // This is a simplified fetch for Node. We only need it for local files and Ollama.
        // For actual Ollama/Gemini, we'll use a real fetch-like implementation if needed,
        // but let's use standard node https/http for now.
    });
};

// Instead of mocking deep fetch, let's just extract the core logic
// Since ai_service.js is a browser script (no exports), we use eval or read its content.

async function runTest() {
    const aiServiceCode = fs.readFileSync(path.join(__dirname, 'ai_service.js'), 'utf8');

    // Inject mocks and run
    const context = {
        console,
        chrome: global.chrome,
        fetch: async (url, options = {}) => {
            if (!url.startsWith('http')) {
                return {
                    text: async () => fs.readFileSync(url, 'utf8'),
                    ok: true
                };
            }
            // Real fetch for Ollama/Gemini
            const nodeFetch = require('node-fetch');
            return nodeFetch(url, options);
        },
        FileReader: class {
            readAsDataURL(blob) {
                this.result = 'data:application/pdf;base64,' + blob.arrayBuffer().toString('base64');
                this.onloadend();
            }
        }
    };

    // Note: To use node-fetch, user needs to install it or we use dynamic import
    console.log("🚀 Running Extension Logic directly via Node...");
}
