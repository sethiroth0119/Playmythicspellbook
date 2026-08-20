#!/usr/bin/env node
/* 🪟 OVERLAY STACKING — anything Just Business opens must draw ABOVE the
   Just Business iframe.

   The bug this exists for: the Weapon Smith bench was z-index 9600 while
   #jb-frame is 2147483300. Clicking "The Weapon Smith" in the JB sidebar
   opened the bench UNDERNEATH a full-screen iframe, so it looked like nothing
   happened — and clicking any other business tore the iframe down and revealed
   the bench that had been open the whole time. The reported symptom was "it
   does not work unless you click it and then click another business", which
   sounds like a routing bug and is really a paint-order one.

   Nothing about this is visible to a syntax check, a module parse, or any test
   that does not render — which is why it shipped. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = process.env.MP_SRC || join(ROOT, 'public', 'index.html');
const idx = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  — ' + extra : '')); }
};

console.log('\n── overlay stacking ──');

/* The iframe's own z-index, read from source rather than hardcoded here, so
   raising it can never quietly invalidate this whole file. */
const frame = idx.match(/f\.id = FID;[\s\S]{0,400}?z-index:(\d+)/);
const FRAME_Z = frame ? parseInt(frame[1], 10) : NaN;
ok('found the #jb-frame z-index in index.html', Number.isFinite(FRAME_Z), String(FRAME_Z));
console.log('  ·  #jb-frame z-index = ' + FRAME_Z);

/* Every sub-app an action handler can open from the JB sidebar. Each entry is
   (label, file, regex capturing its overlay z-index). */
const SURFACES = [
  ['weapon smith bench', 'public/src/weaponsmith/render.js', /position:fixed;inset:0;z-index:(\d+)/],
  ['storage office / market', 'public/src/storage/index.js', /position:fixed;inset:0;z-index:(\d+)/],
];

for (const [label, rel, re] of SURFACES) {
  let z = NaN;
  try { const m = readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n').match(re); if (m) z = parseInt(m[1], 10); } catch (e) {}
  ok(label + ' draws above the JB iframe', Number.isFinite(z) && Number.isFinite(FRAME_Z) && z > FRAME_Z,
     'z=' + z + ' vs frame=' + FRAME_Z);
}

/* The leave-transition curtains must stay BELOW the iframe, or exiting JB
   would paint over the very thing it is fading. They bracket 2147483290-99. */
const curtains = [...idx.matchAll(/z-index:(21474832\d\d);background:#0b0b10/g)].map((m) => parseInt(m[1], 10));
ok('the JB curtains sit below the iframe', curtains.length > 0 && curtains.every((z) => z < FRAME_Z),
   curtains.join(','));

/* ⚠ THE ELEVENTH DEPLOY KNOB. The iframe is requested as `corp/?v=NNN`. sw.js is
   cache-first for sub-resources, so bumping the jsx tags INSIDE corp/index.html
   does nothing if corp/index.html itself is served from cache — the new sidebar
   entries simply never appear for a returning player. The two must move
   together, so assert the URL carries a version at all and that the corp app's
   own script tags do too. */
const corpUrl = idx.match(/f\.src = 'corp\/\?v=([0-9a-z]+)'/);
ok('the JB iframe URL carries a cache-buster', !!corpUrl, corpUrl ? corpUrl[1] : 'missing');
let corpHtml = '';
try { corpHtml = readFileSync(join(ROOT, 'public/corp/index.html'), 'utf8'); } catch (e) {}
const jsxV = [...corpHtml.matchAll(/\.jsx\?v=([0-9a-z]+)/g)].map((m) => m[1]);
ok('every corp .jsx tag is versioned', jsxV.length >= 3, jsxV.join(','));
ok('the corp .jsx tags agree with each other', new Set(jsxV).size === 1, jsxV.join(','));


/* 🏙 THE CITY HOST BAR. Three parent-side pills sit over the node-city iframe.
   They used to be independently position:fixed with HARDCODED right offsets
   (14 / 168 / 378) and they overlapped: "Buy storage from player" measures
   244 px against the 210 px the next offset allowed — a 34 px overrun, measured
   in a real browser. That label also FLIPS to "Send to your storage", a
   different width, so no single offset can be correct for both states.

   A flex row removes the arithmetic. These assertions exist because a returning
   hardcoded offset looks perfectly reasonable in a diff. */
const cityBar = idx.slice(idx.indexOf('const bar = document.createElement'),
                          idx.indexOf('function _closeNodeCity'));
ok('the city chrome is one flex row',
   /node-city-hostbar/.test(cityBar) && /display:flex/.test(cityBar));
ok('the row wraps rather than overflowing', /flex-wrap:wrap/.test(cityBar));
ok('the bar itself cannot eat map clicks', /pointer-events:none/.test(cityBar));
ok('its buttons re-enable pointer events',
   (cityBar.match(/pointer-events:auto/g) || []).length >= 3);
ok('layout order is explicit, not creation order',
   (cityBar.match(/order:[1234];/g) || []).length === 3);
ok('the Zones pill sits between Buy storage and Leave city',
   idx.includes("p.id = 'node-city-zones'")
   && idx.includes("'order:3;flex:none")
   && idx.includes("x.style.cssText = 'order:4;"));

/* 🗺 The Zones pill drives node-city's OWN #ncsb-demand button across the
   same-origin boundary, then hides the original so the control is not offered
   twice. The ORDERING is the safety property: hiding first and failing after
   would take the Zone Demand dock away with no way back. */
ok('the Zones pill drives the real button, not a copy',
   idx.includes("getElementById('ncsb-demand')") && idx.includes('src.click()'));
ok('the original is hidden only AFTER ours is appended',
   idx.indexOf('bar.appendChild(p);') > 0
   && idx.indexOf("src.style.display = 'none'") > idx.indexOf('bar.appendChild(p);'));
ok('a missing status bar leaves the city button alone',
   idx.includes('if (++tries < 40) setTimeout(mount, 250);'));
ok('state is mirrored from the source, not tracked locally',
   idx.includes('new MutationObserver(paint)')
   && idx.includes("attributeFilter: ['aria-expanded', 'class']"));
/* The host chrome must run on the iframe LOAD event. Running it on append
   reads the placeholder about:blank document a fresh iframe carries — which
   has a documentElement, so the gutter wrote the variable into a document that
   was about to be discarded and returned as though it had worked. That made
   --host-gutter a no-op for its whole life. */
ok('the city chrome runs on iframe load, not on append',
   idx.includes("f.addEventListener('load', () => {")
   && idx.includes('try { _ncZonePill(); } catch (e) {}'));
ok('the gutter refuses the pre-load about:blank document',
   idx.includes("d.location.href.indexOf('about:blank') !== 0"));

ok('the observer is disconnected on teardown',
   idx.includes('App._ncZoneObs.disconnect()'));

ok('NO hardcoded right offsets remain',
   !/right:\s*(?:168|378)px/.test(cityBar) && !/\(168 \+ 210\)/.test(cityBar));
ok('the gutter measures the ROW, not one pill',
   /_ncHostGutter[\s\S]{0,900}?getElementById\('node-city-hostbar'\)/.test(idx));
ok('teardown removes the bar',
   /node-city-hostbar'\);[\s\S]{0,140}?hb\.remove\(\)/.test(idx));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
