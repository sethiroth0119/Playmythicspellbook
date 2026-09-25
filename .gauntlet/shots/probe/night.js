(()=>{
 const nc=window.__nc,{renderer,scene,camera,THREE}=nc.three();
 const P=[],roads=[];let V=null;
 for(const t of Object.values(nc.game.tiles)){if(!t.mesh)continue;P.push([t.mesh.position.x,t.mesh.position.z]);
   if(t.type==='road')roads.push({x:t.mesh.position.x,z:t.mesh.position.z});
   if(t.type==='arena'&&!V){const a=((t.rot|0)&3)*Math.PI/2;
     V={x:t.mesh.position.x,z:t.mesh.position.z,fx:Math.sin(a),fz:Math.cos(a)};}}
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
 const FR={cam:[fx-2.0,.80,R.z-SIDE*.34],tgt:[fx+.10,.02,R.z+SIDE*.50]};
 const VE=V?{cam:[V.x+V.fx*2.35+V.fz*1.45,1.30,V.z+V.fz*2.35-V.fx*1.45],tgt:[V.x,.26,V.z]}:FR;
 let win=null,seen=new Set();
 scene.traverse(o=>{const m=o.material;if(!m)return;(Array.isArray(m)?m:[m]).forEach(x=>{
   if(!x||seen.has(x))return;seen.add(x);if(x.emissive&&x.emissive.getHex()===0xffc978)win=x;});});
 const gl=renderer.domElement,CW=gl.width,CH=gl.height;
 const s=document.createElement('canvas');s.width=CW;s.height=CH;
 const c=s.getContext('2d',{willReadFrequently:true});
 const aim=f=>{camera.position.set(f.cam[0],f.cam[1],f.cam[2]);
   camera.lookAt(f.tgt[0],f.tgt[1],f.tgt[2]);camera.updateMatrixWorld(true);};
 const shoot=()=>{renderer.render(scene,camera);c.clearRect(0,0,CW,CH);c.drawImage(gl,0,0,CW,CH);
   return c.getImageData(0,0,CW,CH).data;};
 const full=b=>{const o=document.createElement('canvas');o.width=CW;o.height=CH;
   const oc=o.getContext('2d');const id=oc.createImageData(CW,CH);id.data.set(b);oc.putImageData(id,0,0);
   return o.toDataURL('image/jpeg',.82);};
 const TEX=win.map;
 const on =()=>{win.map=TEX; win.color.setHex(0x3a4860);win.needsUpdate=true;};
 const off=()=>{win.map=null;win.color.setHex(0x1b2430);win.needsUpdate=true;};
 const out={emissiveIntensity:win.emissiveIntensity,hourFrames:{}};
 for(const [nm,f] of [['frontage',FR],['venue',VE]]){
   aim(f);
   off();const A=shoot(); on();const B=shoot(); const C=shoot();
   let ctl=0,chg=0,dsum=0;
   for(let i=0;i<A.length;i+=4){ if(B[i]!=C[i]||B[i+1]!=C[i+1]||B[i+2]!=C[i+2])ctl++;
     const d=Math.abs(A[i]-B[i])+Math.abs(A[i+1]-B[i+1])+Math.abs(A[i+2]-B[i+2]);
     if(d>6)chg++; dsum+=d/3;}
   out.hourFrames[nm]={control_px:ctl,changedPx:chg,pct:+(chg/(CW*CH)*100).toFixed(3),
     meanDelta:+(dsum/(CW*CH)).toFixed(3), before:full(A), after:full(B)};
 }
 return out;
})()
