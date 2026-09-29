/* Slices the on-play drawer for one effect into readable strips, so the shot
   can actually be READ instead of squinted at. Run:
   node .gauntlet/_fx-gate-slice.mjs reviveGrave */
import { bootPage, openCardEditor, forceOpen } from './_forge-harness.mjs';
import fs from 'fs';
const fx = process.argv[2] || 'reviveGrave';
const boot = await bootPage({ viewport: { width: 1400, height: 1200 } });
const pg = boot.page;
const cardId = await pg.evaluate(() => {
  const seed = { id: 'fxgate_slice', name: 'Gate Probe', icon: '🧪', type: 'unit', cost: 3,
    hp: 40, atk: 12, def: 8, element: 'fire', rarity: 'rare', onPlay: { type: 'drawCards', amount: 2 } };
  Forge.customCards = (Forge.customCards || []).concat([seed]);
  return seed.id;
});
await openCardEditor(pg, cardId);
await pg.evaluate('(' + forceOpen + ')(".editor-field")');
const info = await pg.evaluate((fx) => {
  const s = document.getElementById('ed-onplay-type');
  s.value = fx;
  s.dispatchEvent(new Event('input', { bubbles: true }));
  s.dispatchEvent(new Event('change', { bubbles: true }));
  const sec = document.getElementById('fx-onplay'); sec.open = true;
  const r = sec.getBoundingClientRect();
  const labels = [...sec.querySelectorAll('.editor-field')].filter(e => e.checkVisibility())
    .map(e => (e.querySelector('label') ? e.querySelector('label').innerText : '').replace(/\s+/g, ' ').trim().slice(0, 60))
    .filter(Boolean);
  return { h: Math.round(r.height), labels };
}, fx);
console.log(fx, 'drawer', info.h + 'px,', info.labels.length, 'labelled visible fields:');
info.labels.forEach(l => console.log('   ·', l));
const el = await pg.$('#fx-onplay');
const window0 = await pg.evaluate(() => window.scrollY);
const n = Math.ceil(info.h / 1100);
for (let i = 0; i < n; i++) {
  const box = await el.boundingBox(); void box;
  await pg.screenshot({ path: `.gauntlet/_fx-slice-${fx}-${i}.png`, fullPage: true,
    clip: { x: box.x, y: box.y + window0 + i * 1100, width: box.width, height: Math.min(1100, info.h - i * 1100) } });
}
console.log('slices:', n);
await boot.close();
