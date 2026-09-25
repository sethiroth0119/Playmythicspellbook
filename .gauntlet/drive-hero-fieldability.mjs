/* ══════════════════════════════════════════════════════════════════════════
   ✦ DRIVE-HERO-FIELDABILITY — "give heroes Field abilities they can activate.
   I added them, it does not work."

   Authored in the Forge's EDIT CARD screen, which offers the Field Ability
   block for heroes exactly as it does for units. The block saves onto the card
   as `fieldActive`.

   THE SUSPECT, read from the source. _fieldAbilityOf() resolves a definition
   like this:

       const id = u.cardId || u.originalCardId || u.id;
       const def = id ? _cardDefById(id) : null;

   A hero's BATTLE unit is built (index.html, the hero unit factory) as
   `{ id: uid(), isHero: true, heroId: heroData.id, … }` — it carries no
   `cardId` and no `originalCardId`. So the chain falls through to `u.id`,
   which is a freshly generated INSTANCE id, `_cardDefById` cannot match it,
   and the function returns null. No ability → no hover row → nothing to press,
   for every hero, always. Units are unaffected because a unit DOES carry
   cardId.

   The control is the whole point: the SAME fieldActive on a UNIT must work, or
   the bug is somewhere else entirely and this file is blaming the wrong line.

   Run:  node .gauntlet/drive-hero-fieldability.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 7700 + (process.pid % 80);
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
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
await page.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost')) return r.continue();
  return r.abort();
});
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('typeof _fieldAbilityOf === "function"', null, { timeout: 120000 }).catch(() => {});
await page.waitForTimeout(5000);

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  OK   ' : '  FAIL ') + name + (detail == null ? '' : '   ' + detail));
};

const r = await page.evaluate(() => {
  const out = {};
  /* The exact shape the Forge's Field Ability block writes. */
  const FA = { label: 'Shadow Vexing', energyCost: 2, oncePerTurn: true,
               effect: { type: 'weather', amount: 0, radius: 1, chance: 100,
                         status: 'ambushGuard', duration: 2 } };

  /* ── author a custom HERO carrying it, the way the Forge saves one ──────── */
  Forge.customCards = Forge.customCards || [];
  const HID = 'drv_hero_fa';
  if (!Forge.customCards.some((c) => c && c.id === HID)) {
    Forge.customCards.push({ id: HID, type: 'hero', name: 'Driver Hero', icon: '🦇',
                             maxHp: 250, stats: { atk: 10, def: 5 }, fieldActive: FA });
  }
  /* ── and a custom UNIT carrying the same thing — the control ────────────── */
  const UID = 'drv_unit_fa';
  if (!Forge.customCards.some((c) => c && c.id === UID)) {
    Forge.customCards.push({ id: UID, type: 'unit', name: 'Driver Unit', icon: '🗡',
                             maxHp: 20, atk: 5, def: 3, fieldActive: FA });
  }
  try { if (typeof _cardDefMemo !== 'undefined') _cardDefMemo = null; } catch (e) {}

  out.heroDefFound = !!(typeof findHeroById === 'function' && findHeroById(HID));
  out.heroDefHasFA = !!(typeof findHeroById === 'function' && (findHeroById(HID) || {}).fieldActive);
  out.unitDefHasFA = !!(typeof _cardDefById === 'function' && (_cardDefById(UID) || {}).fieldActive);

  /* ── battle units, built the way the game builds them ───────────────────── */
  const heroUnit = { id: 'inst_' + Math.floor(1e8 * 0.4242), isHero: true, heroId: HID,
                     name: 'Driver Hero', owner: 'player', alive: true,
                     pos: { x: 3, y: 3 }, hp: 250, maxHp: 250, currentHp: 250, knownMoves: [] };
  const unitUnit = { id: 'inst_u1', cardId: UID, name: 'Driver Unit', owner: 'player',
                     alive: true, pos: { x: 4, y: 3 }, hp: 20, maxHp: 20, currentHp: 20, knownMoves: [] };

  out.faOnHero = !!_fieldAbilityOf(heroUnit);
  out.faOnUnit = !!_fieldAbilityOf(unitUnit);
  out.faOnHeroLabel = (_fieldAbilityOf(heroUnit) || {}).label || null;

  /* ── and does the hover row actually offer it? ──────────────────────────── */
  const state = { turn: 'player', turnNumber: 3,
                  player: { energy: 9 }, units: [heroUnit, unitUnit], log: [] };
  const rowActs = (u) => {
    try { return (_hoverButtonsFor(u, state) || []).map((b) => b.act + (b.disabled ? '(off)' : '')); }
    catch (e) { return ['THREW: ' + String(e).slice(0, 60)]; }
  };
  out.heroRow = rowActs(heroUnit);
  out.unitRow = rowActs(unitUnit);
  out.heroHasAbilityRow = out.heroRow.some((a) => a.indexOf('ability') === 0);
  out.unitHasAbilityRow = out.unitRow.some((a) => a.indexOf('ability') === 0);

  /* ── can it actually be used, per the shipped gate? ─────────────────────── */
  try { const g = _canUseFieldAbility(state, heroUnit); out.heroGate = g.ok ? 'ok' : g.why; }
  catch (e) { out.heroGate = 'THREW ' + String(e).slice(0, 60); }

  /* ── 🔴 AND NOW THE REAL FACTORY, because everything above used a unit this
     driver built BY HAND. A hand-made unit proves the lookup, not the game: if
     buildHero happened to drop heroId, or to rebuild the unit through another
     allow-list the way normalizeHeroEntry does, every check above would still
     be green and the player would still see no row. window.__mg.rez.buildHero
     is the shipped seam onto the real factory. */
  try {
    const real = window.__mg.rez.buildHero(findHeroById(HID), 'player', { x: 2, y: 2 });
    out.realBuilt = !!real;
    out.realKeepsHeroId = !!(real && real.heroId);
    out.realIsHero = !!(real && real.isHero);
    out.realHasCardId = !!(real && real.cardId);
    out.realFA = !!(real && _fieldAbilityOf(real));
    out.realFALabel = (real && (_fieldAbilityOf(real) || {}).label) || null;
    const st2 = { turn: 'player', turnNumber: 3, player: { energy: 9 },
                  units: [Object.assign(real || {}, { alive: true, owner: 'player' })], log: [] };
    out.realRow = (_hoverButtonsFor(st2.units[0], st2) || []).map((b) => b.act + (b.disabled ? '(off)' : ''));
    out.realHasAbilityRow = out.realRow.some((a) => a.indexOf('ability') === 0);
    const g2 = _canUseFieldAbility(st2, st2.units[0]);
    out.realGate = g2.ok ? 'ok' : g2.why;
  } catch (e) { out.realErr = String(e).slice(0, 140); }
  return out;
});

console.log('\n\u{2726} HERO FIELD ABILITIES — can a hero use one?\n');
console.log('   ' + JSON.stringify(r, null, 0).slice(0, 400));

console.log('\n0. the definitions are authored and findable');
ok('the custom hero resolves via findHeroById', r.heroDefFound);
ok('...and its fieldActive survived onto the definition', r.heroDefHasFA);
ok('the control unit definition carries the same fieldActive', r.unitDefHasFA);

console.log('\n1. THE CONTROL — the identical ability on a UNIT');
ok('_fieldAbilityOf finds it on a unit', r.faOnUnit,
   r.faOnUnit ? '' : 'the control failed — the bug is NOT hero-specific');
ok('...and the unit hover row offers it', r.unitHasAbilityRow, r.unitRow.join(', '));

console.log('\n2. THE HERO — same ability, hero-shaped unit');
ok('\u{2726} _fieldAbilityOf finds it on a HERO', r.faOnHero,
   r.faOnHero ? String(r.faOnHeroLabel) : 'null — the hero carries heroId, not cardId, so the lookup misses');
ok('\u{2726} the hero hover row offers the ability', r.heroHasAbilityRow, r.heroRow.join(', '));
ok('\u{2726} and the shipped gate says it can be used', r.heroGate === 'ok', String(r.heroGate));

console.log('\n3. THE REAL FACTORY — window.__mg.rez.buildHero, not a hand-made unit');
if (r.realErr) ok('buildHero ran', false, r.realErr);
else {
  ok('the real hero unit keeps heroId, and carries no cardId (the whole cause)',
     r.realKeepsHeroId && !r.realHasCardId,
     'heroId=' + r.realKeepsHeroId + ' isHero=' + r.realIsHero + ' cardId=' + r.realHasCardId);
  ok('\u{2726} the REAL hero resolves its field ability', r.realFA, String(r.realFALabel));
  ok('\u{2726} the REAL hover row offers it', r.realHasAbilityRow, (r.realRow || []).join(', '));
  ok('\u{2726} and the shipped gate accepts it', r.realGate === 'ok', String(r.realGate));
}

console.log('\npage errors: ' + errs.length);
errs.slice(0, 3).forEach((e) => console.log('   ' + e));
console.log(fails ? '\n' + fails + ' CHECK(S) FAILED' : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fails ? 1 : 0);
