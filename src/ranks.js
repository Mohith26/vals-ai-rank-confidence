// Rank Confidence for Vals leaderboards: pure functions, no dependencies (browser + Node).
//
// 1. moderateSE: empirical-Bayes (limma-style, Smyth 2004) moderation of standard errors that were
//    estimated from very few runs (Vals' multi-run benchmarks use 3 runs, so each SE has 2 degrees
//    of freedom and can even be exactly 0). Variances are first scaled by p(1-p) so models at different
//    accuracy levels share one prior; the moderated SE has d0 + d degrees of freedom.
// 2. rankIntervals: simultaneous (or per-model) confidence intervals for ranks from estimates and SEs
//    (Mogstad, Romano, Shaikh and Wilhelm, "Inference for Ranks", REStud 2024): a parametric bootstrap
//    of the max studentized pairwise difference gives a critical value c; model j's rank is bounded by
//    counting models that are significantly better / worse. Stepwise refinement (Romano-Wolf) tightens it.
//    With probability >= 1 - alpha (asymptotically), every true rank lies in its interval simultaneously.
// 3. topSet, pairwise, separation planner.

// ---------- RNG and distributions ----------
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function normalOf(R) {
  let spare = null;
  return () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u = 0, v = 0, s = 0;
    do { u = 2 * R() - 1; v = 2 * R() - 1; s = u * u + v * v; } while (s === 0 || s >= 1);
    const m = Math.sqrt(-2 * Math.log(s) / s); spare = v * m; return u * m;
  };
}
/** Gamma(shape, 1) by Marsaglia-Tsang */
export function gammaOf(R, N = normalOf(R)) {
  const g = shape => {
    if (shape < 1) return g(shape + 1) * Math.pow(R(), 1 / shape);
    const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x, v;
      do { x = N(); v = 1 + c * x; } while (v <= 0);
      v = v * v * v; const u = R();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  };
  return g;
}
/** standard normal quantile (Acklam) */
export function qnorm(p) {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) return -qnorm(1 - p);
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
export function pnorm(x) { // Abramowitz-Stegun 7.1.26 via erf, |err| < 1.5e-7
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

// ---------- polygamma for limma's prior fit ----------
export function digamma(x) {
  let r = 0;
  while (x < 6) { r -= 1 / x; x += 1; }
  const f = 1 / (x * x);
  return r + Math.log(x) - 0.5 / x - f * (1 / 12 - f * (1 / 120 - f * (1 / 252 - f * (1 / 240 - f / 132))));
}
export function trigamma(x) {
  let r = 0;
  while (x < 6) { r += 1 / (x * x); x += 1; }
  const f = 1 / (x * x);
  return r + 1 / x + f / 2 + f / x * (1 / 6 - f * (1 / 30 - f * (1 / 42 - f / 30)));
}
/** inverse of trigamma (Newton iteration from limma::trigammaInverse) */
export function trigammaInverse(y) {
  if (y > 1e7) return 1 / Math.sqrt(y);
  if (y < 1e-6) return 1 / y;
  let x = 0.5 + 1 / y;
  for (let i = 0; i < 50; i++) {
    const tri = trigamma(x);
    const dif = tri * (1 - tri / y) / tetragamma(x);
    x += dif;
    if (-dif / x < 1e-8) break;
  }
  return x;
}
export function tetragamma(x) {
  let r = 0;
  while (x < 6) { r -= 2 / (x * x * x); x += 1; }
  const f = 1 / (x * x);
  return r - 1 / (x * x) - 1 / (x * x * x) - f * f * (1 / 2 - f * (1 / 6 - f * (1 / 6 - f * 3 / 10)));
}

// ---------- 1. moderated standard errors ----------
/**
 * @param acc  accuracies in percent
 * @param se   reported standard errors (percent), from R runs (df = R - 1)
 * @returns {se, df, d0, s0, used}  moderated SEs, their df, prior df and scale
 */
export function moderateSE(acc, se, runs) {
  const d = runs - 1;
  const scale = acc.map(a => { const p = Math.min(0.99, Math.max(0.01, a / 100)); return p * (1 - p); });
  const v = se.map((s, i) => (s * s) / scale[i]);
  const pos = v.map((x, i) => [x, i]).filter(([x]) => x > 0 && Number.isFinite(x));
  if (pos.length < 3) return { se: se.slice(), df: se.map(() => d), d0: 0, s0: NaN, used: pos.length };
  const e = pos.map(([x]) => Math.log(x) - digamma(d / 2) + Math.log(d / 2));
  const ebar = e.reduce((a, b) => a + b, 0) / e.length;
  const ve = e.reduce((a, b) => a + (b - ebar) ** 2, 0) / (e.length - 1) - trigamma(d / 2);
  let d0, s02;
  if (ve > 0) { d0 = 2 * trigammaInverse(ve); s02 = Math.exp(ebar + digamma(d0 / 2) - Math.log(d0 / 2)); }
  else { d0 = Infinity; s02 = Math.exp(ebar); }
  const out = v.map((x, i) => {
    const post = Number.isFinite(d0) ? (d0 * s02 + d * x) / (d0 + d) : s02;
    return Math.sqrt(post * scale[i]);
  });
  return { se: out, df: out.map(() => (Number.isFinite(d0) ? d0 + d : Infinity)), d0, s0: Math.sqrt(s02), used: pos.length };
}

// ---------- 2. rank intervals ----------
function quantile(arr, q) { const s = Float64Array.from(arr).sort(); const idx = Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1)); return s[idx]; }

/**
 * @param est   estimates (higher is better)
 * @param se    standard errors
 * @param opts  {alpha=0.05, mode='simultaneous'|'marginal', df (array or number, Infinity = normal), rho=0, B=2000, seed=1, stepdown=true}
 * @returns {lower, upper, c (critical value per model or global), sig(j,k) -> bool}
 */
export function rankIntervals(est, se, opts = {}) {
  const { alpha = 0.05, mode = 'simultaneous', rho = 0, B = 2000, seed = 1, stepdown = true } = opts;
  const p = est.length;
  const df = Array.isArray(opts.df) ? opts.df : est.map(() => (opts.df == null ? Infinity : opts.df));
  const sd = (j, k) => Math.sqrt(Math.max(1e-12, se[j] * se[j] + se[k] * se[k] - 2 * rho * se[j] * se[k]));
  // bootstrap draws of standardized errors Z_j (correlated through a shared factor when rho > 0)
  const R = rng(seed), N = normalOf(R), G = gammaOf(R, N);
  const Z = new Array(B);
  for (let b = 0; b < B; b++) {
    const w = N(), z = new Float64Array(p);
    for (let j = 0; j < p; j++) {
      let x = Math.sqrt(1 - rho) * N() + Math.sqrt(rho) * w;
      if (Number.isFinite(df[j])) x /= Math.sqrt(2 * G(df[j] / 2) / df[j]);
      z[j] = x * se[j];
    }
    Z[b] = z;
  }
  const maxOver = pairs => {
    const m = new Float64Array(B);
    for (let b = 0; b < B; b++) { let mx = 0; const z = Z[b]; for (const [j, k, s] of pairs) { const t = Math.abs(z[j] - z[k]) / s; if (t > mx) mx = t; } m[b] = mx; }
    return quantile(m, 1 - alpha);
  };
  const better = Array.from({ length: p }, () => new Uint8Array(p)); // better[j][k] = 1 if j significantly above k
  const allPairs = [];
  for (let j = 0; j < p; j++) for (let k = j + 1; k < p; k++) allPairs.push([j, k, sd(j, k)]);
  let cGlobal = null; const cPer = new Float64Array(p);
  if (mode === 'simultaneous') {
    let active = allPairs.slice(), changed = true, rounds = 0;
    while (changed && active.length && rounds < 50) {
      changed = false; rounds++;
      const c = maxOver(active);
      if (cGlobal === null) cGlobal = c;
      const keep = [];
      for (const pr of active) {
        const [j, k, s] = pr, t = (est[j] - est[k]) / s;
        if (t > c) { better[j][k] = 1; changed = true; } else if (-t > c) { better[k][j] = 1; changed = true; } else keep.push(pr);
      }
      active = keep;
      if (!stepdown) break;
      cGlobal = Math.min(cGlobal, c);
    }
  } else {
    for (let j = 0; j < p; j++) {
      const pairs = []; for (let k = 0; k < p; k++) if (k !== j) pairs.push([j, k, sd(j, k)]);
      const c = maxOver(pairs); cPer[j] = c;
      for (const [, k, s] of pairs) { const t = (est[j] - est[k]) / s; if (t > c) better[j][k] = 1; else if (-t > c) better[k][j] = 1; }
    }
  }
  const lower = new Int32Array(p), upper = new Int32Array(p);
  for (let j = 0; j < p; j++) {
    let above = 0, below = 0;
    for (let k = 0; k < p; k++) { if (better[k][j]) above++; if (better[j][k]) below++; }
    lower[j] = 1 + above; upper[j] = p - below;
  }
  return { lower: Array.from(lower), upper: Array.from(upper), c: cGlobal, cPer: Array.from(cPer), better };
}

/** Models that could be #1: lower rank bound is 1. Contains the true best with prob >= 1 - alpha. */
export function topSet(ri) { return ri.lower.map((l, j) => (l === 1 ? j : -1)).filter(j => j >= 0); }

/** Group consecutive models (in displayed order) into tiers: a new tier starts when a model's
 *  upper rank bound is below every rank interval in the current tier's head. */
export function tiers(ri, order) {
  const out = []; let cur = [];
  for (const j of order) {
    if (cur.length && ri.lower[j] > ri.upper[cur[0]]) { out.push(cur); cur = []; }
    cur.push(j);
  }
  if (cur.length) out.push(cur);
  return out;
}

/** P(A truly ahead of B) under a normal approximation with flat prior; z and two-sided p-value. */
export function pairwise(estA, seA, estB, seB, rho = 0) {
  const s = Math.sqrt(Math.max(1e-12, seA * seA + seB * seB - 2 * rho * seA * seB));
  const z = (estA - estB) / s;
  return { diff: estA - estB, se: s, z, pAhead: pnorm(z), p: 2 * (1 - pnorm(Math.abs(z))) };
}

/**
 * Separation planner: multiplier m on the number of independent runs (or test items) so that a
 * gap of |diff| is detected with the given power at two-sided level alpha (SE shrinks as 1/sqrt(m)).
 */
export function separationMultiplier(diff, seDiff, { alpha = 0.05, power = 0.8 } = {}) {
  if (!(Math.abs(diff) > 0)) return Infinity;
  const m = Math.pow((qnorm(1 - alpha / 2) + qnorm(power)) * seDiff / Math.abs(diff), 2);
  return Math.max(1, m);
}

/** Pareto frontier on (cost lower is better, accuracy higher is better). `robust`: a model is only
 *  dominated if another is cheaper AND significantly more accurate (one-sided z > zc). */
export function frontier(acc, se, cost, { zc = 0 } = {}) {
  const p = acc.length, on = new Array(p).fill(true);
  for (let j = 0; j < p; j++) {
    if (!(cost[j] > 0)) { on[j] = false; continue; }
    for (let k = 0; k < p; k++) {
      if (k === j || !(cost[k] > 0)) continue;
      const s = Math.sqrt(se[j] * se[j] + se[k] * se[k]) || 1e-9;
      if (cost[k] <= cost[j] && (acc[k] - acc[j]) / s > zc && (cost[k] < cost[j] || acc[k] > acc[j])) { on[j] = false; break; }
    }
  }
  return on;
}

export function toCSV(rows, columns) {
  const esc = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [columns.map(c => esc(c.label)).join(','), ...rows.map(r => columns.map(c => esc(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(','))].join('\n');
}
