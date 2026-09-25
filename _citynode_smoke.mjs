/* 🔮 TWO SUPPLY PRNs THE PLAYER COULD NOT MOVE, DEMOLISH, OR GET RID OF (v121v79).

   Reported: "I can't move or demolish them — the demolishing is key as for some
   reason it has placed 2 x Supply PRNs in my city and I can't do anything about
   them… stop them from randomly appearing and destroying players buildings.
   They're stuck where the system placed them."

   THREE MECHANISMS, and the player met them as one wall.

   1. THE PLACEMENT DESTROYED BUILDINGS, AND NOT WHERE YOU WOULD LOOK FOR IT.
      spawnAnchors() rings the owned nodes at slots derived from the node COUNT
      — so licensing one more node moves every slot — and wrote
      `game.tiles[k] = {type:'anchor'}` unconditionally. It runs BEFORE
      loadState on an empty grid, so nothing was crushed at that instant. The
      loss happened one step later: loadState restored the save with
      `if (game.tiles[k]) continue;  // anchor already there`, and a saved
      building whose plot an anchor had taken was SILENTLY DROPPED. No log line,
      no toast. The building was gone and a PRN stood on it.

   2. IT COULD NOT BE MOVED. moveRefusal returned 'A node anchor cannot be
      moved.' — and it would not have worked anyway: tryMove dereferences
      BUILDINGS[t.type] (no 'anchor' row → TypeError, mid-move, tile already
      deleted) and moveCheck refuses everything with 'Unknown building.'

   3. THE PANEL OFFERED NOTHING AND EXPLAINED NOTHING. The anchor branch of
      openInspect hid upgrade, demolish, rotate, repair, action AND move. Six
      hidden buttons and no sentence is indistinguishable from a broken tile.

   Run: node _citynode_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const NC = readFileSync('./public/node-city/index.html', 'utf8');

function fnText(name) {
  const i = NC.search(new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\('));
  if (i < 0) throw new Error('cannot find ' + name);
  let d = 0;
  for (let k = NC.indexOf('{', i); k < NC.length; k++) {
    if (NC[k] === '{') d++;
    else if (NC[k] === '}') { d--; if (!d) return NC.slice(i, k + 1); }
  }
  throw new Error('unbalanced ' + name);
}

/* ── 1. A PLAYER'S BUILDING IS NEVER DISPLACED ───────────────────────────── */
{
  /* anchorFreeNear is the rule, run for real against a board. */
  const ctx = {
    Math, GRID: 24, game: { tiles: {} },
    key: (x, z) => x + ',' + z,
    inGrid: (x, z) => x >= 0 && z >= 0 && x < 24 && z < 24,
  };
  vm.createContext(ctx);
  vm.runInContext(fnText('anchorFreeNear'), ctx);
  const near = (x, z, taken) => vm.runInContext('anchorFreeNear(' + x + ',' + z + ',' + (taken ? 'new Set(' + JSON.stringify(taken) + ')' : 'null') + ')', ctx);

  ok(JSON.stringify(near(5, 5)) === '{"x":5,"z":5}', 'a free plot is used as-is', JSON.stringify(near(5, 5)));
  ctx.game.tiles['5,5'] = { type: 'farm' };
  const moved = near(5, 5);
  ok(moved && !(moved.x === 5 && moved.z === 5), 'an occupied plot is NOT taken — the building stays', JSON.stringify(moved));
  ok(moved && Math.max(Math.abs(moved.x - 5), Math.abs(moved.z - 5)) === 1, 'and it lands on the nearest ring, so it stays in its own quarter', JSON.stringify(moved));
  /* Box it in and it must go further out rather than give up or overwrite. */
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) ctx.game.tiles[(5 + dx) + ',' + (5 + dz)] = { type: 'farm' };
  const out2 = near(5, 5);
  ok(out2 && Math.max(Math.abs(out2.x - 5), Math.abs(out2.z - 5)) === 2, 'a boxed-in anchor steps out another ring', JSON.stringify(out2));
  ok(!ctx.game.tiles[out2.x + ',' + out2.z], 'and the plot it chose really was empty');
  /* Keys already claimed in this pass are respected, or two anchors collide. */
  const t2 = near(5, 5, [out2.x + ',' + out2.z]);
  ok(t2 && !(t2.x === out2.x && t2.z === out2.z), 'a plot claimed earlier in the same pass is not handed out twice — two anchors would overwrite each other',
    JSON.stringify(t2));
  /* A completely full board must refuse rather than crush. */
  const full = { Math, GRID: 4, game: { tiles: {} }, key: (x, z) => x + ',' + z, inGrid: (x, z) => x >= 0 && z >= 0 && x < 4 && z < 4 };
  for (let x = 0; x < 4; x++) for (let z = 0; z < 4; z++) full.game.tiles[x + ',' + z] = { type: 'farm' };
  vm.createContext(full);
  vm.runInContext(fnText('anchorFreeNear'), full);
  ok(vm.runInContext('anchorFreeNear(1,1,null)', full) === null,
    'and a completely full city returns nothing — unplaced beats destructive');
}

/* ── 2. THE LINE THAT DROPPED BUILDINGS IS GONE ──────────────────────────── */
{
  /* ^\s* anchors it to a STATEMENT. The old line is quoted verbatim inside the
     comment that replaced it — deliberately, so the next reader knows what was
     there — and a looser pattern matches that quotation and fails for ever. */
  ok(!/^\s*if \(game\.tiles\[k\]\) continue;/m.test(NC),
    'the silent "skip the saved building" statement is gone');
  ok(/if \(_sitting\.type !== 'anchor' \|\| !BUILDINGS\[td\.type\]\) continue;/.test(NC),
    'only an anchor is ever lifted out of a saved building\'s way, never another building');
  ok(/_bumped\.push\(_sitting\.anchor\)/.test(NC), 'and the displaced anchor is remembered rather than lost');
  ok(/function reseatAnchors/.test(NC), 'a pass after the load puts every anchor back on free ground');
  ok(/await loadState\(\);\s*[\s\S]{0,600}?reseatAnchors\(\)/.test(NC), 'and it runs AFTER loadState, which is the only moment the buildings are known');
  {
    const seg = fnText('reseatAnchors');
    ok(/const taken = new Set\(\)/.test(seg), 'it tracks plots claimed within the pass');
    ok(/anchorFreeNear\(wx, wz, taken\)/.test(seg), 'and asks for free ground only');
    ok(/game\.anchorAt\[id\]/.test(seg), 'preferring where the player last put it');
  }
}

/* ── 3. WHERE THE PLAYER PUTS IT IS WHERE IT STAYS ───────────────────────── */
{
  ok(/anchorAt: game\.anchorAt,/.test(NC), 'the anchor positions ride the save');
  ok(/if \(s\.anchorAt && typeof s\.anchorAt === 'object'\) game\.anchorAt = Object\.assign\(\{\}, s\.anchorAt\);/.test(NC),
    'and are read back on load');
  ok(/^  anchorAt: \{\},$/m.test(NC), 'with a default so an old save simply uses the ring, exactly as before');
  {
    const seg = fnText('anchorSetTile');
    ok(/game\.anchorAt\[String\(a\.node\.id\)\] = k/.test(seg), 'every placement records the plot, so a move is remembered');
    ok(/a\.x = x; a\.z = z; a\.key = k;/.test(seg), 'and the anchor\'s own bookkeeping moves with it');
    ok(/dropTileMesh/.test(seg), 'the old mesh is freed rather than leaked');
  }
}

/* ── 4. IT MOVES ─────────────────────────────────────────────────────────── */
{
  ok(!/if \(t\.type === 'anchor'\) return 'A node anchor cannot be moved\.';/.test(NC), 'the blanket refusal is gone');
  {
    const seg = fnText('moveCheck');
    const i = seg.indexOf("if (t.type === 'anchor')");
    const j = seg.indexOf("const def = BUILDINGS[t.type]");
    ok(i > 0 && j > i, 'moveCheck answers for an anchor BEFORE it reads BUILDINGS — there is no "anchor" row, so that read refuses every tile');
  }
  {
    /* tryMove is `const tryMove = guardedAction(async function (x, z) {…})`,
       not a declaration, so the plain lifter cannot see it. */
    const seg = (() => {
      const i = NC.indexOf('const tryMove = guardedAction(');
      if (i < 0) throw new Error('cannot find tryMove');
      let d = 0;
      for (let k = NC.indexOf('{', i); k < NC.length; k++) {
        if (NC[k] === '{') d++;
        else if (NC[k] === '}') { d--; if (!d) return NC.slice(i, k + 1); }
      }
      throw new Error('unbalanced tryMove');
    })();
    const i = seg.indexOf("if (t.type === 'anchor')");
    const j = seg.indexOf('const def = BUILDINGS[t.type]');
    ok(i > 0 && j > i, 'and so does tryMove — BUILDINGS[t.type].roadLink is a TypeError on an anchor, mid-move, with the tile already deleted');
    const arm = seg.slice(i, j);
    ok(/anchorSetTile\(a, x, z\)/.test(arm), 'the move goes through the one placement helper');
    ok(/computeLinks\(\)/.test(arm), 'links are recomputed — an anchor that moved is fed by different roads');
    ok(/saveSoon\(\)/.test(arm), 'and it is saved, or the move is forgotten on reload');
  }
  ok(/if \(t\.type === 'anchor'\) return \(t\.anchor\.node && t\.anchor\.node\.name\)/.test(NC),
    'beginMove names it off the node — BUILDINGS[t.type].name would throw and the player would get move mode with no instructions');
}

/* ── 5. THE PANEL OFFERS SOMETHING, AND EXPLAINS THE REST ────────────────── */
{
  ok(/\$\('btn-move'\)\.style\.display = canMoveBuildings\(\) \? '' : 'none';/.test(NC), 'Move is on the anchor card');
  ok(/insCardHtml\('Moving it'/.test(NC), 'and a card says how it behaves');
  ok(/There is no Demolish/.test(NC), 'including why there is no Demolish, rather than just omitting the button');
  ok(/efficiency shield/.test(NC), 'naming what tearing it down would actually cost');
  ok(/Foundation Reserve if you no longer want it/.test(NC), 'and where to go to be rid of the node for real');
  /* The other five stay hidden — an anchor has no level, no rotation, no repair. */
  ok(/\$\('btn-upgrade'\)\.style\.display = 'none'; \$\('btn-demolish'\)\.style\.display = 'none';/.test(NC),
    'upgrade and demolish stay hidden — an anchor has neither');
}

/* ── 6. spawnAnchors itself no longer overwrites ─────────────────────────── */
{
  const seg = fnText('spawnAnchors');
  ok(!/if \(game\.tiles\[k\]\) dropTileMesh\(game\.tiles\[k\]\);/.test(seg), 'the unconditional overwrite is gone');
  ok(/anchorFreeNear\(want\.x, want\.z, null\)/.test(seg), 'it asks for free ground');
  ok(/if \(!spot\) return;/.test(seg), 'and skips the node rather than crushing something when there is none');
  ok(/anchorSetTile\(a, spot\.x, spot\.z\)/.test(seg), 'placing through the one helper, so bookkeeping cannot drift');
}

console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
