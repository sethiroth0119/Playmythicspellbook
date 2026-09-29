(async () => {
  const B = window.MythicBroadcast, o = {};
  for (let i=0;i<16;i++){ B.tick(9); await new Promise(r=>setTimeout(r,260)); }
  o.posts = B.count(); o.unread = B.unread();
  // ── BUTTON REACHABILITY, five points, computed style, stacking
  const btn = document.querySelector('#railbar [data-rail="bcphone"], #railbar .rl[rail="bcphone"], #railbar button.rl');
  const all = [...document.querySelectorAll('#railbar .rl')];
  o.railButtons = all.map(b=>({txt:(b.textContent||'').trim().slice(0,14), rail:b.getAttribute('rail')||b.dataset.rail}));
  const target = all.find(b=>/phone/i.test((b.getAttribute('rail')||b.dataset.rail||'')+(b.textContent||'')));
  if (!target) { o.buttonErr='no phone launcher in #railbar'; return o; }
  const r = target.getBoundingClientRect();
  const cs = getComputedStyle(target);
  o.button = { rect:{x:+r.x.toFixed(0),y:+r.y.toFixed(0),w:+r.width.toFixed(0),h:+r.height.toFixed(0)},
    display:cs.display, visibility:cs.visibility, opacity:cs.opacity, zIndex:cs.zIndex,
    pointerEvents:cs.pointerEvents, text:(target.textContent||'').trim(),
    badge:(target.querySelector('.rlbadge,[class*=badge]')||{}).textContent||null };
  const pts = [[r.x+r.width/2,r.y+r.height/2],[r.x+3,r.y+3],[r.x+r.width-3,r.y+3],
               [r.x+3,r.y+r.height-3],[r.x+r.width-3,r.y+r.height-3]];
  o.hits = pts.map(([x,y])=>{ const st=document.elementsFromPoint(x,y);
    return { at:[Math.round(x),Math.round(y)], top: st[0]? st[0].tagName+'.'+(st[0].className||'').toString().split(' ').slice(0,2).join('.') : 'none',
             mine: !!(st[0] && (st[0]===target || target.contains(st[0]))),
             stack: st.slice(0,4).map(e=>e.tagName+(e.id?'#'+e.id:'')) }; });
  // ── OPEN by a REAL click
  target.click();
  await new Promise(r=>setTimeout(r,700));
  o.isOpen = window.MythicPhone.isOpen();
  o.unreadAfterOpen = B.unread();
  const shell = document.querySelector('#bcp-shell') || document.querySelector('#bcphone');
  if (shell) { const sr = shell.getBoundingClientRect(); const scs=getComputedStyle(shell);
    o.shell={ w:+sr.width.toFixed(0), h:+sr.height.toFixed(0), ratio:+(sr.height/sr.width).toFixed(2),
      radius:scs.borderRadius, opacity:scs.opacity, display:scs.display, visibility:scs.visibility, transform:scs.transform }; }
  o.title = (document.querySelector('#bcphone [class*=title],#bcphone h1,#bcphone h2,#bcphone header')||{}).textContent || null;
  o.chrome = ['#bcp-notch','.bcp-notch','.bcp-status','.bcp-screen','.bcp-body','.bcp-head','.bcp-tabs']
    .map(s=>{const e=document.querySelector(s); return s+'='+(e?'yes':'no');});
  const cards = [...document.querySelectorAll('.bcp-post')];
  o.cardsRendered = cards.length;
  o.cardSample = cards.slice(0,6).map(c=>({txt:(c.textContent||'').replace(/\s+/g,' ').trim().slice(0,170),
     avatarBg: (c.querySelector('[class*=av]')? getComputedStyle(c.querySelector('[class*=av]')).backgroundColor : null),
     h: +c.getBoundingClientRect().height.toFixed(0)}));
  // visible paint check on the first card
  if (cards[0]) { const c0=getComputedStyle(cards[0]); const b0=cards[0].getBoundingClientRect();
    o.card0 = { opacity:c0.opacity, visibility:c0.visibility, w:+b0.width.toFixed(0), h:+b0.height.toFixed(0),
      onScreen: b0.top>=0 && b0.bottom<=innerHeight+2 && b0.width>0 }; }
  // ── LIKE VIA THE UI
  const heart = document.querySelector('.bcp-post [data-act*="like"], .bcp-post button[class*=like]');
  if (heart) {
    const card = heart.closest('.bcp-post');
    const before = (card.textContent||'').match(/(\d+)\s*[♡❤♥]/);
    heart.click(); await new Promise(r=>setTimeout(r,400));
    const card2 = document.querySelectorAll('.bcp-post')[[...document.querySelectorAll('.bcp-post')].indexOf(card)] || card;
    const after = (document.querySelectorAll('.bcp-post')[0].textContent||'').match(/(\d+)\s*[♡❤♥]/);
    o.uiLike = { heartFound:true, beforeTxt: before&&before[0], afterTxt: after&&after[0],
                 apiLiked: B.posts({limit:400}).filter(p=>p.mine).length, following: B.following() };
    // close and reopen — the like must survive
    window.MythicPhone.close(); await new Promise(r=>setTimeout(r,300));
    window.MythicPhone.open(); await new Promise(r=>setTimeout(r,500));
    const again = document.querySelectorAll('.bcp-post')[0];
    o.uiLike.afterReopen = (again.textContent||'').replace(/\s+/g,' ').trim().slice(0,140);
    o.uiLike.stillLiked = B.posts({limit:400}).filter(p=>p.mine).length;
  } else o.uiLike = { heartFound:false, actAttrs: [...document.querySelectorAll('.bcp-post [data-act]')].map(e=>e.dataset.act).slice(0,8) };
  o.rows = window.MythicPhone._rows ? window.MythicPhone._rows().length : null;
  o.nav = window.MythicPhone._nav ? window.MythicPhone._nav() : null;
  return o;
})()
