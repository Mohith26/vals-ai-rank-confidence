// Leaderboard-level analysis shared by the app and scripts/report.mjs.
import { moderateSE, rankIntervals, topSet, tiers, pairwise, separationMultiplier, frontier, rng, normalOf } from './ranks.js';

export const DEFAULTS = { alpha: 0.05, mode: 'simultaneous', rho: 0, moderate: true, B: 2000, seed: 7 };

/** rows: [id, name, lab, accuracy, stderr, costPerTest, latency] */
export function analyzeBoard(bench, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const rows = bench.rows.filter(r => r[4] != null && Number.isFinite(r[4]));
  const excluded = bench.rows.filter(r => !(r[4] != null && Number.isFinite(r[4])));
  const acc = rows.map(r => r[3]), seRaw = rows.map(r => r[4]);
  let se = seRaw.slice(), df = Infinity, mod = null;
  const zeroSE = seRaw.filter(s => s === 0).length;
  if (bench.runs > 1 && o.moderate) { mod = moderateSE(acc, seRaw, bench.runs); se = mod.se; df = mod.df; }
  else if (bench.runs > 1) { df = rows.map(() => bench.runs - 1); se = seRaw.map(s => Math.max(s, 1e-6)); }
  const ri = rankIntervals(acc, se, { alpha: o.alpha, mode: o.mode, rho: o.rho, df, B: o.B, seed: o.seed });
  const order = acc.map((_, j) => j); // rows already sorted by accuracy
  const top = topSet(ri);
  const tierList = tiers(ri, order);
  const chanceFirst = chanceOfFirst(acc, se, o.rho, 4000, o.seed + 1);
  // adjacent separation plan within the top set
  const plan = [];
  for (let j = 0; j + 1 < Math.min(rows.length, Math.max(top.length, 2) + 1); j++) {
    const pw = pairwise(acc[j], se[j], acc[j + 1], se[j + 1], o.rho);
    plan.push({ a: j, b: j + 1, ...pw, mult: separationMultiplier(pw.diff, pw.se, { alpha: o.alpha }) });
  }
  const cost = rows.map(r => r[5]);
  const front = frontier(acc, se, cost, { zc: 0 });
  const robustFront = frontier(acc, se, cost, { zc: 1.96 });
  return { o, rows, excluded, acc, se, seRaw, df, mod, zeroSE, ri, top, tiers: tierList, chanceFirst, plan, front, robustFront };
}

/** Monte Carlo P(model is #1) under independent normal errors (flat prior); a display aid, not a test. */
export function chanceOfFirst(acc, se, rho = 0, draws = 4000, seed = 3) {
  const R = rng(seed), N = normalOf(R), p = acc.length, wins = new Float64Array(p);
  for (let d = 0; d < draws; d++) {
    const w = N(); let best = -Infinity, arg = 0;
    for (let j = 0; j < p; j++) { const v = acc[j] + se[j] * (Math.sqrt(1 - rho) * N() + Math.sqrt(rho) * w); if (v > best) { best = v; arg = j; } }
    wins[arg]++;
  }
  return Array.from(wins, x => x / draws);
}

export function headToHead(board, j) {
  const { acc, se, rows, ri, o } = board;
  return rows.map((r, k) => k === j ? null : ({ k, ...pairwise(acc[j], se[j], acc[k], se[k], o.rho), sig: ri.better[j][k] ? 'ahead' : ri.better[k][j] ? 'behind' : 'tie',
    mult: separationMultiplier(acc[j] - acc[k], Math.sqrt(se[j] ** 2 + se[k] ** 2 - 2 * o.rho * se[j] * se[k]), { alpha: o.alpha }) })).filter(Boolean);
}
