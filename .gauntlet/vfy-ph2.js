(async () => {
  const B = window.MythicBroadcast;
  for (let i=0;i<12;i++){ B.tick(9); await new Promise(r=>setTimeout(r,260)); }
  try { window.MythicPhone.close(); } catch(e){}
  await new Promise(r=>setTimeout(r,400));
  const all=[...document.querySelectorAll('#railbar .rl')];
  const t=all.find(b=>(b.getAttribute('rail')||'')==='bcphone');
  const r=t.getBoundingClientRect();
  return { closed: !window.MythicPhone.isOpen(), unread: B.unread(),
    label:(t.textContent||'').trim(), rect:{x:+r.x.toFixed(0),y:+r.y.toFixed(0),w:+r.width.toFixed(0),h:+r.height.toFixed(0)},
    hitCentre: (()=>{const s=document.elementsFromPoint(r.x+r.width/2,r.y+r.height/2);
      return {top:s[0].tagName+'.'+s[0].className, mine:t.contains(s[0])||s[0]===t};})(),
    rowY: [...new Set(all.map(b=>Math.round(b.getBoundingClientRect().y)))],
    rowWidth: all.reduce((a,b)=>a+b.getBoundingClientRect().width,0),
    track: document.querySelector('#railbar').getBoundingClientRect().width };
})()
