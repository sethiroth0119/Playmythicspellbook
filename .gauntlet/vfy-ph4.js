(async () => {
  const B = window.MythicBroadcast, o = {};
  B.reset();                       // a brand-new city: no events at all
  window.MythicPhone.open();
  await new Promise(r=>setTimeout(r,600));
  o.emptyOpen = window.MythicPhone.isOpen();
  o.emptyCards = document.querySelectorAll('.bcp-post').length;
  o.emptyText = (document.querySelector('#bcp-shell')||document.body).textContent.replace(/\s+/g,' ').trim().slice(0,260);
  o.pageErrors = 0;
  // now fill it live while the phone is OPEN — posts must arrive
  for (let i=0;i<8;i++){ B.tick(9); await new Promise(r=>setTimeout(r,300)); }
  await new Promise(r=>setTimeout(r,600));
  o.liveCards = document.querySelectorAll('.bcp-post').length;
  o.apiCount = B.count();
  // big freshness corpus
  const all = B.posts({limit:400}); const bodies = all.map(p=>p.body);
  const dup={}; bodies.forEach(b=>dup[b]=(dup[b]||0)+1);
  o.freshness = { n:bodies.length, distinct:new Set(bodies).size,
                  verbatim: Object.entries(dup).filter(([,c])=>c>1).map(([b,c])=>[c,b.slice(0,70)]) };
  o.sample = bodies.slice(0,10);
  return o;
})()
