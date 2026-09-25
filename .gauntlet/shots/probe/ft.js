(()=>{
 const {renderer, scene, camera} = __nc.three();
 const gl = renderer.getContext();
 const seen=new Set(), mats=[];
 scene.traverse(o=>{ const m=o.material; if(!m) return; (Array.isArray(m)?m:[m]).forEach(x=>{ if(x && x.envMap && !seen.has(x)){seen.add(x); mats.push(x);} }); });
 const keep = mats.map(m=>m.envMap);
 const set = (on)=>{ mats.forEach((m,i)=>{ m.envMap = on?keep[i]:null; m.needsUpdate=true; }); };
 const t = (n)=>{ for(let i=0;i<3;i++) renderer.render(scene,camera); gl.finish();
   const t0=performance.now(); for(let i=0;i<n;i++) renderer.render(scene,camera); gl.finish();
   return (performance.now()-t0)/n; };
 const N=10;
 const A=t(N); set(false); const B=t(N); set(true); const C=t(N); set(false); const D=t(N); set(true); const E=t(N);
 renderer.info.reset(); renderer.render(scene,camera);
 const inf={tri:renderer.info.render.triangles, calls:renderer.info.render.calls, prog:renderer.info.programs.length};
 console.log('FRAMETIME ' + JSON.stringify({
   envOnMs:[+A.toFixed(2),+C.toFixed(2),+E.toFixed(2)],
   envOffMs:[+B.toFixed(2),+D.toFixed(2)],
   matsInScene:mats.length, matNames:mats.map(m=>m.type+':'+m.uuid.slice(0,6)),
   render:inf, quality:'?', skyEnv:__nc.skyEnv()
 }));
})()
