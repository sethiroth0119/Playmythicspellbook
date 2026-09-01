/* 🏙 THE CITY — a seeded, procedural ruined Manhattan.
   ═══════════════════════════════════════════════════════════════════════════
   PURE. No DOM, no I/O, no globals. Call build() once, get geometry back.

   There is no city artwork and there is not meant to be. The island
   silhouette, the street grid, Central Park's hole, and every building and
   its height come out of hash2(), so one seed draws the same New York for
   every player on every device, forever — and a designer can move a district
   by editing a number instead of commissioning a repaint.

   ⚠ THE PROJECTION IS A TRUE 45° ISOMETRIC AND SHOULD STAY THAT WAY. A skewed
     camera was tried (it fills a landscape frame better — Manhattan at 45°
     wastes two corners) and it flattens every building into a chip: diamonds
     read as mass, parallelograms don't. The diagonal is the price of the
     buildings looking like buildings. Don't re-litigate it without looking at
     both renders side by side.
   ═══════════════════════════════════════════════════════════════════════════ */

import { SITES, SITE_BY_ID } from './poi.js';

export function hash2(x, y, s) {
  let h = (x|0)*374761393 + (y|0)*668265263 + (s|0)*1442695041;
  h = Math.imul(h ^ (h>>>13), 1274126177);
  return ((h ^ (h>>>16))>>>0) / 4294967296;
}
/* String → 32-bit seed. Used for mission ids, so a run's layout is recoverable
   from its id alone and never has to be stored. */
export function hashStr(str) {
  let h = 2166136261;
  const s = String(str);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0);
}

/* the isometric basis: U is one step across the island, V one step downtown */
export const TW = 18, TH = 9;
export const UX = TW/2, UY = TH/2, VX = -TW/2, VY = TH/2;
export const pX = (gx,gy) => gx*UX + gy*VX;
export const pY = (gx,gy) => gx*UY + gy*VY;
const DEPTH = (gx,gy) => gx*UY + gy*VY;         // painter's-algorithm key

const GW = 34, GH = 84, CX = 17;

function halfWidth(gy){
  let hw;
  if (gy < 13)      hw = 6.2;                 // Harlem
  else if (gy < 33) hw = 7.6;                 // the Uppers + the park
  else if (gy < 46) hw = 7.2;                 // Midtown
  else if (gy < 55) hw = 6.4;                 // Chelsea
  else if (gy < 65) hw = 5.6;                 // the Village
  else if (gy < 75) hw = 4.6;                 // SoHo
  else              hw = 4.6 - (gy-75)*0.52;  // Battery, tapering to a point
  hw += (hash2(0,gy,7)-0.5)*1.3;              // ragged shoreline
  return Math.max(0.6, hw);
}
const centerX  = (gy) => CX + Math.sin(gy*0.055)*2.2;
const onIsland = (gx,gy) => Math.abs(gx-centerX(gy)) <= halfWidth(gy);
const inPark   = (gx,gy) => gy>=16 && gy<=32 && Math.abs(gx-centerX(gy)) <= 2.2;
const broadway = (gy) => centerX(gy) - 2.6 + (gy/GH)*5.2;   // the one diagonal

function siteAt(gx,gy){
  const c = centerX(gy);
  if (inPark(gx,gy)) return 'park';
  if (gy < 13)  return 'harlem';
  if (gy < 33)  return gx < c ? 'uws' : 'ues';
  if (gy < 46)  return gx < c ? 'hells' : 'midtown';
  if (gy < 55)  return 'chelsea';
  if (gy < 65)  return 'village';
  if (gy < 75)  return 'soho';
  return 'battery';
}

let _city = null;

/* Build once and memoise — the geometry never changes, only the colours do,
   and re-deriving 400+ buildings on every re-render would be pure waste. */
export function city(){
  if (_city) return _city;

  const cells = [], builds = [], water = [], meta = {};
  SITES.forEach(s => { meta[s.id] = { cells:0, gx:0, gy:0, ax:0, ay:0 }; });

  for (let gy=-5; gy<GH+5; gy++) for (let gx=-9; gx<GW+9; gx++){
    if (onIsland(gx,gy)) continue;
    const d = Math.abs(gx-centerX(gy)) - halfWidth(gy);
    if (d>0 && d<8) water.push({ gx, gy, a:Math.max(0,1-d/8) });
  }

  for (let gy=0; gy<GH; gy++) for (let gx=0; gx<GW; gx++){
    if (!onIsland(gx,gy)) continue;
    const id = siteAt(gx,gy), park = id==='park';
    const road = !park && ((gx%3===0) || (gy%4===0) || Math.round(broadway(gy))===gx);
    cells.push({ gx, gy, id, road, park });
    const m = meta[id]; m.cells++; m.gx+=gx; m.gy+=gy;
    if (park || road) continue;
    const site = SITE_BY_ID[id];
    // a spine of towers down the middle of Midtown and the Financial District
    const spine = 1 - Math.min(1, Math.abs(gx-centerX(gy))/4.5);
    let h = (0.30 + hash2(gx,gy,3)*0.85 + spine*0.55) * site.hBase * 46;
    const ruined = hash2(gx,gy,9) < site.ruin;
    if (ruined) h *= 0.42;
    builds.push({ gx, gy, id, h:Math.max(7,h), ruined, lit:hash2(gx,gy,11)<0.36, roll:0 });
  }
  SITES.forEach(s => { const m = meta[s.id]; if (m.cells){ m.gx/=m.cells; m.gy/=m.cells; } });

  /* 🔴 THE FLIP ORDER — this is the feature, not a detail.
     Grip is NOT a tint over the district: it is the PERCENTAGE OF THAT
     DISTRICT'S BUILDINGS wearing the faction colour. `roll` is the order they
     flip in, and it is mostly noise but partly distance from the district's
     centre, so a faction grows outward from an epicentre with a ragged edge
     instead of a clean radius or a uniform wash. Losing a district then reads
     as blocks going out one at a time, which is the whole point. */
  builds.forEach(b => {
    const m = meta[b.id];
    b.roll = 0.62*hash2(b.gx,b.gy,21) + 0.38*Math.min(1, Math.hypot(b.gx-m.gx, b.gy-m.gy)/13);
  });
  SITES.forEach(s => {                       // normalise so grip% is exact
    const arr = builds.filter(b => b.id===s.id).sort((a,b)=>a.roll-b.roll);
    arr.forEach((b,i) => { b.roll = arr.length>1 ? i/(arr.length-1) : 0; });
  });

  const byCell = new Map();
  cells.forEach(c => byCell.set(c.gx+','+c.gy, c));
  water.sort((a,b)=>DEPTH(a.gx,a.gy)-DEPTH(b.gx,b.gy));
  cells.sort((a,b)=>DEPTH(a.gx,a.gy)-DEPTH(b.gx,b.gy));
  builds.sort((a,b)=>DEPTH(a.gx,a.gy)-DEPTH(b.gx,b.gy));

  // label anchor = the district's highest point on screen
  SITES.forEach(s => {
    const m = meta[s.id];
    let top = 1e9, tx = pX(m.gx,m.gy);
    builds.forEach(b => {
      if (b.id !== s.id) return;
      const t = pY(b.gx,b.gy) - b.h;
      if (t < top) { top = t; tx = pX(b.gx,b.gy); }
    });
    m.ax = (s.id === 'park') ? pX(m.gx,m.gy) : tx;
    m.ay = (top < 1e9) ? top : pY(m.gx,m.gy);
  });

  _city = { cells, builds, water, meta, byCell, GW, GH };
  return _city;
}

/* Screen-space bounds of the island, for fitting it to a canvas. */
export function bounds(){
  const { cells } = city();
  let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;
  cells.forEach(c => {
    for (const [a,b] of [[0,0],[1,0],[1,1],[0,1]]){
      const x = pX(c.gx+a,c.gy+b), y = pY(c.gx+a,c.gy+b);
      if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y;
    }
  });
  return { x0, x1, y0:y0-70, y1 };            // headroom for the towers
}
