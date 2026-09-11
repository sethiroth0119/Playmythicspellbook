/* 📐 SPRITE FIT RULE — one footprint on the battlefield, explicit size classes.

   The owner: "make it where all of the sprites are a good size that fit the
   tiles and all are the same size so it can be consistent — the only way a
   sprite should be bigger is if the unit or hero is just a big character, but
   it is still the same size as a system."

   Defends, from the source text and by running the real functions in a vm:
     · battle-board SIZE_CLASS is exactly normal 1.0 / large 1.35 / huge 1.7,
       unitWorldH multiplies by it, SPRITE_SCALE is untouched (the camera fit
       reasons about it), applyDefs accepts only those three names;
     · index.html _bbUnitDefs sets `size:` from _bbSizeClass — metadata only:
       no naturalWidth / img.width / .height anywhere in either block — and
       _bbSizeClass run for real: explicit field wins, case-folded, garbage and
       missing → normal, curated id table, boss → large, a 4000px image → normal;
     · the visible-box cache exists beside isPixelArt (WeakMap, once per
       texture), fitSprite takes the box and snaps the VISIBLE rect to whole
       device pixels (translate included), spriteBlit fits through defFitBox;
     · spriteBlit run for real: a tight frame and a 40%-padded frame of the same
       silhouette draw the same visible height (±1 device px), feet on the
       origin, a 'large' def 1.35× that, and the visible width is capped at one
       tile;
     · the DOM board stamps data-size on .unit and units.css mirrors the class
       by setting ONLY --u-size; the host's row ladder / base / hero / flat-board
       icon transforms read scale(calc(K * var(--u-size, 1))), so a large unit
       keeps its row scale and translateZ lift (round 2 — a competing transform
       rule at equal specificity used to draw a boss smaller than a footman).
     · unitScreenH applies the class to the PROJECTED normal height, so large is
       exactly 1.35x on screen on every row (round 1 measured 1.387-1.394).

   Run: node _spritefit_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
const BB = readFileSync('./public/battle-board/index.html', 'utf8');
const UCSS = readFileSync('./public/src/battle/units.css', 'utf8');
function fnText(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); } }
}
const between = (src, a, b) => { const i = src.indexOf(a); const j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('cannot slice ' + a); return src.slice(i, j); };

/* ── 1. the host: size from metadata only ─────────────────────────────── */
{
  const defs = fnText(SRC, '_bbUnitDefs');
  const lit = between(defs, 'defs[key] = {', '};');
  ok(/\bsize:\s*_bbSizeClass\(o,\s*card\)/.test(lit), '_bbUnitDefs sets size: from _bbSizeClass(o, card)');
  ok(/h:\s*1\.05/.test(lit), 'every def still gets h: 1.05 (size is the only sanctioned difference)');
  ok(!/naturalWidth|naturalHeight|\.width\b|\.height\b|img\./.test(lit), 'the def literal reads no image dimensions', lit);
  const sc = fnText(SRC, '_bbSizeClass');
  ok(!/naturalWidth|naturalHeight|\.width\b|\.height\b|Image\b|frames|artUrl/.test(sc), '_bbSizeClass reads no image dimensions or art', sc);
  const tbl = between(SRC, 'const _BB_SIZE_CLASSES', 'function _bbSizeClass');
  ok(/normal:\s*1,\s*large:\s*1,\s*huge:\s*1/.test(tbl) && /_BB_SIZE_BY_ID\s*=\s*\{/.test(tbl), 'exactly normal|large|huge, plus a curated id table');
  /* run it */
  const ctx = { resolveDeckCard: (id) => ({ id, spriteSize: id === 'card-big' ? 'huge' : undefined }), console };
  vm.createContext(ctx);
  vm.runInContext(tbl.replace(/const _BB_SIZE_BY_ID = \{[\s\S]*?\};/, "const _BB_SIZE_BY_ID = { 'curated-1': 'large' };") + '\n' + sc, ctx);
  const S = ctx._bbSizeClass;
  ok(S({}, {}) === 'normal', 'missing → normal');
  ok(S({ sizeClass: 'Large' }, null) === 'large', 'unit sizeClass, case-folded');
  ok(S({}, { spriteSize: 'huge' }) === 'huge', 'card spriteSize');
  ok(S({ size: 'giant' }, { size: 'colossal' }) === 'normal', 'an unknown class is normal, not an error');
  ok(S({ cardId: 'curated-1' }, null) === 'large', 'curated id table');
  ok(S({ cardId: 'card-big' }, null) === 'huge', 'card resolved via resolveDeckCard when none is passed');
  ok(S({ isBoss: true }, null) === 'large', 'boss flag → large');
  ok(S({ naturalWidth: 4000, naturalHeight: 4000, width: 4000 }, { width: 4000 }) === 'normal', 'image dimensions never decide the class');
  ok(S({ spriteSize: 'normal', isBoss: true }, null) === 'normal', 'an explicit normal beats the boss flag');
  ok(S(null, null) === 'normal' && S(undefined, undefined) === 'normal', 'null-safe');
  /* the DOM mirror */
  ok(/class="unit \$\{occupant\.owner\}[^\n]*data-size="\$\{_bbSizeClass\(occupant, null\)\}"/.test(SRC), '.unit carries data-size from _bbSizeClass');
  ok(/^\.unit\[data-size="large"\]\s*\{\s*--u-size:\s*1\.35;\s*\}/m.test(UCSS) && /^\.unit\[data-size="huge"\]\s*\{\s*--u-size:\s*1\.7;\s*\}/m.test(UCSS), 'units.css mirrors large 1.35 / huge 1.7 as --u-size');
  ok(!/data-size="(large|huge|normal)"\][^{]*\{[^}]*transform\s*:/.test(UCSS), 'the mirror sets NO transform of its own (it would replace the row ladder at equal specificity)');
  /* the host's row ladder composes with the variable: every row keeps its
     translate3d lift and multiplies its own scale by --u-size */
  const ladder = [...SRC.matchAll(/\.board\.iso-mode \.unit\[data-y="(\d+)"\]\s+\.unit-icon \{ transform: (translate3d\([^)]*\)) scale\(([^;]*)\); \}/g)];
  ok(ladder.length === 12 && ladder.every(m => /^calc\(\d\.\d+ \* var\(--u-size, 1\)\)$/.test(m[3]) && /\d+px\)$/.test(m[2])), 'all 12 row-ladder rules read scale(calc(K * var(--u-size, 1))) and keep their translateZ lift', ladder.map(m => m[3]));
  ok(!/\.unit\[data-y="\d+"\]\s+\.unit-icon \{ transform:[^}]*scale\(\d\.\d+\);/.test(SRC), 'no ladder row still carries a bare scale(K)');
  ok(/\.board\.iso-mode \.unit \.unit-icon \{\s*\/\*[\s\S]*?\*\/\s*transform: translate3d\(0, -28%, 38px\) scale\(calc\(1\.55 \* var\(--u-size, 1\)\)\);\s*transform-origin: 50% 100%;/.test(SRC), 'the base iso icon transform composes and scales from the feet');
  ok(/\.board\.iso-mode \.unit\.hero \.unit-icon \{\s*transform: translate3d\(0, -24%, 58px\) scale\(calc\(1\.74 \* var\(--u-size, 1\)\)\);/.test(SRC), 'the hero icon transform composes too');
  ok(/\.unit \.unit-icon \{\s*transform: scale\(calc\(var\(--depth-scale, 1\) \* var\(--u-size, 1\)\)\);/.test(SRC), 'the flat-board depth-scale rule composes too');
  /* cascade arithmetic, the way the browser resolves it: row 4 large */
  const row4 = ladder.find(m => m[1] === '4');
  const K4 = row4 ? parseFloat(row4[3].replace(/^calc\(/, '')) : 0;
  ok(row4 && Math.abs(K4 * 1.35 / (K4 * 1) - 1.35) < 1e-9 && K4 * 1.35 > K4, 'row 4: large resolves to 1.35x the normal row scale, never smaller', K4);
}

/* ── 2. the stage: one fit rule ────────────────────────────────────────── */
{
  ok(/const SPRITE_SCALE = 1\.30;/.test(BB), 'SPRITE_SCALE is still 1.30 (the camera fit reasons about it)');
  ok(/const SIZE_CLASS = \{ normal: 1\.0, large: 1\.35, huge: 1\.7 \};/.test(BB), 'SIZE_CLASS is exactly normal 1.0 / large 1.35 / huge 1.7');
  ok(/function unitWorldH\(def\)\{ return \(def && def\.h \|\| 1\) \* SPRITE_SCALE \* sizeMul\(def\); \}/.test(BB), 'unitWorldH multiplies by the class table');
  const ush = fnText(BB, 'unitScreenH');
  ok(/function unitScreenH\(def, base, wy, foot\)/.test(ush) && /\(def && def\.h \|\| 1\) \* SPRITE_SCALE/.test(ush) && /\* sizeMul\(def\);/.test(ush) && !/unitWorldH/.test(ush), 'unitScreenH projects the NORMAL head and multiplies the screen height by the class');
  const du = fnText(BB, 'drawUnit'), usb = fnText(BB, 'unitScreenBox');
  ok(/const k = unitScreenH\(u\.def, base, wy, foot\); if \(!k\) return;/.test(du) && !/unitWorldH\(u\.def\)/.test(du), 'drawUnit takes k from unitScreenH (no world-head projection)');
  ok(/const h = unitScreenH\(u\.def, base, wy, foot\);/.test(usb) && /top: foot\.y - h/.test(usb) && !/unitWorldH\(u\.def\)/.test(usb), 'unitScreenBox (nameplates / VFX anchors / board:rects) uses the same height');
  const ad = fnText(BB, 'applyDefs');
  ok(/size:\s*\(typeof d\.size === 'string' && SIZE_CLASS\[d\.size\]\) \? d\.size : 'normal'/.test(ad), 'applyDefs accepts only the three names, else normal');
  ok(!/naturalWidth|img\.width|\.height\b/.test(ad.split('size:')[1].split('\n')[0]), 'the size line reads no image');
  ok(/cur\._vbox = null; cur\._vboxAll = false;/.test(ad), 'applyDefs drops the fit box when the frames change');
  ok(/const _vbVerdict = new WeakMap\(\);/.test(BB) && /function visibleBox\(img, sx, sy, sw, sh\)/.test(BB), 'visible-box cache: WeakMap keyed by the texture, beside isPixelArt');
  ok(BB.indexOf('const _vbVerdict') > BB.indexOf('const _pxVerdict') && BB.indexOf('const _vbVerdict') < BB.indexOf('function fitSprite('), 'the cache sits between isPixelArt and fitSprite');
  const fs_ = fnText(BB, 'fitSprite');
  ok(/function fitSprite\(c, img, srcW, w, h, def, fx, fy, vb\)/.test(fs_) && /vb\.x0/.test(fs_) && /Math\.round\(Math\.min\(X0, X1\)\)/.test(fs_), 'fitSprite takes the visible box and snaps it in device space');
  const sb = fnText(BB, 'spriteBlit');
  ok(/defFitBox\(def, img, sx, sy, sw, sh\)/.test(sb) && /h = k \/ vh/.test(sb) && /fitSprite\(c, img, sw, w, h, def, fx, fy, vb\)/.test(sb), 'spriteBlit fits the VISIBLE height to k through the def box');
  ok(/const maxW = hexW\(\) \* \(k \/ \(unitWorldH\(def\) \|\| 1\)\);/.test(sb) && /if \(w \* vw > maxW\)/.test(sb), 'visible width capped at one tile');
  ok(/const fx = \(vb\.x0 \+ vb\.x1\) \/ 2, fy = vb\.y1;/.test(sb), 'anchored at the visible box\'s bottom centre — feet on the tile centre');
  /* still hard-edged pixel art on nearest */
  ok(/crisp = scale >= 1 && isPixelArt\(img, def\);\s*c\.imageSmoothingEnabled = !crisp;/.test(fs_), 'pixel art stays nearest-neighbour');

  /* run the geometry for real */
  const ctx = { window: {}, DPR: 2, console, Math, hexW: () => 1.0, isPixelArt: () => false, document: { createElement: () => ({ getContext: () => null }) } };
  vm.createContext(ctx);
  const code = [
    'const SPRITE_SCALE = 1.30;',
    between(BB, 'const SIZE_CLASS =', '/* x of the LATTICE'),
    /* a deliberately NON-linear projection: a pitched camera foreshortens */
    'function project(p){ return { x: p.x, y: 1000 - 100 * p.y - 6 * p.y * p.y }; }',
    fnText(BB, 'fitSprite'), fnText(BB, 'unionBox'), fnText(BB, 'defFitBox'), fnText(BB, 'spriteBlit'),
    'globalThis.BOXES = {}; function visibleBox(img){ return BOXES[img.id]; }',
    'function artImage(f){ return IMGS[f]; }',
    'globalThis.IMGS = { tight:{ id:"tight", width:128, height:128 }, pad:{ id:"pad", width:512, height:512 } };',
    'BOXES.tight = { x0:0.25, y0:0, x1:0.75, y1:1 }; BOXES.pad = { x0:0.35, y0:0.2, x1:0.65, y1:0.8 };',
  ].join('\n');
  vm.runInContext(code, ctx);
  const draw = (img, def, k, e, f) => {
    const calls = [];
    const c = { imageSmoothingEnabled: true, imageSmoothingQuality: 'low',
      getTransform: () => ({ a: 2, b: 0, c: 0, d: 2, e, f }), drawImage: (...a) => calls.push(a) };
    ctx.spriteBlit(c, img, 'k', 0, 0, img.width, img.height, k, img.width / img.height, null, def);
    const [, , , , , dx, dy, dw, dh] = calls[0];
    const vb = ctx.BOXES[img.id];
    /* the visible box in device px */
    return { dx, dy, dw, dh, visH: dh * (vb.y1 - vb.y0) * 2, visW: dw * (vb.x1 - vb.x0) * 2,
             feet: (dy + dh * vb.y1) * 2 + f, left: (dx + dw * vb.x0) * 2 + e, top: (dy + dh * vb.y0) * 2 + f };
  };
  const defT = { h: 1.05, size: 'normal', frames: ['tight'] }, defP = { h: 1.05, size: 'normal', frames: ['pad'] }, defL = { h: 1.05, size: 'large', frames: ['tight'] };
  const T = draw(ctx.IMGS.tight, defT, 100, 300.37, 400.61), P = draw(ctx.IMGS.pad, defP, 100, 300.37, 400.61);
  ok(Math.abs(T.visH - 200) <= 1 && Math.abs(P.visH - 200) <= 1, 'tight and padded frames draw the same visible height (200 device px ±1)', [T.visH, P.visH]);
  ok(Math.abs(T.visH - P.visH) <= 1, 'padding changes nothing', [T.visH, P.visH]);
  ok(Math.abs(P.dh * 2 - 200 / 0.6) <= 2, 'the padded frame\'s FULL rect is visible / 0.6', P.dh * 2);
  ok(Math.abs(T.feet - 400.61) < 1 && Math.abs(P.feet - 400.61) < 1, 'feet land on the origin (snapped within a device px)', [T.feet, P.feet]);
  const isInt = (v) => Math.abs(v - Math.round(v)) < 1e-6;
  ok(isInt(T.left) && isInt(T.top) && isInt(P.left) && isInt(P.top) && isInt(T.feet) && isInt(P.feet), 'the VISIBLE box lands on whole device pixels, translate included', [T.left, T.top, P.left, P.top]);
  const L = draw(ctx.IMGS.tight, defL, 100 * 1.35, 300.37, 400.61);
  ok(Math.abs(L.visH / T.visH - 1.35) < 0.01, 'large draws 1.35× the visible height', L.visH / T.visH);
  ok(Math.abs(ctx.unitWorldH(defL) / ctx.unitWorldH(defT) - 1.35) < 1e-9 && ctx.unitWorldH({ h: 1.05, size: 'giant' }) === ctx.unitWorldH(defT), 'unitWorldH: large = 1.35× normal, an unknown class is normal');
  {
    const base = { x: 0, y: 0.4, z: 0 }, wy = 0.4, foot = ctx.project({ x: 0, y: wy, z: 0 });
    const hN = ctx.unitScreenH(defT, base, wy, foot), hL = ctx.unitScreenH(defL, base, wy, foot), hH = ctx.unitScreenH({ h: 1.05, size: 'huge' }, base, wy, foot);
    const worldHead = Math.abs(foot.y - ctx.project({ x: 0, y: wy + ctx.unitWorldH(defL), z: 0 }).y);
    ok(Math.abs(hL / hN - 1.35) < 1e-9 && Math.abs(hH / hN - 1.7) < 1e-9, 'unitScreenH: large is EXACTLY 1.35× and huge 1.7× the projected normal height', [hN, hL, hH]);
    ok(worldHead / hN > 1.36, 'projecting the taller WORLD head would have over-shot 1.35× on this pitch (why the screen-space helper exists)', worldHead / hN);
    ok(ctx.unitScreenH(defT, base, wy, null) === 0 && ctx.unitScreenH({ h: 1.05, size: 'giant' }, base, wy, foot) === hN, 'unitScreenH: no foot → 0, unknown class → normal');
  }
  /* width cap: a very wide silhouette is capped at one tile — hexW()=1 world
     unit; k=100 px for unitWorldH 1.365 → one tile = 73.26 css px */
  ctx.BOXES.wide = { x0: 0, y0: 0.4, x1: 1, y1: 0.6 }; ctx.IMGS.wide = { id: 'wide', width: 512, height: 512 };
  const Wd = draw(ctx.IMGS.wide, { h: 1.05, size: 'normal', frames: ['wide'] }, 100, 300, 400);
  const tilePx = 1.0 * (100 / ctx.unitWorldH(defT)) * 2;
  ok(Wd.visW <= tilePx + 1 && Wd.visH < 200, 'visible width is capped at one tile (and the height follows, aspect kept)', [Wd.visW, tilePx, Wd.visH]);
  /* per-def union: a set whose frames differ in extent fits ALL of them the same */
  ctx.BOXES.f1 = { x0: 0.3, y0: 0.1, x1: 0.7, y1: 1 }; ctx.BOXES.f2 = { x0: 0.2, y0: 0.3, x1: 0.8, y1: 1 };
  ctx.IMGS.f1 = { id: 'f1', width: 256, height: 256 }; ctx.IMGS.f2 = { id: 'f2', width: 256, height: 256 };
  const defA = { h: 1.05, size: 'normal', frames: ['f1', 'f2'] };
  const a1 = draw(ctx.IMGS.f1, defA, 100, 300, 400), a2 = draw(ctx.IMGS.f2, defA, 100, 300, 400);
  ok(Math.abs(a1.dh - a2.dh) < 1e-6 && defA._vboxAll === true, 'an animation is fitted by the UNION of its frames — no per-frame pulse', [a1.dh, a2.dh]);
}

console.log(fails ? `\n${fails} FAILED` : '\nall green');
process.exit(fails ? 1 : 0);
