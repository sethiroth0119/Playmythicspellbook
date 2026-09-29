(()=>{
 const nc=window.__nc,{renderer,scene,camera,THREE}=nc.three();
 const P=[],roads=[];
 for(const t of Object.values(nc.game.tiles)){if(!t.mesh)continue;P.push([t.mesh.position.x,t.mesh.position.z]);
   if(t.type==='road')roads.push({x:t.mesh.position.x,z:t.mesh.position.z});}
 const xs=P.map(p=>p[0]);const cz=(Math.min(...P.map(p=>p[1]))+Math.max(...P.map(p=>p[1])))/2;
 const cx=(Math.min(...xs)+Math.max(...xs))/2;
 const isPlot=t=>t&&t.type!=='road'&&t.type!=='anchor';
 const rows={};for(const r of roads)(rows[r.z.toFixed(2)]||=[]).push(r.x);
 let best=null;
 for(const z in rows){const xsr=rows[z].sort((a,b)=>a-b);let front=0;
  for(const t of Object.values(nc.game.tiles)){if(!t.mesh||!isPlot(t))continue;
   const d=Math.abs(t.mesh.position.z-+z);if(d<1.01&&d>.5)front++;}
  const score=front*2+xsr.length-Math.abs(+z-cz)*.5;if(!best||score>best.score)best={z:+z,xs:xsr,score};}
 let sn=0,sp=0;
 for(const t of Object.values(nc.game.tiles)){if(!t.mesh||!isPlot(t))continue;
  const d=t.mesh.position.z-best.z;if(Math.abs(Math.abs(d)-1)<.35){d<0?sn++:sp++;}}
 const SIDE=sp>=sn?1:-1;const R=best,fx=R.xs.length>4?R.xs[Math.min(R.xs.length-2,6)]:cx;
 camera.position.set(fx-2.0,.80,R.z-SIDE*.34);camera.lookAt(fx+.10,.02,R.z+SIDE*.50);camera.updateMatrixWorld(true);

 let win=null,seen=new Set();
 scene.traverse(o=>{const m=o.material;if(!m)return;(Array.isArray(m)?m:[m]).forEach(x=>{
   if(!x||seen.has(x))return;seen.add(x);
   if(x.emissive&&x.emissive.getHex()===0xffc978&&x.color.getHex()===0x1b2430)win=x;});});

 const gl=renderer.domElement,CW=gl.width,CH=gl.height;
 const s=document.createElement('canvas');s.width=CW;s.height=CH;
 const c=s.getContext('2d',{willReadFrequently:true});
 const shoot=()=>{renderer.render(scene,camera);c.clearRect(0,0,CW,CH);c.drawImage(gl,0,0,CW,CH);
   return c.getImageData(0,0,CW,CH).data;};

 __SKINLIB__

 // ---- glass mask via albedo black/white -------------------------------
 const oc=win.color.getHex();
 win.color.setHex(0x000000);win.needsUpdate=true;const K=shoot();
 win.color.setHex(0xffffff);win.needsUpdate=true;const Wt=shoot();
 win.color.setHex(oc);win.needsUpdate=true;
 const A=shoot();                                  // BEFORE (shipped today)
 const mask=new Uint8Array(CW*CH);let nm=0;
 for(let p=0,i=0;p<CW*CH;p++,i+=4){
   const d=Math.abs(Wt[i]-K[i])+Math.abs(Wt[i+1]-K[i+1])+Math.abs(Wt[i+2]-K[i+2]);
   if(d>25){mask[p]=1;nm++;} }
 // clusters
 const lab=new Int32Array(CW*CH).fill(-1),cl=[],st=[];
 for(let p0=0;p0<CW*CH;p0++){if(!mask[p0]||lab[p0]>=0)continue;
  const id=cl.length;st.length=0;st.push(p0);lab[p0]=id;
  let n=0,x0=1e9,x1=-1e9,y0=1e9,y1=-1e9,px=[];
  while(st.length){const p=st.pop();const x=p%CW,y=(p/CW)|0;n++;px.push(p);
   if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;
   if(x>0&&mask[p-1]&&lab[p-1]<0){lab[p-1]=id;st.push(p-1);}
   if(x<CW-1&&mask[p+1]&&lab[p+1]<0){lab[p+1]=id;st.push(p+1);}
   if(y>0&&mask[p-CW]&&lab[p-CW]<0){lab[p-CW]=id;st.push(p-CW);}
   if(y<CH-1&&mask[p+CW]&&lab[p+CW]<0){lab[p+CW]=id;st.push(p+CW);}}
  cl.push({id,n,x0,x1,y0,y1,px});}
 cl.sort((a,b)=>b.n-a.n);
 const erode=(px)=>{const set=new Set(px),keep=[];
  for(const p of px){const x=p%CW,y=(p/CW)|0;let ok=true;
   for(let dy=-2;dy<=2&&ok;dy++)for(let dx=-2;dx<=2;dx++){if(!set.has((y+dy)*CW+(x+dx))){ok=false;break;}}
   if(ok)keep.push(p);}return keep.length>=9?keep:px;};
 const stat=(b,px)=>{let r=0,g=0,bl=0;const n=px.length;
  for(const p of px){const i=p*4;r+=b[i];g+=b[i+1];bl+=b[i+2];}r/=n;g/=n;bl/=n;
  let v=0;for(const p of px){const i=p*4;v+=(b[i]-r)**2+(b[i+1]-g)**2+(b[i+2]-bl)**2;}
  const mx=Math.max(r,g,bl),mn=Math.min(r,g,bl);
  return{rgb:[Math.round(r),Math.round(g),Math.round(bl)],lum:+(.2126*r+.7152*g+.0722*bl).toFixed(1),
    chroma:+(mx-mn).toFixed(1),sd:+Math.sqrt(v/(3*n)).toFixed(2)};};
 // panes worth quoting: interior >= 40 px after erosion
 const panes=cl.filter(k=>k.n>=60).slice(0,40).map(k=>({k,in:erode(k.px)})).filter(o=>o.in.length>=40);

 const out={glassPx:nm,clusters:cl.length,panes:panes.length,variants:[]};
 out.before=panes.map(o=>stat(A,o.in));
 const CAND=__CAND__;
 for(const cand of CAND){
   const cv=_mkSkin(cand);
   const tex=new THREE.CanvasTexture(cv);
   tex.colorSpace=THREE.SRGBColorSpace;tex.wrapS=tex.wrapT=THREE.ClampToEdgeWrapping;
   tex.anisotropy=4;
   win.map=tex;win.color.setHex(cand.hex);win.needsUpdate=true;
   const B=shoot();
   out.variants.push({name:cand.name,hex:cand.hex.toString(16),
     stats:panes.map(o=>stat(B,o.in))});
   tex.dispose();
 }
 win.map=null;win.color.setHex(oc);win.needsUpdate=true;
 const Z=shoot();let ctl=0;for(let i=0;i<A.length;i+=4)if(A[i]!=Z[i]||A[i+1]!=Z[i+1]||A[i+2]!=Z[i+2])ctl++;
 out.control_px=ctl;
 out.boxes=panes.map(o=>[o.k.x0,o.k.y0,o.k.x1,o.k.y1,o.in.length]);
 return out;
})()
