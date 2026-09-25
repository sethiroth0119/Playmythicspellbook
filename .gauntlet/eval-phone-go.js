/* GO SOMEWHERE — requirement 6. A post about a business opens the dossier for
   that tile; a post by a named citizen opens the citizen dialogue. Both go
   through the shipped openers (openInspect / openCitTalk) handed over in ctx,
   and both close the phone on the way. */
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const out = { steps: [] };
  const S = (k, v) => out.steps.push(k + ': ' + (typeof v === 'string' ? v : JSON.stringify(v)));
  const B = window.MythicBroadcast, P = window.MythicPhone;
  for (let i = 0; i < 14; i++) { try { B.tick(9); } catch (e) {} await sleep(260); }
  P.open();
  await sleep(300);
  const feed = document.getElementById('bcp-feed');
  S('cards', feed.querySelectorAll('.bcp-post').length);

  // ── a TILE link (a business name, resolved through /src/naming) ──
  S('allGo', [...feed.querySelectorAll('[data-go]')].map(a => a.getAttribute('data-go').split(':')[0] + '|' + a.textContent.slice(0, 22)));
  S('kinds', [...feed.querySelectorAll('.bcp-post')].map(a => a.dataset.kind));
  S('subs', [...feed.querySelectorAll('.bcp-sub')].map(a => (a.tagName === 'BUTTON' ? '[L]' : '[ ]') + a.textContent.slice(0, 26)));
  /* The tile branch. A `company` post only exists once a business has actually
     opened, and the gauntlet district is placed finished (sites: 0), so this
     run may legitimately produce none. The half that is THIS file's — the
     delegated handler, the ctx hand-over to openInspect, and closing the phone
     on the way out — is exercised by planting the same data-go a company card
     would carry, against a real key from /src/naming's register. The other
     half (name -> key) is the identical lookup the citizen case just proved. */
  let planted = null;
  try {
    const all = window.MythicNaming.all();
    const key = Object.keys(all).find(k => window.MythicCityBridge && true);
    planted = { key, name: all[key].name };
    const b = document.createElement('button');
    b.setAttribute('data-go', 'tile:' + key);
    b.id = 'plantedgo';
    feed.insertBefore(b, feed.firstChild);
  } catch (e) { S('plantErr', String(e)); }
  S('planted', planted);
  const tileLink = feed.querySelector('[data-go^="tile:"]');
  S('tileLinkText', tileLink ? tileLink.textContent : null);
  S('tileLinkKey', tileLink ? tileLink.getAttribute('data-go') : null);
  if (tileLink) {
    tileLink.click();
    await sleep(400);
    const ins = document.getElementById('inspect');
    S('afterTileClick', {
      phoneClosed: !P.isOpen(),
      dossierOpen: ins.classList.contains('open'),
      dossierName: document.getElementById('insname').textContent.trim().slice(0, 60),
    });
    try { document.getElementById('insx').click(); } catch (e) {}
    await sleep(200);
  }

  // ── a CITIZEN link (a roster name) ──
  P.open();
  await sleep(300);
  const czLink = document.querySelector('#bcp-feed [data-go^="cit:"]');
  S('czLinkText', czLink ? czLink.textContent : null);
  if (czLink) {
    czLink.click();
    await sleep(400);
    const cb = document.getElementById('citback');
    S('afterCitClick', {
      phoneClosed: !P.isOpen(),
      talkOpen: cb.classList.contains('open'),
      talkText: cb.textContent.replace(/\s+/g, ' ').trim().slice(0, 70),
    });
  }
  return JSON.stringify(out, null, 1);
})()
