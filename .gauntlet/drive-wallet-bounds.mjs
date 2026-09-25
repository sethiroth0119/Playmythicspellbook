/* ══════════════════════════════════════════════════════════════════════════
   💰 DRIVE-WALLET-BOUNDS — the client Cinder faucet is bounded by what real
      play actually does, and the one call site that could stop naming an
      amount has stopped naming one.

   Asked for: close the hole where wallet_credit is executable by
   `authenticated` and takes the amount as an argument.

   🔴 THIS DOES NOT CLOSE IT, and the driver says so because the commit does.
      wallet_credit has to stay reachable: two call sites still pass a
      client-computed amount, because the CLIENT is what knows what a player
      earned. Revoking the grant and putting a Worker in front adds no barrier —
      the player's JWT reaches a Worker as easily as the RPC — so the policy
      lives in the function, where calling it directly cannot bypass it. What
      this pins is the harm reduction and the one path that WAS closable.

   📏 THE CEILINGS ARE MEASURED, and the driver re-asserts the measurements so a
      later "let's raise it a bit" has to argue with the data:
        biggest single credit ever ........  1,552,600
        busiest hour, one player ..........  9,859,847
        busiest day, one player ........... 10,867,754

   WHAT THIS PINS:
     · single-credit ceiling is 2,000,000 — above the largest real credit, far
       below the old 5,000,000
     · a DAILY ceiling exists at all. There was none: an hourly cap alone is a
       daily cap of 24× itself, so the old ceiling was really 240,000,000/day
     · the day window is ROLLING, not calendar — midnight is not a free refill
     · the reconcile path sends NO amount, and the server computes the gap from
       two columns the player cannot write
     · version.txt is written from BUILD_VERSION at deploy time, so the update
       signal cannot go stale again

   Run:  node .gauntlet/drive-wallet-bounds.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';

const out = {};
/* 🔴 THE EFFECTIVE CEILINGS LIVE IN 047, NOT 046. 046 sized them ABOVE
   measured play so nothing legitimate was refused; 047 is the owner setting
   the daily one BELOW that on purpose. Reading 046 here would test a policy
   that is no longer in the database — the classic drift where a check keeps
   passing against the wrong file. 046 is still read for the shape rules it
   introduced (the rolling window, the refusal logging, the amount-free
   reconcile), which 047 inherits unchanged. */
const sql = fs.readFileSync(path.resolve('sql/047_owner_tightened_caps.sql'), 'utf8');
const sql046 = fs.readFileSync(path.resolve('sql/046_wallet_credit_bounds_v2.sql'), 'utf8');
const idx = fs.readFileSync(path.resolve('public/index.html'), 'utf8');
const dep = fs.readFileSync(path.resolve('deploy.mjs'), 'utf8');
const sql048 = fs.readFileSync(path.resolve('sql/048_grant_not_capped.sql'), 'utf8');

/* the ceilings, read out of the migration rather than retyped */
const num = (name) => {
  const m = sql.match(new RegExp(name + '\\s+constant bigint := (\\d+)'));
  return m ? Number(m[1]) : null;
};
out.single = num('c_max_single');
out.hour = num('c_max_hour');
out.day = num('c_max_day');

/* the measured facts the ceilings are sized against — kept HERE so a future
   change has to move the numbers and the evidence together */
const MEASURED = { biggestSingle: 1552600, busiestHour: 9859847, busiestDay: 10867754 };
out.measured = MEASURED;

out.rules = {
  singleAboveRealMax: out.single > MEASURED.biggestSingle,
  singleWellBelowOld: out.single <= 2000000,
  hourStillFitsRealPlay: out.hour >= MEASURED.busiestHour,
  dayCeilingExists: out.day !== null,
  /* 🔴 THE DAY CAP IS DELIBERATELY BELOW MEASURED PLAY, AND THIS ASSERTION
     EXISTS TO STOP SOMEBODY 'FIXING' IT BACK. sql/046 set it at 15,000,000 —
     above the busiest real day — and the owner then set it to 500,000 knowing
     the cost: 41 of 255 recorded player-days (16.1%) exceeded that, across 10
     of 39 active players. So a heavy player being refused is this policy
     working, not a regression, and the number is pinned exactly rather than
     bounded — drifting either way should need a decision, not a tweak. */
  dayIsTheOwnerSetFigure: out.day === 500000,
  dayIsBelowRealPlayOnPurpose: out.day < MEASURED.busiestDay,
  /* …and the file has to keep SAYING that, so the next reader knows it was
     chosen rather than mis-sized. */
  policyIsWrittenDown: sql.toUpperCase().indexOf('BELOW MEASURED PLAY') >= 0
                    && sql.indexOf('16.1%') >= 0,
  /* 🔴 ROLLING, NOT CALENDAR. `where created_at > now() - interval '24 hours'`
     rather than `created_at::date = current_date`, or a thief waits for
     midnight and takes the day's allowance twice in two minutes. */
  dayWindowIsRolling: sql.indexOf("interval '24 hours'") >= 0
                   && sql.indexOf('current_date') < 0,
  /* the refusal is recorded, not silent — an unlogged ceiling is a ceiling
     nobody finds out was hit */
  refusalsLogged: sql.indexOf("'REFUSED daily>'") >= 0,
  /* the reconcile takes no argument at all */
  reconcileTakesNoAmount: sql046.indexOf('wallet_reconcile_self()') >= 0
                       && sql046.indexOf('v_diff := coalesce(v_gems,0) - coalesce(v_cin,0);') >= 0,
  reconcileOnlyCloses: sql046.indexOf('if v_diff <= 0 then') >= 0,
  /* …and it goes through the audited path rather than minting privately */
  reconcileIsNotPrivileged: sql046.indexOf("public.wallet_credit(v_diff, 'reconcile_canonical_wallet', null)") >= 0,
  /* 🔴 THE ONE-OFF GRANT IS NOT SUBJECT TO THE DAILY CAP, and that exemption
     has to survive. Paying it THROUGH wallet_credit meant a player who had
     already earned 450,000 that day silently did not receive it — no error,
     no log, and the players most affected by the ground re-roll are exactly
     the busy ones most likely to be near the cap. The cap bounds credits whose
     amount comes from the CLIENT and which repeat; this one is a constant in
     the function body, payable once per account for ever. */
  grantNotThroughWalletCredit: sql048.indexOf('public.wallet_credit') < 0
                            && sql048.indexOf('update public.user_progress') >= 0,
  /* …but it still writes the ledger row, which is the receipt AND the lock */
  grantStillLedgered: sql048.indexOf("insert into public.wallet_ledger") >= 0
                   && sql048.indexOf('v_ref') >= 0,
  /* …and a race is reported as already-paid rather than paying twice */
  grantSurvivesARace: sql048.indexOf('when unique_violation then') >= 0,
};

out.client = {
  reconcileSendsNoAmount: idx.indexOf("rpc('wallet_reconcile_self')") >= 0,
  oldReconcileGone: idx.indexOf("p_reason: 'reconcile_canonical_wallet'") < 0,
  /* the two that REMAIN are named, so this driver fails the day a third appears
     without anybody thinking about it */
  remainingCreditCallSites: (idx.match(/rpc\('wallet_credit'/g) || []).length,
};

out.deploy = {
  writesVersionTxt: dep.indexOf('syncVersionTxt()') >= 0,
  readsItFromBuildVersion: dep.indexOf('window\\.BUILD_VERSION') >= 0 || dep.indexOf('BUILD_VERSION') >= 0,
  runsBeforeMinify: dep.indexOf('syncVersionTxt();') < dep.indexOf('await minify();'),
};

/* version.txt must AGREE with BUILD_VERSION in the tree that is about to ship */
{
  const m = idx.match(/window\.BUILD_VERSION\s*=\s*'([^']+)'/);
  out.buildVersion = m ? m[1] : null;
  out.versionTxt = fs.readFileSync(path.resolve('public/version.txt'), 'utf8').trim();
}

console.log(JSON.stringify(out, null, 2));

const F = [];
for (const [k, v] of Object.entries(out.rules))  if (!v) F.push('ceiling rule failed: ' + k);
for (const [k, v] of Object.entries(out.client)) if (k !== 'remainingCreditCallSites' && !v) F.push('client rule failed: ' + k);
for (const [k, v] of Object.entries(out.deploy)) if (!v) F.push('deploy rule failed: ' + k);
if (out.client.remainingCreditCallSites !== 2) {
  F.push('there are now ' + out.client.remainingCreditCallSites + ' client wallet_credit call sites, not the 2 that are known '
       + '— a new one needs a server-side faucet, not another client-named amount');
}
if (out.versionTxt !== out.buildVersion) {
  F.push('version.txt (' + out.versionTxt + ') does not match BUILD_VERSION (' + out.buildVersion + ') — the update signal is stale again');
}

console.log(F.length ? ('FAIL\n  - ' + F.join('\n  - ')) : 'PASS · the faucet is bounded by measured play, the reconcile names no amount, and the update signal cannot go stale');
process.exit(F.length ? 1 : 0);
