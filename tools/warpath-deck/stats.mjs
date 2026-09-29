// Small statistics helpers. Win rates are reported as Wilson score intervals
// rather than bare percentages, because "51%" over 40 matches and "51%" over
// 4000 are not the same claim and the brief asked for the spread.

/** Wilson score interval for a binomial proportion, 95% by default. */
export function wilson(k, n, z = 1.96) {
  if (!n) return { p: 0, lo: 0, hi: 0, n: 0, k: 0 };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const s = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return { p, lo: Math.max(0, (c - s) / d), hi: Math.min(1, (c + s) / d), n, k };
}

export function pct(x, d = 1) { return (100 * x).toFixed(d) + '%'; }

export function fmtRate(k, n) {
  const w = wilson(k, n);
  return `${pct(w.p)} [${pct(w.lo)}–${pct(w.hi)}] (${k}/${n})`;
}

export function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
export function sd(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
}
export function quantile(a, q) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
}
export function describe(a) {
  return { n: a.length, mean: mean(a), sd: sd(a),
           min: a.length ? Math.min(...a) : 0, max: a.length ? Math.max(...a) : 0,
           p10: quantile(a, 0.1), p50: quantile(a, 0.5), p90: quantile(a, 0.9) };
}

/** A deterministic PRNG so every run of the harness reproduces exactly. */
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
export function pick(r, arr) { return arr[Math.floor(r() * arr.length)]; }
export function shuffled(r, arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
