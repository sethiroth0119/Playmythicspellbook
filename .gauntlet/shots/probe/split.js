(()=>{
 const nc=window.__nc,{renderer,scene,camera,THREE}=nc.three();
 // frontage framing, copied from panes.js
 const P=[],roads=[];
 for(const t of Object.values(nc.game.tiles)){if(!t.mesh)continue;P.push([t.mesh.position.x,t.mesh.position.z]);
   if(t.type==='road')roads.push({x:t.mesh.position.x,z:t.mesh.position.z});}
 const xs=P.map(p=>p[0]),zs=P.map(p=>p[1]);
 const box={x0:Math.min(...xs),x1:Math.max(...xs),z0:Math.min(...zs),z1:Math.max(...zs)};
 const cx=(box.x0+box.x1)/2,cz=(box.z0+box.z1)/2;
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
 // pane pixels = pixels that move when the whole material goes flat magenta
 const oc=win.color.getHex();
 const N=shoot();                                   // normal
 win.color.setHex(0x000000);win.needsUpdate=true;
 const K=shoot();                                   // diffuse killed => spec+ambient only
 win.color.setHex(0xffffff);win.needsUpdate=true;
 const Wt=shoot();                                  // diffuse maxed
 win.color.setHex(oc);win.needsUpdate=true;
 const N2=shoot();
 let ctl=0;for(let i=0;i<N.length;i+=4)if(N[i]!=N2[i]||N[i+1]!=N2[i+1]||N[i+2]!=N2[i+2])ctl++;
 // mask from the white-vs-black difference: those are the glass pixels
 const px=[];for(let p=0,i=0;p<CW*CH;p++,i+=4){
   const d=Math.abs(Wt[i]-K[i])+Math.abs(Wt[i+1]-K[i+1])+Math.abs(Wt[i+2]-K[i+2]);
   if(d>25)px.push(p);}
 const st=(b)=>{let r=0,g=0,bl=0;for(const p of px){const i=p*4;r+=b[i];g+=b[i+1];bl+=b[i+2];}
   const n=px.length;return[Math.round(r/n),Math.round(g/n),Math.round(bl/n)];};
 return{control_px:ctl,glassPx:px.length,normal:st(N),diffuseKilled:st(K),diffuseWhite:st(Wt)};
})()
