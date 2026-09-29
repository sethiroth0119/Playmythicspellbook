/* 🎚 Photographs the On-Play drawer for two effects, plus the same drawer with
   the gate lifted, so the before/after is one comparison and not a claim.
   Run: node .gauntlet/_fx-gate-shot.mjs */
import { bootPage, openCardEditor, forceOpen } from './_forge-harness.mjs';

const boot = await bootPage({ viewport: { width: 1400, height: 1200 } });
const pg = boot.page;
const cardId = await pg.evaluate(() => {
  const seed = { id: 'fxgate_shot', name: 'Gate Probe', icon: '🧪', type: 'unit', cost: 3,
    hp: 40, atk: 12, def: 8, element: 'fire', rarity: 'rare',
    onPlay: { type: 'drawCards', amount: 2 } };
  Forge.customCards = (Forge.customCards || []).concat([seed]);
  return seed.id;
});
await openCardEditor(pg, cardId);
await pg.evaluate('(' + forceOpen + ')(".editor-field")');
await pg.waitForTimeout(300);

const shot = async (fx, file, lift) => {
  const n = await pg.evaluate((a) => {
    const s = document.getElementById('ed-onplay-type');
    s.value = a.fx;
    s.dispatchEvent(new Event('input', { bubbles: true }));
    s.dispatchEvent(new Event('change', { bubbles: true }));
    if (a.lift) document.querySelectorAll('.fx-off').forEach(e => e.classList.remove('fx-off'));
    const sec = document.getElementById('fx-onplay');
    sec.open = true;
    const flds = [...sec.querySelectorAll('.editor-field')];
    return { h: Math.round(sec.getBoundingClientRect().height),
             fields: flds.length,
             visible: flds.filter(e => e.checkVisibility()).length,
             value: s.value };
  }, { fx, lift });
  const el = await pg.$('#fx-onplay');
  await el.screenshot({ path: '.gauntlet/' + file });
  const st = (await import('node:fs')).statSync('.gauntlet/' + file);
  console.log(file.padEnd(28), 'effect=' + n.value.padEnd(14),
    'drawer height=' + String(n.h).padStart(5) + 'px',
    'editor-fields ' + String(n.visible).padStart(3) + ' of ' + n.fields,
    '  png ' + st.size + ' B');
  return n;
};

const offA = await shot('drawCards', '_fx-gate-drawCards-BEFORE.png', true);
const onA = await shot('drawCards', '_fx-gate-drawCards.png', false);
const onC = await shot('reviveGrave', '_fx-gate-reviveGrave.png', false);
const onD = await shot('damagePerCard', '_fx-gate-damagePerCard.png', false);
const onE = await shot('intimidate', '_fx-gate-intimidate.png', false);
const offB = await shot('boardWipe', '_fx-gate-boardWipe-BEFORE.png', true);
const onB = await shot('boardWipe', '_fx-gate-boardWipe.png', false);
console.log('\ndrawCards  drawer ' + offA.h + 'px → ' + onA.h + 'px  ('
  + Math.round((1 - onA.h / offA.h) * 100) + '% shorter),  fields '
  + offA.visible + ' → ' + onA.visible);
console.log('boardWipe  drawer ' + offB.h + 'px → ' + onB.h + 'px  ('
  + Math.round((1 - onB.h / offB.h) * 100) + '% shorter),  fields '
  + offB.visible + ' → ' + onB.visible);
console.log('page errors:', boot.errors.length ? boot.errors.slice(0, 3) : 'none');
await boot.close();
