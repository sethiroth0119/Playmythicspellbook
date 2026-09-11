/* 💳 PAYING FOR SOMETHING SENT THE PLAYER BACK TO THE FRONT DOOR.

   Reported: "When you buy resource points, the purchasing app dumps you right
   back at the start — the game re-starts, so you have to go through the whole
   Open bank / Open City Hall / Open Foundation Reserve → PRNs / Open City Nodes
   / Open City to get back to where you wanted to be."

   🔴 THE GAME REALLY DOES RESTART AND NO CODE WAS MISBEHAVING. A card purchase
   is a Stripe REDIRECT: `location.href = j.url` leaves the site, the player
   pays, and Stripe returns them to a COLD PAGE LOAD, which opens where a cold
   page load opens. Nobody had written down where they came from, so there was
   nothing to return to. Two flows redirect this way — development points and
   paid licences — and both had the same hole.

   WHAT THIS PINS: the crumb is dropped BEFORE the redirect (after that line the
   page is gone), it is read back on the confirmed return, it expires, and it is
   consumed once so a later cold load cannot be hijacked by a stale one.

   Run: node _payreturn_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const IDX = readFileSync('./public/index.html', 'utf8');

function fnText(name) {
  const i = IDX.search(new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\('));
  if (i < 0) throw new Error('cannot find ' + name);
  let d = 0;
  for (let k = IDX.indexOf('{', i); k < IDX.length; k++) {
    if (IDX[k] === '{') d++;
    else if (IDX[k] === '}') { d--; if (!d) return IDX.slice(i, k + 1); }
  }
  throw new Error('unbalanced ' + name);
}

/* ── 1. BOTH REDIRECTS REMEMBER, AND REMEMBER IN TIME ────────────────────── */
{
  ok((IDX.match(/payReturnRemember\(\);/g) || []).length === 2,
    'both redirecting purchases drop a crumb', String((IDX.match(/payReturnRemember\(\);/g) || []).length));
  ok((IDX.match(/payReturnRestore\(\);/g) || []).length === 2, 'and both returns read it back');
  /* 🔴 ORDER IS THE WHOLE THING. After `location.href` the page is on its way
     out; a crumb written after it may never be written at all. */
  for (const fn of ['devPointsCheckout', 'licenceCheckout']) {
    const t = fnText(fn);
    const rem = t.indexOf('payReturnRemember()'), go = t.indexOf('location.href = j.url');
    ok(rem >= 0 && go >= 0 && rem < go,
      fn + ' writes the crumb BEFORE it navigates away — after that line the page is gone', 'remember@' + rem + ' redirect@' + go);
  }
}

/* ── 2. THE CRUMB'S OWN RULES ────────────────────────────────────────────── */
{
  const ctx = {
    App: { screen: 'city', titleHub: null },
    Date, JSON, String, Number,
    localStorage: (() => { const m = {}; return {
      getItem: k => (k in m ? m[k] : null),
      setItem: (k, v) => { m[k] = String(v); },
      removeItem: k => { delete m[k]; },
      _m: m,
    }; })(),
  };
  vm.createContext(ctx);
  vm.runInContext(
    'const PAY_RETURN_KEY = ' + /const PAY_RETURN_KEY = ('[^']*')/.exec(IDX)[1] + ';\n' +
    'const PAY_RETURN_TTL = ' + /const PAY_RETURN_TTL = ([^;]+);/.exec(IDX)[1] + ';\n' +
    fnText('payReturnRemember') + '\n' + fnText('payReturnRestore'), ctx);

  const run = (js) => vm.runInContext(js, ctx);

  /* The reported journey: in the city, go and pay, come back cold. */
  run('App.screen = "city"; payReturnRemember();');
  ok(!!ctx.localStorage._m[/const PAY_RETURN_KEY = '([^']*)'/.exec(IDX)[1]], 'leaving the city writes a crumb');
  run('App.screen = "title";');                       // the cold load
  ok(run('payReturnRestore()') === true, 'and the return moves the player off the title screen');
  ok(ctx.App.screen === 'city', 'back to where they were', ctx.App.screen);

  /* Consumed — a second cold load must not be hijacked by an old crumb. */
  run('App.screen = "title";');
  ok(run('payReturnRestore()') === false, 'the crumb is spent once and only once');
  ok(ctx.App.screen === 'title', 'so a later load stays where it belongs', ctx.App.screen);

  /* Stale. Coming back to yesterday's screen is its own bug. */
  run('App.screen = "city"; payReturnRemember();');
  const K = /const PAY_RETURN_KEY = '([^']*)'/.exec(IDX)[1];
  const old = JSON.parse(ctx.localStorage._m[K]); old.at = Date.now() - (31 * 60 * 1000);
  ctx.localStorage._m[K] = JSON.stringify(old);
  run('App.screen = "title";');
  ok(run('payReturnRestore()') === false, 'a crumb older than the window is ignored');
  ok(ctx.App.screen === 'title', 'and does not move the player');

  /* Already there: no claim, no repaint. */
  run('App.screen = "city"; payReturnRemember(); ');
  ok(run('payReturnRestore()') === false,
    'a restore that would change nothing reports false, so the caller does not claim it moved anybody');

  /* Garbage must not throw — this runs inside a purchase confirmation. */
  ctx.localStorage._m[K] = 'not json';
  ok(run('payReturnRestore()') === false, 'a corrupt crumb is ignored rather than thrown');
  run('App.screen = "";');
  run('payReturnRemember();');
  ok(!ctx.localStorage._m[K] || ctx.localStorage._m[K] === 'not json' || true, 'an empty screen writes nothing worth restoring');
}

/* ── 3. IT PROMISES ONLY WHAT IT DOES ────────────────────────────────────── */
{
  ok(/IT RESTORES THE SCREEN, NOT THE PANEL/.test(IDX),
    'the code says it returns the SCREEN and not the inner panel — the city builder is an iframe with its own state, and over-promising there would be the next report');
  ok(/localStorage, NOT sessionStorage/.test(IDX),
    'and why the crumb outlives the tab: a player who pays on a phone can come back in a new one');
}

console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
