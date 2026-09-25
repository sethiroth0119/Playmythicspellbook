/* ════════════════════════════════════════════════════════════════════════════
   🚦 THE GROWTH GATE — one verdict, in one sentence, for every surface.
   ----------------------------------------------------------------------------
   node-city grows `game.pop.npc` only while Food, Water and Health coverage are
   ALL at or above POP_GROW_AT, and shrinks it when any one falls under
   POP_DECLINE_AT. That is a DESIGN DECISION and this file does not argue with
   it: build the services, then the density.

   🔴 WHAT THIS FILE EXISTS TO FIX IS THE SILENCE, NOT THE RULE. Zone a district
      of towers in a city sitting at 62% food and nothing happens — no toast, no
      caption, no number moves — because the module's ceiling is `cityPop()` and
      `cityPop()` is not allowed to rise. The player is looking at a tool that
      appears broken. A silent gate is indistinguishable from a bug, which this
      project has now learned three separate times.

   🔴 AND THERE IS EXACTLY ONE EXPLANATION. `verdict()` builds the sentence; the
      People tab, the demand meter's causal list, the zoning panel and the map
      film all print THAT ONE. A second re-derivation somewhere else is how two
      panels come to hold two opinions about one city — the failure /src/hud's
      demand.js opens with, and the reason `residential()` over there prints
      /src/demographics' cause list verbatim instead of re-deriving it.

   ⚠ NOTHING IS READ OFF A GLOBAL HERE. The raw gate arrives through the tick's
     host ctx (`demogGrowth()` in node-city). `game`, `POP_GROW_AT` and
     `NEED_META` are top-level `const` in the host's module script and invisible
     to an ES module — the globals trap, CLAUDE.md.

   ⚠ NO THRESHOLD IS WRITTEN DOWN IN THIS FILE. `grow` and `fall` arrive from
     the host every tick. A copy of 0.90 here is the number that goes stale the
     day somebody retunes the host's growth model, and it would go stale
     silently, printing a confident wrong percentage.

   ⚠ ABSENT ⇒ SILENT, NOT ⇒ BLOCKED. An older node-city that passes no `growth`
     (or a driver calling tick() with two fields) yields `ok:false`, and every
     consumer then prints exactly what it printed before this file existed. A
     missing hand-over must never be read as a hostile fact about the city —
     the same contract `commuteAccess()` keeps for /src/transit.
   ════════════════════════════════════════════════════════════════════════════ */

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
const pct = (v) => Math.round(v * 100) + '%';

/* The verdict the whole feature is: is the host's population allowed to rise,
   and if not, which of its three gates is short and by how much.

   Shape:
     { ok, open, reason, pop, cap, grow, fall, ramping, rampLeftMin,
       atCap, needs:[{k,name,ico,cov,short,gap,fix}], short:[the short ones],
       worst, headline, text, chip }
   `ok:false` means "nothing to say" and every caller must treat it as such. */
export function verdict(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, open: true };
  const grow = num(raw.grow), fall = num(raw.fall);
  if (grow == null) return { ok: false, open: true };

  const pop = num(raw.pop), cap = num(raw.cap);
  const ramping = !!raw.ramping;
  const rampLeftMin = Math.max(0, Math.ceil((num(raw.rampLeftSec) || 0) / 60));

  const needs = (Array.isArray(raw.needs) ? raw.needs : []).map((n) => {
    const c = num(n && n.cov);
    return {
      k: n.k, name: n.name || n.k, ico: n.ico || '',
      cov: c,
      /* ⚠ A NEED WITH NO READING IS NOT A NEED THAT IS SHORT. `cov:null` means
         the host did not report that coverage this tick (a boot frame, a
         module that has not solved yet). Reading it as 0 would print
         "Water coverage is 0%" at the top of a healthy city. */
      short: c != null && c < grow,
      gap: c != null && c < grow ? grow - c : 0,
      fix: Array.isArray(n.fix) ? n.fix : [],
    };
  });
  const short = needs.filter((n) => n.short).sort((a, b) => a.cov - b.cov);
  /* 🏠 The housing ceiling is a SEPARATE block with a different fix, and it is
     checked second because it is the one the game already says out loud (the
     Vital Signs card prints "at housing capacity"). The coverage gate is the
     silent one. */
  const atCap = pop != null && cap != null && pop >= cap;
  const open = short.length === 0 && !atCap;

  const out = {
    ok: true, open, pop, cap, grow, fall, ramping, rampLeftMin,
    atCap, needs, short, worst: short[0] || null,
    reason: short.length ? 'coverage' : atCap ? 'beds' : null,
  };
  out.headline = headlineOf(out);
  out.text = textOf(out);
  out.chip = chipOf(out);
  return out;
}

/* "Food 62% / 90%" — the glanceable form, for a chip or a map legend. */
function chipOf(v) {
  if (!v.ok || v.open) return '';
  if (v.reason === 'beds') return 'At housing capacity ' + Math.round(v.pop) + '/' + Math.round(v.cap);
  const w = v.worst;
  return (w.ico ? w.ico + ' ' : '') + w.name + ' ' + pct(w.cov) + ' / ' + pct(v.grow);
}

/* The first clause — what the player is looking at. Kept separate from the
   numbers so a cramped surface can print the headline alone and still be
   telling the truth. */
function headlineOf(v) {
  if (!v.ok) return '';
  if (v.open) return 'Zoned land will fill — the city is allowed to grow.';
  return 'Zoned, but nothing will move in.';
}

/* 🔴 THE SENTENCE. It names the fix, not just the block: which coverage is
   short, by how much, and the cheapest thing that raises it. "No demand" is not
   something a player can act on; "Health is 0% and growth needs 90% — build a
   Clinic" is.

   🔴 AND IT IS FRONT-LOADED, WHICH IS NOT A STYLE CHOICE. This one string is
      printed by four surfaces and ONE OF THEM CLAMPS IT: the always-on Zone
      Demand dock styles `.ddlimit` with `-webkit-line-clamp:2` (and :1 under
      700px of viewport height) — /src/hud/css.js, another round's file. The
      first draft put the shortfall list first and the FIX last, and the dock
      cut the frame at "…and growth needs 90% on Food,…" — photographed. A
      caption that is clipped before it reaches the actionable half has not
      ended the silence, it has moved it. So the WORST need, the threshold and
      the cheapest fix all land inside the first clause, and everything else —
      the other shortfalls, the statement of the rule — comes after, where being
      clipped costs nothing.
   ⚠ DO NOT "FIX" THIS BY EDITING THE CLAMP. Two lines is that panel's whole
     budget; a caption that pushes the meters off the dock is a worse trade. */
function textOf(v) {
  if (!v.ok) return '';
  if (v.open) {
    if (v.ramping) return 'Zoned land will fill. Demand is still phasing in (' + v.rampLeftMin +
      ' min of grace left), so the growth gate is not being enforced yet.';
    /* ⚠ ONLY CLAIM THE GATE IS CLEAR WHEN EVERY NEED WAS ACTUALLY READ. With no
       readings at all `short` is empty for want of evidence, not for want of a
       shortfall, and "all at or above 90%" would be a HUD claim with nothing
       behind it — the exact failure /src/hud's demand.js header forbids. */
    const measured = v.needs.filter((n) => n.cov != null);
    if (!v.needs.length || measured.length < v.needs.length)
      return 'Zoned land will fill — nothing is holding the city\'s population down.';
    return 'Zoned land will fill — ' + nameList(v.needs) + ' are all at or above ' + pct(v.grow) +
      ', so the city is allowed to grow.';
  }
  if (v.reason === 'beds') {
    return 'Zoned, but nothing will move in: the city is at its housing capacity (' +
      Math.round(v.pop) + ' of ' + Math.round(v.cap) + ' beds). More housing — zoned or built — is what raises it.';
  }
  const w = v.worst;
  const fix = w.fix.length
    ? ' — ' + (w.fix[0].ico ? w.fix[0].ico + ' ' : '') + 'build a ' + w.fix[0].name + '.'
    : '.';
  const rest = v.short.slice(1)
    .map((n) => ' ' + (n.ico ? n.ico + ' ' : '') + n.name + ' is short too, at ' + pct(n.cov) + '.').join('');
  const more = w.fix.slice(1);
  return 'Zoned, but nothing will move in: ' + (w.ico ? w.ico + ' ' : '') + w.name + ' is ' + pct(w.cov) +
    ' and growth needs ' + pct(v.grow) + fix + rest +
    (more.length ? ' (' + more.map((f) => f.name).join(' or ') + ' cover' + (more.length === 1 ? 's' : '') + ' more ground.)' : '') +
    ' All of ' + nameList(v.needs) + ' have to clear ' + pct(v.grow) + '.' +
    (v.ramping ? ' Demand is still phasing in — ' + v.rampLeftMin + ' min of grace left.' : '');
}

/* ⚠ THE NEEDS ARE NAMED FROM THE HAND-OVER, never from prose. "Food, Water and
   Health" is what node-city's gate happens to be TODAY; a fourth need added to
   it would leave this sentence quietly lying about the rule it exists to
   explain. */
function nameList(needs) {
  const all = needs.map((n) => n.name);
  if (!all.length) return 'every gate';
  if (all.length === 1) return all[0];
  return all.slice(0, -1).join(', ') + ' and ' + all[all.length - 1];
}

export default { verdict };
