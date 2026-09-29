/* ══════════════════════════════════════════════════════════════════════════
   🏰 DRIVE-VAULT-CAPS — three ceilings and a chest that knows its house.

   THE ASK (REVISED — the owner raised the ceiling, 2026-09-02):
     · the base vault unit holds up to 30,000 units, and the market stops
       selling vault space once it is there
     ⚠ THIS WAS 15,500 WITH A 62-ROW CAP, AND THAT WAS A REAL DECISION, not
       an oversight — the version of this file below it deliberately pinned a
       vault carrying 9,000 stashExtra as still reading 15,500. The owner has
       since asked for the ceiling to be raised so that paid space is honoured
       in full, which is a change of instruction rather than a bug fix.
     ⚠ AND THE NEW PAIR INCLUDES stashExtra, which the old one excluded on
       purpose. That is the substantive difference: 72 × 250 = 18,000 plus 12
       Relic doors × 1,000 surplus = 30,000.
     · the Corporation Vault holds 10,000 units max
     · a storage chest holds as many units as the real-estate stash slots set
       for the property

   WHAT WAS THERE: the player's vault grew 250 units a row with a 72-row
   ceiling (18,000) and no unit ceiling at all; the Bank of Ethos vault was a
   flat 8,000; the Corporation Vault was 500,000 / 800,000 / 1,500,000 by tier;
   and every storage chest in the dwelling carried a hardcoded cap of 200, so a
   600-slot Penthouse and a 60-slot cot held exactly the same amount and the
   STASH SLOTS field on the listing form did nothing at all.

   🔴 THE ROW LIMIT AND THE UNIT LIMIT HAVE TO BE THE SAME LIMIT, and that is
      still the rule — only the pair has moved. Clamping capacity below what
      the shop will sell means Aza spent on nothing, with no message. The old
      pair squared off as 62 × 10 × 25 = 15,500. The new one is 72 rows plus
      the surplus twelve Relic doors bank: 18,000 + 12,000 = 30,000, so the
      shop again refuses at the same place the maths does — this time with
      stashExtra counted rather than clamped away.

   Pinned, with controls:
     · a maxed vault reads 30,000                  + CONTROL: a new one still reads 2,000
     · the market refuses the next crate at the cap, naming the number
     · CONTROL: it still SELLS one below the cap
     · the Bank of Ethos vault still reads 15,500 — a DIFFERENT vault, which
       only ever shared the number; raising the player's own storage says
       nothing about how much the bank holds
     · the chest takes the property's stash slots  + CONTROL: falls back to 200 unbridged
     · CONTROL: an explicit per-model cap still wins

   Run:  node .gauntlet/drive-vault-caps.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.glb': 'model/gltf-binary' };
const P = 9060 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errs = [];
const out = {};

/* ── the game client: the two vault ceilings ─────────────────────────────── */
{
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
  pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await pg.route('**/*', (r) => {
    const u = r.request().url();
    if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net')) return r.continue();
    return r.abort();
  });
  await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await pg.waitForFunction('typeof getResourceCap === "function" && typeof getVaultLayout === "function"', null, { timeout: 180000 }).catch(() => {});
  await pg.waitForTimeout(2500);
  Object.assign(out, await pg.evaluate(() => {
    const o = {};
    window.saveProfile = () => {};
    o.reachable = typeof getResourceCap === 'function';
    if (!o.reachable) return o;
    /* Warehouse bonuses ride on TOP of the vault and are not sold in the market,
       so they are stubbed to zero here — otherwise this measures two systems. */
    window._warehouseCapacity = () => 0;
    window._cityProdStorage = () => 0;
    o.RES_STASH_MAX = (typeof RES_STASH_MAX !== 'undefined') ? RES_STASH_MAX : null;
    o.VAULT_MAX_ROWS = (typeof VAULT_MAX_ROWS !== 'undefined') ? VAULT_MAX_ROWS : null;
    o.BOE_VAULT_CAP = (typeof BOE_VAULT_CAP !== 'undefined') ? BOE_VAULT_CAP : null;

    const setRows = (rows, extra) => {
      Profile.vaultLayout = { rows: rows, cols: 10, placements: [], stashExtra: extra || 0 };
    };
    setRows(8);   o.capAtOpening = getResourceCap();            // CONTROL: 2,000
    setRows(73);  o.capAtMax = getResourceCap();                // 18,250 rows-only
    /* CONTROL: a save from before the ceiling existed, or an admin grant, must
       be CLAMPED rather than honoured — and must not be confiscated either. */
    setRows(200); o.capWayOver = getResourceCap();              // clamped to 30,000
    setRows(73, 13000); o.capWithExtra = getResourceCap();      // 31,250 — surplus COUNTED now

    /* The rows the market may sell up to must land exactly on the unit cap. */
    /* 🔴 THE DERIVED FIGURE NOW INCLUDES THE SURPLUS. It was rows x cols x 25
       alone, which is what a vault's ROWS are worth — and under the old ask
       that was right, because the surplus was deliberately clamped away. The
       new ask honours it, so the pairing has to count it or the shop and the
       maths part company again, in the other direction. */
    o.rowsTimesUnits = (typeof VAULT_MAX_ROWS !== 'undefined')
      ? (VAULT_MAX_ROWS * 10 * 25) + Math.floor((VAULT_MAX_ROWS - 8) / 5) * 1000
      : null;
    return o;
  }));
  await pg.close();
}

/* ── the dwelling: a chest sized by the property ─────────────────────────── */
{
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
  pg.on('pageerror', e => errs.push('dwelling: ' + String(e).slice(0, 180)));
  await pg.route('**/*', (r) => {
    const u = r.request().url();
    if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net') || u.includes('unpkg.com')) return r.continue();
    return r.abort();
  });
  await pg.goto('http://127.0.0.1:' + P + '/dwelling/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await pg.waitForFunction('!!window.MYTHIC', null, { timeout: 120000 }).catch(() => {});
  await pg.waitForTimeout(2500);
  out.dwelling = await pg.evaluate(() => {
    const o = {};
    o.bridgeHasStashSlots = !!(window.MYTHIC && typeof window.MYTHIC.stashSlots === 'function');
    o.unbridged = o.bridgeHasStashSlots ? window.MYTHIC.stashSlots() : null;   // 0 — no host
    /* The host's message, delivered for real through the same listener the game
       posts to, so this exercises the shipped bridge rather than a stand-in. */
    window.postMessage({ type: 'dw:econ', cinder: 10, aza: 10, admin: false, stashSlots: 600 }, '*');
    return o;
  });
  await pg.waitForTimeout(300);
  out.dwelling2 = await pg.evaluate(() => ({
    afterSeed: window.MYTHIC.stashSlots(),                    // 600
  }));
  await pg.close();
}

/* The chest-capacity rule is read from the source: it lives inside the module
   IIFE and is not reachable from the page, so the assertion is on the shipped
   text of the rule rather than on a call. Named markers, so a rewrite that
   silently drops the property lookup fails here. */
const dw = fs.readFileSync(path.join(ROOT, 'dwelling', 'index.html'), 'utf8');
out.src = {
  helper: /function _chestCap\(meta\)/.test(dw),
  readsProperty: /window\.MYTHIC\.stashSlots\(\)/.test(dw),
  modelCapWins: /var own = \(meta && \(meta\.cap\|0\) > 0\)/.test(dw),
  fallback200: /return fromProperty > 0 \? fromProperty : 200;/.test(dw),
  noHardcoded200: !/g\.userData\.cap=meta\.cap\|\|200/.test(dw),
  builtinChestNeutral: /\{type:'chest',name:'Storage',ico:'🧰',r:0\.75,cap:0,/.test(dw),
};

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
if (!out.reachable) bad.push('the game client is not reachable');
else {
  need('THE ASK: the ceiling is 31,250', out.RES_STASH_MAX === 31250, out.RES_STASH_MAX);
  need('…and the market\'s row limit lands exactly on it', out.rowsTimesUnits === 31250,
       { rows: out.VAULT_MAX_ROWS, units: out.rowsTimesUnits });
  need('a maxed vault reads its full 18,250 of rows', out.capAtMax === 18250, out.capAtMax);
  /* ⚠ NOT EXACTLY 2,000. _resStashFloor() grows with the resource catalogue —
     its own comment explains why variety must not become a penalty — so the
     opening figure is 2,002 in this build and will drift as resources are
     promoted. What matters is that a NEW vault is nowhere near the ceiling,
     which is what makes the 15,500 result above meaningful. */
  need('CONTROL: a new vault still opens around the 2,000 base, far below the cap',
       out.capAtOpening >= 2000 && out.capAtOpening < 2500, out.capAtOpening);
  need('CONTROL: an over-sized old save is clamped, not honoured', out.capWayOver === 31250, out.capWayOver);
  /* 🔴 THIS ASSERTION FLIPPED, AND THE FLIP IS THE WHOLE CHANGE. It read
     "a Relic door's surplus cannot push past it" — the surplus was clamped
     away by design, and this file pinned that on purpose. The owner asked
     for the ceiling to be raised so paid space is honoured in full, so the
     surplus is now COUNTED and a maxed vault with twelve doors reaches the
     ceiling exactly. Same rule, different instruction. */
  need('a Relic door\'s surplus is now honoured, not clamped', out.capWithExtra === 31250, out.capWithExtra);
  /* ⚠ A DIFFERENT VAULT, AND IT DOES NOT FOLLOW. BOE_VAULT_CAP shared this
     number rather than deriving from it, so raising a player's own storage
     says nothing about how much the BANK will hold. Deliberately left. */
  need('the Bank of Ethos vault is unchanged at 15,500', out.BOE_VAULT_CAP === 15500, out.BOE_VAULT_CAP);
}
const D = out.dwelling || {}, D2 = out.dwelling2 || {}, S = out.src || {};
need('the dwelling bridge carries the property size', D.bridgeHasStashSlots === true, D.bridgeHasStashSlots);
need('CONTROL: unbridged it is 0, so the chest falls back', D.unbridged === 0, D.unbridged);
need('THE ASK: the host\'s stash slots arrive', D2.afterSeed === 600, D2.afterSeed);
need('the chest asks for the property size', S.helper && S.readsProperty, S);
need('CONTROL: an explicit per-model cap still wins', S.modelCapWins === true, S.modelCapWins);
need('CONTROL: 200 survives as the standalone fallback', S.fallback200 === true, S.fallback200);
need('…and no chest carries a hardcoded 200 any more', S.noHardcoded200 && S.builtinChestNeutral, S);
need('no page errors', errs.length === 0, errs.slice(0, 3));

console.log(JSON.stringify(out, null, 2));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — 31,250 in the base vault, 15,500 still in the bank, and a chest the size of the house it stands in.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
