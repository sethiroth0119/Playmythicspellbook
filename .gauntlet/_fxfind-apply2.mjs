/* 🔎 FIND-THE-EFFECT, part 2 — the type-to-filter box and the inline
   explanation. One read, one transform, one write; every anchor asserts its own
   match count. */
import fs from 'node:fs';
const F = 'public/index.html';
let S = fs.readFileSync(F, 'utf8');
const n0 = S.length;
let step = 0;
function sub(name, find, repl, want = 1) {
  const parts = S.split(find);
  const got = parts.length - 1;
  if (got !== want) throw new Error('anchor "' + name + '": matched ' + got + ', wanted ' + want);
  S = parts.join(repl);
  console.log('  ok ' + String(++step).padStart(2) + '  ' + name + '  (' + got + ')');
}

/* ═══ A. the styles ═══ */
sub('css',
`  @media (max-width: 720px) {
    .fx-sum { font-size: 0.88rem; }
    .fx-sum-hint { display: none; }
  }
`,
`  @media (max-width: 720px) {
    .fx-sum { font-size: 0.88rem; }
    .fx-sum-hint { display: none; }
  }

  /* 🔎 FIND-THE-EFFECT — the filter row above every effect picker and the
     one-line explanation below it (both injected by _fxFindWire; neither
     carries an id, see the 🔴 note there). */
  .fx-find { display: flex; align-items: center; gap: 0.35rem; margin: 0.15rem 0 0.25rem; }
  .fx-find-in {
    flex: 1 1 auto; min-width: 0; width: auto;
    font-size: 0.78rem; padding: 0.24rem 0.5rem;
    border-radius: 6px; border: 1px solid rgba(212,175,55,0.35);
    background: rgba(20,14,38,0.72); color: #f0e6d2;
  }
  .fx-find-in::placeholder { color: rgba(240,230,210,0.42); }
  .fx-find-in:focus {
    outline: none; border-color: rgba(255,209,102,0.85);
    box-shadow: 0 0 0 2px rgba(255,209,102,0.18);
  }
  .fx-find-n {
    flex: 0 0 auto; font-size: 0.7rem; color: #9fb0c4;
    font-variant-numeric: tabular-nums; white-space: nowrap;
  }
  .fx-find-x {
    flex: 0 0 auto; cursor: pointer; user-select: none;
    font-size: 0.72rem; line-height: 1; padding: 0.24rem 0.4rem;
    border-radius: 6px; border: 1px solid rgba(212,175,55,0.3);
    color: #d9c48a; background: rgba(212,175,55,0.08);
  }
  .fx-find-x:hover { color: #ffd166; border-color: rgba(255,209,102,0.6); }
  .fx-find-desc {
    margin: 0.22rem 0 0; padding: 0.24rem 0.5rem;
    font-size: 0.76rem; line-height: 1.35; color: #d6e2ea;
    border-left: 2px solid rgba(255,209,102,0.55);
    background: rgba(255,209,102,0.06); border-radius: 0 5px 5px 0;
  }
  /* option[hidden] is honoured by Chrome and Firefox; older Safari ignores it,
     so the class carries the same rule and _fxFindApply sets both together. */
  option.fx-nomatch, optgroup.fx-nomatch { display: none; }
`);

/* ═══ B. the runtime, parked beside the field gate it has to co-exist with ═══ */
sub('wire',
`function _setFromZoneFieldHtml(prefix, eff) {`,
`/* 🔎 FIND-THE-EFFECT — a type-to-filter box and a one-line explanation on every
   effect picker in the card editor.
   ─────────────────────────────────────────────────────────────────────────
   THE COMPLAINT: 118 on-play effects in one <select>, fifteen of those selects
   rendered at once in a unit editor (measured: ed-onplay-type, six ed-onplayx-N,
   ed-ig-effect and seven sibling-trigger pickers), and the only way to find
   "discard" was to read. Grouping alone did not fix it — "⚰️ Graveyard & Void"
   was nineteen rows under one heading. So: chunked headings (_fxChunkOptgroups),
   a filter, and the effect's own explanation on screen without a modal.

   🔴 WHY THIS IS A DOM SCAN AND NOT AN EDIT TO THE ELEVEN CALL SITES.
      _onplayTypeOptgroups returns <option> HTML; the <select> around it is
      written by each call site, in eleven different shapes. Enhancing here
      covers all of them from one place — and it also picks up the two pickers
      that never went through the grouping helper at all: ed-ig-effect and the
      Trigger-Ability rows, both built flat by _extendEffects(). Those two get
      the filter and the explanation even though they have no <optgroup>s.

   🔴 NEITHER INJECTED NODE CARRIES AN id, AND THAT IS LOAD-BEARING.
      _fxApplyEffectGate walks \`input[id], select[id], textarea[id]\` and bumps
      every ancestor of each hit; an id on the filter box would enrol it in the
      gate's "is every field in this box off?" tally and keep a fully-gated
      wrapper on screen. openCardEditor also refuses duplicate ids (harness bug
      15). Both nodes are held by reference on the select instead. They are also
      deliberately NOT .editor-field, so _fxSweepEmptySections still counts an
      empty section as empty. */
const FX_FIND_MIN_OPTIONS = 40;   // ONPLAY ids in one select => it is an effect picker
function _fxFindSelects(root) {
  let ids;
  try { ids = new Set((typeof ONPLAY_TYPES !== 'undefined' ? ONPLAY_TYPES : []).map(t => t && t.id)); }
  catch (e) { return []; }
  return Array.from(root.querySelectorAll('select')).filter(s => {
    let n = 0;
    for (let i = 0; i < s.options.length; i++) {
      if (ids.has(s.options[i].value) && ++n >= FX_FIND_MIN_OPTIONS) return true;
    }
    return false;
  });
}
// Hide what does not match. HIDE, never remove — an option that leaves the DOM
// takes its value with it, and the value is what the save reads.
function _fxFindApply(sel, q) {
  const needle = String(q || '').trim().toLowerCase();
  const before = sel.value;
  let shown = 0, total = 0;
  for (let i = 0; i < sel.options.length; i++) {
    const o = sel.options[i];
    const placeholder = !o.value;                 // "— None —" rows always stay
    if (!placeholder) total++;
    const keep = !needle || placeholder || o.text.toLowerCase().indexOf(needle) >= 0;
    o.hidden = !keep;
    o.classList.toggle('fx-nomatch', !keep);
    if (keep && !placeholder) shown++;
  }
  // a heading with nothing left under it is a heading over empty space
  sel.querySelectorAll('optgroup').forEach(g => {
    let live = 0;
    for (let i = 0; i < g.children.length; i++) if (!g.children[i].hidden) live++;
    g.hidden = live === 0;
    g.classList.toggle('fx-nomatch', live === 0);
  });
  /* 🔴 A FILTER MUST NEVER BE ABLE TO CHANGE A VALUE. Hiding the option that is
     currently selected makes some engines re-snap the select to the first
     visible row; captureEditorIntoCard would then read THAT effect and
     saveCardFromInputs would cloud-push the rewritten card to every owner —
     exactly the silent-rewrite class the field gate is built around (see the 🔴
     header on FX_GATE_FIELDS). Chromium measured as not re-snapping. This makes
     it true everywhere instead of true on the one browser it was tested in. */
  if (sel.value !== before) sel.value = before;
  return { shown: shown, total: total };
}
// The explanation under the picker. It is _onplayTypeDesc verbatim for anything
// in the registry — the driver asserts that equality — and falls back to the
// option's own parenthetical for the nine classic spell / seven classic trap
// effects, which are hand-written above the engine list and have no registry row.
function _fxFindDescribe(sel) {
  const box = sel && sel._fxFindDesc;
  if (!box) return;
  const o = sel.options[sel.selectedIndex];
  let txt = _onplayTypeDesc(sel.value);
  if (!txt && o && sel.value) txt = _fxLabelDesc(o.text) || String(o.text || '');
  box.textContent = txt;
  box.style.display = txt ? '' : 'none';
}
function _fxFindWire() {
  const host = document.querySelector('.card-editor');
  if (!host) return 0;
  const sels = _fxFindSelects(host);
  sels.forEach(sel => {
    if (sel.dataset.fxFind === '1') { _fxFindDescribe(sel); return; }
    sel.dataset.fxFind = '1';
    let total = 0;
    for (let i = 0; i < sel.options.length; i++) if (sel.options[i].value) total++;
    const bar = document.createElement('div');
    bar.className = 'fx-find';
    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'fx-find-in';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('aria-label', 'Filter effects');
    input.placeholder = '🔎 filter ' + total + ' effects — try "discard", "grave", "summon"';
    const n = document.createElement('span');
    n.className = 'fx-find-n';
    const x = document.createElement('span');
    x.className = 'fx-find-x'; x.textContent = '✕'; x.title = 'clear the filter (Esc)';
    const desc = document.createElement('div');
    desc.className = 'fx-find-desc';
    bar.appendChild(input); bar.appendChild(n); bar.appendChild(x);
    sel.parentNode.insertBefore(bar, sel);
    sel.parentNode.insertBefore(desc, sel.nextSibling);
    sel._fxFindDesc = desc; sel._fxFindN = n; input._fxFindSel = sel;
    const clear = () => { input.value = ''; _fxFindApply(sel, ''); n.textContent = ''; input.focus(); };
    /* stopPropagation: the editor root carries delegated click handling and a
       filter reset is nobody else's business. */
    x.onclick = (e) => { e.preventDefault(); e.stopPropagation(); clear(); };
    input.onkeydown = (e) => { if (e.key === 'Escape') { e.stopPropagation(); clear(); } };
    _fxFindDescribe(sel);
  });
  return sels.length;
}
function _setFromZoneFieldHtml(prefix, eff) {`);

/* ═══ C. the bind hook — wire on render, and keep both live ═══ */
sub('bind:call',
`  _fxApplyEffectGate();
  _fxSweepEmptySections();

  /* 🎚 …and keep it live.`,
`  _fxApplyEffectGate();
  _fxSweepEmptySections();
  // 🔎 …then hang a filter box and an explanation line on every effect picker.
  // AFTER the gate and the sweep: both walk the editor by selector and neither
  // should have to know about nodes that were not there when they were written.
  _fxFindWire();

  /* 🎚 …and keep it live.`);

sub('bind:change',
`    _fxGateHost.addEventListener('change', (e) => {
      const t = e.target;
      if (!t || !t.id || t.id.slice(-5) !== '-type') return;
      _fxApplyEffectGate();
      _fxSweepEmptySections();
    });
  }`,
`    _fxGateHost.addEventListener('change', (e) => {
      const t = e.target;
      if (!t) return;
      /* 🔎 The explanation follows the pick, and it is checked BEFORE the -type
         test on purpose: ed-ig-effect, ed-spell-effect and ed-trap-effect are
         effect pickers whose ids do not end in "-type", so the gate's own test
         would have skipped exactly the three dropdowns that ARE a card's whole
         body. */
      if (t.dataset && t.dataset.fxFind === '1') _fxFindDescribe(t);
      if (!t.id || t.id.slice(-5) !== '-type') return;
      _fxApplyEffectGate();
      _fxSweepEmptySections();
    });
    /* 🔎 One delegated 'input' for every filter box, for the same reason the
       gate is delegated: render() rebuilds the whole editor, and a per-box
       listener would be re-bound fifteen times a render. */
    _fxGateHost.addEventListener('input', (e) => {
      const t = e.target;
      if (!t || !t.classList || !t.classList.contains('fx-find-in')) return;
      const sel = t._fxFindSel;
      if (!sel) return;
      const r = _fxFindApply(sel, t.value);
      if (sel._fxFindN) sel._fxFindN.textContent = String(t.value || '').trim() ? (r.shown + ' of ' + r.total) : '';
    });
  }`);

fs.writeFileSync(F, S);
console.log('bytes ' + n0 + ' -> ' + S.length + '  (+' + (S.length - n0) + ')');
