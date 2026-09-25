/* ══════════════════════════════════════════════════════════════════════════
   🧬 DRIVE-MUTATE-HOSTCOST — a mutate card can find its hosts.

   Reported, with the card open in the editor: "Mutate is not working. I can
   play the unit on normal tiles and not on other units." The card was authored
   Mutate ON, HOST SIDE = your own unit, HOST MIN COST = 4.

   🔴 EVERY UNIT ON THE BOARD READ AS COSTING 0. _mutateHostCheck resolved the
      host's cost as

        (typeof _cardDefById === 'function' && (host.cardId || host.originalCardId))
          ? ((_cardDefById(host.cardId || host.originalCardId) || {}).cost | 0)
          : (host.cost | 0)

      so `host.cost` was only consulted when the unit had NO id at all. A unit
      that HAS an id whose definition does not resolve on this device — a Forge
      card never published here, a catalogue still loading, a summon token —
      took the first branch and evaluated `undefined | 0` = 0. Any hostMinCost
      of 1 or more then refused the whole board.

      And board units carried no cost of their own to fall back to: buildUnit
      copied a dozen fields off the card and not that one, so the lookup was the
      ONLY answer and 0 was what it gave.

      The visible result is exactly the report: no host highlights, every unit
      refuses, and clicking empty ground still deploys normally — because that
      path never consults the mutate spec at all.

   WHAT THIS PINS:
     · buildUnit stamps the printed cost onto the unit, so a unit is
       self-describing and the catalogue is an optimisation rather than the
       only source
     · the cost read tries def -> unit -> card, and `!= null` so a real 0 is
       not stepped over by a truthiness test
     · with the definition UNRESOLVABLE — the failing condition — hosts are
       still selected correctly by cost
     · a unit under the minimum is refused with its REAL cost in the message,
       not 0
     · heroes are never hosts

   Run:  node .gauntlet/drive-mutate-hostcost.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.jsx': 'text/babel', '.svg': 'image/svg+xml' };
const P = 9960 + (process.pid % 60);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errs = [];
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
await pg.route('**/*', (r) => (r.request().url().includes('127.0.0.1') ? r.continue() : r.abort()));
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForTimeout(6000);

const out = await pg.evaluate(() => {
  const o = {};
  const heroes = getAllHeroes();
  App.state = initGame(heroes[0], heroes[1] || heroes[0], (Forge && Forge.customCards) || [], true, null);

  /* Deploy through the game's OWN factory, with ids the catalogue cannot
     resolve — that unresolvable state is the whole point of the test. */
  const cards = [
    { id: 'zz_cheap', name: 'Cheap Forged', cost: 2, type: 'unit', stats: { hp: 5, atk: 2, def: 1, mag: 0, res: 0, spd: 1 }, maxHp: 5, elements: ['fire'] },
    { id: 'zz_four',  name: 'Four Forged',  cost: 4, type: 'unit', stats: { hp: 5, atk: 2, def: 1, mag: 0, res: 0, spd: 1 }, maxHp: 5, elements: ['fire'] },
    { id: 'zz_big',   name: 'Big Forged',   cost: 7, type: 'unit', stats: { hp: 5, atk: 2, def: 1, mag: 0, res: 0, spd: 1 }, maxHp: 5, elements: ['fire'] },
    /* a real 0-cost unit, so the `!= null` read is exercised rather than a
       truthiness test that would step over it and keep looking */
    { id: 'zz_zero',  name: 'Zero Forged',  cost: 0, type: 'unit', stats: { hp: 5, atk: 2, def: 1, mag: 0, res: 0, spd: 1 }, maxHp: 5, elements: ['fire'] },
  ];
  cards.forEach((c, i) => {
    try { const u = buildUnit(c, 'player', { x: 2 + i, y: 4 }, null, 1, 0); if (u) App.state.units.push(u); }
    catch (e) { o.factoryErr = String(e).slice(0, 140); }
  });

  const s = App.state;
  const mine = (s.units || []).filter(u => !u.isHero);
  o.deployed = mine.length;
  o.stampedCosts = mine.map(u => u.name + '=' + (u.cost != null ? u.cost : 'MISSING'));
  /* the condition that broke it must actually hold, or this proves nothing */
  o.defsUnresolvable = mine.every(u => !_cardDefById(u.cardId || u.originalCardId || u.id));

  const card = { id: 'divine-rain-mut', name: 'Divine Rain (mutate)', type: 'unit', cost: 2,
                 treatAs: 'Divine Rain', mutate: { on: true, hostSide: 'ally', hostMinCost: 4 } };
  o.hostsAtMin4 = _mutateHosts(s, 'player', card).map(u => u.name).sort();

  const cheap = mine.find(u => u.name === 'Cheap Forged');
  o.refusalNamesRealCost = _mutateHostCheck(s, 'player', card, cheap).why || '';

  /* a max-cost filter, and a 0-cost host that must satisfy it */
  const maxCard = { id: 'mx', name: 'Max', type: 'unit', cost: 1, mutate: { on: true, hostSide: 'ally', hostMaxCost: 2 } };
  o.hostsAtMax2 = _mutateHosts(s, 'player', maxCard).map(u => u.name).sort();

  /* no filter at all — every non-hero ally is a host */
  const anyCard = { id: 'any', name: 'Any', type: 'unit', cost: 1, mutate: { on: true, hostSide: 'ally' } };
  o.hostsNoFilter = _mutateHosts(s, 'player', anyCard).map(u => u.name).sort();
  o.heroesExcluded = _mutateHosts(s, 'player', anyCard).every(u => !u.isHero);
  return o;
});

out.pageErrors = errs.filter(e => !/ERR_FAILED|Failed to load resource/.test(e));
console.log(JSON.stringify(out, null, 2));

const F = [];
if (out.factoryErr) F.push('the unit factory threw: ' + out.factoryErr);
if (out.deployed !== 4) F.push('expected 4 deployed units, got ' + out.deployed);
if (!out.defsUnresolvable) F.push('the definitions RESOLVED — the failing condition did not hold, so this run proves nothing');
if (out.stampedCosts.some(x => /MISSING/.test(x))) F.push('a unit carries no cost of its own: ' + out.stampedCosts.join(', '));
if (String(out.hostsAtMin4) !== String(['Big Forged', 'Four Forged'])) {
  F.push('min-cost 4 selected ' + JSON.stringify(out.hostsAtMin4) + ', expected the 4 and the 7');
}
if (!/costs 2 /.test(out.refusalNamesRealCost)) {
  F.push('the refusal did not name the real cost — it said: ' + out.refusalNamesRealCost);
}
if (String(out.hostsAtMax2) !== String(['Cheap Forged', 'Zero Forged'])) {
  F.push('max-cost 2 selected ' + JSON.stringify(out.hostsAtMax2)
       + ', expected the 2 and the 0 — a real 0 cost must not be stepped over by a truthiness read');
}
if (out.hostsNoFilter.length !== 4) F.push('with no filter every ally should be a host, got ' + out.hostsNoFilter.length);
if (!out.heroesExcluded) F.push('a hero was offered as a mutate host');
if (out.pageErrors.length) F.push('page errors: ' + out.pageErrors.join(' | '));

console.log(F.length ? ('FAIL\n  - ' + F.join('\n  - ')) : 'PASS · hosts are found by their real cost even when the catalogue cannot answer');
await b.close(); srv.close();
process.exit(F.length ? 1 : 0);
