/* ═══════════════════════════════════════════════════════════════════════════
   mapforge.actors.js — ACTOR BLUEPRINTS: components + an event graph on any
   placed object, the way an Unreal Actor carries components and a Blueprint.

   Document (objects[].bp):
     { vars:  { name: { type, value } },
       comps: [ { type: 'trigger', r: 3 }, { type: 'light', c, i, d }, { type: 'spin', speed },
                { type: 'bob', amp, speed }, { type: 'tag', v } ],
       graph: { nodes: [{ id, type, x, y, props }], links: [{ from: { n, pin }, to: { n } }] } }

   Runtime (createActors): one actor per object with a graph or components.
   Events fire from the world (Begin Play, Tick, the player entering/leaving a
   trigger radius, pressing E inside it); actions are tweens on transforms,
   visibility, tint, animation, effects, spawning a prefab/prop, destroying,
   toasts, variables, calls into the game. Nothing here is an `eval`: the
   expression language is the widgets' fixed-grammar parser, imported — one
   language for widgets AND actors, so `{$hp} > 0` means the same everywhere.

   Runs only while PLAYING (editor Play mode, engine.mount, a game overlay).
   In edit mode a blueprint is data; start() snapshots every transform and
   stop() puts them back, so a test run never dirties the map.
   ═══════════════════════════════════════════════════════════════════════════ */

import { interpolate, evalExpr, truthy } from '../widgets/widgets.format.js';
import { PHYSICS_FIELDS, PHYSICS_ENUMS } from './mapforge.physics.js';

export const COMPONENTS = {
  trigger: { label: 'Trigger volume', icon: '⭕', fields: { r: 3 },                    help: 'A radius around the actor. Fires On Enter / On Exit / On Interact for the player.' },
  light:   { label: 'Point light',    icon: '💡', fields: { c: '#ffd27a', i: 1.2, d: 12 }, help: 'Colour, intensity, distance. Eight lights are budgeted per W().' },
  spin:    { label: 'Rotating',       icon: '🔄', fields: { speed: 45 },                help: 'Degrees per second around Y, always on.' },
  bob:     { label: 'Floating',       icon: '〰', fields: { amp: 0.3, speed: 1 },        help: 'Bobs up and down: amplitude in metres, cycles per second.' },
  tag:     { label: 'Tag',            icon: '🏷', fields: { v: '' },                     help: 'A label the game can query: W().actors.withTag("loot").' },
  physics: { label: 'Physics body',   icon: '🎳', fields: PHYSICS_FIELDS, enums: PHYSICS_ENUMS, help: 'Dynamic: mass, gravity, collides with everything (cannon-es). Kinematic: moved by the graph, pushes dynamic bodies. Shape fits the object\'s bounds.' },
  agent:   { label: 'Nav agent',      icon: '🧭', fields: { speed: 2.5, turn: 8, stop: 0.8 }, help: 'Walks the navmesh: Move To, Chase, Patrol, Wander. speed m/s, turn = how fast it faces its heading, stop = arrival distance.' },
};

export const ACTOR_NODES = {
  ev_begin:    { cat: 'Events',  label: 'Begin Play',      color: '#b8404a', outs: ['then'], help: 'Fires once when play starts.' },
  ev_tick:     { cat: 'Events',  label: 'On Tick',         color: '#b8404a', outs: ['then'], props: { ms: 1000 } },
  ev_enter:    { cat: 'Events',  label: 'On Enter',        color: '#b8404a', outs: ['then'], help: 'The player enters the Trigger volume.' },
  ev_exit:     { cat: 'Events',  label: 'On Exit',         color: '#b8404a', outs: ['then'] },
  ev_interact: { cat: 'Events',  label: 'On Interact (E)', color: '#b8404a', outs: ['then'], props: { prompt: 'Press E' }, help: 'The player presses E inside the Trigger volume.' },
  ev_hit:      { cat: 'Events',  label: 'On Hit',          color: '#b8404a', outs: ['then'], props: { with: '', minImpact: 1 }, help: 'This Physics body collides. `with`: empty = anything, player, ground, an object name or a tag. minImpact filters soft touches (m/s).' },
  ev_see:      { cat: 'Events',  label: 'On See',          color: '#b8404a', outs: ['then'], props: { target: 'player', range: 10, fov: 140 }, help: 'The target comes into view: within range and inside the field of view (degrees) in front of this actor. Fires once per sighting.' },
  toast:       { cat: 'Actions', label: 'Toast',           color: '#3a6ea8', ins: true, outs: ['then'], props: { message: 'Hello', ms: 3000 } },
  setvar:      { cat: 'Actions', label: 'Set variable',    color: '#3a6ea8', ins: true, outs: ['then'], props: { var: '', value: '' }, help: 'value is an expression: {$count} + 1' },
  branch:      { cat: 'Flow',    label: 'Branch',          color: '#8a8a8a', ins: true, outs: ['true', 'false'], props: { cond: '{$count} > 0' } },
  sequence:    { cat: 'Flow',    label: 'Sequence',        color: '#8a8a8a', ins: true, outs: ['then 0', 'then 1', 'then 2'] },
  delay:       { cat: 'Flow',    label: 'Delay',           color: '#8a8a8a', ins: true, outs: ['then'], props: { ms: 500 } },
  move:        { cat: 'Transform', label: 'Move',          color: '#4a8a5a', ins: true, outs: ['then'], props: { target: 'self', x: 0, y: 0, z: 0, secs: 1, relative: 'true' }, help: 'Offsets in metres (relative) or a position (absolute), over seconds (0 = instant).' },
  rotate:      { cat: 'Transform', label: 'Rotate',        color: '#4a8a5a', ins: true, outs: ['then'], props: { target: 'self', deg: 90, secs: 1 }, help: 'Turn around Y by degrees over seconds.' },
  scale:       { cat: 'Transform', label: 'Scale',         color: '#4a8a5a', ins: true, outs: ['then'], props: { target: 'self', factor: 1.5, secs: 0.5 } },
  spin:        { cat: 'Transform', label: 'Spin on/off',   color: '#4a8a5a', ins: true, outs: ['then'], props: { target: 'self', speed: 90, on: 'true' } },
  visible:     { cat: 'Look',    label: 'Set visible',     color: '#7a5aa8', ins: true, outs: ['then'], props: { target: 'self', visible: 'true' } },
  tint:        { cat: 'Look',    label: 'Set tint',        color: '#7a5aa8', ins: true, outs: ['then'], props: { target: 'self', color: '#ff4040' } },
  anim:        { cat: 'Look',    label: 'Play animation',  color: '#7a5aa8', ins: true, outs: ['then'], props: { target: 'self', clip: '', speed: 1, loop: 'repeat' } },
  fx:          { cat: 'Look',    label: 'Effect on/off',   color: '#7a5aa8', ins: true, outs: ['then'], props: { target: 'self', on: 'true' } },
  light:       { cat: 'Look',    label: 'Light on/off',    color: '#7a5aa8', ins: true, outs: ['then'], props: { target: 'self', on: 'true' } },
  spawn:       { cat: 'World',   label: 'Spawn',           color: '#a8763a', ins: true, outs: ['then'], props: { what: 'crate', x: 0, y: 0, z: 2, name: '' }, help: 'A prop id or a prefab name, at an offset from this actor.' },
  destroy:     { cat: 'World',   label: 'Destroy',         color: '#a8763a', ins: true, outs: ['then'], props: { target: 'self' } },
  teleport:    { cat: 'World',   label: 'Teleport player', color: '#a8763a', ins: true, outs: ['then'], props: { x: 0, z: 0 } },
  impulse:     { cat: 'Physics', label: 'Impulse',         color: '#c2451c', ins: true, outs: ['then'], props: { target: 'self', x: 0, y: 4, z: 6, local: 'true' }, help: 'A kick (N·s) on a Physics body; local = in the body\'s own frame (z forward).' },
  velocity:    { cat: 'Physics', label: 'Set velocity',    color: '#c2451c', ins: true, outs: ['then'], props: { target: 'self', x: 0, y: 0, z: 0 } },
  bodykind:    { cat: 'Physics', label: 'Set body kind',   color: '#c2451c', ins: true, outs: ['then'], props: { target: 'self', kind: 'dynamic' }, help: 'dynamic (falls), kinematic (graph-driven, pushes), static (frozen).' },
  moveto:      { cat: 'AI',      label: 'Move To',         color: '#2f8f8f', ins: true, outs: ['then', 'arrived', 'failed'], props: { target: 'player', x: '', z: '' }, help: 'Walk the navmesh to a target (player / object name) or to x,z. then = at once; arrived / failed = later.' },
  chase:       { cat: 'AI',      label: 'Chase',           color: '#2f8f8f', ins: true, outs: ['then', 'caught', 'lost'], props: { target: 'player', range: 12, reach: 1.5 }, help: 'Keep re-pathing toward the target while it is within range; caught when within reach, lost when it leaves range.' },
  patrol:      { cat: 'AI',      label: 'Patrol',          color: '#2f8f8f', ins: true, outs: ['then', 'arrived'], props: { points: '', wait: 1, loop: 'true' }, help: 'Walk a list of waypoint names ("wp1, wp2") or every waypoint in a folder ("folder:Route"). arrived fires at each point.' },
  wander:      { cat: 'AI',      label: 'Wander',          color: '#2f8f8f', ins: true, outs: ['then'], props: { radius: 6, wait: 2 }, help: 'Random walkable points around where it started.' },
  stopmove:    { cat: 'AI',      label: 'Stop moving',     color: '#2f8f8f', ins: true, outs: ['then'], props: { target: 'self' } },
  lookat:      { cat: 'AI',      label: 'Look at',         color: '#2f8f8f', ins: true, outs: ['then'], props: { target: 'player' } },
  call:        { cat: 'Actions', label: 'Call game action', color: '#3a6ea8', ins: true, outs: ['then'], props: { action: '', args: '' } },
  log:         { cat: 'Actions', label: 'Print',           color: '#3a6ea8', ins: true, outs: ['then'], props: { message: '' } },
};

function uid(p) { return (p || 'g') + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); }
function num(v, d) { v = Number(v); return Number.isFinite(v) ? v : d; }
const HEX = /^#[0-9a-f]{6}$/i;

/* ── document ── */
export function newGraphNode(type, x, y) { const G = ACTOR_NODES[type] || ACTOR_NODES.log; return { id: uid('g_'), type: ACTOR_NODES[type] ? type : 'log', x: x || 40, y: y || 40, props: Object.assign({}, G.props || {}) }; }
export function newBlueprint() { return { vars: {}, comps: [], graph: { nodes: [Object.assign(newGraphNode('ev_begin'), { x: 40, y: 40 })], links: [] } }; }
export function normalizeBp(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const bp = { vars: {}, comps: [], graph: { nodes: [], links: [] } };
  Object.keys(raw.vars || {}).slice(0, 100).forEach(k => { const key = String(k).replace(/[^A-Za-z0-9_]/g, '').slice(0, 40); const v = raw.vars[k]; if (!key || !v || typeof v !== 'object') return; bp.vars[key] = { type: ['number', 'string', 'bool'].includes(v.type) ? v.type : 'string', value: v.value }; });
  (Array.isArray(raw.comps) ? raw.comps : []).slice(0, 20).forEach(c => {
    if (!c || !COMPONENTS[c.type]) return;
    const out = { type: c.type }; const F = COMPONENTS[c.type].fields;
    const E = COMPONENTS[c.type].enums || {};
    Object.keys(F).forEach(k => { const d = F[k]; out[k] = typeof d === 'number' ? num(c[k], d) : E[k] ? (E[k].includes(c[k]) ? c[k] : d) : (k === 'c' ? (HEX.test(String(c[k] || '')) ? String(c[k]).toLowerCase() : d) : String(c[k] == null ? d : c[k]).slice(0, 60)); });
    bp.comps.push(out);
  });
  const g = raw.graph || {}; const ids = new Set();
  bp.graph.nodes = (Array.isArray(g.nodes) ? g.nodes : []).map(n => { if (!n || !ACTOR_NODES[n.type]) return null; const id = String(n.id || uid('g_')); if (ids.has(id)) return null; ids.add(id); const props = {}; Object.keys(n.props || {}).slice(0, 30).forEach(k => { const v = n.props[k]; props[String(k).slice(0, 30)] = typeof v === 'number' || typeof v === 'boolean' ? v : String(v == null ? '' : v).slice(0, 1000); }); return { id, type: n.type, x: num(n.x, 0), y: num(n.y, 0), props: Object.assign({}, ACTOR_NODES[n.type].props || {}, props) }; }).filter(Boolean).slice(0, 300);
  bp.graph.links = (Array.isArray(g.links) ? g.links : []).map(l => l && l.from && l.to && ids.has(l.from.n) && ids.has(l.to.n) ? { from: { n: String(l.from.n), pin: String(l.from.pin || 'then').slice(0, 20) }, to: { n: String(l.to.n) } } : null).filter(Boolean).slice(0, 600);
  if (!bp.comps.length && !bp.graph.nodes.length && !Object.keys(bp.vars).length) return undefined;
  return bp;
}
export function hasBehaviour(o) { return !!(o && o.bp && (o.bp.comps.length || o.bp.graph.nodes.length)); }
export function comp(o, type) { return (o && o.bp && o.bp.comps.find(c => c.type === type)) || null; }

/* ── runtime ──
   host = { THREE, map, world, player? (pos, setPos?), actions?, toast?, onPrompt? } */
export function createActors(host) {
  const THREE = host.THREE;
  const W = () => host.world;      // read lazily: the world builds its api AFTER creating the actors
  const actors = new Map();        // objectId → actor
  let running = false, time = 0, lastInteract = false, promptShown = null;
  const tweens = [];
  const timers = [];
  const snapshot = new Map();      // objectId → { p, r, s, visible }
  const toast = (m, ms) => { try { if (host.toast) return host.toast(m, ms); const b = window.MythicBridge; if (b && b.toast) b.toast(m, ms); } catch (e) {} };

  function resolveTarget(actor, name) {
    name = String(name == null ? 'self' : name).trim() || 'self';
    if (name === 'self') return actor.id;
    if (name.startsWith('self.')) return actor.id + ':' + name.slice(5);
    if (name === 'player') return null;
    const byName = host.map.objects.find(o => o.n === name || o.id === name);
    if (byName) return byName.id;
    if (name.includes('.')) { const [a, b] = name.split('.'); const p = host.map.objects.find(o => o.n === a); if (p) return p.id + ':' + b; }
    return null;
  }
  const rootOf = (id) => { const w = W(); return w ? (w.objects.get(id) || (w.parts && w.parts.get(id)) || null) : null; };
  const docOf = (id) => host.map.objects.find(o => o.id === id) || null;

  function scopeFor(actor) {
    let data = {};
    try { const b = window.MythicBridge; if (b && b.ui && b.ui.data) data = b.ui.data() || {}; } catch (e) {}
    data.time = time; data.player = host.player ? { x: host.player.pos.x, y: host.player.pos.y, z: host.player.pos.z } : null;
    const r = rootOf(actor.id); if (r) data.self = { x: r.position.x, y: r.position.y, z: r.position.z, name: actor.o.n || '' };
    if (host.player && r) data.dist = Math.hypot(host.player.pos.x - r.position.x, host.player.pos.z - r.position.z);
    if (actor.lastHit) data.hit = { other: actor.lastHit.other, impact: actor.lastHit.impact };
    data.agent = { moving: !!actor.nav, mode: actor.nav ? actor.nav.mode : '' };
    return { data, vars: actor.vars };
  }
  function makeActor(o) {
    const a = { id: o.id, o, vars: {}, inside: false, spin: null, bobT: Math.random() * 6, light: null, nav: null, seen: {}, home: null };
    Object.keys(o.bp.vars || {}).forEach(k => { a.vars[k] = { type: o.bp.vars[k].type, value: o.bp.vars[k].value }; });
    const sp = comp(o, 'spin'); if (sp) a.spin = sp.speed;
    const li = comp(o, 'light'); const root = rootOf(o.id);
    if (li && root && THREE) { const L = new THREE.PointLight(new THREE.Color(li.c), li.i, li.d, 2); L.position.y = 1; L.name = 'mf-actor-light'; root.add(L); a.light = L; }
    return a;
  }
  function next(actor, n, pin) { return actor.o.bp.graph.links.filter(l => l.from.n === n.id && l.from.pin === pin).map(l => actor.o.bp.graph.nodes.find(x => x.id === l.to.n)).filter(Boolean); }
  function fire(actor, type) { if (!running) return; actor.o.bp.graph.nodes.filter(n => n.type === type).forEach(n => run(actor, n, 0)); }
  function tween(obj, secs, apply, done) {
    if (!(secs > 0)) { apply(1); if (done) done(); return; }
    tweens.push({ t: 0, secs, apply, done });
  }
  function run(actor, n, depth) {
    if (!running || !n || depth > 300) return;
    const P = (k) => interpolate(n.props[k], scopeFor(actor));
    const N = (k, d) => num(P(k), d);
    const cont = (pin) => next(actor, n, pin).forEach(m => run(actor, m, depth + 1));
    const targetRoot = () => { const id = resolveTarget(actor, n.props.target); return id ? rootOf(id) : null; };
    try {
      switch (n.type) {
        case 'ev_begin': case 'ev_tick': case 'ev_enter': case 'ev_exit': case 'ev_interact': cont('then'); break;
        case 'toast': toast(String(P('message') == null ? '' : P('message')), N('ms', 3000)); cont('then'); break;
        case 'setvar': { const k = String(n.props.var || '').trim(); if (k) { const v = evalExpr(n.props.value, scopeFor(actor)); if (!actor.vars[k]) actor.vars[k] = { type: 'string', value: v }; const t = actor.vars[k].type; actor.vars[k].value = t === 'number' ? (Number(v) || 0) : t === 'bool' ? truthy(v) : v; } cont('then'); break; }
        case 'branch': cont(truthy(evalExpr(n.props.cond, scopeFor(actor))) ? 'true' : 'false'); break;
        case 'sequence': cont('then 0'); cont('then 1'); cont('then 2'); break;
        case 'delay': { const t = setTimeout(() => { if (running) cont('then'); }, Math.max(0, N('ms', 500))); timers.push(t); break; }
        case 'move': { const r = targetRoot(); if (r) { const rel = truthy(P('relative')); const from = r.position.clone(); const to = rel ? from.clone().add(new THREE.Vector3(N('x', 0), N('y', 0), N('z', 0))) : new THREE.Vector3(N('x', 0), N('y', 0), N('z', 0)); tween(r, N('secs', 1), (k) => { r.position.lerpVectors(from, to, ease(k)); }, () => { W().updateCollider && W().updateCollider(actor.id); cont('then'); }); } else cont('then'); break; }
        case 'rotate': { const r = targetRoot(); if (r) { const from = r.rotation.y, to = from + N('deg', 90) * Math.PI / 180; tween(r, N('secs', 1), (k) => { r.rotation.y = from + (to - from) * ease(k); }, () => cont('then')); } else cont('then'); break; }
        case 'scale': { const r = targetRoot(); if (r) { const from = r.scale.clone(), to = from.clone().multiplyScalar(Math.max(0.01, N('factor', 1))); tween(r, N('secs', 0.5), (k) => { r.scale.lerpVectors(from, to, ease(k)); }, () => cont('then')); } else cont('then'); break; }
        case 'spin': { const id = resolveTarget(actor, n.props.target); const a = id && actors.get(id); if (a) a.spin = truthy(P('on')) ? N('speed', 90) : null; else { const r = id && rootOf(id); if (r) extraSpin.set(id, truthy(P('on')) ? N('speed', 90) : null); } cont('then'); break; }
        case 'visible': { const r = targetRoot(); if (r) r.visible = truthy(P('visible')); cont('then'); break; }
        case 'tint': { const id = resolveTarget(actor, n.props.target); const d = id && docOf(id); const c = String(P('color') || ''); if (d && HEX.test(c)) { d.c = c.toLowerCase(); W().refreshObject(d); } cont('then'); break; }
        case 'anim': { const id = resolveTarget(actor, n.props.target); if (id && W().setAnim) W().setAnim(id, n.props.clip ? { clip: String(P('clip')), speed: N('speed', 1), loop: String(P('loop') || 'repeat') } : null); cont('then'); break; }
        case 'fx': { const id = resolveTarget(actor, n.props.target); const d = id && docOf(id); if (d) { d.fx = Object.assign({}, d.fx || { i: 1, s: 1 }); if (truthy(P('on'))) delete d.fx.off; else d.fx.off = true; W().refreshFx && W().refreshFx(id); } cont('then'); break; }
        case 'light': { const id = resolveTarget(actor, n.props.target); const a = id && actors.get(id); if (a && a.light) a.light.visible = truthy(P('on')); cont('then'); break; }
        case 'spawn': { const r = rootOf(actor.id); if (r && host.spawn) { const what = String(P('what') || '').trim(); const off = new THREE.Vector3(N('x', 0), N('y', 0), N('z', 2)).applyAxisAngle(new THREE.Vector3(0, 1, 0), r.rotation.y); host.spawn(what, [r.position.x + off.x, r.position.y + off.y, r.position.z + off.z], String(P('name') || '')); } cont('then'); break; }
        case 'destroy': { const id = resolveTarget(actor, n.props.target); if (id && host.destroy) host.destroy(id); if (id !== actor.id) cont('then'); break; }
        case 'teleport': { if (host.player && host.player.setPos) host.player.setPos(N('x', 0), N('z', 0)); cont('then'); break; }
        case 'impulse': { const ph = W().physics; const id = resolveTarget(actor, n.props.target); if (ph && id) { if (!ph.impulse(id, [N('x', 0), N('y', 0), N('z', 0)], truthy(P('local')))) toast('Impulse: "' + (n.props.target || 'self') + '" has no Physics body.', 2600); } cont('then'); break; }
        case 'velocity': { const ph = W().physics; const id = resolveTarget(actor, n.props.target); if (ph && id) ph.setVelocity(id, [N('x', 0), N('y', 0), N('z', 0)]); cont('then'); break; }
        case 'bodykind': { const ph = W().physics; const id = resolveTarget(actor, n.props.target); if (ph && id) ph.setKind(id, String(P('kind') || 'dynamic')); cont('then'); break; }
        case 'moveto': { const tgt = navTarget(actor, n); if (!tgt) { cont('then'); cont('failed'); break; } navGo(actor, tgt, { mode: 'moveto', onArrive: () => cont('arrived'), onFail: () => cont('failed') }); cont('then'); break; }
        case 'chase': { navGo(actor, null, { mode: 'chase', target: String(n.props.target || 'player'), range: N('range', 12), reach: N('reach', 1.5), onCaught: () => cont('caught'), onLost: () => cont('lost') }); cont('then'); break; }
        case 'patrol': { const pts = patrolPoints(actor, String(n.props.points || '')); if (!pts.length) { toast('Patrol: no waypoints found for "' + n.props.points + '".', 2600); cont('then'); break; } navGo(actor, null, { mode: 'patrol', points: pts, i: 0, wait: N('wait', 1), loop: truthy(P('loop')), onArrive: () => cont('arrived') }); cont('then'); break; }
        case 'wander': { navGo(actor, null, { mode: 'wander', radius: N('radius', 6), wait: N('wait', 2) }); cont('then'); break; }
        case 'stopmove': { const id = resolveTarget(actor, n.props.target); const a = id && actors.get(id); if (a) a.nav = null; cont('then'); break; }
        case 'lookat': { const r = rootOf(actor.id); const p = pointOf(actor, String(n.props.target || 'player')); if (r && p) r.rotation.y = Math.atan2(p[0] - r.position.x, p[1] - r.position.z); cont('then'); break; }
        case 'call': { const name = String(n.props.action || '').trim(); let fn = host.actions && host.actions[name]; if (!fn) { try { const b = window.MythicBridge; fn = b && b.ui && b.ui.actions && b.ui.actions[name]; } catch (e) {} } const args = String(n.props.args || '').split(',').map(s => s.trim()).filter(Boolean).map(a => evalExpr(a, scopeFor(actor))); if (typeof fn === 'function') { try { fn.apply(null, args); } catch (e) {} } else toast('Actor: no game action named "' + name + '".', 2600); cont('then'); break; }
        case 'log': try { console.log('[actor ' + (actor.o.n || actor.id) + ']', P('message')); } catch (e) {} cont('then'); break;
        default: cont('then');
      }
    } catch (e) { try { console.warn('[actors] node failed', n.type, e); } catch (x) {} }
  }
  const extraSpin = new Map();
  /* ── navigation (mapforge.nav.js through the world) ── */
  const navOf = () => { const w = W(); return w && w.nav ? w.nav : null; };
  function pointOf(actor, name) {
    name = String(name || '').trim();
    if (name === 'player') return host.player ? [host.player.pos.x, host.player.pos.z] : null;
    const id = resolveTarget(actor, name); const r = id && rootOf(id); if (r) return [r.position.x, r.position.z];
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(name); if (m) return [+m[1], +m[2]];
    return null;
  }
  function navTarget(actor, n) {
    const xs = String(n.props.x == null ? '' : interpolate(n.props.x, scopeFor(actor))).trim(), zs = String(n.props.z == null ? '' : interpolate(n.props.z, scopeFor(actor))).trim();
    if (xs !== '' && zs !== '' && Number.isFinite(+xs) && Number.isFinite(+zs)) return [+xs, +zs];
    return pointOf(actor, interpolate(n.props.target, scopeFor(actor)));
  }
  function patrolPoints(actor, spec) {
    const w = W(); if (!w) return [];
    if (/^folder:/i.test(spec)) { const name = spec.slice(7).trim(); return w.inFolder(name).filter(o => o.t === 'waypoint' || o.n).map(o => [o.p[0], o.p[2]]); }
    return spec.split(',').map(s => s.trim()).filter(Boolean).map(nm => pointOf(actor, nm)).filter(Boolean);
  }
  function navGo(actor, point, st) {
    const nav = navOf(); if (!nav) { if (st.onFail) st.onFail(); return; }
    const r = rootOf(actor.id); if (!r) return;
    const c = comp(actor.o, 'agent') || { speed: 2.5, turn: 8, stop: 0.8 };
    actor.nav = Object.assign({ path: null, idx: 0, speed: c.speed, turn: c.turn, stopDist: c.stop, repath: 0, waitT: 0, goal: point, stuck: 0 }, st);
    if (!actor.home) actor.home = [r.position.x, r.position.z];
    if (point) { actor.nav.path = nav.findPath([r.position.x, r.position.z], point); actor.nav.idx = 1; if (!actor.nav.path) { actor.nav = null; if (st.onFail) st.onFail(); } }
  }
  /* one agent, one frame: pick / refresh the goal per mode, then walk the path */
  function navStep(actor, dt) {
    const nv = actor.nav; const r = rootOf(actor.id); const nav = navOf(); if (!nv || !r || !nav) return;
    const here = [r.position.x, r.position.z];
    if (nv.waitT > 0) { nv.waitT -= dt; return; }
    if (nv.mode === 'chase') {
      const p = pointOf(actor, nv.target); if (!p) { actor.nav = null; if (nv.onLost) nv.onLost(); return; }
      const d = Math.hypot(p[0] - here[0], p[1] - here[1]);
      if (d > nv.range) { actor.nav = null; if (nv.onLost) nv.onLost(); return; }
      if (d <= nv.reach) { actor.nav = null; if (nv.onCaught) nv.onCaught(); return; }
      nv.repath -= dt; if (nv.repath <= 0 || !nv.path) { nv.repath = 0.4; nv.path = nav.findPath(here, p); nv.idx = 1; nv.goal = p; if (!nv.path) { actor.nav = null; if (nv.onLost) nv.onLost(); return; } }
    } else if (nv.mode === 'patrol' && !nv.path) {
      if (nv.i >= nv.points.length) { if (!nv.loop) { actor.nav = null; return; } nv.i = 0; }
      nv.goal = nv.points[nv.i]; nv.path = nav.findPath(here, nv.goal); nv.idx = 1; if (!nv.path) { nv.i++; nv.waitT = 0.2; return; }
    } else if (nv.mode === 'wander' && !nv.path) {
      for (let tries = 0; tries < 6 && !nv.path; tries++) { const a = Math.random() * Math.PI * 2, d = Math.random() * nv.radius; const g = nav.nearestWalkable(actor.home[0] + Math.cos(a) * d, actor.home[1] + Math.sin(a) * d, 3); if (g) { nv.goal = g; nv.path = nav.findPath(here, g); nv.idx = 1; } }
      if (!nv.path) { nv.waitT = 1; return; }
    }
    if (!nv.path) return;
    const wp = nv.path[Math.min(nv.idx, nv.path.length - 1)];
    const dx = wp.x - here[0], dz = wp.z - here[1], d = Math.hypot(dx, dz);
    const last = nv.idx >= nv.path.length - 1;
    if (d < (last ? nv.stopDist : 0.25)) {
      if (!last) { nv.idx++; return; }
      nv.path = null;
      if (nv.mode === 'moveto') { actor.nav = null; if (nv.onArrive) nv.onArrive(); }
      else if (nv.mode === 'patrol') { nv.i++; nv.waitT = nv.wait; if (nv.onArrive) nv.onArrive(); }
      else if (nv.mode === 'wander') nv.waitT = nv.wait;
      return;
    }
    const stepLen = Math.min(d, nv.speed * dt);
    let nx = here[0] + dx / d * stepLen, nz = here[1] + dz / d * stepLen;
    const w = W(); if (w.resolveMove) { const rr = w.resolveMove(here[0], here[1], nx, nz, r.position.y, 1.7, 0.3, actor.id); nx = rr.x; nz = rr.z; if (rr.blocked) { nv.stuck += dt; if (nv.stuck > 1.5) { nv.stuck = 0; nv.path = nav.findPath(here, nv.goal || [wp.x, wp.z]); nv.idx = 1; if (!nv.path) { const cb = nv.onFail; actor.nav = null; if (cb) cb(); return; } } } else nv.stuck = 0; }
    r.position.x = nx; r.position.z = nz;
    r.position.y = w.groundAt ? w.groundAt(nx, nz, r.position.y, actor.id) : w.heightAt(nx, nz);
    if (w.updateCollider) w.updateCollider(actor.id);   // its collider travels with it (the player and other agents are blocked by it)
    const want = Math.atan2(dx, dz); let diff = want - r.rotation.y; while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2;
    r.rotation.y += diff * Math.min(1, nv.turn * dt);
  }
  function seeStep(actor) {
    const nodes = actor.o.bp.graph.nodes.filter(n => n.type === 'ev_see'); if (!nodes.length) return;
    const r = rootOf(actor.id); if (!r) return;
    nodes.forEach(n => {
      const p = pointOf(actor, n.props.target || 'player'); const key = n.id;
      let vis = false;
      if (p) { const dx = p[0] - r.position.x, dz = p[1] - r.position.z, d = Math.hypot(dx, dz); if (d <= num(n.props.range, 10)) { const ang = Math.atan2(dx, dz); let diff = ang - r.rotation.y; while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2; vis = Math.abs(diff) <= (num(n.props.fov, 140) / 2) * Math.PI / 180; } }
      if (vis && !actor.seen[key]) { actor.seen[key] = true; run(actor, n, 0); } else if (!vis) actor.seen[key] = false;
    });
  }
  const ease = (k) => k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;

  const api = {
    actors, get running() { return running; },
    start() {
      if (running) return; running = true; time = 0;
      snapshot.clear(); actors.clear(); tweens.length = 0;
      host.map.objects.forEach(o => { if (!hasBehaviour(o)) return; const r = rootOf(o.id); if (!r) return; snapshot.set(o.id, { p: r.position.clone(), r: r.rotation.clone(), s: r.scale.clone(), visible: r.visible, c: o.c, fx: o.fx ? Object.assign({}, o.fx) : undefined }); actors.set(o.id, makeActor(o)); });
      actors.forEach(a => fire(a, 'ev_begin'));
      actors.forEach(a => a.o.bp.graph.nodes.filter(n => n.type === 'ev_tick').forEach(n => { const ms = Math.max(50, num(n.props.ms, 1000)); const t = setInterval(() => { if (running) run(a, n, 0); }, ms); timers.push(t); }));
    },
    stop() {
      if (!running) return; running = false;
      timers.forEach(t => { clearTimeout(t); clearInterval(t); }); timers.length = 0; tweens.length = 0; extraSpin.clear();
      actors.forEach(a => { if (a.light && a.light.parent) a.light.parent.remove(a.light); });
      snapshot.forEach((s, id) => { const r = rootOf(id); const o = docOf(id); if (!r) return; r.position.copy(s.p); r.rotation.copy(s.r); r.scale.copy(s.s); r.visible = s.visible; if (o) { if (s.c !== o.c) { o.c = s.c; W().refreshObject(o); } if (JSON.stringify(s.fx) !== JSON.stringify(o.fx)) { o.fx = s.fx; W().refreshFx && W().refreshFx(id); } } });
      snapshot.clear(); actors.clear(); if (host.onPrompt) host.onPrompt(null); promptShown = null;
    },
    /* the world calls this every frame while playing; `interact` is true on the frame E is pressed */
    update(dt, interact) {
      if (!running) return; time += dt;
      for (let i = tweens.length - 1; i >= 0; i--) { const t = tweens[i]; t.t += dt; const k = Math.min(1, t.t / t.secs); t.apply(k); if (k >= 1) { tweens.splice(i, 1); if (t.done) t.done(); } }
      let prompt = null;
      // physics contacts → On Hit (the world steps physics before this update)
      const ph = W().physics;
      if (ph && ph.running) {
        const hitList = ph.drainHits();
        if (hitList.length) hitList.forEach(h => {
          const a = actors.get(h.id); if (!a) return;
          a.o.bp.graph.nodes.filter(n => n.type === 'ev_hit').forEach(n => {
            if (h.impact < num(n.props.minImpact, 1)) return;
            const want = String(n.props.with || '').trim();
            if (want) { const other = host.map.objects.find(o => o.id === h.other); const tag = other && comp(other, 'tag'); if (!(want === h.other || (other && other.n === want) || (tag && tag.v === want))) return; }
            a.lastHit = h; run(a, n, 0);
          });
        });
      }
      actors.forEach(a => {
        const r = rootOf(a.id); if (!r) return;
        if (a.spin != null) r.rotation.y += a.spin * Math.PI / 180 * dt;
        if (a.nav) navStep(a, dt);
        seeStep(a);
        const bob = comp(a.o, 'bob'); if (bob) { a.bobT += dt * bob.speed * Math.PI * 2; const base = snapshot.get(a.id); if (base) r.position.y = base.p.y + Math.sin(a.bobT) * bob.amp; }
        const tr = comp(a.o, 'trigger');
        if (tr && host.player) {
          const d = Math.hypot(host.player.pos.x - r.position.x, host.player.pos.z - r.position.z);
          const inside = d <= tr.r * Math.max(r.scale.x, 0.01);
          if (inside && !a.inside) { a.inside = true; fire(a, 'ev_enter'); }
          else if (!inside && a.inside) { a.inside = false; fire(a, 'ev_exit'); }
          if (inside) { const ev = a.o.bp.graph.nodes.find(n => n.type === 'ev_interact'); if (ev) { prompt = prompt || String(ev.props.prompt || 'Press E'); if (interact && !lastInteract) fire(a, 'ev_interact'); } }
        }
      });
      extraSpin.forEach((sp, id) => { const r = rootOf(id); if (r && sp != null) r.rotation.y += sp * Math.PI / 180 * dt; });
      lastInteract = !!interact;
      if (prompt !== promptShown) { promptShown = prompt; if (host.onPrompt) host.onPrompt(prompt); }
    },
    withTag(tag) { return host.map.objects.filter(o => { const t = comp(o, 'tag'); return t && t.v === tag; }); },
    fire(id, type) { const a = actors.get(id); if (a) fire(a, type); },
    vars(id) { const a = actors.get(id); return a ? a.vars : null; },
    /* a new object placed at runtime (Spawn) joins the running set */
    adopt(o) { if (!running || !hasBehaviour(o)) return; const r = rootOf(o.id); if (!r) return; if (W().physics) W().physics.adopt(o); snapshot.set(o.id, { p: r.position.clone(), r: r.rotation.clone(), s: r.scale.clone(), visible: r.visible, c: o.c }); const a = makeActor(o); actors.set(o.id, a); fire(a, 'ev_begin'); },
    forget(id) { actors.delete(id); snapshot.delete(id); if (W().physics) W().physics.forget(id); },
  };
  return api;
}
