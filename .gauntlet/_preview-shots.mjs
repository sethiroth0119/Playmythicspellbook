/* 📸 PREVIEW SHOTS — what the owner asked to see.

   Opens the REAL card editor through the hardened harness at 1600x1000, forces
   a fixed open-set so the picture is not just "whatever sections happened to be
   open", and writes PNGs plus the same metrics the width piece was judged on.

   Run: node .gauntlet/_preview-shots.mjs [outDir] */
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { bootPage, openCardEditor, REPO } from './_forge-harness.mjs';

const OUT = path.resolve(process.argv[2] || path.join(REPO, '.gauntlet', 'preview'));
mkdirSync(OUT, { recursive: true });

/* The same explicit open-set both sides of the A/B used, so a picture here is
   comparable to the numbers in the run ledger. */
const OPEN = ['fx-identity', 'fx-kind', 'fx-effects', 'fx-onplay'];

const shots = [];
const boot = await bootPage({ viewport: { width: 1600, height: 1000 } });
const page = boot.page;

async function shoot(name, cardId, prep) {
  await openCardEditor(page, cardId);
  await page.evaluate((ids) => {
    document.querySelectorAll('details.fx-sec, details.fx-sub').forEach((d) => { d.open = ids.includes(d.id); });
  }, OPEN);
  if (prep) await prep();
  const m = await page.evaluate(() => {
    const ed = document.querySelector('.card-editor');
    const props = document.querySelector('.fx-props');
    const cs = ed && getComputedStyle(ed);
    const grid = document.querySelector('.fx-two .editor-grid');
    const vis = [...document.querySelectorAll('.editor-field')].filter((e) => e.offsetParent !== null);
    return {
      editorWidth: ed ? Math.round(ed.getBoundingClientRect().width) : 0,
      maxWidth: cs ? cs.maxWidth : '',
      propsScrollHeight: props ? props.scrollHeight : 0,
      fieldsInDom: document.querySelectorAll('.editor-field').length,
      fieldsVisible: vis.length,
      gridCols: grid ? getComputedStyle(grid).gridTemplateColumns : '',
      pageHScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
  const file = path.join(OUT, name + '.png');
  const el = await page.$('.card-editor');
  writeFileSync(file, await el.screenshot());
  shots.push({ name, file, ...m });
  console.log(name.padEnd(22) + ' w=' + String(m.editorWidth).padStart(5)
    + '  props=' + String(m.propsScrollHeight).padStart(6)
    + '  fields ' + m.fieldsVisible + '/' + m.fieldsInDom
    + '  cols=' + m.gridCols);
}

/* 1 — a unit, the everyday case. */
await shoot('01-card-editor', 'NEW');

/* 2 — the same card with an effect chosen, so the gating is visible: a
   many-field effect against a one-field effect, same card, same open-set. */
await shoot('02-onplay-boardWipe', 'NEW', async () => {
  await page.evaluate(() => {
    const s = document.getElementById('ed-onplay-type');
    if (s) { s.value = 'boardWipe'; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); }
  });
});
await shoot('03-onplay-drawCards', 'NEW', async () => {
  await page.evaluate(() => {
    const s = document.getElementById('ed-onplay-type');
    if (s) { s.value = 'drawCards'; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); }
  });
});

/* releaseForced() runs IN the page; this driver closes the browser instead. */
await boot.close();
writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify(shots, null, 1));
console.log('\nwrote ' + shots.length + ' shots to ' + OUT);
process.exit(0);
