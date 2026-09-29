
/* ══════════════════════════════════════════════════════════════════════════
   🧬 BIOLAB — the 3D hazmat minigame. Registers window.MythicBioLab.
   ──────────────────────────────────────────────────────────────────────────
   Walk the room. Sequence the strain. Suit up at the airlock — four seals, in
   order, standing still. Spin, mix, assay, and hand the crate to a haulier.
   Every station writes into the SAME formulation object, and that object is
   what /src/plague/cures.js grades. There is no separate "minigame score"
   that gets translated into a result: the lab work IS the result.

   🔴 THE GLOBALS TRAP (CLAUDE.md). This module reads no game global. Every
   capability arrives through window.MythicPlagueBridge, which /src/plague/
   state.js owns. If the bridge is absent the lab still OPENS — you can walk
   the room and work the stations — it simply cannot spend reagents or record
   a batch, and it says so rather than pretending.

   ⚠ IT IS INERT UNTIL open() IS CALLED. Importing this file builds nothing,
   loads no three.js and touches no DOM. That is what makes it safe to ship
   in the <script type="module"> list next to the other features.
   ══════════════════════════════════════════════════════════════════════════ */

import { ensureThree, build, SUIT_SPEED, CARRY_SPEED, setModelYaw, setCamera, gltfVia } from './scene.js';
import { makePlayer, makeInput, step, attachInput } from './player.js';
import { STATIONS, OBJECTIVES, stationByKey, nearest, inHotZone } from './stations.js';
import * as HZ from './hazmat.js';
import * as HUD from './hud.js';
import * as PL from '../plague/state.js';
import { formulate, suggestMix, REAGENTS, REAGENT_IDS, GRADES } from '../plague/cures.js';
import * as LG from '../plague/logistics.js';

let RUN = null;         // the live run, or null when the lab is shut
let STYLE = null;

function injectCss() {
  try {
    if (STYLE && STYLE.isConnected) return;
    STYLE = document.createElement('style');
    STYLE.id = 'mythic-biolab-css';
    STYLE.textContent = HUD.CSS;
    document.head.appendChild(STYLE);
  } catch (e) {}
}

function B() { return PL.bridge(); }
function toastGame(m, ms) { try { B().toast(m, ms); } catch (e) {} }

/* ── run state ─────────────────────────────────────────────────────────────
   ONE object. The scene reads it, the HUD reads it, the stations write it,
   and craftBatch() consumes it. A second copy of any of these numbers is how
   the HUD and the result end up disagreeing about what the player did. */
function newRun(strain) {
  return {
    strain: strain || null,
    player: makePlayer(),
    input: makeInput(),
    suit: HZ.emptySuit(),
    // The lab work, in exactly the shape cures.js's normCraft() expects.
    craft: { sequenced: false, centrifuge: 0.5, synthesis: 0.5, assayed: false, exposure: 0, sealed: true },
    mix: {},
    done: {},              // objective key -> true
    near: null,
    blocked: null,
    spin: null,            // the centrifuge minigame's own state
    /* 📦 The crate in the player's hands, by batch id, or null. NOT saved —
       see the note on stageBatch(): a crate still in hand when the lab closes
       is simply back on the bench next time, because a save that describes a
       pose is a save that can strand a batch nowhere. */
    carrying: null,
    panel: null,           // which station panel is open
    dispatchSel: { batchId: null, carrierId: null, labId: null, coldPack: false },
    market: { carriers: [], labs: [], online: false },
    lastFrame: 0,
    flat: false,
  };
}

/* Live formulation preview. Recomputed on every change so the readout the
   player is looking at is produced by the same function that will grade the
   batch — see the note at the top of cures.js about why this is pure. */
function craftOf(run) {
  return Object.assign({}, run.craft, {
    exposure: run.suit.exposure,
    sealed: run.suit.sealed || !run.suit.inHot,
  });
}
function preview(run) {
  return formulate(run.strain || { sig: { vector: 50, envelope: 50, replication: 50, resilience: 50 } }, run.mix, craftOf(run));
}

function have() {
  const b = B();
  const out = {};
  for (const id of REAGENT_IDS) { try { out[id] = b.getRes(id) | 0; } catch (e) { out[id] = 0; } }
  return out;
}

/* ══ STATION INTERACTIONS ══════════════════════════════════════════════════ */

function interact(run) {
  const near = run.near;
  if (!near) return;
  const s = near.station;

  // The suit gate. Every hot station asks it, and it is the ONLY thing
  // standing between the player and a contaminated batch.
  const refusal = HZ.gate(run.suit, s);
  if (refusal) { HUD.toast(run.nodes, refusal, 'bad'); return; }

  /* 📦 HANDS FULL. A crate is a two-handed object: the only thing a carrying
     player can do is walk it to the bay (or set it back down on the bench).
     ⚠ AFTER the suit gate above, on purpose. The bench is a hot station, so an
       unsuited player is refused there exactly as they would be empty-handed —
       but the Dispatch Bay is cold, so there is never a dead end: a crate can
       always be delivered, whatever the suit is doing. */
  if (run.carrying) {
    if (s.key === 'dispatch') return placeCrate(run);
    if (s.key === 'synthesis') return dropCrate(run);
    HUD.toast(run.nodes, '📦 Your hands are full. Take the crate to the Dispatch Bay, or back to the bench to set it down.', 'warn');
    return;
  }

  if (s.key === 'suitup') return doAirlock(run);
  /* 🗄 NO STRAIN IS NOT A DEAD END. This used to refuse every bench with "the
     register is clear — nothing here needs curing", which meant a player who
     had built the Research Facility and kept their city healthy could walk the
     whole lab and never open a single panel. Cures are stock: the register
     carries every named virus in the game, so send the player there instead of
     turning them away. The Sequencer is the door because reading a strain is
     step one of the checklist either way. */
  if (!run.strain && s.key !== 'dispatch') {
    if (s.key !== 'sequencer') {
      HUD.toast(run.nodes, '🗄 Nothing on the bench yet. Pick a strain at the Sequencer first.', 'warn');
      return;
    }
    return openRegister(run);
  }
  if (s.key === 'sequencer') return openSequencer(run);
  if (s.key === 'centrifuge') return openCentrifuge(run);
  if (s.key === 'synthesis') return openSynthesis(run);
  if (s.key === 'assay') return openAssay(run);
  if (s.key === 'dispatch') return openDispatch(run);
}

/* ══ THE CRATE ═════════════════════════════════════════════════════════════
   A sealed batch is a physical object. It is mixed at the bench and it has to
   be walked to the dispatch table before a haulier can take it — which is the
   only reason the carry animation and SUIT_CARRY exist. */
function crateLabel(b) {
  const g = GRADES[b.f.grade] || { icon: '📦', label: 'BATCH' };
  return g.icon + ' ' + b.strainName + ' · ' + b.f.doses + ' doses · ' + g.label;
}

function takeCrate(run, batchId) {
  if (run.carrying) { HUD.toast(run.nodes, '📦 You are already carrying one.', 'warn'); return; }
  const b = PL.batchById(batchId);
  if (!b || b.status !== 'held' || b.staged) {
    HUD.toast(run.nodes, '⚠ That crate is not on the bench any more.', 'bad');
    return;
  }
  run.carrying = batchId;
  HUD.closeModal(run.nodes);
  run.panel = null;
  HUD.toast(run.nodes, '📦 Lifted ' + crateLabel(b) + '. Walk it to the Dispatch Bay — you will move slower.', 'good');
}

function dropCrate(run) {
  const b = PL.batchById(run.carrying);
  run.carrying = null;
  HUD.toast(run.nodes, '📦 Set down' + (b ? ' ' + crateLabel(b) : '') + ' on the bench.', '');
}

/* 🔴 THE PLACE STEP IS THE ONLY THING THAT WRITES. Everything above is pose;
   this is the state change, and it persists before it reports success. If the
   save refuses, the crate stays in the player's hands rather than vanishing
   from both the bench and the table. */
function placeCrate(run) {
  const id = run.carrying;
  const b = PL.batchById(id);
  const r = PL.stageBatch(id);
  if (!r.ok) { HUD.toast(run.nodes, '⚠ ' + r.error, 'bad'); return; }
  run.carrying = null;
  run.done.dispatch = true;
  HUD.toast(run.nodes, '📦 ' + (b ? crateLabel(b) : 'Crate') + ' is on the dispatch table.', 'good');
  // Straight into the manifest: the player put it there to ship it, and the
  // panel is where the cures on the table are listed.
  openDispatch(run);
}

function doAirlock(run) {
  if (run.suit.sealed) {
    HZ.doff(run.suit);
    HUD.toast(run.nodes, '🧴 Doffed and vented. Most of what was on the suit went down the drain.', 'good');
    return;
  }
  const d = HZ.startDon(run.suit, Date.now());
  if (d) HUD.toast(run.nodes, d.icon + ' ' + d.label + ' — hold still.', '');
}

/* The strain register. Picking an unsampled world virus files a reference
   isolate first (PL.sampleStrain), then puts it on the bench.

   🔴 CHANGING THE STRAIN RESETS THE BENCH. The craft state — sequenced,
      centrifuge, synthesis, assayed — describes work done ON A PARTICULAR
      VIRUS. Carrying a completed sequence across to a different strain would
      hand the player a free read of a signature they never measured, and the
      assay is the only honest way to learn one. The mix goes too: those
      reagents were chosen to answer a different set of four numbers. */
function openRegister(run) {
  const render = () => {
    let list = [];
    try { list = PL.catalogue(); } catch (e) {}
    HUD.modal(run.nodes, HUD.registerPanel(list, run.strain ? run.strain.id : null), (act, id) => {
      if (act === 'close') { HUD.closeModal(run.nodes); run.panel = null; return; }
      if (act !== 'reg-pick' || !id) return;

      let picked = null;
      if (id.indexOf('def:') === 0) {
        const r = PL.sampleStrain(id.slice(4));
        if (!r || !r.ok) { HUD.toast(run.nodes, '⚠ ' + ((r && r.error) || 'That virus could not be sampled.'), 'bad'); return; }
        picked = r.strain;
        HUD.toast(run.nodes, '🧪 ' + picked.name + ' filed as a reference isolate. Nobody in your city has it.', 'good');
      } else {
        try { picked = PL.catalogue().map((e) => e.strain).find((s) => s && s.id === id) || null; } catch (e) {}
        if (!picked) { HUD.toast(run.nodes, '⚠ That strain is no longer in the register.', 'bad'); return; }
      }

      if (!run.strain || run.strain.id !== picked.id) {
        run.strain = picked;
        run.craft = { sequenced: false, centrifuge: 0.5, synthesis: 0.5, assayed: false, exposure: run.craft.exposure, sealed: run.craft.sealed };
        run.mix = {};
        run.spin = null;
        run.done = {};
      }
      HUD.closeModal(run.nodes);
      run.panel = null;
      HUD.toast(run.nodes, '🦠 ' + picked.name + ' (' + picked.isolate + ') is on the bench. Sequence it first.', '');
    });
  };
  run.panel = 'register';
  render();
}

function openSequencer(run) {
  const render = () => HUD.modal(run.nodes, HUD.sequencerPanel(run.strain, run.craft.sequenced), (act) => {
    if (act === 'close') { HUD.closeModal(run.nodes); run.panel = null; return; }
    if (act === 'seq-register') return openRegister(run);
    if (act === 'seq-run') {
      run.craft.sequenced = true;
      run.done.sequencer = true;
      HUD.toast(run.nodes, '🧭 Signature resolved. The bench will now show you what you are aiming at.', 'good');
      render();
    }
  });
  run.panel = 'sequencer';
  render();
}

/* ── the centrifuge minigame ───────────────────────────────────────────────
   A needle sweeps; stop it in the band. Skill, one button, works on a phone.
   The band NARROWS with the strain's resilience, so a tough virus is
   physically harder to purify — the difficulty comes from the enemy rather
   than from an arbitrary setting. */
function openCentrifuge(run) {
  const res = (run.strain && run.strain.sig.resilience) || 50;
  run.spin = {
    running: true, pos: 0, dir: 1,
    speed: 0.55 + res / 260,
    target: 0.30 + ((run.strain ? run.strain.sig.replication : 50) / 100) * 0.42,
    width: Math.max(0.09, 0.24 - res / 620),
    result: null,
  };
  run.panel = 'centrifuge';
  const render = () => HUD.modal(run.nodes, HUD.centrifugePanel(run.spin), (act) => {
    if (act === 'close') { run.spin = null; run.panel = null; HUD.closeModal(run.nodes); return; }
    if (act === 'spin-stop') {
      if (!run.spin.running) { run.spin.running = true; run.spin.result = null; render(); return; }
      run.spin.running = false;
      const d = Math.abs(run.spin.pos - run.spin.target);
      // 0 at the centre of the band, 0 at the far edge of tolerance.
      const score = Math.max(0, 1 - d / (run.spin.width * 1.6));
      run.spin.result = +score.toFixed(2);
      run.craft.centrifuge = score;
      run.done.centrifuge = true;
      HUD.toast(run.nodes,
        score > 0.7 ? '🌀 Clean separation — purity up.'
        : score > 0.4 ? '🌀 Sediment left in it. Usable.'
        : '🌀 Sheared. That batch will not travel well.',
        score > 0.7 ? 'good' : score > 0.4 ? 'warn' : 'bad');
      render();
    }
  });
  render();
  run.spinRender = render;
}

function openSynthesis(run) {
  run.panel = 'synthesis';
  const render = () => {
    const f = preview(run);
    let bench = [];
    try { bench = PL.benchBatches(); } catch (e) {}
    HUD.modal(run.nodes, HUD.synthesisPanel({
      strain: run.strain, mix: run.mix, have: have(), f, known: run.craft.sequenced, bench,
      /* the bench prints what one more unit would do, and it must ask against
         the SAME lab work the preview is graded on */
      craft: craftOf(run),
    }), (act, id, e, el) => {
      if (act === 'close') { HUD.closeModal(run.nodes); run.panel = null; return; }
      if (act === 'crate-take') return takeCrate(run, id);
      const stock = have();
      if (act === 'mix+') { run.mix[id] = Math.min(stock[id] | 0, (run.mix[id] | 0) + 1); return render(); }
      if (act === 'mix-') { run.mix[id] = Math.max(0, (run.mix[id] | 0) - 1); if (!run.mix[id]) delete run.mix[id]; return render(); }
      if (act === 'mix=') {
        const v = Math.max(0, Math.min(stock[id] | 0, parseInt(el.value, 10) || 0));
        if (v) run.mix[id] = v; else delete run.mix[id];
        return render();
      }
      if (act === 'mix-clear') { run.mix = {}; return render(); }
      if (act === 'mix-auto') {
        /* 🔴 THE SHELF GOES IN, IT IS NOT APPLIED AFTERWARDS. This used to
           solve without limits and then clamp each reagent to what the player
           held — but the blend is a WEIGHTED AVERAGE, so removing units from
           one jar moves every axis and the clamped mix no longer solved the
           thing the solver solved. It handed the player a blend that was worse
           than the one it had just described. The solver now plans inside the
           stock it is given, so what comes back is buildable as it stands. */
        const s = suggestMix(run.strain, 24, stock, craftOf(run));
        run.mix = {};
        for (const k of Object.keys(s)) { const v = Math.min(s[k], stock[k] | 0); if (v > 0) run.mix[k] = v; }
        HUD.toast(run.nodes, '📋 Suggested blend loaded — the best the shelf can do for this strain. Refine it from here; the jars are ordered by what helps most.', 'good');
        return render();
      }
      if (act === 'mix-commit') return commit(run);
    });
  };
  render();
  run.synthRender = render;
}

/* THE COMMIT. This is where reagents actually leave the player's ledger, and
   it is the only place in the lab that does. state.js owns the spend and the
   refund-on-failure; everything above this line is free to experiment with. */
function commit(run) {
  if (!PL.ready()) {
    HUD.toast(run.nodes, '⚠ The lab is not connected to your ledger — nothing can be mixed. Reload the game.', 'bad');
    return;
  }
  /* A batch mixed at a HOT bench is sealed-or-not by what the suit was doing
     during the work, which is the state the suit is in right now. Exposure is
     read live for the same reason — cures.js turns both into lost purity,
     lost stability and the contaminated flag. */
  const craft = Object.assign({}, run.craft, {
    exposure: run.suit.exposure,
    sealed: !!run.suit.sealed,
  });
  const r = PL.craftBatch(run.strain.id, run.mix, craft);
  if (!r.ok) {
    if (r.why === 'short') {
      const lines = Object.keys(r.shortfall).map((k) => (REAGENTS[k] ? REAGENTS[k].icon + ' ' + REAGENTS[k].name : k) + ' ×' + r.shortfall[k]);
      HUD.toast(run.nodes, '📉 Short: ' + lines.join(', '), 'bad');
    } else {
      HUD.toast(run.nodes, '⚠ ' + (r.error || 'The mix failed.'), 'bad');
    }
    return;
  }
  run.done.synthesis = true;
  run.mix = {};
  run.lastBatch = r.batch;
  const g = r.formulation.grade;
  HUD.toast(run.nodes, g.icon + ' Batch sealed — ' + g.label + ', ' + r.formulation.doses + ' doses. ' +
    (r.formulation.risk > 0.3 ? 'Mutation risk ' + Math.round(r.formulation.risk * 100) + '%. Assay it.' : 'Take it to the bay.'),
    g.key === 'iatrogenic' ? 'bad' : g.key === 'palliative' ? 'warn' : 'good');
  toastGame(g.icon + ' Cure batch ' + g.label + ' — ' + r.formulation.doses + ' doses ready for dispatch.');
  if (run.synthRender) run.synthRender();
}

function openAssay(run) {
  run.panel = 'assay';
  const render = () => {
    // The assay reads the last COMMITTED batch if there is one, otherwise the
    // vessel. Reading the vessel is the useful case — QC before you commit.
    const f = run.lastBatch && !Object.keys(run.mix).length
      ? Object.assign({}, run.lastBatch.f, { grade: GRADES[run.lastBatch.f.grade] || GRADES.inert })
      : preview(run);
    HUD.modal(run.nodes, HUD.assayPanel(f, run.craft.assayed), (act) => {
      if (act === 'close') { HUD.closeModal(run.nodes); run.panel = null; return; }
      if (act === 'assay-run') {
        run.craft.assayed = true;
        run.done.assay = true;
        HUD.toast(run.nodes, '🔬 Assay logged. Whatever it says now, you cannot claim you did not know.', '');
        render();
      }
    });
  };
  render();
}

async function openDispatch(run) {
  run.panel = 'dispatch';
  /* Re-read on every render rather than closing over one snapshot: dispatching
     moves a batch out of `held` and collecting moves a shipment out of
     `inTransit`, and a stale list would keep offering a crate that has already
     gone. */
  let batches = PL.stagedBatches();
  const sel = run.dispatchSel;
  if (!sel.batchId && batches.length) sel.batchId = batches[0].id;

  const refreshMarket = async () => {
    const b = batches.find((x) => x.id === sel.batchId) || batches[0] || null;
    run.market = await PL.fetchMarket({
      doses: b ? b.f.doses : 20,
      stability: b ? b.f.stability : 50,
      coldPack: sel.coldPack,
      distance: 1,
    });
  };

  const quoteNow = () => {
    const b = batches.find((x) => x.id === sel.batchId);
    const c = run.market.carriers.find((x) => x.id === sel.carrierId);
    const l = run.market.labs.find((x) => x.id === sel.labId);
    if (!b || !c || !l) return null;
    return LG.quote(c, {
      econ: B().opEcon('transport') || {},
      doses: b.f.doses, stability: b.f.stability,
      coldPack: sel.coldPack, distance: c.mine ? 1 : 2,
    });
  };

  const render = () => HUD.modal(run.nodes, HUD.dispatchPanel({
    batches, market: run.market, sel, quote: quoteNow(),
    online: run.market.online, transit: PL.inTransit(),
    // so an empty table can say WHY it is empty
    onBench: (function () { try { return PL.benchBatches().length; } catch (e) { return 0; } })(),
  }), async (act, id, e, el) => {
    if (act === 'close') { HUD.closeModal(run.nodes); run.panel = null; return; }
    if (act === 'pick-batch') { sel.batchId = id; await refreshMarket(); return render(); }
    if (act === 'pick-carrier') { sel.carrierId = id; return render(); }
    if (act === 'pick-lab') { sel.labId = id; return render(); }
    if (act === 'coldpack') { sel.coldPack = !!(el && el.checked); await refreshMarket(); return render(); }
    if (act === 'destroy') {
      if (PL.destroyBatch(sel.batchId)) {
        HUD.toast(run.nodes, '🔥 Incinerated. Nothing that came off that bench will reach anybody.', '');
        batches = PL.stagedBatches();
        sel.batchId = batches.length ? batches[0].id : null;
        return render();
      }
      return;
    }
    if (act === 'collect') {
      /* 🔴 THE CRATE IS OPENED HERE, and this is where a bad decision comes
         home: a batch that broke its cold chain arrives iatrogenic and sheds a
         strain into the city. Every consequence is announced by state.js and
         relayed to both the lab HUD and the game's own toasts, because a
         mutation the player cannot connect to their own shipment reads as the
         game inventing an outbreak. */
      const r = PL.collect(cityHost(), id);
      if (!r.ok) { HUD.toast(run.nodes, '⚠ ' + r.error, 'bad'); return; }
      for (const nnote of r.notes) HUD.toast(run.nodes, nnote, r.mutant ? 'bad' : 'good');
      if (r.medicine) HUD.toast(run.nodes, '💊 +' + r.medicine + ' Medicine from the delivered doses.', 'good');
      if (r.coldChainBroken) toastGame('🧊 A cure shipment broke its cold chain in transit.', 6500);
      if (r.mutant) toastGame('☣️ ' + r.mutant.name + ' — a NEW strain came out of your own crate.', 9000);
      batches = PL.stagedBatches();
      return render();
    }
    if (act === 'dispatch-go') {
      const c = run.market.carriers.find((x) => x.id === sel.carrierId);
      const l = run.market.labs.find((x) => x.id === sel.labId);
      const r = PL.dispatch(sel.batchId, c, l, { coldPack: sel.coldPack, distance: c && c.mine ? 1 : 2 });
      if (!r.ok) { HUD.toast(run.nodes, '⚠ ' + r.error, 'bad'); return; }
      run.done.dispatch = true;
      HUD.toast(run.nodes, '🚚 Away with ' + c.name + ' — ' + LG.etaText(r.shipment) + ' to ' + l.name + '.', 'good');
      toastGame('🚚 Cure batch dispatched to ' + l.name + '. Collect it at the Dispatch Bay when it lands.', 5200);
      batches = PL.stagedBatches();
      sel.batchId = batches.length ? batches[0].id : null;
      return render();
    }
  });

  HUD.modal(run.nodes, '<h3>📦 DISPATCH BAY</h3><p class="sub">Raising hauliers…</p>', () => {});
  await refreshMarket();
  // The player may have walked off or closed the lab during the fetch.
  if (!RUN || RUN !== run || run.panel !== 'dispatch') return;
  render();
}

/* ══ THE LOOP ══════════════════════════════════════════════════════════════ */

/* `now` is a FRAME clock (performance.now) and is used only to derive dt.
   `wall` is the WALL clock (Date.now) and is the one the suit runs on.

   🔴 THESE ARE TWO DIFFERENT TIME ORIGINS AND MIXING THEM WAS A SHIPPED
   BLOCKER. startDon() stamps Date.now(); this function used to hand tick()
   the performance.now() value, so the comparison inside was `5000 -
   1756700000000 >= 2600` and no seal could ever latch. The HUD reads the wall
   clock too, so the first bar filled to 100% and stopped — the suit was
   simply unobtainable, and it looked like a stuck progress bar rather than a
   unit mismatch. Anything time-based that the HUD also renders must be handed
   `wall`, not `now`. */
function frame(run, now, wall) {
  const dt = run.lastFrame ? Math.min(100, now - run.lastFrame) : 16;
  run.lastFrame = now;
  const wallNow = wall || Date.now();

  const modalUp = HUD.modalOpen(run.nodes);
  // 🔴 MOVEMENT FREEZES WHILE A PANEL IS OPEN. Without this the player walks
  // out of the airlock while donning, or out of a hot bench mid-mix, and the
  // state the panel is describing stops being true underneath it.
  // A sealed suit is heavy. See SUIT_SPEED in scene.js — this is also what
  // puts the character into the walk cycle rather than the run.
  // 📦 A crate is heavier than the suit, and it does not stack with it: the
  //    slowest applicable factor wins rather than multiplying to a crawl.
  const speedFactor = run.carrying ? CARRY_SPEED : (run.suit.sealed ? SUIT_SPEED : 1);
  if (!modalUp) step(run.player, run.input, dt, speedFactor);

  const p = run.player;
  run.near = nearest(p.x, p.z, 3.2);
  const atAirlock = !!(run.near && run.near.station.key === 'suitup');
  const hot = inHotZone(p.x, p.z);

  const evs = HZ.tick(run.suit, dt, { now: wallNow, atAirlock, inHot: hot });
  for (const ev of evs) {
    if (ev.kind === 'seal') HUD.toast(run.nodes, '✅ ' + ev.label + ' — sealed.', 'good');
    else if (ev.kind === 'sealed') HUD.toast(run.nodes, '🥽 SUIT SEALED. The hot zone will let you work.', 'good');
    else if (ev.kind === 'interrupted') HUD.toast(run.nodes, '⚠ You walked away mid-seal. That step has to be redone.', 'warn');
    else if (ev.kind === 'breach') HUD.toast(run.nodes, '☣️ YOU ARE IN THE HOT ZONE WITHOUT A SUIT. Everything you touch is now contaminated.', 'bad');
    else if (ev.kind === 'trackedOut') HUD.toast(run.nodes, '⚠ You left the hot zone still suited. Doff at the airlock next time.', 'warn');
  }
  run.craft.exposure = run.suit.exposure;
  run.craft.sealed = run.suit.sealed;
  run.done.suitup = run.suit.everSealed;

  run.blocked = run.near ? HZ.gate(run.suit, run.near.station) : null;

  // Centrifuge needle. Driven from the loop rather than its own interval so it
  // stops dead when the lab closes — an orphaned setInterval on a disposed
  // panel is how a closed overlay keeps burning battery.
  if (run.spin && run.spin.running) {
    run.spin.pos += run.spin.dir * run.spin.speed * (dt / 1000);
    if (run.spin.pos >= 1) { run.spin.pos = 1; run.spin.dir = -1; }
    if (run.spin.pos <= 0) { run.spin.pos = 0; run.spin.dir = 1; }
    /* 🌀 MOVE, DO NOT RE-RENDER. run.spinRender() rebuilds the whole modal
       (modal() assigns innerHTML), and doing that every frame destroyed the
       buttons between mousedown and mouseup — no click could ever complete,
       so the player could neither stop the rotor nor close the panel. The
       needle is the only thing that moves; move the needle.
       Falls back to the full render only if the needle is not on screen (the
       panel was replaced by something else), which cannot loop because that
       render puts the needle back. */
    if (run.panel === 'centrifuge') {
      const moved = HUD.centrifugeMove(run.nodes, run.spin.pos);
      if (!moved && run.spinRender) run.spinRender();
    }
  }

  /* Resolved here rather than in the HUD so the renderer stays pure and does
     not reach into the ledger every frame. Cheap: a null id short-circuits. */
  run.crate = run.carrying ? PL.batchById(run.carrying) : null;
  HUD.refresh(run.nodes, run);
  if (run.scene) { try { run.scene.frame(dt, run); } catch (e) {} }
}

function loop() {
  if (!RUN) return;
  try { frame(RUN, performance.now()); } catch (e) { try { console.warn('[biolab] frame', e); } catch (e2) {} }
  RUN.raf = requestAnimationFrame(loop);
}

/* ══ PUBLIC API ════════════════════════════════════════════════════════════ */

export async function open(opts) {
  const o = opts || {};
  if (RUN) return { ok: true, already: true };
  injectCss();

  /* Which strain is on the bench. Caller's choice wins; otherwise the worst
     active one, because that is the one the player came here about. A lab with
     no strain still opens — you can walk it, learn it, and ship an old batch. */
  let strain = null;
  try {
    const list = PL.activeStrains();
    strain = o.strainId ? list.find((s) => s.id === o.strainId) || null
           : list.slice().sort((a, b) => b.severity - a.severity)[0] || null;
    /* Nothing loose in the city — fall back to the shelf, most recently
       sampled first, so a player who came back to finish a batch walks in on
       the strain they were working rather than an empty bench. An explicit
       o.strainId can also name a sample. */
    if (!strain) {
      const shelf = PL.sampleStrains().slice().sort((a, b) => (b.sampledAt || 0) - (a.sampledAt || 0));
      strain = o.strainId ? shelf.find((s) => s.id === o.strainId) || null : shelf[0] || null;
    }
  } catch (e) {}

  const root = document.createElement('div');
  root.className = 'bl-root';
  document.body.appendChild(root);
  const nodes = HUD.mountHud(root);

  const run = newRun(strain);
  run.root = root;
  run.nodes = nodes;
  RUN = run;

  // ── 3D, best effort. A failure here downgrades the room, never the feature.
  const THREE = o.flat ? null : await ensureThree();
  if (!RUN || RUN !== run) return { ok: false };        // closed during the load
  if (THREE) {
    try { run.scene = build(THREE, nodes.canvas); } catch (e) { run.scene = null; }
  }
  /* Characters load AFTER the room is up and walkable, deliberately not
     awaited: the box avatar covers the gap, and trading a playable lab for a
     loading screen to gain a model the player has not looked at yet is a bad
     trade. They pop in when they arrive. */
  if (run.scene && run.scene.loadCharacters) {
    run.scene.loadCharacters().then((c) => {
      if (!RUN || RUN !== run) return;
      if (c && (c.bare || c.suit)) { HUD.toast(nodes, '🧑‍🔬 Field team model loaded.', ''); return; }
      /* 🔴 SAY SO ON SCREEN. A silent fall back to the box avatar is
         indistinguishable from a bug, and was reported as one twice. The
         player gets the reason and the game keeps working. */
      HUD.toast(nodes, '⚠ ' + ((c && c.why) || 'Character models unavailable') +
        ' — using the placeholder figure. Everything else works.', 'warn');
    }).catch((e) => {
      if (!RUN || RUN !== run) return;
      HUD.toast(nodes, '⚠ Character models failed to load — using the placeholder figure.', 'warn');
    });
  }
  if (!run.scene) {
    run.flat = true;
    root.classList.add('is-flat');
    nodes.flatnote.innerHTML =
      '<div><b style="color:#7fd6ff">THE ROOM DID NOT LOAD</b><br><br>' +
      'This device could not start WebGL, so the lab is running without the walk.<br>' +
      'Every station is still here — use the buttons below.<br><br>' +
      STATIONS.map((s) => '<button class="bl-btn" data-jump="' + HUD.esc(s.key) + '" style="margin:3px">' +
        HUD.esc(s.icon + ' ' + s.name) + '</button>').join('') + '</div>';
    /* In flat mode the buttons TELEPORT the player to the station rather than
       bypassing the stations, so the suit gate, the exposure meter and the hot
       zone all still apply. A fallback that skipped the hazmat rule would be a
       fallback that skips the feature. */
    nodes.flatnote.addEventListener('click', (e) => {
      const b = e.target.closest('[data-jump]');
      if (!b) return;
      const s = stationByKey(b.getAttribute('data-jump'));
      if (!s) return;
      run.player.x = s.pos[0];
      run.player.z = s.pos[1] - (s.size[1] / 2 + 1.4);
      run.near = nearest(run.player.x, run.player.z, 3.2);
      interact(run);
    });
  }

  // ── input
  run.detach = attachInput(root, run.input, {
    onInteract: () => { if (!HUD.modalOpen(nodes)) interact(run); },
    onExit: () => { if (HUD.modalOpen(nodes)) HUD.closeModal(nodes); else close(); },
  });
  root.querySelector('[data-act="exit"]').addEventListener('click', () => close());
  nodes.act.addEventListener('click', () => { if (!HUD.modalOpen(nodes)) interact(run); });

  const onResize = () => { if (run.scene) run.scene.resize(); };
  window.addEventListener('resize', onResize);
  run.onResize = onResize;

  // ── landed shipments waiting for the player. Announced on entry because the
  //    dispatch bay is where they are collected and this is the door to it.
  try {
    const due = PL.dueShipments();
    if (due.length) HUD.toast(nodes, '📦 ' + due.length + ' shipment' + (due.length === 1 ? ' has' : 's have') +
      ' landed. Collect at the Dispatch Bay.', 'good');
  } catch (e) {}

  if (strain) {
    HUD.toast(nodes, '🦠 ' + strain.name + ' (' + strain.isolate + ') is on the bench. Sequence it first.', '');
  } else {
    HUD.toast(nodes, '🗄 Your city is clean. Press E at the Sequencer to open the register and pick ' +
      'a virus to make cures for — you do not need an outbreak of your own.', '');
  }
  HUD.toast(nodes, '🥽 Hot benches will not run without a sealed suit. The airlock is behind you.', 'warn');

  run.raf = requestAnimationFrame(loop);

  /* 🚚 `at` drops the player straight at a station. Used by
     cityEnterBusiness('transport'), where the player is the HAULIER and came
     for the waybills, not the chemistry — walking them across the room to the
     bay first would be ceremony, not gameplay.
     🔴 IT PLACES THEM AND THEN INTERACTS — it does NOT call the panel directly.
     Going straight to the panel would bypass the suit gate, and a shortcut
     that skips the hazmat rule is a shortcut that skips the feature. A cold
     entry at a HOT bench therefore lands on the refusal, exactly as walking
     there would. */
  if (o.at) {
    const s = stationByKey(o.at);
    if (s) {
      run.player.x = s.pos[0];
      run.player.z = s.pos[1] - (s.size[1] / 2 + 1.5);
      run.near = nearest(run.player.x, run.player.z, 3.2);
      interact(run);
    }
  }

  return { ok: true, flat: run.flat, strain: strain ? strain.id : null };
}

export function close() {
  const run = RUN;
  if (!run) return false;
  RUN = null;
  try { if (run.raf) cancelAnimationFrame(run.raf); } catch (e) {}
  try { if (run.detach) run.detach(); } catch (e) {}
  try { if (run.onResize) window.removeEventListener('resize', run.onResize); } catch (e) {}
  try { if (run.scene) run.scene.dispose(); } catch (e) {}
  try { run.root.remove(); } catch (e) {}
  return true;
}

export function isOpen() { return !!RUN; }

/* Collect a landed shipment. Exposed here as well as inside the bay because
   the game's Operations screen wants the same action without a 3D room. */
export function collect(host, shipmentId) {
  const r = PL.collect(host || cityHost(), shipmentId);
  if (r.ok) {
    for (const n of r.notes) toastGame(n, 6000);
    if (r.medicine) toastGame('💊 +' + r.medicine + ' Medicine from the delivered doses.', 4200);
  }
  return r;
}

/* ── who the outbreak is happening to ─────────────────────────────────────
   The city builder is a SEPARATE PAGE (public/node-city/), so when the lab is
   opened from the game the citizen roster is genuinely not reachable from
   here. `cityHost()` uses the city's own adapter if it happens to be in this
   window and otherwise hands back a host with nobody in it.

   🔴 AN EMPTY HOST IS NOT A DROPPED STRAIN. introduce() queues a strain it
   cannot seed (see `pending` in outbreak.js) and it takes hold the first time
   the city ticks with people in it. That queue is what makes "the crate I
   collected on the Operations screen gave the city a new virus" work at all —
   without it the usual case would silently do nothing. */
function cityHost() {
  try {
    const O = (typeof window !== 'undefined') && window.MythicOutbreak;
    if (O && typeof O._host === 'function') return O._host();
  } catch (e) {}
  return nullHost();
}
function nullHost() {
  return { citizens: () => [], vitals: () => ({}), coverage: () => ({}), pop: () => 0, popCap: () => 1, nudge: () => false };
}

const api = {
  open, close, isOpen, collect,
  // Read-through to the domain layer, so a caller holding MythicBioLab does
  // not need to know /src/plague exists.
  plague: PL,
  stations: STATIONS,
  objectives: OBJECTIVES,
  /* 🔬 Test seam. The Browser pane never composites (CLAUDE.md), so nothing
     driven by requestAnimationFrame can be observed there. `_run()` hands back
     the live state and `_step(ms)` advances one frame by hand, which is the
     only way any of this is verifiable in this environment. */
  _run: () => RUN,
  /* `wall` is injectable precisely because the suit runs on the wall clock:
     without it a driver cannot advance a seal without really waiting 2.6
     seconds, which is why the clock-mismatch blocker went unnoticed. Drive a
     full donning with _step(16, Date.now() + n) for increasing n. */
  _step: (ms, wall) => { if (RUN) frame(RUN, (RUN.lastFrame || 0) + (ms || 16), wall); },
  _interact: () => { if (RUN) interact(RUN); },
  _preview: () => (RUN ? preview(RUN) : null),
  /* 🔄 If the character walks backwards, this is the one knob. `rotation.y` is
     set from atan2(vx, vz), so at yaw 0 the mesh must face +z — and exporters
     disagree about which way that is. Try Math.PI first. It applies live. */
  _setModelYaw: (rad) => setModelYaw(rad),
  /* 🎥 Chase-camera framing, live. `_setCamera(10.5, 9)` is the shipped value;
     larger numbers pull back toward the old box-avatar framing. */
  _setCamera: (y, back) => setCamera(y, back),
  // Which of the four GLTFLoader sources actually worked — 'inline', 'blob',
  // 'vendored', 'cdn', 'already-present', or null if none did.
  _gltfVia: () => gltfVia(),
  _chars: () => (RUN && RUN.scene ? RUN.scene.chars : null),
};

try { if (typeof window !== 'undefined') window.MythicBioLab = api; } catch (e) {}
export default api;
