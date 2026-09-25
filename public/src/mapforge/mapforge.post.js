/* ═══════════════════════════════════════════════════════════════════════════
   mapforge.post.js — the "look" pass: bloom + vignette composited over the
   scene render. Self-contained (no EffectComposer / UnrealBloomPass addons,
   which would be four more CDN scripts the sandbox cannot fetch and the
   game would have to keep in sync with r128).

   Pipeline: scene → RGBA target (tone-mapped by the materials, as three does
   when renderer.toneMapping is set) → bright pass at half size (threshold,
   soft knee) → two separable blur iterations at quarter size → composite:
   scene + bloom × strength, vignette. With bloom and vignette both 0 the
   scene is drawn straight to the canvas and no target is touched. */

export function createPost(THREE, renderer) {
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadGeo = new THREE.PlaneGeometry(2, 2);
  const mk = (frag, uniforms) => new THREE.ShaderMaterial({ uniforms, depthTest: false, depthWrite: false, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: frag });
  const bright = mk('uniform sampler2D tex; uniform float thr; varying vec2 vUv; void main(){ vec4 c = texture2D(tex, vUv); float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722)); float k = 0.2; float soft = clamp((l - thr + k) / (2.0 * k), 0.0, 1.0); float w = max(soft * soft, step(thr, l)) ; gl_FragColor = vec4(c.rgb * w, 1.0); }', { tex: { value: null }, thr: { value: 0.75 } });
  const blur = mk('uniform sampler2D tex; uniform vec2 dir; varying vec2 vUv; void main(){ vec4 s = texture2D(tex, vUv) * 0.227; s += texture2D(tex, vUv + dir * 1.384) * 0.316; s += texture2D(tex, vUv - dir * 1.384) * 0.316; s += texture2D(tex, vUv + dir * 3.230) * 0.070; s += texture2D(tex, vUv - dir * 3.230) * 0.070; gl_FragColor = s; }', { tex: { value: null }, dir: { value: new THREE.Vector2() } });
  const comp = mk('uniform sampler2D scene; uniform sampler2D bloom; uniform float strength; uniform float vig; varying vec2 vUv; void main(){ vec3 c = texture2D(scene, vUv).rgb + texture2D(bloom, vUv).rgb * strength; vec2 d = vUv - 0.5; float v = 1.0 - smoothstep(0.35, 0.95, length(d) * 1.4) * vig; gl_FragColor = vec4(c * v, 1.0); }', { scene: { value: null }, bloom: { value: null }, strength: { value: 0 }, vig: { value: 0 } });
  const quad = new THREE.Mesh(quadGeo, comp); const quadScene = new THREE.Scene(); quadScene.add(quad);
  let w = 0, h = 0, rtScene = null, rtA = null, rtB = null, rtHalf = null;
  function ensure() {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2()); const nw = Math.max(2, size.x | 0), nh = Math.max(2, size.y | 0);
    if (nw === w && nh === h && rtScene) return;
    dispose(false); w = nw; h = nh;
    const o = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, depthBuffer: true, stencilBuffer: false };
    rtScene = new THREE.WebGLRenderTarget(w, h, o);
    rtHalf = new THREE.WebGLRenderTarget(w >> 1, h >> 1, Object.assign({}, o, { depthBuffer: false }));
    rtA = new THREE.WebGLRenderTarget(w >> 2, h >> 2, Object.assign({}, o, { depthBuffer: false }));
    rtB = new THREE.WebGLRenderTarget(w >> 2, h >> 2, Object.assign({}, o, { depthBuffer: false }));
  }
  function pass(mat, target) { quad.material = mat; renderer.setRenderTarget(target); renderer.render(quadScene, quadCam); }
  const api = {
    enabled: true,
    /* p = { bloom, threshold, vignette } — with everything at zero this is a plain render */
    render(scene, camera, p) {
      p = p || {};
      const strength = api.enabled ? Math.max(0, +p.bloom || 0) : 0, vig = api.enabled ? Math.max(0, Math.min(1, +p.vignette || 0)) : 0;
      if (strength <= 0 && vig <= 0) { renderer.setRenderTarget(null); renderer.render(scene, camera); return false; }
      ensure();
      renderer.setRenderTarget(rtScene); renderer.render(scene, camera);
      if (strength > 0) {
        bright.uniforms.tex.value = rtScene.texture; bright.uniforms.thr.value = p.threshold == null ? 0.75 : +p.threshold; pass(bright, rtHalf);
        let src = rtHalf;
        for (let i = 0; i < 2; i++) {
          blur.uniforms.tex.value = src.texture; blur.uniforms.dir.value.set(1 / rtA.width, 0); pass(blur, rtA);
          blur.uniforms.tex.value = rtA.texture; blur.uniforms.dir.value.set(0, 1 / rtB.height); pass(blur, rtB);
          src = rtB;
        }
        comp.uniforms.bloom.value = rtB.texture;
      } else comp.uniforms.bloom.value = rtScene.texture;   // (strength 0 → adds nothing)
      comp.uniforms.scene.value = rtScene.texture; comp.uniforms.strength.value = strength; comp.uniforms.vig.value = vig;
      pass(comp, null);
      return true;
    },
    dispose,
  };
  function dispose(all) { [rtScene, rtA, rtB, rtHalf].forEach(rt => { if (rt) rt.dispose(); }); rtScene = rtA = rtB = rtHalf = null; w = h = 0; if (all !== false) { quadGeo.dispose(); bright.dispose(); blur.dispose(); comp.dispose(); } }
  return api;
}
