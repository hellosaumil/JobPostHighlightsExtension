import urllib.request
import urllib.parse
import json
import re
import sys
import os
import base64
import subprocess
import tempfile

def clean_html(html):
    text = re.sub(r'<script.*?>.*?</script>', '', html, flags=re.DOTALL)
    text = re.sub(r'<style.*?>.*?</style>', '', text, flags=re.DOTALL)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def get_resume_b64(file_path='resume.pdf'):
    if os.path.exists(file_path):
        with open(file_path, 'rb') as f:
            return base64.b64encode(f.read()).decode('utf-8')
    return None

def run_js(command, *args):
    """Calls the Node.js bridge to use extension logic."""
    try:
        process = subprocess.Popen(
            ['node', 'js_bridge.js', command, *args],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        stdout, stderr = process.communicate()
        if stderr and "warning" not in stderr.lower():
             print(f"⚠️ JS Bridge Error: {stderr}")
        return stdout
    except Exception as e:
        print(f"❌ Failed to run JS bridge: {e}")
        return None

def print_result(result_json):
    print("\n" + "="*80)
    print("🚀 AI ANALYSIS RESULT:")
    print("="*80)
    print(json.dumps(result_json, indent=2))
    print("="*80)

def test_gemini(prompt, resume_b64, api_key):
    print("✨ Calling Gemini API...")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key={api_key}"
    
    parts = [{"text": prompt}]
    if resume_b64:
        parts.insert(0, {
            "inline_data": {
                "mime_type": "application/pdf",
                "data": resume_b64
            }
        })

    payload = {"contents": [{"parts": parts}]}
    
    try:
        req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=120) as response:
            data = json.loads(response.read().decode('utf-8'))
            raw_text = data['candidates'][0]['content']['parts'][0]['text']
            print("🧹 Cleanup via JS Bridge...")
            parsed_result = run_js('parse', raw_text)
            if parsed_result:
                print_result(json.loads(parsed_result))
    except Exception as e:
        print(f"❌ Gemini Call failed: {e}")

def test_analysis(page_text, model="llama3", ollama_url="http://localhost:11434", provider="ollama", api_key=None):
    resume_b64 = get_resume_b64()
    # For Ollama, we can't send PDF - use the same summary the extension uses as fallback
    resume_source = "Saumil Shah (Senior Backend Engineer, 5 years exp, Python/FastAPI/Distributed Systems/Postgres/Redis/Kubernetes expertise)."
    
    with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as tf:
        tf.write(page_text)
        temp_path = tf.name

    print("🚜 Building prompt via Extension JS...")
    full_prompt = run_js('prompt', resume_source, temp_path)
    
    try: os.unlink(temp_path)
    except: pass

    if not full_prompt:
        print("❌ Prompt construction failed.")
        return

    if provider == "gemini":
        return test_gemini(full_prompt, resume_b64, api_key)

    print(f"🧠 Calling AI Provider ({model}) at {ollama_url}...")
    api_endpoint = f"{ollama_url.rstrip('/')}/api/generate"
    
    payload = {
        "model": model,
        "prompt": full_prompt,
        "stream": False,
        "format": "json",
        "options": {
            "num_predict": 2048,
            "temperature": 0.1,
            "num_ctx": 8192
        }
    }

    try:
        req = urllib.request.Request(api_endpoint, data=json.dumps(payload).encode('utf-8'), headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=120) as response:
            res = json.loads(response.read().decode('utf-8'))
            print("🧹 Parsing results via Extension JS...")
            
            # Reasoning models like qwen3:30b might put the output in 'thinking' instead of 'response'
            # if 'format': 'json' is used.
            full_response = (res.get('response') or '') + (res.get('thinking') or '')
            
            if not full_response.strip():
                print(f"❌ Received empty response from model.")
                print(f"DEBUG: Full API response: {res}")
                return

            parsed_result = run_js('parse', full_response)
            if parsed_result:
                print_result(json.loads(parsed_result))
            else:
                print(f"❌ Failed to parse result via JS.")
                print(f"DEBUG: Raw response from model:\n{full_response}")
    except Exception as e:
        print(f"❌ AI PROVIDER ERROR: {e}")
        if "404" in str(e):
            print(f"💡 Hint: The model '{model}' might not exist on the server.")
            print("Checking available models...")
            try:
                tags_url = f"{ollama_url.rstrip('/')}/api/tags"
                with urllib.request.urlopen(tags_url, timeout=5) as tag_res:
                    tags = json.loads(tag_res.read().decode('utf-8'))
                    names = [m['name'] for m in tags.get('models', [])]
                    print(f"Available models: {', '.join(names)}")
            except: pass

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python3 test_prompt.py <URL/file.txt>")
        print("  python3 test_prompt.py <model> <URL/file.txt>")
        print("  python3 test_prompt.py <model> <ollama_url> <URL/file.txt>")
        print("  python3 test_prompt.py gemini <api_key> <URL/file.txt>")
        sys.exit(1)
    
    input_source = sys.argv[-1]
    model_name = "llama3"
    api_url = "http://localhost:11434"
    provider = "ollama"
    api_key = None

    if len(sys.argv) == 3:
        model_name = sys.argv[1]
    elif len(sys.argv) >= 4:
        model_name = sys.argv[1]
        api_url = sys.argv[2]

    if model_name.lower() == "gemini":
        provider = "gemini"
        api_key = api_url
        api_url = None

    content = None
    if os.path.exists(input_source) and not input_source.startswith("http"):
        print(f"📄 Reading from local file: {input_source}...")
        try:
            with open(input_source, 'r', encoding='utf-8') as f:
                content = f.read()
        except Exception as e:
            print(f"❌ Failed to read file: {e}")
    else:
        print(f"🔍 Fetching URL: {input_source}...")
        import time
        time.sleep(2)
        try:
            from curl_cffi import requests as cffi_requests
            resp = cffi_requests.get(input_source, impersonate="chrome", timeout=15)
            if resp.status_code == 200 and len(resp.text) > 500:
                content = clean_html(resp.text)
            else:
                print(f"⚠️  curl_cffi returned {resp.status_code} (len={len(resp.text)})")
        except ImportError:
            print("⚠️  curl_cffi not installed. Falling back to urllib...")
        except Exception as cffi_err:
            print(f"⚠️  curl_cffi failed ({cffi_err})")

        # Fallback to urllib if curl_cffi didn't work
        if not content or len(content) < 500:
            try:
                headers = {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                }
                req = urllib.request.Request(input_source, headers=headers)
                with urllib.request.urlopen(req, timeout=15) as response:
                    content = clean_html(response.read().decode('utf-8'))
            except Exception as urllib_err:
                print(f"⚠️  urllib also failed ({urllib_err})")

    if content and len(content) > 500:
        test_analysis(content, model_name, api_url, provider, api_key)
    else:
        print("❌ DATA EXTRACTION FAILED: Could not get job text.")
        print("💡 Hint: OpenAI blocks scrapers. Copy the JD text to a file (job.txt).")
        print(f"👉 Run: python3 test_prompt.py {model_name} {api_url or 'http://localhost:11435'} job.txt")
