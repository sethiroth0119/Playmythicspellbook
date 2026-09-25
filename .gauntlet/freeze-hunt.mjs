/* ══════════════════════════════════════════════════════════════════════════
   FREEZE HUNT — why a player's tab locks up and then dies.

   Owner, 2026-09-19: "The players said that the game in the browser froze and
   crashed please fix and optimize the game."

   A freeze-then-crash is almost never a mystery once it is MEASURED; it is one
   of exactly four things, and this probe separates them instead of guessing:

     1. a synchronous loop that never ends   → long tasks, one of them endless
     2. unbounded memory growth → OOM        → usedJSHeapSize climbs and never
                                               comes back down across GC
     3. a leak of live objects (timers,
        listeners, DOM nodes, WebGL)         → the COUNTS climb even while the
                                               heap looks calm
     4. a renderer resource blow-up          → the tab dies with no JS error at
                                               all (page 'crash' event)

   HOW IT MEASURES WHAT THE PAGE HIDES
   Counters are installed with addInitScript, i.e. BEFORE any page script runs,
   so setInterval / setTimeout / addEventListener / requestAnimationFrame are
   already wrapped by the time index.html's first line executes. A leak that
   starts in the first tick is therefore still counted. The wrappers are
   deliberately transparent (same return values, same this) — a page that
   clears its own timers reads as clean, which is the whole point.

   ⚠ WHY LONG TASKS ARE COLLECTED TWO WAYS. PerformanceObserver('longtask')
     stops reporting once the main thread is wedged for good — the observer
     callback is itself a task and can never run. So a heartbeat is ALSO driven
     from node over CDP: if the page stops answering an evaluate() within the
     timeout, that is the freeze itself, caught from outside the tab.

   Usage:
     node .gauntlet/freeze-hunt.mjs [url] [--minutes 3] [--json out.json]
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import fs from 'node:fs';

const args = process.argv.slice(2);
const url = (args[0] && !args[0].startsWith('--')) ? args[0] : 'https://playmythicspellbook.com/';
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const minutes = +flag('minutes', 3);
const jsonOut = flag('json', null);
const SAMPLE_MS = 5000;

const INIT = `
(() => {
  const M = {
    intervals: new Map(), timeouts: new Map(), rafs: 0, rafLive: new Set(),
    listeners: new Map(), longTasks: [], errors: [], rejections: [],
    intervalSeq: 0, timeoutSeq: 0,
    glLost: 0, glContexts: 0, canvases: 0,
  };
  window.__FH = M;

  const _si = window.setInterval, _ci = window.clearInterval;
  window.setInterval = function (fn, ms, ...rest) {
    const id = _si.call(window, fn, ms, ...rest);
    M.intervals.set(id, { ms, stack: (new Error()).stack || '', at: Date.now() });
    return id;
  };
  window.clearInterval = function (id) { M.intervals.delete(id); return _ci.call(window, id); };

  const _st = window.setTimeout, _ct = window.clearTimeout;
  window.setTimeout = function (fn, ms, ...rest) {
    const key = { };
    const id = _st.call(window, function () { M.timeouts.delete(id); try { return fn.apply(this, arguments); } catch (e) { throw e; } }, ms, ...rest);
    M.timeouts.set(id, { ms, stack: (new Error()).stack || '' });
    return id;
  };
  window.clearTimeout = function (id) { M.timeouts.delete(id); return _ct.call(window, id); };

  const _raf = window.requestAnimationFrame, _caf = window.cancelAnimationFrame;
  window.requestAnimationFrame = function (fn) {
    M.rafs++;
    const id = _raf.call(window, function (t) { M.rafLive.delete(id); return fn.call(this, t); });
    M.rafLive.add(id);
    return id;
  };
  window.cancelAnimationFrame = function (id) { M.rafLive.delete(id); return _caf.call(window, id); };

  /* Listener census. The KEY is type + whether it is on window/document or an
     element, because "300 click listeners on elements" and "300 on window" are
     completely different bugs: the first dies with the DOM, the second never
     does. */
  const proto = EventTarget.prototype;
  const _ael = proto.addEventListener, _rel = proto.removeEventListener;
  const keyOf = (t, type) => (t === window ? 'window:' : t === document ? 'document:' : 'element:') + type;
  proto.addEventListener = function (type, fn, opts) {
    const k = keyOf(this, type);
    const e = M.listeners.get(k) || { add: 0, rem: 0 };
    e.add++; M.listeners.set(k, e);
    return _ael.call(this, type, fn, opts);
  };
  proto.removeEventListener = function (type, fn, opts) {
    const k = keyOf(this, type);
    const e = M.listeners.get(k) || { add: 0, rem: 0 };
    e.rem++; M.listeners.set(k, e);
    return _rel.call(this, type, fn, opts);
  };

  /* WebGL: a leaked context is a classic renderer-side tab killer, and Chromium
     caps live contexts (~16) then starts LOSING them silently. */
  const _gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const ctx = _gc.call(this, type, ...rest);
    if (ctx && /webgl/i.test(String(type))) {
      M.glContexts++;
      try { this.addEventListener('webglcontextlost', () => { M.glLost++; }); } catch (e) {}
    }
    return ctx;
  };

  try {
    new PerformanceObserver(list => {
      for (const t of list.getEntries()) {
        if (t.duration >= 200) M.longTasks.push({ dur: Math.round(t.duration), at: Math.round(t.startTime) });
      }
      if (M.longTasks.length > 400) M.longTasks.splice(0, M.longTasks.length - 400);
    }).observe({ entryTypes: ['longtask'] });
  } catch (e) {}

  window.addEventListener('error', e => {
    M.errors.push(String((e && e.message) || e).slice(0, 200));
    if (M.errors.length > 100) M.errors.shift();
  });
  window.addEventListener('unhandledrejection', e => {
    M.rejections.push(String((e && e.reason && e.reason.message) || (e && e.reason) || e).slice(0, 200));
    if (M.rejections.length > 100) M.rejections.shift();
  });
})();
`;

const browser = await chromium.launch({ args: ['--enable-precise-memory-info'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.addInitScript(INIT);

let crashed = false;
page.on('crash', () => { crashed = true; });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e.message || e).slice(0, 200)));

console.log('══ FREEZE HUNT ══');
console.log('url      : ' + url);
console.log('watching : ' + minutes + ' min, sampling every ' + (SAMPLE_MS / 1000) + 's\n');

const t0 = Date.now();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForLoadState('load', { timeout: 120000 }).catch(() => {});

const samples = [];
let frozenAt = null;

const sample = async () => {
  /* The heartbeat IS the freeze detector: a wedged main thread cannot answer
     this, and playwright times out. 8s is well past any legitimate task. */
  const probe = page.evaluate(() => {
    const M = window.__FH || {};
    const L = {};
    for (const [k, v] of (M.listeners || new Map())) { const live = v.add - v.rem; if (live > 0) L[k] = live; }
    const mem = performance.memory || {};
    return {
      heapMB: Math.round((mem.usedJSHeapSize || 0) / 1048576),
      heapLimitMB: Math.round((mem.jsHeapSizeLimit || 0) / 1048576),
      intervals: (M.intervals || new Map()).size,
      timeouts: (M.timeouts || new Map()).size,
      rafTotal: M.rafs || 0,
      rafLive: (M.rafLive || new Set()).size,
      listeners: L,
      listenerTotal: Object.values(L).reduce((a, b) => a + b, 0),
      domNodes: document.getElementsByTagName('*').length,
      canvases: document.getElementsByTagName('canvas').length,
      glContexts: M.glContexts || 0,
      glLost: M.glLost || 0,
      longTasks: (M.longTasks || []).length,
      worstTask: (M.longTasks || []).reduce((a, t) => Math.max(a, t.dur), 0),
      errors: (M.errors || []).slice(-5),
      rejections: (M.rejections || []).slice(-5),
      screen: (window.MythicBridge && window.MythicBridge.screen) ? window.MythicBridge.screen() : null,
    };
  });
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('MAIN THREAD DID NOT ANSWER IN 8s')), 8000));
  return Promise.race([probe, timeout]);
};

const ticks = Math.max(1, Math.round((minutes * 60000) / SAMPLE_MS));
for (let i = 0; i < ticks; i++) {
  if (crashed) { console.log('\n🔴 THE TAB CRASHED (renderer gone) at ' + Math.round((Date.now() - t0) / 1000) + 's'); break; }
  let s;
  try { s = await sample(); }
  catch (e) {
    frozenAt = Math.round((Date.now() - t0) / 1000);
    console.log('\n🔴 FROZEN at ' + frozenAt + 's — ' + e.message);
    break;
  }
  s.t = Math.round((Date.now() - t0) / 1000);
  samples.push(s);
  console.log(
    String(s.t).padStart(4) + 's  heap ' + String(s.heapMB).padStart(5) + 'MB/' + s.heapLimitMB +
    '  nodes ' + String(s.domNodes).padStart(6) +
    '  intervals ' + String(s.intervals).padStart(3) +
    '  timeouts ' + String(s.timeouts).padStart(5) +
    '  rafLive ' + String(s.rafLive).padStart(3) +
    '  listeners ' + String(s.listenerTotal).padStart(5) +
    '  canvas ' + String(s.canvases).padStart(3) + '/gl ' + s.glContexts + (s.glLost ? ' LOST ' + s.glLost : '') +
    '  longTasks ' + s.longTasks + (s.worstTask ? ' (worst ' + s.worstTask + 'ms)' : ''));
  await page.waitForTimeout(SAMPLE_MS);
}

/* ── the reading ── */
console.log('\n══ READING ══');
const first = samples[0], last = samples[samples.length - 1];
if (first && last && samples.length > 1) {
  const mins = Math.max(1 / 60, (last.t - first.t) / 60);
  const growth = (a, b) => ({ d: b - a, per: Math.round(((b - a) / mins) * 10) / 10 });
  const g = {
    heapMB: growth(first.heapMB, last.heapMB),
    domNodes: growth(first.domNodes, last.domNodes),
    intervals: growth(first.intervals, last.intervals),
    timeouts: growth(first.timeouts, last.timeouts),
    listeners: growth(first.listenerTotal, last.listenerTotal),
    canvases: growth(first.canvases, last.canvases),
    glContexts: growth(first.glContexts, last.glContexts),
  };
  for (const [k, v] of Object.entries(g)) {
    const bad = v.per > 0 && (k === 'heapMB' ? v.per > 3 : k === 'domNodes' ? v.per > 200 : v.per > 1);
    console.log((bad ? '  ⚠ ' : '    ') + k.padEnd(12) + (v.d >= 0 ? '+' : '') + v.d + '  (' + (v.per >= 0 ? '+' : '') + v.per + '/min)');
  }
  /* which listener kinds grew — the useful half */
  const lk = new Set([...Object.keys(first.listeners), ...Object.keys(last.listeners)]);
  const grew = [...lk].map(k => ({ k, d: (last.listeners[k] || 0) - (first.listeners[k] || 0), now: last.listeners[k] || 0 }))
    .filter(x => x.d > 0).sort((a, b) => b.d - a.d).slice(0, 12);
  if (grew.length) {
    console.log('\n  listener kinds that GREW (live = added - removed):');
    for (const x of grew) console.log('    +' + String(x.d).padStart(5) + '  now ' + String(x.now).padStart(6) + '  ' + x.k);
  }
  if (last.errors.length)     console.log('\n  last page errors:      ' + last.errors.join(' | '));
  if (last.rejections.length) console.log('  last rejections:       ' + last.rejections.join(' | '));
}
if (pageErrors.length) {
  const uniq = [...new Set(pageErrors)];
  console.log('\n  pageerror (' + pageErrors.length + ', ' + uniq.length + ' distinct):');
  for (const e of uniq.slice(0, 10)) console.log('    ' + e);
}
console.log('\n  verdict: ' + (crashed ? '🔴 RENDERER CRASHED' : frozenAt != null ? '🔴 MAIN THREAD FROZE at ' + frozenAt + 's'
  : samples.length > 1 && (last.heapMB - first.heapMB) > 3 * Math.max(1, (last.t - first.t) / 60) ? '⚠ heap climbing'
  : '✅ stable over this window'));

if (jsonOut) { fs.writeFileSync(jsonOut, JSON.stringify({ url, samples, pageErrors, crashed, frozenAt }, null, 2)); console.log('\n  json → ' + jsonOut); }
await browser.close();
