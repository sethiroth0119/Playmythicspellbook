/* ══ THE WILD-GROUND REBUILD BENCH ═════════════════════════════════════════
   /src/wild's build() in node, no browser — the same argument
   check-streets-clock.mjs makes for traffic.js. refresh() runs from
   manageAgents(), so a rebuild that overruns a frame is felt every time the
   player lays a road, and answering "which line is it" needs a CPU profile
   rather than a screenshot. A browser boot is ~2.5 minutes and its profile is
   buried under SwiftShader; this is 2 seconds and profiles clean:

       node --cpu-prof --cpu-prof-dir=/tmp/prof .gauntlet/wildbench.mjs 200

   ⚠ THE ctx BELOW REPRODUCES node-city's hfield / mfield / rampAt ARITHMETIC,
     character for character. It is a COST model, not a correctness one: the
     numbers it returns are only meaningful because the host callbacks cost
     what the real ones cost. If index.html's field ever changes, this file is
     wrong until it is changed with it — which is why nothing here is a gate.
   ⚠ AND THE TILE MAP IS AN APPROXIMATION of .gauntlet/scene.js's district (the
     road cross, the housing blocks, the depots). Absolute figures differ a
     little from the browser's; the A/B between two versions of the module does
     not, which is what it is for.

   Usage: node .gauntlet/wildbench.mjs [iterations] [path to a module to bench]
          EMPTY=1 …  benches a brand-new 576-tile map instead.
   ══════════════════════════════════════════════════════════════════════════ */
import * as THREE from './package/build/three.module.js';
const M = await import(process.argv[3]||'../public/src/wild/index.js');

const GRID = 24, HALF = 12, AMP = .009;
const hash = (x, z, s) => { let h = (Math.imul(x|0,0x27d4eb2d) ^ Math.imul(z|0,0x165667b1) ^ s)>>>0;
  h = (h||0x9e3779b9)>>>0; h^=h<<13;h>>>=0;h^=h>>>17;h^=h<<5;h>>>=0; return h/4294967296; };
const vnoise = (x,z,f,s) => { const px=x*f,pz=z*f,X=Math.floor(px),Z=Math.floor(pz);
  const fx=px-X,fz=pz-Z,sx=fx*fx*(3-2*fx),sz=fz*fz*(3-2*fz);
  const a=hash(X,Z,s),b=hash(X+1,Z,s),c=hash(X,Z+1,s),d=hash(X+1,Z+1,s);
  const t=a+(b-a)*sx,u=c+(d-c)*sx; return t+(u-t)*sz; };
const clamp01=v=>v<0?0:v>1?1:v;
const hfield=(u,w)=>vnoise(u,w,.055,0xc2b2ae35)*.38+vnoise(u,w,.150,0x9e3779b9)*.35+vnoise(u,w,.420,0x85ebca6b)*.27;
const mfield=(u,w)=>vnoise(u+37.7,w-11.3,.085,0x51ab4c9d)*.66+vnoise(u-5.1,w+21.9,.230,0x2f6ec371)*.34;
const DRY=[0x706c58,0x888361,0xa09b73,0xb8b287], GRN=[0x577042,0x69844e,0x7d9b5d,0x91b26b];
const mk=a=>a.map(h=>new THREE.Color().setHex(h));
const DR=mk(DRY), GR=mk(GRN), cE=new THREE.Color().setHex(0x8a9464);
const rampAt=(R,t,out,tmp)=>{const i=Math.max(0,Math.min(R.length-2,Math.floor(t)));
  out.copy(R[i]); tmp.copy(R[i+1]); out.lerp(tmp, clamp01(t-i)); return out;};
const sA=new THREE.Color(),sB=new THREE.Color(),sT=new THREE.Color();
const groundAt=(wx,wz,out)=>{const o=out||sA;const u=wx+HALF,w=wz+HALF;
  const H=hfield(u,w),Mo=mfield(u,w);const t=clamp01(.5+(H-.5)*1.75)*(DR.length-1);
  rampAt(DR,t,o,sT); rampAt(GR,t,sB,sT); o.lerp(sB,clamp01(.38+(Mo-.5)*2.2-(H-.5)*.9));
  const d=Math.max(Math.abs(wx),Math.abs(wz))/HALF; if(d>.86)o.lerp(cE,Math.min(1,(d-.86)/.14)); return o;};
const terrainAt=(wx,wz)=>{const u=wx+HALF,w=wz+HALF;const H=hfield(u,w),Mo=mfield(u,w);
  const d=Math.max(Math.abs(wx),Math.abs(wz))/HALF;const fade=d>.86?Math.min(1,(d-.86)/.14):0;
  return {h:H,m:Mo,y:(H-.5)*2*AMP*(1-fade)};};

/* the standard district's tile map, close enough for a cost profile: the road
   cross plus the housing blocks scene.js places. */
const tiles={}; const C=12;
const put=(x,z,t)=>{ if(x>=0&&z>=0&&x<GRID&&z<GRID) tiles[x+','+z]={type:t}; };
for(const r of [C-8,C-4,C,C+4,C+8]) for(let i=C-9;i<=C+9;i++){ put(i,r,'road'); put(r,i,'road'); }
for(const [x0,z0] of [[C-7,C-7],[C-3,C-7],[C+1,C-7],[C-7,C-3],[C-3,C-3],[C-7,C+1]])
  for(let a=0;a<3;a++)for(let b=0;b<3;b++) put(x0+a,z0+b,'housing');
for(const [x,z] of [[C+7,C+7],[C+8,C+7],[C+7,C+8],[C+8,C+8],[C+9,C+7],[C+9,C+8],[C+1,C+1],[C+2,C+1],[C+3,C+1]]) put(x,z,'depot');

if (process.env.EMPTY) for (const k in tiles) delete tiles[k];
const scene=new THREE.Group();
const api=M.mount({ THREE, scene, game:{tiles}, GRID, HALF,
  isRoad:(x,z)=>{const t=tiles[x+','+z];return !!t&&t.type==='road';},
  groundMat:new THREE.MeshLambertMaterial(), propMat:new THREE.MeshLambertMaterial(),
  texDiv:0.83, grainPer:3.71, roadApron:0.150, groundAt, terrainAt });
const N=+(process.argv[2]||40);
const t=[]; let flip=0;
for(let i=0;i<N;i++){ flip^=1; if(flip) tiles['23,23']={type:'road'}; else delete tiles['23,23'];
  const t0=process.hrtime.bigint(); api.refresh(); t.push(Number(process.hrtime.bigint()-t0)/1e6); }
t.sort((a,b)=>a-b);
console.log(JSON.stringify({ first:+t[0].toFixed(2), median:+t[(N/2)|0].toFixed(2),
  worst:+t[N-1].toFixed(2), stats:api.stats() }));
