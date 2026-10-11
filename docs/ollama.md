# Ollama Guide

## 🛠️ Setup

1. Install Ollama from [ollama.com](https://ollama.com)
2. Pull a model (recommended options):
   ```bash
   ollama pull gemma3:4b       # Best quality/speed balance (~2.5 GB)
   ollama pull cogito:3b       # Lightweight, good for extraction
   ollama pull qwen2.5:3b      # Fast and efficient
   ```
3. Verify Ollama is running:
   ```bash
   ollama list                 # Shows downloaded models
   ollama serve                # Start server if not already running
   ```
4. In the extension **Settings** → select **Ollama (Local)** → click **Refresh** to load your models

---

## 🔒 CORS Troubleshooting

By default, browsers block Chrome extensions from talking to `localhost` services for security reasons. The extension includes a built-in CORS bypass via `declarativeNetRequest`, but if you encounter **403 Forbidden** errors, follow the steps below.

> [!TIP]
> Try the automatic fix first — the extension registers CORS rules on install. A fresh reload of the extension (`chrome://extensions/` → click the reload ↺ icon) often resolves the issue.

> [!NOTE]
> For general Ollama setup, refer to the [official Ollama FAQ](https://docs.ollama.com/faq).

### macOS

1. Quit the Ollama application
2. Open Terminal and run:
   ```bash
   launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"
   ```
3. Restart the Ollama application

### Windows

1. Quit Ollama from the taskbar
2. Search for **"Edit the system environment variables"** in the Start menu
3. Click **Environment Variables**
4. Under **User variables**, click **New**:
   - Variable Name: `OLLAMA_ORIGINS`
   - Variable Value: `chrome-extension://*`
5. Click OK and restart Ollama

### Linux

1. Edit the Ollama service:
   ```bash
   systemctl edit ollama.service
   ```
2. Add under the `[Service]` section:
   ```ini
   Environment="OLLAMA_ORIGINS=chrome-extension://*"
   ```
3. Save and restart:
   ```bash
   systemctl daemon-reload
   systemctl restart ollama
   ```

---

### Method 1: Automatic Bypass (Recommended)

The extension includes high-priority `declarativeNetRequest` rules that automatically inject the `ngrok-skip-browser-warning` header and bypass CORS for `*.ngrok-free.app` and `localhost`.

1. **Start ngrok** on your Ollama machine:
   ```bash
   ngrok http 11434 --host-header="localhost:11434"
   ```
2. **Copy the Forwarding URL** (e.g., `https://xxxx.ngrok-free.app`)
3. **In Settings** → Paste the URL into **Ollama URL** → click **Refresh Models**

---

### Method 2: Local Python Proxy (Guaranteed Fix)

If Method 1 still results in `403` or `CORS` errors due to strict browser security policies, you can use the revived `proxy.py` included in the root of the project. This runs a small local server that acts as a bridge, making requests outside of the browser's sandbox.

1. **Install Python** (if not already installed)
2. **Run the proxy** pointing to your ngrok URL:
   ```bash
   python proxy.py --remote https://xxxx.ngrok-free.app
   ```
3. **Update Extension Settings**:
   - **Ollama URL**: `http://localhost:11435`
   - Click **Refresh Models**

> [!TIP]
> This method is 100% reliable as it completely bypasses browser preflight issues and header restrictions by handling the "last mile" request in Python.

---

## ⚡ Architecture: "Make LLM Extract, Make Code Decide"

Small on-device models (1.5B–4B) often struggle with multi-step prompt reasoning and nested JSON syntax. The extension solves this with a two-phase architecture:
1. **Ollama Structured Outputs**: Strict JSON schemas (`FACTS_SCHEMA` and `SYNTHESIS_SCHEMA`) are passed in `format`. Decoding is constrained by Ollama's grammar engine, guaranteeing 100% valid JSON with zero hallucinations.
2. **Fact Extraction**: The model extracts objective facts (enums for seniority, location, role focus; lists for tech skills).
3. **Deterministic Scoring in Code**: JavaScript evaluates the rubric (hard disqualifiers, Staff+ caps, preferred skills penalties) and calculates skill overlap (`fullMatches`, `partialMissing`) via alias-mapped Set intersections.
4. **Micro-Synthesis**: A minimal follow-up call generates only 15-word narrative fields (`reason`, `uniqueInsight`).

### Tuned Performance Settings

| Setting       | Value    | Why                                                                             |
| ------------- | -------- | ------------------------------------------------------------------------------- |
| `num_ctx`     | `8192`   | Ample context window for full job descriptions on modern laptops                |
| `temperature` | `0.0`    | Greedy decoding ensures deterministic, fast output                              |
| `seed`        | `42`     | Ensures repeatable extraction results                                           |
| `think`       | `false`  | Suppresses reasoning tokens (`<think>`) for reasoning models (Qwen, DeepSeek-R1)|
| `num_predict` | `1024`   | Generous cap; schema-constrained decoding stops as soon as the JSON object ends |
| `keep_alive`  | `10m`    | Keeps model loaded in VRAM between requests for fast evaluations                |

These settings are managed automatically in `ai_service.js`.

### Recommended Models by Use Case

| Model              | Size    | Best For                                                              |
| ------------------ | ------- | --------------------------------------------------------------------- |
| `phi4-mini:3.8b`   | ~2.5 GB | **Recommended**: Exceptional accuracy on structured fact extraction  |
| `deepseek-r1:1.5b` | ~1.1 GB | Ultra-lightweight; runs fast on lower-spec machines                   |
| `qwen2.5:3b`       | ~2.0 GB | Excellent balance of speed and JSON fidelity                          |
| `gemma3:4b`        | ~2.5 GB | Strong general reasoning and multilingual extraction                  |
| `llama3.2:3b`      | ~2.0 GB | Solid general purpose model                                          |

> [!NOTE]
> Larger models (7B+) also work, but 1.5B–4B models provide near-instantaneous evaluations (< 10s) with identical rubric precision because the scoring decisions are made in JavaScript.
