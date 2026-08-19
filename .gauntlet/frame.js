/* Point the shipped camera at ONE THING and drive the render.
   Two traps, both of them capture.mjs's and both of them paid for already:
     · OrbitControls is set up for a PLAYER — minDistance 6, maxPolarAngle 82.8°
       — and every controls.update() re-derives the camera from those clamps, so
       an eye-level request comes out on the roof. Relax the limits, THEN set
       the target, THEN take the transform back by hand.
     · rAF is ~0.56 Hz here, so render() is called directly; shot.mjs's 4 s wait
       is what lets the compositor put it on the screen. */
(() => {
  const F = window.__FRAME;
  const nc = window.__nc, { renderer, scene, camera } = nc.three();
  const c = nc.controls;
  if (c) { c.maxPolarAngle = Math.PI * .4995; c.minDistance = .05; c.enableDamping = false;
           c.target.set(F.at[0], F.at[1], F.at[2]); c.update(); }
  camera.position.set(F.cam[0], F.cam[1], F.cam[2]);
  camera.lookAt(F.at[0], F.at[1], F.at[2]);
  camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
  try { nc.cullAgents && nc.cullAgents(); } catch (e) {}
  for (let i = 0; i < 3; i++) renderer.render(scene, camera);
  return JSON.stringify({ cam: F.cam, at: F.at, y: +camera.position.y.toFixed(3) });
})()
