/* 🛡 SPRITE ATELIER GUARDLINE — no path can silently delete, truncate or
   corrupt a saved sprite set.

   Asked for as: "set a guardline where the sprites do not delete or break in
   the Sprite Atelier." Defends:
     G1 a save whose record holds a non-string / empty frame, or FEWER frames
        than the on-disk copy without an explicit user delete, is REFUSED with
        a toast and spr:<id> on disk is untouched;
     G2 publish / migrate write the rebuilt record only when every anim is at
        least as long as the original and holds no null — else the original
        stays and the run reports it;
     G3 the disk-full cloud fallback swaps frames for URLs on a COPY; the
        resident record and disk change only after idbSet + read-back succeed,
        so a failed upload never removes the local copy;
     G4 remove-frame and clear-all snapshot to spr:__undo:<id> BEFORE deleting
        and toast a 10 s Undo (clear-all keeps its gcConfirm);
     G5 forge_sprites_idx is only ever written as a superset of the on-disk
        spr: keys, on every path; window.MythicSpriteGuard exposes
        validate(rec) / diffFrames(a, b).

   Run: node _spriteguard_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
function slice(from, to, label) {
  const i = SRC.indexOf(from);
  if (i < 0) throw new Error('cannot find start of ' + label + ': ' + from);
  const j = SRC.indexOf(to, i + from.length);
  if (j < 0) throw new Error('cannot find end of ' + label + ': ' + to);
  return SRC.slice(i, j);
}
function fnText(name) {
  const i = SRC.indexOf('function ' + name + '(');
  if (i < 0) return '';
  let d = 0, j = SRC.indexOf('{', i);
  for (let k = j; k < SRC.length; k++) { if (SRC[k] === '{') d++; else if (SRC[k] === '}') { d--; if (!d) return SRC.slice(i, k + 1); } }
  return '';
}
const count = (re) => (SRC.match(re) || []).length;

/* ── source shape ─────────────────────────────────────────────────────── */
console.log('source:');
ok(/window\.MythicSpriteGuard = \{ validate: _sprGuardValidate, diffFrames: _sprGuardDiffFrames/.test(SRC), 'window.MythicSpriteGuard = { validate, diffFrames, … } seam');
ok(/async function _sprGuardWrite\(id, rec, opts\)/.test(SRC), 'one guarded write for every spr:<id> save');
ok(/async function _sprIdxWrite\(/.test(SRC) && count(/idbSet\('forge_sprites_idx'/g) === 1, 'forge_sprites_idx is written by ONE helper only', count(/idbSet\('forge_sprites_idx'/g) + ' raw writes');
ok(/id\.indexOf\('__'\) !== 0\) Forge\._sprIds\.add\(id\)/.test(fnText('_ensureSprIdx')), 'the index never lists __undo / __ internal keys');
const REM = slice("const removeBtns = document.querySelectorAll('[data-remove-frame]')", "const zone = document.getElementById('upload-zone')", 'atelier delete handlers');
ok(/_sprGuardSnapshot\(id[\s\S]*splice\(idx, 1\)/.test(REM), 'remove-frame: snapshot BEFORE the splice');
ok(/gcConfirm\('Remove all sprites for this subject[\s\S]*_sprGuardSnapshot\([\s\S]*delete Forge\.sprites\[/.test(REM), 'clear-all: gcConfirm kept, snapshot BEFORE the delete');
ok(/_sprGuardOfferUndo\(/.test(REM) && /'spr:__undo:' \+ /.test(SRC) && /10000/.test(fnText('_sprGuardOfferUndo')), 'both offer a 10 s Undo from spr:__undo:<id>');
const UP = fnText('uploadSpriteFiles');
ok(/_sprGuardWrite\(id, Forge\.sprites\[id\]/.test(UP) && !/idbSet\('spr:' \+ id/.test(UP), 'Atelier upload saves through the guard, never a raw idbSet');
ok(/_sprGuardCloudCopy\(/.test(UP) && /_sprGuardCloudCopy\(/.test(fnText('_persistSpriteRecord')), 'disk-full fallback swaps URLs on a COPY (both upload paths)');
const CC = fnText('_sprGuardCloudCopy');
ok(/copy\[k\] = Array\.isArray\(arr\) \? arr\.slice\(\) : arr/.test(CC) && /Forge\.sprites\[id\] = copy/.test(CC) && CC.indexOf('Forge.sprites[id] = copy') > CC.indexOf('idbGet(') , 'resident record replaced only after the write + read-back succeed');
const MIG = fnText('_migrateSpritesToCloud');
ok(/_sprGuardDiffFrames\(rec, newRec\)/.test(MIG) && /guardKept\+\+/.test(MIG), 'migrate: a shorter / null-holding newRec is kept as the original and counted');
ok(count(/_sprGuardWrite\(id, best, \{ why: 'publish'/g) === 2, 'publish (streamed + full): persist-back goes through the guard', count(/_sprGuardWrite\(id, best, \{ why: 'publish'/g));
ok(/_sprGuardWrite\(_id, v, \{ why: 'save'/.test(fnText('saveForge')), 'saveForge per-key sprite writes go through the guard');
ok(/_sprGuardWrite\(id, spriteMap\[id\], \{ why: 'reclaim'/.test(SRC), 'reclaim: the cloud record cannot overwrite a longer local one');
ok(/_sprGuardAllowShrink\(key\)/.test(SRC) && count(/_sprGuardAllowShrink\(key\)/g) >= 2, 'card-editor Clear + Kalon Clear are explicit deletes (allowed to shrink)');

/* ── behaviour, headless ──────────────────────────────────────────────── */
console.log('behaviour:');
function makeCtx(opts) {
  opts = opts || {};
  const disk = new Map();
  for (const k in (opts.disk || {})) disk.set(k, JSON.parse(JSON.stringify(opts.disk[k])));
  const log = { sets: [], dels: [], toasts: [], calls: [] };
  const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  const heavy = (v) => { try { return JSON.stringify(v).indexOf('data:') >= 0; } catch (e) { return false; } };
  const ctx = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    Forge: { sprites: clone(opts.sprites || {}), _sprIds: opts.sprIds === undefined ? new Set() : opts.sprIds },
    App: { spriteSubjectId: opts.id || 'u_hero', spriteActiveAnim: opts.anim || 'idle', spriteUploadRes: 128 },
    Profile: { cloud: { signedIn: true } },
    showToast: (t) => { log.toasts.push(String(t)); log.calls.push('toast'); },
    gcConfirm: async () => { log.calls.push('gcConfirm'); return true; },
    cloudUploadAssetFile: async (path, d) => { log.calls.push('upload:' + path); return opts.uploadOk ? { ok: true, url: 'https://cdn/' + path } : { ok: false, error: 'network' }; },
    _artValueToDataUrl: async (v) => (opts.dead && opts.dead.indexOf(v) >= 0) ? null : (typeof v === 'string' ? v : null),
    idbGet: async (k) => { log.calls.push('get:' + k); return clone(disk.get(k)); },
    idbSet: async (k, v) => {
      log.sets.push(k); log.calls.push('set:' + k);
      if (opts.quotaFull && k.indexOf('spr:') === 0 && heavy(v)) return false;
      disk.set(k, clone(v)); return true;
    },
    idbDel: async (k) => { log.dels.push(k); log.calls.push('del:' + k); disk.delete(k); return true; },
    idbKeys: async (p) => Array.from(disk.keys()).filter(k => !p || k.indexOf(p) === 0),
    resizeImage: async (f) => 'data:image/png;base64,' + f.name,
    saveForge: () => { log.calls.push('saveForge'); },
    _softUpdateSpriteEditor: () => {}, captureAndRender: () => {}, render: () => {},
    _sprMissing: new Set(), _storagePutRetry: async () => null, _sleep: async () => {}, CATALOG_SHARD_CAP_BYTES: 4000000,
    _artIndexJson: () => '{}', initCloud: () => true, isAdmin: () => true, escapeHtml: (s) => String(s),
    navigator: {}, localStorage: { getItem() { return null; }, setItem() {} },
    setTimeout: (fn) => { try { fn(); } catch (e) {} return 0; }, clearTimeout() {},
    document: {
      querySelectorAll: (sel) => (sel === '[data-remove-frame]' ? [ctx._removeBtn] : []),
      getElementById: (id) => (id === 'btn-clear-all-sprites' ? ctx._clearBtn : null),
      querySelector: () => null, body: { appendChild() {} }, createElement: () => ({ classList: { add() {}, remove() {} }, remove() {} }),
    },
    _removeBtn: { dataset: { removeFrame: '1' }, onclick: null },
    _clearBtn: { onclick: null },
    Date, Math, JSON, Array, Object, String, Number, Set, Map, Promise, Blob: class Blob { constructor() { this.size = 1; } }, isFinite, parseInt,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const code = [
    slice('async function _ensureSprIdx()', '// 🔍 One-click storage diagnostic', 'index + guard + persist'),
    slice('async function _migrateSpritesToCloud(', 'async function migrateSpritesToCloud()', 'migrate'),
    slice('function _artRecordFrameCount(rec)', 'async function cloudPublishCatalogArt()', 'publish'),
    slice('function _spriteUploadRes()', '// ============ SPRITE SHEET SLICING', 'atelier'),
  ].join('\n');
  vm.runInContext(code, ctx);
  return { ctx, disk, log, run: (s) => vm.runInContext(s, ctx) };
}
const frames = (rec, anim) => (rec && Array.isArray(rec[anim || 'idle'])) ? rec[anim || 'idle'].length : 0;
const GOOD = { idle: ['data:a', 'data:b', 'data:c'], attack: ['data:x'] };

try {
  const { run } = makeCtx();
  const v1 = run("MythicSpriteGuard.validate({ idle: ['data:a', {}, 'data:c'] })");
  const v2 = run("MythicSpriteGuard.validate({ idle: ['data:a', '', 'data:c'] })");
  const v3 = run("MythicSpriteGuard.validate({ idle: ['data:a', 'https://x/y'], frameMs: 90 })");
  ok(v1 && v1.ok === false && v2 && v2.ok === false && v3 && v3.ok === true, 'validate: object / empty frame refused, string frames accepted', JSON.stringify([v1, v2, v3]));
  const d = run("MythicSpriteGuard.diffFrames({ idle: ['a','b','c'], attack: ['x'] }, { idle: ['a','b'], attack: ['x'], walk: ['w'] })");
  ok(d && d.shrunk.length === 1 && d.shrunk[0].anim === 'idle' && d.shrunk[0].before === 3 && d.shrunk[0].after === 2 && d.lost === 1, 'diffFrames reports the shrunk anim and frames lost', JSON.stringify(d));
} catch (e) { ok(false, 'guard seam runs headless', e.message); }

/* G1 — a broken resident record must never reach disk */
try {
  const T = makeCtx({ disk: { 'spr:u_hero': GOOD }, sprites: { u_hero: { idle: ['data:a', null, 'data:c'], attack: ['data:x'] } } });
  await T.run("uploadSpriteFiles([{ name: 'new.png' }])");
  ok(!T.log.sets.some(k => k === 'spr:u_hero'), 'G1 broken save: idbSet(spr:u_hero) never called', T.log.sets.join(','));
  ok(frames(T.disk.get('spr:u_hero')) === 3 && T.log.toasts.some(t => /NOT saved|refused/i.test(t)), 'G1 broken save: disk keeps 3 frames and the user is told', T.log.toasts.join(' | '));
} catch (e) { ok(false, 'G1 scenario runs', e.message); ok(false, 'G1 (skipped)'); }
try {
  const T = makeCtx({ disk: { 'spr:u_hero': GOOD }, sprites: { u_hero: { idle: ['data:a'], attack: ['data:x'] } } });
  const r = await T.run("_persistSpriteRecord('u_hero', { cloud: false })");
  ok(!r.saved && frames(T.disk.get('spr:u_hero')) === 3, 'G1 shorter save (no user delete): refused, disk keeps 3 frames', JSON.stringify(r) + ' disk=' + frames(T.disk.get('spr:u_hero')));
} catch (e) { ok(false, 'G1 shrink scenario runs', e.message); }

/* G2 — publish / migrate cannot drop frames */
try {
  const T = makeCtx({ disk: { 'spr:u_hero': GOOD }, sprites: {}, uploadOk: true, dead: ['data:b'] });
  const before = frames(T.disk.get('spr:u_hero'));
  await T.run("_publishArtCategoryStreamed('sprites', 'sprites')");
  const after = frames(T.disk.get('spr:u_hero'));
  ok(before === 3 && after === before, 'G2 publish with a dead frame: on-disk frame count before === after (' + before + ')', 'after=' + after);
} catch (e) { ok(false, 'G2 publish scenario runs', e.message); }
try {
  const T = makeCtx({ disk: { 'spr:u_hero': { idle: ['data:a', null, 'data:c'] } }, sprites: {}, uploadOk: true, sprIds: new Set(['u_hero']) });
  const res = await T.run("_migrateSpritesToCloud()");
  const rec = T.disk.get('spr:u_hero');
  ok(rec && rec.idle[0] === 'data:a' && rec.idle.length === 3 && res && res.guardKept === 1, 'G2 migrate with a null frame: original kept and reported', JSON.stringify({ res, rec }));
} catch (e) { ok(false, 'G2 migrate scenario runs', e.message); }

/* G3 — a failed cloud fallback never removes the local copy */
try {
  const T = makeCtx({ disk: { 'spr:u_hero': GOOD }, sprites: { u_hero: GOOD }, quotaFull: true, uploadOk: false });
  await T.run("uploadSpriteFiles([{ name: 'new.png' }])");
  const resident = T.ctx.Forge.sprites.u_hero;
  ok(resident.idle.length === 4 && resident.idle.slice(0, 3).join() === GOOD.idle.join() && resident.idle.every(f => f.indexOf('data:') === 0) && resident.attack[0] === 'data:x', 'G3 Atelier: failed upload leaves every local frame in place (no URL swap, no loss; the new frame stays resident)', JSON.stringify(resident));
  ok(JSON.stringify(T.disk.get('spr:u_hero')) === JSON.stringify(GOOD), 'G3 Atelier: on-disk record identical', JSON.stringify(T.disk.get('spr:u_hero')));
  ok(T.log.toasts.some(t => /Could NOT save|storage is full/i.test(t)), 'G3 Atelier: the true failure is reported');
} catch (e) { ok(false, 'G3 scenario runs', e.message); ok(false, 'G3 (skipped)'); ok(false, 'G3 (skipped)'); }
try {
  const T = makeCtx({ disk: { 'spr:u_hero': GOOD }, sprites: { u_hero: GOOD }, quotaFull: true, uploadOk: false });
  const r = await T.run("_persistSpriteRecord('u_hero', { cloud: true })");
  ok(!r.saved && JSON.stringify(T.ctx.Forge.sprites.u_hero) === JSON.stringify(GOOD), 'G3 card editor: failed upload leaves the resident record identical', JSON.stringify(T.ctx.Forge.sprites.u_hero));
} catch (e) { ok(false, 'G3 persist scenario runs', e.message); }

/* G4 — delete paths snapshot first and can be undone */
try {
  const T = makeCtx({ disk: { 'spr:u_hero': GOOD }, sprites: { u_hero: GOOD } });
  await T.run('attachSpriteEditorHandlers()');
  await T.ctx._removeBtn.onclick({ preventDefault() {}, stopPropagation() {} });
  const snapAt = T.log.calls.indexOf('set:spr:__undo:u_hero');
  const writeAt = T.log.calls.indexOf('set:spr:u_hero');
  ok(snapAt >= 0 && writeAt > snapAt, 'G4 remove-frame: snapshot written BEFORE the shrunk record', T.log.calls.join(' > '));
  ok(frames(T.disk.get('spr:u_hero')) === 2 && frames(T.disk.get('spr:__undo:u_hero') && T.disk.get('spr:__undo:u_hero').rec) === 3, 'G4 remove-frame: disk has 2 frames, the undo snapshot has 3');
  ok(T.log.toasts.some(t => /Undo/.test(t)), 'G4 remove-frame: Undo toast shown', T.log.toasts.join(' | '));
  await T.run("MythicSpriteGuard.undo('u_hero')");
  ok(frames(T.disk.get('spr:u_hero')) === 3 && T.ctx.Forge.sprites.u_hero.idle.length === 3, 'G4 undo restores the 3-frame record on disk and in memory');
  await T.ctx._clearBtn.onclick();
  const c = T.log.calls;
  const gc = c.lastIndexOf('gcConfirm'), snap = c.lastIndexOf('set:spr:__undo:u_hero'), del = c.lastIndexOf('del:spr:u_hero');
  ok(gc >= 0 && snap > gc && del > snap && !T.ctx.Forge.sprites.u_hero, 'G4 clear-all: gcConfirm > snapshot > delete', c.slice(gc).join(' > '));
  await T.run("MythicSpriteGuard.undo('u_hero')");
  ok(frames(T.disk.get('spr:u_hero')) === 3, 'G4 clear-all can be undone');
} catch (e) { ok(false, 'G4 scenario runs', e.message); for (let i = 0; i < 5; i++) ok(false, 'G4 (skipped)'); }

/* G5 — the index is always a superset of the on-disk keys */
try {
  const T = makeCtx({ disk: { 'spr:u_a': GOOD, 'spr:u_b': GOOD, 'spr:__undo:u_a': { rec: GOOD }, forge_sprites_idx: ['u_a', 'u_b', 'u_old'] }, sprites: { u_c: GOOD }, id: 'u_c', sprIds: new Set() });
  await T.run("uploadSpriteFiles([{ name: 'new.png' }])");
  const idx = T.disk.get('forge_sprites_idx') || [];
  ok(['u_a', 'u_b', 'u_c', 'u_old'].every(x => idx.indexOf(x) >= 0) && idx.indexOf('__undo:u_a') < 0, 'G5 upload with an empty resident index: written index is a superset of disk (+ old index), no __undo', JSON.stringify(idx));
  const T2 = makeCtx({ disk: { 'spr:u_a': GOOD, 'spr:u_b': GOOD }, sprites: { u_b: GOOD }, uploadOk: true, sprIds: new Set(['u_b']) });
  await T2.run("_migrateSpritesToCloud()");
  const idx2 = T2.disk.get('forge_sprites_idx') || [];
  ok(idx2.indexOf('u_a') >= 0 && idx2.indexOf('u_b') >= 0, 'G5 migrate with a partial resident index: index still lists every on-disk sprite', JSON.stringify(idx2));
} catch (e) { ok(false, 'G5 scenario runs', e.message); ok(false, 'G5 (skipped)'); }

console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
