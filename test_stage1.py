#!/usr/bin/env python3
"""
Stage 1 Extraction Test - Analyze what metadata is in the page
"""

import sys
import re
import os

def test_file(filepath):
    """Test Stage 1 extraction on a local HTML file"""
    if not os.path.isfile(filepath):
        print(f"❌ File not found: {filepath}")
        sys.exit(1)

    with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
        page_text = f.read()

    print(f"\n{'='*60}")
    print(f"Stage 1 Extraction Analysis")
    print(f"{'='*60}")
    print(f"File: {filepath}\n")

    # Check for salary
    print("🔍 Searching for metadata...\n")

    found = {}

    # Salary patterns
    salary_patterns = [
        (r'\$[\d,]+\s*[-–]\s*\$[\d,]+', 'salary range'),
        (r'salary[:\s]+\$', 'salary mention'),
        (r'\$\d+k', 'salary k notation'),
    ]

    for pattern, desc in salary_patterns:
        matches = re.findall(pattern, page_text, re.IGNORECASE)
        if matches:
            found['SALARY'] = matches[0]
            print(f"✓ SALARY: {matches[0]}")
            break

    if 'SALARY' not in found:
        print(f"✗ SALARY: Not found")

    # Experience
    exp_match = re.search(r'(\d+)\+?\s*years?', page_text, re.IGNORECASE)
    if exp_match:
        found['EXPERIENCE'] = exp_match.group(0)
        print(f"✓ EXPERIENCE: {exp_match.group(0)}")
    else:
        print(f"✗ EXPERIENCE: Not found")

    # Location
    locations = ['San Francisco', 'Seattle', 'New York', 'Remote', 'Hybrid']
    for loc in locations:
        if loc.lower() in page_text.lower():
            found['LOCATION'] = loc
            print(f"✓ LOCATION: {loc}")
            break

    if 'LOCATION' not in found:
        print(f"✗ LOCATION: Not found")

    # Skills
    skills = ['Python', 'Java', 'Go', 'Rust', 'JavaScript', 'TypeScript', 'Postgres', 'FastAPI']
    found_skills = []
    for skill in skills:
        if skill in page_text:
            found_skills.append(skill)

    if found_skills:
        print(f"✓ SKILLS: {', '.join(found_skills)}")
    else:
        print(f"✗ SKILLS: Not found")

    # Title
    title_match = re.search(r'<h1[^>]*>([^<]+)</h1>', page_text)
    if title_match:
        found['TITLE'] = title_match.group(1)
        print(f"✓ TITLE: {title_match.group(1)[:50]}...")
    else:
        print(f"✗ TITLE: Not found")

    print(f"\n{'='*60}")
    print(f"Summary:")
    print(f"{'='*60}")
    print(f"File size: {len(page_text):,} characters")
    print(f"Metadata found: {len(found)} fields")
    print(f"Missing: SALARY" if 'SALARY' not in found else "✓ All critical fields found")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python3 test_stage1.py <html_file>")
        print("\nExample:")
        print('  python3 test_stage1.py "test/jobs/Backend Software Engineer (Evals) _ OpenAI.html"')
        sys.exit(1)

    filepath = sys.argv[1]
    test_file(filepath)
