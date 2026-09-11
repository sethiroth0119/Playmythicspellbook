#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scaffold.mjs — print a ready-to-paste skeleton for a new MOVE, STATUS, PASSIVE
// or ON-PLAY EFFECT, with the exact insertion anchors in public/index.html and
// the checklist of everything else that entry must touch to be "real".
//
//   node tools/gamedev/scaffold.mjs move   tidalLash  --element water --kind attack --type magic --power 30
//   node tools/gamedev/scaffold.mjs status armorBreak --stat def --mod -50pct
//   node tools/gamedev/scaffold.mjs passive bulwark   --cat defense
//   node tools/gamedev/scaffold.mjs effect  shatterWalls --needs radius,amount --group "🧹 Board Control"
//
// It prints; it never edits index.html. The 11 MB file is edited by a human or
// the game-dev agent with the anchors below, then verified with check.mjs.
// The skeletons are derived from the LIVE schema (catalog.mjs --schema), so the
// field names track what the resolver actually reads.
// ─────────────────────────────────────────────────────────────────────────────
import { loadEngine, argValue, positional } from './headless.mjs';

const eng = loadEngine();
const [kind, id] = positional(['element', 'kind', 'type', 'power', 'range', 'cost', 'stat', 'mod', 'cat', 'needs', 'group', 'status', 'label']);
if (!kind || !id) { console.error('usage: scaffold.mjs move|status|passive|effect <camelCaseId> [--flags]'); process.exit(1); }
if (!/^[a-z][A-Za-z0-9]*$/.test(id)) { console.error('id must be camelCase, letters/digits only: "' + id + '"'); process.exit(1); }

const lines = eng.script.code.split('\n');
const off = eng.script.startLine;                       // script line 1 == html line `off`
const html = (i) => (i == null ? '(not found — grep it)' : 'public/index.html:' + (i + off));
const constLine = (name) => { const i = lines.findIndex((l) => l.startsWith('const ' + name + ' = ')); return i === -1 ? null : i; };
const constEnd = (name) => { const s = constLine(name); if (s == null) return null; const e = lines.findIndex((l, i) => i > s && /^[}\])]/.test(l)); return e; };
const fnLine = (name) => { const re = new RegExp('^(?:(?:async )?function ' + name + '\\(|(?:const|let|var) ' + name + ' = )'); const i = lines.findIndex((l) => re.test(l)); return i === -1 ? null : i; };
const title = id.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();

function moveSkeleton() {
  if (eng.MOVES[id]) { console.error('MOVES.' + id + ' already exists:\n' + JSON.stringify(eng.MOVES[id], null, 2)); process.exit(1); }
  const el = argValue('element', 'neutral'), kd = argValue('kind', 'attack'), ty = argValue('type', 'physical');
  const power = argValue('power', kd === 'attack' ? '30' : '0'), range = argValue('range', '1'), cost = argValue('cost', '1');
  const status = argValue('status');
  const line = `  ${(id + ':').padEnd(15)}{ id: '${id}', name: '${title}', kind: '${kd}', type: '${ty}', power: ${power}, range: ${range}, cost: ${cost}, element: '${el}',\n` +
               `                   icon: '✨', desc: 'TODO — one line, player-facing, says the NUMBERS.'` +
               (status ? `,\n                   applyStatus: { id: '${status}', chance: 100, duration: 2 }` : '') + ' },';
  const sameEl = Object.values(eng.MOVES).filter((m) => m.element === el).map((m) => m.id + '(' + (m.power | 0) + ')').join(' ');
  return {
    paste: line,
    where: 'inside `const MOVES = {` — ' + html(constLine('MOVES')) + ' … closes ' + html(constEnd('MOVES')) + '. Group with the other ' + el + ' moves.',
    checklist: [
      status && !eng.STATUS_EFFECTS[status] ? '❌ status "' + status + '" does not exist in STATUS_EFFECTS — scaffold it first (scaffold.mjs status ' + status + ')' : null,
      'Optional fields the resolver understands (see `catalog.mjs moves --schema`): applyStatus, applyStatuses[], aoeRadius, pull, knockback, teleport, selfDamagePct, splashDamagePct, multiHit, dualHit, healAmount, healPercent, stageMods, chargeTurns, setsWeather, paintSurface, clearsTraps, smashesWalls, vanish, priority, accuracy, crit, effect (pierce|drain|aoe|ohko).',
      'A move nobody learns is unreachable: add `{ lvl: N, m: \'' + id + '\' }` to a learnset in UNIT_CARDS/STARTER_HEROES (' + html(constLine('UNIT_CARDS')) + ') or make it Forge-pickable.',
      'Other ' + el + ' moves for power calibration: ' + (sameEl || '(none yet)'),
      'Numbers: node tools/gamedev/damage.mjs ' + id + '   (and --vs <unitId>)',
      'Server: node tools/extract-engine-data.mjs   (MOVES ships to Colyseus; lint fails while stale)',
      'Gate: node tools/gamedev/check.mjs',
    ].filter(Boolean),
  };
}
function statusSkeleton() {
  if (eng.STATUS_EFFECTS[id]) { console.error('STATUS_EFFECTS.' + id + ' already exists:\n' + JSON.stringify(eng.STATUS_EFFECTS[id], null, 2)); process.exit(1); }
  const stat = argValue('stat'); const mod = argValue('mod', '-3');
  const isPct = /pct$/.test(mod);
  const fields = stat ? (isPct ? `statMult: { ${stat}: ${1 + parseInt(mod, 10) / 100} }` : `${stat}Mod: ${parseInt(mod, 10)}`) : `dmgMin: 2, dmgMax: 4, when: 'turnStart'`;
  return {
    paste: `  ${(id + ':').padEnd(11)}{ id: '${id}', name: '${title}', icon: '✨', ${fields}, desc: 'TODO — what it does, in numbers, e.g. "-3 DEF for 2 turns"' },`,
    where: 'inside `const STATUS_EFFECTS = {` — ' + html(constLine('STATUS_EFFECTS')) + ' … ' + html(constEnd('STATUS_EFFECTS')),
    checklist: [
      'Known status fields (from the live schema): dmgMin/dmgMax/when (DoT), skipTurn, skipChance, atkMod/defMod/magMod/resMod/spdMod/accMod, statMult, dodgeChance, forceMiss, blocksAll, countersAttack, forceAttackNearest, koOnExpire, revivesOnKO, stackable, escalating, tracksSource, displacement.',
      isPct ? '⚠ `statMult` is only read in ONE existing status — grep `statMult` in getStatBonus/calculateDamage before relying on it; flat `' + stat + 'Mod` is the well-trodden path.' : null,
      'The tick/expiry machinery is generic (startTurn → status tick, ' + html(fnLine('startTurn')) + '). A pure stat-mod status needs NO engine change.',
      'Immunities: isImmuneToStatus (' + html(fnLine('isImmuneToStatus')) + ') — add faction/element immunities there if the flavour demands it.',
      'Give it a source: a MOVES.applyStatus, an ONPLAY effect `status` field, or a trap. Otherwise it is dead data.',
      'Icon shows on the unit chip; keep it a single emoji.',
      'Server: node tools/extract-engine-data.mjs   then node tools/gamedev/check.mjs',
    ].filter(Boolean),
  };
}
function passiveSkeleton() {
  if (eng.PASSIVES[id]) { console.error('PASSIVES.' + id + ' already exists.'); process.exit(1); }
  const cat = argValue('cat', 'defense');
  return {
    paste: `  ${(id + ':').padEnd(15)}{ id: '${id}', name: '${title}', cat: '${cat}',\n    desc: '✨ TODO — the rule, in one sentence, with numbers.' },`,
    where: 'inside `const PASSIVES = {` — ' + html(constLine('PASSIVES')) + ' … ' + html(constEnd('PASSIVES')),
    checklist: [
      'A PASSIVES entry is ONLY a label. The behaviour lives wherever the rule applies: `hasPassive(unit, \'' + id + '\')` (' + html(fnLine('hasPassive')) + ') inside calculateDamage (' + html(fnLine('calculateDamage')) + '), applyDamageTriggers (' + html(fnLine('applyDamageTriggers')) + '), executeMove (' + html(fnLine('executeMove')) + '), startTurn or _fireTriggers (' + html(fnLine('_fireTriggers')) + ').',
      'Find a sibling with the same trigger point and copy its guard: e.g. `grep -n "hasPassive(.*\'thorns\')" public/index.html`.',
      'cats in use: ' + [...new Set(Object.values(eng.PASSIVES).map((p) => p.cat).filter(Boolean))].join(', ') + '. wardElement / wardFaction / faction are the data-driven passive shapes (no code needed).',
      'Give a unit the passive: `passive: \'' + id + '\'` on a UNIT_CARDS entry, or it is Forge-only.',
      'Server: node tools/extract-engine-data.mjs   then node tools/gamedev/check.mjs',
    ],
  };
}
function effectSkeleton() {
  if (eng.ONPLAY_TYPES.find((t) => t.id === id)) { console.error('ONPLAY_TYPES already has "' + id + '".'); process.exit(1); }
  const needs = (argValue('needs', 'radius,amount')).split(',').map((s) => s.trim()).filter(Boolean);
  const group = argValue('group'); const label = argValue('label', '✨ ' + title + ' (TODO one-line summary)');
  const groups = (eng.ONPLAY_TYPE_GROUPS || []).map((g) => g.label);
  const rawStart = fnLine('_applyOnPlayOneRaw');
  return {
    paste:
      `// 1) REGISTRY — makes it authorable in the Forge editor. Insert inside \`const ONPLAY_TYPES = [\` (${html(constLine('ONPLAY_TYPES'))}):\n` +
      `  // ✨ ${title.toUpperCase()} — TODO: what it does, and WHY it exists (which card wanted it).\n` +
      `  { id: '${id}', label: '${label}', needs: [${needs.map((n) => `'${n}'`).join(',')}] },\n\n` +
      `// 2) GROUP — add '${id}' to the ids[] of ${group ? 'the "' + group + '" group' : 'one group'} in ONPLAY_TYPE_GROUPS (${html(constLine('ONPLAY_TYPE_GROUPS'))}) — else it lands in "🔧 Other".\n\n` +
      `// 3) RESOLVER — a pure state→state branch inside _applyOnPlayOneRaw (${html(rawStart)}). Insert BEFORE its final return, beside a similar effect:\n` +
      `  if (eff.type === '${id}') {\n` +
      `    // WHY: TODO. Reads: ${needs.join(', ')}. Never touch the DOM here; log via state.log.\n` +
      `    const _radius = eff.radius | 0, _amount = eff.amount | 0;\n` +
      `    const _side = (unit && unit.owner) || 'player';\n` +
      `    const _foes = (state.units || []).filter(u => u && u.alive && u.owner !== _side && !u.isHero && _dist(unit.pos, u.pos) <= _radius);\n` +
      `    if (!_foes.length) return state;                       // fizzle quietly — the harness reports "quiet", not "threw"\n` +
      `    _foes.forEach(u => { /* TODO mutate copies, e.g. u.currentHp = Math.max(0, u.currentHp - _amount); */ });\n` +
      `    state.log = [...(state.log || []), { msg: (card && card.name || 'Effect') + ': ${title} hit ' + _foes.length + ' target(s).', color: 'amber' }];\n` +
      `    return state;\n` +
      `  }\n`,
    where: 'three insertions — registry, group, resolver — listed above. `_dist` is a placeholder: use the distance helper the neighbouring branch uses.',
    checklist: [
      'Groups available: ' + groups.join(' | '),
      '`needs` must be field names the editor knows (' + [...new Set(eng.ONPLAY_TYPES.flatMap((t) => t.needs || []))].slice(0, 20).join(', ') + ' …). A new field name means a new editor input in the Forge form too.',
      'Prove it headless: node tools/gamedev/effects.mjs ' + id + ' --show ' + id + '   (must not be "quiet" or "threw")',
      'Registry ⇄ resolver parity is enforced: node tools/gamedev/lint.mjs (effects.unhandled / effects.unregistered)',
      'Describe it for players: _afxClassicLine / the effect describer near ' + html(constLine('ONPLAY_TYPES')) + ' if the card text is auto-generated.',
      'AI: if the AI should value it, teach _aiEffectValue (grep it) — otherwise the AI plays the card as a blank body.',
      'Gate: node tools/gamedev/check.mjs',
    ],
  };
}

const gen = { move: moveSkeleton, status: statusSkeleton, passive: passiveSkeleton, effect: effectSkeleton }[kind];
if (!gen) { console.error('kind must be move|status|passive|effect'); process.exit(1); }
const out = gen();
console.log('▶ ' + kind + ' "' + id + '"\n\n── paste ──────────────────────────────────────────────\n' + out.paste + '\n\n── where ──────────────────────────────────────────────\n' + out.where + '\n\n── checklist ──────────────────────────────────────────');
out.checklist.forEach((c) => console.log('  • ' + c));
