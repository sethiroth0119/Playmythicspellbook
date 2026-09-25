/* ══════════════════════════════════════════════════════════════════════════
   PURITY PACT (CONTINUOUS) + RISE PROBE. Owner: "destroy this if you control a
   unit that is not x. From the graveyard it rises to the field at the start of
   your turn." — ruled a MERGE into Purity Pact: onPlay { type: 'purityPact',
   filter, pactContinuous: true }.
   Drives the REAL processTombstoneDrops (whose head runs _pactContinuousSweep)
   and the REAL _applyInGraveTick('turnStart'):
     1. a Savage Demon ruled "not Savage Demon" dies when a Goblin is beside it,
        and is filed to the graveyard like any death;
     2. …but lives when every other unit you control IS a Savage Demon;
     3. …and a HERO or an ENEMY unit never counts;
     4. an empty filter never fires, and an ON-SUMMON pact (not continuous)
        never fires from the sweep;
     5. In-Grave { trigger: turnStart, effect: selfDeploy } — it rises from the
        graveyard onto the field.
   Usage: node .gauntlet/sdc-rise-probe.mjs <candidate.html>  (needs :8787)
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import fs from 'node:fs';
const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.error('usage: sdc-rise-probe.mjs <candidate.html>'); process.exit(2); }
const html = fs.readFileSync(file, 'utf8');
if (!html.includes('_pactContinuousSweep')) { console.log(JSON.stringify({ ok: false, missing: 'the continuous Purity Pact is not in this file' })); process.exit(2); }
const browser = await chromium.launch();
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));
await page.route(/\/(index\.html)?(\?.*)?$/, (route) => {
  const u = new URL(route.request().url());
  if (u.pathname === '/' || u.pathname === '/index.html') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
  return route.continue();
});
let R;
try {
  await page.goto('http://localhost:8787/index.html', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => typeof processTombstoneDrops === 'function' && typeof _applyInGraveTick === 'function', null, { timeout: 30000 });
  R = await page.evaluate(() => {
    const W = BOARD_W, H = BOARD_H;
    const board = () => Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => ({ x, y, terrain: 'plain' })));
    const side = () => ({ deck: [], hand: [], graveyard: [], void: [], energy: 9, maxEnergy: 9, hp: 30 });
    const stats = { hp: 20, atk: 8, def: 4, mag: 2, res: 2, spd: 1 };
    const PACT = { type: 'purityPact', filter: { nameIncludes: 'Savage Demon' }, pactContinuous: true };
    const DEMON = { id: 'ps_demon', name: 'Savage Demon Grunt', type: 'unit', stats, learnset: [{ lvl: 1, m: 'slash' }], onPlay: PACT,
      inGrave: { trigger: 'turnStart', effect: 'selfDeploy', chance: 100, cooldown: 0 } };
    Forge.customCards = (Forge.customCards || []).filter(c => !/^ps_/.test(c.id)).concat([DEMON]);
    const u = (id, name, owner, x, y, extra) => Object.assign({ id, name, owner, alive: true, pos: { x, y }, currentHp: 20, maxHp: 20, stats, cardId: id }, extra || {});
    const mk = (extra) => ({ player: side(), ai: side(), board: board(), turn: 'player', turnNumber: 3, round: 2, gameOver: false, log: [], tombstones: [],
      units: [ u('h_p', 'Hero', 'player', 5, 10, { isHero: true, currentHp: 300 }), u('h_a', 'AI Hero', 'ai', 5, 0, { isHero: true, currentHp: 300 }),
               u('d1', 'Savage Demon Grunt', 'player', 5, 8, { cardId: 'ps_demon', _card: { ...DEMON, instanceId: 'iid_d1', _summonedUnitId: 'd1' } })   /* a deployed unit carries its card — that is what gets filed */ ].concat(extra || []) });
    const alive = (st, id) => !!(st.units.find(x => x.id === id) || {}).alive;
    const out = {};
    let st = mk([u('g1', 'Goblin', 'player', 4, 8)]); App.state = st; processTombstoneDrops(st);
    out.diesBesideGoblin = !alive(st, 'd1');
    out.logged = (st.log || []).some(l => /cannot abide Goblin — the pact breaks/.test(l.msg || ''));
    /* the graveyard filing happens in the App.state setter (_reconcileUnitCards), on the next assignment — as in play */
    App.state = st;
    out.inGrave = (App.state.player.graveyard || []).some(c => c && (c.id === 'ps_demon' || c.cardId === 'ps_demon'));
    st = mk([u('d2', 'Savage Demon Brute', 'player', 4, 8)]); App.state = st; processTombstoneDrops(st);
    out.livesAmongDemons = alive(st, 'd1');
    st = mk([u('e1', 'Goblin', 'ai', 4, 2)]); App.state = st; processTombstoneDrops(st);
    out.enemyAndHeroIgnored = alive(st, 'd1');
    st = mk([u('g2', 'Goblin', 'player', 4, 8)]); st.units[2]._card = { ...DEMON, onPlay: { ...PACT, filter: {} } };
    App.state = st; processTombstoneDrops(st);
    out.emptyRuleInert = alive(st, 'd1');
    st = mk([u('g3', 'Goblin', 'player', 4, 8)]); st.units[2]._card = { ...DEMON, onPlay: { ...PACT, pactContinuous: undefined } };
    App.state = st; processTombstoneDrops(st);
    out.onSummonPactNotSwept = alive(st, 'd1');
    /* rise */
    st = mk([]); st.units = st.units.filter(x => x.id !== 'd1');
    st.player.graveyard = [{ ...DEMON, instanceId: 'iid_demon' }];
    App.state = st;
    let st2; try { st2 = _applyInGraveTick(st, 'player', 'turnStart'); } catch (e) { out.riseErr = String(e); }
    out.rose = !!(st2 && (st2.units || []).some(x => x.alive && x.owner === 'player' && /Savage Demon/.test(x.name || '')));
    out.leftGrave = !!(st2 && !(st2.player.graveyard || []).some(c => c && c.id === 'ps_demon'));
    return out;
  });
} catch (e) {
  console.error(JSON.stringify({ ok: false, error: String(e), pageErrors }));
  await browser.close(); process.exit(2);
}
await browser.close();
const f = [];
if (!R.diesBesideGoblin || !R.logged) f.push('1 destroyed when you control a non-X unit (and it says why)');
if (!R.inGrave) f.push('1b filed to the graveyard like any death');
if (!R.livesAmongDemons) f.push('2 lives while every other unit you control is X');
if (!R.enemyAndHeroIgnored) f.push('3 heroes and enemy units never count');
if (!R.emptyRuleInert) f.push('4 an empty filter never fires');
if (!R.onSummonPactNotSwept) f.push('4b an on-summon pact does not fire from the sweep');
if (!R.rose || !R.leftGrave) f.push('5 In-Grave turnStart + Rise returns it to the field');
console.log(JSON.stringify({ ok: !f.length, fails: f, result: R, pageErrors: pageErrors.slice(0, 5) }, null, 1));
process.exit(f.length ? 1 : 0);
