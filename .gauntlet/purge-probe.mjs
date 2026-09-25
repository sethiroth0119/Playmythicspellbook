/* ══════════════════════════════════════════════════════════════════════════
   PURGE PROBE (2026-09-19). Owner: "Destroy unit with stat x or less and one
   for stat x or higher, as well as effect type that destroy element types and
   or faction types."
     1–3  Destroy by Stat ≤ / ≥ Amount, read the way combat reads it (buffs
          count), on the chosen side; heroes / walls / the caster never caught;
     4–5  Destroy by Type — element, "…or element", faction; an EMPTY filter is
          a no-op, never a wipe;
     6    a "cannot be destroyed" ward and an enemy Spellshield are honoured;
     7    the editor: each box shows ONLY for its own effect — including the
          Fetch box, which before this round showed under every effect type
          (the gate reads input ids, and only the wrapper id was registered).
   Usage: node .gauntlet/purge-probe.mjs <candidate.html>  (needs :8787)
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import fs from 'node:fs';
const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.error('usage: purge-probe.mjs <candidate.html>'); process.exit(2); }
const html = fs.readFileSync(file, 'utf8');
if (!html.includes("eff.type === 'destroyStatMax'")) { console.log(JSON.stringify({ ok: false, missing: 'the purge effects are not in this file' })); process.exit(2); }
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
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
  await page.waitForFunction(() => typeof _applyOnPlayOne === 'function' && typeof _purgeStatOf === 'function', null, { timeout: 30000 });
  R = await page.evaluate(() => {
    const out = {}, err = {};
    const T = (k, f) => { try { out[k] = f(); } catch (e) { err[k] = String(e && e.stack || e).slice(0, 400); out[k] = false; } };
    const W = BOARD_W, H = BOARD_H;
    const board = () => Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => ({ x, y, terrain: 'plain' })));
    const side = () => ({ deck: [], hand: [], graveyard: [], void: [], energy: 9, maxEnergy: 9, hp: 30 });
    const U = (id, owner, x, y, atk, extra) => Object.assign({ id, name: id, owner, alive: true, pos: { x, y }, currentHp: 20, maxHp: 30,
      stats: { hp: 30, atk, def: 4, mag: 2, res: 2, spd: 2 }, cardId: id, elements: ['neutral'], factions: [], passives: [], statusEffects: [] }, extra || {});
    const heroes = () => [U('h_p', 'player', 1, H - 1, 1, { isHero: true, currentHp: 300, maxHp: 300 }), U('h_a', 'ai', 1, 0, 1, { isHero: true, currentHp: 300, maxHp: 300 })];
    const mk = (units) => ({ player: side(), ai: side(), board: board(), turn: 'player', turnNumber: 3, round: 2, gameOver: false, log: [], tombstones: [], weather: null, units: heroes().concat(units) });
    const run = (units, onPlay) => { const s = mk(units); App.state = s; const caster = U('caster', 'player', 6, H - 2, 1); s.units.push(caster);
      const r = _applyOnPlayOne(s, caster, { id: 'pp', name: 'Purge', type: 'spell', onPlay }); return (id) => { const u = r.units.find(x => x.id === id); return u ? u.alive : null; }; };

    T('1_stat_or_less_enemy_only', () => {
      const a = run([U('e4', 'ai', 3, 2, 4), U('e8', 'ai', 4, 2, 8), U('e4buffed', 'ai', 5, 2, 4, { statusEffects: [{ type: 'strong', turnsLeft: 2 }] }), U('a3', 'player', 3, H - 3, 3)],
        { type: 'destroyStatMax', amount: 5, purgeStat: 'atk' });
      out._1 = { e4: a('e4'), e8: a('e8'), e4buffed: a('e4buffed'), a3: a('a3'), hero: a('h_a'), caster: a('caster') };
      /* Strong is +4 ATK, so the buffed 4 reads 8 — combat-effective, not printed */
      return a('e4') === false && a('e8') === true && a('e4buffed') === true && a('a3') === true && a('h_a') === true && a('caster') === true;
    });
    T('2_stat_or_more', () => {
      const a = run([U('e4', 'ai', 3, 2, 4), U('e8', 'ai', 4, 2, 8), U('e9', 'ai', 5, 2, 9)], { type: 'destroyStatMin', amount: 8, purgeStat: 'atk' });
      return a('e4') === true && a('e8') === false && a('e9') === false;
    });
    T('3_current_hp_and_sides', () => {
      const a = run([U('ehurt', 'ai', 3, 2, 5, { currentHp: 3 }), U('ehale', 'ai', 4, 2, 5), U('ahurt', 'player', 3, H - 3, 5, { currentHp: 2 })], { type: 'destroyStatMax', amount: 5, purgeStat: 'hp', purgeSide: 'both' });
      const b = run([U('ehurt', 'ai', 3, 2, 5, { currentHp: 3 }), U('ahurt', 'player', 3, H - 3, 5, { currentHp: 2 })], { type: 'destroyStatMax', amount: 5, purgeStat: 'hp', purgeSide: 'ally' });
      return a('ehurt') === false && a('ehale') === true && a('ahurt') === false && b('ehurt') === true && b('ahurt') === false;
    });
    T('4_by_type_element_or_element_and_faction', () => {
      const a = run([U('fire', 'ai', 3, 2, 5, { elements: ['fire'] }), U('ice', 'ai', 4, 2, 5, { elements: ['ice'] }), U('water', 'ai', 5, 2, 5, { elements: ['water'] })],
        { type: 'destroyMatching', filter: { element: 'fire', element2: 'ice' } });
      const fac = (typeof FACTIONS !== 'undefined' && FACTIONS[0]) ? FACTIONS[0].id : 'beast';
      const b = run([U('inFac', 'ai', 3, 2, 5, { factions: [fac] }), U('noFac', 'ai', 4, 2, 5)], { type: 'destroyMatching', filter: { faction: fac } });
      out._4 = { fire: a('fire'), ice: a('ice'), water: a('water'), fac, inFac: b('inFac'), noFac: b('noFac') };
      return a('fire') === false && a('ice') === false && a('water') === true && b('inFac') === false && b('noFac') === true;
    });
    T('5_empty_filter_is_a_no_op', () => {
      const a = run([U('x', 'ai', 3, 2, 5), U('y', 'ai', 4, 2, 5)], { type: 'destroyMatching', filter: { element: 'any', faction: 'any', costMode: 'exact' } });
      return a('x') === true && a('y') === true;
    });
    T('6_wards_are_honoured', () => {
      const a = run([U('shield', 'ai', 3, 2, 2, { passives: ['spellshield'] }), U('plain', 'ai', 4, 2, 2)], { type: 'destroyStatMax', amount: 5, purgeStat: 'atk' });
      return a('shield') === true && a('plain') === false;
    });
    T('7_text', () => /with ATK 5 or less your opponent controls/.test(_purgeWhat({ type: 'destroyStatMax', amount: 5, purgeStat: 'atk' }))
      && /Fire or Ice/.test(_purgeWhat({ type: 'destroyMatching', filter: { element: 'fire', element2: 'ice' } })));

    /* 8. the editor: every box shows ONLY for its own effect */
    T('8_editor_boxes_gate_to_their_effect', () => {
      const card = { id: 'pp_card', name: 'Purge Test', type: 'spell', cost: 2, onPlay: { type: 'destroyStatMax', amount: 4, purgeStat: 'def', purgeSide: 'both' } };
      Forge.customCards = (Forge.customCards || []).filter(c => c.id !== card.id).concat([card]);
      const host = document.createElement('div'); document.body.appendChild(host);
      App.editingCardId = card.id; host.innerHTML = renderCardEditor();
      try { bindCardEditor(); } catch (e) {}
      const vis = (id) => { const el = document.getElementById(id); if (!el) return null; let n = el; while (n && n !== host) { if (getComputedStyle(n).display === 'none') return false; n = n.parentElement; } return true; };
      const set = (t) => { const sel = document.getElementById('ed-onplay-type'); sel.value = t; _fxApplyEffectGate(); };
      const seeded = document.getElementById('ed-onplay-purgestat').value === 'def' && document.getElementById('ed-onplay-purgeside').value === 'both';
      const r = {};
      set('destroyStatMax'); r.statMax = { stat: vis('ed-onplay-purgestat'), side: vis('ed-onplay-purgeside'), fetch: vis('ed-onplay-fz-deck') };
      set('destroyMatching'); r.match = { stat: vis('ed-onplay-purgestat'), side: vis('ed-onplay-purgeside'), fetch: vis('ed-onplay-fz-deck') };
      set('fetchCard'); r.fetch = { stat: vis('ed-onplay-purgestat'), side: vis('ed-onplay-purgeside'), fetch: vis('ed-onplay-fz-deck') };
      set('drawCards'); r.draw = { stat: vis('ed-onplay-purgestat'), side: vis('ed-onplay-purgeside'), fetch: vis('ed-onplay-fz-deck') };
      set('destroyStatMax'); document.getElementById('ed-onplay-purgestat').value = 'hp';
      card.onPlay.type = 'destroyStatMax'; _fxCapturePurge(card);
      host.remove(); Forge.customCards = Forge.customCards.filter(c => c.id !== card.id);
      out._8 = { seeded, ...r, saved: card.onPlay.purgeStat };
      return seeded && r.statMax.stat && r.statMax.side && !r.statMax.fetch
        && !r.match.stat && r.match.side && !r.match.fetch
        && !r.fetch.stat && !r.fetch.side && r.fetch.fetch
        && !r.draw.stat && !r.draw.side && !r.draw.fetch && card.onPlay.purgeStat === 'hp';
    });
    App.state = null;
    return { out, err };
  });
} catch (e) {
  console.error(JSON.stringify({ ok: false, error: String(e), pageErrors }));
  await browser.close(); process.exit(2);
}
await browser.close();
const fails = Object.keys(R.out).filter(k => !k.startsWith('_') && R.out[k] !== true);
console.log(JSON.stringify({ ok: !fails.length, fails, errors: R.err, detail: Object.fromEntries(Object.entries(R.out).filter(([k]) => k.startsWith('_'))), pageErrors: pageErrors.slice(0, 5) }, null, 1));
process.exit(fails.length ? 1 : 0);
