/* ══════════════════════════════════════════════════════════════════════════
   💸 DRIVE-CORP-PAY — paying a colleague moves real Cinder into their wallet.

   THE REPORT, made three times: "when a corp owner pays the people they hired
   in their corp, transfer the cinder to the player who is getting paid's
   wallet."

   WHY IT SURVIVED EVERY EARLIER FIX. Nothing in the feature ever moved money.
   The two functions it ran are both no-ops on a balance:

     corp_send_asset()      INSERTs a corp_transfers row + a log row. Debits NOBODY.
     corp_claim_transfer()  UPDATEs that row's status to 'claimed'. Credits NOBODY.

   The only arithmetic was _corpAssetMove() — in the BROWSER, against
   Profile.gems — while the canonical wallet (user_progress.cinder) sat
   untouched. walletReconcile() re-reads that canonical row on the next sync,
   so the recipient's local credit was wiped and the payer's local debit came
   back. Both ends were shown a number that was never real, which is exactly
   why an earlier round's fix — a toast telling the recipient a payment was
   waiting — changed nothing: it announced money that did not exist.

   CONFIRMED ON PRODUCTION BEFORE ANY CODE WAS WRITTEN. The one claimed
   transfer on record (10,000, LIDS → URDA, claimed 2026-08-25) has NO
   wallet_ledger row on either side, and the recipient's ledger across that
   whole session runs 1,450 → 3,335 on achievements and missions with no
   10,000 anywhere in it.

   sql/080 adds corp_pay_member(), proved in a rolled-back transaction against
   live rows: payer −7,777, payee +7,777, a charge row and a credit row, both
   user_profiles.gems mirrors updated, and refusals for a non-member, a
   self-payment, a zero, and more than the payer holds.

   THIS FILE IS THE OTHER HALF — that the SCREEN calls it. A perfect RPC that
   the button never reaches is the same outage.

   Pinned, with controls:
     · paying Cinder calls corp_pay_member and NOT the old posting RPC
     · the client does NOT debit — it adopts the server's own closing balance
     · CONTROL: the payer is not taxed for their own payment
     · CONTROL: a refusal leaves the payer's balance untouched
     · CONTROL: a CARD still goes the old pending/claim way, because the
       server has no inventory to move one through

   Run:  node .gauntlet/drive-corp-pay.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const P = 8760 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('typeof _jbHandleAction === "function" && typeof _gemsTaxExempt === "function"', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(2500);

const out = await pg.evaluate(async () => {
  const o = {};
  o.reachable = typeof _jbHandleAction === 'function';
  if (!o.reachable) return o;

  /* The seams that stand BEFORE the pay branch — a signed-in session and a
     corporation. Everything from the branch inward is the shipped code. */
  window.initCloud = () => true;
  Cloud.ready = true;
  Profile.cloud = Profile.cloud || {};
  Profile.cloud.signedIn = true; Profile.cloud.userId = 'me-uuid';
  Profile.name = 'The Founder';
  Corp.mine = Corp.mine || { id: 'corp-uuid', name: 'Test Co' };
  window.corpEnsure = () => Promise.resolve(null);
  window._jbSendData = () => {};
  window.saveProfile = () => {};
  const toasts = []; window.showToast = (m) => toasts.push(String(m));

  /* The RPC layer, recorded rather than reached. What is under test is WHICH
     call the screen makes and what it does with the answer — the function
     itself is proved against live rows in sql/080's own verification. */
  const calls = [];
  let reply = null;
  Cloud.client = Cloud.client || {};
  Cloud.client.rpc = (fn, args) => { calls.push({ fn, args }); return Promise.resolve(reply); };

  const run = async (action, r) => {
    calls.length = 0; toasts.length = 0; reply = r;
    _jbHandleAction(action);
    await new Promise((res) => setTimeout(res, 250));
    return { calls: calls.slice(), toasts: toasts.slice() };
  };
  const payCinder = (qty) => ({ kind: 'corpSend', toId: 'them-uuid', toName: 'Grimalkin Lord',
    assetKind: 'resource', itemId: 'cinder', name: 'Cinder', icon: '🔥', qty: qty, note: 'Work completed' });

  // ── 1 · a wage payment ────────────────────────────────────────────────
  Profile.gems = 50000;
  Profile.walletSeqProgress = 4;
  const paid = await run(payCinder(7777),
    { data: { id: 'row-uuid', qty: 7777, from_balance: 42223, from_wallet_seq: 5, to_balance: 12345 }, error: null });
  o.rpcNames = paid.calls.map((c) => c.fn);
  o.paidArgs = paid.calls[0] ? paid.calls[0].args : null;
  o.balanceAfter = Profile.gems;
  o.seqAfter = Profile.walletSeqProgress;
  o.paidToast = paid.toasts[0] || '';
  /* CONTROL: the 2% Foundation Tax watcher must not read this as an untaxed
     spend. _gemsTaxExempt's finally clause moves _gemsWatchLast onto the new
     balance; an UNWRAPPED assignment would leave it at the old one and the
     next tick would tax the founder for paying wages. */
  o.taxWatchAligned = (typeof _gemsWatchLast === 'number') ? (_gemsWatchLast === Profile.gems) : 'n/a';

  // ── 2 · CONTROL: the server says no ───────────────────────────────────
  Profile.gems = 50000;
  const refused = await run(payCinder(999999), { data: null, error: { message: 'not enough Cinder' } });
  o.refusedBalance = Profile.gems;
  o.refusedToast = refused.toasts[0] || '';
  o.refusedCalls = refused.calls.map((c) => c.fn);

  // ── 3 · CONTROL: a card is not money and cannot move server-side ──────
  Profile.gems = 50000;
  Profile.cardCollection = Object.assign({}, Profile.cardCollection, { 'test-card': 4 });
  const card = await run({ kind: 'corpSend', toId: 'them-uuid', toName: 'Grimalkin Lord',
    assetKind: 'card', itemId: 'test-card', name: 'A Card', icon: '🃏', qty: 2, note: null },
    { data: 'transfer-uuid', error: null });
  o.cardCalls = card.calls.map((c) => c.fn);
  o.cardLeftCollection = (Profile.cardCollection['test-card'] | 0);   // 4 − 2, debited client-side
  o.cardToast = card.toasts[0] || '';

  // ── 4 · CONTROL: an unpatched server is named, not silently swallowed ─
  Profile.gems = 50000;
  const missing = await run(payCinder(100),
    { data: null, error: { message: 'Could not find the function public.corp_pay_member', code: 'PGRST202' } });
  o.missingToast = missing.toasts[0] || '';
  o.missingBalance = Profile.gems;
  return o;
});

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
if (!out.reachable) bad.push('_jbHandleAction is not reachable');
else {
  need('THE REPORT: paying Cinder calls corp_pay_member',
       (out.rpcNames || [])[0] === 'corp_pay_member', out.rpcNames);
  need('…and never the old posting RPC that moved nothing',
       (out.rpcNames || []).indexOf('corp_send_asset') < 0, out.rpcNames);
  need('…with the amount and the recipient it was given',
       !!(out.paidArgs && out.paidArgs.p_qty === 7777 && out.paidArgs.p_to_id === 'them-uuid'), out.paidArgs);
  need('the payer lands on the SERVER\'s closing balance, not a local subtraction',
       out.balanceAfter === 42223, out.balanceAfter);
  need('…and adopts the server\'s wallet_seq with it', out.seqAfter === 5, out.seqAfter);
  need('the payer is told it arrived', /in their wallet now/.test(out.paidToast), out.paidToast);
  need('CONTROL: the Foundation Tax watcher is not left seeing an untaxed spend',
       out.taxWatchAligned === true || out.taxWatchAligned === 'n/a', out.taxWatchAligned);
  need('CONTROL: a refusal leaves the payer\'s balance alone', out.refusedBalance === 50000, out.refusedBalance);
  need('…and says why', /do not have|not enough/i.test(out.refusedToast), out.refusedToast);
  need('CONTROL: a card still goes the pending/claim way',
       (out.cardCalls || [])[0] === 'corp_send_asset', out.cardCalls);
  need('…and is still debited client-side, because only the client holds it',
       out.cardLeftCollection === 2, out.cardLeftCollection);
  need('CONTROL: a server without sql/080 is named out loud',
       /sql\/080/.test(out.missingToast), out.missingToast);
  need('…and nothing is deducted when it is missing', out.missingBalance === 50000, out.missingBalance);
  need('no page errors', errs.length === 0, errs.slice(0, 3));
}

console.log(JSON.stringify({ ...out, pageErrors: errs.slice(0, 3) }, null, 2));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — a wage payment moves real Cinder into the payee\'s wallet.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
