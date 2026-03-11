import json
import os
import sys
import glob
import argparse
from datetime import datetime
from run_parallel_tests import process_list

def generate_html(result_files, output_dir=None, threshold=0):
    all_results = []
    for file_path in result_files:
        if os.path.exists(file_path):
            with open(file_path, 'r') as f:
                results = json.load(f)
                # Add source info
                for r in results:
                    r['_source'] = os.path.basename(file_path)
                all_results.extend(results)
    
    # Sort by score descending
    all_results.sort(key=lambda x: x.get('score', 0), reverse=True)

    # Detect if a single model was used for everything
    models_used = sorted(list(set(r.get('model', 'Unknown') for r in all_results)))
    model_header_html = f"<span>🧠 {', '.join(models_used)}</span>" if models_used else ""

    html_template = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Job Match Radar</title>
    <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
    <style>
        :root {{
            --bg: #080808;
            --card-bg: rgba(255, 255, 255, 0.03);
            --card-border: rgba(255, 255, 255, 0.08);
            --text-primary: #ffffff;
            --text-secondary: #a1a1aa;
            --accent: #3b82f6;
            --accent-glow: rgba(59, 130, 246, 0.5);
            --success: #10b981;
            --error: #ef4444;
            --font-main: 'Space Grotesk', sans-serif;
            --font-mono: 'JetBrains Mono', monospace;
            --header-gradient: linear-gradient(to right, #fff, #a1a1aa);
        }}

        [data-theme="light"] {{
            --bg: #f8f9fa;
            --card-bg: #ffffff;
            --card-border: #e9ecef;
            --text-primary: #1a1d23;
            --text-secondary: #6c757d;
            --accent: #2563eb;
            --accent-glow: rgba(37, 99, 235, 0.2);
            --header-gradient: linear-gradient(to right, #1a1d23, #4b5563);
        }}
        
        body {{
            background: var(--bg);
            color: var(--text-primary);
            font-family: var(--font-main);
            margin: 0;
            padding: 3rem 2rem;
            line-height: 1.6;
            min-height: 100vh;
        }}

        .container {{
            max-width: 1400px;
            margin: 0 auto;
        }}

        header {{
            margin-bottom: 4rem;
            padding-bottom: 2rem;
            border-bottom: 1px solid var(--card-border);
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 2rem;
            flex-wrap: wrap;
        }}

        .header-info {{
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
            flex: 1;
            min-width: 300px;
        }}

        .header-right {{
            display: flex;
            align-items: center;
            gap: 0.5rem;
            flex-shrink: 0;
        }}

        .stats {{
            display: flex;
            align-items: center;
            gap: 1.5rem;
            font-family: var(--font-mono);
            font-size: 0.75rem;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            flex-wrap: wrap;
        }}

        .stats span {{
            display: flex;
            align-items: center;
            gap: 0.4rem;
            white-space: nowrap;
        }}

        .header-title h1 {{
            font-size: 2.8rem;
            font-weight: 700;
            margin: 0;
            letter-spacing: -0.04em;
            background: var(--header-gradient);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            white-space: nowrap;
        }}

        /* Filter Controls */
        .controls {{
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            padding: 0 1rem;
            border-radius: 16px;
            display: flex;
            align-items: center;
            gap: 1rem;
            min-width: 260px;
            height: 46px;
            backdrop-filter: blur(12px);
            box-sizing: border-box;
        }}

        .filter-header {{
            display: flex;
            flex-direction: column;
            gap: 0.25rem;
        }}

        .filter-label {{
            font-family: var(--font-mono);
            font-size: 0.65rem;
            text-transform: uppercase;
            color: var(--text-secondary);
            white-space: nowrap;
            letter-spacing: 0.05em;
        }}

        #scoreRangeText {{
            font-family: var(--font-mono);
            font-weight: 700;
            color: var(--accent);
            font-size: 0.9rem;
            min-width: 5.8rem;
            line-height: 1.1;
        }}

        .slider-container {{
            flex: 1;
            position: relative;
            height: 20px;
            display: flex;
            align-items: center;
        }}

        .slider-track-wrap {{
            position: absolute;
            width: 100%;
            height: 4px;
            background: var(--card-border);
            border-radius: 2px;
            pointer-events: none;
        }}

        .slider-track-active {{
            position: absolute;
            height: 100%;
            background: var(--accent);
            border-radius: 2px;
            box-shadow: 0 0 12px var(--accent-glow);
        }}

        .dual-range-input {{
            position: absolute;
            width: 100%;
            pointer-events: none;
            -webkit-appearance: none;
            background: transparent;
            z-index: 2;
            margin: 0;
        }}

        .dual-range-input::-webkit-slider-thumb {{
            pointer-events: auto;
            -webkit-appearance: none;
            width: 18px;
            height: 18px;
            background: var(--text-primary);
            border-radius: 50%;
            cursor: pointer;
            border: 2px solid var(--accent);
            box-shadow: 0 0 10px var(--accent-glow);
            transition: transform 0.1s;
        }}

        .dual-range-input::-webkit-slider-thumb:hover {{
            transform: scale(1.2);
        }}

        .job-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
            gap: 2rem;
        }}

        .job-card {{
            background: var(--card-bg);
            border-radius: 20px;
            padding: 2rem;
            border: 1px solid var(--card-border);
            backdrop-filter: blur(12px);
            transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }}

        .job-card.hidden {{
            opacity: 0;
            transform: scale(0.9) translateY(20px);
            pointer-events: none;
        }}

        .job-card:not(.hidden):hover {{
            transform: translateY(-6px);
            border-color: var(--accent);
            background: rgba(255, 255, 255, 0.05);
            box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
        }}

        .score-badge {{
            position: absolute;
            top: 2rem;
            right: 2rem;
            font-family: var(--font-mono);
            font-size: 1.4rem;
            font-weight: 700;
            color: var(--text-primary);
            display: flex;
            flex-direction: column;
            align-items: flex-end;
        }}

        .score-label-inner {{
            font-size: 0.65rem;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.1em;
        }}

        .job-title {{
            font-size: 1.4rem;
            font-weight: 700;
            margin: 0 0 0.75rem 0;
            padding-right: 5rem;
            letter-spacing: -0.02em;
            line-height: 1.2;
        }}

        .job-meta {{
            display: flex;
            flex-wrap: wrap;
            gap: 1rem;
            margin-bottom: 1.5rem;
            font-family: var(--font-mono);
            font-size: 0.75rem;
        }}

        .meta-item {{
            color: var(--text-secondary);
            display: flex;
            align-items: center;
            gap: 0.4rem;
        }}

        .salary-tag {{
            background: rgba(16, 185, 129, 0.1);
            color: var(--success);
            padding: 0.4rem 0.8rem;
            border-radius: 8px;
            font-weight: 600;
            border: 1px solid rgba(16, 185, 129, 0.2);
        }}

        .reason-box {{
            background: rgba(59, 130, 246, 0.05);
            border-left: 4px solid var(--accent);
            padding: 1.25rem;
            border-radius: 0 12px 12px 0;
            font-size: 0.95rem;
            margin-bottom: 2rem;
            font-weight: 500;
        }}

        .details-grid {{
            display: grid;
            grid-template-columns: 1fr;
            gap: 1.5rem;
            margin-bottom: 2rem;
        }}

        .detail-group h4 {{
            font-family: var(--font-mono);
            font-size: 0.7rem;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            color: var(--text-secondary);
            margin: 0 0 0.75rem 0;
        }}

        .matches-list {{
            list-style: none;
            padding: 0;
            margin: 0;
            font-size: 0.9rem;
        }}

        .matches-list li {{
            margin-bottom: 0.6rem;
            display: flex;
            gap: 0.75rem;
            padding-left: 0.25rem;
        }}

        .matches-list li::before {{
            content: '→';
            color: var(--accent);
            font-weight: bold;
        }}

        .insight-footer {{
            margin-top: auto;
            border-top: 1px solid var(--card-border);
            padding-top: 1.5rem;
            display: flex;
            flex-direction: column;
            gap: 1rem;
        }}

        .insight-text {{
            font-size: 0.85rem;
            color: #60a5fa;
            font-style: italic;
            line-height: 1.4;
        }}

        .action-bar {{
            display: flex;
            justify-content: space-between;
            align-items: center;
        }}

        .apply-btn {{
            background: var(--text-primary);
            color: var(--bg);
            text-decoration: none;
            padding: 0.8rem 1.5rem;
            border-radius: 12px;
            font-weight: 700;
            font-size: 0.9rem;
            transition: all 0.2s;
            text-transform: uppercase;
            letter-spacing: 0.02em;
        }}

        .apply-btn:hover {{
            transform: scale(1.05);
            box-shadow: 0 0 20px rgba(255, 255, 255, 0.2);
        }}

        .source-label {{
            font-family: var(--font-mono);
            font-size: 0.6rem;
            color: var(--text-secondary);
            opacity: 0.5;
        }}
        
        .empty-state {{
            grid-column: 1 / -1;
            padding: 4rem;
            text-align: center;
            display: none;
        }}

        .open-all-btn {{
            background: rgba(255, 255, 255, 0.05);
            color: var(--text-primary);
            border: 1px solid var(--card-border);
            padding: 0 1.2rem;
            height: 46px;
            border-radius: 16px;
            font-family: var(--font-main);
            font-weight: 700;
            font-size: 0.85rem;
            cursor: pointer;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            display: inline-flex;
            align-items: center;
            gap: 0.6rem;
            backdrop-filter: blur(12px);
            white-space: nowrap;
            box-sizing: border-box;
        }}

        .open-all-btn:hover {{
            background: rgba(255, 255, 255, 0.1);
            border-color: var(--text-primary);
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(0, 0, 0, 0.5);
        }}

        .theme-toggle {{
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            color: var(--text-primary);
            width: 46px;
            height: 46px;
            border-radius: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.2s;
            backdrop-filter: blur(12px);
            box-sizing: border-box;
            flex-shrink: 0;
        }}

        .theme-toggle:hover {{
            background: rgba(255, 255, 255, 0.1);
            transform: translateY(-2px);
        }}

        [data-theme="light"] .theme-toggle:hover {{
            background: #f1f3f5;
        }}

        .theme-toggle svg {{
            width: 20px;
            height: 20px;
        }}

        .sun-icon {{ display: none; }}
        [data-theme="light"] .sun-icon {{ display: block; }}
        [data-theme="light"] .moon-icon {{ display: none; }}
    </style>
</head>
<body data-theme="dark">
    <div class="container">
        <header>
            <div class="header-info">
                <div class="header-title">
                    <h1>Job Match Radar</h1>
                </div>
                
                <div class="stats">
                    <span id="matchDisplay">⚡ {total_count} Matches</span>
                    <span>🕒 {date}</span>
                    {model_header_html}
                </div>
            </div>
            
            <div class="header-right">
                <div class="controls">
                    <div class="filter-header">
                        <span class="filter-label">Score Range</span>
                        <span id="scoreRangeText">{min_score} - 5.0</span>
                    </div>
                    <div class="slider-container">
                        <div class="slider-track-wrap">
                            <div id="sliderTrackActive" class="slider-track-active"></div>
                        </div>
                        <input type="range" id="minSlider" class="dual-range-input" min="0" max="5" step="0.1" value="{min_score}">
                        <input type="range" id="maxSlider" class="dual-range-input" min="0" max="5" step="0.1" value="5.0">
                    </div>
                </div>
                <button class="theme-toggle" id="themeToggle" title="Toggle Light/Dark Mode">
                    <svg class="moon-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                    </svg>
                    <svg class="sun-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="5" />
                        <line x1="12" y1="1" x2="12" y2="3" />
                        <line x1="12" y1="21" x2="12" y2="23" />
                        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                        <line x1="1" y1="12" x2="3" y2="12" />
                        <line x1="21" y1="12" x2="23" y2="12" />
                        <line x1="4.22" y1="19.07" x2="5.64" y2="17.66" />
                        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                    </svg>
                </button>
                <button class="open-all-btn" onclick="openAllFiltered()">
                    🚀 Open All
                </button>
            </div>
        </header>

        <div class="job-grid" id="jobGrid">
            {job_cards}
            <div class="empty-state" id="emptyState">
                <h3 style="color: var(--text-secondary)">No jobs match this score range.</h3>
            </div>
        </div>
    </div>

    <script>
        const minSlider = document.getElementById('minSlider');
        const maxSlider = document.getElementById('maxSlider');
        const scoreRangeText = document.getElementById('scoreRangeText');
        const trackActive = document.getElementById('sliderTrackActive');
        const cards = document.querySelectorAll('.job-card');
        const matchDisplay = document.getElementById('matchDisplay');
        const emptyState = document.getElementById('emptyState');
        const themeToggle = document.getElementById('themeToggle');

        // Theme Support
        const savedTheme = localStorage.getItem('matchRadarTheme') || 'dark';
        document.body.setAttribute('data-theme', savedTheme);

        themeToggle.addEventListener('click', () => {{
            const currentTheme = document.body.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            document.body.setAttribute('data-theme', newTheme);
            localStorage.setItem('matchRadarTheme', newTheme);
        }});

        function updateFilter() {{
            let minVal = parseFloat(minSlider.value);
            let maxVal = parseFloat(maxSlider.value);

            // Ensure they don't cross
            if (minVal > maxVal) {{
                // If min moved, push max
                if (this === minSlider) {{
                    maxSlider.value = minVal;
                    maxVal = minVal;
                }} else if (this === maxSlider) {{
                    minSlider.value = maxVal;
                    minVal = maxVal;
                }}
            }}

            scoreRangeText.textContent = `${{minVal.toFixed(1)}} - ${{maxVal.toFixed(1)}}`;
            
            // Update track
            const left = (minVal / 5) * 100;
            const right = 100 - (maxVal / 5) * 100;
            trackActive.style.left = left + '%';
            trackActive.style.right = right + '%';

            let visibleCount = 0;
            cards.forEach(card => {{
                const score = parseFloat(card.dataset.score);
                const isMatch = score >= minVal && score <= maxVal;
                
                if (isMatch) {{
                    card.style.display = 'flex';
                    card.offsetHeight;
                    card.classList.remove('hidden');
                    visibleCount++;
                }} else {{
                    card.classList.add('hidden');
                    const onTransitionEnd = (e) => {{
                        if (e.propertyName === 'opacity' && card.classList.contains('hidden')) {{
                            card.style.display = 'none';
                            card.removeEventListener('transitionend', onTransitionEnd);
                        }}
                    }};
                    card.addEventListener('transitionend', onTransitionEnd);
                }}
            }});

            matchDisplay.textContent = `⚡ ${{visibleCount}} Matches Found`;
            emptyState.style.display = visibleCount === 0 ? 'block' : 'none';
        }}

        function openAllFiltered() {{
            const minVal = parseFloat(minSlider.value);
            const maxVal = parseFloat(maxSlider.value);
            const visibleLinks = Array.from(cards)
                .filter(card => {{
                    const score = parseFloat(card.dataset.score);
                    return score >= minVal && score <= maxVal;
                }})
                .map(card => card.querySelector('.apply-btn').href);
            
            if (visibleLinks.length === 0) {{
                alert('No jobs match the current range.');
                return;
            }}

            if (confirm(`Open all ${{visibleLinks.length}} jobs in new tabs?`)) {{
                visibleLinks.forEach(url => window.open(url, '_blank'));
            }}
        }}

        minSlider.addEventListener('input', updateFilter);
        maxSlider.addEventListener('input', updateFilter);
        
        // Initial setup for layout
        updateFilter();
    </script>
</body>
</html>
    """

    cards_html = []
    for job in all_results:
        raw = job.get('raw', {})
        summary = raw.get('summary', {})
        score = job.get('score', 0)
        
        matches = "".join([f"<li>{m}</li>" for m in summary.get('fullMatches', [])])
        missing = "".join([f"<li>{m}</li>" for m in summary.get('partialMissing', [])])
        
        card = f"""
            <div class="job-card" data-score="{score}">
                <div class="score-badge">
                    <span class="score-label-inner">Score</span>
                    {score}
                </div>
                <h2 class="job-title">{job['title']}</h2>
                <div class="job-meta">
                    <div class="meta-item">📍 {raw.get('team', 'Unknown')}</div>
                    <div class="salary-tag">💰 {raw.get('salary', 'N/A')}</div>
                </div>
                
                <div class="reason-box">
                    {summary.get('primaryStatus', {}).get('reason', 'No specific reason found.')}
                </div>

                <div class="details-grid">
                    <div class="detail-group">
                        <h4>Key Alignments</h4>
                        <ul class="matches-list">
                            {matches}
                        </ul>
                    </div>
                    {'<div class="detail-group"><h4>Gaps & Considerations</h4><ul class="matches-list missing-list">' + missing + '</ul></div>' if missing else ''}
                </div>

                <div class="insight-footer">
                    <div class="insight-text">
                        ✨ {summary.get('uniqueInsight', 'No unique insight.')}
                    </div>
                    <div class="action-bar">
                        <a href="{job['url']}" class="apply-btn" target="_blank">Open Job Post</a>
                        <span class="source-label" style="opacity: 0.3;">{job['_source']}</span>
                    </div>
                </div>
            </div>
        """
        cards_html.append(card)

    # Start with the user-provided threshold
    min_score = threshold

    final_html = html_template.format(
        total_count=len(all_results),
        date=datetime.now().strftime("%Y-%m-%d %H:%M"),
        job_cards="".join(cards_html),
        min_score=f"{min_score:.1f}",
        model_header_html=model_header_html
    )

    # If output_dir is provided, save there; else use the dir of first result file
    save_dir = output_dir if output_dir else (os.path.dirname(result_files[0]) if result_files else "test")
    output_path = os.path.join(save_dir, "dashboard.html")
    with open(output_path, 'w') as f:
        f.write(final_html)
    
    return output_path

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run analysis and/or generate Job Match Radar dashboard.")
    parser.add_argument("inputs", nargs="*", help="Paths to test JSON lists (to run) or results_*.json files (to visualize).")
    parser.add_argument("--model", default="phi4-mini-reasoning:3.8b", help="Ollama model name (for running tests)")
    parser.add_argument("--url", default="http://localhost:11435", help="Ollama API URL")
    parser.add_argument("--workers", type=int, default=2, help="Parallel workers for tests")
    parser.add_argument("--gemini-api-key", help="Gemini API key (overrides GEMINI_API_KEY env var)")
    parser.add_argument("--dir", help="Target directory for results and dashboard")
    parser.add_argument("--threshold", type=float, default=0.0, help="Initial minimum score threshold for dashboard")
    
    args = parser.parse_args()
    
    inputs = args.inputs
    gemini_api_key = args.gemini_api_key or os.environ.get("GEMINI_API_KEY")
    
    if not inputs:
        # Default behavior if no inputs: look for results in test/
        test_folder = args.dir or "test"
        result_files = glob.glob(os.path.join(test_folder, "results_*.json"))
        if not result_files:
            print(f"⚠️  No inputs provided and no results_*.json found in {test_folder}")
            sys.exit(0)
        path = generate_html(result_files, test_folder, args.threshold)
        print(f"\n✨ Dashboard generated from existing results: {os.path.abspath(path)}")
        sys.exit(0)

    # Sort inputs into test lists (need running) and result files (ready to visualize)
    test_lists = []
    result_files = []
    
    for item in inputs:
        if os.path.basename(item).startswith("results_"):
            result_files.append(item)
        else:
            test_lists.append(item)
            # Predict the resulting file path
            dir_name = os.path.dirname(item) or "test"
            base_name = os.path.splitext(os.path.basename(item))[0]
            result_files.append(os.path.join(dir_name, f"results_{base_name}.json"))

    # Run tests if any test lists were provided
    if test_lists:
        print(f"🚀 Running analysis with {args.model} for {len(test_lists)} list(s)...")
        for tl in test_lists:
            process_list(tl, args.model, args.url, args.workers, gemini_api_key, args.threshold)

    # Generate dashboard from all identified result files
    if result_files:
        # Filter for files that actually exist (after testing or pre-existing)
        valid_results = [f for f in result_files if os.path.exists(f)]
        if not valid_results:
            print("⚠️  No valid result files found after processing.")
            sys.exit(1)
            
        print(f"\n📊 Visualizing {len(valid_results)} result file(s)...")
        path = generate_html(valid_results, args.dir, args.threshold)
        print(f"\n✨ Unified Dashboard: {os.path.abspath(path)}")
