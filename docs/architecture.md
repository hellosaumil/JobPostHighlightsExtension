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

Stage 1 condenses raw job page text into a concise structured format that feeds into Stage 2. This reduces token usage and focuses Stage 2 on relevant signals.

### Extraction Prompt (`STAGE1_SYSTEM_PROMPT`)

Extracts these labeled fields in plain text:

```
TITLE: [exact job title]
SALARY: [compensation range or "Not specified"]
TEAM: [department/team]
LOCATION: [location and remote policy]
EXPERIENCE: [required years]
ROLE FOCUS: [Backend | Frontend | Full-Stack | Mobile | ...]
PRIMARY LANGUAGES: [required languages in order of emphasis]
REQUIRED SKILLS: [comma-separated explicit requirements]
PREFERRED SKILLS: [comma-separated nice-to-haves]
```

### Fallback Chain

| Priority | Method | Trigger |
|----------|--------|---------|
| 1 | **On-Device** (Gemini Nano via `ai.languageModel`) | Always attempted first |
| 2 | **Regex Cleaner** (`cleanJobText()`) | On-device unavailable or output < 100 chars |

> The provider fallback (Gemini Cloud / Ollama) for Stage 1 is disabled by default (`ENABLE_STAGE1_PROVIDER_FALLBACK = false` in `preParseJobText()`). This prevents burning Cloud/Ollama tokens on pre-processing.

---

## Stage 2: Relevance Analysis

**File:** `ai_service.js` → `summarizeJob()`, `summarizeWithOnDevice()`, `summarizeWithGemini()`, `summarizeWithOllama()`

Stage 2 applies the full scoring rubric from `prompt.md` against the Stage 1 output.

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
| `ai_service.js` | All AI logic: Stage 1 & 2 pipeline, provider routing, prompt building, response parsing |
| `prompt.md` | Stage 2 rubric template — injected with `{{pageText}}` and `{{resumeSource}}` at runtime |
| `content.js` | Content script — extracts DOM text from the active job tab |
| `background.js` | Service worker — manages side panel, pop-out window, and Ollama CORS bypass rules |
| `js_bridge.js` | Bridge for accessing `window.ai` / `LanguageModel` from the extension context |
| `sidepanel.js` | Side panel UI controller — settings, evaluation flow, result rendering |
| `popup.js` | Popup UI controller (same flow as sidepanel) |
| `window.js` | Pop-out window controller — adds tab selector for cross-tab analysis |

---

## Context Window Management

| Stage | Provider | Input Limit | Output Limit |
|-------|----------|-------------|--------------|
| Stage 1 | On-Device | `smartTruncate(pageText, 6000)` | ~300–800 chars |
| Stage 2 | On-Device | `smartTruncate(pageText, 10000)` | Full JSON |
| Stage 2 | Gemini Cloud | `smartTruncate(pageText, 10000)` | Full JSON |
| Stage 2 | Ollama | `smartTruncate(pageText, 4000)` | `num_predict: 800` |

`smartTruncate()` cuts at the last newline boundary before the limit — never mid-sentence.
