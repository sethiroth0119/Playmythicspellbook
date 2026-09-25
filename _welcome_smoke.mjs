/* 📨 WELCOME EMAIL, END TO END (v121v62).

   Asked for: "have it where a member join the game have it send them a
   welcome email."

   The dangerous failure here is not silence, it is VOLUME — a welcome mail
   sent twice, or sent to every existing player at once, and neither can be
   recalled. Three things prevent that, and all three are pinned below:

     · the roll-out backfill in sql/120 marks every account that already
       exists as welcomed, so shipping this does not greet the whole game;
     · the claim is an INSERT against a primary key, so two tabs signing in
       together produce one winner, not two mails;
     · env.EMAIL is checked BEFORE the claim, so onboarding the sending domain
       later is retroactive instead of having silently burned everyone's claim.

   Also runs the real client function to prove it only remembers "done" when
   the server actually settled the question.

   Run: node _welcome_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
const WK  = readFileSync('./worker.js', 'utf8');
const SQL = readFileSync('./sql/120_welcome_email.sql', 'utf8');
const WR  = readFileSync('./wrangler.jsonc', 'utf8');
function fnText(src, name) {
  let i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name);
  if (src.slice(i - 6, i) === 'async ') i -= 6;
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); } }
}

/* ── the roll-out guard: the single most expensive thing to get wrong ── */
{
  const i = SQL.indexOf('insert into public.welcome_emails (user_id, email, claimed_at, sent_at)');
  ok(i > 0 && /select u\.id, u\.email, now\(\), now\(\)\s*\n\s*from auth\.users u/.test(SQL),
    'every account that already exists is backfilled as welcomed');
  ok(/on conflict \(user_id\) do nothing;/.test(SQL.slice(i)), 'and the backfill cannot clobber a live row');
  ok(SQL.indexOf('begin;') > 0 && /commit;\s*$/.test(SQL.trim()),
    'the table, the functions and the backfill land in ONE transaction');
  ok(SQL.indexOf('create table if not exists public.welcome_emails') < i,
    'the table is created before the backfill fills it');
}

/* ── one mail, not two ── */
ok(/user_id\s+uuid primary key references auth\.users\(id\)/.test(SQL), 'the claim is keyed, so Postgres picks the winner');
ok(/on conflict \(user_id\) do update\s*\n\s*set claimed_at = now\(\)\s*\n\s*where public\.welcome_emails\.sent_at is null/.test(SQL),
  'a row that was already SENT can never be re-claimed');
ok(/claimed_at < now\(\) - interval '10 minutes'/.test(SQL), 'but a claim that never sent reopens after ten minutes');
ok(/returning true into v_won;/.test(SQL) && /return coalesce\(v_won, false\);/.test(SQL),
  'and a caller that matched no branch is told false, not null');

/* ── grants ── */
ok(/revoke all on function public\.claim_welcome_email\(\)\s+from public, anon;/.test(SQL)
  && /revoke all on function public\.mark_welcome_email_sent\(\) from public, anon;/.test(SQL),
  'BOTH acl entries come off — public and anon, not just public');
ok(/grant execute on function public\.claim_welcome_email\(\)\s+to authenticated;/.test(SQL), 'signed-in players may claim');
ok(/for select to authenticated using \(user_id = auth\.uid\(\)\)/.test(SQL), 'a player can read only their own record');
ok(!/for (insert|update|delete)/i.test(SQL), 'and no policy lets a client write the table directly');

/* ── the worker: recipient comes from the JWT, never the request ── */
{
  const h = fnText(WK, 'handleWelcome');
  ok(/const user = await sbUser\(env, request\);/.test(h) && /if \(!user\) return cjson\(\{ ok: false, error: 'unauthorized' \}, 401\);/.test(h),
    'an unauthenticated caller is refused');
  ok(/to: user\.email,/.test(h) && !/request\.json\(\)/.test(h) && !/body\.(to|email)/.test(h),
    'the recipient is read off the verified token, never off the request body');
  const iBind  = h.indexOf('if (!env.EMAIL)');
  const iClaim = h.indexOf('claim_welcome_email');
  const iSend  = h.indexOf('env.EMAIL.send');
  ok(iBind > 0 && iClaim > iBind, 'the binding is checked BEFORE the claim, so onboarding later still works');
  ok(iClaim > 0 && iSend > iClaim, 'and the claim is taken BEFORE the send — a late mail beats a double mail');
  ok(/from: WELCOME_FROM,/.test(h) && /name: 'Hidn Studios'/.test(WK), 'the mail is from Hidn Studios');
  ok(/if \(request\.method !== 'POST'\)/.test(h), 'GET cannot trigger a send');
}
ok(/_welcomeEsc\(name/.test(WK), 'the greeting name is escaped before it reaches HTML');
ok(/name: \(j\.user_metadata && j\.user_metadata\.display_name\) \|\| null/.test(WK), 'and that name comes from the token account record');
ok(/if \(u\.pathname === '\/api\/welcome'\) \{/.test(WK), 'the route is wired');
ok(/"send_email": \[\{ "name": "EMAIL" \}\]/.test(WR), 'the EMAIL binding is declared');

/* ── the client function, run for real ── */
function world(res, opts) {
  opts = opts || {};
  const store = opts.store || {};
  const calls = [];
  const ctx = {
    App: {}, console,
    Profile: { cloud: { userId: opts.uid || 'u1', signedIn: opts.signedIn !== false } },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } },
    _sbToken: async () => (opts.token === undefined ? 'tok' : opts.token),
    fetch: async (u, o) => { calls.push([u, o]); if (res === 'throw') throw new Error('offline'); return { json: async () => res }; },
    setTimeout: (fn) => fn(),
    window: {},
  };
  vm.createContext(ctx);
  vm.runInContext([fnText(SRC, '_welcomeKey'), fnText(SRC, '_welcomeMaybeSend')].join('\n'), ctx);
  return { ctx, store, calls, run: () => vm.runInContext('_welcomeMaybeSend()', ctx) };
}
{
  const w = world({ ok: true, sent: true });
  await w.run();
  ok(w.calls.length === 1 && w.calls[0][0] === '/api/welcome' && w.calls[0][1].method === 'POST', 'it POSTs to /api/welcome');
  ok(/^Bearer /.test(w.calls[0][1].headers.authorization), 'with the session token');
  ok(!w.calls[0][1].body, 'and sends no body — it cannot name a recipient');
  ok(w.store['mythic_welcome_u1'] === '1', 'a sent mail is remembered');
}
{
  const w = world({ ok: true, sent: false, reason: 'already_sent' });
  await w.run();
  ok(w.store['mythic_welcome_u1'] === '1', 'so is an account the server says was already greeted');
}
{
  const w = world({ ok: true, sent: false, reason: 'email_not_configured' });
  await w.run();
  ok(w.store['mythic_welcome_u1'] === undefined, 'but "not configured yet" is NOT remembered as done');
  ok(w.ctx.App._welcomeTried === false, 'and the page-load latch reopens so onboarding is retroactive');
}
{
  const w = world('throw');
  await w.run();
  ok(w.store['mythic_welcome_u1'] === undefined && w.ctx.App._welcomeTried === false, 'a dead network retries later');
}
{
  const w = world({ ok: true, sent: true }, { store: { mythic_welcome_u1: '1' } });
  await w.run();
  ok(w.calls.length === 0, 'an already-greeted account never even asks');
}
{
  const w = world({ ok: true, sent: true }, { token: null });
  await w.run();
  ok(w.calls.length === 0 && w.ctx.App._welcomeTried === false, 'no token yet means wait, not give up');
}
{
  const w = world({ ok: true, sent: true }, { signedIn: false });
  await w.run();
  ok(w.calls.length === 0, 'a signed-out visitor asks for nothing');
}
{
  const w = world({ ok: true, sent: true });
  await w.run(); const before = w.calls.length;
  await w.run();
  ok(w.calls.length === before, 'and it asks at most once per page load');
}

/* ── the hook ── */
ok(/if \(session && session\.user && event !== 'PASSWORD_RECOVERY'\) \{/.test(SRC),
  'it fires on a real session, and not while someone is resetting a password');
ok(/setTimeout\(function \(\) \{ _welcomeMaybeSend\(\); \}, 1800\);/.test(SRC), 'deferred, so sign-in never waits on an email');
ok(/window\.MythicWelcome = \{ maybeSend: _welcomeMaybeSend/.test(SRC), 'the seam is on window, not a top-level const');
ok(/window\.BUILD_VERSION = 'v121v(6[2-9]|[7-9]\d|\d{3,})'/.test(SRC), 'build v121v62 or later');
console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
