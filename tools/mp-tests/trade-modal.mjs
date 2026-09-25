import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
/* Render the trade dialog with a stubbed DOM and assert the HTML it produces.
   The last defect here was a broken string concatenation that left a style
   attribute unterminated — valid JS, valid-looking HTML, and invisible until a
   human looked at the screen. A string assertion catches exactly that class. */
const made = [];
function el(tag) {
  const e = {
    tagName: tag.toUpperCase(), id: '', innerHTML: '', style: { cssText: '' },
    children: [], dataset: {},
    appendChild(c) { this.children.push(c); return c; },
    querySelector() { return el('div'); },
    querySelectorAll() { return []; },
    remove() {},
  };
  made.push(e);
  return e;
}
global.document = {
  createElement: el,
  getElementById: () => null,
  body: { appendChild: (c) => c },
};
global.window = {
  MythicCityTradeBridge: {
    resources: () => ([
      { id: 'food', name: 'Food', icon: '🥫' },
      { id: 'ammo', name: 'Ammo', icon: '🔫' },
      { id: 'water', name: 'Water', icon: '💧' },
    ]),
    chainResources: () => ([
      { id: 'freshWater', name: 'Fresh Water', icon: '💧', cat: 'water' },
      { id: 'rawWater', name: 'Raw Water', icon: '💧', cat: 'water' },
      { id: 'coal', name: 'Coal', icon: '🪨', cat: 'mining' },
      { id: 'food', name: 'Food dupe', icon: '🥫', cat: 'agri' },   // promoted overlap
    ]),
    meta: (id) => ({ id, name: id }),
    toast: () => {},
  },
};

const HERE = dirname(fileURLToPath(import.meta.url));
const mod = await import(pathToFileURL(join(HERE, '..', '..', 'public', 'src', 'citytrade', 'index.js')).href);
mod.open({ cityName: 'GreyDragon' });

const ov = made.find(e => e.id === 'citytrade-overlay');
const html = ov ? ov.innerHTML : '';

const results = [];
const check = (name, cond, detail) => results.push({ name, ok: !!cond, detail: cond ? '' : detail });

// 1. THE DAY BUTTONS — the thing that broke.
const dayBtns = html.match(/<button[^>]*data-d="\d+"[^>]*>/g) || [];
check('all five day buttons render', dayBtns.length === 5, 'found ' + dayBtns.length);
check('each day button closes its style attribute',
  dayBtns.every(b => (b.match(/"/g) || []).length % 2 === 0), 'unbalanced quotes: ' + dayBtns[0]);
for (const d of [1, 3, 7, 14, 30]) {
  const label = d + (d === 1 ? ' day' : ' days');
  check('day button labelled "' + label + '"', html.includes('>' + label + '<'), 'missing');
}
check('no NaN leaked into any style', !/NaN/.test(html), 'NaN present — the old unary-plus bug');

// 2. THE CATALOGUE.
const opts = html.match(/<option /g) || [];
const groups = html.match(/<optgroup label="([^"]*)"/g) || [];
check('options come from BOTH catalogues', opts.length === 2 * 6, 'expected 12 (6 per select), got ' + opts.length);
check('grouped by catalogue and category', groups.length >= 2 * 3, 'groups: ' + groups.join(' | '));
check('a promoted id is not listed twice', (html.match(/value="food"/g) || []).length === 2,
  'food appears ' + (html.match(/value="food"/g) || []).length + ' times across 2 selects');
check('chain goods are grouped under City goods', /City goods · water/.test(html), 'no city-goods group');

// 3. STRUCTURE.
for (const id of ['ct-give-res', 'ct-want-res', 'ct-give-units', 'ct-want-units', 'ct-days', 'ct-preview', 'ct-cancel', 'ct-send']) {
  check('has #' + id, html.includes('id="' + id + '"'), 'missing');
}
check('every tag that opens a style attribute closes it',
  (html.match(/style="/g) || []).length === (html.match(/style="[^"]*"/g) || []).length,
  'an unterminated style attribute survived');
check('partner name is used', html.includes('GreyDragon'), 'partner name missing');

const failed = results.filter(r => !r.ok);
console.log('\n🤝 TRADE DIALOG MARKUP — ' + results.length + ' checks\n');
for (const r of results) console.log('  ' + (r.ok ? '✅' : '❌') + ' ' + r.name + (r.ok ? '' : '  → ' + r.detail));
console.log(failed.length ? '\n  ' + failed.length + ' failed.\n' : '\n  ✅ markup is well-formed.\n');
process.exit(failed.length ? 1 : 0);
