/* 🔑 CHANGE PASSWORD FROM THE PROFILE (v121v63).

   Asked for: "Make it in the player profile they can change their password if
   they know the old password to the account."

   "If they know the old password" is the whole feature, and it is the part
   Supabase does NOT give you: auth.updateUser({password}) rewrites the
   password of whatever session the browser holds without ever asking for the
   old one. On a game with real money in the wallets, that turns any unlocked
   device into an account takeover.

   So the test that matters is the negative one: with a WRONG current password,
   updateUser must never be reached. That is checked by running the real
   function against a stubbed auth client and asserting on the call log.

   Run: node _pwchange_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
function fnText(name) {
  let i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name);
  if (SRC.slice(i - 6, i) === 'async ') i -= 6;
  let d = 0, j = SRC.indexOf('{', i);
  for (let k = j; k < SRC.length; k++) { if (SRC[k] === '{') d++; else if (SRC[k] === '}') { d--; if (!d) return SRC.slice(i, k + 1); } }
}

/* A stub auth client that knows one real password. */
function world(opts) {
  opts = opts || {};
  const real = opts.real || 'oldpass';
  const calls = [];
  const ctx = {
    console, window: {},
    initCloud: () => true,
    Profile: { cloud: { email: opts.email === undefined ? 'p@x.test' : opts.email, signedIn: opts.signedIn !== false } },
    Cloud: {
      _initError: null,
      client: {
        auth: {
          signInWithPassword: async (o) => {
            calls.push(['signin', o.email, o.password]);
            if (opts.signinError) return { error: { message: opts.signinError } };
            return o.password === real ? { error: null } : { error: { message: 'Invalid login credentials' } };
          },
          updateUser: async (o) => {
            calls.push(['update', o.password]);
            return opts.updateError ? { error: { message: opts.updateError } } : { error: null };
          },
        },
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(fnText('cloudChangePassword'), ctx);
  return { ctx, calls, run: (a, b) => vm.runInContext('cloudChangePassword(' + JSON.stringify(a) + ',' + JSON.stringify(b) + ')', ctx) };
}

/* ── THE ONE THAT MATTERS ── */
{
  const w = world();
  const r = await w.run('wrongpass', 'brandnew1');
  ok(r.ok === false, 'a wrong current password is refused', JSON.stringify(r));
  ok(/current password is not right/i.test(r.error), 'and is named plainly, not as "Invalid login credentials"', r.error);
  ok(!w.calls.some((c) => c[0] === 'update'), 'updateUser is NEVER reached — this is the takeover guard', JSON.stringify(w.calls));
}

/* ── the happy path ── */
{
  const w = world();
  const r = await w.run('oldpass', 'brandnew1');
  ok(r.ok === true, 'the right current password is accepted', JSON.stringify(r));
  ok(w.calls[0][0] === 'signin' && w.calls[0][2] === 'oldpass', 'the old password is proved first');
  ok(w.calls[1] && w.calls[1][0] === 'update' && w.calls[1][1] === 'brandnew1', 'and only then is the new one written');
  ok(w.calls[0][1] === 'p@x.test', 'proof is against the signed-in account, not a typed address');
}

/* ── refusals that never touch the network ── */
{
  const w = world();
  const r = await w.run('', 'brandnew1');
  ok(r.ok === false && /current password/i.test(r.error) && w.calls.length === 0, 'an empty current password never calls out');
}
{
  const w = world();
  const r = await w.run('oldpass', 'short');
  ok(r.ok === false && /at least 6/.test(r.error) && w.calls.length === 0, 'a short new password is caught locally', r.error);
}
{
  const w = world();
  const r = await w.run('oldpass', 'oldpass');
  ok(r.ok === false && /already your password/i.test(r.error) && w.calls.length === 0, 'reusing the same password is refused', r.error);
}
{
  const w = world({ signedIn: false });
  const r = await w.run('oldpass', 'brandnew1');
  ok(r.ok === false && w.calls.length === 0, 'a signed-out player cannot change anything');
}
{
  const w = world({ email: '' });
  const r = await w.run('oldpass', 'brandnew1');
  ok(r.ok === false && w.calls.length === 0, 'and neither can a session with no address to prove against');
}

/* ── server refusals are passed on in words ── */
{
  const w = world({ signinError: 'Request rate limit reached' });
  const r = await w.run('oldpass', 'brandnew1');
  ok(r.ok === false && /wait a minute/i.test(r.error), 'a rate limit tells the player to wait', r.error);
  ok(!w.calls.some((c) => c[0] === 'update'), 'and still does not write a password');
}
{
  const w = world({ updateError: 'Auth session missing!' });
  const r = await w.run('oldpass', 'brandnew1');
  ok(r.ok === false && /session expired/i.test(r.error), 'a session that dies mid-change says so', r.error);
}

/* ── the UI, in source ── */
ok(/id="set-pw-current"/.test(SRC) && /id="set-pw-new"/.test(SRC) && /id="set-pw-new2"/.test(SRC), 'the profile has current + new + confirm fields');
ok(/autocomplete="current-password"/.test(SRC) && (SRC.match(/autocomplete="new-password"/g) || []).length >= 4, 'the fields carry the right autocomplete roles');
ok(/id="btn-cloud-changepw"/.test(SRC), 'and an Update Password button');
ok(/Those two new passwords do not match/.test(SRC), 'the handler checks the confirm field before calling out');
{
  const i = SRC.indexOf("const bChangePw = document.getElementById('btn-cloud-changepw');");
  const seg = SRC.slice(i, i + 1800);
  ok(i > 0 && /if \(elCur\) elCur\.value = '';/.test(seg) && /elNew\.value = '';/.test(seg) && /elNew2\.value = '';/.test(seg),
    'all three fields are cleared on success — no password is left on screen');
  ok(!/render\(\);/.test(seg), 'and it does not re-render mid-flow, which would wipe what was typed');
}
ok(/sign out and use <em>Forgot password\?<\/em>/.test(SRC), 'a player who has forgotten the old one is pointed at the reset flow');
ok(/\.settings-input \{/.test(SRC) && /\.settings-input:focus/.test(SRC), 'the inputs are actually styled, not bare');
ok(/window\.MythicPassword = \{ change: cloudChangePassword \}/.test(SRC), 'the seam is on window, not a top-level const');
ok(/window\.BUILD_VERSION = 'v121v(6[3-9]|[7-9]\d|\d{3,})'/.test(SRC), 'build v121v63 or later');
console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
