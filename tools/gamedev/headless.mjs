// ─────────────────────────────────────────────────────────────────────────────
// headless.mjs — load the legacy battle engine (the big inline <script> in
// public/index.html) inside a Node `vm` context and hand back its catalogs and
// pure-ish resolver functions, so the other tools in this folder can inspect
// and EXECUTE game logic without a browser.
//
//   import { loadEngine } from './headless.mjs';
//   const eng = loadEngine();             // ~0.5s
//   eng.MOVES.fireball, eng.applyOnPlayEffect(state, unit, card), eng.mg.testEffect('heal')
//
// WHY a vm sandbox and not `import`: index.html is one 11 MB classic script.
// Its catalogs (MOVES, STATUS_EFFECTS, ONPLAY_TYPES…) are top-level `const`s —
// lexical bindings that are NOT on the global object, so nothing outside the
// script can see them. We therefore append an "exports epilogue" to the script
// source that copies the names we want onto `window.__gd` BEFORE running it.
// Adding a name to EXPORTS below is all it takes to reach a new one.
//
// WHY it works at all: `_harness.js` proved the whole script executes top-level
// under a permissive Proxy global. This loader is the same trick, plus a
// persistent `window`, an in-memory localStorage and real timer no-ops, so state
// the script writes onto `window` (e.g. `window.__mg`, the in-app effect test
// harness) survives instead of evaporating into a fresh stub every read.
//
// Limits (be honest about them in tool output):
//  • Anything DOM/VFX/network-shaped is a no-op stub. Resolvers that touch the
//    DOM inside try/catch behave fine; ones that need real layout will not.
//  • Math.random is real. For deterministic checks pass accuracy:100, crit:0.
//  • RAF/setTimeout never fire — async chains (counter windows) never resolve.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, '..', '..');
export const INDEX = join(ROOT, 'public', 'index.html');

// Everything the tools may want. Guarded with typeof so a renamed/removed const
// yields `undefined` instead of a ReferenceError that kills the whole load.
export const EXPORTS = [
  // catalogs
  'MOVES', 'STATUS_EFFECTS', 'PASSIVES', 'WEATHERBORN_PASSIVES', 'ELEMENTS', 'ELEMENT_DATA',
  'STRONG_VS', 'TYPE_CHART', 'TYPE_IMMUNITIES', 'HELD_ITEMS', 'FACTIONS', 'RARITIES',
  'UNIT_CARDS', 'SPELL_CARDS', 'LOCATION_CARDS', 'TRAP_CARDS', 'WALL_CARDS', 'EVENT_CARDS',
  'WEATHER_CARDS', 'STARTER_HEROES', 'HERO_CLASSES', 'SUBCLASSES',
  // effect / trigger vocabularies
  'ONPLAY_TYPES', 'ONPLAY_TYPE_GROUPS', 'SUMMON_ZONES', 'TRIGGER_EVENTS', 'TRIGGER_EFFECTS',
  'TRIGGER_NEGATE_MODES', 'IN_GRAVE_TRIGGERS', 'IN_GRAVE_EFFECTS', '_CLASSIC_SPELL_FX', '_CLASSIC_TRAP_FX',
  // resolvers / helpers
  'applyOnPlayEffect', '_applyOnPlayOne', '_applyOnPlayOneRaw', '_applyTriggerEffect', '_fireTriggers',
  'calculateDamage', 'applyDamageTriggers', 'applyStatusEffect', 'isImmuneToStatus', 'executeMove',
  'getAvailableMoves', 'hasPassive', '_aiEffectValue', 'buildPassivesFromCard', 'drawCards', 'startTurn',
  // app-level objects (lexical consts — see CLAUDE.md "globals trap")
  'App', 'Profile',
];

/** Pull the largest classic (non-module, non-src) inline script out of the HTML. */
export function extractInlineScript(html) {
  const re = /<script\b((?![^>]*\bsrc=)[^>]*)>([\s\S]*?)<\/script>/gi;
  const blocks = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] || '';
    if (/type\s*=/.test(attrs)) continue;            // importmap / module / json
    const startLine = html.slice(0, m.index).split('\n').length;
    blocks.push({ code: m[2], startLine, attrs });
  }
  if (!blocks.length) throw new Error('No inline <script> found in ' + INDEX);
  blocks.sort((a, b) => b.code.length - a.code.length);
  return blocks[0];
}

function makeStub() {
  const fn = function () { return makeStub(); };
  return new Proxy(fn, {
    get(t, p) {
      if (p === Symbol.toPrimitive) return () => 0;
      if (p === 'then') return undefined;            // never a thenable
      if (p === Symbol.iterator) return function* () {};
      if (p === 'length') return 0;
      if (p === 'nodeType') return 1;
      if (p === 'toString' || p === 'toJSON') return () => '';
      return makeStub();
    },
    set() { return true; },
    apply() { return makeStub(); },
    construct() { return makeStub(); },
    has() { return true; },
  });
}

function makeStorage() {
  const store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    key: (i) => Object.keys(store)[i] || null,
    get length() { return Object.keys(store).length; },
  };
}

/**
 * Load the engine. Returns an object with every EXPORTS name plus:
 *   window   — the persistent window object (window.__mg lives here)
 *   mg       — shortcut to window.__mg (in-app effect test harness) or {}
 *   script   — { code, startLine } for tools that want to grep the source
 *   loadMs   — wall time of the top-level execution
 * opts.quiet (default true) swallows the script's own console noise during load.
 */
export function loadEngine(opts = {}) {
  const quiet = opts.quiet !== false;
  const html = readFileSync(opts.file || INDEX, 'utf8');
  const script = extractInlineScript(html);
  const epilogue = '\n;window.__gd = {' +
    EXPORTS.map((n) => `${n}: (typeof ${n} !== 'undefined' ? ${n} : undefined)`).join(',') +
    '};\n';
  const code = script.code + epilogue;

  const noop = () => 0;
  const localStorage = makeStorage();
  const win = new Proxy({}, {
    get(t, p) { return p in t ? t[p] : makeStub(); },
    set(t, p, v) { t[p] = v; return true; },
    has() { return true; },
  });
  win.__mg = {};                                    // so `window.__mg = window.__mg || {}` keeps a REAL object
  win.localStorage = localStorage;
  win.sessionStorage = makeStorage();

  const silent = { log: noop, warn: noop, error: noop, info: noop, debug: noop, group: noop, groupEnd: noop, table: noop, time: noop, timeEnd: noop };
  const REAL = {
    console: quiet ? silent : console, localStorage, sessionStorage: win.sessionStorage,
    Symbol, Math, JSON, Date, Array, Object, String, Number, Boolean, RegExp, Map, Set, WeakMap, WeakSet,
    Promise, Error, TypeError, RangeError, SyntaxError, parseInt, parseFloat, isNaN, isFinite,
    Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array, Float32Array, Float64Array,
    ArrayBuffer, DataView, encodeURIComponent, decodeURIComponent, encodeURI, decodeURI, escape, unescape,
    structuredClone, performance, TextEncoder, TextDecoder, URL, URLSearchParams, Reflect, Proxy, Function,
    Infinity, NaN, undefined, BigInt, Intl, atob, btoa,
  };
  const TIMERS = new Set(['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'queueMicrotask', 'requestIdleCallback']);
  const sandbox = new Proxy({}, {
    get(t, p) {
      if (p in t) return t[p];
      if (p in REAL) return REAL[p];
      if (TIMERS.has(p)) return noop;
      if (p === 'globalThis' || p === 'window' || p === 'self') return win;
      return makeStub();                            // document, navigator, supabase, PIXI, …
    },
    set(t, p, v) { t[p] = v; return true; },       // keep function declarations reachable
    has() { return true; },
  });

  const t0 = Date.now();
  vm.runInNewContext(code, sandbox, { filename: 'index-inline.js', timeout: opts.timeoutMs || 60000 });
  const gd = win.__gd;
  if (!gd || typeof gd !== 'object') throw new Error('engine loaded but the exports epilogue did not run');
  return Object.assign({}, gd, {
    window: win, mg: (win.__mg && typeof win.__mg === 'object') ? win.__mg : {},
    script, loadMs: Date.now() - t0, sandbox,
  });
}

/** Small CLI helpers shared by the tools. */
export function argFlag(name, dflt = false) {
  const i = process.argv.indexOf('--' + name);
  return i === -1 ? dflt : true;
}
export function argValue(name, dflt = null) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return dflt;
  const v = process.argv[i + 1];
  return (v == null || v.startsWith('--')) ? dflt : v;
}
/** Positional args: not flags, and not the value of one of `valueFlags` (e.g. ['grep']). */
export function positional(valueFlags = []) {
  const vf = new Set(valueFlags.map((f) => '--' + f));
  const raw = process.argv.slice(2);
  return raw.filter((a, i) => !a.startsWith('--') && !(i > 0 && vf.has(raw[i - 1])));
}
