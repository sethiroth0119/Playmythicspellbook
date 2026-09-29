/* 👕 PLAYER CLOSET — entry point. Registers window.MythicCloset and stays
   inert until something opens it (the Character Forge tile, the Athena top
   bar, ?closet=1 / ?closetstudio=1). three.js is fetched only then.

   What is here for the rest of the game:
     open({ cat })        the Player Closet (character creator) for players
     openStudio()         the Closet Studio (admin) — brands, clothing, bodies
     catalog()            brands / items / bodies, cloud ∪ device (cached)
     dress(THREE, body, outfit, catalog)   wear an outfit on any model
     bodySpec(outfit, catalog)             the closet body as { url, scale, faces }
     outfit() / packOutfit / unpackOutfit  the player's outfit and its packet form
     CATEGORIES           the slots
     character            spawn(THREE, { scene }) / replace(THREE, standIn) — the player's
                          dressed character for any scene (closet.character.js)

   The world side (mapforge.avatar.js) reaches these through dynamic imports
   so a hub still runs if this folder ever fails to load. */

import { CATEGORIES, CAT_BY_ID, packOutfit, unpackOutfit, normalizeOutfit, normalizeItem, normalizeBrand, normalizeBody, priceLabel, CLOSET_VERSION } from './closet.model.js';
import * as api from './closet.api.js';
import * as me from './closet.bridge.js';
import { dress, loadModel, cloneModel, measureItem } from './closet.dress.js';
import { measure, findBones, focusFor, focusBody } from './closet.rig.js';
import { openCreator, closeCreator, isOpen } from './closet.creator.js';
import { openStudio, closeStudio, isStudioOpen } from './closet.studio.js';
import * as character from './closet.character.js';

/* The closet body a player chose, as the shape createAvatar understands —
   null when they chose none or it is not (or no longer) in the catalogue. */
export function bodySpec(outfit, catalog) {
  const o = normalizeOutfit(outfit); if (!o.body || !catalog) return null;
  const b = (catalog.bodies || []).find(x => x.id === o.body && x.url);
  return b ? { url: b.url, scale: b.scale || 1, faces: b.faces === 'z' ? 'z' : '-z', anim: b.anim || {} } : null;
}

const MythicCloset = {
  version: CLOSET_VERSION,
  open: (opts) => openCreator(opts).catch(e => { try { console.warn('[closet] open failed', e); } catch (_) {} return null; }),
  close: closeCreator, isOpen,
  openStudio: (opts) => openStudio(opts).catch(e => { try { console.warn('[closet] studio failed', e); } catch (_) {} return null; }),
  closeStudio, isStudioOpen,
  catalog: api.catalog, cached: api.cached, invalidate: api.invalidate,
  brands: api.brands, items: api.items, bodies: api.bodies,
  dress, loadModel, cloneModel, measureItem, measure, findBones, focusFor, focusBody, bodySpec,
  outfit: me.outfit, setOutfit: me.setOutfit, owned: me.owned,
  packOutfit, unpackOutfit, normalizeOutfit, normalizeItem, normalizeBrand, normalizeBody, priceLabel,
  CATEGORIES, CAT_BY_ID,
  /* 🧍 the player's character for ANY scene — the hub, the courthouse, the camp, the roguelite map: spawn / replace / describe / onChange (closet.character.js) */
  character: { spawn: character.spawn, replace: character.replace, describe: character.describe, onChange: character.onChange },
};
try { window.MythicCloset = MythicCloset; } catch (e) {}

// Deep links: /?closet=1 (optionally &cat=watch) and /?closetstudio=1
try {
  const q = new URLSearchParams(location.search);
  const go = (fn) => { if (document.readyState === 'complete') setTimeout(fn, 800); else window.addEventListener('load', () => setTimeout(fn, 800), { once: true }); };
  if (q.get('closet') === '1') go(() => MythicCloset.open({ cat: q.get('cat') || '' }));
  else if (q.get('closetstudio') === '1') go(() => MythicCloset.openStudio());
} catch (e) {}

export default MythicCloset;
