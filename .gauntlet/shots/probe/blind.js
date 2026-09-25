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
   if(!x||seen.has(x))return;seen.add(x);if(x.emissive&&x.emissive.getHex()===0xffc978)win=x;});});
 const gl=renderer.domElement,CW=gl.width,CH=gl.height;
 const s=document.createElement('canvas');s.width=CW;s.height=CH;
 const c=s.getContext('2d',{willReadFrequently:true});
 const shoot=()=>{renderer.render(scene,camera);c.clearRect(0,0,CW,CH);c.drawImage(gl,0,0,CW,CH);
   return c.getImageData(0,0,CW,CH).data;};
 const mk=(o)=>{const W=16,H=32,cv=document.createElement('canvas');cv.width=W;cv.height=H;
   const g=cv.getContext('2d');const grd=g.createLinearGradient(0,0,0,H);
   for(const[t,v]of o.stops){const b=Math.round(v*255);grd.addColorStop(t,'rgb('+b+','+b+','+b+')');}
   g.fillStyle=grd;g.fillRect(0,0,W,H);
   if(o.blind>0){g.globalCompositeOperation='lighten';const b=Math.round(o.blind*255);
     g.fillStyle='rgb('+b+','+b+','+b+')';g.fillRect(0,0,Math.round(W*.26),H);
     g.globalCompositeOperation='source-over';}
   const t=new THREE.CanvasTexture(cv);t.colorSpace=THREE.SRGBColorSpace;
   t.wrapS=t.wrapT=THREE.ClampToEdgeWrapping;t.anisotropy=4;return t;};
 const S=(b1,iv,fl)=>[[0,.28],[.04,1],[b1,1],[b1+.16,iv+.05],[b1+.22,iv],[.80,iv],[.83,fl],[.90,fl],[.93,.16],[1,.16]];
 const VAR=[
  {n:'shipped',    hex:0x3a4860,stops:S(.22,.13,.50),blind:.42},
  {n:'noblind',    hex:0x3a4860,stops:S(.22,.13,.50),blind:0},
  {n:'lifted iv17',hex:0x384660,stops:S(.22,.17,.50),blind:.42},
  {n:'band .28',   hex:0x374559,stops:S(.28,.13,.50),blind:.42},
 ];
 // crop box: the sunlit four-light window found in the orient run
 const K={x0:592,y0:97,x1:622,y1:138};
 const crop=(buf,k,z)=>{const w=k.x1-k.x0+11,h=k.y1-k.y0+11,x0=Math.max(0,k.x0-5),y0=Math.max(0,k.y0-5);
   const o=document.createElement('canvas');o.width=w*z;o.height=h*z;const o2=o.getContext('2d');
   o2.imageSmoothingEnabled=false;
   const tmp=document.createElement('canvas');tmp.width=w;tmp.height=h;const tc=tmp.getContext('2d');
   const id=tc.createImageData(w,h);
   for(let y=0;y<h;y++)for(let x=0;x<w;x++){const sp=((y0+y)*CW+(x0+x))*4,dp=(y*w+x)*4;
     id.data[dp]=buf[sp];id.data[dp+1]=buf[sp+1];id.data[dp+2]=buf[sp+2];id.data[dp+3]=255;}
   tc.putImageData(id,0,0);o2.drawImage(tmp,0,0,w*z,h*z);return o.toDataURL('image/png');};
 const out=[];
 for(const v of VAR){const t=mk(v);win.map=t;win.color.setHex(v.hex);win.needsUpdate=true;
   out.push({n:v.n,img:crop(shoot(),K,7)});t.dispose();}
 return{variants:out};
})()
