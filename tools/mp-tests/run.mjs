#!/usr/bin/env node
/* 🔀 MULTIPLAYER GATE — run from the repo root:  node tools/mp-tests/run.mjs
   ---------------------------------------------------------------------------
   Every test file MUST be listed in TESTS below. This project has twice
   written a test, reported it green across multiple rounds, and never run it:
   fuelarb.mjs and then repairtrap.mjs (41 KB) both sat unreferenced in the
   economy runner's list. A file that is not in the array is not a gate.

   This runner also does something the economy gauntlet learned the hard way:
   it PROVES each check can fail. After the real run passes, it rebuilds
   index.html in a temp directory with ONE fix surgically reverted and requires
   the suite to go RED. A green result only means something if red is reachable
   — the first multiplayer load test passed while comparing nothing at all.
   The shipped tree is never written to; every mutation lands in a temp copy. */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, cpSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const INDEX = join(ROOT, 'public', 'index.html');

const TESTS = ['perspective.mjs', 'private-zones.mjs', 'citytrade.mjs', 'trade-modal.mjs', 'move-merge.mjs', 'node-daycap.mjs', 'builtins.mjs', 'warpath-gate.mjs', 'storage.mjs', 'overlays.mjs', 'heroart.mjs', 'wxshield.mjs', 'zones.mjs', 'delta-roundtrip.mjs', 'twoclient.mjs', 'delta-e2e.mjs'];

/* SLOW tests boot a real browser (Playwright, two contexts, the whole 14 MB
   page) and cost ~20s each. The REAL pass runs them like everything else — a
   file that is not gated is not a gate. The falsifiability sweep does not:
   re-running a browser test for all ~25 mutations would add ten minutes to
   prove nothing about the 24 of them it does not cover. A mutation that WANTS
   a slow test names it in `test`, and then only that test runs. */
const SLOW = ['twoclient.mjs', 'delta-e2e.mjs'];

/* Mutations may target a file OTHER than index.html — /src/citytrade/plan.js is
   a real ES module, not an extracted function, so its proof works by swapping
   the module itself. `file` is repo-relative and defaults to public/index.html.
   The copy is written to a mirror path under the temp dir so a module's own
   relative imports still resolve. */
const DEFAULT_TARGET = 'public/index.html';

/* Each entry reverts ONE shipped fix by substring surgery, and names the bug it
   reintroduces. `find` must match exactly once — if index.html is edited such
   that it matches zero or many times, that is reported as a broken proof rather
   than silently skipped, because a mutation that does not apply proves nothing. */
const MUTATIONS = [
  {
    name: 'sealedTiles / smokedTiles / delayedBlasts stop mirroring',
    find: "for (const _k of ['sealedTiles', 'smokedTiles', 'delayedBlasts']) {",
    replace: "for (const _k of []) {",
  },
  {
    name: 'delayedBlasts owner stops swapping',
    find: '? state.delayedBlasts.map(b => (b && b.owner) ? { ...b, owner: swapOwner(b.owner) } : b)',
    replace: '? state.delayedBlasts',
  },
  {
    /* Reverting this one needs care. The obvious edit — weakening the ternary
       TEST to `state._lastPlayerCounterCard && state._lastAiCounterCard` — is a
       no-op: both are truthy in the fixture, so the same branch is taken and
       the suite stayed green. That looked like an unfalsifiable check and was
       really just a mutation that did not mutate. Break the CONSEQUENT instead,
       so the field keeps the sender's own stash and never exchanges. */
    name: 'the counter-card pair stops exchanging',
    find: '{ ...state._lastAiCounterCard, owner: swapOwner(state._lastAiCounterCard.owner || \'ai\') }',
    replace: 'state._lastPlayerCounterCard',
  },
  {
    name: 'private-zone removals stop being applied (liveness)',
    find: '    if (ix < 0) continue;   // already gone (resync replay, or we never had it)',
    replace: '    if (ix < 0 || true) continue;',
  },
  {
    name: 'the op ledger stops deduping (a resync would remove a second card)',
    find: '    seen[op.id] = 1;\n    const zone =',
    replace: '    const zone =',
  },
  {
    name: 'a cross-side write loses its removal op (millEnemy)',
    find: "      for (const _mc of milled) _mpNotePrivateRemoval(state, _mc, 'deck', 'graveyard');",
    replace: '',
  },
  {
    /* The property-losing shape: shipping 40 of 100 because that is all there
       was. Turn the refusal into a partial and the suite must go red.

       ⚠ A PROOF CAN PASS FOR THE WRONG REASON, and this one did. The first
         version replaced the `return` with `left = need;`, which is a TDZ error
         (`left` is declared below it) — so the module threw ReferenceError, the
         run went red, and the mutation was scored "proven" while demonstrating
         nothing about whether the test can SEE a part-delivery. A mutation that
         crashes the code under test proves only that the test executes it.
         Neutering the CONDITION instead lets the function run to completion and
         return a genuine partial, which is the thing the assertion is for.
         Check that a red mutation is red for the reason you intended. */
    name: 'planDraw part-delivers instead of refusing',
    file: 'public/src/citytrade/plan.js',
    find: '  if (available < need) {',
    replace: '  if (false) {',
  },
  {
    /* Make the cycle index depend on what has been settled rather than on the
       clock, which is how two offline clients start disagreeing about which
       cycle is which and the unique constraint stops guarding anything. */
    name: 'cycle count stops being a function of the clock',
    file: 'public/src/citytrade/plan.js',
    find: '  const fired = Math.min(total, Math.floor(elapsed / periodMs));',
    replace: '  const fired = Math.min(total, (settled || []).length + 1);',
  },
  {
    /* Put the ORIGINAL bug back: decide the moveset by length alone. A swap at
       the move cap does not change the length, so the local choice loses and
       the cloud's pre-swap list returns — the "my new move didn't save" report.
       If this does not redden, the gate is not testing the thing it exists for. */
    name: 'the moveset merge goes back to picking by length',
    find: '    if (la || ra) takeLocal = la > ra;                       // 1 + 2',
    replace: '    if (false) takeLocal = false;',
  },
  {
    /* Skip the art store. This is the branch that fixed the unicorns: without
       it a forged hero falls back to inline fields it does not carry, and the
       glyph is all that is left. */
    name: 'hero art stops consulting getCardArt',
    find: "    if (id && typeof getCardArt === 'function') {",
    replace: '    if (false) {',
  },
  {
    /* Unhook the Mansions research node from its zone. A grade that exists in
       zones.js and is unlocked by nothing is a zone the player can never
       reach, and it looks perfectly correct in its own file. */
    name: 'two research nodes collide on one grid slot',
    file: 'public/src/progression/tree.js',
    test: 'zones.mjs',
    find: "{ id: 'res_condo', cat: 'res', row: 2, col: 3",
    replace: "{ id: 'res_condo', cat: 'res', row: 2, col: 2",
  },
  {
    /* Remove the fire shield from the ember path. A protective building that
       is researched, built, staffed and does NOTHING is worse than absent —
       the player pays for it and never learns it is not wired. */
    name: 'fire rain stops respecting fire cover',
    file: 'public/node-city/index.html',
    test: 'wxshield.mjs',
    find: "        if (!_wxShield('fire')) damageTile(k, !!t.damaged && Math.random() < .5, '☄️ Fire rain');",
    replace: "        damageTile(k, !!t.damaged && Math.random() < .5, '☄️ Fire rain');",
  },
  {
    /* Let a damaged protector still protect. A fire station burned down by the
       first ember must stop answering the second, or a long front is free. */
    name: 'a damaged protector still protects',
    file: 'public/node-city/index.html',
    test: 'wxshield.mjs',
    find: "      if (t && t.type === S.b && !t.damaged) n += Math.max(1, t.lvl | 0);",
    replace: "      if (t && t.type === S.b) n += Math.max(1, t.lvl | 0);",
  },
  {
    /* Put the gate back to drawing the hero's emoji glyph. Six forged custom
       heroes all carry 🦄, so the picker showed six identical unicorns. */
    name: 'the warpath gate goes back to emoji glyphs',
    find: "_heroArtSrc === 'function') ? _heroArtSrc(h) : ''",
    replace: "_heroArtSrc === 'function') ? '' : ''",
  },
  {
    /* Eat one backslash out of the extension test — /\.(png…)/ becomes
       /.(png…)/, which still PARSES and still matches real images, so every
       existing check stays green while non-images start resolving as art.
       This is the mutation that matters: the syntax-error version of the same
       slip was caught instantly, and this one would not have been. */
    name: 'the image-extension regex loses its escape',
    find: '/\\.(png|jpe?g|webp|gif|avif|svg)(\\?|#|$)/i.test(a)',
    replace: '/.(png|jpe?g|webp|gif|avif|svg)(\\?|#|$)/i.test(a)',
  },
  {
    /* Put one pill back on a hardcoded right offset — the exact shape of the
       reported overlap. "Buy storage from player" is 244px wide and this offset
       leaves it 210px, so it runs 34px into its neighbour. It looks like a
       perfectly ordinary style string in a diff, which is why it needs a gate. */
    name: 'a city pill goes back to a hardcoded right offset',
    find: "    wh.style.cssText = 'order:2;flex:none;white-space:nowrap;pointer-events:auto;padding:8px 16px;border-radius:999px;cursor:pointer;'",
    replace: "    wh.style.cssText = 'position:fixed;top:12px;right:168px;z-index:2147483301;padding:8px 16px;border-radius:999px;cursor:pointer;'",
  },
  {
    /* Put the paint order back the way it shipped: the JB iframe above the
       sub-apps it opens. This is the real bug — the bench drew underneath a
       full-screen iframe and looked like a dead button, and clicking any other
       business revealed it. Nothing but a stacking check can see it. */
    name: 'the JB iframe covers the sub-apps it opens',
    find: 'border:0;z-index:2147483300;background:#0b0b10;opacity:0;transform:scale(.986)',
    replace: 'border:0;z-index:2147483999;background:#0b0b10;opacity:0;transform:scale(.986)',
  },
  {
    /* Drop the iframe's cache-buster. sw.js is cache-first for sub-resources,
       so without it a returning player keeps the old corp/index.html and never
       sees a new sidebar entry no matter how the .jsx tags inside are bumped. */
    name: 'the JB iframe URL loses its cache-buster',
    /* Version-agnostic: this anchor broke once already when the corp URL was
       bumped, and a PROOF BROKEN is a check that silently stops guarding. The
       runner requires exactly one match, and only one line assigns f.src.

       ⚠ AND IT BROKE A SECOND TIME, exactly as predicted — the literal above
       still read 'v121a7' while the corp URL had moved to 'v121e0' at release
       a77df80441, so this check sat UNPROVEN and the whole MP gate exited 1
       declaring itself unsound. A comment saying "version-agnostic" over a
       hardcoded version string is not version-agnostic. So it is a RegExp now,
       which is what the comment always meant: `find` is only ever fed to
       String.split and String.replace, and both take a RegExp natively, so this
       needs no runner change. Do NOT put a /g flag on it — replace() would then
       rewrite every match and the "exactly one" contract above is what keeps
       this honest.

       …AND `[0-9a-z]+` WAS STILL NOT VERSION-AGNOSTIC — it is only agnostic
       about the versions that happen to be alphanumeric. This repo already
       ships hyphenated and mixed build strings (BB_VER = 'v121e3-hex', the
       battle assets on '?v=121e3hex'), so the day the corp URL adopts that
       spelling this anchor breaks a THIRD time, in the same way, for the same
       reason. `[^']+` cannot: it is bounded by the closing quote that the
       pattern already anchors on, so it matches the whole version and nothing
       past it, whatever characters the version is made of. */
    find: /f\.src = 'corp\/\?v=[^']+';/,
    replace: "f.src = 'corp/';",
  },
  {
    /* One warehouse arriving from both Operations.list and the local JB list is
       ONE warehouse. Drop the dedupe and a player's ceiling silently doubles —
       invisible, because a ceiling is just a number. */
    name: 'a duplicated warehouse op is counted twice',
    file: 'public/src/storage/index.js',
    test: 'storage.mjs',
    find: "      if (!o || o.op_type !== 'warehouse' || seen[o.id]) continue;",
    replace: "      if (!o || o.op_type !== 'warehouse') continue;",
  },
  {
    /* A negative worker count must not subtract from the ceiling. */
    name: 'negative workers subtract from capacity',
    file: 'public/src/storage/index.js',
    test: 'storage.mjs',
    find: '    return (e.storageBase | 0) + Math.max(0, op.workers | 0) * (e.storagePerWorker | 0);',
    replace: '    return (e.storageBase | 0) + (op.workers | 0) * (e.storagePerWorker | 0);',
  },
  {
    /* Open the admin-only phase to everyone. Warpath ships before its migration
       is applied, so a player let in reaches a mode whose database does not
       exist — this gate is the only thing standing between them and that. */
    name: 'the warpath kill switch stops disabling the mode',
    find: '  if (!warpathVisible()) return false;',
    replace: '  if (false) return false;',
  },
  {
    /* Lift the seal. WARPATH_MODE_OPEN is the ONE constant that makes the mode
       visible-and-dead-for-everyone — a state neither shipped flag could
       express, because WARPATH_ADMIN_ONLY = true still lets the admin in and
       'hg_warpath' hides the entry instead of greying it. Flip it and the
       whole mode reopens for every signed-in player at once, so the gate has
       to notice. The substituted cases in warpath-gate.mjs deliberately do NOT
       cover this: they rewrite the constant, so they would stay green. */
    name: 'the warpath seal is lifted (WARPATH_MODE_OPEN back to true)',
    find: 'const WARPATH_MODE_OPEN = false;',
    replace: 'const WARPATH_MODE_OPEN = true;',
  },
  {
    /* Take the refusal off the MOUNT. openWarpathGate() would still refuse,
       but _warpathOpen is exposed as window.__mg.warpath.open and is called
       unconditionally at the tail of warpathAfterBattle() — so without this
       line a sealed mode is one console call (or one finished battle) away
       from mounting anyway. A gate with a second unlocked door is not a gate. */
    name: 'the warpath mount loses its refusal (__mg.warpath.open reopens it)',
    find: 'function _warpathOpen() {\n  if (!warpathEnabled()) return;\n',
    replace: 'function _warpathOpen() {\n',
  },
  {
    /* Put the extraction drain back on warpathEnabled(). That is the version
       that freezes owed warpath_grants the moment the mode is sealed — the
       player earned the cards, the server already wrote them to the outbox,
       and nothing would ever collect them. Silent, and it would never be
       reported as a Warpath bug because the mode is visibly switched off. */
    name: 'the extraction drain is frozen by the seal again',
    find: '  if (!warpathDrainEnabled()) return;',
    replace: '  if (!warpathEnabled()) return;',
  },
  {
    /* Grey-but-clickable is worse than either state on its own: it LOOKS
       unavailable and still opens. The CSS is not the enforcement. */
    name: 'a locked hub tile becomes clickable again',
    find: "      if (sec.locked && sec.locked()) { try { showToast(sec.lockMsg || '🔒 Not available yet.', 3200); } catch (e2) {} return; }\n      nav(sec.go);",
    replace: '      nav(sec.go);',
  },
  {
    /* The root cause of the placeholder cards on the camp Table: the admin
       grant stuffed every built-in pool into Profile.cardCollection, and the
       Table reads that collection directly. Ungate it and the grant returns. */
    name: 'the admin grant stops honouring the built-in flag',
    find: '      if (!_hideBuiltins()) {',
    replace: '      if (true) {',
  },
  {
    /* And the surface itself. Without this line the Table lists any built-in
       an older save already owns, which is precisely the reported bug. */
    name: 'the camp Table stops skipping built-in ids',
    find: '        if (_isBuiltinCardId(id)) continue;      // placeholders get no seat at the Table',
    replace: '',
  },
  {
    /* Put back the fail-closed reading of an absent tier: rate 0 → cap 0 rather
       than "no cap". That is the bug I nearly shipped — one guarded module
       404ing would have clamped every PRN payout to nothing. The suite must go
       red on it, or the gate is not guarding the direction that locks players
       out of their own money. */
    name: 'an absent tier means a ZERO daily cap instead of none',
    find: '    if (!isFinite(rate) || rate <= 0) return Infinity;',
    replace: '    if (!isFinite(rate) || rate <= 0) return 0;',
  },
  {
    /* 🔴 THE ORIGINAL SHAPE OF THE DELTA BUG: the decoder patches a list of keys
       that is maintained SEPARATELY from the one the encoder diffs, so a key can
       be added to one side only. That is exactly how `_atkFx` came to be
       computed, serialized, shipped and then dropped on arrival, and how board /
       controlPoints / cpScore / graveLock / enchantments / delayedBlasts /
       _counterChain / _lastMove / _mpPrivateRemovals / equipment / _bleeding /
       walkPath came to be on neither side. This mutation reintroduces it in the
       smallest possible way — ONE key stops being applied — and the round-trip
       gate has to notice, because a decoder that drops one key drops it on every
       packet for the rest of the match and nothing anywhere reports an error. */
    name: 'the delta decoder stops applying one key (cpScore)',
    find: '    if (STRUCTURAL[k] || RESERVED[k]) continue;',
    replace: "    if (STRUCTURAL[k] || RESERVED[k] || k === 'cpScore') continue;",
  },
  {
    /* The decoder half of the board carrier. Surfaces, walls and traps all live
       in board[y][x]; before the fix the board was in NEITHER function and a
       turn that lit a fire handed over a board that was never lit. */
    name: 'the delta decoder stops applying board tiles',
    find: '  if (Array.isArray(delta.boardChanges) && Array.isArray(baseline.board)) {',
    replace: '  if (false) {',
  },
  {
    /* And the ENCODER half, which fails differently and must also be caught:
       the receiver is willing to patch tiles and is simply never told about
       any. A gate that only covers the decoder would call this green.

       ⚠ THIS ONE IS AIMED AT THE BROWSER GATE, and that is the point. The two
         mutations above are caught by delta-roundtrip.mjs, which feeds the
         extracted codec a fixture; this one has to be caught END TO END, by two
         real clients on a relayed transport, or delta-e2e.mjs is an unproven
         entry in TESTS — and an unproven gate is the failure mode this runner
         exists to prevent. `test` keeps the sweep to that one file, which boots
         a browser (see SLOW). */
    name: 'the delta encoder stops diffing the board',
    test: 'delta-e2e.mjs',
    find: '    if (tiles.length) delta.boardChanges = tiles;',
    replace: '',
  },
  {
    /* Put back the bug the line's own comment describes: without the bump,
       "turnNumber stays 1 forever and the snapshot out-of-order dedup
       (`payload.turn < lastSeenTurn`) is non-functional — a late/reordered
       stale packet would overwrite newer state and desync the board."

       ⚠ ONLY THE TWO-CLIENT GATE CAN SEE THIS. It is not in
         swapBattlePerspective, so perspective.mjs cannot reach it; and one
         client talking to a stub has nothing to disagree with. It needs a
         second client AND a server model to compare against, which is the
         whole reason twoclient.mjs exists. `test` keeps the sweep to that one
         file — it boots a browser (see SLOW). */
    name: 'the MP end-turn stops bumping turnNumber',
    test: 'twoclient.mjs',
    find: "App.state = { ...App.state, currentTurn: 'ai', turnNumber: _prevTurnNumber + 1 };",
    replace: "App.state = { ...App.state, currentTurn: 'ai' };",
  },
];

const runSuite = (srcOverride, cwdOverride, only) => {
  let worst = 0;
  const out = [];
  for (const t of (only ? [only] : TESTS.filter(t => !srcOverride || !SLOW.includes(t)))) {
    const r = spawnSync(process.execPath, [join(HERE, t)], {
      // A module mutation runs the suite against a MIRRORED tree, so the tests'
      // own `../../public/src/...` imports resolve to the mutated copy.
      cwd: cwdOverride || ROOT,
      encoding: 'utf8',
      env: srcOverride ? { ...process.env, MP_SRC: srcOverride } : process.env,
    });
    out.push((r.stdout || '') + (r.stderr || ''));
    if (r.status !== 0) worst = r.status || 1;
  }
  return { status: worst, output: out.join('\n') };
};

// ── 1. The real run ────────────────────────────────────────────────────────
console.log('\n══ MULTIPLAYER GATE ══  ' + TESTS.length + ' test file(s): ' + TESTS.join(', '));
const real = runSuite(null);
process.stdout.write(real.output);
if (real.status !== 0) {
  console.log('❌ MP GATE FAILED — see the findings above.\n');
  process.exit(real.status);
}

// ── 2. Prove each check can fail ───────────────────────────────────────────
console.log('── falsifiability: reverting each fix in a temp copy, expecting RED ──\n');
/* Normalised to LF. A merge or a fresh checkout can hand this file CRLF — that
   happened on the city-builder merge and silently broke the one multi-line
   anchor below, reporting a real check as UNPROVEN. The anchors are written with
   \n, so the input has to be. */
const html = readFileSync(INDEX, 'utf8').replace(/\r\n/g, '\n');
const tmp = mkdtempSync(join(tmpdir(), 'mp-gate-'));
let broken = 0;
try {
  for (const m of MUTATIONS) {
    const target = m.file || DEFAULT_TARGET;
    const source = target === DEFAULT_TARGET
      ? html
      : readFileSync(join(ROOT, target), 'utf8').replace(/\r\n/g, '\n');
    const hits = source.split(m.find).length - 1;
    if (hits !== 1) {
      console.log('  ⚠ PROOF BROKEN  "' + m.name + '" — anchor matched ' + hits + ' times in ' + target + ', expected exactly 1.');
      console.log('                  The mutation did not apply, so this check is UNPROVEN.');
      broken++;
      continue;
    }
    const mutated = source.replace(m.find, m.replace);
    let r;
    if (target === DEFAULT_TARGET) {
      // index.html is reached through MP_SRC, so a bare copy is enough.
      const copy = join(tmp, 'index.html');
      writeFileSync(copy, mutated);
      /* `test` narrows the sweep to ONE file. Required for a SLOW test (see the
         SLOW note above) and harmless for the rest — no existing index.html
         mutation declares it, so they all still run the whole suite. */
      r = runSuite(copy, null, m.test);
    } else {
      /* A MODULE is imported by relative path, so it has to be mutated inside a
         MIRROR of the tree — never in place. Editing the shipped file and
         restoring afterwards is the shape that has already bitten this repo
         once (deploy.mjs minifying index.html in place, where an interrupted
         run left a 9 MB tree). A mirror cannot leave wreckage behind. */
      const mirror = mkdtempSync(join(tmpdir(), 'mp-mut-'));
      try {
        cpSync(HERE, join(mirror, 'tools', 'mp-tests'), { recursive: true });
        const dest = join(mirror, target);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, mutated);
        r = spawnSync(process.execPath, [join(mirror, 'tools', 'mp-tests', m.test || 'citytrade.mjs')],
          { cwd: mirror, encoding: 'utf8' });
        r = { status: r.status || 0, output: (r.stdout || '') + (r.stderr || '') };
      } finally {
        rmSync(mirror, { recursive: true, force: true });
      }
    }
    if (r.status === 0) {
      console.log('  ❌ NOT PROVEN   "' + m.name + '" — suite still passed with the fix reverted.');
      broken++;
    } else {
      const n = (r.output.match(/❌/g) || []).length;
      console.log('  ✅ proven       "' + m.name + '" → ' + n + ' finding(s)');
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log('');
if (broken) {
  console.log('❌ MP GATE UNSOUND — ' + broken + ' check(s) cannot be shown to fail. A green run means nothing.\n');
  process.exit(1);
}
console.log('✅ MP GATE PASSED — and every check was shown to fail when its fix is removed.\n');
process.exit(0);
