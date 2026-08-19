/* ════════════════════════════════════════════════════════════════════════════
   🖌 THE SPECIALISATION ROW — two levels in one panel, without thirty chips.
   ----------------------------------------------------------------------------
   THE PROBLEM, STATED AS THE BRIEF STATES IT: "the zoning panel needs to
   express two levels without becoming a menu of thirty."

   Eleven zones × thirteen specialisations is 143 combinations. Laying them out
   as one flat list of ~24 chips is the obvious thing and it is the wrong thing:
   the player loses the land-use read (green/blue/teal/yellow, the convention
   /src/zoning's own header is emphatic about) inside a wall of themed names.

   ── HOW IT IS KEPT LEGIBLE — four decisions, in order of how much they buy ──
   1. THE SPECIALISATION IS A PROPERTY OF THE BRUSH, NOT A SECOND TOOL. There
      is no extra mode, no extra click and no second tool state to reason about:
      you pick Commercial · high density, then you pick 🃏 Mythic Retail, and
      one drag paints both. Paint / marquee / fill and the right-button de-zone
      are all exactly what they were.
   2. THE ROW IS CONTEXTUAL AND OFTEN ABSENT. It shows ONLY the family of the
      zone already selected. Pick a residential zone and the row is not there at
      all (residential has no specialisations — see specs.js). So the worst case
      on screen is Commercial: six chips plus General. Office shows four,
      Industrial five. It is never thirteen and never twenty-four.
   3. "— GENERAL" IS FIRST AND IS THE DEFAULT. Layer 2 is opt-in and looks it.
      A player who never touches this row plays the game that shipped
      yesterday, and the chip that says so is the one their eye lands on first.
   4. ONE DETAIL LINE, NOT A SECOND PANEL. The armed specialisation gets a
      single line under the chips: what it builds, the lowest band that will
      take it, and how many tiles already carry it. Everything on that line is
      derived live (index.js `available()`); nothing is written twice.

   ⚠ AND THE THING THAT IS DELIBERATELY *NOT* DRAWN: the chips do not carry
     per-specialisation colours. The overlay's hues are the LAND USE families
     and they are learned already; a second colour system on top of them would
     cost the first one its meaning. A specialised tile gets a corner pip on
     the map instead — gold for a card district, bone for any other — and that
     is the whole claim the map makes.
   ════════════════════════════════════════════════════════════════════════════ */

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let API = null, wired = false;

export function mountUI(api) {
  API = api;
  style();
  return true;
}

function style() {
  const doc = (typeof document !== 'undefined') ? document : null;
  if (!doc || !doc.head || doc.getElementById('nd-style')) return;
  const st = doc.createElement('style');
  st.id = 'nd-style';
  /* Sits inside #nz-panel and borrows its variables, so the row cannot drift
     away from the panel it lives in. Same fallback discipline /src/zoning uses:
     every var() carries a literal for a page whose theme has moved on. */
  st.textContent = `
#nz-spec{margin:2px 0 4px}
#nz-spec .ndgl{color:var(--mist,#8f87a3);font-size:10px;letter-spacing:.12em;margin:0 0 3px 2px}
#nz-spec .ndgl b{color:var(--gold,#d4af37);letter-spacing:.09em}
#nz-spec .ndchips{display:flex;gap:5px;flex-wrap:wrap;align-items:center}
#nz-spec .ndc{display:flex;align-items:center;gap:5px;border:1px solid rgba(255,255,255,.12);
  background:rgba(0,0,0,.32);border-radius:7px;padding:4px 8px;cursor:pointer;
  color:var(--bone,#e9e0cc);font-size:11px;line-height:1.1}
#nz-spec .ndc:hover{border-color:var(--gold,#d4af37)}
#nz-spec .ndc.on{border-color:#fff;background:rgba(255,255,255,.14)}
#nz-spec .ndc.myth{border-color:rgba(212,175,55,.45);color:#ffd98a}
#nz-spec .ndc.myth.on{border-color:#ffd98a;background:rgba(212,175,55,.22)}
#nz-spec .ndc.lock{opacity:.55}
#nz-spec .ndc.dead{opacity:.4;cursor:not-allowed;text-decoration:line-through}
#nz-spec .nddiv{width:1px;align-self:stretch;background:rgba(212,175,55,.35);margin:0 2px}
#nz-spec .nddet{margin-top:4px;color:var(--mist,#8f87a3);font-size:11px;line-height:1.35}
#nz-spec .nddet b{color:var(--bone,#e9e0cc)}
#nz-spec .nddet .ndfl{color:#ffd08a}
#nz-spec .nddet .ndwarn{color:#ff9a6a}`;
  doc.head.appendChild(st);
}

/* Called by /src/zoning's panel refresh, once per draw, with the container it
   owns and the zone currently on the brush. Absent module ⇒ the container is
   left empty and the panel is exactly what it was. */
export function renderInto(el, zoneId, zoneDef) {
  if (!el || !API) return false;
  const cat = zoneDef ? zoneDef.cat : null;
  const fam = cat && API.FAMILIES[cat];
  if (!fam) { el.innerHTML = ''; return false; }        // residential, or nothing selected

  const rows = API.available(cat);
  const armed = API.armedFor(cat);
  const plain = rows.filter((r) => !r.mythic);
  const myth = rows.filter((r) => r.mythic);

  const chip = (r) => {
    const cls = ['ndc'];
    if (r.mythic) cls.push('myth');
    if (r.id === armed) cls.push('on');
    if (r.empty) cls.push('dead');
    else if (r.locked) cls.push('lock');
    /* The tooltip is where the long form lives, so the chip itself can stay two
       words. It names the buildings and the floor because "why can I not use
       this" and "why is nothing developing" are the same question. */
    const tip = r.name + ' — ' + r.desc
      + '\nBuilds: ' + (r.tenants.length ? r.tenants.join(', ') : 'nothing in this build of the city')
      + (r.floor ? '\nLowest land value that takes it: ' + r.floor.ico + ' ' + r.floor.name : '')
      + (r.locked && r.node ? '\n🔒 ' + r.node.name + ' opens it (' + (r.node.cost | 0) + ' ⬡, Progression — K)' : '');
    return '<button class="' + cls.join(' ') + '" type="button" data-spec="' + esc(r.id) + '" title="' + esc(tip) + '">'
      + esc((r.locked ? '🔒 ' : '') + r.ico + ' ' + r.short)
      + (r.tiles ? '<span style="opacity:.6">· ' + r.tiles + '</span>' : '')
      + '</button>';
  };

  const genOn = armed ? '' : ' on';
  el.innerHTML =
    '<div class="ndgl"><b>SPECIALISATION</b> · ' + esc(fam.ico + ' ' + fam.name) +
      ' — optional. Sits on top of the land use, and narrows what moves in.</div>'
    + '<div class="ndchips">'
    + '<button class="ndc' + genOn + '" type="button" data-spec="" title="No specialisation — this zone develops exactly as it always has.">— General</button>'
    + plain.map(chip).join('')
    + (myth.length ? '<span class="nddiv"></span>' + myth.map(chip).join('') : '')
    + '</div>'
    + detail(rows, armed);
  wire(el);
  return true;
}

function detail(rows, armed) {
  if (!armed) {
    return '<div class="nddet">Painting <b>General</b> — the zone\'s own mix, unchanged. '
      + 'Pick a specialisation to decide what kind of businesses compete for these plots.</div>';
  }
  const r = rows.find((x) => x.id === armed);
  if (!r) return '';
  let s = '<div class="nddet"><b>' + esc(r.ico + ' ' + r.name) + '</b> — ' + esc(r.desc)
    + '<br>Builds: <b>' + esc(r.tenants.join(', ') || '—') + '</b>'
    + (r.lvl ? ' · grown to level <b>' + r.lvl + '</b>' : '');
  if (r.reach === null) {
    /* 🔴 NO FLOOR IS CLAIMED WHEN THE MODEL THAT WOULD DECIDE IT IS ABSENT.
       A plausible-looking band name here would be a figure with nothing behind
       it — the one thing this project keeps re-learning not to ship. */
    s += '<br><span class="ndwarn">Land value model not loaded — no land-value floor can be shown, and none is being enforced.</span>';
  } else if (!r.reach.length) {
    s += '<br><span class="ndwarn">No land in this city will take any of these yet</span> — raise land value, or research the buildings that are still locked.';
  } else {
    s += '<br>Takes <span class="ndfl">' + esc(r.floor.ico + ' ' + r.floor.name) + '</span> land or better'
      + (r.reach.length > 1 ? ' <span style="opacity:.7">(' + esc(r.reach.map((b) => b.name).join(' · ')) + ')</span>' : '')
      + '. Cheaper plots stay vacant and say so.';
  }
  if (r.tiles) s += '<br><b>' + r.tiles + '</b> tile' + (r.tiles === 1 ? '' : 's') + ' already carry this district.';
  return s + '</div>';
}

/* One delegated listener, attached once. Re-rendering the row every draw would
   otherwise stack a listener per refresh — the leak class that made an earlier
   panel in this project fire its handler forty times per click. */
function wire(el) {
  if (wired) return;
  wired = true;
  el.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-spec]');
    if (!b) return;
    ev.preventDefault(); ev.stopPropagation();
    if (b.classList.contains('dead')) return;
    const id = b.dataset.spec || null;
    /* arm() owns the refusal and names the node; a false answer means it has
       already said why, so nothing is said twice here. */
    if (!API.arm(id)) return;
    /* Ask /src/zoning to redraw. sync() rebuilds the overlay (so the corner
       pips follow) AND fires the panel's onChange, which re-enters
       renderInto() — one call, both halves. */
    try { const Z = window.MythicZoning; if (Z && Z.sync) Z.sync(); } catch (e) {}
  });
}
