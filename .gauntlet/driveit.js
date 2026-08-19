(() => {
  const nc = window.__nc, D = window.MythicDossier;
  if (!D) { console.log('DOSSIER FAIL: module not mounted'); return; }
  try { nc.citizens.refresh(true); } catch (e) {}
  const homes = Object.keys(nc.game.tiles).filter(k => nc.game.tiles[k].type === 'housing');
  let home = homes[0];
  for (const k of homes) if ((D.householdOf(k).members || []).length) { home = k; break; }
  const strip = v => String(v == null ? '' : v).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  console.log('DOSSIER address ' + JSON.stringify(D.addressOf(home)));
  console.log('DOSSIER zone ' + D.zoneOf(home).label + ' | wealth ' + D.wealthOf(home).label +
              ' rank ' + D.wealthOf(home).rank + '/' + D.wealthOf(home).of);
  const h = D.householdOf(home);
  console.log('DOSSIER household ' + h.name + ' :: ' + (h.members || []).map(m => m.name).join(', '));
  console.log('DOSSIER books ' + D.booksOf(home).rows.map(r => r.label + '=' + strip(r.value)).join(' | '));
  const shop = Object.keys(nc.game.tiles).find(k => nc.game.tiles[k].type === 'shop');
  if (shop) console.log('DOSSIER business header ' + strip(D.headerHtml(shop, 'Marlow & Vane Provisions')));
  nc.inspect(home);
  const p = document.getElementById('inspanes');
  console.log('DOSSIER header ' + document.getElementById('insname').textContent +
    ' | pips=' + (p.innerHTML.indexOf('dsr-pips') >= 0) +
    ' | householdCard=' + (p.innerHTML.indexOf('dsr-fam') >= 0) +
    ' | citizenRows=' + p.querySelectorAll('.wfrow[data-cit]').length);
})()
