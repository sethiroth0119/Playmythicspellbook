(() => {
  const o = {};
  const bar = document.getElementById('ncsb');
  o.bar = bar ? { h: Math.round(bar.getBoundingClientRect().height), w: Math.round(bar.getBoundingClientRect().width) } : null;
  const top = document.getElementById('nctop');
  o.dockH = top ? Math.round(top.getBoundingClientRect().height) : null;
  const ck = document.getElementById('ncsb-clock');
  o.clock = ck ? { txt: ck.innerText.replace(/\s+/g,' ').trim(), r: (r=>({x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}))(ck.getBoundingClientRect()) } : null;
  const np = document.getElementById('ncsb-nopause');
  o.nopause = np ? { txt: np.innerText.replace(/\s+/g,' ').trim(), r: (r=>({x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}))(np.getBoundingClientRect()) } : null;
  o.rclockParent = (document.getElementById('r-clock')||{}).parentElement ? document.getElementById('r-clock').parentElement.id : null;
  o.clockresHidden = (()=>{ const e=document.getElementById('clockres'); return e ? getComputedStyle(e).display : 'gone'; })();
  try { o.covWater = window.__nc.game.cov.pct.water; } catch(e) { o.covWater = 'ERR '+e.message; }
  try { const w = window.MythicWater && window.MythicWater.state(); o.water = w ? { ok:w.ok, cap:w.capacity, draw:w.draw, short:w.shortfall, demandKnown:w.demandKnown } : null; } catch(e) { o.water='ERR'+e.message; }
  try { const s = window.MythicEconomy && window.MythicEconomy.snapshot(); o.snapWant = s ? s.want : null; o.snapUnmet = s ? s.unmet : null; o.snapSat = s ? s.satisfaction : null; } catch(e){ o.snap='ERR'+e.message; }
  try {
    const d = window.MythicHUD.demand();
    o.demand = d.map(x => ({ id:x.id, v: x.value == null ? null : Math.round(x.value*100),
      causes: (x.causes||[]).map(c => c.sign + ' ' + c.label + ' [' + (Math.round(c.w*1000)/1000) + ']') }));
    o.comWhy = (d.find(x=>x.id==='com')||{causes:[]}).causes.map(c=>c.sign+' '+c.label+' :: '+c.why);
    o.indWhy = (d.find(x=>x.id==='ind')||{causes:[]}).causes.map(c=>c.sign+' '+c.label+' :: '+c.why);
  } catch(e) { o.demand = 'ERR ' + e.message; }
  window.__R8 = o;
  return JSON.stringify(o);
})()
