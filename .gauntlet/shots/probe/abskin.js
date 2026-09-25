(()=>{
 const nc=window.__nc,{renderer,scene,camera,THREE}=nc.three();
 const FR=window.__FR||'frontage';
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
   if(!x||seen.has(x))return;seen.add(x);if(x.emissive&&x.emissive.getHex()===0xffc978)win=x;});});
 if(!win)return{err:'no winMat'};

 const gl=renderer.domElement,CW=gl.width,CH=gl.height;
 const s=document.createElement('canvas');s.width=CW;s.height=CH;
 const c=s.getContext('2d',{willReadFrequently:true});
 const shoot=()=>{renderer.render(scene,camera);c.clearRect(0,0,CW,CH);c.drawImage(gl,0,0,CW,CH);
   return c.getImageData(0,0,CW,CH).data;};

 // ── COST, all reads taken together before any capture (README layer-ab rule)
 const cost=()=>{renderer.info.reset();renderer.render(scene,camera);
   return{tri:renderer.info.render.triangles,calls:renderer.info.render.calls,
          textures:renderer.info.memory.textures,geometries:renderer.info.memory.geometries,
          programs:renderer.info.programs.length};};
 const time=(n)=>{for(let i=0;i<6;i++)renderer.render(scene,camera);
   const t0=performance.now();for(let i=0;i<n;i++)renderer.render(scene,camera);
   return (performance.now()-t0)/n;};
 const TEX=win.map;
 const skinOn =()=>{win.map=TEX; win.color.setHex(0x3a4860);win.needsUpdate=true;};
 const skinOff=()=>{win.map=null;win.color.setHex(0x1b2430);win.needsUpdate=true;};
 skinOn(); const cOn=cost();   skinOff(); const cOff=cost();  skinOn(); const cOn2=cost();
 skinOn(); const tOn=time(24); skinOff(); const tOff=time(24); skinOn(); const tOn2=time(24);

 // ── glass mask via albedo black/white, with the skin OFF (identical to the
 //    round-15 baseline probe) so the pane set is the same set both ways.
 skinOff();
 const oc=win.color.getHex();
 win.color.setHex(0x000000);win.needsUpdate=true;const K=shoot();
 win.color.setHex(0xffffff);win.needsUpdate=true;const Wt=shoot();
 win.color.setHex(oc);win.needsUpdate=true;
 const A=shoot();                       // BEFORE — round 15 material exactly
 skinOn();
 const B=shoot();                       // AFTER
 const C=shoot();                       // control, B vs C must be 0
 let ctl=0,chg=0;
 for(let i=0;i<B.length;i+=4){
   if(B[i]!=C[i]||B[i+1]!=C[i+1]||B[i+2]!=C[i+2])ctl++;
   if(Math.abs(A[i]-B[i])+Math.abs(A[i+1]-B[i+1])+Math.abs(A[i+2]-B[i+2])>6)chg++; }

 const mask=new Uint8Array(CW*CH);let nm=0;
 for(let p=0,i=0;p<CW*CH;p++,i+=4){
   const d=Math.abs(Wt[i]-K[i])+Math.abs(Wt[i+1]-K[i+1])+Math.abs(Wt[i+2]-K[i+2]);
   if(d>25){mask[p]=1;nm++;}}
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
  cl.push({n,x0,x1,y0,y1,px});}
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
 const panes=cl.filter(k=>k.n>=60).slice(0,40).map(k=>({k,in:erode(k.px)})).filter(o=>o.in.length>=40);
 const before=panes.map(o=>stat(A,o.in)), after=panes.map(o=>stat(B,o.in));
 const keep=before.map((r,i)=>r.sd<5?i:-1).filter(i=>i>=0);
 const mean=(rows,k)=>+(keep.reduce((a,i)=>a+rows[i][k],0)/keep.length).toFixed(2);

 // ── crops for the eye: the widest pane group, 4x nearest-neighbour
 const crop=(buf,k,z)=>{const w=k.x1-k.x0+9,h=k.y1-k.y0+9,x0=Math.max(0,k.x0-4),y0=Math.max(0,k.y0-4);
   const o=document.createElement('canvas');o.width=w*z;o.height=h*z;const oc2=o.getContext('2d');
   oc2.imageSmoothingEnabled=false;
   const tmp=document.createElement('canvas');tmp.width=w;tmp.height=h;
   const tc=tmp.getContext('2d');const id=tc.createImageData(w,h);
   for(let y=0;y<h;y++)for(let x=0;x<w;x++){const sp=((y0+y)*CW+(x0+x))*4,dp=(y*w+x)*4;
     id.data[dp]=buf[sp];id.data[dp+1]=buf[sp+1];id.data[dp+2]=buf[sp+2];id.data[dp+3]=255;}
   tc.putImageData(id,0,0);oc2.drawImage(tmp,0,0,w*z,h*z);return o.toDataURL('image/png');};
 const big=cl.filter(k=>k.n>=200).slice(0,3);
 return{control_px:ctl, changedPx:chg, totalPx:CW*CH,
  pct:+(chg/(CW*CH)*100).toFixed(3),
  glassPx:nm, panes:panes.length, pairedPanes:keep.length,
  sd:{before:mean(before,'sd'),after:mean(after,'sd')},
  lum:{before:mean(before,'lum'),after:mean(after,'lum')},
  chroma:{before:mean(before,'chroma'),after:mean(after,'chroma')},
  perPaneSdBefore:keep.map(i=>before[i].sd),perPaneSdAfter:keep.map(i=>after[i].sd),
  perPaneChrBefore:keep.map(i=>before[i].chroma),perPaneChrAfter:keep.map(i=>after[i].chroma),
  cost:{on:cOn,off:cOff,on2:cOn2},
  ms:{on:+tOn.toFixed(2),off:+tOff.toFixed(2),on2:+tOn2.toFixed(2)},
  crops:big.map((k,i)=>({box:[k.x0,k.y0,k.x1,k.y1],before:crop(A,k,4),after:crop(B,k,4)}))};
})()
