/* ══════════════════════════════════════════════════════════════════════════
   WEATHER EXPANSION PROBE (v178). Owner: "Do them all, I want them all" —
   fourteen new weathers, plus Oil Fire Storm, whose card promised Fire +50% and
   a 3 HP burn and whose gameplay was never coded.
   Drives the REAL engine, never a copy of the rules:
     calculateDamage (aiExpectedValue — no dice), getMoveRange,
     isEffectivelyFlying, applyStatusEffect, getEffectiveCardCost, startTurn,
     processTombstoneDrops, executeMove.
   Every check is an A/B against the SAME call with no weather, so a pass
   means the weather moved the number and nothing else did.
   Usage: node .gauntlet/weather-probe.mjs <candidate.html>  (needs :8787)
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import fs from 'node:fs';
const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.error('usage: weather-probe.mjs <candidate.html>'); process.exit(2); }
const html = fs.readFileSync(file, 'utf8');
if (!html.includes('WX_EXT')) { console.log(JSON.stringify({ ok: false, missing: 'the weather expansion is not in this file' })); process.exit(2); }
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
  await page.waitForFunction(() => typeof WX_EXT === 'object' && typeof startTurn === 'function' && typeof calculateDamage === 'function', null, { timeout: 30000 });
  R = await page.evaluate(() => {
    const out = {}, err = {};
    const W = BOARD_W, H = BOARD_H;
    const WX = (t, n) => t ? { weatherType: t, turnsLeft: n == null ? 3 : n, ownerHint: 'player' } : null;
    const board = () => Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => ({ x, y, terrain: 'plain' })));
    const side = () => ({ deck: [], hand: [], graveyard: [], void: [], energy: 3, maxEnergy: 3, hp: 30 });
    const stats = () => ({ hp: 40, atk: 10, def: 4, mag: 10, res: 4, spd: 3 });
    const u = (id, owner, x, y, extra) => Object.assign({ id, name: id, owner, alive: true, pos: { x, y }, currentHp: 30, maxHp: 40, stats: stats(), elements: ['neutral'], element: 'neutral', statusEffects: [] }, extra || {});
    const mk = (w, units) => ({ player: side(), ai: side(), board: board(), turn: 'ai', turnNumber: 4, round: 2, gameOver: false, log: [], tombstones: [], weather: w, units });
    const dmg = (move, a, d, w) => calculateDamage(move, a, d, w, { aiExpectedValue: true }).damage;
    const T = (k, f) => { try { out[k] = f(); } catch (e) { err[k] = String(e && e.stack || e).slice(0, 300); out[k] = false; } };
    const A = u('A', 'player', 5, 6), D = u('D', 'ai', 5, 5), Dfar = u('D', 'ai', 5, 2);
    const mv = (el, type) => ({ id: 'probe', name: 'Probe', kind: 'attack', power: 40, element: el, type: type || 'magic', accuracy: 100, cost: 0, range: 6 });
    const ratio = (m, w, a, d) => dmg(m, a || A, d || D, WX(w)) / Math.max(1, dmg(m, a || A, d || D, null));

    /* 1. damage */
    T('oil_fire_x1_5', () => { const r = ratio(mv('fire'), 'oilstorm'); out._oil = r; return r > 1.35 && r < 1.65; });
    T('blizzard_ice_up_fire_down', () => ratio(mv('ice'), 'blizzard') > 1.35 && ratio(mv('fire'), 'blizzard') < 0.65);
    T('every_elem_row_moves_dmg', () => { const bad = []; for (const k in WX_EXT) { const el = WX_EXT[k].elem || {}; for (const e in el) { /* relative to a neutral move under the SAME weather, so a weather that also moves DEF (Iron Rain) is not read as cutting the element */ const r = ratio(mv(e), k) / ratio(mv('neutral'), k); if (el[e] > 1 ? r <= 1.05 : r >= 0.95) bad.push(k + ':' + e + '=' + r.toFixed(2)); } } out._elemBad = bad; return !bad.length; });
    T('unboosted_elem_untouched', () => Math.abs(ratio(mv('neutral'), 'blizzard') - 1) < 0.001);
    T('manaSurge_phys_down', () => ratio(mv('neutral', 'physical'), 'manaSurge') < 0.95 && Math.abs(ratio(mv('neutral', 'magic'), 'manaSurge') - 1) < 0.001);
    T('ironRain_def_up', () => ratio(mv('neutral', 'physical'), 'ironRain') < 0.99);
    T('hurricane_ranged_acc', () => ratio(mv('neutral'), 'hurricane', A, Dfar) < 0.9 && Math.abs(ratio(mv('neutral'), 'hurricane', A, D) - 1) < 0.001);
    T('ironRain_flyer_acc', () => ratio(mv('neutral', 'magic'), 'ironRain', { ...A, flying: true }, D) < ratio(mv('neutral', 'magic'), 'ironRain', A, D));
    T('prismatic_strongest', () => { const a = { ...A, elements: ['fire', 'water'], element: 'fire' }, d = { ...D, elements: ['fire'], element: 'fire' };
      /* fire into fire resists, water into fire is super — the storm should pick water */
      return dmg(mv('fire'), a, d, WX('prismaticStorm')) > dmg(mv('fire'), a, d, null); });

    /* 2. movement + flight */
    const range = (x) => Array.isArray(x) ? x.length : (typeof x === 'number' ? x : (x && x.size) || JSON.stringify(x).length);
    T('blizzard_move_down', () => range(getMoveRange(A, WX('blizzard'))) < range(getMoveRange(A, null)));
    T('gravityWell_move_down', () => range(getMoveRange(A, WX('gravityWell'))) < range(getMoveRange(A, null)));
    T('gale_flyer_move_up', () => { App.state = mk(WX('gale'), [A, D]); const f = { ...A, flying: true }; const r1 = range(getMoveRange(f, WX('gale'))); App.state = mk(null, [A, D]); return r1 > range(getMoveRange(f, null)); });
    T('monsoon_water_move_down', () => { const s = mk(WX('monsoonFlood'), [A, D]); _setSurface(s, A.pos.x, A.pos.y, 'water', 3); App.state = s; const r1 = range(getMoveRange(A, s.weather)); const s2 = mk(WX('monsoonFlood'), [A, D]); App.state = s2; return r1 < range(getMoveRange(A, s2.weather)); });
    T('hurricane_grounds', () => { App.state = mk(WX('hurricane'), [A]); const g = isEffectivelyFlying({ ...A, flying: true }); App.state = mk(null, [A]); return g === false && isEffectivelyFlying({ ...A, flying: true }) === true; });

    /* 3. statuses */
    const turnsOf = (un) => { const e = (un.statusEffects || [])[0]; return e ? (e.turnsLeft != null ? e.turnsLeft : (e.turns != null ? e.turns : e.duration)) : null; };
    T('voidTide_no_status', () => { App.state = mk(WX('voidTide'), [A]); const r = applyStatusEffect({ ...A, statusEffects: [] }, 'burn', 2, null); App.state = mk(null, [A]); const c = applyStatusEffect({ ...A, statusEffects: [] }, 'burn', 2, null); return (r.statusEffects || []).length === 0 && (c.statusEffects || []).length === 1; });
    T('miasma_status_plus1', () => { App.state = mk(WX('miasma'), [A]); const r = turnsOf(applyStatusEffect({ ...A, statusEffects: [] }, 'burn', 2, null)); App.state = mk(null, [A]); const c = turnsOf(applyStatusEffect({ ...A, statusEffects: [] }, 'burn', 2, null)); out._miasma = [r, c]; return r === c + 1; });
    T('miasma_heal_half', () => _wxHeal(8, WX('miasma')) === 4 && _wxHeal(8, null) === 8);

    /* 4. cost */
    T('manaSurge_spell_minus1', () => { const card = { id: 'p_spell', name: 'Probe Spell', type: 'spell', cost: 3 }; const a = getEffectiveCardCost(card, mk(WX('manaSurge'), [A]), 'player'); const b = getEffectiveCardCost(card, mk(null, [A]), 'player'); const unit = { id: 'p_u', type: 'unit', cost: 3 }; return a === b - 1 && getEffectiveCardCost(unit, mk(WX('manaSurge'), [A]), 'player') === getEffectiveCardCost(unit, mk(null, [A]), 'player'); });

    /* 5. the turn tick — the real startTurn */
    const hpAfter = (w, un, who) => { const s = mk(WX(w, 3), [u('HP', 'player', 1, H - 1, { isHero: true, currentHp: 300, maxHp: 300 }), u('HA', 'ai', 1, 0, { isHero: true, currentHp: 300, maxHp: 300 }), un]); App.state = s; const r = startTurn(s, who || 'player'); return (r.units.find(x => x.id === un.id) || {}).currentHp; };
    T('oil_burns_3', () => { const a = hpAfter('oilstorm', u('B', 'player', 3, 6)), b = hpAfter(null, u('B', 'player', 3, 6)); out._oilHp = [a, b]; return a === b - 3; });
    T('oil_spares_fire', () => hpAfter('oilstorm', u('B', 'player', 3, 6, { elements: ['fire'], element: 'fire' })) === hpAfter(null, u('B', 'player', 3, 6, { elements: ['fire'], element: 'fire' })));
    T('aurora_heal_5', () => hpAfter('aurora', u('B', 'player', 3, 6)) === hpAfter(null, u('B', 'player', 3, 6)) + 5);
    T('bloom_heal_8', () => hpAfter('verdantBloom', u('B', 'player', 3, 6)) === hpAfter(null, u('B', 'player', 3, 6)) + 8);
    T('manaSurge_energy', () => { const f = (w) => { const s = mk(WX(w), [u('HP', 'player', 1, H - 1, { isHero: true })]); App.state = s; return startTurn(s, 'player').player.energy; }; out._energy = [f('manaSurge'), f(null)]; return f('manaSurge') === f(null) + 1; });
    T('hurricane_pushes', () => { const s = mk(WX('hurricane'), [u('HP', 'player', 0, H - 1, { isHero: true }), u('B', 'player', 2, 2)]); App.state = s; const r = startTurn(s, 'player'); const b = r.units.find(x => x.id === 'B'); return !!b && (b.pos.x !== 2 || b.pos.y !== 2 || b.currentHp < 30); });
    T('hurricane_eye_calm', () => { const cx = Math.floor(W / 2), cy = Math.floor(H / 2); const s = mk(WX('hurricane'), [u('HP', 'player', 0, H - 1, { isHero: true }), u('B', 'player', cx, cy)]); App.state = s; const b = startTurn(s, 'player').units.find(x => x.id === 'B'); return b.pos.x === cx && b.pos.y === cy && b.currentHp === 30; });
    T('flood_spreads', () => { const s = mk(WX('monsoonFlood'), [u('HP', 'player', 0, H - 1, { isHero: true })]); _setSurface(s, 4, 4, 'water', 4); App.state = s; const r = startTurn(s, 'player'); let n = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const sf = _surfaceAt(r, x, y); if (sf && sf.type === 'water') n++; } out._flood = n; return n > 1; });
    T('prismatic_shifts_and_restores', () => {
      const s = mk(WX('prismaticStorm', 3), [u('HP', 'player', 0, H - 1, { isHero: true }), u('B', 'player', 3, 3, { elements: ['earth'], element: 'earth' })]);
      App.state = s; let r = startTurn(s, 'player'); const b = r.units.find(x => x.id === 'B');
      const stamped = !!(b._wxOrigElements && b._wxOrigElements[0] === 'earth');
      r = { ...r, weather: { ...r.weather, turnsLeft: 1 } }; App.state = r; const r2 = startTurn(r, 'player'); const b2 = r2.units.find(x => x.id === 'B');
      out._prism = { stamped, after: b2.elements, weather: r2.weather };
      return stamped && !r2.weather && b2.elements[0] === 'earth' && !b2._wxOrigElements; });
    T('blizzard_freezes_idle', () => { let froze = 0; for (let i = 0; i < 40; i++) { const s = mk(WX('blizzard'), [u('HP', 'player', 0, H - 1, { isHero: true }), u('I', 'ai', 3, 3, { hasMoved: false })]); App.state = s; const r = startTurn(s, 'player'); if ((r.units.find(x => x.id === 'I').statusEffects || []).some(e => e && (e.type || e.id) === 'frozen')) froze++; } out._froze = froze; return froze > 0 && froze < 40; });
    T('aurora_reveals_traps', () => { const s = mk(WX('aurora'), [u('HP', 'player', 0, H - 1, { isHero: true })]); s.board[3][3].trap = { id: 'p', owner: 'ai', revealed: false }; App.state = s; const r = startTurn(s, 'player'); return !!(r.board[3][3].trap && r.board[3][3].trap.revealed); });

    /* 6. Spirit Veil — the real death sweep */
    T('spiritVeil_first_death_returns', () => { const s = mk(WX('spiritVeil'), [u('V1', 'player', 3, 3, { alive: false, currentHp: 0 }), u('V2', 'player', 4, 3, { alive: false, currentHp: 0 })]); App.state = s; processTombstoneDrops(s);
      const a = s.units.filter(x => x.alive && x.currentHp === 1).length; out._veil = a; return a === 1; });
    T('spiritVeil_off_no_return', () => { const s = mk(null, [u('V1', 'player', 3, 3, { alive: false, currentHp: 0 })]); App.state = s; processTombstoneDrops(s); return !s.units[0].alive; });

    /* 7. Resonance splash + Gravity Well pins knockback — the real executeMove.
       An attack can MISS (accuracy / dodge are Math.random), and a missed control
       swing reads as 'no knockback' — so the dice are fixed at 0.5 (always hits, never
       crits) for these two, and restored after. Found by a flake on 2026-09-19. */
    const _rnd = Math.random; Math.random = () => 0.5;
    T('resonance_splash', () => { const f = (w) => { const s = mk(WX(w), [u('HP', 'player', 0, H - 1, { isHero: true }), A, D, u('N', 'ai', 6, 5)]); App.state = s; const r = executeMove(s, A, D, mv('neutral')); return (r.units.find(x => x.id === 'N') || {}).currentHp; };
      out._res = [f('resonance'), f(null)]; return f('resonance') < f(null); });
    T('gravityWell_pins', () => { const f = (w) => { const s = mk(WX(w), [u('HP', 'player', 0, H - 1, { isHero: true }), A, D]); App.state = s; const r = executeMove(s, A, D, { ...mv('neutral'), knockback: 2 }); return JSON.stringify((r.units.find(x => x.id === 'D') || {}).pos); };
      out._kb = [f('gravityWell'), f(null)]; return f('gravityWell') === JSON.stringify(D.pos) && f(null) !== JSON.stringify(D.pos); });

    Math.random = _rnd;
    /* 8. the catalogue: cards, icons, presets, VFX, editor list */
    const NEW = ['blizzard','hurricane','gale','miasma','aurora','gravityWell','voidTide','resonance','spiritVeil','verdantBloom','manaSurge','ironRain','monsoonFlood','prismaticStorm'];
    T('catalogue_complete', () => { const miss = NEW.filter(k => !WEATHER_CARDS.some(c => c.weatherType === k) || !WX_EXT[k] || !_WX_PRESETS[k] || !_WX_TYPE_DEFAULT[k] || !WEATHER_ICON_EMOJI[k]); out._miss = miss; return !miss.length; });
    T('no_duplicate_card_ids', () => new Set(WEATHER_CARDS.map(c => c.id)).size === WEATHER_CARDS.length);
    App.state = null;
    return { out, err };
  });
  /* 9. 🌦 THE WEATHER ATLAS (src/weather/atlas.js) — the VFX, driven directly
     (the Browser pane's RAF is throttled, so frames are drawn by hand). */
  await page.waitForFunction(() => !!window.MythicWeatherAtlas, null, { timeout: 20000 });
  const AT = await page.evaluate(() => {
    const out = {}, err = {};
    const T = (k, f) => { try { out[k] = f(); } catch (e) { err[k] = String(e && e.stack || e).slice(0, 300); out[k] = false; } };
    const M = window.MythicWeatherAtlas;
    const types = [...new Set(WEATHER_CARDS.map(c => c.weatherType))].filter(t => t && t !== 'custom');
    T('atlas_covers_every_card_weather', () => { const miss = types.filter(t => !M.has(t)); out._atlasMiss = miss; return !miss.length && types.length >= 24; });
    /* every look draws something, and no two look alike */
    const sig = {}, ms = {};
    T('atlas_every_look_draws', () => {
      const bad = [];
      for (const t of types) {
        const c = document.createElement('canvas'); c.width = 400; c.height = 225;
        const t0 = performance.now(); M.drawInto(c, t, 1.5); ms[t] = +(performance.now() - t0).toFixed(1);
        const d = c.getContext('2d').getImageData(0, 0, 400, 225).data; let n = 0, h = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) { n++; h = (h * 31 + d[i - 3] + d[i - 2] * 7 + d[i - 1] * 13) | 0; }
        sig[t] = n + ':' + h; if (n < 400) bad.push(t + '=' + n);
      }
      out._atlasBlank = bad; return !bad.length; });
    T('atlas_looks_distinct', () => new Set(Object.values(sig)).size === types.length);
    out._atlasMs = ms;
    /* the resolver: Atlas default, old picks yield, '!' picks and 'none' win, custom untouched */
    T('atlas_resolver_rules', () => {
      const keep = Forge.weatherVfx;
      Forge.weatherVfx = { rain: 'RAIN', sand: '!SAND', eclipse: 'none', custom: 'SLICK' };
      const r = { rain: _resolveWeatherVfxId('rain'), sand: _resolveWeatherVfxId('sand'), eclipse: _resolveWeatherVfxId('eclipse'), custom: _resolveWeatherVfxId('custom'), blizzard: _resolveWeatherVfxId('blizzard') };
      _wxVfxStore('mist', 'STORM'); const stored = Forge.weatherVfx.mist; _wxVfxStore('mist', 'ATLAS'); const cleared = !('mist' in Forge.weatherVfx);
      Forge.weatherVfx = keep; out._resolver = { ...r, stored, cleared };
      return r.rain === 'ATLAS' && r.sand === 'SAND' && r.eclipse === 'none' && r.custom === 'SLICK' && r.blizzard === 'ATLAS' && stored === '!STORM' && cleared; });
    /* mount → one canvas, switching weather re-uses it, unmount removes it */
    T('atlas_mount_cycle', () => {
      const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:420px'; document.body.appendChild(host);
      M.mount(host, 'hurricane'); const one = host.querySelectorAll('canvas.wxatlas-canvas').length; const c1 = host.querySelector('canvas');
      M.mount(host, 'blizzard'); const same = host.querySelector('canvas') === c1 && M.active === 'blizzard';
      M.unmount(); const gone = !host.querySelector('canvas') && M.active === null; host.remove();
      return one === 1 && same && gone && c1.style.pointerEvents === 'none'; });
    /* the REAL coordinator: a live weather mounts the Atlas on the board, clearing it takes it down */
    T('atlas_via_weatherVfxTick', () => {
      const keepScreen = App.screen, keepState = App.state;
      let area = document.querySelector('.board-area'), made = false;
      if (!area) { area = document.createElement('div'); area.className = 'board-area'; area.style.cssText = 'position:relative;width:600px;height:400px'; document.body.appendChild(area); made = true; }
      App.screen = 'battle'; App.state = { weather: { weatherType: 'monsoonFlood', turnsLeft: 3 }, units: [], player: {}, ai: {} };
      _weatherVfxTick();
      const on = !!document.querySelector('.board-area canvas.wxatlas-canvas') && M.active === 'monsoonFlood' && !_WXR.on && !_HWX.on;
      App.state = { ...App.state, weather: null }; _weatherVfxTick();
      const off = !document.querySelector('canvas.wxatlas-canvas') && M.active === null;
      App.screen = keepScreen; App.state = keepState; if (made) area.remove();
      out._tick = { on, off }; return on && off; });
    /* the Forge picker (owner's screenshot): every Atlas look is offered by name */
    if (typeof _WX_ATLAS_LOOKS !== 'undefined') {
      T('atlas_looks_in_picker', () => {
        const card = { id: 'wxp_card', name: 'Probe Weather', type: 'weather', cost: 2, weatherType: 'eclipse', duration: 4 };
        Forge.customCards = (Forge.customCards || []).filter(c => c.id !== card.id).concat([card]);
        const host = document.createElement('div'); document.body.appendChild(host);
        App.editingCardId = card.id; host.innerHTML = renderCardEditor();
        const sel = host.querySelector('#ed-weather-vfx'), vals = sel ? [...sel.options].map(o => o.value) : [];
        const looks = vals.filter(v => v.indexOf('ATLAS:') === 0);
        const need = types.filter(t => !looks.includes('ATLAS:' + t));
        out._picker = { looks: looks.length, selected: sel && sel.value, missing: need };
        host.remove(); Forge.customCards = Forge.customCards.filter(c => c.id !== card.id);
        return looks.length === 24 && !need.length && vals.includes('ATLAS') && sel.value === 'ATLAS'; });
      T('atlas_custom_wears_any_look', () => {
        const keep = Forge.weatherVfx, keepScreen = App.screen, keepState = App.state;
        Forge.weatherVfx = { custom: 'ATLAS:hurricane', eclipse: '!ATLAS:blizzard' };
        const r = [_resolveWeatherVfxId('custom'), _resolveWeatherVfxId('eclipse'), _wxVfxPickerValue('eclipse')];
        let area = document.querySelector('.board-area'), made = false;
        if (!area) { area = document.createElement('div'); area.className = 'board-area'; area.style.cssText = 'position:relative;width:600px;height:400px'; document.body.appendChild(area); made = true; }
        App.screen = 'battle'; App.state = { weather: { weatherType: 'custom', turnsLeft: 3 }, units: [], player: {}, ai: {} };
        _weatherVfxTick(); const on = !!document.querySelector('canvas.wxatlas-canvas');
        App.state = { ...App.state, weather: null }; _weatherVfxTick();
        _wxVfxStore('rain', 'ATLAS:rain'); const ownIsDefault = !('rain' in Forge.weatherVfx);
        Forge.weatherVfx = keep; App.screen = keepScreen; App.state = keepState; if (made) area.remove();
        out._looks = { r, on, ownIsDefault };
        return r[0] === 'ATLAS:hurricane' && r[1] === 'ATLAS:blizzard' && r[2] === 'ATLAS:blizzard' && on && ownIsDefault; });
    }
    /* the contact sheet: every look over a dark board-ish backdrop */
    const W = 6, cw = 320, ch = 180, sheet = document.createElement('canvas'); sheet.width = W * cw; sheet.height = Math.ceil(types.length / W) * (ch + 22);
    const sg = sheet.getContext('2d'); sg.fillStyle = '#0d1219'; sg.fillRect(0, 0, sheet.width, sheet.height);
    types.forEach((t, i) => { const x = (i % W) * cw, y = Math.floor(i / W) * (ch + 22); const c = document.createElement('canvas'); c.width = cw; c.height = ch;
      const bg = sg.createLinearGradient(0, y, 0, y + ch); bg.addColorStop(0, '#1d2733'); bg.addColorStop(1, '#2a3526'); sg.fillStyle = bg; sg.fillRect(x + 2, y + 2, cw - 4, ch - 4);
      M.drawInto(c, t, 2.2); sg.drawImage(c, x + 2, y + 2, cw - 4, ch - 4); sg.fillStyle = '#e6edf3'; sg.font = '13px system-ui'; sg.fillText(t, x + 8, y + ch + 16); });
    out._sheet = sheet.toDataURL('image/png');
    return { out, err };
  });
  const sheet = AT.out._sheet; delete AT.out._sheet;
  if (sheet && process.env.WX_SHEET) fs.writeFileSync(process.env.WX_SHEET, Buffer.from(sheet.split(',')[1], 'base64'));
  Object.assign(R.out, AT.out); Object.assign(R.err, AT.err);
} catch (e) {
  console.error(JSON.stringify({ ok: false, error: String(e), pageErrors }));
  await browser.close(); process.exit(2);
}
await browser.close();
const fails = Object.keys(R.out).filter(k => !k.startsWith('_') && R.out[k] !== true);
console.log(JSON.stringify({ ok: !fails.length, fails, errors: R.err, detail: Object.fromEntries(Object.entries(R.out).filter(([k]) => k.startsWith('_'))), pageErrors: pageErrors.slice(0, 5) }, null, 1));
process.exit(fails.length ? 1 : 0);
