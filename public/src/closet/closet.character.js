/* closet.character.js — THE PLAYER'S CHARACTER, for any scene that draws one.

   Asked for: "this character should be the character for the player hub,
   the courthouse, the 3D camp when we build it, and the roguelite's 3D map
   — where the model we trade from the train becomes the player's character.
   None of that is ready yet; prepare for it."

   So this is the one door. A scene that has a three.js scene and nothing
   else gets the player's dressed character in three lines:

     const me = await MythicCloset.character.spawn(THREE, { scene });
     me.update(dt, pos, yaw, 'walk');      // every frame: where and doing what
     me.dispose();                          // on the way out

   and a scene that already draws a stand-in (the train's placeholder, a
   capsule, a marker) replaces it where it stands:

     const me = await MythicCloset.character.replace(THREE, standIn);

   What comes back is a createAvatar handle (mapforge.avatar.js): the body
   the player chose in the Player Closet, dressed in the outfit they saved,
   animated by whatever idle / walk / run clips the body carries, measured
   and fitted by the same code the closet and every hub use — so the
   character LOOKS THE SAME in every scene because it IS the same.

   ⚠ The closet only knows the closet body. A map that offers its own cast
     (a hub whose author placed characters) passes `player: map.player` and
     the map's choice wins, exactly as it does in engine.mount; with nothing
     from the map the closet body is the character. With no closet body
     chosen either, spawn() resolves to null (and replace() leaves the
     stand-in) — a scene must still draw SOMETHING, and it, not this file,
     knows what its placeholder is.

   `onChange(fn)` fires when the player saves a new outfit in the creator
   while the scene is running (the `closet:outfit` event); the usual answer
   is dispose() + spawn() again, which `spawn({ follow: true })` does for you. */

import { normalizeOutfit } from './closet.model.js';
import * as api from './closet.api.js';
import * as me from './closet.bridge.js';

/* Everything a scene may want to know before drawing: which body, its URL,
   scale and facing, and the outfit — plain data, no three.js. `null` body
   when none is chosen or it left the catalogue. */
export async function describe() {
  const outfit = normalizeOutfit(me.outfit());
  let body = null;
  try { const cat = await api.catalog(); const b = (cat.bodies || []).find(x => x.id === outfit.body && x.url); if (b) body = { id: b.id, name: b.name, url: b.url, scale: b.scale || 1, faces: b.faces === 'z' ? 'z' : '-z', anim: b.anim || {} }; } catch (e) {}
  return { body, outfit, worn: Object.keys(outfit.wear).length };
}

/* Subscribe to outfit changes (the creator's Save). Returns the unsubscribe. */
export function onChange(fn) {
  const h = (e) => { try { fn(normalizeOutfit(e && e.detail)); } catch (err) {} };
  try { window.addEventListener('closet:outfit', h); } catch (e) {}
  return () => { try { window.removeEventListener('closet:outfit', h); } catch (e) {} };
}

/* ── spawn ──
   opts.scene    the THREE.Scene (required — the avatar adds its own group)
   opts.world    an Athena world, when there is one (lets a map's own cast
                 character load through the map's asset cache)
   opts.player   the map's `player` block (model / cast / anim) — the map's
                 character wins over the closet body, as in engine.mount
   opts.outfit   override the profile outfit (a peer's packet, a preview)
   opts.pick     the map-cast pick to honour (defaults to the profile's)
   opts.visible  start visible (default true — this is a third-person door)
   opts.follow   rebuild automatically when the player saves a new outfit
   Resolves to the avatar handle, or null when nothing can be drawn. */
export async function spawn(THREE, opts) {
  opts = opts || {};
  if (!THREE || !opts.scene) throw new Error('spawn needs THREE and a scene');
  const av = await import('../mapforge/mapforge.avatar.js');
  const outfit = opts.outfit === undefined ? normalizeOutfit(me.outfit()) : normalizeOutfit(opts.outfit);
  const P = opts.player && typeof opts.player === 'object' ? opts.player : {};
  let pick = opts.pick;
  if (pick === undefined) { try { const b = window.MythicBridge; pick = b && b.avatarPick ? b.avatarPick() : ''; } catch (e) { pick = ''; } }
  const model = av.resolveCharacter(P, pick);
  if (!model && !outfit.body) return null;
  let handle = av.createAvatar(THREE, { world: opts.world || null, scene: opts.scene, outfit, player: { model, anim: P.anim || {}, animFiles: P.animFiles || [] } });
  handle.setVisible(opts.visible !== false);
  if (!opts.follow) return handle;
  /* follow: a new outfit tears the character down and builds it again in
     the same place — swapping pieces inside a live mixer is machinery for
     something that happens when the player opens a menu */
  const wrap = { get group() { return handle.group; }, get ready() { return handle.ready; }, get error() { return handle.error; } };
  let last = { pos: new THREE.Vector3(), yaw: 0, state: 'idle', visible: opts.visible !== false };
  const off = onChange(async (o) => {
    const fresh = av.createAvatar(THREE, { world: opts.world || null, scene: opts.scene, outfit: o, player: { model, anim: P.anim || {}, animFiles: P.animFiles || [] } });
    fresh.setVisible(last.visible); fresh.update(0, last.pos, last.yaw, last.state);
    const old = handle; handle = fresh; try { old.dispose(); } catch (e) {}
  });
  return Object.assign(wrap, {
    update(dt, pos, yaw, state) { last.pos.copy(pos); last.yaw = yaw; last.state = state; handle.update(dt, pos, yaw, state); },
    setVisible(v) { last.visible = !!v; handle.setVisible(v); },
    interact() { return handle.interact(); },
    clipNames() { return handle.clipNames(); },
    dispose() { off(); try { handle.dispose(); } catch (e) {} },
  });
}

/* ── replace a stand-in ──
   The roguelite's train hands over a model; the camp has a marker where the
   player stands. Give it the Object3D and the character is drawn at its
   position and heading, the stand-in hidden — not removed, so the scene can
   show it again if the character cannot be drawn (null) or is disposed. */
export async function replace(THREE, standIn, opts) {
  opts = opts || {};
  if (!standIn) throw new Error('replace needs the stand-in Object3D');
  const scene = opts.scene || rootOf(standIn);
  const h = await spawn(THREE, Object.assign({}, opts, { scene }));
  if (!h) return null;
  standIn.updateMatrixWorld(true);
  const pos = new THREE.Vector3(); standIn.getWorldPosition(pos);
  const q = new THREE.Quaternion(); standIn.getWorldQuaternion(q);
  const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
  h.update(0, pos, e.y, 'idle');
  const wasVisible = standIn.visible; standIn.visible = false;
  const dispose = h.dispose.bind(h);
  h.dispose = () => { standIn.visible = wasVisible; dispose(); };
  h.standIn = standIn;
  /* keep tracking the stand-in if the scene moves it (the train rolls on) */
  h.sync = (dt, state) => { standIn.getWorldPosition(pos); standIn.getWorldQuaternion(q); e.setFromQuaternion(q, 'YXZ'); h.update(dt || 0, pos, e.y, state || 'idle'); };
  return h;
}
function rootOf(o) { let r = o; while (r.parent) r = r.parent; return r; }
