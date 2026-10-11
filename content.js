// content.js - Injected into all pages to extract job posting content.
// Messaged by the extension (shared.js extractTabContent) or falls back via scripting API.

function extractPageContent() {
    // Priority-ordered selectors — covers LinkedIn, Indeed, Greenhouse, Lever, Workday, etc.
    const selectors = [
        '#job-description',
        '.job-description',
        '.job-description--wrapper',
        '#jobDescriptionText',            // Indeed
        '.show-more-less-html__snippet',  // LinkedIn (expanded)
        '#content',                       // Greenhouse
        '.posting-page',                  // Lever
        '[data-automation="jobAdDetails"]',// Seek
        '.jobsearch-JobComponent',        // Indeed (alternate)
        'main',
        'article',
    ];

    let content = '';
    for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el && el.innerText.length > 200) {
            content = el.innerText;
            break;
        }
    }

    // Fallback to full body if no targeted section found
    if (content.length < 200) {
        content = document.body.innerText;
    }

    // Normalise whitespace and cap at 15K chars (~3,750 tokens).
    // Further per-provider truncation happens in ai_service.js.
    return content.replace(/\s+/g, ' ').trim().slice(0, 15000);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractJobContent') {
        sendResponse({ text: extractPageContent() });
    }
});
