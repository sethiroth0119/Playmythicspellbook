/* THE BOOKS card, driven against a district that has actually been lived in.
   Prints in small pieces — shot.mjs truncates a console line at 400 chars. */
(() => {
  const nc = window.__nc, D = window.MythicDossier;
  const say = (t, v) => console.log('BK ' + t + ' :: ' +
    (typeof v === 'string' ? v : (v === undefined ? 'undefined' : JSON.stringify(v))).slice(0, 330));
  const strip = v => String(v == null ? '' : v).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const chunk = (tag, s) => { s = strip(s); for (let i = 0; i < s.length; i += 300) say(tag + (i ? '+' : ''), s.slice(i, i + 300)); };
  say('layers', { dossier: !!D, eco: !!(window.MythicEconomy && window.MythicEconomy.ready()), demog: !!(window.MythicDemographics && window.MythicDemographics.ready()), chain: !!window.MythicResourceChain });
  if (!D) return;

  /* A freshly-built district has eight people in it: node-city grows `pop.npc`
     on a real clock and the demographics budget is that figure. Setting it is
     the same stimulus a few hours of play is, and it is the ONLY thing this
     driver writes — every number below is then produced by the shipped ticks. */
  nc.game.pop.npc = 240;
  for (let i = 0; i < 40; i++) {
    try { nc.demog.tick(20); } catch (e) {}
    try { window.MythicEconomy.tick(20, nc.eco.host()); } catch (e) {}
  }
  try { const r = nc.demog.report(); say('city', { pop: r.population, hh: Math.round(r.households), homes: r.homes, occPct: Math.round(r.occupancy * 100), rentIdx: Math.round(r.rentIndex * 100) / 100, limit: r.limit }); } catch (e) { say('report threw', String(e)); }

  const homes = Object.keys(nc.game.tiles).filter(k => nc.game.tiles[k].type === 'housing');
  let HOME = homes[0];
  for (const k of homes) {
    const r = (() => { try { return window.MythicDemographics.residents(k); } catch (e) { return null; } })();
    if (r && r.ok && r.occupied > 0) { HOME = k; break; }
  }
  const r = window.MythicDemographics.residents(HOME);
  say('home', HOME + ' — ' + (D.addressOf(HOME).text || '?'));
  say('res', { zone: r.zone && r.zone.name, homes: r.homes, let: r.occupied, people: r.residents, rentPerDwellingDay: r.rent, burden: r.rentBurden, incomeDay: r.income });
  say('hh0', r.households[0] && { l: r.households[0].label, size: r.households[0].size, inc: r.households[0].income, fit: r.households[0].jobFit });

  const s = window.MythicEconomy.snapshot();
  say('eco', { pop: s.population, day: Math.round(s.day), unempPct: Math.round(s.unemployment * 100), rentDay: Math.round(s.flow.rent * 100) / 100, wagesDay: Math.round(s.flow.wages * 100) / 100 });

  const B = D.booksOf(HOME);
  say('rows', B.rows.map(x => x.label + ' = ' + strip(x.value)).join(' | '));
  B.rows.forEach((x, i) => chunk('sub' + i + ' ' + x.label, x.sub));
  say('residence', B.residence);
  B.notes.forEach((n, i) => chunk('note' + i, n));

  // …and a producer, so the non-residence wording is seen too.
  const SHOP = Object.keys(nc.game.tiles).find(k => {
    const d = nc.game.tiles[k]; return d && (d.type === 'farm' || d.type === 'depot');
  }) || Object.keys(nc.game.tiles)[0];
  const S2 = D.booksOf(SHOP);
  if (S2) {
    say('producer tile', SHOP + ' ' + nc.game.tiles[SHOP].type);
    say('shop rows', S2.rows.map(x => x.label + ' = ' + strip(x.value)).join(' | '));
    chunk('shop rent', S2.rows[1].sub);
    chunk('shop fees', S2.rows[4].sub);
  }

  // 🔴 the economy must be exactly where it was: this card only READS.
  say('audit', (() => { const a = window.MythicEconomy.audit(); return a ? { ok: a.ok, err: Math.round((a.err || 0) * 1e6) / 1e6 } : null; })());
  say('payoutAllowed', window.MythicEconomy.snapshot().payoutAllowed);

  // the REAL render, through the shipped panel
  nc.inspect(HOME);
  const panes = document.getElementById('inspanes');
  const card = Array.from(panes.querySelectorAll('.ins-card')).find(c => (c.textContent || '').indexOf('The books') >= 0);
  say('card in DOM', !!card);
  if (card) { chunk('CARD', card.textContent); try { card.scrollIntoView({ block: 'start' }); } catch (e) {} }
  const w = D.wealthOf(HOME);
  say('wealth', w && { label: w.label, src: w.source });
  if (w) chunk('wealth note', w.note);
})()
