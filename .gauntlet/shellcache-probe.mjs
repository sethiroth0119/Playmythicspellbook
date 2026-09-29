/* ══════════════════════════════════════════════════════════════════════════
   SHELL CACHE PROBE — the service worker never holds the app in memory.
   (bug-mui2j3wd: "after update browser crashed, reload crashed again, open app
   crashed again … open game, wait 1 or 2 seconds, browser closes")

   serveShell's cache-populate path used to read the cloned response body to
   TEXT. public/index.html is 10.6 MB over the wire and ~17 MB decoded, so that
   is a ~17-million-character JavaScript string — about 34 MB as UTF-16 — held
   in the service worker WHILE THE PAGE PARSES THE SAME DOCUMENT, and then
   copied again into a second Response for the cache. It runs only when the
   cached shell version differs from live: the first navigation after an update.
   And because the cache is written last, a browser that dies partway never
   records the new version, so the next load repeats it — the reload loop the
   reporter describes.

   This runs the REAL serveShell, lifted out of public/sw.js, against stubs, and
   checks the things that matter:
     · the body is never read to text or to a buffer;
     · what reaches the cache is a STREAM, not a string;
     · the entry still carries x-shell-version, so the fast path keeps working;
     · a version that cannot be read caches NOTHING (an unversioned entry would
       be served for ever);
     · and when the cached version matches live, it returns the cache without
       fetching the document at all.

   Usage: node .gauntlet/shellcache-probe.mjs [path/to/sw.js]
   ══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';

const SRC = process.argv[2] || 'public/sw.js';
const src = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (c || x === undefined ? '' : '   [' + x + ']')); if (!c) fails++; };

console.log('══ SHELL CACHE PROBE ══');
console.log('  sw : ' + SRC + '\n');

/* lift the pieces we need, by name, so the probe exercises shipped code */
function fnText(name) {
  const i = src.indexOf('async function ' + name + '(');
  if (i < 0) return null;
  let d = 0, started = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  return null;
}
/* ⚠ THE CONSTANTS MUST COME TOO. serveShell opens caches.open(SHELL_CACHE)
   inside a try whose catch is empty, so if SHELL_CACHE is undefined the
   ReferenceError is swallowed, `cache` stays null and the ENTIRE cache path is
   skipped — the probe then reports a clean run for code it never executed.
   That is exactly what the first version of this file did: it passed "the
   document is never read to text" against the control that reads it. */
const constsMatch = src.match(/const SHELL_CACHE =[\s\S]*?const SHELL_KEY = '[^']*';/);
const timeoutFn = (() => {
  const i = src.indexOf('function _timeout(');
  if (i < 0) return '';
  let d = 0, started = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  return '';
})();
const verFn = fnText('_shellVersionOf');
const shellFn = fnText('serveShell');
ok(!!constsMatch, 'SHELL_CACHE / SHELL_KEY were found (without them the probe tests nothing)');
ok(!!timeoutFn, '_timeout was found');
ok(!!shellFn, 'serveShell was found in the worker');
if (!shellFn || !constsMatch || !timeoutFn) { console.log('\n❌ cannot continue'); process.exit(1); }
const PREAMBLE = constsMatch[0] + '\n' + timeoutFn + '\n' + (verFn || '') + '\n';

/* ── the harness ── */
const mk = (opts) => {
  const state = { textReads: 0, bufferReads: 0, put: null, fetched: [], cacheOpened: [] };
  /* Stands in for the 17 MB document, and it CARRIES A BUILD_VERSION so the
     old regex path can succeed on its own terms — otherwise the control would
     fail "the shell is still cached" for the wrong reason and flatter the
     candidate. */
  const BIG = "<!DOCTYPE html>" + 'x'.repeat(2000) +
              "window.BUILD_VERSION = '" + (opts.liveVer || 'v121v191') + "';" + 'y'.repeat(2000);

  class FakeHeaders {
    constructor(init) { this.m = new Map(Object.entries(init || {})); }
    get(k) { const v = this.m.get(String(k).toLowerCase()); return v === undefined ? null : v; }
    set(k, v) { this.m.set(String(k).toLowerCase(), String(v)); }
    delete(k) { this.m.delete(String(k).toLowerCase()); }
  }
  class FakeResponse {
    constructor(body, init) {
      this._body = body;
      this.status = (init && init.status) || 200;
      this.ok = this.status === 200;
      this.type = 'basic';
      this.headers = (init && init.headers instanceof FakeHeaders) ? init.headers : new FakeHeaders(init && init.headers);
      this.bodyIsStream = (body && typeof body === 'object' && body.__stream === true);
    }
    get body() { return { __stream: true, of: this }; }
    clone() {
      const r = new FakeResponse(this._body, { status: this.status, headers: this.headers });
      r._parent = state; return r;
    }
    /* ⚠ ONLY THE DOCUMENT COUNTS. Reading /version.txt to text is the whole
       point of the fix, so counting every .text() made the candidate look as
       bad as the control — nine bytes and seventeen megabytes are not the same
       act. */
    async text() { if (this._body === BIG) state.textReads++; return this._body; }
    async arrayBuffer() { state.bufferReads++; return new ArrayBuffer(8); }
  }

  const cacheObj = {
    match: async () => opts.cached
      ? new FakeResponse(BIG, { headers: new FakeHeaders({ 'x-shell-version': opts.cachedVer }) })
      : undefined,
    put: async (key, res) => { state.put = { key, isStream: !!res.bodyIsStream, ver: res.headers.get('x-shell-version') }; },
  };
  const scope = {
    caches: { open: async (n) => { state.cacheOpened.push(n); return cacheObj; } },
    fetch: async (u) => {
      state.fetched.push(String(u).split('?')[0]);
      if (String(u).indexOf('/version.txt') === 0) {
        if (opts.versionFails) throw new Error('offline');
        return new FakeResponse(opts.liveVer, {});
      }
      return new FakeResponse(BIG, {});
    },
    Headers: FakeHeaders,
    Response: FakeResponse,
    setTimeout, Promise, Error, Date, RegExp, console: { log() {}, warn() {} },
    state,
  };
  const body = PREAMBLE + shellFn +
               '\nreturn { serveShell, state };';
  const fn = new Function(...Object.keys(scope), body);
  return { run: fn(...Object.values(scope)), state };
};

/* ── 1. the update path: cached version is stale ── */
{
  const { run, state } = mk({ cached: true, cachedVer: 'v121v190', liveVer: 'v121v191' });
  const waited = [];
  await run.serveShell({ waitUntil: (p) => waited.push(p) });
  await Promise.all(waited);

  ok(state.textReads === 0, 'the document is never read to text', state.textReads + ' text read(s)');
  ok(state.bufferReads === 0, '…nor to a buffer', state.bufferReads + ' buffer read(s)');
  ok(!!state.put, 'the shell is still cached after an update');
  ok(state.put && state.put.isStream === true, '…and what is cached is a STREAM, not a string');
  ok(state.put && state.put.ver === 'v121v191', '…carrying the live version so the fast path keeps working', state.put && state.put.ver);
  ok(state.fetched.filter(u => u.indexOf('version.txt') >= 0).length >= 1,
     'the version comes from /version.txt, not from parsing the document');
}

/* ── 2. the fast path: cached version already matches ── */
{
  const { run, state } = mk({ cached: true, cachedVer: 'v121v191', liveVer: 'v121v191' });
  const waited = [];
  const res = await run.serveShell({ waitUntil: (p) => waited.push(p) });
  await Promise.all(waited);
  ok(!!res, 'a matching cached shell is returned');
  ok(state.fetched.indexOf('/') < 0, '…without fetching the 17 MB document at all', JSON.stringify(state.fetched));
  ok(state.put === null, '…and without rewriting the cache');
}

/* ── 3. no version, no cache entry ── */
{
  const { run, state } = mk({ cached: false, liveVer: 'v121v191', versionFails: true });
  const waited = [];
  await run.serveShell({ waitUntil: (p) => waited.push(p) });
  await Promise.all(waited);
  ok(state.put === null, 'a version that cannot be read caches NOTHING (an unversioned shell would be served for ever)');
  ok(state.textReads === 0, '…and still never reads the document to text');
}

console.log(fails ? ('\n❌ ' + fails + ' FAILED\n') : '\n✅ the worker never materialises the app\n');
process.exit(fails ? 1 : 0);
