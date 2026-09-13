/* ════════════════════════════════════════════════════════════════════════════
   🛏 REST ECONOMY — module entry. Registers window.MythicRest.
   ----------------------------------------------------------------------------
   index.html contributes `window.MythicRestBridge`, replaces the Rest Tent's
   free click with `MythicRest.open()`, and nothing else changes.

       MythicRest.open()             the rest panel (short / long)
       MythicRest.quote('long')      cost + affordability, for a HUD badge
       await MythicRest.take('long') do it, headless (used by tests/automation)

   🔴 THE LONG REST IS THE CAMP'S HEARTBEAT. It is the one action that:
        • costs food and supplies (the sink this feature exists to create)
        • refills short-rest charges
        • rolls a dream (the existing _campRollDream, through the bridge)
        • plays a waiting SUPPORT CONVERSATION (/src/supports)
      Those last two are why a long rest must stay a deliberate, occasional act
      rather than something spammed between fights — and why the short rest
      exists at all, to absorb the "I just need a top-up" case without cheapening
      the long one.

   ⚠ Everything is wrapped; without the bridge this is inert and the tent keeps
   its old behaviour.
   ════════════════════════════════════════════════════════════════════════════ */

import { REST, priceOf, costMultiplier } from './rest.tuning.js';
import { quote, apply, state, resters } from './rest.state.js';
import { openRestPanel } from './rest.ui.js';

function b() { try { return window.MythicRestBridge || null; } catch (e) { return null; } }

let _warned = false;
function ready() {
  if (b()) return true;
  if (!_warned) { _warned = true; try { console.warn('[rest] window.MythicRestBridge absent — rest economy disabled.'); } catch (e) {} }
  return false;
}

/* Take a rest and run everything that HANGS OFF a rest. Order matters:
     1. resources + recovery  (rest.state.apply — the part that can fail)
     2. the dream             (atmosphere; long rest only)
     3. the support scene     (the payoff; long rest only)
   Steps 2 and 3 are strictly after a SUCCESSFUL step 1. Showing a dream for a
   rest the player could not afford is the kind of thing that reads as the
   resource check being decorative. */
async function take(mode) {
  if (!ready()) return { ok: false, why: 'unavailable' };

  const res = apply(mode);
  if (!res.ok) {
    try { b().toast && b().toast('⚠ ' + res.why, 3600); } catch (e) {}
    return res;
  }

  const spec = res.spec;
  try {
    b().toast && b().toast(
      `${spec.icon} ${spec.name} — +${res.energyBack} stamina${res.hpBack ? `, +${res.hpBack} HP` : ''} across ${res.rested.length} in camp.`,
      4200);
  } catch (e) {}

  if (spec.rollsDream) { try { b().rollDream && b().rollDream(); } catch (e) {} }

  // 💬 The camp talks. One scene per long rest — queueing three in a row turns
  // the payoff into a chore, and the rest of them keep until tomorrow night.
  if (spec.supportScene) {
    try {
      const S = window.MythicSupports;
      if (S && S.available && S.available()) {
        const waiting = S.pending();
        if (waiting.length) {
          const first = waiting[0];
          await S.play(first.pair.a, first.pair.b);
        }
      }
    } catch (e) { try { console.warn('[rest] support scene failed — the rest still counted', e); } catch (e2) {} }
  }

  try { b().render && b().render(); } catch (e) {}
  return res;
}

function open() {
  if (!ready()) return;
  try { openRestPanel({ quote, take, state: state(), REST }); }
  catch (e) { try { console.warn('[rest] panel failed', e); } catch (e2) {} }
}

/* A compact line for the camp HUD — "🛏 Long rest: 18 food, 12 supplies" or the
   reason it is blocked. Cheap enough to call on every camp render. */
function hudLine() {
  try {
    const q = quote('long');
    if (!q.canRest) return { ok: false, text: q.blocked };
    return {
      ok: true,
      text: Object.keys(q.cost).map(k => `${q.cost[k]} ${k}`).join(' · '),
      charges: q.charges,
      maxCharges: q.maxCharges,
    };
  } catch (e) { return { ok: false, text: '' }; }
}

try {
  window.MythicRest = {
    open, take, quote, hudLine,
    state, resters, priceOf, costMultiplier,
    REST,
    available: () => ready(),
    VERSION: 'rest-1.0.0',
  };
  try { console.info('%c🛏 MythicRest%c ready — short/long rest economy.', 'color:#8fb0ff;font-weight:700', 'color:inherit'); } catch (e) {}
} catch (e) {}
