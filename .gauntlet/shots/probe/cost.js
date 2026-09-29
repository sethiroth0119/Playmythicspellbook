(()=>{
 const nc=window.__nc,{renderer,scene,camera}=nc.three();
 let win=null,seen=new Set();
 scene.traverse(o=>{const m=o.material;if(!m)return;(Array.isArray(m)?m:[m]).forEach(x=>{
   if(!x||seen.has(x))return;seen.add(x);if(x.emissive&&x.emissive.getHex()===0xffc978)win=x;});});
 const TEX=win.map;
 const on =()=>{win.map=TEX; win.color.setHex(0x3a4860);win.needsUpdate=true;};
 const off=()=>{win.map=null;win.color.setHex(0x1b2430);win.needsUpdate=true;};
 // warm both programs, then INTERLEAVE single renders so drift is common-mode
 on(); for(let i=0;i<4;i++)renderer.render(scene,camera);
 off();for(let i=0;i<4;i++)renderer.render(scene,camera);
 const A=[],B=[],N=14;
 for(let i=0;i<N;i++){
   on(); let t=performance.now(); renderer.render(scene,camera); A.push(performance.now()-t);
   off();t=performance.now(); renderer.render(scene,camera); B.push(performance.now()-t);
 }
 const med=a=>{const s=a.slice().sort((x,y)=>x-y);return s[s.length>>1];};
 on();
 renderer.info.reset();renderer.render(scene,camera);
 const inf=JSON.parse(JSON.stringify({render:renderer.info.render,memory:renderer.info.memory}));
 return{n:N, onMs:+med(A).toFixed(1), offMs:+med(B).toFixed(1),
   onAll:A.map(x=>+x.toFixed(0)), offAll:B.map(x=>+x.toFixed(0)),
   deltaPct:+(((med(A)-med(B))/med(B))*100).toFixed(2),
   info:inf, programs:renderer.info.programs.length,
   texBytes: 16*32*4};
})()
