(()=>{
 const nc = window.__nc, { renderer, scene, camera, THREE } = nc.three();
 // ── reproduce capture.mjs's `frontage` framing exactly ────────────────────
 const P=[], roads=[];
 for (const t of Object.values(nc.game.tiles)) { if(!t.mesh) continue;
   P.push([t.mesh.position.x,t.mesh.position.z]);
   if(t.type==='road') roads.push({x:t.mesh.position.x,z:t.mesh.position.z}); }
 const xs=P.map(p=>p[0]), zs=P.map(p=>p[1]);
 const box={x0:Math.min(...xs),x1:Math.max(...xs),z0:Math.min(...zs),z1:Math.max(...zs)};
 const cx=(box.x0+box.x1)/2, cz=(box.z0+box.z1)/2;
 const isPlot=t=>t&&t.type!=='road'&&t.type!=='anchor';
 const rows={}; for(const r of roads) (rows[r.z.toFixed(2)] ||= []).push(r.x);
 let best=null;
 for(const z in rows){ const xsr=rows[z].sort((a,b)=>a-b); let front=0;
   for(const t of Object.values(nc.game.tiles)){ if(!t.mesh||!isPlot(t)) continue;
     const d=Math.abs(t.mesh.position.z-+z); if(d<1.01&&d>.5) front++; }
   const score=front*2+xsr.length-Math.abs(+z-cz)*.5;
   if(!best||score>best.score) best={z:+z,xs:xsr,score}; }
 let sn=0,sp=0;
 for(const t of Object.values(nc.game.tiles)){ if(!t.mesh||!isPlot(t)) continue;
   const d=t.mesh.position.z-best.z; if(Math.abs(Math.abs(d)-1)<.35){ d<0?sn++:sp++; } }
 const SIDE = sp>=sn?1:-1;
 const R=best, fx = R.xs.length>4 ? R.xs[Math.min(R.xs.length-2,6)] : cx;
 const cam=[fx-2.0,.80,R.z-SIDE*.34], tgt=[fx+.10,.02,R.z+SIDE*.50];
 camera.position.set(cam[0],cam[1],cam[2]); camera.lookAt(tgt[0],tgt[1],tgt[2]);
 camera.updateMatrixWorld(true);

 // ── find winMat by identity: the shared window material ───────────────────
 let win=null, metal=null, paint=null, veh=null;
 const seen=new Set();
 scene.traverse(o=>{ const m=o.material; if(!m) return; (Array.isArray(m)?m:[m]).forEach(x=>{
   if(!x||seen.has(x)) return; seen.add(x);
   if(x.emissive && x.emissive.getHex()===0xffc978) win=x;
   if(x.emissive && x.emissive.getHex()===0x4a6076) veh=x; }); });

 const gl=renderer.domElement, CW=gl.width, CH=gl.height;
 const s=document.createElement('canvas'); s.width=CW; s.height=CH;
 const c=s.getContext('2d',{willReadFrequently:true});
 const shoot=()=>{ renderer.render(scene,camera); c.clearRect(0,0,CW,CH); c.drawImage(gl,0,0,CW,CH);
                   return c.getImageData(0,0,CW,CH).data; };

 // A = the round-13 material exactly: matte, no reflection.
 const nEnv=win.envMap, nRough=win.roughness;
 win.envMap=null; win.roughness=.6; win.needsUpdate=true;
 const A=shoot();
 win.envMap=nEnv; win.roughness=nRough; win.needsUpdate=true;
 const B=shoot();
 const C=shoot();                       // control: B vs C must be 0

 let ctl=0; for(let i=0;i<B.length;i+=4) if(Math.abs(B[i]-C[i])+Math.abs(B[i+1]-C[i+1])+Math.abs(B[i+2]-C[i+2])>0) ctl++;

 // ── panes = connected clusters of pixels the window material moved ────────
 const mask=new Uint8Array(CW*CH);
 for(let p=0,i=0;p<CW*CH;p++,i+=4){
   const d=Math.abs(A[i]-B[i])+Math.abs(A[i+1]-B[i+1])+Math.abs(A[i+2]-B[i+2]);
   if(d>10) mask[p]=1; }
 const lab=new Int32Array(CW*CH).fill(-1); const cl=[]; const st=[];
 for(let p0=0;p0<CW*CH;p0++){ if(!mask[p0]||lab[p0]>=0) continue;
   const id=cl.length; st.length=0; st.push(p0); lab[p0]=id;
   let n=0,sx=0,sy=0,x0=1e9,x1=-1e9,y0=1e9,y1=-1e9, px=[];
   while(st.length){ const p=st.pop(); const x=p%CW, y=(p/CW)|0;
     n++; sx+=x; sy+=y; if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; px.push(p);
     if(x>0&&mask[p-1]&&lab[p-1]<0){lab[p-1]=id;st.push(p-1);}
     if(x<CW-1&&mask[p+1]&&lab[p+1]<0){lab[p+1]=id;st.push(p+1);}
     if(y>0&&mask[p-CW]&&lab[p-CW]<0){lab[p-CW]=id;st.push(p-CW);}
     if(y<CH-1&&mask[p+CW]&&lab[p+CW]<0){lab[p+CW]=id;st.push(p+CW);} }
   cl.push({id,n,cx:sx/n,cy:sy/n,x0,x1,y0,y1,px}); }
 cl.sort((a,b)=>b.n-a.n);

 const stat=(buf,px)=>{ let r=0,g=0,b=0,n=px.length, rr=[],gg=[],bb=[];
   for(const p of px){ const i=p*4; r+=buf[i]; g+=buf[i+1]; b+=buf[i+2]; rr.push(buf[i]); gg.push(buf[i+1]); bb.push(buf[i+2]); }
   r/=n; g/=n; b/=n;
   let vr=0; for(const p of px){ const i=p*4; vr+=(buf[i]-r)**2+(buf[i+1]-g)**2+(buf[i+2]-b)**2; }
   const lum=.2126*r+.7152*g+.0722*b;
   const mx=Math.max(r,g,b), mn=Math.min(r,g,b);
   return { rgb:[Math.round(r),Math.round(g),Math.round(b)], lum:+lum.toFixed(1),
            chroma:+(mx-mn).toFixed(1), sd:+Math.sqrt(vr/(3*n)).toFixed(2),
            min:[Math.min(...rr),Math.min(...gg),Math.min(...bb)], max:[Math.max(...rr),Math.max(...gg),Math.max(...bb)] }; };
 // the wall a pane sits in: a 3px ring outside the cluster bbox, unchanged pixels only
 const wall=(buf,k)=>{ const px=[];
   for(let y=Math.max(0,k.y0-4);y<=Math.min(CH-1,k.y1+4);y++)
     for(let x=Math.max(0,k.x0-4);x<=Math.min(CW-1,k.x1+4);x++){
       const p=y*CW+x; if(mask[p]) continue;
       if(x>=k.x0-1&&x<=k.x1+1&&y>=k.y0-1&&y<=k.y1+1) continue; px.push(p); }
   return px.length? stat(buf,px) : null; };

 // THE CRITIC MEASURED A SUNLIT FACADE (wall luminance 212.8), so rank the
 // panes by the brightness of the wall they are cut into, not by pixel count.
 const cand = cl.filter(k=>k.n>=25).map(k=>({k, w:wall(B,k)})).filter(o=>o.w);
 cand.sort((a,b)=>b.w.lum-a.w.lum);
 // INTERIOR only: erode 2 px so mullions, reveals and the antialiased pane edge
 // are not counted. "Zero variance inside a pane" is a claim about the GLASS.
 const erode=(px)=>{ const set=new Set(px); const keep=[];
   for(const p of px){ const x=p%CW,y=(p/CW)|0; let ok=true;
     for(let dy=-2;dy<=2&&ok;dy++) for(let dx=-2;dx<=2;dx++){
       if(!set.has((y+dy)*CW+(x+dx))){ ok=false; break; } }
     if(ok) keep.push(p); }
   return keep.length>=9?keep:px; };
 const mk = o=>{ const in_=erode(o.k.px); return { n:o.k.n, nInterior:in_.length,
   box:[o.k.x0,o.k.y0,o.k.x1,o.k.y1],
   before:stat(A,in_), after:stat(B,in_), wall:o.w,
   paneVsWallBefore:+(stat(A,in_).lum/o.w.lum*100).toFixed(1),
   paneVsWallAfter:+(stat(B,in_).lum/o.w.lum*100).toFixed(1) }; };
 return { control_px_changed: ctl, framing:{cam,tgt,road:R.z,side:SIDE},
          clusters: cl.length, changedPx: mask.reduce((a,b)=>a+b,0),
          totalPx: CW*CH,
          sunlit: cand.slice(0,6).map(mk),
          biggest: cl.filter(k=>k.n>=25).slice(0,3).map(k=>mk({k,w:wall(B,k)})),
          wallLumRange: cand.length?[cand[cand.length-1].w.lum, cand[0].w.lum]:null,
          skyEnv: nc.skyEnv() };
})()
