import json
import subprocess
import concurrent.futures
import sys
import os
import re

def run_test(url, model, poll_url, gemini_api_key=None):
    if model.lower().startswith("gemini"):
        # For Gemini, poll_url might be used as the API key in old scripts, 
        # but here we prefer the explicit gemini_api_key or env var
        api_key = gemini_api_key or os.environ.get("GEMINI_API_KEY")
        cmd = [sys.executable, 'test_prompt.py', model, api_key or 'missing', url]
    else:
        cmd = [sys.executable, 'test_prompt.py', model, poll_url, url]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        output = result.stdout
        stderr = result.stderr
        
        # Look for the JSON block specifically after result marker
        marker = "🚀 AI ANALYSIS RESULT:"
        json_str = None
        
        target_text = output
        if marker in output:
            target_text = output.split(marker)[1]
            
        # Find the balanced JSON block - look for the first { and last }
        # This is more robust against <think> blocks or trailing text
        start_idx = target_text.find('{')
        end_idx = target_text.rfind('}')
        if start_idx != -1 and end_idx != -1:
            json_str = target_text[start_idx:end_idx + 1]

        if json_str:
            try:
                # Clean up potential markdown code blocks if any
                clean_json = re.sub(r'^```json\s*|\s*```$', '', json_str.strip())
                # Sometimes there's multiple JSONs or garbage, find the largest { } block
                result_json = json.loads(clean_json)
                
                # Check for both snake_case and camelCase keys
                score = result_json.get('relevanceScore')
                if score is None:
                    score = result_json.get('relevance_score')
                
                if score is not None:
                    return {
                        'url': url,
                        'score': float(score),
                        'model': model,
                        'title': result_json.get('title') or result_json.get('job_title', 'Unknown'),
                        'success': True,
                        'raw': result_json
                    }
                else:
                    error_msg = f"Score missing. Keys: {list(result_json.keys())}"
            except (json.JSONDecodeError, ValueError) as e:
                error_msg = f"JSON parse error: {str(e)}"
        else:
            error_msg = "No JSON found ({...})"
        
        # Detailed error reporting if we didn't return already
        if "DATA EXTRACTION FAILED" in output or "Scraper blocked" in output:
            error_msg = "Scraper blocked"
        elif "AI PROVIDER ERROR" in output or "AI API call failed" in output:
            error_msg = "AI error"
            
        return {
            'url': url, 
            'success': False, 
            'error': error_msg, 
            'output_preview': output[:500] + "..." + output[-500:] if len(output) > 1000 else output,
            'stderr_preview': stderr[:500] if stderr else "No stderr"
        }
            
    except subprocess.TimeoutExpired:
        return {'url': url, 'success': False, 'error': "Timeout expired"}
    except Exception as e:
        return {'url': url, 'success': False, 'error': str(e)}

def process_list(path, model, poll_url, max_workers, gemini_api_key=None, threshold=0):
    if not os.path.exists(path):
        print(f"⚠️  Warning: {path} not found.")
        return

    with open(path, 'r') as f:
        jobs = json.load(f)
    
    # Remove duplicates by URL
    seen_urls = set()
    unique_jobs = []
    for job in jobs:
        if job['url'] not in seen_urls:
            seen_urls.add(job['url'])
            unique_jobs.append(job)
    
    urls = [job['url'] for job in unique_jobs]
    
    print(f"\n Processing: {path} ({len(urls)} unique URLs)")
    print(f"⚙️  Parallelism: {max_workers} | Threshold: >= {threshold}")
    print("-" * 60)

    results = []
    passed_count = 0
    filtered_count = 0
    failed_count = 0

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_url = {executor.submit(run_test, url, model, poll_url, gemini_api_key): url for url in urls}

        for future in concurrent.futures.as_completed(future_to_url):
            url = future_to_url[future]
            try:
                data = future.result()
                if data['success']:
                    score = data['score']
                    if score >= threshold:
                        print(f"✅ KEEP [{score}/5]: {url}")
                        results.append(data)
                        passed_count += 1
                    else:
                        print(f"❌ SKIP [{score}/5]: {url}")
                        filtered_count += 1
                else:
                    print(f"⚠️  FAIL: {url} ({data['error']})")
                    failed_count += 1
            except Exception as exc:
                print(f"🔴 ERR: {url} -> {exc}")
                failed_count += 1

    print("-" * 60)
    print(f"📊 STATS for {os.path.basename(path)}:")
    print(f"   Matches (> {threshold}): {passed_count} | Filtered: {filtered_count} | Failed: {failed_count}")
    
    # Save to unique file in the same directory as input
    dir_name = os.path.dirname(path) or "test"
    base_name = os.path.splitext(os.path.basename(path))[0]
    output_file = os.path.join(dir_name, f"results_{base_name}.json")
    with open(output_file, 'w') as f:
        json.dump(results, f, indent=2)
    print(f"📝 Results saved to: {output_file}")

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Run parallel job analysis tests.")
    parser.add_argument("--model", default="gemma3:27b", help="Ollama model name (default: gemma3:27b)")
    parser.add_argument("--url", default="http://localhost:11435", help="Ollama API URL (default: http://localhost:11435)")
    parser.add_argument("--workers", type=int, default=2, help="Number of parallel workers (default: 2)")
    parser.add_argument("--threshold", type=float, default=0, help="Score threshold to keep matches (default: 0)")
    parser.add_argument("--gemini-api-key", help="Gemini API key (overrides GEMINI_API_KEY env var)")
    parser.add_argument("test_lists", nargs="*", default=["test/test_list1.json", "test/test_list2.json"], 
                        help="Paths to JSON test lists")
    
    args = parser.parse_args()
    
    model = args.model
    poll_url = args.url
    max_workers = args.workers
    test_lists = args.test_lists
    gemini_api_key = args.gemini_api_key or os.environ.get("GEMINI_API_KEY")
    
    print(f"🚀 Starting analysis for {len(test_lists)} list(s)...")
    print(f"🧠 Model: {model} | Endpoint: {poll_url} | Workers: {max_workers}")
    
    for test_list in test_lists:
        process_list(test_list, model, poll_url, max_workers, gemini_api_key, args.threshold)

    print("\n" + "="*60)
    print("🏁 ALL LISTS COMPLETED")
    print("="*60)

if __name__ == "__main__":
    main()
