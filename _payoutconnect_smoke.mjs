/* 💳 CONNECT STRIPE FROM THE PROFILE (v121v64).

   Asked for: "Connect this to Cashout as well. Make it where players can
   connect their stripe to their profile."

   BAZAAR_ACTIVATION.md names the failure mode this suite exists to prevent:
   "Do not build a second Stripe onboarding flow. Two account maps for one
   player is how a payout reaches the wrong Stripe account." So the profile
   button must call the SAME cashoutConnectStripe() the Vault calls, hitting
   the SAME /api/cashout/connect endpoint and the SAME cashout_accounts row.
   There must be exactly one connect endpoint in the client, and one only.

   The second thing checked here was simply missing before: the Worker sends
   Stripe back to /?cashout=return, and nothing in the client read it — a
   player finished onboarding and landed on the title screen with no word and
   a stale "not connected" status.

   Run: node _payoutconnect_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
const WK  = readFileSync('./worker.js', 'utf8');
function fnText(name) {
  let i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name);
  if (SRC.slice(i - 6, i) === 'async ') i -= 6;
  let d = 0, j = SRC.indexOf('{', i);
  for (let k = j; k < SRC.length; k++) { if (SRC[k] === '{') d++; else if (SRC[k] === '}') { d--; if (!d) return SRC.slice(i, k + 1); } }
}

/* ── ONE FLOW, ONE ACCOUNT — the rule that costs money if broken ── */
{
  const hits = (SRC.match(/\/api\/cashout\/connect/g) || []).length;
  ok(hits === 1, 'the client has exactly ONE Stripe onboarding call, not a second flow', 'found ' + hits);
  const starts = (SRC.match(/type: 'account_onboarding'/g) || []).length;
  ok(starts === 0, 'and the client never builds an account link itself — that is the Worker\'s job', 'found ' + starts);
}
{
  const i = SRC.indexOf("const bStripeConnect = document.getElementById('btn-cloud-stripe-connect');");
  const seg = SRC.slice(i, i + 260);
  ok(i > 0 && /cashoutConnectStripe\(\);/.test(seg), 'the profile button calls the Vault\'s own connect function');
  ok(!/fetch\(/.test(seg), 'and does not talk to the API on its own');
}
ok(/sbAcctGet\(env, user\)/.test(WK) && /cashout_accounts\?select=stripe_account_id/.test(WK),
  'the Worker still resolves the account from the single cashout_accounts row');

/* ── the return trip, run for real ── */
{
  const at = (search, hash) => {
    const ctx = { location: { search, hash }, console };
    vm.createContext(ctx);
    vm.runInContext(fnText('_payoutUrlReturn'), ctx);
    return vm.runInContext('_payoutUrlReturn()', ctx);
  };
  ok(at('?cashout=return', '') === 'return', 'a finished onboarding is recognised');
  ok(at('?cashout=refresh', '') === 'refresh', 'an abandoned one is recognised separately');
  ok(at('', '') === null && at('?x=1', '') === null, 'an ordinary load is neither');
}
{
  const ctxOf = (st) => {
    const toasts = [], calls = [];
    const ctx = {
      console,
      StripeCashout: Object.assign({ enabled: true, connected: false, payouts_enabled: false, payoutsEnabled: false }, st || {}),
      cashoutStripeRefresh: async () => { calls.push('refresh'); },
      showToast: (t) => toasts.push(String(t)),
      App: {}, render: () => calls.push('render'),
      location: { href: 'https://x.test/?cashout=return', search: '?cashout=return', hash: '', pathname: '/' },
      history: { replaceState: (a, b, u) => calls.push(['url', u]) },
      URL: class { constructor() { this.hash = ''; this.pathname = '/'; this._p = new Map([['cashout', 'return']]); }
        get search() { return this._p.size ? '?' + [...this._p].map(([k, v]) => k + '=' + v).join('&') : ''; }
        get searchParams() { const p = this._p; return { delete: (k) => p.delete(k) }; } },
    };
    vm.createContext(ctx);
    vm.runInContext([fnText('_payoutUrlReturn'), fnText('_payoutCleanUrl'), fnText('_payoutStatusText'), fnText('_payoutHandleReturn')].join('\n'), ctx);
    return { ctx, toasts, calls, run: (k) => vm.runInContext('_payoutHandleReturn(' + JSON.stringify(k) + ')', ctx) };
  };
  {
    const w = ctxOf({ connected: true, payouts_enabled: true });
    await w.run('return');
    ok(w.calls.includes('refresh'), 'coming back from Stripe re-asks for the status');
    ok(w.calls.some((c) => Array.isArray(c) && c[0] === 'url' && !/cashout/.test(c[1])), 'the marker is scrubbed so a reload does not re-toast', JSON.stringify(w.calls));
    ok(/payouts/i.test(w.toasts.join(' ')), 'a fully enabled account is confirmed', w.toasts.join(' | '));
    ok(w.ctx.App.screen === 'settings', 'and the player lands on their profile, not the title screen');
  }
  {
    const w = ctxOf({ connected: true, payouts_enabled: false });
    await w.run('return');
    ok(/still verifying/i.test(w.toasts.join(' ')), 'a pending account is NOT claimed as done', w.toasts.join(' | '));
  }
  {
    const w = ctxOf({ connected: false });
    await w.run('refresh');
    ok(/not finished/i.test(w.toasts.join(' ')), 'an abandoned onboarding says so and invites a retry', w.toasts.join(' | '));
  }
  {
    const w = ctxOf({});
    const r = await w.run(null);
    ok(r === null && w.calls.length === 0, 'an ordinary load does nothing at all');
  }
}

/* ── the status line, one wording for every screen ── */
{
  const say = (st) => {
    const ctx = { StripeCashout: st, console };
    vm.createContext(ctx);
    vm.runInContext(fnText('_payoutStatusText'), ctx);
    return vm.runInContext('_payoutStatusText()', ctx);
  };
  ok(say({ enabled: false }).tone === 'dim', 'an unconfigured deployment reads as dim');
  ok(/No payout account/.test(say({ enabled: true, connected: false }).text), 'not connected says so plainly');
  ok(say({ enabled: true, connected: true, payouts_enabled: false }).tone === 'warn', 'pending verification is a warning tone');
  ok(say({ enabled: true, connected: true, payouts_enabled: true }).tone === 'good', 'and a live account is good');
}

/* ── the profile block ── */
ok(/id="btn-cloud-stripe-connect"/.test(SRC), 'the profile has a connect button');
ok(/id="btn-cloud-stripe-refresh"/.test(SRC), 'and a re-check, because verification lands later');
ok(/Connect payout account/.test(SRC) && /Resume Stripe verification/.test(SRC), 'the button says which of the two it is');
ok(/the Cashout Vault and the Bazaar both use it/.test(SRC), 'the copy tells the player it is one shared account');
ok(/Stripe's own secure pages/.test(SRC), 'and that bank details are never typed into the game');
ok(/const _pc = \(typeof _payoutStatusText === 'function'\)/.test(SRC), 'the panel takes its wording from the shared helper');
ok(/'sovStore', 'shop', 'settings'\]\.indexOf\(App\.screen\)/.test(SRC), 'a status fetch repaints the profile when it lands');
{
  const i = SRC.indexOf("if (Profile.cloud && Profile.cloud.signedIn && (!StripeCashout.fetched");
  ok(i > 0 && /Date\.now\(\) - StripeCashout\.fetched > 60000/.test(SRC.slice(i, i + 200)),
    'a stale status refreshes itself without the player clicking anything');
}
ok(/Cloud\._payoutReturn = _payoutUrlReturn\(\)/.test(SRC), 'the return marker is snapshotted at boot');
{
  const iSnap = SRC.indexOf('Cloud._payoutReturn = _payoutUrlReturn()');
  const iCreate = SRC.indexOf('window.supabase.createClient(SUPABASE_URL');
  ok(iSnap > 0 && iCreate > iSnap, 'before createClient, which rewrites the URL');
}
ok(/if \(Cloud\._payoutReturn\) \{ var _pr = Cloud\._payoutReturn; Cloud\._payoutReturn = null;/.test(SRC),
  'and it is spent exactly once');
ok(/window\.MythicPayout = \{/.test(SRC), 'the seam is on window, not a top-level const');
ok(/window\.BUILD_VERSION = 'v121v(6[4-9]|[7-9]\d|\d{3,})'/.test(SRC), 'build v121v64 or later');
console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
