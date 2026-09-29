/* 🖥 A REFUSED GRAPHICS CONTEXT RETRIES INSTEAD OF LEAVING A DEAD CITY.
   Run: node _citygl_smoke.mjs
   ═══════════════════════════════════════════════════════════════════════════
   Tracker: bug-mtr5xz8t (high, reopened twice) — "Managed cities not loading
   first time after a break of more than a couple of hours… sit on the blank
   gameplay screen with just the control bars… you have to exit the city and
   re-enter."

   After a long idle the browser can refuse new WebGL contexts until its GPU
   process recovers. `new WebGLRenderer()` then throws at the top of the city's
   module and nothing below it runs. REPRODUCED in Chromium with the first
   getContext refused: stuck on "detecting renderer…", one load in 20 s. With
   this change (.gauntlet/citygl-probe.mjs): refused once → 2 loads, city
   drawn; never given a context → 7 loads (1 + 6 retries), then a working
   "Try again" button.

   This is the static half; §3 runs the real _glRefused against a fake page.
   §4 is a negative control: without the rethrow the module would carry on
   and draw a half-built city — the check that holds it must notice. */
import { readFileSync } from 'fs';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/node-city/index.html', 'utf8').replace(/\r\n/g, '\n');

function fnText(name, src) {
  const s = src || SRC;
  const i = s.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name);
  let d = 0, started = false;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return s.slice(i, j + 1); }
  }
  throw new Error('unbalanced ' + name);
}

console.log('\n=== 1. the renderer is built inside a guard ===');
const iR = SRC.indexOf('const renderer = (() => {');
const block = iR > 0 ? SRC.slice(iR, SRC.indexOf('})();', iR) + 5) : '';
{
  ok(iR > 0, 'the city renderer is constructed inside a guard, not bare at module top level');
  ok(!/\nconst renderer = _WANT_GPU \? new THREE\.WebGPURenderer/.test(SRC), 'the unguarded constructor is gone');
  ok(/new WebGLRenderer\(\{ antialias: true \}\)/.test(block) && /new THREE\.WebGPURenderer/.test(block), 'both backends are built inside it');
  ok(/catch \(err\) \{\s*_glRefused\(err\);\s*throw err;\s*\}/.test(block),
    'a refusal schedules the retry AND rethrows — nothing below can run without a renderer');
  ok(/sessionStorage\.removeItem\(_GL_RETRY_KEY\)/.test(block), 'a successful build forgets earlier attempts');
  ok(iR < SRC.indexOf("_gl.addEventListener('webglcontextlost'"), 'it runs before the lost-context handler that the earlier fix added');
}

console.log('\n=== 2. the retry is bounded and forgets old attempts ===');
{
  const f = fnText('_glRefused');
  ok(/const _GL_RETRY_MAX = 6;/.test(SRC), 'six retries at most');
  ok(/Date\.now\(\) - \(Number\(prev\.t\) \|\| 0\) < 60000/.test(f), 'attempts older than a minute do not count — a later visit gets a full set');
  ok(/catch \(e\) \{ \/\* no sessionStorage: the count cannot be bounded, so do not loop \*\/ \}/.test(f) && /let n = _GL_RETRY_MAX \+ 1;/.test(f),
    'with no sessionStorage the count cannot be bounded, so it goes straight to the button rather than looping');
}

console.log('\n=== 3. run _glRefused for real ===');
function page(seed) {
  const ss = new Map(seed ? [['mythic_city_gl_retry', JSON.stringify(seed)]] : []);
  const slot = { textContent: 'detecting renderer…', children: [], appendChild(c) { this.children.push(c); } };
  const env = {
    _GL_RETRY_KEY: 'mythic_city_gl_retry', _GL_RETRY_MAX: 6,
    sessionStorage: { getItem: k => ss.has(k) ? ss.get(k) : null, setItem: (k, v) => ss.set(k, String(v)), removeItem: k => ss.delete(k) },
    document: { getElementById: id => id === 'bootgpu' ? slot : null, body: slot, createElement: () => ({ style: {}, set textContent(v) { this.text = v; } }) },
    location: { reloads: 0, reload() { this.reloads++; } },
    setTimeout: (fn) => { env.__timers.push(fn); },
    console: { warn() {} },
    __timers: [],
  };
  const fn = new Function(...Object.keys(env), fnText('_glRefused') + '\nreturn _glRefused;')(...Object.values(env));
  return { fn, env, ss, slot };
}
{
  const P = page();
  P.fn(new Error('Error creating WebGL context.'));
  ok(/retrying \(1 of 6\)/.test(P.slot.textContent), 'the first refusal says so on the splash', P.slot.textContent);
  ok(P.env.__timers.length === 1, 'and schedules exactly one reload');
  P.env.__timers[0]();
  ok(P.env.location.reloads === 1, 'which reloads the city — the exit-and-re-enter players were doing by hand');
  ok(JSON.parse(P.ss.get('mythic_city_gl_retry')).n === 1, 'the attempt is recorded for the next load');

  const Q = page({ n: 6, t: Date.now() });
  Q.fn(new Error('x'));
  ok(Q.env.__timers.length === 0, 'the seventh refusal schedules nothing — the loop stops');
  ok(Q.slot.children.length === 1 && Q.slot.children[0].text === 'Try again', '…and offers a Try again button instead');
  Q.slot.children[0].onclick();
  ok(!Q.ss.has('mythic_city_gl_retry') && Q.env.location.reloads === 1, 'the button clears the count and reloads');

  const R = page({ n: 6, t: Date.now() - 5 * 60000 });
  R.fn(new Error('x'));
  ok(R.env.__timers.length === 1 && /\(1 of 6\)/.test(R.slot.textContent), 'a count from five minutes ago is ignored: a later visit starts at 1');
}

console.log('\n=== 4. NEGATIVE CONTROL — drop the rethrow ===');
{
  const broken = block.replace(/_glRefused\(err\);\s*throw err;/, '_glRefused(err);');
  ok(broken !== block, 'the control removed the rethrow');
  ok(!/catch \(err\) \{\s*_glRefused\(err\);\s*throw err;\s*\}/.test(broken),
    'the §1 check sees it gone — without the rethrow the module would go on building a city with no renderer');
}

console.log(fails ? `\n❌ ${fails} FAILED\n` : '\n✅ a refused graphics context retries, then asks\n');
process.exit(fails ? 1 : 0);
