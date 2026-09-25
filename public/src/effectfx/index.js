/* ══════════════════════════════════════════════════════════════════════════
   🎇 BOARD EFFECT VFX — effects drawn ON the board, sized from the tile they
   fire on. Registered as window.MythicEffectFx; index.html's _playEffectVfx
   hands an id here first and falls back to its own paths if this is absent.
   Owner, 2026-09-18: "Update Grave Reach in Effect VFX (plays when the effect
   fires) with this Zombie arm also add the deck shuffle VFX … Make them
   smaller to fit the game board where it make sense".

   Both come from the owner's packs (Zombie-Transparent-VFX, Card-Shuffle-VFX)
   and keep those packs' own drawing code — the arm's per-finger skinning
   mesh, the flying dirt and dust, the shuffle's lift / riffle / square and
   its gold sparks. What changed, and why:
     · SIZE — the packs draw at 1280×720 and 900 units, i.e. full screen. A
       card effect is about one unit, so each is scaled from the anchor's
       tile width (A.w): the arm stands ~2.4 tiles tall from the tile it
       fires on; the deck is ~1.3 tiles tall.
     · LENGTH — 6 s and 4.8 s are cutscene lengths; an effect resolves in a
       beat. The arm runs ~2.7 s (the same burst → rise → breathe → retract,
       compressed); the shuffle keeps its normalized timeline at 3 s.
     · ART — the pack PNGs are 2 MB and 1 MB. The arm is pre-clipped with the
       pack's own outline (so its ground and hole stay removed) and both are
       WebP at the size they are drawn: 33 KB and 5 KB, in
       assets/vfx/effectfx/.
     · The 144 PNG frames (≈ 60 MB) are not used — the code that made them is.
     · The mesh is 11×15 instead of 22×30: at board size the difference is
       sub-pixel and it is a quarter of the drawImage calls.
     · setTimeout loop, not RAF: the Browser pane and background tabs throttle
       RAF, and an effect that stalls leaves an overlay on the board.
   ══════════════════════════════════════════════════════════════════════════ */

const BASE = (() => { try { return new URL('../../assets/vfx/effectfx/', import.meta.url).href; } catch (e) { return '/assets/vfx/effectfx/'; } })();
const images = {};
function img(name) {
  if (images[name]) return images[name];
  const i = new Image(); i.decoding = 'async'; i.src = BASE + name;
  const p = new Promise((res, rej) => { i.onload = () => res(i); i.onerror = rej; });
  images[name] = { img: i, ready: p };
  return images[name];
}
const clamp = (n) => Math.max(0, Math.min(1, n));
const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3);
const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };

/* ── 🧟 GRAVE REACH — the zombie arm ─────────────────────────────────────── */
const ARM = (() => {
  let seed = 472; const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const dirt = Array.from({ length: 95 }, () => ({ vx: (rand() - .5) * 820, vy: -160 - rand() * 450, r: 2 + rand() * 11, delay: rand() * .13, spin: rand() * 10, col: ['#383329', '#554b37', '#75674a', '#282b21'][Math.floor(rand() * 4)] }));
  const dust = Array.from({ length: 38 }, () => ({ vx: (rand() - .5) * 330, vy: -rand() * 80, r: 20 + rand() * 45, delay: rand() * .22 }));
  const tips = [[.16, .25, .43, .43], [.28, .115, .46, .31], [.53, .01, .53, .28], [.64, .075, .59, .30], [.81, .16, .63, .36]];
  const GROUND = 595, SIZE = 570;
  const DURATION = 2.7, BURST = 0.12, RISE = 0.42, RETRACT = 2.05, DROP = 0.5;
  function deform(u, v, t, W, H) {
    let px = u * W, py = v * H;
    const breath = (1 - Math.cos((t - BURST - RISE) * Math.PI * 2 / 1.8)) * .5;   // one clench+release while it stands
    for (const [tx, ty, bx, by] of tips) {
      const k = clamp((by - v) / (by - ty)); const ln = bx + (tx - bx) * k;
      const w = Math.exp(-Math.pow((u - ln) / .09, 4)) * k;
      px += (bx - tx) * W * w * breath * .055; py += H * w * breath * .007;
    }
    return [px, py];
  }
  function tri(x, sprite, a, b, d, A, B, D) {
    x.save(); x.beginPath(); x.moveTo(...A); x.lineTo(...B); x.lineTo(...D); x.closePath(); x.clip();
    const den = a[0] * (b[1] - d[1]) + b[0] * (d[1] - a[1]) + d[0] * (a[1] - b[1]);
    const m = (j) => [(A[j] * (b[1] - d[1]) + B[j] * (d[1] - a[1]) + D[j] * (a[1] - b[1])) / den, (A[j] * (d[0] - b[0]) + B[j] * (a[0] - d[0]) + D[j] * (b[0] - a[0])) / den, (A[j] * (b[0] * d[1] - d[0] * b[1]) + B[j] * (d[0] * a[1] - a[0] * d[1]) + D[j] * (a[0] * b[1] - b[0] * a[1])) / den];
    const m1 = m(0), m2 = m(1); x.transform(m1[0], m2[0], m1[1], m2[1], m1[2], m2[2]); x.drawImage(sprite, 0, 0); x.restore();
  }
  /* draws in the PACK's space (1280 wide, ground at y=595); the caller maps that onto the tile */
  function draw(x, t, sprite) {
    const burst = t - BURST;
    const rise = easeOut(burst / RISE) * (1 - easeOut((t - RETRACT) / DROP));
    x.save();
    if (burst > 0 && burst < .3) { const sh = (1 - burst / .3) * 9; x.translate(Math.sin(t * 103) * sh, Math.cos(t * 89) * sh * .5); }
    if (rise > 0 && sprite) {
      const W = sprite.width, H = sprite.height, scale = SIZE / H;
      x.save(); x.beginPath(); x.rect(-2000, -2000, 5280, GROUND + 5 + 2000); x.clip();
      x.translate(640 - W * scale / 2, GROUND - SIZE + 35 + SIZE * (1 - rise)); x.scale(scale, scale);
      const n = 11, m = 15;
      for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) {
        const uv = [[i / n, j / m], [(i + 1) / n, j / m], [(i + 1) / n, (j + 1) / m], [i / n, (j + 1) / m]];
        const src = uv.map(([u, v]) => [u * W, v * H]), dst = uv.map(([u, v]) => deform(u, v, t, W, H));
        tri(x, sprite, src[0], src[1], src[2], dst[0], dst[1], dst[2]); tri(x, sprite, src[0], src[2], src[3], dst[0], dst[2], dst[3]);
      }
      x.restore();
    }
    for (const p of dirt) {
      const age = burst - p.delay; if (age < 0 || age > 2) continue;
      const yy = GROUND + p.vy * age + 400 * age * age; if (yy > GROUND + 32) continue;
      x.save(); x.translate(640 + p.vx * age, yy); x.rotate(age * p.spin); x.fillStyle = p.col;
      x.beginPath(); x.moveTo(-p.r, -p.r * .5); x.lineTo(p.r * .3, -p.r); x.lineTo(p.r, p.r * .4); x.lineTo(0, p.r * .8); x.closePath(); x.fill(); x.restore();
    }
    if (burst > 0) for (const p of dust) {
      const age = burst - p.delay; if (age < 0 || age > 2.4) continue;
      const a = .15 * (1 - age / 2.4), cx = 640 + p.vx * age, cy = GROUND + p.vy * age - 10, r = p.r * (1 + age);
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, `rgba(125,120,88,${a})`); g.addColorStop(1, 'rgba(125,120,88,0)');
      x.fillStyle = g; x.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    x.restore();
  }
  return {
    duration: DURATION, art: 'zombie-arm.webp',
    /* pack space → screen: the arm's ground line sits a little below the tile's centre */
    place(A) { const k = (A.w * 2.4) / SIZE; return { k, ox: A.x - 640 * k, oy: A.y + A.w * 0.28 - GROUND * k }; },
    draw(x, t, sprite) { draw(x, t, sprite); },
  };
})();

/* ── 🃏 DECK SHUFFLE ──────────────────────────────────────────────────────── */
const SHUFFLE = (() => {
  const DURATION = 3.0, CW = 205, CH = 307;
  function draw(c, p, card) {
    const lift = smooth((p - .035) / .16);
    p = Math.max(0, (p - .34) / .66);
    const split = smooth((p - .09) / .19) * (1 - smooth((p - .43) / .28));
    const settle = smooth((p - .73) / .19);
    const power = Math.sin(Math.PI * clamp((p - .12) / .77));
    c.save(); c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 56; i++) {
      const a = i * 2.39996 + p * 5.5, r = 170 + (i % 9) * 16, x = Math.cos(a) * r, y = Math.sin(a) * r * .61;
      const alpha = power * (.15 + .55 * (.5 + .5 * Math.sin(i * 4 + p * 14)));
      c.strokeStyle = `rgba(213,165,69,${alpha * .35})`; c.lineWidth = 1.3; c.beginPath(); c.moveTo(x, y); c.lineTo(x - Math.sin(a) * 14, y + Math.cos(a) * 9); c.stroke();
      const g = c.createRadialGradient(x, y, 0, x, y, 7); g.addColorStop(0, `rgba(255,232,151,${alpha})`); g.addColorStop(1, 'rgba(217,151,39,0)'); c.fillStyle = g; c.fillRect(x - 7, y - 7, 14, 14);
    }
    c.restore();
    /* the pack crops a 17 px frame off a 640 px card back; same proportion at any size */
    const inset = card ? card.width * 17 / 640 : 0;
    for (let i = 0; i < 24; i++) {
      const side = i % 2 ? 1 : -1, layer = Math.floor(i / 2), delay = layer * .010;
      const fly = smooth((p - .35 - delay) / .22), arc = Math.sin(fly * Math.PI);
      let x = side * split * (142 + layer * 2) * (1 - fly * .65);
      let y = (23 - i) * 2.15 - 25 - arc * (75 + layer * 2) + (1 - settle) * Math.sin(fly * Math.PI) * side * 11;
      let rot = side * split * .20 + side * arc * .075;
      if (i === 23) { x = lift * 150; y = -25 - lift * 270; rot = lift * .10; }
      c.save(); c.translate(x, y); c.rotate(rot); c.transform(1, -.10, .15, .73, 0, 0);
      c.shadowColor = 'rgba(0,0,0,.5)'; c.shadowBlur = 7; c.shadowOffsetY = 3;
      c.fillStyle = '#c4b383'; c.beginPath(); c.roundRect(-CW / 2, -CH / 2 + 3, CW, CH, 8); c.fill();
      c.shadowBlur = 0; c.shadowOffsetY = 0;
      c.save(); c.beginPath(); c.roundRect(-CW / 2, -CH / 2, CW, CH, 8); c.clip();
      if (card) c.drawImage(card, inset, inset, card.width - inset * 2, card.height - inset * 2, -CW / 2, -CH / 2, CW, CH);
      else { c.fillStyle = '#3a2d52'; c.fillRect(-CW / 2, -CH / 2, CW, CH); }
      c.restore();
      c.strokeStyle = `rgba(229,191,102,${.28 + arc * .4})`; c.lineWidth = .9; c.beginPath(); c.roundRect(-CW / 2, -CH / 2, CW, CH, 8); c.stroke();
      c.restore();
    }
  }
  return {
    duration: DURATION, art: 'shuffle-cardback.webp',
    /* the drawn card lifts ~270 units above the deck, so the deck sits a little below the anchor */
    place(A) { const k = (A.w * 1.3) / CH; return { k, ox: A.x, oy: A.y + A.w * 0.55 }; },
    draw(x, t, card) { draw(x, clamp(t / DURATION), card); },
  };
})();

const FX = {
  graveReach:  { label: '🧟 Grave Reach', ...ARM },
  deckShuffle: { label: '🃏 Deck Shuffle', ...SHUFFLE },
};

/* ── the overlay ──────────────────────────────────────────────────────────── */
let live = 0;
const FADE = 0.3;
function drawFrame(ctx, fx, A, t, art, dpr) {
  const pl = fx.place(A);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(dpr * pl.k, 0, 0, dpr * pl.k, dpr * pl.ox, dpr * pl.oy);
  ctx.globalAlpha = 1;
  fx.draw(ctx, t, art);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
function play(id, anchor) {
  const fx = FX[id];
  if (!fx || typeof document === 'undefined' || !document.body || live > 2) return false;
  const A = (anchor && isFinite(anchor.x) && isFinite(anchor.y)) ? { x: anchor.x, y: anchor.y, w: Math.max(28, anchor.w || 70) } : { x: innerWidth / 2, y: innerHeight / 2, w: 70 };
  live++;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cv = document.createElement('canvas');
  cv.className = 'effectfx-canvas'; cv.setAttribute('aria-hidden', 'true');
  cv.width = Math.round(innerWidth * dpr); cv.height = Math.round(innerHeight * dpr);
  cv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:1900;pointer-events:none;transition:opacity ' + FADE + 's';
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');
  const a = img(fx.art);
  let t0 = 0, done = false, timer = 0;
  const end = () => { if (done) return; done = true; clearTimeout(timer); try { cv.remove(); } catch (e) {} live = Math.max(0, live - 1); };
  const tick = () => {
    if (done) return;
    const t = (performance.now() - t0) / 1000;
    if (t >= fx.duration) { cv.style.opacity = '0'; setTimeout(end, FADE * 1000 + 30); return; }
    try { drawFrame(ctx, fx, A, t, a.img.complete && a.img.naturalWidth ? a.img : null, dpr); } catch (e) { try { console.warn('[effectfx]', e); } catch (_) {} end(); return; }
    timer = setTimeout(tick, 16);
  };
  /* wait for the art (it is tiny and usually cached), but never longer than 600 ms — then play without it */
  const go = () => { if (!t0) { t0 = performance.now(); tick(); } };
  a.ready.then(go, go); setTimeout(go, 600);
  setTimeout(end, (fx.duration + 2) * 1000);   // backstop: an overlay can never outlive its effect
  return true;
}

/* ── 💠 HOLOGRAM DEATH — every unit's death (owner, 2026-09-19: "Add this vfx
   when a unit dies"). The owner's Hologram-Death pack: the dying unit's OWN
   picture glitches, shears into holographic blocks and scatters in 1.55 s. The
   renderer below is the pack's, unchanged except:
     · it is placed on the unit's tile — feet at the tile, ~1.7 tiles tall —
       where the pack centres a 900×700 stage;
     · no crossOrigin on the image. The pack set it, and a sprite served
       without CORS then FAILS TO LOAD at all; nothing here reads pixels back,
       so a tainted canvas is harmless and the image simply draws;
     · setTimeout, not RAF — see the header.
   A death with no picture to break apart plays no VFX (its sound still plays). */
const HOLO = (() => {
  const clamp = v => Math.max(0, Math.min(1, v));
  const smooth = v => { v = clamp(v); return v * v * (3 - 2 * v); };
  const rand = n => { const v = Math.sin(n * 127.1 + 78.2) * 43758.5453; return v - Math.floor(v); };
  const TAU = Math.PI * 2, DURATION = 1.55;
  function prepare(image, color) {
    const unit = document.createElement('canvas'); unit.width = 420; unit.height = 550;
    const w = image.naturalWidth || image.width, h = image.naturalHeight || image.height;
    const g = unit.getContext('2d'); const scale = Math.min(410 / w, 545 / h);
    g.drawImage(image, (420 - w * scale) / 2, 550 - h * scale, w * scale, h * scale);
    const tint = document.createElement('canvas'); tint.width = 420; tint.height = 550;
    const t = tint.getContext('2d'); t.drawImage(unit, 0, 0); t.globalCompositeOperation = 'source-in'; t.fillStyle = color; t.fillRect(0, 0, 420, 550);
    return { unit, tint, color };
  }
  /* the pack's draw(), in its own 900×700 stage space with the feet at (0,0) */
  function draw(g, seconds, P) {
    const p = clamp(seconds / DURATION); if (p >= 1) return;
    const x0 = -210, y0 = -550;
    const glitch = smooth(p / .15) * (1 - smooth((p - .37) / .21));
    const dissolve = smooth((p - .16) / .62);
    const fade = 1 - smooth((p - .67) / .33);
    if (p < .58) {
      g.globalAlpha = (1 - smooth((p - .18) / .38)) * (1 - .22 * glitch); g.drawImage(P.unit, x0, y0);
      g.globalAlpha = .34 * glitch; g.drawImage(P.tint, x0 - 7 * glitch, y0);
      g.globalAlpha = .18 * glitch; g.drawImage(P.tint, x0 + 9 * glitch, y0);
      g.globalAlpha = 1;
    }
    const cols = 21, rows = 44, cw = 420 / cols, ch = 550 / rows;
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const id = row * cols + col, seed = rand(id + 901);
      const local = smooth((dissolve - (1 - row / rows) * .34 - seed * .14) / .56);
      if (local <= 0 || p > .96) continue;
      const sx = col * cw, sy = row * ch;
      const dx = x0 + sx + (rand(id + 111) - .5) * (70 + 190 * local) * local, dy = y0 + sy - (45 + rand(id + 333) * 160) * local * local;
      const alpha = local * fade * (.42 + .58 * rand(id + 77)); if (alpha < .012) continue;
      g.globalAlpha = alpha;
      g.drawImage(id % 4 === 0 ? P.unit : P.tint, sx, sy, cw, ch, dx, dy, cw * (1 - local * .35), ch * (1 - local * .2));
      if (id % 8 === 0) { g.strokeStyle = P.color; g.lineWidth = .8; g.strokeRect(dx, dy, cw * (1 - local * .35), ch * (1 - local * .2)); }
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 13; i++) {
      const q = rand(i + 600), phase = (p * 2.7 + q) % 1, y = y0 + phase * 550;
      const a = (glitch * .65 + dissolve * fade * .32) * Math.sin(phase * Math.PI); if (a <= 0) continue;
      g.globalAlpha = a; g.fillStyle = i % 4 ? P.color : '#eaffff'; g.fillRect(-190 + rand(i + 620) * 90, y, 150 + rand(i + 640) * 190, i % 3 ? 1 : 2.5);
    }
    for (let i = 0; i < 230; i++) {
      const start = rand(i + 1200) * .46 + .18, age = clamp((p - start) / .62); if (age <= 0 || age >= 1) continue;
      const x = (rand(i + 1400) - .5) * 350, y = y0 + rand(i + 1600) * 520;
      const a = Math.sin(age * Math.PI) * fade * (.25 + rand(i + 2200) * .6);
      g.globalAlpha = a; g.fillStyle = i % 9 === 0 ? '#f2ffff' : P.color;
      const s = 1 + rand(i + 2400) * (i % 5 ? 2.6 : 5);
      g.fillRect(x + (rand(i + 1800) - .5) * 330 * age, y - (60 + rand(i + 2000) * 210) * age, s, i % 7 ? s : s * 3);
    }
    const pulse = smooth((p - .35) / .2) * (1 - smooth((p - .73) / .2));
    if (pulse > 0) {
      g.globalAlpha = pulse * .65; g.strokeStyle = P.color; g.lineWidth = 2;
      g.beginPath(); g.ellipse(0, -2, 70 + 230 * pulse, 12 + 27 * pulse, 0, 0, TAU); g.stroke();
      g.globalAlpha = pulse * .18;
      const glow = g.createRadialGradient(0, -2, 0, 0, -2, 160); glow.addColorStop(0, P.color); glow.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = glow; g.fillRect(-160, -35, 320, 70);
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }
  /* stage → screen: unit ~1.7 tiles tall (550 stage units), feet a little below the tile centre */
  const place = (A) => { const k = (A.w * 1.7) / 550; return { k, ox: A.x, oy: A.y + A.w * 0.3 }; };
  return { DURATION, prepare, draw, place };
})();
let holoLive = 0;
/* 💠 A unit with no sprite and no card art still gets a hologram: its icon
   (or a ⚔) drawn onto a canvas becomes the picture that shatters. Before this,
   such a death played no VFX at all — found checking the owner's report that
   deaths showed nothing (2026-09-19). */
function iconPicture(icon) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 320;
  const g = c.getContext('2d');
  g.font = '190px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.fillText(String(icon || '⚔').slice(0, 4), 128, 290);
  return c;
}
function playDeath(src, anchor, opts) {
  if (typeof document === 'undefined' || !document.body || holoLive > 5) return false;
  if (!src) src = iconPicture(opts && opts.icon);
  const A = (anchor && isFinite(anchor.x) && isFinite(anchor.y)) ? { x: anchor.x, y: anchor.y, w: Math.max(28, anchor.w || 70) } : null;
  if (!A) return false;
  holoLive++;
  const isPicture = typeof src !== 'string';
  const im = isPicture ? src : new Image(); if (!isPicture) im.decoding = 'async';
  let done = false; const end = (cv) => { if (done) return; done = true; try { if (cv) cv.remove(); } catch (e) {} holoLive = Math.max(0, holoLive - 1); };
  /* a sprite URL that fails to load falls back to the icon rather than to nothing */
  if (!isPicture) im.onerror = () => { holoLive = Math.max(0, holoLive - 1); done = true; playDeath(iconPicture(opts && opts.icon), anchor, opts); };
  const start = () => {
    let P; try { P = HOLO.prepare(im, (opts && opts.color) || '#66eaff'); } catch (e) { end(null); return; }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cv = document.createElement('canvas'); cv.className = 'effectfx-death'; cv.setAttribute('aria-hidden', 'true');
    cv.width = Math.round(innerWidth * dpr); cv.height = Math.round(innerHeight * dpr);
    cv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:1901;pointer-events:none';
    document.body.appendChild(cv);
    const g = cv.getContext('2d'), pl = HOLO.place(A), t0 = performance.now();
    const tick = () => {
      if (done) return;
      const t = (performance.now() - t0) / 1000;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
      if (t >= HOLO.DURATION) { end(cv); return; }
      g.setTransform(dpr * pl.k, 0, 0, dpr * pl.k, dpr * pl.ox, dpr * pl.oy);
      try { HOLO.draw(g, t, P); } catch (e) { end(cv); return; }
      setTimeout(tick, 16);
    };
    tick();
    setTimeout(() => end(cv), 4000);   // backstop
  };
  if (isPicture) start();
  else { im.onload = start; im.src = src; }
  return true;
}

window.MythicEffectFx = {
  /* 💠 the unit-death hologram; src = the unit's own sprite / art URL */
  death: playDeath,
  /* for probes: one frame of the hologram at time t (image must be loaded) */
  deathFrame(canvas, image, anchor, t) {
    const P = HOLO.prepare(image, '#66eaff'), pl = HOLO.place(anchor), g = canvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height);
    g.setTransform(pl.k, 0, 0, pl.k, pl.ox, pl.oy); HOLO.draw(g, t, P); g.setTransform(1, 0, 0, 1, 0, 0);
    return true;
  },
  has: (id) => !!FX[id],
  list: () => Object.keys(FX).map((id) => ({ id, label: FX[id].label })),
  play,
  /* for probes and previews: one frame of an effect at time t into a given canvas */
  async frame(id, canvas, anchor, t) {
    const fx = FX[id]; if (!fx) return false;
    const a = img(fx.art); try { await a.ready; } catch (e) {}
    drawFrame(canvas.getContext('2d'), fx, anchor, t, a.img.naturalWidth ? a.img : null, 1);
    return true;
  },
  preload() { for (const k in FX) img(FX[k].art); },
};
