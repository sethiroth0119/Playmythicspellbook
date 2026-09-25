(()=>{
 const {renderer, scene, camera} = __nc.three();
 const gl = renderer.getContext();
 const px = new Uint8Array(4);
 const seen=new Set(), mats=[];
 scene.traverse(o=>{ const m=o.material; if(!m) return; (Array.isArray(m)?m:[m]).forEach(x=>{ if(x && x.envMap && !seen.has(x)){seen.add(x); mats.push(x);} }); });
 const keep = mats.map(m=>m.envMap);
 const set = (on)=>{ mats.forEach((m,i)=>{ m.envMap = on?keep[i]:null; m.needsUpdate=true; }); };
 // readPixels forces a full synchronous flush, which gl.finish() alone did not:
 // a first pass measured 14.9ms for a frame the harness renders at ~0.6fps.
 const one = ()=>{ const t0=performance.now(); renderer.render(scene,camera);
                   gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px); return performance.now()-t0; };
 const batch = (n)=>{ for(let i=0;i<2;i++) one(); const a=[]; for(let i=0;i<n;i++) a.push(+one().toFixed(1)); return a; };
 const on=[], off=[];
 for (let r=0; r<4; r++){ set(true); on.push(...batch(3)); set(false); off.push(...batch(3)); }
 set(true);
 const med = a=>{ const s=[...a].sort((x,y)=>x-y); return s[s.length>>1]; };
 renderer.info.reset(); renderer.render(scene,camera);
 return { on, off, medOn: med(on), medOff: med(off),
          meanOn: +(on.reduce((a,b)=>a+b,0)/on.length).toFixed(1),
          meanOff: +(off.reduce((a,b)=>a+b,0)/off.length).toFixed(1),
          mats: mats.length,
          render: { tri: renderer.info.render.triangles, calls: renderer.info.render.calls,
                    prog: renderer.info.programs.length, tex: renderer.info.memory.textures,
                    geo: renderer.info.memory.geometries },
          skyEnv: __nc.skyEnv() };
})()
