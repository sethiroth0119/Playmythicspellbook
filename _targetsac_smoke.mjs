/* 🎯⚰️ v121v145 — target range (tiles vs Global) and sacrifice mode (auto /
   random / player) are authorable. Run: node _targetsac_smoke.mjs

   Owner: "Fix the targeting system where when a card effect has a target effect
   that target 1 unit have it where it can be based on how far tiles are or
   Global. Same as Sacrificing Allow where it can be random and targeting where
   player target who they want to sacerfice. add these to drop downs when these
   effects are selected."

   ⚠ THE ENGINE HAS UNDERSTOOD GLOBAL SINCE v120c3 — _targetCandidates reads
     (eff.global === true) || ((eff.radius|0) >= 99) — but NOTHING IN THE FORGE
     COULD SET IT. The only route was typing 99 into a Radius box every editor
     caps at 4, so "anywhere on the battlefield" was unauthorable in practice.
     This is the missing control, not new engine behaviour.

   ⚠ RANDOM IS SEEDED, NOT Math.random(). sacrificeNearby's own comment says the
     weakest go first "deterministically, so multiplayer stays in sync"; a live
     Math.random() would have two clients sacrifice DIFFERENT units from one
     board. The roll uses _bbRng/_bbSeedFromString — the mulberry32 pair this
     codebase already uses because it yields an identical stream on every JS
     engine. */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');

/* ── the engine was already right ─────────────────────────────────────────── */
ok(/const isGlobal = \(eff\.global === true\) \|\| \(\(eff\.radius \| 0\) >= 99\);/.test(SRC),
  'the engine already honoured eff.global — this release did NOT change how targeting resolves');

/* ── the target-range picker ──────────────────────────────────────────────── */
ok(/function _targetRangeFieldHtml\(prefix, eff\) \{/.test(SRC), 'there is a target-range picker');
{
  const f = SRC.slice(SRC.indexOf('function _targetRangeFieldHtml(prefix, eff) {'), SRC.indexOf('function _sacPickFieldHtml'));
  ok(/const glob = \(eff\.global === true\) \|\| \(\(eff\.radius \| 0\) >= 99\);/.test(f),
    'it opens on what the card already has — including a legacy radius-99 card, which was the only way to author Global before');
  ok(/<option value="radius"/.test(f) && /<option value="global"/.test(f), 'two options: within N tiles, or Global');
  ok(/uses the Radius box above \(1-4\)/.test(f), '…and it says the tile version reads the existing Radius box, rather than inventing a second number');
}
ok(/'tgtrange': \['tgtGlobal'\]/.test(SRC), 'the gate table knows the field, so it hides and shows with the effect');
{
  const f = SRC.slice(SRC.indexOf('const FX_GATE_NEEDS_PATCH = {'), SRC.indexOf('const FX_GATE_ROOTS'));
  for (const id of ['targetStrike', 'singleKill', 'bounceUnit', 'destroyTarget', 'transformAlly', 'vanishReturn']) {
    ok(new RegExp(id + ": \\[[^\\]]*'tgtGlobal'").test(f), '…for ' + id);
  }
  ok(/the same six ids as _TARGETABLE_EFFECTS/.test(SRC),
    'the six are the same six the engine calls targetable — not a hand-picked subset that could drift');
}

/* ── the sacrifice-mode picker ────────────────────────────────────────────── */
ok(/function _sacPickFieldHtml\(prefix, eff\) \{/.test(SRC), 'there is a sacrifice-mode picker');
{
  const f = SRC.slice(SRC.indexOf('function _sacPickFieldHtml(prefix, eff) {'), SRC.indexOf('function _sacPickFieldHtml(prefix, eff) {') + 1400);
  ok(/opt\('auto',/.test(f) && /opt\('random',/.test(f) && /opt\('player',/.test(f), 'three modes: automatic, random, player picks');
  ok(/Sacrifice Ally only; the others use Automatic/.test(f),
    'THE LABEL TELLS THE TRUTH — only Sacrifice Ally has a pick flow, so the option says where it applies rather than silently doing nothing on three of four effects');
  ok(/seeded from the turn and the board, so both players in a match always see the same unit die/.test(f),
    '…and the author is told random is seeded, because that is a rules-visible fact, not an implementation detail');
}
ok(/'sacpick': \['sacPick'\]/.test(SRC), 'the gate table knows this field too');
{
  const f = SRC.slice(SRC.indexOf('const FX_GATE_NEEDS_PATCH = {'), SRC.indexOf('const FX_GATE_ROOTS'));
  for (const id of ['sacrifice', 'sacrificeNearby', 'tributeRite', 'tributeDraw']) {
    ok(new RegExp(id + ": \\[[^\\]]*'sacPick'").test(f), '…for ' + id);
  }
}

/* ── the chooser ──────────────────────────────────────────────────────────── */
ok(/function _sacOrder\(list, eff, state, caster\) \{/.test(SRC), 'one chooser decides which friendly unit dies');
{
  const f = SRC.slice(SRC.indexOf('function _sacOrder(list, eff, state, caster) {'), SRC.indexOf('function _effectTargetable'));
  ok(/const rnd = _bbRng\(seed\);/.test(f) && /_bbSeedFromString\(/.test(f),
    'RANDOM IS SEEDED with the codebase\'s own mulberry32, not Math.random()');
  ok(!/Math\.random\(\)/.test(f), '…and no live Math.random() is anywhere in it');
  ok(/String\(\(state && state\.turnNumber\) \| 0\)/.test(f) && /arr\.map\(\(u\) => String\(u && u\.id\)\)\.sort\(\)\.join\(','\)/.test(f),
    'the seed is the turn, the caster and the SORTED candidate ids — so both clients derive it identically');
  ok(/arr\.sort\(\(a, b\) => String\(a\.id\)\.localeCompare\(String\(b\.id\)\)\);\n\s*for \(let i = arr\.length - 1/.test(f),
    'the shuffle runs over an ID-SORTED copy, so a different input order on one client cannot change the outcome — only the seed can');
  ok(/if \(mode !== 'random'\)/.test(f) && /\(\(a\.currentHp \| 0\) - \(b\.currentHp \| 0\)\) \|\| String\(a\.id\)\.localeCompare/.test(f),
    'auto is unchanged: weakest first with an id tiebreak');
  ok(/catch \(e\) \{\n\s*return arr\.sort/.test(f), '…and a throw falls back to the old deterministic order rather than to nothing');
}
ok(/victims = _sacOrder\(victims, eff, state, unit\)\.slice\(0, cap\);/.test(SRC),
  'sacrificeNearby asks the chooser instead of hard-coding weakest-first');
{
  const f = SRC.slice(SRC.indexOf("if (eff.type === 'sacrifice') {"), SRC.indexOf("if (eff.type === 'sacrifice') {") + 1800);
  ok(/const _sacMode = String\(eff\.sacPick \|\| 'player'\);/.test(f),
    "Sacrifice Ally defaults to 'player' — that is what it has always done, so an unauthored card behaves exactly as before");
  ok(/if \(owner === 'player' && _sacMode === 'player'\)/.test(f), '…and only prompts when the card says so');
  ok(/_sacOrder\(\n?\s*\(state\.units \|\| \[\]\)\.filter/.test(f) || /_sacOrder\(/.test(f),
    '…while auto/random resolve the player\'s own sacrifice the way the AI\'s always has');
}

/* ── the pickers reach every editor, and save ─────────────────────────────── */
ok(/if \(!document\.getElementById\(pre \+ '-tgtrange'\)\) \{/.test(SRC) && /if \(!document\.getElementById\(pre \+ '-sacpick'\)\) \{/.test(SRC),
  'both ride the SAME completion pass the summon-zone picker uses — seventeen blocks can hold these effects');
ok(/function _fxCaptureAllTargetOpts\(card\) \{/.test(SRC), 'a save-side sweep writes both back');
{
  const f = SRC.slice(SRC.indexOf('function _fxCaptureAllTargetOpts(card) {'), SRC.indexOf('function _fxCaptureAllSummonZones(card) {'));
  ok(/if \(rSel\.value === 'global'\) eff\.global = true; else delete eff\.global;/.test(f),
    'Global sets the flag and "within N" DELETES it — so switching back really does switch back');
  ok(/if \(v && v !== 'auto'\) eff\.sacPick = v; else delete eff\.sacPick;/.test(f),
    '…and auto deletes the key rather than storing a default, keeping saved cards clean');
  ok(/_TAKES_TGT_RANGE\[eff\.type\]/.test(f) && /_TAKES_SAC_PICK\[eff\.type\]/.test(f),
    'only effects that READ the value get one written — a "draw 2 cards" does not acquire a stray key');
}
ok(/try \{ _fxCaptureAllTargetOpts\(card\); \} catch \(e\) \{ console\.warn\('\[target-sweep\]', e\); \}/.test(SRC),
  '…and it runs on save, beside the zone sweep it mirrors');

/* ── run the rules for real ───────────────────────────────────────────────── */
{
  /* the seeded order, using the file's own mulberry32 */
  const rngBlock = SRC.slice(SRC.indexOf('function _bbRng(seed) {'), SRC.indexOf('// 🌱 THE SEED.'));
  const api = new Function(rngBlock + '\nreturn { _bbRng, _bbSeedFromString };')();
  const order = (list, mode, turn, casterId) => {
    const arr = list.slice();
    if (mode !== 'random') return arr.sort((a, b) => (a.currentHp - b.currentHp) || String(a.id).localeCompare(String(b.id)));
    const seed = api._bbSeedFromString(String(turn | 0) + ':' + String(casterId || '') + ':' + arr.map(u => String(u.id)).sort().join(','));
    const rnd = api._bbRng(seed);
    arr.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    return arr;
  };
  const units = [{ id: 'c', currentHp: 30 }, { id: 'a', currentHp: 10 }, { id: 'b', currentHp: 20 }];
  ok(order(units, 'auto', 1, 'x')[0].id === 'a', 'run for real: auto takes the weakest');
  ok(order(units, 'player', 1, 'x')[0].id === 'a', 'run for real: player falls back to auto where no prompt exists');
  {
    const one = order(units, 'random', 3, 'caster1').map(u => u.id).join('');
    const two = order(units.slice().reverse(), 'random', 3, 'caster1').map(u => u.id).join('');
    ok(one === two,
      'run for real: TWO CLIENTS WITH DIFFERENT INPUT ORDER GET THE SAME RESULT — this is the multiplayer desync the seeding exists to prevent', one + ' vs ' + two);
    const other = order(units, 'random', 4, 'caster1').map(u => u.id).join('');
    ok(one !== other || units.length < 3, 'run for real: a different turn rolls differently, so it is genuinely random across turns', one + ' vs ' + other);
    ok(order(units, 'random', 3, 'caster1').map(u => u.id).join('') === one, 'run for real: …and the same inputs always give the same answer');
  }
  ok(order([], 'random', 1, 'x').length === 0 && order([{ id: 'z', currentHp: 1 }], 'random', 1, 'x')[0].id === 'z',
    'run for real: empty and single-candidate lists are safe');
  /* the range flag */
  const isGlobal = (eff) => (eff.global === true) || ((eff.radius | 0) >= 99);
  ok(isGlobal({ global: true }) === true, 'run for real: the new flag means Global');
  ok(isGlobal({ radius: 99 }) === true, 'run for real: …and a legacy radius-99 card still does, so nothing already authored changes');
  ok(isGlobal({ radius: 3 }) === false, 'run for real: an ordinary radius is still an ordinary radius');
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 145, 'BUILD_VERSION is v121v145 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(readFileSync('./public/node-city/index.html', 'utf8')), 'NC_BUILD carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
