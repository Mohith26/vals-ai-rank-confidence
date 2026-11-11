import re, html, json, time, urllib.request, sys
def dec(v):
    if isinstance(v, list) and len(v) == 2 and isinstance(v[0], int):
        t, x = v
        if t == 0: return {k: dec(w) for k, w in x.items()} if isinstance(x, dict) else x
        if t == 1: return [dec(w) for w in x]
        return x
    if isinstance(v, dict): return {k: dec(w) for k, w in v.items()}
    return v
def find(o, out):
    if isinstance(o, dict):
        if 'tasks' in o and isinstance(o['tasks'], dict) and 'overall' in o['tasks']: out.append(o)
        for w in o.values(): find(w, out)
    elif isinstance(o, list):
        for w in o: find(w, out)
slugs = open('/tmp/slugs.txt').read().split()
res = {}
for s in slugs:
    url = f'https://www.vals.ai/benchmarks/{s}'
    try:
        t = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (research; contact mohithgajjela@gmail.com)'}), timeout=30).read().decode('utf8', 'ignore')
    except Exception as e:
        print('fail', s, e); continue
    title = re.search(r'<title>(.*?)</title>', t); title = html.unescape(title.group(1)) if title else s
    upd = re.search(r'Updated\s*(?:<[^>]+>\s*)*([0-9]{1,2}/[0-9]{1,2}/[0-9]{4})', t)
    cands = []
    for m in re.finditer(r'props="([^"]*)"', t):
        p = html.unescape(m.group(1))
        if '"overall"' not in p: continue
        try: o = dec(json.loads(p))
        except Exception: continue
        find(o, cands)
    if not cands: print('nodata', s); continue
    best = max(cands, key=lambda c: len(c['tasks']['overall']))
    ov = best['tasks']['overall']
    models = {}
    for mid, r in ov.items():
        if not isinstance(r, dict) or r.get('accuracy') is None: continue
        models[mid] = {k: r.get(k) for k in ['accuracy', 'stderr', 'cost_per_test', 'latency']}
    meta = {k: best.get(k) for k in ['name', 'runner', 'mode', 'archived', 'visible', 'total_models', 'num_runs', 'n_runs', 'runs'] if k in best}
    keys = [k for k in best.keys() if k not in ('tasks',)]
    names = dict((sl.replace('_','/',1), html.unescape(nm).strip()) for sl, nm in re.findall(r'<a href="/models/([^"]+)"[^>]*>([^<]{2,80})</a>', t))
    comps = dict(re.findall(r'\{"model":\[0,"([^"]+)"\][^{}]*?"company":\[0,"([^"]+)"\]', html.unescape(t)))
    res[s] = {'names': names, 'companies': comps, 'title': title, 'updated': upd.group(1) if upd else None, 'url': url, 'meta': meta, 'keys': keys[:40], 'models': models}
    print(s, len(models), title[:60])
    time.sleep(0.6)
json.dump(res, open('raw.json', 'w'))
