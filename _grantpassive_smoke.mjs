/* 🧬🔵 v121v114 — the "Grant Passive" effect type (a passive to this unit /
   your units / the units, fusions and archons called this turn, for N turns
   or for good) and the counter-name fixes behind "Spell counters is not
   working". Runs the helpers and the counter module for real.
   Run: node _grantpassive_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
const FX = readFileSync('./public/src/battle/effects.js', 'utf8').replace(/\r\n/g, '\n');

/* ── 1. the editor ── */
ok(/\{ id: 'grantPassive',\s+label: '🧬 Grant Passive \([^)]*\)', needs: \['grantPassive'\] \},/.test(SRC), 'the effect type, labelled "<icon> <Name> (<what it does>)" like the other 118');
ok(/ids: \['grantPassive','intimidate',/.test(SRC), 'filed under Buffs & Debuffs (an existing group — group labels are persisted data)');
ok(/'grantbox': \['grantPassive'\], 'gpassive': \['grantPassive'\], 'gtarget': \['grantPassive'\], 'gturns': \['grantPassive'\],\n\s*'ctrbox': \['counterName'\], 'ctrname': \['counterName'\],/.test(SRC), 'the gate knows the new knobs (they hide for every other effect)');
ok(/^function _fxExtraFieldsHtml\(prefix, eff\) \{/m.test(SRC), 'one field builder for every section');
for (const p of ['ed-onplay', 'ed-grave', 'ed-ongrave', 'ed-field', 'ed-hand', 'ed-kalon-onx']) ok(SRC.includes("_fxExtraFieldsHtml('" + p + "'"), 'rendered in ' + p);
for (const p of ['ed-onplay', 'ed-grave', 'ed-ongrave', 'ed-field', 'ed-hand']) ok(new RegExp("grantPassiveId: v\\('" + p + "-gpassive'\\) \\|\\| '', grantTarget: v\\('" + p + "-gtarget'\\) \\|\\| 'self', grantTurns: num\\('" + p + "-gturns', 0, 99, 1\\), counterName: \\(v\\('" + p + "-ctrname'\\) \\|\\| ''\\)\\.trim\\(\\),").test(SRC), 'saved from ' + p);
ok(/if \(t === 'grantPassive'\) \{ e\.grantPassiveId = v\('ed-kalon-onx-gpassive'\)/.test(SRC) && /e\.counterName = \(v\('ed-kalon-onx-ctrname'\) \|\| ''\)\.trim\(\);/.test(SRC), 'saved from the Kalon on-x chain');
ok(/needs: \['amount', 'radius', 'tSide', 'counterName'\] \},\n\s*\{ id: 'removeCounters'/.test(SRC), 'Add / Remove Counters take a counter name');

/* ── 2. the battle ── */
ok(/if \(eff\.type === 'grantPassive'\) \{\n\s*const pid = String\(eff\.grantPassiveId \|\| ''\)\.trim\(\);/.test(SRC), 'the resolver case');
ok(/App\._battleTurnGrants\.push\(\{ side: owner, passiveId: pid, scope, turns, eot \}\);/.test(SRC), '"called this turn" is remembered for units called later in the turn');
ok(/const startTurn = \(state, who\) => \{\n\s*\/\/ 🧬[^\n]*\n\s*try \{ state = \{ \.\.\.state, _idsAtTurnStart:/.test(SRC), 'startTurn stamps who was already on the board');
ok(/s = _expireEotGrants\(s, 'player'\); _clearTurnGrants\('player'\);/.test(SRC) && /s = _expireEotGrants\(s, 'ai'\); _clearTurnGrants\('ai'\);/.test(SRC), 'end of turn drops the "until end of turn" grants and the pending turn grants, both sides');
ok(/if \(!hasPassive\(unit, 'speed'\) && !_turnGrantGives\(unit, 'speed'\)\)/.test(SRC) && /if \(hasPassive\(newUnit, 'speed'\) \|\| _turnGrantGives\(newUnit, 'speed'\)\)/.test(SRC), 'a granted Speed clears summoning sickness on both deploy paths');
ok(/try \{ if \(unit && !unit\.isHero && typeof _applyTurnGrants === 'function'\) _applyTurnGrants\(unit\); \} catch \(e\) \{\}/.test(SRC), 'applyOnPlayEffect hands a pending grant to the unit just called');
ok(/if \(Array\.isArray\(unit\.statusEffects\) && unit\.statusEffects\.some\(\(e\) => e && e\.type === 'grantPassive' && e\.passiveId === id\)\) return true;/.test(SRC), 'hasPassive reads a grant like a printed passive');
ok(/tok = \(eff\.counterName && _ctrSlug\(eff\.counterName\)\) \? \{ id: _ctrSlug\(eff\.counterName\), name: String\(eff\.counterName\)\.trim\(\), icon: '🔵' \} : null;/.test(SRC), 'Add Counters places the NAMED pile');
ok(/const id = \(fc\.name \? _ctrSlug\(fc\.name\) : ''\) \|\| \(fc\.id \? _ctrSlug\(fc\.id\) : ''\) \|\| \(own && own\.id\) \|\| 'charge';/.test(SRC), 'the field-ability cost re-slugs its name every time');
ok(/const _slug = _ctrSlug\(_name\) \|\| 'charge';/.test(SRC) && /const id = name \? \(_ctrSlug\(name\) \|\| 'charge'\) : '';/.test(SRC), 'both editor save sites use the one slug');
ok(/t\.id = Counters\.slug\(t\.id\) \|\| Counters\.slug\(t\.name\) \|\| 'charge';/.test(FX) && /var id = \(tokenId && Counters\.slug\(tokenId\)\) \|\| \(tok && tok\.id\) \|\| DEFAULT_TOKEN\.id;/.test(FX), 'the counter module normalises ids the same way on read and on add');

/* ── 3. run the helpers for real ── */
{
  const block = SRC.slice(SRC.indexOf('/* ═══ 🧬 GRANT PASSIVE'), SRC.indexOf('// True if ANY living unit on `owner`\'s side'));
  const App = { _battleTurnGrants: [] };
  const api = new Function('App', block + '\nreturn { _grantPassiveTo, _calledThisTurn, _grantScopeMatch, _turnGrantGives, _applyTurnGrants, _clearTurnGrants, _expireEotGrants, _ctrSlug, hasPassive };')(App);
  ok(api._ctrSlug('Spell Counters') === 'spellcounter' && api._ctrSlug('spell counter') === 'spellcounter' && api._ctrSlug('SPELL-COUNTER') === 'spellcounter', '"Spell Counters", "spell counter" and "SPELL-COUNTER" are one pile');
  ok(api._ctrSlug('Boss') === 'boss' && api._ctrSlug('Glass') === 'glass' && api._ctrSlug('') === '', 'short names and -ss names keep their s; blank stays blank');
  const u = { id: 'u1', owner: 'player', alive: true, passives: ['taunt'], statusEffects: [] };
  ok(api._grantPassiveTo(u, 'speed', 0, false) && u.passives.includes('speed') && api.hasPassive(u, 'speed'), '0 turns: permanent — on unit.passives');
  const u2 = { id: 'u2', owner: 'player', alive: true, passives: [], statusEffects: [] };
  ok(api._grantPassiveTo(u2, 'speed', 1, true) && u2.statusEffects.length === 1 && u2.statusEffects[0].eot === true && api.hasPassive(u2, 'speed'), '1 turn: an eot status entry, and hasPassive sees it');
  const u3 = { id: 'u3', owner: 'player', alive: true, passives: [], statusEffects: [], _negatedTurns: 2 };
  api._grantPassiveTo(u3, 'speed', 1, true);
  ok(api.hasPassive(u3, 'speed') === false, '…but a field-negated unit still has nothing');
  const state = { _idsAtTurnStart: ['old1'], units: [
    { id: 'old1', owner: 'player', alive: true, passives: [], statusEffects: [] },
    { id: 'new1', owner: 'player', alive: true, passives: [], statusEffects: [] },
    { id: 'fus1', owner: 'player', alive: true, isFusion: true, passives: [], statusEffects: [] },
    { id: 'foe1', owner: 'ai', alive: true, passives: [], statusEffects: [] },
    { id: 'hero', owner: 'player', alive: true, isHero: true, passives: [], statusEffects: [] },
  ] };
  const pick = (scope) => state.units.filter((x) => api._grantScopeMatch(state, x, 'player', scope)).map((x) => x.id).join(',');
  ok(pick('calledThisTurn') === 'new1,fus1', 'called this turn = not on the board at turn start, never the hero', pick('calledThisTurn'));
  ok(pick('calledFusionsArchons') === 'fus1', 'fusions and archons called this turn', pick('calledFusionsArchons'));
  ok(pick('allies') === 'old1,new1,fus1,hero' && pick('enemies') === 'foe1' && pick('all').split(',').length === 5, 'allies / enemies / all');
  App._battleTurnGrants.push({ side: 'player', passiveId: 'speed', scope: 'calledThisTurn', turns: 1, eot: true });
  const later = { id: 'later', owner: 'player', alive: true, passives: [], statusEffects: [] };
  ok(api._turnGrantGives(later, 'speed') === true && api._turnGrantGives({ ...later, owner: 'ai' }, 'speed') === false, 'a unit called later this turn is owed the grant (the other side is not)');
  api._applyTurnGrants(later);
  ok(api.hasPassive(later, 'speed'), '…and receives it when it is called');
  const s2 = api._expireEotGrants({ units: [u2, later, u] }, 'player');
  ok(s2.units[0].statusEffects.length === 0 && s2.units[1].statusEffects.length === 0 && s2.units[2].passives.includes('speed'), 'end of turn: the eot grants fall away, the permanent one stays');
  api._clearTurnGrants('player');
  ok(App._battleTurnGrants.length === 0, '…and the pending turn grants are cleared');
}
/* the counter module for real */
{
  const ctx = { window: {}, console, Math, String, Array, Object, Number, JSON };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  try { vm.runInContext(FX, ctx); } catch (e) { console.log('  (effects.js boot: ' + e.message + ')'); }
  const MC = ctx.window.MythicCounters;
  ok(!!MC && typeof MC.slug === 'function', 'MythicCounters boots and exposes slug()');
  if (MC) {
    ok(MC.tokenOf({ counterToken: { name: 'Spell Counters', id: 'spellcounters' } }).id === 'spellcounter', 'a token saved as "Spell Counters" reads as the spellcounter pile');
    const st = { units: [] }; const holder = { id: 'x1', counterToken: { name: 'Spell Counter' } };
    MC.add(st, holder, 2, 'spellcounters');
    ok(MC.get(st, holder, 'spellcounter') === 2, 'adding under the plural id lands in the singular pile');
    ok(MC.pay ? MC.pay(st, 'player', 'spellcounter', 0) !== undefined : true, 'pay() is callable');
  }
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 114, 'BUILD_VERSION is v121v114 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(readFileSync('./public/node-city/index.html', 'utf8')), 'NC_BUILD carries the build');
ok(new RegExp('src/battle/effects\\.js\\?v=' + v).test(SRC), 'the effects module buster moved');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
