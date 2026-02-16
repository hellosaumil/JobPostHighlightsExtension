import json
import os
import sys
from datetime import datetime

def generate_html(result_files):
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
            align-items: flex-end;
            gap: 2rem;
            flex-wrap: wrap;
        }}

        .header-title h1 {{
            font-size: 2.8rem;
            font-weight: 700;
            margin: 0;
            letter-spacing: -0.04em;
            background: linear-gradient(to right, #fff, #a1a1aa);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }}

        .stats {{
            display: flex;
            gap: 2rem;
            margin-top: 1rem;
            font-family: var(--font-mono);
            font-size: 0.85rem;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }}

        /* Filter Controls */
        .controls {{
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            padding: 1.25rem 2rem;
            border-radius: 16px;
            display: flex;
            align-items: center;
            gap: 1.5rem;
            min-width: 300px;
        }}

        .filter-label {{
            font-family: var(--font-mono);
            font-size: 0.75rem;
            text-transform: uppercase;
            color: var(--text-secondary);
            white-space: nowrap;
        }}

        .slider-container {{
            flex: 1;
            display: flex;
            align-items: center;
            gap: 1rem;
        }}

        #scoreSlider {{
            -webkit-appearance: none;
            width: 100%;
            height: 4px;
            background: var(--card-border);
            border-radius: 2px;
            outline: none;
        }}

        #scoreSlider::-webkit-slider-thumb {{
            -webkit-appearance: none;
            width: 18px;
            height: 18px;
            background: var(--text-primary);
            border-radius: 50%;
            cursor: pointer;
            border: 2px solid var(--accent);
            box-shadow: 0 0 10px var(--accent-glow);
        }}

        #scoreValue {{
            font-family: var(--font-mono);
            font-weight: 700;
            color: var(--accent);
            min-width: 2.5rem;
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
    </style>
</head>
<body>
    <div class="container">
        <header>
            <div class="header-title">
                <h1>Job Match Radar</h1>
                <div class="stats">
                    <span id="matchDisplay">⚡ {total_count} Matches Found</span>
                    <span>🕒 Scanned: {date}</span>
                </div>
            </div>
            
            <div class="controls">
                <span class="filter-label">Min Score</span>
                <div class="slider-container">
                    <input type="range" id="scoreSlider" min="{min_score}" max="5" step="0.1" value="{min_score}">
                    <span id="scoreValue">{min_score}</span>
                </div>
            </div>
        </header>

        <div class="job-grid" id="jobGrid">
            {job_cards}
            <div class="empty-state" id="emptyState">
                <h3 style="color: var(--text-secondary)">No jobs match this score threshold.</h3>
            </div>
        </div>
    </div>

    <script>
        const slider = document.getElementById('scoreSlider');
        const scoreValue = document.getElementById('scoreValue');
        const cards = document.querySelectorAll('.job-card');
        const matchDisplay = document.getElementById('matchDisplay');
        const emptyState = document.getElementById('emptyState');

        function updateFilter() {{
            const threshold = parseFloat(slider.value);
            scoreValue.textContent = threshold.toFixed(1);
            
            let visibleCount = 0;
            cards.forEach(card => {{
                const score = parseFloat(card.dataset.score);
                const isMatch = score >= threshold;
                
                if (isMatch) {{
                    card.style.display = 'flex';
                    // Trigger reflow for transition
                    card.offsetHeight;
                    card.classList.remove('hidden');
                    visibleCount++;
                }} else {{
                    card.classList.add('hidden');
                    // We hide layout after transition
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

        slider.addEventListener('input', updateFilter);
        
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
                        <span class="source-label">{job['_source']}</span>
                    </div>
                </div>
            </div>
        """
        cards_html.append(card)

    # Calculate min score for the slider default
    scores = [r.get('score', 0) for r in all_results]
    min_score = min(scores) if scores else 3.5

    final_html = html_template.format(
        total_count=len(all_results),
        date=datetime.now().strftime("%Y-%m-%d %H:%M"),
        job_cards="".join(cards_html),
        min_score=f"{min_score:.1f}"
    )

    output_path = "test/dashboard.html"
    with open(output_path, 'w') as f:
        f.write(final_html)
    
    return output_path

if __name__ == "__main__":
    import glob
    
    # Automatically find all results_*.json files in the test folder
    test_folder = "test"
    result_files = glob.glob(os.path.join(test_folder, "results_*.json"))
    
    if not result_files:
        print(f"⚠️  No result files found in {test_folder} matching 'results_*.json'")
        sys.exit(0)
        
    print(f"🔍 Found {len(result_files)} result file(s):")
    for f in result_files:
        print(f"   - {os.path.basename(f)}")
        
    path = generate_html(result_files)
    print(f"\n✨ Dashboard generated successfully: {os.path.abspath(path)}")
