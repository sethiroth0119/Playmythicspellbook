(async () => {
  const nc=window.__nc, D=window.MythicDistricts, Z=window.MythicZoning, P=window.MythicProgress, G=nc.game;
  const R={}, K=(x,z)=>x+','+z, sleep=ms=>new Promise(r=>setTimeout(r,ms));
  /* PLAYER PATH, NOTHING RESEARCHED: click the zone chip then the spec chip. */
  window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',bubbles:true}));
  await sleep(200);
  const zb=[...document.querySelectorAll('[data-zone]')].map(b=>b.dataset.zone);
  R.zoneButtons=zb;
  const clow=[...document.querySelectorAll('[data-zone]')].find(b=>b.dataset.zone==='c_low');
  if(clow){ clow.click(); await sleep(250); }
  const row=document.getElementById('nz-spec');
  R.locked={ rowText:row?row.textContent.replace(/\s+/g,' ').slice(0,500):null,
             chips:row?[...row.querySelectorAll('[data-spec]')].map(b=>({id:b.dataset.spec,cls:b.className,label:b.textContent.trim()})):null };
  const myth=row&&[...row.querySelectorAll('[data-spec]')].find(b=>b.dataset.spec==='c_mythic');
  if(myth){ myth.click(); await sleep(250); }
  R.locked.armedAfterClickingLocked=D.armed();
  /* now grant and repeat */
  for(const n of P.tree.NODES) P._grant(n.id);
  Z.sync(); await sleep(250);
  const row2=document.getElementById('nz-spec');
  const myth2=row2&&[...row2.querySelectorAll('[data-spec]')].find(b=>b.dataset.spec==='c_mythic');
  if(myth2){ myth2.click(); await sleep(250); }
  R.unlocked={ armed:D.armed(), armedForCom:D.armedFor('com'),
    chips:row2?[...row2.querySelectorAll('[data-spec]')].map(b=>({id:b.dataset.spec,cls:b.className})):null,
    detail:(document.querySelector('#nz-spec .nddet')||{}).textContent };
  /* paint with the armed brush through the shipped paint call */
  const plots=[];
  for(let x=0;x<24;x++)for(let z=0;z<24;z++){ if(G.tiles[K(x,z)]||G.zones[K(x,z)])continue;
    const rf=[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz])=>{const t=G.tiles[K(x+dx,z+dz)];return t&&t.type==='road';});
    if(rf) plots.push({x,z}); }
  const p=plots[0];
  Z.applyPaint(p.x,p.z,'c_low',D.armedFor('com'));
  R.painted={ at:[p.x,p.z], spec:D.specAt(p.x,p.z), marks:Z.specMarks(), stats:D.stats() };
  return R;
})()
