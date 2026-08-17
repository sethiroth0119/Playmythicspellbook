/* ══════════════════════════════════════════════════════════════════════════
   🏷 NAMING — mount point. Registers window.MythicNaming and
      window.MythicCitySave, and hangs the rename affordance off the dossier.

   🔴 THE GLOBALS TRAP (CLAUDE.md, and this is the fifth module to meet it).
      `game`, `BUILDINGS`, `openInspect`, `saveSoon` and `toast` are top-level
      `const`/function bindings in node-city's <script type="module"> and are
      INVISIBLE from here. There is no window.game and there never will be.
      The ctx object passed to mount() IS the hand-over.

   WHAT THIS FILE OWNS IN THE DOSSIER, and nothing else: the contents of
   #insname, one extra chip appended to #insmeta, and one injected <style>.
   It does not edit openInspect's markup — it re-renders the header AFTER the
   base panel has drawn, exactly the way the ops layer appends #ops-inspect to
   whatever panel is on screen. Two other workflows are inside index.html this
   round; a wrapper survives a rewrite of the function it wraps.
   ══════════════════════════════════════════════════════════════════════════ */
import { NameRegister, esc, sanitise, NAME_MAX } from './registry.js';
import { SaveShelf } from './save.js';

const STYLE_ID = 'nm-style';
const CSS = `
#insname .nm-name{cursor:text}
#insname .nm-btn{appearance:none;border:1px solid rgba(212,175,55,.34);background:rgba(212,175,55,.10);
  color:#e6c86f;font:inherit;font-size:11px;line-height:1;letter-spacing:.04em;padding:4px 7px;
  border-radius:6px;cursor:pointer;flex:none}
#insname .nm-btn:hover{background:rgba(212,175,55,.22);color:#ffe9a8}
#insname .nm-btn:focus-visible{outline:2px solid #f0d68f;outline-offset:1px}
#insname .nm-in{font:inherit;font-size:16px;color:#f0d68f;background:rgba(0,0,0,.35);
  border:1px solid rgba(212,175,55,.55);border-radius:7px;padding:3px 8px;min-width:12ch;
  max-width:100%;flex:1 1 14ch}
#insname .nm-in:focus{outline:none;border-color:#f0d68f;box-shadow:0 0 0 2px rgba(212,175,55,.2)}
#insname .nm-bp{font-family:'Crimson Text',Georgia,serif;font-size:10px;letter-spacing:.1em;
  padding:2px 7px;border-radius:20px;background:rgba(255,255,255,.05);color:#a79cbd;
  border:1px solid rgba(255,255,255,.12);white-space:nowrap;text-transform:uppercase}
#insmeta span.nm-addr{color:#c9b27a}
`;

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

export function mount(ctx) {
  if (!ctx || !ctx.game) throw new Error('naming: ctx.game is required');
  injectStyle();

  const reg = new NameRegister({
    game: ctx.game,
    opsLabel: ctx.opsLabel,
    saveSoon: ctx.saveSoon,
  });
  const shelf = (typeof window !== 'undefined' && window.MythicCitySave) || new SaveShelf();

  /* The register is the shelf's first tenant. Everything about the name
     register's persistence therefore rides ONE field in serialize(), and the
     next module needs no edit to index.html at all. */
  shelf.register('names', {
    save: () => reg.save(),
    load: (p) => reg.load(p),
  });

  const toast = (m, k) => { try { ctx.toast && ctx.toast(m, k); } catch (e) {} };
  const $ = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);

  /* ── the dossier header ────────────────────────────────────────────────
     Redrawn after the base panel, so nothing in openInspect has to change and
     the ops layer's own augmentation is untouched. `editing` guards the case
     where openInspect is re-entered while the input is open (the panel
     re-renders itself on half a dozen actions) — losing what the player was
     typing because a tick fired underneath them is the kind of thing that
     makes a rename box feel broken. */
  let editing = null;
  /* Did the header just print an address? Set by paintHeader, read by paintMeta
     — see dossierAddr. One dossier is open at a time, so one flag is enough. */
  let headerHasAddr = false;
  /* The level chip is openInspect's markup, and beginEdit blows the whole
     header away to put an input there. Without this cache a rename committed
     from the inline editor repainted a header with no LVL chip until the panel
     was closed and reopened — measured, and it looks exactly like the rename
     ate something. One entry is enough: only one dossier is ever open. */
  let lvlKey = null, lvlCached = '';

  function blueprint(key) {
    try { return (ctx.blueprintName && ctx.blueprintName(key)) || null; } catch (e) { return null; }
  }

  /* ── the address, borrowed from /src/dossier ────────────────────────────
     🔴 TWO MODULES LANDED AN ADDRESS IN THE SAME ROUND AND THE HEADER IS ONE
        LINE. openInspect now builds its title as
        `MythicDossier.headerHtml(k, MythicNaming.nameFor(k))` — the name from
        here, the ", 126 9th Street" from there. This function repaints that
        same element afterwards to hang the ✏️ Rename button off it, so it has
        to put the address BACK or the title visibly loses its street the
        instant the panel finishes drawing.
     Read through the module's public seam and not by re-deriving it here:
     /src/dossier and /src/naming each carry their own address derivation, and
     two of them printing different numbers for one building is worse than
     either. The dossier's is the one openInspect used, so it is the one that
     wins. Absent module (a 404 on /src/dossier) ⇒ null ⇒ the header is the
     name alone and paintMeta below prints the address chip instead, which is
     exactly what this module did before the dossier existed. */
  function dossierAddr(key) {
    try {
      const D = (typeof window !== 'undefined') && window.MythicDossier;
      if (!D || typeof D.addressOf !== 'function') return null;
      const a = D.addressOf(key);
      return (a && a.ok && a.text) ? String(a.text) : null;
    } catch (e) { return null; }
  }

  function paintHeader(key) {
    const host = $('insname');
    if (!host) return;
    const name = reg.nameFor(key);
    if (name == null) return;                 // road / wall / anchor: not ours
    /* The level chip belongs to openInspect. Lift it out of the markup the
       base panel just wrote and put it back afterwards, rather than trying to
       reproduce its two different shapes (operation licence level vs building
       tier) — that string drifted apart from its twin once already. */
    const lvl = host.querySelector('.lvl');
    const lvlHtml = lvl ? lvl.outerHTML : (lvlKey === key ? lvlCached : '');
    lvlKey = key; lvlCached = lvlHtml;
    const bp = blueprint(key);
    const custom = reg.isCustom(key);
    /* The street, put back exactly where openInspect had it — see dossierAddr.
       `headerHasAddr` is then read by paintMeta, so the address is printed once
       in the panel and not twice in two different places. */
    const addr = dossierAddr(key);
    headerHasAddr = !!addr;
    host.innerHTML =
      '<span class="nm-name" id="nm-name">' + esc(name) + '</span>' +
      (addr ? '<span class="dsr-addr">, ' + esc(addr) + '</span>' : '') + lvlHtml +
      (bp && bp !== name ? '<span class="nm-bp">' + esc(bp) + '</span>' : '') +
      '<button type="button" class="nm-btn" id="nm-edit" title="Rename this business">✏️ Rename</button>' +
      (custom ? '<button type="button" class="nm-btn" id="nm-reset" title="Go back to the generated name">↺</button>' : '');
    const eb = $('nm-edit');
    if (eb) eb.onclick = () => beginEdit(key);
    const rb = $('nm-reset');
    if (rb) rb.onclick = () => {
      const n = reg.clearName(key);
      toast('🏷️ Sign taken down — back to ' + n + '.', 'good');
      paintHeader(key);
    };
  }

  function beginEdit(key) {
    const host = $('insname');
    if (!host) return;
    const cur = reg.nameFor(key) || '';
    editing = key;
    host.innerHTML = '<input class="nm-in" id="nm-in" type="text" maxlength="' + NAME_MAX +
      '" aria-label="Business name" value="' + esc(cur) + '">' +
      '<button type="button" class="nm-btn" id="nm-ok">Save</button>' +
      '<button type="button" class="nm-btn" id="nm-cancel">Cancel</button>';
    const inp = $('nm-in');
    const done = (commit) => {
      if (editing !== key) return;
      editing = null;
      if (commit) {
        const raw = inp ? inp.value : '';
        const before = reg.nameFor(key);
        const after = reg.setName(key, raw);
        if (after && after !== before) {
          toast('🏷️ Renamed to ' + after + '.', 'good');
          try { ctx.logEvent && ctx.logEvent('city', '🏷️ ' + before + ' is now trading as ' + after + '.'); } catch (e) {}
        } else if (!sanitise(raw)) {
          toast('🏷️ Name cleared — back to ' + reg.nameFor(key) + '.', 'good');
        }
      }
      paintHeader(key);
    };
    if (inp) {
      inp.onkeydown = (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); done(true); }
        else if (ev.key === 'Escape') { ev.preventDefault(); done(false); }
        /* ⚠ The city listens for WASD/R on the document to pan and rotate.
           Without this the letters a player types into the name box also drive
           the camera and re-orient the building behind the panel. */
        ev.stopPropagation();
      };
      inp.onkeyup = (ev) => ev.stopPropagation();
      inp.onkeypress = (ev) => ev.stopPropagation();
      try { inp.focus(); inp.select(); } catch (e) {}
    }
    const ok = $('nm-ok'); if (ok) ok.onclick = () => done(true);
    const no = $('nm-cancel'); if (no) no.onclick = () => done(false);
  }

  /* One extra chip on the meta line. Appended, not rewritten — openInspect
     builds that row fresh on every open and owns everything already in it. */
  function paintMeta(key) {
    const meta = $('insmeta');
    if (!meta) return;
    /* Skipped when the header already carries the street. This chip existed
       because nothing else in the panel said where the building was; with
       /src/dossier mounted the title says it AND the Address card says it, and
       a third copy on the meta line is the kind of triplication that makes a
       dossier read as generated rather than designed. Without that module it is
       still the only address on screen, so it still prints. */
    if (headerHasAddr) return;
    const a = reg.address(key);
    const txt = a ? '📍 ' + a.full : '📍 no street frontage';
    meta.insertAdjacentHTML('beforeend',
      '<i class="sep"></i><span class="nm-addr">' + esc(txt) + '</span>');
  }

  function decorate(key) {
    try {
      const t = ctx.game.tiles[key];
      if (!t || !reg.eligible(key)) return;
      if (editing && editing !== key) editing = null;
      if (editing === key) return;          // do not stomp an open input
      paintHeader(key);
      paintMeta(key);
    } catch (e) { console.warn('[naming] dossier', e); }
  }

  try { ctx.wrapInspect && ctx.wrapInspect(decorate); } catch (e) { console.warn('[naming] wrapInspect', e); }

  const API = {
    version: 1,
    nameFor: (k) => reg.nameFor(k),
    autoFor: (k) => reg.autoFor(k),
    isCustom: (k) => reg.isCustom(k),
    setName: (k, v) => { const n = reg.setName(k, v); decorate(k); return n; },
    clearName: (k) => { const n = reg.clearName(k); decorate(k); return n; },
    address: (k) => reg.address(k),
    ensureAll: () => reg.ensureAll(),
    /* All of them, for a list view or an export. */
    all: () => {
      reg.ensureAll();
      const out = {};
      for (const k in ctx.game.tiles) {
        const n = reg.nameFor(k);
        if (n) out[k] = { name: n, custom: reg.isCustom(k), type: ctx.game.tiles[k].type,
                          address: (reg.address(k) || {}).full || null };
      }
      return out;
    },
    stats: () => reg.stats(),
    sanitise,
    esc,
    /* Escape hatch for a driver/test: the register itself. */
    _reg: reg,
  };

  if (typeof window !== 'undefined') {
    window.MythicNaming = API;
    window.MythicCitySave = shelf;
  }
  return API;
}

export { SaveShelf, NameRegister };
