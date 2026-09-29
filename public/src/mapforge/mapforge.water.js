/* mapforge.water.js — one animated water plane per map.

   Unity/Unreal-style "global water level": a plane at `water.level` covering
   the whole terrain (plus a margin so the horizon never shows a hard edge).
   Waves are vertex sines with an analytic normal — no normal-map texture,
   which keeps the runtime asset-free (and is why it works with the r128
   build the battle board already loads). Fresnel + a sun highlight sell it. */

export function createWater(THREE, w, size) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 }, uWave: { value: 0.12 }, uSpeed: { value: 1 },
    uColor: { value: new THREE.Color('#2e6f9e') }, uDeep: { value: new THREE.Color('#123a58') },
    uOpacity: { value: 0.78 }, uSun: { value: new THREE.Vector3(0.3, 0.8, 0.2) },
  }]);
  const material = new THREE.ShaderMaterial({
    uniforms, fog: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `
      uniform float uTime, uWave, uSpeed;
      varying vec3 vWorld; varying vec3 vN;
      #include <fog_pars_vertex>
      void main() {
        vec3 p = position; float t = uTime * uSpeed;
        float a = sin(p.x * 0.35 + t * 1.1), b = sin(p.z * 0.28 - t * 0.9), c = sin((p.x + p.z) * 0.12 + t * 0.6);
        p.y += (a * 0.5 + b * 0.35 + c * 0.6) * uWave;
        float dx = 0.35 * cos(p.x * 0.35 + t * 1.1) * 0.5 + 0.12 * cos((p.x + p.z) * 0.12 + t * 0.6) * 0.6;
        float dz = 0.28 * cos(p.z * 0.28 - t * 0.9) * 0.35 + 0.12 * cos((p.x + p.z) * 0.12 + t * 0.6) * 0.6;
        vN = normalize(vec3(-dx * uWave, 1.0, -dz * uWave));
        vec4 wp = modelMatrix * vec4(p, 1.0); vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform vec3 uColor, uDeep, uSun; uniform float uOpacity, uTime;
      varying vec3 vWorld; varying vec3 vN;
      #include <fog_pars_fragment>
      void main() {
        vec3 V = normalize(cameraPosition - vWorld); vec3 N = normalize(vN);
        if (!gl_FrontFacing) N = -N;
        float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        vec3 col = mix(uDeep, uColor, 0.35 + 0.65 * max(N.y, 0.0));
        col = mix(col, vec3(0.86, 0.93, 1.0), fres * 0.55);
        vec3 H = normalize(normalize(uSun) + V); float spec = pow(max(dot(N, H), 0.0), 140.0);
        col += vec3(1.0) * spec * 0.9;
        float rip = sin(vWorld.x * 2.1 + uTime * 1.7) * sin(vWorld.z * 1.7 - uTime * 1.3);
        col += 0.025 * rip;
        gl_FragColor = vec4(col, uOpacity * (0.72 + 0.28 * fres));
        #include <fog_fragment>
      }`,
  });
  const seg = 96;
  const geo = new THREE.PlaneGeometry(size * 1.6, size * 1.6, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'mf-water'; mesh.userData.mfWater = true; mesh.renderOrder = 2; mesh.frustumCulled = false;

  const api = {
    mesh,
    apply(cfg) {
      mesh.visible = cfg.on !== false;
      mesh.position.y = cfg.level;
      uniforms.uColor.value.set(cfg.color);
      uniforms.uDeep.value.set(cfg.color).multiplyScalar(0.42);
      uniforms.uOpacity.value = cfg.opacity; uniforms.uWave.value = cfg.wave; uniforms.uSpeed.value = cfg.speed;
    },
    resize(newSize) { const g = new THREE.PlaneGeometry(newSize * 1.6, newSize * 1.6, seg, seg); g.rotateX(-Math.PI / 2); mesh.geometry.dispose(); mesh.geometry = g; },
    update(time, sunDir) { uniforms.uTime.value = time; if (sunDir) uniforms.uSun.value.copy(sunDir); },
    dispose() { try { geo.dispose(); material.dispose(); } catch (e) {} },
  };
  api.apply(w);
  return api;
}
