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
 const SKIN=win.map;
 // --- half/half orientation probe --------------------------------------
 const cv=document.createElement('canvas');cv.width=8;cv.height=32;const g2=cv.getContext('2d');
 g2.fillStyle='#fff';g2.fillRect(0,0,8,16);g2.fillStyle='#000';g2.fillRect(0,16,8,16);
 const tst=new THREE.CanvasTexture(cv);tst.colorSpace=THREE.SRGBColorSpace;
 tst.generateMipmaps=false;tst.minFilter=THREE.LinearFilter;
 win.map=tst;win.color.setHex(0xffffff);win.needsUpdate=true;const T=shoot();
 win.map=SKIN;win.color.setHex(0x3a4860);win.needsUpdate=true;const B=shoot();
 win.map=null;win.color.setHex(0x1b2430);win.needsUpdate=true;const A=shoot();
 win.map=SKIN;win.color.setHex(0x3a4860);win.needsUpdate=true;const B2=shoot();
 let ctl=0;for(let i=0;i<B.length;i+=4)if(B[i]!=B2[i])ctl++;
 // mask: glass = pixels where the test texture render differs a lot from A
 const mask=new Uint8Array(CW*CH);
 for(let p=0,i=0;p<CW*CH;p++,i+=4){const d=Math.abs(T[i]-A[i])+Math.abs(T[i+1]-A[i+1])+Math.abs(T[i+2]-A[i+2]);
   if(d>20)mask[p]=1;}
 const lab=new Int32Array(CW*CH).fill(-1),cl=[],st=[];
 for(let p0=0;p0<CW*CH;p0++){if(!mask[p0]||lab[p0]>=0)continue;
  const id=cl.length;st.length=0;st.push(p0);lab[p0]=id;let n=0,x0=1e9,x1=-1e9,y0=1e9,y1=-1e9,px=[];
  while(st.length){const p=st.pop();const x=p%CW,y=(p/CW)|0;n++;px.push(p);
   if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;
   if(x>0&&mask[p-1]&&lab[p-1]<0){lab[p-1]=id;st.push(p-1);}
   if(x<CW-1&&mask[p+1]&&lab[p+1]<0){lab[p+1]=id;st.push(p+1);}
   if(y>0&&mask[p-CW]&&lab[p-CW]<0){lab[p-CW]=id;st.push(p-CW);}
   if(y<CH-1&&mask[p+CW]&&lab[p+CW]<0){lab[p+CW]=id;st.push(p+CW);}}
  cl.push({n,x0,x1,y0,y1,px});}
 cl.sort((a,b)=>b.n-a.n);
 // orientation: for the 8 biggest clusters, mean lum of top half vs bottom half in T
 const lum=(b,p)=>.2126*b[p*4]+.7152*b[p*4+1]+.0722*b[p*4+2];
 const orient=cl.slice(0,8).map(k=>{const mid=(k.y0+k.y1)/2;let tl=0,tn=0,bl=0,bn=0;
   for(const p of k.px){const y=(p/CW)|0;if(y<mid){tl+=lum(T,p);tn++;}else{bl+=lum(T,p);bn++;}}
   return{box:[k.x0,k.y0,k.x1,k.y1],n:k.n,topLum:+(tl/tn).toFixed(1),botLum:+(bl/bn).toFixed(1)};});
 // wall brightness ranking, so crops land on a SUNLIT elevation
 const wallLum=k=>{let s=0,n=0;
   for(let y=Math.max(0,k.y0-6);y<=Math.min(CH-1,k.y1+6);y++)
    for(let x=Math.max(0,k.x0-6);x<=Math.min(CW-1,k.x1+6);x++){const p=y*CW+x;
      if(mask[p])continue;if(x>=k.x0-1&&x<=k.x1+1&&y>=k.y0-1&&y<=k.y1+1)continue;s+=lum(B,p);n++;}
   return n?s/n:0;};
 const cand=cl.filter(k=>k.n>=150).map(k=>({k,w:wallLum(k)}));
 cand.sort((a,b)=>b.w-a.w);
 const crop=(buf,k,z)=>{const w=k.x1-k.x0+11,h=k.y1-k.y0+11,x0=Math.max(0,k.x0-5),y0=Math.max(0,k.y0-5);
   const o=document.createElement('canvas');o.width=w*z;o.height=h*z;const o2=o.getContext('2d');
   o2.imageSmoothingEnabled=false;
   const tmp=document.createElement('canvas');tmp.width=w;tmp.height=h;const tc=tmp.getContext('2d');
   const id=tc.createImageData(w,h);
   for(let y=0;y<h;y++)for(let x=0;x<w;x++){const sp=((y0+y)*CW+(x0+x))*4,dp=(y*w+x)*4;
     id.data[dp]=buf[sp];id.data[dp+1]=buf[sp+1];id.data[dp+2]=buf[sp+2];id.data[dp+3]=255;}
   tc.putImageData(id,0,0);o2.drawImage(tmp,0,0,w*z,h*z);return o.toDataURL('image/png');};
 const full=b=>{const o=document.createElement('canvas');o.width=CW;o.height=CH;
   const oc=o.getContext('2d');const id=oc.createImageData(CW,CH);id.data.set(b);oc.putImageData(id,0,0);
   return o.toDataURL('image/png');};
 return{control_px:ctl,clusters:cl.length,orient,
  wallRange:cand.length?[+cand[cand.length-1].w.toFixed(1),+cand[0].w.toFixed(1)]:null,
  crops:cand.slice(0,4).map(o=>({box:[o.k.x0,o.k.y0,o.k.x1,o.k.y1],wall:+o.w.toFixed(1),
    before:crop(A,o.k,6),after:crop(B,o.k,6)})),
  fullAfter:full(B), fullBefore:full(A)};
})()
