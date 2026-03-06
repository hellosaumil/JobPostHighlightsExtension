/**
 * Test: Hybrid Extraction (Option 3)
 * Demonstrates how Summarizer + Prompt API refinement would work
 */

// Mock job posting text (with salary data for testing)
const TEST_JOB_POST = `
Backend Software Engineer (Evals)
Location: San Francisco and Seattle
Salary: $200,000 - $320,000 per year

About the role:
The Support Automation team at OpenAI scales the organization by applying cutting-edge AI models to real-world challenges.
We're looking for a Backend Software Engineer to design eval pipelines and build infrastructure.

Requirements:
- 4+ years of backend experience
- Python, FastAPI, Postgres expertise
- Experience with distributed systems and APIs
- Experience building AI agents or applications
- Understanding of LLM evaluation methods

Responsibilities:
- Design eval pipelines for AI model evaluation
- Build the infrastructure for continuous eval monitoring
- Design, build, and maintain backend services and APIs
- Integrate and structure data across platforms
- Own the full development lifecycle

Preferred:
- Experience scaling distributed systems
- Background in machine learning infrastructure
`;

// ============ STEP 1: Simulate Summarizer API output ============
const SUMMARIZER_OUTPUT = `
- Backend Software Engineer (Evals) role at OpenAI Support Automation team
- Location: San Francisco and Seattle
- Requires 4+ years backend experience
- Key skills: Python, FastAPI, Postgres, distributed systems, APIs, AI agents, LLM evaluation
- Main responsibilities: Design eval pipelines, build infrastructure, design backend services, integrate data
- Full development lifecycle ownership
- Scaling distributed systems experience preferred
`;

// ============ STEP 2: Parse Summarizer output ============
function parseMarkdownToJSON(markdown) {
    const result = {};
    const lines = markdown.split('\n').filter(l => l.trim());

    for (const line of lines) {
        const match = line.match(/^[-*]\s*(.+?):\s*(.+)$|^[-*]\s*(.+)$/);
        if (match) {
            const [, key, value, onlyText] = match;
            if (key && value) {
                result[key.toLowerCase().replace(/\s+/g, '')] = value.trim();
            }
        }
    }

    return result;
}

const PARSED_FROM_SUMMARIZER = parseMarkdownToJSON(SUMMARIZER_OUTPUT);
console.log('=== STEP 1: Summarizer API Parsed ===');
console.log(PARSED_FROM_SUMMARIZER);
console.log('');

// ============ STEP 3: Check for missing critical fields ============
const CRITICAL_FIELDS = ['salary', 'team', 'keyresponsibilities', 'aboutrole'];
const missingFields = [];

for (const field of CRITICAL_FIELDS) {
    const value = PARSED_FROM_SUMMARIZER[field];
    if (!value || value === 'Not specified' || value === 'None specified') {
        missingFields.push(field);
    }
}

console.log('=== STEP 2: Check Missing Fields ===');
console.log('Missing or empty fields:', missingFields);
console.log('');

// ============ STEP 4: Prompt API refinement (mock) ============
function refineWithPromptAPI(jobText, fieldsToExtract) {
    // In real implementation, this would call Prompt API with JSON schema
    // For this test, we'll simulate extraction from the text

    const refined = {};

    // Salary extraction
    const salaryMatch = jobText.match(/salary[:\s]+\$?([\d,]+)\s*[-–]\s*\$?([\d,]+)/i);
    if (salaryMatch) {
        refined.salary = `$${salaryMatch[1]} - $${salaryMatch[2]} per year`;
    }

    // Team extraction
    const teamMatch = jobText.match(/(?:the\s+)?(\w+(?:\s+\w+)*?)\s+team/i);
    if (teamMatch) {
        refined.team = teamMatch[1];
    }

    // Responsibilities (extract bullet points)
    const respMatch = jobText.match(/Responsibilities:([\s\S]+?)(?=Preferred:|$)/i);
    if (respMatch) {
        const items = respMatch[1]
            .split('\n')
            .filter(l => l.match(/^[-*]/))
            .slice(0, 3)
            .map(l => l.replace(/^[-*]\s*/, '').trim())
            .join(', ');
        if (items) refined.keyresponsibilities = items;
    }

    return refined;
}

const REFINED_DATA = refineWithPromptAPI(TEST_JOB_POST, missingFields);
console.log('=== STEP 3: Prompt API Refinement ===');
console.log('Refined fields:', REFINED_DATA);
console.log('');

// ============ STEP 5: Merge results ============
const FINAL_RESULT = {
    ...PARSED_FROM_SUMMARIZER,
    ...REFINED_DATA
};

console.log('=== STEP 4: Final Merged Result ===');
console.log(FINAL_RESULT);
console.log('');

// ============ Format as Stage 1 output ============
function formatToStage1Output(json) {
    const labels = {
        title: 'TITLE',
        salary: 'SALARY',
        team: 'TEAM',
        location: 'LOCATION',
        experience: 'EXPERIENCE',
        rolefocus: 'ROLE FOCUS',
        primarylanguages: 'PRIMARY LANGUAGES',
        requiredskills: 'REQUIRED SKILLS',
        preferredskills: 'PREFERRED SKILLS',
        keyresponsibilities: 'KEY RESPONSIBILITIES',
        aboutrole: 'ABOUT ROLE'
    };

    let output = '';
    for (const [key, label] of Object.entries(labels)) {
        if (json[key]) {
            output += `${label}: ${json[key]}\n`;
        }
    }
    return output;
}

const FINAL_OUTPUT = formatToStage1Output(FINAL_RESULT);
console.log('=== STEP 5: Final Stage 1 Output ===');
console.log(FINAL_OUTPUT);
console.log('');

// ============ Summary ============
console.log('=== SUMMARY ===');
console.log(`✓ Summarizer initial extraction: ${Object.keys(PARSED_FROM_SUMMARIZER).length} fields`);
console.log(`✓ Missing critical fields: ${missingFields.length}`);
console.log(`✓ Prompt API refinement added: ${Object.keys(REFINED_DATA).length} fields`);
console.log(`✓ Final result: ${Object.keys(FINAL_RESULT).length} fields`);
console.log('');
console.log(`✓ Salary found: ${FINAL_RESULT.salary || 'Not found'}`);
