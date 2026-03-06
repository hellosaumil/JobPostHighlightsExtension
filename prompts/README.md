# Prompts

This directory contains the prompts used by the Job Post Highlights extension's two-stage AI analysis pipeline.

## Files

- **`stage_1.md`** — Job posting data extraction prompt
  - Parses raw job posting text into structured fields (TITLE, SALARY, TEAM, LOCATION, EXPERIENCE, ROLE FOCUS, PRIMARY LANGUAGES, REQUIRED SKILLS, PREFERRED SKILLS)
  - Used by `extractWithOnDevice()`, `extractWithSummarizer()`, and `preParseWithProvider()` in ai_service.js
  - Output is a concise, plain-text summary that feeds into Stage 2

- **`stage_2.md`** — Resume vs JD gap analysis prompt
  - Evaluates job posting against candidate resume
  - Applies hard requirements (Python, Location, Over-Qualified, Wrong Focus)
  - Implements scoring rubric (0-5 scale) and skill gap analysis
  - Returns structured JSON output with relevance score and detailed summary
  - Loaded by `fetchPrompt()` in ai_service.js

## Pipeline

```
Raw Job Posting
        ↓
    STAGE 1: Job Data Extraction (stage_1.md)
        ↓
Structured Job Fields (TITLE, ROLE FOCUS, SKILLS, etc.)
        ↓
    STAGE 2: Resume vs JD Analysis (stage_2.md)
        ↓
Relevance JSON Output
```

## Token Limits

- **Stage 1 input**: 4,000-8,000 chars (~1,000-2,000 tokens) depending on provider
- **Stage 2 input**: 10,000 chars (~2,500 tokens) for Gemini, 4,000 for Ollama
- See `INPUT_LIMITS` in ai_service.js for exact values per provider

## Refinements

Both prompts are refined for:
- **Clarity**: Explicit rules and examples prevent ambiguity
- **Efficiency**: Minimal token usage, structured output format
- **Accuracy**: Hard requirements checked before leveling/scoring
- **Maintainability**: Separated into logical stages for easier updates
