/* 🔊🌾🐄🛣️ v121v94 — voice lines finish, the Feed Operation exists everywhere it
   must, and the Homestead Farm and Highway Haul modules are connected.

   1. "the audio is overlapping each other" — the cinematic player made a new
      Audio() per node and stopped none of them; the classic bubble player
      advanced on a typing timer that knew nothing about its clip. Driven: a
      stub Audio class records play/pause/src; the engine's next() must stop
      the previous clip, a voiced node must wait for 'ended' before an
      automatic advance, Next/Skip must cut a clip short, and a muted / blocked
      / erroring clip must count as finished so a scene never hangs.
   2. The Feed Operation: OPS_ECON.feed (1,500,000 🔥 / 55 ◈), OP_LABELS, the
      Just Business catalogue AND its sidebar row, node-city's OP_BP tile, and
      the opFound Aza branch that charges, awaits the ledger, refunds on a
      failed charge, and only then writes the row.
   3. Thirteen farm ids promoted: RESOURCES, SALVAGE_RES, RESOURCE_CINDER_VALUE,
      chain.js `existing`, MINIGAME_IDS — the four sites RESOURCES_NEXT names.
   4. The two modules load from index.html, publish their globals, and read
      only their bridges, which are defined and complete.

   Run: node _farmhaul_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
const NC = readFileSync('./public/node-city/index.html', 'utf8');
const NARR = readFileSync('./public/narrative/index.html', 'utf8');
const SCREENS = readFileSync('./public/corp/screens.jsx', 'utf8').replace(/\r\n/g, '\n');
const SHELL = readFileSync('./public/corp/shell.jsx', 'utf8').replace(/\r\n/g, '\n');
const CHAIN = readFileSync('./public/src/resources/chain.js', 'utf8');
const PROD = readFileSync('./public/src/city/production.data.js', 'utf8').replace(/\r\n/g, '\n');
const HAUL = readFileSync('./public/src/haul/index.js', 'utf8');
const FARM = readFileSync('./public/src/farm/index.js', 'utf8');
const FARM_IDS = ['animalFeed', 'eggs', 'feathers', 'rawMilk', 'meat', 'wool', 'hide', 'leather', 'fertilizer', 'goldEggs', 'primeMeat', 'richMilk', 'fineWool'];

/* ── 1. the cinematic AudioSys, lifted and driven ────────────────────────── */
{
  const a0 = NARR.indexOf('_voice: null, _voiceCb: null,');
  const a1 = NARR.indexOf("onVoiceEnd(cb){ if (this.voicePlaying()) this._voiceCb = cb; else cb(); }", a0);
  ok(a0 > 0 && a1 > a0, 'the voice block is in the AudioSys');
  const block = NARR.slice(a0, a1 + "onVoiceEnd(cb){ if (this.voicePlaying()) this._voiceCb = cb; else cb(); }".length);
  const made = [];
  class FakeAudio {
    constructor(url) { this.url = url; this.src = url; this.ended = false; this.paused = true; this.volume = 1; this._h = {}; this.plays = 0; made.push(this); }
    addEventListener(ev, fn) { this._h[ev] = fn; }
    play() { this.plays++; this.paused = false; return this._reject ? Promise.reject(new Error('blocked')) : Promise.resolve(); }
    pause() { this.paused = true; }
    end() { this.ended = true; this._h.ended && this._h.ended(); }
    fail() { this._h.error && this._h.error(); }
  }
  function sys(muted) {
    const ctx = { Audio: FakeAudio, muted: !!muted };
    vm.createContext(ctx);
    vm.runInContext('const AudioSys = { ' + block + ' }; this.A = AudioSys;', ctx);
    return ctx.A;
  }
  let A = sys(false); made.length = 0;
  A.playUrl('a.mp3');
  ok(made.length === 1 && A.voicePlaying(), 'a clip starts and is the current voice');
  A.playUrl('b.mp3');
  ok(made.length === 2 && made[0].paused && made[0].src === '' && A.voicePlaying() && made[1].plays === 1, 'a second clip STOPS the first before it starts (no overlap)');
  let fired = 0;
  A.onVoiceEnd(() => fired++);
  ok(fired === 0, 'onVoiceEnd waits while the clip plays');
  made[1].end();
  ok(fired === 1 && !A.voicePlaying(), '…and fires once when it ends');
  A.playUrl('c.mp3'); fired = 0; A.onVoiceEnd(() => fired++);
  A.stopVoice();
  ok(fired === 0 && !A.voicePlaying() && made[2].paused, 'stopVoice (Next/Skip) cuts the clip AND clears the pending advance — a skip never fires a stale auto-advance');
  made[2].end();
  ok(fired === 0, 'a stopped clip ending later fires nothing');
  A.playUrl('d.mp3'); fired = 0; A.onVoiceEnd(() => fired++); made[3].fail();
  ok(fired === 1, 'a clip that errors (404) counts as finished — the scene does not hang');
  A = sys(true); fired = 0; A.playUrl('e.mp3'); A.onVoiceEnd(() => fired++);
  ok(fired === 1 && !A.voicePlaying(), 'muted: nothing plays and the advance runs at once');
  A = sys(false); fired = 0; FakeAudio.prototype._reject = true; A.playUrl('f.mp3'); A.onVoiceEnd(() => fired++);
  await new Promise((r) => setTimeout(r, 5)); FakeAudio.prototype._reject = false;
  ok(fired === 1, 'blocked by autoplay: the rejected play() counts as finished');
  ok(fired === 1 && A.voicePlaying() === false, '…and the voice is cleared');
  /* engine wiring */
  ok(/next\(gotoId\)\{\s*if \(this\.typing\)\{[^\n]*\n[\s\S]{0,300}clearTimeout\(this\._autoT\); AudioSys\.stopVoice\(\);/.test(NARR), 'Engine.next() stops the voice on every advance (Next, Skip, choice)');
  ok(/if \(idx >= paras\.length\)\{\s*\/\*[\s\S]*?\*\/\s*AudioSys\.onVoiceEnd\(\(\) => \{ this\._paraTimer = setTimeout\(\(\) => this\.next\(\), 700\); \}\);/.test(NARR), 'the journal narration waits for its voice-over before moving on');
  ok(/if \(n\.audioUrl\) AudioSys\.onVoiceEnd\(\(\) => \{\s*if \(Engine\.node\(\) !== n \|\| Engine\.typing \|\| Engine\._done\) return;/.test(NARR), 'a voiced dialogue line advances by itself when the line ends, guarded against a node change');
  ok(/skipScene\(\)\{\s*this\.cancelType && this\.cancelType\(\); clearTimeout\(this\._paraTimer\); clearTimeout\(this\._autoT\); AudioSys\.stopVoice\(\);/.test(NARR), 'Skip stops the voice');
  ok(/this\._done = true;\s*clearTimeout\(this\._autoT\); AudioSys\.stopVoice\(\);/.test(NARR), 'finish stops the voice');
  ok(/const v = this\._voice; if \(v\) \{ if \(m\) v\.pause\(\);/.test(NARR), 'the mute button pauses the voice too');
  ok(!/try\{ const a = new Audio\(url\); a\.volume = \.9; a\.play\(\)\.catch\(\(\)=>\{\}\); \}catch\(e\)\{\}/.test(NARR), 'the fire-and-forget playUrl is gone');
}

/* ── 2. the classic bubble player ────────────────────────────────────────── */
{
  const i = SRC.indexOf("const _voiceBusy = () => { const a = RPGGuide._audio;");
  ok(i > 0, 'the classic player knows whether a clip is speaking');
  const T = SRC.slice(i, i + 4000);
  ok(/const start = \(\) => \{\s*_stopGuideAudio\(\);/.test(T), 'the previous clip is stopped before a bubble speaks');
  ok(/a\.addEventListener\('ended', \(\) => \{\s*if \(RPGGuide\._audio !== a \|\| idx !== myIdx \|\| RPGGuide\._typeTimer\) return;\s*if \(Array\.isArray\(b\.choices\) && b\.choices\.length\) return;\s*RPGGuide\._advTimer = setTimeout\(\(\) => advance\(\), 500\);/.test(T), 'a bubble with a voice line advances when the line ends — not while typing, not on a choice bubble, not for a stale bubble');
  ok(/if \(!hasChoices && !_voiceBusy\(\) && \(b\.autoAdvance \|\| b\.audioUrl\)\) \{/.test(T), 'typing done: auto-advance only when no clip is still speaking');
  ok(/if \(!hc && !_voiceBusy\(\) && \(b\.autoAdvance \|\| b\.audioUrl\)\) RPGGuide\._advTimer/.test(SRC), 'the skip-typing press respects a clip still speaking');
}

/* ── 3. the Feed Operation, everywhere an op has to exist ────────────────── */
{
  ok(/feed:\s+\{ startup: 1500000, azaStartup: 55, ratePerWorkerHr: 900, salaryPerWorkerHr: 240, maxWorkers: 10, yields: \{ animalFeed: 3\.0 \}, inputs: \{ food: 1\.0, water: 0\.8 \} \},/.test(SRC), 'OPS_ECON.feed: 1,500,000 Cinder or 55 Aza, feed out of food and water');
  ok(/feed: 'Feed Operation',/.test(SRC), 'OP_LABELS names it');
  ok(/\{ id: 'feed',\s+cat: 'Agriculture', icon: '🌾'/.test(SCREENS), 'the Just Business catalogue lists it');
  ok(/act\(\{ kind: 'opFound', op: o\.id, pay: 'aza' \}\)/.test(SCREENS) && /\(oe\.azaStartup \| 0\) > 0 &&/.test(SCREENS), 'the card offers the Aza button only when the op carries an Aza price');
  ok(/feed:\s+\{ label: 'Homestead Farm',\s+ico: '🐄', action: 'openFarm' \},/.test(SHELL), 'My Companies opens the Homestead Farm from the Feed Operation row');
  ok(/feed:\s+\{ label: 'Feed Operation',\s+ico: '🌾',\s+mesh: 'farm',/.test(NC), 'node-city has the op_feed tile');
  const b0 = SRC.indexOf("if (a.pay === 'aza') {");
  const B = SRC.slice(b0, SRC.indexOf("_jbSendData(); return;\n          }", SRC.indexOf("founded for ◈ ' + azaPrice + ' Aza.'", b0)) + 40);
  ok(B.indexOf('spendSovereigns(azaPrice') > 0 && B.indexOf('_sovLastCharge.promise') > B.indexOf('spendSovereigns(azaPrice'), 'the Aza branch charges, then awaits the ledger');
  ok(/if \(!ledgerId\) \{ try \{ refundSovereigns\(azaPrice\); \} catch \(e2\) \{\} showToast/.test(B), '…refunds when the charge did not settle');
  ok(B.indexOf("_opCreateLocal(a.op, 0, 'aza')") > B.indexOf('if (!ledgerId)'), '…and writes the row only after the charge settled');
  ok(/if \(_ownsOp\(a\.op\) \|\| \(Operations\.list \|\| \[\]\)\.some/.test(B), '…and refuses a duplicate before charging');
  ok(B.indexOf("_opCreateLocal(a.op, 0, 'aza')") < B.length && !/chargeCinderAtomic|_opTreasuryRow/.test(B), 'no Cinder path runs on the Aza branch');
  ok(/if \(a\.kind === 'openFarm'\) \{/.test(SRC) && /App\.screen = 'farm'; App\._farmReturn = 'title';/.test(SRC), 'openFarm leaves the Just Business frame for the Farm screen');
}

/* ── 4. the thirteen farm ids, at every site ─────────────────────────────── */
{
  const R = SRC.slice(SRC.indexOf('const RESOURCES = ['), SRC.indexOf('\n];', SRC.indexOf('const RESOURCES = [')));
  const S = SRC.slice(SRC.indexOf('const SALVAGE_RES = ['), SRC.indexOf('\n];', SRC.indexOf('const SALVAGE_RES = [')));
  const V = SRC.slice(SRC.indexOf('const RESOURCE_CINDER_VALUE = {'), SRC.indexOf('\n};', SRC.indexOf('const RESOURCE_CINDER_VALUE = {')));
  for (const id of FARM_IDS) {
    ok(new RegExp("\\{ id: '" + id + "',").test(R), 'RESOURCES has ' + id);
    ok(new RegExp('\\{ id: "' + id + '",').test(S), 'SALVAGE_RES has ' + id);
    ok(new RegExp('\\b' + id + ': \\d').test(V), 'RESOURCE_CINDER_VALUE prices ' + id);
    ok(new RegExp("'" + id + "'").test(PROD.slice(PROD.indexOf('export const MINIGAME_IDS'), PROD.indexOf('export const PROMOTED_STOCK_IDS'))), 'MINIGAME_IDS carries ' + id + ' (terroir fallback)');
  }
  for (const id of ['animalFeed', 'eggs', 'rawMilk', 'meat', 'fertilizer', 'leather'])
    ok(new RegExp("\\{ id: '" + id + "',[^\\n]*existing: true").test(CHAIN), 'chain.js marks ' + id + ' as existing in the ledger');
  const ids = (R.match(/^  \{ id: '([A-Za-z0-9_]+)'/gm) || []).map((m) => m.replace(/^  \{ id: '/, '').replace(/'$/, ''));
  ok(ids.length >= 156, 'RESOURCES is at least 156 ids (143 + 13; later builds append)', ids.length);
  ok(new Set(ids).size === ids.length, 'no RESOURCES id is duplicated');
  ok(/chain\.js\?v=v121v94chain3/.test(SRC) && /chain\.js\?v=v121v94chain3/.test(NC), 'chain.js is re-versioned in BOTH windows');
}

/* ── 5. the modules and their bridges ────────────────────────────────────── */
{
  ok(/<script type="module" src="src\/haul\/index\.js\?v=v121v\d+haul\d+"><\/script>/.test(SRC), 'Highway Haul is loaded (any haul buster — v121v109 moved it to haul2)');
  ok(/<script type="module" src="src\/farm\/index\.js\?v=v121v\d+farm\d+"><\/script>/.test(SRC), 'the Homestead Farm is loaded (any farm buster — v121v102 moved it to farm2)');
  ok(/window\.MythicHaul = MythicHaul;/.test(HAUL) && !/getElementById\('(st|open)'\)/.test(HAUL), 'the haul module publishes window.MythicHaul and the test-page lines are gone');
  ok(/window\.MythicFarm = api;/.test(FARM) && !/mount\(document\.getElementById\('app'\)\)/.test(FARM), 'the farm module publishes window.MythicFarm and the sandbox auto-mount is gone');
  ok(!/^import /m.test(HAUL) && !/^import /m.test(FARM), 'neither module imports anything (single-file bundles)');
  const haulFields = [...new Set([...HAUL.matchAll(/bridge\(\)\.([a-zA-Z_]+)/g)].map((m) => m[1]))].filter((f) => f !== '_null');
  const HB = SRC.slice(SRC.indexOf('window.MythicHaulBridge = {'), SRC.indexOf('window.MythicFarmBridge = {'));
  for (const f of haulFields) ok(new RegExp('\\b' + f + ':').test(HB), 'MythicHaulBridge defines ' + f);
  const mh = FARM.slice(FARM.indexOf('function makeHost() {'), FARM.indexOf('\n}\n', FARM.indexOf('function makeHost() {')));
  const farmFields = [...new Set([...mh.matchAll(/\bB\.([a-zA-Z_]+)/g)].map((m) => m[1]))];
  ok(farmFields.length >= 15, 'makeHost reads a real set of bridge fields', farmFields.length);
  const FB = SRC.slice(SRC.indexOf('window.MythicFarmBridge = {'), SRC.indexOf('window.cityAddCinders = (n, why) => {'));
  for (const f of farmFields) ok(new RegExp('\\b' + f + ':').test(FB), 'MythicFarmBridge defines ' + f);
  ok(/if \(App\.screen === 'farm'\)\s+return renderFarm\(\);/.test(SRC) && /^function renderFarm\(\) \{/m.test(SRC), 'the Farm screen is routed and rendered');
  ok(/__farm__:\s+\(Profile\.farm && typeof Profile\.farm === 'object'\) \? Profile\.farm : null,/.test(SRC) && /f\.__farm__/.test(SRC), 'the farm save syncs through the cloud profile');
  ok(/id="haul-drive"/.test(SRC) && /window\.MythicHaul\.open\(\)/.test(SRC), 'the Haulage Board has the Drive it button');
  ok(/const CLASS_OF = \{ animalFeed: 'heavy', livestock: 'fragile',/.test(HAUL), 'feed hauls as bulk (heavy) and livestock as fragile');
}

/* ── 5b. the terroir charge rule the ledger growth exposed — driven ───────── */
{
  /* Promoting 13 ids re-dealt the ground and turned the gauntlet red on the
     Smelting Foundry: "@dealt over-charged 264🔥 > one unit per leg (4🔥)".
     The rule was wrong for any two-yield building — inputs were charged at the
     MAX of the yields' terroir factors. Now the value-weighted mean. */
  const PS = readFileSync('./public/src/city/production.state.js', 'utf8');
  const i = PS.indexOf('export function inputTerroirScale(host, p, def) {');
  const fn = PS.slice(i, PS.indexOf('\n}\n', i) + 2).replace('export ', '');
  const mk = (factors, values) => {
    const ctx = { terroirFactor: (h, p, k) => factors[k], Number, Math, isFinite, Object };
    vm.createContext(ctx);
    vm.runInContext(fn + '\nthis.scale = inputTerroirScale;', ctx);
    return ctx.scale({ resValue: (k) => values[k] }, {}, { yields: { metal: 40, ingots: 12 } });
  };
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  ok(near(mk({ metal: 1, ingots: 1 }, { metal: 3, ingots: 6 }), 1), 'flat ground: factor 1');
  const w = mk({ metal: 1.6, ingots: 0.8 }, { metal: 3, ingots: 6 });
  ok(near(w, (40 * 3 * 1.6 + 12 * 6 * 0.8) / (40 * 3 + 12 * 6)), 'dealt ground: the value-weighted mean of the yields\' factors', w);
  ok(w < 1.6 && w > 0.8, '…which is never the max (1.6) and never the min (0.8)');
  /* neutrality, the property the gauntlet measures: output value ÷ input value is the catalogue ratio on any ground */
  const flat = (40 * 3 + 12 * 6) / (20 * 4);
  const dealt = (40 * 3 * 1.6 + 12 * 6 * 0.8) / (20 * 4 * w);
  ok(near(flat, dealt), 'a two-yield cycle keeps the catalogue ratio on dealt ground (value-neutral)', flat + ' vs ' + dealt);
  ok(near(mk({ metal: 2.4, ingots: 1.1 }, {}), (40 * 2.4 + 12 * 1.1) / 52), 'a host without the value seam falls back to unit weighting');
  ok(/resValue: \(id\) => \{ try \{ return _resCinderValue\(id\); \}/.test(SRC), 'the city bridge answers resValue from RESOURCE_CINDER_VALUE');
  ok(/resValue: \(id\) => \{ try \{ return B\.resValue \? \(Number\(B\.resValue\(id\)\) \|\| 0\) : 0; \}/.test(readFileSync('./public/src/city/index.js', 'utf8')), 'the host wrapper carries it');
}

/* ── 6. the knobs ────────────────────────────────────────────────────────── */
{
  const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
  ok(!!v && readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION', v);
  ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js CACHE_VERSION carries the build');
  ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(NC), 'NC_BUILD carries the build');
  ok(new RegExp('effects\\.js\\?v=' + v + '"').test(SRC) && new RegExp('handset\\.js\\?v=' + v + '"').test(SRC), 'effects.js and handset.js cache-busters equal the build');
}

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
