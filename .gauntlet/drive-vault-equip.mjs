/* ══════════════════════════════════════════════════════════════════════════
   🎒 DRIVE-VAULT-EQUIP — "items and equipment is not equipping to the hero".

   Reported by the player against the Base Vault (App.screen = 'baseVault').
   The click path exists in source — a press that never becomes a drag opens
   _vaultOpenEquipMenu(), and the code carries a comment saying drag-only was
   "the single point of failure this screen shipped with". So the question is
   not whether the code is there; it is which link in the chain actually breaks.

   This drives the real screen and reports, in order:
     1  does the vault render items at all;
     2  is a hero selected (no hero = nothing to equip TO);
     3  does clicking an item open the equip menu;
     4  does choosing a slot actually write the hero's loadout;
     5  does the slot then RENDER the item.
   Whichever of those is the first to fail is the bug.

   Run:  node .gauntlet/drive-vault-equip.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 7100 + (process.pid % 90);
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 200)));
await page.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost')) return r.continue();
  return r.abort();
});
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('typeof render === "function" && typeof getVaultLayout === "function"',
  null, { timeout: 120000 }).catch(() => {});
await page.waitForTimeout(6000);

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  OK   ' : '  FAIL ') + name + (detail == null ? '' : '   ' + detail));
};

/* ── Put a hero and some gear in front of us, then open the screen. ─────── */
console.log('\n0. open the Base Vault with a hero and real items');
const setup = await page.evaluate(async () => {
  const out = {};
  const heroes = (typeof getAllHeroes === 'function') ? getAllHeroes() : [];
  out.heroCount = heroes.length;
  out.heroId = heroes[0] ? heroes[0].id : null;
  App.vaultHeroId = out.heroId;

  /* Give the vault something to hold. getItemById is the catalogue; take the
     first few real ids rather than inventing any. */
  const ids = [];
  try {
    const pool = (typeof HELD_ITEMS === 'object' && HELD_ITEMS) ? Object.keys(HELD_ITEMS) : [];
    for (const id of pool) { if (ids.length < 4) ids.push(id); }
  } catch (e) {}
  out.catalogueIds = ids;
  /* A CUSTOM item with a tag the table does not know — the exact shape the
     player reported (Frag Grenade, Tactical Rig, Swift Boots). Before the fix
     this fitted NO slot and the menu told the player to go re-tag it. */
  try {
    Forge.customItems = Forge.customItems || [];
    if (!Forge.customItems.some((z) => z && z.id === 'drv_boots')) {
      Forge.customItems.push({ id: 'drv_boots', name: 'Swift Boots', icon: '🥾',
                               rarity: 'rare', slotType: 'boots', stats: { spd: 3 } });
    }
    Profile.itemInventory.drv_boots = 1;
    ids.push('drv_boots');
  } catch (e) { out.customErr = String(e).slice(0, 120); }
  try {
    if (!Profile.itemInventory) Profile.itemInventory = {};
    for (const id of ids) Profile.itemInventory[id] = Math.max(1, Profile.itemInventory[id] | 0);
    if (typeof vaultAutoStow === 'function') vaultAutoStow();
  } catch (e) { out.stowErr = String(e).slice(0, 120); }

  App.screen = 'baseVault';
  render();
  await new Promise((r) => setTimeout(r, 900));
  const v = getVaultLayout();
  return Object.assign(out, {
    placements: (v.placements || []).length,
    domItems: document.querySelectorAll('.vault-item').length,
    slotEls: document.querySelectorAll('[data-vault-slot]').length,
  });
});
console.log('   ' + JSON.stringify(setup));
ok('a hero exists to equip TO', !!setup.heroId, setup.heroCount + ' heroes');
ok('the item catalogue is non-empty', (setup.catalogueIds || []).length > 0);
ok('the vault holds placements', (setup.placements | 0) > 0, setup.placements + ' placed');
ok('items render in the grid', (setup.domItems | 0) > 0, setup.domItems + ' .vault-item');
ok('the hero panel renders slots', (setup.slotEls | 0) > 0, setup.slotEls + ' slots');

if (!setup.domItems) {
  console.log('\nNo items in the grid — nothing to click. Stopping here.');
  console.log(errs.slice(0, 4).join('\n'));
  await browser.close(); server.close(); process.exit(1);
}

/* ── Which slots does the code think these items fit? ──────────────────── */
console.log('\n1. does the fit test accept these items at all');
const fit = await page.evaluate(() => {
  const v = getVaultLayout();
  return (v.placements || []).slice(0, 5).map((p) => {
    const it = getItemById(p.itemId);
    const slots = (typeof itemFittingSlots === 'function' && it) ? itemFittingSlots(it) : [];
    return { id: p.itemId, name: it ? it.name : '(no catalogue row)',
             slotType: it ? (it.slotType || it.slot || '(none)') : '-',
             fits: slots.map((s) => s.key) };
  });
});
fit.forEach((f) => console.log('   ' + String(f.name).padEnd(24) + 'slotType=' + String(f.slotType).padEnd(12) + 'fits: ' + (f.fits.join(', ') || 'NOTHING')));
ok('at least one item fits at least one slot', fit.some((f) => f.fits.length > 0),
   fit.every((f) => !f.fits.length) ? 'every item fits nothing — itemSlotFit is the bug' : '');

/* ── The actual click. ─────────────────────────────────────────────────── */
console.log('\n2. clicking an item opens the equip menu');
const clicked = await page.evaluate(async () => {
  const el = document.querySelector('.vault-item');
  const r = el.getBoundingClientRect();
  const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
  const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0, pointerId: 1 };
  el.dispatchEvent(new PointerEvent('pointerdown', opts));
  window.dispatchEvent(new PointerEvent('pointerup', opts));      // no movement = a click
  await new Promise((res) => setTimeout(res, 500));
  const menu = document.querySelector('#vault-eqm, .vault-eqm');
  return {
    uid: el.dataset.uid, itemId: el.dataset.itemId,
    menuFound: !!menu,
    menuText: menu ? menu.innerText.replace(/\s+/g, ' ').slice(0, 160) : '',
    buttons: menu ? menu.querySelectorAll('[data-eqm-slot]').length : 0,
  };
});
console.log('   ' + JSON.stringify(clicked));
ok('the equip menu opened on a plain click', clicked.menuFound,
   clicked.menuFound ? clicked.buttons + ' slot rows · ' + clicked.menuText
                     : 'no #vault-eqm appeared — the click path is the bug');

/* ── Does equipping actually write the loadout, and does it render? ─────── */
console.log('\n3. equipping writes the loadout AND the slot renders it');
const equipped = await page.evaluate(async () => {
  const heroId = App.vaultHeroId;
  const v = getVaultLayout();
  /* Skip placements whose id resolves to no catalogue row — placements[0] is
     'none', which is not an item and cannot fit anything. */
  const phantom = (v.placements || []).filter((z) => !getItemById(z.itemId)).map((z) => z.itemId);
  const pl = (v.placements || []).find((z) => !!getItemById(z.itemId));
  if (!pl) return { err: 'no placement resolves to a catalogue item', phantom };
  const it = getItemById(pl.itemId);
  const slots = itemFittingSlots(it);
  if (!slots.length) return { err: 'this item fits no slot' };
  const before = JSON.parse(JSON.stringify(getHeroLoadout(heroId)));
  setHeroLoadoutSlot(heroId, slots[0].key, pl.itemId);
  const after = JSON.parse(JSON.stringify(getHeroLoadout(heroId)));
  render();
  await new Promise((r) => setTimeout(r, 700));
  const slotEl = document.querySelector('[data-vault-slot="' + slots[0].key + '"]');
  return {
    slot: slots[0].key, itemId: pl.itemId,
    beforeVal: before[slots[0].key] || null,
    afterVal: after[slots[0].key] || null,
    slotHtmlLen: slotEl ? slotEl.innerHTML.length : -1,
    slotShowsSomething: !!(slotEl && slotEl.innerHTML.length > 40),
    phantom,
    /* Every rendered item element, checked against the catalogue. */
    renderedPhantoms: [...document.querySelectorAll('.vault-item')]
      .filter((n) => !getItemById(n.dataset.itemId)).length,
  };
});
console.log('   ' + JSON.stringify(equipped));
if (equipped.err) ok('an item was equippable', false, equipped.err);
else {
  ok('setHeroLoadoutSlot wrote the slot', equipped.afterVal === equipped.itemId,
     String(equipped.beforeVal) + ' -> ' + String(equipped.afterVal));
  ok('...and the slot RENDERS the equipped item', !!equipped.slotShowsSomething,
     'slot html ' + equipped.slotHtmlLen + ' chars');
  /* 🧹 The stray placement is filtered from the RENDER, not deleted from the
     saved layout — this is player data and a cleanup pass is a separate,
     riskier decision. So the assertion is on what was actually fixed: no
     rendered cell points at a non-item. The data-level count is REPORTED. */
  ok('no RENDERED cell points at a non-item',
     equipped.renderedPhantoms === 0,
     equipped.renderedPhantoms + ' rendered · ' + (equipped.phantom || []).length +
     ' still in the saved layout (filtered at render, not deleted)');
}

console.log('\npage errors: ' + errs.length);
errs.slice(0, 5).forEach((e) => console.log('   ' + e));
console.log(fails ? '\n' + fails + ' CHECK(S) FAILED — the first FAIL above is the bug' : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fails ? 1 : 0);
