// node scripts/report.mjs -> results/results.json (headline numbers for README and email)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { analyzeBoard } from '../src/board.js';
import { pairwise } from '../src/ranks.js';
const data = JSON.parse(readFileSync(new URL('../data/vals.json', import.meta.url)));
const out = { source: data.source, fetched: data.fetched, defaults: { alpha: 0.05, mode: 'simultaneous', rho: 0, moderate: true }, boards: {}, summary: {} };
let adj = 0, adjTie = 0, boards = 0, topMulti = 0;
for (const [slug, b] of Object.entries(data.benchmarks)) {
  if (b.rows.filter(r => r[4] != null).length < 3) continue;
  const a = analyzeBoard(b);
  boards++;
  let ties = 0;
  for (let j = 0; j + 1 < a.rows.length; j++) { adj++; if (!a.ri.better[j][j + 1]) { adjTie++; ties++; } }
  if (a.top.length > 1) topMulti++;
  out.boards[slug] = { title: b.title, models: a.rows.length, runs: b.runs, topSet: a.top.map(j => a.rows[j][1]), topSetSize: a.top.length,
    leader: a.rows[0][1], leaderRank: [a.ri.lower[0], a.ri.upper[0]], adjacentTies: ties, zeroSE: a.zeroSE,
    moderation: a.mod ? { d0: Number.isFinite(a.mod.d0) ? +a.mod.d0.toFixed(2) : 'Infinity', pooledScaledSE: +a.mod.s0.toFixed(3) } : null,
    chanceFirstLeader: +a.chanceFirst[0].toFixed(3) };
}
const vi = analyzeBoard(data.benchmarks.vals_index);
const viM = analyzeBoard(data.benchmarks.vals_index, { mode: 'marginal' });
const viR = analyzeBoard(data.benchmarks.vals_index, { rho: 0.5 });
const p12 = pairwise(vi.acc[0], vi.se[0], vi.acc[1], vi.se[1]);
out.summary = {
  boards, adjacentPairs: adj, adjacentNotSeparated: adjTie, adjacentNotSeparatedPct: +(100 * adjTie / adj).toFixed(1), boardsWithTiedTop: topMulti,
  valsIndex: { models: vi.rows.length, topSetSize: vi.top.length, topSet: vi.top.map(j => vi.rows[j][1]), leaderRank: [vi.ri.lower[0], vi.ri.upper[0]],
    marginalLeaderRank: [viM.ri.lower[0], viM.ri.upper[0]], marginalTopSetSize: viM.top.length, rho05TopSetSize: viR.top.length,
    gap12: +p12.diff.toFixed(3), pAhead12: +p12.pAhead.toFixed(3), sepMultiplier12: +vi.plan[0].mult.toFixed(1), chanceFirstLeader: +vi.chanceFirst[0].toFixed(3) },
};
const tb = analyzeBoard(data.benchmarks['terminal-bench-4']), tbRaw = analyzeBoard(data.benchmarks['terminal-bench-4'], { moderate: false });
out.summary.terminalBench4 = { models: tb.rows.length, zeroSE: tb.zeroSE, minRawSE: Math.min(...tb.seRaw), pooledScaledSE: +tb.mod.s0.toFixed(3),
  d0: Number.isFinite(tb.mod.d0) ? +tb.mod.d0.toFixed(2) : 'Infinity', topSetModerated: tb.top.length, topSetRaw: tbRaw.top.length };
mkdirSync(new URL('../results/', import.meta.url), { recursive: true });
writeFileSync(new URL('../results/results.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out.summary, null, 2));
