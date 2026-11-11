import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  qnorm, pnorm, digamma, trigamma, trigammaInverse, moderateSE, rankIntervals, topSet, pairwise,
  separationMultiplier, frontier, rng, normalOf, gammaOf, toCSV,
} from '../src/ranks.js';
import { analyzeBoard, chanceOfFirst } from '../src/board.js';

const root = new URL('../', import.meta.url);
const data = JSON.parse(readFileSync(new URL('data/vals.json', root)));
const results = JSON.parse(readFileSync(new URL('results/results.json', root)));

test('normal quantile/CDF and polygamma match known values', () => {
  assert.ok(Math.abs(qnorm(0.975) - 1.959964) < 1e-5);
  assert.ok(Math.abs(pnorm(1.959964) - 0.975) < 1e-5);
  assert.ok(Math.abs(digamma(1) + 0.5772156649) < 1e-9);
  assert.ok(Math.abs(trigamma(1) - Math.PI ** 2 / 6) < 1e-9);
  for (const x of [0.3, 1, 2.5, 7, 40]) assert.ok(Math.abs(trigammaInverse(trigamma(x)) - x) / x < 1e-6);
});

test('well-separated models get exact ranks; identical models get the full range', () => {
  const sep = rankIntervals([90, 70, 50, 30], [0.5, 0.5, 0.5, 0.5], { B: 500 });
  assert.deepEqual(sep.lower, [1, 2, 3, 4]); assert.deepEqual(sep.upper, [1, 2, 3, 4]);
  const same = rankIntervals([60, 60, 60], [2, 2, 2], { B: 500 });
  assert.deepEqual(same.lower, [1, 1, 1]); assert.deepEqual(same.upper, [3, 3, 3]);
});

test('simultaneous rank intervals cover all true ranks at least 1 - alpha of the time (randomized)', () => {
  const R = rng(5), N = normalOf(R); let cover = 0; const S = 150, p = 12;
  for (let s = 0; s < S; s++) {
    const theta = Array.from({ length: p }, () => 50 + 6 * N());
    const se = Array.from({ length: p }, () => 0.6 + 1.2 * R());
    const est = theta.map((t, j) => t + se[j] * N());
    const ri = rankIntervals(est, se, { B: 600, seed: s + 1 });
    const trueRank = theta.map(t => 1 + theta.filter(u => u > t).length);
    if (trueRank.every((r, j) => r >= ri.lower[j] && r <= ri.upper[j])) cover++;
  }
  assert.ok(cover / S >= 0.95 - 0.04, `coverage ${cover / S}`);
});

test('per-model intervals are never wider than simultaneous ones, and contain the reported rank', () => {
  const b = data.benchmarks.vals_index;
  const sim = analyzeBoard(b, { B: 800 }), mar = analyzeBoard(b, { mode: 'marginal', B: 800 });
  sim.rows.forEach((_, j) => {
    assert.ok(mar.ri.lower[j] >= sim.ri.lower[j] && mar.ri.upper[j] <= sim.ri.upper[j]);
    assert.ok(sim.ri.lower[j] <= j + 1 && j + 1 <= sim.ri.upper[j]);
  });
});

test('accounting for positive item correlation narrows intervals (monotone in rho)', () => {
  const b = data.benchmarks.vals_index;
  const w = a => a.ri.upper.reduce((s, u, j) => s + u - a.ri.lower[j], 0);
  const r0 = analyzeBoard(b, { rho: 0, B: 800 }), r5 = analyzeBoard(b, { rho: 0.5, B: 800 });
  assert.ok(w(r5) < w(r0), `${w(r5)} < ${w(r0)}`);
});

test('the "could be #1" set contains the true best model (randomized)', () => {
  const R = rng(17), N = normalOf(R); let hit = 0; const S = 150;
  for (let s = 0; s < S; s++) {
    const theta = Array.from({ length: 10 }, (_, j) => 70 - 0.8 * j);
    const se = theta.map(() => 1);
    const est = theta.map((t, j) => t + se[j] * N());
    if (topSet(rankIntervals(est, se, { B: 500, seed: s })).includes(0)) hit++;
  }
  assert.ok(hit / S >= 0.95 - 0.03, `hit ${hit / S}`);
});

test('moderated SEs replace zero SEs and shrink toward the pooled value', () => {
  const b = data.benchmarks['terminal-bench-4'];
  const acc = b.rows.map(r => r[3]), se = b.rows.map(r => r[4]);
  const m = moderateSE(acc, se, 3);
  assert.ok(se.some(x => x === 0));
  assert.ok(m.se.every(x => x > 0));
  assert.ok(m.used >= 50);
});

test('moderation recovers the prior and beats raw 3-run SEs on accuracy (randomized)', () => {
  const R = rng(23), N = normalOf(R), G = gammaOf(R, N);
  const p = 400, d = 2, d0 = 8, s02 = 4;
  const trueVar = Array.from({ length: p }, () => d0 * s02 / (2 * G(d0 / 2)));      // scaled inv-chi2 prior
  const obsVar = trueVar.map(v => v * 2 * G(d / 2) / d);                              // chi2_d / d sampling
  const acc = trueVar.map(() => 50);                                                   // p(1-p) constant
  const sc = 0.25;
  const m = moderateSE(acc, obsVar.map(v => Math.sqrt(v * sc)), 3);
  assert.ok(m.d0 > 3 && m.d0 < 25, `d0 ${m.d0}`);
  const err = (est) => est.reduce((s, x, j) => s + (Math.log(x * x / sc) - Math.log(trueVar[j])) ** 2, 0) / p;
  assert.ok(err(m.se) < 0.6 * err(obsVar.map(v => Math.sqrt(v * sc))), 'moderated log-variance error is much lower');
});

test('pairwise and separation planner match closed forms', () => {
  const pw = pairwise(71.309, 0.956, 70.854, 0.928);
  assert.ok(Math.abs(pw.se - Math.hypot(0.956, 0.928)) < 1e-12);
  assert.ok(Math.abs(pw.pAhead + pairwise(70.854, 0.928, 71.309, 0.956).pAhead - 1) < 1e-9);
  const m = separationMultiplier(0.455, pw.se);
  assert.ok(Math.abs(m - ((1.959964 + 0.841621) * pw.se / 0.455) ** 2) < 0.01);
  assert.ok(separationMultiplier(1, pw.se) < m);
  assert.equal(separationMultiplier(0, 1), Infinity);
});

test('cost frontier keeps only undominated models', () => {
  const on = frontier([80, 70, 60, 75], [0, 0, 0, 0], [10, 2, 1, 12]);
  assert.deepEqual(on, [true, true, true, false]);
});

test('chance of #1 sums to 1 and favors the leader', () => {
  const c = chanceOfFirst([71.3, 70.9, 60], [1, 1, 1], 0, 3000, 2);
  assert.ok(Math.abs(c.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(c[0] > c[1] && c[2] < 0.01);
});

test('data snapshot is consistent with the public pages', () => {
  const vi = data.benchmarks.vals_index;
  assert.equal(vi.rows.length, 36);
  assert.equal(vi.rows[0][1], 'Claude Fable 5.2'); assert.equal(vi.rows[0][3], 71.309); assert.equal(vi.rows[0][4], 0.956);
  for (const b of Object.values(data.benchmarks)) {
    assert.match(b.url, /^https:\/\/www\.vals\.ai\/benchmarks\//);
    for (let j = 1; j < b.rows.length; j++) assert.ok(b.rows[j - 1][3] >= b.rows[j][3]);
    for (const r of b.rows) assert.ok(r[4] == null || r[4] >= 0);
  }
});

test('headline numbers in results/results.json match a fresh analysis', () => {
  const vi = analyzeBoard(data.benchmarks.vals_index);
  assert.equal(results.summary.valsIndex.topSetSize, vi.top.length);
  assert.deepEqual(results.summary.valsIndex.topSet, vi.top.map(j => vi.rows[j][1]));
  assert.equal(results.summary.valsIndex.topSetSize, 6);
  const tb = analyzeBoard(data.benchmarks['terminal-bench-4']);
  assert.equal(results.summary.terminalBench4.zeroSE, tb.zeroSE);
  assert.equal(results.summary.terminalBench4.topSetModerated, tb.top.length);
  assert.ok(results.summary.terminalBench4.topSetRaw > tb.top.length, 'moderation tightens the 3-run board');
});

test('CSV export escapes commas and quotes', () => {
  assert.equal(toCSV([{ a: 'GPT-6, "Astra"' }], [{ key: 'a', label: 'Model' }]), 'Model\n"GPT-6, ""Astra"""');
});
