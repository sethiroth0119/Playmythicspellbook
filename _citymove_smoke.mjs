/* 🚚 MOVING BUILDINGS IN THE CITY.

   Asked for: "make it where every player can move their buildings to
   different places on their city builder … every player but AetosDios."

   What this file defends, headless, through node-city/index.html:
     · the gate: the named player never sees the button, everyone else does,
       and it is the ACTING player's name (owner or mayor) that is compared;
     · what refuses to move: roads, anchors, sites, upgrades, PRNs;
     · the destination test mirrors placement: off-map, taken, busy, the
       concourse (with the mover's own tile counted as empty), the kerb rule,
       the edge / power / water / deposit module gates — absent modules mean
       yes, exactly as tryPlace;
     · the wiring: the button, move mode, the hover preview, the click, the
       licence re-site with rollback, and the register following the building.

   Run: node _citymove_smoke.mjs */
import { readFileSync } from 'fs';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/node-city/index.html', 'utf8');
const REG = readFileSync('./public/src/naming/registry.js', 'utf8');
const NAM = readFileSync('./public/src/naming/index.js', 'utf8');
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

console.log('\n=== 1. the gate ===');
{
  const build = (gov) => new Function('gov', 'MOVE_DENIED', fnText('_moveActorName') + '\n' + fnText('canMoveBuildings') + '\nreturn canMoveBuildings;')(gov, ['aetosdios']);
  ok(build({ isOwner: true, name: 'Seth' })() === true, 'an owner looking at their own city may move');
  ok(build({ isOwner: true, name: 'AetosDios' })() === false, 'AetosDios, as owner, may not');
  ok(build({ isOwner: true, name: '  aetosdios ' })() === false, 'the comparison ignores case and spaces');
  ok(build({ isOwner: false, name: 'Seth', mayorName: 'AetosDios' })() === false, 'AetosDios appointed mayor of someone else\'s city may not either');
  ok(build({ isOwner: false, name: 'AetosDios', mayorName: 'Rin' })() === true, 'a mayor named Rin in AetosDios\'s city may — it is the acting player who is compared');
  ok(/const MOVE_DENIED = \[\];/.test(SRC), 'the shipped list is EMPTY — every player, AetosDios included, may move (lifted the day after it shipped)');
  ok(new Function('gov', 'MOVE_DENIED', fnText('_moveActorName') + '\n' + fnText('canMoveBuildings') + '\nreturn canMoveBuildings;')({ isOwner: true, name: 'AetosDios' }, [])() === true, 'with the shipped empty list AetosDios may move too');
}

console.log('\n=== 2. what refuses to move, and where it may go ===');
{
  const tiles = {};
  const env = {
    BUILDINGS: { farm: { name: 'Farm' }, stadium: { name: 'Stadium', concourse: 1 }, lamp: { name: 'Street Light', roadLink: true }, road: { name: 'Road' }, gate: { name: 'Interchange', edgeOnly: true }, well: { name: 'Well', aquifer: true } },
    isRoadTile: (t) => !!t && t.type === 'road',
    bldSite: (t) => !!(t && t.bld && t.bld.k === 0),
    prnRowForKey: (k) => (k === '9,9' ? { id: 'p1' } : null),
    inGrid: (x, z) => x >= 0 && z >= 0 && x < 10 && z < 10,
    tileAt: (x, z) => tiles[x + ',' + z] || null,
    _placing: new Set(['5,5']),
    key: (x, z) => x + ',' + z,
    NEI: [[0, -1], [1, 0], [0, 1], [-1, 0]],
    isRoad: (x, z) => !!(tiles[x + ',' + z] && tiles[x + ',' + z].type === 'road'),
    game: { tiles },
    window: {},
  };
  const code = ['moveRefusal', 'moveCheck'].map(fnText).join('\n') + '\nreturn { refusal: moveRefusal, check: moveCheck };';
  const F = new Function(...Object.keys(env), code)(...Object.values(env));
  ok(F.refusal({ type: 'road' }, '1,1') && F.refusal({ type: 'farm', bld: { k: 0 } }, '1,1') && F.refusal({ type: 'farm', bld: { k: 1 } }, '1,1') && F.refusal({ type: 'farm' }, '9,9'), 'a road, a construction site, an upgrade in progress and a PRN all refuse');
  /* 🔮 THE ANCHOR CAME OFF THIS LIST ON PURPOSE — see _citynode_smoke.mjs. It
     refusing to move, with its Move button hidden and no sentence saying why,
     is what left a player with two Supply PRNs they could not do anything
     about. Asserted the other way now so it cannot quietly go back. */
  ok(!F.refusal({ type: 'anchor', anchor: { node: {} } }, '1,1'), 'and an anchor does NOT — it moves like anything else on the grid');
  ok(F.refusal({ type: 'farm', lvl: 3, damaged: true }, '1,1') === null, 'a standing building — even a damaged one — may move');
  const farm = { type: 'farm' };
  ok(/off the map/.test(F.check(farm, 12, 3)) && /busy/.test(F.check(farm, 5, 5)), 'off-map and a tile with a placement in flight refuse');
  tiles['2,2'] = { type: 'farm' };
  ok(/taken/.test(F.check(farm, 2, 2)) && F.check(farm, 3, 3) === null, 'a taken tile refuses; empty ground is fine');
  const stadium = { type: 'stadium' }; tiles['6,6'] = stadium; tiles['7,7'] = { type: 'road' };
  ok(F.check(stadium, 6, 7) === null, 'a stadium shuffling one tile over counts its OWN old tile as empty and a road as clear');
  tiles['7,5'] = { type: 'farm' };
  ok(/concourse/.test(F.check(stadium, 6, 5)) && /Farm/.test(F.check(stadium, 6, 5)), 'a building inside the concourse refuses and is named');
  ok(/kerb/.test(F.check({ type: 'lamp' }, 0, 0)) && F.check({ type: 'lamp' }, 7, 8) === null, 'a street light must land beside a road');
  ok(F.check({ type: 'gate' }, 3, 3) === null && F.check({ type: 'well' }, 3, 3) === null, 'with no modules loaded the edge and water gates say yes, like tryPlace');
  env.window.MythicOutside = { placeCheck: () => ({ ok: false, msg: 'edge only' }) };
  env.window.MythicPower = { siteRefusal: (type) => (type === 'farm' ? 'too hot' : null) };
  env.window.MythicWater = { siteRefusal: () => 'no water' };
  const G = new Function(...Object.keys(env), code)(...Object.values(env));
  ok(G.check({ type: 'gate' }, 3, 3) === 'edge only' && G.check(farm, 3, 3) === 'too hot' && G.check({ type: 'well' }, 3, 3) === 'no water', 'the module gates refuse with their own words');
}

console.log('\n=== 3. the wiring ===');
{
  ok(/<button class="pbtn" id="btn-move" style="display:none">🚚 Move<\/button>/.test(SRC), 'the Move button sits in the dossier action row');
  ok(/mv\.style\.display = canMoveBuildings\(\) \? 'block' : 'none';/.test(SRC) && /mv\.disabled = !!whyMv;/.test(SRC), 'it is hidden for the excluded player and disabled with the reason on an immovable tile');
  /* 🔮 ASSERTED THE OTHER WAY ON PURPOSE — see _citynode_smoke.mjs. The anchor
     branch hid the ENTIRE action row, so a player who did not like where the
     game had put their PRN had no control and no explanation. */
  ok(/\$\('btn-move'\)\.style\.display = canMoveBuildings\(\) \? '' : 'none';/.test(SRC),
    'and an anchor DOES show it now — hiding the whole row read as a broken building');
  ok(/container\.classList\.toggle\('moving', m === 'move'\);\s*if \(m !== 'move'\) _moveFrom = null;/.test(SRC), 'move mode is a mode: Escape (setMode) ends it and forgets the tile');
  ok(/\(mode === 'move' \? movePreviewOk\(t\.x, t\.z\) : placePreviewOk\(t\.x, t\.z\)\) \? 0x4caf7a : 0xc0473f/.test(SRC), 'the hover square is green where the building may land');
  ok(/else if \(mode === 'move'\) await tryMove\(t\.x, t\.z\);/.test(SRC), 'a click in move mode moves');
  ok(/const u = await opsUnsite\(op\.id\);[\s\S]{0,200}r = await opsSite\(op\.id, x, z, t\.rot \| 0\);[\s\S]{0,300}await opsSite\(op\.id, ox, oz, t\.rot \| 0\);/.test(SRC), 'a licensed business is unsited and re-sited first, and put back if the new site is refused');
  ok(/for \(const c of citizens\) if \(c && c\.job === from\) c\.job = nk;/.test(SRC), 'the staff follow the building');
  ok(/window\.MythicNaming\.moveKey\(from, nk\)/.test(SRC) && /moveKey\(from, to\) \{/.test(REG) && /moveKey: \(from, to\) => reg\.moveKey\(from, to\),/.test(NAM), 'the name register follows it too');
  ok(/refreshRoadArea\(ox, oz\); refreshRoadArea\(x, z\);/.test(SRC) && /computeLinks\(\); manageAgents\(\); updateHUD\(\); saveSoon\(\);\s*openInspect\(nk\);/.test(SRC), 'both neighbourhoods refresh, the city re-links, the move is saved, and the dossier reopens on the new tile');
  ok(!/payCost\(.*\)[\s\S]{0,40}tryMove|tryMove[\s\S]{0,2000}payCost\(/.test(fnText('moveCheck') + SRC.slice(SRC.indexOf('const tryMove ='), SRC.indexOf('const tryMove =') + 4000)), 'moving is free — nothing in the move path charges');
  ok(/mode === 'place' \|\| mode === 'move'\) return;/.test(SRC), 'a click on a citizen while moving is not a conversation');
  ok(/window\.NC_BUILD = "v12[1-9]v(3[2-9]|[4-9]\d|\d{3,})-/.test(SRC), 'city build v121v32 or later');
}

console.log(fails ? '\n❌ ' + fails + ' FAILURES' : '\n✅ ALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
