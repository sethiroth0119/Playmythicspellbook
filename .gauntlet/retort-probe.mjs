/* ══════════════════════════════════════════════════════════════════════════
   RETORT ROUND PROBE (2026-09-19). Owner, three asks:
     A. "call or summon trigger — When a x is summoned or called on your side
        of the field destroy a unit your enemy controls";
     B. "a passive where when the unit is attacked status effects is given to
        the attacking unit or hero. Like burn, stunned, frozen";
     C. "replace the Emojis with these VFX … placed on the unit/hero that has
        the Status Effect … fit the tile only".
   Drives the REAL _fireTriggers → _applyTriggerEffect → _applyOnPlayOne chain,
   the REAL executeMove, the REAL card editor (render → bind → capture), and the
   served assets + stylesheet. A/B wherever there is a "without" to compare.
   RTP_SHOT=<png> writes a picture of real tiles wearing the VFX.
   Usage: node .gauntlet/retort-probe.mjs <candidate.html>  (needs :8787)
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import fs from 'node:fs';
const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.error('usage: retort-probe.mjs <candidate.html>'); process.exit(2); }
const html = fs.readFileSync(file, 'utf8');
if (!html.includes('RETORT_PREFIX')) { console.log(JSON.stringify({ ok: false, missing: 'the retort round is not in this file' })); process.exit(2); }
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
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
  await page.waitForFunction(() => typeof executeMove === 'function' && typeof _fireTriggers === 'function' && typeof _statusFxHtml === 'function', null, { timeout: 30000 });
  R = await page.evaluate(async () => {
    const out = {}, err = {};
    const T = async (k, f) => { try { out[k] = await f(); } catch (e) { err[k] = String(e && e.stack || e).slice(0, 400); out[k] = false; } };
    const W = BOARD_W, H = BOARD_H;
    const board = () => Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => ({ x, y, terrain: 'plain' })));
    const side = () => ({ deck: [], hand: [], graveyard: [], void: [], energy: 9, maxEnergy: 9, hp: 30 });
    const stats = { hp: 40, atk: 10, def: 4, mag: 4, res: 4, spd: 2 };
    const U = (id, name, owner, x, y, extra) => Object.assign({ id, name, owner, alive: true, pos: { x, y }, currentHp: 40, maxHp: 40, stats, cardId: id, elements: ['neutral'], passives: [], statusEffects: [] }, extra || {});
    const heroes = () => [U('h_p', 'Hero', 'player', 1, H - 1, { isHero: true, currentHp: 300, maxHp: 300 }), U('h_a', 'AI Hero', 'ai', 1, 0, { isHero: true, currentHp: 300, maxHp: 300 })];
    const mk = (turn, units) => ({ player: side(), ai: side(), board: board(), turn, turnNumber: 3, round: 2, gameOver: false, log: [], tombstones: [], weather: null, units: heroes().concat(units || []) });
    const hit = { id: 'rtp', name: 'Strike', kind: 'attack', power: 12, element: 'neutral', type: 'physical', accuracy: 100, cost: 0, range: 1 };
    const has = (u, id) => (u.statusEffects || []).some(e => e && e.type === id);

    /* ── B. the retort passives ── */
    await T('B1_family_registered_harmful_only', () => {
      const ids = Object.keys(PASSIVES).filter(k => k.indexOf(RETORT_PREFIX) === 0);
      out._b1 = ids.length;
      return ids.length >= 30 && !!PASSIVES.retort_burn && !!PASSIVES.retort_stun && !!PASSIVES.retort_frozen
        && !PASSIVES.retort_strong && !PASSIVES.retort_shielded && !PASSIVES.retort_knockback && /attacker/.test(PASSIVES.retort_burn.desc);
    });
    const _rnd = Math.random; Math.random = () => 0.5;   // an attack can miss — fix the dice
    try {
      await T('B2_attacker_gets_the_statuses', () => {
        const run = (passives) => {
          const s = mk('player', [U('atk', 'Brute', 'player', 4, 5), U('def', 'Ember Knight', 'ai', 4, 4, { passives })]);
          App.state = s;
          return executeMove(s, s.units.find(u => u.id === 'atk'), s.units.find(u => u.id === 'def'), hit).units.find(u => u.id === 'atk');
        };
        const a = run(['retort_burn', 'retort_stun']), b = run([]);
        const st = (id) => (a.statusEffects || []).find(e => e.type === id);
        out._b2 = { with: (a.statusEffects || []).map(e => e.type + ':' + (e.turnsLeft != null ? e.turnsLeft : e.duration)), without: (b.statusEffects || []).map(e => e.type) };
        return has(a, 'burn') && has(a, 'stun') && !(b.statusEffects || []).length;
      });
      await T('B3_a_hero_attacker_is_retorted_too', () => {
        const s = mk('player', [U('def', 'Frost Warden', 'ai', 1, H - 2, { passives: ['retort_frozen'] })]);
        App.state = s;
        const hero = s.units.find(u => u.id === 'h_p');
        return has(executeMove(s, hero, s.units.find(u => u.id === 'def'), hit).units.find(u => u.id === 'h_p'), 'frozen');
      });
    } finally { Math.random = _rnd; }

    /* ── A. "when a X is summoned or called on your side, destroy an enemy unit" ── */
    const TRG = { id: 'trg_rtp', name: 'Demon Call', event: 'summon', who: 'owner', effect: 'destroyTarget', whenFilter: { nameIncludes: 'Savage Demon' } };
    await T('A1_ai_side_summon_destroys_a_far_player_unit', () => {
      const run = (arrivalName) => {
        const s = mk('ai', [U('watch', 'Demon Shrine', 'ai', 6, 1, { triggers: [TRG] }), U('far', 'Knight', 'player', 7, H - 2), U('arr', arrivalName, 'ai', 5, 1)]);
        App.state = s;
        return _fireTriggers(s, 'summon', { actorOwner: 'ai', unit: s.units.find(u => u.id === 'arr'), fromZone: 'hand' }).units.find(u => u.id === 'far');
      };
      const a = run('Savage Demon Grunt'), b = run('Goblin Scout');
      out._a1 = { savage: a.alive, goblin: b.alive };
      return a.alive === false && b.alive === true;   // six rows away — the trigger reaches anywhere
    });
    await T('A2_enemy_side_summon_does_not_fire_owner_trigger', () => {
      const s = mk('ai', [U('watch', 'Demon Shrine', 'ai', 6, 1, { triggers: [TRG] }), U('far', 'Knight', 'player', 7, H - 2), U('arr', 'Savage Demon Grunt', 'player', 5, H - 2)]);
      App.state = s;
      return _fireTriggers(s, 'summon', { actorOwner: 'player', unit: s.units.find(u => u.id === 'arr'), fromZone: 'hand' }).units.find(u => u.id === 'far').alive === true;
    });
    await T('A3_player_picks_the_target_anywhere', () => {
      const s = mk('player', [U('watch', 'Demon Shrine', 'player', 6, H - 2, { triggers: [TRG] }), U('far', 'Orc', 'ai', 7, 1), U('arr', 'Savage Demon Grunt', 'player', 5, H - 2)]);
      App.state = s;
      const r = _fireTriggers(s, 'summon', { actorOwner: 'player', unit: s.units.find(u => u.id === 'arr'), fromZone: 'hand' });
      const q = (r._pendingTargets || [])[0];
      const cands = q ? _targetCandidates(r, r.units.find(u => u.id === q.casterId), q.effect).map(u => u.id) : [];
      out._a3 = { pending: (r._pendingTargets || []).length, cands };
      return !!q && cands.includes('far') && r.units.find(u => u.id === 'far').alive === true;
    });
    await T('A4_editor_row_seeds_and_saves', () => {
      const card = { id: 'rtp_card', name: 'Demon Shrine', type: 'unit', cost: 3, stats, learnset: [{ lvl: 1, m: 'slash' }], triggers: [{ ...TRG, whenFilter: { nameIncludes: 'Savage', element: 'fire' } }] };
      Forge.customCards = (Forge.customCards || []).filter(c => c.id !== card.id).concat([card]);
      const host = document.createElement('div'); document.body.appendChild(host);
      App.editingCardId = card.id; host.innerHTML = renderCardEditor();
      try { bindCardEditor(); } catch (e) {}
      const row = host.querySelector('.trg-row .trg-wf');
      const seeded = row && host.querySelector('.trg-wf-name').value === 'Savage' && host.querySelector('.trg-wf-el').value === 'fire';
      const shown = row && getComputedStyle(row).display !== 'none';
      host.querySelector('.trg-wf-name').value = 'Savage Demon'; host.querySelector('.trg-wf-el').value = '';
      captureEditorIntoCard(card);
      const saved = card.triggers && card.triggers[0] && card.triggers[0].whenFilter;
      /* switch the event away from summon → the row hides and nothing is saved */
      host.querySelector('.trg-event').value = 'attack';
      const hidden = getComputedStyle(row).display === 'none';
      captureEditorIntoCard(card);
      const dropped = card.triggers && card.triggers[0] && card.triggers[0].whenFilter === undefined;
      host.remove(); Forge.customCards = Forge.customCards.filter(c => c.id !== card.id);
      out._a4 = { seeded: !!seeded, shown: !!shown, saved, hidden, dropped };
      return !!seeded && !!shown && saved && saved.nameIncludes === 'Savage Demon' && !saved.element && hidden && dropped;
    });

    /* ── C. status VFX on the unit ── */
    await T('C1_every_atlas_look_is_served_and_the_rest_keep_emojis', async () => {
      const bad = [];
      for (const sl of _STATUS_FX_HAVE) {
        const r = await fetch('assets/vfx/status/' + sl + '.webp', { method: 'HEAD' }).catch(() => null);
        if (!r || !r.ok) bad.push(sl);
      }
      /* statuses with no look (added at runtime, e.g. Ambush Guard) must fall back to their emoji, not a blank layer */
      const noLook = Object.keys(STATUS_EFFECTS).filter(id => !_STATUS_FX_HAVE.has(_statusFxSlug(id)));
      const fallbackOk = noLook.every(id => { const h = _statusFxHtml({ statusEffects: [{ type: id }] }, STATUS_EFFECTS[id].icon || '?'); return !/status-fx-stack/.test(h) && /unit-status/.test(h); });
      const mixed = _statusFxHtml({ statusEffects: [{ type: 'burn' }].concat(noLook.length ? [{ type: noLook[0] }] : []) }, '');
      out._c1 = { missing: bad, noLook, fallbackOk };
      return !bad.length && _STATUS_FX_HAVE.size === 58 && fallbackOk && /status-fx-stack/.test(mixed) && (!noLook.length || /unit-status/.test(mixed));
    });
    await T('C2_markup_layers_dedupes_and_caps', () => {
      const h = _statusFxHtml({ statusEffects: [{ type: 'burn' }, { type: 'stun' }, { type: 'burn' }, { type: 'poison' }, { type: 'frozen' }] }, '🔥');
      const urls = (h.match(/assets\/vfx\/status\/[a-z-]+\.webp/g) || []);
      out._c2 = urls;
      return urls.length === 3 && urls[0].endsWith('burn.webp') && urls[1].endsWith('stunned.webp') && urls[2].endsWith('poison.webp') && /title="Burn, Stunned, Poison, Frozen"/.test(h);
    });
    await T('C3_the_board_no_longer_prints_emojis', () => !/<div class="unit-status">\$\{statusIcons\}<\/div>/.test(document.documentElement.outerHTML) && typeof _statusFxHtml === 'function');
    await T('C4_layer_fits_the_tile_and_animates', () => {
      const tile = document.createElement('div'); tile.style.cssText = 'position:fixed;left:40px;top:40px;width:80px;height:80px';
      tile.innerHTML = '<div class="unit" style="position:absolute;inset:0">' + _statusFxHtml({ statusEffects: [{ type: 'burn' }] }, '🔥') + '</div>';
      document.body.appendChild(tile);
      const st = tile.querySelector('.status-fx-stack'), fx = tile.querySelector('.status-fx');
      const r = st.getBoundingClientRect(), cs = getComputedStyle(fx), ur = tile.querySelector('.unit').getBoundingClientRect(), tr = tile.getBoundingClientRect();
      out._c4 = { w: r.width, h: r.height, unitW: ur.width, anim: cs.animationName, size: cs.backgroundSize };
      /* the game's own .unit CSS sizes the piece inside its tile; the layer is exactly the piece's width, square, and never wider than the tile */
      /* computed style is LIVE — read it before the tile leaves the page */
      const ok = Math.abs(r.width - ur.width) < 1 && Math.abs(r.height - r.width) < 1 && r.width <= tr.width + 0.5 && cs.animationName === 'statusfx-loop' && /2000%/.test(cs.backgroundSize);
      tile.remove();
      return ok;
    });
    await T('C5_low_graphics_keeps_emojis', () => {
      const gs = window.getSettings; window.getSettings = () => ({ ...(gs ? gs() : {}), graphics: 'low' });
      try { return /class="unit-status">🔥</.test(_statusFxHtml({ statusEffects: [{ type: 'burn' }] }, '🔥')); } finally { window.getSettings = gs; }
    });
    /* ── D. the death hologram, REAL flow (owner: "When units die they do not do
          the new unit die hologram vfx"). Nothing stubbed but the sound's spy,
          which calls through: a unit with NO sprite and NO art dies on the live
          board, the real sweep runs, and a hologram canvas must appear and draw. */
    await T('D1_a_death_with_no_art_still_shatters', async () => {
      const played = []; const ps = window.playSfx; window.playSfx = function (id) { played.push(id); try { return ps.apply(this, arguments); } catch (e) {} };
      try {
        document.querySelectorAll('canvas.effectfx-death').forEach(c => c.remove());
        const s = mk('player', [U('rtp_dead', 'Nameless Wolf', 'ai', 4, 3, { alive: false, currentHp: 0, icon: '🐺', cardId: 'rtp_no_such_card' })]);
        App.state = s; processTombstoneDrops(App.state);
        let cv = null; for (let i = 0; i < 30 && !cv; i++) { await new Promise(r => setTimeout(r, 20)); cv = document.querySelector('canvas.effectfx-death'); }
        await new Promise(r => setTimeout(r, 600));   // mid-shatter
        let px = 0;
        if (cv && cv.isConnected) { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; for (let i = 3; i < d.length; i += 64) if (d[i] > 20) px++; }
        out._d1 = { canvas: !!cv, px, played };
        return !!cv && px > 30 && played.includes('unitDeathHolo');
      } finally { window.playSfx = ps; }
    });
    App.state = null;
    return { out, err };
  });
  if (process.env.RTP_SHOT) {
    await page.evaluate(() => {
      const ids = ['burn', 'poison', 'stun', 'frozen', 'bleed', 'sleep', 'electrified', 'shielded', 'strong', 'cursed', 'entangled', 'blessed'];
      const wrap = document.createElement('div'); wrap.id = 'rtp-shot';
      wrap.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#0f141b;padding:14px;display:grid;grid-template-columns:repeat(6,96px);gap:10px';
      const art = (Catalog.cards || []).filter(c => c && c.type === 'unit' && typeof getCardArt === 'function' && getCardArt(c.id)).slice(0, 12);
      ids.forEach((id, i) => {
        const c = art[i % Math.max(1, art.length)], src = c ? getCardArt(c.id) : '';
        const cell = document.createElement('div'); cell.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px;color:#e6edf3;font:11px system-ui';
        cell.innerHTML = '<div style="position:relative;width:96px;height:96px;background:linear-gradient(#35573a,#2a4630);border-radius:4px;overflow:hidden">'
          + '<div class="unit" style="position:absolute;inset:0">' + (src ? '<img src="' + src + '" style="position:absolute;left:18px;top:10px;width:60px;height:80px;object-fit:contain">' : '')
          + _statusFxHtml({ statusEffects: [{ type: id }] }, '') + '</div></div>' + (STATUS_EFFECTS[id] ? STATUS_EFFECTS[id].name : id);
        wrap.appendChild(cell);
      });
      document.body.appendChild(wrap);
    });
    await page.waitForTimeout(1500);
    const el = await page.$('#rtp-shot'); if (el) await el.screenshot({ path: process.env.RTP_SHOT });
  }
} catch (e) {
  console.error(JSON.stringify({ ok: false, error: String(e), pageErrors }));
  await browser.close(); process.exit(2);
}
await browser.close();
const fails = Object.keys(R.out).filter(k => !k.startsWith('_') && R.out[k] !== true);
console.log(JSON.stringify({ ok: !fails.length, fails, errors: R.err, detail: Object.fromEntries(Object.entries(R.out).filter(([k]) => k.startsWith('_'))), pageErrors: pageErrors.slice(0, 5) }, null, 1));
process.exit(fails.length ? 1 : 0);
