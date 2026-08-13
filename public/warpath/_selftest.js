/* warpath/_selftest.js — property tests for the world generator.
   `node public/warpath/_selftest.js [seedCount]`

   The generator is a contract with two consumers (the browser and the plpgsql
   mirror in the Warpath migration), so the things worth testing are the
   INVARIANTS the rest of the mode assumes, not the exact output:
     • determinism
     • every pack biome actually exists in every world
     • every structure sits on passable ground
     • every structure is reachable from every spawn (the lattice claim)
     • node density and the rarity of extraction materials land in-band
   Exits non-zero on the first violated invariant, naming the seed.           */
const M = require('./warpath-mapgen.js').WarpathMap;

const N = parseInt(process.argv[2], 10) || 300;
let fails = 0;
const fail = (seed, msg) => { fails++; console.log('FAIL seed=' + seed + ' — ' + msg); };

// Flood fill over passable tiles from a start, 8-way.
function flood(w, sx, sy) {
  const seen = new Set([sx + ',' + sy]);
  const q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.pop();
    for (const [nx, ny] of M.neighbours(x, y)) {
      const k = nx + ',' + ny;
      if (seen.has(k)) continue;
      const t = w.at(nx, ny);
      if (!t || !t.passable) continue;
      seen.add(k); q.push([nx, ny]);
    }
  }
  return seen;
}

const agg = { water: [], nodes: [], extraction: [], biomeMin: [] };

for (let s = 0; s < N; s++) {
  const seed = (s * 2654435761) >>> 0;
  let w;
  try { w = M.generate(seed); } catch (e) { fail(seed, 'generate threw: ' + e.message); continue; }

  // 1 — determinism
  const w2 = M.generate(seed);
  if (JSON.stringify(w.tiles) !== JSON.stringify(w2.tiles)) fail(seed, 'non-deterministic tiles');
  if (JSON.stringify(w.spawns) !== JSON.stringify(w2.spawns)) fail(seed, 'non-deterministic spawns');

  // 2 — every pack biome present, and none vanishingly small
  const area = {};
  let water = 0, nodes = 0, extraction = 0;
  for (const t of w.tiles) {
    area[t.biome] = (area[t.biome] || 0) + 1;
    if (t.water) water++;
    if (t.node) { nodes++; if (t.node.tier === 'extraction') extraction++; }
  }
  for (const b of ['forest', 'graveyard', 'facility', 'mountain']) {
    if (!area[b]) { fail(seed, 'pack biome missing: ' + b); }
    else if (area[b] < 40) fail(seed, 'pack biome too small: ' + b + ' = ' + area[b] + ' tiles');
  }
  agg.biomeMin.push(Math.min(...['forest', 'graveyard', 'facility', 'mountain'].map(b => area[b] || 0)));

  // 3 — structures on passable ground (generate() already asserts; re-check
  //     here so a thrown assert vs a silent bad tile are distinguishable)
  const structures = [].concat(
    w.spawns.map(p => ['spawn' + p.slot, p]),
    w.gates.map(g => [g.id, g]),
    w.sites.map(r => [r.id, r]),
    [['landmark', w.landmark]]);
  for (const [name, p] of structures) {
    const t = w.at(p.x, p.y);
    if (!t) { fail(seed, name + ' out of bounds ' + p.x + ',' + p.y); continue; }
    if (!t.passable) fail(seed, name + ' on impassable tile');
    if (!t.lattice) fail(seed, name + ' off the land lattice — reachability is not guaranteed');
  }

  // 4 — no two structures share a tile
  const occ = new Map();
  for (const [name, p] of structures) {
    const k = p.x + ',' + p.y;
    if (occ.has(k)) fail(seed, 'structure collision at ' + k + ': ' + occ.get(k) + ' / ' + name);
    occ.set(k, name);
  }

  // 5 — THE LATTICE CLAIM. Everything is reachable from spawn 0.
  const reach = flood(w, w.spawns[0].x, w.spawns[0].y);
  for (const [name, p] of structures) {
    if (!reach.has(p.x + ',' + p.y)) fail(seed, name + ' unreachable from spawn 0');
  }

  // 6 — movement budget behaves: a fresh hero with 6 MP can go somewhere,
  //     and every reported destination is genuinely passable + in budget.
  const d = M.reachable(w, w.spawns[0].x, w.spawns[0].y, 6);
  const keys = Object.keys(d);
  if (keys.length < 12) fail(seed, 'spawn 0 has only ' + keys.length + ' destinations at 6 MP — boxed in');
  for (const k of keys) {
    const [x, y] = k.split(',').map(Number);
    if (!w.at(x, y).passable) fail(seed, 'reachable() returned impassable ' + k);
    if (d[k] > 6) fail(seed, 'reachable() returned over-budget ' + k + ' = ' + d[k]);
  }
  // path reconstruction terminates at the start
  const far = keys.sort((a, b) => d[b] - d[a])[0].split(',').map(Number);
  const path = M.pathTo(w, d, w.spawns[0].x, w.spawns[0].y, far[0], far[1]);
  if (path[0][0] !== w.spawns[0].x || path[0][1] !== w.spawns[0].y) fail(seed, 'pathTo did not start at the hero');
  if (path[path.length - 1][0] !== far[0]) fail(seed, 'pathTo did not end at the target');

  // 7 — hash mirror sanity: wpHash32 stays in uint32 range
  for (let i = 0; i < 50; i++) {
    const h = M.wpHash32(seed, i, i * 3, i % 14);
    if (!Number.isInteger(h) || h < 0 || h > 4294967295) fail(seed, 'wpHash32 out of uint32 range: ' + h);
  }

  agg.water.push(water / w.tiles.length);
  agg.nodes.push(nodes);
  agg.extraction.push(extraction);
}

/* ── CARD_META vs the real catalogs ───────────────────────────────────────
   ⚠ Re-derive from the ARRAYS, not with a regex. The original check pulled
   card ids out of public/index.html with `/\{\s*id:\s*.([a-zA-Z0-9_]+)./g`,
   which also matched nested objects — so `siphoned`, a STATUS EFFECT declared
   inside a card, was counted as a location card. `location:siphoned` sat in
   the facility discovery table declared valid, and a player who drafted it
   would have received a card that resolves to nothing: dropped from the
   battle deck, dropped again at extraction. Evaluating the array is the only
   check that actually agrees with resolveDeckCard(). */
{
  const fs = require('fs'), path = require('path');
  const idx = path.join(__dirname, '..', 'index.html');
  if (fs.existsSync(idx)) {
    const src = fs.readFileSync(idx, 'utf8');
    const block = (name) => {
      const i = src.indexOf('const ' + name + ' = [');
      if (i < 0) return null;
      let d = 0, j = src.indexOf('[', i), k = j;
      for (; k < src.length; k++) { if (src[k] === '[') d++; else if (src[k] === ']') { d--; if (!d) break; } }
      return src.slice(j, k + 1);
    };
    const kinds = { unit: 'UNIT_CARDS', spell: 'SPELL_CARDS', trap: 'TRAP_CARDS',
                    location: 'LOCATION_CARDS', weather: 'WEATHER_CARDS' };
    const cat = {};
    let ok = true;
    for (const k in kinds) {
      const b = block(kinds[k]);
      if (!b) { ok = false; break; }
      // eslint-disable-next-line no-eval
      cat[k] = new Map(eval(b).map(c => [c.id, c]));
    }
    if (!ok) {
      console.log('note: could not read the catalogs from index.html — skipping the CARD_META check');
    } else {
      const D = require('./warpath-data.js').WarpathData;
      const keys = new Set(D.STARTER_POOL);
      Object.values(D.RECRUIT_POOLS).forEach(p => p.offers.forEach(o => keys.add(o.key)));
      Object.values(D.DISCOVERY).forEach(b => b.cards.forEach(c => keys.add(c[0])));
      let bad = 0;
      for (const key of keys) {
        const kind = key.slice(0, key.indexOf(':')), id = key.slice(key.indexOf(':') + 1);
        const c = cat[kind] && cat[kind].get(id);
        if (!c) { console.log('FAIL unresolvable card key in warpath-data.js: ' + key); bad++; continue; }
        const m = D.CARD_META[key];
        if (!m) { console.log('FAIL CARD_META is missing ' + key); bad++; continue; }
        if (m.n !== c.name) { console.log('FAIL CARD_META name drift for ' + key + ': ' + m.n + ' vs ' + c.name); bad++; }
        if ((m.c != null ? m.c : null) !== (c.cost != null ? c.cost : null)) {
          console.log('FAIL CARD_META cost drift for ' + key); bad++;
        }
      }
      for (const key of Object.keys(D.CARD_META)) {
        if (!keys.has(key)) { console.log('FAIL CARD_META has a key the mode never offers: ' + key); bad++; }
      }
      fails += bad;
      console.log('CARD_META            ' + keys.size + ' keys checked against the live catalogs'
        + (bad ? ' — ' + bad + ' PROBLEMS' : ''));

      /* ── The authored Guardian decks ────────────────────────────────────
         These are the mode's only authored PvE encounter and they live in
         index.html, so nothing else checks them. An unresolvable id would be
         silently dropped by warpathGuardianDeck and the Guardian would arrive
         with a short deck and lose to a clock it should have set. */
      const objBlock = (name) => {
        const i = src.indexOf('const ' + name + ' = {');
        if (i < 0) return null;
        let d = 0, j = src.indexOf('{', i), k = j;
        for (; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) break; } }
        return src.slice(j, k + 1);
      };
      const gb = objBlock('WARPATH_GUARDIANS');
      if (!gb) { console.log('FAIL WARPATH_GUARDIANS not found in index.html'); fails++; }
      else {
        // eslint-disable-next-line no-eval
        const G = eval('(' + gb + ')');
        const heroBlock = (() => {
          const i = src.indexOf('const STARTER_HEROES = [');
          if (i < 0) return null;
          let d = 0, j = src.indexOf('[', i), k = j;
          for (; k < src.length; k++) { if (src[k] === '[') d++; else if (src[k] === ']') { d--; if (!d) break; } }
          // eslint-disable-next-line no-eval
          return new Set(eval(src.slice(j, k + 1)).map(h => h.id));
        })();
        const DECK_SIZE = 40, MAX_COPIES = 3;
        let gbad = 0, names = [];
        for (const lm of Object.keys(G)) {
          const g = G[lm]; let n = 0; const seen = new Set();
          if (heroBlock && !heroBlock.has(g.heroId)) {
            console.log('FAIL Guardian ' + lm + ' names a hero that does not exist: ' + g.heroId); gbad++;
          }
          for (const [key, copies] of g.deck) {
            const kind = key.slice(0, key.indexOf(':')), id = key.slice(key.indexOf(':') + 1);
            if (!(cat[kind] && cat[kind].get(id))) { console.log('FAIL Guardian ' + lm + ' uses an unresolvable key: ' + key); gbad++; continue; }
            if (copies > MAX_COPIES) { console.log('FAIL Guardian ' + lm + ' runs ' + copies + '× ' + key); gbad++; }
            if (seen.has(key)) { console.log('FAIL Guardian ' + lm + ' lists ' + key + ' twice'); gbad++; }
            seen.add(key); n += copies;
          }
          if (n !== DECK_SIZE) { console.log('FAIL Guardian ' + lm + ' has ' + n + ' cards, not ' + DECK_SIZE); gbad++; }
          names.push(lm + ' (' + n + ', ' + g.heroId + ')');
        }
        // Every landmark the generator marks `guardian` must HAVE one authored,
        // read from the generator rather than restated here — adding a fourth
        // guarded landmark should fail this until somebody writes its deck.
        for (const l of (M.LANDMARKS || [])) {
          if (l.guardian && !G[l.id]) {
            console.log('FAIL guarded landmark ' + l.id + ' has no authored Guardian deck'); gbad++;
          }
          if (!l.guardian && G[l.id]) {
            console.log('FAIL ' + l.id + ' has a Guardian deck but no Guardian'); gbad++;
          }
        }
        fails += gbad;
        console.log('Guardian decks       ' + names.join(', ') + (gbad ? ' — ' + gbad + ' PROBLEMS' : ''));
      }

      /* ── THE BRIDGE: pool → 40 cards ────────────────────────────────────
         warpathPadDeck is the single place a Warpath pool becomes a battle
         deck. If it ever returns something other than DECK_SIZE the engine
         deals a short deck and the player decks out; if it stops being
         deterministic the same pool fights two different fights. Neither is
         visible from the Warpath screen, so it is checked here against the
         real card catalogue. */
      const fnBlock = (name) => {
        const i = src.indexOf('function ' + name + '(');
        if (i < 0) return null;
        let d = 0, j = src.indexOf('{', i), k = j;
        for (; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) break; } }
        return src.slice(i, k + 1);
      };
      const padSrc = fnBlock('warpathPadDeck'), scoreSrc = fnBlock('_warpathCardScore');
      if (!padSrc || !scoreSrc) { console.log('FAIL warpathPadDeck / _warpathCardScore not found'); fails++; }
      else {
        const sandbox = {
          DECK_SIZE: 40, MAX_COPIES_PER_CARD: 3, WARPATH_DECK_SELECT: true,
          resolveDeckCard: (key) => {
            const kind = key.slice(0, key.indexOf(':')), id = key.slice(key.indexOf(':') + 1);
            const c = cat[kind] && cat[kind].get(id);
            return c ? Object.assign({ type: kind }, c) : null;
          },
        };
        // eslint-disable-next-line no-new-func
        const pad = new Function('DECK_SIZE', 'MAX_COPIES_PER_CARD', 'WARPATH_DECK_SELECT', 'resolveDeckCard',
          scoreSrc + '\n' + padSrc + '\nreturn warpathPadDeck;')(
          sandbox.DECK_SIZE, sandbox.MAX_COPIES_PER_CARD, sandbox.WARPATH_DECK_SELECT, sandbox.resolveDeckCard);

        const every = [];
        for (const kind of Object.keys(cat)) for (const id of cat[kind].keys()) every.push(kind + ':' + id);
        const D = require('./warpath-data.js').WarpathData;
        const discovery = new Set(D.STARTER_POOL);
        Object.values(D.DISCOVERY).forEach(b => b.cards.forEach(c => discovery.add(c[0])));
        const cases = [
          ['the starter pool alone', D.STARTER_POOL],
          ['the starter pool + everything draftable', D.STARTER_POOL.concat([...discovery])],
          ['every card in the game', every],
          ['a single card', [D.STARTER_POOL[0]]],
          ['nothing but Locations', every.filter(k => k.startsWith('location:'))],
        ];
        let pbad = 0;
        for (const [name, pool] of cases) {
          const deck = pad(pool);
          if (deck.length !== 40) { console.log('FAIL warpathPadDeck dealt ' + deck.length + ' cards for ' + name); pbad++; continue; }
          if (pad(pool.slice()).join('|') !== deck.join('|')) {
            console.log('FAIL warpathPadDeck is not deterministic for ' + name); pbad++;
          }
          const counts = {};
          for (const k of deck) counts[k] = (counts[k] || 0) + 1;
          const loc = deck.filter(k => k.startsWith('location:')).length;
          const wth = deck.filter(k => k.startsWith('weather:')).length;
          // The caps only apply when the pool HAS something else to offer —
          // a pool of nothing but Locations must still deal 40 cards.
          const hasOther = pool.some(k => !k.startsWith('location:') && !k.startsWith('weather:'));
          if (hasOther && (loc > 3 || wth > 3)) {
            console.log('FAIL warpathPadDeck dealt ' + loc + ' Locations / ' + wth + ' Weather for ' + name
              + ' — only one of each can ever be in play'); pbad++;
          }
          const over = Object.entries(counts).filter(([, v]) => v > 3);
          // Over the copy limit is only tolerable when the pool cannot make a
          // legal 40 at all (fewer than 14 distinct cards).
          const distinctPool = new Set(pool).size;
          if (over.length && distinctPool >= 14) {
            console.log('FAIL warpathPadDeck broke the 3-copy limit with ' + distinctPool + ' distinct cards available: '
              + over.map(o => o[0] + '×' + o[1]).join(', ')); pbad++;
          }
        }
        // An empty or entirely unresolvable pool must deal NOTHING, not junk —
        // warpathStartBattle checks for that and refuses the battle.
        if (pad([]).length !== 0 || pad(['unit:definitely_not_a_card']).length !== 0) {
          console.log('FAIL warpathPadDeck invented a deck out of an empty pool'); pbad++;
        }
        fails += pbad;
        console.log('warpathPadDeck       ' + cases.length + ' pools → 40 cards, deterministic, legal'
          + (pbad ? ' — ' + pbad + ' PROBLEMS' : ''));
      }
    }
  }
}

/* ── THE GRANT LEDGER, THE ONLY COPY THAT SURVIVES THE ACK ─────────────────
   warpath_grants_ack() destroys the server's re-issuable copy of an extracted
   card, so from that moment the local ledger is the only record that it was
   ever delivered. Three separate critics have now found a way to lose those
   cards, so the ledger's three properties are asserted here rather than
   reasoned about: it survives the old id-only format, it repairs a clobbered
   Profile as a high-water mark, and it never invents anything.

   Run in Node against the real functions lifted out of index.html, with
   localStorage and Profile stubbed — the browser parts (MultiTab election,
   saveProfile) are what the browser critics drive. */
{
  const fs = require('fs'), path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const fn = (name) => {
    const i = src.indexOf('function ' + name + '(');
    if (i < 0) return null;
    let d = 0, j = src.indexOf('{', i), k = j;
    for (; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) break; } }
    return src.slice(i, k + 1);
  };
  const parts = ['_wpLedger', '_wpLedgerHas', '_wpLedgerAdd', '_wpLedgerRepair'].map(fn);
  if (parts.some(x => !x)) {
    console.log('FAIL could not lift the grant ledger out of index.html'); fails++;
  } else {
    let bad = 0;
    const store = {};
    const ctx = {
      localStorage: {
        getItem: k => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
      },
      WARPATH_LEDGER_KEY: 'hg_warpath_grants',
      WARPATH_MATERIALS: ['dragon_heart', 'void_crystal', 'celestial_ore',
                          'ancient_bone', 'ouroboros_core', 'kalon_fragment'],
      Profile: {},
      saveProfile: function () { ctx.saved = (ctx.saved | 0) + 1; },
      console: { warn: function () {} },
    };
    // eslint-disable-next-line no-new-func
    const api = new Function('localStorage', 'WARPATH_LEDGER_KEY', 'WARPATH_MATERIALS',
                             'Profile', 'saveProfile', 'console',
      parts.join('\n') + '\nreturn { _wpLedger, _wpLedgerHas, _wpLedgerAdd, _wpLedgerRepair };')(
      ctx.localStorage, ctx.WARPATH_LEDGER_KEY, ctx.WARPATH_MATERIALS,
      ctx.Profile, ctx.saveProfile, ctx.console);

    // 1. The old id-only ledger must still read as "already applied", or an
    //    upgrade re-applies every grant in a player's history.
    store['hg_warpath_grants'] = JSON.stringify(['g-old-1', 'g-old-2']);
    if (!api._wpLedgerHas('g-old-1') || api._wpLedgerHas('g-nope')) {
      console.log('FAIL the ledger no longer recognises the id-only format an earlier build wrote'); bad++;
    }

    // 2. A payload entry repairs a Profile that was written over.
    store['hg_warpath_grants'] = JSON.stringify([
      { id: 'w1', cards: { paladin: 2 }, mats: { void_crystal: 4 }, ts: 1 },
    ]);
    ctx.Profile.cardCollection = {};            // exactly the reproduced clobber:
    ctx.Profile.warpathMaterials = undefined;   // disk paladin undefined, mats undefined
    ctx.saved = 0;
    const raised = api._wpLedgerRepair('test');
    if (raised !== 2) { console.log('FAIL the ledger repaired ' + raised + ' values, expected 2'); bad++; }
    if ((ctx.Profile.cardCollection.paladin | 0) !== 2) {
      console.log('FAIL two extracted Paladins were not restored'); bad++;
    }
    if (((ctx.Profile.warpathMaterials || {}).void_crystal | 0) !== 4) {
      console.log('FAIL four extracted Void Crystals were not restored'); bad++;
    }
    if (!ctx.saved) { console.log('FAIL a repair that changed Profile did not save it'); bad++; }

    // 3. It is a HIGH-WATER MARK, not a delta: repeating it must not stack, and
    //    a legitimately larger value must survive untouched.
    if (api._wpLedgerRepair('again') !== 0) {
      console.log('FAIL a second repair changed something — the ledger is stacking deltas'); bad++;
    }
    ctx.Profile.cardCollection.paladin = 3;     // the player earned another elsewhere
    api._wpLedgerRepair('third');
    if (ctx.Profile.cardCollection.paladin !== 3) {
      console.log('FAIL the repair pulled a legitimately higher count back DOWN'); bad++;
    }

    // 4. It never invents: an unknown material is not ours to write, and a
    //    ledger with nothing in it does nothing.
    store['hg_warpath_grants'] = JSON.stringify([
      { id: 'w2', cards: {}, mats: { not_a_material: 9 }, ts: 2 },
    ]);
    ctx.Profile.warpathMaterials = {};
    api._wpLedgerRepair('unknown');
    if ('not_a_material' in ctx.Profile.warpathMaterials) {
      console.log('FAIL the repair wrote a material that is not on the whitelist'); bad++;
    }
    store['hg_warpath_grants'] = '[]';
    if (api._wpLedgerRepair('empty') !== 0) { console.log('FAIL an empty ledger changed Profile'); bad++; }

    // 5. Round trip: what _wpLedgerAdd writes is what _wpLedgerRepair reads.
    store['hg_warpath_grants'] = '[]';
    api._wpLedgerAdd([{ id: 'w3', cards: { goblin: 3 }, mats: { kalon_fragment: 1 }, ts: 3 }]);
    ctx.Profile.cardCollection = {}; ctx.Profile.warpathMaterials = {};
    api._wpLedgerRepair('roundtrip');
    if ((ctx.Profile.cardCollection.goblin | 0) !== 3
        || (ctx.Profile.warpathMaterials.kalon_fragment | 0) !== 1) {
      console.log('FAIL a grant written by _wpLedgerAdd could not be repaired back'); bad++;
    }
    fails += bad;
    console.log('grant ledger         5 properties'
      + (bad ? ' — ' + bad + ' PROBLEMS' : ' — survives the old format, repairs, never invents'));
  }

  /* ── THE RUN DECK MUST NOT BE PERSISTABLE ────────────────────────────────
     Temporary run state in Profile.decks is the letter of hard constraint #4:
     Profile.decks goes to disk AND uploads as forge.userDecks. */
  let dbad = 0;
  if (/Profile\.decks\.push\(\{\s*id:\s*'warpath_run_deck'/.test(src)) {
    console.log('FAIL the Warpath run deck is being pushed into Profile.decks'); dbad++;
  }
  if (!/window\.__wpRunDeck\s*=\s*\{\s*id:\s*'warpath_run_deck'/.test(src)) {
    console.log('FAIL the Warpath run deck is not held in the transient slot'); dbad++;
  }
  if (!/function _wpPurgePersistedRunDeck/.test(src)) {
    console.log('FAIL nothing sweeps a run deck an earlier build already persisted'); dbad++;
  }
  if (!/window\.__wpRunDeck/.test(fn('getDeckById') || '')) {
    console.log('FAIL getDeckById cannot see the transient run deck — the battle would deal no deck'); dbad++;
  }
  fails += dbad;
  console.log('transient run deck   ' + (dbad ? dbad + ' PROBLEMS' : 'never reaches Profile.decks or the cloud row'));

  /* ── AN UNRESOLVABLE GRANT IS DEFERRED, NOT ACKED ────────────────────── */
  const drain = fn('warpathClaimGrants') || '';
  let gbad = 0;
  if (!/const deferred = fresh\.filter/.test(drain)) {
    console.log('FAIL a grant this build cannot resolve is still applied and acked'); gbad++;
  }
  if (!/_wpLedgerRepair\(/.test(drain)) {
    console.log('FAIL the drain does not repair a clobbered Profile before applying'); gbad++;
  }
  fails += gbad;
  console.log('grant drain          ' + (gbad ? gbad + ' PROBLEMS' : 'defers what it cannot resolve, repairs before it applies'));
}

/* ── THE SCREEN'S THREE SILENT FAILURES ───────────────────────────────────
   All three were invisible to every check that existed, because they are about
   what the player is TOLD and what is left on screen, not about whether
   anything threw. */
{
  const fs = require('fs'), path = require('path');
  const app = fs.readFileSync(path.join(__dirname, 'warpath-app.js'), 'utf8');
  const idx = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  let bad = 0;

  /* 1. The camera must know about the bottom sheet. viewH() returned
     window.innerHeight unconditionally while viewW() beside it subtracted the
     desktop column, so with the sheet open the world was 137px tall at
     390x844 and GONE at 844x390 — and clampCam, comparing against the wrong
     viewport, pinned cam.y so dragging did nothing. */
  const lift = (src, name) => {
    const i = src.indexOf('function ' + name + '(');
    if (i < 0) return null;
    let d = 0, j = src.indexOf('{', i), k = j;
    for (; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) break; } }
    return src.slice(i, k + 1);
  };
  const sheetSrc = lift(app, 'sheetH'), viewHSrc = lift(app, 'viewH');
  if (!sheetSrc || !viewHSrc) { console.log('FAIL sheetH/viewH not found in warpath-app.js'); bad++; }
  else {
    const make = (w, h, cls, sheetPx) => {
      const side = { classList: { contains: c => cls.indexOf(c) >= 0 },
                     getBoundingClientRect: () => ({ height: sheetPx }) };
      // eslint-disable-next-line no-new-func
      return new Function('$', 'window',
        sheetSrc + '\n' + viewHSrc + '\nreturn { sheetH, viewH };')(
        id => (id === 'side' ? side : null), { innerWidth: w, innerHeight: h });
    };
    const cases = [
      // [w, h, classes, sheet px, expect viewH]
      [1440, 900, [], 0, 900],                       // desktop, sheet is a column
      [1440, 900, ['open'], 500, 900],               // ...even if something says open
      [390, 844, ['hidden'], 0, 844],                // phone, collapsed
      [390, 844, ['open'], 473, 371],                // phone, open: 56vh gone
      [360, 640, ['open'], 358, 282],
      [844, 390, ['open'], 218, 172],                // rotated: the case that was 0
    ];
    for (const [w, h, cls, px, want] of cases) {
      const got = make(w, h, cls, px).viewH();
      if (got !== want) {
        console.log('FAIL viewH at ' + w + 'x' + h + ' [' + cls.join(',') + '] = ' + got + ', expected ' + want); bad++;
      }
    }
    // The floor matters: a sheet taller than the window must not produce a
    // zero or negative viewport, which is what made the world vanish.
    if (make(390, 400, ['open'], 900).viewH() <= 0) {
      console.log('FAIL viewH can still return zero — the world disappears'); bad++;
    }
  }

  /* 2. The battle verdict has to survive the remount. warpathStartBattle
     removes the iframe and warpathAfterBattle builds a new one, so the result
     always lands on the FIRST read of a new session — where "do not shout
     history" swallowed it. */
  if (!/_loadSeen\(st\)/.test(app) || !/sessionStorage/.test(app)) {
    console.log('FAIL the announce baseline still dies with the frame — every battle result is swallowed'); bad++;
  }
  if (!/_saveSeen\(st\);\s*\n\}/.test(app)) {
    console.log('FAIL the announce baseline is never written back'); bad++;
  }
  if (!/hero_away:\s*1/.test(app)) {
    console.log('FAIL being dropped from the barrier is still announced by a dashed dot and nothing else'); bad++;
  }

  /* 3. The parent must actually send the verdict, and the client must read the
     "not yet" the server sends back. */
  if (!/warpath:battleResult/.test(idx)) {
    console.log('FAIL nothing in the game ever posts warpath:battleResult — the handler is dead code'); bad++;
  }
  if (!/pending_confirmation/.test(idx)) {
    console.log('FAIL the parent ignores pending_confirmation and reports every claim as a win'); bad++;
  }
  if (!/d\.awaiting/.test(app)) {
    console.log('FAIL the screen cannot say "waiting on your opponent"'); bad++;
  }
  if (!/pendingBattle\.i_claimed/.test(app)) {
    console.log('FAIL the screen still offers "Fight" for a battle you have already reported'); bad++;
  }
  fails += bad;
  console.log('the screen           ' + (bad ? bad + ' PROBLEMS'
    : 'camera knows the sheet, verdicts survive the remount, "waiting" is sayable'));
}

const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
const lo  = a => Math.min(...a), hi = a => Math.max(...a);

console.log('\nseeds tested: ' + N);
console.log('water fraction   avg ' + avg(agg.water).toFixed(3) + '  range ' + lo(agg.water).toFixed(3) + '..' + hi(agg.water).toFixed(3));
console.log('resource nodes   avg ' + avg(agg.nodes).toFixed(1) + '  range ' + lo(agg.nodes) + '..' + hi(agg.nodes));
console.log('extraction nodes avg ' + avg(agg.extraction).toFixed(1) + '  range ' + lo(agg.extraction) + '..' + hi(agg.extraction));
console.log('smallest pack biome avg ' + avg(agg.biomeMin).toFixed(1) + ' tiles, worst ' + lo(agg.biomeMin));

// Band checks on the aggregate — a generator that technically passes every
// per-seed invariant but produces 4 nodes or 900 nodes is still wrong.
if (avg(agg.water) < 0.02 || avg(agg.water) > 0.14) { console.log('FAIL water fraction out of band'); fails++; }
if (avg(agg.nodes) < 300 || avg(agg.nodes) > 700)   { console.log('FAIL node count out of band'); fails++; }
if (lo(agg.extraction) < 3)                          { console.log('FAIL a world generated with almost no extraction materials'); fails++; }
if (avg(agg.extraction) > 90)                        { console.log('FAIL extraction materials are not rare'); fails++; }

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL CLEAN');
process.exit(fails ? 1 : 0);
