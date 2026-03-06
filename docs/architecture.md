# Architecture Guide

## Overview

Job Post Highlights uses a **2-stage AI pipeline** designed to minimize token usage and cost while maximizing scoring accuracy.

```
Raw Page Text (5,000–20,000 chars)
        │
        ▼
┌─────────────────────────────────────────────┐
│  STAGE 1: Pre-Extraction                    │
│  Goal: Reduce noisy page text → 300–800     │
│  char structured summary                    │
│                                             │
│  1. On-Device (Gemini Nano) ← always first  │
│  2. Regex Cleaner (cleanJobText) ← fallback │
└─────────────────────────────────────────────┘
        │ processedText (~300–800 chars)
        ▼
┌─────────────────────────────────────────────┐
│  STAGE 2: Relevance Analysis                │
│  Goal: Score job vs resume, output JSON     │
│                                             │
│  Route by provider:                         │
│  • On-Device → ai.languageModel / Gemini    │
│  • Gemini Cloud → Gemini API                │
│  • Ollama → Local model via /api/chat       │
└─────────────────────────────────────────────┘
        │
        ▼
   Output JSON → UI Render
```

---

## Stage 1: Pre-Extraction

**File:** `ai_service.js` → `preParseJobText()`, `extractWithOnDevice()`
**Prompt:** `prompts/stage_1.md` (loaded at runtime, cached in memory)

Stage 1 condenses raw job page text into a concise structured format that feeds into Stage 2. This reduces token usage and focuses Stage 2 on relevant signals.

### Extracted Fields

```
TITLE | SALARY | TEAM | LOCATION | EXPERIENCE | ROLE FOCUS
PRIMARY LANGUAGES | REQUIRED SKILLS | PREFERRED SKILLS
KEY RESPONSIBILITIES | ABOUT ROLE
```

### Fallback Chain

| Priority | Method | Trigger |
|----------|--------|---------|
| 1 | **On-Device** (Gemini Nano via `ai.languageModel`) | Always attempted first |
| 2 | **Selected Provider** (Gemini Cloud / Ollama) | On-device unavailable |
| 3 | **Regex Cleaner** (`cleanJobText()`) | All models fail |

### Hybrid Refinement

After initial extraction, missing critical fields (`salary`, `team`, `keyResponsibilities`, `aboutRole`) trigger a second targeted pass:

```
detectMissingFields(stage1Text)
    → if gaps: refineStage1WithPromptAPI(fullPageText, missingFields)
        → uses full page text (10,000 chars) instead of truncated (4,000 chars)
        → JSON schema constrains output to only the missing fields
    → mergeRefinedFields(stage1Text, refinedData)
```

This solves salary extraction failures where compensation appears late in the page (e.g., past the 4,000-char truncation point).

### On-Device Session Management

The Gemini Nano session is **pre-warmed at startup** to eliminate the ~25s initialization cost from each evaluation:

```
Extension loads → initializePrompts() → initOnDeviceModel()
    → creates _onDeviceSession (persistent base session)
    → temperature: 0.1, topK: 1 (greedy decoding — fast, deterministic)

Each evaluation → _onDeviceSession.clone()
    → fresh context (no chat history), reuses initialized model
    → destroy() after extraction
```

---

## Stage 2: Relevance Analysis

**File:** `ai_service.js` → `summarizeJob()`, `summarizeWithOnDevice()`, `summarizeWithGemini()`, `summarizeWithOllama()`
**Prompt:** `prompts/stage_2.md` (loaded at runtime, cached in memory)

Stage 2 applies the full scoring rubric against the Stage 1 output.

### Scoring Rubric (0–5)

| Score Range | Category | Criteria |
|-------------|----------|----------|
| 4.5–5.0 | **Full Match** | Strong alignment, Senior/Mid-Senior title, all hard requirements met |
| 2.0–4.0 | **Semi Match** | Staff+ title (cap 4.0), missing preferred skills (cap 3.5), vague JD (cap 3.5) |
| 0 | **No Match** | Any hard requirement fails |

### Hard Requirements (Score 0 if any apply)

- **Missing Python** — Python is not a primary required language
- **Location** — Role is outside the US or not Remote
- **Over-Qualified** — Required experience exceeds 7 years
- **Wrong Focus** — Frontend, Mobile, Embedded, Hardware, Firmware, RF, Kernel/Driver roles

---

## Output JSON Schema

```json
{
  "title": "string",
  "salary": "string",
  "team": "string",
  "expReq": "string",
  "relevanceScore": 0.0,
  "summary": {
    "primaryStatus": {
      "match": "NO-MATCH | SEMI-MATCH | FULL-MATCH",
      "reason": "string (max 15 words)"
    },
    "levelingNote": "string | NULL",
    "fullMatches": ["Category (Tech in JD & Resume)"],
    "partialMissing": ["Gap (Tech in JD, not in Resume)"],
    "uniqueInsight": "string (max 15 words)"
  }
}
```

---

## File Responsibilities

| File | Responsibility |
|------|---------------|
| `ai_service.js` | All AI logic: Stage 1 & 2 pipeline, session management, hybrid refinement, provider routing |
| `prompts/stage_1.md` | Stage 1 extraction prompt — field definitions, rules, examples |
| `prompts/stage_2.md` | Stage 2 scoring rubric — injected with `{{pageText}}` and `{{resumeSource}}` at runtime |
| `content.js` | Content script — extracts DOM text from the active job tab |
| `background.js` | Service worker — manages side panel, pop-out window, and Ollama CORS bypass rules |
| `js_bridge.js` | Bridge for accessing `window.ai` / `LanguageModel` from the extension context |
| `sidepanel.js` | Side panel UI controller — model init on load, evaluation flow, result rendering |
| `window.js` | Pop-out window controller — adds tab selector for cross-tab analysis |

---

## Context Window Management

| Stage | Provider | Input Limit | Notes |
|-------|----------|-------------|-------|
| Stage 1 | On-Device (Gemini Nano) | 4,000 chars | `STAGE1_NANO` |
| Stage 1 | Gemini Cloud / Ollama | 6,000 chars | `STAGE1_CLOUD` |
| Stage 1 | Hybrid refinement pass | 10,000 chars | Full page text for missing fields |
| Stage 2 | On-Device | 6,000 chars | `STAGE2_ON_DEVICE` |
| Stage 2 | Gemini Cloud | 10,000 chars | `STAGE2_DEFAULT` |
| Stage 2 | Ollama | 4,000 chars | `STAGE2_OLLAMA`, `num_predict: 400` |

`smartTruncate()` cuts at the last newline boundary before the limit — never mid-sentence.
