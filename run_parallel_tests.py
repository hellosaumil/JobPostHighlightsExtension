import json
import subprocess
import concurrent.futures
import sys
import os
import re

def run_test(url, model, poll_url):
    cmd = [sys.executable, 'test_prompt.py', model, poll_url, url]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        output = result.stdout
        stderr = result.stderr
        
        # Look for the JSON block specifically after result marker
        marker = "🚀 AI ANALYSIS RESULT:"
        json_str = None
        if marker in output:
            json_part = output.split(marker)[1]
            start = json_part.find('{')
            end = json_part.rfind('}') + 1
            if start != -1 and end != -1:
                json_str = json_part[start:end]
        
        # Fallback: look for ANY JSON-like block in the whole output if marker failed
        if not json_str:
            start = output.find('{')
            end = output.rfind('}') + 1
            if start != -1 and end != -1:
                json_str = output[start:end]

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

def process_list(path, model, poll_url, max_workers):
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
    
    print(f"\n� Processing: {path} ({len(urls)} unique URLs)")
    print(f"⚙️  Parallelism: {max_workers} | Threshold: > 3.5")
    print("-" * 60)

    results = []
    passed_count = 0
    filtered_count = 0
    failed_count = 0

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_url = {executor.submit(run_test, url, model, poll_url): url for url in urls}
        
        for future in concurrent.futures.as_completed(future_to_url):
            url = future_to_url[future]
            try:
                data = future.result()
                if data['success']:
                    score = data['score']
                    if score > 3.5:
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
    print(f"   Matches (> 3.5): {passed_count} | Filtered: {filtered_count} | Failed: {failed_count}")
    
    # Save to unique file
    base_name = os.path.splitext(os.path.basename(path))[0]
    output_file = f"test/results_{base_name}.json"
    with open(output_file, 'w') as f:
        json.dump(results, f, indent=2)
    print(f"📝 Results saved to: {output_file}")

def main():
    # Configuration
    model = "ministral-3:8b"
    poll_url = "http://localhost:11435"
    
    # Get test lists from args or default to both 1 and 2
    if len(sys.argv) > 1:
        test_lists = sys.argv[1:]
    else:
        test_lists = ["test/test_list1.json", "test/test_list2.json"]
    
    max_workers = 2 
    
    print(f"🚀 Starting analysis for {len(test_lists)} list(s)...")
    print(f"🧠 Model: {model} | Endpoint: {poll_url}")
    
    for test_list in test_lists:
        process_list(test_list, model, poll_url, max_workers)

    print("\n" + "="*60)
    print("🏁 ALL LISTS COMPLETED")
    print("="*60)

if __name__ == "__main__":
    main()
