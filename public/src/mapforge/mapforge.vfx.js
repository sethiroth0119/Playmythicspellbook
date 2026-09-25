/* mapforge.vfx.js — particles: fire, smoke, steam, fog, sparks, gas, dust,
   and the weather (rain, storm, snow, ash, dust storm).

   Everything is GPU-driven. A particle's whole life is a function of time in
   the vertex shader — start, velocity, gravity, wind, turbulence — and when a
   particle dies it is reborn on the next loop with a fresh hash, so an
   emitter costs ONE draw call and zero per-frame CPU work no matter how many
   particles it has. Sprites are drawn on a canvas at startup (no textures to
   host). Fire is additive, smoke is alpha-blended and takes the scene fog, so
   both sit correctly in the world instead of glowing through distance haze. */

const sprites = {};
function sprite(THREE, kind) {
  if (sprites[kind]) return sprites[kind];
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  const g = (r0, r1, stops) => { const gr = x.createRadialGradient(64, 64, r0, 64, 64, r1); stops.forEach(([o, col]) => gr.addColorStop(o, col)); return gr; };
  if (kind === 'soft') { x.fillStyle = g(0, 64, [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,.55)'], [1, 'rgba(255,255,255,0)']]); x.fillRect(0, 0, 128, 128); }
  else if (kind === 'smoke') {
    x.fillStyle = g(0, 64, [[0, 'rgba(255,255,255,.9)'], [0.5, 'rgba(255,255,255,.4)'], [1, 'rgba(255,255,255,0)']]); x.fillRect(0, 0, 128, 128);
    // blotches break the perfect disc so overlapping puffs read as a cloud, not bubbles
    x.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 14; i++) { const a = Math.random() * 6.28, d = 20 + Math.random() * 34, r = 8 + Math.random() * 16; x.fillStyle = g(0, 1, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0)']]); const gg = x.createRadialGradient(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 0, 64 + Math.cos(a) * d, 64 + Math.sin(a) * d, r); gg.addColorStop(0, 'rgba(0,0,0,.55)'); gg.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gg; x.fillRect(0, 0, 128, 128); }
  }
  else if (kind === 'flame') {
    const gr = x.createRadialGradient(64, 78, 4, 64, 64, 60); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,.75)'); gr.addColorStop(0.7, 'rgba(255,255,255,.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.save(); x.translate(64, 64); x.scale(0.75, 1.15); x.translate(-64, -64); x.fillStyle = gr; x.fillRect(0, 0, 128, 128); x.restore();
  }
  else if (kind === 'spark') { x.fillStyle = g(0, 30, [[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(255,255,255,.9)'], [1, 'rgba(255,255,255,0)']]); x.fillRect(0, 0, 128, 128); }
  else if (kind === 'flake') { x.translate(64, 64); x.fillStyle = 'rgba(255,255,255,.95)'; for (let i = 0; i < 6; i++) { x.rotate(Math.PI / 3); x.fillRect(-4, -46, 8, 92); x.fillRect(-14, -30, 28, 6); } x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'destination-in'; x.fillStyle = g(0, 60, [[0, 'rgba(0,0,0,1)'], [0.6, 'rgba(0,0,0,1)'], [1, 'rgba(0,0,0,0)']]); x.fillRect(0, 0, 128, 128); }
  else if (kind === 'streak') { const gr = x.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(58, 0, 12, 128); const gh = x.createLinearGradient(52, 0, 76, 0); gh.addColorStop(0, 'rgba(0,0,0,1)'); gh.addColorStop(0.5, 'rgba(0,0,0,0)'); gh.addColorStop(1, 'rgba(0,0,0,1)'); x.globalCompositeOperation = 'destination-out'; x.fillStyle = gh; x.fillRect(52, 0, 24, 128); }
  else if (kind === 'ash') { x.fillStyle = g(0, 40, [[0, 'rgba(255,255,255,1)'], [0.5, 'rgba(255,255,255,.8)'], [1, 'rgba(255,255,255,0)']]); x.beginPath(); x.moveTo(40, 44); x.lineTo(80, 36); x.lineTo(92, 70); x.lineTo(60, 96); x.lineTo(34, 78); x.closePath(); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearMipmapLinearFilter;
  return (sprites[kind] = t);
}

const VERT = `
  attribute vec3 aVel; attribute float aBirth; attribute float aLife; attribute float aSize; attribute float aSeed;
  uniform float uTime, uGravity, uTurb, uSpread, uSize0, uSize1, uScale, uSpin, uCycle; uniform vec3 uWind; uniform vec3 uBox; uniform vec3 uCam; uniform float uWrap;
  varying float vAge; varying float vSeed; varying float vRot;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  #include <fog_pars_vertex>
  void main() {
    float t = uTime - aBirth;
    float loop = floor(t / aLife);
    float age = t - loop * aLife;
    float a01 = age / aLife;
    float h1 = hash(aSeed + loop * 7.13), h2 = hash(aSeed * 1.71 + loop * 3.31), h3 = hash(aSeed * 2.37 + loop * 5.71);
    vec3 start = position + (vec3(h1, h2, h3) - 0.5) * uSpread;
    vec3 vel = aVel * (0.75 + 0.5 * h2);
    vec3 p = start + vel * age + vec3(0.0, -0.5 * uGravity * age * age, 0.0) + uWind * age;
    p.x += sin(age * 2.6 + aSeed * 13.0) * uTurb * a01;
    p.z += cos(age * 2.1 + aSeed * 9.0) * uTurb * a01;
    if (uWrap > 0.5) {
      // weather: particles live in a box that travels with the camera; wrap so it never runs out
      vec3 rel = p - uCam + uBox * 0.5;
      p = mod(rel, uBox) - uBox * 0.5 + uCam;
    }
    vAge = a01; vSeed = aSeed; vRot = aSeed * 6.283 + age * uSpin * (h3 - 0.5) * 2.0;
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    float sz = aSize * mix(uSize0, uSize1, a01);
    gl_PointSize = max(1.0, sz * uScale / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const FRAG = `
  uniform sampler2D uMap; uniform vec3 uC0, uC1, uC2; uniform float uOpacity, uFadeIn, uFadeOut;
  varying float vAge; varying float vSeed; varying float vRot;
  #include <fog_pars_fragment>
  void main() {
    vec2 uv = gl_PointCoord - 0.5; float c = cos(vRot), s = sin(vRot);
    uv = vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c) + 0.5;
    vec4 tex = texture2D(uMap, uv);
    vec3 col = vAge < 0.5 ? mix(uC0, uC1, vAge * 2.0) : mix(uC1, uC2, (vAge - 0.5) * 2.0);
    float a = tex.a * smoothstep(0.0, uFadeIn, vAge) * (1.0 - smoothstep(uFadeOut, 1.0, vAge)) * uOpacity;
    if (a < 0.01) discard;
    gl_FragColor = vec4(col * tex.rgb, a);
    #include <fog_fragment>
  }`;

/* One particle system = one Points. `def` is a recipe; see RECIPES. */
function makeSystem(THREE, def, scale, intensity) {
  const n = Math.max(4, Math.round(def.count * (intensity || 1)));
  const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3), birth = new Float32Array(n), life = new Float32Array(n), size = new Float32Array(n), seed = new Float32Array(n);
  const s = scale || 1;
  for (let i = 0; i < n; i++) {
    const r = Math.random(), a = Math.random() * Math.PI * 2, rad = Math.sqrt(Math.random()) * def.radius * s;
    pos[i * 3] = Math.cos(a) * rad; pos[i * 3 + 1] = (def.y || 0) * s + Math.random() * (def.height || 0) * s; pos[i * 3 + 2] = Math.sin(a) * rad;
    const v = def.vel; const spread = def.velSpread || 0;
    vel[i * 3] = (v[0] + (Math.random() - 0.5) * spread) * s; vel[i * 3 + 1] = (v[1] + (Math.random() - 0.5) * spread * 0.5) * s; vel[i * 3 + 2] = (v[2] + (Math.random() - 0.5) * spread) * s;
    life[i] = def.life * (0.7 + Math.random() * 0.6);
    birth[i] = -Math.random() * life[i] * 4;              // stagger so the emitter is already "running" at t=0
    size[i] = (0.7 + Math.random() * 0.6) * s;
    seed[i] = r * 100 + i * 0.37;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aVel', new THREE.BufferAttribute(vel, 3));
  geo.setAttribute('aBirth', new THREE.BufferAttribute(birth, 1)); geo.setAttribute('aLife', new THREE.BufferAttribute(life, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1)); geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 }, uGravity: { value: def.gravity || 0 }, uTurb: { value: (def.turb || 0) * s }, uSpread: { value: 0 },
    uSize0: { value: def.size0 * s }, uSize1: { value: def.size1 * s }, uScale: { value: 300 }, uSpin: { value: def.spin || 0 },
    uWind: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(1, 1, 1) }, uCam: { value: new THREE.Vector3() }, uWrap: { value: def.wrap ? 1 : 0 }, uCycle: { value: 0 },
    uMap: { value: sprite(THREE, def.sprite) }, uC0: { value: new THREE.Color(def.colors[0]) }, uC1: { value: new THREE.Color(def.colors[1]) }, uC2: { value: new THREE.Color(def.colors[2]) },
    uOpacity: { value: def.opacity == null ? 1 : def.opacity }, uFadeIn: { value: def.fadeIn == null ? 0.15 : def.fadeIn }, uFadeOut: { value: def.fadeOut == null ? 0.6 : def.fadeOut },
  }]);
  uniforms.uMap.value = sprite(THREE, def.sprite);   // merge() clones textures' holders; make sure the real one is set
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: !def.additive,
    blending: def.additive ? THREE.AdditiveBlending : THREE.NormalBlending });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = def.additive ? 12 : 11;
  pts.userData.mfFx = true;
  return pts;
}

/* ── recipes: the look of each effect ── */
const RECIPES = {
  // fire = a hot core of small fast tongues + a wider, cooler skirt; two layers
  // is what stops it reading as one glowing ball
  flame:  { count: 140, radius: 0.2,  height: 0.15, vel: [0, 2.3, 0], velSpread: 0.6, life: 0.75, gravity: -1.6, turb: 0.16, size0: 0.62, size1: 0.12, sprite: 'flame', colors: ['#fff6c8', '#ffb01a', '#d02a08'], additive: true, opacity: 0.9, fadeIn: 0.06, fadeOut: 0.5, spin: 2.0 },
  skirt:  { count: 60,  radius: 0.36, height: 0.05, vel: [0, 1.2, 0], velSpread: 0.5, life: 0.6, gravity: -0.6, turb: 0.1, size0: 0.9, size1: 0.3, sprite: 'flame', colors: ['#ff9a2a', '#ff4a10', '#5a0a00'], additive: true, opacity: 0.55, fadeIn: 0.05, fadeOut: 0.45, spin: 1.0 },
  embers: { count: 40,  radius: 0.3,  height: 0.3, vel: [0, 2.4, 0], velSpread: 1.4, life: 1.6, gravity: 0.6, turb: 0.35, size0: 0.14, size1: 0.05, sprite: 'spark', colors: ['#fff0c0', '#ffb347', '#ff5a00'], additive: true, opacity: 1, fadeIn: 0.02, fadeOut: 0.7 },
  smoke:  { count: 70,  radius: 0.35, height: 0.6, y: 0.8, vel: [0, 1.1, 0], velSpread: 0.35, life: 3.8, gravity: -0.05, turb: 0.5, size0: 0.9, size1: 3.4, sprite: 'smoke', colors: ['#5a5652', '#3a3835', '#2a2927'], opacity: 0.42, fadeIn: 0.2, fadeOut: 0.55, spin: 0.6 },
  darksmoke:{ count: 110, radius: 0.6, height: 0.8, vel: [0, 1.4, 0], velSpread: 0.4, life: 5.5, gravity: -0.03, turb: 0.9, size0: 1.4, size1: 6.0, sprite: 'smoke', colors: ['#3c3a38', '#232221', '#151515'], opacity: 0.55, fadeIn: 0.15, fadeOut: 0.5, spin: 0.4 },
  steam:  { count: 60,  radius: 0.3,  height: 0.2, vel: [0, 1.3, 0], velSpread: 0.4, life: 2.4, gravity: -0.1, turb: 0.4, size0: 0.6, size1: 2.4, sprite: 'smoke', colors: ['#ffffff', '#e8eef2', '#d8dde2'], opacity: 0.4, fadeIn: 0.1, fadeOut: 0.5, spin: 0.8 },
  fog:    { count: 40,  radius: 4.0,  height: 0.6, y: 0.2, vel: [0.25, 0.04, 0.1], velSpread: 0.3, life: 9, gravity: 0, turb: 0.8, size0: 5.0, size1: 7.0, sprite: 'smoke', colors: ['#dfe6ea', '#d2d9de', '#c8ced2'], opacity: 0.16, fadeIn: 0.3, fadeOut: 0.6, spin: 0.15 },
  sparks: { count: 50,  radius: 0.12, height: 0.1, vel: [0, 2.2, 0], velSpread: 3.2, life: 0.55, gravity: 9, turb: 0, size0: 0.12, size1: 0.04, sprite: 'spark', colors: ['#ffffff', '#9be8ff', '#2a9bff'], additive: true, opacity: 1, fadeIn: 0.02, fadeOut: 0.75 },
  toxic:  { count: 70,  radius: 1.6,  height: 0.4, vel: [0, 0.35, 0], velSpread: 0.25, life: 5, gravity: -0.02, turb: 0.7, size0: 1.2, size1: 3.6, sprite: 'smoke', colors: ['#b8ff7a', '#5fbf3a', '#1f5a22'], opacity: 0.3, fadeIn: 0.25, fadeOut: 0.5, spin: 0.5 },
  dust:   { count: 60,  radius: 3.0,  height: 1.5, vel: [0.6, 0.15, 0.1], velSpread: 0.6, life: 6, gravity: 0, turb: 1.2, size0: 1.6, size1: 3.2, sprite: 'smoke', colors: ['#d9bb8c', '#c9a274', '#b08a5e'], opacity: 0.14, fadeIn: 0.3, fadeOut: 0.6, spin: 0.3 },
  motes:  { count: 80,  radius: 3.0,  height: 3.0, vel: [0.1, 0.05, 0], velSpread: 0.3, life: 7, gravity: 0, turb: 0.6, size0: 0.07, size1: 0.07, sprite: 'soft', colors: ['#fff6d8', '#ffe9b0', '#ffd98a'], additive: true, opacity: 0.55, fadeIn: 0.3, fadeOut: 0.6 },
  // weather (camera-relative, wrapping)
  rain:   { count: 4500, radius: 22, height: 26, y: -8, vel: [0, -24, 0], velSpread: 1.5, life: 3, gravity: 0, turb: 0, size0: 0.34, size1: 0.34, sprite: 'streak', colors: ['#c9d8e6', '#c9d8e6', '#c9d8e6'], opacity: 0.42, fadeIn: 0, fadeOut: 1, wrap: true },
  storm:  { count: 7000, radius: 24, height: 28, y: -8, vel: [0, -30, 0], velSpread: 2.0, life: 3, gravity: 0, turb: 0, size0: 0.4, size1: 0.4, sprite: 'streak', colors: ['#b9c9d8', '#b9c9d8', '#b9c9d8'], opacity: 0.5, fadeIn: 0, fadeOut: 1, wrap: true },
  snow:   { count: 1800, radius: 22, height: 24, y: -6, vel: [0, -1.4, 0], velSpread: 0.6, life: 14, gravity: 0, turb: 0.9, size0: 0.14, size1: 0.14, sprite: 'flake', colors: ['#ffffff', '#f4f8ff', '#e8f0ff'], opacity: 0.9, fadeIn: 0, fadeOut: 1, wrap: true, spin: 1.2 },
  ash:    { count: 1200, radius: 22, height: 22, y: -6, vel: [0.2, -0.7, 0], velSpread: 0.5, life: 16, gravity: 0, turb: 1.2, size0: 0.12, size1: 0.12, sprite: 'ash', colors: ['#4a4644', '#333130', '#222'], opacity: 0.9, fadeIn: 0, fadeOut: 1, wrap: true, spin: 2.0 },
  duststorm:{ count: 900, radius: 24, height: 12, y: -3, vel: [9, 0.3, 1.5], velSpread: 2.5, life: 6, gravity: 0, turb: 1.5, size0: 2.5, size1: 3.5, sprite: 'smoke', colors: ['#d4b183', '#c39a68', '#a8825a'], opacity: 0.16, fadeIn: 0.15, fadeOut: 0.7, wrap: true, spin: 0.3 },
};

/* Emitter kinds a builder can place (and the ones props attach). Each is a
   stack of systems plus, for fire, a flickering light. */
export const EMITTERS = {
  fire:   { label: 'Fire',        icon: '🔥', systems: ['skirt', 'flame', 'embers', 'smoke'], light: { color: '#ff7a1a', intensity: 1.6, distance: 9, flicker: 0.35 } },
  bigfire:{ label: 'Blaze',       icon: '🔥', systems: ['skirt', 'flame', 'embers', 'darksmoke'], scale: 2.4, light: { color: '#ff6a10', intensity: 3, distance: 18, flicker: 0.4 } },
  smoke:  { label: 'Smoke',       icon: '💨', systems: ['smoke'] },
  darksmoke:{ label: 'Black smoke', icon: '🌫️', systems: ['darksmoke'] },
  steam:  { label: 'Steam',       icon: '♨️', systems: ['steam'] },
  fog:    { label: 'Ground fog',  icon: '🌁', systems: ['fog'] },
  sparks: { label: 'Sparks',      icon: '✨', systems: ['sparks'], light: { color: '#7fd4ff', intensity: 0.8, distance: 5, flicker: 0.9 } },
  toxic:  { label: 'Toxic gas',   icon: '☣️', systems: ['toxic'], light: { color: '#6fff4a', intensity: 0.5, distance: 6, flicker: 0.1 } },
  dust:   { label: 'Dust',        icon: '🌪️', systems: ['dust'] },
  motes:  { label: 'Light motes', icon: '✴️', systems: ['motes'] },
};
export const WEATHERS = { none: 'None', rain: 'Rain', storm: 'Storm (lightning)', snow: 'Snow', ash: 'Ash fall', duststorm: 'Dust storm' };

export function createEmitter(THREE, kind, opts) {
  opts = opts || {};
  const def = EMITTERS[kind] || EMITTERS.fire;
  const scale = (opts.scale || 1) * (def.scale || 1), intensity = opts.intensity || 1;
  const g = new THREE.Group(); g.name = 'fx-' + kind; g.userData.mfFx = true;
  const systems = def.systems.map(id => { const p = makeSystem(THREE, RECIPES[id], scale, intensity); if (opts.tint && RECIPES[id].additive) { p.material.uniforms.uC1.value.set(opts.tint); p.material.uniforms.uC0.value.set(opts.tint).lerp(new THREE.Color('#ffffff'), 0.6); } g.add(p); return p; });
  let light = null;
  if (def.light && opts.light !== false) {
    light = new THREE.PointLight(def.light.color, def.light.intensity * Math.min(2, intensity), def.light.distance * scale, 2);
    light.position.y = 0.8 * scale; g.add(light);
  }
  const base = light ? light.intensity : 0, flick = def.light ? def.light.flicker : 0;
  let seed = Math.random() * 100;
  return {
    group: g, kind, systems, light,
    update(t, wind) {
      systems.forEach(p => { p.material.uniforms.uTime.value = t; if (wind) p.material.uniforms.uWind.value.copy(wind).multiplyScalar(0.25); });
      if (light) light.intensity = base * (1 - flick + flick * (0.6 + 0.4 * Math.sin(t * 17 + seed) * Math.sin(t * 7.3 + seed * 2) + 0.3 * Math.sin(t * 31 + seed)));
    },
    dispose() { systems.forEach(p => { p.geometry.dispose(); p.material.dispose(); }); },
  };
}

/* Weather: one wrapping system in a box around the camera, plus lightning
   for storms (a flash light + a brighter sky for a few frames). */
export function createWeather(THREE, kind, opts) {
  opts = opts || {};
  if (!RECIPES[kind] || kind === 'none') return null;
  const intensity = opts.intensity || 1;
  const pts = makeSystem(THREE, RECIPES[kind], 1, intensity);
  const u = pts.material.uniforms;
  u.uBox.value.set(44, RECIPES[kind].height + 4, 44);
  const g = new THREE.Group(); g.name = 'fx-weather-' + kind; g.add(pts);
  const flash = kind === 'storm' ? new THREE.HemisphereLight('#dfe8ff', '#8090a8', 0) : null;
  if (flash) g.add(flash);
  let nextBolt = 3 + Math.random() * 6, flashV = 0;
  return {
    group: g, kind, intensity,
    update(t, dt, cam, wind) {
      u.uTime.value = t; u.uCam.value.copy(cam);
      if (wind) u.uWind.value.copy(wind);
      if (flash) {
        nextBolt -= dt;
        if (nextBolt <= 0) { flashV = 1; nextBolt = 4 + Math.random() * 9; }
        flashV = Math.max(0, flashV - dt * (flashV > 0.5 ? 2.5 : 6));
        flash.intensity = flashV * 4 * (0.6 + 0.4 * Math.random());
        if (opts.onFlash) opts.onFlash(flashV);
      }
    },
    dispose() { pts.geometry.dispose(); pts.material.dispose(); },
  };
}

export function windVector(THREE, env) {
  const a = ((env && env.windDir) || 0) * Math.PI / 180, s = (env && env.windSpeed) || 0;
  return new THREE.Vector3(Math.sin(a) * s, 0, Math.cos(a) * s);
}
