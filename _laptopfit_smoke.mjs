/* 🖥 bug-mtxq2arc — "Certain areas do not show well on a laptop. When I go
   into the city, most of the time it does not show the city in full screen.
   Also in the camp when parked." (Windows 11 laptop, desktop app.)

   ROOT CAUSE (measured with the real open path in Chromium, from the field
   hub): the legacy app zooms <html> to fit laptops (0.735–0.882 at
   1280×720 … 1536×864) and EXEMPTS the fullscreen iframe apps — but the
   exemption is only evaluated on resize and at the end of render(), and
   _openNodeCity is an overlay that never calls render(). So the city frame,
   sized 100vw×100vh, was drawn at zoom × viewport: 1070×602 of 1366×768.

   THE FIX: a childList MutationObserver on <body> re-runs _uiAutoScale()
   whenever a frame is added or removed. This suite lifts the REAL
   _uiAutoScale, _deviceClass and the init block out of public/index.html
   and runs them on a stub DOM:

     1. a laptop page screen is zoomed (the premise)
     2. appending #node-city-frame drops the zoom to 1 with NO render()
     3. removing it restores the page zoom
     4. the camp bunker frame does the same, and an unrelated <div> does not
        change anything
     5. the observer watches <body> childList only (not the subtree)
     6. NEGATIVE CONTROL: the same init block with the observer cut out leaves
        the zoom at 0.78 under the city — the reported bug, reproduced.

   Run: node _laptopfit_smoke.mjs */
import { readFileSync } from 'fs';

let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (c) passes++; else fails++; };

const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
function fnText(name) {
  const i = SRC.indexOf('\nfunction ' + name + '(');
  if (i < 0) throw new Error('cannot find function ' + name);
  let d = 0, started = false;
  for (let j = i; j < SRC.length; j++) {
    const c = SRC[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return SRC.slice(i, j + 1); }
  }
  throw new Error('unbalanced ' + name);
}
// The init block: from the resize listener to the __mg namespace line.
const A = "  window.addEventListener('resize', () => { try { _uiAutoScale(); } catch (e) {} }, { passive: true });";
const B = '  window.__mg = window.__mg || {};';
const ia = SRC.indexOf(A), ib = SRC.indexOf(B, ia);
if (ia < 0 || ib < 0) throw new Error('cannot find the _uiAutoScale init block');
const INIT = SRC.slice(ia, ib);

/* A DOM just big enough: <html> with a style.zoom and a dataset, a <body>
   whose appendChild/removeChild notify MutationObservers watching it. */
function world(w, h, initText) {
  const observers = [];
  const kids = [];
  const de = { style: { zoom: '' }, dataset: {} };
  const body = {
    appendChild(el) { kids.push(el); el.parentNode = body; notify(); return el; },
    removeChild(el) { const i = kids.indexOf(el); if (i >= 0) kids.splice(i, 1); notify(); return el; },
  };
  function notify() { for (const o of observers) if (o.target === body && o.opts && o.opts.childList) o.cb([], o); }
  class MO { constructor(cb) { this.cb = cb; } observe(t, o) { this.target = t; this.opts = o; observers.push(this); } disconnect() {} }
  const document = {
    documentElement: de, body, readyState: 'complete', addEventListener() {},
    getElementById: (id) => kids.find((k) => k.id === id) || null,
    querySelector: (sel) => (/iframe\[id\*="jb"\]/.test(sel) ? kids.find((k) => /jb|just/.test(k.id || '')) || null : null),
    createElement: (tag) => ({ tagName: tag, id: '', style: {} }),
  };
  const App = { screen: 'title', titleHub: 'field', _uiZoom: undefined };
  const env = {
    window: { innerWidth: w, innerHeight: h, addEventListener() {}, visualViewport: null },
    document, App, localStorage: { getItem: () => null }, MutationObserver: MO,
    matchMedia: () => ({ matches: false }), setTimeout: (f) => f(),
  };
  const code = fnText('_deviceClass') + '\n' + fnText('_uiAutoScale') + '\ntry {\n' + initText + '\n} catch (e) { throw e; }\nreturn { _uiAutoScale };';
  const F = new Function(...Object.keys(env), code)(...Object.values(env));
  return { ...env, observers, F, zoom: () => de.style.zoom || '1' };
}

console.log('\n=== 1–3. the city frame at 1366×768 ===');
{
  const W = world(1366, 768, INIT);
  ok(W.zoom() !== '1' && Math.abs(parseFloat(W.zoom()) - 0.7837) < 0.01, 'a laptop page screen is zoomed (' + W.zoom() + ')');
  const f = W.document.createElement('iframe'); f.id = 'node-city-frame';
  W.document.body.appendChild(f);            // exactly what _openNodeCity does — no render()
  ok(W.zoom() === '1', 'appending the city frame drops the zoom to 1 with no render() (' + W.zoom() + ')');
  f.id = 'node-city-frame-closing';           // _closeNodeCity's 400 ms fade
  W.F._uiAutoScale();
  ok(W.zoom() === '1', 'still 1 while the frame fades out under its -closing id');
  W.document.body.removeChild(f);
  ok(Math.abs(parseFloat(W.zoom()) - 0.7837) < 0.01, 'removing it restores the page zoom (' + W.zoom() + ')');
}

console.log('\n=== 4. the camp bunker, other laptop sizes, and unrelated nodes ===');
{
  for (const [w, h] of [[1536, 864], [1280, 720]]) {
    const W = world(w, h, INIT);
    const z0 = W.zoom();
    const f = W.document.createElement('iframe'); f.id = 'base-builder-frame';
    W.document.body.appendChild(f);
    const z1 = W.zoom();
    W.document.body.removeChild(f);
    ok(z0 !== '1' && z1 === '1' && W.zoom() === z0, w + '×' + h + ': camp bunker frame ' + z0 + ' → ' + z1 + ' → ' + W.zoom());
  }
  const W = world(1366, 768, INIT);
  const before = W.zoom();
  W.document.body.appendChild({ id: 'some-toast', style: {} });
  ok(W.zoom() === before, 'an unrelated body child changes nothing (' + W.zoom() + ')');
}

console.log('\n=== 5. the observer is narrow ===');
{
  ok(/\.observe\(document\.body, \{ childList: true \}\)/.test(INIT) && !/subtree/.test(INIT.replace(/\/\*[\s\S]*?\*\//g, '')), 'body childList only — no subtree');
  ok(/bug-mtxq2arc/.test(INIT), 'the block names the bug it fixes');
}

console.log('\n=== 6. NEGATIVE CONTROL: without the observer the city opens zoomed ===');
{
  const cut = INIT.replace(/new MutationObserver\([\s\S]*?\.observe\(document\.body, \{ childList: true \}\);/, '');
  ok(cut !== INIT, 'the control really removed the observer');
  const W = world(1366, 768, cut);
  const f = W.document.createElement('iframe'); f.id = 'node-city-frame';
  W.document.body.appendChild(f);
  ok(W.zoom() !== '1', 'with no observer the city frame sits under zoom ' + W.zoom() + ' — drawn at ~78% of the screen, as reported');
}

console.log('\n' + (fails ? '❌ ' + fails + ' failed, ' + passes + ' passed' : '✅ all clear (' + passes + ' passed)'));
process.exit(fails ? 1 : 0);
