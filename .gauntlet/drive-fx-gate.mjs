/* ══════════════════════════════════════════════════════════════════════════
   🎚 DRIVE-FX-GATE — "show only the fields the chosen effect actually uses".

   WHAT IT MEASURES, on the REAL editor, for EVERY ONE of the 118 ONPLAY_TYPES
   ids, in the primary on-play block, in the six sibling trigger blocks and in
   the six extra-effect slots:

     A. NOTHING THE ENGINE READS IS HIDDEN.  Every field that _applyOnPlayOneRaw
        reads for that effect is VISIBLE. 🔴 The requirement comes from
        .gauntlet/_fx-engine-needs.mjs — a scan of the ENGINE, attributing each
        `eff.<key>` read to the `eff.type === …` branch it sits in and mapping
        it through the capture object to the field ids that write it. It never
        looks at ONPLAY_TYPES[].needs, which is what the GATE reads: scoring
        this clause against `needs` is a tautology that cannot fail, and the
        first round of this piece shipped exactly that and missed fifteen
        effects hiding a field the engine reads.
     B. NOTHING UNUSED IS SHOWN.   Every gated field that is visible has a token
        that effect needs. Together with A this is set EQUALITY against the
        per-effect whitelist.
     C. THE FIELDS ARE STILL THERE. Hidden ≠ removed. The count of on-play
        controls IN THE DOM is identical for every effect — the one thing that
        stops num() writing its literal fallback over a live card.
     D. SWEEP COHERENCE. No .fx-sec / .fx-sub is visible with zero visible
        .editor-field, and no visible nav chip points at a hidden section.
     E. ROUND TRIP. Type under effect A, switch to B, switch back to A, run the
        REAL captureEditorIntoCard into a scratch object: the value is still
        there. In memory — nothing is saved.

   The select is driven the way a human drives it: .value AND an input + change
   event. Assigning .value alone fires nothing and would test a dead form.

   Run:  node .gauntlet/drive-fx-gate.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { bootPage, openCardEditor, forceOpen } from './_forge-harness.mjs';
import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

/* the ENGINE-derived requirement, computed before the page is even opened */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENG = JSON.parse(execFileSync(process.execPath,
  [path.join(HERE, '_fx-engine-needs.mjs'), path.resolve(HERE, '..'), '--json'],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const ENG_REQ = ENG.req;
console.log('engine scan: _applyOnPlayOneRaw ' + ENG.engineLines.join('..')
  + ', capture ' + ENG.captureLines.join('..')
  + ', ' + ENG.reads + ' eff.<key> reads over ' + ENG.ids + ' effects');

const boot = await bootPage({ viewport: { width: 1500, height: 1400 } });
const pg = boot.page;

/* A saved card, not NEW: the point is the editor an author actually opens on
   work they already did. A clean boot has no Forge content (nothing is fetched
   — the harness aborts every off-box request), so one is seeded in memory. It
   is never written anywhere: this driver does not touch Forge storage. */
const cardId = await pg.evaluate(() => {
  const list = (Forge.customCards || []).filter(c => c && c.id);
  const unit = list.find(c => c.type === 'unit' || c.type === 'hero');
  if (unit) return unit.id;
  const seed = {
    id: 'fxgate_probe', name: 'Gate Probe', icon: '🧪', type: 'unit', cost: 3,
    hp: 40, atk: 12, def: 8, element: 'fire', rarity: 'rare',
    onPlay: { type: 'paintSurface', radius: 2, amount: 9, chance: 80,
              surfaceType: 'oil', status: 'burn', statusDuration: 3 },
  };
  Forge.customCards = (Forge.customCards || []).concat([seed]);
  return seed.id;
});
if (!cardId) { console.log('NO CARD TO DRIVE'); await boot.close(); process.exit(1); }
await openCardEditor(pg, cardId);
const fo = await pg.evaluate('(' + forceOpen + ')(".editor-field")');
console.log('editor open on card', cardId, '— forceOpen matched', fo.matched, 'shown', fo.shown);

const R = await pg.evaluate((ENG_REQ) => {
  const out = { effects: [], fail: [], notes: [] };
  const cat = (typeof ONPLAY_TYPES !== 'undefined' ? ONPLAY_TYPES : []);
  out.catalogue = cat.length;
  if (typeof _fxApplyEffectGate !== 'function' || typeof FX_GATE_FIELDS !== 'object') {
    out.fail.push('the gate is not on the page'); return out;
  }

  /* The blocks under test, and the select that drives each one. */
  const BLOCKS = [{ pre: 'ed-onplay', root: 'fx-onplay' }];
  ['ed-grave', 'ed-ongrave', 'ed-onatk', 'ed-onkill', 'ed-field', 'ed-hand']
    .forEach(p => BLOCKS.push({ pre: p, root: null }));
  for (let i = 0; i < 6; i++) BLOCKS.push({ pre: 'ed-onplayx-' + i, root: null });
  const live = BLOCKS.filter(b => document.getElementById(b.pre + '-type'));
  out.blocks = live.map(b => b.pre);

  const seen = (el) => !!(el && el.checkVisibility
    ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
    : el && el.offsetParent !== null);

  /* Every control this block owns, and the gate tokens (if any) of each. */
  const controlsOf = (pre) => {
    const all = document.querySelectorAll('[id^="' + pre + '-"]');
    const rows = [];
    for (const el of all) {
      const tag = el.tagName;
      if (tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') continue;
      if (el.type === 'hidden') continue;                 // never visible either way
      let suf = el.id.slice(pre.length + 1);
      if (suf.length > 5 && suf.slice(-5) === '-rule') suf = suf.slice(0, -5);
      rows.push({ id: el.id, suf, toks: FX_GATE_FIELDS[suf] || null, el });
    }
    return rows;
  };

  /* BASELINE: what is visible with the gate fully OFF. A control hidden for a
     reason that is not the gate — an extra slot the ➕ has not revealed — must
     not be counted against the gate in either direction. */
  const setSel = (id, v) => {
    const s = document.getElementById(id); if (!s) return false;
    s.value = v;
    s.dispatchEvent(new Event('input', { bubbles: true }));
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return s.value === v;
  };
  const gateOff = () => { document.querySelectorAll('.fx-off').forEach(e => e.classList.remove('fx-off')); };

  const base = {};
  live.forEach(b => { base[b.pre] = controlsOf(b.pre); });
  gateOff();
  if (typeof _fxSweepEmptySections === 'function') _fxSweepEmptySections();
  const baseVisible = {};
  live.forEach(b => {
    baseVisible[b.pre] = new Set(base[b.pre].filter(r => seen(r.el)).map(r => r.id));
  });
  out.baseVisible = {}; live.forEach(b => { out.baseVisible[b.pre] = baseVisible[b.pre].size; });
  out.domControls = {}; live.forEach(b => { out.domControls[b.pre] = base[b.pre].length; });

  /* Sanity on the table itself: a token no effect ever needs would hide its
     field forever, which is a silent feature removal. */
  const everyToken = new Set();
  cat.forEach(t => (t.needs || []).forEach(n => everyToken.add(n)));
  Object.keys(FX_GATE_NEEDS_PATCH).forEach(k => FX_GATE_NEEDS_PATCH[k].forEach(n => everyToken.add(n)));
  const dead = [];
  Object.keys(FX_GATE_FIELDS).forEach(k => {
    if (!FX_GATE_FIELDS[k].some(t => everyToken.has(t))) dead.push(k);
  });
  out.deadTokens = dead;
  if (dead.length) out.fail.push('gate tokens no effect can ever satisfy: ' + dead.join(', '));

  /* ── the per-effect sweep ───────────────────────────────────────────── */
  const ids = cat.map(t => t && t.id).filter(Boolean);
  out.drivenIds = ids.length;
  let worstA = 0, worstB = 0, domDrift = 0;
  const domBase = {}; live.forEach(b => { domBase[b.pre] = document.querySelectorAll('[id^="' + b.pre + '-"]').length; });

  ids.forEach((fx) => {
    const needs = _fxNeedTokens(fx);
    const rec = { id: fx, needs: Object.keys(needs), blocks: {} };
    live.forEach(b => {
      if (!setSel(b.pre + '-type', fx)) { out.fail.push(b.pre + ': the picker refused ' + fx); return; }
    });
    // one gate pass covers every block; the change events already ran it, but
    // call it once more so a missing listener cannot pass by accident of order
    _fxApplyEffectGate();
    _fxSweepEmptySections();

    live.forEach(b => {
      const rows = controlsOf(b.pre);
      const vis = rows.filter(r => seen(r.el)).map(r => r.id);
      const visSet = new Set(vis);
      // A: a field THE ENGINE READS for this effect that is hidden. The
      // requirement is keyed by field-id SUFFIX, which is the same shape in
      // every block, so the on-play whitelist scores the siblings too.
      const engNeed = new Set(ENG_REQ[fx] || []);
      const missing = rows.filter(r => engNeed.has(r.suf)
        && baseVisible[b.pre].has(r.id) && !visSet.has(r.id)).map(r => r.id);
      // B: a gated field that is visible with no token this effect needs.
      // ⚠ This direction is scored against needs+patch — the gate's own input —
      // so it cannot fail by construction; it is here to catch a gate that
      // stopped hiding at all, not as evidence. The evidence for over-showing
      // is 'overShown' below, which counts against the ENGINE scan instead.
      const extra = rows.filter(r => r.toks && !r.toks.some(t => needs[t]) && visSet.has(r.id)).map(r => r.id);
      // gated fields on screen that the engine scan does NOT attribute to this
      // effect: the honest residual of equality. Printed, never failed — the
      // scan over-approximates through closures, so a small tail is expected
      // and a big one would mean the gate is barely gating.
      const over = rows.filter(r => r.toks && visSet.has(r.id) && !engNeed.has(r.suf)).length;
      // C: nothing left the DOM
      const inDom = document.querySelectorAll('[id^="' + b.pre + '-"]').length;
      if (inDom !== domBase[b.pre]) domDrift++;
      rec.blocks[b.pre] = { visible: vis.length, of: baseVisible[b.pre].size, missing, extra, over, inDom };
      if (missing.length) { worstA++; out.fail.push(fx + '/' + b.pre + ' HIDES a field THE ENGINE READS: ' + missing.join(',')); }
      if (extra.length) { worstB++; out.fail.push(fx + '/' + b.pre + ' SHOWS an unused field: ' + extra.slice(0, 6).join(',')); }
    });

    // D: sweep coherence
    const emptyVisible = [], deadChips = [];
    document.querySelectorAll('.fx-sec, .fx-sub').forEach(sec => {
      if (!seen(sec) && sec.style.display === 'none') return;
      if (sec.style.display === 'none') return;
      let n = 0;
      sec.querySelectorAll('.editor-field').forEach(f => { if (!f.closest('.fx-off')) n++; });
      if (n === 0) emptyVisible.push(sec.id || '(unnamed)');
    });
    document.querySelectorAll('[data-fx-go]').forEach(bt => {
      if (bt.style.display === 'none') return;
      const sec = document.getElementById('fx-' + bt.dataset.fxGo);
      if (!sec || sec.style.display === 'none') deadChips.push(bt.dataset.fxGo);
    });
    rec.emptyVisibleSections = emptyVisible;
    rec.chipsPointingAtHidden = deadChips;
    if (emptyVisible.length) out.fail.push(fx + ': visible section with nothing in it — ' + emptyVisible.join(','));
    if (deadChips.length) out.fail.push(fx + ': nav chip points at a hidden section — ' + deadChips.join(','));
    out.effects.push(rec);
  });
  out.domDrift = domDrift;
  out.badHidden = worstA; out.badShown = worstB;

  /* ── F. LIVE, AND WITHOUT A RE-RENDER ───────────────────────────────
     Everything above called _fxApplyEffectGate() itself after dispatching, so
     a gate with no listener at all would have passed it. This clause dispatches
     and does NOT call the gate: the change event has to do the work on its own.
     And the drawer must be the SAME NODE afterwards — a re-render would throw
     away focus, caret and scroll on every effect pick. */
  const drawer = document.getElementById('fx-onplay');
  const surfBox = () => {
    const el = document.getElementById('ed-onplay-surface');
    return el && el.checkVisibility && el.checkVisibility();
  };
  setSel('ed-onplay-type', 'paintSurface');
  const liveOn = surfBox();
  setSel('ed-onplay-type', 'drawCards');
  const liveOff = surfBox();
  out.live = { shownForItsOwnEffect: liveOn, hiddenForAnother: liveOff,
               sameDrawerNode: document.getElementById('fx-onplay') === drawer };
  if (!liveOn) out.fail.push('the change event did not REVEAL the field its effect uses');
  if (liveOff) out.fail.push('the change event did not HIDE a field the new effect cannot use');
  if (!out.live.sameDrawerNode) out.fail.push('the drawer was re-rendered — the gate must work in place');

  /* ── E. round trip ──────────────────────────────────────────────────── */
  setSel('ed-onplay-type', 'paintSurface');
  _fxApplyEffectGate();
  const surf = document.getElementById('ed-onplay-surface');
  const surfOpts = surf ? Array.from(surf.options).map(o => o.value) : [];
  const pick = surfOpts.find(v => v && v !== surf.value) || (surfOpts[0] || '');
  if (surf) { surf.value = pick; surf.dispatchEvent(new Event('change', { bubbles: true })); }
  const amt = document.getElementById('ed-onplay-amount');
  if (amt) { amt.value = '37'; amt.dispatchEvent(new Event('input', { bubbles: true })); }
  setSel('ed-onplay-type', 'drawCards');
  _fxApplyEffectGate();
  out.roundTrip = { hiddenUnderB: !(surf && surf.checkVisibility && surf.checkVisibility()) };
  /* 🔴 CAPTURE WHILE THE FIELD IS HIDDEN. This is the whole argument for hiding
     with a class instead of not rendering: the input is still in the DOM
     carrying its value, so the save reads the AUTHORED value and not num()'s
     literal fallback. A conditionally-rendered gate passes every visible-field
     count above and fails right here. */
  {
    const sc = { id: '_scratch_hidden', name: 'scratch', type: 'unit' };
    try { captureEditorIntoCard(sc); } catch (e) { out.fail.push('capture-while-hidden threw: ' + e); }
    out.roundTrip.hiddenCaptureSurface = sc.onPlay && sc.onPlay.surfaceType;
    out.roundTrip.hiddenCaptureAmount = sc.onPlay && sc.onPlay.amount;
    if (out.roundTrip.hiddenCaptureSurface !== pick)
      out.fail.push('a capture taken while the field was HIDDEN lost the surface: got ' + out.roundTrip.hiddenCaptureSurface);
    if (out.roundTrip.hiddenCaptureAmount !== 37)
      out.fail.push('a capture taken while the field was HIDDEN lost the amount: got ' + out.roundTrip.hiddenCaptureAmount);
  }
  setSel('ed-onplay-type', 'paintSurface');
  _fxApplyEffectGate();
  const scratch = { id: '_scratch_not_saved', name: 'scratch', type: 'unit' };
  try { captureEditorIntoCard(scratch); } catch (e) { out.fail.push('capture threw: ' + e); }
  out.roundTrip.surfaceWanted = pick;
  out.roundTrip.surfaceGot = scratch.onPlay && scratch.onPlay.surfaceType;
  out.roundTrip.amountGot = scratch.onPlay && scratch.onPlay.amount;
  out.roundTrip.visibleAgain = !!(surf && surf.checkVisibility && surf.checkVisibility());
  if (out.roundTrip.surfaceGot !== pick) out.fail.push('round trip LOST the surface: wanted ' + pick + ' got ' + out.roundTrip.surfaceGot);
  if (out.roundTrip.amountGot !== 37) out.fail.push('round trip LOST the amount: got ' + out.roundTrip.amountGot);
  if (!out.roundTrip.visibleAgain) out.fail.push('the field did not come back when its effect did');

  return out;
}, ENG_REQ);

/* ── report ──────────────────────────────────────────────────────────── */
console.log('\ncatalogue effects driven   :', R.drivenIds, 'of', R.catalogue);
console.log('blocks under test          :', (R.blocks || []).join(' '));
console.log('controls in DOM per block  :', JSON.stringify(R.domControls));
console.log('visible with gate OFF      :', JSON.stringify(R.baseVisible));
console.log('DOM drift across 118 picks :', R.domDrift, '(must be 0 — hidden is not removed)');
console.log('engine-read-but-hidden      :', R.badHidden, '(scored against the engine scan, not ONPLAY_TYPES[].needs)');
console.log('engine-required suffixes    : mean ' + (Object.values(ENG_REQ).reduce((a, v) => a + v.length, 0) / Object.keys(ENG_REQ).length).toFixed(1)
  + ', max ' + Math.max(...Object.values(ENG_REQ).map(v => v.length)));
console.log('unused-but-shown failures  :', R.badShown, '(scored against needs+patch — cannot fail; see the residual below)');
{ const rows = (R.effects || []).map(e => (e.blocks['ed-onplay'] || {}));   const ov = rows.map(r => r.over).filter(v => v != null);   const vs = rows.map(r => r.visible).filter(v => v != null);   console.log('over-shown vs the ENGINE scan:', 'mean ' + (ov.reduce((a,b)=>a+b,0)/ov.length).toFixed(1) + ' of ' + (vs.reduce((a,b)=>a+b,0)/vs.length).toFixed(1) + ' visible on-play fields, max ' + Math.max(...ov)); }
console.log('dead gate tokens           :', (R.deadTokens || []).length ? R.deadTokens.join(',') : 'none');
console.log('live on the change event   :', JSON.stringify(R.live));
console.log('round trip                 :', JSON.stringify(R.roundTrip));

const per = (R.effects || []).map(e => ({ id: e.id, v: (e.blocks['ed-onplay'] || {}).visible }))
  .filter(x => x.v != null).sort((a, b) => a.v - b.v);
if (per.length) {
  const total = (R.baseVisible || {})['ed-onplay'];
  console.log('\non-play visible fields, of', total, 'ungated:');
  console.log('  leanest 6 :', per.slice(0, 6).map(x => x.id + '=' + x.v).join('  '));
  console.log('  fattest 6 :', per.slice(-6).map(x => x.id + '=' + x.v).join('  '));
  const sum = per.reduce((a, x) => a + x.v, 0);
  console.log('  mean      :', (sum / per.length).toFixed(1), '  median:', per[Math.floor(per.length / 2)].v);
  const named = ['drawCards', 'boardWipe', 'paintSurface', 'searchDeck', 'summonFromZone', 'sacrifice', 'callLock'];
  named.forEach(n => { const h = per.find(x => x.id === n); if (h) console.log('  ' + n.padEnd(15), h.v); });
}

console.log('\nvisible controls per block, mean over the 118 effects (of the ungated count):');
(R.blocks || []).forEach(pre => {
  const vals = (R.effects || []).map(e => (e.blocks[pre] || {}).visible).filter(v => v != null);
  if (!vals.length) return;
  const of = (R.baseVisible || {})[pre];
  if (!of) return;
  const mean = vals.reduce((a, v) => a + v, 0) / vals.length;
  console.log('  ' + pre.padEnd(14), mean.toFixed(1) + ' of ' + of,
    ' (' + Math.round((1 - mean / of) * 100) + '% fewer)',
    ' min ' + Math.min(...vals) + ' max ' + Math.max(...vals));
});

const emptySecs = (R.effects || []).reduce((a, e) => a + e.emptyVisibleSections.length, 0);
const badChips = (R.effects || []).reduce((a, e) => a + e.chipsPointingAtHidden.length, 0);
console.log('\nempty visible sections, all 118 effects :', emptySecs);
console.log('chips pointing at a hidden section      :', badChips);

if (R.fail.length) {
  console.log('\n❌ FAIL (' + R.fail.length + ')');
  R.fail.slice(0, 30).forEach(f => console.log('   ·', f));
} else {
  console.log('\n✅ every effect shows exactly the fields it needs, nothing left the DOM,');
  console.log('   no empty drawer, no dead chip, and the round trip keeps its value.');
}
console.log('page errors:', boot.errors.length ? boot.errors.slice(0, 3).join(' | ') : 'none');
await boot.close();

/* ── H · A SLOT THE ➕ REVEALS AFTER BIND ────────────────────────────────
   Slots 1-5 are collapsed on a fresh card, so the sweep above scores per-effect
   equality on slot 0 only. This clicks the REAL ➕ control (not a class change)
   and runs the same 118-effect equality on slot 1 — the case where the gate has
   to work on markup that was hidden when the listener was bound. */
const H = await (async () => {
  const b = await bootPage({ viewport: { width: 1500, height: 1400 } });
  try {
    const id = await b.page.evaluate(() => {
      const seed = { id: 'fxgate_slot', name: 'Slot Probe', icon: '🧪', type: 'unit', cost: 3,
        hp: 40, atk: 12, def: 8, element: 'fire', rarity: 'rare', onPlay: { type: 'drawCards', amount: 2 } };
      Forge.customCards = (Forge.customCards || []).concat([seed]);
      return seed.id;
    });
    await openCardEditor(b.page, id);
    await b.page.evaluate('(' + forceOpen + ')(".editor-field")');
    return await b.page.evaluate((ENG_REQ) => {
      const pre = 'ed-onplayx-1';
      const vis = (el) => !!(el && el.checkVisibility());
      const ctrls = () => [...document.querySelectorAll('[id^="' + pre + '-"]')]
        .filter(e => ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.tagName) && e.type !== 'hidden');
      const before = ctrls().filter(vis).length;
      const add = document.getElementById('ed-onplayx-add');
      if (!add) return { fail: 'no ➕ control' };
      add.click();                      // slot 0 is already showing, so this reveals 1
      const after = ctrls().filter(vis).length;
      const sel = document.getElementById(pre + '-type');
      if (!sel) return { fail: 'slot 1 has no picker' };
      const cat = ONPLAY_TYPES.map(t => t.id);
      // the slot's own ungated baseline, measured with the gate lifted
      document.querySelectorAll('.fx-off').forEach(e => e.classList.remove('fx-off'));
      const base = new Set(ctrls().filter(vis).map(e => e.id));
      _fxApplyEffectGate();
      let hidden = 0, shownWrong = 0, drift = 0;
      const dom0 = ctrls().length;
      const sample = {};
      for (const fx of cat) {
        sel.value = fx;
        sel.dispatchEvent(new Event('input', { bubbles: true }));
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        const showing = new Set(ctrls().filter(vis).map(e => e.id));
        const need = new Set(ENG_REQ[fx] || []);
        for (const el of ctrls()) {
          const suf = el.id.slice(pre.length + 1);
          if (need.has(suf) && base.has(el.id) && !showing.has(el.id)) hidden++;
          const toks = FX_GATE_FIELDS[suf];
          if (toks && showing.has(el.id) && !toks.some(t => _fxNeedTokens(fx)[t])) shownWrong++;
        }
        if (ctrls().length !== dom0) drift++;
        if (fx === 'drawCards' || fx === 'boardWipe' || fx === 'damagePerCard') sample[fx] = showing.size;
      }
      return { before, after, ofBase: base.size, inDom: dom0, hidden, shownWrong, drift, sample };
    }, ENG_REQ);
  } finally { await b.close(); }
})();
console.log('\n(H) extra slot 1, revealed by clicking the real ➕ AFTER bind:');
console.log('    visible controls in the slot ' + H.before + ' → ' + H.after
  + ' (ungated baseline ' + H.ofBase + ' of ' + H.inDom + ' in the DOM)');
console.log('    over all 118 effects: engine-read-but-hidden ' + H.hidden
  + ', unused-but-shown ' + H.shownWrong + ', DOM drift ' + H.drift
  + '   e.g. ' + JSON.stringify(H.sample));
const hOk = !H.fail && H.after > H.before && H.hidden === 0 && H.shownWrong === 0 && H.drift === 0;
console.log(hOk ? '    ✅ a slot revealed after bind gates live, and correctly, on every effect'
                : '    ❌ ' + (H.fail || 'the revealed slot does not gate correctly'));

/* ── G · SHIP THE MUTANT ────────────────────────────────────────────────
   Clause A is only worth its ink if it can FAIL. The round-1 version of this
   driver derived "needed" from ONPLAY_TYPES[].needs — the same list the gate
   reads — so it could not fail by construction and printed 0 while fifteen
   effects hid a field the engine reads. So: copy index.html to a scratch tree,
   delete ONE line of FX_GATE_NEEDS_PATCH (intimidate's chance — the case that
   proves the catalogue wrong, since aoeStatus shares its engine branch and
   DOES list chance), and drive the same probe there. The mutant must hide the
   box. If both trees agree, this driver is not measuring anything. */
const MUT_LINE = "  intimidate: ['chance'],\n";
const probeChance = async (cwd, label) => {
  const b = await bootPage({ cwd, assetsFrom: 'D:/game-deploy', viewport: { width: 1500, height: 1400 } });
  try {
    const id = await b.page.evaluate(() => {
      const seed = { id: 'fxgate_mut', name: 'Mutant Probe', icon: '🧪', type: 'unit', cost: 3,
        hp: 40, atk: 12, def: 8, element: 'fire', rarity: 'rare',
        onPlay: { type: 'intimidate', chance: 25, status: 'weak', statusDuration: 2 } };
      Forge.customCards = (Forge.customCards || []).concat([seed]);
      return seed.id;
    });
    await openCardEditor(b.page, id);
    await b.page.evaluate('(' + forceOpen + ')(".editor-field")');
    return await b.page.evaluate(() => {
      const sel = document.getElementById('ed-onplay-type');
      sel.value = 'intimidate';
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      const el = document.getElementById('ed-onplay-chance');
      return { visible: !!(el && el.checkVisibility()), value: el ? el.value : null,
               gate: typeof _fxApplyEffectGate === 'function' };
    });
  } finally { await b.close(); }
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fxgate-mutant-'));
fs.mkdirSync(path.join(tmp, 'public'));
/* THE REPO ROOT, DERIVED, NOT TYPED. This read an absolute D:/game-deploy
   path, so the suite ran its whole battery and then threw ENOENT at the last
   step on any checkout that does not live on that drive - reported by
   checkall as "the suite threw, it checked NOTHING", which is worse than a
   red check because all 118 effect assertions above it are discarded too.
   import.meta.url is this file inside .gauntlet/, so the parent is the root
   wherever the tree is cloned. */
const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const srcHtml = fs.readFileSync(path.join(REPO_ROOT, 'public/index.html'), 'utf8');
if (!srcHtml.includes(MUT_LINE)) throw new Error('mutant anchor gone: ' + JSON.stringify(MUT_LINE));
fs.writeFileSync(path.join(tmp, 'public/index.html'), srcHtml.replace(MUT_LINE, ''));
const real = await probeChance(REPO_ROOT, 'tree');
const mut = await probeChance(tmp, 'mutant');
fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n(G) mutant discrimination — intimidate, Chance box (engine reads eff.chance at 110844):');
console.log('    working tree :', JSON.stringify(real));
console.log('    one patch line deleted :', JSON.stringify(mut));
const mutOk = real.visible === true && mut.visible === false && real.value === mut.value;
console.log(mutOk
  ? '    ✅ the clause bites: the same probe passes here and FAILS on the mutant,'
    + '\n       and the value (' + real.value + ') survives in the DOM either way.'
  : '    ❌ the clause cannot tell the two trees apart — clause A is measuring nothing');

process.exit((R.fail.length || !mutOk || !hOk) ? 1 : 0);
