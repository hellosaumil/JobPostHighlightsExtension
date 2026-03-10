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

## ⚡ Performance Tips

| Setting       | Value  | Why                                                            |
| ------------- | ------ | -------------------------------------------------------------- |
| `num_ctx`     | `4096` | Controls context window; larger = more tokens = slower         |
| `temperature` | `0.1`  | Low temp = deterministic, structured JSON output               |
| `num_predict` | `800`  | Limits output tokens for Stage 2; Stage 1 uses `400`           |
| `keep_alive`  | `5m`   | Keeps model in memory between requests for faster repeat calls |

These are already tuned in `ai_service.js` — no manual configuration needed.

### Recommended Models by Use Case

| Model         | Size    | Best For                    |
| ------------- | ------- | --------------------------- |
| `gemma3:4b`   | ~2.5 GB | Balanced quality and speed  |
| `cogito:3b`   | ~2 GB   | Lightweight, good reasoning |
| `qwen2.5:3b`  | ~2 GB   | Fast JSON output            |
| `llama3.2:3b` | ~2 GB   | General purpose             |

> [!NOTE]
> Larger models (7B+) significantly increase response time. For job post analysis, 3–4B models offer the best trade-off.
