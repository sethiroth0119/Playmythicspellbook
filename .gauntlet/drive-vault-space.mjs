/* ══════════════════════════════════════════════════════════════════════════
   🏰 DRIVE-VAULT-SPACE — the vault stops changing size on its own, and what a
      player paid for cannot be taken back.

   Reported: "Players base vaults are going up and down in numbers, set the
   correct base vault space for players, keep the correct numbers for those who
   purchased vault space."

   🔴 THE UP AND DOWN. getResourceCap() = the vault's own rows, PLUS warehouse
      staff, PLUS _cityProdStorage() — the storage every Warehouse standing in
      the city contributes. That last term reads Profile.cityProduction, which
      was named in the cloud UPLOAD and in the cloud HYDRATION and in NEITHER
      local whitelist. So every local load began with those buildings missing
      and the ceiling low, and it jumped when the cloud answered. Twice a page
      load, in front of the player.

   🔴 THE QUIETER ONE. A vault crate is bought on the CLIENT — `v.rows += c.rows`
      and save — and nothing server-side ever knew. Four reset paths wiped the
      vault object; only ONE kept the size. And getVaultLayout() treats `{}` as
      valid and fills in the DEFAULT rows, so a repossession rendered as an
      ordinary 8-row vault: invisible to the player and unrecoverable, because
      no record of the purchase existed anywhere.

   WHAT THIS PINS:
     · cityProduction (and recon) survive a local load, so the ceiling is the
       same number before and after the cloud answers
     · ALL FOUR reset paths keep rows / cols / stashExtra
     · the paid floor RAISES a shrunken vault and never LOWERS a large one
     · the floor RPC takes no arguments — a player cannot name their own size
     · the seeded receipts match the five accounts that actually bought space

   Run:  node .gauntlet/drive-vault-space.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.jsx': 'text/babel', '.svg': 'image/svg+xml' };
const P = 9610 + (process.pid % 60);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const out = {};

/* ── the source + migration rules ────────────────────────────────────────── */
{
  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const sql = fs.readFileSync(path.resolve('sql/049_vault_paid_floor.sql'), 'utf8');
  out.src = {
    /* the whitelist gap that caused the fluctuation */
    cityProductionRestoredLocally: idx.indexOf('Profile.cityProduction  = p.cityProduction;') >= 0,
    reconRestoredLocally: idx.indexOf('Profile.recon           = p.recon;') >= 0,
    /* every reset keeps the paid size — the helper, and no bare wipes left */
    keepPaidHelperExists: idx.indexOf('function _vaultKeepPaid(prev) {') >= 0,
    noBareVaultWipes: idx.indexOf('Profile.vaultLayout = {};') < 0
                   && idx.indexOf('Profile.vaultLayout = null;') < 0,
    resetsUsingHelper: (idx.match(/_vaultKeepPaid\(Profile\.vaultLayout\)/g) || []).length,
    /* the floor raises and never lowers */
    floorRaisesOnly: idx.indexOf('if ((paid.rows | 0) > (v.rows | 0))') >= 0
                  && idx.indexOf('v.rows = Math.min(') < 0,
    floorNeedsASession: idx.indexOf("if (!(Profile.cloud && Profile.cloud.userId)) return null;") >= 0,
    /* the RPC names no size */
    rpcTakesNoArgs: idx.indexOf("rpc('vault_paid_sync')") >= 0,
    sqlRpcTakesNoArgs: sql.indexOf('vault_paid_sync()') >= 0
                    && sql.indexOf('p_rows') < 0 && sql.indexOf('p_stash') < 0,
    sqlIsMonotonic: sql.indexOf('greatest(public.vault_paid.rows, excluded.rows)') >= 0,
    sqlNoClientWrite: sql.indexOf('for select to authenticated') >= 0
                   && sql.indexOf('for update to authenticated') < 0
                   && sql.indexOf('for insert to authenticated') < 0,
  };
}

/* ── the client, in a real browser ───────────────────────────────────────── */
const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errs = [];
const pg = await b.newPage({ viewport: { width: 1300, height: 900 } });
pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
await pg.route('**/*', (r) => (r.request().url().includes('127.0.0.1') ? r.continue() : r.abort()));
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForTimeout(7000);

/* the four reset paths keep paid size */
Object.assign(out, await pg.evaluate(() => {
  const o = {};
  const paid = { rows: 38, cols: 10, stashExtra: 6000, placements: [{ uid: 'x', itemId: 'a', col: 0, row: 0, w: 1, h: 1 }] };
  Profile.vaultLayout = JSON.parse(JSON.stringify(paid));
  const kept = _vaultKeepPaid(Profile.vaultLayout);
  o.keepsRows = kept.rows === 38;
  o.keepsCols = kept.cols === 10;
  o.keepsStashExtra = kept.stashExtra === 6000;
  o.clearsContents = Array.isArray(kept.placements) && kept.placements.length === 0;
  /* …and does not hand back the SAME array, or a "clean" vault still holds
     the old items through a shared reference */
  o.doesNotShareTheArray = kept.placements !== paid.placements;
  return o;
}));

/* the floor raises a shrunken vault, and never shrinks a large one */
Object.assign(out, await pg.evaluate(async () => {
  const o = {};
  Cloud.ready = true;
  Profile.cloud = Object.assign(Profile.cloud || {}, { signedIn: true, userId: 'u-paid' });
  Cloud.client = { rpc: async (name) => (name === 'vault_paid_sync'
    ? { data: { ok: true, rows: 38, cols: 10, stashExtra: 6000 }, error: null }
    : { data: null, error: null }) };

  /* a vault that has been shrunk to base by a reset */
  Profile.vaultLayout = { rows: 8, cols: 10, stashExtra: 0, placements: [] };
  window._vaultFloorTried = false;
  await window._vaultApplyPaidFloor();
  const a = getVaultLayout();
  o.restoredRows = a.rows;
  o.restoredStashExtra = a.stashExtra;

  /* …and a vault BIGGER than the record is left alone */
  Profile.vaultLayout = { rows: 44, cols: 10, stashExtra: 7000, placements: [] };
  window._vaultFloorTried = false;
  await window._vaultApplyPaidFloor();
  const c = getVaultLayout();
  o.largerLeftAlone = c.rows === 44 && c.stashExtra === 7000;
  return o;
}));

/* 🏰 EVERY REAL PAID VAULT, THROUGH THE SHIPPED getResourceCap().
   The pairs are the live values seeded into vault_paid, so this asks "is what
   they bought actually honoured?" of the real function rather than of a
   restatement of the arithmetic.
   🔴 THE CLAMP USED TO EAT THE DIFFERENCE, AND NOT ONLY FOR THE ONE PLAYER
      OVER THE CAP. RES_STASH_MAX was derived as rows x cols x 25, which leaves
      out stashExtra — the surplus a Relic Vault Door banks on top of its rows.
      getResourceCap() adds that surplus and THEN clamps, so the two disagreed
      by construction: at the old 62-row cap a door-buyer already lost 10,000
      units. Raising the row cap without re-deriving the unit ceiling would
      have left that untouched. */
Object.assign(out, await pg.evaluate(() => {
  const PAID = [
    { name: 'Grimalkin Lord',    rows: 72, extra: 12000 },
    { name: 'Sethiroth Tha Dev', rows: 38, extra: 6000 },
    { name: 'GreyDragon',        rows: 16, extra: 1000 },
    { name: 'Aston Drakonis',    rows: 12, extra: 0 },
    { name: 'AetosDios',         rows: 9,  extra: 0 },
  ];
  const before = JSON.parse(JSON.stringify(Profile.vaultLayout || {}));
  const rows = PAID.map(p => {
    Profile.vaultLayout = { rows: p.rows, cols: 10, stashExtra: p.extra, placements: [] };
    const bought = p.rows * 10 * 25 + p.extra;
    return { name: p.name, bought, cap: getResourceCap() };
  });
  Profile.vaultLayout = before;
  return {
    stashMax: RES_STASH_MAX,
    maxRows: VAULT_MAX_ROWS,
    paidShortfalls: rows.filter(r => r.cap < r.bought).map(r => r.name + ' short ' + (r.bought - r.cap)),
    /* the ceiling must be exactly what a full vault can reach — higher is a
       clamp that does nothing, lower silently confiscates */
    ceilingMatchesFullVault: RES_STASH_MAX === (VAULT_MAX_ROWS * 250 + Math.floor((VAULT_MAX_ROWS - 8) / 5) * 1000),
  };
}));

/* the anon guard: no session, no question asked */
Object.assign(out, await pg.evaluate(async () => {
  let asked = false;
  Profile.cloud = Object.assign(Profile.cloud || {}, { signedIn: false, userId: null });
  Cloud.client = { rpc: async () => { asked = true; return { data: null, error: null }; } };
  window._vaultFloorTried = false;
  const r = await window._vaultApplyPaidFloor();
  return { anonAsked: asked, anonAnswer: r };
}));

out.pageErrors = errs.filter(e => !/ERR_FAILED|Failed to load resource/.test(e));
console.log(JSON.stringify(out, null, 2));

const F = [];
for (const [k, v] of Object.entries(out.src)) {
  if (k === 'resetsUsingHelper') continue;
  if (!v) F.push('source rule failed: ' + k);
}
if (out.src.resetsUsingHelper !== 3) {
  F.push('expected the 3 bare resets to use the helper, found ' + out.src.resetsUsingHelper
       + ' (the fourth keeps size with its own inline copy)');
}
if (!out.keepsRows || !out.keepsCols || !out.keepsStashExtra) F.push('a reset dropped paid capacity');
if (!out.clearsContents) F.push('a reset did not clear the vault contents');
if (!out.doesNotShareTheArray) F.push('the "clean" vault shares its placements array with the old one');
if (out.restoredRows !== 38) F.push('the floor did not restore paid rows (' + out.restoredRows + ')');
if (out.restoredStashExtra !== 6000) F.push('the floor did not restore stashExtra (' + out.restoredStashExtra + ')');
if (!out.largerLeftAlone) F.push('the floor SHRANK a vault larger than the record — a stale receipt must never take space');
if (out.paidShortfalls && out.paidShortfalls.length) {
  F.push('paid vault space is still clamped away: ' + out.paidShortfalls.join(', '));
}
if (!out.ceilingMatchesFullVault) {
  F.push('RES_STASH_MAX (' + out.stashMax + ') is not what a full ' + out.maxRows
       + '-row vault holds (' + (out.maxRows * 250 + Math.floor((out.maxRows - 8) / 5) * 1000) + ')'
       + ' — the two constants have drifted apart again, which is how stashExtra got lost the first time');
}
if (out.anonAsked) F.push('it asked the server with no session — an empty answer would read as "paid for nothing"');
if (out.anonAnswer !== null) F.push('a sessionless call returned an answer instead of nothing');
if (out.pageErrors.length) F.push('page errors: ' + out.pageErrors.join(' | '));

console.log(F.length ? ('FAIL\n  - ' + F.join('\n  - ')) : 'PASS · the ceiling stops moving, every reset keeps what was paid for, and the receipt can only give space back');
await b.close(); srv.close();
process.exit(F.length ? 1 : 0);
