/* ══════════════════════════════════════════════════════════════════════════
   🏰 DRIVE-VAULT-CRATE-CAP — the shop stops selling vault space at the cap,
      and cannot be talked past it by a dialog.

   Asked for: "make it where players cannot buy anymore vault space +50 Cells
   after they reach the cap."

   🔴 THE TILE ALREADY REFUSED; THE HANDLER DID NOT, QUITE. It tested the cap
      BEFORE `await showGameConfirm(...)` and never again — so anything that
      filled the vault while that dialog sat open went unnoticed and the
      purchase applied over the top of it. Driven before the fix: from five rows
      below the cap, with the vault reaching the cap during the await, the buy
      landed at 78 rows against a cap of 73 and took 120 Ⓐ Aza for five rows the
      clamp then throws away. Two dialogs open at once is the ordinary way in; a
      cloud hydration landing mid-dialog is the quiet one.

   ⚠ THE CONTROL IS THE POINT OF THIS FILE. A refusal test alone passes just as
     happily if buying is broken outright, so the ordinary purchase is driven
     here too and has to still work, spend the Aza, and add exactly its rows.

   Run:  node .gauntlet/drive-vault-crate-cap.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.jsx': 'text/babel', '.svg': 'image/svg+xml' };
const P = 8110 + (process.pid % 60);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errs = [];
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
await pg.route('**/*', (r) => (r.request().url().includes('127.0.0.1') ? r.continue() : r.abort()));
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForTimeout(6000);

const out = await pg.evaluate(async () => {
  const o = {};
  o.cap = VAULT_MAX_ROWS;
  o.ceiling = RES_STASH_MAX;
  Profile.sovereigns = 100000;              // never the thing doing the refusing

  /* the REAL shop body and the REAL binder, rather than a screen route */
  const paint = () => {
    document.getElementById('app').innerHTML = _buildPackShopBody(Profile.gems || 0, Profile.sovereigns || 0);
    _bindPackShopHandlers();
  };
  const relic = () => document.querySelector('[data-buy-crate="relicv"]');
  const settle = () => new Promise(r => setTimeout(r, 350));

  /* ── 1 · AT the cap: the tile is dead and says so ───────────────────── */
  Profile.vaultLayout = { rows: VAULT_MAX_ROWS, cols: 10, stashExtra: 13000, placements: [] };
  paint(); await settle();
  o.tileDisabledAtCap = !!(relic() && relic().disabled);
  o.tileLabelAtCap = relic() ? (relic().textContent || '').trim() : null;

  /* clicking it anyway must move nothing */
  const sov0 = Profile.sovereigns;
  const realConfirm = window.showGameConfirm;
  window.showGameConfirm = async () => true;
  if (relic()) relic().click();
  await new Promise(r => setTimeout(r, 700));
  o.rowsAfterClickingDeadTile = getVaultLayout().rows;
  o.azaSpentOnDeadTile = sov0 - Profile.sovereigns;

  /* ── 2 · THE RACE: the vault fills while the dialog is open ──────────── */
  Profile.vaultLayout = { rows: VAULT_MAX_ROWS - 5, cols: 10, stashExtra: 12000, placements: [] };
  window.showGameConfirm = async () => { getVaultLayout().rows = VAULT_MAX_ROWS; return true; };
  paint(); await settle();
  o.tileEnabledBelowCap = !!(relic() && !relic().disabled);
  const sov1 = Profile.sovereigns;
  if (relic()) relic().click();
  await new Promise(r => setTimeout(r, 900));
  o.rowsAfterRace = getVaultLayout().rows;
  o.overCapBy = Math.max(0, getVaultLayout().rows - VAULT_MAX_ROWS);
  o.azaSpentInRace = sov1 - Profile.sovereigns;

  /* ── 3 · CONTROL: an ordinary purchase below the cap still works ─────── */
  Profile.vaultLayout = { rows: 8, cols: 10, stashExtra: 0, placements: [] };
  window.showGameConfirm = async () => true;
  paint(); await settle();
  const sov2 = Profile.sovereigns;
  if (relic()) relic().click();
  await new Promise(r => setTimeout(r, 900));
  const v = getVaultLayout();
  o.controlRows = v.rows;                    // 8 + 5
  o.controlStashExtra = v.stashExtra;        // 2,250 granted - 1,250 the rows are worth
  o.controlAzaSpent = sov2 - Profile.sovereigns;

  /* ── 4 · CONTROL: the last legal door lands exactly ON the cap ───────── */
  Profile.vaultLayout = { rows: VAULT_MAX_ROWS - 5, cols: 10, stashExtra: 12000, placements: [] };
  paint(); await settle();
  if (relic()) relic().click();
  await new Promise(r => setTimeout(r, 900));
  const v2 = getVaultLayout();
  o.lastDoorRows = v2.rows;
  o.lastDoorUnits = v2.rows * v2.cols * 25 + (v2.stashExtra | 0);

  window.showGameConfirm = realConfirm;
  return o;
});

out.pageErrors = errs.filter(e => !/ERR_FAILED|Failed to load resource/.test(e));
console.log(JSON.stringify(out, null, 2));

const F = [];
if (!out.tileDisabledAtCap) F.push('the container tile is still clickable at the cap');
if (!/MAX/i.test(out.tileLabelAtCap || '')) F.push('the tile does not say it is maxed — it reads: ' + out.tileLabelAtCap);
if (out.rowsAfterClickingDeadTile !== out.cap) F.push('clicking the dead tile changed the vault');
if (out.azaSpentOnDeadTile !== 0) F.push('clicking the dead tile spent ' + out.azaSpentOnDeadTile + ' Aza');
if (out.overCapBy !== 0) F.push('the dialog race bought past the cap by ' + out.overCapBy + ' rows');
if (out.azaSpentInRace !== 0) F.push('the dialog race spent ' + out.azaSpentInRace + ' Aza on rows it did not get');
/* the controls — a fix that blocks everything must fail here */
if (out.controlRows !== 13) F.push('CONTROL: an ordinary purchase did not add its rows (' + out.controlRows + ', expected 13)');
if (out.controlStashExtra !== 1000) F.push('CONTROL: the surplus was not banked (' + out.controlStashExtra + ', expected 1000)');
if (!(out.controlAzaSpent > 0)) F.push('CONTROL: an ordinary purchase took no Aza — buying is broken');
if (out.lastDoorRows !== out.cap) F.push('CONTROL: the last legal door did not land on the cap (' + out.lastDoorRows + ')');
if (out.lastDoorUnits !== out.ceiling) F.push('CONTROL: the last legal door reached ' + out.lastDoorUnits + ', not the ' + out.ceiling + ' ceiling');
if (out.pageErrors.length) F.push('page errors: ' + out.pageErrors.join(' | '));

console.log(F.length ? ('FAIL\n  - ' + F.join('\n  - ')) : 'PASS · the shop stops at the cap, cannot be raced past it, and still sells everything below it');
await b.close(); srv.close();
process.exit(F.length ? 1 : 0);
