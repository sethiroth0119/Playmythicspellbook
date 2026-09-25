/* 🔎 FIND-THE-EFFECT — one read, one transform, one write.
   Every anchor asserts its own match count, so a re-layout of the target makes
   this THROW instead of silently editing the wrong place (public/index.html is
   261k lines with mixed line endings; sed -i is not an option here). */
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

/* ═══ 1. the six orphans join four EXISTING groups. No label is touched. ═══ */
sub('grp:damage', "'drainLife','fight'] },",
                  "'drainLife','fight','mirrorWard','purityPact'] },");
sub('grp:buffs',  "'rewind','readyAllies'] },",
                  "'rewind','readyAllies','buffPerCard','stillnessSeal'] },");
sub('grp:control', "'transformAlly','cloneUnit'] },",
                   "'transformAlly','cloneUnit','soulSwap'] },");
sub('grp:summon', "'tributeDraw','sendMatching'] },",
                  "'tributeDraw','sendMatching','tributeRite'] },");

/* ═══ 2. why those six were homeless, said on the registry itself ═══ */
sub('grp:comment',
`// 🗂 Effect-type CATEGORIES — group the ~75 on-play effects into labelled
// <optgroup> sections so the long dropdowns are navigable. Ordered; the
// _onplayTypeOptgroups helper renders them and sweeps any id NOT listed here
// into a final "🔧 Other" group, so a new effect can never silently vanish.
`,
`// 🗂 Effect-type CATEGORIES — group the on-play effects into labelled
// <optgroup> sections so the long dropdowns are navigable. Ordered; the
// _onplayTypeOptgroups helper renders them and sweeps any id NOT listed here
// into a final "🔧 Other" group, so a new effect can never silently vanish.
//
// 🔴 THESE TEN LABEL STRINGS ARE PERSISTED LIVE DATA — DO NOT RENAME OR SPLIT ONE.
//    card.counterScope holds them verbatim ("🃏 Cards & Hand", …) and
//    _counterScopeOk matches by literal string (scope.indexOf(g.label) < 0) and
//    then FAILS CLOSED. Rename a label and every Counter card already authored
//    against it silently narrows to nothing and refuses everything, with no
//    error anywhere. Splitting one in this array is the same bug in a nicer hat
//    — the rendered dropdown is chunked instead, in _fxChunkOptgroups, where no
//    saved card can see it. Adding a NEW group, or adding an id to an existing
//    one, is safe: it only ever turns a "no" into a "yes" for something nothing
//    could answer before.
// 🕳 AND AN ID IN NO GROUP IS NOT COSMETIC, which is what the "🔧 Other" sweep
//    hid. "Other" exists only in the rendered <optgroup>, never in this array,
//    so _counterScopeOk could not resolve a group for an ungrouped id and a
//    SCOPED counter could never answer it. Six effects sat there — purityPact,
//    buffPerCard, mirrorWard, soulSwap, tributeRite, stillnessSeal — unanswerable
//    by any scoped counter card in the game. They are grouped now, and "🔧 Other"
//    stays only as the never-lose-an-effect backstop it was meant to be.
`);

/* ═══ 3. the renderer: counts, ≤12-per-heading chunking, and the desc lifter ═══ */
sub('render:head',
`// Render the grouped <optgroup> option list for a given selected id. Any effect
// not placed in a group above falls into "🔧 Other" so nothing is ever lost.
// \`exclude\` is an optional Set of ids to leave out — the spell and trap editors
// list a handful of "classic" effects above the engine list and must not repeat
// them. Without this they fell back to ONE flat optgroup of ~120 entries.
function _onplayTypeOptgroups(selectedId, exclude) {
  const sel = selectedId || '';
  const skip = (exclude && typeof exclude.has === 'function') ? exclude : null;
  const byId = {};
  ONPLAY_TYPES.forEach(t => { if (!skip || !skip.has(t.id)) byId[t.id] = t; });
  const emitted = new Set();
  const opt = (t) => \`<option value="\${t.id}" \${sel === t.id ? 'selected' : ''}>\${escapeHtml(t.label)}</option>\`;
  let html = '';
  ONPLAY_TYPE_GROUPS.forEach(g => {
    const rows = g.ids.filter(id => byId[id] && !emitted.has(id));
    if (!rows.length) return;
    html += \`<optgroup label="\${escapeHtml(g.label)}">\` + rows.map(id => { emitted.add(id); return opt(byId[id]); }).join('') + \`</optgroup>\`;
  });
  const leftovers = ONPLAY_TYPES.filter(t => byId[t.id] && !emitted.has(t.id));
  if (leftovers.length) html += \`<optgroup label="🔧 Other">\` + leftovers.map(opt).join('') + \`</optgroup>\`;
  return html;
}
`,
`// 🔎 THE ONE-LINE EXPLANATION, LIFTED FROM THE LABEL RATHER THAN COPIED.
// Every one of the 118 ONPLAY_TYPES labels is "<icon> <Name> (<what it does>)" —
// all 118 checked, all 118 close with ')'. So the explanation the author needs is
// ALREADY in the registry, and a \`desc\` field would be a 118-line second copy of
// text sitting three characters away, free to drift out of step with the label
// the author is reading. _fxFindDescribe renders exactly what this returns and
// the driver asserts the two are equal, so the DOM and the registry cannot
// disagree about what an effect does.
function _fxLabelDesc(label) {
  const s = String(label || '');
  const i = s.indexOf(' ('), j = s.lastIndexOf(')');
  return (i >= 0 && j > i) ? s.slice(i + 2, j).trim() : '';
}
function _onplayTypeDesc(id) {
  if (!id) return '';
  try {
    const cat = (typeof ONPLAY_TYPES !== 'undefined') ? ONPLAY_TYPES : [];
    for (let i = 0; i < cat.length; i++) if (cat[i] && cat[i].id === id) return _fxLabelDesc(cat[i].label);
  } catch (e) {}
  return '';
}

// 🔎 NO RENDERED HEADING HOLDS MORE THAN THIS. "⚰️ Graveyard & Void" put nineteen
// options under one heading, which is past where an eye scans and into where it
// reads — the "I can't find anything in here" this piece is about. Split into
// EVEN parts, never twelve-then-the-remainder: 19 reads as 10 + 9, not 12 + 7.
const FX_OPTGROUP_MAX = 12;
// 🔴 THE SPLIT IS PRESENTATION AND HAS TO STAY THAT WAY. It happens HERE, on the
//    way into the DOM, and never in ONPLAY_TYPE_GROUPS — see the 🔴 block on that
//    array: its labels are persisted counterScope data, matched by literal string
//    and failing closed, so splitting a group up there would silently empty the
//    scope of every Counter card authored against it. Nothing ever reads an
//    <optgroup> label back, so chunking it costs nothing and risks nothing.
function _fxChunkOptgroups(label, rows, render) {
  const parts = Math.max(1, Math.ceil(rows.length / FX_OPTGROUP_MAX));
  const per = Math.ceil(rows.length / parts);
  let html = '';
  for (let p = 0; p < parts; p++) {
    const slice = rows.slice(p * per, (p + 1) * per);
    if (!slice.length) continue;
    // the count is the house pattern: buildPassiveOpts (the ~187-entry passive
    // picker) has labelled its optgroups "<name> (n)" since it grew past 100.
    const head = (parts > 1 ? label + ' · ' + (p + 1) + ' of ' + parts : label) + ' (' + slice.length + ')';
    html += \`<optgroup label="\${escapeHtml(head)}">\` + slice.map(render).join('') + \`</optgroup>\`;
  }
  return html;
}

// Render the grouped <optgroup> option list for a given selected id. Any effect
// not placed in a group above falls into "🔧 Other" so nothing is ever lost.
// \`exclude\` is an optional Set of ids to leave out — the spell and trap editors
// list a handful of "classic" effects above the engine list and must not repeat
// them. Without this they fell back to ONE flat optgroup of ~120 entries.
function _onplayTypeOptgroups(selectedId, exclude) {
  const sel = selectedId || '';
  const skip = (exclude && typeof exclude.has === 'function') ? exclude : null;
  const byId = {};
  ONPLAY_TYPES.forEach(t => { if (!skip || !skip.has(t.id)) byId[t.id] = t; });
  const emitted = new Set();
  const opt = (t) => \`<option value="\${t.id}" \${sel === t.id ? 'selected' : ''}>\${escapeHtml(t.label)}</option>\`;
  let html = '';
  ONPLAY_TYPE_GROUPS.forEach(g => {
    const rows = g.ids.filter(id => byId[id] && !emitted.has(id)).map(id => { emitted.add(id); return byId[id]; });
    if (!rows.length) return;
    html += _fxChunkOptgroups(g.label, rows, opt);
  });
  const leftovers = ONPLAY_TYPES.filter(t => byId[t.id] && !emitted.has(t.id));
  if (leftovers.length) html += _fxChunkOptgroups('🔧 Other', leftovers, opt);
  return html;
}
`);

fs.writeFileSync(F, S);
console.log('bytes ' + n0 + ' -> ' + S.length + '  (+' + (S.length - n0) + ')');
