/* ══════════════════════════════════════════════════════════════════════════
   🚗 DRIVE-KITCHEN-WINDOW — the car at the window can be handed its food.

   THE BUG THIS EXISTS TO KEEP DEAD. kitchen.state.js planPass() used to walk
   the board in `dueAt` order and nothing else, and drivethru.js serveCar()
   refuses any car that is not at the window. So when the car BEHIND the window
   car ordered the same dish and happened to be due sooner, the one plate the
   cook made for the window car was claimed by the car that could not collect
   it: the window car read "not complete yet", the queued car was refused for
   not being at the window, and the plate rotted under the lamp. A player
   cooking exactly what the car in front asked for could not serve it.

   Measured before the fix (this file, seeds 7/42/99/1337): starvedFrames
   929/896/696/434, and with the walk-in counter closed 553/455/140/31. The
   only way out was pinning every plate by hand with assignDish() — which this
   harness still does, late, as the RECOVERY step, and prints when it has to.
   The fix ranks the board: window car · walk-ins · queued cars, then dueAt.

   WHAT IT ASSERTS, per seed, playing the player's natural policy (cook for
   the car at the window, hand it over):
     · starvedFrames == 0    the pass physically held every (recipe × qty) of
                             the window car's ticket for two consecutive
                             frames (one full tick after the last plate landed)
                             and the ticket was still not 'ready'
     · flipBacks == 0        a 'ready' window ticket went back to 'open' while
                             the pass still held its order (the bot HOLDS a
                             ready window ticket for HOLD frames before serving,
                             so later cars get the chance to order the same dish)
     · refused == 0          serveCar() said no to a 'ready' car at the window
     · 'recovery assignDish' is never printed — the escape hatch was not needed

   Run:  node .gauntlet/drive-kitchen-window.mjs [seed …]     (default 7 42 99 1337)
         NO_COUNTER=1 node .gauntlet/drive-kitchen-window.mjs  (walk-in counter closed:
                                                               only cars contend)
         HOLD=<frames>   how long a ready window ticket is held before serving (10)
   Exits non-zero if any seed fails any line above.
   ══════════════════════════════════════════════════════════════════════════ */
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', 'public', 'src', 'kitchen');
const href = (f) => pathToFileURL(path.join(REPO, f)).href;
const SEEDS = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n));
if (!SEEDS.length) SEEDS.push(7, 42, 99, 1337);
const HOLD = Math.max(0, Number(process.env.HOLD || 10) | 0);
const NO_COUNTER = !!process.env.NO_COUNTER;

const RES_IDS = ['food', 'ammo', 'water', 'medicine', 'energyDrink', 'supplies', 'metal', 'fuel', 'corruptedEssence', 'memoryShards', 'dna', 'wood', 'stone', 'cloth'];
const stash = {}; for (const id of RES_IDS) stash[id] = 4000;
const purse = { gems: 250000 }; let mem = {};
globalThis.window = globalThis;
globalThis.window.MythicKitchenBridge = {
  resources: () => RES_IDS.map(id => ({ id, name: id })), meta: (id) => ({ id, name: id, icon: '📦', color: '#888' }),
  getRes: (id) => stash[id] || 0, resourceCap: () => 1e9, resourceUnits: () => 0, gems: () => purse.gems,
  signedIn: () => true, userId: () => 'u', displayName: () => 'R', cloud: null, myCorp: () => null, cityProd: () => ({}), isAdmin: () => false,
  spendRes: (id, n) => { if ((stash[id] || 0) < n) return false; stash[id] -= n; return true; },
  addRes: (id, n) => { stash[id] = (stash[id] || 0) + n; return true; }, refundRes: (id, n) => { stash[id] += n; return true; },
  spendGems: (n) => { if (purse.gems < n) return false; purse.gems -= n; return true; }, addGems: (n) => { purse.gems += n; return true; },
  kitchenState: () => mem, setKitchenState: (o) => { mem = o || {}; return true; }, save: () => true, toast: () => {}, confirm: async () => true, render: () => {},
};
const State = await import(href('kitchen.state.js'));
const DT = await import(href('drivethru.js'));
const DATA = await import(href('kitchen.data.js'));
if (NO_COUNTER) { try { DATA.ECON.COUNTER_ENABLED = false; } catch (e) { console.log('cannot set ECON', e.message); } }
const say = (...a) => console.log(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '));

function runSeed(SEED) {
  State.reset();
  mem = {};
  const K = State.Kitchen;
  let restocked = false; const assembled = new Set();
  let starvedFrames = 0, firstStarve = null, deadlockShown = false, pinShown = false, flipBacks = 0, refused = 0, servedAtWindow = 0;
  let run = 0, runTicket = null, holdTicket = null, holdLeft = 0, lastReady = null, contestedHolds = 0;
  /* Proof the hold is not vacuous: a NEW order arriving while the window ticket is held ready, wanting a
     dish the held ticket also wants. Under the old dueAt-only board that order is what stole the plate. */
  const offNew = State.on('ticket:new', (ev) => {
    const held = holdTicket && holdLeft > 0 && K.tickets.find(x => x.id === holdTicket && x.state === 'ready');
    if (held && (ev.items || []).some(r => held.items.some(it => it.recipeId === r))) contestedHolds++;
  });
  const passCount = (r) => (K.pass || []).filter(d => d && d.recipeId === r).length;
  const ovenCount = (r) => { let n = 0; for (const sid of Object.keys(K.stations)) for (const s of K.stations[sid].slots) if (s && s.recipeId === r) n++; return n; };
  const coveredBy = (t) => t.items.every(it => passCount(it.recipeId) >= (it.qty | 0));

  function bot(api, k, tSec, now) {
    if (!restocked) { restocked = true; for (const s of ['sup_patty', 'sup_bun', 'sup_dough', 'sup_sauce', 'sup_cheese', 'sup_lettuce', 'sup_roll', 'sup_sausage', 'sup_mustard']) State.buySupply(s, 3); }
    if (!k.hand) {
      outer: for (const sid of Object.keys(k.stations)) { const st = k.stations[sid];
        for (let i = 0; i < st.slots.length; i++) { const ph = State.slotPhase(st.slots[i], now); if (ph === 'done' || ph === 'burnt') { State.pullSlot(sid, i, now); break outer; } } }
    }
    if (k.hand) { if (k.hand.quality === 'burnt') State.dropHand(); else State.plateHand(now); }
    for (const sid of Object.keys(k.stations)) { const st = k.stations[sid];
      for (let i = 0; i < st.slots.length; i++) { const slot = st.slots[i]; if (!slot || assembled.has(slot)) continue; assembled.add(slot);
        const r = DATA.recipe(slot.recipeId); if (r && r.steps) for (const s of r.steps) for (let q = 0; q < Math.max(1, s.qty | 0); q++) State.addStep(sid, i, s.ing, now); } }

    // The player's natural policy: cook for the car AT THE WINDOW, then hand it over.
    const head = (k.lane || []).filter(Boolean)[0];
    const t = head && head.ticketId && k.tickets.find(x => x.id === head.ticketId);
    if (!t || head.station !== 'window') { lastReady = null; return; }

    // FLIP-BACK CHECK: it was 'ready' last frame, the pass still holds its order, and it is 'open' now.
    if (lastReady === t.id && t.state === 'open' && coveredBy(t)) {
      flipBacks++;
      say('=== FLIPPED BACK at', tSec.toFixed(1) + 's: window car', head.name, 'ticket', t.id, 'ready → open with pass holding', k.pass.map(d => d.recipeId));
    }
    lastReady = t.state === 'ready' ? t.id : null;

    if (t.state === 'open') {
      for (const it of t.items) {
        const need = (it.qty | 0) - passCount(it.recipeId) - ovenCount(it.recipeId);
        for (let n = 0; n < need; n++) { const r = DATA.recipe(it.recipeId); const st = r && k.stations[r.station]; const free = st ? st.slots.findIndex(s => !s) : -1; if (free === -1) break; State.startCook(r.station, free, it.recipeId, now); }
      }
      // STARVATION CHECK: every plate the window car needs is on the pass, yet its ticket is not 'ready'.
      // run 1 is the frame the last plate was put down (refreshReady has not looked yet); run 2 is after a full tick.
      const covered = coveredBy(t);
      if (covered) { if (runTicket !== t.id) { runTicket = t.id; run = 0; } run++; } else { run = 0; }
      if (covered && run >= 2) {
        starvedFrames++;
        if (!firstStarve) {
          firstStarve = tSec;
          const board = k.tickets.filter(x => x.state === 'open' || x.state === 'ready').sort((a, b) => a.dueAt - b.dueAt)
            .map(x => ({ id: x.id, src: x.source, car: x.carId && (k.lane.find(c => c && c.carId === x.carId) || {}).name, station: x.carId && (k.lane.find(c => c && c.carId === x.carId) || {}).station, state: x.state, dueIn: Math.round((x.dueAt - now) / 1000) + 's', items: x.items.map(i => i.recipeId + ' ' + i.filled + '/' + i.qty) }));
          const card = DT.laneCard(k, now).window;
          say('\n=== STARVED at', tSec.toFixed(1) + 's:', 'window car', head.name, 'ticket', t.id, 'state', t.state, '| pass holds', k.pass.map(d => d.recipeId), '| pinned card:', { ready: card.ready, canServe: card.canServe, items: card.items.map(i => i.recipeId + ' ' + i.filled + '/' + i.qty) });
          say('board (dueAt asc):', board);
          say('serveCar(window car) ->', DT.serveCar(k, head.carId, now));
          const robber = board.find(x => x.id !== t.id && x.items.some(l => /[1-9]\/\d/.test(l)));
          if (robber && robber.src === 'drive') { say('serveCar(car holding the plates, ' + robber.car + ' @' + robber.station + ') ->', DT.serveCar(k, k.tickets.find(x => x.id === robber.id).carId, now)); deadlockShown = true; }
          else if (robber) say('plates are held by walk-in ticket', robber.id, '(served from the board, not the window)');
        }
        // The escape hatch that exists: pin the plates to the window ticket by hand. Printing this line is a failure.
        if (starvedFrames > 30 && !pinShown) {
          pinShown = true;
          for (const it of t.items) { let n = 0; for (const d of k.pass) if (d.recipeId === it.recipeId && n < it.qty) { say('recovery assignDish(' + d.id + ' -> ' + t.id + ') ->', State.assignDish(d.id, t.id)); n++; } }
          State.tick(0, now);
          say('after pinning: ticket', t.id, 'state', t.state, '| serveCar ->', DT.serveCar(k, head.carId, now));
        }
      }
    } else if (t.state === 'ready') {
      // HOLD the ready ticket for a while so cars behind get to order the same dish, then hand it over.
      if (holdTicket !== t.id) { holdTicket = t.id; holdLeft = HOLD; }
      if (holdLeft > 0) { holdLeft--; return; }
      const r = DT.serveCar(k, head.carId, now);
      if (r.ok) servedAtWindow++;
      else { refused++; say('=== REFUSED at', tSec.toFixed(1) + 's: window car', head.name, 'ticket', t.id, 'ready, serveCar ->', r); }
    }
  }
  const rep = State.simulate(300, bot, { seed: SEED, auto: false, quiet: true, fresh: true, step: 100 });
  if (typeof offNew === 'function') offNew();
  const sum = { seed: SEED, noCounter: NO_COUNTER, hold: HOLD, starvedFrames, firstStarve, flipBacks, contestedHolds, refused, deadlockShown, servedAtWindow, served: K.today.served, lost: K.today.lost, errors: rep.errors };
  const pass = starvedFrames === 0 && flipBacks === 0 && refused === 0 && !pinShown && !(rep.errors && rep.errors.length);
  say((pass ? 'PASS' : 'FAIL') + ' summary', sum);
  return pass;
}

let bad = 0;
for (const s of SEEDS) if (!runSeed(s)) bad++;
say('\n' + (bad ? '🔴 ' + bad + ' of ' + SEEDS.length + ' seed(s) FAILED' : '✅ every seed clean') + ' · seeds ' + SEEDS.join(',') + (NO_COUNTER ? ' · counter closed' : ' · counter open') + ' · hold ' + HOLD);
process.exit(bad ? 1 : 0);
