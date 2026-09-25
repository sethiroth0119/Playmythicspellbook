/* 🌲 THE CONSTELLATION, THE LEARNED ARTS, AND THE GOLD CAPSULE.

   Asked for: "This randomly happens — stop this from happening" (a giant
   gold capsule over the selected deck tile); "a system where heroes can learn
   moves from the move pool that fit their element and faction in the skill
   tree, in addition to the 4 moves — 8 moves — 10 skill points each; in the
   Forge move section create these moves for each custom hero and assign
   them to the skill tree"; "make the skill tree much bigger — massive, Final
   Fantasy depth"; "fix any dupe code or dead code".

   What this file defends, headless, through the shipped index.html:
     · the SELECTED badge can no longer inherit inset:0 and stretch;
     · the SP curve, and the one-shot credit that never shrinks a pool;
     · every class constellation: four sectors, nine rings, ~95 stars, stable
       authored ids, a sound prerequisite graph, no overlapping stars, four
       10-SP Learned Arts, real moves behind every ✦, the legacy skills live;
     · the move pool rule (element fit, hero/faction pins, hidden, admin-only,
       already-known) and the slot → move → bay plumbing;
     · the engine reads the index, not the deleted tier-list catalog; the
       Forge editor writes the pins the pool reads.

   Run: node _skilltree_smoke.mjs */
import { readFileSync } from 'fs';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
function fnText(name) {
  const i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find function ' + name);
  let d = 0, started = false;
  for (let j = i; j < SRC.length; j++) {
    const c = SRC[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return SRC.slice(i, j + 1); }
  }
  throw new Error('unbalanced ' + name);
}
function slice(startMarker, endMarker) {
  const a = SRC.indexOf(startMarker), b = SRC.indexOf(endMarker, a);
  if (a < 0 || b < 0) throw new Error('cannot slice ' + startMarker);
  return SRC.slice(a, b);
}

console.log('\n=== 1. the gold capsule ===');
{
  const m = SRC.match(/\.dsx \.dsx-tile\.selected::before\{\s*content:"✓ SELECTED";([^}]*)\}/);
  ok(!!m, 'the SELECTED badge rule exists');
  const body = (m && m[1]) || '';
  ok(/inset:auto/.test(body) && /right:auto/.test(body) && /bottom:auto/.test(body), 'it resets every side the generic .hero-card::before glow set (inset:0 → right/bottom no longer stretch it)', body);
  ok(/width:max-content/.test(body) && /height:auto/.test(body), 'and sizes the badge to its own text');
  ok(/\.hero-card::before \{[^}]*inset: 0;/.test(SRC), '(the generic glow it collided with is still there — the fix is on the badge, not a removal of the glow)');
}

console.log('\n=== 2. the SP curve ===');
{
  const F = new Function(fnText('skillPointsForLevel') + '\nreturn skillPointsForLevel;')();
  ok(F(1) === 0 && F(2) === 2 && F(3) === 4, 'level 1 → 0 SP, then 2 a level');
  ok(F(10) === 23 && F(20) === 48 && F(50) === 123, 'a 5-point milestone at every tenth level; 123 SP at the level-50 cap', [F(10), F(20), F(50)].join(','));
  let mono = true; for (let L = 1; L < 60; L++) if (F(L + 1) < F(L)) mono = false;
  ok(mono, 'never decreases');
  ok(/const sp = Math\.max\(0, skillPointsForLevel\(newLevel\) - skillPointsForLevel\(oldLvl\)\);/.test(SRC), 'the battle level-up banks exactly the curve difference');
  ok(!/Math\.floor\(newLevel \/ 3\) - Math\.floor\(oldLvl \/ 3\)/.test(SRC), 'the old 1-per-3-levels cadence is gone');
}

console.log('\n=== 3. the constellation ===');
let COS = null;
{
  const legacyIds = ['heavyStrike', 'cleave', 'bash', 'smash', 'aegisBreak', 'drainLife', 'sunder', 'fireball', 'blizzard', 'lightning', 'iceShard', 'chainLightning', 'siphonGrasp', 'shadowBolt', 'quickJab', 'pierce', 'arcaneBlast', 'iceCoffin', 'plagueBloom'];
  const MOVES = {}; legacyIds.forEach(id => { MOVES[id] = { id, name: id.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()), desc: 'legacy ' + id }; });
  const code = 'const HERO_LEARN_NODE_COST = 10;\n' + slice('const COSMIC_EL = {', '// The cosmic class id a hero spends its tree in')
    + '\nreturn { COSMIC_CLASSES, COSMIC_NODE_INDEX, buildCosmicClass, COSMIC_CLASS_BY_ID, COSMIC_SKILL_MOVES, MOVES };';
  COS = new Function('MOVES', code)(MOVES);
  const classes = COS.COSMIC_CLASSES;
  ok(classes.length === 7, 'seven classes');
  const allMoves = COS.MOVES;
  let allGood = true; const report = [];
  for (const cls of classes) {
    const b = COS.buildCosmicClass(cls);
    const n = b.nodes.length - 1;
    const learn = b.nodes.filter(x => x.type === 'learn');
    const ids = new Set(b.nodes.map(x => x.id));
    const dupIds = ids.size !== b.nodes.length;
    let badReq = 0, unreach = 0, overlap = 0;
    for (const x of b.nodes) {
      if (x.type === 'core') continue;
      if (!x.req.length) unreach++;
      for (const r of x.req) { const p = b.byId[r]; if (!p || (p.type !== 'core' && p.tier !== x.tier - 1) || (p.type === 'core' && x.tier !== 1)) badReq++; }
      for (const y of b.nodes) { if (y === x) continue; if (Math.hypot(x.x - y.x, x.y - y.y) < 40) overlap++; }
    }
    const movesResolve = b.nodes.filter(x => x.type === 'move').every(x => { const e = COS.COSMIC_NODE_INDEX[x.id]; return e && e.moveId && allMoves[e.moveId]; });
    const keys9 = b.nodes.filter(x => x.type === 'key' && x.tier === 9);
    const total = b.nodes.reduce((s, x) => s + (x.cost || 0), 0);
    const authoredFirst = [0, 1, 2].every(bi => b.nodes.filter(x => x.branch === bi).slice(0, 7).every(x => x.tier <= 5));
    const good = cls.branches.length === 4 && n >= 90 && learn.length === 4 && learn.every(x => x.cost === 10) && learn.map(x => x.learnSlot).sort().join() === '0,1,2,3'
      && !dupIds && badReq === 0 && unreach === 0 && overlap === 0 && movesResolve && keys9.length === 4 && keys9.every(k => k.cost === 5) && total > 123 && authoredFirst;
    if (!good) allGood = false;
    report.push(`${cls.id}: ${cls.branches.length} sectors, ${n} stars, ${learn.length} learn, total ${total} SP, badReq ${badReq}, unreach ${unreach}, overlap ${overlap}, moves ${movesResolve}, t9 keys ${keys9.length}, authoredFirst ${authoredFirst}`);
  }
  report.forEach(r => console.log('       ' + r));
  ok(allGood, 'every class: 4 sectors, ≥90 stars, 4 Learned Arts (10 SP, slots 0–3), unique ids, every prerequisite one ring in, no orphan or overlapping star, a real move behind every ✦, four 5-SP tier-9 keystones, more SP on the board than a capped hero holds, authored stars still first');
  const by = COS.COSMIC_CLASS_BY_ID;
  const v = COS.buildCosmicClass(by.vanguard).byId;
  ok(v['vanguard-0-0'].name === 'Edge Training' && v['vanguard-1-6'].name === 'BANNER OF WAR' && v['vanguard-2-6'].name === 'UNBREAKABLE', 'the authored ids are untouched (a saved allocation still points at the same star)');
  ok(v['vanguard-3-6'].type === 'learn' && v['vanguard-3-6'].learnSlot === 0 && v['vanguard-3-6'].tier === 4, 'Learned Art I sits at ring 4 of the fourth sector');
  const I = COS.COSMIC_NODE_INDEX;
  const flags = (f) => Object.values(I).filter(e => e.flag === f);
  ok(flags('guardian').length >= 2 && flags('bodyguard').length === 1 && flags('nanoRepair').length === 1 && flags('evasiveRoll').length === 1 && flags('nightmareField').length === 1, 'the engine-read legacy passives are stars again (Guardian, Bodyguard, Nano Repair, Evasive Roll, Nightmare Field)');
  ok(flags('tacticalAwareness').length === 1 && flags('tacticalAwareness')[0].kind === 'active' && flags('tacticalAwareness')[0].activeUses === 2 && flags('weakPointScan').length === 1, 'the scan skills are live — Tactical Awareness (2 uses) and Weak Point Scan');
  const summons = Object.values(I).filter(e => e.summonId);
  ok(summons.length === 6 && summons.every(e => e.kind === 'active'), 'all six hero summons are active stars', summons.length);
  ok(Object.values(I).filter(e => e.decoy).length === 2 && flags('dimensionalCollapse').length === 1 && flags('mindFracture').length === 1 && flags('hiveAscension').length === 1 && flags('cloak').length === 1 && flags('chameleonSkin').length === 1, 'decoys, Dimensional Collapse, Mind Fracture, Hive Ascension, Cloak and Chameleon Skin are all reachable');
  ok(I['vanguard-3-6'].kind === 'attack' && I['vanguard-3-6'].learnSlot === 0 && I['vanguard-3-6'].cost === 10 && I['vanguard-0-0'].cost === 1 && I['vanguard-1-6'].cost === 3, 'the index carries kind, slot and cost');
  ok(Object.values(I).some(e => e.flag === 'cosmic_banner_of_war') && Object.values(I).some(e => e.flag === 'cosmic_ascendant_bladestorm'), 'keystone flags derive from the name, ascendants included');
  // a fresh hero can reach a Learned Art by level 8: core → 1 + 1 + 2 + 10 = 14 SP
  const F = new Function(fnText('skillPointsForLevel') + '\nreturn skillPointsForLevel;')();
  ok(F(8) >= 14, 'Learned Art I is affordable by level 8');
}

console.log('\n=== 4. the pool ===');
{
  const heroes = {
    storm: { id: 'h_storm', name: 'Aria', elements: ['storm', 'wind'], factions: ['mage', 'bird'], learnset: [{ lvl: 1, m: 'lightning' }] },
    fire:  { id: 'h_fire',  name: 'Pyra', elements: ['fire'], factions: ['warrior'], learnset: [] },
  };
  const moves = [
    { id: 'lightning', name: 'Lightning', element: 'storm' },
    { id: 'gale', name: 'Gale', element: 'wind' },
    { id: 'ember', name: 'Ember', element: 'fire' },
    { id: 'slash', name: 'Slash', element: 'nature', basic: true },
    { id: 'neutralHit', name: 'Neutral Hit', element: 'neutral' },
    { id: 'pinnedToPyra', name: 'Pyra Only', element: 'storm', treeHeroes: ['h_fire'] },
    { id: 'birdsOnly', name: 'Birds Only', element: 'fire', treeFactions: ['bird'] },
    { id: 'hiddenStorm', name: 'Hidden', element: 'storm', treeHidden: true },
    { id: 'adminStorm', name: 'Admin', element: 'storm' },
  ];
  const env = {
    findHeroById: (id) => Object.values(heroes).find(h => h.id === id) || null,
    getEffectiveHeroData: (h) => h,
    getEffectiveLearnsetForHero: (h) => h.learnset || [],
    allMovesArray: () => moves,
    getForgeObt: (k, id) => ({ adminOnly: id === 'adminStorm' }),
    getElementsOf: (o) => o.elements || [],
  };
  const code = fnText('_moveTreeFits') + '\n' + fnText('getHeroLearnableMoves') + '\nreturn { fits: _moveTreeFits, pool: getHeroLearnableMoves };';
  const F = new Function(...Object.keys(env), code)(...Object.values(env));
  const aria = F.pool('h_storm').map(m => m.id).sort().join(',');
  ok(aria === 'birdsOnly,gale,neutralHit', 'Aria (storm/wind, mage/bird): her element moves, the faction-pinned bird move, the neutral move — not Lightning she already knows, not the basic swing, not the hidden or admin-only storm moves, not the move pinned to Pyra', aria);
  const pyra = F.pool('h_fire').map(m => m.id).sort().join(',');
  ok(pyra === 'ember,neutralHit,pinnedToPyra', 'Pyra (fire, warrior): her fire move, the neutral move, and the storm move pinned to her by name — nothing else', pyra);
  ok(F.pool('nobody').length === 0, 'an unknown hero has an empty pool');
}

console.log('\n=== 5. slot → move → bay ===');
{
  const tree = { unlockedNodes: { 'x-3-6': true, 'x-0-4': true }, equippedSkillAttacks: [null, null, null, null], learnedMoves: [null, null, null, null], points: 0 };
  const INDEX = {
    'x-3-6': { id: 'x-3-6', kind: 'attack', type: 'learn', name: 'Learned Art I', learnSlot: 0, cost: 10 },
    'x-0-4': { id: 'x-0-4', kind: 'attack', type: 'move', name: 'Whirlwind Strike', moveId: 'cm_whirlwind', cost: 2 },
  };
  const MV = { cm_whirlwind: { id: 'cm_whirlwind', name: 'Whirlwind Strike' }, gale: { id: 'gale', name: 'Gale' } };
  const env = { getHeroSkillTree: () => tree, lookupMove: (id) => MV[id] || null, saveProfile: () => {}, _skillNodeById: (id) => INDEX[id] || null, HERO_SKILL_ATTACK_SLOTS: 4, showToast: () => {} };
  const code = ['_skillNodeMoveId', '_skillNodeDisplayName', 'setHeroLearnedMove', 'getUnlockedHeroAttackNodes', 'equipSkillAttack', 'getHeroEquippedSkillMoves'].map(fnText).join('\n')
    + '\nreturn { mid: _skillNodeMoveId, name: _skillNodeDisplayName, set: setHeroLearnedMove, unlocked: getUnlockedHeroAttackNodes, equip: equipSkillAttack, equipped: getHeroEquippedSkillMoves };';
  const F = new Function(...Object.keys(env), code)(...Object.values(env));
  const learn = INDEX['x-3-6'], mv = INDEX['x-0-4'];
  ok(F.mid('h', learn) === null && F.mid('h', mv) === 'cm_whirlwind', 'an empty Learned Art grants no move; a class move star grants its move');
  ok(F.unlocked('h').map(n => n.id).join() === 'x-0-4', 'only stars with a move behind them are offered to the bay');
  F.set('h', learn, 'gale');
  ok(tree.learnedMoves[0] === 'gale' && tree.equippedSkillAttacks[0] === 'x-3-6', 'choosing a move writes the slot and drops the star into the first empty bay slot');
  ok(F.name('h', learn) === 'Gale' && F.name('h', mv) === 'Whirlwind Strike', 'the bay names a Learned Art after the move it teaches');
  F.equip('h', 1, 'x-0-4');
  ok(F.equipped('h').map(m => m.id).join() === 'gale,cm_whirlwind', 'battle merges both — the learned move and the class move');
  F.set('h', learn, null);
  ok(tree.learnedMoves[0] === null && tree.equippedSkillAttacks[0] === null && F.equipped('h').map(m => m.id).join() === 'cm_whirlwind', 'clearing the slot pulls the star out of the bay');
  ok(/if \(owner === 'player' && typeof getHeroEquippedSkillMoves === 'function'\)/.test(SRC) && /knownMoves = knownMoves\.concat\(skillIds\)/.test(SRC), 'buildHero still merges the bay into knownMoves (4 base + 4 bay = 8)');
}

console.log('\n=== 6. the one-shot credit ===');
{
  const Profile = { heroes: { h1: { level: 20 } }, heroSkillTrees: { h1: { unlockedNodes: { 'vanguard-0-0': true, 'vanguard-0-1': true }, points: 3, equippedSkillAttacks: [null, null, null, null], _cosmicMigrated: true, _ultRolled: true, _backfillDone: true, passive: 'p', ultimate: 'u' } } };
  let saves = 0;
  const env = { Profile, saveProfile: () => { saves++; }, HERO_SKILL_TREES: { _default: { passive: 'passive_bonusMove', ultimate: 'ult_volley', nodes: [] } }, HERO_SKILL_ATTACK_SLOTS: 4, HERO_LEARNED_MOVE_SLOTS: 4,
    COSMIC_NODE_INDEX: { 'vanguard-0-0': { cost: 1 }, 'vanguard-0-1': { cost: 1 } }, _skillNodeById: (id) => ({ 'vanguard-0-0': { cost: 1 }, 'vanguard-0-1': { cost: 1 } })[id] || null,
    HERO_ULTIMATE_DEFS: { ult_volley: {} }, getAllUltimateDefs: () => ({ ult_volley: {} }) };
  const code = [fnText('skillPointsForLevel'), fnText('_rollHeroUltimate'), fnText('_defaultHeroSkillTree'), fnText('getHeroSkillTree')].join('\n') + '\nreturn getHeroSkillTree;';
  const G = new Function(...Object.keys(env), code)(...Object.values(env));
  const t = G('h1');
  ok(t.points === 46, 'a level-20 hero holding 3 SP with 2 spent is credited up to the curve: 48 − 2 = 46', t.points);
  ok(Array.isArray(t.learnedMoves) && t.learnedMoves.length === 4 && t._spCurveV2 === true, 'the record gains its four Learned Art slots and the v2 stamp');
  G('h1');
  ok(t.points === 46, 'a second read credits nothing more');
  const t2 = G('h_new');
  ok(t2.points === 0 && t2.learnedMoves.length === 4, 'a brand-new level-1 hero starts at 0 SP with empty slots');
}

console.log('\n=== 7. the engine, the Forge, the dead code ===');
{
  ok(!/HERO_SKILL_TREE_NODES|HERO_SKILL_TREE_DEFS|canUnlockSkillNode|unlockHeroSkillNode|unlockSkillTreeNode|getSkillTreeNodes\(|getAllSkillTreeNodes|getHeroSummonPool|getSummonsForTree/.test(SRC), 'the legacy tier-list catalog and its API are deleted outright');
  ok((SRC.match(/const node = _skillNodeById\(nodeId\);/g) || []).length === 4 && /const node = _skillNodeById\(stp\.nodeId\);/.test(SRC) && /const n = _skillNodeById\(nid\);\s*if \(n && n\.kind === 'active'\) actives\.push\(n\);/.test(SRC), 'the active-skill engine, the targeting panel and the sidebar bar read the cosmic index');
  ok(/if \(Profile\.heroSkillTrees && typeof Profile\.heroSkillTrees === 'object'\) delete Profile\.heroSkillTrees\[id\];/.test(SRC) && !/h\.skillTreeUnlocked = \[\];/.test(SRC), 'an account reset wipes the real tree record, not three fields nothing read');
  ok(!/App\.skillTreeFilter/.test(SRC), 'the unused tree-filter line is gone');
  ok(/id="mv-tree-heroes" multiple/.test(SRC) && /id="mv-tree-factions" multiple/.test(SRC) && /id="mv-tree-hidden"/.test(SRC) && /getAllCustomHeroes\(\) \|\| \[\]\) : \[\];\s*const pinnedH/.test(SRC), 'the Move editor lists the custom heroes and factions to pin a move to, and a hide switch');
  ok(/if \(th\.length\) move\.treeHeroes = th; else delete move\.treeHeroes;/.test(SRC) && /if \(hid && hid\.checked\) move\.treeHidden = true; else delete move\.treeHidden;/.test(SRC), 'saving writes treeHeroes / treeFactions / treeHidden — the fields the pool reads');
  ok(/🌲 Pinned/.test(SRC) && /🌲 Hidden/.test(SRC), 'the move list tags pinned and hidden moves');
  ok(/id="st-learn-picker-modal"/.test(SRC) && /openLearnMovePicker\(heroId, n, refresh\)/.test(SRC) && /if \(n\.type === 'learn'\) openLearnMovePicker\(heroId, n, refresh\);/.test(SRC), 'learning a Learned Art star opens the move picker at once; the star offers Choose / Change move afterwards');
  ok(/tree\.learnedMoves\[n\.learnSlot\] = null;/.test(SRC) && /tree\.learnedMoves = new Array\(HERO_LEARNED_MOVE_SLOTS\)\.fill\(null\);/.test(SRC), 'refund and respec clear the learned moves');
  ok(/zoom: \.5, tx: 0, ty: 0, tzoom: \.5/.test(SRC) && /Math\.max\(0\.2, Math\.min\(1\.7/.test(SRC), 'the camera opens wider and zooms out far enough for nine rings');
  ok(/window\.BUILD_VERSION = 'v12[1-9]v\d+'/.test(SRC), 'build v121v25 or later');
}

console.log(fails ? '\n❌ ' + fails + ' FAILURES' : '\n✅ ALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
