/* ══════════════════════════════════════════════════════════════════════════
   🧬 DRIVE-MUTATE — a unit played onto another, replacing it.

   "A genuinely new mechanic: a unit placed onto another that replaces it, plus
    legality restrictions on the host's type/cost/element. That's a new play
    path (it isn't a summon and isn't an equip), a new legality check the AI
    must also respect, and editor fields."

   THE LEGALITY CHECK IS THE FEATURE, so it is what this hammers. Each rule is
   asserted BOTH ways — a host that passes and a host that fails — because a
   check that never refuses is not a check, and a check that always refuses is
   an unplayable card. Both failures look identical from one direction.

     · side      — your own unit vs an enemy's
     · element   — overlap against a multi-element unit
     · cost      — min and max, read off the host's CARD
     · name      — including a `treatAs` alias, which is what makes an alias
                   worth having
     · hero      — never a legal host, whatever else matches

   And the resolution:
     · the host leaves the board and lands in the graveyard (or the Void)
     · the new unit stands on the host's exact tile
     · `keepDamage` carries the wounds; without it the arrival is fresh
     · 🔴 CONTROL: when the deploy cannot happen, THE HOST COMES BACK — a body
       eaten by a play that never landed is the worst outcome of a mis-click,
       and it is the one thing a composed play path can get wrong.

   Run:  node .gauntlet/drive-mutate.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const P = 8760 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('typeof _mutateHostCheck === "function" && typeof initGame === "function"', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(2500);

const out = await pg.evaluate(() => {
  const o = {};
  o.reachable = typeof _mutateHostCheck === 'function' && typeof _mutateHosts === 'function'
             && typeof mutateOnto === 'function' && typeof _mutateSpecOf === 'function';
  if (!o.reachable) return o;

  const board = () => {
    App.battlePrep = App.battlePrep || {};
    const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
    App.battlePrep.hero = me; App.battlePrep.multiplayer = false;
    App.state = initGame(me, foe, [], true, null);
    App.screen = 'battle';
    const s = App.state;
    s.log = []; s.turn = 'player'; s.turnNumber = 2; s.gameOver = null;
    s.player = { ...s.player, hand: [], graveyard: [], void: [], energy: 20 };
    const mk = (o2) => Object.assign({
      isHero: false, alive: true, level: 5, currentHp: 500, maxHp: 500,
      stats: { hp: 500, atk: 10, def: 10, mag: 10, res: 10, spd: 1 },
      elements: ['fire'], passives: [], statusEffects: [], stages: {},
      moves: [], hasAttacked: false, hasMoved: false, cardType: 'unit', cost: 3,
    }, o2);
    s.units = [
      mk({ id: 'ALLY',  owner: 'player', name: 'Ember Kin', pos: { x: 4, y: 4 }, elements: ['fire'] }),
      mk({ id: 'WATER', owner: 'player', name: 'Tide Kin',  pos: { x: 5, y: 4 }, elements: ['water'] }),
      mk({ id: 'FOE',   owner: 'ai',     name: 'Foe',       pos: { x: 6, y: 4 } }),
      mk({ id: 'HERO',  owner: 'player', name: 'My Hero',   pos: { x: 3, y: 4 }, isHero: true }),
    ];
    return s;
  };
  const cardWith = (mutate) => ({
    id: 'mut_test', instanceId: 'mi1', name: 'Mutant', type: 'unit', cost: 1,
    hp: 400, atk: 20, def: 5, mag: 5, res: 5, spd: 2, elements: ['fire'],
    mutate,
  });
  const unit = (s, id) => (s.units || []).find(u => u.id === id);
  const at = (s, x, y) => (s.units || []).find(u => u && u.alive && u.pos && u.pos.x === x && u.pos.y === y);

  // ── legality, each rule both ways ────────────────────────────────────────
  let s = board();
  const chk = (mu, id) => _mutateHostCheck(App.state, 'player', cardWith(mu), unit(App.state, id));
  o.sideAllyOk    = chk({ on: true }, 'ALLY').ok;
  o.sideEnemyNo   = chk({ on: true }, 'FOE').ok;                       // default is ally-only
  o.sideEnemyOk   = chk({ on: true, hostSide: 'enemy' }, 'FOE').ok;
  o.heroNever     = chk({ on: true }, 'HERO').ok;                      // must be false
  o.elemOk        = chk({ on: true, hostElements: ['fire'] }, 'ALLY').ok;
  o.elemNo        = chk({ on: true, hostElements: ['fire'] }, 'WATER').ok;
  o.costMinOk     = chk({ on: true, hostMinCost: 3 }, 'ALLY').ok;
  o.costMinNo     = chk({ on: true, hostMinCost: 4 }, 'ALLY').ok;
  o.costMaxOk     = chk({ on: true, hostMaxCost: 3 }, 'ALLY').ok;
  o.costMaxNo     = chk({ on: true, hostMaxCost: 2 }, 'ALLY').ok;
  o.nameOk        = chk({ on: true, hostNameIncludes: 'ember' }, 'ALLY').ok;
  o.nameNo        = chk({ on: true, hostNameIncludes: 'ember' }, 'WATER').ok;
  o.whyNames      = chk({ on: true, hostElements: ['fire'] }, 'WATER').why || '';
  // the alias counts as the name
  App.state = { ...App.state, units: App.state.units.map(u => u.id === 'WATER' ? { ...u, treatAs: 'Ember Kin' } : u) };
  o.nameAlias     = chk({ on: true, hostNameIncludes: 'ember' }, 'WATER').ok;

  /* ══ 🔴 THE ROUTE A PLAYER ACTUALLY TAKES ═══════════════════════════════
     Reported: "the mutate to place on top of a unit does not allow the player
     to select the unit they choose to mutate over."
     NOTHING WAS WRONG WITH THE MECHANIC. Every assertion in this file passed
     and kept passing, because every one of them calls mutateOnto() or
     _mutateHostCheck() DIRECTLY. The card was simply unreachable: BOTH boards
     send a click that landed on a unit to onUnitClick (the DOM board via its
     .unit handler, the 3D board via board:tileClick with a unitId), and
     onUnitClick opened with `if (App.ui.selectedCardId) return;` — so holding a
     mutate card and clicking the host did nothing at all: no play, no details,
     no refusal. A seam that can do something the UI cannot is not a feature.
     ⚠ This stage touches App.ui and calls the click handler. It never calls
       mutateOnto. */
  {
    s = board();
    const card = cardWith({ on: true });
    App.state = { ...App.state, player: { ...App.state.player, hand: [card], energy: 99 } };
    App.ui = App.ui || {};
    App.ui.selectedCardId = card.instanceId;
    const host = unit(App.state, 'ALLY');
    o.ui = { hadHost: !!host };
    /* 🎯 …and the board must SHOW which units will accept it, or the player is
       guessing. getValidPlacementTiles filters occupied tiles out by design, so
       a mutate card lit up nothing that was standing. */
    try { renderBattle(); } catch (e) { o.ui.renderErr = String(e).slice(0, 160); }
    o.ui.tileCount = document.querySelectorAll('.tile').length;
    o.ui.placementCount = document.querySelectorAll('.tile.placement').length;
    o.ui.screen = App.screen;
    o.ui.hostsSeen = (typeof _mutateHosts === 'function') ? _mutateHosts(App.state, 'player', card).map(u => u.id) : 'no fn';
    o.ui.hostTileLit = !!document.querySelector('.tile.placement[data-x="' + host.pos.x + '"][data-y="' + host.pos.y + '"]');
    const before = App.state.units.length;
    try { onUnitClick(host.id); } catch (e) { o.ui.clickErr = String(e).slice(0, 160); }
    const now = App.state;
    o.ui.hostGone = !unit(now, 'ALLY');
    o.ui.standingHere = !!at(now, host.pos.x, host.pos.y);
    o.ui.tagged = !!(at(now, host.pos.x, host.pos.y) || {})._mutatedFrom;
    o.ui.unitCountUnchanged = (now.units.length === before);
    App.ui.selectedCardId = null;
  }

  /* CONTROL: a NON-mutate card clicked on a unit must still do nothing —
     forwarding every card type would trade one silence for a stream of
     "Tile occupied" toasts. */
  {
    s = board();
    const plain = cardWith({ on: false });
    App.state = { ...App.state, player: { ...App.state.player, hand: [plain], energy: 99 } };
    App.ui.selectedCardId = plain.instanceId;
    const host2 = unit(App.state, 'ALLY');
    const before2 = App.state.units.length;
    try { onUnitClick(host2.id); } catch (e) {}
    o.uiControl = { hostStillThere: !!unit(App.state, 'ALLY'),
                    countUnchanged: App.state.units.length === before2 };
    App.ui.selectedCardId = null;
  }

  // the host list agrees with the checker
  o.hostList = _mutateHosts(App.state, 'player', cardWith({ on: true, hostElements: ['fire'] })).map(u => u.id);

  // ── resolution ──────────────────────────────────────────────────────────
  {
    s = board();
    const card = cardWith({ on: true });
    App.state = { ...App.state, player: { ...App.state.player, hand: [card] } };
    const before = App.state.units.length;
    const okRes = mutateOnto(card, unit(App.state, 'ALLY'), 'player');
    const now = App.state;
    o.res = {
      returned: okRes,
      hostGone: !unit(now, 'ALLY'),
      standingHere: !!at(now, 4, 4),
      standingName: (at(now, 4, 4) || {}).name,
      tagged: !!(at(now, 4, 4) || {})._mutatedFrom,
      hostInGrave: (now.player.graveyard || []).length,
      unitCount: now.units.length,
      before,
    };
  }
  // keepDamage carries the wounds; the default does not
  {
    s = board();
    App.state = { ...App.state, units: App.state.units.map(u => u.id === 'ALLY' ? { ...u, currentHp: 200 } : u) };
    const card = cardWith({ on: true, keepDamage: true });
    App.state = { ...App.state, player: { ...App.state.player, hand: [card] } };
    mutateOnto(card, unit(App.state, 'ALLY'), 'player');
    const u = at(App.state, 4, 4);
    o.keptDamage = u ? { hp: u.currentHp, max: u.maxHp } : null;
  }
  {
    s = board();
    App.state = { ...App.state, units: App.state.units.map(u => u.id === 'ALLY' ? { ...u, currentHp: 200 } : u) };
    const card = cardWith({ on: true });
    App.state = { ...App.state, player: { ...App.state.player, hand: [card] } };
    mutateOnto(card, unit(App.state, 'ALLY'), 'player');
    const u = at(App.state, 4, 4);
    o.freshArrival = u ? (u.currentHp === u.maxHp) : null;
  }
  // banish the host instead
  {
    s = board();
    const card = cardWith({ on: true, mutateVanishHost: true });
    App.state = { ...App.state, player: { ...App.state.player, hand: [card] } };
    mutateOnto(card, unit(App.state, 'ALLY'), 'player');
    o.hostVoided = (App.state.player.void || []).length;
    o.hostNotInGrave = (App.state.player.graveyard || []).length;
  }
  /* 🔴 THE CONTROL — the deploy is refused, so the host must come back.
     A deploy lock is the cleanest refusal to force: placeUnit checks it before
     anything else and returns without spawning. */
  {
    s = board();
    const card = cardWith({ on: true });
    /* 🔴 A DETERMINISTIC REFUSAL. Two earlier drafts tried to provoke one
       through the game's own rules — a deploy lock (wrong data shape, never
       fired) and zero energy (placeUnit has its own affordability paths and
       still deployed). Both 'controls' passed while proving nothing, which is
       worse than no control.
       placeUnit is a function DECLARATION, so it can be replaced for the
       duration of this one case. That tests exactly the invariant this control
       is about — 'if nothing landed, put the host back' — instead of testing
       which of placeUnit's dozen refusals happens to be reachable from here. */
    const _realPlace = placeUnit;
    placeUnit = function () { /* refuses: spawns nothing */ };
    App.state = { ...App.state, player: { ...App.state.player, hand: [card] } };
    // whatever shape the lock takes, this asserts the INVARIANT: if nothing
    // landed, the board is untouched.
    const unitsBefore = App.state.units.length;
    const graveBefore = (App.state.player.graveyard || []).length;
    const res = mutateOnto(card, unit(App.state, 'ALLY'), 'player');
    const landed = !!at(App.state, 4, 4) && !unit(App.state, 'ALLY');
    placeUnit = _realPlace;
    o.refusal = { res, landed,
                  hostBack: !!unit(App.state, 'ALLY'),
                  unitsSame: App.state.units.length === unitsBefore,
                  graveSame: (App.state.player.graveyard || []).length === graveBefore };
  }
  /* ── 🤖 THE AI SIDE — it must CHOOSE to mutate, and refuse to when the trade
        is bad. 'a new legality check the AI must also respect' was half the
        ask, and an AI that can resolve a mutate but never elects one is an
        unfinished feature that looks finished. */
  {
    /* ⚠ REAL CARD SHAPE — a nested stats block, not top-level numbers. aiScoreUnitCard reads
       card.stats, so a test card with bare hp/atk scores as a vanilla body and
       every AI assertion below measures the wrong thing. The first draft did
       exactly that and the positive case silently failed while its three
       controls passed. */
    const strong = { id: 'ai_strong', instanceId: 'ai1', name: 'Ravager', type: 'unit', cost: 1,
                     stats: { hp: 900, atk: 90, def: 20, mag: 40, res: 20, spd: 2 },
                     elements: ['fire'], mutate: { on: true } };
    const feeble = { ...strong, id: 'ai_weak', instanceId: 'ai2', name: 'Whelp',
                     stats: { hp: 60, atk: 2, def: 1, mag: 1, res: 1, spd: 1 } };

    // a chaff host worth eating
    const mk2 = () => { const st = board();
      st.units = st.units.map(u => u.id === 'ALLY' ? { ...u, owner: 'ai', name: 'Chaff',
                                    currentHp: 60, maxHp: 900, atk: 3, mag: 0, def: 1, res: 1 }
                                 : u.id === 'WATER' ? { ...u, owner: 'ai' } : u);
      st.ai = { ...st.ai, hand: [], energy: 20 };
      return st; };

    let st = mk2(); st.ai.hand = [strong];
    const pick = _aiPickMutate(st, null);
    o.aiPicks = pick ? { card: pick.card.name, host: pick.host.name, score: Math.round(pick.score) } : null;

    // CONTROL: a feeble card is not worth the body — the AI declines.
    let st2 = mk2(); st2.ai.hand = [feeble];
    o.aiDeclinesWeak = _aiPickMutate(st2, null) === null;

    // CONTROL: a Kalon is never eaten, however good the card is.
    let st3 = mk2();
    // The Kalon must be the ONLY host on offer, or the AI simply picks the
    // other body and the control proves nothing about Kalons at all — which is
    // exactly what the first draft measured.
    // Keep ONLY the Kalon and the heroes: any other body is a legal host, the
    // AI picks it instead, and the control says nothing about Kalons. Two
    // drafts of this case failed that way — first 'Tide Kin' was left standing,
    // then 'Foe' was.
    st3.units = st3.units.filter(u => u.isHero || u.name === 'Chaff');
    st3.units = st3.units.map(u => u.name === 'Chaff' ? { ...u, isKalon: true } : u);
    st3.ai.hand = [strong];
    const kPick = _aiPickMutate(st3, null);
    o.aiSparesKalon = kPick === null;
    o.aiKalonHosts = _mutateHosts(st3, 'ai', strong).map(u => u.name);

    // CONTROL: an illegal host (element) is never chosen.
    let st4 = mk2();
    st4.ai.hand = [{ ...strong, mutate: { on: true, hostElements: ['ice'] } }];
    o.aiRespectsLegality = _aiPickMutate(st4, null) === null;

    // …and it resolves on the AI's side of the board.
    let st5 = mk2(); st5.ai.hand = [strong];
    App.state = st5;
    const hostU = st5.units.find(u => u.name === 'Chaff');
    const aiHero = st5.units.find(u => u.owner === 'ai' && u.isHero) || { heroPassive: null };
    const did = _aiMutateResolve(st5, strong, hostU, aiHero);
    const now = App.state;
    o.aiResolved = {
      did,
      standing: !!(now.units || []).find(u => u.pos && u.pos.x === 4 && u.pos.y === 4 && u.owner === 'ai'),
      hostGone: !(now.units || []).some(u => u.name === 'Chaff'),
      handSpent: (now.ai.hand || []).length === 0,
      energySpent: (now.ai.energy | 0) < 20,
      hostFiledOnAiSide: (now.ai.graveyard || []).length === 1,
      playerGraveUntouched: (now.player.graveyard || []).length === 0,
    };
  }
  return o;
});

/* source facts read off index.html — used where the harness cannot render */
out.src = (() => {
  try {
    const idx = fs.readFileSync(path.join(process.cwd(), 'public', 'index.html'), 'utf8');
    return {
      /* the fold-in that lights up legal hosts */
      highlightsMutateHosts: /_mutateHosts\(s, 'player', moveCard\)\.forEach/.test(idx),
      /* 🔴 and the early return that made the card unplayable is gone */
      unitClickForwardsMutate: /if \(_mt\) \{ onTileClick\(_mt\.pos\.x, _mt\.pos\.y\); return; \}/.test(idx),
    };
  } catch (e) { return { err: String(e).slice(0, 120) }; }
})();

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
if (!out.reachable) bad.push('mutate is not in this build');
else {
  need('an ally is a legal host', out.sideAllyOk === true);
  need('CONTROL: an enemy is not, by default', out.sideEnemyNo === false);
  need('…unless the card says enemy', out.sideEnemyOk === true);
  need('CONTROL: a hero is never a host', out.heroNever === false);
  need('element matches', out.elemOk === true);
  need('CONTROL: element refuses', out.elemNo === false);
  need('min cost passes', out.costMinOk === true);
  need('CONTROL: min cost refuses', out.costMinNo === false);
  need('max cost passes', out.costMaxOk === true);
  need('CONTROL: max cost refuses', out.costMaxNo === false);
  need('name matches', out.nameOk === true);
  need('CONTROL: name refuses', out.nameNo === false);
  need('a treatAs alias counts as the name', out.nameAlias === true);
  need('the refusal names the rule', /not fire|Tide Kin/i.test(out.whyNames), out.whyNames);
  need('the host list matches the checker', JSON.stringify(out.hostList) === JSON.stringify(['ALLY']), out.hostList);

  need('mutate resolved', out.res.returned === true, out.res);
  need('the host left the board', out.res.hostGone === true, out.res);
  need('something stands on its tile', out.res.standingHere === true, out.res);
  need('…and it is the mutant', out.res.standingName === 'Mutant', out.res);
  need('…tagged with what it replaced', out.res.tagged === true, out.res);
  need('the host went to the graveyard', out.res.hostInGrave === 1, out.res);
  need('the board did not grow', out.res.unitCount === out.res.before, out.res);

  /* The host was at 200/500 = 40%, so the mutant arrives at 40% of ITS OWN
     max — not minus 300 hit points, which on a smaller body is a kill. The
     first draft asserted the absolute version and caught the design bug. */
  need('keepDamage carries the wounds proportionally',
       out.keptDamage && out.keptDamage.hp === Math.max(1, Math.round(out.keptDamage.max * 0.4)),
       out.keptDamage);
  need('CONTROL: without it the arrival is fresh', out.freshArrival === true);
  need('banish sends the host to the Void', out.hostVoided === 1, out.hostVoided);
  need('…and not to the graveyard', out.hostNotInGrave === 0, out.hostNotInGrave);

  need('CONTROL: the deploy really was refused', out.refusal.landed === false, out.refusal);
  need('CONTROL: a refused deploy puts the host back', out.refusal.hostBack === true, out.refusal);
  need('CONTROL: …with no unit lost', out.refusal.unitsSame === true, out.refusal);
  need('CONTROL: …and nothing in the graveyard', out.refusal.graveSame === true, out.refusal);

  need('🤖 the AI elects a good mutate', !!out.aiPicks && out.aiPicks.host === 'Chaff', out.aiPicks);
  need('🤖 CONTROL: it declines a bad trade', out.aiDeclinesWeak === true);
  need('🤖 CONTROL: it never eats a Kalon', out.aiSparesKalon === true);
  need('🤖 CONTROL: it respects host legality', out.aiRespectsLegality === true);
  need('🤖 it resolves on its own side', out.aiResolved.did === true && out.aiResolved.standing === true, out.aiResolved);
  need('🤖 the host left the board', out.aiResolved.hostGone === true, out.aiResolved);
  need('🤖 the card and the energy were spent', out.aiResolved.handSpent && out.aiResolved.energySpent, out.aiResolved);
  need('🤖 the host was filed on the AI side', out.aiResolved.hostFiledOnAiSide === true, out.aiResolved);
  need('🤖 CONTROL: the player graveyard is untouched', out.aiResolved.playerGraveUntouched === true, out.aiResolved);
}

/* ── 🔴 the route the player actually walks ───────────────────────────────── */
{
  const UI = out.ui || {}, UC = out.uiControl || {};
  need('SETUP: there is a host standing', UI.hadHost === true, UI);
  /* 🎯 THE HIGHLIGHT, AND AN HONEST NOTE ABOUT WHAT THIS HARNESS CAN SEE.
     A mutate card's legal targets are OCCUPIED tiles, which is exactly what
     getValidPlacementTiles filters out — so holding one lit up nothing standing
     and the player had to guess which unit would accept it. renderBattle now
     folds _mutateHosts into validPlacement.
     ⚠ This harness renders NO DOM board (tileCount is 0 — the battle screen is
       set but the tiles are never built here), so the class cannot be read off
       the page. What IS checked: the host list the highlight is built from is
       non-empty and contains the unit under test, and the source folds it in.
       Stated rather than quietly dropped, because a check that cannot fail is
       worse than one that is absent. */
  if ((UI.tileCount | 0) > 0) {
    need('🔴 THE ASK: the board SHOWS which unit will accept the mutate',
         UI.hostTileLit === true, UI);
  } else {
    console.log('  · highlight not asserted against the DOM: this harness renders no tile board');
    need('🎯 …the host list the highlight is built from includes the unit under test',
         Array.isArray(UI.hostsSeen) && UI.hostsSeen.indexOf('ALLY') >= 0, UI.hostsSeen);
    need('🎯 …and renderBattle folds those hosts into the placement highlight',
         out.src && out.src.highlightsMutateHosts === true, out.src);
  }
  need('🔴 the early return that swallowed the click is gone',
       out.src && out.src.unitClickForwardsMutate === true, out.src);
  need('🔴 THE BUG: clicking that unit with the card selected PLAYS it',
       UI.hostGone === true, UI);
  need('…the mutation is standing where the host was', UI.standingHere === true, UI);
  need('…and carries the host tag', UI.tagged === true, UI);
  need('…with no net change in unit count — one replaced one',
       UI.unitCountUnchanged === true, UI);
  need('🔴 CONTROL: a NON-mutate card clicked on a unit still does nothing',
       UC.hostStillThere === true && UC.countUnchanged === true, UC);
}

console.log(JSON.stringify({ ...out, pageErrors: errs.slice(0, 4) }, null, 2));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — every host rule refuses and permits, the host is consumed, and a refused deploy gives it back.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
