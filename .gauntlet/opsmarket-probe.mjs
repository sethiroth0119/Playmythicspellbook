/* ══════════════════════════════════════════════════════════════════════════
   OPS + MARKET PROBE — the Operations page belongs to the corporation's OWNER,
   and a Player Market listing says how long it has left.

   Feature board (Gary Brooks, UI/Interface):
     1. "Lock down control of the Operations on Just Business → Operations" —
        after people "trying to help out" compromised the corporation, ONLY THE
        OWNER should buy Operations, employ/remove workers, make or accept job
        offers to Player Staff, and collect payouts.
     2. "Show a 'how long listing has left' / 'listing expires at…' time on the
        Player Market", and tell the seller when a listing lapses and the goods
        return to their stash.

   WHAT THIS DRIVES, IN THE LOADED PAGE (no sign-in — the gate is reached by
   standing Corp up through the existing __mg.laws probe seam and calling the
   REAL _jbHandleAction, which is what the Just Business iframe posts to):
     O1–O4  each of the four actions is REFUSED for a member who is not the
            owner (including a member holding the CEO title, which is the case
            that was open), and NOT refused for the owner.
     O5     the rendered half: public/corp/screens.jsx gates on the narrower
            fact the bridge now sends.
     M1–M3  a listing row shows a correct remaining time (the clock is frozen
            for the measurement), an expired row says so, and the "it did not
            sell, it is back in your inventory" notice exists and is NOT filed
            under a sale.

   Usage:  node .gauntlet/opsmarket-probe.mjs [candidate-index.html] [candidate-screens.jsx]
           (a static server on :8787 serving public/ — see .gauntlet/README.md)

   Expected: FAIL on HEAD, PASS on the candidate pair.
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import fs from 'node:fs';

const CAND_HTML = process.argv[2] || null;
const CAND_JSX = process.argv[3] || null;

/* 🔴 SERVICE WORKERS BLOCKED, AND THAT IS LOAD-BEARING. sw.js takes control a
   second or two into the page and then answers fetches from ITS cache, which
   Playwright's page routes do not intercept. Measured: the candidate
   screens.jsx was served correctly to a fast-finishing script and the HEAD copy
   (198,802 bytes rather than 199,892) to this one, purely because this probe
   waits longer before asking — a candidate check that silently reads HEAD is a
   green light for a change that was never loaded. */
const b = await chromium.launch();
const ctxB = await b.newContext({ serviceWorkers: 'block' });
const p = await ctxB.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e.message || e)));

if (CAND_HTML) {
  const html = fs.readFileSync(CAND_HTML, 'utf8');
  await p.route('**/index.html', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
}
if (CAND_JSX) {
  const jsx = fs.readFileSync(CAND_JSX, 'utf8');
  await p.route('**/corp/screens.jsx', (r) => r.fulfill({ status: 200, contentType: 'text/babel; charset=utf-8', body: jsx }));
}

await p.goto('http://localhost:8787/index.html', { waitUntil: 'load', timeout: 60000 });
await p.waitForFunction(() => typeof window._jbHandleAction === 'function' && !!window.__mg && !!window.__mg.laws, null, { timeout: 60000 });
// The trading module is a separate <script type="module"> — give it its moment.
await p.waitForFunction(() => !!window.MythicTrading, null, { timeout: 30000 }).catch(() => {});

const out = await p.evaluate(async () => {
  const R = [];
  const ok = (label, cond, detail) => R.push({ label, pass: !!cond, detail: detail == null ? '' : String(detail).slice(0, 200) });

  /* ── toast capture. showToast is a function declaration, so it IS on window;
        the refusal is the observable the player gets, so it is the observable
        this probe reads. */
  const said = [];
  const realToast = window.showToast;
  window.showToast = function (msg) { said.push(String(msg == null ? '' : msg)); try { return realToast.apply(this, arguments); } catch (e) {} };
  const heardOwnerRefusal = () => said.some(t => /only .*OWNER can/i.test(t));
  const clear = () => { said.length = 0; };

  const L = window.__mg.laws;
  const G = window.__mg.opsOwner || null;
  ok('O0 the owner gate exists in this build (__mg.opsOwner)', !!G);

  const OP_ID = 'probe-op-1';
  const opRow = () => ({
    id: OP_ID, corp_id: 'probe-corp', op_type: 'mining', level: 1, workers: 1, status: 'active',
    // 12 hours ago, so a collect is off cooldown and the handler has to reach
    // its permission check rather than bouncing on the timer.
    meta: { lastCollect: Date.now() - 12 * 3600000 },
    created_at: new Date(Date.now() - 48 * 3600000).toISOString(),
  });
  const asMember = () => L._probeSet({
    // The exact shape the bug was about: a member who has been appointed CEO.
    // amOwner is TRUE for them — that is the hole — and founderId is somebody
    // else's, which is the fact that decides it.
    mine: { id: 'probe-corp', name: 'Probe Holdings', role: 'CEO', founderId: 'another-player-uuid' },
    amOwner: true, owned: null, roster: [{ userId: 'u2', name: 'Helper', role: 'member' }],
  });
  const asOwner = () => L._probeSet({
    mine: { id: 'probe-corp', name: 'Probe Holdings', role: 'founder', founderId: 'me-uuid' },
    amOwner: true, owned: { id: 'probe-corp', name: 'Probe Holdings', tag: 'PRB' },
    roster: [{ userId: 'u2', name: 'Helper', role: 'member' }],
  });
  const seed = () => { if (G && G._seedOps) G._seedOps([opRow()]); };

  const drive = async (action) => {
    clear();
    try { window._jbHandleAction(action); } catch (e) { said.push('THREW ' + e.message); }
    await new Promise(r => setTimeout(r, 140));   // the handlers are async inside
    return said.slice();
  };

  try {
    // ── O1. buying an Operation ──────────────────────────────────────────
    asMember(); seed();
    await drive({ kind: 'opFound', op: 'mining' });
    ok('O1a buy an Operation is REFUSED for a non-owner member', heardOwnerRefusal(), said.join(' | '));
    asOwner(); seed();
    await drive({ kind: 'opFound', op: 'mining' });
    ok('O1b …and the owner is not refused', !heardOwnerRefusal(), said.join(' | '));

    /* The Aza route reaches the same INSERT and had no owner test at all
       before this change. It has to be driven with an operation that actually
       carries an Aza price or the handler bounces on "no Aza price" before the
       gate — `feed` is one (construction is the other, and construction is the
       one deliberate exemption, so it would prove nothing here). */
    asMember(); seed();
    await drive({ kind: 'opFound', op: 'feed', pay: 'aza' });
    ok('O1c the Aza founding route is refused too', heardOwnerRefusal(), said.join(' | '));

    // ── O2. employing / removing workers (the Labour Pool) ───────────────
    asMember(); seed();
    await drive({ kind: 'opAssign', opId: OP_ID, workers: 5 });
    ok('O2a staffing an Operation is REFUSED for a non-owner member', heardOwnerRefusal(), said.join(' | '));
    ok('O2b …and the worker count did not move', ((G && G.ops()[0]) || {}).workers === 1, JSON.stringify((G && G.ops()[0]) || null));
    asOwner(); seed();
    await drive({ kind: 'opAssign', opId: OP_ID, workers: 5 });
    ok('O2c …and the owner is not refused', !heardOwnerRefusal(), said.join(' | '));

    // ── O3. job offers to Player Staff ───────────────────────────────────
    asMember(); seed();
    await drive({ kind: 'staffOffer', opId: OP_ID, userId: 'u2', userName: 'Helper', wage: 100 });
    ok('O3a offering a job is REFUSED for a non-owner member', heardOwnerRefusal(), said.join(' | '));
    asOwner(); seed();
    const ownerStaff = await drive({ kind: 'staffOffer', opId: OP_ID, userId: 'u2', userName: 'Helper', wage: 100 });
    ok('O3b …and the owner gets past the gate (stopped only by sign-in)',
      !heardOwnerRefusal() && ownerStaff.some(t => /sign in/i.test(t)), ownerStaff.join(' | '));
    // The worker's own side must stay open or nobody can ever be hired.
    asMember(); seed();
    const applied = await drive({ kind: 'staffApply', opId: OP_ID, wage: 90 });
    ok('O3c a member may still APPLY for a job', !heardOwnerRefusal(), applied.join(' | '));

    // ── O4. collecting the payout ────────────────────────────────────────
    asMember(); seed();
    await drive({ kind: 'opCollect', opId: OP_ID });
    ok('O4a collecting a payout is REFUSED for a non-owner member', heardOwnerRefusal(), said.join(' | '));
    asOwner(); seed();
    const ownerCollect = await drive({ kind: 'opCollect', opId: OP_ID });
    ok('O4b …and the owner is not refused', !heardOwnerRefusal(), ownerCollect.join(' | '));

    // ── the gate's own answer, both ways ─────────────────────────────────
    if (G) {
      asMember(); ok('O4c __mg.opsOwner.may() is false for the appointed CEO', G.may() === false);
      asOwner();  ok('O4d __mg.opsOwner.may() is true for the owner', G.may() === true);
    } else {
      ok('O4c __mg.opsOwner.may() is false for the appointed CEO', false, 'no gate in this build');
      ok('O4d __mg.opsOwner.may() is true for the owner', false, 'no gate in this build');
    }
  } finally {
    try { L._probeRestore(); } catch (e) {}
    try { if (G && G._restoreOps) G._restoreOps(); } catch (e) {}
    window.showToast = realToast;
  }

  // ── O5. the RENDERED half (source-level: the iframe needs a live corp) ──
  try {
    const jsx = await fetch('/corp/screens.jsx').then(r => r.text());
    ok('O5a screens.jsx gates the Operations card on the narrower owner fact',
      /const isOwner = !!\(E\.amTrueOwner/.test(jsx), 'bytes=' + jsx.length + ' amTrueOwner@' + jsx.indexOf('amTrueOwner'));
    ok('O5b …and a member can still apply for a job (the member-side control is untouched)',
      /kind: 'staffApply'/.test(jsx));
  } catch (e) { ok('O5 screens.jsx readable', false, e.message); }

  // ── the bridge that carries it ─────────────────────────────────────────
  ok('O6 the Just Business payload carries amTrueOwner',
    typeof window._jbEcon === 'function' && /amTrueOwner/.test(String(window._jbEcon)));

  // ══ MARKET ═════════════════════════════════════════════════════════════
  const T = Date.parse('2026-09-19T12:00:00.000Z');
  const realNow = Date.now;
  try {
    const MT = window.MythicTrading;
    ok('M0 the trading module is loaded', !!MT);
    if (MT) {
      const ttl = MT.ctx.listingTtlMs ? MT.ctx.listingTtlMs() : 0;
      ok('M1a the listing TTL reaches the module from index.html', ttl > 0, 'ttl=' + ttl);

      // Freeze the clock for the measurement only. render.js reads Date.now()
      // directly, so a real-clock assertion would be a coin flip on the minute
      // boundary — and a countdown test that is right 59 minutes an hour is the
      // test being wrong, not flaky.
      // Listed so that exactly 3h 12m of its life is LEFT — the example from
      // the report, and the shape the seller reads off the row.
      const made = new Date(T - (ttl - (3 * 3600000 + 12 * 60000))).toISOString();
      const live = { id: 'L1', seller_id: 'me', seller_name: 'Me', resource: 'wood', qty: 100,
                     lot_size: 100, lots_total: 1, lots_left: 1, price: 50, currency: 'cinders',
                     created_at: made, status: 'open' };
      Date.now = () => T;
      let mineHtml = '', theirs = '', deadHtml = '';
      try {
        mineHtml = MT.rowHtml(live, true);
        theirs = MT.rowHtml(Object.assign({}, live, { seller_id: 'other' }), false);
        deadHtml = MT.rowHtml(Object.assign({}, live, { created_at: new Date(T - (ttl + 3600000)).toISOString() }), true);
      } finally { Date.now = realNow; }

      const want = '3h 12m';
      ok('M1b my own listing row shows the time remaining', /expires in/.test(mineHtml));
      ok('M1c …and the number is the real one (3h 12m left, clock frozen)',
        mineHtml.indexOf('expires in ' + want) >= 0, 'wanted "expires in ' + want + '"');
      ok('M1d …with the absolute expiry in the tooltip',
        /title="[^"]*return to your stash at [^"]+"/.test(mineHtml));
      ok('M1e someone else\'s row shows it too', /ends in/.test(theirs));
      ok('M1f a listing past its TTL says so instead of counting down',
        /expired/.test(deadHtml) && !/expires in/.test(deadHtml));

      // A market must never invent a deadline it cannot stand behind.
      const noTtl = Object.assign({}, MT.ctx, { listingTtlMs: () => 0 });
      ok('M1g with no TTL known, NO countdown is drawn (it does not guess)',
        MT.render.expiryHtml(live, noTtl, true) === '');
    } else {
      ok('M1 the market row can show a remaining time', false, 'no trading module');
    }
  } catch (e) { ok('M1 the market row can show a remaining time', false, e.message); }

  // ── M2. the lapse notice ───────────────────────────────────────────────
  try {
    const n = window._resEntryNotice({ party: 'seller', kind: 'expire', resource: 'wood', units: 200, currency: 'cinders' });
    ok('M2a an expired listing produces a notice that says it did NOT sell',
      !!n && /did not sell/i.test(n.text) && /back in your inventory/i.test(n.text), n && n.text);
    ok('M2b …and it is not filed as money earned',
      !!n && n.tone !== 'good' && window._resEntryBucket({ party: 'seller', kind: 'expire' }) === 'back');
    const sale = window._resEntryNotice({ party: 'seller', kind: 'sale', resource: 'wood', units: 200, price_total: 500, currency: 'cinders', counterparty: 'Gary' });
    ok('M2c a real sale still reads as a sale, with the buyer named',
      !!sale && /sold/i.test(sale.text) && /Gary/.test(sale.text), sale && sale.text);
  } catch (e) { ok('M2 the lapse notice', false, e.message); }

  // ── M3. it reaches the player without opening the market ───────────────
  ok('M3a a background sweep exists (it does not wait for the market screen)',
    typeof window._resPayoutTick === 'function');
  ok('M3b …and it is the sweep that raises the notification',
    typeof window._resSweep === 'function' && /_resNotifyEntry/.test(String(window._resSweep)));
  ok('M3c the notice is raised only AFTER the payout settled (never ahead of it)',
    /if \(r\.ok\) \{ done\.push\(e\); _resNotifyEntry\(e\);/.test(String(window._resSweep)));

  return R;
});

const pass = out.filter(r => r.pass).length;
for (const r of out) console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.label + (r.detail ? '   [' + r.detail + ']' : ''));
if (errs.length) console.log('\npage errors: ' + errs.slice(0, 4).join(' | '));
console.log('\n' + pass + '/' + out.length + ' checks passed' + (CAND_HTML ? '   (candidate: ' + CAND_HTML + ')' : '   (HEAD)'));
await b.close();
process.exit(pass === out.length ? 0 : 1);
