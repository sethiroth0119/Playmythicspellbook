/* ══════════════════════════════════════════════════════════════════════════
   WOULD-DESTROY PROBE. Owner: "If a unit would be destroyed by card effect,
   negate the use of the card effect and destroy the causer."
   Loads a candidate index.html as the real page and drives the REAL
   _wdSnapIf / _wdGuardPlayer / _wdGuardAi / tryPromptCounter /
   _battleActivateCounter / _aiAutoCounter. Checks:
     1. no answer held → no snapshot (nothing is cloned for nothing);
     2. an AI SPELL that killed your unit, answered → the unit stands again,
        the spell is spent to the AI's graveyard, your counter is spent, and
        the hero caster is NOT destroyed (negated only);
     3. the same, declined → the resolved board is put back exactly;
     4. an AI UNIT's on-play, answered → your unit stands and the causer dies;
     5. YOUR spell killed an AI unit and the AI holds the counter → the AI
        answers: its unit stands and your spell is spent;
     6. a counter WITHOUT the trigger in hand is not offered (control).
   Usage:  node .gauntlet/wouldDestroy-probe.mjs <candidate.html> [--url base]
   Needs the `public` preview server (port 8787). Exit 0 / 1 / 2.
   🔴 Against a file WITHOUT the feature it must exit 2 (the functions are
   missing) — run it on HEAD~ first to see that.
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import fs from 'node:fs';
const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.error('usage: wouldDestroy-probe.mjs <candidate.html>'); process.exit(2); }
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const BASE = arg('--url') || 'http://localhost:8787';
const html = fs.readFileSync(file, 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));
await page.route(/\/(index\.html)?(\?.*)?$/, (route) => {
  const u = new URL(route.request().url());
  if (u.pathname === '/' || u.pathname === '/index.html') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
  return route.continue();
});
let R;
try {
  await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => typeof tryPromptCounter === 'function', null, { timeout: 30000 });
  R = await page.evaluate(async () => {
    if (typeof _wdGuardPlayer !== 'function') return { missing: true };
    const out = {};
    try { renderBattle = () => {}; } catch (e) {}
    try { playSfx = () => {}; } catch (e) {}
    const W = BOARD_W, H = BOARD_H;
    const board = () => Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => ({ x, y, terrain: 'plain' })));
    const side = () => ({ deck: [], hand: [], graveyard: [], void: [], energy: 9, maxEnergy: 9, hp: 30 });
    const COUNTER = { id: 'wd_ctr', name: 'Last Stand', type: 'counter', isCounter: true, cost: 1,
      counterTriggers: ['wouldDestroy'], counterEffect: 'negate' };
    const OTHER = { id: 'atk_ctr', name: 'Parry', type: 'counter', isCounter: true, cost: 1, counterTriggers: ['attack'], counterEffect: 'negate' };
    const SPELL = { id: 'boom', name: 'Doom Bolt', type: 'spell', cost: 3, instanceId: 'iid_boom' };
    const mk = () => ({
      player: side(), ai: side(), board: board(), turn: 'ai', turnNumber: 3, round: 2, gameOver: false, log: [],
      units: [
        { id: 'h_p', name: 'Hero', owner: 'player', isHero: true, alive: true, pos: { x: 4, y: 9 }, currentHp: 300 },
        { id: 'p_knight', name: 'Knight', owner: 'player', alive: true, pos: { x: 4, y: 6 }, currentHp: 20 },
        { id: 'h_a', name: 'AI Hero', owner: 'ai', isHero: true, alive: true, pos: { x: 4, y: 0 }, currentHp: 300 },
        { id: 'a_imp', name: 'Imp', owner: 'ai', alive: true, pos: { x: 4, y: 2 }, currentHp: 12 },
      ],
    });
    const kill = (st, id) => ({ ...st, units: st.units.map(u => u.id === id ? { ...u, alive: false, currentHp: 0 } : u),
      log: [...st.log, { msg: 'killed ' + id }] });
    const alive = (st, id) => !!(st.units.find(u => u.id === id) || {}).alive;
    /* answer the window the way a click does, once it has opened */
    const clickWhenOpen = (iid) => new Promise(res => {
      const t0 = Date.now();
      const tick = () => {
        const cp = App.ui && App.ui.counterPrompt;
        if (cp) { _battleActivateCounter(iid); return res(true); }
        if (Date.now() - t0 > 4000) return res(false);
        setTimeout(tick, 20);
      };
      tick();
    });
    const declineWhenOpen = () => new Promise(res => {
      const t0 = Date.now();
      const tick = () => {
        if (App.ui && App.ui.counterPrompt) { _battleDeclineCounter(); return res(true); }
        if (Date.now() - t0 > 4000) return res(false);
        setTimeout(tick, 20);
      };
      tick();
    });
    App.ui = App.ui || {};

    /* 1 */
    { const st = mk(); out.noAnswer = _wdSnapIf(st, 'player') === null; }

    /* 2 AI spell, answered */
    { const st = mk(); st.player.hand = [{ ...COUNTER, instanceId: 'iid_c2' }]; st.ai.hand = [{ ...SPELL }];
      const pre = _wdSnapIf(st, 'player');
      App.state = kill(st, 'p_knight');
      const aiHero = App.state.units.find(u => u.id === 'h_a');
      const clicked = clickWhenOpen('iid_c2');
      const ok = await _wdGuardPlayer(pre, { attacker: 'ai', kind: 'spell', card: SPELL, source: aiHero });
      out.spell = { snap: !!pre, clicked: await clicked, ok, knight: alive(App.state, 'p_knight'), aiHero: alive(App.state, 'h_a'),
        spellInAiGrave: App.state.ai.graveyard.some(c => c.id === 'boom'), spellLeftAiHand: !App.state.ai.hand.some(c => c.id === 'boom'),
        aiEnergy: App.state.ai.energy, counterSpent: !App.state.player.hand.some(c => c.id === 'wd_ctr'),
        logged: App.state.log.some(l => /would have destroyed Knight/.test(l.msg || '')) }; }

    /* 3 declined */
    { const st = mk(); st.player.hand = [{ ...COUNTER, instanceId: 'iid_c3' }];
      const pre = _wdSnapIf(st, 'player');
      const after = kill(st, 'p_knight'); App.state = after;
      const d = declineWhenOpen();
      const ok = await _wdGuardPlayer(pre, { attacker: 'ai', kind: 'spell', card: SPELL, source: App.state.units.find(u => u.id === 'h_a') });
      out.declined = { opened: await d, ok, restored: App.state === after, knightDead: !alive(App.state, 'p_knight') }; }

    /* 4 AI unit on-play, answered */
    { const st = mk(); st.player.hand = [{ ...COUNTER, instanceId: 'iid_c4' }];
      const pre = _wdSnapIf(st, 'player');
      App.state = kill(st, 'p_knight');
      const imp = App.state.units.find(u => u.id === 'a_imp');
      const c = clickWhenOpen('iid_c4');
      const ok = await _wdGuardPlayer(pre, { attacker: 'ai', kind: 'onPlay', card: { id: 'imp', name: 'Imp' }, source: imp });
      out.onPlay = { clicked: await c, ok, knight: alive(App.state, 'p_knight'), causerDead: !alive(App.state, 'a_imp') }; }

    /* 5 your spell, the AI answers */
    { const st = mk(); st.turn = 'player'; st.ai.hand = [{ ...COUNTER, instanceId: 'iid_c5' }];
      st.player.hand = [{ ...SPELL, instanceId: 'iid_ps' }];
      const pre = _wdSnapIf(st, 'ai');
      App.state = kill(st, 'a_imp');
      const ok = _wdGuardAi(pre, { attacker: 'player', kind: 'spell', card: { ...SPELL, instanceId: 'iid_ps' },
        source: App.state.units.find(u => u.id === 'h_p') });
      out.aiAnswers = { snap: !!pre, ok, imp: alive(App.state, 'a_imp'), spellSpent: App.state.player.graveyard.some(c => c.id === 'boom'),
        aiCounterSpent: !App.state.ai.hand.some(c => c.id === 'wd_ctr') }; }

    /* 6 control: a counter without the trigger is not an answer */
    { const st = mk(); st.player.hand = [{ ...OTHER, instanceId: 'iid_o' }]; out.control = _wdSnapIf(st, 'player') === null; }
    return out;
  });
} catch (e) {
  console.error(JSON.stringify({ ok: false, error: String(e), pageErrors }));
  await browser.close(); process.exit(2);
}
await browser.close();
if (R && R.missing) { console.log(JSON.stringify({ ok: false, missing: 'the would-destroy functions are not in this file' })); process.exit(2); }
const f = [];
if (!R.noAnswer) f.push('1 no answer must mean no snapshot');
const sp = R.spell || {};
if (!(sp.snap && sp.clicked && sp.ok && sp.knight && sp.aiHero && sp.spellInAiGrave && sp.spellLeftAiHand && sp.aiEnergy === 6 && sp.counterSpent && sp.logged)) f.push('2 AI spell answered');
const dc = R.declined || {};
if (!(dc.opened && dc.ok === false && dc.restored && dc.knightDead)) f.push('3 declined restores the resolved board');
const op = R.onPlay || {};
if (!(op.clicked && op.ok && op.knight && op.causerDead)) f.push('4 on-play: unit saved, causer destroyed');
const ai = R.aiAnswers || {};
if (!(ai.snap && ai.ok && ai.imp && ai.spellSpent && ai.aiCounterSpent)) f.push('5 the AI answers your spell');
if (!R.control) f.push('6 control: a counter without the trigger is no answer');
console.log(JSON.stringify({ ok: !f.length, fails: f, result: R, pageErrors: pageErrors.slice(0, 5) }, null, 1));
process.exit(f.length ? 1 : 0);
