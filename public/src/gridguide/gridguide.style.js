/* gridguide.style.js — the guide's stylesheet, injected once on first open.
   Everything is scoped under .gg- so nothing here can restyle the game. The
   palette sits beside the City Nodes screen (warm dark, gold, ember). */
export const CSS = `
.gg-overlay{position:fixed;inset:0;z-index:9000;background:rgba(8,6,4,.78);display:flex;justify-content:center;
  padding:calc(12px + env(safe-area-inset-top,0px)) 12px calc(12px + env(safe-area-inset-bottom,0px))}
.gg-sheet{--bg:#15110c;--panel:#1f1a13;--ink:#f1e9da;--muted:#b3a58c;--line:#3a3023;--gold:#e0b23c;--ember:#ff7a45;
  --ember-soft:#3a2119;--grid:#6cc0db;--grid-soft:#17303a;--ok:#6fd49a;--no:#ff8a80;
  width:100%;max-width:1040px;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:10px;
  display:flex;flex-direction:column;overflow:hidden;font-size:16px;line-height:1.6;color-scheme:dark}
.gg-top{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--line);background:var(--panel)}
.gg-top .gg-st{margin-right:auto;font-size:13px;color:var(--muted)}
.gg-top .gg-st.dirty{color:var(--ember);font-weight:700}
.gg-body{overflow-y:auto;padding:0 20px 56px;display:grid;gap:56px;-webkit-overflow-scrolling:touch}
.gg-sheet h1,.gg-sheet h2,.gg-sheet h3{margin:0;line-height:1.05;text-wrap:balance;text-transform:uppercase;letter-spacing:.02em;font-weight:800}
.gg-sheet h1{font-size:clamp(38px,7vw,76px)}
.gg-sheet h2{font-size:clamp(28px,4.4vw,44px)}
.gg-sheet h3{font-size:20px;font-weight:700}
.gg-sheet p{margin:0;max-width:66ch}
.gg-pw{white-space:pre-wrap}
.gg-eb{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--ember)}
.gg-sec{display:grid;gap:20px}
.gg-head{display:grid;gap:8px}
.gg-head p{color:var(--muted)}
.gg-btn{font:700 13px system-ui,sans-serif;padding:8px 14px;border-radius:5px;border:1px solid var(--line);background:var(--bg);color:var(--ink);cursor:pointer}
.gg-btn:hover{border-color:var(--gold)}
.gg-btn:focus-visible,.gg-x:focus-visible,.gg-tag:focus-visible{outline:2px solid var(--grid);outline-offset:2px}
.gg-btn.pri{background:var(--gold);border-color:var(--gold);color:#1a1409}
.gg-btn.sm{padding:4px 10px;font-size:12px}
.gg-btn.dan{color:var(--no)}
.gg-btn:disabled{opacity:.45;cursor:not-allowed}
.gg-x{font:700 12px system-ui;width:24px;height:24px;border-radius:50%;border:1px solid var(--line);background:var(--panel);color:var(--no);cursor:pointer;flex:none;line-height:1}
.gg-ctl,.gg-add,.gg-bar{display:none}
.gg-editing .gg-ctl,.gg-editing .gg-add{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.gg-editing .gg-bar{display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:8px 10px;border:1px dashed var(--line);border-radius:6px;font-size:12px;color:var(--muted)}
.gg-bar .lbl{margin-right:auto;font-family:ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase}
.gg-editing [data-ed]{outline:1px dashed var(--line);outline-offset:3px;border-radius:2px;cursor:text;min-width:2ch}
.gg-editing [data-ed]:hover{outline-color:var(--grid)}
.gg-editing [data-ed]:focus{outline:2px solid var(--grid)}
.gg-row{display:flex;gap:8px;align-items:flex-start}
.gg-row > :first-child{flex:1}
.gg-hero{position:relative;padding-block:48px 32px;display:grid;gap:18px;border-bottom:2px solid var(--gold)}
.gg-hero::before{content:"";position:absolute;inset:0;z-index:0;opacity:.45;pointer-events:none;
  background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);
  background-size:44px 44px;-webkit-mask-image:linear-gradient(to bottom,#000 30%,transparent);mask-image:linear-gradient(to bottom,#000 30%,transparent)}
.gg-hero > *{position:relative}
.gg-hero h1 span{display:block}
.gg-hero h1 span:nth-child(2){color:var(--gold)}
.gg-lede{font-size:18px;color:var(--muted)}
.gg-meta{display:flex;flex-wrap:wrap;gap:8px 20px;font-family:ui-monospace,monospace;font-size:13px;color:var(--muted);align-items:center}
.gg-meta > span{display:inline-flex;gap:6px;align-items:center}
.gg-hphoto img{display:block;width:100%;max-height:440px;object-fit:cover;border-radius:8px;border:1px solid var(--line)}
.gg-doors,.gg-scripts{display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:14px}
.gg-card{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:20px;display:grid;gap:10px;align-content:start}
.gg-card .gg-who{font-family:ui-monospace,monospace;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--grid)}
.gg-card .hook{font-weight:700}
.gg-card ul{margin:0;padding-left:18px;display:grid;gap:6px;color:var(--muted)}
.gg-flow{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));counter-reset:ggstep}
.gg-step{position:relative;padding:18px 16px 18px 0;display:grid;gap:6px;align-content:start;border-top:3px solid var(--ember)}
.gg-step::before{counter-increment:ggstep;content:counter(ggstep);font-weight:800;font-size:36px;color:var(--ember);line-height:1}
.gg-step b{font-size:16px}
.gg-step p{font-size:14.5px;color:var(--muted)}
@media (max-width:760px){.gg-flow{grid-template-columns:1fr}.gg-step{border-top:none;border-left:3px solid var(--ember);padding:2px 0 20px 18px}}
.gg-calc{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:20px;display:grid;gap:18px}
.gg-calc label{display:grid;gap:6px;font-size:14px;font-weight:700}
.gg-cr{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:18px}
.gg-calc input[type=range]{width:100%;accent-color:var(--gold)}
.gg-calc input[type=number]{font:15px ui-monospace,monospace;padding:8px 10px;border:1px solid var(--line);border-radius:5px;background:var(--bg);color:var(--ink);width:100%}
.gg-split{display:flex;height:38px;border-radius:5px;overflow:hidden;font:600 13px ui-monospace,monospace}
.gg-split div{display:flex;align-items:center;padding-inline:10px;white-space:nowrap;overflow:hidden;min-width:0;color:#fff}
.gg-split .m{background:#2f6f86}.gg-split .o{background:#c4471b}
.gg-ro{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}
.gg-ro div{display:grid;gap:2px}
.gg-ro small{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}
.gg-ro strong{font:600 21px ui-monospace,monospace;font-variant-numeric:tabular-nums}
.gg-fine{font-size:13px;color:var(--muted)}
.gg-map{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:2px;background:var(--gold);border:2px solid var(--gold);border-radius:8px;overflow:hidden}
.gg-dist{background:var(--panel);padding:18px;display:grid;gap:10px;align-content:start}
.gg-dist h3{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.gg-dist h3 small{font:500 11px ui-monospace,monospace;color:var(--muted);letter-spacing:.08em}
.gg-dist ul{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.gg-dist li{display:grid;gap:1px;font-size:14px;color:var(--muted)}
.gg-dist li b{color:var(--ink);font-size:15px}
.gg-tag{display:inline-block;font:500 10.5px ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;padding:2px 7px;border-radius:3px;justify-self:start;border:none}
.gg-tag.play{background:var(--grid-soft);color:var(--grid)}
.gg-tag.own{background:var(--ember-soft);color:var(--ember)}
.gg-editing .gg-tag{cursor:pointer}
.gg-faq{display:grid;border-top:1px solid var(--line)}
.gg-faq > div{border-bottom:1px solid var(--line);padding-block:12px;display:grid;gap:6px}
.gg-faq .q{font-weight:700;font-size:16px}
.gg-faq .a{color:var(--muted)}
.gg-check{display:grid;gap:10px;margin:0;padding:0;list-style:none}
.gg-check li{display:grid;grid-template-columns:20px 1fr;gap:10px;font-size:15px}
.gg-check li::before{content:"";width:14px;height:14px;border:2px solid var(--gold);border-radius:3px;margin-top:5px}
.gg-extras{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}
.gg-extras:empty{display:none}
.gg-blk{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:18px;display:grid;gap:8px;align-content:start;margin:0}
.gg-blk.wide{grid-column:1/-1}
.gg-blk.photo{padding:0;overflow:hidden}
.gg-blk.photo img{display:block;width:100%;height:auto;min-height:100px;background:var(--line)}
.gg-blk.photo figcaption{padding:10px 16px 14px;font-size:14px;color:var(--muted)}
.gg-blk.photo .gg-ctl{padding:0 16px 14px}
.gg-note{padding:10px 14px;border:1px solid var(--line);border-radius:6px;font-size:13px;color:var(--muted)}
@media (max-width:520px){.gg-overlay{padding-inline:0}.gg-sheet{border-radius:0}.gg-body{padding-inline:16px}}
@media (prefers-reduced-motion:reduce){.gg-sheet *{transition:none!important}}
`;
