// Runtime validation harness — extracts the main inline <script> from
// public/index.html, parses it (syntax) AND executes it under a Proxy-stub
// global to catch top-level TDZ / ReferenceError (the class of bug that the
// parse-only check misses, e.g. the blank-screen const-ordering crash).
const fs = require('fs');
const vm = require('vm');

const path = process.argv[2] || 'public/index.html';
const html = fs.readFileSync(path, 'utf8');

// Grab the big inline script (the one that is NOT the supabase CDN tag).
const open = html.indexOf('<script>\n', 16000) >= 0 ? html.indexOf('<script>', 16000) : html.indexOf('<script>');
const start = html.indexOf('>', open) + 1;
const end = html.indexOf('</script>', start);
let code = html.slice(start, end);
console.log('Extracted inline script: ' + code.length + ' chars');

// 1) Syntax / parse check.
try {
  new vm.Script(code, { filename: 'index-inline.js' });
  console.log('PARSE: OK');
} catch (e) {
  console.log('PARSE: FAIL — ' + e.message);
  process.exit(1);
}

// 2) Runtime top-level execution under a permissive Proxy global. This
// surfaces TDZ ("Cannot access X before initialization") and ReferenceError
// thrown while the module body evaluates — exactly what broke the page.
const noop = function () { return undefined; };
function makeStub() {
  const fn = function () { return makeStub(); };
  return new Proxy(fn, {
    get(t, p) {
      if (p === Symbol.toPrimitive) return () => 0;
      if (p === 'then') return undefined;          // not a thenable
      if (p === Symbol.iterator) return function* () {};
      if (p === 'length') return 0;
      if (p === 'nodeType') return 1;
      return makeStub();
    },
    set() { return true; },
    apply() { return makeStub(); },
    construct() { return makeStub(); },
    has() { return true; },
  });
}

const sandbox = new Proxy({}, {
  get(t, p) {
    if (p in t) return t[p];
    if (p === 'console') return console;
    if (p === 'Symbol') return Symbol;
    if (p === 'Math') return Math;
    if (p === 'JSON') return JSON;
    if (p === 'Date') return Date;
    if (p === 'Array') return Array;
    if (p === 'Object') return Object;
    if (p === 'String') return String;
    if (p === 'Number') return Number;
    if (p === 'Boolean') return Boolean;
    if (p === 'RegExp') return RegExp;
    if (p === 'Map') return Map;
    if (p === 'Set') return Set;
    if (p === 'Promise') return Promise;
    if (p === 'Error') return Error;
    if (p === 'parseInt') return parseInt;
    if (p === 'parseFloat') return parseFloat;
    if (p === 'isNaN') return isNaN;
    if (p === 'setTimeout' || p === 'setInterval' || p === 'clearTimeout' || p === 'clearInterval' || p === 'requestAnimationFrame') return noop;
    if (p === 'globalThis' || p === 'window' || p === 'self' || p === 'document' || p === 'navigator' || p === 'location' || p === 'localStorage') return makeStub();
    return makeStub();
  },
  set() { return true; },
  has() { return true; },
});

try {
  vm.runInNewContext(code, sandbox, { filename: 'index-inline.js', timeout: 15000 });
  console.log('RUNTIME: OK (top-level executed with no TDZ/ReferenceError)');
} catch (e) {
  console.log('RUNTIME: FAIL — ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : e));
  process.exit(2);
}
console.log('ALL CHECKS PASSED');
