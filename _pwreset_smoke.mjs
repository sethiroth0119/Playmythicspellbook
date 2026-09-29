/* 🔐 FORGOT PASSWORD, END TO END (v121v61).

   Asked for: "Set up the forgot password system where players click they
   password it sends them. Make sure the email come from Hidn Studios."

   The REQUEST half already shipped; the ANSWER half did not, and that made
   the feature worse than absent — the link signed the player in, gave them
   no form, and was single-use, so it was spent and the password unchanged.

   Defends, by running the real functions against a stubbed Supabase auth:
     · the reset request sends an explicit redirectTo back into this game, so
       the link cannot depend on a dashboard field;
     · _authUrlRecovery reads the marker in either the hash or the query, and
       is snapshotted BEFORE createClient (which clears it);
     · PASSWORD_RECOVERY opens the new-password step, and the URL marker is a
       backstop when the event is missed;
     · cloudSetNewPassword writes through auth.updateUser, scrubs the spent
       token out of the address bar, and turns a dead link into a sentence the
       player can act on rather than "Auth session missing";
     · the modal has a newpass step with two fields, the submit branch refuses
       a short password and a mismatch before calling out, and the reset
       screen says the mail comes from Hidn Studios.

   Run: node _pwreset_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
function fnText(name) {
  let i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name);
  /* keep a leading `async` — slicing from `function` alone turns an async
     function into a sync one and its awaits into syntax errors */
  if (SRC.slice(i - 6, i) === 'async ') i -= 6;
  let d = 0, j = SRC.indexOf('{', i);
  for (let k = j; k < SRC.length; k++) { if (SRC[k] === '{') d++; else if (SRC[k] === '}') { d--; if (!d) return SRC.slice(i, k + 1); } }
}

/* ── the URL marker, run for real ── */
{
  const at = (search, hash) => {
    const ctx = { location: { search, hash }, console };
    vm.createContext(ctx);
    vm.runInContext(fnText('_authUrlRecovery'), ctx);
    return vm.runInContext('_authUrlRecovery()', ctx);
  };
  ok(at('', '#access_token=abc&type=recovery') === true, 'the implicit-flow hash is recognised');
  ok(at('?recover=1', '') === true, 'our own redirect marker is recognised');
  ok(at('?type=recovery', '') === true, 'a query-style recovery is recognised');
  ok(at('', '') === false && at('?x=1', '#y=2') === false, 'an ordinary load is not a recovery');
}

/* ── setting the password, run for real ── */
function pwWorld(updateResult) {
  const calls = [];
  const ctx = {
    initCloud: () => true,
    Cloud: { _initError: null, client: { auth: { updateUser: async (o) => { calls.push(o); return updateResult; } } } },
    location: { href: 'https://x.test/?recover=1', search: '?recover=1', hash: '', pathname: '/' },
    history: { replaceState: (a, b, u) => calls.push(['url', u]) },
    URL: class { constructor(h) { this.href = h; this.hash = ''; this.pathname = '/'; this._p = new Map([['recover', '1']]); }
      get search() { return this._p.size ? '?' + [...this._p].map(([k, v]) => k + '=' + v).join('&') : ''; }
      get searchParams() { const p = this._p; return { delete: (k) => p.delete(k) }; } },
    console,
  };
  vm.createContext(ctx);
  vm.runInContext([fnText('_authUrlRecovery'), fnText('_authCleanRecoveryUrl'), fnText('cloudSetNewPassword')].join('\n'), ctx);
  return { ctx, calls, run: (pw) => vm.runInContext('cloudSetNewPassword(' + JSON.stringify(pw) + ')', ctx) };
}
{
  const w = pwWorld({ error: null });
  const r = await w.run('newsecret');
  ok(r.ok === true, 'a good password is accepted', JSON.stringify(r));
  ok(w.calls[0] && w.calls[0].password === 'newsecret', 'it is written through auth.updateUser', JSON.stringify(w.calls[0]));
  ok(w.calls.some((c) => Array.isArray(c) && c[0] === 'url' && !/recover/.test(c[1])), 'the spent token is scrubbed out of the address bar', JSON.stringify(w.calls));
  ok(w.ctx.Cloud._recoveryPending === false, 'and the recovery flag is cleared');
}
{
  const w = pwWorld({ error: { message: 'Auth session missing!' } });
  const r = await w.run('newsecret');
  ok(r.ok === false && /expired or was already used/.test(r.error) && /new one/.test(r.error), 'a dead link is explained in words the player can act on', r.error);
}
{
  const w = pwWorld({ error: { message: 'Password should be at least 6 characters' } });
  const r = await w.run('short');
  ok(r.ok === false && /at least 6/.test(r.error), 'any other server refusal is passed through verbatim', r.error);
}

/* ── the opener retries until the modal layer exists ── */
{
  let opened = null, timers = [];
  const ctx = { App: undefined, openAuthModal: undefined, Cloud: {}, console,
    setTimeout: (fn) => { timers.push(fn); return 1; } };
  vm.createContext(ctx);
  vm.runInContext(fnText('_authOpenRecovery'), ctx);
  ok(vm.runInContext('_authOpenRecovery(0)', ctx) === false && timers.length === 1, 'with no modal layer yet it schedules a retry instead of giving up');
  ctx.App = {}; ctx.openAuthModal = (m) => { opened = m; };
  timers.shift()();
  ok(opened === 'newpass', 'and opens the new-password step as soon as the layer is there', String(opened));
}

/* ── the wiring, in source ── */
ok(/redirectTo: _back/.test(SRC) && /location\.origin \+ location\.pathname \+ '\?recover=1'/.test(SRC), 'the reset email is told to come back to this game');
ok(/if \(event === 'PASSWORD_RECOVERY'\) \{ Cloud\._recoveryPending = true; _authOpenRecovery\(0\); \}/.test(SRC), 'PASSWORD_RECOVERY opens the new-password step');
ok(/if \(Cloud\._recoveryUrl\) \{ Cloud\._recoveryPending = true; _authOpenRecovery\(0\); \}/.test(SRC), 'and the URL marker is a backstop when the event is missed');
{
  const iSnap = SRC.indexOf('Cloud._recoveryUrl = _authUrlRecovery()');
  const iCreate = SRC.indexOf('window.supabase.createClient(SUPABASE_URL');
  ok(iSnap > 0 && iCreate > iSnap, 'the marker is snapshotted BEFORE createClient, which clears it');
}
ok(/s\.mode === 'newpass' \?/.test(SRC) && /id="auth-newpass"/.test(SRC) && /id="auth-newpass2"/.test(SRC), 'the modal has a new-password step with a confirm field');
ok(/if \(App\.authModal\.mode === 'newpass'\) \{/.test(SRC) && /Those two passwords do not match/.test(SRC) && /Password must be at least 6 characters/.test(SRC), 'the submit branch checks length and match before calling out');
{
  const i = SRC.indexOf("if (App.authModal.mode === 'newpass') {");
  const j = SRC.indexOf("const emailEl = document.getElementById('auth-email');", i);
  ok(i > 0 && j > i && (j - i) < 1400, 'and it answers BEFORE the email validation, which has no field to read');
}
ok(/The reset link arrives from <strong>Hidn Studios<\/strong>/.test(SRC), 'the reset screen names Hidn Studios as the sender');
ok(/The link from Hidn Studios signed you in for this one purpose/.test(SRC), 'and so does the new-password step');
ok(/spam \/ promotions<\/strong> folder if it has not landed/.test(SRC), 'it tells the player where to look if the mail is slow');
ok(/window\.BUILD_VERSION = 'v121v(6[1-9]|[7-9]\d|\d{3,})'/.test(SRC), 'build v121v61 or later');
console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
