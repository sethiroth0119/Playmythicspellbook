/* ══════════════════════════════════════════════════════════════════════════
   🖥 HUD — every pixel of the lab's 2D layer, and its stylesheet.
   ──────────────────────────────────────────────────────────────────────────
   The style block lives in this file rather than a sibling .css for one
   reason: the lab is opened and closed as an overlay, and a stylesheet that
   404s (a missed ?v= bump against the service worker — CLAUDE.md warns about
   exactly this) would leave the player looking at unstyled markup on top of
   their game. Inlined, the HUD either mounts whole or does not mount.

   ⚠ EVERY STRING THAT COULD CONTAIN PLAYER DATA GOES THROUGH `esc`. Carrier
   names and corporation names come from other players.
   ══════════════════════════════════════════════════════════════════════════ */

import { SEALS, sealCount, exposureBand } from './hazmat.js';
import { OBJECTIVES, STATIONS } from './stations.js';
import { REAGENTS, REAGENT_IDS, GRADES } from '../plague/cures.js';
import { AXES, AXIS_META, familyOf, severityLabel } from '../plague/strains.js';
/* The two shipment readers the bay needs. Imported rather than re-derived so
   "has it landed" is answered by ONE function — a second `Date.now() >=
   arrivesAt` written here is a second clock that will eventually disagree with
   the one that actually settles the shipment. */
import { isDue as LGisDue, etaText as etaOf } from '../plague/logistics.js';

export function esc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const pct = (v) => Math.round((+v || 0) * 100) + '%';
const num = (n) => (Number(n) || 0).toLocaleString();

export const CSS = `
.bl-root{position:fixed;inset:0;z-index:2400;background:#0a0e14;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#cfd8e6;overscroll-behavior:none;touch-action:none}
.bl-root canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.bl-root.is-flat canvas{display:none}
.bl-flatnote{position:absolute;inset:0;display:none;align-items:center;justify-content:center;padding:24px;text-align:center;font-size:13px;line-height:1.6;color:#8b93a3}
.bl-root.is-flat .bl-flatnote{display:flex}
.bl-layer{position:absolute;inset:0;pointer-events:none}
.bl-layer>*{pointer-events:auto}

/* ── top bar ── */
.bl-top{position:absolute;top:0;left:0;right:0;display:flex;gap:10px;align-items:center;padding:10px 12px;
  background:linear-gradient(#0a0e14ee,#0a0e1400);flex-wrap:wrap}
.bl-title{font-weight:700;letter-spacing:.12em;font-size:12px;color:#7fd6ff}
.bl-strain{font-size:11px;color:#e0b8c8;background:#1a1420;border:1px solid #3a2a38;border-radius:6px;padding:3px 8px}
.bl-spacer{flex:1}
.bl-x{background:#1a2130;border:1px solid #2e3a4a;color:#cfd8e6;border-radius:6px;padding:6px 12px;font:inherit;font-size:11px;cursor:pointer}
.bl-x:hover{border-color:#7fd6ff;color:#7fd6ff}

/* ── suit + exposure gauges ── */
.bl-gauges{position:absolute;top:52px;left:12px;display:flex;flex-direction:column;gap:8px;width:210px}
.bl-card{background:#0f141ce6;border:1px solid #212b38;border-radius:8px;padding:9px 10px}
.bl-card h4{margin:0 0 6px;font-size:10px;letter-spacing:.14em;color:#8b93a3;font-weight:700}
.bl-seals{display:flex;gap:5px}
.bl-seal{flex:1;height:7px;border-radius:3px;background:#232c3a;position:relative;overflow:hidden}
.bl-seal.on{background:#86e08a}
.bl-seal .fill{position:absolute;inset:0;width:0;background:#ffd166;transition:none}
.bl-sealtxt{margin-top:6px;font-size:10px;color:#8b93a3;line-height:1.4}
.bl-expo{height:9px;border-radius:5px;background:#232c3a;overflow:hidden}
.bl-expo i{display:block;height:100%;width:0;background:#86e08a}
.bl-expo-lbl{display:flex;justify-content:space-between;margin-top:5px;font-size:10px}

/* ── objectives ── */
.bl-obj{position:absolute;top:52px;right:12px;width:212px}
.bl-obj ol{margin:0;padding:0;list-style:none}
.bl-obj li{display:flex;gap:7px;align-items:flex-start;font-size:10.5px;padding:3px 0;color:#8b93a3;line-height:1.35}
.bl-obj li.done{color:#86e08a}
.bl-obj li b{font-weight:700;min-width:12px}

/* ── prompt + interact ── */
.bl-prompt{position:absolute;left:50%;bottom:118px;transform:translateX(-50%);background:#0f141cf2;border:1px solid #2e3a4a;
  border-radius:9px;padding:9px 14px;font-size:12px;text-align:center;max-width:min(92vw,460px);line-height:1.5;display:none}
.bl-prompt.on{display:block}
.bl-prompt.blocked{border-color:#ff5b6e;color:#ffb0ba;background:#1c1016f2}
.bl-prompt kbd{background:#232c3a;border:1px solid #3a4656;border-radius:4px;padding:1px 6px;font:inherit;font-size:10px;color:#7fd6ff}
.bl-act{position:absolute;right:24px;bottom:34px;width:88px;height:88px;border-radius:50%;background:#16202ccc;
  border:2px solid #2e3a4a;color:#cfd8e6;font:inherit;font-size:11px;font-weight:700;letter-spacing:.08em;cursor:pointer}
.bl-act:active{background:#1f2c3c}
.bl-act.hot{border-color:#7fd6ff;color:#7fd6ff}
.bl-act.no{border-color:#ff5b6e;color:#ff8a94}
.bl-stick{position:absolute;width:108px;height:108px;border-radius:50%;border:2px solid #2e3a4a55;
  transform:translate(-50%,-50%);display:none;pointer-events:none}
.bl-stick.on{display:block}
.bl-stick-nub{position:absolute;left:50%;top:50%;width:44px;height:44px;border-radius:50%;background:#7fd6ff44;
  border:1px solid #7fd6ff88;transform:translate(-50%,-50%)}

/* ── toasts ── */
.bl-toasts{position:absolute;left:50%;top:96px;transform:translateX(-50%);display:flex;flex-direction:column;gap:6px;align-items:center;width:min(92vw,520px)}
.bl-toast{background:#0f141cf2;border:1px solid #2e3a4a;border-left-width:3px;border-radius:7px;padding:7px 12px;font-size:11.5px;line-height:1.5}
.bl-toast.good{border-left-color:#86e08a}
.bl-toast.warn{border-left-color:#e0a860}
.bl-toast.bad{border-left-color:#ff5b6e}

/* ── modal panels ── */
.bl-modal{position:absolute;inset:0;background:#050810dd;display:flex;align-items:center;justify-content:center;padding:14px}
.bl-panel{background:#0d1218;border:1px solid #263140;border-radius:12px;width:min(96vw,720px);max-height:92vh;overflow:auto;padding:16px}
.bl-panel h3{margin:0 0 4px;font-size:14px;letter-spacing:.06em;color:#7fd6ff}
.bl-panel .sub{margin:0 0 14px;font-size:11px;color:#8b93a3;line-height:1.5}
.bl-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.bl-btn{background:#16202c;border:1px solid #2e3a4a;color:#cfd8e6;border-radius:7px;padding:9px 14px;font:inherit;font-size:11.5px;cursor:pointer}
.bl-btn:hover:not(:disabled){border-color:#7fd6ff;color:#7fd6ff}
.bl-btn:disabled{opacity:.4;cursor:not-allowed}
.bl-btn.pri{background:#153042;border-color:#2c6a8c;color:#7fd6ff}
.bl-btn.danger{background:#2a1218;border-color:#6a2c34;color:#ff8a94}

.bl-axes{display:grid;grid-template-columns:1fr;gap:7px;margin:10px 0}
.bl-ax{display:grid;grid-template-columns:100px 1fr 42px;gap:8px;align-items:center;font-size:11px}
.bl-bar{height:9px;border-radius:5px;background:#1a222e;position:relative;overflow:hidden}
.bl-bar i{position:absolute;left:0;top:0;bottom:0;background:#5a7fd8}
.bl-bar u{position:absolute;top:-2px;bottom:-2px;width:2px;background:#ffd166;text-decoration:none}
.bl-unknown{color:#5f6878;font-style:italic}

.bl-reagents{display:grid;grid-template-columns:repeat(auto-fill,minmax(196px,1fr));gap:7px;margin:10px 0}
.bl-rg{background:#111823;border:1px solid #202a38;border-radius:8px;padding:8px}
.bl-rg.sel{border-color:#7fd6ff}
.bl-rg-top{display:flex;align-items:center;gap:6px;font-size:11.5px}
.bl-rg-have{margin-left:auto;color:#8b93a3;font-size:10px}
.bl-rg-blurb{font-size:9.5px;color:#77808f;line-height:1.4;margin-top:4px}
.bl-rg-ctl{display:flex;gap:5px;align-items:center;margin-top:6px}
.bl-rg-ctl button{width:26px;height:26px;background:#1a2432;border:1px solid #2b3644;color:#cfd8e6;border-radius:5px;font:inherit;cursor:pointer}
.bl-rg-ctl input{flex:1;min-width:0;background:#0b0f16;border:1px solid #2b3644;color:#cfd8e6;border-radius:5px;padding:4px 6px;font:inherit;font-size:11px;text-align:center}

.bl-readout{display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:7px;margin:12px 0}
.bl-stat{background:#111823;border:1px solid #202a38;border-radius:8px;padding:8px}
.bl-stat b{display:block;font-size:17px;line-height:1.2}
.bl-stat span{font-size:9.5px;color:#8b93a3;letter-spacing:.1em}
.bl-grade{display:inline-block;border-radius:6px;padding:5px 11px;font-size:12px;font-weight:700;letter-spacing:.06em}
.bl-warn{font-size:10.5px;color:#e0a860;line-height:1.55;margin-top:3px}

.bl-list{display:flex;flex-direction:column;gap:7px;margin:10px 0}
.bl-item{background:#111823;border:1px solid #202a38;border-radius:8px;padding:9px 11px;font-size:11px;line-height:1.5}
.bl-item.sel{border-color:#7fd6ff}
.bl-item b{color:#cfd8e6}
.bl-item .meta{color:#8b93a3;font-size:10px;margin-top:3px}
.bl-empty{background:#111823;border:1px dashed #2b3644;border-radius:8px;padding:14px;font-size:11px;color:#8b93a3;line-height:1.6;text-align:center}

.bl-spin{height:14px;border-radius:7px;background:#1a222e;position:relative;overflow:hidden;margin:10px 0}
.bl-spin i{position:absolute;top:0;bottom:0;width:3px;background:#ffd166}
.bl-spin u{position:absolute;top:0;bottom:0;background:#2c6a4c;text-decoration:none}
@media (max-width:640px){
  .bl-gauges{width:154px}
  .bl-obj{display:none}
  .bl-act{width:74px;height:74px;right:16px;bottom:24px}
}
`;

/* ── the persistent overlay ────────────────────────────────────────────────
   Built once per open. `refresh(st)` writes text into existing nodes rather
   than re-rendering markup, because this runs at frame rate — an innerHTML
   rebuild every frame would garbage-collect the HUD into a slideshow. */
export function mountHud(root) {
  root.innerHTML = `
    <canvas class="bl-canvas"></canvas>
    <div class="bl-flatnote"></div>
    <div class="bl-layer">
      <div class="bl-top">
        <span class="bl-title">☣ CONTAINMENT LAB</span>
        <span class="bl-strain"></span>
        <span class="bl-spacer"></span>
        <button class="bl-x" data-act="exit">LEAVE LAB ✕</button>
      </div>
      <div class="bl-gauges">
        <div class="bl-card">
          <h4>HAZMAT SUIT</h4>
          <div class="bl-seals"></div>
          <div class="bl-sealtxt"></div>
        </div>
        <div class="bl-card">
          <h4>EXPOSURE</h4>
          <div class="bl-expo"><i></i></div>
          <div class="bl-expo-lbl"><span class="band"></span><span class="val"></span></div>
        </div>
      </div>
      <div class="bl-card bl-obj"><h4>RUN CHECKLIST</h4><ol></ol></div>
      <div class="bl-toasts"></div>
      <div class="bl-prompt"></div>
      <button class="bl-act" data-act="interact">USE</button>
      <div class="bl-stick"><div class="bl-stick-nub"></div></div>
      <div class="bl-modalhost"></div>
    </div>`;

  const q = (s) => root.querySelector(s);
  const nodes = {
    canvas: q('.bl-canvas'),
    flatnote: q('.bl-flatnote'),
    strain: q('.bl-strain'),
    seals: q('.bl-seals'),
    sealtxt: q('.bl-sealtxt'),
    expo: q('.bl-expo i'),
    expoBand: q('.bl-expo-lbl .band'),
    expoVal: q('.bl-expo-lbl .val'),
    obj: q('.bl-obj ol'),
    prompt: q('.bl-prompt'),
    act: q('.bl-act'),
    toasts: q('.bl-toasts'),
    modalhost: q('.bl-modalhost'),
  };

  // Seal pips, built once.
  nodes.seals.innerHTML = SEALS.map(() => '<div class="bl-seal"><i class="fill"></i></div>').join('');
  nodes.sealPips = Array.from(nodes.seals.querySelectorAll('.bl-seal'));

  nodes.obj.innerHTML = OBJECTIVES.map((o) =>
    '<li data-obj="' + esc(o.key) + '"><b>○</b><span>' + esc(o.text) + '</span></li>').join('');
  nodes.objItems = {};
  for (const li of nodes.obj.querySelectorAll('li')) nodes.objItems[li.getAttribute('data-obj')] = li;

  return nodes;
}

export function refresh(nodes, st) {
  const suit = st.suit;
  const now = Date.now();

  // ── seals
  for (let i = 0; i < nodes.sealPips.length; i++) {
    const s = SEALS[i], pip = nodes.sealPips[i], fill = pip.querySelector('.fill');
    const on = !!suit.seals[s.key];
    pip.classList.toggle('on', on);
    if (!on && suit.donning && suit.donning.key === s.key) {
      const p = Math.min(1, (now - suit.donning.startedAt) / suit.donning.ms);
      fill.style.width = (p * 100) + '%';
    } else {
      fill.style.width = on ? '100%' : '0';
    }
  }
  /* 🔴 SAY WHAT TO DO, NOT JUST WHAT IS TRUE. The donning line used to read
     "⏳ Zip and tape the torso…" and stop there, which told a player nothing
     about whether to wait, walk away, or press the key again — and when a
     clock bug froze the sequence, there was nothing on screen to contradict
     the filled bar. Every state now names the next action. */
  const n = sealCount(suit);
  nodes.sealtxt.textContent = suit.sealed
    ? '✅ SEALED — hot-zone benches will run.'
    : suit.donning
      ? '⏳ ' + suit.donning.icon + ' ' + suit.donning.label + '… (' + (n + 1) + '/' + SEALS.length + ') — stand still.'
      : n === 0
        ? '❌ No suit. Stand in the airlock and press E.'
        : n + ' of ' + SEALS.length + ' seals — press E at the airlock to resume.';

  // ── exposure
  const band = exposureBand(suit.exposure);
  nodes.expo.style.width = Math.min(100, suit.exposure * 260) + '%';
  nodes.expo.style.background = band.color;
  nodes.expoBand.textContent = band.label;
  nodes.expoBand.style.color = band.color;
  nodes.expoVal.textContent = (suit.exposure * 100).toFixed(1) + '%';

  // ── objectives
  for (const k of Object.keys(nodes.objItems)) {
    const done = !!st.done[k];
    const li = nodes.objItems[k];
    li.classList.toggle('done', done);
    li.querySelector('b').textContent = done ? '●' : '○';
  }

  // ── strain chip
  if (st.strain) {
    const f = familyOf(st.strain.family);
    nodes.strain.textContent = f.icon + ' ' + st.strain.name + ' · ' + st.strain.isolate + ' · ' + severityLabel(st.strain.severity);
    nodes.strain.style.display = '';
  } else {
    nodes.strain.textContent = 'NO ACTIVE STRAIN';
    nodes.strain.style.display = '';
  }

  // ── prompt + interact button
  const near = st.near;
  if (!near) {
    nodes.prompt.classList.remove('on');
    nodes.act.className = 'bl-act';
    nodes.act.textContent = 'USE';
  } else {
    const s = near.station;
    const blocked = st.blocked;
    nodes.prompt.classList.add('on');
    nodes.prompt.classList.toggle('blocked', !!blocked);
    nodes.prompt.innerHTML = blocked
      ? esc(blocked)
      : '<b>' + esc(s.icon + ' ' + s.name) + '</b> — ' + esc(s.prompt) +
        ' <kbd>E</kbd> <kbd>SPACE</kbd><br><span style="color:#77808f">' + esc(s.blurb) + '</span>';
    nodes.act.className = 'bl-act ' + (blocked ? 'no' : 'hot');
    nodes.act.textContent = blocked ? 'BLOCKED' : s.short;
  }
}

export function toast(nodes, text, kind) {
  try {
    const d = document.createElement('div');
    d.className = 'bl-toast ' + (kind || '');
    d.textContent = text;
    nodes.toasts.appendChild(d);
    setTimeout(() => { try { d.remove(); } catch (e) {} }, kind === 'bad' ? 7000 : 4200);
    // Never let a flood of events push the HUD off screen.
    while (nodes.toasts.children.length > 5) nodes.toasts.firstChild.remove();
  } catch (e) {}
}

/* ══ PANELS ════════════════════════════════════════════════════════════════
   Each returns an HTML string. The caller wires the buttons; keeping these
   pure makes them renderable in a test page with no game behind them. */

export function sequencerPanel(strain, known) {
  const f = familyOf(strain.family);
  const rows = AXES.map((ax) => {
    const m = AXIS_META[ax];
    const v = strain.sig[ax] | 0;
    return '<div class="bl-ax"><span>' + esc(m.icon + ' ' + m.label) + '</span>' +
      '<div class="bl-bar">' + (known ? '<i style="width:' + v + '%"></i>' : '') + '</div>' +
      '<span>' + (known ? v : '<span class="bl-unknown">??</span>') + '</span></div>' +
      (known ? '<div style="font-size:9.5px;color:#6b7382;margin:-3px 0 3px 108px">' + esc(m.blurb) + '</div>' : '');
  }).join('');
  return '<h3>🧭 SEQUENCER — ' + esc(strain.name) + ' (' + esc(strain.isolate) + ')</h3>' +
    '<p class="sub">' + esc(f.icon + ' ' + f.name) + ' · ' + esc(severityLabel(strain.severity)) +
    ' · contagion ' + pct(strain.contagion) +
    (strain.origin === 'iatrogenic' ? ' · <span style="color:#ff8a94">☣ IATROGENIC — this one came out of a botched batch</span>' : '') +
    (strain.resistance > 0 ? ' · <span style="color:#e0a860">resistance ' + pct(strain.resistance) + '</span>' : '') +
    '</p>' + '<div class="bl-axes">' + rows + '</div>' +
    (known
      ? '<p class="sub">Read complete. Match a reagent blend to these four numbers at the bench.</p>'
      : '<p class="sub">Run the sequence to reveal the signature. Formulating blind caps what the batch can ever be.</p>') +
    '<div class="bl-row">' +
      (known ? '' : '<button class="bl-btn pri" data-act="seq-run">RUN SEQUENCE</button>') +
      '<button class="bl-btn" data-act="close">CLOSE</button></div>';
}

export function centrifugePanel(state) {
  // The rotor game: a moving needle and a green band. Stopping inside the band
  // is purity. It is one button and it is legible on a phone.
  const target = state.target || 0.5, width = state.width || 0.16;
  return '<h3>🌀 CENTRIFUGE</h3>' +
    '<p class="sub">Spin the reagents to separate them. Stop the rotor inside the green band — ' +
    'under-spin leaves sediment, over-spin shears the batch apart. This sets PURITY.</p>' +
    '<div class="bl-spin"><u style="left:' + ((target - width / 2) * 100) + '%;width:' + (width * 100) + '%"></u>' +
    '<i style="left:' + ((state.pos || 0) * 100) + '%"></i></div>' +
    '<div class="bl-row">' +
      '<button class="bl-btn pri" data-act="spin-stop">' + (state.running ? 'STOP THE ROTOR' : 'START') + '</button>' +
      '<button class="bl-btn" data-act="close">CLOSE</button></div>' +
    (state.result != null
      ? '<p class="sub" style="margin-top:10px">Result: <b style="color:' +
        (state.result > 0.7 ? '#86e08a' : state.result > 0.4 ? '#e0a860' : '#ff8a94') + '">' +
        pct(state.result) + ' separation</b>. ' +
        (state.result > 0.7 ? 'Clean.' : state.result > 0.4 ? 'Usable, with sediment.' : 'Sheared. Run it again if you can afford to.') +
        '</p>' : '');
}

export function synthesisPanel(ctx) {
  const { strain, mix, have, f, known } = ctx;
  const cards = REAGENT_IDS.map((id) => {
    const R = REAGENTS[id];
    const units = (mix[id] | 0);
    const stock = have[id] | 0;
    return '<div class="bl-rg' + (units ? ' sel' : '') + '">' +
      '<div class="bl-rg-top">' + esc(R.icon) + ' <b>' + esc(R.name) + '</b>' +
      '<span class="bl-rg-have">' + num(stock) + ' held</span></div>' +
      '<div class="bl-rg-blurb">' + esc(R.blurb) + '</div>' +
      '<div class="bl-rg-ctl">' +
        '<button data-act="mix-" data-id="' + esc(id) + '">−</button>' +
        '<input type="number" min="0" step="1" value="' + units + '" data-act="mix=" data-id="' + esc(id) + '">' +
        '<button data-act="mix+" data-id="' + esc(id) + '"' + (units >= stock ? ' disabled' : '') + '>+</button>' +
      '</div></div>';
  }).join('');

  const target = AXES.map((ax) => {
    const want = known ? (strain.sig[ax] | 0) : null;
    const got = Math.round(f.blend[ax] || 0);
    return '<div class="bl-ax"><span>' + esc(AXIS_META[ax].icon + ' ' + AXIS_META[ax].label) + '</span>' +
      '<div class="bl-bar"><i style="width:' + got + '%"></i>' +
      (want != null ? '<u style="left:' + want + '%"></u>' : '') + '</div>' +
      '<span>' + got + (want != null ? '/' + want : '') + '</span></div>';
  }).join('');

  return '<h3>⚗️ SYNTHESIS BENCH</h3>' +
    '<p class="sub">Blue is your blend; the amber tick is the strain. Close the gap on all four axes.' +
    (known ? '' : ' <b style="color:#e0a860">You have not sequenced this strain — the ticks are hidden and the batch is capped.</b>') +
    '</p>' +
    '<div class="bl-axes">' + target + '</div>' +
    '<div class="bl-reagents">' + cards + '</div>' +
    readoutHtml(f) +
    '<div class="bl-row">' +
      (known ? '<button class="bl-btn" data-act="mix-auto">SUGGEST A BLEND</button>' : '') +
      '<button class="bl-btn" data-act="mix-clear">EMPTY THE VESSEL</button>' +
      '<button class="bl-btn pri" data-act="mix-commit"' + (f.total > 0 ? '' : ' disabled') + '>MIX THE BATCH</button>' +
      '<button class="bl-btn" data-act="close">CLOSE</button></div>';
}

export function readoutHtml(f) {
  const g = f.grade || GRADES.inert;
  return '<div class="bl-readout">' +
    stat(pct(f.efficacy), 'EFFICACY', f.efficacy > 0.8 ? '#86e08a' : f.efficacy > 0.5 ? '#e0a860' : '#ff8a94') +
    stat(f.purity + '%', 'PURITY', f.purity > 65 ? '#86e08a' : f.purity > 40 ? '#e0a860' : '#ff8a94') +
    stat(f.stability + '%', 'STABILITY', f.stability > 60 ? '#86e08a' : f.stability > 35 ? '#e0a860' : '#ff5b6e') +
    stat(num(f.doses), 'DOSES', '#cfd8e6') +
    stat(pct(f.risk), 'MUTATION RISK', f.risk < 0.1 ? '#86e08a' : f.risk < 0.35 ? '#e0a860' : '#ff5b6e') +
    '</div>' +
    '<div><span class="bl-grade" style="background:' + g.color + '22;color:' + g.color + ';border:1px solid ' + g.color + '55">' +
    esc(g.icon + ' ' + g.label) + '</span> <span style="font-size:10.5px;color:#8b93a3">' + esc(g.blurb) + '</span></div>' +
    (f.warnings || []).map((w) => '<div class="bl-warn">' + esc(w) + '</div>').join('');
}

function stat(v, label, color) {
  return '<div class="bl-stat"><b style="color:' + color + '">' + v + '</b><span>' + esc(label) + '</span></div>';
}

export function assayPanel(f, ran) {
  if (!ran) {
    return '<h3>🔬 ASSAY / QC</h3>' +
      '<p class="sub">The last station that will tell you the truth. It reads the batch you actually made — ' +
      'not the one you meant to make. Shipping without it is a bet you are placing blind.</p>' +
      '<div class="bl-row"><button class="bl-btn pri" data-act="assay-run">RUN THE ASSAY</button>' +
      '<button class="bl-btn" data-act="close">SKIP IT</button></div>';
  }
  return '<h3>🔬 ASSAY / QC — RESULT</h3>' +
    '<p class="sub">This is what is in the vessel right now.</p>' + readoutHtml(f) +
    '<div class="bl-row"><button class="bl-btn" data-act="close">UNDERSTOOD</button></div>';
}

export function dispatchPanel(ctx) {
  const { batches, market, sel, quote, online, transit } = ctx;

  /* ── ON THE ROAD. Rendered FIRST and rendered even when there is nothing to
     ship, because a player who came here to ask "where is my crate" must not
     be told "nothing to ship" and shown a dead end. A landed shipment settles
     on the game's own poll within a couple of minutes anyway; this is the
     button for people who do not want to wait for it. */
  const tl = (transit || []).map((s) => {
    const due = LGisDue(s);
    return '<div class="bl-item"' + (due ? ' style="border-color:#86e08a"' : '') + '>' +
      '<b>🚚 ' + esc(s.carrierName) + ' → ' + esc(s.labName) + '</b>' +
      '<div class="meta">' + num(s.doses) + ' doses · integrity ' + pct(s.integrity) + ' · ' +
      (due ? '<b style="color:#86e08a">LANDED</b>' : 'arrives in ' + esc(etaOf(s))) + '</div>' +
      (due ? '<div class="bl-row"><button class="bl-btn pri" data-act="collect" data-id="' + esc(s.id) + '">RECEIVE THE CRATE</button></div>' : '') +
      '</div>';
  }).join('');
  const transitHtml = (transit && transit.length)
    ? '<h4 style="font-size:10px;letter-spacing:.14em;color:#8b93a3;margin:6px 0">ON THE ROAD</h4><div class="bl-list">' + tl + '</div>'
    : '';

  if (!batches.length) {
    return '<h3>📦 DISPATCH BAY</h3>' + transitHtml +
      '<div class="bl-empty">Nothing new to ship. Mix a batch at the Synthesis Bench first.</div>' +
      '<div class="bl-row"><button class="bl-btn" data-act="close">CLOSE</button></div>';
  }
  const bl = batches.map((b) => {
    const g = GRADES[b.f.grade] || GRADES.inert;
    return '<div class="bl-item' + (sel.batchId === b.id ? ' sel' : '') + '" data-act="pick-batch" data-id="' + esc(b.id) + '">' +
      '<b>' + esc(b.strainName) + ' · ' + esc(b.strainIsolate) + '</b> — ' +
      '<span style="color:' + g.color + '">' + esc(g.icon + ' ' + g.label) + '</span>' +
      '<div class="meta">' + num(b.f.doses) + ' doses · stability ' + b.f.stability + '% · purity ' + b.f.purity +
      '% · mutation risk ' + pct(b.f.risk) + '</div></div>';
  }).join('');

  const cl = market.carriers.length
    ? market.carriers.map((c) => {
        const q = c.quote;
        return '<div class="bl-item' + (sel.carrierId === c.id ? ' sel' : '') + '" data-act="pick-carrier" data-id="' + esc(c.id) + '">' +
          '<b>🚚 ' + esc(c.name) + '</b>' + (c.mine ? ' <span style="color:#86e08a">· yours</span>' : ' · ' + esc(c.ownerName)) +
          '<div class="meta">cold-chain integrity <b style="color:' +
          (q.integrity > 0.8 ? '#86e08a' : q.integrity > 0.6 ? '#e0a860' : '#ff8a94') + '">' + pct(q.integrity) + '</b>' +
          ' · ' + c.workers + ' crew · L' + c.level + ' · ' + num(q.fee) + ' 🔥' +
          (c.rating != null ? ' · rating ' + c.rating : '') + '</div></div>';
      }).join('')
    : '<div class="bl-empty">No player is running a Transportation Company right now.<br>' +
      'A cure cannot ship itself — found one at City Hall, or wait for a haulier to open.' +
      (online ? '' : '<br><span style="color:#e0a860">You are offline, so only your own operations are listed.</span>') +
      '</div>';

  const ll = market.labs.length
    ? market.labs.map((l) =>
        '<div class="bl-item' + (sel.labId === l.id ? ' sel' : '') + '" data-act="pick-lab" data-id="' + esc(l.id) + '">' +
        '<b>🏥 ' + esc(l.name) + '</b>' + (l.mine ? ' <span style="color:#86e08a">· yours</span>' : ' · ' + esc(l.ownerName)) +
        '<div class="meta">takes up to ' + num(l.capacity) + ' doses · ' + l.workers + ' staff · L' + l.level +
        (l.canAdminister ? '' : ' · <span style="color:#ff8a94">unstaffed — it cannot administer</span>') + '</div></div>').join('')
    : '<div class="bl-empty">No player-owned Medical Corporation is receiving.<br>' +
      'The lab at the far end is where doses become treatment — without one, the crate has nowhere to go.</div>';

  return '<h3>📦 DISPATCH BAY</h3>' + transitHtml +
    '<p class="sub">A cure in this room has cured nobody. Hire a player-owned haulier to run it to a ' +
    'player-owned Medical Corporation. The carrier you pick changes what arrives — a broken cold chain ' +
    'can turn a cure into the next outbreak in transit.</p>' +
    '<h4 style="font-size:10px;letter-spacing:.14em;color:#8b93a3;margin:14px 0 6px">1 · THE BATCH</h4><div class="bl-list">' + bl + '</div>' +
    '<h4 style="font-size:10px;letter-spacing:.14em;color:#8b93a3;margin:14px 0 6px">2 · THE CARRIER</h4><div class="bl-list">' + cl + '</div>' +
    '<h4 style="font-size:10px;letter-spacing:.14em;color:#8b93a3;margin:14px 0 6px">3 · THE RECEIVING LAB</h4><div class="bl-list">' + ll + '</div>' +
    (quote
      ? '<div class="bl-item" style="border-color:#2c6a8c;margin-top:12px"><b>WAYBILL</b><div class="meta">' +
        num(quote.fee) + ' 🔥 Cinder · ' + quote.crew + ' crew · ' + quote.hours + 'h on the road · ' +
        'integrity ' + pct(quote.integrity) + ' · the lab keeps ' + pct(quote.labShare) + ' of the fee</div></div>'
      : '') +
    '<div class="bl-row">' +
      '<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:#8b93a3">' +
      '<input type="checkbox" data-act="coldpack"' + (sel.coldPack ? ' checked' : '') + '> insulated cold-pack (+35% fee, +10% integrity)</label>' +
    '</div>' +
    '<div class="bl-row">' +
      '<button class="bl-btn pri" data-act="dispatch-go"' + (quote ? '' : ' disabled') + '>DISPATCH</button>' +
      '<button class="bl-btn danger" data-act="destroy"' + (sel.batchId ? '' : ' disabled') + '>INCINERATE THIS BATCH</button>' +
      '<button class="bl-btn" data-act="close">CLOSE</button></div>';
}

/* 🔴 THE PREVIOUS HANDLER IS REMOVED BEFORE THE NEW ONE IS ADDED, and that is
   not tidiness — it is a correctness bug if you skip it. Panels re-render
   themselves by calling modal() again (the reagent grid does it on every ±),
   and the host element survives every one of those. Without the detach, a
   listener is added per render and they ALL fire on the next click: the tenth
   render turns one press of "+" into ten units of Corrupted Essence, out of a
   ledger the player is watching. The scroll position is preserved across the
   swap for the same reason — a re-render that jumps the panel back to the top
   makes the grid unusable on a phone. */
export function modal(nodes, html, onClick) {
  const host = nodes.modalhost;
  detachModal(host);
  let scroll = 0;
  try { const p = host.querySelector('.bl-panel'); if (p) scroll = p.scrollTop || 0; } catch (e) {}

  host.innerHTML = '<div class="bl-modal"><div class="bl-panel">' + html + '</div></div>';
  try { const p = host.querySelector('.bl-panel'); if (p && scroll) p.scrollTop = scroll; } catch (e) {}

  const handler = (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) {
      // Click on the backdrop closes. Clicks inside the panel do not.
      if (e.target.classList && e.target.classList.contains('bl-modal')) onClick('close', null, e);
      return;
    }
    /* 🔴 INPUTS ARE DRIVEN BY `change`, NEVER BY `click`. Both listeners point
       at this one handler, so without this line every form control fires it
       twice — and for the reagent number field the click arm re-renders the
       panel the instant you tap into it, destroying the input you were about
       to type in. The checkbox has the same double-fire, harmlessly; the
       number field does not. */
    if (e.type === 'click' && t.tagName === 'INPUT') return;
    onClick(t.getAttribute('data-act'), t.getAttribute('data-id'), e, t);
  };
  host.addEventListener('click', handler);
  host.addEventListener('change', handler);
  host._blHandler = handler;
  return () => closeModal(nodes);
}

function detachModal(host) {
  try {
    if (host && host._blHandler) {
      host.removeEventListener('click', host._blHandler);
      host.removeEventListener('change', host._blHandler);
      host._blHandler = null;
    }
  } catch (e) {}
}

export function closeModal(nodes) {
  try { detachModal(nodes.modalhost); nodes.modalhost.innerHTML = ''; } catch (e) {}
}
export function modalOpen(nodes) { return !!(nodes.modalhost && nodes.modalhost.firstChild); }
