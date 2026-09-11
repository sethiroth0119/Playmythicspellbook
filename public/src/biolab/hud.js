
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
import { REAGENTS, REAGENT_IDS, GRADES, marginalOf } from '../plague/cures.js';
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
/* 📦 carried crate. [hidden] needs the !important: this file sets padding and
   display on the chip, and an author rule beats the attribute otherwise — the
   same trap that shipped a visible admin pill to every player. */
.bl-carry{font-size:11px;color:#ffd7a8;background:#20180e;border:1px solid #4a3620;border-radius:6px;padding:3px 8px}
.bl-carry[hidden]{display:none!important}
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
.bl-ax{display:grid;grid-template-columns:100px 1fr 42px auto;gap:8px;align-items:center;font-size:11px}
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
/* 🔎 What one more unit would do. Green toward the strain, red away — but the
   sign is always printed too, because colour alone is not a readable answer
   for a player who cannot separate these two hues. */
.bl-rg-mv{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px}
.bl-mv{font-size:9px;padding:1px 5px;border-radius:4px;background:#18202c;color:#8b93a3;
  border:1px solid #232d3c;font-variant-numeric:tabular-nums;white-space:nowrap}
.bl-mv.ok{color:#86e08a;border-color:#2c4a33;background:#132018}
.bl-mv.no{color:#ff8a94;border-color:#4a2830;background:#201417}
.bl-mv-eff{font-size:9px;padding:1px 5px;border-radius:4px;font-weight:700;
  font-variant-numeric:tabular-nums;white-space:nowrap;background:#18202c;border:1px solid #232d3c}
.bl-mv-eff.ok{color:#86e08a;border-color:#2c4a33}
.bl-mv-eff.no{color:#ff8a94;border-color:#4a2830}
/* A jar the player has none of stays visible — knowing it exists is the point
   of the list — but it stops competing for attention with the ones they can use. */
.bl-rg.out{opacity:.45}
/* The signed gap beside the bar. "27/92" is true and useless; "65 short" is
   the sentence the player is trying to read out of it. */
.bl-gap{font-size:9.5px;padding:1px 5px;border-radius:4px;background:#20242c;color:#9aa3b2;
  border:1px solid #2b313c;white-space:nowrap;font-variant-numeric:tabular-nums}
.bl-gap.ok{color:#86e08a;border-color:#2c4a33;background:#132018}
.bl-gap.bad{color:#e0a860;border-color:#4a3a20;background:#201a12}
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
        <span class="bl-carry" hidden></span>
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
    carry: q('.bl-carry'),
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
    nodes.strain.textContent = f.icon + ' ' + st.strain.name + ' · ' + st.strain.isolate + ' · ' + severityLabel(st.strain.severity) +
      (st.strain.sample ? ' · SAMPLE' : '');
    nodes.strain.style.display = '';
  } else {
    /* Not "NO ACTIVE STRAIN" any more. That read as a locked door — the player
       is standing in a lab being told there is nothing to do. There is: the
       register has five named viruses in it. Name the way in. */
    nodes.strain.textContent = 'NO STRAIN ON THE BENCH — PRESS E AT THE SEQUENCER';
    nodes.strain.style.display = '';
  }

  // ── carried crate. `st.crate` is the batch record the run is holding, or
  //    null; the lab resolves it so this stays a pure renderer.
  if (nodes.carry) {
    const cr = st.crate;
    if (cr) {
      const g = GRADES[cr.f.grade] || GRADES.inert;
      nodes.carry.textContent = '📦 CARRYING ' + g.icon + ' ' + cr.strainName + ' · ' + cr.f.doses + ' doses';
      nodes.carry.hidden = false;
    } else {
      nodes.carry.hidden = true;
    }
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
    /* 📦 THE PROMPT MUST NAME WHAT E ACTUALLY DOES. While a crate is in hand
       every station does something different from its printed label — the bay
       takes delivery, the bench takes the crate back, everything else refuses —
       and a prompt still advertising "Mix the formulation" is a prompt lying
       about the only key the player has. */
    let promptHtml, actLabel = s.short, actClass = blocked ? 'no' : 'hot';
    if (blocked) {
      promptHtml = esc(blocked);
    } else if (st.carrying) {
      if (s.key === 'dispatch') {
        promptHtml = '<b>📦 Dispatch Bay</b> — set the crate on the table <kbd>E</kbd> <kbd>SPACE</kbd>' +
          '<br><span style="color:#77808f">Cures on this table are the ones a haulier can take.</span>';
        actLabel = 'DELIVER';
      } else if (s.key === 'synthesis') {
        promptHtml = '<b>📦 Synthesis Bench</b> — put the crate back down <kbd>E</kbd> <kbd>SPACE</kbd>' +
          '<br><span style="color:#77808f">It stays sealed and stays yours. Nothing ships from here.</span>';
        actLabel = 'SET DOWN';
      } else {
        promptHtml = '<b>📦 Your hands are full</b> — carry it to the Dispatch Bay' +
          '<br><span style="color:#77808f">' + esc(s.icon + ' ' + s.name) + ' will have to wait.</span>';
        actLabel = 'FULL';
        actClass = 'no';
      }
    } else {
      promptHtml = '<b>' + esc(s.icon + ' ' + s.name) + '</b> — ' + esc(s.prompt) +
        ' <kbd>E</kbd> <kbd>SPACE</kbd><br><span style="color:#77808f">' + esc(s.blurb) + '</span>';
    }
    nodes.prompt.innerHTML = promptHtml;
    nodes.act.className = 'bl-act ' + actClass;
    nodes.act.textContent = blocked ? 'BLOCKED' : actLabel;
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

/* 🗄 THE REGISTER — what may go on the bench.
   Three groups, and the labels are doing real work: a player must be able to
   tell at a glance whether a virus is in their streets right now or is stock
   they are manufacturing against. Entries come from PL.catalogue(). */
export function registerPanel(entries, currentId) {
  const list = entries || [];
  const row = (e) => {
    const s = e.strain;
    const id = s ? s.id : ('def:' + e.def);
    const name = s ? s.name : e.name;
    const icon = (s ? s.icon : e.icon) || '🦠';
    const sel = currentId && s && s.id === currentId;
    let tag, meta;
    if (e.source === 'outbreak') {
      tag = '<span style="color:#ff8a94">● IN YOUR CITY</span>';
      meta = e.cases + ' active case' + (e.cases === 1 ? '' : 's') + ' · ' + severityLabel(s.severity) +
             ' · ' + familyOf(s.family).name;
    } else if (e.source === 'sample') {
      tag = '<span style="color:#7fd6ff">◆ REFERENCE SAMPLE</span>';
      meta = 'On the shelf · infects nobody · ' + severityLabel(s.severity) + ' · ' + familyOf(s.family).name;
    } else {
      tag = '<span style="color:#8b93a3">○ NOT YET SAMPLED</span>';
      meta = esc(String(e.blurb || '').slice(0, 150));
    }
    return '<div class="bl-item' + (sel ? ' sel' : '') + '" data-act="reg-pick" data-id="' + esc(id) + '"' +
      ' style="cursor:pointer">' +
      '<b>' + esc(icon + ' ' + name) + '</b> — ' + tag +
      (sel ? ' <span style="color:#7fd6ff">· ON THE BENCH</span>' : '') +
      '<div class="meta">' + meta + '</div></div>';
  };
  const body = list.length
    ? '<div class="bl-list">' + list.map(row).join('') + '</div>'
    : '<div class="bl-empty">The register is empty and the world catalogue could not be read. ' +
      'This is what a missing module looks like — try a hard refresh.</div>';
  return '<h3>🗄 STRAIN REGISTER</h3>' +
    '<p class="sub">Pick what goes on the bench. You do not need an outbreak of your own to make a cure — ' +
    'sample a virus that exists in the world, formulate against it, and ship the doses to the players who do ' +
    'have it.</p>' + body +
    '<p class="sub">Sampling files a reference isolate in your register. It infects nobody in your city.</p>' +
    '<div class="bl-row"><button class="bl-btn" data-act="close">CLOSE</button></div>';
}

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
      '<button class="bl-btn" data-act="seq-register">CHANGE STRAIN</button>' +
      '<button class="bl-btn" data-act="close">CLOSE</button></div>';
}

/* 🌀 MOVE THE NEEDLE WITHOUT REBUILDING THE PANEL.
   🔴 THE BUG THIS EXISTS FOR: the rotor tick called the panel's full render
      EVERY FRAME, and modal() assigns host.innerHTML — so every button was
      destroyed and recreated ~60 times a second. A click needs mousedown AND
      mouseup on the SAME element, which at that rate essentially never
      happens: STOP THE ROTOR never fired, CLOSE never fired, and the player
      was sealed inside the modal with no way out. Reported exactly that way.
   Only one thing actually moves between frames — the needle's x position —
   so only that is written. The panel is re-rendered ONLY when its content
   really changes (start, stop, a result), which is what makes the buttons
   ordinary clickable DOM again. */
export function centrifugeMove(nodes, pos) {
  try {
    const host = nodes && nodes.modalhost; if (!host) return false;
    const needle = host.querySelector('.bl-spin i'); if (!needle) return false;
    needle.style.left = (Math.max(0, Math.min(1, +pos || 0)) * 100) + '%';
    return true;
  } catch (e) { return false; }
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

/* 📦 Sealed crates sitting on the bench, each with the only way to pick one
   up. Rendered at the TOP of the synthesis panel rather than the bottom: a
   player who has just mixed a batch comes back to this panel to move it, and
   burying the carry button under the whole reagent grid is how a finished cure
   sits on the bench forever. */
function benchCratesHtml(bench) {
  if (!bench || !bench.length) return '';
  const rows = bench.map((b) => {
    const g = GRADES[b.f.grade] || GRADES.inert;
    return '<div class="bl-item">' +
      '<b>' + esc(g.icon + ' ' + b.strainName + ' · ' + b.strainIsolate) + '</b> — ' +
      '<span style="color:' + g.color + '">' + esc(g.label) + '</span>' +
      '<div class="meta">' + b.f.doses + ' doses · efficacy ' + Math.round(b.f.efficacy * 100) + '% · ' +
      'stability ' + b.f.stability + '%</div>' +
      '<div class="bl-row" style="margin-top:6px">' +
        '<button class="bl-btn pri" data-act="crate-take" data-id="' + esc(b.id) + '">CARRY TO THE BAY</button>' +
      '</div></div>';
  }).join('');
  return '<h3 style="margin-top:0">📦 SEALED ON THIS BENCH</h3>' +
    '<p class="sub">These are made and they are going nowhere until somebody walks them to the Dispatch Bay.</p>' +
    '<div class="bl-list">' + rows + '</div>';
}

export function synthesisPanel(ctx) {
  const { strain, mix, have, f, known, bench } = ctx;

  /* 🔎 WHAT EACH REAGENT WOULD DO TO *THIS* VESSEL, not to an empty one.
     The bench used to print a fixed list in a fixed order with a prose blurb,
     and a player looking at four gaps and twenty-odd jars had no way to connect
     the two — reported as "it feels like I am missing a lot of what needs to be
     shown on the UI", alongside "if you get to one suitable marker, adjusting
     anything else moves it from that marker".

     That second sentence is the coupling: blendOf() is a weighted average, so
     every jar moves all four axes at once and a reagent's own profile does not
     tell you what it will do to a vessel that already has something in it.
     marginalOf() answers the question the player is actually asking — what
     happens if I add one of THESE, right now — and the list is then ordered by
     it, so whatever helps most is at the top rather than wherever the table
     happened to declare it.

     ⚠ ONLY WHEN THE STRAIN IS KNOWN. Without a Sequencer read there is no
       target to be nearer to, and ranking by "efficacy gained" against a
       signature the player has not seen would hand them the answer the
       sequencing gate exists to withhold. Unsequenced, the order stays the
       declaration order and the numbers shown are the axis movements only —
       which are a fact about chemistry, not about this virus. */
  const marg = marginalOf(known ? strain : null, mix, ctx.craft);
  const ids = REAGENT_IDS.slice();
  if (known) {
    ids.sort((a, b) => {
      const stockA = (have[a] | 0) > (mix[a] | 0), stockB = (have[b] | 0) > (mix[b] | 0);
      if (stockA !== stockB) return stockA ? -1 : 1;   // what you cannot add sinks
      return (marg[b].dEfficacy - marg[a].dEfficacy);
    });
  }

  const sgn = (n, dp) => (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(dp == null ? 0 : dp);

  const cards = ids.map((id) => {
    const R = REAGENTS[id];
    const units = (mix[id] | 0);
    const stock = have[id] | 0;
    const m = marg[id];
    /* The four axis movements, and — when there is a target — whether this jar
       takes the blend toward the strain or away from it. */
    const moves = AXES.map((ax) => {
      const d = m.axis[ax] || 0;
      if (Math.abs(d) < 0.05) return '';
      const good = known ? (Math.abs((strain.sig[ax] || 0) - ((f.blend[ax] || 0) + d))
                            < Math.abs((strain.sig[ax] || 0) - (f.blend[ax] || 0))) : null;
      return '<span class="bl-mv' + (good === null ? '' : good ? ' ok' : ' no') + '">' +
        esc(AXIS_META[ax].icon) + ' ' + sgn(d) + '</span>';
    }).join('');
    const eff = known && Math.abs(m.dEfficacy) >= 0.0005
      ? '<span class="bl-mv-eff' + (m.dEfficacy > 0 ? ' ok' : ' no') + '">' +
        sgn(m.dEfficacy * 100, 1) + '% efficacy</span>' : '';
    return '<div class="bl-rg' + (units ? ' sel' : '') + (stock <= units ? ' out' : '') + '">' +
      '<div class="bl-rg-top">' + esc(R.icon) + ' <b>' + esc(R.name) + '</b>' +
      '<span class="bl-rg-have">' + num(stock) + ' held</span></div>' +
      '<div class="bl-rg-mv">' + moves + eff + '</div>' +
      '<div class="bl-rg-blurb">' + esc(R.blurb) + '</div>' +
      '<div class="bl-rg-ctl">' +
        '<button data-act="mix-" data-id="' + esc(id) + '">−</button>' +
        '<input type="number" min="0" step="1" value="' + units + '" data-act="mix=" data-id="' + esc(id) + '">' +
        '<button data-act="mix+" data-id="' + esc(id) + '"' + (units >= stock ? ' disabled' : '') + '>+</button>' +
      '</div></div>';
  }).join('');

  /* 📉 THE GAP, SIGNED AND NAMED. "27/92" is a true statement that does not
     tell a player what to do; "65 short — needs far more envelope" does. The
     bar and the tick stay, because the shape of the four gaps together is the
     thing you steer by. */
  const target = AXES.map((ax) => {
    const want = known ? (strain.sig[ax] | 0) : null;
    const got = Math.round(f.blend[ax] || 0);
    const gap = want == null ? null : want - got;
    const word = gap == null ? ''
      : Math.abs(gap) <= 3 ? '<span class="bl-gap ok">on target</span>'
      : '<span class="bl-gap' + (Math.abs(gap) > 20 ? ' bad' : '') + '">' +
        Math.abs(gap) + ' ' + (gap > 0 ? 'short' : 'over') + '</span>';
    return '<div class="bl-ax"><span>' + esc(AXIS_META[ax].icon + ' ' + AXIS_META[ax].label) + '</span>' +
      '<div class="bl-bar"><i style="width:' + got + '%"></i>' +
      (want != null ? '<u style="left:' + want + '%"></u>' : '') + '</div>' +
      '<span>' + got + (want != null ? '/' + want : '') + '</span>' + word + '</div>';
  }).join('');

  return benchCratesHtml(bench) +
    '<h3>⚗️ SYNTHESIS BENCH</h3>' +
    '<p class="sub">Blue is your blend; the amber tick is the strain. Close the gap on all four axes.' +
    (known
      ? ' Each jar shows what <b>one more unit</b> would do to the vessel you have now — green moves you toward the strain, red away — and the list is ordered by what helps most right now.'
      : ' <b style="color:#e0a860">You have not sequenced this strain — the ticks are hidden, the jars cannot be ranked against it, and the batch is capped.</b>') +
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
    /* 🔴 TWO DIFFERENT EMPTIES, AND TELLING THEM APART IS THE WHOLE POINT.
       "You have made nothing" and "you have made three cures and they are all
       still sitting on the bench" look identical from an empty table, and a
       player in the second case is being told a flat lie by the first message.
       `onBench` comes from the caller for exactly this. */
    const waiting = ctx.onBench | 0;
    return '<h3>📦 DISPATCH BAY</h3>' + transitHtml +
      '<div class="bl-empty">' + (waiting
        ? '📦 <b>' + waiting + ' sealed crate' + (waiting === 1 ? '' : 's') + ' still on the Synthesis Bench.</b><br>' +
          'Nothing ships from a bench. Walk over, pick one up and carry it back here.'
        : 'Nothing new to ship. Mix a batch at the Synthesis Bench first.') + '</div>' +
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
          '<b>🚚 ' + esc(c.name) + '</b>' +
          (c.mine ? ' <span style="color:#86e08a">· yours</span>'
            : c.npc ? ' <span style="color:#9aa4b4">· contract, never improves</span>'
            : ' · ' + esc(c.ownerName)) +
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
        '<b>🏥 ' + esc(l.name) + '</b>' +
        (l.mine ? ' <span style="color:#86e08a">· yours</span>'
          : l.npc ? ' <span style="color:#9aa4b4">· municipal</span>'
          : ' · ' + esc(l.ownerName)) +
        '<div class="meta">takes up to ' + num(l.capacity) + ' doses · ' + l.workers + ' staff · L' + l.level +
        (l.understaffed ? ' · <span style="color:#d9b184">unstaffed — small shipments only</span>' : '') + '</div></div>').join('')
    : '<div class="bl-empty">No player-owned Medical Corporation is receiving.<br>' +
      'The lab at the far end is where doses become treatment — without one, the crate has nowhere to go.</div>';

  return '<h3>📦 DISPATCH BAY</h3>' + transitHtml +
    '<p class="sub">A cure in this room has cured nobody. Hire a haulier to run it to a receiving ' +
    'ward. The carrier you pick changes what arrives — a broken cold chain can turn a cure into the ' +
    'next outbreak in transit, so a player-owned company with a real crew delivers more of the batch ' +
    'intact than the contract truck ever will.</p>' +
    '<h4 style="font-size:10px;letter-spacing:.14em;color:#8b93a3;margin:14px 0 6px">1 · ON THE DISPATCH TABLE</h4>' +
    '<p class="sub" style="margin:0 0 6px">Cures you have carried over and set down. Pick the one to send.</p>' +
    '<div class="bl-list">' + bl + '</div>' +
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
