// Rank Confidence: a concept feature for Vals AI leaderboards (unofficial demo).
import { analyzeBoard, headToHead } from './src/board.js';
import { toCSV } from './src/ranks.js';

const $ = s => document.querySelector(s);
const view = $('#view'), overlay = $('#overlay'), selbar = $('#selbar');
const STORE = 'vals-rank-confidence:v1';
const S = { data: null, bench: 'vals_index', mode: 'simultaneous', level: 0.95, rho: 0, moderate: true, model: null, showAll: false, search: '', sort: 'acc', menu: false, dialog: null };
try { Object.assign(S, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch { /* ignore */ }
S.model = null; S.menu = false; S.dialog = null;
const persist = () => localStorage.setItem(STORE, JSON.stringify({ mode: S.mode, level: S.level, rho: S.rho, moderate: S.moderate }));

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (x, d = 2) => `${x.toFixed(d)}%`;
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const longDate = u => { if (!u) return ''; const [m, d, y] = u.split('/').map(Number); return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]} ${d}, ${y}`; };
const shortDate = u => { if (!u) return ''; const [m, d, y] = u.split('/').map(Number); return `${MON[m - 1]} ${String(d).padStart(2, '0')}, ${y}`; };
const LABC = { Anthropic: '#191917', OpenAI: '#3e3b38', Google: '#376fc8', Meta: '#2d5ba4', 'Moonshot AI': '#56524e', DeepSeek: '#5b89d2', Alibaba: '#e7792b', xAI: '#191917', Mistral: '#d9a21b', zAI: '#284d32' };
const labChip = lab => `<span class="lab" style="color:${LABC[lab] || '#86807a'}" aria-hidden="true">${esc((lab || '?').slice(0, 1))}</span>`;
const icons = () => window.lucide && window.lucide.createIcons({ attrs: { 'stroke-width': 1.6 } });

// ---------- analysis cache ----------
const cache = new Map();
function A(slug = S.bench) {
  const b = S.data.benchmarks[slug];
  const key = JSON.stringify([slug, S.mode, S.level, S.rho, S.moderate]);
  if (!cache.has(key)) cache.set(key, analyzeBoard(b, { alpha: +(1 - S.level).toFixed(3), mode: S.mode, rho: S.rho, moderate: S.moderate, B: b.rows.length > 90 ? 1000 : 2000 }));
  return cache.get(key);
}

// ---------- URL ----------
function readHash() {
  const p = new URLSearchParams(location.hash.replace(/^#\/?/, '').split('?')[1] || '');
  const parts = location.hash.replace(/^#\/?/, '').split('?')[0].split('/');
  if (parts[0] === 'benchmarks' && parts[1] && (!S.data || S.data.benchmarks[parts[1]])) S.bench = parts[1];
  if (['simultaneous', 'marginal'].includes(p.get('mode'))) S.mode = p.get('mode');
  if (p.get('level') && [90, 95, 99].includes(+p.get('level'))) S.level = +p.get('level') / 100;
  if (p.get('rho') != null && !isNaN(+p.get('rho'))) S.rho = Math.min(0.9, Math.max(0, +p.get('rho')));
  if (p.get('moderate') != null) S.moderate = p.get('moderate') !== '0';
  S.model = p.get('model');
}
function writeHash() {
  const p = new URLSearchParams({ mode: S.mode, level: Math.round(S.level * 100), rho: S.rho.toFixed(2), moderate: S.moderate ? 1 : 0 });
  if (S.model) p.set('model', S.model);
  history.replaceState(null, '', `#/benchmarks/${S.bench}?${p}`);
}

// ---------- pieces ----------
function selbarHtml() {
  const B = S.data.benchmarks, cur = B[S.bench];
  const groups = { index: [], benchmark: [] };
  for (const [k, b] of Object.entries(B)) if (b.rows.filter(r => r[4] != null).length >= 3) groups[b.kind].push([k, b.title]);
  for (const g of Object.values(groups)) g.sort((a, b) => a[1].localeCompare(b[1]));
  const kindSel = `<select aria-label="Benchmark type" data-ctl="kind"><option value="index" ${cur.kind === 'index' ? 'selected' : ''}>Index</option><option value="benchmark" ${cur.kind === 'benchmark' ? 'selected' : ''}>Benchmark</option></select>`;
  const benchSel = `<select aria-label="Benchmark" data-ctl="bench">${groups[cur.kind].map(([k, t]) => `<option value="${k}" ${k === S.bench ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  const chev = '<span class="chev"><i data-lucide="chevrons-up-down"></i></span>';
  return `<div class="cell"><i data-lucide="${cur.kind === 'index' ? 'layers' : 'flask-conical'}"></i>${cur.kind === 'index' ? 'Index' : 'Benchmark'}${chev}${kindSel}</div><div class="cell">${esc(cur.title)}${chev}${benchSel}</div>`;
}

function rangeHtml(a, j, p) {
  const lo = a.ri.lower[j], hi = a.ri.upper[j], top = lo === 1;
  const x = r => ((r - 1) / Math.max(1, p - 1)) * 100;
  return `<span class="range" aria-label="rank between ${lo} and ${hi}"><span class="track"></span><span class="bar ${top ? 'top' : ''}" style="left:${x(lo)}%;width:${Math.max(1.2, x(hi) - x(lo))}%"></span><span class="pt" style="left:calc(${x(j + 1)}% - 1px)"></span></span><span class="rtxt">${lo === hi ? lo : `${lo}–${hi}`}</span>`;
}

function hero(a) {
  const b = S.data.benchmarks[S.bench], r = a.rows;
  const lead = r[0], second = r[1], third = r[2];
  const top = a.top.map(j => r[j][1]);
  const p12 = a.plan[0];
  const lede = S.bench === 'vals_index'
    ? "A single measure of AI's potential economic impact — agentic model performance across finance, coding, legal, and tax tasks, weighted by each sector's share of U.S. GDP."
    : `${esc(b.title)}: ${r.length} models, each scored by Vals with a reported standard error${b.runs > 1 ? ` over ${b.runs} independent runs` : ''}.`;
  return `<section class="hero"><div class="crumb"><a href="#">Benchmarks</a> / ${b.kind === 'index' ? 'Vals Indexes' : 'Leaderboards'}</div>
    ${b.kind === 'index' ? '<div class="tag"><i></i>PROPRIETARY</div>' : `<div class="tag pub"><i></i>${b.runs > 1 ? `${b.runs} RUNS PER MODEL` : 'SINGLE RUN'}</div>`}
    <h1>${esc(b.title)}</h1>
    <div class="meta"><span>Updated ${esc(b.updated || '')}</span><span class="sep"></span><span>${r.length} models</span><span class="sep"></span><span>Rank confidence <span class="badge-new">NEW</span></span></div>
    <p class="lede">${lede}</p>
    <p class="summary">As of ${longDate(b.updated)}, <a data-model="${esc(lead[0])}">${esc(lead[1])}</a> ranks first on the ${esc(b.title)} with ${pct(lead[3])}${second ? `, followed by <a data-model="${esc(second[0])}">${esc(second[1])}</a> (${pct(second[3])})` : ''}${third ? ` and <a data-model="${esc(third[0])}">${esc(third[1])}</a> (${pct(third[3])})` : ''}.
    <span class="new">At ${Math.round(S.level * 100)}% ${S.mode === 'simultaneous' ? 'simultaneous ' : ''}confidence, ${top.length === 1 ? `${esc(top[0])} is the clear #1.` : `${top.length} models could be #1${p12 ? `, and ${esc(lead[1])} leads ${esc(second[1])} with probability ${Math.round(p12.pAhead * 100)}%` : ''}.`}</span></p></section>`;
}

function rankCard(a) {
  const b = S.data.benchmarks[S.bench], p = a.rows.length;
  const q = S.search.trim().toLowerCase();
  let idx = a.rows.map((_, j) => j);
  if (q) idx = idx.filter(j => a.rows[j][1].toLowerCase().includes(q) || a.rows[j][2].toLowerCase().includes(q));
  const sorters = { acc: (x, y) => x - y, lo: (x, y) => a.ri.lower[x] - a.ri.lower[y] || x - y, chance: (x, y) => a.chanceFirst[y] - a.chanceFirst[x], cost: (x, y) => (a.rows[x][5] ?? 1e9) - (a.rows[y][5] ?? 1e9) };
  idx.sort(sorters[S.sort] || sorters.acc);
  const shown = S.showAll || q ? idx : idx.slice(0, 16);
  const th = (k, label, cls = '') => `<th class="${cls}" data-sort="${k}">${label}<span class="arr">${S.sort === k ? '↓' : '↕'}</span></th>`;
  const rows = shown.map(j => {
    const r = a.rows[j], cls = j === 0 ? 't1' : j === 1 ? 't2' : j === 2 ? 't3' : '';
    return `<tr class="${cls} ${S.model === r[0] ? 'sel' : ''}" data-model="${esc(r[0])}" tabindex="0">
      <td class="rk">${j + 1}</td>
      <td class="l">${labChip(r[2])}<span class="mname">${esc(r[1])}</span>${a.ri.lower[j] === 1 ? '<span class="pill top">COULD BE #1</span>' : ''}${a.seRaw[j] === 0 ? '<span class="pill zero" title="Reported standard error is exactly 0">SE 0</span>' : ''}</td>
      <td class="acc num">${r[3].toFixed(2)} <small>%</small> <span class="se">±${a.se[j].toFixed(2)}</span></td>
      <td>${rangeHtml(a, j, p)}</td>
      <td class="chance num">${a.chanceFirst[j] >= 0.001 ? `${(100 * a.chanceFirst[j]).toFixed(1)}%` : '<span style="color:#b1ada9">&lt;0.1%</span>'}</td>
      <td class="acc num">${r[5] != null ? `$ ${r[5] >= 1 ? r[5].toFixed(2) : r[5].toFixed(3)}` : '-'}</td></tr>`;
  }).join('') || `<tr><td colspan="6" class="empty">No models match "${esc(S.search)}"</td></tr>`;
  const multiNote = b.runs > 1 ? `<div class="note ${S.moderate ? '' : 'warn'}"><i data-lucide="${S.moderate ? 'info' : 'triangle-alert'}"></i>${S.moderate
    ? `Standard errors here come from ${b.runs} runs per model (2 degrees of freedom each)${a.zeroSE ? `, and ${a.zeroSE} model${a.zeroSE > 1 ? 's report' : ' reports'} an SE of exactly 0` : ''}. Shown: moderated SEs that borrow strength across all ${p} models (prior df ${Number.isFinite(a.mod.d0) ? a.mod.d0.toFixed(1) : '∞, the spread of SEs is no larger than chance'}).`
    : `Raw ${b.runs}-run standard errors with Student-t (2 df) tails${a.zeroSE ? `; ${a.zeroSE} SEs of 0 are floored` : ''}. Turn on moderation to borrow strength across models.`}</div>` : '';
  const excl = a.excluded.length ? `<div class="note"><i data-lucide="info"></i>${a.excluded.length} model${a.excluded.length > 1 ? 's' : ''} without a reported standard error ${a.excluded.length > 1 ? 'are' : 'is'} not ranked here.</div>` : '';
  return `<section class="card" id="rank-card"><div class="card-h"><span class="t">Rank Confidence</span><span class="s">Which places in the ranking the data can actually support</span><span class="r">${esc(b.title)} • ${shortDate(b.updated)}</span></div>
    <div class="tools">
      <div class="seg" role="group" aria-label="Interval type"><button class="${S.mode === 'simultaneous' ? 'on' : ''}" data-mode="simultaneous" title="All rank intervals hold together (s)">Simultaneous</button><button class="${S.mode === 'marginal' ? 'on' : ''}" data-mode="marginal" title="Each model's interval holds on its own (s)">Per model</button></div>
      <span class="lab">Confidence</span><select data-ctl="level" aria-label="Confidence level">${[90, 95, 99].map(v => `<option value="${v}" ${Math.round(S.level * 100) === v ? 'selected' : ''}>${v}%</option>`).join('')}</select>
      <span class="lab" title="Models answer the same items, so their errors are positively correlated. 0 is conservative; Vals' item-level data gives the exact value.">Item correlation</span><input type="range" min="0" max="0.8" step="0.05" value="${S.rho}" data-ctl="rho" aria-label="Assumed correlation between models' errors"/><span class="num">${S.rho.toFixed(2)}</span>
      ${b.runs > 1 ? `<button class="tbtn ${S.moderate ? 'on' : 'off'}" data-act="moderate"><span class="ic"><i data-lucide="${S.moderate ? 'sigma' : 'eye-off'}"></i></span>Moderated SE</button>` : ''}
      <span class="spacer"></span>
      <div class="rel"><button class="tbtn" data-act="menu" aria-haspopup="menu"><span class="ic"><i data-lucide="download"></i></span>Export</button>${S.menu ? `<div class="menu" role="menu"><button data-export="csv">Rank intervals (CSV)</button><button data-export="json">Full analysis (JSON)</button><button data-export="link">Copy link to this view</button></div>` : ''}</div>
      <button class="tbtn" data-act="help" title="Keyboard shortcuts (?)"><span class="ic"><i data-lucide="keyboard"></i></span></button>
    </div>
    <div class="legend"><span class="k">Rank range:</span><span><i style="background:var(--accent-600);border:1px solid var(--green-800)"></i>Could be #1</span><span><i style="background:var(--accent-300);border:1px solid var(--accent-600)"></i>Plausible ranks</span><span><i style="background:var(--accent-900);width:3px"></i>Reported rank</span><span style="margin-left:auto" class="k">${a.top.length} of ${p} could be #1 · ${S.mode === 'marginal' ? `per-model critical values ${Math.min(...a.ri.cPer).toFixed(2)}–${Math.max(...a.ri.cPer).toFixed(2)}` : `critical value ${a.ri.c.toFixed(2)}`}</span></div>
    ${multiNote}${excl}
    <div class="searchrow"><div class="q"><i data-lucide="search"></i><input id="q" placeholder="Search models or labs" value="${esc(S.search)}" aria-label="Search models"/></div><span><span class="k">View:</span> All models <i data-lucide="chevron-down"></i></span><span><span class="k">Task:</span> Overall <i data-lucide="chevron-down"></i></span></div>
    <table class="lb"><thead><tr><th class="l" data-sort="acc" style="width:42px">#</th><th class="l" data-sort="acc">Systems (${p})</th>${th('acc', 'Accuracy')}${th('lo', `Rank range (${Math.round(S.level * 100)}%)`)}${th('chance', 'Chance of #1')}${th('cost', 'Cost / Test')}</tr></thead><tbody>${rows}</tbody></table>
    ${!q && idx.length > 16 ? `<div class="more" data-act="more">${S.showAll ? 'Show fewer models' : `View ${idx.length - 16} more models`} <i data-lucide="${S.showAll ? 'chevron-up' : 'chevron-down'}"></i></div>` : ''}
  </section>`;
}

function insightCards(a) {
  const b = S.data.benchmarks[S.bench], r = a.rows;
  const topIdx = a.chanceFirst.map((c, j) => [c, j]).sort((x, y) => y[0] - x[0]).slice(0, 8);
  const max = Math.max(...topIdx.map(x => x[0]), 1e-9);
  const unit = b.runs > 1 ? 'runs' : 'test items';
  const plan = a.plan.map(pl => `<tr><td>${esc(r[pl.a][1])} <span style="color:var(--fg-tertiary)">vs</span> ${esc(r[pl.b][1])}</td><td class="r num">${pl.diff.toFixed(2)}</td><td class="r num">${Math.round(100 * pl.pAhead)}%</td>
    <td class="r num">${Number.isFinite(pl.mult) ? (b.runs > 1 ? `${Math.ceil(pl.mult * b.runs)} runs` : `${pl.mult >= 100 ? Math.round(pl.mult) : pl.mult.toFixed(1)}×`) : '∞'}</td></tr>`).join('');
  return `<div class="gap"></div><section class="card split">
    <div><div class="card-h"><span class="t">Who could be #1?</span><span class="s">Chance each model is truly first</span></div><div class="pad">
      <div class="bigq">${a.top.length === 1 ? `${esc(r[a.top[0]][1])} is first with confidence.` : `${a.top.length} models are statistically tied for first.`}</div>
      <div class="small">The set of models whose rank interval reaches #1 contains the true leader with ${Math.round(S.level * 100)}% confidence. Bars show a simpler Bayesian read: how often each model comes out on top when scores are redrawn within their standard errors.</div>
      <div style="margin-top:10px">${topIdx.map(([c, j]) => `<div class="chbar"><span>${esc(r[j][1])}</span><span class="b"><i class="${a.ri.lower[j] === 1 ? '' : 'out'}" style="width:${(100 * c / max).toFixed(1)}%"></i></span><span class="num mono" style="font-size:12px;text-align:right">${(100 * c).toFixed(1)}%</span></div>`).join('')}</div></div></div>
    <div><div class="card-h"><span class="t">What would settle it?</span><span class="s">Extra ${unit} needed to separate neighbors</span></div><div class="pad">
      <div class="small">For each neighboring pair in the top group: the score gap, the chance the higher one is really ahead, and how many ${b.runs > 1 ? 'runs per model' : 'times more test items'} it would take to tell them apart at ${Math.round(S.level * 100)}% with 80% power (standard error shrinks with the square root of the sample).</div>
      <table class="plan"><thead><tr><th>Pair</th><th class="r">Gap (pts)</th><th class="r">P(ahead)</th><th class="r">${b.runs > 1 ? 'Runs needed' : 'Test set ×'}</th></tr></thead><tbody>${plan}</tbody></table></div></div>
  </section>`;
}

function drawer(a) {
  if (!S.model) return '';
  const j = a.rows.findIndex(r => r[0] === S.model);
  if (j < 0) return '';
  const r = a.rows[j], b = S.data.benchmarks[S.bench];
  const h = headToHead(a, j).sort((x, y) => x.k - y.k);
  const counts = { ahead: h.filter(x => x.sig === 'ahead').length, behind: h.filter(x => x.sig === 'behind').length, tie: h.filter(x => x.sig === 'tie').length };
  return `<div class="scrim" data-act="close"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="${esc(r[1])} head to head">
    <header><div><div class="crumb">${esc(b.title)} / Head to head</div><h3>${esc(r[1])}</h3><div class="small">${esc(r[2])} · reported rank ${j + 1} · plausible ranks ${a.ri.lower[j]}–${a.ri.upper[j]}</div></div><button class="x" data-act="close" aria-label="Close"><i data-lucide="x"></i></button></header>
    <div class="dl"><div><span>Accuracy</span><b>${pct(r[3])}</b></div><div><span>Std. error${b.runs > 1 && S.moderate ? ' (moderated)' : ''}</span><b>±${a.se[j].toFixed(2)}${b.runs > 1 && S.moderate ? ` <small style="font-size:11px;color:var(--fg-tertiary)">raw ±${a.seRaw[j].toFixed(2)}</small>` : ''}</b></div><div><span>Chance of #1</span><b>${(100 * a.chanceFirst[j]).toFixed(1)}%</b></div><div><span>Significantly ahead of / behind</span><b>${counts.ahead} / ${counts.behind}</b></div></div>
    <div class="body"><table class="lb"><thead><tr><th class="l" style="width:42px">#</th><th class="l">Versus</th><th>Gap</th><th>P(${esc(r[1].split(' ').slice(0, 2).join(' '))} ahead)</th><th>Verdict (${Math.round(S.level * 100)}%)</th><th>${b.runs > 1 ? 'Runs to separate' : 'Test set ×'}</th></tr></thead><tbody>
    ${h.map(x => `<tr data-model="${esc(a.rows[x.k][0])}"><td class="rk">${x.k + 1}</td><td class="l">${labChip(a.rows[x.k][2])}${esc(a.rows[x.k][1])}</td><td class="acc num">${x.diff >= 0 ? '+' : ''}${x.diff.toFixed(2)}</td><td class="acc num">${(100 * x.pAhead).toFixed(1)}%</td><td><span class="verdict ${x.sig}">${x.sig === 'tie' ? 'Not separable' : x.sig === 'ahead' ? 'Ahead' : 'Behind'}</span></td>
      <td class="acc num">${Number.isFinite(x.mult) ? (x.sig !== 'tie' ? '<span style="color:#b1ada9">settled</span>' : b.runs > 1 ? `${Math.ceil(x.mult * b.runs)}` : `${x.mult >= 100 ? Math.round(x.mult) : x.mult.toFixed(1)}×`) : '∞'}</td></tr>`).join('')}
    </tbody></table></div></aside>`;
}

function dialog() {
  if (S.dialog !== 'help') return '';
  const k = [['/', 'Search models'], ['j / k', 'Next / previous model (opens head to head)'], ['s', 'Simultaneous ↔ per model'], ['[ ]', 'Previous / next leaderboard'], ['e', 'Export rank intervals (CSV)'], ['Esc', 'Close'], ['?', 'This help']];
  return `<div class="scrim" data-act="close-dialog"></div><div class="dialog" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts"><h3>Keyboard shortcuts</h3><dl>${k.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl><div class="row"><button class="btn" data-act="close-dialog">Close</button></div></div>`;
}

// ---------- render ----------
function render() {
  if (!S.data) return;
  const a = A();
  selbar.innerHTML = selbarHtml();
  const focusQ = document.activeElement && document.activeElement.id === 'q';
  view.innerHTML = hero(a) + rankCard(a) + insightCards(a);
  overlay.innerHTML = drawer(a) + dialog();
  if (focusQ) { const q = $('#q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  document.title = `Rank Confidence · ${S.data.benchmarks[S.bench].title} | Vals AI (concept)`;
  writeHash(); icons();
}

// ---------- export ----------
function download(name, text, type) {
  const u = URL.createObjectURL(new Blob([text], { type })); const l = document.createElement('a');
  l.href = u; l.download = name; document.body.appendChild(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(u), 800);
}
function doExport(kind) {
  const a = A(), b = S.data.benchmarks[S.bench];
  if (kind === 'csv') download(`vals-rank-confidence-${S.bench}.csv`, toCSV(a.rows.map((r, j) => ({ r, j })), [
    { label: 'Reported rank', get: x => x.j + 1 }, { label: 'Model', get: x => x.r[1] }, { label: 'Lab', get: x => x.r[2] }, { label: 'Accuracy', get: x => x.r[3] },
    { label: 'Reported SE', get: x => x.r[4] }, { label: 'SE used', get: x => a.se[x.j].toFixed(4) }, { label: 'Rank lower', get: x => a.ri.lower[x.j] }, { label: 'Rank upper', get: x => a.ri.upper[x.j] },
    { label: 'Could be #1', get: x => (a.ri.lower[x.j] === 1 ? 'yes' : 'no') }, { label: 'Chance of #1', get: x => a.chanceFirst[x.j].toFixed(4) }, { label: 'Cost per test', get: x => x.r[5] }]), 'text/csv');
  else if (kind === 'json') download(`vals-rank-confidence-${S.bench}.json`, JSON.stringify({ benchmark: b.title, source: b.url, updated: b.updated, settings: { level: S.level, mode: S.mode, itemCorrelation: S.rho, moderatedSE: b.runs > 1 && S.moderate },
    criticalValue: a.ri.c, topSet: a.top.map(j => a.rows[j][1]), moderation: a.mod ? { priorDf: Number.isFinite(a.mod.d0) ? a.mod.d0 : 'Infinity', pooledScaledSE: a.mod.s0 } : null,
    models: a.rows.map((r, j) => ({ model: r[1], lab: r[2], accuracy: r[3], reportedSE: r[4], seUsed: +a.se[j].toFixed(4), rank: [a.ri.lower[j], a.ri.upper[j]], chanceOfFirst: +a.chanceFirst[j].toFixed(4) })) }, null, 2), 'application/json');
  else if (kind === 'link') { navigator.clipboard && navigator.clipboard.writeText(location.href).catch(() => {}); }
  S.menu = false; render(); toast(kind === 'link' ? 'Link copied' : 'Export downloaded');
}
let tt; function toast(m) { let e = $('.toast'); if (!e) { e = document.createElement('div'); e.className = 'toast'; e.setAttribute('role', 'status'); document.body.appendChild(e); } e.textContent = m; clearTimeout(tt); tt = setTimeout(() => e.remove(), 2000); }

// ---------- events ----------
function setBench(slug) { if (slug && S.data.benchmarks[slug] && slug !== S.bench) { S.bench = slug; S.model = null; S.search = ''; S.showAll = false; render(); window.scrollTo(0, 0); } }
function benchList() { return Object.keys(S.data.benchmarks).filter(k => S.data.benchmarks[k].rows.filter(r => r[4] != null).length >= 3).sort((x, y) => S.data.benchmarks[x].title.localeCompare(S.data.benchmarks[y].title)); }
document.addEventListener('click', e => {
  const t = e.target.closest('[data-mode],[data-act],[data-export],[data-sort],[data-model]');
  if (S.menu && !(t && (t.dataset.act === 'menu' || t.dataset.export))) { S.menu = false; render(); }
  if (!t) return;
  const d = t.dataset;
  if (d.mode) { S.mode = d.mode; persist(); render(); }
  else if (d.export) doExport(d.export);
  else if (d.sort) { S.sort = d.sort; render(); }
  else if (d.model) { e.preventDefault(); S.model = d.model; render(); }
  else if (d.act) {
    e.preventDefault();
    if (d.act === 'menu') { S.menu = !S.menu; render(); }
    else if (d.act === 'moderate') { S.moderate = !S.moderate; persist(); render(); }
    else if (d.act === 'more') { S.showAll = !S.showAll; render(); }
    else if (d.act === 'close') { S.model = null; render(); }
    else if (d.act === 'help') { S.dialog = 'help'; render(); }
    else if (d.act === 'close-dialog') { S.dialog = null; render(); }
  }
});
document.addEventListener('change', e => {
  const c = e.target.dataset.ctl;
  if (c === 'bench') setBench(e.target.value);
  else if (c === 'kind') { const first = benchList().find(k => S.data.benchmarks[k].kind === e.target.value); setBench(e.target.value === 'index' ? 'vals_index' : first); }
  else if (c === 'level') { S.level = +e.target.value / 100; persist(); render(); }
});
document.addEventListener('input', e => {
  if (e.target.id === 'q') { S.search = e.target.value; render(); }
  else if (e.target.dataset.ctl === 'rho') { S.rho = +e.target.value; persist(); clearTimeout(window.__rt); window.__rt = setTimeout(render, 60); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches && e.target.matches('tr[data-model]')) { S.model = e.target.dataset.model; render(); return; }
  const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
  if (e.key === 'Escape') { S.model = null; S.dialog = null; S.menu = false; if (typing) document.activeElement.blur(); render(); return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey || !S.data) return;
  const a = A();
  if (e.key === '/') { e.preventDefault(); $('#q') && $('#q').focus(); }
  else if (e.key === 's') { S.mode = S.mode === 'simultaneous' ? 'marginal' : 'simultaneous'; persist(); render(); }
  else if (e.key === 'e') doExport('csv');
  else if (e.key === '?') { S.dialog = 'help'; render(); }
  else if (e.key === 'j' || e.key === 'k') {
    const j = S.model ? a.rows.findIndex(r => r[0] === S.model) : -1;
    const n = Math.min(a.rows.length - 1, Math.max(0, j + (e.key === 'j' ? 1 : -1)));
    S.model = a.rows[n][0]; render();
  } else if (e.key === '[' || e.key === ']') {
    const L = benchList(), i = L.indexOf(S.bench); setBench(L[(i + (e.key === ']' ? 1 : -1) + L.length) % L.length]);
  }
});
window.addEventListener('hashchange', () => { readHash(); render(); });

async function boot() {
  readHash();
  try {
    const r = await fetch('data/vals.json');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    S.data = await r.json();
    if (!S.data.benchmarks[S.bench]) S.bench = 'vals_index';
    readHash();
    render();
  } catch (err) {
    view.innerHTML = `<div class="err"><h1>Couldn't load leaderboard data</h1><p class="summary">${esc(err.message)}. <a id="retry">Try again</a></p></div>`;
    $('#retry').addEventListener('click', boot);
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
window.addEventListener('load', icons);
