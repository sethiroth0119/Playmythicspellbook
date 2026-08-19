(()=>{
 const nc=window.__nc,{scene}=nc.three();
 let win=null,seen=new Set();
 scene.traverse(o=>{const m=o.material;if(!m)return;(Array.isArray(m)?m:[m]).forEach(x=>{
   if(!x||seen.has(x))return;seen.add(x);
   if(x.emissive&&x.emissive.getHex()===0xffc978&&x.color.getHex()===0x1b2430)win=x;});});
 if(!win)return{err:'winMat not found'};
 const rows=[];let tot=0,totTri=0;
 scene.traverse(o=>{
   if(!o.isMesh)return;const ms=Array.isArray(o.material)?o.material:[o.material];
   if(!ms.includes(win))return;
   const g=o.geometry,uv=g.attributes.uv;
   const tri=(g.index?g.index.count:g.attributes.position.count)/3;
   tot++;totTri+=tri;
   let u0=1e9,u1=-1e9,v0=1e9,v1=-1e9,nOut=0;
   if(uv){const a=uv.array;for(let i=0;i<a.length;i+=2){const u=a[i],v=a[i+1];
     if(u<u0)u0=u;if(u>u1)u1=u;if(v<v0)v0=v;if(v>v1)v1=v;
     if(u<-.001||u>1.001||v<-.001||v>1.001)nOut++;}}
   g.computeBoundingBox();const bb=g.boundingBox;
   const par=[];let p=o;while(p&&par.length<4){par.push(p.name||p.type);p=p.parent;}
   rows.push({name:o.name||'',chain:par.join('<'),tri,verts:g.attributes.position.count,
     hasUV:!!uv,u:[+u0.toFixed(3),+u1.toFixed(3)],v:[+v0.toFixed(3),+v1.toFixed(3)],uvOut:nOut,
     size:[+(bb.max.x-bb.min.x).toFixed(3),+(bb.max.y-bb.min.y).toFixed(3),+(bb.max.z-bb.min.z).toFixed(3)]});
 });
 // aggregate: how many meshes have uv strictly inside 0..1
 const bad=rows.filter(r=>!r.hasUV||r.uvOut>0);
 const byChain={};for(const r of rows){const k=r.chain.split('<')[0]||'?';(byChain[k]||=[0,0])[0]++;byChain[k][1]+=r.tri;}
 return{meshes:tot,tris:totTri,badCount:bad.length,
   bad:bad.slice(0,25),byChain,
   sample:rows.slice(0,12),
   vRange:[Math.min(...rows.map(r=>r.v[0])),Math.max(...rows.map(r=>r.v[1]))],
   uRange:[Math.min(...rows.map(r=>r.u[0])),Math.max(...rows.map(r=>r.u[1]))]};
})()
