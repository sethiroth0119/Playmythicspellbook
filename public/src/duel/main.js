/* ═══════════════════════════════════════════════════════════════════════════
   main.js — entry point for /duel/. Wires rules + AI + UI and reads the few
   inputs a prototype accepts:

     ?seed=123                  reproduce a board and shuffle
     ?deck=goblin,orc,unit:wolf your deck (Profile.decks keys like "unit:goblin"
                                are accepted as-is so a real deck can be pasted)
     ?rival=…                   the rival's deck, same format
     ?first=p1|p2               who opens

   Hosting: like battle-board, this page can be iframed and driven by
   postMessage — `{ type: 'duel:init', seed, deck, rival }` — which is how the
   main app would hand over Profile.decks WITHOUT the module reaching for the
   `const Profile` that a module cannot see (see CLAUDE.md, the globals trap).
   Nothing here touches index.html; the bridge addition is the host's side.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as R from './rules.js';
import { takeTurn } from './ai.js';
import { DuelUI } from './ui.js';

const q = new URLSearchParams(location.search);
const parseDeck = (s) => (s ? String(s).split(',').map((k) => k.trim().replace(/^unit:/, '')).filter(Boolean) : null);
const cfg = {
  seed: q.get('seed'),
  deck: parseDeck(q.get('deck')),
  rival: parseDeck(q.get('rival')),
  first: q.get('first') === 'p2' ? 'p2' : q.get('first') === 'p1' ? 'p1' : null,
};

const ui = new DuelUI(document.getElementById('app'), {
  ai: takeTurn,
  onNew: (seedText) => start(seedText),
});

function start(seedText) {
  const seed = seedText ? (Number(seedText) >>> 0 || hashSeed(seedText)) : 0;
  const state = R.newDuel({ seed, p1Deck: cfg.deck, p2Deck: cfg.rival, first: cfg.first, p1Name: 'You', p2Name: 'Rival' });
  ui.attach(state);
  history.replaceState(null, '', '?' + new URLSearchParams({ ...Object.fromEntries(q), seed: String(state.seed) }));
  if (state.active === 'p2') ui.runAi();
  window.duel = { state, R, ui };   // console handle for poking the rules
}

function hashSeed(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

window.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || d.type !== 'duel:init') return;
  if (d.deck) cfg.deck = parseDeck(Array.isArray(d.deck) ? d.deck.join(',') : d.deck);
  if (d.rival) cfg.rival = parseDeck(Array.isArray(d.rival) ? d.rival.join(',') : d.rival);
  start(d.seed != null ? String(d.seed) : '');
});

start(cfg.seed || '');
