/* ══════════════════════════════════════════════════════════════════════════
   🔁 DRIVE-MP-TWOCLIENT — two real clients, one relayed transport, and an
   oracle that has been shown to go red.

   WHY THIS EXISTS. Every multiplayer test in this repo so far has driven ONE
   client against a recording stub (drive-matchmaking.mjs says so in its own
   header: "Cloud.client is a recording stub. No socket is opened… Nothing here
   shows that two real accounts can actually meet"). tools/mp-tests/*.mjs go
   further and test swapBattlePerspective as a pure function, extracted out of
   index.html and fed a synthetic state. Both are worth having. Neither has
   ever watched two of these clients play each other, so no MP claim in this
   repo has ever been judged against a second client — only against a fixture
   somebody wrote by hand.

   This is that instrument. ONE Playwright run, TWO browser contexts, the real
   public/index.html in both, and the Supabase Realtime channel replaced by a
   relay that lives in this Node process. Client A's broadcast is delivered to
   client B's real .on('broadcast') handler and vice versa, so what is being
   exercised is _onRemoteStateArrived / swapBattlePerspective / the turn-start
   handoff — the actual code, in a browser, against a peer that is also the
   actual code.

   ── WHAT IT FOUND THE FIRST TIME IT WAS RUN ───────────────────────────────
   Recorded here because a tool's first results are the evidence that it works,
   and because the next person will otherwise assume a red run is the harness.
   Neither of these is fixed — this piece adds no game code — and neither is
   a harness artifact: both reproduce on the shipped file, in a browser, with a
   lossless in-order relay.
     F1  TURN 1 HAS NO PACKET ORDERING AT ALL. The out-of-order guard in
         _onRemoteStateArrived is `if (payload.turn && payload.turn <
         MatchBroadcast.lastSeenTurn) return;` — strictly less-than, on a
         counter that only moves when somebody ends a turn. For the whole of
         turn 1 EVERY packet carries turn 1, so that guard can never reject
         anything, and both clients answer each other's opening resync with a
         full board. Whichever opening snapshot lands last wins that client's
         board, and the pair can finish the handshake standing on each OTHER's
         boards — the harness prints it in those words ("A on B's original, B on
         A's original").
         MEASURED, on the clean default script, 20 runs, this tree: 2/20 = 10%
         ended the handshake diverged, both of them that swap. `--trace` shows
         which snapshot landed last.
         ⚠ WHAT THE SAME 20 RUNS DID NOT SHOW: turn ownership never broke
           (0/20 turn-number mismatches, 0/20 blocked end-turns). A rolled-back
           opener with BOTH clients holding the turn HAS been reproduced here,
           but only in runs where the relay was injecting faults, and in earlier
           runs that turned out to be the harness's own fidelity bugs. Do not
           quote it as a property of the shipped clean path on this evidence.
         The 4000 ms turn-holder heartbeat is what usually heals the swap, and
         it is not dependable: measured over six runs of a fault-injected
         variant it took 9–20 s and twice had not held.
         ⚠ NOT the cause, though it looks like one: state.currentTurn being
           unset. startBattleWithPrep DOES set it for a multiplayer match. An
           early version of this harness did not, and that omission alone
           manufactured a convincing fake version of this bug — see the note in
           __2c.setup.
     F2  THE SERVER'S current_player_id IS NEVER READ BACK. joinMatchChannel's
         postgres_changes handler acts on `row.winner_id` only, directly under
         a comment promising "Same story for current_player_id transitions
         (mp_end_turn updates the row; both clients hear about it through this
         listener)". They do not. So when F1 strands a match there is no
         server-authoritative correction: the ONLY path back is mp_end_turn
         answering 'not_your_turn', which requires a client to try to end a turn
         it does not believe it holds — which is exactly what the stranded
         client will not do.
     F3  A SURFACE'S COUNTDOWN DRIFTS BY ONE TURN between the two clients
         (`board[y][x].surface.turnsLeft: 7 ≠ 8`), in runs where the random
         opening board spawned a surface at all — which is why it looks
         intermittent and is not. MEASURED: 2/20 = 10% of clean runs, on the
         same 20. Almost certainly the same root as the
         asymmetric unit flags in EXCLUDED below: the live Supabase path runs
         the opponent's turn-start TWICE, once on the sender (onEndTurn →
         endPlayerTurn → startTurn(s,'ai')) and once on the receiver
         (_onRemoteStateArrived's turn-start-on-flip), and both tick countdowns.
         Not chased further here. It is PINNED, not excluded — see KNOWN_BAD.
         ⚠ F3 HAS A SECOND SHAPE, AND MISSING IT COST THIS FILE A GATE. A
           countdown ends: on the tick where the client that is one AHEAD hits
           zero it runs _clearSurface — a literal `delete board[y][x].surface` —
           so the tile's surface EXISTS on one client and is undefined on the
           other, and the oracle records a TYPE mismatch
           (`board[8][1].surface: "object" ≠ "undefined"`), not a number one.
           The first version of the pin matched only the countdown, so the
           terminal step of the very bug it names walked past it and `--gate`
           went red on an untouched tree. MEASURED BY A CRITIC: 16 gate runs,
           15 green, 1 red on exactly that shape, with the pin itself firing in
           0 of the 16. Both shapes are pinned now, both bounded, and K4
           reproduces the second one deliberately on every run so the allowance
           can never go quietly dead again.
     F4  THE SAME DOUBLE TURN-START ALSO DIFFERS A UNIT'S HP, WHICH IS NOT A
         COUNTER. Found by the 24-run gate sweep that was run to check the F3
         widening — i.e. found by measuring a fix, which is the argument for
         measuring fixes. One run in 24 went red on
         `units[0].currentHp: 244 ≠ 238` at half-turn 1 and `226 ≠ 232` at
         half-turn 2 (same unit, sign flipping between checkpoints, in a run that
         also showed the F3 drift). The difference is 6 and SURFACE_FIRE_DMG is
         6: a unit that ends its turn in fire appears to be burned a different
         number of times on the two clients.
         ⚠ NOT VERIFIED BEYOND THE NUMBER. Nobody has stepped a run through to
           watch the second burn land. The divergence is measured; the mechanism
           is a hypothesis, and it is written down as one.
         This one is NOT pinned and must never be — see the F4 note in the gate
         block for what the gate does instead, and what that costs.

   ── THE THREE CALIBRATION CHECKS ──────────────────────────────────────────
   They print on EVERY run. A run missing one of them is not a result.
     K1  CLEAN RELAY — six scripted half-turns, nothing dropped or reordered.
         The oracle must report ZERO divergence at every checkpoint, and the
         stub server's matches.turn_number must equal BOTH clients'
         App.state.turnNumber at every step.
         ⚠ K1 IS RED SOME OF THE TIME ON A CORRECT TREE, because of F1 and F3.
           MEASURED AT 4/20 = 20% on this tree (10% F1 + 10% F3). That is a
           measurement, not a defect in the harness: run --flake=20 for the rate
           rather than reading one run as a verdict. It is also why this file is
           NOT the thing tools/mp-tests/run.mjs gates on — a gate that is red on
           one run in five teaches people to ignore gates. `--gate` runs the
           deterministic slice that is gated, and says what it gave up to be
           deterministic.
     K2  NEGATIVE CONTROL — the oracle is evaluated BEFORE a single packet is
         relayed. It MUST report NOT-CONVERGED. Each client built its own board
         with its own initGame() (own hero, own deck, own random board events),
         so two clients that have not yet spoken genuinely do not agree. If the
         oracle says CONVERGED there, it is comparing nothing and every green
         result built on it is void.
     K3  MUTATION CONTROL — one unit's currentHp is changed by 1 on ONE client
         only. The oracle must go red, name that unit, and then go green again
         when the 1 HP is put back. A harness that is green on a clean run and
         green on a mutated one is comparing nothing; that is the exact failure
         tools/mp-tests/run.mjs was built to prevent.
     K4  THE PIN'S OWN CONTROL (gate mode) — the F3 allowance is the one place
         this suite says "this difference is fine", so it gets the same
         treatment K3 gives the oracle. A surface is seeded on ONE client
         through the shipped _setSurface: at `turnsLeft: 1` the oracle must SEE
         it and the pin must ABSORB it (that is the shape that used to make the
         gate red), and at `turnsLeft: 6` — same path, same type mismatch — the
         pin must REFUSE it and the run must fail. Without the second half the
         allowance would be indistinguishable from "ignore board surfaces",
         which is an exclusion wearing a pin's clothes. A cheap pure-Node PIN
         SELF-TEST prints in every mode besides, covering 3 pinned shapes and 5
         near-misses.
   Plus: NO UNIT MAY MOVE on either client except as the result of a relayed
   packet — asserted over a quiescent window in which scheduleAIStep() is
   actively kicked on both clients (it returns early in multiplayer, so the AI
   cannot be the mover), and CONTROLLED at the end of the run by clearing
   App.battlePrep.multiplayer on one client and showing the SAME detector then
   reports movement. A "nothing moved" check that cannot see movement is not a
   check.
   Plus: a KNOB SELF-TEST. drop / delay / duplicate / reorder are the levers
   M1–M3 will pull, and a knob that silently does nothing would turn every
   fault-injection result green. Each is shown to change what is delivered.

   ── WHAT A GREEN RUN DOES NOT PROVE ───────────────────────────────────────
   Read this before quoting any number out of this file.
     · THE RELAY IS NOT THE NETWORK. It is lossless, in-order, ~0 ms and
       single-process. Real Supabase Realtime is none of those. The knobs exist
       precisely because the default relay is kinder than reality.
     · THE SERVER IS A TRANSCRIPTION. The `matches` row and mp_end_turn's
       verdicts below are transcribed BY HAND from mp_edge_functions.sql
       (lines 112–223, the SQL function) and supabase/functions/mp_end_turn/
       index.ts (the Edge Function that wraps it and renames the columns to
       camelCase). Nobody in this working copy can run a migration or reach the
       live database, and there is no evidence in the tree that this SQL was
       ever applied to it. So a green run proves THE CLIENT HANDLES A VERDICT.
       It never proves the server produces one.
     · NO AUTH, NO RLS, NO auth.uid(). The SQL's `v_uid := auth.uid()` is
       modelled as "the caller is whoever invoked", which is exactly the check
       an attacker would attack. This harness cannot test authorisation.
     · ONE PROCESS, ONE MACHINE, ONE CLOCK. Clock skew between two real players
       is not modelled here (drive-mm-clockskew.mjs is the file for that), and
       both pages share this machine's CPU, so timing is not a player's timing.
     · THE STUB IS NOT supabase-js. It implements only what index.html actually
       calls on Cloud.client. Two fidelity bugs in it were found and fixed while
       this file was being written — SUBSCRIBED firing synchronously (which
       skipped the presence track AND the opening resync, because
       joinMatchChannel's callback guards on a MatchBroadcast.channel that has
       not been assigned yet) and a match started without the currentTurn that
       startBattleWithPrep sets. BOTH produced confident, reproducible, entirely
       fake desyncs. If a result here surprises you, suspect this file before
       you suspect the game, and go and read the shipped call site.
     · 'unitviz' IS DROPPED BY DEFAULT (knobs.dropViz). It is the chunked
       sprite/art relay; it carries no board state and dominates the runtime.
       Nothing here tests it.

   ── THE ORACLE'S ONE JUDGEMENT CALL ───────────────────────────────────────
   Two converged clients are NOT byte-identical, and pretending otherwise would
   force the oracle to be either permanently red or hand-tuned until green. The
   exclusion list in EXCLUDED below is the whole judgement call. Every entry on
   it was MEASURED on a clean run (not guessed, not added to make a red run
   green), each carries the reason it differs, and the list is CLOSED: anything
   that differs and is not on it is a DIVERGENCE and fails the run. Excluded
   fields that differ are still counted and PRINTED each run as ASYMMETRY, so
   they cannot be quietly swept up — see the note above the list for what they
   turned out to be, which is not nothing.

   Run:  node .gauntlet/drive-mp-twoclient.mjs              full run, ~45 s
         node .gauntlet/drive-mp-twoclient.mjs --gate       deterministic slice,
                                                            ~20 s — this is what
                                                            tools/mp-tests/run.mjs
                                                            gates on
         node .gauntlet/drive-mp-twoclient.mjs --flake=20   clean script ×20,
                                                            reports a RATE
         node .gauntlet/drive-mp-twoclient.mjs --gate --repeat=20
                                                            the GATE ×20, as N
                                                            fresh processes —
                                                            reports a RATE. Any
                                                            claim that the gate
                                                            is deterministic
                                                            must cite this, not
                                                            a lucky ten.
         node .gauntlet/drive-mp-twoclient.mjs --trace      every packet, and
                                                            what it did to the
                                                            receiver
         node .gauntlet/drive-mp-twoclient.mjs --stagger    join the clients one
                                                            after the other
         node .gauntlet/drive-mp-twoclient.mjs --headed
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/* Paths are derived, never hardcoded. The older .gauntlet drivers bake in
   /opt/node22 and /opt/pw-browsers and cannot run on a Windows checkout at
   all; this one runs wherever `node` and playwright already work. */
const ROOT = path.resolve(process.cwd(), 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.webp': 'image/webp', '.glb': 'model/gltf-binary' };
const PORT = 8890 + (process.pid % 50);
const HEADED = process.argv.includes('--headed');
const TRACE  = process.argv.includes('--trace');
/* --stagger[=ms] joins the two clients one after the other instead of inside a
   single delivery window. See startMatch. Default off: the tight join is the
   worst case and it is the one that reproduces. */
const STAGGER = (() => {
  const x = process.argv.find(s2 => s2.startsWith('--stagger'));
  if (!x) return 0;
  const n = parseInt(x.split('=')[1], 10);
  return Number.isFinite(n) && n > 0 ? n : 1500;
})();
/* --gate runs the deterministic slice that tools/mp-tests/run.mjs gates on.
   See the GATE block for why the full script is not gate-material. */
const GATE = process.argv.includes('--gate');
/* --delta runs the DELTA-FIDELITY scenario: a turn that changes the board and a
   side-keyed top-level field while summoning and killing nothing. That is the
   exact shape _computeStateDelta does NOT bail to a full snapshot for, and the
   shape whose changes the delta pair used to drop on the floor. It also reports
   BYTES/TURN, because "carry every field" has a useless correct answer (always
   send a full snapshot) and bytes are what tell the two apart. */
const DELTA = process.argv.includes('--delta');
const FLAKE = (() => {
  const a = process.argv.find(s => s.startsWith('--flake'));
  if (!a) return 0;
  const n = parseInt(a.split('=')[1], 10);
  return Number.isFinite(n) && n > 0 ? n : 20;
})();
/* MP_SRC points the run at a DIFFERENT copy of index.html — the same lever
   tools/mp-tests/*.mjs already take, so tools/mp-tests/run.mjs can re-run this
   file against a tree with one shipped fix reverted and require it to go red. */
const SRC = process.env.MP_SRC || path.join(ROOT, 'index.html');

/* ── --repeat=N: MEASURE THE GATE, DO NOT ARGUE ABOUT IT ──────────────────────
   The gate entry in tools/mp-tests/run.mjs runs THIS FILE AS A FRESH PROCESS,
   so the only honest measurement of the gate's flake rate is N fresh processes.
   That is what this does — it re-spawns itself, it does not loop the body in
   one process, because a loop in one process would share a warm browser, a warm
   page cache and (worst) the accumulated `fails` counter, none of which the
   real gate shares.
   ⚠ THIS EXISTS BECAUSE THE GATE WAS ONCE CLAIMED DETERMINISTIC ON A SAMPLE OF
     TEN AND WAS NOT: a critic ran it 16 times and got 1 red. Nobody should have
     to hand-roll a shell loop to check that claim again, and nobody should quote
     a rate from fewer runs than they can print here.
       node .gauntlet/drive-mp-twoclient.mjs --gate --repeat=20              */
const REPEAT = (() => {
  const a = process.argv.find(s => s.startsWith('--repeat'));
  if (!a) return 0;
  const n = parseInt(a.split('=')[1], 10);
  return Number.isFinite(n) && n > 1 ? n : 0;
})();
if (REPEAT) {
  const args = process.argv.slice(2).filter(s => !s.startsWith('--repeat'));
  console.log('\n\u{1F501} REPEAT MODE — ' + REPEAT + ' fresh processes of `'
    + args.join(' ') + '`, exactly as tools/mp-tests/run.mjs spawns it\n');
  let red = 0;
  const reds = [];
  for (let i = 1; i <= REPEAT; i++) {
    const t = Date.now();
    const r = spawnSync(process.execPath, [process.argv[1], ...args],
      { encoding: 'utf8', env: process.env, maxBuffer: 64 * 1024 * 1024 });
    const out = (r.stdout || '') + (r.stderr || '');
    const bad = r.status !== 0;
    if (bad) {
      red++;
      /* Keep WHY it was red, not just that it was. A rate with no failure modes
         attached is the thing that let the last one hide. */
      const lines = out.split('\n').filter(l => /^\s*FAIL |UNEXPECTED /.test(l)).slice(0, 4);
      reds.push('    run ' + i + ' (exit ' + r.status + '):\n' + (lines.join('\n') || '      <no FAIL line — it threw>'));
    }
    console.log('    run ' + String(i).padStart(2) + '/' + REPEAT + '  '
      + (bad ? 'RED' : 'green') + '  ' + ((Date.now() - t) / 1000).toFixed(1) + 's'
      /* Did the F3 drift happen NATURALLY in this run's script? (K4 fires the
         pin on purpose every run; this marker is about the bug, not the pin.) */
      + (/KNOWN-BAD ALLOWED/.test(out) ? '   [F3 drift occurred in the script]' : ''));
  }
  console.log('\n  \u{1F4CA} RATE: ' + red + '/' + REPEAT + ' runs red = '
    + (red / REPEAT * 100).toFixed(1) + '%   (a rate, not a boolean)');
  if (reds.length) console.log(reds.join('\n'));
  process.exit(red ? 1 : 0);
}

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = (p === '/index.html') ? SRC : path.join(ROOT, p);
  if ((f !== SRC && !f.startsWith(ROOT)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (detail == null ? '' : '   ' + detail));
};
const say = (s) => console.log(s);

/* ════════════════════════════════════════════════════════════════════════
   1 · THE SERVER MODEL — transcribed, not invented.
   ════════════════════════════════════════════════════════════════════════
   mp_edge_functions.sql:112-223 (public.mp_end_turn) + mp_init_match at :227,
   wrapped the way supabase/functions/mp_end_turn/index.ts wraps them: the
   Edge Function clamps expectedTurn with Math.max(1, Math.floor(…)) and
   renames current_player_id/turn_number/winner_id to camelCase, which is the
   spelling the client actually reads (index.html: `data.winnerId`,
   `data.reason`). Every branch below quotes the SQL's own reason string.
   ⚠ auth.uid() has no analogue here: the caller is simply whoever called.
     Nothing in this file tests authorisation. */
function makeMatchRow(p1, p2) {
  return { id: 'match-2c-0001', player1_id: p1, player2_id: p2,
    current_player_id: null, turn_number: 1, winner_id: null,
    status: 'active', state_snapshot: null, end_reason: null, turns: 0 };
}
function srv_mp_init_match(row, uid, args) {
  // SQL: refuses a non-participant / non-participant opener, then sets
  // current_player_id ONLY `where current_player_id is null` (idempotent).
  const opener = args && args.p_opener_id;
  if (!uid || !opener) return { data: false, error: null };
  if (uid !== row.player1_id && uid !== row.player2_id) return { data: false, error: null };
  if (opener !== row.player1_id && opener !== row.player2_id) return { data: false, error: null };
  if (row.current_player_id == null) {
    row.current_player_id = opener;
    row.turn_number = Math.max(row.turn_number || 1, 1);
  }
  return { data: true, error: null };
}
function srv_mp_end_turn(row, uid, body) {
  const R = (ok, reason) => ({ data: { ok, currentPlayerId: row.current_player_id,
    turnNumber: row.turn_number, winnerId: row.winner_id, reason }, error: null });
  const expected = Math.max(1, Math.floor(Number((body && body.expectedTurn) || 0)));  // Edge Function clamp
  if (!row.id) return R(false, 'match_not_found');
  if (uid !== row.player1_id && uid !== row.player2_id) return R(false, 'not_participant');
  if (row.winner_id != null || row.status === 'complete') return R(false, 'match_already_ended');
  // "First-ever turn pass: current_player_id may still be NULL … adopt the caller."
  if (row.current_player_id == null) row.current_player_id = uid;
  if (row.current_player_id !== uid) return R(false, 'not_your_turn');
  // expected <  server → stale client, reject.  expected > server → server
  // fell behind, adopt the client's number.  (Both branches are in the SQL.)
  if (expected < (row.turn_number || 1)) return R(false, 'turn_stale');
  if (expected > (row.turn_number || 1)) row.turn_number = expected;
  const opp = (uid === row.player1_id) ? row.player2_id : row.player1_id;
  const winner = (body && body.gameoverWinner) || null;
  if (winner) {
    if (winner !== row.player1_id && winner !== row.player2_id) return R(false, 'bad_winner');
    row.winner_id = winner; row.status = 'complete';
    row.turn_number += 1; row.current_player_id = opp;
    row.end_reason = 'normal'; row.turns = row.turn_number;
    return R(true, '');
  }
  row.current_player_id = opp;
  row.turn_number += 1;
  return R(true, '');
}

/* ════════════════════════════════════════════════════════════════════════
   2 · THE RELAY — the transport, with the knobs M1–M3 will pull.
   ════════════════════════════════════════════════════════════════════════
   Delivery is PUMPED, not raced: a client's .send() only queues here, and
   nothing reaches the peer until deliverReady() runs. That is what makes K2
   possible ("before any packet is relayed" is a state this harness can
   actually be in) and what makes drop/reorder deterministic instead of
   timing-dependent.

   Knobs are keyed by BROADCAST EVENT NAME — the same names index.html uses:
   'state', 'state-delta', 'resync', 'unitviz', 'vizreq', 'attackfx', 'coin',
   'gameover', 'emote', plus the synthetic 'matches.UPDATE' for the
   postgres_changes row echo.
     drop[e]      = n   → swallow the next n packets of e
     duplicate[e] = n   → deliver the next n packets of e TWICE
     delay[e]     = ms  → hold e for ms before it is eligible
     reorder[e]   = n   → the next n packets of e are held behind the packet
                          that follows them (a swap with the successor)
   A key may name ONE sender — 'B:state' beats 'state' — so "drop everything
   this player says" is expressible. Gate mode uses exactly that.
   'unitviz' is dropped by default and counted: it is the chunked sprite/art
   relay (150 KB per message, dozens of messages), it carries no board state,
   and shipping it through page.evaluate() dominates the runtime of the whole
   file. That default is a stated choice, not an accident — set knobs.dropViz
   = false to relay them. */
function makeRelay() {
  return {
    pending: [],
    seq: 0,
    delivered: [],          // {from,event,at}
    knobs: { drop: {}, duplicate: {}, delay: {}, reorder: {}, dropViz: true },
    vizDropped: 0,
    lost: 0,                // sent into a channel the peer had not joined yet
    counts: { queued: {}, dropped: {}, duplicated: {}, delivered: {} },
    /* 📏 BYTES ON THE WIRE, per event name. Counted at ENQUEUE — this is what
       the client handed the transport, which is the number a bandwidth claim is
       about; the relay's own fault injection dropping something afterwards is
       the harness's doing, not the client's. Added for the delta-fidelity work:
       "make the delta carry every field" has a trivially correct and completely
       useless answer (send a full snapshot every time), and the only thing that
       tells the two apart is bytes/turn. */
    bytes: {},
    _bump(bag, e) { bag[e] = (bag[e] || 0) + 1; },
  };
}
const OTHER = (s) => (s === 'A' ? 'B' : 'A');

/* Knob lookup. A key may be scoped to ONE sender — 'B:state' beats 'state' —
   because "drop the packets from one player" is the fault M1–M3 will want most
   and a global event knob cannot express it. */
function knobKey(bag, from, event) {
  return (bag[from + ':' + event] !== undefined) ? from + ':' + event : event;
}
function relayEnqueue(relay, from, event, payload) {
  if (relay.knobs.dropViz && event === 'unitviz') { relay.vizDropped++; return; }
  relay._bump(relay.counts.queued, event);
  // Serialized size of what the client actually put on the channel.
  try { relay.bytes[event] = (relay.bytes[event] || 0) + JSON.stringify(payload).length; } catch (e) {}
  const kDrop = knobKey(relay.knobs.drop, from, event);
  if ((relay.knobs.drop[kDrop] | 0) > 0) {
    relay.knobs.drop[kDrop]--;
    relay._bump(relay.counts.dropped, event);
    return;                                   // gone, exactly like a lost frame
  }
  const kDup = knobKey(relay.knobs.duplicate, from, event);
  const copies = ((relay.knobs.duplicate[kDup] | 0) > 0) ? 2 : 1;
  if (copies === 2) { relay.knobs.duplicate[kDup]--; relay._bump(relay.counts.duplicated, event); }
  const kRe = knobKey(relay.knobs.reorder, from, event);
  let swap = false;
  if ((relay.knobs.reorder[kRe] | 0) > 0) { relay.knobs.reorder[kRe]--; swap = true; }
  for (let i = 0; i < copies; i++) {
    relay.pending.push({ id: ++relay.seq, from, event, payload,
      dueAt: Date.now() + (relay.knobs.delay[knobKey(relay.knobs.delay, from, event)] | 0), swap: swap && i === 0 });
  }
}

/* Deliver everything that is due. A packet marked `swap` waits until there is
   a successor and then goes AFTER it — one packet arriving out of order, which
   is the shape the client's own dedup (`payload.turn < lastSeenTurn`) claims to
   handle. */
async function relayPump(relay, clients) {
  let n = 0;
  for (;;) {
    const now = Date.now();
    let ix = relay.pending.findIndex(p => p.dueAt <= now);
    if (ix < 0) break;
    if (relay.pending[ix].swap) {
      const nx = relay.pending.findIndex((p, i) => i > ix && p.dueAt <= now);
      if (nx < 0) break;                      // nothing to swap with yet — hold
      relay.pending[ix].swap = false;
      ix = nx;
    }
    const p = relay.pending.splice(ix, 1)[0];
    const target = clients[OTHER(p.from)];
    let landed;
    if (p.event === 'matches.UPDATE') {
      landed = await target.page.evaluate((row) => window.__mpDeliver('postgres_changes', 'UPDATE', { new: row }), p.payload);
    } else {
      landed = await target.page.evaluate(([e, pl]) => window.__mpDeliver('broadcast', e, { payload: pl }), [p.event, p.payload]);
    }
    if (!landed) { relay.lost++; continue; }        // peer had not subscribed — no replay, it is gone
    /* --trace prints WHO sent WHAT and what it did to the receiver. The join
       handshake is a race between two full snapshots and this is the only way
       to see which one landed last; M1–M3 will want it for every packet. */
    if (TRACE) {
      const m = await target.page.evaluate(() => window.__2c.marks());
      const carried = (p.event === 'state' && p.payload && p.payload.state)
        ? ' carrying tn=' + p.payload.state.turnNumber + ' units=' + (p.payload.state.units || []).map(u => u.id.slice(-4)).join('/')
        : '';
      say('       #' + p.id + ' ' + p.from + '→' + OTHER(p.from) + ' ' + p.event + carried
        + '  ⇒ ' + OTHER(p.from) + ' tn=' + m.turnNumber + ' myTurn=' + m.myTurn + ' units=' + m.units);
    }
    relay._bump(relay.counts.delivered, p.event);
    /* The PAYLOAD is kept, not just the event name. --delta asserts on what a
       handoff packet actually CONTAINED — "B ended up with the surface" is
       satisfiable by a heartbeat full snapshot arriving later, so it cannot on
       its own show that the DELTA carried it. */
    relay.delivered.push({ id: p.id, from: p.from, event: p.event, at: Date.now(), payload: p.payload });
    n++;
  }
  return n;
}
/* Let the page's own timers run (broadcastMyState debounces 30 ms; the join
   handshake re-requests resync at 1500 ms and 4000 ms) and keep pumping. */
async function settle(relay, clients, ms) {
  const end = Date.now() + ms;
  let n = 0;
  while (Date.now() < end) {
    await new Promise(r => setTimeout(r, 100));
    n += await relayPump(relay, clients);
  }
  return n;
}
/* settle for at least `minMs`, then until no packet has moved for `quietMs`,
   never longer than `maxMs`. The debounced 30 ms sends are what a quiet window
   must outlast, so 400 ms is ~13 debounce periods. */
async function settleQuiet(relay, clients, minMs, quietMs, maxMs) {
  const start = Date.now();
  let lastMove = start, n = 0;
  while (Date.now() - start < maxMs) {
    await new Promise(r => setTimeout(r, 100));
    const k = await relayPump(relay, clients);
    n += k;
    if (k) lastMove = Date.now();
    if (Date.now() - start >= minMs && Date.now() - lastMove >= quietMs) break;
  }
  return n;
}

/* ════════════════════════════════════════════════════════════════════════
   3 · THE PAGE STUB — Cloud.client, replaced in-page.
   ════════════════════════════════════════════════════════════════════════ */
const PAGE_STUB = () => {
  window.__2c = { chans: {}, errs: [], probeN: 0 };

  /* A channel object shaped like a supabase-js v2 RealtimeChannel as far as
     index.html actually uses it: chained .on(type, {event}, cb), .send(),
     .subscribe(cb => cb('SUBSCRIBED')), .track/.untrack, .presenceState,
     .unsubscribe. Handlers are kept so the relay can invoke the REAL ones. */
  window.__2c.mkChannel = (name) => {
    const hs = [];
    const ch = {
      on(type, filt, cb) { hs.push({ type, event: filt && filt.event, cb }); return ch; },
      send(msg) {
        try { window.__mpSend(JSON.stringify({ event: msg.event, payload: msg.payload })); }
        catch (e) { window.__2c.errs.push('send: ' + e); }
        return Promise.resolve('ok');
      },
      /* 🔴 SUBSCRIBED MUST BE ASYNCHRONOUS. joinMatchChannel is written as
         `MatchBroadcast.channel = Cloud.client.channel(…).on(…).subscribe(cb)`,
         so during a SYNCHRONOUS callback MatchBroadcast.channel is still the
         previous value (null). Its callback guards on exactly that — `track()`
         throws into its own catch and `_reqResync()` returns at
         `if (!MatchBroadcast.channel) return;` — so a synchronous stub silently
         skips the presence track AND the opening resync request, and the
         handshake under test is not the shipped handshake. Real supabase-js
         resolves SUBSCRIBED after a socket round trip; one macrotask is the
         smallest faithful version of that. */
      subscribe(cb) {
        if (cb) setTimeout(() => { try { cb('SUBSCRIBED'); } catch (e) { window.__2c.errs.push('sub: ' + e); } }, 0);
        return ch;
      },
      track: () => Promise.resolve('ok'),
      untrack: () => Promise.resolve('ok'),
      unsubscribe: () => Promise.resolve('ok'),
      presenceState: () => ({}),
      _deliver(type, event, arg) {
        let n = 0;
        for (const h of hs) if (h.type === type && h.event === event) {
          n++;
          try { h.cb(arg); } catch (e) { window.__2c.errs.push('handler ' + event + ': ' + e); }
        }
        return n;
      },
    };
    window.__2c.chans[name] = ch;
    return ch;
  };
  /* Returns how many REAL handlers it reached. Zero means the packet arrived at
     a client that has not joined the channel yet — which is not a harness
     failure but the truth about Supabase broadcast: there is no replay, so a
     message sent into a channel before the peer subscribes is simply gone. The
     relay counts those separately instead of pretending they were delivered. */
  window.__mpDeliver = (type, event, arg) => {
    let n = 0;
    for (const k of Object.keys(window.__2c.chans)) n += window.__2c.chans[k]._deliver(type, event, arg);
    return n;
  };

  window.__2c.setup = (o) => {
    /* Cloud.ready short-circuits initCloud() at index.html:48501 before it can
       build a real supabase client (the CDN is blocked in this run) and stomp
       the stub — the same move drive-matchmaking.mjs:290-295 makes. */
    Cloud.ready = true;
    Cloud.client = {
      channel: (n) => window.__2c.mkChannel(n),
      removeChannel: () => {},
      from: () => ({ select: function () { return this; }, eq: function () { return this; },
        order: function () { return this; }, limit: function () { return this; },
        maybeSingle: function () { return this; }, single: function () { return this; },
        then: (r) => Promise.resolve({ data: [], error: null }).then(r) }),
      rpc: (fn, args) => window.__mpRpc(JSON.stringify({ fn, args })).then(s => JSON.parse(s)),
      functions: { invoke: (fn, opts) => window.__mpInvoke(JSON.stringify({ fn, body: opts && opts.body })).then(s => JSON.parse(s)) },
      auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
    };
    Profile.cloud = Profile.cloud || {};
    Profile.cloud.signedIn = true;
    Profile.cloud.userId = o.userId;
    Profile.cloud.displayName = o.myName;
    Profile.cloud.autoSync = false;
    App.battlePrep = App.battlePrep || {};
    /* Each client builds its OWN board from ITS OWN hero, exactly as a real
       client does — which is why K2 has something to see. */
    const me = findHeroById(STARTER_HEROES[o.myHero].id);
    const foe = findHeroById(STARTER_HEROES[o.oppHero].id);
    App.battlePrep.hero = me;
    App.battlePrep.heroId = me.id;
    App.battlePrep.multiplayer = true;
    App.battlePrep.opponentName = o.oppName;
    /* 🔴 THIS MUST MATCH startBattleWithPrep, NOT AN APPROXIMATION OF IT. The
       shipped MP entry (index.html, startBattleWithPrep) calls
       initGame(…, playerGoesFirst, …) and then, for a multiplayer match ONLY:
           App.state.currentTurn = playerGoesFirst ? 'player' : 'ai';
           MatchBroadcast.myTurn  = !!playerGoesFirst;
           App.ui.aiBusy          = !playerGoesFirst;
       An earlier version of this harness set myTurn but left currentTurn
       undefined, and that ONE omission manufactured a spectacular fake bug:
       swapBattlePerspective reads `swapOwner(state.currentTurn || 'player')`,
       so with the field absent every adopted snapshot told the receiver "it is
       the opponent's turn" and both clients stood down. It reproduced, it
       looked exactly like a stranded-turn desync, and it was the harness.
       If you change how a match is started here, go and read that block first. */
    const goesFirst = !!o.myTurn;            // P1 opens; mp_init_match seeds the server with the same
    App.state = initGame(me, foe, [], goesFirst, null);
    App.state.currentTurn = goesFirst ? 'player' : 'ai';
    App.screen = 'battle';
    render();
    joinMatchChannel(o.matchId, o.amIPlayer1, o.oppId);
    MatchBroadcast.myTurn = goesFirst;
    App.ui.aiBusy = !goesFirst;
    return { units: (App.state.units || []).length, channel: !!MatchBroadcast.channel,
      turnNumber: App.state.turnNumber, hero: me.id,
      turn: App.state.turn, currentTurn: App.state.currentTurn };
  };

  /* THE PROJECTION the oracle compares. Both sides go through the SHIPPED
     serializer so art-stripping is symmetric, and the remote side additionally
     goes through the SHIPPED swapBattlePerspective — the same transform a real
     receiver applies. Normalising by hand instead would mean the oracle and the
     client could disagree, and the oracle would be measuring itself. */
  window.__2c.projection = (asSeenByPeer) => {
    let s = _serializeBattleStateForBroadcast(App.state);
    if (asSeenByPeer) s = swapBattlePerspective(s);
    return JSON.stringify(s);
  };
  window.__2c.marks = () => ({
    turnNumber: App.state && App.state.turnNumber,
    turn: App.state && App.state.turn,
    currentTurn: App.state && App.state.currentTurn,
    myTurn: !!MatchBroadcast.myTurn,
    hand: (App.state && App.state.player && App.state.player.hand || []).length,
    units: (App.state && App.state.units || []).length,
    gameOver: (App.state && App.state.gameOver) || null,
    discardPrompt: !!(App.ui && App.ui.discardPrompt),
    awaitingResync: !!MatchBroadcast.awaitingResync,
    screen: App.screen,
  });
  /* Board signature — positions + hp + liveness, sorted so it is order-free.
     This is what "no unit moved" is measured on. */
  /* Which of the two ORIGINAL boards is this client standing on? Unit ids are
     minted by initGame, so they identify the board a client adopted. The join
     handshake is a race between two full snapshots and this is what says who
     won it — including the "both adopted the other's board" outcome, which
     looks converged to a careless check and is the worst possible result. */
  window.__2c.unitIds = () => (App.state.units || []).map(u => u.id).sort().join(',');
  window.__2c.boardSig = () => JSON.stringify((App.state.units || [])
    .map(u => [u.id, u.owner, u.pos && u.pos.x, u.pos && u.pos.y, u.currentHp, u.alive !== false])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]))));

  /* A scripted half-turn's ACTION: swap a vanilla, cost-0, no-onPlay unit into
     a hand slot and deploy it through the REAL placeUnit(). Swap (not append)
     keeps the hand at its natural size, so a six-half-turn script never trips
     the HAND_LIMIT=7 discard prompt that would silently abort onEndTurn.
     The point is a real board mutation that must cross the wire — an end-turn
     alone only moves a counter. */
  window.__2c.playProbe = () => {
    const s = App.state;
    const hand = (s.player.hand || []).slice();
    if (!hand.length) return { err: 'empty hand' };
    window.__2c.probeN++;
    const card = { id: '_2c_probe', name: 'Relay Probe ' + window.__2c.probeN, type: 'unit',
      cost: 0, level: 1, atk: 2, def: 1, hp: 8, stats: { atk: 2, def: 1, hp: 8 },
      instanceId: 'probe_' + Profile.cloud.userId + '_' + window.__2c.probeN, onPlay: null };
    hand[0] = card;
    App.state = { ...s, player: { ...s.player, hand } };
    const ph = App.state.units.find(u => u.owner === 'player' && u.isHero);
    const tiles = getValidPlacementTiles(card, ph, App.state);
    if (!tiles || !tiles.length) return { err: 'no legal tile' };
    const before = App.state.units.length;
    placeUnit(card, tiles[0]);
    return { ok: App.state.units.length === before + 1, units: App.state.units.length,
      at: tiles[0], name: card.name };
  };
  window.__2c.endTurn = () => {
    const before = App.state.turnNumber;
    try { onEndTurn(); } catch (e) { return { err: String(e) }; }
    return { ok: App.state.turnNumber === before + 1, from: before, to: App.state.turnNumber,
      discardPrompt: !!(App.ui && App.ui.discardPrompt) };
  };
  /* K3's mutation. Deliberately the smallest possible one: ONE unit, ONE hp. */
  window.__2c.nudgeHp = (delta) => {
    const us = (App.state.units || []);
    const u = us.find(x => x && x.isHero && x.owner === 'player') || us[0];
    if (!u) return { err: 'no unit' };
    App.state = { ...App.state, units: us.map(x => x === u ? { ...x, currentHp: (x.currentHp | 0) + delta } : x) };
    return { id: u.id, hp: (u.currentHp | 0) + delta };
  };
  /* K4's levers — the pinned F3 bug, reproduced on purpose through the SHIPPED
     _setSurface / _clearSurface (index.html: _clearSurface is `delete
     board[y][x].surface`, which is where the "object ≠ undefined" diff shape
     comes from). Reading the census from both clients first is what keeps K4
     from landing on a tile that already carries a surface, which would produce
     an object-vs-object diff and prove something else. */
  window.__2c.surfaceCells = () => {
    const b = (App.state && App.state.board) || [];
    const out = [];
    for (let y = 0; y < b.length; y++) for (let x = 0; x < (b[y] || []).length; x++) {
      const t = b[y][x];
      if (t && t.surface) out.push(x + ',' + y + ':' + t.surface.type + ':' + t.surface.turnsLeft);
    }
    return { w: (b[0] || []).length, h: b.length, cells: out };
  };
  window.__2c.setSurface = (x, y, type, turns) => {
    try { _setSurface(App.state, x, y, type, turns); } catch (e) { return { err: String(e) }; }
    const t = App.state.board[y][x];
    return { ok: !!(t && t.surface), at: x + ',' + y, surface: t && t.surface };
  };
  window.__2c.clearSurface = (x, y) => {
    try { _clearSurface(App.state, x, y); } catch (e) { return { err: String(e) }; }
    return { ok: !(App.state.board[y][x] || {}).surface };
  };
  /* Gate mode only, and applied to BOTH clients so it introduces no asymmetry of
     its own. See the F4 note in the gate block for why the gate cannot leave the
     opening board's surfaces in place. */
  window.__2c.clearAllSurfaces = () => {
    const b = (App.state && App.state.board) || [];
    let n = 0;
    for (let y = 0; y < b.length; y++) for (let x = 0; x < (b[y] || []).length; x++) {
      if (b[y][x] && b[y][x].surface) { _clearSurface(App.state, x, y); n++; }
    }
    return n;
  };
  /* Kick the real AI scheduler. In multiplayer this returns at the guard
     (index.html, scheduleAIStep: "In multiplayer the AI is OFF"), so this must
     move nothing — and the control at the end of the run clears the flag to
     prove the same kick DOES move something when the guard is gone. */
  window.__2c.kickAI = () => { try { scheduleAIStep(1); return 'kicked'; } catch (e) { return String(e); } };
  window.__2c.unguardAI = () => {
    App.battlePrep.multiplayer = false;       // control only — corrupts this client
    /* doAIStep's FIRST line is `if (!App.state || !App.ui.aiBusy) return;` — the
       AI phase is what aiBusy means, so the control has to set it, not clear it.
       (Clearing it made the control silently prove nothing, which is exactly the
       failure mode the control exists to catch.) */
    App.ui.aiBusy = true;
    App.state = { ...App.state, turn: 'ai' };
    try { scheduleAIStep(1); return 'kicked-unguarded'; } catch (e) { return String(e); }
  };
  /* ── LEVERS FOR THE DELTA-FIDELITY SCENARIO (--delta) ────────────────────
     The point of that scenario is a turn that changes the BOARD and a
     side-keyed TOP-LEVEL field while summoning and killing nothing, because
     that is the shape the delta path used to silently drop: units.length is
     unchanged so _computeStateDelta does NOT bail to a full snapshot, and the
     end-turn moves turnNumber so the delta is non-empty and IS sent. */
  window.__2c.tileAt = (x, y) => {
    const b = (App.state && App.state.board) || [];
    const t = (b[y] || [])[x];
    return t ? JSON.parse(JSON.stringify(t)) : null;
  };
  window.__2c.cpState = () => ({
    cpScore: JSON.parse(JSON.stringify(App.state.cpScore || null)),
    cpStreak: JSON.parse(JSON.stringify(App.state.cpStreak || null)),
    points: (App.state.controlPoints || []).map(c => ({ id: c.id, x: c.x, y: c.y, holder: c.holder,
      scored: JSON.parse(JSON.stringify(c.scored || {})) })),
    ring: (typeof CP_RING === 'number') ? CP_RING : null,
  });
  /* Where every unit is, so "summoned and killed nothing" is an assertion and
     not an assumption. */
  window.__2c.census = () => ({
    units: (App.state.units || []).map(u => ({ id: u.id, owner: u.owner, x: u.pos && u.pos.x,
      y: u.pos && u.pos.y, hp: u.currentHp, alive: u.alive !== false, hero: !!u.isHero,
      hasMoved: !!u.hasMoved })),
  });
  /* Walk one of MY units toward a truck through the SHIPPED moveUnit — the same
     entry point the board's click handler uses, so range, pathing, traps and
     walkPath are all the real ones. Tries the truck tile first, then its ring,
     then anything that gets strictly closer; returns what it managed. */
  window.__2c.walkTowardCp = (cpIndex) => {
    const s0 = App.state;
    const mine = (s0.units || []).filter(u => u && u.owner === 'player' && u.alive !== false && u.pos);
    if (!mine.length) return { err: 'no units' };
    const d = (a, b) => (typeof distance === 'function') ? distance(a, b) : Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    /* ⚠ NEAREST truck, not truck #0. The trucks are seeded per match by
       _cpRollTruckTiles, so which one is within a single move's reach changes
       from run to run — pinning the index would have made this scenario fail on
       the seeds where cp1 happens to be across the board, i.e. a gate that goes
       red for reasons having nothing to do with the delta codec. */
    const cps = (s0.controlPoints || []);
    const cp = (cpIndex === null || cpIndex === undefined)
      ? cps.slice().sort((p, q) => Math.min(...mine.map(u => d(u.pos, p))) - Math.min(...mine.map(u => d(u.pos, q))))[0]
      : cps[cpIndex | 0];
    if (!cp) return { err: 'no such control point' };
    mine.sort((a, b) => d(a.pos, cp) - d(b.pos, cp));
    for (const u of mine) {
      const from = { x: u.pos.x, y: u.pos.y };
      const cands = [];
      const b = s0.board || [];
      for (let y = 0; y < b.length; y++) for (let x = 0; x < (b[y] || []).length; x++) {
        if (x === from.x && y === from.y) continue;
        if ((s0.units || []).some(o => o && o.alive !== false && o.pos && o.pos.x === x && o.pos.y === y)) continue;
        cands.push({ x: x, y: y });
      }
      cands.sort((p, q) => d(p, cp) - d(q, cp));
      for (const dest of cands) {
        if (d(dest, cp) >= d(from, cp)) break;            // nothing closer is reachable
        let ns;
        try { ns = moveUnit(s0, u, dest); } catch (e) { continue; }
        const moved = ns && (ns.units || []).find(x2 => x2.id === u.id);
        if (!moved || !moved.pos || (moved.pos.x === from.x && moved.pos.y === from.y)) continue;
        App.state = ns;
        return { ok: true, id: u.id, from: from, to: { x: moved.pos.x, y: moved.pos.y },
          distToCp: d(moved.pos, cp), cp: { x: cp.x, y: cp.y } };
      }
    }
    return { err: 'no reachable tile closer to the truck' };
  };
  /* Light a fire through the SHIPPED _setSurface, on a tile nobody is standing
     on, and write the log line a real action writes — without one the end-turn
     delta would still be sent (turnNumber moves) but the scenario would not
     look like a real turn. */
  window.__2c.lightFire = (x, y, turns) => {
    try { _setSurface(App.state, x, y, 'fire', turns || 4); } catch (e) { return { err: String(e) }; }
    App.state.log = [...(App.state.log || []), { msg: '🔥 Scripted fire at ' + x + ',' + y, color: 'amber' }];
    const t = App.state.board[y][x];
    return { ok: !!(t && t.surface), at: { x: x, y: y }, surface: t && JSON.parse(JSON.stringify(t.surface)) };
  };
  window.__2c.errors = () => window.__2c.errs.slice(0, 6);
};

/* ════════════════════════════════════════════════════════════════════════
   4 · THE ORACLE
   ════════════════════════════════════════════════════════════════════════
   Compare A's projection with B's projection-as-seen-by-A. Everything is
   compared; the exclusion list is what is allowed to differ, and nothing else
   is. `units` LENGTH mismatches are always divergence — a unit that exists on
   one board and not the other is the bug this whole subsystem exists to avoid.

   ⚠ WHAT THE EXCLUDED FIELDS TURNED OUT TO BE — do not read this list as
     "harmless". Every entry below is turn-scoped scratch that startTurn()
     stamps for the side whose turn it is, and the two clients have run a
     DIFFERENT NUMBER of startTurns at any settled moment: the live Supabase
     path runs endPlayerTurn() (which calls startTurn(s,'ai')) on the sender
     AND the turn-start-on-flip block in _onRemoteStateArrived runs
     startTurn(s,'player') on the receiver. usedPriority / ambushUsed /
     _momentumStacks / _vigilantTurn are once-per-turn gameplay gates, so this
     asymmetry is a real question for M1–M3, not a formatting detail. It is
     excluded here because it is present on a CLEAN run of the shipped code and
     an oracle that reds on it could never certify anything — but it is COUNTED
     and PRINTED every run so nobody can pretend it is not there. */
const EXCLUDED = [
  { re: /^log($|[.[])/,        why: 'each client keeps its OWN re-worded log on purpose (_mpReattributeLogLine)' },
  { re: /^phase$/,             why: 'the phase track belongs to whoever is currently playing' },
  { re: /^spellTurn$/,         why: 'per-turn flag, reset by startTurn for the side taking the turn' },
  { re: /^turnLocks($|[.[])/,  why: 'per-turn restrictions, cleared by startTurn' },
  { re: /^_fkDeathSeen($|[.[])/,      why: 'per-turn bookkeeping reset by startTurn' },
  { re: /^_phoenixTurnRevives($|[.[])/, why: 'per-turn bookkeeping reset by startTurn' },
  { re: /^units\[\d+\]\.(_hpTurnStart|usedPriority|solarFlareUsed|ambushUsed|_steadfastAttacked|_cosmicBladestormTurn|_cosmicOvermindTurn|_cosmicShadowWarTurn|_momentumStacks|_momentumTurn|_vigilantTurn|_chokeheld)$/,
    why: 'once-per-turn unit gates stamped by startTurn — see the warning above' },
];
function deepDiff(a, b, p, out, cap) {
  if (out.length >= cap) return out;
  if (a === b) return out;
  const ta = a === null ? 'null' : Array.isArray(a) ? 'arr' : typeof a;
  const tb = b === null ? 'null' : Array.isArray(b) ? 'arr' : typeof b;
  /* 🔴 A TYPE MISMATCH CARRIES THE VALUES TOO (`av`/`bv`), not only the type
     names. Without them no pin can tell the TERMINAL step of the one-turn
     surface drift — the client that is a tick ahead has already run
     _clearSurface, which is a literal `delete board[y][x].surface`, so the key
     EXISTS on one client and is undefined on the other — apart from any other
     object-vs-undefined difference. That distinction is not academic: that
     exact shape (`board[8][1].surface: "object" ≠ "undefined"`) is what made
     `--gate` go red on an untouched tree roughly one run in sixteen.
     `a`/`b` stay the type names so fmtDiff keeps printing what it printed. */
  if (ta !== tb) { out.push({ path: p, a: ta, b: tb, av: a, bv: b }); return out; }
  if (ta === 'arr') {
    if (a.length !== b.length) out.push({ path: p + '.length', a: a.length, b: b.length });
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) deepDiff(a[i], b[i], p + '[' + i + ']', out, cap);
    return out;
  }
  if (ta === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) deepDiff(a[k], b[k], p ? p + '.' + k : k, out, cap);
    return out;
  }
  out.push({ path: p, a, b });
  return out;
}
/* 🐛 A KNOWN BUG, PINNED — NOT AN EXCLUSION.
   F3: a surface's countdown drifts by exactly one turn between the two clients.
   It is real, it is in the shared board, and the FULL run reports it as
   divergence — which is why the full run is not a gate. Gate mode allows it, in
   the two shapes ONE tick of drift can actually take, and nothing else.

   🔴 WHY THERE ARE TWO SHAPES, AND WHY THE FIRST VERSION OF THIS PIN WAS A
      LIE OF OMISSION. The first version matched only shape (a), the mid-drift
      countdown. But a countdown ends. `_clearSurface` (index.html) is
      `delete state.board[y][x].surface`, so on the tick where the client that
      is one AHEAD reaches zero, it deletes the tile's surface while the client
      that is one BEHIND still holds it with `turnsLeft: 1`. The oracle then
      sees a TYPE mismatch, not a number one: `board[8][1].surface:
      "object" ≠ "undefined"`. Same single bug, terminal step, different diff
      record — and it escaped the pin.
      MEASURED, and this is the reason for this whole block: a critic ran
      `--gate` 16 times on the untouched shipped tree and got 15 green and 1 RED,
      the red being exactly that shape at half-turn 3. Shape (a) fired in 0 of
      those 16. So as written the pin was dead code in gate mode while the shape
      that actually occurs walked straight past it, and the gate — which
      tools/mp-tests/run.mjs step 1 now depends on — was red ~6% of the time for
      reasons having nothing to do with the change under test. A gate that cries
      wolf gets ignored; that is the harm this file's own header spends three
      paragraphs arguing against, so it is not acceptable in this file's own
      gate entry.

   The allowance is BOUNDED, deliberately, and the bound is exercised on every
   single run (see PIN_SELFTEST below and K4 in gate mode):
     (a) both clients still hold the surface and the countdowns differ by
         EXACTLY ONE. Two turns of drift is a different, worse bug and fails.
     (b) one client holds it and the other has deleted it, AND the surviving
         side is within one tick of expiry (`turnsLeft <= 1`). A surface that
         vanished on one client with 6 turns still on the clock is NOT this
         bug — it is a surface that was never relayed, or was cleared by an
         effect that did not cross, and it still fails the run.
   Every occurrence is printed, loudly, every run: an allowance nobody can see
   is how a bug becomes the spec. Delete this whole block the day the drift is
   fixed — the allowance is permissive, so a fixed tree stays green without it. */
const SURFACE_TICK = /^board\[\d+\]\[\d+\]\.surface\.turnsLeft$/;
const SURFACE_CELL = /^board\[\d+\]\[\d+\]\.surface$/;
function KNOWN_BAD(d) {
  if (SURFACE_TICK.test(d.path)) {                       // (a) mid-drift
    return typeof d.a === 'number' && typeof d.b === 'number' && Math.abs(d.a - d.b) === 1;
  }
  if (SURFACE_CELL.test(d.path)) {                       // (b) the drift expiring
    const aGone = d.av === undefined, bGone = d.bv === undefined;
    if (aGone === bGone) return false;                   // both there / both gone → not this
    const live = aGone ? d.bv : d.av;
    return !!live && typeof live === 'object' && !Array.isArray(live)
      && Number.isFinite(live.turnsLeft) && live.turnsLeft <= 1;
  }
  return false;
}
/* THE PIN'S OWN SPEC, EXECUTED ON EVERY RUN — because a pin that never fires is
   indistinguishable from a pin that is broken, and this one demonstrably went
   16 runs without firing while the bug it names sailed past it. These are the
   diff records deepDiff actually produces (hence `av`/`bv`), including the
   verbatim shape from the red run that motivated the widening. */
function PIN_SELFTEST() {
  const cell = (av, bv) => ({ path: 'board[8][1].surface', a: av === undefined ? 'undefined' : 'object',
    b: bv === undefined ? 'undefined' : 'object', av, bv });
  const cases = [
    ['(a) countdown one apart is pinned',        { path: 'board[3][5].surface.turnsLeft', a: 7, b: 8 }, true],
    ['(b) expiry — the shape that went red',     cell({ type: 'fire', turnsLeft: 1 }, undefined),       true],
    ['(b) expiry, other direction',              cell(undefined, { type: 'water', turnsLeft: 1 }),      true],
    ['countdown TWO apart is not pinned',        { path: 'board[3][5].surface.turnsLeft', a: 6, b: 8 }, false],
    ['a surface gone with 6 turns left is not',  cell({ type: 'oil', turnsLeft: 6 }, undefined),        false],
    ['a surface TYPE differing is not',          { path: 'board[3][5].surface.type', a: 'fire', b: 'oil' }, false],
    ['a unit vanishing is never pinned',         { path: 'units[2]', a: 'object', b: 'undefined', av: { id: 'u' }, bv: undefined }, false],
    ['hp off by one is never pinned',            { path: 'units[1].currentHp', a: 12, b: 13 },          false],
  ];
  const bad = cases.filter(([, d, want]) => KNOWN_BAD(d) !== want).map(([n]) => n);
  ok('\u{1F4CC} PIN SELF-TEST: the F3 allowance matches its 3 shapes and rejects 5 near-misses',
    bad.length === 0, bad.length ? 'WRONG: ' + bad.join('; ') : cases.length + '/' + cases.length);
  /* 🔴 THE CONTROL FOR THE WIDENING ITSELF — the pin exactly as it was written
     on the day the gate went red, kept here as a control and nowhere else. It
     must REJECT the expiry shape that the widened pin accepts; if it ever
     accepts it, the story told in the F3 note above is wrong and this whole
     block is decoration. This is the difference between "the gate is green" and
     "the gate is green for the reason claimed". */
  const OLD_PIN = (d) => /^board\[\d+\]\[\d+\]\.surface\.turnsLeft$/.test(d.path)
    && typeof d.a === 'number' && typeof d.b === 'number' && Math.abs(d.a - d.b) === 1;
  const redShape = cell({ type: 'fire', turnsLeft: 1 }, undefined);
  ok('\u{1F4CC} PIN SELF-TEST control: the OLD pin let that shape through — this one does not',
    OLD_PIN(redShape) === false && KNOWN_BAD(redShape) === true,
    'old=' + OLD_PIN(redShape) + ' new=' + KNOWN_BAD(redShape) + '  on ' + fmtDiff(redShape));
}
function classify(diffs) {
  const divergence = [], asymmetry = [];
  for (const d of diffs) {
    const hit = EXCLUDED.find(x => x.re.test(d.path));
    (hit ? asymmetry : divergence).push(d);
  }
  return { divergence, asymmetry };
}
async function runOracle(clients, label) {
  const A = JSON.parse(await clients.A.page.evaluate(() => window.__2c.projection(false)));
  const B = JSON.parse(await clients.B.page.evaluate(() => window.__2c.projection(true)));
  const { divergence, asymmetry } = classify(deepDiff(A, B, '', [], 4000));
  return { converged: divergence.length === 0, divergence, asymmetry,
    label, aUnits: (A.units || []).length, bUnits: (B.units || []).length };
}
const fmtDiff = (d) => d.path + ': ' + JSON.stringify(d.a) + ' ≠ ' + JSON.stringify(d.b);
function reportOracle(res, expectConverged, name) {
  const asym = res.asymmetry.length;
  const verdict = res.converged ? 'CONVERGED' : 'NOT-CONVERGED (' + res.divergence.length + ' divergent field' + (res.divergence.length === 1 ? '' : 's') + ')';
  ok(name, res.converged === expectConverged,
    verdict + (asym ? '  [+' + asym + ' known asymmetry]' : ''));
  if (res.converged !== expectConverged || !expectConverged) {
    for (const d of res.divergence.slice(0, 6)) say('         · ' + fmtDiff(d).slice(0, 150));
    if (res.divergence.length > 6) say('         · … ' + (res.divergence.length - 6) + ' more');
  }
}

/* ════════════════════════════════════════════════════════════════════════
   5 · BOOT
   ════════════════════════════════════════════════════════════════════════ */
async function boot(browser, relay, row) {
  const clients = {};
  const uid = { A: 'uid-aaaa-1111', B: 'uid-bbbb-2222' };
  const mk = async (side) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));
    /* Everything off-box is refused: no CDN, no live Supabase, no analytics.
       If a socket to the real service were ever opened, this would break the
       run instead of quietly making it a one-client test again. */
    await page.route('**/*', (r) => {
      const u = r.request().url();
      return (u.includes('127.0.0.1') || u.includes('localhost')) ? r.continue() : r.abort();
    });
    await page.exposeFunction('__mpSend', (json) => {
      const m = JSON.parse(json);
      relayEnqueue(relay, side, m.event, m.payload);
    });
    await page.exposeFunction('__mpRpc', (json) => {
      const m = JSON.parse(json);
      if (m.fn === 'mp_init_match') return JSON.stringify(srv_mp_init_match(row, uid[side], m.args));
      return JSON.stringify({ data: null, error: null });
    });
    await page.exposeFunction('__mpInvoke', (json) => {
      const m = JSON.parse(json);
      if (m.fn !== 'mp_end_turn') return JSON.stringify({ data: null, error: null });
      const res = srv_mp_end_turn(row, uid[side], m.body);
      /* Realtime echoes the row UPDATE to BOTH clients (mp_edge_functions.sql
         §5 adds `matches` to the publication, and joinMatchChannel listens on
         postgres_changes). Modelled as relay traffic so the knobs cover it. */
      if (res.data && res.data.ok) {
        relayEnqueue(relay, 'A', 'matches.UPDATE', { ...row });
        relayEnqueue(relay, 'B', 'matches.UPDATE', { ...row });
      }
      return JSON.stringify(res);
    });
    await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction('typeof initGame === "function" && typeof joinMatchChannel === "function" && typeof swapBattlePerspective === "function" && typeof placeUnit === "function"',
      null, { timeout: 180000 });
    await page.evaluate(PAGE_STUB);
    clients[side] = { side, page, context, pageErrors, uid: uid[side] };
  };
  await Promise.all([mk('A'), mk('B')]);
  return clients;
}
const SETUP = {
  A: { userId: 'uid-aaaa-1111', oppId: 'uid-bbbb-2222', amIPlayer1: true,  myHero: 0, oppHero: 1, myTurn: true,  myName: 'Ava', oppName: 'Bex' },
  B: { userId: 'uid-bbbb-2222', oppId: 'uid-aaaa-1111', amIPlayer1: false, myHero: 1, oppHero: 0, myTurn: false, myName: 'Bex', oppName: 'Ava' },
};
/* STAGGER — join B first, let its opening handshake go out while A is still
   loading, THEN join A. Nothing is dropped by the relay: B's early packets are
   delivered to a client that has not subscribed, and Supabase broadcast has no
   replay, so they are genuinely gone. That is the ordinary case in production,
   where two players reach joinMatchChannel through their own poll ticks and are
   rarely inside the same delivery window. The default (both clients joined
   inside one delivery window, nothing delivered in between) is the TIGHTEST
   corner of the same race, and comparing the two is how this harness tells a
   race apart from a bug. */
async function startMatch(clients, relay, row, staggerMs) {
  if (staggerMs) {
    const b0 = await clients.B.page.evaluate(o => window.__2c.setup(o), { ...SETUP.B, matchId: row.id });
    await settle(relay, clients, staggerMs);
    const a0 = await clients.A.page.evaluate(o => window.__2c.setup(o), { ...SETUP.A, matchId: row.id });
    const origin0 = { A: await clients.A.page.evaluate(() => window.__2c.unitIds()),
      B: await clients.B.page.evaluate(() => window.__2c.unitIds()) };
    return { a: a0, b: b0, origin: origin0 };
  }
  const a = await clients.A.page.evaluate(o => window.__2c.setup(o), { ...SETUP.A, matchId: row.id });
  const b = await clients.B.page.evaluate(o => window.__2c.setup(o), { ...SETUP.B, matchId: row.id });
  /* The id sets each client MINTED, before anything is relayed. Whichever set a
     client is holding later is the board it adopted. */
  const origin = { A: await clients.A.page.evaluate(() => window.__2c.unitIds()),
    B: await clients.B.page.evaluate(() => window.__2c.unitIds()) };
  return { a, b, origin };
}
/* Name the board a client is standing on, for the handshake diagnosis. */
async function whoseBoard(client, origin) {
  const ids = await client.page.evaluate(() => window.__2c.unitIds());
  const inA = origin.A.split(',').filter(Boolean);
  const inB = origin.B.split(',').filter(Boolean);
  const now = ids.split(',').filter(Boolean);
  const fromA = now.filter(i => inA.includes(i)).length;
  const fromB = now.filter(i => inB.includes(i)).length;
  if (fromA && !fromB) return "A's original";
  if (fromB && !fromA) return "B's original";
  if (fromA && fromB) return 'MIXED (' + fromA + ' from A, ' + fromB + ' from B)';
  return 'neither (all units minted since)';
}

/* ════════════════════════════════════════════════════════════════════════
   6 · THE CLEAN SCRIPT — six half-turns, nothing injected.
   ════════════════════════════════════════════════════════════════════════
   One half-turn = the client that holds the turn deploys one probe unit
   (real placeUnit → real checkPostAction → real broadcastMyState) and then
   ends the turn (real onEndTurn → real broadcast + real mp_end_turn invoke).
   Convergence is judged AFTER the peer has adopted and answered, which is the
   only settled point the protocol has: between those two moments exactly one
   client has run a turn-start the other has not seen. */
async function cleanScript(clients, relay, row, opts) {
  const quiet = !!(opts && opts.quiet);
  const turns = (opts && opts.turns) || 6;
  const results = [];
  let holder = 'A';
  for (let i = 1; i <= turns; i++) {
    const play = await clients[holder].page.evaluate(() => window.__2c.playProbe());
    const end = await clients[holder].page.evaluate(() => window.__2c.endTurn());
    /* 900 ms covers the 30 ms outbound debounce plus the peer's adopt →
       turn-start → answering broadcast round trip. */
    /* ⏱ WAIT FOR THE WIRE TO GO QUIET, not a fixed 900 ms. Since the receiver
       runs its own turn start and answers with its board (the sender no longer
       simulates the peer's turn start — that was the double tick), a handoff is
       a ROUND TRIP, and when vizreq packets queue ahead of it the answer was
       still in the relay when the oracle read both boards: 2 red runs in 12,
       always "the peer's mirror is one draw behind", with the answer visibly
       missing from --trace. 900 ms stays the floor; the ceiling is 4 s. */
    await settleQuiet(relay, clients, 900, 400, 4000);
    const marks = { A: await clients.A.page.evaluate(() => window.__2c.marks()),
      B: await clients.B.page.evaluate(() => window.__2c.marks()) };
    const res = await runOracle(clients, 'half-turn ' + i);
    results.push({ i, holder, play, end, marks, res, srvTurn: row.turn_number,
      srvCurrent: row.current_player_id });
    if (!quiet) {
      const tag = 'half-turn ' + i + ' (' + holder + ' plays + ends)';
      ok(tag + ' — turn actually ended', !!end.ok,
        'turnNumber ' + end.from + '→' + end.to + (end.discardPrompt ? ' [HAND-LIMIT PROMPT]' : ''));
      ok(tag + ' — probe unit deployed', !!play.ok, play.err || (play.name + ' at ' + JSON.stringify(play.at) + ', units=' + play.units));
      ok(tag + ' — server turn_number == both clients',
        row.turn_number === marks.A.turnNumber && row.turn_number === marks.B.turnNumber,
        'server=' + row.turn_number + ' A=' + marks.A.turnNumber + ' B=' + marks.B.turnNumber);
      ok(tag + ' — exactly one client holds the turn',
        marks.A.myTurn !== marks.B.myTurn,
        'A.myTurn=' + marks.A.myTurn + ' B.myTurn=' + marks.B.myTurn + ' server.current=' + (row.current_player_id === clients.A.uid ? 'A' : 'B'));
      ok(tag + ' — the server agrees who holds it',
        (row.current_player_id === clients.A.uid) === marks.A.myTurn,
        'server says ' + (row.current_player_id === clients.A.uid ? 'A' : 'B'));
      /* GATE MODE, FIRST HALF-TURN ONLY. Muting B's opening snapshots means A
         never received B's private block, so A's `ai` mirror of it is still
         empty (and its model of B's deck has even taken fatigue drawing from a
         deck it does not have). That is a consequence of the harness's OWN
         fault injection, and the first exchange is what repairs it. It is not
         waved through: the divergence has to be EXACTLY the known set, so a new
         one here still fails. */
      if (opts && opts.knownBad) {
        const kb = res.divergence.filter(opts.knownBad);
        const stray = res.divergence.filter(d => !opts.knownBad(d)
          && !(i === 1 && opts.firstTurnAllowed && opts.firstTurnAllowed.test(d.path)));
        ok(tag + ' — oracle' + (i === 1 ? ' (gate: only the muted peer\'s mirror may lag)' : ''),
          stray.length === 0,
          stray.length ? stray.length + ' unexplained' : (res.divergence.length ? 'all ' + res.divergence.length + ' explained' : 'CONVERGED'));
        for (const d of stray) say('         · UNEXPECTED ' + fmtDiff(d).slice(0, 150));
        if (kb.length) say('         ⚠ KNOWN-BAD ALLOWED (' + kb.length + '): '
          + kb.slice(0, 3).map(d => fmtDiff(d)).join('; '));
      } else {
        reportOracle(res, true, tag + ' — oracle');
      }
    }
    holder = OTHER(holder);
  }
  return results;
}

/* ════════════════════════════════════════════════════════════════════════
   7 · MAIN
   ════════════════════════════════════════════════════════════════════════ */
const browser = await chromium.launch({ headless: !HEADED, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const t0 = Date.now();

say('\n\u{1F501} TWO-CLIENT MP HARNESS — two contexts, one relayed transport, one oracle');
say('   source: ' + SRC);
say('   ⚠ THE RELAY IS LOSSLESS, IN-ORDER, ~0ms AND SINGLE-PROCESS. The server');
say('     model is transcribed by hand from mp_edge_functions.sql:112-223 and');
say('     supabase/functions/mp_end_turn/index.ts; nobody here can run a migration');
say('     or reach the live database, and nothing in this tree shows that SQL was');
say('     ever applied to it. A green run proves THE CLIENT HANDLES A VERDICT — it');
say('     never proves the server produces one. No auth, no RLS, no clock skew.\n');

/* Printed on EVERY run, in every mode: the F3 allowance's spec, executed. It
   costs nothing and it is the check that would have caught the pin being dead. */
PIN_SELFTEST();

if (GATE) {
  /* ── GATE MODE — the deterministic slice, for tools/mp-tests/run.mjs ──────
     The default script is NOT gate-material and this file says so out loud:
     the shipped join handshake is a race (see the finding printed by a normal
     run), so a gate built on it would be red on correct code a large fraction
     of the time, and a gate people learn to ignore is worse than no gate.
     Gate mode removes THAT ONE nondeterminism WITHOUT injecting any fault and
     without touching the fixture: it WAITS for the client's own self-healing
     turn-holder heartbeat (a full re-broadcast every 4000 ms) to settle which
     opening board both clients end up on, and asserts that it happens inside a
     budget. Everything downstream is then the same code on the same clean
     relay. An earlier version muted client B's opening snapshots instead; that
     is fault injection, and it produced its own artifacts — a peer that thinks
     its snapshot was delivered goes on to send DELTAS against it, so the mute
     leaked into every later packet. Waiting is honest; muting was not.
     What this gates: the oracle, the adopt path, the turn handoff, and the
     transcribed server's turn_number agreeing with both clients. What it does
     NOT gate: how long the opening race takes to heal, or how often it is
     visible to a player — that is measured by --flake, not asserted.

     📊 THE GATE'S MEASURED RATE, AND THE ONLY WAY TO STATE IT. Every claim of
        determinism here is a MEASUREMENT and gets replaced, not defended, when
        somebody re-measures:
          · 16 runs, F3 pin matching the countdown only ..... 1 red  (6.3%)
          · 24 runs, pin widened to the expiry shape ........ 1 red  (4.2%) ← F4
          · 48 runs, pin widened + F4 source removed ........ 0 red  (0.0%)
            (two separate 24-run sweeps; the second on the final file, the first
            on the same code before this table was written into it)
        The last of those is this code. 0/48 does NOT mean zero: with 48 samples
        the true rate could still be a couple of percent (a 3% fault has a ~23%
        chance of surviving 48 runs unseen). If this gate goes red on a change that
        cannot plausibly have caused it, re-run `--gate --repeat=24` before
        blaming the change, and put the number you get here.

     🔴 THE SECOND NONDETERMINISM, AND WHY IT IS NOT SOLVED BY LOOKING AWAY.
     F1 is not the only random thing in here: the opening board spawns surfaces
     at random, and F3 drifts their countdowns by a turn, so some gate runs
     carry a surface difference and some do not. That is handled by PINNING the
     two shapes one tick of drift can take (KNOWN_BAD) — not by seeding the
     board flat and not by excluding board surfaces. Both of those would have
     been less code and both would have thrown away the gate's ability to see a
     surface that never crossed the wire at all, which is a real MP failure and
     is precisely what M1–M3 will be injecting. The cost of the pin is that it
     must be shown to be live and bounded on every run, which is K4's job. */
  const relay = makeRelay();
  const row = makeMatchRow('uid-aaaa-1111', 'uid-bbbb-2222');
  const clients = await boot(browser, relay, row);
  say('  \u{1F512} GATE MODE — TWO faults are injected on purpose: the opening resync exchange is');
  say('     suppressed (F1) and the opening board\'s surfaces are cleared on both clients (F4).');
  say('     So this gate does NOT exercise the opening snapshot or surface relay. Both are');
  say('     measured instead by the full run and --flake. See the notes at each injection.\n');
  /* Set BEFORE the clients start. subscribe() resolves on a macrotask, so the
     opening resync is sent while startMatch is still awaiting — a knob set
     afterwards is set too late, and two resyncs got through and re-opened the
     race. Left up for the whole run: on a lossless relay resync is a recovery
     path with nothing to recover, and the gate says plainly that it therefore
     does not exercise it. */
  relay.knobs.drop['A:resync'] = 1e9;
  relay.knobs.drop['B:resync'] = 1e9;
  const setup = await startMatch(clients, relay, row, 0);
  ok('both clients built their own board', setup.a.units >= 2 && setup.b.units >= 2 && setup.a.hero !== setup.b.hero);

  const k2 = await runOracle(clients, 'pre-relay');
  reportOracle(k2, false, '\u{1F534} K2: two unsynced clients must NOT read as converged');
  ok('K2: nothing had been delivered when K2 was judged', relay.delivered.length === 0,
    relay.delivered.length + ' delivered');

  /* 🔴 THE ONE FAULT THIS GATE INJECTS, AND EXACTLY WHY.
     The opening resync exchange is dropped in BOTH directions for one second,
     so no snapshot crosses before the first end-turn. That skips turn 1 —
     the only genuinely unstable window in this protocol, and the harness
     measured why: the out-of-order guard is `payload.turn < lastSeenTurn`, and
     during turn 1 EVERY packet carries turn 1, so `<` can never reject
     anything. Whichever opening snapshot lands last wins, a stale one can roll
     a client back after it has already ended its turn, and the pair can sit
     swapped. Waiting for the 4000 ms turn-holder heartbeat to heal it was tried
     and is not reliable: measured over six runs it healed in 9–20 s and twice
     did not hold.
     Dropping resync — rather than muting one client's snapshots, which was the
     previous attempt — leaves no residue: _sendFullSnapshot only ever fires in
     answer to a resync, so with none delivered NEITHER client sends an opening
     snapshot, neither one sets lastSentSnapshot, and the only board on the wire
     before the first end-turn is the opener's own heartbeat. From there turn
     numbers advance and the `<` guard starts working, which is the regime this
     gate is for.
     The skipped window is NOT thereby declared fine — it is the headline
     finding, measured by --flake. */
  await settle(relay, clients, 1200);
  /* What makes this deterministic is not silence — it is that only ONE client
     speaks. A does broadcast in this window without being asked: the turn-holder
     heartbeat starts with _mpHeartbeatAt = 0, so `_now - 0 > 4000` is true on the
     very first turn-clock tick and the opener re-pushes its board immediately.
     That is shipped behaviour and it is the good half of the handshake — one
     board, from the client the server named as opener. The non-holder must not
     answer with a competing opening snapshot, and with resync suppressed it has
     no reason to.
     Whether that first heartbeat lands inside this window is timing (it did in
     6 of 10 measured runs) and does not matter. The invariant that does: the
     NON-opener must not have put a board on the wire. */
  const preBoard = relay.delivered.filter(d => d.event === 'state' || d.event === 'state-delta');
  ok('no board crossed from the non-opener before the first turn ended',
    preBoard.every(d => d.from === 'A'),
    (preBoard.map(d => d.from + ':' + d.event).join(', ') || 'nothing crossed yet')
    + '  [resync dropped: ' + (relay.counts.dropped.resync || 0) + ']');
  const m0 = { A: await clients.A.page.evaluate(() => window.__2c.marks()),
    B: await clients.B.page.evaluate(() => window.__2c.marks()) };
  ok('the opener the server chose is the client that holds the turn',
    m0.A.myTurn === (row.current_player_id === clients.A.uid) && m0.A.myTurn !== m0.B.myTurn,
    'A.myTurn=' + m0.A.myTurn + ' B.myTurn=' + m0.B.myTurn + ' server=' + (row.current_player_id === clients.A.uid ? 'A' : 'B'));

  /* 🔴 F4 — THE SECOND FAULT THIS GATE INJECTS, AND THE MEASUREMENT THAT FORCED
     IT. The opening board spawns surfaces at random, and the double turn-start
     that causes F3's countdown drift does not only move a counter: a unit that
     ends its turn on a damaging surface is burned a different number of times on
     the two clients. MEASURED, 24 gate runs on this tree with the F3 pin already
     widened: 23 green, 1 red on `units[0].currentHp: 244 ≠ 238` at half-turn 1
     and `226 ≠ 232` at half-turn 2 — the same unit, the sign flipping between
     checkpoints. That difference is 6, and SURFACE_FIRE_DMG is 6 (index.html).
     ⚠ The 6 is a match, not a proof: no run in this harness has yet been stepped
       through to show the burn being applied twice. Treat the mechanism as the
       hypothesis it is; the DIVERGENCE is measured and is not a hypothesis.
     THIS ONE MUST NEVER BE PINNED. A pin that tolerated hero HP differing by 6
     would gut the oracle — HP is the single most load-bearing field it compares,
     and K3 exists to prove a ONE HP difference is caught. So the gate removes
     the SOURCE instead, symmetrically, on both clients: no surfaces on the
     opening board, therefore no stand damage, therefore no drift and no expiry
     either. What that costs is printed in the gate's own banner lines and it is
     real: THIS GATE DOES NOT EXERCISE SURFACE RELAY. K4 below still seeds a surface by hand
     to prove the oracle compares board surfaces at all, the full run and --flake
     keep the surfaces and report F3/F4 as findings, and any surface that spawns
     mid-script (weather pools water and dries it) is still covered by the pin. */
  const cleared = { A: await clients.A.page.evaluate(() => window.__2c.clearAllSurfaces()),
    B: await clients.B.page.evaluate(() => window.__2c.clearAllSurfaces()) };
  const cens0 = { A: await clients.A.page.evaluate(() => window.__2c.surfaceCells()),
    B: await clients.B.page.evaluate(() => window.__2c.surfaceCells()) };
  say('  \u{1F5FA} GATE: board surfaces cleared on BOTH clients (A ' + cleared.A + ', B ' + cleared.B
    + ') — this gate does not test surface relay; see the F4 note');
  ok('the gate starts from a surface-free board on both clients',
    cens0.A.cells.length === 0 && cens0.B.cells.length === 0,
    'A: ' + (cens0.A.cells.join(' ') || 'none') + '   B: ' + (cens0.B.cells.join(' ') || 'none'));

  /* With no opening exchange, each client's MIRROR of the other's private zones
     (`state.ai` — populated only from a received snapshot) is still empty at the
     first checkpoint, and two shape artifacts of the serialize→adopt round trip
     ride along (`activeLocation` undefined vs null, `_mpPrivateRemovals` stamped
     by the adopt path). B's first broadcast fills the mirror in, so this is
     allowed at half-turn 1 ONLY, and only for these paths — anything else there
     still fails. */
  const FIRST_TURN_ALLOWED = /^(ai($|[.[])|activeLocation$|_mpPrivateRemovals$)/;
  const rs = await cleanScript(clients, relay, row, { turns: 4, knownBad: KNOWN_BAD,
    firstTurnAllowed: FIRST_TURN_ALLOWED });
  const k1ok = rs.every(r => r.end.ok)
    && rs.slice(1).every(r => r.res.divergence.every(d => KNOWN_BAD(d)))
    && rs[0].res.divergence.every(d => KNOWN_BAD(d) || FIRST_TURN_ALLOWED.test(d.path));
  ok('\u{1F3AF} K1: four half-turns, zero unexplained divergence', k1ok,
    rs.map(r => r.res.divergence.length).join('/') + ' divergent fields per half-turn'
    + ' (the first is each mirror catching up)');
  const mEnd = { A: await clients.A.page.evaluate(() => window.__2c.marks()),
    B: await clients.B.page.evaluate(() => window.__2c.marks()) };
  ok('the server and both clients agree on the turn at the end',
    row.turn_number === mEnd.A.turnNumber && row.turn_number === mEnd.B.turnNumber && mEnd.A.myTurn !== mEnd.B.myTurn,
    'server=' + row.turn_number + ' A=' + mEnd.A.turnNumber + ' B=' + mEnd.B.turnNumber);

  /* K3 in gate mode is measured as a DELTA against the pinned known-bad set, so
     "the oracle went red" can never be satisfied by a drift that was already
     there: clean before, exactly the mutated field after, clean again once it
     is put back. */
  const strayOf = (res) => res.divergence.filter(d => !KNOWN_BAD(d));
  const before = strayOf(await runOracle(clients, 'pre-mutation'));
  ok('K3: the board is clean (modulo the pinned drift) before the mutation', before.length === 0,
    before.map(d => d.path).join(', '));
  await clients.B.page.evaluate(() => window.__2c.nudgeHp(-1));
  const k3 = strayOf(await runOracle(clients, 'mutated'));
  ok('\u{1F534} K3: a 1 HP difference on one client must go RED, and name that field',
    k3.length === 1 && /^units\[\d+\]\.currentHp$/.test(k3[0].path),
    k3.map(d => fmtDiff(d)).join(', ') || 'NOTHING DIVERGED — the oracle is vacuous');
  await clients.B.page.evaluate(() => window.__2c.nudgeHp(+1));
  const after = strayOf(await runOracle(clients, 'restored'));
  ok('K3: putting the 1 HP back makes it green again', after.length === 0,
    after.map(d => d.path).join(', '));

  /* ── K4 · THE PINNED BUG, REPRODUCED ON PURPOSE ────────────────────────────
     🔴 WHY THIS EXISTS. The F3 allowance above used to match only the
        mid-drift countdown, and the shape that actually reaches this gate is
        the TERMINAL step — one client has already run _clearSurface's
        `delete board[y][x].surface` while the other still holds the tile. That
        made the gate red 1 run in 16 on an untouched tree, while the allowance
        itself fired in 0 of those 16: a dead pin next to an escaping bug. The
        widening is only worth as much as the evidence that it is live and
        bounded, and waiting for a ~6% event to appear is not evidence.
        So K4 MANUFACTURES that exact shape, deterministically, every run,
        through the SHIPPED _setSurface / _clearSurface, and checks BOTH
        directions of the bound:
          · turnsLeft 1 on one client only → the oracle SEES it and the pin
            ABSORBS it (this is the run that used to go red),
          · turnsLeft 6 on one client only → same path, same type mismatch, and
            the pin must REFUSE it, because a surface that vanished with six
            turns on the clock is a different bug.
        Without the second half the widening would be indistinguishable from
        "ignore board surfaces", which is an exclusion wearing a pin's clothes.
     ⚠ It is a MUTATION on client B, like K3, so it runs last and is undone. */
  const cens = { A: await clients.A.page.evaluate(() => window.__2c.surfaceCells()),
    B: await clients.B.page.evaluate(() => window.__2c.surfaceCells()) };
  say('  \u{1F5FA} surface census — A: ' + (cens.A.cells.join(' ') || 'none')
    + '   B: ' + (cens.B.cells.join(' ') || 'none'));
  /* Pick a tile carrying no surface on EITHER client. B's (x,y) is compared
     against A's mirrored cell (_mirrorAllPositions rebuilds the grid at
     W-1-x, H-1-y), so both ends have to be clear or the diff is object-vs-object
     and K4 would be proving something else. */
  const occB = new Set(cens.B.cells.map(c => c.split(':')[0]));
  const occA = new Set(cens.A.cells.map(c => c.split(':')[0]));
  const W = cens.B.w, H = cens.B.h;
  let spot = null;
  for (let y = 0; y < H && !spot; y++) for (let x = 0; x < W && !spot; x++) {
    if (!occB.has(x + ',' + y) && !occA.has((W - 1 - x) + ',' + (H - 1 - y))) spot = { x, y };
  }
  ok('K4: found a tile with no surface on either client', !!spot, spot ? JSON.stringify(spot) : 'board full of surfaces');
  if (spot) {
    const seed = async (turns) => {
      await clients.B.page.evaluate(([x, y, t]) => window.__2c.setSurface(x, y, 'fire', t), [spot.x, spot.y, turns]);
      const res = await runOracle(clients, 'seeded surface');
      const cellDiffs = res.divergence.filter(d => SURFACE_CELL.test(d.path));
      return { res, cellDiffs, stray: strayOf(res) };
    };
    const expiring = await seed(1);
    ok('K4: a surface on ONE client only IS a divergence the oracle sees',
      expiring.cellDiffs.length === 1,
      expiring.cellDiffs.map(d => fmtDiff(d)).join(', ') || 'THE ORACLE DID NOT SEE IT — it is not comparing board surfaces at all');
    ok('\u{1F4CC} K4: …and at turnsLeft 1 the F3 pin ABSORBS it (this shape used to go RED)',
      expiring.stray.length === 0 && expiring.cellDiffs.length === 1,
      expiring.stray.map(d => fmtDiff(d)).join(', ') || 'pinned: ' + expiring.cellDiffs.map(d => fmtDiff(d)).join(', '));
    await clients.B.page.evaluate(([x, y]) => window.__2c.clearSurface(x, y), [spot.x, spot.y]);
    const fresh = await seed(6);
    ok('\u{1F534} K4 CONTROL: at turnsLeft 6 the SAME shape must still fail — the pin is bounded',
      fresh.stray.length === 1 && SURFACE_CELL.test(fresh.stray[0].path),
      fresh.stray.map(d => fmtDiff(d)).join(', ') || 'THE PIN SWALLOWED IT — the allowance is an exclusion');
    await clients.B.page.evaluate(([x, y]) => window.__2c.clearSurface(x, y), [spot.x, spot.y]);
    const k4after = strayOf(await runOracle(clients, 'K4 restored'));
    ok('K4: clearing the seeded surface makes it green again', k4after.length === 0,
      k4after.map(d => d.path).join(', '));
  }

  for (const s of ['A', 'B']) ok(s + ': zero page errors', clients[s].pageErrors.length === 0,
    clients[s].pageErrors.slice(0, 2).join(' | '));
  await clients.A.context.close(); await clients.B.context.close();
} else if (DELTA) {
  /* ── DELTA-FIDELITY MODE ───────────────────────────────────────────────
     🐛 THE BUG. _computeStateDelta whitelisted 17 unit fields and 9 top-level
     keys; _applyStateDelta patched a DIFFERENT list of 9. Measured through the
     shipped pair, 3 of 17 fields round-tripped and 14 were lost — including the
     whole BOARD (surfaces, walls, traps), controlPoints and cpScore.
     Why that is not a small leak: the end-of-turn handoff is ALWAYS a delta,
     because it changes turnNumber / currentTurn / turn, which WERE on the
     whitelist. So a turn that lit a fire or took a control point but summoned
     and killed nothing (units.length unchanged → no bail to a full snapshot)
     handed the opponent a board on which none of it happened, and the two
     baselines then diverged permanently: the sender advances to the full next
     snapshot, the receiver to the patched one.

     THE SCENARIO, in three half-turns after a warm-up, all through shipped
     entry points and with NOTHING summoned or killed after the warm-up:
       T1  A lights a fire (shipped _setSurface) and walks a unit toward a
           control-point truck (shipped moveUnit), then ends its turn.
       T2  B ends its turn without playing. That flip is what runs A's OWN
           turn-start — in multiplayer _cpTickControlPoints deliberately ticks
           only the LOCAL side (see its header: ticking both double-counted and
           ended matches early), so A's control-point score lands here, one
           turn-start after the walk, not during T1.
       T3  A ends its turn. THIS is the handoff that has to carry cpScore.
     Then: B must hold the fire on its mirrored tile and the same cpScore, and
     the oracle must be green.

     📏 AND THE BANDWIDTH CONTROL, which is the point of measuring at all:
     "make the delta carry everything" has a trivially correct and completely
     useless answer — return null and send a full snapshot every time. That
     would pass every fidelity check in this file. So every run reports bytes
     on the wire per half-turn and how many of the handoffs were deltas rather
     than snapshots; a fix that converts the delta path into a snapshot path
     shows up as both numbers moving at once. */
  const relay = makeRelay();
  const row = makeMatchRow('uid-aaaa-1111', 'uid-bbbb-2222');
  const clients = await boot(browser, relay, row);
  say('  \u{1F4E6} DELTA-FIDELITY MODE — the board+control-point turn that the delta path used to drop\n');
  /* Same two determinism controls the gate uses, for the same reasons: the
     opening resync exchange is a race nothing can order at turn 1 (F1), and the
     opening board's random surfaces drive a stand-damage divergence (F4). Both
     are applied symmetrically. This mode therefore does not exercise the
     opening snapshot either — it is about what a mid-match handoff carries. */
  relay.knobs.drop['A:resync'] = 1e9;
  relay.knobs.drop['B:resync'] = 1e9;
  await startMatch(clients, relay, row, 0);
  await settle(relay, clients, 1200);
  for (const s of ['A', 'B']) await clients[s].page.evaluate(() => window.__2c.clearAllSurfaces());

  /* Warm-up: two ordinary half-turns so both sides hold a delta baseline. These
     DO summon (playProbe), which is why they are the warm-up and not the
     measurement — a units.length change makes _computeStateDelta bail to a full
     snapshot on purpose, and that path was never the broken one. */
  await cleanScript(clients, relay, row, { turns: 2, quiet: true });
  const warmBytes = JSON.parse(JSON.stringify(relay.bytes));
  const warmCounts = JSON.parse(JSON.stringify(relay.counts.queued));

  const cp0 = await clients.A.page.evaluate(() => window.__2c.cpState());
  const cen0 = await clients.A.page.evaluate(() => window.__2c.census());
  say('  \u{1F69A} trucks (A\'s board, ring ' + cp0.ring + '): '
    + cp0.points.map(p => p.id + '@' + p.x + ',' + p.y + (p.holder ? ' held by ' + p.holder : '')).join('  ')
    + '   score=' + JSON.stringify(cp0.cpScore));
  ok('the board actually has control points to capture', cp0.points.length > 0,
    cp0.points.length + ' truck(s)');

  /* A tile for the fire: empty, and far from every truck, so no unit ever
     stands in it. A unit ending its turn in fire takes stand damage, and that
     is F4 — a real divergence this scenario must not manufacture for itself.
     ⚠ The grid is read FROM THE PAGE. Hardcoding it here got the mirror wrong
       on the first run of this mode — tools/mp-tests/perspective.mjs still says
       "must match index.html's `const BOARD_W = 8, BOARD_H = 7`" and index.html
       has said `BOARD_W = 14, BOARD_H = 12` for some time, so the mirrored tile
       read was off the board and the fire looked lost when it was not. */
  const dims = await clients.A.page.evaluate(() => window.__2c.surfaceCells());
  const W = dims.w, H = dims.h;
  say('  \u{1F4D0} board is ' + W + '×' + H + ' (read from the page, not assumed)');
  const occupied = new Set(cen0.units.filter(u => u.alive).map(u => u.x + ',' + u.y));
  let fireAt = null;
  for (let y = 0; y < H && !fireAt; y++) for (let x = 0; x < W && !fireAt; x++) {
    if (occupied.has(x + ',' + y)) continue;
    if (cp0.points.some(p => Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) <= (cp0.ring + 1))) continue;
    const tA = await clients.A.page.evaluate(([xx, yy]) => window.__2c.tileAt(xx, yy), [x, y]);
    const tB = await clients.B.page.evaluate(([xx, yy]) => window.__2c.tileAt(xx, yy), [W - 1 - x, H - 1 - y]);
    if (tA && tB && !tA.surface && !tB.surface) fireAt = { x, y };
  }
  ok('found an empty, truck-free tile to light', !!fireAt, fireAt ? JSON.stringify(fireAt) : 'none');

  const mark = () => relay.delivered.length;
  const since = (m) => relay.delivered.slice(m);

  /* 🔴 THE MEASUREMENT'S OWN HONESTY CONTROL — without this the scenario proves
     nothing. "B ended up with the fire" is satisfiable by the turn-holder
     HEARTBEAT, which re-pushes a FULL snapshot every 4000 ms, and on the first
     run of this mode exactly that happened: A's T1 window carried
     `state, state-delta`. A full snapshot has always carried everything; if one
     is allowed to cross, a completely broken delta path still ends with both
     boards agreeing and the run goes green for the wrong reason.
     So from here on A's full snapshots are DROPPED. The only board A puts on
     the wire during the scenario is a delta, and if that delta is lossy the run
     is red — which is the whole question. How many were dropped is printed, so
     the reader can see the injection rather than take it on trust.
     ⚠ FLUSH FIRST. The warm-up's own snapshots are still sitting in relay.pending
       when this arms, and a knob only affects what is enqueued AFTER it: the
       first version of this block left one warm-up `state` to be delivered
       inside T1's settle window, which made the window look like it carried a
       full snapshot when the packet predated the fire by two half-turns. */
  await settle(relay, clients, 700);
  relay.knobs.drop['A:state'] = 1e9;

  // ── T1 · A lights a fire and walks toward a truck, then ends its turn ────
  const m1 = mark();
  const fire = await clients.A.page.evaluate(([x, y]) => window.__2c.lightFire(x, y, 9), [fireAt.x, fireAt.y]);
  ok('T1: A lit a fire through the shipped _setSurface', !!fire.ok, JSON.stringify(fire.surface || fire.err));
  const walk = await clients.A.page.evaluate(() => window.__2c.walkTowardCp(null));
  ok('T1: A walked a unit toward the truck through the shipped moveUnit', !!walk.ok,
    walk.err || (walk.id + ' ' + JSON.stringify(walk.from) + '→' + JSON.stringify(walk.to)
      + ', now ' + walk.distToCp + ' from ' + JSON.stringify(walk.cp)));
  const cenPre = await clients.A.page.evaluate(() => window.__2c.census());
  const end1 = await clients.A.page.evaluate(() => window.__2c.endTurn());
  await settle(relay, clients, 900);
  const t1pk = since(m1).filter(d => d.from === 'A' && (d.event === 'state' || d.event === 'state-delta'));
  ok('T1: the only board A put on the wire was a DELTA (full snapshots dropped)',
    t1pk.length > 0 && t1pk.every(d => d.event === 'state-delta'),
    t1pk.map(d => d.event).join(', ') || 'A sent no board at all');
  /* 🔴 THE PACKET ITSELF. Not "B agrees with A" — what the handoff CONTAINED.
     This is the assertion that fails on the shipped-before tree: board was on
     neither the compute list nor the apply list, so the delta had no board
     carrier at all and this comes back with the key missing. */
  const t1fire = t1pk.filter(d => d.event === 'state-delta').map(d => (d.payload && d.payload.delta) || {})
    .flatMap(dl => (dl.boardChanges || []))
    .filter(c => c && c.x === fireAt.x && c.y === fireAt.y && c.tile && c.tile.surface);
  ok('\u{1F534} T1: the handoff DELTA carries the lit tile itself',
    t1fire.length > 0 && t1fire[0].tile.surface.type === 'fire',
    t1fire.length ? JSON.stringify(t1fire[0]) : 'no boardChanges entry for ' + JSON.stringify(fireAt)
      + ' — delta keys were: ' + JSON.stringify(t1pk.filter(d => d.event === 'state-delta')
        .map(d => Object.keys((d.payload && d.payload.delta) || {}))));
  ok('T1: nothing was summoned and nothing died',
    cenPre.units.length === cen0.units.length
    && cenPre.units.filter(u => u.alive).length === cen0.units.filter(u => u.alive).length,
    cen0.units.length + ' units before, ' + cenPre.units.length + ' after (alive '
    + cen0.units.filter(u => u.alive).length + '→' + cenPre.units.filter(u => u.alive).length + ')');
  ok('T1: the turn actually ended', !!end1.ok, 'turnNumber ' + end1.from + '→' + end1.to);

  /* 🔴 THE HEADLINE ASSERTION — the board change itself. B's board is the
     mirror (_mirrorAllPositions rebuilds the grid at W-1-x, H-1-y), so A's
     (x,y) is read at B's (W-1-x, H-1-y). turnsLeft is NOT compared: the F3
     countdown drift is a known, separately-pinned bug and this is not the check
     that should fail for it. The TYPE is what crossed or did not. */
  const tileA = await clients.A.page.evaluate(([x, y]) => window.__2c.tileAt(x, y), [fireAt.x, fireAt.y]);
  const tileB = await clients.B.page.evaluate(([x, y]) => window.__2c.tileAt(x, y), [W - 1 - fireAt.x, H - 1 - fireAt.y]);
  ok('\u{1F534} T1: the fire A lit is on B\'s board',
    !!(tileB && tileB.surface && tileB.surface.type === 'fire'),
    'A: ' + JSON.stringify(tileA && tileA.surface) + '   B(mirrored): ' + JSON.stringify(tileB && tileB.surface));
  /* The walked unit's ROUTE, which moveUnit's own header claims reaches the
     multiplayer receiver "through the same channel the position itself travels
     on". It did not: walkPath was on neither delta list, so on the opponent's
     screen every relayed walk was a straight tween through walls. */
  const wpB = await clients.B.page.evaluate((id) => {
    const u = (App.state.units || []).find(x => x.id === id);
    return u ? { has: Array.isArray(u.walkPath), n: (u.walkPath || []).length } : null;
  }, walk.id);
  ok('T1: the walked unit\'s route (walkPath) reached B', !!(wpB && wpB.has && wpB.n >= 2),
    JSON.stringify(wpB));

  // ── T2 · B ends its turn; that flip runs A's own turn-start + CP tick ────
  const m2 = mark();
  const end2 = await clients.B.page.evaluate(() => window.__2c.endTurn());
  await settle(relay, clients, 900);
  ok('T2: B handed the turn back', !!end2.ok, 'turnNumber ' + end2.from + '→' + end2.to);
  const cpA1 = await clients.A.page.evaluate(() => window.__2c.cpState());
  ok('\u{1F69A} T2: A\'s turn-start banked a control point (the walk paid off)',
    JSON.stringify(cpA1.cpScore) !== JSON.stringify(cp0.cpScore),
    'A cpScore ' + JSON.stringify(cp0.cpScore) + ' → ' + JSON.stringify(cpA1.cpScore)
    + '   holders: ' + cpA1.points.map(p => p.id + '=' + p.holder).join(','));

  // ── T3 · A ends its turn — the handoff that must carry cpScore ───────────
  const m3 = mark();
  const cenPre3 = await clients.A.page.evaluate(() => window.__2c.census());
  const end3 = await clients.A.page.evaluate(() => window.__2c.endTurn());
  await settle(relay, clients, 900);
  const t3pk = since(m3).filter(d => d.from === 'A' && (d.event === 'state' || d.event === 'state-delta'));
  ok('T3: the only board A put on the wire was a DELTA (full snapshots dropped)',
    t3pk.length > 0 && t3pk.every(d => d.event === 'state-delta'),
    t3pk.map(d => d.event).join(', ') || 'A sent no board at all');
  const t3cp = t3pk.filter(d => d.event === 'state-delta').map(d => (d.payload && d.payload.delta) || {})
    .filter(dl => dl.cpScore !== undefined);
  ok('\u{1F534} T3: the handoff DELTA carries cpScore itself',
    t3cp.length > 0, t3cp.length ? JSON.stringify(t3cp[0].cpScore)
      : 'no cpScore key — delta keys were: ' + JSON.stringify(t3pk.filter(d => d.event === 'state-delta')
        .map(d => Object.keys((d.payload && d.payload.delta) || {}))));
  ok('T3: still nothing summoned, nothing died',
    cenPre3.units.length === cen0.units.length, cen0.units.length + ' → ' + cenPre3.units.length);
  ok('T3: the turn ended', !!end3.ok, 'turnNumber ' + end3.from + '→' + end3.to);

  const cpA2 = await clients.A.page.evaluate(() => window.__2c.cpState());
  const cpB2 = await clients.B.page.evaluate(() => window.__2c.cpState());
  /* B's view is the SWAPPED perspective, so A's 'player' score is B's 'ai'
     score (swapBattlePerspective exchanges the side-keyed cpScore map). */
  ok('\u{1F534} T3: the control-point score A banked is on B\'s board',
    (cpA2.cpScore.player | 0) === (cpB2.cpScore.ai | 0)
    && (cpA2.cpScore.ai | 0) === (cpB2.cpScore.player | 0)
    && (cpA2.cpScore.player | 0) > 0,
    'A=' + JSON.stringify(cpA2.cpScore) + '   B(swapped)=' + JSON.stringify(cpB2.cpScore));
  const holdersA = cpA2.points.map(p => p.id + '=' + p.holder).join(',');
  const holdersB = cpB2.points.map(p => p.id + '=' + (p.holder === 'player' ? 'ai' : p.holder === 'ai' ? 'player' : p.holder)).join(',');
  ok('T3: the truck HOLDERS agree once B\'s perspective is unswapped', holdersA === holdersB,
    'A: ' + holdersA + '   B: ' + holdersB);

  const strayOf = (res) => res.divergence.filter(d => !KNOWN_BAD(d));
  const fin = await runOracle(clients, 'delta scenario');
  const stray = strayOf(fin);
  ok('\u{1F3AF} the convergence oracle is green after the whole scenario', stray.length === 0,
    stray.length ? stray.length + ' divergent: ' + stray.slice(0, 6).map(d => fmtDiff(d).slice(0, 140)).join(' | ')
      : 'CONVERGED' + (fin.asymmetry.length ? ' [+' + fin.asymmetry.length + ' known asymmetry]' : ''));

  // ── 📏 BANDWIDTH ────────────────────────────────────────────────────────
  const scenarioBytes = {};
  for (const k of new Set([...Object.keys(relay.bytes), ...Object.keys(warmBytes)])) {
    const n = (relay.bytes[k] | 0) - (warmBytes[k] | 0);
    if (n) scenarioBytes[k] = n;
  }
  const nDelta = (relay.counts.queued['state-delta'] | 0) - (warmCounts['state-delta'] | 0);
  const nFull  = (relay.counts.queued['state'] | 0) - (warmCounts['state'] | 0);
  const bDelta = scenarioBytes['state-delta'] | 0;
  const bFull  = scenarioBytes['state'] | 0;
  say('\n  \u{1F4CF} BYTES ON THE WIRE');
  say('     whole run, by event: ' + JSON.stringify(relay.bytes));
  say('     the 3 scripted half-turns: ' + JSON.stringify(scenarioBytes));
  /* 🔴 DELTAS AND SNAPSHOTS ARE REPORTED SEPARATELY, ON PURPOSE. The regression
     this measurement exists to catch is a "fix" that makes the delta carry
     everything by quietly turning every packet into a full snapshot, and a
     single combined byte total hides exactly that: it moves the same way
     whether the deltas grew or whether the deltas were REPLACED. The pair of
     numbers that answers it is deltas-per-turn and bytes-per-delta. A snapshot
     from B lands in this window on some runs and not others (its heartbeat is
     on a 4000 ms clock), which is a second reason not to read the combined
     total as if it were the delta path's cost. */
  say('     DELTAS   : ' + nDelta + ' packet(s), ' + bDelta + ' bytes'
    + (nDelta ? '  → ' + Math.round(bDelta / nDelta) + ' bytes/delta' : ''));
  say('     SNAPSHOTS: ' + nFull + ' packet(s), ' + bFull + ' bytes'
    + '   (A\'s were dropped by the honesty control; ' + (relay.counts.dropped.state | 0) + ' dropped)');
  say('     BYTES/HALF-TURN, deltas only: ' + Math.round(bDelta / 3)
    + '   ·   including snapshots: ' + Math.round((bDelta + bFull) / 3));
  say('     ⚠ compare against the SAME command on a tree without the fix:');
  say('       MP_SRC=<other index.html> node .gauntlet/drive-mp-twoclient.mjs --delta');

  for (const s of ['A', 'B']) {
    ok(s + ': zero page errors', clients[s].pageErrors.length === 0, clients[s].pageErrors.slice(0, 2).join(' | '));
    const inPage = await clients[s].page.evaluate(() => window.__2c.errors());
    ok(s + ': zero errors inside a channel handler', inPage.length === 0, inPage.slice(0, 2).join(' | '));
  }
  await clients.A.context.close(); await clients.B.context.close();
} else if (FLAKE) {
  /* ── FLAKE MODE ────────────────────────────────────────────────────────
     The same clean script, N times, from a cold pair of contexts each time.
     Reports a RATE. A single green run of a concurrent system is an anecdote. */
  say('  \u{1F3B2} FLAKE MODE — ' + FLAKE + ' runs of the byte-identical clean script\n');
  let green = 0;
  const failures = [];
  const tally = { handshake: 0, endTurn: 0, probe: 0, turnNumber: 0, oracle: 0, pageerror: 0, threw: 0 };
  for (let run = 1; run <= FLAKE; run++) {
    const relay = makeRelay();
    const row = makeMatchRow('uid-aaaa-1111', 'uid-bbbb-2222');
    const clients = await boot(browser, relay, row);
    let bad = [];
    const hit = {};
    try {
      const setup = await startMatch(clients, relay, row, STAGGER);
      await settle(relay, clients, 5200);
      const hs = await runOracle(clients, 'post-handshake');
      if (!hs.converged) {
        hit.handshake = 1;
        bad.push('handshake:diverged[A on ' + await whoseBoard(clients.A, setup.origin)
          + ', B on ' + await whoseBoard(clients.B, setup.origin) + ']');
      }
      const rs = await cleanScript(clients, relay, row, { quiet: true });
      for (const r of rs) {
        if (!r.end.ok) { hit.endTurn = 1; bad.push('ht' + r.i + ':end-turn-blocked' + (r.end.discardPrompt ? '(hand-limit)' : '')); }
        if (!r.play.ok) { hit.probe = 1; bad.push('ht' + r.i + ':probe(' + (r.play.err || '?') + ')'); }
        if (!(r.srvTurn === r.marks.A.turnNumber && r.srvTurn === r.marks.B.turnNumber)) { hit.turnNumber = 1; bad.push('ht' + r.i + ':turn#(srv' + r.srvTurn + '/A' + r.marks.A.turnNumber + '/B' + r.marks.B.turnNumber + ')'); }
        if (!r.res.converged) { hit.oracle = 1; bad.push('ht' + r.i + ':diverged[' + r.res.divergence.slice(0, 2).map(d => d.path).join(',') + ']'); }
      }
      for (const s of ['A', 'B']) if (clients[s].pageErrors.length) { hit.pageerror = 1; bad.push(s + ':pageerror'); }
    } catch (e) { hit.threw = 1; bad.push('threw:' + String(e).slice(0, 80)); }
    for (const k of Object.keys(hit)) tally[k] += hit[k];
    if (!bad.length) green++; else failures.push('run ' + run + ': ' + bad.join(' '));
    say('    run ' + String(run).padStart(2) + '/' + FLAKE + '  ' + (bad.length ? 'RED  ' + bad.slice(0, 3).join(' ') : 'green'));
    await clients.A.context.close(); await clients.B.context.close();
  }
  const rate = ((FLAKE - green) / FLAKE * 100).toFixed(1);
  say('\n  \u{1F4CA} FLAKE RATE: ' + (FLAKE - green) + '/' + FLAKE + ' runs red = ' + rate + '%   (a rate, not a boolean)');
  say('     per checkpoint, runs in which it went red:');
  for (const k of Object.keys(tally)) say('       ' + k.padEnd(12) + tally[k] + '/' + FLAKE
    + '  (' + (tally[k] / FLAKE * 100).toFixed(0) + '%)');
  for (const f of failures) say('     ' + f);
  ok('flake mode completed ' + FLAKE + ' runs', true, rate + '% red');
} else {
  const relay = makeRelay();
  const row = makeMatchRow('uid-aaaa-1111', 'uid-bbbb-2222');
  const clients = await boot(browser, relay, row);
  say('  two contexts booted in ' + (Date.now() - t0) + 'ms\n');

  /* ── the match is REAL on both sides ─────────────────────────────────── */
  say('  ── PASS 0 · both clients are in a real battle');
  const setup = await startMatch(clients, relay, row, STAGGER);
  ok('A built a real board', setup.a.units >= 2 && setup.a.channel, JSON.stringify(setup.a));
  ok('B built a real board', setup.b.units >= 2 && setup.b.channel, JSON.stringify(setup.b));
  ok('the two clients did NOT start from the same board', setup.a.hero !== setup.b.hero,
    'A hero=' + setup.a.hero + '  B hero=' + setup.b.hero);
  ok('mp_init_match seeded the server with the opener', row.current_player_id === clients.A.uid,
    'current_player_id=' + row.current_player_id + ' turn_number=' + row.turn_number);

  /* ── K2 ──────────────────────────────────────────────────────────────── */
  say('\n  ── K2 · NEGATIVE CONTROL — the oracle BEFORE any packet is relayed');
  say('     (both clients have queued their join handshake; nothing has been delivered)');
  const k2 = await runOracle(clients, 'pre-relay');
  reportOracle(k2, false, '\u{1F534} K2: two unsynced clients must NOT read as converged');
  /* Holds in --stagger too: B's opening packets went out before A subscribed,
     so they reached no handler and are counted as lost, not delivered. */
  ok('K2: nothing had been delivered when K2 was judged', relay.delivered.length === 0,
    relay.pending.length + ' queued, ' + relay.delivered.length + ' delivered, ' + relay.lost + ' lost-before-subscribe');

  /* ── join handshake ──────────────────────────────────────────────────── */
  say('\n  ── join handshake');
  const drained = await settle(relay, clients, 5200);
  say('     ' + drained + ' packet(s) relayed (waits past joinMatchChannel\'s 1500ms and 4000ms resync re-requests)');
  say('     ' + relay.vizDropped + ' unitviz packet(s) dropped by the default knob'
    + (relay.vizDropped === 0 ? ' — none were produced: the starter heroes in this run carry no custom art, so _mpRelayUnitVisuals had nothing to chunk' : ''));
  const k0 = await runOracle(clients, 'post-handshake');
  const onBoard = { A: await whoseBoard(clients.A, setup.origin), B: await whoseBoard(clients.B, setup.origin) };
  say('     A is standing on ' + onBoard.A + ';  B is standing on ' + onBoard.B);
  reportOracle(k0, true, 'after the handshake the two boards agree');
  if (!k0.converged) {
    /* THIS IS A MEASUREMENT, NOT A HARNESS FAULT — and it is the point of the
       file, so it says so out loud rather than being averaged away. Both
       clients answer each other's resync with a FULL pre-adopt snapshot, and at
       turn 1 the out-of-order guard (`payload.turn < lastSeenTurn`) cannot
       break the tie because every packet carries turn 1. Whichever full
       snapshot lands LAST wins that client's board, so the pair can end up
       having swapped boards instead of agreeing on one. See --trace. */
    say('     \u{1F534} DIVERGED AT THE JOIN HANDSHAKE. Everything below is DOWNSTREAM of this,');
    say('        not independent evidence. Re-run with --trace to see which full snapshot');
    say('        landed last. This is a race in the shipped join handshake, not in the relay:');
    say('        both clients answer the peer\'s resync with a full turn-1 snapshot, and at');
    say('        turn 1 the `payload.turn < lastSeenTurn` guard cannot order them.');
  }

  /* ── K1 ──────────────────────────────────────────────────────────────── */
  say('\n  ── K1 · CLEAN RELAY — six scripted half-turns, nothing injected');
  const k1 = await cleanScript(clients, relay, row, {});
  const k1clean = k1.every(r => r.res.converged && r.end.ok);
  ok('\u{1F3AF} K1: six half-turns on a clean relay, zero divergence', k1clean,
    k1.map(r => r.res.divergence.length).join('/') + ' divergent fields per half-turn');
  const asym = k1[k1.length - 1].res.asymmetry;
  say('     KNOWN ASYMMETRY still present at the end: ' + asym.length + ' field(s) — '
    + [...new Set(asym.map(d => d.path.replace(/\[\d+\]/g, '[]')))].slice(0, 8).join(', '));

  /* ── nothing moves without a packet ──────────────────────────────────── */
  /* ── nothing moves without a packet ──────────────────────────────────────
     The window is closed on BOTH ends: the relay delivers nothing at all while
     it is open (so any movement would have to be locally generated), and both
     clients get a real scheduleAIStep() kick inside it. The AI is the only
     thing in the client that moves a unit on its own, and its MP guard is the
     only thing stopping it — so this is that guard, exercised.
     The clients do NOT go silent in that window and it would be wrong to
     assert that they do: the turn-holder re-broadcasts its authoritative board
     every 4000 ms (index.html's MP heartbeat, "so a dropped action/handoff
     self-heals on the opponent") and the waiting client keeps its viz-request
     throttle ticking. So the check is on the CONTENT, not the traffic: after
     the window, everything the clients queued during it is delivered, and the
     boards must STILL be the boards they were before the kick. Nothing moved
     locally, and nothing was announced as having moved. */
  say('\n  ── no unit moves except from a relayed packet');
  await settle(relay, clients, 1500);                    // quiesce: drain the stragglers first
  const sigBefore = { A: await clients.A.page.evaluate(() => window.__2c.boardSig()),
    B: await clients.B.page.evaluate(() => window.__2c.boardSig()) };
  const deliveredBefore = relay.delivered.length;
  const queuedBefore = relay.seq;
  await clients.A.page.evaluate(() => window.__2c.kickAI());
  await clients.B.page.evaluate(() => window.__2c.kickAI());
  await new Promise(r => setTimeout(r, 2600));           // > scheduleAIStep's own delay + AI_DELAYS.move
  const sigAfter = { A: await clients.A.page.evaluate(() => window.__2c.boardSig()),
    B: await clients.B.page.evaluate(() => window.__2c.boardSig()) };
  const queuedInWindow = relay.pending.filter(p => p.id > queuedBefore);
  ok('the relay delivered NOTHING during the window', relay.delivered.length === deliveredBefore,
    (relay.delivered.length - deliveredBefore) + ' delivered');
  ok('A: no unit moved while the AI was kicked', sigBefore.A === sigAfter.A);
  ok('B: no unit moved while the AI was kicked', sigBefore.B === sigAfter.B);
  say('     the window\'s own traffic: ' + (queuedInWindow.map(p => p.from + ':' + p.event).join(', ') || 'none')
    + '  — now delivered, and the boards must not move');
  await settle(relay, clients, 800);
  const sigFinal = { A: await clients.A.page.evaluate(() => window.__2c.boardSig()),
    B: await clients.B.page.evaluate(() => window.__2c.boardSig()) };
  ok('A: the window\'s own traffic announced no movement either', sigBefore.A === sigFinal.A);
  ok('B: the window\'s own traffic announced no movement either', sigBefore.B === sigFinal.B);

  /* ── K3 ──────────────────────────────────────────────────────────────── */
  say('\n  ── K3 · MUTATION CONTROL — 1 HP on one client only');
  const nudged = await clients.B.page.evaluate(() => window.__2c.nudgeHp(-1));
  const k3 = await runOracle(clients, 'mutated');
  reportOracle(k3, false, '\u{1F534} K3: a 1 HP difference on one client must go RED');
  const namesUnit = k3.divergence.some(d => /^units\[\d+\]\.currentHp$/.test(d.path));
  ok('K3: the oracle names the mutated field', namesUnit,
    'unit ' + nudged.id + ' → ' + nudged.hp + '; divergent: ' + k3.divergence.map(d => d.path).slice(0, 3).join(', '));
  await clients.B.page.evaluate(() => window.__2c.nudgeHp(+1));
  const k3back = await runOracle(clients, 'restored');
  reportOracle(k3back, true, 'K3: putting the 1 HP back makes it green again');

  /* ── knob self-test ──────────────────────────────────────────────────── */
  say('\n  ── knob self-test — a knob that does nothing would make every fault-injection green');
  const probe = (knobs) => {
    const r = makeRelay();
    Object.assign(r.knobs, knobs);
    for (const e of ['state', 'state', 'resync']) relayEnqueue(r, 'A', e, { n: e });
    return r;
  };
  const kDrop = probe({ drop: { state: 1 } });
  ok('knob drop: one \'state\' packet is swallowed', kDrop.pending.length === 2 && kDrop.counts.dropped.state === 1,
    kDrop.pending.length + ' queued of 3');
  const kDup = probe({ duplicate: { state: 1 } });
  ok('knob duplicate: one \'state\' packet is doubled', kDup.pending.length === 4,
    kDup.pending.length + ' queued of 3');
  const kDelay = probe({ delay: { state: 500 } });
  const nowDue = kDelay.pending.filter(p => p.dueAt <= Date.now()).length;
  ok('knob delay: delayed packets are not yet due', nowDue === 1 && kDelay.pending.length === 3,
    nowDue + ' of 3 due now');
  {
    /* Pumped against a stand-in page so the order can be read straight off
       relay.delivered — the packets are numbered in the order they were queued,
       so "1,2,3" means nothing was reordered and "2,1,3" means the first
       'state' packet was held behind its successor. */
    const kRe = probe({ reorder: { state: 1 } });
    /* Returns 1: the pump treats a zero-handler delivery as lost-before-
       subscribe and drops it from `delivered`, which would leave this test
       reading an empty order and calling it a pass-by-vacuum. */
    const sink = { page: { evaluate: async () => 1 } };
    await relayPump(kRe, { A: sink, B: sink });
    const order = kRe.delivered.map(d => d.id);
    ok('knob reorder: the marked packet arrives after its successor',
      order.length === 3 && order[0] === 2 && order[1] === 1,
      'delivery order by queue position: ' + order.join(','));
  }

  /* ── CONTROL for the movement check ──────────────────────────────────── */
  say('\n  ── CONTROL — the same "nothing moved" detector, with the MP guard removed');
  say('     (this deliberately corrupts client B; it is the last thing the run does)');
  const ctlBefore = await clients.B.page.evaluate(() => window.__2c.boardSig());
  await clients.B.page.evaluate(() => window.__2c.unguardAI());
  await new Promise(r => setTimeout(r, 4000));
  const ctlAfter = await clients.B.page.evaluate(() => window.__2c.boardSig());
  ok('\u{1F534} CONTROL: with multiplayer cleared, the AI DOES move a unit',
    ctlBefore !== ctlAfter,
    ctlBefore === ctlAfter ? 'board unchanged — the movement detector proves nothing' : 'board signature changed');

  /* ── page health ─────────────────────────────────────────────────────── */
  say('');
  for (const s of ['A', 'B']) {
    ok(s + ': zero page errors', clients[s].pageErrors.length === 0, clients[s].pageErrors.slice(0, 2).join(' | '));
    const inPage = await clients[s].page.evaluate(() => window.__2c.errors());
    ok(s + ': zero errors inside a channel handler', inPage.length === 0, inPage.slice(0, 2).join(' | '));
  }
  say('\n  relay traffic: ' + JSON.stringify(relay.counts.delivered) + '  (unitviz dropped: ' + relay.vizDropped + ')');
  say('  final matches row: ' + JSON.stringify(row));
  await clients.A.context.close(); await clients.B.context.close();
}

say('\n  ' + (fails ? '❌ ' + fails + ' FAILURE(S)' : '✅ all checks passed') + '  · ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
await browser.close();
server.close();
process.exit(fails ? 1 : 0);
