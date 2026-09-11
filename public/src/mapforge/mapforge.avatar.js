/* mapforge.avatar.js — the player's CHARACTER in a world.

   Asked for: "a setting for the game mode and how the player will be —
   top-down, over-the-shoulder third person cinematic like Resident Evil, or
   first person — so that is the POV when players play that map, even when
   testing in the Athena Engine; and let me set the character model the
   players use, with idle / interact / walk / run animations."

   The map carries it in map.player (mapforge.format.js, normalizePlayer):
     view   'fps' | 'tps' | 'top'
     model  { a: <asset id in map.assets>, scale, faces: 'z' | '-z' }
     anim   { idle | walk | run | interact : { clip, src? } }
   createAvatar() loads the model through the world's asset cache (so an
   embedded or URL model works alike and a placed copy shares the template),
   pulls any clips that live in separate uploaded animation files, and runs
   one AnimationMixer with cross-fades. The walker (mapforge.player.js) tells
   it the state every frame; the camera rig lives there too. In first person
   the avatar is simply not shown. */

export const VIEWS = { fps: 'First person', tps: 'Third person · over the shoulder', top: 'Top-down' };

/* 🧍 WHICH CHARACTER THIS PERSON IS WEARING.
   ───────────────────────────────────────────────────────────────────────────
   A player's choice is ACCOUNT-WIDE — one character that represents them
   everywhere — but a map only offers the cast its author put in it. So the
   choice is carried as an ASSET ID and reconciled here, per map:

     · the id is in this map's cast   → wear it;
     · it is not (a map with a different cast, or a character since removed)
       → the map's own `player.model`, which is the author's default;
     · there is no default either     → null, and the caller draws the
       placeholder rather than nothing at all.

   🔴 THE LAST RULE IS THE IMPORTANT ONE AND IT IS WHY THIS RETURNS null RATHER
      THAN THROWING. In a hub the caller is drawing OTHER PEOPLE, and a peer
      whose character cannot be resolved must still appear — a player who is
      there but invisible is worse than one drawn as a capsule, because you
      walk into them and hear them speak with nothing on the screen. */
export function resolveCharacter(player, pickId) {
  const P = player && typeof player === 'object' ? player : {};
  const cast = Array.isArray(P.cast) ? P.cast : [];
  if (pickId) {
    const hit = cast.find(c => c && c.a === pickId);
    if (hit) return { a: hit.a, scale: +hit.scale > 0 ? +hit.scale : 1, faces: hit.faces === 'z' ? 'z' : '-z' };
  }
  const m = P.model;
  if (m && m.a) return { a: m.a, scale: +m.scale > 0 ? +m.scale : 1, faces: m.faces === 'z' ? 'z' : '-z' };
  return null;
}
/* Everything this map offers, the author's default first and labelled, so a
   picker never has to know the difference between the two fields. */
export function castOf(player) {
  const P = player && typeof player === 'object' ? player : {};
  const cast = (Array.isArray(P.cast) ? P.cast : []).slice();
  const m = P.model;
  if (m && m.a && !cast.some(c => c && c.a === m.a)) cast.unshift({ a: m.a, label: '', scale: m.scale, faces: m.faces, isDefault: true });
  return cast;
}
export const ANIM_STATES = ['idle', 'walk', 'run', 'interact'];

export function createAvatar(THREE, opts) {
  const { world, scene } = opts;
  const P = opts.player || {};
  const model = P.model || {};
  const anim = P.anim || {};
  const group = new THREE.Group(); group.name = 'mf-avatar'; group.visible = false;
  if (scene) scene.add(group);
  const A = { group, ready: false, error: null, state: 'idle', clips: new Map(), mixer: null, actions: new Map(), current: null, interactUntil: 0, yawOffset: model.faces === 'z' ? Math.PI : 0, scale: +model.scale > 0 ? +model.scale : 1 };

  /* which clip a state plays: its own, else a sensible stand-in */
  function clipFor(state) {
    const want = anim[state] && anim[state].clip;
    if (want && A.clips.has(want)) return { clip: A.clips.get(want), speed: anim[state].speed || 1 };
    if (state === 'run') { const w = anim.walk && anim.walk.clip; if (w && A.clips.has(w)) return { clip: A.clips.get(w), speed: 1.6 }; }
    if (state === 'interact') return null;
    const idle = anim.idle && anim.idle.clip; if (idle && A.clips.has(idle) && state !== 'idle') return { clip: A.clips.get(idle), speed: 1 };
    return null;
  }
  function play(state, once) {
    if (!A.mixer) return false;
    const c = clipFor(state); if (!c) { if (A.current) { A.current.fadeOut(0.2); A.current = null; } return false; }
    let act = A.actions.get(c.clip.name);
    if (!act) { act = A.mixer.clipAction(c.clip); A.actions.set(c.clip.name, act); }
    if (once) { act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = true; } else act.setLoop(THREE.LoopRepeat, Infinity);
    act.setEffectiveTimeScale(c.speed);
    if (A.current === act && !once) return true;
    act.reset().setEffectiveWeight(1).fadeIn(0.18).play();
    if (A.current && A.current !== act) A.current.fadeOut(0.18);
    A.current = act;
    return true;
  }

  (async () => {
    try {
      if (!model.a || !world || !world.loadAsset) throw new Error('no model');
      const { template, clips } = await world.loadAsset(model.a);
      const body = world.cloneTemplate ? world.cloneTemplate(template) : template.clone();
      body.scale.setScalar(A.scale);
      group.add(body);
      clips.forEach(c => A.clips.set(c.name, c));
      // clips that live in uploaded animation files
      const srcs = new Set(); ANIM_STATES.forEach(s => { if (anim[s] && anim[s].src) srcs.add(anim[s].src); });
      for (const src of srcs) { try { const ext = await world.loadExtClips(src); ext.forEach(c => { if (!A.clips.has(c.name)) A.clips.set(c.name, c); }); } catch (e) {} }
      A.mixer = new THREE.AnimationMixer(body);
      A.ready = true;
      play(A.state);
    } catch (e) { A.error = (e && e.message) || String(e); }
  })();

  return {
    group,
    get ready() { return A.ready; }, get error() { return A.error; },
    clipNames: () => Array.from(A.clips.keys()),
    setVisible(v) { group.visible = !!v; },
    /* the walker calls this every frame */
    update(dt, pos, yaw, state) {
      group.position.set(pos.x, pos.y, pos.z);
      group.rotation.y = yaw + A.yawOffset;
      const now = performance.now();
      if (A.interactUntil && now < A.interactUntil) state = 'interact';
      else if (A.interactUntil) { A.interactUntil = 0; A.current = null; }
      if (state !== A.state || (A.current === null && A.mixer)) { A.state = state; play(state, state === 'interact'); }
      if (A.mixer) A.mixer.update(dt);
    },
    /* E pressed: play the interact clip once, then fall back to the movement state */
    interact() {
      const c = clipFor('interact'); if (!c) return false;
      A.interactUntil = performance.now() + c.clip.duration * 1000 / (c.speed || 1);
      A.state = 'interact'; play('interact', true);
      return true;
    },
    dispose() {
      try { if (A.mixer) A.mixer.stopAllAction(); } catch (e) {}
      try { if (group.parent) group.parent.remove(group); } catch (e) {}
    },
  };
}
