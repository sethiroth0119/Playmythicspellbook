/* Envoy modal card art. Owner screenshot: "Mosquito Beamer" drawn as 🦄 —
   "Have this show the card art". The bridge read only the resident art map.
   Seeds art the way a live account holds a card it has not drawn this session
   (stable cloud URL only; or catalogue artUrl only), and checks the bridge AND
   the rendered modal. Usage: node .gauntlet/envoyart-probe.mjs [candidate.html] */
import { chromium } from 'playwright';
import fs from 'node:fs';
const b = await chromium.launch();
const p = await b.newPage();
if (process.argv[2]) {
  const html = fs.readFileSync(process.argv[2], 'utf8');
  await p.route('**/index.html', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
}
await p.goto('http://localhost:8787/index.html', { waitUntil: 'load', timeout: 60000 });
await p.waitForFunction(() => window.MythicInfluenceBridge && typeof window.MythicInfluenceBridge.cardArt === 'function');
const out = await p.evaluate(async () => {
  const R = [];
  const ok = (l, c, d) => R.push({ l, c: !!c, d: String(d) });
  const CLOUD = 'https://art.example/mosquito-beamer.png';
  const CAT = 'https://art.example/published-only.png';
  Forge.cardArtUrl = Object.assign({}, Forge.cardArtUrl || {}, { mosquito_beamer: CLOUD });
  if (Forge.cardArt) { delete Forge.cardArt.mosquito_beamer; delete Forge.cardArt.pub_only; }
  Forge.customCards = (Forge.customCards || []).concat([{ id: 'pub_only', name: 'Published Only', type: 'unit', artUrl: CAT }]);
  const a1 = window.MythicInfluenceBridge.cardArt('mosquito_beamer');
  ok('bridge: a card not resident this session still returns its cloud art', a1 === CLOUD, a1);
  const a2 = window.MythicInfluenceBridge.cardArt('pub_only');
  ok('bridge: a card whose art is only its published artUrl returns it', a2 === CAT, a2);
  const a3 = window.MythicInfluenceBridge.cardArt('no_such_card_zz');
  ok('bridge: a card with no art anywhere returns null (emoji fallback stays)', !a3, a3);
  // rendered modal, through the module's own renderer
  try {
    const R2 = await import('/src/influence/render.js');
    const mount = R2.mount || (R2.default && R2.default.mount);
    const view = { levelMeta: { icon: '🎖', name: 'Noted' }, parts: {}, progress: {}, nodeTier: { name: 'Free' }, repPoints: 0,
      mode: 'offer', busy: false, result: null,
      enc: { kind: 'gift', cardKind: 'unit', envoy: { name: 'Dael Ashwalker', title: 'Pattern Keeper', icon: '📜', line: 'I carry patterns, not goods.' }, card: { id: 'mosquito_beamer', name: 'Mosquito Beamer', type: 'unit', icon: '🦄', rarity: 'common', stats: { hp: 20, atk: 12, def: 8, spd: 1 } } },
      rarityMeta: (id) => window.MythicInfluenceBridge.rarityMeta(id), cardArt: (id) => window.MythicInfluenceBridge.cardArt(id) };
    if (typeof mount === 'function') {
      mount(view, {});
      const img = document.querySelector('.mif-card img.mif-art');
      ok('modal: the card block shows an <img> with that art, not the 🦄 glyph', img && img.getAttribute('src') === CLOUD, img ? img.getAttribute('src') : 'no img');
    } else ok('modal: render.js exports mount', false, Object.keys(R2).join(','));
  } catch (e) { ok('modal rendered', false, e.message); }
  return R;
});
await b.close();
let f = 0;
for (const r of out) { if (!r.c) f++; console.log((r.c ? '  ok   ' : '  FAIL ') + r.l + (r.c ? '' : '  ← ' + r.d)); }
console.log(f ? f + ' FAILED' : 'ALL ' + out.length + ' PASS');
process.exit(f ? 1 : 0);
