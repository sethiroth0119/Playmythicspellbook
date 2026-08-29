/* 🗺 MISSION MAP — the roguelite campaign list, replaced by a city.
   ═══════════════════════════════════════════════════════════════════════════
   Registers window.MythicMissions and is INERT until index.html's router asks
   for it. Three things index.html calls, and nothing else:

     MythicMissions.render()      → draw the map screen; FALSE means "I could
                                    not", and the caller falls straight back to
                                    renderRlcList(). A broken map must never be
                                    a locked door in front of the whole mode.
     MythicMissions.campaign(id)  → resolve a generated mission by id, the same
                                    way getAllCampaigns() already injects the
                                    built-in Gas Station and Black Market runs.
     MythicMissions.owns(id)      → is this one of ours?

   ⚠ Everything it needs from the legacy app arrives on
     window.MythicMissionBridge (the globals trap — see bridge.js). Without the
     bridge it registers, reports false, and the old list renders. That is the
     intended failure mode, not a bug.
   ═══════════════════════════════════════════════════════════════════════════ */

import { bridge, bridgeReady } from './bridge.js';
import { screen, select } from './render.js';
import { generate, parse, missionId, PREFIX } from './graph.js';
import * as S from './state.js';
import { SITES } from './poi.js';

/* Generated campaigns are regenerated from their id on every lookup rather
   than cached, because the id IS the recipe (graph.js) — but _rlcCampaign is
   called on every node, render and reload, so a one-entry memo keeps that from
   rebuilding a whole graph dozens of times per screen. */
let last = null;
function campaign(id) {
  if (typeof id !== 'string' || id.indexOf(PREFIX) !== 0) return null;
  if (last && last.id === id) return last;
  try { last = generate(id); } catch (e) { try { console.warn('[missions] generate failed', e); } catch (e2) {} last = null; }
  return last;
}

function render() {
  if (!bridgeReady()) return false;
  try { return !!screen(); }
  catch (e) {
    try { console.warn('[missions] map render failed, falling back to the campaign list', e); } catch (e2) {}
    return false;
  }
}

const api = {
  render, campaign, select,
  owns: (id) => typeof id === 'string' && id.indexOf(PREFIX) === 0,
  // What the map would launch for a district right now — index.html has no
  // reason to know how an id is built.
  idFor: (siteId) => missionId(siteId, S.hold(siteId), S.mm().day),
  parse,
  state: S,
  sites: SITES,
  /* 🛠 Dev handles, mirroring the __mg.* convention the rest of the app uses.
       __mg.msnTick()                 — force one faction push
       __mg.msnSet('hells','scp',95)  — put a faction on a district
       __mg.msnReset()                — back to the opening board */
  _install() {
    try {
      const mg = (window.__mg = window.__mg || {});
      mg.msnTick  = () => { const l = S.tick(true); try { bridge().render(); } catch (e) {} return l; };
      mg.msnSet   = (site, fac, grip) => { const ok = S.debugSet(site, fac, grip); try { bridge().render(); } catch (e) {} return ok; };
      mg.msnReset = () => { const ok = S.debugReset(); try { bridge().render(); } catch (e) {} return ok; };
      mg.missions = api;
    } catch (e) {}
  },
};

try { window.MythicMissions = api; api._install(); } catch (e) {}
export default api;
