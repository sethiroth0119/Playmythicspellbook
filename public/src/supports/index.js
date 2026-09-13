/* ════════════════════════════════════════════════════════════════════════════
   💬 SUPPORTS — module entry. Registers window.MythicSupports.
   ----------------------------------------------------------------------------
   index.html contributes `window.MythicSupportsBridge` and calls:

       MythicSupports.afterBattle(report)     // award points from a finished fight
       MythicSupports.pending()               // [{pair, rank}] conversations waiting
       await MythicSupports.play(a, b)        // show the next scene for a pair
       MythicSupports.bonusFor(idA, idB)      // the adjacency bonus in battle
       MythicSupports.roster()                // the camp's support screen model

   Save blob: `Profile.supports` — a map of pairKey → pair. Absent on every
   existing profile and absence means "nobody has fought together yet", so no
   migration.

   🔴 THE BONUS IS READ IN A COMBAT HOT PATH. `bonusFor` is called for every
   attack resolution, so it must be O(1) and allocation-light: one object
   lookup, no scanning, no generation. Everything expensive (dialogue) happens
   in the camp, never in battle.
   ════════════════════════════════════════════════════════════════════════════ */

import {
  RANKS, pairKey, splitKey, newPair, earnedRank, unlockedRank,
  pendingScene, bonusFor as bonusOfPair, awardBattle,
} from './supports.data.js';
import { generate, setProvider, hasProvider } from './supports.voice.js';
import { playScene, openRoster } from './supports.ui.js';

function b() { try { return window.MythicSupportsBridge || null; } catch (e) { return null; } }

let _warned = false;
function ready() {
  if (b()) return true;
  if (!_warned) { _warned = true; try { console.warn('[supports] window.MythicSupportsBridge absent — support conversations disabled.'); } catch (e) {} }
  return false;
}

function store() {
  const br = b();
  try {
    const s = br && br.supportsState && br.supportsState();
    return (s && typeof s === 'object') ? s : {};
  } catch (e) { return {}; }
}
function commit(map) {
  const br = b();
  try { br && br.setSupportsState && br.setSupportsState(map); } catch (e) {}
  try { br && br.save && br.save(); } catch (e) {}
}

function getPair(map, a, b2) {
  const k = pairKey(a, b2);
  if (!map[k]) map[k] = newPair(a, b2);
  return map[k];
}

/* ── Battle → points ──────────────────────────────────────────────────────
   `report` is what the battle observed:
     { participants: [heroId…],
       adjacency: { 'a|b': turns },            // already pair-keyed by the caller
       saves:     [{ saver, saved }],
       revives:   [{ medic, patient }],
       survivors: [heroId…] }

   Every pair of participants gets the base award; the extras land on the pairs
   that earned them. */
function afterBattle(report) {
  if (!ready() || !report) return [];
  const map = store();
  const parts = (report.participants || []).filter(Boolean);
  const survivors = new Set(report.survivors || []);
  const gains = [];

  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i], bb = parts[j];
      const k = pairKey(a, bb);
      const pair = getPair(map, a, bb);
      const events = {
        adjacentTurns: ((report.adjacency || {})[k]) | 0,
        savedKill: (report.saves || []).some(s => pairKey(s.saver, s.saved) === k),
        revived: (report.revives || []).some(r => pairKey(r.medic, r.patient) === k),
        bothSurvived: survivors.has(a) && survivors.has(bb),
      };
      const before = earnedRank(pair).key;
      const pts = awardBattle(pair, events);
      const after = earnedRank(pair).key;
      gains.push({ key: k, a, bb, points: pts, rankUp: before !== after ? after : null });
    }
  }

  commit(map);

  // Tell the player a conversation is waiting — that prompt is the only reason
  // anyone visits the support screen unprompted.
  const newScenes = gains.filter(g => g.rankUp);
  if (newScenes.length) {
    try {
      const br = b();
      br.toast && br.toast(`💬 ${newScenes.length} support conversation${newScenes.length === 1 ? '' : 's'} unlocked — visit camp.`, 4800);
    } catch (e) {}
  }
  return gains;
}

/* Every pair with a scene ready to watch. Drives the camp badge. */
function pending() {
  const map = store();
  const out = [];
  for (const k of Object.keys(map)) {
    const scene = pendingScene(map[k]);
    if (scene) out.push({ key: k, pair: map[k], rank: scene.key });
  }
  return out;
}

/* 🔥 HOT PATH — see the header. One lookup, nothing else. */
function bonusFor(idA, idB) {
  try {
    const pair = store()[pairKey(idA, idB)];
    return pair ? bonusOfPair(pair) : null;
  } catch (e) { return null; }
}

/* Play the next scene for a pair, then bank it as watched. */
async function play(idA, idB) {
  if (!ready()) return null;
  const map = store();
  const pair = map[pairKey(idA, idB)];
  if (!pair) return null;
  const next = pendingScene(pair);
  if (!next) return null;

  const br = b();
  const hero = (id) => {
    try { return br.hero(id) || { id, name: id, traits: [] }; }
    catch (e) { return { id, name: id, traits: [] }; }
  };
  const a = hero(pair.a), bb = hero(pair.b);

  let convo;
  try {
    convo = await generate({
      a, b: bb, rank: next.key,
      history: {
        battles: pair.battles | 0,
        revived: !!pair.everRevived,
        lostAlly: !!(br.campHasLosses && br.campHasLosses()),
      },
    });
  } catch (e) {
    try { console.warn('[supports] generation failed', e); } catch (e2) {}
    return null;
  }

  try { await playScene(convo, a, bb, next); } catch (e) {}

  // 💾 Bank it only AFTER it has been shown. Marking it seen first means a
  // scene lost to a render failure can never be watched again.
  pair.scenesSeen = (pair.scenesSeen || []).concat([next.key]);
  commit(map);

  try {
    const bon = next.bonus;
    if (bon) br.toast && br.toast(`${next.icon} ${a.name} & ${bb.name} reached Support ${next.key} — +${bon.hit} hit / +${bon.avoid} avoid when adjacent.`, 5200);
  } catch (e) {}

  return { rank: next.key, convo };
}

/* The camp screen's model: every pair this player has, sorted by what needs
   attention first. */
function roster() {
  const map = store();
  const br = b();
  const name = (id) => { try { return (br.hero(id) || {}).name || id; } catch (e) { return id; } };
  return Object.keys(map).map(k => {
    const p = map[k];
    const nextScene = pendingScene(p);
    const earned = earnedRank(p), unlocked = unlockedRank(p);
    const nextRank = RANKS[RANKS.indexOf(earned) + 1] || null;
    return {
      key: k,
      a: p.a, b: p.b,
      aName: name(p.a), bName: name(p.b),
      points: p.points | 0,
      battles: p.battles | 0,
      earned: earned.key, unlocked: unlocked.key,
      color: unlocked.color, icon: unlocked.icon,
      bonus: unlocked.bonus,
      ready: nextScene ? nextScene.key : null,
      toNext: nextRank ? Math.max(0, nextRank.at - (p.points | 0)) : 0,
      nextAt: nextRank ? nextRank.at : null,
    };
  }).sort((x, y) => {
    if (!!x.ready !== !!y.ready) return x.ready ? -1 : 1;   // waiting scenes first
    return y.points - x.points;
  });
}

try {
  window.MythicSupports = {
    afterBattle, pending, play, bonusFor, roster,
    openRoster: () => openRoster(roster(), play),
    pairKey, RANKS,
    // The LLM seam — see supports.voice.js. Local engine stays the fallback.
    setProvider, hasProvider,
    available: () => ready(),
    VERSION: 'supports-1.0.0',
  };
  try { console.info('%c💬 MythicSupports%c ready — local voice engine.', 'color:#ff9ecb;font-weight:700', 'color:inherit'); } catch (e) {}
} catch (e) {}
