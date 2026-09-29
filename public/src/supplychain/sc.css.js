/* ═══════════════════════════════════════════════════════════════════════════
   🎨 SUPPLY CHAIN · sc.css.js — every rule the SHELL paints, as one string.

   WHY A .js FILE AND NOT A .css FILE. The overlay is body-level chrome that
   lands inside a 215k-line index.html whose stylesheet it has never met. Two
   things follow:
     1. The rules must arrive with the module, in ONE <style> the shell owns and
        removes on close. A <link> would need a second deploy path, a second
        cache knob, and would still race the first paint — the map would flash
        unstyled over the hub for a frame. A string cannot race itself.
     2. Every selector is prefixed `#sc-overlay`, so an id + class beats almost
        anything the legacy page declares, and NOTHING here can leak out and
        restyle the game. The one exception is the keyframes block, which has no
        selector at all; its names are prefixed `sc-` instead.

   WHY THE COLOURS COME FROM tuning.js. SC.palette is already the single source
   the three.js materials and the canvas-painted plates read (they cannot use a
   CSS variable). If this file re-typed the hexes, a palette change would move
   the 3D map and leave the chrome behind — which is exactly how a screen ends
   up half warm-black and half something else. So the tokens below are BUILT
   from SC.palette, and the rest of the file only ever names the token.

   The palette itself is DESIGN-BAR.md's Ruin Ledger: warm black, gold,
   parchment; Cinzel caps for headings, a serif for body, radius <= 6px, and
   blue is never chrome (it is reserved, in the map, for one edge kind).
   ═══════════════════════════════════════════════════════════════════════════ */

import { SC } from './tuning.js';

const P = SC.palette;

/* The style element's id, so a second open() can find the one it already put in
   the head instead of stacking a second copy (five opens, five stylesheets, was
   a real leak in an earlier overlay in this app). */
export const STYLE_ID = 'sc-shell-css';

/* Tokens. Declared on the overlay itself, NOT on :root — the overlay is the
   only thing allowed to know these values, and a token on :root would be
   readable (and overridable) by the whole game. */
const TOKENS = `
#sc-overlay{
  --sc-deep:${P.bgDeep}; --sc-panel:${P.bgPanel}; --sc-card:${P.bgCard};
  --sc-gold:${P.gold}; --sc-gold-bright:${P.goldBright};
  --sc-ember:${P.ember}; --sc-blood:${P.blood};
  --sc-emerald:${P.emerald}; --sc-azure:${P.azure};
  --sc-ink:${P.ink}; --sc-ink-dim:${P.inkDim};
  --sc-line:${P.border}; --sc-line-bright:${P.borderBright};
  --sc-parchment:${P.parchment};
  --sc-head:"Cinzel","Cinzel Decorative",Georgia,"Times New Roman",serif;
  --sc-body:"Crimson Text","EB Garamond",Georgia,serif;
  --sc-ui:"Rajdhani","Trebuchet MS",system-ui,sans-serif;
  --sc-r:4px;
  --sc-rail:330px;
  --sc-find:352px;
}`;

/* ── the sheet ───────────────────────────────────────────────────────────── */
export function css() {
  return `${TOKENS}
#sc-overlay{
  position:fixed;inset:0;z-index:${SC.overlay.zIndex};
  color-scheme:dark;
  display:flex;flex-direction:column;
  background:
    radial-gradient(ellipse 120% 90% at 50% 0%, rgba(80,66,36,.30) 0, rgba(12,11,10,0) 62%),
    var(--sc-deep);
  color:var(--sc-ink);
  font-family:var(--sc-body);font-size:15px;line-height:1.45;
  -webkit-font-smoothing:antialiased;
  overscroll-behavior:contain;
}
#sc-overlay *,#sc-overlay *::before,#sc-overlay *::after{box-sizing:border-box}
#sc-overlay button,#sc-overlay input{font:inherit;color:inherit}
#sc-overlay :focus-visible{outline:2px solid var(--sc-gold-bright);outline-offset:2px}

/* ── header ─────────────────────────────────────────────────────────────── */
#sc-overlay .sc-head{
  flex:0 0 auto;position:relative;z-index:6;
  background:linear-gradient(180deg,rgba(28,24,19,.97),rgba(23,21,15,.97));
  border-bottom:1px solid var(--sc-line);
  box-shadow:0 6px 22px rgba(0,0,0,.5);
  padding:10px 16px 0;
}
#sc-overlay .sc-head-top{display:flex;align-items:flex-start;gap:16px}
#sc-overlay .sc-title{min-width:0;flex:1 1 auto}
#sc-overlay .sc-title h1{
  margin:0;font-family:var(--sc-head);font-weight:900;
  /* DESIGN-BAR: a page title is 28-44px. The old ceiling of 25px kept the
     right family and colour and still measured under the bar on every desktop
     frame, which is the kind of miss that survives review. */
  font-size:clamp(20px,2.6vw,32px);letter-spacing:.08em;text-transform:uppercase;
  color:var(--sc-gold-bright);
  text-shadow:0 1px 0 #000,0 0 18px rgba(212,175,55,.18);
}
#sc-overlay .sc-title p{margin:2px 0 0;color:var(--sc-ink-dim);font-size:13.5px;max-width:78ch}
#sc-overlay .sc-head-right{display:flex;align-items:center;gap:8px;flex:0 0 auto}

/* the LIVE / PLANNED key — the contract's rule 3, said in the chrome so it is
   on screen before the player hovers anything */
#sc-overlay .sc-key{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
#sc-overlay .sc-key b{
  font-family:var(--sc-ui);font-size:10.5px;letter-spacing:.14em;font-weight:700;
  border:1px solid;border-radius:2px;padding:1px 5px;white-space:nowrap;
}
#sc-overlay .sc-key .k-live{color:var(--sc-emerald);border-color:rgba(58,168,107,.55);background:rgba(58,168,107,.10)}
#sc-overlay .sc-key .k-planned{color:var(--sc-parchment);border-color:rgba(217,203,170,.4);background:rgba(217,203,170,.07);border-style:dashed}
#sc-overlay .sc-key span{font-size:12px;color:var(--sc-ink-dim)}

#sc-overlay .sc-btn{
  background:rgba(23,21,15,.9);border:1px solid rgba(198,160,74,.38);border-radius:var(--sc-r);
  color:var(--sc-gold-bright);font-family:var(--sc-ui);font-size:13px;letter-spacing:.06em;
  padding:6px 11px;cursor:pointer;white-space:nowrap;transition:background .12s,border-color .12s;
}
#sc-overlay .sc-btn:hover{background:rgba(80,66,36,.42);border-color:var(--sc-gold)}
#sc-overlay .sc-btn.sc-x{font-size:18px;line-height:1;padding:4px 10px 6px;font-family:var(--sc-body)}

/* legend — the four icons off the owner's PDF, with the legend text verbatim */
#sc-overlay .sc-legend{
  display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;
  margin:8px 0 0;padding:7px 10px;list-style:none;
  border:1px solid rgba(80,66,36,.6);border-radius:var(--sc-r);
  background:rgba(12,11,10,.55);
}
#sc-overlay .sc-legend li{display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--sc-parchment)}
#sc-overlay .sc-legend .sc-ic{
  width:26px;height:20px;flex:0 0 auto;display:grid;place-items:center;
  border:1px solid rgba(198,160,74,.32);border-radius:3px;background:rgba(28,24,19,.9);
}
#sc-overlay .sc-legend .sc-ic svg{width:18px;height:14px;display:block}
#sc-overlay .sc-legend .sc-lg-rule{
  flex:1 1 220px;min-width:180px;color:var(--sc-ink-dim);font-style:italic;font-size:12px;
  border-left:1px solid rgba(80,66,36,.7);padding-left:12px;
}

/* the sideways strips (legend, chips) and their "there is more" affordance.
   On desktop both wrap and nothing is ever hidden, so the wrapper is inert and
   data-more is 0. Under 820px they scroll instead, and a phone player was
   measured seeing 3 of 5 legend items and 2 of 5 chips with no cue at all. */
#sc-overlay .sc-strip{position:relative;min-width:0}
#sc-overlay .sc-strip-chips{flex:1 1 220px}
#sc-overlay .sc-strip::after{
  content:'›';position:absolute;right:1px;top:1px;bottom:1px;width:26px;
  display:none;align-items:center;justify-content:flex-end;padding-right:6px;
  font-family:var(--sc-ui);font-size:20px;font-weight:700;line-height:1;color:var(--sc-gold-bright);
  text-shadow:0 0 7px #000,0 0 3px #000,0 1px 0 #000;
  pointer-events:none;border-radius:0 var(--sc-r) var(--sc-r) 0;
}
#sc-overlay .sc-strip[data-more="1"]::after{display:flex}
/* the fade is a MASK, not a gradient in a colour — the two strips sit on
   different backgrounds and a painted gradient matched neither of them */
#sc-overlay .sc-strip[data-more="1"] > *{
  -webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 44px),transparent);
  mask-image:linear-gradient(90deg,#000 calc(100% - 44px),transparent);
}

/* controls row: tabs · search · chips */
#sc-overlay .sc-controls{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:9px 0 10px}
#sc-overlay .sc-tabs{display:flex;border:1px solid rgba(198,160,74,.34);border-radius:var(--sc-r);overflow:hidden}
#sc-overlay .sc-tabs button{
  background:transparent;border:0;border-right:1px solid rgba(198,160,74,.22);
  color:var(--sc-ink-dim);font-family:var(--sc-ui);font-size:13px;letter-spacing:.07em;
  padding:6px 13px;cursor:pointer;text-transform:uppercase;
}
#sc-overlay .sc-tabs button:last-child{border-right:0}
#sc-overlay .sc-tabs button[aria-selected="true"]{background:rgba(212,175,55,.16);color:var(--sc-gold-bright)}

#sc-overlay .sc-search{position:relative;flex:1 1 260px;max-width:420px;min-width:190px}
#sc-overlay .sc-search input{
  width:100%;background:rgba(12,11,10,.8);border:1px solid rgba(198,160,74,.34);
  border-radius:var(--sc-r);padding:7px 30px 7px 30px;color:var(--sc-ink);
  font-family:var(--sc-body);font-size:14px;
}
#sc-overlay .sc-search input::-webkit-search-cancel-button,#sc-overlay .sc-search input::-webkit-search-decoration{-webkit-appearance:none;appearance:none;display:none}
#sc-overlay .sc-search input::placeholder{color:rgba(168,152,136,.75)}
#sc-overlay .sc-search .sc-mag{position:absolute;left:9px;top:50%;transform:translateY(-50%);color:var(--sc-ink-dim);font-size:13px;pointer-events:none}
#sc-overlay .sc-search .sc-clear{
  position:absolute;right:4px;top:50%;transform:translateY(-50%);
  background:none;border:0;color:var(--sc-ink-dim);cursor:pointer;font-size:15px;padding:2px 6px;display:none;
}
#sc-overlay .sc-search.has-q .sc-clear{display:block}

#sc-overlay .sc-chips{display:flex;flex-wrap:wrap;gap:6px}
#sc-overlay .sc-chip{
  background:rgba(12,11,10,.6);border:1px solid rgba(198,160,74,.28);border-radius:999px;
  color:var(--sc-ink-dim);font-family:var(--sc-ui);font-size:12px;letter-spacing:.04em;
  padding:4px 11px;cursor:pointer;display:flex;align-items:center;gap:6px;
}
#sc-overlay .sc-chip:hover{border-color:var(--sc-gold);color:var(--sc-parchment)}
#sc-overlay .sc-chip[aria-pressed="true"]{background:rgba(212,175,55,.2);border-color:var(--sc-gold);color:var(--sc-gold-bright)}
#sc-overlay .sc-chip svg{width:15px;height:12px}
#sc-overlay .sc-chip .sc-n{opacity:.62;font-variant-numeric:tabular-nums}

/* ── body / stage ───────────────────────────────────────────────────────── */
#sc-overlay .sc-body{flex:1 1 auto;display:flex;min-height:0;position:relative}
#sc-overlay .sc-stage{flex:1 1 auto;position:relative;min-width:0;min-height:0;overflow:hidden}
#sc-overlay .sc-stage.is-2d{overflow:auto;-webkit-overflow-scrolling:touch}
#sc-overlay .sc-stage canvas{display:block}

/* the boot curtain: the 3D map takes a moment to bake its plates, and a black
   rectangle with nothing in it reads as a broken feature */
#sc-overlay .sc-boot{
  position:absolute;inset:0;display:grid;place-items:center;gap:10px;
  background:var(--sc-deep);z-index:4;text-align:center;padding:24px;
}
#sc-overlay .sc-boot p{margin:0;font-family:var(--sc-head);letter-spacing:.12em;color:var(--sc-gold);font-size:14px;text-transform:uppercase}
#sc-overlay .sc-boot small{color:var(--sc-ink-dim);font-size:12.5px;max-width:42ch}
#sc-overlay .sc-boot.is-gone{display:none}

/* floating stage furniture */
#sc-overlay .sc-float{
  position:absolute;background:rgba(23,21,15,.96);border:1px solid var(--sc-line);
  border-radius:var(--sc-r);box-shadow:0 10px 30px rgba(0,0,0,.55);
}
#sc-overlay .sc-map-legend{left:12px;bottom:12px;width:min(286px,42vw);z-index:3}
/* the search answer and the explainer share the left gutter — never both */
#sc-overlay .sc-stage.is-finding .sc-map-legend{display:none}
#sc-overlay .sc-map-legend h2,#sc-overlay .sc-find h2{
  margin:0;font-family:var(--sc-head);font-size:11.5px;letter-spacing:.16em;text-transform:uppercase;
  color:var(--sc-gold);padding:8px 10px;border-bottom:1px solid rgba(80,66,36,.7);
  display:flex;align-items:center;justify-content:space-between;gap:8px;
}
#sc-overlay .sc-map-legend ol{margin:0;padding:7px 10px 9px 24px;font-size:12px;line-height:1.38;color:var(--sc-parchment)}
#sc-overlay .sc-map-legend li{margin:0 0 5px}
#sc-overlay .sc-map-legend li:last-child{margin-bottom:0}
#sc-overlay .sc-map-legend[data-open="0"] ol{display:none}
/* Closed, this panel IS its title bar, so the title has to be the button —
   a collapsed card with one small "▼ Show" in the corner reads as decoration
   and was measured being ignored. Both halves carry data-a="fold". */
#sc-overlay .sc-map-legend h2{padding:0;border-bottom:0}
#sc-overlay .sc-map-legend[data-open="1"] h2{border-bottom:1px solid rgba(80,66,36,.7)}
#sc-overlay .sc-fold-t{
  flex:1 1 auto;text-align:left;background:none;border:0;cursor:pointer;
  font:inherit;color:inherit;letter-spacing:inherit;text-transform:inherit;
  padding:8px 0 8px 10px;
}
#sc-overlay .sc-map-legend h2:hover .sc-fold-t,#sc-overlay .sc-map-legend h2:hover .sc-fold{color:var(--sc-gold-bright)}
#sc-overlay .sc-fold{background:none;border:0;color:var(--sc-ink-dim);cursor:pointer;font-size:12px;padding:8px 10px}
#sc-overlay .sc-find h2 .sc-fold{padding:0 2px}

/* resource / node find panel — A COLUMN OF THE BODY, NOT A CARD ON THE MAP.
   See the comment above it in render.js: floating, it covered 2 of 11 nodes on
   "cloth", 4 of 17 on "metal", and its own subject on "freshFish". Docked, the
   stage is simply narrower while an answer is up and scene.js refits the home
   camera into what is left, so the answer and the map it describes cannot
   overlap by construction. It keeps the panel look (its own border and
   background) minus the float's shadow and outer radius, which is what tells a
   player it is part of the frame rather than lying on top of it. */
#sc-overlay .sc-find{
  flex:0 0 var(--sc-find);width:var(--sc-find);min-width:0;min-height:0;
  display:none;flex-direction:column;position:relative;z-index:5;
  background:rgba(23,21,15,.96);border-right:1px solid var(--sc-line);
}
#sc-overlay .sc-find.is-on{display:flex}
#sc-overlay .sc-find h2{flex:0 0 auto}
#sc-overlay .sc-find .sc-find-body{flex:1 1 auto;overflow:auto;padding:0 0 6px}
#sc-overlay .sc-res{width:100%;text-align:left;background:none;border:0;border-bottom:1px solid rgba(80,66,36,.42);
  padding:7px 10px;cursor:pointer;display:flex;gap:9px;align-items:baseline;color:var(--sc-ink)}
#sc-overlay .sc-res:hover,#sc-overlay .sc-res:focus{background:rgba(212,175,55,.13)}
#sc-overlay .sc-res .sc-res-ic{width:18px;flex:0 0 auto;text-align:center}
#sc-overlay .sc-res .sc-res-n{flex:1 1 auto;min-width:0}
#sc-overlay .sc-res .sc-res-n b{font-weight:600;color:var(--sc-parchment)}
#sc-overlay .sc-res .sc-res-n i{display:block;font-style:normal;font-size:11.5px;color:var(--sc-ink-dim);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#sc-overlay .sc-res .sc-tag{flex:0 0 auto}
#sc-overlay .sc-tag{font-family:var(--sc-ui);font-size:9.5px;letter-spacing:.12em;border:1px solid;border-radius:2px;padding:0 4px}
#sc-overlay .sc-tag.t-res{color:var(--sc-azure);border-color:rgba(74,143,212,.5)}
#sc-overlay .sc-tag.t-biz{color:var(--sc-gold);border-color:rgba(212,175,55,.5)}
#sc-overlay .sc-tag.t-sys{color:var(--sc-ember);border-color:rgba(232,93,60,.5)}
#sc-overlay .sc-tag.t-ch{color:var(--sc-emerald);border-color:rgba(58,168,107,.5)}
#sc-overlay .sc-tag.t-planned{color:var(--sc-parchment);border-color:rgba(217,203,170,.45);border-style:dashed}

#sc-overlay .sc-flow{padding:10px}
#sc-overlay .sc-flow h3{margin:0 0 2px;font-family:var(--sc-head);font-size:15px;color:var(--sc-gold-bright);letter-spacing:.04em}
#sc-overlay .sc-flow .sc-sum{margin:0 0 9px;font-size:12.5px;color:var(--sc-ink-dim)}
#sc-overlay .sc-flow dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:4px 9px;align-items:baseline}
#sc-overlay .sc-flow dt{font-family:var(--sc-ui);font-size:10.5px;letter-spacing:.12em;color:var(--sc-ink-dim);text-transform:uppercase;white-space:nowrap}
#sc-overlay .sc-flow dd{margin:0;display:flex;flex-wrap:wrap;gap:4px}
#sc-overlay .sc-node-chip{
  background:rgba(12,11,10,.7);border:1px solid rgba(198,160,74,.3);border-radius:2px;
  color:var(--sc-parchment);font-size:12px;padding:1px 7px;cursor:pointer;
}
#sc-overlay .sc-node-chip:hover{border-color:var(--sc-gold);color:var(--sc-gold-bright)}
#sc-overlay .sc-node-chip.is-planned{border-style:dashed;opacity:.8}
#sc-overlay .sc-flow .sc-none{color:var(--sc-ink-dim);font-size:12px}
#sc-overlay .sc-empty{padding:12px 10px;color:var(--sc-ink-dim);font-size:13px}

/* ── the business rail (the second tab) ─────────────────────────────────── */
#sc-overlay .sc-rail{
  flex:0 0 var(--sc-rail);width:var(--sc-rail);overflow:auto;
  border-left:1px solid var(--sc-line);background:rgba(17,15,11,.96);
  display:none;
}
#sc-overlay .sc-body[data-view="businesses"] .sc-rail{display:block}
#sc-overlay .sc-rail h2{
  position:sticky;top:0;margin:0;padding:9px 12px;background:rgba(28,24,19,.98);
  border-bottom:1px solid var(--sc-line);font-family:var(--sc-head);font-size:11.5px;
  letter-spacing:.16em;text-transform:uppercase;color:var(--sc-gold);z-index:2;
}
/* the phone-only line that says where the 3D map went */
#sc-overlay .sc-hint{
  margin:0;padding:9px 12px;font-size:12.5px;line-height:1.35;
  color:var(--sc-parchment);background:rgba(212,175,55,.09);
  border-bottom:1px solid rgba(80,66,36,.6);
}
#sc-overlay .sc-hint b{color:var(--sc-gold-bright);font-weight:600}
#sc-overlay .sc-rail h3{
  margin:0;padding:8px 12px 4px;font-family:var(--sc-ui);font-size:11px;letter-spacing:.16em;
  text-transform:uppercase;color:var(--sc-ink-dim);
}
#sc-overlay .sc-row{
  width:100%;text-align:left;background:none;border:0;border-bottom:1px solid rgba(80,66,36,.35);
  padding:8px 12px;cursor:pointer;color:var(--sc-ink);display:block;
}
#sc-overlay .sc-row:hover,#sc-overlay .sc-row:focus{background:rgba(212,175,55,.12)}
#sc-overlay .sc-row[aria-current="true"]{background:rgba(212,175,55,.2);box-shadow:inset 3px 0 0 var(--sc-gold)}
#sc-overlay .sc-row.is-off{opacity:.33}
#sc-overlay .sc-row-h{display:flex;align-items:center;gap:8px}
#sc-overlay .sc-row-h b{flex:1 1 auto;font-weight:600;font-size:13.5px;color:var(--sc-parchment)}
#sc-overlay .sc-row-b{display:flex;gap:3px;flex:0 0 auto}
#sc-overlay .sc-row-b svg{width:15px;height:12px;opacity:.9}
#sc-overlay .sc-row small{display:block;font-size:11.5px;color:var(--sc-ink-dim);margin-top:1px}

/* ── footer ─────────────────────────────────────────────────────────────── */
#sc-overlay .sc-foot{
  flex:0 0 auto;display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center;
  padding:6px 16px;border-top:1px solid var(--sc-line);background:rgba(17,15,11,.96);
  font-family:var(--sc-ui);font-size:11.5px;letter-spacing:.05em;color:var(--sc-ink-dim);
}
#sc-overlay .sc-foot .sc-warn{color:var(--sc-ember)}
#sc-overlay .sc-foot .sc-sp{flex:1 1 auto}


/* ── the 2D fallback, mounted INSIDE this shell ─────────────────────────── */
/* 🔴 ONE TITLE, ONE LEGEND. fallback.js is also a standalone view (its own
   harness page has no chrome around it), so it draws its own <h2> and its own
   legend chips. Inside the shell that is the second copy of both, ten pixels
   under the first — the same duplication the 3D map had to remove from its
   district slabs, and it reads as a bug. The shell hides ITS OWN copy of the
   duplicate, and touches no line of fallback.js. The subtitle stays: it says
   something the header does not. */
#sc-overlay .sc-stage.is-2d .scf-head h2,
#sc-overlay .sc-stage.is-2d .scf-head .scf-legend{display:none}
/* The 2D stage SCROLLS, and an absolutely-positioned panel inside a scroll
   container scrolls away with the content — the search answer would leave the
   screen while the player read it. Fixed, against the viewport the overlay
   already fills, with the footer's height allowed for. */
#sc-overlay .sc-stage.is-2d .sc-float{position:fixed;top:auto;bottom:38px;left:12px}


/* ── narrow screens ─────────────────────────────────────────────────────── */
@media (max-width:820px){
  #sc-overlay{font-size:14px}
  #sc-overlay .sc-head{padding:8px 11px 0}
  #sc-overlay .sc-legend .sc-lg-rule{display:none}
  /* one row that scrolls sideways beats four rows that eat the map */
  #sc-overlay .sc-legend,#sc-overlay .sc-chips{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}
  #sc-overlay .sc-legend::-webkit-scrollbar,#sc-overlay .sc-chips::-webkit-scrollbar{display:none}
  #sc-overlay .sc-legend li,#sc-overlay .sc-chip{flex:0 0 auto}
  #sc-overlay .sc-rail{position:absolute;inset:0;width:auto;flex:none;z-index:8;border-left:0}
  /* on a phone the map is the secondary view, so the answer goes back over
     it as a sheet rather than eating the last of the width as a column */
  #sc-overlay .sc-find{position:absolute;left:12px;right:12px;bottom:12px;top:auto;width:auto;flex:none;
    max-height:60%;border:1px solid var(--sc-line);border-radius:var(--sc-r);
    box-shadow:0 10px 30px rgba(0,0,0,.55);z-index:9}
  #sc-overlay .sc-map-legend{width:calc(100% - 24px)}
  #sc-overlay .sc-search{max-width:none}
}
@media (max-width:560px){
  #sc-overlay .sc-title h1{font-size:16px;letter-spacing:.06em}
  #sc-overlay .sc-title p{display:none}
  #sc-overlay .sc-key span{display:none}
  #sc-overlay .sc-key{gap:5px}
  #sc-overlay .sc-head-right{gap:5px}
  /* the help button becomes its own glyph — the words are the panel's heading */
  #sc-overlay .sc-btn .sc-long{display:none}
  #sc-overlay .sc-controls{gap:7px;padding:7px 0 8px}
  #sc-overlay .sc-tabs button{padding:5px 9px;font-size:12px}
  #sc-overlay .sc-legend{padding:5px 8px;gap:4px 10px}
  #sc-overlay .sc-legend li{font-size:11.5px}
}
#sc-overlay .sc-btn .sc-short{display:none}
@media (max-width:560px){#sc-overlay .sc-btn .sc-short{display:inline}}

/* reduced motion: the shell has no essential animation, so there is nothing to
   turn off here — the scene reads the same query itself (three.boot.js). */
`;
}

export default css;
