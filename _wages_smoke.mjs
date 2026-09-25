/* 💸 WAGES — the recipient side of corp pay.

   Reported (PDF): "Employee Wages Not Reaching Employee Accounts" — a paid
   player saw no balance change and no line saying where money came from.
   Verified live: the credit always landed; the READER was missing. Defends:
     · walletIncomingCheck exists, polls, runs on focus/visibility, adopts
       a server debit verbatim, and only adopts a gain that the server's own
       ledger explains with an unmirrored (ref-less) credit;
     · it books each named credit on the device diary and announces corp pay;
     · the phone's server audit prints the server reason, not "Reward";
     · sql/116 installs get_my_ledger with the ref column for authenticated.

   Run: node _wages_smoke.mjs */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
const SQL = readFileSync('./sql/116_wallet_audit_visible.sql', 'utf8');
function fnText(name) {
  const i = SRC.indexOf('async function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name);
  let d = 0, j = SRC.indexOf('{', i);
  for (let k = j; k < SRC.length; k++) { if (SRC[k] === '{') d++; else if (SRC[k] === '}') { d--; if (!d) return SRC.slice(i, k + 1); } }
}
const W = fnText('walletIncomingCheck');
ok(W.length > 500, 'walletIncomingCheck is defined');
ok(/select\('cinder,wallet_seq'\)/.test(W), 'reads only the canonical cinder + seq');
ok(/srvSeq > locSeq/.test(W) && /adopted: 'debit'/.test(W), 'a server debit (seq ahead) is adopted verbatim');
ok(/if \(server <= local\) return/.test(W), 'a level or lower server figure does nothing');
ok(/rpc\('get_my_ledger'/.test(W), 'names the money from the server ledger');
ok(/if \(x\.ref\) return;/.test(W), 'client-mirrored credits (ref set) are never re-announced');
ok(/_wiSeen\[x\.id\]/.test(W), 'a ledger row is booked once');
ok(/if \(namedSum <= 0\) return/.test(W), 'an unexplained gap is left to walletReconcile (in-flight spend guard)');
ok(/Math\.min\(diff, namedSum\)/.test(W), 'adopts only what the ledger explains');
ok(/_cinderLedgerAdd\(d, x\.reason/.test(W), 'device diary gets the server reason');
ok(/\^Corp \(pay\|wage\)/.test(W) && /showToast\(line/.test(W) && /notify\(line/.test(W), 'corp pay is toasted and kept in the bell');
ok(/_gemsTaxExempt/.test(W), 'the adopt is tax-exempt');
ok(/setInterval\(walletIncomingCheck, 45 \* 1000\)/.test(SRC), 'polls every 45 s');
ok(/addEventListener\('focus', \(\) => walletIncomingSoon\(1200\)\)/.test(SRC) && /visibilitychange/.test(SRC.slice(SRC.indexOf('function walletIncomingSoon'), SRC.indexOf('function walletIncomingSoon') + 900)), 'focus and visibility re-check');
ok(/window\.MythicWalletWatch = \{ check: walletIncomingCheck/.test(SRC), 'seam on window');
ok(/r: _ledgerServerWord\(x\)/.test(SRC) && /raw \|\| \(\(\{ charge: 'Spend'/.test(SRC), 'phone server audit prints the ledger reason');
ok(/create or replace function public\.get_my_ledger\(p_limit int default 100\)/.test(SQL) && /ref\s+text,/.test(SQL), 'sql/116 defines get_my_ledger with ref');
ok(/where l\.user_id = auth\.uid\(\)/.test(SQL) && /security definer/.test(SQL), 'get_my_ledger is scoped to the caller');
ok(/grant execute on function public\.get_my_ledger\(int\) to authenticated/.test(SQL), 'granted to authenticated');
/* 🔒 Supabase's default privileges grant EXECUTE to `anon` as a SECOND ACL entry;
   `from public` alone leaves it standing (verified live on 2026-09-06). */
ok(/revoke all on function public\.get_my_ledger\(int\) from public, anon;/.test(SQL), 'the revoke names anon as well as public');
ok(/window\.BUILD_VERSION = 'v121v(4[7-9]|[5-9]\d|\d{3,})'/.test(SRC), 'build v121v47 or later');

/* behaviour, headless: the function runs against stubbed Cloud/Profile */
import vm from 'vm';
async function scenario(name, opts) {
  const log = { gems: opts.gems, ledger: [], toasts: [], saved: 0 };
  const ctx = {
    Cloud: { client: {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { cinder: opts.server, wallet_seq: opts.srvSeq } }) }) }) }),
      rpc: async () => ({ data: opts.rows || [] }),
    } },
    Profile: { cloud: { signedIn: true, userId: 'u1' }, get gems() { return log.gems; }, set gems(v) { log.gems = v; }, walletSeqProgress: opts.seq },
    Wallet: { rpcMissing: false, lastFetchAt: 1, _reconciling: false },
    _gemsTaxExempt: (fn) => fn(), _ledgerQuiet: (fn) => fn(), saveProfile: () => { log.saved++; }, render: () => {},
    _cinderLedgerAdd: (d, r) => log.ledger.push([d, r]), showToast: (t) => log.toasts.push(t), notify: () => {},
    setInterval: () => 0, setTimeout: () => 0, clearTimeout: () => {}, window: { addEventListener() {} }, document: { addEventListener() {} },
    Date, Math, isFinite, Array, String, console,
  };
  vm.createContext(ctx);
  const start = SRC.indexOf('let _wiBusy = false');
  const end = SRC.indexOf('} catch (e) {}', SRC.indexOf('window.MythicWalletWatch')) + '} catch (e) {}'.length;
  vm.runInContext(SRC.slice(start, end), ctx);
  const res = await vm.runInContext('walletIncomingCheck()', ctx);
  log.seqAfter = ctx.Profile.walletSeqProgress;
  return { res, log };
}
const now = new Date().toISOString();
{
  const { res, log } = await scenario('debit', { gems: 500, seq: 3, server: 200, srvSeq: 4 });
  ok(res.adopted === 'debit' && log.gems === 200 && log.seqAfter === 4, 'seq ahead: server debit adopted verbatim', JSON.stringify(res));
}
{
  const rows = [{ id: 'a', resource: 'cinder', op: 'credit', delta: 1000, reason: 'Corp pay from Sethiroth', ref: null, created_at: now }];
  const { res, log } = await scenario('pay', { gems: 500, seq: 3, server: 1500, srvSeq: 3, rows });
  ok(res.credited === 1000 && log.gems === 1500, 'corp pay: +1000 adopted', JSON.stringify(res) + ' gems=' + log.gems);
  ok(log.ledger.length === 1 && log.ledger[0][1] === 'Corp pay from Sethiroth', 'diary row carries the payer', JSON.stringify(log.ledger));
  ok(log.toasts.length === 1 && /\+1,000/.test(log.toasts[0]) && /Corp pay from Sethiroth/.test(log.toasts[0]), 'toast names the pay', log.toasts[0]);
}
{
  const rows = [{ id: 'b', resource: 'cinder', op: 'credit', delta: 700, reason: 'City income', ref: 'r-1', created_at: now }];
  const { res, log } = await scenario('inflight', { gems: 800, seq: 3, server: 1500, srvSeq: 3, rows });
  ok(res.credited === 0 && res.unexplained === 700 && log.gems === 800 && !log.toasts.length, 'in-flight spend / mirrored credit only: nothing adopted, nothing announced', JSON.stringify(res));
}
{
  const rows = [{ id: 'c', resource: 'cinder', op: 'credit', delta: 5000, reason: 'Corp wage from River Meadows Corp', ref: null, created_at: now }];
  const { res, log } = await scenario('partial', { gems: 800, seq: 3, server: 1500, srvSeq: 3, rows });
  ok(res.credited === 700 && log.gems === 1500 && log.ledger.length === 0, 'named credit larger than the gap: adopts the gap only, books nothing it cannot fit', JSON.stringify(res) + ' ' + JSON.stringify(log.ledger));
}
console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
