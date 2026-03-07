# Setup Guide

## 📦 Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/hellosaumil/JobPostHighlightsExtension.git
   ```
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top right)
4. Click **Load unpacked** and select the extension folder
5. Pin the extension to the toolbar for quick access

---

## ⚙️ Provider Configuration

Open the extension → click the **Settings** (⚙️) icon → choose your AI provider.

### On-Device (Gemini Nano)

> [!TIP]
> Free, private, and fast — no API key needed. Recommended for Stage 1 pre-extraction.

**Requirements:**
- Chrome 127+ (Dev/Canary channel recommended)
- ~1.5 GB free disk space for the model download

**Setup:**
1. Navigate to `chrome://flags`
2. Enable `#prompt-api-for-gemini-nano` → Set to **Enabled**
3. Enable `#optimization-guide-on-device-model` → Set to **Enabled BypassPerfRequirement**
4. Restart Chrome
5. Check `chrome://components` → Look for **Optimization Guide On Device Model**
   - If version shows `0.0.0.0`, click **Check for update**
   - Wait for the model to download (~1.5 GB)

> [!NOTE]
> If you see "not enough space" errors, the model needs ~1.5 GB of free disk space. Free up space or switch to a different provider.

**Troubleshooting:**
- [Prompt API documentation](https://developer.chrome.com/docs/ai/prompt-api) — Official API reference and availability checks
- [Informing users of model download](https://developer.chrome.com/docs/ai/inform-users-of-model-download) — Handling download progress and availability states
- [Built-in model download sample](https://googlechrome.github.io/samples/downloading-built-in-models/index.html) — Live demo to test if your browser supports on-device AI

### Gemini Cloud API

1. Get a free API key from [Google AI Studio](https://aistudio.google.com/apikey)
2. In Settings, select **Google Gemini (Cloud)** as the provider
3. Choose your model:
   - **Gemini 3.1 Pro Preview** — Best quality
   - **Gemini 3.1 Flash-Lite Preview** — Faster, lower cost
4. Paste your API key → Click **Save Settings**

> [!IMPORTANT]
> Your API key is stored locally in `chrome.storage.local` and never leaves your browser.

### Ollama (Local)

1. Install Ollama from [ollama.com](https://ollama.com)
2. Pull a model:
   ```bash
   ollama pull gemma3:4b    # Recommended for quality/speed balance
   ```
3. In Settings, select **Ollama (Local)** as the provider
4. Set the server URL (default: `http://localhost:11434`)
5. Click the **refresh** button to load available models
6. Select your model → Click **Save Settings**

> See [Ollama Guide](ollama.md) for CORS troubleshooting and performance tips.

---

## 📄 Resume Configuration

The candidate resume is embedded as a text summary inside `prompts/stage_2.md` (substituted into the `{{resumeSource}}` placeholder at runtime by `fetchPrompt()` in `ai_service.js`).

To customize for your own resume, edit the hardcoded summary string in `ai_service.js` inside `fetchPrompt()`:

```js
// In ai_service.js → fetchPrompt()
const resumeSummary = "Your Name (Role, X years exp, Key Skills).";
```

> **Note:** An optional `resume.pdf` path exists in the codebase for future Gemini Cloud file-upload support, but is not currently used.

---

## ⌨️ Keyboard Shortcut

| Platform | Shortcut | Action |
|----------|----------|--------|
| Mac | `Cmd+J` | Open side panel |
| Windows/Linux | `Ctrl+J` | Open side panel |

Customize in `chrome://extensions/shortcuts`.
