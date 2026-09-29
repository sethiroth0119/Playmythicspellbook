// Builds a PATCHED COPY of public/index.html in the scratchpad. Never writes public/.
// Usage: node apply-mp-patches.mjs <src index.html> <out.html> [patch ids csv]
import fs from 'node:fs';
const [src, out, only] = process.argv.slice(2);
let s = fs.readFileSync(src, 'utf8');
const want = only ? new Set(only.split(',')) : null;

export const PATCHES = [
  { id: 'P1-spell-counter-wait',
    old: "      if (!(App.battlePrep && App.battlePrep.multiplayer) || typeof sendColyseusFx !== 'function') { resolve(null); return; }",
    new: "      // 🌐 The counter request only has a wire on the Colyseus transport. On the live\n"
       + "      // Supabase path sendColyseusFx() is a silent no-op (no ColyseusMP.room), so the\n"
       + "      // request was never sent and every PvP spell sat on the 20 s timer below.\n"
       + "      if (!(App.battlePrep && App.battlePrep.multiplayer) || typeof sendColyseusFx !== 'function'\n"
       + "          || !(typeof ColyseusMP !== 'undefined' && ColyseusMP && ColyseusMP.room)) { resolve(null); return; }" },

  { id: 'P2a-endPlayerTurn-opts',
    old: "const endPlayerTurn = (state) => {",
    new: "const endPlayerTurn = (state, opts) => {" },
  { id: 'P2b-endPlayerTurn-handoff',
    old: "  s = startTurn(s, 'ai');\n"
       + "  // ⚡ turnStart triggers (AI turn beginning). actorOwner = 'ai'.\n"
       + "  try { if (typeof _fireTriggers === 'function') s = _fireTriggers(s, 'turnStart', { actorOwner: 'ai', side: 'ai' }); } catch (e) {}\n",
    new: "  if (opts && opts.handOffOnly) {\n"
       + "    // 📡 PvP: the opponent runs its OWN turn start when it adopts this snapshot\n"
       + "    // (_onRemoteStateArrived → TURN-START ON FLIP). Running startTurn('ai') here\n"
       + "    // as well ticked every countdown / DoT / seize timer twice per hand-off.\n"
       + "    // endAITurn never runs in PvP, so its end-of-MY-turn grave tick goes here.\n"
       + "    try { if (typeof _endTurnGraveTick === 'function') s = _endTurnGraveTick(s, 'player'); } catch (e) {}\n"
       + "  } else {\n"
       + "  s = startTurn(s, 'ai');\n"
       + "  // ⚡ turnStart triggers (AI turn beginning). actorOwner = 'ai'.\n"
       + "  try { if (typeof _fireTriggers === 'function') s = _fireTriggers(s, 'turnStart', { actorOwner: 'ai', side: 'ai' }); } catch (e) {}\n"
       + "  }\n" },
  { id: 'P2c-onEndTurn-handoff',
    old: "  } else {\n    App.state = endPlayerTurn(App.state);\n  }\n  App.ui.aiBusy = true;",
    new: "  } else {\n    App.state = endPlayerTurn(App.state, { handOffOnly: !!(App.battlePrep && App.battlePrep.multiplayer) });\n  }\n  App.ui.aiBusy = true;" },
  { id: 'P2d-receiver-turnstart',
    old: "      App.state = startTurn(App.state, 'player');\n",
    new: "      let _ts = App.state;\n"
       + "      // What endAITurn does around startTurn('player') in solo. endAITurn never runs\n"
       + "      // in PvP, so vanished units never returned, day/night never turned, emotions\n"
       + "      // never expired and 'at the start of your turn' triggers never fired.\n"
       + "      try { if (typeof _vanishReturnTick === 'function') _ts = _vanishReturnTick(_ts, 'player'); } catch (e) {}\n"
       + "      try {\n"
       + "        const _tn = _ts.turnNumber | 0;   // PvP turnNumber counts HALF-turns\n"
       + "        if (_tn > 1 && (_tn - 1) % (DAY_NIGHT_PERIOD * 2) === 0) {\n"
       + "          _ts = { ..._ts, timeOfDay: (_ts.timeOfDay === 'day') ? 'night' : 'day' };\n"
       + "          _ts.log = [...(_ts.log || []), { msg: _ts.timeOfDay === 'day' ? '☀️ Dawn breaks — Light empowered.' : '🌙 Night falls — Shadow empowered.', color: 'amber' }];\n"
       + "          if (typeof _fireDayNight === 'function') _ts = _fireDayNight(_ts);\n"
       + "        }\n"
       + "        if ((_tn % 2) === 1 && typeof _battleTickRotation === 'function') _battleTickRotation(_ts);   // once per round, on the opener's side\n"
       + "      } catch (e) {}\n"
       + "      _ts = startTurn(_ts, 'player');\n"
       + "      try { if (typeof _fireTriggers === 'function') _ts = _fireTriggers(_ts, 'turnStart', { actorOwner: 'player', side: 'player' }); } catch (e) {}\n"
       + "      App.state = _ts;\n"
       + "      // The peer no longer simulates this turn start, so tell it now rather than at\n"
       + "      // our first action / the 4 s heartbeat. We hold the turn: we are the authority.\n"
       + "      try { if (!(typeof USE_COLYSEUS_MP !== 'undefined' && USE_COLYSEUS_MP) && typeof broadcastMyState === 'function') broadcastMyState(); } catch (e) {}\n" },
  { id: 'P9-ley-owner-swap',
    old: "      if (t.trap && t.trap.owner) t.trap = { ...t.trap, owner: swapOwner(t.trap.owner) };\n",
    new: "      if (t.trap && t.trap.owner) t.trap = { ...t.trap, owner: swapOwner(t.trap.owner) };\n"
       + "      // 🜂 ley.owner names the side that last flipped the hex (src/battle/ley.js).\n"
       + "      if (t.ley && t.ley.owner) t.ley = { ...t.ley, owner: swapOwner(t.ley.owner) };\n" },

  { id: 'P3-P4-adopt-private-edges',
    old: "    swapped.player = _myPrev.player;   // my hand/deck/energy are mine, not their guess\n",
    new: "    const _theirModelOfMe = swapped.player;\n"
       + "    swapped.player = _myPrev.player;   // my hand/deck/energy are mine, not their guess\n"
       + "    // 🌫 vanishTemp parks MY units in MY side block on the CASTER's engine, and the\n"
       + "    // line above threw that record away: the unit left both boards for good. Take\n"
       + "    // records only for units absent from the board entirely, so a stale packet can\n"
       + "    // never re-park a unit that already came back (or came back and died).\n"
       + "    try {\n"
       + "      const _bay = Array.isArray(_theirModelOfMe && _theirModelOfMe._vanished) ? _theirModelOfMe._vanished : [];\n"
       + "      if (_bay.length) {\n"
       + "        const _mine = Array.isArray(swapped.player._vanished) ? swapped.player._vanished : [];\n"
       + "        const _have = new Set(_mine.map(v => v && v.unit && v.unit.id));\n"
       + "        const _present = new Set((swapped.units || []).map(u => u && u.id));\n"
       + "        const _add = _bay.filter(v => v && v.unit && !_have.has(v.unit.id) && !_present.has(v.unit.id))\n"
       + "          .map(v => ({ ...v, pos: v.pos ? _mirrorPos(v.pos) : v.pos,\n"
       + "            unit: { ...v.unit, owner: 'player', pos: v.unit.pos ? _mirrorPos(v.unit.pos) : v.unit.pos } }));\n"
       + "        if (_add.length) swapped.player = { ...swapped.player, _vanished: _mine.concat(_add) };\n"
       + "      }\n"
       + "    } catch (e) {}\n"
       + "    // 🪦 A unit of MINE that died on the SENDER's engine arrives already stamped\n"
       + "    // `_cardFiled` — the sender filed its card into ITS model of my graveyard, which\n"
       + "    // I just discarded — so my reconciler reads 'already filed' and never files it.\n"
       + "    // Clear the stamp on exactly the deaths I have not seen yet, then file them.\n"
       + "    try {\n"
       + "      const _prevU = new Map((_myPrev.units || []).map(u => [u && u.id, u]));\n"
       + "      let _unfiled = 0;\n"
       + "      swapped.units = (swapped.units || []).map(u => {\n"
       + "        if (!u || !u._cardFiled || !u._card || _cardOwnerOf(u) !== 'player') return u;\n"
       + "        const pu = _prevU.get(u.id);\n"
       + "        if (pu && pu._cardFiled === u._cardFiled) return u;\n"
       + "        _unfiled++;\n"
       + "        return { ...u, _cardFiled: null, _cardPileIid: null };\n"
       + "      });\n"
       + "      if (_unfiled) {\n"
       + "        const _rf = _reconcileUnitCards(swapped);\n"
       + "        if (_rf && _rf !== swapped) { swapped.units = _rf.units; swapped.player = _rf.player; }\n"
       + "      }\n"
       + "    } catch (e) {}\n" },

  { id: 'P5-grave-stub-id-type',
    old: "      if (Array.isArray(block.graveyard)) block.graveyard = block.graveyard.map(_stub);",
    new: "      // 🪦 The graveyard is a PUBLIC zone, and grave effects that run on the OTHER\n"
       + "      // engine (an opponent's summonGrave trap sprung by the mover) need id + type.\n"
       + "      if (Array.isArray(block.graveyard)) block.graveyard = block.graveyard.map(c => ({ ..._stub(c), id: (c && (c.id || c.cardId)) || '', type: (c && c.type) || '' }));" },

  { id: 'P6-reconnect-hydrate',
    old: "  App.state = swapped;\n  // ⚔️ Reliable combat-cinematic trigger",
    new: "  // 🔁 RELOADED MID-MATCH — there is no local block to keep, so the only copy of my\n"
       + "  // hand / deck / graveyard is the opponent's model of it, which the wire slims to\n"
       + "  // {instanceId, cardId, name}. Adopted raw, no card in my hand had a type, cost\n"
       + "  // or effect. Rebuild each stub from the shared catalog, keeping its instanceId.\n"
       + "  if (_isMp && !(_myPrev && _myPrev.player) && swapped.player) {\n"
       + "    try {\n"
       + "      const _kinds = ['unit', 'spell', 'trap', 'location', 'weather', 'counter', 'custom'];\n"
       + "      const _def = (id) => { for (const k of _kinds) { try { const d = resolveDeckCard(k + ':' + id); if (d) return d; } catch (e) {} } return null; };\n"
       + "      const _hyd = (c) => {\n"
       + "        if (!c || c.type || !(c.cardId || c.id)) return c;\n"
       + "        const d = _def(c.cardId || c.id);\n"
       + "        return d ? { ...d, instanceId: c.instanceId || d.instanceId } : c;\n"
       + "      };\n"
       + "      const _p = swapped.player;\n"
       + "      swapped.player = { ..._p, hand: (_p.hand || []).map(_hyd), deck: (_p.deck || []).map(_hyd), graveyard: (_p.graveyard || []).map(_hyd) };\n"
       + "    } catch (e) {}\n"
       + "  }\n"
       + "  App.state = swapped;\n  // ⚔️ Reliable combat-cinematic trigger" },

  { id: 'P8a-flip-guard',
    old: "      && App.state && MatchBroadcast._mpLastTurnStarted !== App.state.turnNumber) {",
    new: "      && App.state && MatchBroadcast._mpLastTurnStarted !== App.state.turnNumber\n"
       + "      // 🔁 _mpLastTurnStarted dies with the page. A turn-holder that RELOADS adopts its\n"
       + "      // own turn back through a resync answer and used to start the turn a second\n"
       + "      // time (energy refilled, every unit ready). The stamp rides the snapshot.\n"
       + "      && (App.state._mpTurnStartedTn | 0) !== (App.state.turnNumber | 0)) {" },
  { id: 'P8b-flip-stamp',
    old: "      MatchBroadcast._mpLastTurnStarted = App.state.turnNumber;",
    new: "      MatchBroadcast._mpLastTurnStarted = App.state.turnNumber;\n"
       + "      App.state._mpTurnStartedTn = App.state.turnNumber;" },
  { id: 'P8c-stamp-monotonic',
    old: "  const _myPrev = App.state;\n",
    new: "  const _myPrev = App.state;\n"
       + "  // The turn-start stamp only moves forward: a heal packet from the non-holder\n"
       + "  // carries ITS older stamp and must not roll ours back.\n"
       + "  try { if (_myPrev && (_myPrev._mpTurnStartedTn | 0) > (swapped._mpTurnStartedTn | 0)) swapped._mpTurnStartedTn = _myPrev._mpTurnStartedTn; } catch (e) {}\n" },
  { id: 'P7-endReason',
    old: "        endReason: 'normal',",
    new: "        endReason: endReason,   // was hardcoded 'normal' — a DC win was recorded as a normal one" },
];

let bad = 0;
for (const p of PATCHES) {
  if (want && !want.has(p.id)) continue;
  const n = s.split(p.old).length - 1;
  if (n !== 1) { console.log('ANCHOR ' + p.id + ' matched ' + n + ' times'); bad++; continue; }
  s = s.replace(p.old, () => p.new);
  console.log('applied ' + p.id);
}
fs.writeFileSync(out, s);
process.exit(bad ? 1 : 0);
