(async () => {
  const B = window.MythicBroadcast;
  for (let i=0;i<12;i++){ B.tick(9); await new Promise(r=>setTimeout(r,260)); }
  try { window.MythicPhone && window.MythicPhone.close(); } catch(e){}
  await new Promise(r=>setTimeout(r,400));
  const bar = document.querySelector('#railbar');
  const all=[...document.querySelectorAll('#railbar .rl')];
  const anyPhone = [...document.querySelectorAll('[rail="bcphone"],[data-rail="bcphone"]')];
  const out = { hasPhoneModule: !!window.MythicPhone, unread: B.unread(),
    barExists: !!bar, railCount: all.length,
    rails: all.map(b=>({r:b.getAttribute('rail'), txt:(b.textContent||'').trim().slice(0,12), disp:getComputedStyle(b).display, y:Math.round(b.getBoundingClientRect().y), w:Math.round(b.getBoundingClientRect().width)})),
    phoneNodes: anyPhone.map(b=>({tag:b.tagName, inBar: !!(bar&&bar.contains(b)), disp:getComputedStyle(b).display, rect:b.getBoundingClientRect().toJSON()})),
    barRect: bar? bar.getBoundingClientRect().toJSON():null, vw: innerWidth };
  const t = anyPhone[0];
  if (t) { const r=t.getBoundingClientRect();
    if (r.width>0) { const s=document.elementsFromPoint(r.x+r.width/2,r.y+r.height/2);
      out.hit={top:s[0]&&s[0].tagName+'.'+s[0].className, mine:t.contains(s[0])||s[0]===t}; } }
  out.rowsY = [...new Set(all.map(b=>Math.round(b.getBoundingClientRect().y)))];
  return out;
})()
