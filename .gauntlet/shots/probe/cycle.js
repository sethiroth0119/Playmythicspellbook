(async ()=>{
 const nc = window.__nc;
 const _D = window.Date, base = _D.now();
 let shift = 0;
 class SD extends _D { constructor(...a){ if(!a.length) super(_D.now()+shift); else super(...a);} static now(){return _D.now()+shift;} }
 SD.parse=_D.parse; SD.UTC=_D.UTC; window.Date = SD;
 const cur = ()=>{ const p={}; for(const q of new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(new _D())) p[q.type]=q.value;
   return (+p.hour%24)+(+p.minute)/60+(+p.second)/3600; };
 const raf = ()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
 const setH = (h)=>{ shift = (h - cur())*3600*1000; };
 const STEP = 0.05;
 setH(0); await raf(); await raf();
 const start = nc.skyEnv().builds, perHour = {};
 let ms = 0, n0 = nc.skyEnv();
 for (let h = 0; h < 24; h += STEP) {
   setH(h); await raf();
   const s = nc.skyEnv();
   const k = Math.floor(h);
   perHour[k] = (perHour[k]||0) + 0;
 }
 const end = nc.skyEnv();
 // second pass, per-hour attribution
 const buckets = new Array(24).fill(0);
 let prev = nc.skyEnv().builds;
 for (let h = 0; h < 24; h += STEP) { setH(h); await raf();
   const b = nc.skyEnv().builds; buckets[Math.floor(h)] += (b - prev); prev = b; }
 const total = nc.skyEnv().builds - end.builds;
 window.Date = _D;
 return { steps: Math.round(24/STEP), sweep1Builds: end.builds - start,
          sweep2Builds: total, perHourSweep2: buckets,
          avgRebuildMs: +((nc.skyEnv().totalMs - 0) / nc.skyEnv().builds).toFixed(2),
          lastMs: nc.skyEnv().lastMs, stat: nc.skyEnv() };
})()
