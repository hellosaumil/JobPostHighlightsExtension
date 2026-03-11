const fs = require('fs');
const path = require('path');

/**
 * This bridge allows Python to call extension JS functions without duplicating logic.
 */

const aiServiceCode = fs.readFileSync(path.join(__dirname, 'ai_service.js'), 'utf8');

// Simple environment to expose the functions
const env = { 
    console: { log: () => { }, error: () => { }, warn: () => { } },
    window: { ai: { languageModel: null } },
    document: { },
    fetch: () => Promise.resolve({ ok: true, text: () => Promise.resolve('') })
};

(function () {
    // Setting chrome.runtime to null prevents initializePrompts() from firing in ai_service.js
    const chrome = { runtime: null };
    const window = env.window;
    const document = env.document;
    const fetch = env.fetch;
    const console = env.console;
    const LanguageModel = null;
    
    try {
        eval(aiServiceCode);
        env.parseAIResponse = parseAIResponse;
        env.fetchPrompt = fetchPrompt;
    } catch (e) {
        // Suppress init errors that don't affect parse/prompt functions
    }
})();

const command = process.argv[2];
const args = process.argv.slice(3);

if (command === 'parse') {
    const result = env.parseAIResponse(args[0]);
    console.log(JSON.stringify(result));
} else if (command === 'prompt') {
    const template = fs.readFileSync(path.join(__dirname, 'prompts', 'stage_2.md'), 'utf8');
    const resumeSource = args[0];
    const pageTextPath = args[1];

    // Read the actual text from the file passed by Python
    const pageText = fs.readFileSync(pageTextPath, 'utf8');

    const prompt = template
        .replace('{{resumeSource}}', resumeSource)
        .replace('{{pageText}}', pageText);

    process.stdout.write(prompt);
}
