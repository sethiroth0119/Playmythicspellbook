/* ══════════════════════════════════════════════════════════════════════════
   👤 THE CITIZEN DOSSIER — MARKUP ONLY. NO NUMBER IS COMPUTED HERE.
   ──────────────────────────────────────────────────────────────────────────
   The same rule /src/economy/render.js is documented under, and for the same
   reason: if a figure can be born in the renderer then "where did that come
   from" has two answers and one of them is a screenshot. Everything below is
   facts.js's object turned into HTML. There is no arithmetic in this file, no
   threshold, no default that stands in for a missing value — a row facts.js
   marked `un` renders as UNAVAILABLE with facts.js's own reason, and a row it
   did not produce does not appear.

   THE VISUAL LANGUAGE IS THE CITIZEN DIALOGUE'S OWN. `.cthead`, `.ctrow`,
   `.ctfoot` and `.wfrow` are node-city's, not this module's — a household
   member here is the same row, pixel for pixel, as a name on the building
   dossier's Workforce roster, because it opens the same dialogue. Only three
   shapes are new (the mood/activity strip, the label-over-source row and the
   🔍 cross-link), and each is prefixed `cz-` so it cannot reach another panel.

   🔍 THE CROSS-LINK IS THE FEATURE. Every `.cz-link` carries `data-tile`, and
   every member row carries `data-cit` — the SAME attribute the building
   dossier's roster uses. index.js delegates both, once, on the dialog box.
   ══════════════════════════════════════════════════════════════════════════ */

export const CITIZEN_CSS = `
#citbox .cz-strip{display:flex;align-items:center;gap:9px;padding:8px 11px;border-radius:8px;
  margin:0 0 4px;border:1px solid currentColor;background:rgba(255,255,255,.035);}
#citbox .cz-strip .fc{font-size:16px;line-height:1;flex:none;}
#citbox .cz-strip .bd{font-family:'Cinzel',Georgia,serif;font-size:10px;letter-spacing:.14em;
  text-transform:uppercase;flex:none;}
#citbox .cz-strip .sp{flex:1;min-width:6px;}
#citbox .cz-strip .ac{flex:none;font-size:11.5px;color:var(--bone,#e8dcc0);opacity:.92;}
#citbox .cz-strip.good{color:var(--valid,#5ac47a);}
#citbox .cz-strip.warn{color:var(--gold,#d4af37);}
#citbox .cz-strip.bad{color:var(--ember,#e0873f);}
#citbox .cz-strip.fl{color:var(--mist,#8b8299);}
#citbox .cz-note{font-size:10px;color:var(--mist,#8b8299);line-height:1.45;margin:0 0 10px;}

#citbox .cz-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;
  font-size:9.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--mist,#8b8299);
  margin:13px 0 3px;border-bottom:1px solid rgba(255,255,255,.07);padding-bottom:3px;}

#citbox .cz-fac{display:block;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.05);}
#citbox .cz-fac:last-child{border-bottom:0;}
#citbox .cz-fac .tp{display:flex;justify-content:space-between;align-items:baseline;gap:10px;}
#citbox .cz-fac .tp > .l{font-size:11.5px;color:#8b8299;min-width:0;}
#citbox .cz-fac .tp > .v{font-size:12.5px;color:var(--bone,#e8dcc0);text-align:right;
  overflow-wrap:anywhere;}
#citbox .cz-fac .v.un{color:var(--mist,#8b8299);opacity:.8;font-style:italic;}
#citbox .cz-src{display:block;font-size:9.5px;color:var(--mist,#8b8299);opacity:.85;
  line-height:1.45;margin-top:2px;overflow-wrap:anywhere;}

#citbox .cz-link{background:none;border:0;padding:0;font:inherit;font-size:12.5px;cursor:pointer;
  color:var(--gold,#d4af37);text-align:right;border-bottom:1px dotted rgba(212,175,55,.55);
  border-radius:2px;}
#citbox .cz-link:hover,#citbox .cz-link:focus-visible{color:#f2dc9c;outline:none;
  border-bottom-color:#f2dc9c;}
#citbox .cz-head .cz-link{font-size:10px;letter-spacing:.04em;text-transform:none;}
#citbox .cz-hnote{margin:0 0 2px;}
#citbox .cz-me{color:var(--gold,#d4af37);}
`;

/* The face and the tone are PRESENTATION for the band word facts.js was given
   by the host's own ctBand — this module owns no threshold and no second band
   table. An unknown word (ctBand grows a band one day) degrades to a neutral
   face rather than to a wrong one. */
const FACE = {
  wretched:  { fc: '😖', tone: 'bad' },
  low:       { fc: '🙁', tone: 'bad' },
  'getting by': { fc: '😐', tone: 'warn' },
  content:   { fc: '🙂', tone: 'good' },
  thriving:  { fc: '😄', tone: 'good' },
  /* …and the /src/dossier spellings, which are the same five bands under
     nicer names — kept so that a build without the host's ctBand in its ctx
     still gets a face rather than a dot. */
  struggling: { fc: '🙁', tone: 'bad' },
};

export function render(F, esc, pctCol) {
  if (!F || !F.ok) return '';
  const E = (s) => esc(s == null ? '' : String(s));
  let h = '';

  /* ── the strip: mood on the left, what they are doing on the right ── */
  const word = F.mood.label;
  const f = (word && FACE[String(word).toLowerCase()]) || { fc: '·', tone: 'fl' };
  h += '<div class="cz-strip ' + f.tone + '">' +
    '<span class="fc">' + f.fc + '</span>' +
    '<span class="bd">' + (word ? E(word) : 'mood unknown') + '</span>' +
    '<span class="sp"></span>' +
    '<span class="ac">' + (F.activity.ok ? E(F.activity.label) : '<span class="cz-me">—</span>') + '</span>' +
    '</div>';
  h += '<div class="cz-note">' +
    (F.activity.ok
      ? 'Doing: <b>' + E(F.activity.label) + '</b> — ' + E(F.activity.note) + '.'
      : '<b>Activity unavailable</b> — ' + E(F.activity.why) + '.') +
    '</div>';

  for (const s of F.sections) {
    const link = s.id === 'household' && s.houseKey
      ? '<button type="button" class="cz-link" data-tile="' + E(s.houseKey) + '">🔍 ' +
        E(s.houseName || 'their household') + '</button>'
      : '';
    h += '<div class="cz-head"><span>' + E(s.title) + '</span>' + link + '</div>' +
      (s.note ? '<span class="cz-src cz-hnote">' + E(s.note) + '</span>' : '');
    for (const r of s.rows) h += facRow(r, E);
    if (s.id === 'household' && s.members && s.members.length) h += members(s.members, F.id, E, pctCol);
  }

  h += '<div class="ctfoot">Every row above names the live call it was read from. A row that says ' +
    '<i>unavailable</i> is a thing this city does not model — it is never a zero and never a guess. ' +
    'The 🔍 links open that building’s dossier; a name opens that person’s.</div>';
  return h;
}

function facRow(r, E) {
  const v = r.link
    ? '<button type="button" class="cz-link" data-tile="' + E(r.link.key) + '" ' +
      'title="Open ' + E(r.link.label) + '">🔍 ' + E(r.value) + '</button>'
    : '<span class="v' + (r.un ? ' un' : '') + '">' + E(r.value) + '</span>';
  return '<div class="cz-fac"><div class="tp"><span class="l">' + E(r.label) + '</span>' + v + '</div>' +
    '<span class="cz-src">' + E(r.src) + '</span></div>';
}

/* The family, as rows that are literally the Workforce roster's rows — same
   class, same attribute, same dialogue on the other end of the click. */
function members(list, selfId, E, pctCol) {
  let h = '';
  for (const m of list) {
    const mood = Number.isFinite(m.mood) ? Math.round(m.mood) : null;
    const me = m.id === selfId;
    let col = 'var(--mist)';
    if (mood != null && typeof pctCol === 'function') { try { col = pctCol(mood / 100); } catch (e) {} }
    h += '<button type="button" class="wfrow" data-cit="' + E(m.id) + '" ' +
      'title="Open ' + E(m.name) + '">' +
      '<span class="wfn' + (me ? ' cz-me' : '') + '">👤 ' + E(m.name) +
        (me ? ' <small>· this person</small>' : '') + '</span>' +
      '<span class="wfb"><i style="width:' + (mood == null ? 0 : mood) + '%;background:' + col + '"></i></span>' +
      '<span class="wfv" style="color:' + col + '">' + (mood == null ? '—' : mood) + '</span></button>';
  }
  return h;
}
