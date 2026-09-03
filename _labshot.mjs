/* ══════════════════════════════════════════════════════════════════════════
   🔬 REAL-BROWSER HARNESS for the containment lab.
   ──────────────────────────────────────────────────────────────────────────
   CLAUDE.md's "Verifying" note says the Browser pane in this environment never
   composites — requestAnimationFrame does not fire, canvas rects read 0x0 — so
   anything that only exists once the scene has RENDERED is invisible to every
   other check in this repo. This drives real Chromium instead, and it is not
   a luxury: it is the only thing that caught the 175-metre researcher.

   THE BUG IT FOUND, as a warning about what "it loads fine" is worth: the GLBs
   downloaded, GLTFLoader initialised, the character entered the scene graph and
   drew 3,043 triangles every frame — and the room looked EMPTY, because the
   model was scaled 103x and the camera was inside its shin. Every state flag
   said success. Only a screenshot disagreed.

   Needs two packages that are deliberately NOT in package.json (CLAUDE.md: no
   new npm dependencies without asking). Install them for the run only:

     npm i --no-save playwright-core three@0.128.0
     node _labshot.mjs [page.html] [outdir]

   Defaults to the deployed-shape page at public/index.html is NOT what this
   opens — pass the self-contained preview build, or any page that registers
   window.MythicBioLab.
   ══════════════════════════════════════════════════════════════════════════ */
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { chromium } from 'playwright-core';

const PAGE = process.argv[2];
const OUT = process.argv[3] || './_labshots';
if (!PAGE || !existsSync(PAGE)) {
  console.error('usage: node _labshot.mjs <page.html> [outdir]');
  process.exit(2);
}
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

/* This container cannot reach cdnjs or jsDelivr, so the two libraries the lab
   loads at runtime are served from node_modules instead. The page is otherwise
   untouched — it runs exactly the code that ships. */
const LOCAL = {
  three: 'node_modules/three/build/three.min.js',
  gltf: 'node_modules/three/examples/js/loaders/GLTFLoader.js',
};
for (const [k, p] of Object.entries(LOCAL)) {
  if (!existsSync(p)) { console.error('missing ' + p + ' — run: npm i --no-save playwright-core three@0.128.0'); process.exit(2); }
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 640 } });
const logs = [];
page.on('console', (m) => logs.push('[' + m.type() + '] ' + m.text()));
page.on('pageerror', (e) => logs.push('[PAGEERROR] ' + e.message));

await page.route('**/*', async (route) => {
  const u = route.request().url();
  if (u.includes('cdnjs') && u.includes('three.min.js')) {
    return route.fulfill({ contentType: 'application/javascript', body: readFileSync(LOCAL.three, 'utf8') });
  }
  if (u.includes('jsdelivr') && u.includes('GLTFLoader')) {
    return route.fulfill({ contentType: 'application/javascript', body: readFileSync(LOCAL.gltf, 'utf8') });
  }
  if (/^(file|data|blob):/.test(u)) return route.continue();
  return route.abort();
});

await page.goto(PAGE.startsWith('http') ? PAGE : 'file://' + (PAGE[0] === '/' ? PAGE : process.cwd() + '/' + PAGE),
  { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(500);
const enter = await page.$('#enter');
if (enter) await enter.click();
await page.waitForTimeout(5500);

const fail = [];
const state = await page.evaluate(() => {
  const L = window.MythicBioLab;
  if (!L) return { error: 'MythicBioLab never registered' };
  const run = L._run && L._run();
  const c = L._chars && L._chars();
  const s = run && run.scene;
  const out = { open: !!L.isOpen(), flat: !!(run && run.flat), gltf: !!(window.THREE && window.THREE.GLTFLoader) };
  if (c) out.chars = { loaded: c.loaded, bare: !!c.bare, suit: !!c.suit, active: !!c.active };
  if (s && c && c.active) {
    const T = s.THREE;
    /* 🔴 MEASURE THE BONES, NOT Box3.setFromObject. On a SKINNED mesh that
       helper reports the BIND-POSE geometry box through matrixWorld, which
       here includes an armature scale of ~0.01 — it answers 0.02 m for a
       character standing 1.75 m tall on screen. That is the very lie this
       harness exists to catch, and the first cut of this file fell for it and
       failed a correct build.
       Bone world positions are in the space the skinned vertices actually land
       in, so they are the honest measurement. The top bone is roughly the
       crown and the lowest is roughly the ankle. */
    let lo = Infinity, hi = -Infinity, bones = 0;
    c.active.root.traverse((o) => {
      if (!o.isBone) return;
      const v = new T.Vector3(); o.getWorldPosition(v);
      lo = Math.min(lo, v.y); hi = Math.max(hi, v.y); bones++;
    });
    out.bones = bones;
    out.headAt = bones ? +hi.toFixed(2) : null;
    out.feetAt = bones ? +lo.toFixed(2) : null;
    // The box helper is reported too, purely so the discrepancy stays visible
    // to whoever reads this next instead of being rediscovered.
    const box = new T.Box3().setFromObject(c.active.holder);
    out.bindBoxHeight_misleading = +(box.max.y - box.min.y).toFixed(3);
  }
  return out;
});

console.log(JSON.stringify(state, null, 2));
if (state.error) fail.push(state.error);
if (state.chars && !state.chars.bare && !state.chars.suit) fail.push('no character models loaded');
if (state.chars && state.chars.active && !state.bones) fail.push('character has no skeleton — skinning did not survive load');
if (state.headAt != null && (state.headAt < 1.2 || state.headAt > 2.6)) {
  fail.push('character stands ' + state.headAt + ' m — expected roughly human (1.2-2.6). ' +
    'A 175 m researcher draws thousands of triangles and looks like an empty room.');
}
if (state.feetAt != null && (state.feetAt < -0.2 || state.feetAt > 0.35)) {
  fail.push('lowest bone is at y=' + state.feetAt + ' — the character is not standing on the floor');
}

await page.screenshot({ path: OUT + '/lab.png' });
console.log('\nscreenshot: ' + OUT + '/lab.png');
if (logs.length) { console.log('\n--- console ---'); for (const l of logs.slice(-15)) console.log(l); }
if (fail.length) { console.log('\n❌ ' + fail.length + ' PROBLEM(S)'); for (const f of fail) console.log('   · ' + f); }
else console.log('\n✅ lab renders, character is human-sized and standing on the floor');

await browser.close();
process.exit(fail.length ? 1 : 0);
