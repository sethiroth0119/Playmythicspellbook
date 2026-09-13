/* ============================================================================
 * _ley_smoke.mjs — 🜂 LEYLINES regression gate.        node _ley_smoke.mjs
 * ----------------------------------------------------------------------------
 * Covers public/src/battle/ley.js: seeding from both terrain vocabularies,
 * attunement, the clamp, territory conversion + contest + decay, faction
 * affinity, the painted-map guard, and the degenerate inputs the module has to
 * survive (null state, flying, dead, wall tiles).
 *
 * 🔴 THE ID CHECK IS THE ONE THAT EARNS ITS KEEP. ley.js names elements,
 * factions and terrain keys as STRING LITERALS in its own tables. A typo there
 * throws nothing, breaks no syntax gate and shows up only as "that faction's
 * perk never seems to fire" — so this parses ELEMENTS / FACTIONS / _BME_TERRAIN
 * straight out of index.html and asserts every literal against them.
 * ==========================================================================*/
import fs from 'fs';

const ROOT = new URL('.', import.meta.url).pathname;
const g = {};
new Function('window', fs.readFileSync(ROOT + 'public/src/battle/ley.js', 'utf8'))(g);
const L = g.MythicLey;
if (!L) { console.error('❌ ley.js did not register window.MythicLey'); process.exit(1); }

let fails = 0;
const ok = (n, c, extra = '') => { console.log((c ? '  ✅' : '  ❌') + ' ' + n + (c ? '' : '  <-- ' + extra)); if (!c) fails++; };

/* A miniature of the real type chart — enough for the matchups asserted below. */
const STRONG = { fire: ['nature', 'wind', 'ice', 'metal'], water: ['fire', 'earth', 'blood'],
                 ice: ['nature', 'water', 'blood'], metal: ['earth', 'ice', 'crystal'], nature: ['water'] };
const tm = (a, d) => (!a || !d) ? 1 : ((STRONG[a] || []).includes(d) ? 2 : ((STRONG[d] || []).includes(a) ? 0.5 : 1));
L.wire({
  getElementsOf: o => (o && o.elements) || [],
  getTypeMultiplier: tm,
  elementColor: () => '#f00', elementName: e => e,
  isFlying: u => !!(u && u.flying),
  log: (st, m) => { if (st && st.log) st.log.push({ msg: m }); },
});

const W = 5, H = 5;
const mk = () => ({ board: Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => ({ x, y }))), units: [], log: [] });

console.log('\n--- 1. SEEDING from editor paint (11-key fidelity) ---');
let s = mk();
// column-major terrain, cols*rows stride = rows
const terrain = new Array(W*H).fill('road');
terrain[0*H+0]='lava'; terrain[1*H+2]='water'; terrain[2*H+1]='snow'; terrain[3*H+3]='blight';
L.seed(s, { terrain, cols:W, rows:H, tiles:null });
// `lava` IS a real element id (ELEMENTS includes it), so lava terrain seeding
// the LAVA ley rather than fire is correct and higher-fidelity.
ok('lava seeds lava', s.board[0][0].ley?.elem==='lava', JSON.stringify(s.board[0][0].ley));
ok('water(x1,y2) seeds water', s.board[2][1].ley?.elem==='water', JSON.stringify(s.board[2][1].ley));
ok('snow(x2,y1) seeds ice', s.board[1][2].ley?.elem==='ice', JSON.stringify(s.board[1][2].ley));
ok('blight seeds corruption', s.board[3][3].ley?.elem==='corruption');
ok('road seeds NEUTRAL (no ley)', !s.board[4][4].ley);
ok('seed power capped at SEED_CAP', s.board[0][0].ley.power<=L.LEY.SEED_CAP, s.board[0][0].ley.power);
ok('seeded ground has no owner', s.board[0][0].ley.owner===null);
ok('seed is idempotent', (()=>{const b=JSON.stringify(s.board);L.seed(s,{terrain,cols:W,rows:H});return JSON.stringify(s.board)===b;})());

console.log('\n--- 2. SEEDING from generator surfaces (5-surf fallback) ---');
let s2 = mk();
L.seed(s2, { terrain:null, tiles:[{x:0,z:0,surf:'water'},{x:1,z:0,surf:'grass'},{x:2,z:0,surf:'asphalt'},{x:3,z:0,surf:'rubble'}] });
ok('surf water -> water ley', s2.board[0][0].ley?.elem==='water');
ok('surf grass -> nature ley', s2.board[0][1].ley?.elem==='nature');
ok('surf asphalt -> neutral',  !s2.board[0][2].ley);
ok('surf rubble -> metal ley', s2.board[0][3].ley?.elem==='metal');

console.log('\n--- 3. ATTUNEMENT (elements = damage) ---');
let s3 = mk(); s3._leySeeded=true;
s3.board[0][0].ley={elem:'fire',power:2,owner:'player',held:1,idle:0};
s3.board[0][1].ley={elem:'water',power:3,owner:'ai',held:1,idle:0};
const atk={name:'A',owner:'player',pos:{x:0,y:0},elements:['fire'],factions:[]};
const def={name:'D',owner:'ai',pos:{x:1,y:0},elements:['water'],factions:[]};
let d = L.damageMod(s3, atk, {...def,pos:{x:4,y:4}}, 'fire');
ok('attuned fire on fire ley p2 = +35%', Math.abs(d.mul-1.35)<1e-9, d.mul);
ok('flagged attuned', d.attuned===true);
d = L.damageMod(s3, {...atk,pos:{x:1,y:0}}, {...def,pos:{x:4,y:4}}, 'fire');
ok('fire cast on water ley = discordant -15%', Math.abs(d.mul-0.85)<1e-9, d.mul);
d = L.damageMod(s3, atk, def, 'fire');
ok('defender dug into own water ley p3 cuts 35%', Math.abs(d.mul-(1.35*0.65))<1e-9, d.mul);
d = L.damageMod(s3, {...atk,flying:true}, {...def,pos:{x:4,y:4}}, 'fire');
ok('FLYER draws nothing from the ground', d.mul===1, d.mul);
// Discord is ground-beats-move, so an off-element move is only NEUTRAL when the
// ground does not beat it. Both halves of that rule are asserted.
// 'water' is the genuinely neutral pairing against fire ground: fire is NOT
// strong vs water, so the ground does not beat the move. ('metal' is not
// neutral here — the real STRONG_VS has fire beating metal, so it is discordant.)
d = L.damageMod(s3, atk, {...def,pos:{x:4,y:4}}, 'water');
ok('neutral off-element move on fire ley = no change', d.mul===1, d.mul);
d = L.damageMod(s3, atk, {...def,pos:{x:4,y:4}}, 'ice');
ok('ICE move on fire ley IS discordant (fire beats ice)', Math.abs(d.mul-0.85)<1e-9, d.mul);

console.log('\n--- 4. THE CLAMP (the whole reason this is safe) ---');
let s4 = mk(); s4._leySeeded=true;
s4.board[0][0].ley={elem:'fire',power:99,owner:'player',held:9,idle:0};
d = L.damageMod(s4, atk, {...def,pos:{x:4,y:4}}, 'fire');
ok('power 99 cannot exceed CAP', d.mul<=1+L.LEY.CAP+1e-9, d.mul);
ok('power 99 clamps to POWER_MAX bonus (.50)', Math.abs(d.mul-1.50)<1e-9, d.mul);

console.log('\n--- 5. TERRITORY conversion (automatic, DotR) ---');
let s5 = mk(); s5._leySeeded=true;
const fireU={id:'f',name:'Inferno',owner:'player',alive:true,pos:{x:2,y:2},elements:['fire'],factions:[],currentHp:10,maxHp:10};
s5.units=[fireU];
L.tick(s5,null);
ok('neutral hex claimed at power 1', s5.board[2][2].ley?.elem==='fire' && s5.board[2][2].ley.power===1, JSON.stringify(s5.board[2][2].ley));
ok('claimed hex records owner', s5.board[2][2].ley.owner==='player');
L.tick(s5,null);
ok('entrenches to power 2 by standing', s5.board[2][2].ley.power===2);
L.tick(s5,null); L.tick(s5,null);
ok('entrench caps at POWER_MAX', s5.board[2][2].ley.power===L.LEY.POWER_MAX, s5.board[2][2].ley.power);

console.log('\n--- 6. CONTESTING dug-in ground ---');
const iceU={id:'i',name:'Frost',owner:'ai',alive:true,pos:{x:2,y:2},elements:['ice'],factions:[],currentHp:10,maxHp:10};
s5.units=[iceU];   // fire unit leaves, ice unit takes the tile
L.tick(s5,null); ok('grind 3 -> 2', s5.board[2][2].ley.power===2 && s5.board[2][2].ley.elem==='fire');
L.tick(s5,null); ok('grind 2 -> 1', s5.board[2][2].ley.power===1 && s5.board[2][2].ley.elem==='fire');
L.tick(s5,null); ok('grind 1 -> 0 FLIPS to ice p1', s5.board[2][2].ley.elem==='ice' && s5.board[2][2].ley.power===1, JSON.stringify(s5.board[2][2].ley));
ok('flipped hex changes owner', s5.board[2][2].ley.owner==='ai');

console.log('\n--- 7. DECAY of unheld ley ---');
let s7 = mk(); s7._leySeeded=true;
s7.board[1][1].ley={elem:'fire',power:2,owner:'player',held:0,idle:0};
for(let i=0;i<L.LEY.DECAY_TICKS;i++) L.tick(s7,null);
ok('decays a step after DECAY_TICKS', s7.board[1][1].ley.power===1, JSON.stringify(s7.board[1][1].ley));
for(let i=0;i<L.LEY.DECAY_TICKS;i++) L.tick(s7,null);
ok('decays to nothing and is REMOVED', !s7.board[1][1].ley, JSON.stringify(s7.board[1][1].ley));

console.log('\n--- 8. FACTION AFFINITY (tactics, never damage) ---');
let s8 = mk(); s8._leySeeded=true;
s8.board[0][0].ley={elem:'water',power:2,owner:null,held:0,idle:0};
s8.board[0][1].ley={elem:'metal',power:2,owner:null,held:0,idle:0};
const fish={name:'Merfolk',owner:'player',alive:true,pos:{x:0,y:0},elements:['water'],factions:['aquatic'],currentHp:5,maxHp:20};
const bot ={name:'Golem', owner:'player',alive:true,pos:{x:1,y:0},elements:['metal'],factions:['construct'],currentHp:20,maxHp:20};
ok('aquatic on water ley gets +1 MOV', L.moveBonus(s8,fish)===1);
ok('aquatic on METAL ley gets nothing', L.moveBonus(s8,{...fish,pos:{x:1,y:0}})===0);
ok('construct gets no MOV (ward faction)', L.moveBonus(s8,bot)===0);
d = L.damageMod(s8, atk, bot, 'fire');
ok('construct ward cuts incoming', d.warded===true && d.mul<1, d.mul);
ok('construct on metal ignores acid', L.ignoresHazard(s8,bot,'acid')===true);
ok('construct does NOT ignore fire',  L.ignoresHazard(s8,bot,'fire')===false);
ok('construct off home ley ignores nothing', L.ignoresHazard(s8,{...bot,pos:{x:4,y:4}},'acid')===false);

console.log('\n--- 9. REGEN affinity paid on tick ---');
let s9 = mk(); s9._leySeeded=true;
s9.board[0][0].ley={elem:'corruption',power:2,owner:'ai',held:0,idle:0};
const ghoul={name:'Ghoul',owner:'ai',alive:true,pos:{x:0,y:0},elements:['corruption'],factions:['undead'],currentHp:10,maxHp:30};
s9.units=[ghoul];
L.tick(s9,null);
ok('undead on corruption ley regens', ghoul.currentHp===10+L.LEY.PERK_REGEN, ghoul.currentHp);
ghoul.currentHp=29; L.tick(s9,null);
ok('regen never overheals', ghoul.currentHp===30, ghoul.currentHp);

console.log('\n--- 10. safety: unwired / absent state ---');
ok('null state survives tick', L.tick(null,null)===null);
ok('no board survives tick', (()=>{const o={units:[]};return L.tick(o,null)===o;})());
ok('damageMod with no pos is inert', L.damageMod(s8,{name:'x'},null,'fire').mul===1);
ok('flying unit does not convert', (()=>{
  const st=mk(); st._leySeeded=true;
  st.units=[{name:'bird',owner:'player',alive:true,flying:true,pos:{x:0,y:0},elements:['wind'],factions:[]}];
  L.tick(st,null); return !st.board[0][0].ley;
})());
ok('dead unit does not convert', (()=>{
  const st=mk(); st._leySeeded=true;
  st.units=[{name:'d',owner:'player',alive:false,pos:{x:0,y:0},elements:['fire'],factions:[]}];
  L.tick(st,null); return !st.board[0][0].ley;
})());
ok('wall tile is never claimed', (()=>{
  const st=mk(); st._leySeeded=true; st.board[0][0].wall={hp:5};
  st.units=[{name:'w',owner:'player',alive:true,pos:{x:0,y:0},elements:['fire'],factions:[]}];
  L.tick(st,null); return !st.board[0][0].ley;
})());


/* ── 11. every string literal in ley.js is a REAL id ────────────────────── */
console.log('\n--- 11. id validity against index.html ---');
{
  const s = fs.readFileSync(ROOT + 'public/index.html', 'utf8');
  const els = [...(s.match(/const ELEMENTS = \[(.*?)\];/s)[1].matchAll(/'([a-z]+)'/g))].map(m => m[1]);
  const facs = [...(s.match(/const FACTIONS = \[(.*?)\n\];/s)[1].matchAll(/\{ id: '([a-z]+)'/g))].map(m => m[1]);
  const terr = [...(s.match(/const _BME_TERRAIN = \{(.*?)\};/s)[1].matchAll(/([a-z]+):\{/g))].map(m => m[1]);
  const E = new Set(els), F = new Set(facs), T = new Set(terr);
  let bad = [];
  for (const [k, v] of Object.entries(L.EDITOR_SEED)) {
    if (!T.has(k)) bad.push('EDITOR_SEED key ' + k);
    if (v && !E.has(v.elem)) bad.push('EDITOR_SEED elem ' + v.elem);
  }
  for (const [k, v] of Object.entries(L.SURF_SEED)) if (v && !E.has(v.elem)) bad.push('SURF_SEED elem ' + v.elem);
  for (const [f, a] of Object.entries(L.AFFINITY)) {
    if (!F.has(f)) bad.push('AFFINITY faction ' + f);
    for (const h of a.home) if (!E.has(h)) bad.push('AFFINITY home ' + f + '->' + h);
    if (!['move', 'regen', 'ward', 'hazard'].includes(a.perk)) bad.push('AFFINITY perk ' + f + '->' + a.perk);
  }
  ok('every element / faction / terrain literal is real', bad.length === 0, bad.join(', '));
  // Every terrain key must be DECIDED — mapped to an element or explicitly null
  // (neutral). A key merely missing from the table also seeds neutral, but it
  // does so by accident, which is how a new paint silently stops mattering.
  const undecided = terr.filter(k => !(k in L.EDITOR_SEED));
  ok('all ' + terr.length + ' terrain keys explicitly decided', undecided.length === 0, undecided.join(', '));
}

/* ── 12. painted-map guard ──────────────────────────────────────────────── */
console.log('\n--- 12. painted-map seed-share guard ---');
{
  const N = 10;
  const build = fill => {
    const st = { board: Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => ({ x, y }))), units: [], log: [] };
    const t = new Array(N * N);
    for (let c = 0; c < N; c++) for (let r = 0; r < N; r++) t[c * N + r] = fill(c, r);
    L.seed(st, { terrain: t, cols: N, rows: N });
    return st;
  };
  ok('100% lava map knocked to power 1', build(() => 'lava').board[0][0].ley.power === 1);
  ok('40% lava map keeps power 2',       build(c => c < 4 ? 'lava' : 'road').board[0][0].ley.power === 2);
  const bal = build(c => ['lava', 'water', 'snow', 'grass'][c % 4]);
  let penalised = false;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const l = bal.board[y][x].ley;
    if (l && l.elem === 'lava' && l.power !== 2) penalised = true;
  }
  ok('balanced 4-element map NOT penalised', !penalised);
}

/* ── 13. the clamp survives a careless constant bump ────────────────────── */
console.log('\n--- 13. clamp integrity ---');
{
  const st = mk(); st._leySeeded = true;
  st.board[0][0].ley = { elem: 'fire', power: 3, owner: null, held: 0, idle: 0 };
  const a = { name: 'a', owner: 'player', pos: { x: 0, y: 0 }, elements: ['fire'], factions: [] };
  const d = { name: 'd', owner: 'ai', pos: { x: 4, y: 4 }, elements: ['nature'], factions: [] };
  const before = L.damageMod(st, a, d, 'fire').mul;
  ok('power 3 attuned = +50%', Math.abs(before - 1.5) < 1e-9, before);
  const keepA = L.LEY.ATTUNE_ATK, keepD = L.LEY.ATTUNE_DEF, keepW = L.LEY.PERK_WARD;
  L.LEY.ATTUNE_ATK = [0, 9, 9, 9]; L.LEY.ATTUNE_DEF = [0, 9, 9, 9]; L.LEY.PERK_WARD = 9;
  const blown = L.damageMod(st, a, d, 'fire').mul;
  ok('a +900% bump still cannot exceed CAP', blown <= 1 + L.LEY.CAP + 1e-9, blown);
  L.LEY.ATTUNE_ATK = keepA; L.LEY.ATTUNE_DEF = keepD; L.LEY.PERK_WARD = keepW;
}

console.log('\n' + (fails ? '❌ ' + fails + ' FAILED' : '✅ ALL PASS'));
process.exit(fails ? 1 : 0);
