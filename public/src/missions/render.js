/* 🖥 THE MISSION MAP SCREEN — replaces the roguelite campaign list.
   ═══════════════════════════════════════════════════════════════════════════
   Canvas 2D on purpose. The city is STATIC geometry — only the tints change —
   so this redraws on interaction rather than on a ticker, and the only thing
   that needs a frame loop is the ash. PixiJS is already loaded globally and
   pixi-board.js is the precedent if this ever needs a sprite pool, but a
   dependency that buys nothing is a dependency that can break.

   ⚠ index.html's render() replaces #app wholesale, so everything below is
     rebuilt on every call. The city geometry is memoised in city.js; only the
     DOM and the canvas are recreated, which is cheap.
   ═══════════════════════════════════════════════════════════════════════════ */

import { bridge, esc } from './bridge.js';
import { city, bounds, pX, pY, hash2, TW, TH, UX, UY, VX, VY } from './city.js';
import { SITES, SITE_BY_ID, MISSION_POI, FACTIONS, bandFor, enemyLevelFor } from './poi.js';
import * as S from './state.js';
import { missionId, hasCards } from './graph.js';

let sel = 'hells';
let drawer = false;        // the Story Runs panel
let view = { s:1, ox:0, oy:0, w:0, h:0 };
let pickCv = null, pickCtx = null, pickIds = [];
let loopTok = 0;

/* ── styles, injected once ───────────────────────────────────────────────
   A <style> tag rather than a .css file so there is one fewer asset for the
   service worker to serve stale. */
function css(){
  if (document.getElementById('msn-css')) return;
  const el = document.createElement('style');
  el.id = 'msn-css';
  el.textContent = `
  .msn{position:fixed;inset:0;display:grid;grid-template-columns:1fr 320px;
       grid-template-rows:auto 1fr auto;background:#06080c;color:#e8edf5;
       font:400 14.5px/1.55 'Barlow',ui-sans-serif,system-ui,sans-serif;z-index:5}
  @media (max-width:900px){ .msn{grid-template-columns:1fr;grid-template-rows:auto 52vh auto auto;overflow-y:auto} }
  .msn-ui{font-family:'Chakra Petch','Cinzel',ui-sans-serif,system-ui,sans-serif}
  .msn-hud{grid-column:1/-1;display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:9px 16px;
       background:linear-gradient(#0c1119,#080b11);border-bottom:1px solid rgba(120,180,220,.2)}
  .msn-hud h1{margin:0;font-size:12.5px;letter-spacing:.2em;text-transform:uppercase;font-weight:700;color:#e0b356}
  .msn-sep{flex:1}
  .msn-lg{display:flex;align-items:center;gap:6px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#7d8ba0}
  .msn-lg i{width:9px;height:9px;border-radius:2px;display:block;box-shadow:0 0 8px currentColor}
  .msn-lg b{color:#e8edf5;font-weight:700;font-variant-numeric:tabular-nums}
  .msn-stage{position:relative;overflow:hidden;background:radial-gradient(120% 90% at 50% 45%,#141c28,#0a0e14 58%,#06080c)}
  .msn-stage canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
  #msn-fx{pointer-events:none}
  .msn-pins{position:absolute;inset:0;pointer-events:none}
  .msn-vig{position:absolute;inset:0;pointer-events:none;background:radial-gradient(72% 62% at 50% 48%,transparent 42%,rgba(0,0,0,.58))}
  .msn-pin{position:absolute;transform:translate(-50%,-50%);pointer-events:auto;cursor:pointer;white-space:nowrap}
  .msn-pin .c{background:rgba(8,12,18,.92);border:1px solid var(--c);border-left-width:3px;padding:4px 10px 5px;
       box-shadow:0 4px 14px rgba(0,0,0,.65),inset 0 0 18px rgba(0,0,0,.4);transition:transform .14s}
  .msn-pin:hover .c{transform:translateY(-2px)}
  .msn-pin.on .c{box-shadow:0 0 0 1px var(--c),0 0 24px -3px var(--c)}
  .msn-pin .n{font-size:11.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;display:flex;align-items:center;gap:6px}
  .msn-pin .m{font-size:10.5px;color:#7d8ba0;margin-top:1px;font-variant-numeric:tabular-nums}
  .msn-pin .g{margin-top:4px;height:2px;background:rgba(255,255,255,.1)}
  .msn-pin .g i{display:block;height:100%;background:var(--c);box-shadow:0 0 6px var(--c)}
  .msn-panel{background:#0d121b;border-left:1px solid rgba(120,180,220,.2);display:flex;flex-direction:column;overflow:hidden}
  @media (max-width:900px){ .msn-panel{border-left:0;border-top:1px solid rgba(120,180,220,.2)} }
  .msn-ph{padding:12px 16px 10px;border-bottom:1px solid rgba(255,255,255,.06)}
  .msn-ph .k{font-size:10.5px;letter-spacing:.2em;text-transform:uppercase;color:#4a5568}
  .msn-ph h2{margin:2px 0 0;font-size:20px;font-weight:700}
  .msn-ph .p{margin-top:3px;font-size:12.5px;color:#7d8ba0}
  .msn-pb{padding:12px 16px;overflow-y:auto;flex:1;min-height:0}
  .msn-row{display:flex;justify-content:space-between;align-items:baseline;padding:6px 0;
       border-bottom:1px solid rgba(255,255,255,.05);font-size:12.5px}
  .msn-row span{color:#7d8ba0}
  .msn-row b{font-weight:700;font-variant-numeric:tabular-nums}
  .msn-grip{margin:14px 0 4px}
  .msn-grip .l{display:flex;justify-content:space-between;font-size:10.5px;letter-spacing:.16em;
       text-transform:uppercase;color:#4a5568;margin-bottom:5px;font-variant-numeric:tabular-nums}
  .msn-track{height:7px;background:rgba(255,255,255,.07);overflow:hidden}
  .msn-track i{display:block;height:100%;transition:width .45s cubic-bezier(.4,0,.2,1)}
  .msn-band{margin-top:8px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;
       padding:4px 8px;display:inline-block;border:1px solid currentColor}
  .msn-haul{margin-top:12px;font-size:12.5px;color:#7d8ba0;line-height:1.7}
  .msn-haul b{color:#e8edf5}
  .msn-acts{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap}
  .msn button{font:inherit;font-size:11.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;
       font-family:'Chakra Petch',ui-sans-serif,system-ui,sans-serif;
       padding:9px 12px;cursor:pointer;background:rgba(255,255,255,.05);color:#e8edf5;
       border:1px solid rgba(255,255,255,.16);transition:.14s}
  .msn button:hover:not(:disabled){background:rgba(255,255,255,.11);border-color:rgba(255,255,255,.34)}
  .msn button:disabled{opacity:.35;cursor:not-allowed}
  .msn button.go{background:rgba(61,139,253,.16);border-color:#3d8bfd;color:#bcd8ff;flex:1}
  .msn button.go:hover:not(:disabled){background:rgba(61,139,253,.3)}
  .msn :focus-visible{outline:2px solid #e0b356;outline-offset:2px}
  .msn-log{border-top:1px solid rgba(255,255,255,.08);padding:10px 16px;max-height:150px;overflow-y:auto;
       font-size:11.5px;line-height:1.6;color:#7d8ba0}
  .msn-bar{grid-column:1/-1;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:9px 16px;
       background:linear-gradient(#080b11,#0c1119);border-top:1px solid rgba(120,180,220,.2)}
  .msn-bar .h{font-size:11.5px;color:#4a5568}
  .msn-run{display:flex;align-items:center;gap:10px;padding:6px 12px;border:1px solid #e0b356;
       background:rgba(224,179,86,.12);font-size:12px;color:#f3d99b}
  .msn-note{margin-top:12px;font-size:12px;line-height:1.6;color:#e0b356;
       border-left:2px solid #e0b356;padding:6px 0 6px 10px;background:rgba(224,179,86,.07)}
  .msn-story{position:absolute;left:0;right:0;bottom:0;max-height:64%;overflow-y:auto;
       background:rgba(8,12,18,.96);border-top:1px solid rgba(224,179,86,.5);
       padding:14px 18px 18px;backdrop-filter:blur(4px)}
  .msn-story h3{margin:0 0 3px;font-size:12px;letter-spacing:.2em;text-transform:uppercase;
       color:#e0b356;font-family:'Chakra Petch',ui-sans-serif,system-ui,sans-serif}
  .msn-story .sub{font-size:11.5px;color:#4a5568;margin-bottom:12px}
  .msn-story .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(268px,1fr));gap:10px}
  .msn-card{border:1px solid rgba(255,255,255,.14);border-left:3px solid #b86bff;
       background:rgba(255,255,255,.035);padding:9px 12px 11px}
  .msn-card.lk{border-left-color:#4a5568;opacity:.6}
  .msn-card .t{font-size:12.5px;font-weight:700;display:flex;align-items:center;gap:7px;flex-wrap:wrap}
  .msn-card .d{font-size:11.5px;color:#7d8ba0;margin:3px 0 8px;line-height:1.5}
  .msn-card .tag{font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;
       padding:1px 6px;border:1px solid currentColor}
  .msn-card button{width:100%;padding:7px 10px}
  @media (prefers-reduced-motion:reduce){ .msn *{transition:none!important} }`;
  document.head.appendChild(el);
}

/* ── drawing ─────────────────────────────────────────────────────────────── */
function shade(hex,k,mix){
  let r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  r=Math.round(r*k); g=Math.round(g*k); b=Math.round(b*k);
  if (mix){ r=Math.round(r*(1-mix)+9*mix); g=Math.round(g*(1-mix)+13*mix); b=Math.round(b*(1-mix)+20*mix); }
  return 'rgb('+r+','+g+','+b+')';
}
const FACE = {};
Object.keys(FACTIONS).forEach(k => { const c = FACTIONS[k].color; FACE[k] = {
  i:{ t:shade(c,1), l:shade(c,.54,.16), r:shade(c,.31,.3) },
  r:{ t:shade(c,.6,.34), l:shade(c,.34,.44), r:shade(c,.2,.52) } }; });

const sx = (gx,gy) => pX(gx,gy)*view.s + view.ox;
const sy = (gx,gy,h) => (pY(gx,gy)-(h||0))*view.s + view.oy;
function poly(c,p,fill){ c.beginPath(); c.moveTo(p[0],p[1]); for(let i=2;i<p.length;i+=2) c.lineTo(p[i],p[i+1]); c.closePath(); c.fillStyle=fill; c.fill(); }
function quad(gx,gy,h){
  const s=view.s, ux=UX*s, uy=UY*s, vx=VX*s, vy=VY*s, x=sx(gx,gy), y=sy(gx,gy,h);
  return [x,y, x+ux,y+uy, x+ux+vx,y+uy+vy, x+vx,y+vy];
}
function ownerOf(b){ const h = S.hold(b.id); return (h.f && b.roll*100 < h.g) ? h.f : 'survivors'; }

function fit(stage, cv, fx){
  const r = stage.getBoundingClientRect();
  view.w = Math.max(320, r.width); view.h = Math.max(240, r.height);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  [cv,fx].forEach(c => { c.width = Math.round(view.w*dpr); c.height = Math.round(view.h*dpr); });
  cv.getContext('2d').setTransform(dpr,0,0,dpr,0,0);
  fx.getContext('2d').setTransform(dpr,0,0,dpr,0,0);
  const b = bounds(), cw = b.x1-b.x0, ch = b.y1-b.y0;
  // the label cards fan off both flanks; fitting the geometry alone pushes the
  // end districts off the frame
  const px = Math.min(272, view.w*0.23), py = Math.min(104, view.h*0.15);
  view.s = Math.min((view.w-px)/cw, (view.h-py)/ch);
  view.ox = (view.w-cw*view.s)/2 - b.x0*view.s;
  view.oy = (view.h-ch*view.s)/2 - b.y0*view.s;
}

function pinAt(site){
  const m = city().meta[site.id];
  const ax = m.ax*view.s + view.ox, ay = m.ay*view.s + view.oy;
  const k = Math.min(1.25, Math.max(0.8, view.s*1.4));
  return { ax, ay, x: ax + site.pin.dx*k, y: ay + site.pin.dy*k };
}

function draw(cv){
  const C = city(), ctx = cv.getContext('2d'), s = view.s;
  ctx.clearRect(0,0,view.w,view.h);

  C.water.forEach(c => {                                   // the rivers give the island an edge
    const sh = 0.5+0.5*Math.sin(c.gx*0.7+c.gy*0.4);
    ctx.globalAlpha = c.a*c.a*0.95;
    poly(ctx, quad(c.gx,c.gy,0),
      'rgb('+Math.round(13+sh*10)+','+Math.round(32+sh*20)+','+Math.round(55+sh*28)+')');
  });
  ctx.globalAlpha = 1;

  C.cells.forEach(c => {                                   // ground; the street grid must read
    const h = S.hold(c.id), on = sel===c.id;
    let f;
    if (c.park)      f = h.f ? shade(FACTIONS[h.f].color,.26,.62) : '#172a1b';
    else if (c.road) f = on ? '#2f3a4a' : '#242c3a';
    else             f = on ? '#181f2b' : '#121925';
    poly(ctx, quad(c.gx,c.gy,0), f);
  });

  ctx.lineWidth = Math.max(1,1.1*s); ctx.strokeStyle = 'rgba(150,190,230,.3)';
  C.cells.forEach(c => {                                   // district seams
    const q = quad(c.gx,c.gy,0);
    const e = C.byCell.get((c.gx+1)+','+c.gy), so = C.byCell.get(c.gx+','+(c.gy+1));
    if (!e || e.id!==c.id){ ctx.beginPath(); ctx.moveTo(q[2],q[3]); ctx.lineTo(q[4],q[5]); ctx.stroke(); }
    if (!so||so.id!==c.id){ ctx.beginPath(); ctx.moveTo(q[6],q[7]); ctx.lineTo(q[4],q[5]); ctx.stroke(); }
  });

  C.cells.forEach(c => {                                   // the park's overgrowth
    if (!c.park || hash2(c.gx,c.gy,31) > 0.5) return;
    const q = quad(c.gx,c.gy,0), cx=(q[0]+q[4])/2, cy=(q[1]+q[5])/2;
    const h = S.hold(c.id), rr = (3+hash2(c.gx,c.gy,33)*3.2)*s;
    ctx.fillStyle = h.f ? shade(FACTIONS[h.f].color,.44,.38) : '#254c2b';
    ctx.beginPath(); ctx.ellipse(cx, cy-rr*0.45, rr, rr*0.62, 0, 0, 7); ctx.fill();
  });

  C.builds.forEach(b => {                                  // far → near
    const g = quad(b.gx,b.gy,0), h = b.h*s, f = FACE[ownerOf(b)][b.ruined?'r':'i'];
    const t = [g[0],g[1]-h, g[2],g[3]-h, g[4],g[5]-h, g[6],g[7]-h];
    poly(ctx,[t[2],t[3],t[4],t[5],g[4],g[5],g[2],g[3]], f.r);
    poly(ctx,[t[6],t[7],t[4],t[5],g[4],g[5],g[6],g[7]], f.l);
    poly(ctx,t,f.t);
    if (b.lit && !b.ruined && h > 12){
      ctx.fillStyle = 'rgba(255,232,176,.6)';
      ctx.fillRect((t[6]+g[4])/2-1, (t[7]+g[5])/2-h*0.18, Math.max(1,1.5*s), Math.max(1,1.5*s));
    }
  });

  SITES.forEach(site => {                                  // leader lines
    const p = pinAt(site), h = S.hold(site.id);
    const c = h.f ? FACTIONS[h.f].color : FACTIONS.survivors.color;
    ctx.strokeStyle = c; ctx.globalAlpha = sel===site.id ? .9 : .4;
    ctx.lineWidth = Math.max(1,1.1*s);
    ctx.beginPath(); ctx.moveTo(p.ax,p.ay); ctx.lineTo(p.x,p.y); ctx.stroke();
    ctx.globalAlpha = 1; ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(p.ax,p.ay,Math.max(2.2,2.6*s),0,7); ctx.fill();
  });
}

/* Offscreen pick buffer — exact hit testing over building faces, instead of
   approximating on the ground plane and mis-selecting behind a tower. */
function drawPick(){
  const C = city();
  if (!pickCv){ pickCv = document.createElement('canvas'); pickCtx = pickCv.getContext('2d',{ willReadFrequently:true }); }
  pickCv.width = Math.round(view.w); pickCv.height = Math.round(view.h);
  pickCtx.setTransform(1,0,0,1,0,0); pickCtx.clearRect(0,0,pickCv.width,pickCv.height);
  pickIds = SITES.map(s => s.id);
  const col = id => 'rgb('+((pickIds.indexOf(id)+1)*20)+',0,0)';
  C.cells.forEach(c => poly(pickCtx, quad(c.gx,c.gy,0), col(c.id)));
  C.builds.forEach(b => {
    const g = quad(b.gx,b.gy,0), h = b.h*view.s, c = col(b.id);
    const t = [g[0],g[1]-h, g[2],g[3]-h, g[4],g[5]-h, g[6],g[7]-h];
    poly(pickCtx,[t[2],t[3],t[4],t[5],g[4],g[5],g[2],g[3]],c);
    poly(pickCtx,[t[6],t[7],t[4],t[5],g[4],g[5],g[6],g[7]],c);
    poly(pickCtx,t,c);
  });
}
function hit(x,y){
  if (!pickCtx || x<0 || y<0 || x>=pickCv.width || y>=pickCv.height) return null;
  const d = pickCtx.getImageData(x,y,1,1).data;
  if (!d[3]) return null;
  return pickIds[Math.round(d[0]/20)-1] || null;
}

/* ── panel ───────────────────────────────────────────────────────────────── */
function storyCard(c, wide){
  const B = bridge();
  const tag = c.cleared ? '<span class="tag" style="color:#5eb37a">Cleared</span>'
            : c.draft   ? '<span class="tag" style="color:#e0b356">Draft</span>' : '';
  return '<div class="msn-card' + (c.locked ? ' lk' : '') + '">'
    + '<div class="t">' + esc(c.name) + tag + '</div>'
    + '<div class="d">' + esc(c.description || '') + (c.description ? '<br>' : '')
    + esc(c.difficulty) + ' · ' + c.nodes + ' nodes</div>'
    + (c.locked
        ? '<button disabled>🔒 Clear ' + esc(c.requires) + ' first</button>'
        : '<button class="go" data-story="' + esc(c.id) + '">▸ ' + (c.cleared ? 'Replay' : 'Deploy') + '</button>')
    + '</div>';
}

function panelHtml(authored){
  const site = SITE_BY_ID[sel], poi = MISSION_POI[site.poi];
  const h = S.hold(sel), fac = h.f ? FACTIONS[h.f] : FACTIONS.survivors;
  const grip = h.f ? (h.g|0) : 0;
  const band = bandFor(site, grip);
  const lvl = enemyLevelFor(grip) + (band.key==='brutal' ? 8 : (band.key==='hard'||band.key==='harder') ? 4 : 0);
  const seal = S.sealed(sel);
  // Campaigns the admin pinned to THIS district, offered alongside the raid.
  const pinned = (authored || []).filter(c => c.site === sel);
  return `
    <div class="msn-ph">
      <div class="k msn-ui">Selected district</div>
      <h2 class="msn-ui">${esc(site.name)}</h2>
      <div class="p">${poi.icon}  ${esc(poi.label)}</div>
    </div>
    <div class="msn-pb">
      <div class="msn-row"><span>Controlled by</span><b style="color:${fac.color}">${esc(fac.name)}</b></div>
      <div class="msn-row"><span>Enemy levels</span><b>${lvl ? '+'+lvl : '—'}</b></div>
      <div class="msn-row"><span>Run length</span><b>${poi.nodes + (grip>=50?1:0) + (grip>=90?1:0)} nodes</b></div>
      <div class="msn-grip">
        <div class="l msn-ui"><span>Faction grip</span><span>${grip} / 100</span></div>
        <div class="msn-track"><i style="width:${grip}%;background:${fac.color};box-shadow:0 0 10px ${fac.color}"></i></div>
        <div class="msn-band msn-ui" style="color:${band.accent}">${esc(band.label)}</div>
        ${seal ? '<div class="msn-haul" style="color:#ff5a3c"><b>⚠ Sealed.</b> Foundation surveillance is total here — carry contraband in and the route closes behind you.</div>' : ''}
      </div>
      <div class="msn-haul"><b>Expected haul</b><br>${esc(band.haul)}</div>
      <div class="msn-haul" style="font-style:italic">${esc(poi.flavour)}</div>
      <div class="msn-acts">
        <button class="go" id="msn-go">▸ Deploy</button>
        <button id="msn-fort" ${h.f ? 'disabled' : ''}>Fortify</button>
      </div>
      ${hasCards() ? '' : '<div class="msn-note"><b>No card catalogue published.</b> Raids pay extra Cinder in place of card rewards until one is. Admins: publish a catalogue in the Forge.</div>'}
      ${pinned.length ? '<div class="msn-grip"><div class="l msn-ui"><span>Story runs here</span></div>' +
        pinned.map(c => storyCard(c)).join('') + '</div>' : ''}
    </div>`;
}

/* ── the screen ──────────────────────────────────────────────────────────── */
export function screen(){
  const B = bridge();
  const root = B.root();
  if (!root) return false;
  css();

  // Catch the map up, then credit anything survived since we last looked.
  const lines = S.tick().concat(S.creditRuns((B.profile() || {}).rlcCompleted || []));

  const run = B.activeRun();
  const cen = S.census(city().builds);
  // 📜 The admin's hand-built campaigns. The map replaced the list that used
  // to be their only surface, so it carries them now — pinned to a district
  // when one is set on them, and in the drawer either way.
  const authored = B.authoredCampaigns() || [];
  const loose = authored.filter(c => !c.site || !SITE_BY_ID[c.site]);

  root.innerHTML = `
  <div class="msn">
    <header class="msn-hud">
      <h1>◆ Sector Map — New York</h1>
      <div style="display:flex;gap:14px;flex-wrap:wrap">
        ${Object.keys(FACTIONS).map(k => `<div class="msn-lg msn-ui"><i style="background:${FACTIONS[k].color};color:${FACTIONS[k].color}"></i>${esc(FACTIONS[k].name)} <b>${cen[k]}%</b></div>`).join('')}
      </div>
      <div class="msn-sep"></div>
      ${run ? `<div class="msn-run msn-ui">RUN IN PROGRESS — ${esc(B.campaignName(run.campaignId))} · ${run.heroHP}/${run.maxHP} HP
        <button id="msn-cont">▶ Continue</button><button id="msn-aband">✖</button></div>` : ''}
    </header>
    <div class="msn-stage" id="msn-stage">
      <canvas id="msn-city"></canvas><canvas id="msn-fx"></canvas>
      <div class="msn-vig"></div><div class="msn-pins" id="msn-pins"></div>
      ${drawer ? `<div class="msn-story" id="msn-drawer">
        <h3>Story Runs</h3>
        <div class="sub">${authored.length ? 'Hand-built campaigns. Ones pinned to a district also appear in its panel.' : 'None published yet. Admins build these in the Forge → Roguelite Campaigns.'}</div>
        <div class="grid">${authored.map(c => storyCard(c)).join('')}</div>
      </div>` : ''}
    </div>
    <aside class="msn-panel" id="msn-panel">${panelHtml(authored)}
      <div class="msn-log" id="msn-log">${lines.length ? lines.map(l => '<div>'+esc(l)+'</div>').join('') : '<div>The city is quiet. It will not stay that way.</div>'}</div>
    </aside>
    <footer class="msn-bar">
      <button id="msn-back">← Camp</button>
      <span class="h">Click a district · Deploy to raid it · survive the run and the survivors take ground back</span>
      <div class="msn-sep"></div>
      ${authored.length ? `<button id="msn-story">📜 Story Runs · ${authored.length}${loose.length ? '' : ' pinned'}</button>` : ''}
    </footer>
  </div>`;

  const stage = document.getElementById('msn-stage');
  const cv = document.getElementById('msn-city'), fx = document.getElementById('msn-fx');

  // Pins are DOM so the labels stay crisp and hoverable over the canvas —
  // the same split pixi-board.js uses for its status badges.
  const pins = document.getElementById('msn-pins');
  const pinEls = {};
  SITES.forEach(site => {
    const h = S.hold(site.id), fac = h.f ? FACTIONS[h.f] : FACTIONS.survivors;
    const poi = MISSION_POI[site.poi];
    const el = document.createElement('div');
    el.className = 'msn-pin' + (sel===site.id ? ' on' : '');
    el.style.setProperty('--c', fac.color);
    el.innerHTML = `<div class="c"><div class="n msn-ui"><span>${poi.icon}</span><span>${esc(site.name)}</span></div>
      <div class="m">${h.f ? esc(fac.name)+' · '+(h.g|0)+'%' : 'Secure · '+esc(poi.label)}</div>
      <div class="g"><i style="width:${h.f ? (h.g|0) : 100}%"></i></div></div>`;
    el.onclick = () => { sel = site.id; B.render(); };
    pins.appendChild(el); pinEls[site.id] = el;
  });

  const paint = () => {
    fit(stage, cv, fx); draw(cv); drawPick();
    SITES.forEach(site => { const p = pinAt(site); const e = pinEls[site.id]; e.style.left = p.x+'px'; e.style.top = p.y+'px'; });
  };
  paint();

  stage.onmousemove = (e) => {
    const r = stage.getBoundingClientRect();
    stage.style.cursor = hit(Math.round(e.clientX-r.left), Math.round(e.clientY-r.top)) ? 'pointer' : 'default';
  };
  stage.onclick = (e) => {
    const r = stage.getBoundingClientRect();
    const id = hit(Math.round(e.clientX-r.left), Math.round(e.clientY-r.top));
    if (id && id !== sel) { sel = id; B.render(); }
  };
  window.onresize = () => { if (document.getElementById('msn-city')) paint(); };

  document.getElementById('msn-back').onclick = () => B.goCamp();
  document.getElementById('msn-go').onclick = async () => {
    const site = SITE_BY_ID[sel];
    if (run && !(await B.confirm('Deploying will abandon your current run. Continue?'))) return;
    const id = missionId(sel, S.hold(sel), S.mm().day);
    if (!B.startRun(id)) B.toast('⚠ Could not open that mission — check the console.');
  };
  const fort = document.getElementById('msn-fort');
  if (fort) fort.onclick = () => {
    if (S.fortify(sel)) { B.toast('🛡 ' + SITE_BY_ID[sel].name + ' fortified — the factions will find it harder to seed here.'); B.render(); }
  };
  const story = document.getElementById('msn-story');
  if (story) story.onclick = () => { drawer = !drawer; B.render(); };
  // One handler for every story-run button, in the panel and the drawer alike.
  document.querySelectorAll('[data-story]').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-story');
      if (run && !(await B.confirm('Deploying will abandon your current run. Continue?'))) return;
      if (!B.startRun(id)) B.toast('⚠ That campaign could not be opened — it may have no map yet.');
    };
  });
  const cont = document.getElementById('msn-cont'); if (cont) cont.onclick = () => B.resumeRun();
  const ab = document.getElementById('msn-aband'); if (ab) ab.onclick = () => B.abandonRun();

  ambient(fx);
  return true;
}

/* Ash and the glow off held districts. Atmosphere, not information — so a
   viewer who asked for less motion gets one static frame and no loop. */
function ambient(fx){
  const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const tok = ++loopTok;
  const ctx = fx.getContext('2d');
  const ash = [];
  for (let i=0;i<80;i++) ash.push({ x:Math.random(), y:Math.random(), s:.15+Math.random()*.5, r:.6+Math.random()*1.3, a:.1+Math.random()*.28 });
  let t0 = 0;
  const frame = (t) => {
    // stop when this screen is gone or another render superseded us
    if (tok !== loopTok || !document.getElementById('msn-fx')) return;
    const dt = Math.min(50, t-t0); t0 = t;
    ctx.clearRect(0,0,view.w,view.h);
    SITES.forEach(site => {
      const h = S.hold(site.id); if (!h.f || h.g < 20) return;
      const m = city().meta[site.id], n = Math.min(5, Math.round(h.g/22));
      for (let i=0;i<n;i++){
        const jx=(hash2(i,0,site.id.length*7)-.5)*7, jy=(hash2(i,1,site.id.length*7)-.5)*7;
        const x=pX(m.gx+jx,m.gy+jy)*view.s+view.ox, y=pY(m.gx+jx,m.gy+jy)*view.s+view.oy;
        const fl=.55+.45*Math.sin(t/(240+i*70)+i), R=(20+i*5)*view.s*fl;
        ctx.fillStyle='rgba(255,150,60,'+(.055*fl*(h.g/100))+')';
        ctx.beginPath(); ctx.arc(x,y,R,0,7); ctx.fill();
      }
    });
    ctx.fillStyle='rgb(200,214,232)';
    ash.forEach(p => {
      p.y -= p.s*dt/2400; p.x += p.s*dt/9000;
      if (p.y < -0.02){ p.y = 1.02; p.x = Math.random(); }
      ctx.globalAlpha = p.a; ctx.fillRect(p.x*view.w, p.y*view.h, p.r, p.r);
    });
    ctx.globalAlpha = 1;
    if (!still) requestAnimationFrame(frame);
  };
  requestAnimationFrame(t => { t0 = t; frame(t); });
}

export function select(id){ if (SITE_BY_ID[id]) sel = id; }
