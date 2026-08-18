/* ══ 🛣 NAMED STREETS ═══════════════════════════════════════════════════════
   Click a road, get the street. Every road in the city is named the moment it
   exists, the name persists, the player can change it, and the panel's four
   readouts plus its two charts are all derived from things the simulation
   actually did.

   ── HOW THIS ATTACHES ─────────────────────────────────────────────────────
   🔴 THE GLOBALS TRAP (CLAUDE.md). node-city's `game`, `BUILDINGS`, `THREE`,
   `scene`, `HALF`, `hourOf`, `AGENTS`, `costOf`, `logEsc` and the whole
   inspector helper family are top-level `const` in a <script type="module">.
   They are LEXICAL bindings; they are not on window and never will be. The ctx
   object handed to mount() IS the hand-over — this file reaches for no global
   of the host's, ever. Four modules have now paid for that lesson.

   ── WHAT IT TOUCHES IN THE HOST ───────────────────────────────────────────
   Nothing. It reads game.tiles; it writes to no tile, no ledger and no mesh
   that is not its own. Road wear here is this module's own reading (see
   tuning.js) and is never written back to t.wear — a UI feature must not invent
   a failure mode.

   ── DEGRADING ─────────────────────────────────────────────────────────────
   A 404 on this file costs the player street names and the road panel. The
   host's road branch falls through to its ordinary tile dossier, the save
   carries the streets blob forward untouched (index.html keeps the raw object
   and re-serialises it), and nothing else changes.                            */

import { STREET } from './tuning.js';
import { segment } from './segment.js';
import { generateName, sanitiseName } from './naming.js';
import { createMeter } from './traffic.js';
import { createLabels } from './labels.js';
import * as panel from './panel.js';

/* A name is stored per (axis, tile), not per street.

   WHY NOT PER STREET: a street has no stable identity. Extend it and its length
   changes; demolish a tile in the middle and it becomes two; build across it and
   a junction appears. Any street-shaped key would rename the player's road out
   from under them on the next edit — which is the one thing a name must never
   do. Tiles ARE stable, so the name lives on them and a street simply reads the
   name its tiles already carry.

   The axis prefix is what lets a crossroads work: tile "5,5" can hold both
   "x@5,5" => Maple Avenue and "z@5,5" => Kestrel Street, because the tile really
   is part of both roads. Without it the two streets would fight over one key and
   flip names on every rescan. */
const nameKey = (axis, tileKey) => axis + '@' + tileKey;

export function mount(ctx) {
  const game = ctx.game;
  const meter = createMeter(ctx);
  /* 🏷 Labels are the one part of this feature that needs THREE, a scene and a
     canvas. If any of those is missing or misbehaves, the player loses the names
     painted on the road and KEEPS the panel, the naming and the charts — a
     decoration must never be able to take the feature down with it. */
  let labels;
  try { labels = createLabels(ctx); }
  catch (e) {
    console.warn('[streets] world labels unavailable (non-fatal):', e);
    labels = { sync: () => false, setEnabled: () => false, isEnabled: () => false,
               orient: () => 0, count: () => 0, dispose: () => {} };
  }
  const names = new Map();          // "x@5,5" -> "Maple Avenue"

  let graph = null;                 // { streets, primary }
  let lastSig = '';
  let sinceScan = 1e9;
  let sinceOrient = 1e9;            // 🏷 label re-facing timer, see orientLabels()
  let nameEpoch = 0;                // bumped on any rename, forces a label rebuild
  let autoSalt = 0;
  let uiTab = 'ov';
  let dirty = false;                // something worth saving changed

  const isRoad = (x, z) => {
    const t = game.tiles[x + ',' + z];
    return !!t && t.type === 'road';
  };

  /* ── the street graph ───────────────────────────────────────────────────
     Rebuilt only when the set of road tiles actually changed. The signature is
     order-independent (a sum, not a concatenation) because Object.keys order is
     not a contract, and a signature that flickered with key order would rebuild
     every label plane every rescan. */
  function scan(force) {
    const roadKeys = [];
    let sum = 0, n = 0;
    for (const k in game.tiles) {
      if (game.tiles[k].type !== 'road') continue;
      roadKeys.push(k);
      n++;
      const c = k.indexOf(',');
      sum += (+k.slice(0, c) + 1) * 977 + (+k.slice(c + 1) + 1) * 31;
    }
    const sig = n + ':' + sum;
    // The meter's capacity model needs the size of the road network; this loop
    // has just counted it, so hand it over rather than counting twice.
    meter.setNetwork(n);
    if (!force && graph && sig === lastSig) return graph;
    lastSig = sig;
    graph = segment(roadKeys, isRoad);
    assignNames(graph.streets);
    labels.sync(sig + '|' + nameEpoch, graph.streets, st => nameOf(st), false);
    return graph;
  }

  /* Read the name a street already has: the majority vote of its own tiles.
     A majority rather than "whatever the first tile says" so that extending a
     street (new tiles start unnamed) or merging two (the longer contributes
     more tiles) lands on the answer a player would expect. */
  function votedName(st) {
    const tally = new Map();
    for (const k of st.tiles) {
      const v = names.get(nameKey(st.axis, k));
      if (!v) continue;
      tally.set(v, (tally.get(v) || 0) + 1);
    }
    if (!tally.size) return null;
    let best = null, bestN = -1;
    for (const [v, c] of tally) {
      // Deterministic tie-break: more tiles wins, then lexicographic. Never
      // insertion order — that would differ between a fresh load and a live
      // edit and the name would appear to change by itself.
      if (c > bestN || (c === bestN && v < best)) { best = v; bestN = c; }
    }
    return best;
  }

  function stamp(st, name) {
    for (const k of st.tiles) names.set(nameKey(st.axis, k), name);
  }

  function assignNames(streets) {
    /* Deterministic order: longest first, then axis, then anchor. This decides
       who KEEPS a name when a street splits in two and both halves vote for it,
       so it has to be stable across a reload. */
    const ordered = streets.slice().sort((a, b) =>
      (b.len - a.len) || (a.axis < b.axis ? -1 : a.axis > b.axis ? 1 : 0) ||
      (a.anchor < b.anchor ? -1 : a.anchor > b.anchor ? 1 : 0));
    const taken = new Set();
    for (const st of ordered) {
      let name = votedName(st);
      if (name && taken.has(name.toLowerCase())) {
        /* The street was split. The half that sorts first kept the name; this
           one is genuinely a different street now and gets its own. */
        name = null;
      }
      if (!name) {
        name = generateName(st.anchor, { len: st.len, junctions: st.junctions }, taken);
        dirty = true;
      }
      taken.add(name.toLowerCase());
      stamp(st, name);
    }
    /* Prune names for tiles that are no longer part of any street — a demolished
       road takes its name with it, and without this the save would accumulate
       every name the city ever had. */
    if (names.size > streets.reduce((a, s) => a + s.tiles.length, 0) * 2 + 64) {
      const live = new Set();
      for (const st of streets) for (const k of st.tiles) live.add(nameKey(st.axis, k));
      for (const k of [...names.keys()]) if (!live.has(k)) names.delete(k);
    }
  }

  function nameOf(st) { return votedName(st) || ''; }

  /* ── derived readouts ───────────────────────────────────────────────────
     Every field says where it came from. Nothing here is a constant that is not
     in tuning.js, and nothing is a number with no source. */
  function wearOfTile(k) {
    const life = meter.lifeOf(k);
    // Counted vehicle passes -> wear. Capped, never written back to the tile.
    let wear = Math.min(STREET.WEAR_CAP, (life / 1000) * STREET.WEAR_PER_1K_PASSES);
    // If the host ever DOES wear or damage a road (decayTick skips roads today,
    // but a raid or a future rule might not), its state wins — this module must
    // not report a healthy road the game considers broken.
    const t = game.tiles[k];
    if (t) {
      if (t.damaged) return { wear: 100, life, damaged: true };
      if (Number.isFinite(+t.wear)) wear = Math.max(wear, +t.wear);
    }
    return { wear, life, damaged: false };
  }

  /* 🔴🔴 CONDITION IS AGGREGATED EXACT AND ROUNDED LAST. READ BEFORE "TIDYING"
     Math.round BACK ONTO THE PER-TILE LINE — that one call is what made this
     readout dead for two rounds, and it did NOT look like a bug.

     The wear model was never wrong. Measured on the standard district (the
     numbers in tuning.js, re-measured with .gauntlet/drive-streets.mjs and they
     hold): the busiest tile takes ~0.47 counted passes per CITY second, so one
     1,200-second cycle costs it ~2.8 points and an average tile ~1.1. That is a
     readout that moves inside a session, and it is exactly what
     check-streets-clock.mjs §10 asserts.

     It never reached the panel. `condition` was `Math.round(100 - wear)` PER
     TILE, and min/max/avg were then computed over those ROUNDED values — so
     every tile under half a point of wear collapsed to exactly 100, min and max
     were both exactly 100, and `avg` was the mean of a list of 100s, i.e. the
     integer 100. `avgExact` was handed to the panel's fmtAvg — a formatter
     written specifically to print "99.4" instead of "99" — with an input that
     had already been rounded to 100. The decimal could never appear. The panel
     printed a bare "100%" with "100% average" under it in a city whose busiest
     tile had genuinely lost a quarter of a point, and every attempt to fix it
     by RAISING WEAR_PER_1K_PASSES (1.6 → 5.0) only moved the threshold from 625
     passes to 200 — both of them more than a verifier's drive produces, which is
     why the retune measured correctly and still changed nothing on screen.

     So: aggregate the exact values, hand the exact values out, and let the
     PANEL decide how many digits to show (it already knows — fmtAvg). The
     rounded fields stay for any caller that wants an integer, and the tile rows
     carry both.
     ⚠ The invariant a future edit must keep: nothing in this function may round
       before the min/max/sum, and nothing outside it may be handed only the
       rounded form. check-streets-clock.mjs §11 drives this exact path with a
       counted pass load and fails if a sub-point change is invisible. */
  function statsFor(st, tileKey) {
    const traffic = meter.series(st.tiles);
    const tiles = st.tiles.map(k => {
      const w = wearOfTile(k);
      const cond = 100 - w.wear;
      return { k, life: w.life, wear: w.wear, damaged: w.damaged,
               condition: Math.round(cond), condExact: cond };
    });
    let min = 100, max = 0, sum = 0, life = 0;
    for (const t of tiles) {
      min = Math.min(min, t.condExact); max = Math.max(max, t.condExact);
      sum += t.condExact; life += t.life;
    }
    const avg = tiles.length ? sum / tiles.length : 100;
    const wearAvg = 100 - avg;

    /* UPKEEP. The road's REAL build cost, read from the host, times the length,
       times the stated per-cycle fraction, scaled by wear. Quoted, not billed —
       see the honesty note on STREET.UPKEEP_PCT_PER_CYCLE. */
    let build = 0;
    try { build = +ctx.roadCost() || 0; } catch (e) { build = 0; }
    /* ⚠ NOT ROUNDED UP TO 1. A road costs 4 Cinder, so a three-tile lane really
       does cost fractions of a Cinder a cycle, and flooring it at "1" would be
       the panel inventing a bill. The formatter shows a decimal instead. */
    const upkeep = st.len * build * STREET.UPKEEP_PCT_PER_CYCLE *
                   (1 + (wearAvg / 100) * STREET.UPKEEP_WEAR_SCALE);

    let peakFlow = 0, peakVolume = 0;
    for (let i = 0; i < STREET.BUCKETS; i++) {
      if (!traffic.seen[i]) continue;
      if (traffic.flow[i] > peakFlow) peakFlow = traffic.flow[i];
      if (traffic.volume[i] > peakVolume) peakVolume = traffic.volume[i];
    }
    /* The chart's "now" marker. THE CITY CYCLE'S HOUR, not ctx.hour() — the EST
       wall hour used to be read here and it put the marker at a position on an
       axis that no longer means wall time. Two clocks on one chart is how a
       player learns to trust neither. */
    const hour = meter.cycleHour();

    /* 🏚 WEAR PER CYCLE — the RATE, beside the accumulated total.
       Condition is a lifetime accumulation, so on a young street it is a small
       number that moves slowly, and a player watching it for a minute cannot
       tell a busy road from a quiet one. This is the same wear arithmetic
       applied to the traffic the meter has actually OBSERVED, projected over one
       cycle: it separates "this road is worn" from "this road is wearing", and
       it moves the moment the traffic does. Derived from counted passes and
       STREET.WEAR_PER_1K_PASSES exactly like the total — no second constant. */
    let wearRate = 0, meanVolume = 0;
    if (traffic.observedBuckets) {
      /* The MEAN of the observed hours, not the peak. "At this traffic" has to
         mean the traffic, and projecting the busiest hour across a whole cycle
         would quote a wear rate the street has never actually sustained. */
      let sum = 0;
      for (let i = 0; i < STREET.BUCKETS; i++) if (traffic.seen[i]) sum += traffic.volume[i];
      meanVolume = sum / traffic.observedBuckets;
      // volume is per city hour past a point; a cycle is BUCKETS of them.
      wearRate = (meanVolume * STREET.BUCKETS / 1000) * STREET.WEAR_PER_1K_PASSES;
    }

    return { name: nameOf(st) || 'Unnamed Road', tileKey, traffic, tiles,
             capParts: meter.capacityParts(),
             condition: { min: Math.round(min), max: Math.round(max), avg: Math.round(avg),
                          minExact: min, maxExact: max, avgExact: avg },
             wearAvg, upkeep, lifePasses: life, peakFlow, peakVolume, meanVolume, hour,
             buildCost: build, wearRate, cycleMin: meter.cycleSec() / 60 };
  }

  /* ── rename ─────────────────────────────────────────────────────────────
     Player-authored text. Sanitised here (naming.js) and escaped again at every
     render site — the position index.html's costLabel comment argues for. */
  function rename(st, raw) {
    const clean = sanitiseName(raw);
    if (!clean) { ctx.toast('A street needs a name.', 'bad'); return false; }
    const cur = nameOf(st);
    if (clean === cur) return true;
    const g = graph || scan(true);
    for (const other of g.streets) {
      if (other === st) continue;
      if ((nameOf(other) || '').toLowerCase() === clean.toLowerCase()) {
        ctx.toast('The city already has a ' + clean + '.', 'bad');
        return false;
      }
    }
    stamp(st, clean);
    nameEpoch++; dirty = true;
    labels.sync(lastSig + '|' + nameEpoch, g.streets, s => nameOf(s), true);
    try { ctx.saveSoon(); } catch (e) {}
    ctx.toast('🛣️ ' + cur + ' is now ' + clean + '.', 'good');
    return true;
  }

  function autoRename(st) {
    const g = graph || scan(true);
    const taken = new Set();
    for (const other of g.streets) {
      if (other === st) continue;
      const n = nameOf(other); if (n) taken.add(n.toLowerCase());
    }
    const cur = nameOf(st); if (cur) taken.add(cur.toLowerCase());
    const name = generateName(st.anchor + '/' + (++autoSalt),
      { len: st.len, junctions: st.junctions }, taken);
    stamp(st, name);
    nameEpoch++; dirty = true;
    labels.sync(lastSig + '|' + nameEpoch, g.streets, s => nameOf(s), true);
    try { ctx.saveSoon(); } catch (e) {}
    return name;
  }

  /* ── the panel ──────────────────────────────────────────────────────────
     Called from openInspect's road branch. Returns true when it took over the
     dossier; false means "not a road I know about", and the host renders its own
     tile view, which is the correct fallback and not an error. */
  function renderInspect(k) {
    const g = scan(true);
    const st = g.primary.get(k);
    if (!st) return false;
    panel.ensureStyle();
    const stats = statsFor(st, k);
    const r = panel.render(ctx, st, stats, uiTab);
    uiTab = r.tab;
    wire(st, k);
    return true;
  }

  function wire(st, k) {
    const $ = ctx.$;
    const inp = $('st-name'), save = $('st-save'), auto = $('st-auto');
    if (save) save.onclick = () => { if (rename(st, inp ? inp.value : '')) renderInspect(k); };
    if (auto) auto.onclick = () => { autoRename(st); renderInspect(k); };
    if (inp) inp.onkeydown = (ev) => {
      // Enter renames; Escape must NOT bubble to the host's global handler and
      // close the whole dossier out from under a half-typed name.
      if (ev.key === 'Enter') { ev.preventDefault(); if (rename(st, inp.value)) renderInspect(k); }
      if (ev.key === 'Escape') { ev.stopPropagation(); inp.value = nameOf(st); inp.blur(); }
    };
    /* The footer is the host's. A street has no level, rotation or repair, but
       demolition still applies to the TILE the player clicked — relabelled so
       nobody expects the whole street to disappear. */
    const dem = $('btn-demolish');
    if (dem) {
      dem.style.display = 'block';
      dem.textContent = '🧨 Demolish this road tile' +
        (ctx.roadDemolishCost != null ? ' — ' + ctx.roadDemolishCost + ' ₵' : '');
    }
    // The tab strip is rebuilt by the host's helpers, so re-observe the choice.
    try {
      $('instabs').querySelectorAll('button').forEach(b => {
        b.addEventListener('click', () => { uiTab = b.dataset.tab; }, { once: false });
      });
    } catch (e) {}
  }

  /* ── save / load ────────────────────────────────────────────────────────
     Compact: a name table plus an index per (axis,tile), so a city where every
     street is one name costs one copy of that string. The traffic rings encode
     themselves (traffic.js). */
  function save() {
    try {
      if (graph) scan(false);
      const table = [], idx = new Map(), t = {};
      for (const [k, v] of names) {
        let i = idx.get(v);
        if (i === undefined) { i = table.length; idx.set(v, i); table.push(v); }
        t[k] = i;
      }
      const tr = meter.save();
      return { v: 1, n: table, t, tr: tr.tr, ob: tr.ob, lbl: labels.isEnabled() ? 1 : 0 };
    } catch (e) { return null; }
  }

  function load(blob) {
    if (!blob || typeof blob !== 'object') return;
    try {
      const table = Array.isArray(blob.n) ? blob.n : [];
      const t = (blob.t && typeof blob.t === 'object') ? blob.t : {};
      names.clear();
      for (const k in t) {
        // Sanitise on the way OUT of the save too: a save can be hand-edited in
        // localStorage, and this string is rendered.
        const raw = table[t[k] | 0];
        const clean = sanitiseName(raw);
        if (clean && /^[xz]@-?\d+,-?\d+$/.test(k)) names.set(k, clean);
      }
      meter.load(blob);
      if (blob.lbl === 0) labels.setEnabled(false);
    } catch (e) { /* a corrupt blob costs names and history, never the city */ }
  }

  /* 🧭 KEEP THE ROAD PAINT THE RIGHT WAY UP AS THE PLAYER ORBITS.
     A street label reads correctly only when its own direction agrees with the
     camera's right vector; a north-south street and an east-west street cannot
     both agree with the same camera, which is the whole of the round-2
     "mirrored street text" artefact (labels.js has the full account). So the
     orientation is a function of the CAMERA, not a constant, and it is refreshed
     here rather than in the render loop.
     ⚠ ctx.camera IS OPTIONAL, and that is deliberate: a host that never handed
       one over gets labels at their build-time orientation and everything else
       in this module works exactly as before. Reaching for a bare global camera
       instead is the trap CLAUDE.md opens with. */
  function orientLabels() {
    const cam = ctx.camera;
    if (!cam || !cam.matrixWorld) return;
    /* Column 0 of a Matrix4 IS the right vector, and THREE stores column-major:
       elements[0], [1], [2] are its x, y, z. Projected onto the ground plane by
       simply dropping y — the labels are flat, so only the XZ heading matters. */
    const e = cam.matrixWorld.elements;
    try { labels.orient(e[0], e[2]); } catch (err) { /* decoration, never fatal */ }
  }

  /* ── the per-frame half ─────────────────────────────────────────────────
     Two calls from agentTick and nothing else. `tick` is the observed-time
     clock and the rescan timer; `countPass` is the meter's hot path. */
  function tick(dt) {
    meter.tick(dt);
    const ms = (+dt || 0) * 1000;
    sinceScan += ms;
    if (sinceScan >= STREET.RESCAN_MS) { sinceScan = 0; scan(false); }
    sinceOrient += ms;
    if (sinceOrient >= STREET.LABEL_ORIENT_MS) { sinceOrient = 0; orientLabels(); }
  }

  const API = {
    /* Hot path — one array increment. See traffic.js. */
    countPass: (k, kind) => meter.count(k, kind),
    tick,
    save, load,
    renderInspect,
    /* ── read-only seam, for the console and the harness ── */
    streets: () => scan(true).streets,
    streetAt: (k) => scan(true).primary.get(k) || null,
    nameAt: (k) => { const st = scan(true).primary.get(k); return st ? nameOf(st) : null; },
    statsAt: (k) => { const st = scan(true).primary.get(k); return st ? statsFor(st, k) : null; },
    rename: (k, name) => { const st = scan(true).primary.get(k); return st ? rename(st, name) : false; },
    autoName: (k) => { const st = scan(true).primary.get(k); return st ? autoRename(st) : null; },
    setLabels: (on) => { const v = labels.setEnabled(on); const g = scan(true);
                         labels.sync(lastSig + '|' + nameEpoch, g.streets, s => nameOf(s), true);
                         dirty = true; return v; },
    labelCount: () => labels.count(),
    /* Re-face the paint NOW rather than on the next tick — the harness moves the
       camera by hand and never runs a frame loop, so without this the shot is
       taken at whatever orientation the last build chose. */
    orientLabels,
    rescan: () => scan(true),
    isDirty: () => dirty,
    /* 🕰 WHICH CLOCK THE RING IS ON, in one call. The last build bucketed on EST
       wall time and the charts could never fill; nothing on the panel said which
       clock it was, so the only way to find out was to read the source. A seam
       that answers it directly is what makes "the ring keys on the city cycle"
       something a test can assert rather than something a reviewer has to
       believe. Read-only. */
    clock: () => ({
      cityAge: +(game.cityAge || 0),
      cycleMin: meter.cycleSec() / 60,
      hourSec: meter.hourSec(),
      cycleHour: meter.cycleHour(),
      bucket: Math.min(STREET.BUCKETS - 1, Math.floor(meter.cycleHour())),
      minObservedSec: meter.hourSec() * STREET.MIN_OBSERVED_FRAC,
    }),
    /* 🔬 Debug seams — see the header on traffic.js's _debugProfile. These
       WRITE traffic that nobody drove, so they exist to prove the renderer and
       for nothing else. No shipped path calls them. */
    _inject: (k, kind, n, seconds) => meter._debugInject(k, kind, n, seconds),
    _profile: (tiles, profile, secs) => meter._debugProfile(tiles, profile, secs),
    _meter: meter,
    TUNING: STREET,
  };

  load(ctx.saved);
  scan(true);
  return API;
}

export default { mount };
