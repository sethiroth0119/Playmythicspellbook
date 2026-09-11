/* 🌬 SPRITE IDLE LOOP — size never changes, loop never visibly restarts.

   The owner: "sprite animations ... not getting bigger and smaller and running
   a loop and smooth". The "bigger and smaller" was `@keyframes
   unit-idle-breathe` (index.html) scaling the board sprite 1 → 1.015 inside a
   .unit-icon that iso-mode already scales ~2×. Defends, from the source text:
     · no `scale(` in any idle keyframe a board sprite runs — unit-idle-breathe
       and every @keyframes referenced by a `.unit … .sprite-stack /
       .sprite-frame / .unit-icon` rule that is not a [data-anim] state rule
       (index.html + src/sprites/idle.css + src/battle/*.css);
     · the idle bob is translate3d only and 0% == 100% (seamless loop);
     · the layer-isolation rule (will-change / translateZ(0)) survives;
     · the stage (battle-board) idle frame index is still `% n` off the shared
       clock with a stable per-def phase — evaluated: over one period every
       index 0..n-1 appears exactly once for the same duration, no held frame;
     · the stage idle is a vertical bob (u.y), the scaleX/scaleY squash spring is
       the untouched event-only telegraph, hold-last-frame only fires on a
       decode miss;
     · sprite-engine.js idle index is `% n` off the clock too.

   Run: node _spriteidle_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
const BB = readFileSync('./public/battle-board/index.html', 'utf8');
const IDLE = readFileSync('./public/src/sprites/idle.css', 'utf8');
const ENG = readFileSync('./public/sprite-live/sprite-engine.js', 'utf8');
const BATTLE_CSS = ['alive', 'board', 'chrome', 'draw', 'hud', 'units'].map(n => { try { return readFileSync('./public/src/battle/' + n + '.css', 'utf8'); } catch (e) { return ''; } }).join('\n');

/* balanced-brace block after `@keyframes <name>` in a text */
function keyframes(text, name) {
  const re = new RegExp('@keyframes\\s+' + name.replace(/[-]/g, '\\-') + '\\s*\\{');
  const m = re.exec(text); if (!m) return null;
  let d = 0; for (let k = m.index + m[0].length - 1; k < text.length; k++) { if (text[k] === '{') d++; else if (text[k] === '}') { d--; if (!d) return text.slice(m.index, k + 1); } }
  return null;
}
/* the transform declared at a keyframe selector (e.g. '0%') inside a block */
function stopTransform(block, stop) {
  const re = /([^{}]+)\{([^{}]*)\}/g; let m;
  while ((m = re.exec(block))) {
    const sels = m[1].split(',').map(s => s.trim());
    if (sels.includes(stop) || (stop === '0%' && sels.includes('from')) || (stop === '100%' && sels.includes('to'))) {
      const t = /transform\s*:\s*([^;]+)/.exec(m[2]); return t ? t[1].replace(/\s+/g, ' ').trim() : null;
    }
  }
  return null;
}

/* ── 1. the source keyframe ── */
const KF = keyframes(SRC, 'unit-idle-breathe');
ok(!!KF, '@keyframes unit-idle-breathe exists in index.html');
ok(KF && !/scale\(/.test(KF), 'unit-idle-breathe has NO scale()', KF);
ok(KF && /translate3d\(/.test(KF), 'unit-idle-breathe bobs with translate3d');
ok(KF && stopTransform(KF, '0%') && stopTransform(KF, '0%') === stopTransform(KF, '100%'), '0% and 100% keyframes are identical (seamless loop)', KF && (stopTransform(KF, '0%') + ' vs ' + stopTransform(KF, '100%')));
ok(KF && !/rotate|skew|filter|opacity/.test(KF), 'the idle bob changes nothing but position');

/* ── 2. every keyframe a board sprite runs ── */
const CSS_ALL = SRC + '\n' + IDLE + '\n' + BATTLE_CSS;
const names = new Set();
{
  const re = /([^{}@]+)\{([^{}]*)\}/g; let m;
  while ((m = re.exec(CSS_ALL))) {
    const sel = m[1].trim(), body = m[2];
    if (!/\.unit\b/.test(sel)) continue;
    if (!/\.sprite-stack|\.sprite-frame|\.unit-icon/.test(sel)) continue;
    if (/\[data-anim=/.test(sel)) continue;                       // event telegraphs: out of scope
    const an = /animation-name\s*:\s*([^;]+)/.exec(body); if (an) an[1].split(',').forEach(n => names.add(n.trim()));
    const sh = /(?:^|[;\s])animation\s*:\s*([^;]+)/.exec(body);
    if (sh) sh[1].split(',').forEach(part => { const tok = part.trim().split(/\s+/).find(t => /^[a-zA-Z_][\w-]*$/.test(t) && !/^(none|ease|ease-in|ease-out|ease-in-out|linear|infinite|normal|reverse|alternate|alternate-reverse|forwards|backwards|both|running|paused|initial|inherit|unset)$/.test(t)); if (tok) names.add(tok); });
  }
  names.delete('none');
}
ok(names.has('unit-idle-breathe') && names.has('hg-idle-breath-r1'), 'the board idle rules name unit-idle-breathe and hg-idle-breath-r1', [...names].join(','));
for (const n of names) {
  const blk = keyframes(CSS_ALL, n);
  ok(!!blk, 'keyframes found for idle animation ' + n);
  ok(blk && !/scale\(/.test(blk), 'idle keyframe ' + n + ' has no scale()');
  ok(blk && stopTransform(blk, '0%') === stopTransform(blk, '100%'), 'idle keyframe ' + n + ' starts and ends on the same pose');
}
ok(/\.unit \.unit-icon \.sprite-stack:where\(:has\(> \.sprite-frame \+ \.sprite-frame\)\)\s*\{\s*animation-name:\s*none;/.test(IDLE), 'idle.css turns the CSS bob off where the frame ticker already animates the art');

/* ── 3. the layer-isolation rule survives ── */
const rule = SRC.slice(SRC.indexOf('.unit .unit-icon .sprite-stack {', SRC.indexOf('@keyframes unit-idle-breathe')));
const ruleBody = rule.slice(0, rule.indexOf('}'));
ok(/animation:\s*unit-idle-breathe\s+3\.6s\s+ease-in-out\s+infinite/.test(ruleBody), 'the stack still runs unit-idle-breathe at 3.6s (divides the 3600ms clock anchor)');
ok(/will-change:\s*transform/.test(ruleBody) && /transform:\s*translateZ\(0\)/.test(ruleBody) && /LAYER ISOLATION/.test(ruleBody), 'layer isolation (will-change / translateZ(0)) and its comment survive');
ok(/\.unit\[data-anim="attack"\] \.unit-icon \.sprite-stack/.test(SRC) && /scale\(1\.08\)/.test(keyframes(SRC, 'unit-attack') || ''), 'the attack telegraph keeps its squash (event-only scale untouched)');
ok(!/restarts the CSS `unit-idle-breathe` from scale 1/.test(SRC), 'the clock-anchor comment no longer describes a scale restart');

/* ── 4. the stage: index formula, phase, bob, spring ── */
const IDX = 'const idx = n > 1 ? (Math.floor((t + (D._phase || 0)) * fps) % n) : 0;';
ok(SRC.length > 0 && BB.includes(IDX), 'stage idle index is floor((t + phase) * fps) % n');
ok(BB.includes('const f = n > 1 ? (Math.floor(t * fps) % n) : 0;'), 'stage sheet index is floor(t * fps) % n');
ok(BB.includes('_phase: cur._phase || ((k.length * 0.137) % 1)'), 'per-def phase is seeded once and kept across applyDefs (stable)');
ok(BB.includes('u.y = Math.sin(u.bob*1.7)*0.022;   /* idle breathe */'), 'stage idle is a vertical bob on u.y');
ok(BB.includes('u.scaleX += (1 - u.scaleX) * Math.min(1, dt*9);') && BB.includes('u.scaleY += (1 - u.scaleY) * Math.min(1, dt*9);') && BB.includes('if (u.squashHold){ u.squashHold = false; }'), 'the scaleX/scaleY squash spring is unchanged (event-only)');
ok(/if \(img && img\.width\)\{ D\._lastFrame = img; D\._lastFrameSrc = src; \}\s*else if \(D\._lastFrame\)\{ img = D\._lastFrame;/.test(BB), 'hold-last-frame only fires on a decode miss');
{
  /* evaluate the formula: one period, dense sampling → each index once, same hold, wraps to 0 */
  const ctx = vm.createContext({ Math });
  const n = 5, fps = 10, phase = 0.192, period = n / fps, S = 5000;
  const seq = [];
  for (let i = 0; i < S; i++) { const t = i * period / S; seq.push(vm.runInContext(IDX.replace('const idx = ', '(') .replace(/;$/, ')'), Object.assign(ctx, { n, fps, t, D: { _phase: phase } }))); }
  const runs = []; for (const x of seq) { if (runs.length && runs[runs.length - 1].i === x) runs[runs.length - 1].c++; else runs.push({ i: x, c: 1 }); }
  const merged = runs.length && runs[0].i === runs[runs.length - 1].i ? runs.slice(1, -1).concat([{ i: runs[0].i, c: runs[0].c + runs[runs.length - 1].c }]) : runs;
  const seen = merged.map(r => r.i).sort();
  ok(seen.join(',') === '0,1,2,3,4', 'over one period every index 0..n-1 appears exactly once', seen.join(','));
  const cs = merged.map(r => r.c);
  ok(Math.max(...cs) - Math.min(...cs) <= 2, 'every frame is held for the same time (no duplicated/held frame)', cs.join(','));
  const at = (t) => vm.runInContext(IDX.replace('const idx = ', '(').replace(/;$/, ')'), Object.assign(ctx, { n, fps, t, D: { _phase: phase } }));
  ok(at(0.3) === at(0.3 + 7 * period) && at(1.234) === at(1.234 + 3 * period), 'the loop is periodic: the same clock phase gives the same frame after any number of periods');
}
ok(ENG.includes('frame = Math.floor(now / ms + u.phase * n) % n;'), 'sprite-engine idle index is floor(now/ms + phase*n) % n');
ok(!/idle[^\n]*scale\(/.test(ENG), 'sprite-engine has no scale in its idle path');
ok(/idx = Math\.floor\(\(t \+ _spritePhaseOffset\(id\)\) \/ stepMs\) % frames\.length;/.test(SRC), 'DOM ticker idle index is floor((t + phase) / stepMs) % frames.length');

console.log(fails ? '\n  ' + fails + ' FAIL' : '\n  all green');
process.exit(fails ? 1 : 0);
