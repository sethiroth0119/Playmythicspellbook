(() => {
  const nc = window.__nc, D = window.MythicDossier;
  const say = (t, v) => console.log('DSR ' + t + ' :: ' + (typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 340));
  const strip = v => String(v == null ? '' : v).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  say('mounted', !!D);
  if (!D) return;
  try { nc.citizens.refresh(true); } catch (e) { say('refresh', String(e)); }

  /* Put a named citizen in THIS house so the household card has a roster to
     draw. setJob is the only citizen verb the seam offers; residence is
     derived, so the house that gets people is the first in the deal order. */
  const homes = Object.keys(nc.game.tiles).filter(k => nc.game.tiles[k].type === 'housing');
  let HOME = homes[0];
  for (const k of homes) { if ((D.householdOf(k).members || []).length > 1) { HOME = k; break; } }
  if (!(D.householdOf(HOME).members || []).length) {
    for (const k of homes) if ((D.householdOf(k).members || []).length) { HOME = k; break; }
  }
  const SHOP = '13,9';
  say('picked home', HOME);
  say('addr home', D.addressOf(HOME));
  say('addr shop', D.addressOf(SHOP));
  say('header home', strip(D.headerHtml(HOME, 'Housing')));
  say('header shop', strip(D.headerHtml(SHOP, 'Marlow & Vane Provisions')));
  say('wealth', D.wealthOf(HOME).label + ' rank ' + D.wealthOf(HOME).rank + '/' + D.wealthOf(HOME).of);
  const h = D.householdOf(HOME);
  say('household', { name: h.name, family: h.family, who: (h.members || []).map(m => m.name + ' ' + Math.round(m.mood)) });
  say('books shop', D.booksOf(SHOP).rows.map(r => r.label + '=' + strip(r.value)).join(' | '));
  say('books shop income why', strip(D.booksOf(SHOP).rows[0].sub));

  nc.inspect(HOME);
  const panes = document.getElementById('inspanes');
  say('name shown', document.getElementById('insname').textContent);
  say('pips', panes.innerHTML.indexOf('dsr-pips') >= 0);
  say('household card', panes.innerHTML.indexOf('dsr-fam') >= 0);
  say('clickable citizen rows', panes.querySelectorAll('.wfrow[data-cit]').length);
})()
