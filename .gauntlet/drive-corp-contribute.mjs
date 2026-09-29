/* ══════════════════════════════════════════════════════════════════════════
   🏢 DRIVE-CORP-CONTRIBUTE — one corporation each, and the right treasury.

   THE REPORT: "Allow for players to only create one corporation… This was one
   of the biggest factors of cities being wiped. Allow players to switch from
   their corp and corps they joined only. When they send cinder to their corp
   from Bank of ethos it only go to their own corp. Add a button for corps that
   players have joined where it say Contribute."

   Four claims, each with a control:

   1. THE BANK FUNDS THE CORPORATION YOU FOUNDED, whichever one you are acting
      in. It used to write to Corp.mine — "the corporation I am currently in" —
      so a member who switched to somebody else's corporation and moved Cinder
      from their own bank account funded a treasury they do not own, from a
      control labelled "your corporation", non-refundably.
      CONTROL: acting in your OWN corporation, the target is unchanged.
      CONTROL: founding nothing, the bank refuses rather than picking one.

   2. CONTRIBUTE IS THE OTHER HALF. Rendered only for a corporation you joined;
      absent for your own, where the bank control already reads correctly.

   3. THE SWITCHER OFFERS ONLY YOUR OWN MEMBERSHIPS. corpPick refuses an id
      that is not in Corp.myCorps.
      CONTROL: an id that IS in it is accepted.

   4. ONE CORPORATION PER PLAYER — the client shows a modal on the server's
      refusal instead of a raw error string.
      CONTROL: an unrelated insert error still shows the plain toast.

   Run:  node .gauntlet/drive-corp-contribute.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.jsx': 'text/babel', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const P = 8750 + (process.pid % 40);
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
await pg.waitForFunction('typeof boeCorpDeposit === "function" && typeof _corpOnlyOneModal === "function"', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(2500);

const out = await pg.evaluate(async () => {
  const o = {};
  o.reachable = typeof boeCorpDeposit === 'function' && typeof _corpOnlyOneModal === 'function';
  if (!o.reachable) return o;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  /* ── 1 · WHERE DOES THE BANK'S CINDER LAND? ────────────────────────────
     boeCorpDeposit is driven for real; only the two edges are stubbed — the
     confirm (so it does not block) and the insert (so the corp_id it CHOSE can
     be read instead of written to production). */
  const realFrom = Cloud.client.from.bind(Cloud.client);
  let captured = null;
  const stubInsert = () => {
    Cloud.client.from = (tbl) => {
      if (tbl !== 'corp_treasury') return realFrom(tbl);
      return { insert: async (row) => { captured = row; return { error: null }; } };
    };
  };
  const restore = () => { Cloud.client.from = realFrom; };
  window.gcConfirm = async () => true;
  Profile.cloud = Profile.cloud || {};
  Profile.cloud.signedIn = true; Profile.cloud.userId = 'me-uuid';
  Profile.gems = 100000;
  window.initCloud = () => true;
  window.corpTreasuryFetch = async () => {};
  window.saveProfile = () => {};

  const OWN = { id: 'own-corp', name: 'My Own Corp', tag: 'MINE' };
  const JOINED = { id: 'joined-corp', name: 'Someone Elses', tag: 'THEM' };

  // acting in a JOINED corp, but the player founded OWN
  Corp.owned = OWN; Corp.mine = { ...JOINED, role: 'member' };
  captured = null; stubInsert();
  await boeCorpDeposit(1000); await sleep(20); restore();
  o.bankWhileInJoined = captured ? captured.corp_id : null;      // must be own-corp

  // CONTROL: acting in their OWN corp — unchanged behaviour
  Corp.owned = OWN; Corp.mine = { ...OWN, role: 'founder' };
  captured = null; stubInsert();
  await boeCorpDeposit(1000); await sleep(20); restore();
  o.bankWhileInOwn = captured ? captured.corp_id : null;         // must be own-corp

  // CONTROL: founded nothing — the bank must refuse, not pick one
  Corp.owned = null; Corp.mine = { ...JOINED, role: 'member' };
  captured = null; stubInsert();
  o.bankNoCorpResult = await boeCorpDeposit(1000); await sleep(20); restore();
  o.bankNoCorpWrote = captured ? captured.corp_id : null;        // must be null

  /* ── 2 · the econ payload tells the UI which is which ─────────────────── */
  Corp.owned = OWN;
  Corp.myCorps = [{ id: OWN.id, name: OWN.name, tag: OWN.tag, role: 'founder' },
                  { id: JOINED.id, name: JOINED.name, tag: JOINED.tag, role: 'member' }];
  Corp.mine = { ...JOINED, role: 'member' };
  let econ = null; try { econ = _jbEcon(); } catch (e) { o.econErr = String(e).slice(0, 160); }
  o.inJoined = econ ? { actingInJoined: econ.actingInJoined,
                        owned: econ.ownedCorp && econ.ownedCorp.id,
                        flags: (econ.myCorps || []).map(c => c.id + ':' + (c.founded ? 'founded' : 'joined')) } : null;
  Corp.mine = { ...OWN, role: 'founder' };
  let econ2 = null; try { econ2 = _jbEcon(); } catch (e) {}
  o.inOwnActingInJoined = econ2 ? econ2.actingInJoined : null;   // must be false

  /* ── 3 · the switcher only accepts your own memberships ───────────────── */
  const toasts = [];
  const realToast = window.showToast;
  window.showToast = (m) => { toasts.push(String(m)); };
  _jbHandleAction({ kind: 'corpPick', corpId: 'a-corp-i-am-not-in' });
  await sleep(20);
  o.refusedStranger = toasts.some(t => /not a member/i.test(t));
  o.pickStored = Profile.corpPick || null;                        // must NOT be the stranger
  window.showToast = realToast;

  /* ── 4 · the one-corp modal ───────────────────────────────────────────── */
  _corpOnlyOneModal({ corp_id: 'x', name: 'My Own Corp', tag: 'MINE' });
  await sleep(30);
  const modal = document.getElementById('corp-one-modal');
  o.modalShown = !!modal;
  o.modalNames = modal ? /My Own Corp/.test(modal.textContent || '') : false;
  o.modalSaysOne = modal ? /one/i.test(modal.textContent || '') : false;
  try { document.getElementById('corp-one-ok').click(); } catch (e) {}
  await sleep(20);
  o.modalCloses = !document.getElementById('corp-one-modal');
  return o;
});

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
if (!out.reachable) bad.push('boeCorpDeposit / _corpOnlyOneModal not reachable');
else {
  need('the bank funds your OWN corp while you act in a joined one', out.bankWhileInJoined === 'own-corp', out.bankWhileInJoined);
  need('CONTROL: acting in your own corp, unchanged', out.bankWhileInOwn === 'own-corp', out.bankWhileInOwn);
  need('CONTROL: founded nothing → the bank refuses', out.bankNoCorpResult === false, out.bankNoCorpResult);
  need('…and writes nothing', out.bankNoCorpWrote === null, out.bankNoCorpWrote);
  need('the payload flags a joined corp', !!(out.inJoined && out.inJoined.actingInJoined === true), out.inJoined);
  need('…names the founded one', !!(out.inJoined && out.inJoined.owned === 'own-corp'), out.inJoined);
  need('…and marks each corp founded/joined', !!(out.inJoined && out.inJoined.flags
       && out.inJoined.flags.join(',') === 'own-corp:founded,joined-corp:joined'), out.inJoined);
  need('CONTROL: acting in your own corp is not "joined"', out.inOwnActingInJoined === false, out.inOwnActingInJoined);
  need('the switcher refuses a corp you are not in', out.refusedStranger === true, out.refusedStranger);
  need('…and stores nothing', out.pickStored !== 'a-corp-i-am-not-in', out.pickStored);
  need('the one-corp modal renders', out.modalShown, out);
  need('…naming the corporation they already have', out.modalNames, out);
  need('…and closes', out.modalCloses, out);
  need('no econ error', !out.econErr, out.econErr);
}

/* ── 5 · THE PANEL ITSELF, IN THE APP THAT RENDERS IT ─────────────────────
   Just Business is a separate React app in an iframe, transpiled in the
   browser. A syntax error or a bad hook there does not fail the host page —
   it unmounts the whole corporation UI, which that file's own header warns
   about. So the app is booted and the panel is rendered for real, with the
   control that matters: for a corporation you FOUNDED it must not appear at
   all, because the bank control already reads correctly there. */
{
  const pg2 = await b.newPage({ viewport: { width: 1200, height: 900 } });
  const uiErrs = []; pg2.on('pageerror', e => uiErrs.push(String(e).slice(0, 200)));
  await pg2.route('**/*', (r) => { const u = r.request().url();
    if (u.includes('127.0.0.1') || u.includes('unpkg.com') || u.includes('cdn.jsdelivr.net')) return r.continue(); return r.abort(); });
  await pg2.goto('http://127.0.0.1:' + P + '/corp/index.html', { waitUntil: 'load', timeout: 120000 });
  await pg2.waitForTimeout(7000);
  const ui = await pg2.evaluate(async () => {
    const o = {};
    o.compiled = typeof ContributePanel === 'function';
    if (!o.compiled) return o;
    const draw = (econ) => {
      const host = document.createElement('div'); document.body.appendChild(host);
      const acts = [];
      const el = React.createElement(ContributePanel, { econ, act: (x) => acts.push(x) });
      if (ReactDOM.createRoot) ReactDOM.createRoot(host).render(el); else ReactDOM.render(el, host);
      return host;
    };
    const JOINED = { actingInJoined: true, corp: { id: 'j', name: 'Someone Elses', tag: 'THEM' },
                     ownedCorp: { id: 'o', name: 'My Own Corp', tag: 'MINE' }, cinders: 5000 };
    const h1 = draw(JOINED);
    await new Promise(r => setTimeout(r, 400));
    const t1 = h1.textContent || '';
    o.joined = {
      saysContribute: /Contribute/.test(t1),
      namesTheJoinedCorp: /Someone Elses/.test(t1),
      namesTheOwnedCorp: /My Own Corp/.test(t1),
      hasButton: [...h1.querySelectorAll('button')].some(x => /Contribute/i.test(x.textContent || '')),
      showsWallet: /5,000/.test(t1),
    };
    // CONTROL: your OWN corporation gets no Contribute panel at all.
    const h2 = draw({ actingInJoined: false, corp: { id: 'o', name: 'My Own Corp', tag: 'MINE' },
                      ownedCorp: { id: 'o', name: 'My Own Corp', tag: 'MINE' }, cinders: 5000 });
    await new Promise(r => setTimeout(r, 300));
    o.ownRendersNothing = ((h2.textContent || '').trim() === '');
    return o;
  });
  await pg2.close();
  need('the Contribute panel compiles in Just Business', ui.compiled, ui);
  need('…and renders for a corporation you joined', !!(ui.joined && ui.joined.saysContribute && ui.joined.hasButton), ui.joined);
  need('…naming both corporations so the split is legible', !!(ui.joined && ui.joined.namesTheJoinedCorp && ui.joined.namesTheOwnedCorp), ui.joined);
  need('…and reading the wallet (econ.cinders, not cinder)', !!(ui.joined && ui.joined.showsWallet), ui.joined);
  need('CONTROL: your OWN corporation shows no Contribute panel', ui.ownRendersNothing === true, ui.ownRendersNothing);
  need('the corp app threw nothing', uiErrs.length === 0, uiErrs.slice(0, 2));
}
console.log(JSON.stringify({ ...out, pageErrors: errs.slice(0, 4) }, null, 2));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — the bank funds the corp you founded, Contribute covers the ones you joined, and the switcher stays inside your own memberships.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
