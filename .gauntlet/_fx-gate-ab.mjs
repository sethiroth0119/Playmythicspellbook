/* A/B of the on-play drawer against a tree given on the command line — used to
   put HEAD's number (no gate at all) beside the working tree's, in the SAME
   viewport, since drawer height is viewport-dependent and an A/B across two
   window sizes is not one. Run: node .gauntlet/_fx-gate-ab.mjs D:/fxhead */
import { bootPage, openCardEditor, forceOpen } from './_forge-harness.mjs';
const cwd = process.argv[2] || 'D:/game-deploy';
const boot = await bootPage({ cwd, assetsFrom: 'D:/game-deploy', viewport: { width: 1400, height: 1200 } });
const pg = boot.page;
const id = await pg.evaluate(() => {
  const seed = { id: 'fxgate_ab', name: 'Gate Probe', icon: '🧪', type: 'unit', cost: 3,
    hp: 40, atk: 12, def: 8, element: 'fire', rarity: 'rare', onPlay: { type: 'drawCards', amount: 2 } };
  Forge.customCards = (Forge.customCards || []).concat([seed]);
  return seed.id;
});
await openCardEditor(pg, id);
await pg.evaluate('(' + forceOpen + ')(".editor-field")');
const out = await pg.evaluate(() => {
  const r = { gate: typeof _fxApplyEffectGate === 'function', per: {} };
  const sel = document.getElementById('ed-onplay-type');
  const sec = document.getElementById('fx-onplay'); sec.open = true;
  for (const fx of ['drawCards', 'boardWipe', 'reviveGrave', 'damagePerCard', 'intimidate', 'paintSurface']) {
    sel.value = fx;
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    const f = [...sec.querySelectorAll('.editor-field')];
    r.per[fx] = { visible: f.filter(e => e.checkVisibility()).length, of: f.length,
                  h: Math.round(sec.getBoundingClientRect().height) };
  }
  r.controlsInDom = document.querySelectorAll('[id^="ed-onplay-"]').length;
  return r;
});
console.log(cwd, JSON.stringify(out, null, 1));
await boot.close();
