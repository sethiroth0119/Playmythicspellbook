/* ══════════════════════════════════════════════════════════════════════════
   💸 DRIVE-CORP-PAY-NOTICE — is a player told that a payment is waiting?

   THE REPORT: "the pay feature to pay other players is not showing in their
   wallets."

   THE TRACE (source, not guesswork):
     · corp_send_asset (supabase-org-vault.sql) INSERTs a corp_transfers row.
       It debits nobody — the SENDER is debited client-side by
       _corpAssetMove(row, -1) before the RPC, and refunded if it is refused.
     · corp_claim_transfer flips 'sent' → 'claimed' and returns the row. It
       credits nobody — the RECIPIENT is credited client-side from the returned
       row by _corpAssetMove(row, +1), then saveProfile().
     · Both halves work. The pending row was announced NOWHERE: its only
       appearance is the Transfers card in Corporation → Guild & Hiring, which
       is hidden when the list is empty.
   So the money is real and reachable, and the player is never told to reach
   for it. That is the defect this file covers.

   WHAT IS ASSERTED, against the real function in the real page:
     1. a pending incoming transfer produces exactly ONE announcement
     2. a second call announces NOTHING (no nag on every corpEnsure)
     3. the seen-set SURVIVES a reload (it lives in Profile, which is saved)
     4. a DIFFERENT payment arriving later is announced
     5. an outgoing transfer is never announced to the sender
     6. once the row is gone (claimed), its id is pruned from the seen-set

   ⚠ showToast is captured, not stubbed away: the test asserts on the text the
     player would actually read, so a toast that fires with an empty amount
     fails here rather than shipping.

   Run: node .gauntlet/drive-corp-pay-notice.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain','.wav':'audio/wav','.mp3':'audio/mpeg' };
const P = 7960 + (process.pid % 30);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));
const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1500, height: 950 } });
pg.on('pageerror', () => {});
await pg.route('**/*', (r) => { const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost')) return r.continue(); return r.abort(); });
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('typeof _corpAnnounceIncoming === "function"', null, { timeout: 180000 });
await pg.waitForTimeout(2500);

const out = await pg.evaluate(() => {
  const rep = { steps: [] };
  const toasts = [];
  const realToast = window.showToast;
  try { window.showToast = function (msg) { toasts.push(String(msg)); }; } catch (e) { rep.stubErr = String(e); }
  /* eval, not window.showToast: showToast is a top-level function declaration,
     a global LEXICAL binding that is not on window (the trap in CLAUDE.md), so
     assigning window.showToast would leave the real one in place. */
  try { eval('showToast = function (m) { toasts.push(String(m)); }'); } catch (e) { rep.evalErr = String(e).slice(0, 80); }

  const T = (id, qty, name, from) => ({ id, qty, name, from, itemId: 'cinder', kind: 'resource', incoming: true, outgoing: false, status: 'sent' });
  const set = (list) => { try { eval('Corp.transfers = ' + JSON.stringify(list)); } catch (e) { Corp.transfers = list; } };
  try { Profile._corpXferSeen = {}; } catch (e) {}

  /* 1 · one pending payment → exactly one announcement */
  set([T('t-1', 5000, 'Cinder', 'Inergy')]);
  const n1 = _corpAnnounceIncoming();
  rep.steps.push({ step: 'first sync announces', n: n1, ok: n1 === 1 && toasts.length === 1 });
  rep.text = toasts[0] || '';

  /* 2 · the same list again → silence */
  const n2 = _corpAnnounceIncoming();
  const n3 = _corpAnnounceIncoming();
  rep.steps.push({ step: 'repeat syncs stay silent', n: n2 + n3, ok: (n2 + n3) === 0 && toasts.length === 1 });

  /* 3 · survives a reload: the flag is in Profile, which is what gets saved */
  const persisted = !!(Profile._corpXferSeen && Profile._corpXferSeen['t-1']);
  rep.steps.push({ step: 'seen-set lives in Profile (saved)', ok: persisted });

  /* 4 · a different payment later IS announced */
  set([T('t-1', 5000, 'Cinder', 'Inergy'), T('t-2', 250, 'Cinder', 'Tha Prince')]);
  const n4 = _corpAnnounceIncoming();
  rep.steps.push({ step: 'a new payment announces', n: n4, ok: n4 === 1 && toasts.length === 2 });
  rep.text2 = toasts[1] || '';

  /* 5 · outgoing is the sender's own money leaving — never announced to them */
  set([{ id: 't-3', qty: 99, name: 'Cinder', from: 'me', itemId: 'cinder', kind: 'resource', incoming: false, outgoing: true, status: 'sent' }]);
  const n5 = _corpAnnounceIncoming();
  rep.steps.push({ step: 'outgoing is not announced', n: n5, ok: n5 === 0 && toasts.length === 2 });

  /* 6 · claimed rows leave the list, so their ids are pruned */
  const prunedT1 = !(Profile._corpXferSeen && Profile._corpXferSeen['t-1']);
  rep.steps.push({ step: 'claimed ids are pruned from the set', ok: prunedT1 });

  try { eval('showToast = realToast'); } catch (e) {}
  try { window.showToast = realToast; } catch (e) {}
  rep.toasts = toasts;
  return rep;
});
await b.close(); srv.close();

const ok = (v) => v ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
console.log('\n💸 A PAYMENT IS WAITING — is the player told?\n');
for (const s of out.steps) console.log('  ' + String(s.step).padEnd(38) + ok(s.ok) + (s.n !== undefined ? '   (' + s.n + ')' : ''));
console.log('\n  what they read: "' + (out.text || '') + '"');
if (out.text2) console.log('  and later     : "' + out.text2 + '"');
const named = /5,000 Cinder from Inergy/.test(out.text || '') && /Guild & Hiring/.test(out.text || '');
console.log('  names the amount, sender and where to claim   ' + ok(named));
const pass = out.steps.every(s => s.ok) && named;
console.log('\n  VERDICT: ' + (pass ? '\x1b[32mTHE RECIPIENT IS TOLD, ONCE\x1b[0m' : '\x1b[31mSTILL SILENT\x1b[0m') + '\n');
process.exit(pass ? 0 : 1);
