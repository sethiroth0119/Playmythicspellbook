/* 🏙 THE CITY CAN ACTUALLY GROW NOW (v121v74).

   Reported, with a screenshot of a city at 42/108 with 23 empty homes and a
   growth gate reading OPEN: "make it where our players city builder increase
   population for the city growth… also make a notification appear that tells
   the players their population is growing like Cities Skylines 2."

   THREE THINGS, and the first is the one that actually froze the city:

   1. A SILENT DEAD ZONE BETWEEN THE TWO GATES. immigrationBlock() refuses
      everything below an attraction score of 30 and NAMES the reason. `pull`
      then zeroed everything below 40. A city scoring 30–40 therefore passed
      every stated gate, was told nothing was wrong, and took zero arrivals for
      ever. The threshold now matches the refusal's own floor, so "not blocked"
      and "somebody arrives" finally mean the same thing — and the TOP of the
      curve is unchanged, so a healthy city grows exactly as fast as before.

   2. THE PANEL TOLD PLAYERS TO BUILD HOUSING THEY ALREADY HAD. The cap is the
      HOST's headcount, not this city's homes, so with dwellings free the
      honest sentence is that nobody is moving in.

   3. THE MILESTONE TOAST, baselined off the city as it loads so a returning
      player is never congratulated for the town they already had.

   Run: node _citygrow_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const POP  = readFileSync('./public/src/city/population.js', 'utf8');
const PIPE = readFileSync('./public/src/demographics/pipeline.js', 'utf8');
const NC   = readFileSync('./public/node-city/index.html', 'utf8');

/* ── 1. the dead zone is closed ── */
{
  ok(/const pull = Math\.max\(0, \(sc\.score - 30\) \/ 70\);/.test(POP), 'pull starts where the refusal stops — 30, not 40');
  const pull = (score) => Math.max(0, (score - 30) / 70);
  ok(pull(29) === 0, 'below the refusal floor nothing pulls');
  ok(pull(35) > 0, 'a city scoring 35 is no longer frozen — it was taking exactly zero', String(pull(35)));
  ok(pull(40) > 0, 'and neither is one scoring exactly 40', String(pull(40)));
  ok(Math.abs(pull(100) - 1) < 1e-9, 'the TOP of the curve is unchanged — a good city grows as before, not faster', String(pull(100)));
  {
    /* The floor in immigrationBlock and the floor in pull must be the same
       number, or the dead zone comes straight back. */
    const m = /if \(sc\.score < (\d+)\) return \{ id: 'attraction'/.exec(POP);
    const p = /const pull = Math\.max\(0, \(sc\.score - (\d+)\) \/ \d+\);/.exec(POP);
    ok(m && p && m[1] === p[1], 'the refusal floor and the pull floor are literally the same number',
      m && p ? (m[1] + ' vs ' + p[1]) : 'not found');
  }
  ok(/room = Math\.max\(0, Number\(ctx\.housingFree\) \|\| 0\)/.test(POP), 'arrivals are still capped by real beds — attraction never conjures housing');
}

/* ── 2. the message ── */
{
  const i = PIPE.indexOf('if (capped) {');
  ok(i > 0, 'the cap cause is now a branch, not one sentence');
  const seg = PIPE.slice(i, i + 1400);
  ok(/const roomToBuild = vacantTotal > 0\.5 && !full;/.test(seg), 'it asks whether homes are actually free');
  ok(/Nobody is moving in/.test(seg), 'and when they are, it says nobody is moving in');
  ok(/housing is not what is stopping this city/.test(seg), 'naming the real constraint');
  ok(/build Housing, or zone more land/.test(seg), 'while a genuinely full city still gets the build advice');
  {
    /* The two must not be reachable together. */
    const iNobody = seg.indexOf('Nobody is moving in');
    const iBuild = seg.indexOf('build Housing, or zone more land');
    ok(iNobody > 0 && iBuild > iNobody, 'they are the two arms of one ternary, so a player never sees both');
  }
}

/* ── 3. the milestone toast, run for real ── */
{
  const i = NC.indexOf('function popMilestoneCheck() {');
  const body = NC.slice(i, NC.indexOf('\n}', i) + 2);
  const world = (startPop) => {
    const toasts = [];
    const ctx = { console, game: { pop: { npc: startPop } }, popCap: () => 500, toast: (m, c) => toasts.push(String(m)), POP_MILESTONE_STEP: 25, _popMilestone: -1 };
    vm.createContext(ctx);
    vm.runInContext('let _popMilestone = -1;\n' + body, ctx);
    return { ctx, toasts, at: (n) => { ctx.game.pop.npc = n; vm.runInContext('popMilestoneCheck()', ctx); } };
  };
  {
    const w = world(42);
    w.at(42);
    ok(w.toasts.length === 0, 'loading a city of 42 congratulates nobody', JSON.stringify(w.toasts));
    w.at(49);
    ok(w.toasts.length === 0, 'and growing within a band stays quiet');
    w.at(50);
    ok(w.toasts.length === 1 && /Population 50/.test(w.toasts[0]), 'crossing 50 announces it', JSON.stringify(w.toasts));
    ok(/more can live here/.test(w.toasts[0]), 'and says how much room is left before more housing is needed', w.toasts[0]);
    w.at(60);
    ok(w.toasts.length === 1, 'the same milestone is never announced twice');
    w.at(75);
    ok(w.toasts.length === 2 && /Population 75/.test(w.toasts[1]), 'the next one lands at 75', JSON.stringify(w.toasts));
  }
  {
    const w = world(80);
    w.at(80); w.at(60); w.at(80);
    ok(w.toasts.length === 0, 'a city that loses people and wins them back is not congratulated again', JSON.stringify(w.toasts));
  }
  {
    const w = world(0);
    w.at(0); w.at(3);
    ok(w.toasts.length === 0, 'a brand-new city is not told it passed zero');
  }
  ok(/try \{ popMilestoneCheck\(\); \} catch \(e\) \{\}/.test(NC), 'it is called from the one line that moves the population, and guarded');
  ok(!/pushBroadcast/.test(NC), 'and it calls nothing that does not exist');
  ok(!/npcPop.*_popMilestone|_popMilestone.*save/i.test(NC), 'the mark is runtime-only — nothing was added to the save');
}
console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
