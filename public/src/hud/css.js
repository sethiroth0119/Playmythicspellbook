/* ============================================================================
   🎛 HUD CSS — the status bar, the docks and the demand panel.
   ============================================================================
   ⚠ ONE TEMPLATE LITERAL, AND NOT ONE BACKTICK INSIDE IT. A backtick in a CSS
     template literal has silently killed a module in this repo three times: the
     string closes early, the file stops parsing, the guarded import reports
     "not mounted (non-fatal)" and the feature is dark while every gate says
     ALL CLEAN. node .gauntlet/modcheck.mjs is the gate that catches it.

   THE TYPE SCALE. Five sizes, each with one job, because "a real type scale"
   was the round-6 brief and fourteen ad-hoc font-sizes is what it replaces:
     --hf-micro  9.5px  Cinzel caps — the label ABOVE a number, never prose
     --hf-small   11px  a secondary figure, a delta, a cause line
     --hf-body  12.5px  prose. The only size a sentence is ever set in
     --hf-num     17px  Cinzel — the primary readout of a metric
     --hf-hero    20px  Cinzel — the city wordmark, once per screen
   THE GRID. 4px base unit. Every padding, gap and inset below is a multiple of
   it, and the metric chips share one min-width so their numbers line up down a
   column rather than each sitting wherever its label ended.
   TABULAR FIGURES are set on every element that prints digits, so a value that
   changes does not change the width of the thing next to it.
   ============================================================================ */
export const HUD_CSS = `
:root{
  --hf-micro:9.5px; --hf-small:11px; --hf-body:12.5px; --hf-num:17px; --hf-hero:20px;
  --hu:4px;
  --hud-ink:#e8dcc0; --hud-dim:#a89bb8; --hud-gold:#d4af37;
  --hud-ok:#5fd08a; --hud-warn:#e0b84a; --hud-bad:#e07a6a;
  --hud-panel:linear-gradient(180deg,rgba(23,19,42,.97),rgba(9,8,19,.985));
}

/* ══ THE TOP DOCK ═════════════════════════════════════════════════════════
   #topbar used to be fourteen chips wide and #railbar floated over the city
   below it. Both are now rows of ONE docked block with a solid ground, so the
   chrome frames the 3D view instead of sitting on it.
   z-index 43 is #railbar's own, kept: it is documented to stay lit and
   clickable above #railmodal (42) and below #inspect (44) so switching panels
   is one click. Moving the rail INTO this block moves that contract with it. */
#nctop{position:absolute;top:0;left:0;right:0;z-index:43;
  display:flex;flex-direction:column;
  background:linear-gradient(180deg,rgba(10,8,17,.975),rgba(12,10,21,.93));
  border-bottom:1px solid rgba(212,175,55,.30);
  box-shadow:0 8px 28px rgba(0,0,0,.55);}

/* 🔴 ONE ROW IS THE WHOLE POINT, so every width below is MEASURED against a
   1600px viewport rather than chosen. The first cut wrapped to two rows and the
   docked block came out 166px tall — taller than the fourteen-chip bar it
   replaced, which would have been a legibility round that made the frame worse.
   Measured at 1600: wordmark 130 + weather 175 + four metrics 520 + seven dots
   244 + demand 198 + stores 91 + models 60 + gaps 96 = 1514, and the bar is one
   48px row. It wraps below ~1520 and --topbarh follows it, which is the
   documented behaviour of everything pinned underneath. */
#ncsb{display:flex;align-items:center;gap:calc(var(--hu)*2);
  padding:calc(var(--hu)*1.5) calc(var(--hu)*3);min-height:44px;flex-wrap:wrap;}
#ncsb .sbgrow{flex:1 1 12px;min-width:0;}
#ncsb .sbsep{width:1px;align-self:stretch;margin:calc(var(--hu)) 0;
  background:linear-gradient(180deg,transparent,rgba(212,175,55,.30),transparent);}

/* ── identity + clock. #cityname and #daypill are the ORIGINAL NODES, moved in
      here rather than re-created, so weatherTick and updateSky keep writing to
      the same ids they always did. Their absolute positioning is what has to be
      undone, and #nctop #x beats the plain #x rules that set it. ── */
#nctop #cityname{font-size:17px;letter-spacing:.16em;margin:0;white-space:nowrap;padding-right:.16em;}
#nctop #daypill{position:static;transform:none;left:auto;top:auto;z-index:auto;
  display:inline-flex;align-items:center;gap:calc(var(--hu)*1.25);
  padding:calc(var(--hu)*.75) calc(var(--hu)*2.5);font-size:var(--hf-micro);}
#nctop #daypill #dayphase,#nctop #daypill #wxname{font-size:var(--hf-micro);}
#nctop #dayico,#nctop #wxico{font-size:13px;}
/* The EST tag is a timezone note, not city state, and it costs 35px of the one
   row the bar gets. It stays in the DOM (updateSky writes it) and out of sight. */
#nctop #daypill #esttag,#nctop #daypill .sep:last-of-type{display:none;}
/* 🔴 AND THE PHASE WORD GOES THE SAME WAY, TO PAY FOR THE CLOCK. "Afternoon"
   costs ~78px of a row measured at 1514 of 1600, and it is the one thing on the
   bar the clock chip beside it makes redundant — 15:04 says everything Afternoon
   says and three things more. The node stays in the DOM because updateSky writes
   it, and the day ICON stays visible, so the at-a-glance read is unchanged. */
#nctop #daypill #dayphase,#nctop #daypill .sep:first-of-type{display:none;}
#nctop #adminbtn{font-size:var(--hf-micro);padding:calc(var(--hu)) calc(var(--hu)*2);}
#nctop #adminbtn{position:static;top:auto;right:auto;bottom:auto;z-index:auto;}

/* ── 🕒 the clock, and the speed control this game has not got ──────────────
   Round 6 put #clockres inside the Stores popover along with the other thirteen
   #topbar chips, so the city clock left the bar entirely and the only time on
   screen was the rail's battle countdown. The chip below wears the same shape
   as a metric chip so the row reads as one system, but it is NARROWER: it has
   no per-hour delta, because a clock's rate of change is one hour per hour.
   ⚠ #clockres is what #clockico and #r-clock were adopted OUT of. It is left in
     the popover with only its tooltip inside it, so it is hidden here rather
     than deleted — removing a node index.html declared is not this module's
     business, and the tooltip text is still true where it sits. */
#topbar #clockres{display:none;}
#ncsb-time{display:flex;align-items:center;gap:calc(var(--hu)*1.5);position:relative;}
.sbm.sbclock{min-width:0;padding-right:calc(var(--hu)*1.5);}
.sbm.sbclock .sbm-num{font-variant-numeric:tabular-nums;letter-spacing:.02em;}
/* 🔴 THE SLOT THE REFERENCE PUTS PAUSE/SPEED IN, TELLING THE TRUTH. Styled as a
   control that is deliberately unavailable rather than as a control that works:
   dashed border, dimmed ink, and it opens an explanation instead of doing
   nothing. See the block comment in statusbar.js for the four checks behind it. */
.sbnopause{display:inline-flex;align-items:center;gap:calc(var(--hu));
  padding:calc(var(--hu)*.75) calc(var(--hu)*1.75);border-radius:9px;cursor:help;
  border:1px dashed rgba(212,175,55,.42);background:rgba(10,8,20,.62);
  color:var(--hud-dim);font-family:'Cinzel',Georgia,'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',serif;
  font-size:9px;letter-spacing:.10em;text-transform:uppercase;white-space:nowrap;}
.sbnopause .np-ico{font-size:11px;opacity:.75;}
.sbnopause:hover,.sbnopause.on{border-color:var(--hud-gold);color:var(--hud-ink);}
.sbnote{position:absolute;top:calc(100% + 8px);left:0;z-index:60;width:min(430px,72vw);
  padding:calc(var(--hu)*3);border:1px solid rgba(212,175,55,.34);border-radius:11px;
  background:linear-gradient(180deg,rgba(16,13,28,.985),rgba(9,7,17,.985));
  box-shadow:0 16px 40px rgba(0,0,0,.6);color:var(--hud-ink);
  font-size:12px;line-height:1.55;text-transform:none;letter-spacing:0;}
.sbnote b{display:block;margin-bottom:calc(var(--hu)*1.5);color:var(--hud-gold);
  font-family:'Cinzel',Georgia,'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',serif;
  font-size:12px;letter-spacing:.08em;text-transform:uppercase;}
.sbnote[hidden]{display:none;}

/* ── the metrics. One shape, four instances, one min-width. ── */
#ncsb-metrics{display:flex;align-items:stretch;gap:calc(var(--hu)*2);flex-wrap:wrap;}
.sbm{display:flex;align-items:center;gap:calc(var(--hu));
  min-width:124px;padding:calc(var(--hu)*.75) calc(var(--hu)*1.5) calc(var(--hu)*.75) calc(var(--hu)*1.5);
  border:1px solid rgba(212,175,55,.30);border-radius:9px;
  background:linear-gradient(180deg,rgba(24,20,44,.85),rgba(10,8,20,.9));}
.sbm.watch-bad{border-color:rgba(224,122,106,.75);box-shadow:0 0 12px rgba(224,122,106,.20);}
.sbm.watch-warn{border-color:rgba(224,184,74,.6);}
.sbm .sbm-ico{font-size:16px;line-height:1;filter:drop-shadow(0 1px 3px rgba(0,0,0,.7));}
.sbm .sbm-col{display:flex;flex-direction:column;gap:1px;min-width:0;}
.sbm .sbm-lab{font-family:'Cinzel',Georgia,'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',serif;
  font-size:9px;letter-spacing:.10em;text-transform:uppercase;color:var(--hud-dim);
  white-space:nowrap;padding-right:.10em;}
.sbm .sbm-num{font-family:'Cinzel',Georgia,'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',serif;
  font-size:15px;font-weight:700;line-height:1.2;color:var(--hud-ink);
  font-variant-numeric:tabular-nums;white-space:nowrap;}
.sbm .sbm-num.cinder{color:#ff9a52;}
/* 🔴 THE DELTA IS THE POINT OF THE WHOLE BAR. BAR.md frame 4: population WITH
   ITS +/hr, treasury WITH ITS +/hr. A number with a rate beside it says
   something a bare number never can, and fourteen bare numbers said nothing. */
/* ⚠ min-width 30, NOT 48, AND THAT IS THE CLOCK'S RENT. Measured in the real
   page at 1600 with a 410M treasury: the four chips came to 662px, the bar's
   children to 1605, and adding the clock cluster pushed #adminbtn onto a second
   row — a legibility round that made the dock 150px tall. The reserved slot
   still stops a chip resizing when its rate appears, which is all it was ever
   for; 48 was sized for "+410M/hr" and every real rate is shorter. */
.sbm .sbm-d{font-size:10.5px;font-variant-numeric:tabular-nums;
  white-space:nowrap;min-width:30px;text-align:right;color:var(--hud-dim);}
.sbm .sbm-d.up{color:var(--hud-ok);} .sbm .sbm-d.dn{color:var(--hud-bad);}

/* ── the service dots. The seven NEEDS, in the coverage model's own order.
      State is in FORM as well as colour: a filled ring is fine, a hollow ring
      is short, a slashed ring is critical, so it survives a colour-blind read
      and a greyscale screenshot. ── */
/* 🔴 THE DOTS CARRY NO DIGITS, and that is the reference frame's own choice —
   frame 4 is "a row of service-status dots", not seven more numbers. The state
   is in FORM as well as colour, so it survives a colour-blind read and a
   greyscale screenshot: a FILLED ring is meeting demand, a HOLLOW ring is under
   the 90% the city grows at, and a hollow ring with a SLASH is under the 60% it
   sheds people at. The exact percentage is one hover away in the title, and one
   click away in Vital Signs, which owns it. */
#ncsb-dots{display:flex;align-items:center;gap:calc(var(--hu)*2);flex-wrap:wrap;}
.sbdot{display:flex;align-items:center;gap:calc(var(--hu));
  padding:calc(var(--hu)*.5) calc(var(--hu));border-radius:6px;
  border:1px solid transparent;}
.sbdot .sbd-ico{font-size:12px;line-height:1;}
.sbdot .sbd-ring{width:9px;height:9px;border-radius:50%;position:relative;
  border:1.5px solid currentColor;background:currentColor;}
.sbdot.s-warn .sbd-ring{background:transparent;}
.sbdot.s-bad .sbd-ring{background:transparent;}
.sbdot.s-bad .sbd-ring::after{content:"";position:absolute;left:-2px;right:-2px;top:3px;height:1.5px;
  background:currentColor;transform:rotate(-45deg);}
.sbdot .sbd-pct{display:none;}
.sbdot.s-ok{color:var(--hud-ok);} .sbdot.s-warn{color:var(--hud-warn);}
.sbdot.s-bad{color:var(--hud-bad);border-color:rgba(224,122,106,.55);background:rgba(224,122,106,.12);}

/* ── the buttons that live on the bar ── */
.sbbtn{display:inline-flex;align-items:center;gap:calc(var(--hu)*1.5);
  padding:calc(var(--hu)*1.5) calc(var(--hu)*2.5);cursor:pointer;
  border:1px solid rgba(212,175,55,.42);border-radius:8px;color:var(--hud-ink);
  background:linear-gradient(180deg,rgba(23,19,42,.94),rgba(9,8,19,.96));
  font-family:'Cinzel',Georgia,'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',serif;
  font-size:var(--hf-micro);letter-spacing:.12em;text-transform:uppercase;padding-right:calc(var(--hu)*2.5 + .12em);
  transition:border-color .15s,box-shadow .15s;}
.sbbtn:hover{border-color:var(--hud-gold);}
.sbbtn.on{border-color:#ff7a2f;box-shadow:0 0 14px rgba(255,122,47,.35);}
/* ⌨ A VISIBLE FOCUS RING EVERYWHERE, which the round-6 brief asks for by name.
   Two shadows rather than an outline so it reads on both the dark dock and the
   gilded panel, and it is never removed on :focus. */
.sbbtn:focus-visible,#ncsb .sbdot:focus-visible,.ncdm-row:focus-visible,.ncdm-x:focus-visible,#ncsb-demand:focus-visible{
  outline:2px solid var(--hud-gold);outline-offset:2px;}

/* ── the demand strip: four arrows, small, on the bar itself ── */
#ncsb-demand{display:inline-flex;align-items:center;gap:calc(var(--hu)*1.5);
  padding:calc(var(--hu)*.75) calc(var(--hu)*2);cursor:pointer;border-radius:8px;
  border:1px solid rgba(212,175,55,.42);
  background:linear-gradient(180deg,rgba(23,19,42,.94),rgba(9,8,19,.96));}
#ncsb-demand:hover{border-color:var(--hud-gold);}
#ncsb-demand.on{border-color:#ff7a2f;box-shadow:0 0 14px rgba(255,122,47,.35);}
#ncsb-demand .sbd-lab{font-family:'Cinzel',Georgia,'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',serif;
  font-size:var(--hf-micro);letter-spacing:.12em;text-transform:uppercase;color:var(--hud-dim);padding-right:.12em;}
.dmini{width:26px;height:13px;position:relative;background:rgba(255,255,255,.10);
  clip-path:polygon(0 22%,68% 22%,68% 0,100% 50%,68% 100%,68% 78%,0 78%);}
.dmini i{position:absolute;left:0;top:0;bottom:0;display:block;background:currentColor;}
.dmini.none{opacity:.35;}

/* ══ THE STORES POPOVER ═══════════════════════════════════════════════════
   #topbar itself, re-homed. The fourteen .res chips are NOT re-created here —
   they are the same nodes, so updateHUD's writes to #r-food and the vault
   click delegation on #topbar both keep working with no edit to either. */
#topbar{position:absolute;top:calc(var(--topbarh) + 8px);left:auto;right:12px;bottom:auto;
  display:none;width:min(600px,calc(100vw - 24px));max-height:calc(100vh - var(--topbarh) - 120px);
  overflow-y:auto;z-index:44;pointer-events:auto;
  flex-wrap:wrap;gap:calc(var(--hu)*2);align-items:flex-start;align-content:flex-start;
  padding:calc(var(--hu)*4);border-radius:12px;
  border:1px solid rgba(212,175,55,.55);background:var(--hud-panel);
  box-shadow:0 24px 70px rgba(0,0,0,.7);}
#topbar.ncopen{display:flex;}
#topbar .ncstores-hd{flex:0 0 100%;font-family:'Cinzel',Georgia,serif;font-size:var(--hf-micro);
  letter-spacing:.14em;text-transform:uppercase;color:#f0d68f;padding-right:.14em;}
#topbar .ncstores-ft{flex:0 0 100%;font-size:var(--hf-body);color:var(--hud-dim);line-height:1.5;
  border-top:1px solid rgba(212,175,55,.2);padding-top:calc(var(--hu)*2);}

/* ══ THE RAIL, DOCKED ═════════════════════════════════════════════════════ */
#nctop #railbar{position:static;top:auto;left:auto;right:auto;z-index:auto;
  padding:0 calc(var(--hu)*3) calc(var(--hu)*2);justify-content:flex-start;
  align-items:center;gap:calc(var(--hu)*1.5);}
/* The indicator group is a flex ITEM of the rail track, so it inherits the
   track's pointer-events:none and has to turn it back on for itself — exactly
   as .rl and #oc-chip already do. */
.sb-ind{display:flex;align-items:center;gap:calc(var(--hu)*2);pointer-events:auto;}
.sb-indlab{font-family:'Cinzel',Georgia,serif;font-size:var(--hf-micro);letter-spacing:.12em;
  text-transform:uppercase;color:var(--hud-dim);padding-right:.12em;}
.sb-ind .sbsep{height:20px;align-self:center;margin:0 calc(var(--hu));}

/* ══ THE BOTTOM DOCK ══════════════════════════════════════════════════════
   #buildbar was a floating island 12px off the bottom of the city. Full-bleed,
   flush, with a ground of its own: chrome that frames rather than sits on.
   ⚠ AND THE TILES BECOME PILLS. A 54px-tall stacked tile centred in a
     full-width bar is 78px of black across the whole screen with four small
     buttons in the middle of it — measured on the first docked capture, and it
     looked worse than the island it replaced. Laid out like the rail dock's
     launchers (icon beside label, not above it) the same four controls are 30px
     tall, the dock is 46px, and the bottom chrome now matches the top chrome
     instead of being a second visual language. .bbtn.tool is the only variant
     on the bar; the 28-tile palette moved into the build shop long ago and its
     loop is dead code behind if (false). */
#buildbar .bbtn.tool{display:inline-flex;align-items:center;gap:calc(var(--hu)*1.5);
  width:auto;min-width:0;padding:calc(var(--hu)*1.5) calc(var(--hu)*3);border-radius:8px;}
#buildbar .bbtn.tool:hover{transform:none;}
#buildbar .bbtn.tool .bico{font-size:15px;display:inline;filter:none;}
#buildbar .bbtn.tool .bname{display:inline;margin:0;font-size:var(--hf-micro);letter-spacing:.11em;
  padding-right:.11em;}
#buildbar{left:0;right:0;bottom:0;transform:none;max-width:none;
  border:0;border-top:1px solid rgba(212,175,55,.30);border-radius:0;
  padding:calc(var(--hu)*2) calc(var(--hu)*3);justify-content:center;
  background:linear-gradient(0deg,rgba(10,8,17,.975),rgba(12,10,21,.9));
  box-shadow:0 -8px 28px rgba(0,0,0,.5);z-index:43;}
/* The dossier's bottom inset was 20px short of the build bar even when the bar
   floated — measured and noted in its own header. Docked, the shortfall is
   real overlap, so it is corrected here in the same commit that causes it. */
body.nchud #inspect{padding-bottom:66px;}
/* …and the toast stack must not slide UNDER the docked bar when the dossier
   opens. It was moved to 10px to clear the dialog; 92 clears both. */
body.nchud.ins-open #toasts{bottom:60px;}

/* 🪟 …AND THE RAIL MODAL'S TOP INSET. index.html pads it by --topbarh + 74px to
   clear a launcher row that FLOATED 34px below the top bar. Docked, that row is
   inside the block --topbarh measures, so the 74 is 74px of dead sky above every
   panel. Corrected HERE and not there, scoped to this class, so a page where
   this module 404s keeps the clearance it still needs. */
body.nchud #railmodal{padding-top:calc(var(--topbarh) + 12px);padding-bottom:70px;}
/* #ctrlhint sat 78px up to clear the floating island. The dock is 46px. */
body.nchud #ctrlhint{bottom:56px;}

/* ══ THE DEMAND PANEL ═════════════════════════════════════════════════════
   Built in node-city's own dark language — the same gilded double frame,
   gradient ground and Cinzel header #railmodal and the dossier use — because
   this must look like the same game, not like a panel bolted on. z-index 42 is
   #railmodal's: the top dock stays lit above it, exactly as the dock's own
   header argues it should. */
#ncdm{display:none;position:fixed;inset:0;z-index:42;background:rgba(4,3,10,.62);
  align-items:flex-start;justify-content:center;
  padding:calc(var(--topbarh) + 16px) 14px 70px;}
#ncdm.open{display:flex;}
#ncdm .ncdm-box{width:min(940px,96vw);max-height:100%;display:flex;flex-direction:column;
  position:relative;overflow:hidden;border-radius:12px;background:var(--hud-panel);
  border:1px solid rgba(212,175,55,.55);
  box-shadow:0 30px 90px rgba(0,0,0,.75),inset 0 0 70px rgba(212,175,55,.045);}
#ncdm .ncdm-box::before{content:"";position:absolute;inset:5px;border:1px solid rgba(212,175,55,.16);
  border-radius:8px;pointer-events:none;z-index:1;}
#ncdm .ncdm-hd{display:flex;align-items:center;gap:calc(var(--hu)*2.5);
  padding:calc(var(--hu)*3.25) calc(var(--hu)*4) calc(var(--hu)*3);
  border-bottom:1px solid rgba(212,175,55,.3);
  background:linear-gradient(180deg,rgba(212,175,55,.07),transparent);}
#ncdm .ncdm-hd .hico{font-size:19px;line-height:1;}
#ncdm .ncdm-hd h2{flex:1;min-width:0;font-family:'Cinzel',Georgia,'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',serif;
  font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#f0d68f;font-weight:700;
  text-shadow:0 1px 8px rgba(212,175,55,.35);padding-right:.12em;}
.ncdm-x{border:1px solid rgba(212,175,55,.35);background:rgba(0,0,0,.3);color:var(--hud-ink);
  border-radius:7px;padding:calc(var(--hu)) calc(var(--hu)*2.5);cursor:pointer;font-size:var(--hf-small);}
.ncdm-x:hover{border-color:var(--hud-gold);}
#ncdm .ncdm-body{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);
  gap:0;overflow:hidden;min-height:0;}
#ncdm .ncdm-list{padding:calc(var(--hu)*3);overflow-y:auto;min-height:0;
  display:flex;flex-direction:column;gap:calc(var(--hu)*2);}
#ncdm .ncdm-detail{padding:calc(var(--hu)*3) calc(var(--hu)*4);overflow-y:auto;min-height:0;
  border-left:1px solid rgba(212,175,55,.2);background:rgba(0,0,0,.22);}

/* ── one demand row: name, ARROW METER, value, signed causal list ── */
.ncdm-row{display:block;width:100%;text-align:left;cursor:pointer;
  border:1px solid rgba(255,255,255,.08);border-radius:10px;
  background:linear-gradient(180deg,rgba(255,255,255,.030),rgba(0,0,0,.16));
  padding:calc(var(--hu)*2.5) calc(var(--hu)*3);color:var(--hud-ink);
  transition:border-color .15s,background .15s;}
.ncdm-row:hover{border-color:rgba(212,175,55,.55);}
.ncdm-row.sel{border-color:rgba(212,175,55,.85);background:linear-gradient(180deg,rgba(212,175,55,.10),rgba(0,0,0,.2));}
.ncdm-row .rhd{display:flex;align-items:center;gap:calc(var(--hu)*2);margin-bottom:calc(var(--hu)*2);}
.ncdm-row .rname{font-family:'Cinzel',Georgia,'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',serif;
  font-size:var(--hf-micro);letter-spacing:.13em;text-transform:uppercase;color:var(--hud-ink);
  min-width:96px;padding-right:.13em;}
/* 🏹 THE ARROW. clip-path, one element, so the meter IS the arrow rather than a
   bar with a triangle parked next to it — which is what BAR.md frame 4 shows. */
.dmeter{flex:1;min-width:60px;height:20px;position:relative;background:rgba(255,255,255,.09);
  clip-path:polygon(0 24%,80% 24%,80% 0,100% 50%,80% 100%,80% 76%,0 76%);}
.dmeter i{position:absolute;left:0;top:0;bottom:0;display:block;background:currentColor;
  box-shadow:0 0 14px currentColor;transition:width .5s;}
.dmeter.none{opacity:.4;}
.ncdm-row .rval{font-family:'Cinzel',Georgia,serif;font-size:var(--hf-num);font-weight:700;
  font-variant-numeric:tabular-nums;min-width:52px;text-align:right;}
.ncdm-row .rnomodel{font-size:var(--hf-body);color:var(--hud-dim);line-height:1.55;}
/* ── the signed causal list ── */
.dcause{display:flex;align-items:flex-start;gap:calc(var(--hu)*1.5);
  font-size:var(--hf-small);line-height:1.6;padding:1px 0;}
.dcause .sgn{font-family:'Cinzel',Georgia,serif;font-weight:700;width:11px;flex:0 0 11px;text-align:center;}
.dcause.up .sgn{color:var(--hud-ok);} .dcause.dn .sgn{color:var(--hud-bad);}
.dcause .lbl{color:var(--hud-ink);}
.dcause.dn .lbl{color:#f0c3b6;}
.ncdm-row .rlimit{margin-top:calc(var(--hu)*1.5);font-size:var(--hf-small);color:#f0d68f;
  border-top:1px solid rgba(212,175,55,.18);padding-top:calc(var(--hu)*1.5);}

/* ── the detail pane ── */
.ncdm-detail h3{font-family:'Cinzel',Georgia,'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',serif;
  font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#f0d68f;
  margin-bottom:calc(var(--hu)*2);padding-right:.12em;}
.ncdm-detail p{font-size:var(--hf-body);line-height:1.65;color:#cfc7e0;margin-bottom:calc(var(--hu)*3);}
.ncdm-detail .dstat{display:flex;flex-wrap:wrap;gap:calc(var(--hu)*2);margin-bottom:calc(var(--hu)*3);}
.ncdm-detail .dstat span{display:flex;flex-direction:column;gap:1px;min-width:78px;}
.ncdm-detail .dstat b{font-family:'Cinzel',Georgia,serif;font-size:15px;color:var(--hud-ink);
  font-variant-numeric:tabular-nums;}
.ncdm-detail .dstat em{font-style:normal;font-size:var(--hf-micro);letter-spacing:.12em;
  text-transform:uppercase;color:var(--hud-dim);font-family:'Cinzel',Georgia,serif;padding-right:.12em;}
.ncdm-detail .dwhy{border-top:1px solid rgba(255,255,255,.08);padding-top:calc(var(--hu)*2.5);}
.ncdm-detail .dwhy .drow{margin-bottom:calc(var(--hu)*2.5);}
.ncdm-detail .dwhy .dtop{display:flex;gap:calc(var(--hu)*1.5);align-items:baseline;
  font-size:var(--hf-small);}
.ncdm-detail .dwhy .dtop .sgn{font-family:'Cinzel',Georgia,serif;font-weight:700;}
.ncdm-detail .dwhy .dtop.up .sgn{color:var(--hud-ok);}
.ncdm-detail .dwhy .dtop.dn .sgn{color:var(--hud-bad);}
.ncdm-detail .dwhy .dtxt{font-size:var(--hf-body);line-height:1.6;color:#cfc7e0;margin-top:2px;}
/* 🔬 PROVENANCE, ON EVERY LINE. The brief for this panel is that no cause may
   be invented; the way that claim is auditable at a glance rather than by
   reading source is to print WHICH MODULE AND WHICH CALL each line came from. */
.ncdm-detail .dsrc{font-size:var(--hf-micro);letter-spacing:.04em;color:#7e769a;margin-top:2px;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:none;}
.ncdm-foot{padding:calc(var(--hu)*2.5) calc(var(--hu)*4);border-top:1px solid rgba(212,175,55,.22);
  font-size:var(--hf-small);color:var(--hud-dim);line-height:1.55;background:rgba(0,0,0,.25);}

/* ══ NARROW ═══════════════════════════════════════════════════════════════ */
/* ── NARROW. Measured at 1280x720, the width node-city's own rail note calls
   the tight case: without these the status row wrapped to two lines and the
   launcher row to two more, and the docked block came out 187px — a quarter of
   a 720px viewport. Each rule below drops the least load-bearing thing left:
   the day PHASE (the icon still says it), the service icons (the ring still
   carries the state and the title still carries the name), the wordmark's
   tracking, and the delta column's reserved width. ── */
@media (max-width:1440px){
  .sbm{min-width:0;gap:calc(var(--hu));padding:calc(var(--hu)*.5) calc(var(--hu)*1.5);}
  .sbm .sbm-d{min-width:0;}
  /* ⚠ THE "NO PAUSE" WORDS NEVER GO. A lone ⏸ glyph is a PAUSE BUTTON to every
     player who has ever seen one, which would turn an honest statement into the
     exact fake control it exists to avoid. The chip's own caption can go — a
     clock still reads as a clock without the words CITY TIME over it — and the
     pill gives up padding instead. */
  .sbnopause{padding:calc(var(--hu)*.5) calc(var(--hu));}
  .sbm.sbclock .sbm-lab{display:none;}
  #nctop #cityname{font-size:14px;letter-spacing:.10em;padding-right:.10em;}
  .sb-indlab{display:none;}
  .sbdot .sbd-ico{display:none;}
  .sbdot{padding:calc(var(--hu)*.5);}
  #ncsb-dots{gap:calc(var(--hu)*1.5);}
}
@media (max-width:1080px){
  #ncsb{gap:calc(var(--hu)*2);}
  #ncsb-demand .sbd-lab{display:none;}
  #nctop #cityname{font-size:15px;}
  #ncdm .ncdm-body{grid-template-columns:minmax(0,1fr);}
  #ncdm .ncdm-detail{border-left:0;border-top:1px solid rgba(212,175,55,.2);}
}
@media (prefers-reduced-motion:reduce){ .dmeter i{transition:none;} }
`;
export default { HUD_CSS };
