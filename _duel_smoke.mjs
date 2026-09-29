/* 🃏 DUEL EFFECTS — the Yu-Gi-Oh-flavoured passives and card effects, and the
   Pokémon / Final Fantasy-flavoured moves, all under our own names.

   Asked for: "add some Yu-Gi-Oh effects we can use as card types and passives
   and some moves from Pokémon or Final Fantasy — named as our own stuff."

   Defends, headless, off the shipped index.html:
     · the eight passives exist, are named, carry a category, and every hook
       the engine needs for them is present (damage calc, kill, first hit,
       trap, death sweep);
     · the four card effects are in ONPLAY_TYPES with editor fields, resolve
       in _applyOnPlayOneRaw, and are described by all three readers;
     · the twenty moves exist with an icon, element, cost and description,
       use only executor fields that already exist, and every status they
       apply is a real STATUS_EFFECTS entry;
     · none of the ids collide with what was there before.

   Run: node _duel_smoke.mjs */
import { readFileSync } from 'fs';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
function literal(name, open, close) {
  const i = SRC.indexOf('const ' + name + ' = ' + open); if (i < 0) throw new Error('no ' + name);
  const j = SRC.indexOf('\n' + close, i);
  return SRC.slice(i + ('const ' + name + ' = ').length, j + 1 + close.length);
}
const STATUS_EFFECTS = new Function('return ' + literal('STATUS_EFFECTS', '{', '};').replace(/;$/, ''))();
const PASSIVES = new Function('return ' + literal('PASSIVES', '{', '};').replace(/;$/, ''))();
const MOVES = new Function('return ' + literal('MOVES', '{', '};').replace(/;$/, ''))();
const ONPLAY_TYPES = new Function('return ' + literal('ONPLAY_TYPES', '[', '];').replace(/;$/, ''))();

console.log('\n=== 1. passives ===');
{
  const ids = ['voidbrand', 'overrun', 'buriedFang', 'trapSense', 'lastRites', 'packmind', 'loneWolf', 'tributeFed'];
  ok(ids.every(id => PASSIVES[id] && PASSIVES[id].id === id && PASSIVES[id].name && PASSIVES[id].desc && PASSIVES[id].cat), 'eight duel passives, each named, described and categorised', ids.filter(id => !PASSIVES[id]).join());
  ok(/hasPassive\(attacker, 'packmind'\) && adj > 0\) dmg = Math\.floor\(dmg \* \(1 \+ 0\.08 \* Math\.min\(4, adj\)\)\)/.test(SRC) && /hasPassive\(attacker, 'loneWolf'\) && adj === 0\) dmg = Math\.floor\(dmg \* 1\.25\)/.test(SRC), 'Packmind +8%/ally (max 4), Lone Wolf +25% alone — in calculateDamage');
  ok(/hasPassive\(attacker, 'voidbrand'\)\) \{\s*updatedTarget = \{ \.\.\.updatedTarget, _banished: true \};/.test(SRC), 'Voidbrand stamps _banished on the kill (the flag the graveyard view already honours)');
  ok(/hasPassive\(attacker, 'overrun'\)\) \{\s*const spill = dmg - Math\.max\(0, target\.currentHp \| 0\);/.test(SRC) && /🐗 \$\{attacker\.name\} overruns/.test(SRC), 'Overrun spills the overkill onto an adjacent enemy');
  ok(/!target\._buriedFangUsed && hasPassive\(target, 'buriedFang'\)/.test(SRC) && /_buriedFangUsed: true/.test(SRC), 'Buried Fang bites once, then is spent');
  ok(/hasPassive\(unit, 'trapSense'\)\) \{[\s\S]{0,300}steps over it/.test(SRC), 'Trap Sense steps over an enemy trap before it is pulled off the board');
  ok(/hasPassive\(u, 'lastRites'\)\) \{[\s\S]{0,700}side\.hand = \[\.\.\.\(side\.hand \|\| \[\]\), c\];/.test(SRC), 'Last Rites returns the newest graveyard card to hand in the death sweep');
  ok(/hasPassive\(a, 'tributeFed'\)\) \{\s*a\.stats = \{ \.\.\.\(a\.stats \|\| \{\}\), atk: \(\(a\.stats && a\.stats\.atk\) \| 0\) \+ 5 \};/.test(SRC), 'Tribute Fed: +5 ATK to adjacent allies on a death');
}

console.log('\n=== 2. card effects ===');
{
  const ids = ['mirrorWard', 'soulSwap', 'tributeRite', 'stillnessSeal'];
  const byId = Object.fromEntries(ONPLAY_TYPES.map(t => [t.id, t]));
  ok(ids.every(id => byId[id] && byId[id].label && Array.isArray(byId[id].needs)), 'four duel effects in the Forge effect list with editor fields', ids.filter(id => !byId[id]).join());
  ok(byId.mirrorWard.needs.join() === 'radius' && byId.soulSwap.needs.join() === 'radius,controlDuration' && byId.tributeRite.needs.join() === 'radius,sacMax,amount' && byId.stillnessSeal.needs.join() === 'statusDuration', 'each asks the editor for exactly the fields it reads');
  ids.forEach(id => ok(new RegExp("if \\(eff\\.type === '" + id + "'\\) \\{").test(SRC), 'resolver handles ' + id));
  ok(/u\.hasAttacked && _canDestroy\(u\)/.test(SRC), 'Mirror Ward only destroys units that attacked this turn and can be destroyed');
  ok(/_seizeUnitControl\(u, owner, dur\) : \(u\.id === give\.id \? _seizeUnitControl\(u, foeSide, dur\) : u\)/.test(SRC), 'Soul Swap flips one unit each way through the one control helper');
  ok(/_tributed: true/.test(SRC) && /atk: \(\(u\.stats && u\.stats\.atk\) \| 0\) \+ gain \}, maxHp: \(u\.maxHp \| 0\) \+ gain/.test(SRC), 'Tribute Rite grows ATK and HP per offering');
  ok(/applyStatusEffect\(u, 'spectralHaze', dur\)/.test(SRC) && STATUS_EFFECTS.spectralHaze && STATUS_EFFECTS.spectralHaze.forceMiss === true, 'Stillness Seal uses the force-miss status on every enemy');
  ids.forEach(id => ok((SRC.match(new RegExp("case '" + id + "':")) || []).length >= 1 && (SRC.split("case '" + id + "':").length - 1) >= 3, 'all three description readers know ' + id, String(SRC.split("case '" + id + "':").length - 1)));
  const old = ['aoeStatus', 'destroyTarget', 'takeControl', 'refuel'];
  ok(old.every(id => byId[id]), 'the older effects are untouched');
}

console.log('\n=== 3. moves ===');
{
  const ids = ['emberVolley', 'recklessCharge', 'siphonBloom', 'slumberDust', 'thunderlock', 'quickfang', 'ironwallStance', 'mirrorGuard', 'doomCount', 'phoenixEmber', 'hasteWind', 'petrifyingGaze', 'meteorFall', 'sevenfoldRend', 'bulwarkPress', 'cleansingRain', 'galeSlash', 'frostbind', 'soulDrain', 'shockwaveStomp'];
  ok(ids.every(id => MOVES[id] && MOVES[id].id === id), 'twenty arena moves present', ids.filter(id => !MOVES[id]).join());
  const elements = new Set(['fire', 'water', 'storm', 'wind', 'earth', 'nature', 'shadow', 'light', 'arcane', 'metal', 'poison', 'psychic', 'void', 'blood', 'sound']);
  ok(ids.every(id => { const m = MOVES[id]; return m.name && m.icon && m.desc && elements.has(m.element) && Number.isFinite(m.cost) && Number.isFinite(m.range) && (m.kind === 'attack' || m.kind === 'ability'); }), 'each has a name, icon, description, real element, cost, range and kind');
  const statusOk = ids.every(id => { const a = MOVES[id].applyStatus; return !a || (STATUS_EFFECTS[a.id] && a.chance >= 1 && a.chance <= 100 && a.duration >= 1); });
  ok(statusOk, 'every applied status is a real STATUS_EFFECTS entry with a sane chance and duration');
  const known = new Set(['id', 'name', 'kind', 'type', 'power', 'range', 'cost', 'element', 'icon', 'desc', 'multiHit', 'recoil', 'healPercent', 'applyStatus', 'priority', 'target', 'chargeTurns', 'aoeRadius', 'accuracy', 'crit', 'useDefenseAsOffense', 'cleanse', 'healAmount', 'knockback']);
  const unknown = ids.flatMap(id => Object.keys(MOVES[id]).filter(k => !known.has(k)));
  ok(unknown.length === 0, 'only fields the executor already reads', unknown.join());
  ok(MOVES.emberVolley.multiHit.min === 2 && MOVES.emberVolley.multiHit.max === 5 && MOVES.sevenfoldRend.multiHit.min === 7, 'multi-hit shapes are { min, max }');
  ok(MOVES.recklessCharge.recoil === 0.25 && MOVES.siphonBloom.healPercent === 50 && MOVES.soulDrain.healPercent === 75, 'recoil and drain fractions');
  ok(MOVES.quickfang.priority === true && MOVES.meteorFall.chargeTurns === 1 && MOVES.meteorFall.aoeRadius === 2, 'priority and charge-then-burst');
  ok(MOVES.ironwallStance.target === 'self' && MOVES.mirrorGuard.target === 'self' && MOVES.phoenixEmber.target === 'ally' && MOVES.cleansingRain.target === 'ally' && MOVES.hasteWind.target === 'ally', 'self and ally abilities target correctly');
  ok(MOVES.bulwarkPress.useDefenseAsOffense === true && MOVES.cleansingRain.cleanse === true && MOVES.galeSlash.accuracy === 100, 'defence-as-offence, cleanse and never-miss');
  ok(/move\.multiHit/.test(SRC) && /move\.recoil\b/.test(SRC) && /move\.healPercent/.test(SRC) && /move\.chargeTurns/.test(SRC) && /move\.useDefenseAsOffense/.test(SRC) && /move\.knockback/.test(SRC), 'the executor reads every field the new moves use');
  ok(!ids.some(id => id in PASSIVES), 'no move id collides with a passive id');
}
ok(/window\.BUILD_VERSION = 'v12[1-9]v\d+'/.test(SRC), 'build version present');

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
