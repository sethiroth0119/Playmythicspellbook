/* ═══════════════════════════════════════════════════════════════════════════
   🖥 THE BENCH — DOM.

   A self-contained overlay the module owns end to end, in the spirit of the
   Dwelling overlay: it mounts itself, paints itself and tears itself down, so
   closing it returns the player exactly where they were. index.html contributes
   an opener and nothing else.

   ⚠ NO requestAnimationFrame FOR THE TORQUE BAR. Per CLAUDE.md the Browser
     pane does not composite, so RAF never fires there and anything driven by
     it is untestable in this environment. setInterval at ~60Hz is equivalent
     for a single bar and stays verifiable.
   ═══════════════════════════════════════════════════════════════════════════ */

import { ensureWeaponSmith } from './state.js';
import { itemCount, toast, ready, addGems, craftedBook as bridgeBook } from './ws.bridge.js';
import { CATALOG, DONOR_CATALOG, partDef, cleanCost, cleanPart, stripDonor, tierOf } from './parts.js';
import { BLUEPRINTS, blueprint, blueprintIds, stepFor } from './blueprints.js';
import { SCHEMATICS, learnSchematic, unlearned } from './schematics.js';
import { ownsBlueprint, online, rollBoard, deliverContract, claimRepBlueprint, repTier } from './server.js';
import { startBuild, abandonBuild, seatPart, pullPart, tryFit, scoreBuild, finishBuild, TORQUE_BAND, TORQUE_STRIP } from './bench.gun.js';
import { startForge, workStep, currentStep, scoreForge, finishForge, abandonForge } from './bench.forge.js';
import { isBlade } from './blueprints.js';
import { armoury, armouryDetail, provenance, slotsFor, equip, heroList, carriedBy } from './armoury.js';
import { mount as mountBench3D } from './scene.bench.js';
import { mount as mountForge3D } from './scene.forge.js';

const ID = 'ws-bench-overlay';
let _tick = null, _torque = null;
/* 🔧 The 3D workshop. One scene at a time, torn down on close and whenever the
   view changes away from a build — see disposeScene. */
let _scene = null, _sceneFor = null;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CSS = `
#${ID}{position:fixed;inset:0;z-index:9600;background:rgba(8,7,6,.96);overflow:auto;
  font-family:inherit;color:#e8dcc0;padding:1rem;box-sizing:border-box}
#${ID} .wsb-wrap{max-width:1180px;margin:0 auto}
#${ID} .wsb-head{display:flex;align-items:center;gap:1rem;flex-wrap:wrap;margin-bottom:1rem;
  border-bottom:1px solid rgba(212,175,55,.3);padding-bottom:.8rem}
#${ID} h2{margin:0;font-size:1.35rem;color:#ffd166}
#${ID} .wsb-sub{color:#a89880;font-size:.82rem}
#${ID} .wsb-x{margin-left:auto;background:rgba(255,119,85,.14);border:1px solid rgba(255,119,85,.45);
  color:#ff9a88;border-radius:5px;padding:.45rem .9rem;cursor:pointer;font:inherit}
#${ID} .wsb-cols{display:grid;grid-template-columns:1fr 340px;gap:1rem}
@media(max-width:900px){#${ID} .wsb-cols{grid-template-columns:1fr}}
#${ID} .wsb-panel{background:rgba(24,20,16,.9);border:1px solid rgba(212,175,55,.24);
  border-radius:7px;padding:.85rem}
#${ID} .wsb-panel h3{margin:0 0 .6rem;font-size:.95rem;color:#ffd166;letter-spacing:.03em}
#${ID} .wsb-stations{display:grid;grid-template-columns:repeat(auto-fill,minmax(158px,1fr));gap:.55rem}
#${ID} .wsb-st{border:1px solid rgba(212,175,55,.28);border-radius:6px;padding:.55rem;
  background:rgba(0,0,0,.3);min-height:74px;transition:border-color .15s,transform .1s}
#${ID} .wsb-st.locked{opacity:.42;border-style:dashed}
#${ID} .wsb-st.ready{border-color:rgba(120,220,160,.6);box-shadow:0 0 10px rgba(120,220,160,.18)}
#${ID} .wsb-st.filled{border-color:rgba(255,209,102,.65);background:rgba(255,209,102,.07)}
#${ID} .wsb-st .nm{font-size:.8rem;color:#ffefb8;font-weight:700}
#${ID} .wsb-st .mt{font-size:.68rem;color:#8a7f6a;margin-top:.15rem}
#${ID} .wsb-st .pt{font-size:.75rem;color:#cfe8d0;margin-top:.3rem}
#${ID} .wsb-st .opt{font-size:.64rem;color:#7b6f5c;font-style:italic}
/* ⚠ A tray that clips MUST LOOK like it clips. The default dark-on-dark
   scrollbar is invisible here, so a cut-off list read as a complete one — the
   blueprint picker hid two frames and the parts tray hid every part that
   actually fit, which is the difference between "there is nothing I can use"
   and "scroll down". Both a visible thumb and a bottom fade, because either
   alone is easy to miss. */
#${ID} .wsb-tray{display:flex;flex-direction:column;gap:.3rem;overflow:auto;
  scrollbar-width:thin;scrollbar-color:rgba(212,175,55,.55) rgba(0,0,0,.35)}
#${ID} .wsb-tray::-webkit-scrollbar{width:9px}
#${ID} .wsb-tray::-webkit-scrollbar-track{background:rgba(0,0,0,.35);border-radius:5px}
#${ID} .wsb-tray::-webkit-scrollbar-thumb{background:rgba(212,175,55,.55);border-radius:5px}
#${ID} .wsb-tray::-webkit-scrollbar-thumb:hover{background:rgba(255,209,102,.8)}
#${ID} .wsb-scroll{position:relative}
#${ID} .wsb-scroll::after{content:'';position:absolute;left:0;right:9px;bottom:0;height:26px;
  pointer-events:none;background:linear-gradient(180deg,rgba(24,20,16,0),rgba(24,20,16,.95))}
/* Rows must never be sliced through the middle — a half-height row reads as a
   rendering fault rather than as more content. */
#${ID} .wsb-tray > *{flex:0 0 auto}
#${ID} .wsb-p{display:flex;align-items:center;gap:.5rem;padding:.35rem .5rem;border-radius:5px;
  border:1px solid rgba(212,175,55,.2);background:rgba(0,0,0,.28);cursor:pointer;text-align:left;
  color:inherit;font:inherit;width:100%}
#${ID} .wsb-p:hover{border-color:rgba(255,209,102,.6)}
#${ID} .wsb-p[disabled]{opacity:.38;cursor:not-allowed}
#${ID} .wsb-p:not([disabled]).wsb-fits{border-color:rgba(120,220,160,.55);background:rgba(120,220,160,.07)}
#${ID} .wsb-p .q{margin-left:auto;font-size:.72rem;color:#a89880}
#${ID} .wsb-tier-pristine{color:#9fe8b0}#${ID} .wsb-tier-worn{color:#e8d79f}#${ID} .wsb-tier-shot{color:#e8a09f}
/* 🔧 The 3D view. Sized by the scene itself (it sets an explicit height from
   the width), so the panel does not need to guess an aspect ratio. */
/* ⚠ CAPPED. The scene sizes itself from its width, and the forge panel is
   full-width — which gave a 640px-tall canvas that pushed the step controls off
   the bottom of the screen entirely. The viewport is for the work, not for the
   room. */
#${ID} .wsb-3d{width:100%;display:block;border-radius:6px;border:1px solid rgba(212,175,55,.28);
  background:#0d0b09;margin-bottom:.6rem;max-height:340px}
#${ID} .wsb-3d-note{font-size:.72rem;color:#7b6f5c;margin:-.35rem 0 .6rem}
#${ID} .wsb-bar{position:relative;height:26px;border:1px solid rgba(212,175,55,.4);border-radius:5px;
  background:rgba(0,0,0,.5);overflow:hidden;margin:.5rem 0}
#${ID} .wsb-fill{position:absolute;inset:0 auto 0 0;width:0;background:linear-gradient(90deg,#6b8f4f,#d4af37)}
#${ID} .wsb-band{position:absolute;top:0;bottom:0;background:rgba(120,220,160,.28);
  border-left:1px solid rgba(120,220,160,.8);border-right:1px solid rgba(120,220,160,.8)}
#${ID} .wsb-danger{position:absolute;top:0;bottom:0;right:0;background:rgba(255,90,70,.3)}
#${ID} .wsb-btn{background:rgba(212,175,55,.16);border:1px solid rgba(212,175,55,.5);color:#ffd166;
  border-radius:5px;padding:.5rem .9rem;cursor:pointer;font:inherit;font-size:.85rem}
#${ID} .wsb-btn:hover{background:rgba(212,175,55,.28)}
#${ID} .wsb-btn[disabled]{opacity:.4;cursor:not-allowed}
#${ID} .wsb-msg{min-height:1.3em;font-size:.8rem;color:#ffbfae;margin-top:.4rem}
#${ID} .wsb-meter{display:flex;gap:.7rem;flex-wrap:wrap;font-size:.78rem;color:#a89880;margin-top:.5rem}
#${ID} .wsb-meter b{color:#ffd166}
`;

function css() {
  if (document.getElementById(ID + '-css')) return;
  const st = document.createElement('style');
  st.id = ID + '-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}

let _msg = '';
let _sel = null;          // the part id awaiting a torque pull

export function openBench() {
  if (!ready()) return false;
  css();
  let el = document.getElementById(ID);
  if (!el) { el = document.createElement('div'); el.id = ID; document.body.appendChild(el); }
  paint();
  return true;
}

export function closeBench() {
  stopTorque();
  disposeScene();
  const el = document.getElementById(ID);
  if (el) el.remove();
  return true;
}

/* ── Torque bar ───────────────────────────────────────────────────────────
   Hold to drive, release to seat. The bar keeps climbing while held and past
   TORQUE_STRIP it strips — so waiting is never safe, which is what makes the
   release a decision rather than a formality. */
function startTorque(partIdStr) {
  stopTorque();
  _sel = partIdStr;
  _torque = { v: 0, held: true };
  const fill = document.getElementById(ID + '-fill');
  _tick = setInterval(() => {
    if (!_torque) return;
    _torque.v = Math.min(1, _torque.v + 0.016);
    if (fill) fill.style.width = (_torque.v * 100).toFixed(1) + '%';
    /* 🧤 Hands follow the SAME number the bar is showing, so the two can never
       disagree about how far along a fastening is. The forge sentinel picks
       the hammer; everything else is the torque wrench. */
    if (_scene && _scene.setWork) {
      _scene.setWork(partIdStr === '__forge' ? 'hammer' : 'wrench', _torque.v);
    }
    // ⚔️ On the forge the same value is the HEAT, and the step decides how to
    // read it — see setHeat's note on quench.
    if (_scene && _scene.setHeat) _scene.setHeat(_torque.v, currentStepId());
    if (_torque.v >= 1) release();          // ran the fastener all the way out
  }, 16);
}
function stopTorque() {
  if (_tick) { clearInterval(_tick); _tick = null; }
  _torque = null;
  // Hands go back down the moment the fastener is released.
  if (_scene && _scene.setWork) { try { _scene.setWork(null); } catch (e) {} }
  // The billet keeps its heat and cools on its own — see the asymmetric rate
  // in scene.forge. Snapping it cold on release would throw away the best
  // moment in the whole sequence.
  if (_scene && _scene.setHeat) { try { _scene.setHeat(0, currentStepId()); } catch (e) {} }
}

function release() {
  if (!_sel || !_torque) return;
  const v = _torque.v, id = _sel;
  stopTorque(); _sel = null;
  /* The bar is shared between the two benches, and the forge parks a sentinel
     in _sel. Without this branch a bar that ran to the end on the forge would
     be handed to seatPart as if '__forge' were a part id. */
  if (id === '__forge') {
    const fr = workStep(v);
    _msg = fr.ok ? fr.note : fr.reason;
    paint();
    return;
  }
  const r = seatPart(id, v);
  _msg = r.ok ? ((partDef(id) || {}).name + ' — ' + r.note) : r.reason;
  paint();
}

/* ── Paint ────────────────────────────────────────────────────────────────*/
function paint() {
  const el = document.getElementById(ID);
  if (!el) return;
  const s = ensureWeaponSmith();
  el.innerHTML = s.bench ? buildView(s) : (s.forge ? forgeView(s) : pickerView(s));
  bind(s);
  sync3D(s);
}

/* Keep the scene in step with the bench.

   ⚠ paint() replaces innerHTML wholesale, which DESTROYS the canvas element the
     renderer is bound to. So the scene is torn down and rebuilt whenever the
     view changes — cheap (ten boxes and a room), and it makes a stale context
     bound to a detached canvas impossible. Within one view the scene persists
     and only the weapon is rebuilt. */
function sync3D(s) {
  const wantFor = s.bench ? ('build:' + s.bench.blueprintId)
                : s.forge ? ('forge:' + s.forge.blueprintId)
                : null;
  if (_sceneFor !== wantFor) { disposeScene(); _sceneFor = wantFor; }
  if (!wantFor) return;

  const isForge = wantFor.indexOf('forge:') === 0;
  const cv = document.getElementById(ID + (isForge ? '-3df' : '-3d'));
  if (!cv) { disposeScene(); return; }

  if (_scene && _scene.renderer && _scene.renderer.domElement !== cv) {
    // A repaint swapped the canvas under us.
    disposeScene();
    _sceneFor = wantFor;
  }

  if (!_scene) {
    const token = wantFor;
    (isForge ? mountForge3D(cv) : mountBench3D(cv)).then((sc) => {
      // The player may have closed or moved on while three.js was loading.
      if (!sc) { markNo3D(); return; }
      if (_sceneFor !== token || !document.getElementById(ID)) { sc.dispose(); return; }
      _scene = sc;
      if (_scene.setSeated) _scene.setSeated(seatedForScene());
      if (_scene.setHeat) _scene.setHeat(0, currentStepId());
      _scene.start();
      // 🧪 Dev probe, same spirit as __mg elsewhere: the scene is otherwise
      // module-private, so there is no way to pose the hands from a console
      // (or a screenshot harness) to check the rig without it.
      try { window.__wsScene = _scene; } catch (e) {}
    }).catch(() => markNo3D());
    return;
  }
  if (_scene.setSeated) _scene.setSeated(seatedForScene());
  if (_scene.setHeat && !_torque) _scene.setHeat(0, currentStepId());
  _scene.resize();
}

/* Which forge step is live — the scene needs it because a QUENCH must read the
   bar inverted (holding it under takes heat OUT, it does not add it). */
function currentStepId() {
  try { const st = currentStep(); return st ? st.id : null; } catch (e) { return null; }
}

/* Slot -> { partId, tier } for the scene. Tier comes from the part id, which
   is where condition lives (§6d), so a worn barrel renders duller than a
   pristine one with no extra bookkeeping. */
function seatedForScene() {
  const s = ensureWeaponSmith();
  const out = {};
  if (!s.bench) return out;
  for (const slot in s.bench.seated) {
    const seat = s.bench.seated[slot];
    const d = seat && partDef(seat.partId);
    out[slot] = { partId: seat.partId, tier: (d && d.part.tier) || 'pristine' };
  }
  return out;
}

function markNo3D() {
  const cv = document.getElementById(ID + '-3d');
  if (cv) cv.style.display = 'none';         // no WebGL: quietly fall back to the DOM bench
}

export function disposeScene() {
  try { if (window.__wsScene === _scene) window.__wsScene = null; } catch (e) {}
  if (_scene) { try { _scene.dispose(); } catch (e) {} }
  _scene = null;
  _sceneFor = null;
}

function pickerView(s) {
  /* Tier-1 frames come with the operation; higher tiers need the blueprint,
     which is a SERVER row. A locked frame is shown rather than hidden — a
     player should be able to see what they are working towards, and hiding it
     makes the schematic they just looted look like it does nothing. */
  const rows = blueprintIds().map((id) => {
    const b = BLUEPRINTS[id];
    const known = b.tier <= 1 || ownsBlueprint(id);
    return `<button class="wsb-p" data-bp="${esc(id)}" ${known ? '' : 'disabled title="' + esc('Needs the ' + b.name + ' blueprint — loot or buy the schematic, then learn it.') + '"'}>
      <span style="font-size:1.2rem">${esc(known ? b.icon : '🔒')}</span>
      <span><b>${esc(b.name)}</b><div class="wsb-sub">${esc(b.blurb)}</div></span>
      <span class="q">T${b.tier} · ${b.budget} pts</span></button>`;
  }).join('');

  const schem = unlearned().map((sid) => {
    const d = SCHEMATICS[sid];
    return `<button class="wsb-p" data-learn="${esc(sid)}"><span>📜</span>
      <span><b>${esc(d.name)}</b><div class="wsb-sub">Learn it — this consumes the schematic</div></span>
      <span class="q">×${itemCount(sid)}</span></button>`;
  }).join('');
  const board = boardView(s);
  const arms = armouryView();
  const schemPanel = schem
    ? `<div class="wsb-panel" style="margin-top:.8rem"><h3>📜 Schematics</h3>
         <div class="wsb-sub" style="margin-bottom:.4rem">${online() ? 'Learning is recorded to your account, not this device.' : '⚠ Offline — learning needs a connection.'}</div>
         <div class="wsb-tray">${schem}</div></div>`
    : '';
  return `<div class="wsb-wrap">
    <div class="wsb-head"><div><h2>🔧 The Bench</h2>
      <div class="wsb-sub">Pick a frame. Parts come off donors and out of the shop — clean them before you build.</div></div>
      <button class="wsb-x" id="${ID}-close">Close</button></div>
    <div class="wsb-cols">
      <div class="wsb-panel"><h3>Blueprints</h3>
        <!-- No max-height: this is the primary navigation and the panel has
             room. Capping it hid two frames behind an invisible scrollbar. -->
        <div class="wsb-tray">${rows}</div></div>
      <div><div class="wsb-panel"><h3>Workshop</h3>${workshopView()}</div>${schemPanel}</div>
    </div>
    ${arms}
    ${board}
    </div>`;
}

/* 🏛 THE ARMOURY. Everything the player has built, with its provenance —
   which parts went in, what ceiling their condition imposed, and how much of
   the blueprint's budget the build actually realised. Without this, all that
   survives a two-minute build is a stat line, and the point of a gunsmith game
   is that the thing in your hands has a history. */
function armouryView() {
  const list = armoury();
  if (!list.length) {
    return `<div class="wsb-panel" style="margin-top:1rem"><h3>🏛 Armoury</h3>
      <div class="wsb-sub">Nothing built yet. Pick a frame above.</div></div>`;
  }
  const hs = heroList();

  const rows = list.map((def) => {
    const p = provenance(def);
    const holder = carriedBy(def.id);
    const statLine = Object.keys(p.stats).map((k) => '+' + p.stats[k] + ' ' + k.toUpperCase()).join(' · ');
    const partLine = p.parts.length
      ? p.parts.map((x) => esc(x.name)).join(' · ')
      : (p.forged ? 'Forged from a billet — no parts.' : 'No parts recorded.');

    /* The ceiling is shown whenever it bit. "Why is my perfect build only 90%?"
       is otherwise unanswerable, and the answer — a worn part — is exactly the
       thing that should push a player towards the cleaning station. */
    const capNote = p.conditionCap < 100
      ? `<div class="mt">condition ceiling ${p.conditionCap}% — a worn part capped this build</div>` : '';

    const equipBtns = hs.length
      ? slotsFor(def).map((sl) => hs.map((h) =>
          `<button class="wsb-btn" style="padding:.15rem .45rem;font-size:.68rem;margin:.15rem .15rem 0 0"
                   data-equip="${esc(def.id)}" data-hero="${esc(h.id)}" data-slot="${esc(sl.key)}"
                   ${holder && holder.hero.id === h.id && holder.slot === sl.key ? 'disabled' : ''}>${esc(h.name)} · ${esc(sl.label)}</button>`
        ).join('')).join('')
      : '<div class="wsb-sub">No heroes yet.</div>';

    return `<div class="wsb-st filled" style="min-height:0;padding:.65rem">
      <div class="nm">${esc(p.icon)} ${esc(p.name)}
        ${p.unverified ? '<span style="color:#e8a09f;font-size:.68rem">· unverified, cannot be sold</span>' : ''}</div>
      <div class="pt">${esc(statLine)}${p.weapon.range ? ' · range ' + p.weapon.range : ''}</div>
      <div class="mt">${esc(p.blueprintName)} · quality ${p.quality}% · ${p.spent}/${p.budget} pts used</div>
      ${capNote}
      <div class="wsb-sub" style="margin-top:.25rem">${partLine}</div>
      ${holder ? `<div class="mt" style="color:#9fe8b0">carried by ${esc(holder.hero.name)}</div>` : ''}
      <div style="margin-top:.3rem">${equipBtns}</div>
    </div>`;
  }).join('');

  return `<div class="wsb-panel" style="margin-top:1rem"><h3>🏛 Armoury</h3>
    <div class="wsb-sub" style="margin-bottom:.5rem">What you have built, and what went into it.</div>
    <div class="wsb-stations">${rows}</div></div>`;
}

/* 📋 THE ORDER BOARD. Contracts are SERVER-GENERATED (sql/041) — a client that
   could author them would write itself "minAtk 1, pays 999999". This paints
   what the server handed over and offers a delivery; it decides nothing. */
function boardView(s) {
  const rep = s.rep | 0;
  const slots = s.slots | 1;
  const claimable = (s.claimable || []).filter((id) => BLUEPRINTS[id] && !ownsBlueprint(id));

  if (!online()) {
    return `<div class="wsb-panel" style="margin-top:1rem"><h3>📋 Order Board</h3>
      <div class="wsb-sub">Offline — contracts and reputation are recorded to your account, so the board needs a connection.</div></div>`;
  }

  const rows = (s.contracts || []).map((c) => {
    const spec = c.spec || {};
    const bits = [];
    if (spec.minAtk)   bits.push('ATK ≥ ' + spec.minAtk);
    if (spec.minSpd)   bits.push('SPD ≥ ' + spec.minSpd);
    if (spec.minCrit)  bits.push('crit ≥ ' + spec.minCrit);
    if (spec.minRange) bits.push('range ≥ ' + spec.minRange);
    if (spec.blueprint && BLUEPRINTS[spec.blueprint]) bits.push(BLUEPRINTS[spec.blueprint].name + ' frame');
    const due = c.dueAt ? new Date(c.dueAt) : null;
    const late = due && due.getTime() < Date.now();
    const left = due ? Math.max(0, Math.round((due.getTime() - Date.now()) / 3600000)) : null;
    return `<div class="wsb-st filled" style="min-height:0;padding:.6rem">
      <div class="nm">${esc(c.client || 'Client')}</div>
      <div class="wsb-sub" style="margin:.15rem 0 .3rem">${esc(c.blurb || '')}</div>
      <div class="pt">${esc(bits.join(' · ') || 'any weapon')}</div>
      <div class="mt">${(c.pays && c.pays.cinder) ? c.pays.cinder.toLocaleString() + ' Cinder' : ''}${
        due ? ' · ' + (late ? '<span style="color:#e8a09f">overdue</span>' : left + 'h left') : ''}</div>
      <button class="wsb-btn" style="padding:.2rem .55rem;font-size:.72rem;margin-top:.35rem"
              data-deliver="${esc(c.id)}">Deliver…</button>
    </div>`;
  }).join('') || '<div class="wsb-sub">No contracts on the board.</div>';

  const claimRows = claimable.map((id) =>
    `<button class="wsb-p" data-claim="${esc(id)}"><span>🏅</span>
      <span><b>${esc(BLUEPRINTS[id].name)}</b><div class="wsb-sub">Earned through reputation — claim it free</div></span>
      <span class="q">rep</span></button>`).join('');

  return `<div class="wsb-panel" style="margin-top:1rem">
    <h3>📋 Order Board</h3>
    <div class="wsb-meter" style="margin:0 0 .6rem">
      <span>rank <b>${esc(repTier(rep))}</b></span>
      <span>reputation <b>${rep}</b>/100</span>
      <span>slots <b>${(s.contracts || []).length}/${slots}</b></span>
      <span>delivered <b>${s.delivered | 0}</b></span>
    </div>
    ${claimRows ? '<div class="wsb-tray" style="margin-bottom:.6rem">' + claimRows + '</div>' : ''}
    <div class="wsb-stations">${rows}</div>
    <div style="margin-top:.6rem"><button class="wsb-btn" id="${ID}-roll">Check the board</button></div>
  </div>`;
}

function workshopView() {
  const donors = Object.keys(DONOR_CATALOG).filter((id) => itemCount(id) > 0).map((id) => {
    const d = DONOR_CATALOG[id];
    return `<button class="wsb-p" data-strip="${esc(id)}"><span>${esc(d.icon)}</span>
      <span><b>${esc(d.name)}</b><div class="wsb-sub">Strip for ${d.donor.picks} parts</div></span>
      <span class="q">×${itemCount(id)}</span></button>`;
  }).join('') || '<div class="wsb-sub">No donor weapons. They drop as scrap in the field.</div>';

  const dirty = Object.keys(CATALOG).filter((id) => itemCount(id) > 0 && CATALOG[id].part.tier !== 'pristine')
    .slice(0, 24).map((id) => {
      const d = CATALOG[id], plan = cleanCost(id);
      const c = plan ? Object.keys(plan.cost).map((k) => plan.cost[k] + '× ' + k).join(', ') : '';
      return `<button class="wsb-p" data-clean="${esc(id)}"><span>${esc(d.icon)}</span>
        <span><b>${esc(d.name)}</b><div class="wsb-sub">Clean · ${esc(c)}</div></span>
        <span class="q">×${itemCount(id)}</span></button>`;
    }).join('') || '<div class="wsb-sub">Nothing needs cleaning.</div>';

  return `<div style="margin-bottom:.6rem"><b style="font-size:.8rem">🪛 Strip</b>
    <div class="wsb-scroll"><div class="wsb-tray" style="max-height:156px">${donors}</div></div></div>
    <div><b style="font-size:.8rem">🧽 Clean</b>
    <div class="wsb-scroll"><div class="wsb-tray" style="max-height:208px">${dirty}</div></div></div>`;
}

function buildView(s) {
  const bench = s.bench, bp = blueprint(bench.blueprintId);
  const sc = scoreBuild(bench) || { quality: 0, cap: 1, complete: false, missing: [] };

  const stations = (bp.steps || []).map((st) => {
    const seat = bench.seated[st.slot];
    const d = seat && partDef(seat.partId);
    const locked = st.requires.some((r) => !bench.seated[r]);
    const cls = d ? 'filled' : (locked ? 'locked' : 'ready');
    const body = d
      ? `<div class="pt">${esc(d.name)}</div><div class="mt">torque ${Math.round(seat.torque * 100)}%</div>
         <button class="wsb-btn" style="padding:.15rem .5rem;font-size:.7rem;margin-top:.3rem" data-pull="${esc(st.slot)}">Pull</button>`
      : `<div class="mt">${locked ? 'needs ' + esc(st.requires.join(' + ')) : 'accepts ' + esc(st.accepts.join('/').toUpperCase())}</div>
         ${st.optional ? '<div class="opt">optional</div>' : ''}`;
    return `<div class="wsb-st ${cls}"><div class="nm">${esc((st.slot[0].toUpperCase() + st.slot.slice(1)))}</div>${body}</div>`;
  }).join('');

  // Only parts the player actually holds, and only ones this frame has a
  // station for — a tray full of things that can never fit is noise.
  /* Fitting parts first. A visible scrollbar fixes "I cannot see the rest";
     this fixes "the rest is what I needed" — the parts that can go on RIGHT NOW
     belong above the ones that cannot, or the bench reads as empty of options
     while holding eight of them. */
  const tray = Object.keys(CATALOG).filter((id) => itemCount(id) > 0 && stepFor(bp, CATALOG[id].part.slot))
    .sort((a, b) => (tryFit(b).ok ? 1 : 0) - (tryFit(a).ok ? 1 : 0))
    .map((id) => {
      const d = CATALOG[id], fit = tryFit(id);
      return `<button class="wsb-p ${fit.ok ? 'wsb-fits' : ''}" data-seat="${esc(id)}" ${fit.ok ? '' : 'disabled title="' + esc(fit.reason) + '"'}>
        <span>${esc(d.icon)}</span><span><b>${esc(d.name)}</b>
        <div class="wsb-sub wsb-tier-${esc(d.part.tier)}">${esc(d.part.mount.toUpperCase())} · ${esc(tierOf(d.part.tier).name)}</div></span>
        <span class="q">×${itemCount(id)}</span></button>`;
    }).join('') || '<div class="wsb-sub">No parts that fit this frame. Strip a donor.</div>';

  const band = TORQUE_BAND[2];
  return `<div class="wsb-wrap">
    <div class="wsb-head"><div><h2>🔧 ${esc(bp.icon)} ${esc(bp.name)}</h2>
      <div class="wsb-sub">${esc(bp.blurb)} · budget ${bp.budget} pts</div></div>
      <button class="wsb-x" id="${ID}-close">Close</button></div>
    <div class="wsb-cols">
      <div class="wsb-panel"><h3>Stations</h3>
        <!-- 🔧 The workshop. First-person over your own bench — the weapon
             assembles here as you seat parts. Purely presentational: if WebGL
             is unavailable the canvas never mounts and the stations below are
             exactly the bench that shipped in phase 5. -->
        <canvas class="wsb-3d" id="${ID}-3d"></canvas>
        <div class="wsb-stations">${stations}</div>
        <div class="wsb-meter">
          <span>quality <b>${Math.round(sc.quality * 100)}%</b></span>
          <span>ceiling <b>${Math.round(sc.cap * 100)}%</b></span>
          <span>misfits <b>${bench.misfits | 0}</b></span>
          <span>stripped <b>${bench.stripped | 0}</b></span>
        </div>
        <div class="wsb-msg">${esc(_msg)}</div>
        <div style="display:flex;gap:.5rem;margin-top:.6rem">
          <button class="wsb-btn" id="${ID}-finish" ${sc.complete ? '' : 'disabled title="' + esc('Missing: ' + (sc.missing || []).join(', ')) + '"'}>Proof &amp; Finish</button>
          <button class="wsb-btn" id="${ID}-abandon">Abandon</button>
        </div>
      </div>
      <div class="wsb-panel"><h3>Parts</h3>
        <div class="wsb-bar">
          <div class="wsb-fill" id="${ID}-fill"></div>
          <div class="wsb-band" style="left:${band[0] * 100}%;width:${(band[1] - band[0]) * 100}%"></div>
          <div class="wsb-danger" style="width:${(1 - TORQUE_STRIP) * 100}%"></div>
        </div>
        <div class="wsb-sub">Click a part to drive the fastener, click again to seat it. Green is spec; the red end strips it.</div>
        <!-- The parts tray is where the clipping hurt most: every part that
             actually FIT this frame sorted below the fold, so the bench looked
             like it had nothing usable in it. -->
        <div class="wsb-scroll"><div class="wsb-tray" style="margin-top:.5rem;max-height:420px">${tray}</div></div>
      </div>
    </div></div>`;
}

/* ⚔️ The forge. A fixed sequence rather than a board of stations — there is no
   order to learn, so the whole screen is the current step and the bar. */
function forgeView(s) {
  const f = s.forge, bp = blueprint(f.blueprintId);
  const step = bp.forge[f.step];
  const sc = scoreForge(f);
  const done = !step;

  const ladder = bp.forge.map((st, i) => {
    const state = i < f.step ? 'filled' : (i === f.step ? 'ready' : 'locked');
    const reps = st.reps || 1;
    return `<div class="wsb-st ${state}" style="min-height:0;padding:.5rem">
      <div class="nm">${esc(st.icon)} ${esc(st.name)}</div>
      <div class="mt">${i === f.step && reps > 1 ? (f.rep + '/' + reps) : (i < f.step ? 'done' : '')}</div>
    </div>`;
  }).join('');

  const band = step ? step.band : [0.6, 0.85];
  const burn = step ? step.burn : 0.95;

  return `<div class="wsb-wrap">
    <div class="wsb-head"><div><h2>⚔️ ${esc(bp.icon)} ${esc(bp.name)}</h2>
      <div class="wsb-sub">${esc(bp.blurb)} · budget ${bp.budget} pts</div></div>
      <button class="wsb-x" id="${ID}-close">Close</button></div>
    <div class="wsb-panel">
      <h3>${done ? 'Finished' : esc(step.icon + ' ' + step.name)}</h3>
      <!-- ⚔️ The smithy. The billet's COLOUR is the game state: it runs black →
           cherry → orange → yellow → white with the bar, and cools when you
           stop. A smith reads heat by colour, and after a few blades the
           player will too. -->
      <canvas class="wsb-3d" id="${ID}-3df"></canvas>
      <div class="wsb-sub" style="margin-bottom:.5rem">${done
        ? 'The blade is done. Proof it and take it.'
        : esc(step.verb) + '. Hold, and release inside the band — past the red and the steel is ruined.'}</div>
      <div class="wsb-stations" style="grid-template-columns:repeat(auto-fill,minmax(110px,1fr));margin-bottom:.7rem">${ladder}</div>
      ${done ? '' : `<div class="wsb-bar">
        <div class="wsb-fill" id="${ID}-fill"></div>
        <div class="wsb-band" style="left:${band[0] * 100}%;width:${(band[1] - band[0]) * 100}%"></div>
        <div class="wsb-danger" style="width:${(1 - burn) * 100}%"></div>
      </div>`}
      <div class="wsb-meter">
        <span>quality <b>${Math.round(sc.quality * 100)}%</b></span>
        <span>worst step <b>${Math.round((sc.worst || 0) * 100)}%</b></span>
        <span>steps <b>${f.step}/${bp.forge.length}</b></span>
      </div>
      <div class="wsb-msg">${esc(_msg)}</div>
      <div style="display:flex;gap:.5rem;margin-top:.6rem">
        ${done ? `<button class="wsb-btn" id="${ID}-fdone">Proof &amp; Finish</button>`
               : `<button class="wsb-btn" id="${ID}-fwork">${esc(step.verb)}</button>`}
        <button class="wsb-btn" id="${ID}-fabandon">Abandon (the billet is lost)</button>
      </div>
    </div></div>`;
}

function bind(s) {
  const el = document.getElementById(ID);
  if (!el) return;
  const close = document.getElementById(ID + '-close');
  if (close) close.onclick = () => closeBench();

  el.querySelectorAll('[data-bp]').forEach((b) => {
    b.onclick = () => {
      const id = b.getAttribute('data-bp');
      _msg = '';
      // A blade goes to the forge, a gun to the assembly bench. One picker,
      // two games — the blueprint decides which, so the player never has to.
      if (isBlade(BLUEPRINTS[id])) { const r = startForge(id); if (!r.ok) _msg = r.reason; }
      else startBuild(id);
      paint();
    };
  });
  el.querySelectorAll('[data-strip]').forEach((b) => {
    b.onclick = () => { const r = stripDonor(b.getAttribute('data-strip')); _msg = r ? ('Stripped — ' + r.parts.length + ' parts recovered.') : 'Could not strip that.'; paint(); };
  });
  el.querySelectorAll('[data-equip]').forEach((b) => {
    b.onclick = () => {
      const ok = equip(b.getAttribute('data-hero'), b.getAttribute('data-slot'), b.getAttribute('data-equip'));
      _msg = ok ? 'Equipped.' : 'That weapon does not fit that slot.';
      paint();
    };
  });
  const roll = document.getElementById(ID + '-roll');
  if (roll) roll.onclick = async () => {
    roll.disabled = true;
    const r = await rollBoard();
    _msg = !r ? 'Could not reach the board.'
         : r.throttled ? 'Nothing new yet — check back shortly.'
         : (((r.expired | 0) > 0 ? r.expired + ' contract(s) expired — reputation lost. ' : '') + 'Board refreshed.');
    paint();
  };
  el.querySelectorAll('[data-claim]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      const id = b.getAttribute('data-claim');
      const r = await claimRepBlueprint(id);
      _msg = (r && r.ok) ? ('Claimed the ' + BLUEPRINTS[id].name + ' — your reputation earned it.')
                         : 'Could not claim that blueprint.';
      paint();
    };
  });
  /* Delivery picks from the player's CRAFTED weapons. A prompt rather than a
     modal because the list is short and the bench already carries enough
     chrome; the server scores the match either way. */
  el.querySelectorAll('[data-deliver]').forEach((b) => {
    b.onclick = async () => {
      const cid = b.getAttribute('data-deliver');
      const book = [];
      try {
        const bk = bridgeBook();
        for (const id in bk) book.push(id + ' — ' + (bk[id].desc || bk[id].name));
      } catch (e) {}
      if (!book.length) { _msg = 'You have no finished weapons to deliver.'; paint(); return; }
      const pick = window.prompt('Deliver which weapon?\n\n' + book.join('\n') + '\n\nType the id:');
      if (!pick) return;
      b.disabled = true;
      const r = await deliverContract(cid, pick.trim());
      _msg = (r && r.ok)
        ? ('Delivered. Reputation ' + r.rep + (r.late ? ' (late — no speed credit).' : '.'))
        : ('Delivery refused: ' + ((r && r.error) || 'unknown weapon or contract') + '.');
      /* 💰 Cinder is paid CLIENT-SIDE, like every other Cinder award in this
         app — Profile.gems with a server mirror, not a canonical server
         balance the way Aza is. Noted in sql/041: what the server protects
         here is the contract's TERMS and the REPUTATION, both of which gate
         content. Moving Cinder itself server-side is a far larger change. */
      if (r && r.ok && r.pays && r.pays.cinder) { try { addGems(r.pays.cinder | 0); } catch (e) {} }
      paint();
    };
  });
  el.querySelectorAll('[data-learn]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;                       // learning round-trips; no double-spend
      const r = await learnSchematic(b.getAttribute('data-learn'));
      _msg = r.ok ? ('Learned the ' + r.name + ' — the frame is unlocked.') : r.reason;
      paint();
    };
  });
  el.querySelectorAll('[data-clean]').forEach((b) => {
    b.onclick = () => {
      const to = cleanPart(b.getAttribute('data-clean'));
      _msg = to ? ('Cleaned up to ' + (partDef(to) || {}).name + '.') : 'Not enough gun oil.';
      /* A short rag pass, so cleaning is a visible ACT rather than a number
         changing. Guarded on the scene existing at all — cleaning lives on the
         picker screen, which has no canvas, so this is usually a no-op and
         must stay harmless when it is. */
      if (to && _scene && _scene.setWork) {
        try {
          _scene.setWork('rag', 0.5);
          setTimeout(() => { if (_scene && _scene.setWork) _scene.setWork(null); }, 700);
        } catch (e) {}
      }
      paint();
    };
  });
  el.querySelectorAll('[data-pull]').forEach((b) => {
    b.onclick = () => { const r = pullPart(b.getAttribute('data-pull')); _msg = (r && r.ok) ? 'Pulled.' : ((r && r.reason) || 'Could not pull that.'); paint(); };
  });
  // Click once to start the fastener, click again to release it.
  el.querySelectorAll('[data-seat]').forEach((b) => {
    b.onclick = () => {
      const id = b.getAttribute('data-seat');
      if (_sel === id && _torque) { release(); return; }
      _msg = 'Driving the fastener — click again to seat.';
      startTorque(id);
      const m = el.querySelector('.wsb-msg'); if (m) m.textContent = _msg;
    };
  });

  /* ⚔️ Forge bar. Same hold-and-release as the torque bar, but a miss past the
     burn threshold destroys the billet rather than costing a retry. */
  const fwork = document.getElementById(ID + '-fwork');
  if (fwork) fwork.onclick = () => {
    if (_torque) {                              // second click — release
      const v = _torque.v; stopTorque(); _sel = null;
      const r = workStep(v);
      _msg = r.ok ? r.note : r.reason;
      paint();
      return;
    }
    _msg = 'Working…  click again to stop.';
    _sel = '__forge';
    startTorque('__forge');
    const m = el.querySelector('.wsb-msg'); if (m) m.textContent = _msg;
  };
  const fdone = document.getElementById(ID + '-fdone');
  if (fdone) fdone.onclick = async () => {
    fdone.disabled = true;
    const r = await finishForge();
    _msg = r.ok ? ('Forged ' + r.item.name + ' at ' + r.quality + '% (worst step ' + r.worst + '%).') : r.reason;
    if (r.ok) { try { toast('⚔️ ' + r.item.name + ' finished (' + r.quality + '%).', 5200); } catch (e) {} }
    paint();
  };
  const fab = document.getElementById(ID + '-fabandon');
  if (fab) fab.onclick = () => { abandonForge(); _msg = 'Left it to go cold. The billet is scrap.'; paint(); };

  const fin = document.getElementById(ID + '-finish');
  if (fin) fin.onclick = async () => {
    // Awaited — finishBuild now round-trips to ws_mint when online, and a
    // bench that cleared itself before the answer arrived would lose the build.
    const r = await finishBuild();
    _msg = r.ok ? ('Built ' + r.item.name + ' at ' + r.quality + '% — it is in your vault.') : r.reason;
    if (r.ok) { try { toast('🔧 ' + r.item.name + ' finished (' + r.quality + '%).', 5200); } catch (e) {} }
    paint();
  };
  const ab = document.getElementById(ID + '-abandon');
  if (ab) ab.onclick = () => { abandonBuild(); _msg = 'Bench cleared — parts returned.'; paint(); };
}

export function benchOpen() { return !!document.getElementById(ID); }
