// Function to extract text content from the page
function extractPageContent() {
  // Focus on common job description selectors if they exist, otherwise fallback to main content
  const selectors = [
    '#job-description',
    '.job-description',
    '.job-description--wrapper',
    '#jobDescriptionText',
    'main',
    'article',
    '.show-more-less-html__snippet'
  ];

  let content = "";
  
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      content = element.innerText;
      break;
    }
  }

  // Fallback to body text if no specific container found
  if (content.length < 200) {
    content = document.body.innerText;
  }

  // Basic cleanup: remove extra whitespace and cap at 15K chars (~3,750 tokens)
  // Covers virtually all job postings; further truncation happens per-provider in ai_service.js
  return content.replace(/\s+/g, ' ').trim().slice(0, 15000);
}

// Send the content back when requested
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "extractJobContent") {
    const text = extractPageContent();
    sendResponse({ text: text });
  }
});
