/* ══════════════════════════════════════════════════════════════════════════
   COUNTER-ART PROBE — do the counter surfaces draw card art, or emojis?

   Owner (v121v169), with two screenshots of the counter prompt: "Add card art
   of the people who is using spell counters. Same for counter cards no emojis."
   The screenshots showed 🔵 for Krystal Anomaly Lynx Ruby (a unit ON THE FIELD
   paying with counters) and 🦄 for Annoucer Bot (a counter unit IN HAND). Both
   cards have hosted art that loads (HTTP 200) — the prompt was not finding it.

   This loads a candidate index.html as the real page and drives the REAL
   renderers — renderCounterPrompt, the COUNTERED flash, the counter-chain
   overlay — with those two real cards, then reads what each art slot drew.
   The field row goes through the real _fieldCounterHolders, because that is
   where the bug was: it took the unit's INSTANCE id as the card id.

   Usage:  node .gauntlet/counterart-probe.mjs <candidate.html> [--shot out.png] [--url base]
   Needs the `public` preview server (port 8787).
   Exit 0 = every slot is art, 1 = an emoji or a broken image, 2 = could not run.

   🔴 RUN IT AGAINST THE PRE-FIX FILE FIRST. It must fail there on the field
   row, or it is not testing the bug.
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import fs from 'node:fs';

const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.error('usage: counterart-probe.mjs <candidate.html> [--shot out.png]'); process.exit(2); }
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const BASE = arg('--url') || 'http://localhost:8787';
const SHOT = arg('--shot');
const html = fs.readFileSync(file, 'utf8');

/* The two cards from the owner's screenshots, as published (card_catalog). */
const LYNX = { id: 'cc_1788390821686', name: 'Krystal Anomaly Lynx Ruby', type: 'summon', icon: '🦄', cost: 2,
  artUrl: 'https://ktsiasyjusesawtrwrjc.supabase.co/storage/v1/object/public/card-art/f9eff35e-29d1-47d0-9c99-346c2478cd6a/cc_1788390821686.webp?v=mtl2310r' };
const BOT = { id: 'cc_1789542059946', name: 'Annoucer Bot', type: 'unit', icon: '🦄', cost: 1, isCounterUnit: true,
  counterEffect: 'negate', counterTriggers: ['summon'],
  artUrl: 'https://ktsiasyjusesawtrwrjc.supabase.co/storage/v1/object/public/card-art/f9eff35e-29d1-47d0-9c99-346c2478cd6a/cc_1789542059946.webp?v=mu3rlwh4' };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));
await page.route(/\/(index\.html)?(\?.*)?$/, (route) => {
  const u = new URL(route.request().url());
  if (u.pathname === '/' || u.pathname === '/index.html') {
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
  }
  return route.continue();
});

let out;
try {
  await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => typeof window.renderCounterPrompt === 'function' && typeof window._fieldCounterHolders === 'function', null, { timeout: 30000 });
  out = await page.evaluate(async ({ LYNX, BOT }) => {
    /* Put the published cards where the game looks for them. `Catalog`, `App`
       and `Forge` are global LEXICAL bindings — reachable by bare name here. */
    Catalog.cards = (Catalog.cards || []).filter(c => c && c.id !== LYNX.id && c.id !== BOT.id).concat([LYNX, BOT]);
    try { if (typeof _cardDefMemoClose === 'function') _cardDefMemoClose(); } catch (e) {}

    /* Make the Lynx a legal field counter without depending on the counters
       module having mounted in a headless page. These stubs change WHO is
       offered, never what the offer draws — the art path is untouched. */
    window._counterPayableWithTokens = () => true;
    window.MythicCounters = Object.assign({}, window.MythicCounters || {}, {
      tokenOf: () => ({ id: 'krystal', icon: '🔵', name: 'Krystal Counter', counterCost: 2, canCounter: true }),
      totalFor: () => 4,
      permanentsFor: () => [],
    });

    /* A field unit the way the battle stores one: `id` is the INSTANCE, the card
       id lives in cardId/originalCardId. That shape is the whole bug. */
    const lynxUnit = Object.assign({}, LYNX, { id: 'u_probe_lynx_1', cardId: LYNX.id, originalCardId: LYNX.id,
      owner: 'player', alive: true, pos: { x: 2, y: 5 }, hp: 5, maxHp: 5 });
    const botInHand = Object.assign({}, BOT, { instanceId: 'iid_probe_bot_1' });
    const side = () => ({ deck: [], hand: [], graveyard: [], void: [], energy: 3, maxEnergy: 3, hp: 30 });
    const s = { player: side(), ai: side(), units: [lynxUnit], turn: 'ai', gameOver: false, round: 3 };
    s.player.hand = [botInHand];
    App.state = s;

    const holders = window._fieldCounterHolders(s, 'summon');
    App.ui = App.ui || {};
    App.ui.counterFlash = null;
    App.ui.counterPrompt = {
      windowMs: 30000, startedAt: Date.now(), trigger: 'summon',
      triggerLabel: 'Enemy summons The Crazy One', sourceName: 'The Crazy One', targetName: 'Max Survivor The Scrap Mage',
      candidateIds: [botInHand.instanceId],
      _graveReactions: [], _tokenHolders: holders, _trapResponders: [],
    };

    const host = document.createElement('div');
    host.id = 'counterart-probe-host';
    document.body.appendChild(host);
    host.innerHTML = window.renderCounterPrompt();

    const waitImgs = (root) => Promise.all([...root.querySelectorAll('img')].map(im =>
      (im.complete && im.naturalWidth > 0) ? null : new Promise(r => { im.addEventListener('load', r, { once: true }); im.addEventListener('error', r, { once: true }); setTimeout(r, 15000); })));
    await waitImgs(host);
    await new Promise(r => setTimeout(r, 300));   // a fallback swap re-fires load

    const EMOJI = /\p{Extended_Pictographic}/u;
    const readSlot = (el, label) => {
      const img = el.querySelector('img');
      return {
        label,
        img: !!img,
        src: img ? img.getAttribute('src').replace(/^.*\//, '').slice(0, 48) : null,
        loaded: !!(img && img.complete && img.naturalWidth > 0),
        emojiText: EMOJI.test(el.textContent || ''),
      };
    };
    const rows = [...host.querySelectorAll('.counter-prompt-card')].map(b =>
      readSlot(b.querySelector('.counter-prompt-card-icon'), (b.querySelector('.counter-prompt-card-name') || {}).textContent.trim().slice(0, 40)));

    /* The COUNTERED flash, for the field counter — the path that had no flash. */
    const flashHost = document.createElement('div');
    document.body.appendChild(flashHost);
    App.ui.counterPrompt = null;
    App.ui.counterFlash = { name: LYNX.name, icon: '🔵', cardId: holders[0] && holders[0].cardId, at: Date.now() };
    flashHost.innerHTML = window.renderCounterPrompt();
    flashHost.querySelectorAll('.counter-flash').forEach(e => { e.style.animation = 'none'; e.style.opacity = '1'; });
    await waitImgs(flashHost);
    const flashEl = flashHost.querySelector('.counter-flash-icon');
    const flash = flashEl ? readSlot(flashEl, 'COUNTERED flash') : { label: 'COUNTERED flash', missing: true };
    flashHost.remove();
    App.ui.counterFlash = null;

    /* The counter-chain overlay: one real card, one link that has no card id at
       all (an online opponent on an older client sends only a name). */
    const cs = { _counterChain: [
      { card: Object.assign({}, BOT, { owner: 'player' }), owner: 'player', againstName: 'The Crazy One', effect: 'negate' },
      { card: { name: 'Old client counter', icon: '⏱', counterEffect: 'negate' }, owner: 'ai', againstName: 'Annoucer Bot', effect: 'negate' },
    ] };
    try { window._renderCounterChainOverlay(cs); } catch (e) { return { ok: false, err: 'chain overlay threw: ' + e.message }; }
    const ov = document.getElementById('counter-chain-overlay');
    if (ov) await waitImgs(ov);
    const chain = ov ? [...ov.querySelectorAll('.cc-card')].map(c => {
      const img = c.querySelector('img.cc-card-art');
      return { label: 'chain: ' + ((c.querySelector('.cc-card-name') || {}).textContent || '').trim(),
        img: !!img, src: img ? img.getAttribute('src').replace(/^.*\//, '').slice(0, 48) : null,
        loaded: !!(img && img.complete && img.naturalWidth > 0),
        emojiText: !!c.querySelector('.cc-card-icon') };
    }) : [];
    if (ov) ov.style.display = 'none';

    const all = rows.concat([flash], chain);
    const ok = rows.length === 2 && all.every(x => x.img && x.loaded && !x.emojiText);
    return { ok, holderCardId: holders[0] && holders[0].cardId, slots: all };
  }, { LYNX, BOT });

  if (SHOT) {
    const box = await page.$('#counterart-probe-host .counter-prompt-modal');
    if (box) await box.screenshot({ path: SHOT });
  }
} catch (e) {
  console.log(JSON.stringify({ file, probe: 'COULD NOT RUN', err: String(e && e.message || e), loadErrors: pageErrors.slice(0, 4) }));
  await browser.close();
  process.exit(2);
}
await browser.close();
console.log(JSON.stringify({ file: file.split(/[\\/]/).pop(), ...out, loadErrors: pageErrors.slice(0, 4).map(m => m.slice(0, 160)) }, null, 1));
process.exit(out && out.ok ? 0 : 1);
