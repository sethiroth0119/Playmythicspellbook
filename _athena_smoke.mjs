/* 🌍 ATHENA ENGINE — Scene, Files, menu buttons, hubs and interactions.

   Asked for: "add 2 sections where it shows everything that is in the map,
   like assets, and the second where all of the files that were uploaded to
   the engine. Allow me to upload GLB, audio, animations and VFX files. Then
   have it where the map can be turned into a button on the game's menu where
   I name the button, which menu it goes on, if it is multiplayer (a player
   hub with prox chat and typed chat) or an interaction — entering a building
   takes the player to a menu; a dialogue pulls a guide from the Forge."

   What this defends, headless, straight off the modules and index.html:
     · the map document carries menu / act / au / anim.src and every field
       is normalized, clamped and never crashes on garbage;
     · the Files module tells the four kinds apart from a file name and what
       a GLB holds, refuses what it cannot host, and stores under the owner's
       folder in the models bucket;
     · the editor has the three new tabs, the upload control, the Scene
       list, and saving a menu-button map forces public + refreshes the hub;
     · the world grows positional audio, external clips and objectsNear;
       the engine starts audio on a gesture;
     · the session enters a map full-screen, runs interactions (screen / hub
       / guide) through the bridge, and the hub rides one realtime channel
       with pos / chat / rtc events and a 16 m voice range;
     · index.html hands the module hubs(), guides() and playGuide(), and
       renderTitle() appends the menu tiles to the hub it draws;
     · sql/112 ships the table with RLS.

   Run: node _athena_smoke.mjs */
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const read = (p) => readFileSync(p, 'utf8');
const D = './public/src/mapforge/';

/* ── 1. the document format ── */
const fmt = await import(pathToFileURL(D + 'mapforge.format.js').href);
{
  const m = fmt.newMap({ name: 'x' });
  ok(m.menu && m.menu.on === false && m.menu.hub === 'main' && m.menu.mode === 'interact', 'newMap carries an OFF menu on the main hub');
  const n = fmt.normalize({ menu: { on: true, label: 'L'.repeat(90), sub: 'S', icon: '🏛️🏛️🏛️', hub: 'forge', mode: 'hub', chatVoice: false, kind: 'dialog', guide: 'g1', target: 'bad id!!' } });
  ok(n.menu.on === true && n.menu.label.length === 40 && n.menu.hub === 'forge' && n.menu.mode === 'hub' && n.menu.chatText === true && n.menu.chatVoice === false && n.menu.kind === 'dialog' && n.menu.guide === 'g1', 'normalize clamps and keeps every menu field', JSON.stringify(n.menu));
  ok(n.menu.target === 'badid', 'a screen target is reduced to an id (no spaces / punctuation)', n.menu.target);
  const bad = fmt.normalize({ menu: { hub: 'nowhere', mode: 'party', kind: 'fly' } });
  ok(bad.menu.hub === 'main' && bad.menu.mode === 'interact' && bad.menu.kind === 'enter', 'unknown hub / mode / kind fall back');
  ok(fmt.HUBS.length === 7 && fmt.HUBS.includes('arcanum') && fmt.HUBS.includes('main'), 'the seven hubs are the game\'s seven menus');
  const o = fmt.normalizeObject({ t: 'house', p: [1, 2, 3], act: { kind: 'screen', target: 'cardShop', prompt: 'P'.repeat(60) } });
  ok(o.act && o.act.kind === 'screen' && o.act.target === 'cardShop' && o.act.prompt.length === 40, 'an object interaction (screen) survives normalize', JSON.stringify(o.act));
  ok(fmt.normalizeAct({ kind: 'guide', guide: 'g9', auto: false }).auto === false, 'a Zone can wait for E instead of firing on entry');
  ok(fmt.normalizeAct({ kind: 'hub', hub: 'codex' }).hub === 'codex' && fmt.normalizeAct({ kind: 'hub', hub: 'x' }).hub === 'main', 'a hub interaction is validated');
  ok(fmt.normalizeAct({ kind: 'none' }) === undefined && fmt.normalizeAct('x') === undefined, 'none / garbage → no interaction');
  const au = fmt.normalizeObject({ t: 'audio', p: [0, 0, 0], au: { url: 'https://x/y.mp3', vol: 9, r: 9999, loop: false } });
  ok(au.au && au.au.vol === 1 && au.au.r === 200 && au.au.loop === false, 'sound marker: volume 0..1, range ≤ 200 m, loop kept', JSON.stringify(au.au));
  ok(fmt.normalizeObject({ t: 'house', p: [0, 0, 0], au: { url: 'x' } }).au === undefined, 'only an audio marker carries au');
  ok(fmt.normalizeAnim({ clip: 'walk', src: 'https://x/anim.glb' }).src === 'https://x/anim.glb' && fmt.normalizeAnim({ clip: 'walk' }).src === undefined, 'anim.src (an uploaded clip file) is kept, absent otherwise');
  const rt = fmt.normalize(JSON.parse(JSON.stringify(fmt.serialize(n))));
  ok(rt.menu.on && rt.menu.hub === 'forge', 'menu round-trips through serialize');
}

/* ── 2. props: the 🔊 marker ── */
const props = await import(pathToFileURL(D + 'mapforge.props.js').href);
{
  const a = props.PROP_BY_ID.audio;
  ok(a && a.cat === 'Markers' && a.marker === true && a.col === false, 'Sound is a Markers prop: hidden in the game, no collision');
  ok(props.collides({ t: 'audio' }) === false, 'a sound marker never blocks the player');
}

/* ── 3. the Files module ── */
const A = await import(pathToFileURL(D + 'mapforge.files.js').href);   // the uploads API moved here in the Athena merge (mapforge.assets.js is build A's asset-browser index)
{
  ok(A.KINDS.join() === 'model,anim,audio,vfx', 'four kinds: model, anim, audio, vfx');
  ok(A.kindOf({ name: 'tree.glb' }) === 'model', 'a .glb is a model');
  ok(A.kindOf({ name: 'idle_anim.glb' }, { clips: ['idle'], meshes: 4 }) === 'anim', 'a .glb named like an animation that has clips is an animation');
  ok(A.kindOf({ name: 'rig.glb' }, { clips: ['a'], meshes: 0 }) === 'anim', 'a clips-only .glb (no meshes) is an animation');
  ok(A.kindOf({ name: 'hero.glb' }, { clips: ['a'], meshes: 4 }) === 'model', 'a model with clips stays a model');
  ok(A.kindOf({ name: 'wind.MP3' }) === 'audio' && A.kindOf({ name: 'a.wav' }) === 'audio' && A.kindOf({ name: 'a.ogg' }) === 'audio', 'mp3 / wav / ogg are audio');
  ok(A.kindOf({ name: 'torch.json' }) === 'vfx', 'json is a VFX preset');
  ok(A.kindOf({ name: 'x.exe' }) === null && A.kindOf({ name: 'x.png' }) === null, 'anything else is refused');
  ok(A.kindOf({ name: 'x.glb' }, null, 'anim') === 'anim', 'the upload form can force the kind');
  ok(A.contentTypeOf({ name: 'a.glb' }) === 'model/gltf-binary' && A.contentTypeOf({ name: 'a.mp3' }) === 'audio/mpeg', 'content types are set on upload');
  const r = await A.list();
  ok(r.ok === false && r.offline === true && Array.isArray(r.rows), 'list() with no bridge is offline, never throws');
  const u = await A.upload({ name: 'a.glb', size: 10 });
  ok(u.ok === false && /sign in/i.test(u.error), 'upload() with no bridge says sign in');
  const src = read(D + 'mapforge.files.js');   // the uploads API (renamed in the Athena merge)
  ok(/\/athena\/' \+ kind \+ '\//.test(src) && /me \+ '\/athena\//.test(src), 'bytes go under {uid}/athena/{kind}/ in the models bucket (owner-folder policy)');
  ok(/from\(TABLE\)\.insert\(row\)/.test(src) && /storage\.from\(BUCKET\)\.remove\(\[path\]\)/.test(src), 'a row that fails removes the bytes again');
  ok(/60 \* 1024 \* 1024/.test(src), '60 MB cap');
}

/* ── 4. the editor ── */
{
  const ed = read(D + 'mapforge.editor.js');
  ok(/data-tab="scene">Scene</.test(ed) && /data-tab="files">Files</.test(ed) && /data-tab="menu">Menu</.test(ed), 'three new tabs: Scene, Files, Menu');
  ok(/function renderSceneTab\(\)/.test(ed) && /Model files/.test(ed) && /data-obj=/.test(ed), 'Scene tab lists model files and every object');
  ok(/function renderFilesTab\(/.test(ed) && /assetsApi\.list\(\)/.test(ed) && /id="mf-up-file"[^>]*accept="\.glb,\.gltf,\.mp3,\.wav,\.ogg,\.m4a,\.json"/.test(ed), 'Files tab lists uploads and accepts glb / audio / json');
  ok(/async function uploadFiles\(/.test(ed) && /assetsApi\.upload\(f, \{ inspect: inspectFile/.test(ed), 'upload goes through the module with GLB inspection');
  ok(/function useFile\(a\)/.test(ed) && /a\.kind === 'anim'/.test(ed) && /a\.kind === 'audio'/.test(ed) && /a\.kind === 'vfx'/.test(ed), 'using a file: model / anim / audio / vfx paths');
  ok(/S\.propId = 'audio'/.test(ed) && /o\.au = \{ url: S\.audioUrl/.test(ed), 'an audio file arms the 🔊 marker; placing it writes o.au');
  ok(/S\.fxPreset = \{ kind, url: a\.url/.test(ed) && /S\.propId = 'fx_' \+ kind/.test(ed), 'a VFX preset arms its emitter');
  ok(/o\.anim = \{ clip: clips\[0\]\.name, speed: 1, loop: 'repeat', src: a\.url \}/.test(ed), 'an animation file applies to the selected model with src');
  ok(/src: \(o\.anim && o\.anim\.src\) \|\| undefined/.test(ed), 'the inspector keeps anim.src when re-applying');
  ok(/function renderMenuTab\(\)/.test(ed) && /id="mf-mn-hub"/.test(ed) && /id="mf-mn-mode"/.test(ed) && /id="mf-mn-voice"/.test(ed) && /id="mf-mn-guide"/.test(ed) && /id="mf-mn-target"/.test(ed), 'Menu tab: hub, kind (hub / interaction), chat toggles, guide, target');
  ok(/S\.map\.menu\.on && source === 'cloud' && !S\.isPublic\) \{ S\.isPublic = true/.test(ed), 'saving a menu-button map to the cloud forces public');
  ok(/refreshMenu\(\)/.test(ed) && /import \{ refreshMenu \} from '\.\/mapforge\.menu\.js'/.test(ed), 'a save refreshes the hub tiles');
  ok(/id="mf-o-act"/.test(ed) && /normalizeAct\(raw\)/.test(ed), 'inspector: an Interaction block on objects');
  ok(/id="mf-o-auv"/.test(ed) && /id="mf-o-aur"/.test(ed), 'inspector: volume + range on a sound marker');
  ok(/if \(S\.propId === 'audio' && !S\.audioUrl\)/.test(ed), 'placing a sound marker with no file sends you to Files');
}

/* ── 5. world / engine ── */
{
  const w = read(D + 'mapforge.world.js');
  ok(/function attachAudio\(camera\)/.test(w) && /THREE\.PositionalAudio\(listener\)/.test(w) && /setDistanceModel\('linear'\)/.test(w), 'positional audio, linear falloff to the marker\'s range');
  ok(/function startAudio\(\)/.test(w) && /context\.resume\(\)/.test(w), 'audio starts (and resumes the context) on demand');
  ok(/function loadExtClips\(url\)/.test(w) && /anim\.src && !_retry/.test(w), 'setAnim fetches an external clip file once and retries');
  ok(/objectsNear: \(x, z, r\)/.test(w), 'objectsNear for interactions');
  ok(/stopAudio\(\); sounds\.forEach\(\(rec, id\) => detachSound\(id\)\)/.test(w), 'dispose stops every sound');
  const e = read(D + 'mapforge.engine.js');
  ok(/world\.attachAudio\(camera\)/.test(e) && /world\.startAudio\(\)/.test(e) && /addEventListener\('pointerdown', gesture\)/.test(e), 'the engine attaches audio and starts it on the first gesture');
}

/* ── 6. menu tiles + session ── */
{
  const mn = read(D + 'mapforge.menu.js');
  ok(/export function menuTiles\(hub\)/.test(mn) && /'athena-' \+ r\.id/.test(mn) && /b\.render\(\)/.test(mn), 'menuTiles(hub) is sync from a cache that primes itself and redraws the hub');
  ok(/replace\(\/\[<>&"'`\]\/g, ''\)/.test(mn), 'tile text from another player is stripped of markup');
  const api = read(D + 'mapforge.api.js');
  ok(/export async function menuMaps\(\)/.test(api) && /\.eq\('is_public', true\)\.filter\('data->menu->>on', 'eq', 'true'\)/.test(api), 'menuMaps: public maps whose menu is on — one narrow select');
  const s = read(D + 'mapforge.session.js');
  ok(/export async function enter\(mapId, opts\)/.test(s) && /mountWorld\(host, \{ id: mapId, source: opts\.source \|\| 'cloud', mode: 'fps', markers: false/.test(s), 'enter(mapId) mounts the cloud map first-person with markers hidden');
  ok(/if \(S\.menu\.mode === 'hub'\) startHub\(\)/.test(s), 'hub mode starts the shared room');
  ok(/c\.channel\('athena:' \+ s\.id, \{ config: \{ broadcast: \{ self: false \}, presence: \{ key: me \} \} \}\)/.test(s), 'one realtime channel per map, presence keyed by user');
  ok(/event: 'pos'/.test(s) && /event: 'chat'/.test(s) && /event: 'rtc'/.test(s), 'pos / chat / rtc events');
  ok(/const VOICE_RANGE = 16/.test(s) && /Math\.max\(0, 1 - d \/ VOICE_RANGE\)/.test(s), 'voice volume falls off linearly to silence at 16 m');
  ok(/String\(me\) < String\(uid\)\) createOffer\(uid\)/.test(s), 'the lower uid initiates the peer connection (no glare)');
  ok(/getUserMedia\(\{ audio: \{ echoCancellation: true, noiseSuppression: true \}, video: false \}\)/.test(s), 'voice is a mic-only capture with echo cancellation');
  ok(/if \(!hub\.voice\.on\) return;/.test(s), 'a player with voice off never answers an offer');
  ok(/function runAction\(act, o\)/.test(s) && /act\.kind === 'guide'/.test(s) && /b\.playGuide\(act\.guide\)/.test(s) && /b\.openScreen\(act\.target\)/.test(s) && /b\.openHub\(act\.hub/.test(s), 'interactions run through the bridge: guide / screen / hub');
  ok(/if \(menu\.kind === 'dialog' && menu\.guide\) return \{ kind: 'guide'/.test(s) && /if \(menu\.target\) return \{ kind: 'screen'/.test(s), 'a Zone with no interaction of its own runs the map default');
  ok(/s\.inZone\.add\(o\.id\)/.test(s) && /s\.inZone\.delete\(o\.id\)/.test(s), 'a zone fires once per entry');
  ok(/e\.key === 'e' \|\| e\.key === 'E'\) && S\.prompt/.test(s), 'E runs the prompted interaction');
  ok(/hub\.input\.onkeydown/.test(s) && /sendChat\(t\)/.test(s) && /slice\(0, 240\)/.test(s), 'typed chat: Enter sends, 240 chars');
  ok(/document\.body\.style\.overflow = s\.prevOverflow/.test(s) && /s\.g\.stop\(\)/.test(s), 'exit restores the page and stops the engine');
  const ix = read(D + 'index.js');
  ok(/menuTiles: menu\.menuTiles/.test(ix) && /enter: session\.enter/.test(ix) && /assets: \{ list: assets\.list, upload: assets\.upload/.test(ix), 'AthenaEngine exposes menuTiles / enter / assets');
}

/* ── 7. index.html ── */
{
  const H = read('./public/index.html');
  ok(/hubs: \(\) => \[\{ id: 'main', name: 'Main menu' \}/.test(H), 'bridge.hubs() lists the seven menus');
  ok(/openHub: \(h\) => \{[^\n]*App\.screen = 'title'; App\.titleHub = h === 'main' \? null : h; render\(\)/.test(H), 'bridge.openHub sets the title hub and renders');
  ok(/guides: \(\) => \{/.test(H) && /take\(typeof Forge !== 'undefined' && Forge\.pageGuides\); take\(typeof Catalog !== 'undefined' && Catalog\.pageGuides\)/.test(H), 'bridge.guides() merges Forge + Catalog page guides, deduped');
  ok(/playGuide: \(id\) => \{/.test(H) && /playPageGuide\(g, \{ manual: true \}\)/.test(H), 'bridge.playGuide plays a Forge guide by id');
  ok(/const _athenaHubPortals = \(h\) => \{/.test(H) && /A\.menuTiles\(h \|\| 'main'\)/.test(H) && /A\.enter\(t\.mapId\)/.test(H), 'renderTitle asks the module for tiles and enters the map on click');
  ok(/const portals = \(PORTALS\[hub\] \|\| PORTALS\.main\)\.filter\(Boolean\)\.concat\(_athenaHubPortals\(hub \|\| 'main'\)\);/.test(H), 'the tiles are appended to the hub being drawn');
  ok(/src\/mapforge\/index\.js\?v=mf\d+/.test(H) && !/src\/mapforge\/index\.js\?v=mf[1-8]"/.test(H), 'mapforge module tag is versioned (mf9+)');
  ok(/window\.BUILD_VERSION = 'v12[1-9]v\d+'/.test(H), 'BUILD_VERSION present');
}

/* ── 7b. point of view + character (map.player) ── */
{
  const np = fmt.normalizePlayer;
  const d = np(null);
  ok(d.view === 'fps' && d.model === null && Object.keys(d.anim).length === 0 && d.animFiles.length === 0, 'default player: first person, no character');
  const p = np({ view: 'tps', model: { a: 'a_1', scale: 99, faces: 'z' }, anim: { idle: { clip: 'Idle' }, run: { clip: 'Run', src: 'https://x/run.glb', speed: 20 }, jump: { clip: 'x' } }, animFiles: [{ url: 'https://x/run.glb', name: 'runs' }, { junk: 1 }] });
  ok(p.view === 'tps' && p.model.a === 'a_1' && p.model.scale === 50 && p.model.faces === 'z', 'view, model, clamped scale, facing kept', JSON.stringify(p.model));
  ok(p.anim.idle.clip === 'Idle' && p.anim.run.src === 'https://x/run.glb' && p.anim.run.speed === 8 && !p.anim.jump, 'idle/walk/run/interact only; src and clamped speed kept', JSON.stringify(p.anim));
  ok(p.animFiles.length === 1 && p.animFiles[0].name === 'runs', 'animation files listed, junk dropped');
  ok(np({ view: 'sideways' }).view === 'fps', 'unknown view → first person');
  const m = fmt.normalize({ assets: [{ id: 'a_1', url: 'https://x/m.glb' }], player: { view: 'top', model: { a: 'gone' } } });
  ok(m.player.view === 'top' && m.player.model === null, 'a character whose model left the map is dropped, the view stays');
  ok(fmt.newMap({}).player.view === 'fps', 'newMap carries a player block');
  const av = read(D + 'mapforge.avatar.js');
  ok(/export function createAvatar\(THREE, opts\)/.test(av) && /world\.loadAsset\(model\.a\)/.test(av) && /world\.loadExtClips\(src\)/.test(av), 'avatar loads the model through the world cache and borrows clips from uploaded files');
  ok(/if \(state === 'run'\)[^\n]*speed: 1\.6/.test(av) && /new THREE\.AnimationMixer\(body\)/.test(av) && /fadeIn\(0\.18\)/.test(av), 'run falls back to walk at 1.6×, one mixer, cross-fades');
  ok(/interact\(\) \{/.test(av) && /LoopOnce/.test(av), 'interact plays its clip once');
  const pl = read(D + 'mapforge.player.js');
  ok(/view: opts\.view \|\| 'fps', avatar: opts\.avatar \|\| null, state: 'idle'/.test(pl) && /if \(P\.view === 'top'\) P\.pointerLock = false;/.test(pl), 'the walker knows its view; top-down never grabs the mouse');
  ok(/if \(P\.view === 'top'\) \{ fwd\.set\(0, 0, -1\); right\.set\(1, 0, 0\); \}/.test(pl) && /if \(moving && P\.view === 'top'\) P\.yaw = Math\.atan2\(-mv\.x, -mv\.z\);/.test(pl), 'top-down: world-axis movement, character faces where it walks');
  ok(/P\.state = moving \? \(k\.shift \? 'run' : 'walk'\) : 'idle';/.test(pl), 'idle / walk / run from the keys');
  ok(/if \(P\.view === 'tps'\) \{/.test(pl) && /const back = 3\.2, side = 0\.6, up = 1\.55;/.test(pl) && /camera\.position\.y < gy/.test(pl), 'over-the-shoulder rig behind and to the right, never under the ground');
  ok(/else if \(P\.view === 'top'\) \{\s*camera\.position\.set\(P\.pos\.x, P\.pos\.y \+ 17, P\.pos\.z \+ 8\.5\);/.test(pl), 'top-down rig hangs above');
  ok(/P\.avatar\.update\(dt, P\.pos, P\.yaw, P\.state\)/.test(pl) && /function setView\(view, avatar\)/.test(pl) && /function interact\(\)/.test(pl), 'the avatar follows the walker; setView / interact exposed');
  const en = read(D + 'mapforge.engine.js');
  /* ⚠ THE CHARACTER CLAUSE MOVED, AND THIS IS NOT A LOOSENING.
     It used to pin the literal `createAvatar(THREE, { world, scene, player: pv })`
     — i.e. "the engine dresses the player in the MAP's one model". A map can
     now offer a CAST and a player carries an account-wide choice, so the engine
     resolves which character this person is wearing first. The claim is the
     same claim, made of the thing that now decides it: split into three so a
     future failure names which half broke. */
  ok(/const view = opts\.view \|\| pv\.view \|\| 'fps';/.test(en), 'the engine mounts with the map\'s view');
  ok(/const myModel = resolveCharacter\(pv, avatarPick\(\)\);/.test(en) &&
     /createAvatar\(THREE, \{ world, scene, outfit, player: \{ model: myModel/.test(en),
    'and with the character this player chose, resolved against the map\'s cast — the map\'s own model is the fallback inside resolveCharacter, not a second code path');
  ok(/pointerLock: opts\.pointerLock !== false && view !== 'top'/.test(en), 'and top-down never grabs the mouse');
  const ed = read(D + 'mapforge.editor.js');
  ok(/function renderPlayerTab\(\)/.test(ed) && /id="mf-pl-view"/.test(ed) && /id="mf-pl-model"/.test(ed) && /animRow\('idle'/.test(ed) && /animRow\('interact'/.test(ed), 'editor: Player & camera section with view, character and the four animations');
  ok(/player\.setView\(S\.map\.player\.view, play\.avatar\)/.test(ed), 'editor Play uses the same view and character as the game');
  ok(/id="mf-o-upanim"/.test(ed) && /data-clip=/.test(ed) && /kind: 'anim'/.test(ed), 'inspector: Animations block with clip chips and an upload for this model');
  ok(/data-act="player"/.test(ed) && /function addPlayerAnimFile\(url, name\)/.test(ed), 'Files: an animation file can go to the player character');
}

/* ── 8. sql ── */
{
  const q = read('./sql/112_world_assets.sql');
  ok(/create table if not exists public\.world_assets/.test(q) && /kind in \('model', 'anim', 'audio', 'vfx'\)/.test(q), 'sql/112: world_assets with the four kinds');
  ok(/enable row level security/.test(q) && /world_assets_select[\s\S]*using \(true\)/.test(q) && /world_assets_insert[\s\S]*owner_id = auth\.uid\(\)/.test(q) && /world_assets_delete/.test(q), 'RLS: everyone signed in reads, only the owner writes');
  ok(/insert into storage\.buckets \(id, name, public\)\s+values \('models', 'models', true\)/.test(q), 'the models bucket is asserted');
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
