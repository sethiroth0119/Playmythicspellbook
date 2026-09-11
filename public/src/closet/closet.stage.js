/* closet.stage.js — the 3D STAGE the studio and the creator share.

   One renderer, one scene with a soft key light and a floor disc, one body
   on it, dressed through closet.dress.js, an OrbitControls camera (or a
   built-in orbit when the addon is missing) and the CAMERA SWING: swingTo()
   eases the camera and its target to a framing over ~600 ms, which is what
   makes picking "Watches" glide down to the wrist.

   Uses the same r128 THREE as Athena (mapforge.three.js) so a body that
   works in a hub works here. */

import { ensureThree } from '../mapforge/mapforge.three.js';
import { loadModel, cloneModel, dress } from './closet.dress.js';
import { focusFor, focusBody } from './closet.rig.js';
import { CAT_BY_ID } from './closet.model.js';

export async function createStage(host, opts) {
  opts = opts || {};
  const { THREE } = await ensureThree();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  const canvas = renderer.domElement; canvas.style.display = 'block'; canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.tabIndex = 0;
  host.appendChild(canvas);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(opts.background || 0x0f1119);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.02, 200);
  camera.position.set(0.4, 1.3, -3.2); camera.lookAt(0, 1, 0);
  /* a studio light rig: key, fill, rim, a little sky */
  scene.add(new THREE.HemisphereLight(0xd9e4ff, 0x2a2216, 0.55));
  const key = new THREE.DirectionalLight(0xfff1d6, 1.35); key.position.set(-2.5, 4.5, -3); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.camera.near = 0.5; key.shadow.camera.far = 20; key.shadow.camera.left = key.shadow.camera.bottom = -3; key.shadow.camera.right = key.shadow.camera.top = 3; key.shadow.bias = -0.0008; scene.add(key);
  const fill = new THREE.DirectionalLight(0xbcd0ff, 0.5); fill.position.set(3, 2, -2); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffe2a8, 0.7); rim.position.set(0.5, 3, 4); scene.add(rim);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1.6, 48), new THREE.MeshStandardMaterial({ color: 0x1a1e2c, roughness: 0.95, metalness: 0 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.58, 1.62, 64), new THREE.MeshBasicMaterial({ color: 0xd4af37, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.002; scene.add(ring);

  let controls = null;
  if (THREE.OrbitControls) { controls = new THREE.OrbitControls(camera, canvas); controls.enableDamping = true; controls.dampingFactor = 0.08; controls.target.set(0, 1, 0); controls.minDistance = 0.25; controls.maxDistance = 12; controls.maxPolarAngle = Math.PI * 0.52; controls.update(); }

  const S = { THREE, renderer, scene, camera, controls, body: null, bodyRec: null, meas: null, dressed: null, mixer: null, clips: [], tween: null, running: true, spin: 0, catalog: opts.catalog || { items: [] }, outfit: opts.outfit || { body: '', wear: {} }, listeners: [] };
  const on = (ev, fn) => { S.listeners.push({ ev, fn }); };
  const emit = (ev, a) => S.listeners.forEach(l => { if (l.ev === ev) { try { l.fn(a); } catch (e) {} } });

  function resize() { const w = host.clientWidth || 1, h = host.clientHeight || 1; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  const ro = new ResizeObserver(resize); ro.observe(host); resize();

  /* ── the body ── */
  async function setBody(rec) {
    if (S.dressed) { try { S.dressed.dispose(); } catch (e) {} S.dressed = null; }
    if (S.body) { try { scene.remove(S.body); } catch (e) {} S.body = null; }
    S.mixer = null; S.clips = []; S.meas = null; S.bodyRec = rec || null;
    if (!rec || !rec.url) { emit('body', null); return null; }
    let tpl; try { tpl = await loadModel(THREE, rec.url); } catch (e) { emit('bodyError', e); return null; }
    if (!S.running || S.bodyRec !== rec) return null;
    const body = cloneModel(tpl);
    // the closet's loader centres a model on its middle; a body stands on its feet
    const bb = new THREE.Box3().setFromObject(body); body.position.y = -bb.min.y * (rec.scale || 1);
    body.scale.setScalar(rec.scale || 1);
    if (rec.faces === 'z') body.rotation.y = Math.PI;
    body.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(body); body.updateMatrixWorld(true);
    S.body = body; S.clips = tpl.clips || [];
    S.dressed = dress(THREE, body, S.outfit, S.catalog, { onMeasure: (m) => { S.meas = m; emit('measure', m); }, onItem: (cat, side, obj, piece) => emit('item', { cat, side, obj, piece }) });
    S.meas = S.dressed.meas;
    // idle clip, if the body has one and the record names it (measurement happened first, at rest)
    const idle = rec.anim && rec.anim.idle && S.clips.find(c => c.name === rec.anim.idle);
    if (idle) { S.mixer = new THREE.AnimationMixer(body); S.mixer.clipAction(idle).play(); }
    emit('body', body);
    return body;
  }
  function setOutfit(o) { S.outfit = o; if (S.dressed) S.dressed.setOutfit(o); }
  function setCatalog(c) { S.catalog = c; if (S.dressed) { S.dressed.dispose(); S.dressed = dress(THREE, S.body, S.outfit, S.catalog, { onMeasure: (m) => { S.meas = m; emit('measure', m); }, onItem: (cat, side, obj, piece) => emit('item', { cat, side, obj, piece }) }); } }

  /* ── the camera swing ── */
  function swingTo(focus, ms) {
    if (!focus) return;
    const fromP = camera.position.clone(), fromT = (controls ? controls.target : lookTarget).clone();
    // measurements are in the body's parent frame — this scene — so they already include where the body stands
    const toP = focus.position.clone(), toT = focus.target.clone();
    S.tween = { fromP, fromT, toP, toT, t0: performance.now(), ms: ms || 650 };
  }
  function swingToCategory(cat, side) { if (!S.meas) return; const C = CAT_BY_ID[cat]; if (!C) return; swingTo(focusFor(THREE, S.meas, C, side)); }
  function swingToBody() { if (!S.meas) return; swingTo(focusBody(THREE, S.meas)); }
  const lookTarget = new THREE.Vector3(0, 1, 0);
  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  let raf = 0, last = performance.now();
  function loop(now) {
    if (!S.running) return;
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (S.tween) {
      const k = Math.min(1, (now - S.tween.t0) / S.tween.ms), e = ease(k);
      camera.position.lerpVectors(S.tween.fromP, S.tween.toP, e);
      const tg = new THREE.Vector3().lerpVectors(S.tween.fromT, S.tween.toT, e);
      if (controls) controls.target.copy(tg); else lookTarget.copy(tg);
      if (k >= 1) S.tween = null;
    }
    if (S.spin && S.body) S.body.rotation.y += S.spin * dt;
    if (S.mixer) S.mixer.update(dt);
    if (controls) controls.update(); else camera.lookAt(lookTarget);
    emit('frame', dt);
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(loop);
  function render() { if (controls) controls.update(); else camera.lookAt(lookTarget); renderer.render(scene, camera); }

  return {
    THREE, renderer, scene, camera, controls, canvas, on,
    get body() { return S.body; }, get meas() { return S.meas; }, get dressed() { return S.dressed; }, get bodyRec() { return S.bodyRec; },
    setBody, setOutfit, setCatalog, swingTo, swingToCategory, swingToBody, render, resize,
    setSpin(v) { S.spin = +v || 0; },
    refit() { if (S.dressed) { S.meas = null; S.dressed.refit(); S.meas = S.dressed.meas; } },
    replaceItem(cat, item) { if (S.dressed) S.dressed.replace(cat, item); },
    dispose() {
      S.running = false; cancelAnimationFrame(raf); ro.disconnect();
      if (S.dressed) { try { S.dressed.dispose(); } catch (e) {} }
      if (controls) { try { controls.dispose(); } catch (e) {} }
      try { renderer.dispose(); renderer.forceContextLoss(); } catch (e) {}
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    },
  };
}
