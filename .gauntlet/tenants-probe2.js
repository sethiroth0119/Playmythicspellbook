(async () => {
  const nc = window.__nc, G = nc.game, P = window.MythicProgress;
  for (const n of P.tree.NODES) P._grant(n.id);
  const R = {};
  R.build = Object.keys(nc.build||{});
  const types = ['foodtruck','grocery','retail','gasstation','restaurant','shop','depot','warehouse','motorpool','clinic','purifier','club','arena'];
  R.sec = {};
  for (const t of types) { try { R.sec[t] = nc.build.timeFor ? nc.build.timeFor(t,1) : null; } catch(e){ R.sec[t]=String(e); } }
  R.ceiling = (()=>{try{return window.MythicEconomy.ECON.construction.municipal.maxSec;}catch(e){return null;}})();
  R.hasCo = (()=>{try{return nc.build.coTiles?nc.build.coTiles().length:'n/a';}catch(e){return String(e);}})();
  /* where is the housing, and where are the food trucks */
  const hs=[],ft=[];
  for (const k in G.tiles){ const t=G.tiles[k]; const c=k.split(',');
    if(t.type==='housing') hs.push([+c[0],+c[1]]);
    if(t.type==='foodtruck') ft.push([+c[0],+c[1]]); }
  R.housing = { n: hs.length, sample: hs.slice(0,10) };
  R.foodtrucks = ft;
  return R;
})()
