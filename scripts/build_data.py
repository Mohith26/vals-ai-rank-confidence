# python3 scripts/build_data.py raw.json -> data/vals.json  (raw.json from scripts/scrape.py)
import json, re, sys
r = json.load(open(sys.argv[1] if len(sys.argv) > 1 else 'raw.json'))
# Multi-run benchmarks per vals.ai/methodology ("Terminal-Bench, Finance Agent v2, BioMysteryBench ... currently three")
MULTI = {'terminal-bench-2', 'terminal-bench-2-1', 'terminal-bench-4', 'terminal-bench-science', 'fabv2', 'fabv2-1', 'biomysterybench'}
allnames, comps = {}, {}
for v in r.values():
    for k, n in v.get('names', {}).items(): allnames.setdefault(k, n)
    comps.update(v.get('companies', {}))
# ids that never appear as a model link on any page; display names as printed on the Vals Index bar chart
OVERRIDE = {'alibaba/qwen3.8-max-internal': 'Qwen 3.8 Max 0902'}
def pretty(mid):
    return mid.split('/', 1)[1].replace('-', ' ').replace('_', ' ').title()
out = {'source': 'https://www.vals.ai/benchmarks (public leaderboard pages; accuracy, stderr, cost_per_test, latency from each page\'s embedded data)', 'fetched': '2026-11-11', 'benchmarks': {}}
for slug, v in r.items():
    title = re.sub(r'\s*(Leaderboard and Methodology|Leaderboard)?\s*\|\s*Vals AI\s*$', '', v['title']).strip()
    rows = []
    for mid, m in v['models'].items():
        if m.get('accuracy') is None: continue
        name = OVERRIDE.get(mid) or v.get('names', {}).get(mid) or allnames.get(mid) or pretty(mid)
        rows.append([mid, name, comps.get(name) or comps.get(allnames.get(mid, '')) or mid.split('/')[0].title(), round(m['accuracy'], 3), m.get('stderr'), m.get('cost_per_test'), m.get('latency')])
    rows.sort(key=lambda x: (-x[3], x[1]))
    out['benchmarks'][slug] = {'title': title, 'updated': v.get('updated'), 'url': v['url'], 'runs': 3 if slug in MULTI else 1, 'kind': 'index' if 'index' in slug else 'benchmark', 'rows': rows}
json.dump(out, open('data/vals.json', 'w'), separators=(',', ':'))
print(len(out['benchmarks']), 'benchmarks')
