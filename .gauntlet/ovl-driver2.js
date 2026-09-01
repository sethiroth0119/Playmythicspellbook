(() => {
const nc = window.__nc;
const { renderer, scene, camera, THREE } = nc.three();
const out = { images: {}, };

/* frame the aerial from the placed meshes (capture.mjs's own derivation) */
const box = { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 };
for (const t of Object.values(nc.game.tiles)) { if (!t.mesh) continue; const p = t.mesh.position;
  box.x0 = Math.min(box.x0, p.x); box.x1 = Math.max(box.x1, p.x);
  box.z0 = Math.min(box.z0, p.z); box.z1 = Math.max(box.z1, p.z); }
const cx = (box.x0 + box.x1) / 2, cz = (box.z0 + box.z1) / 2;
const span = Math.max(box.x1 - box.x0, box.z1 - box.z0);
try { const c = nc.controls; c.maxPolarAngle = Math.PI * .4995; c.minDistance = .05; c.enableDamping = false; } catch (e) {}
camera.position.set(cx + span * .62, span * .55, cz + span * .62);
try { nc.controls.target.set(cx, 0, cz); } catch (e) {}
camera.lookAt(cx, 0, cz);
camera.updateMatrixWorld(); camera.updateProjectionMatrix();
try { nc.cullAgents(90); } catch (e) {}

/* the five flat data planes */
const planes = [];
scene.traverse(o => { if (o.isMesh && o.material && o.material.map && o.geometry &&
  o.geometry.type === 'PlaneGeometry' && Math.abs(o.rotation.x + Math.PI/2) < .01 && o.position.y < 1) planes.push(o); });
const at = y => planes.find(p => Math.abs(p.position.y - y) < 1e-3);
const lv = at(0.105), wt = at(0.075);

const gl = renderer.domElement, CW = gl.width, CH = gl.height;
const scratch = document.createElement('canvas'); scratch.width = CW; scratch.height = CH;
const sctx = scratch.getContext('2d', { willReadFrequently: true });
const shoot = () => { renderer.render(scene, camera); sctx.clearRect(0,0,CW,CH); sctx.drawImage(gl,0,0,CW,CH); return sctx.getImageData(0,0,CW,CH); };
function diff(a,b,r){ let n=0,tot=0,sum=0,mx=0;
  for(let y=r.y0;y<r.y1;y++)for(let x=r.x0;x<r.x1;x++){const i=(y*CW+x)*4;
    const d=Math.abs(a.data[i]-b.data[i])+Math.abs(a.data[i+1]-b.data[i+1])+Math.abs(a.data[i+2]-b.data[i+2]);
    tot++;sum+=d;if(d>12)n++;if(d>mx)mx=d;}
  return {changed:n,of:tot,pct:+(100*n/tot).toFixed(2),meanDelta:+(sum/tot).toFixed(2),maxDelta:mx}; }
function png(img,r){ const w=r.x1-r.x0,h=r.y1-r.y0;
  const s=document.createElement('canvas'); s.width=CW; s.height=CH; s.getContext('2d').putImageData(img,0,0);
  const c=document.createElement('canvas'); c.width=w; c.height=h;
  c.getContext('2d').drawImage(s,r.x0,r.y0,w,h,0,0,w,h); return c.toDataURL('image/png'); }

const HALF=12, v=new THREE.Vector3();
const proj=(tx,tz)=>{v.set(tx-HALF+.5,0.105,tz-HALF+.5).project(camera);
  return {x:Math.round((v.x*.5+.5)*CW), y:Math.round((-v.y*.5+.5)*CH)};};
const tiles=[]; for(let tz=3;tz<21;tz++)for(let tx=3;tx<21;tx++)tiles.push([tx,tz]);
let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;
for(const[tx,tz]of tiles){const p=proj(tx,tz);x0=Math.min(x0,p.x);x1=Math.max(x1,p.x);y0=Math.min(y0,p.y);y1=Math.max(y1,p.y);}
const district={x0:Math.max(0,x0-8),x1:Math.min(CW,x1+8),y0:Math.max(0,y0-8),y1:Math.min(CH,y1+8)};

/* 🔴 §5 of the README, taken literally: a 2x2 block of tiles the player can see
   that has NOTHING built on it, projected through THIS camera, near frame
   centre so the crop is all ground and no sky. */
let best=null;
for(let tz=4;tz<20;tz++)for(let tx=4;tx<20;tx++){
  let free=true; for(const[dx,dz]of[[0,0],[1,0],[0,1],[1,1]]) if(nc.game.tiles[(tx+dx)+','+(tz+dz)]) free=false;
  if(!free)continue;
  const p=proj(tx+.5,tz+.5);
  if(p.x<250||p.x>CW-250||p.y<300||p.y>CH-120)continue;
  const d=Math.hypot(p.x-CW/2,p.y-CH*.62);
  if(!best||d<best.d)best={d,tx,tz,p};
}
const tight = best ? {x0:best.p.x-130,x1:best.p.x+130,y0:best.p.y-90,y1:best.p.y+90} : district;
out.tightTile = best ? [best.tx,best.tz] : null;
out.rects = {district, tight};

/* ── clean A/B: every data plane off, then ONE on ─────────────────────────── */
function ab(name, plane, openFn){
  const r={};
  for(const p of planes) p.visible=false;
  try{openFn();}catch(e){r.openErr=String(e);}
  for(const p of planes) if(p!==plane) p.visible=false;   // openPanel may show only its own
  plane.visible=true;
  const A=shoot();
  plane.visible=false;
  const B=shoot();
  const C=shoot();                                        // do-nothing control
  r.district=diff(A,B,district); r.tight=diff(A,B,tight);
  r.control=diff(B,C,district); r.controlTight=diff(B,C,tight);
  out.images[name+'-on']=png(A,district); out.images[name+'-off']=png(B,district);
  out.images[name+'-on-tight']=png(A,tight); out.images[name+'-off-tight']=png(B,tight);
  return r;
}
out.lv    = ab('lv',    lv, () => nc.landValuePanel(true));
out.water = ab('water', wt, () => nc.waterPanel(true));

/* how often does rAF actually fire here? the README says never; capture.mjs
   says ~1 Hz. It decides whether a naive screenshot A/B is rescued by animate(). */
out.rafProbe = 'pending';
for(const p of planes) p.visible=false;
try{ nc.landValuePanel(true); }catch(e){}
renderer.render(scene,camera);
return out;
})()
