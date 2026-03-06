# Hybrid Extraction (Option 3) - Test Case

## Problem
OpenAI job post is missing salary info in Stage 1 output, even though it may be listed on the page.

## Root Cause Analysis

### Current Flow (Summarizer API)
```
Job Post Text (5760 chars)
        ↓
Summarizer API (limited to 8000 chars, usually returns key-points)
        ↓
Regex parsing (fragile - depends on Summarizer's markdown format)
        ↓
Result: SALARY: Not specified ❌
```

### Why it's missing:
1. **Summarizer API design**: It's meant for summarization, not structured extraction
   - May not include salary in its key-points
   - Markdown format unpredictable

2. **Truncation**: If salary appears after 4000 chars, Nano stage wouldn't see it

3. **Parsing**: Even if Summarizer mentions salary, regex might not match it

## Proposed Solution: Hybrid (Option 3)

```
Job Post Text (full or truncated)
        ↓
┌─────────────────────────────────────────┐
│ PASS 1: Summarizer API (fast, rough)   │ ~1-2 sec
│ Result: Gets 70% of fields              │
└─────────────────────────────────────────┘
        ↓
Parse to JSON, identify gaps:
  - salary: empty ❌
  - team: empty ❌
  - keyResponsibilities: empty ❌
        ↓
┌─────────────────────────────────────────┐
│ PASS 2: Prompt API (targeted refinement)│ ~3-5 sec
│ "Extract ONLY: salary, team, keyResp..."│ (only if gaps exist)
│ Returns: JSON with strict schema        │
└─────────────────────────────────────────┘
        ↓
Merge results: Summarizer + Prompt API refinement
        ↓
Final Stage 1 Output: All fields populated ✅
```

## Implementation Steps

### Step 1: Create refinement function
```javascript
async function refineStage1WithPromptAPI(
    pageText,
    initialData,
    missingFields,
    signal
) {
    // Only call Prompt API if critical fields missing
    if (missingFields.length === 0) return initialData;

    const prompt = `Extract ONLY these missing fields and return as JSON:
Fields needed: ${missingFields.join(', ')}

Job Posting: ${smartTruncate(pageText, 3000)}

Return ONLY valid JSON with the requested fields.`;

    const schema = {
        type: "object",
        properties: missingFields.reduce((acc, field) => {
            acc[field] = { type: "string" };
            return acc;
        }, {})
    };

    const session = await aiAPI.create({...});
    const response = await session.prompt(prompt, {
        responseConstraint: schema,
        signal
    });

    return JSON.parse(response);
}
```

### Step 2: Update extractWithSummarizer
```javascript
async function extractWithSummarizer(pageText, signal) {
    // Get initial extraction
    const summaryText = await summarizer.summarize(truncated);
    const initialData = formatSummarizerToStage1JSON(summaryText);

    // Check for critical missing fields
    const CRITICAL_FIELDS = [
        'salary', 'team', 'keyResponsibilities', 'aboutRole'
    ];

    const missing = CRITICAL_FIELDS.filter(field =>
        !initialData[field] || initialData[field] === 'Not specified'
    );

    // If gaps exist, refine with Prompt API
    if (missing.length > 0) {
        const refined = await refineStage1WithPromptAPI(
            pageText,
            initialData,
            missing,
            signal
        );
        Object.assign(initialData, refined);
    }

    return formatStage1JSON(initialData);
}
```

## Test Results (Expected)

### Before Hybrid:
```
TITLE: Backend Software Engineer (Evals) ✓
SALARY: Not specified ❌
TEAM: The Support Automation team... ✓
LOCATION: San Francisco and Seattle ✓
EXPERIENCE: 4+ ✓
...
```

### After Hybrid:
```
TITLE: Backend Software Engineer (Evals) ✓
SALARY: $200,000 - $320,000 per year ✓✓
TEAM: The Support Automation team... ✓
LOCATION: San Francisco and Seattle ✓
EXPERIENCE: 4+ ✓
...
```

## Performance Impact

- **Without gaps**: Summarizer only → ~2 sec (same as now)
- **With gaps**: Summarizer + Prompt API → ~5-7 sec (adds 3-5 sec)
- **Average**: ~4-5 sec per job (acceptable)

## Trade-offs

| Aspect | Impact |
|--------|--------|
| Extraction Quality | **High** - Captures all fields |
| Speed | **Medium** - Adds Prompt API call only when needed |
| Cost | **Low** - Only pays for refinement passes |
| Complexity | **Medium** - More logic, but manageable |
| Reliability | **High** - JSON schema guarantees |

## Decision: Implement Hybrid?

✅ Recommended because:
- Solves the salary problem on real job posts
- Intelligent fallback (only refines when needed)
- Maintains speed for complete Summarizer results
- Uses proven JSON schema for refinement
