/* ═══════════════════════════════════════════════════════════════════════════
   widgets.format.js — the Athena Widget document. Pure data, no DOM.

   A widget is ONE JSON object the way an Unreal Widget Blueprint is one
   asset: a tree of panels and controls (the Designer), a set of variables,
   and an event GRAPH (the Blueprint) of nodes joined by execution wires.
   Every text-ish property may carry bindings — `{gems|num}` — evaluated
   against the game's data at runtime, so a label follows Cinder without any
   code; the graph adds behaviour (click → branch → toast / set variable /
   call a game action) without any code either.

   `kind: 'theme'` documents carry no tree: they are CSS variables + rules
   applied to the whole game, which is how the existing UI is restyled.

   Targets say WHERE a widget shows: a named slot the game exposes
   (`data-athena-slot="farm.hud"`), or any element by CSS selector — the
   hammer that lets an admin replace or extend an existing screen's UI.
   ═══════════════════════════════════════════════════════════════════════════ */

export const WIDGET_VERSION = 1;

export function uid(prefix) { return (prefix || 'w') + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); }

/* ── the palette ── */
export const WIDGET_TYPES = {
  canvas:   { label: 'Canvas panel',   icon: '▦', container: true, free: true, help: 'Children sit at absolute positions — drag them around in the designer.' },
  vbox:     { label: 'Vertical box',   icon: '☰', container: true, props: { gap: 6, align: 'stretch' } },
  hbox:     { label: 'Horizontal box', icon: '⋯', container: true, props: { gap: 6, align: 'center', wrap: false } },
  border:   { label: 'Border',         icon: '▢', container: true, props: { padding: 10 }, help: 'A panel with padding and its own background.' },
  text:     { label: 'Text',           icon: 'T', props: { text: 'Text', size: 14, weight: '400', align: 'left' } },
  button:   { label: 'Button',         icon: '⬚', props: { label: 'Button', variant: 'primary' }, events: ['click'] },
  image:    { label: 'Image',          icon: '🖼', props: { src: '', alt: '', fit: 'contain' }, help: 'A URL of an existing game asset (assets/…). Nothing is uploaded.' },
  icon:     { label: 'Icon',           icon: '★', props: { glyph: '🔥', size: 20 } },
  progress: { label: 'Progress bar',   icon: '▬', props: { value: '50', max: '100', color: '#d4af37', label: '' } },
  spacer:   { label: 'Spacer',         icon: '⎯', props: { size: 8 } },
  input:    { label: 'Text input',     icon: '⌨', props: { placeholder: '', var: '' }, events: ['change'], help: 'Writes what is typed into the named variable.' },
  toggle:   { label: 'Toggle',         icon: '◐', props: { label: 'Toggle', var: '' }, events: ['change'] },
};
/* Style keys the inspector exposes and the renderer applies (a whitelist:
   a document can never inject arbitrary CSS through a node). */
export const STYLE_KEYS = ['width', 'height', 'minWidth', 'maxWidth', 'padding', 'margin', 'bg', 'color', 'border', 'radius', 'opacity', 'font', 'shadow', 'gapOverride', 'zIndex', 'pointer'];
export const ANCHORS = ['tl', 'tr', 'bl', 'br', 'c'];

/* ── the graph ── exec pins only ('in' on the left, named outs on the right);
   every value is a field on the node that may hold bindings. */
export const GRAPH_NODES = {
  ev_construct: { cat: 'Events',  label: 'On Construct', color: '#b8404a', outs: ['then'], help: 'Fires once when the widget appears.' },
  ev_click:     { cat: 'Events',  label: 'On Click',     color: '#b8404a', outs: ['then'], props: { widget: '' }, help: 'Fires when the named button is clicked.' },
  ev_change:    { cat: 'Events',  label: 'On Change',    color: '#b8404a', outs: ['then'], props: { widget: '' }, help: 'Fires when an input or toggle changes.' },
  ev_tick:      { cat: 'Events',  label: 'On Tick',      color: '#b8404a', outs: ['then'], props: { ms: 1000 }, help: 'Fires every N milliseconds while the widget is shown.' },
  toast:        { cat: 'Actions', label: 'Toast',        color: '#3a6ea8', ins: true, outs: ['then'], props: { message: 'Hello {name}', ms: 3000 } },
  setvar:       { cat: 'Actions', label: 'Set variable', color: '#3a6ea8', ins: true, outs: ['then'], props: { var: '', value: '' }, help: 'value is an expression: {$count} + 1' },
  branch:       { cat: 'Flow',    label: 'Branch',       color: '#8a8a8a', ins: true, outs: ['true', 'false'], props: { cond: '{$count} > 0' } },
  sequence:     { cat: 'Flow',    label: 'Sequence',     color: '#8a8a8a', ins: true, outs: ['then 0', 'then 1', 'then 2'] },
  delay:        { cat: 'Flow',    label: 'Delay',        color: '#8a8a8a', ins: true, outs: ['then'], props: { ms: 500 } },
  call:         { cat: 'Actions', label: 'Call game action', color: '#3a6ea8', ins: true, outs: ['then'], props: { action: '', args: '' }, help: 'An action the game exposes (see the Actions list). args: comma-separated expressions.' },
  setprop:      { cat: 'Actions', label: 'Set property', color: '#3a6ea8', ins: true, outs: ['then'], props: { widget: '', prop: 'text', value: '' } },
  visible:      { cat: 'Actions', label: 'Set visible',  color: '#3a6ea8', ins: true, outs: ['then'], props: { widget: '', visible: 'true' } },
  navigate:     { cat: 'Actions', label: 'Go to screen', color: '#3a6ea8', ins: true, outs: ['then'], props: { screen: 'camp' } },
  log:          { cat: 'Actions', label: 'Print',        color: '#3a6ea8', ins: true, outs: ['then'], props: { message: '' } },
};

export function newNode(type, extra) {
  const T = WIDGET_TYPES[type] || WIDGET_TYPES.text;
  const n = { id: uid('n_'), type: T === WIDGET_TYPES.text && type !== 'text' ? 'text' : type, name: '', props: Object.assign({}, T.props || {}), style: {}, layout: { x: 20, y: 20, w: 160, h: 40, anchor: 'tl' }, bind: {}, on: {}, children: [] };
  if (type === 'text') n.name = ''; 
  return Object.assign(n, extra || {});
}

export function newWidget(opts) {
  opts = opts || {};
  const root = newNode('vbox', { name: 'Root' });
  root.style = { padding: '10px' };
  root.children.push(newNode('text', { name: 'Title', props: { text: 'New widget', size: 16, weight: '700', align: 'left' } }));
  return {
    v: WIDGET_VERSION, id: opts.id || uid('wg_'), name: opts.name || 'Untitled widget', description: '',
    kind: opts.kind === 'theme' ? 'theme' : 'widget',
    target: { mode: 'none', slot: '', selector: '', place: 'append' },
    vars: {},
    root: opts.kind === 'theme' ? null : root,
    graph: { nodes: opts.kind === 'theme' ? [] : [Object.assign(newGraphNode('ev_construct'), { x: 40, y: 40 })], links: [] },
    theme: { vars: {}, css: '' },
    meta: { created: Date.now(), updated: Date.now(), author: opts.author || '' },
  };
}
export function newGraphNode(type, x, y) {
  const G = GRAPH_NODES[type] || GRAPH_NODES.log;
  return { id: uid('g_'), type: GRAPH_NODES[type] ? type : 'log', x: x || 40, y: y || 40, props: Object.assign({}, G.props || {}) };
}

/* Bring ANY parsed JSON into a valid document; an old or hand-edited file
   never crashes the designer or the game. */
export function normalize(raw) {
  const base = newWidget();
  if (!raw || typeof raw !== 'object') return base;
  const d = base;
  d.id = typeof raw.id === 'string' && raw.id ? raw.id : d.id;
  d.name = String(raw.name || d.name).slice(0, 80);
  d.description = String(raw.description || '').slice(0, 1000);
  d.kind = raw.kind === 'theme' ? 'theme' : 'widget';
  const t = raw.target || {};
  d.target = { mode: ['none', 'slot', 'selector'].includes(t.mode) ? t.mode : 'none', slot: String(t.slot || '').slice(0, 80), selector: String(t.selector || '').slice(0, 300), place: ['append', 'prepend', 'before', 'after', 'replace', 'contents'].includes(t.place) ? t.place : 'append' };
  d.vars = {};
  Object.keys(raw.vars || {}).slice(0, 200).forEach(k => { const v = raw.vars[k]; const key = String(k).replace(/[^A-Za-z0-9_]/g, '').slice(0, 40); if (!key) return; d.vars[key] = (v && typeof v === 'object') ? { type: ['number', 'string', 'bool'].includes(v.type) ? v.type : 'string', value: v.value } : { type: typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'bool' : 'string', value: v }; });
  const seen = new Set();
  d.root = d.kind === 'theme' ? null : (normalizeNode(raw.root, seen, 0) || base.root);
  const g = raw.graph || {};
  const gids = new Set();
  d.graph.nodes = (Array.isArray(g.nodes) ? g.nodes : []).map(n => { if (!n || !GRAPH_NODES[n.type]) return null; const id = String(n.id || uid('g_')); if (gids.has(id)) return null; gids.add(id); return { id, type: n.type, x: num(n.x, 0), y: num(n.y, 0), props: Object.assign({}, GRAPH_NODES[n.type].props || {}, plainProps(n.props)) }; }).filter(Boolean).slice(0, 400);
  d.graph.links = (Array.isArray(g.links) ? g.links : []).map(l => l && l.from && l.to && gids.has(l.from.n) && gids.has(l.to.n) ? { from: { n: String(l.from.n), pin: String(l.from.pin || 'then').slice(0, 20) }, to: { n: String(l.to.n) } } : null).filter(Boolean).slice(0, 800);
  const th = raw.theme || {};
  d.theme = { vars: {}, css: String(th.css || '').slice(0, 60000) };
  Object.keys(th.vars || {}).slice(0, 300).forEach(k => { const key = String(k).trim(); if (/^--[A-Za-z0-9_-]{1,60}$/.test(key)) d.theme.vars[key] = String(th.vars[k]).slice(0, 200); });
  const meta = raw.meta || {};
  d.meta = { created: +meta.created || Date.now(), updated: +meta.updated || Date.now(), author: String(meta.author || '').slice(0, 80) };
  return d;
}
function normalizeNode(n, seen, depth) {
  if (!n || typeof n !== 'object' || !WIDGET_TYPES[n.type] || depth > 24) return null;
  const T = WIDGET_TYPES[n.type];
  let id = String(n.id || uid('n_')); if (seen.has(id)) id = uid('n_'); seen.add(id);
  const l = n.layout || {};
  const out = {
    id, type: n.type, name: String(n.name || '').slice(0, 40),
    props: Object.assign({}, T.props || {}, plainProps(n.props)),
    style: {}, layout: { x: num(l.x, 0), y: num(l.y, 0), w: num(l.w, 120), h: num(l.h, 32), anchor: ANCHORS.includes(l.anchor) ? l.anchor : 'tl' },
    bind: {}, on: {}, children: [],
  };
  STYLE_KEYS.forEach(k => { if (n.style && n.style[k] != null && n.style[k] !== '') out.style[k] = String(n.style[k]).slice(0, 120); });
  Object.keys(n.bind || {}).slice(0, 20).forEach(k => { out.bind[String(k).slice(0, 30)] = String(n.bind[k]).slice(0, 500); });
  Object.keys(n.on || {}).slice(0, 10).forEach(k => { out.on[String(k).slice(0, 20)] = String(n.on[k]).slice(0, 60); });
  if (T.container) out.children = (Array.isArray(n.children) ? n.children : []).map(c => normalizeNode(c, seen, depth + 1)).filter(Boolean).slice(0, 200);
  return out;
}
function plainProps(p) { const o = {}; if (p && typeof p === 'object') Object.keys(p).slice(0, 40).forEach(k => { const v = p[k]; if (v == null) return; o[String(k).slice(0, 30)] = typeof v === 'number' || typeof v === 'boolean' ? v : String(v).slice(0, 2000); }); return o; }
function num(v, d) { v = Number(v); return Number.isFinite(v) ? v : d; }

export function serialize(d) { const out = JSON.parse(JSON.stringify(d)); out.meta = out.meta || {}; out.meta.updated = Date.now(); return out; }
export function clone(d) { return JSON.parse(JSON.stringify(d)); }

/* tree helpers */
export function walk(node, fn, parent, depth) { if (!node) return; fn(node, parent || null, depth || 0); (node.children || []).forEach(c => walk(c, fn, node, (depth || 0) + 1)); }
export function findNode(root, id) { let hit = null; walk(root, n => { if (n.id === id) hit = n; }); return hit; }
export function findParent(root, id) { let hit = null; walk(root, (n, p) => { if (n.id === id) hit = p; }); return hit; }
export function nodeByName(root, name) { let hit = null; walk(root, n => { if (!hit && (n.name === name || n.id === name)) hit = n; }); return hit; }

/* ═══ EXPRESSIONS ═══
   `{path}`, `{$var}`, arithmetic and comparisons, `|filters`. No eval, no
   Function: a tiny recursive-descent parser over a fixed grammar, so a
   document from the cloud can never run code. Unknown paths read as
   undefined → '' in text, false in conditions. */
const FILTERS = {
  num: v => (Number(v) || 0).toLocaleString(),
  int: v => String(Math.round(Number(v) || 0)),
  fixed: (v, a) => (Number(v) || 0).toFixed(Math.max(0, Math.min(6, +a || 0))),
  pct: v => Math.round((Number(v) || 0) * 100) + '%',
  upper: v => String(v == null ? '' : v).toUpperCase(),
  lower: v => String(v == null ? '' : v).toLowerCase(),
  cap: v => { const s = String(v == null ? '' : v); return s.charAt(0).toUpperCase() + s.slice(1); },
  time: v => { const d = new Date(Number(v) || Date.now()); return isNaN(d) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); },
  len: v => Array.isArray(v) || typeof v === 'string' ? v.length : (v && typeof v === 'object' ? Object.keys(v).length : 0),
  json: v => { try { return JSON.stringify(v); } catch (e) { return ''; } },
  default: (v, a) => (v == null || v === '' ? a : v),
};
const FNS = {
  min: (a, b) => Math.min(+a, +b), max: (a, b) => Math.max(+a, +b), round: (a) => Math.round(+a), floor: (a) => Math.floor(+a), ceil: (a) => Math.ceil(+a), abs: (a) => Math.abs(+a),
  len: FILTERS.len, str: (a) => String(a == null ? '' : a), num: (a) => Number(a) || 0, now: () => Date.now(), random: () => Math.random(),
};
export function lookup(path, scope) {
  if (path.charAt(0) === '$') { const v = scope.vars ? scope.vars[path.slice(1)] : undefined; return v && typeof v === 'object' && 'value' in v && !Array.isArray(v) ? v.value : v; }
  let cur = scope.data; const parts = path.split('.');
  for (const p of parts) { if (cur == null) return undefined; cur = (typeof cur === 'function') ? undefined : cur[p]; }
  return typeof cur === 'function' ? undefined : cur;
}
export function evalExpr(src, scope) {
  src = String(src == null ? '' : src);
  let i = 0; const s = src;
  // braces are transparent: '{$count} + 1' and '{gems} > 100' read as plain expressions,
  // so a field may be written either way (the designer shows bindings in braces everywhere)
  const ws = () => { while (i < s.length && /[\s{}]/.test(s[i])) i++; };
  const peek = (str) => { ws(); return s.startsWith(str, i); };
  const eat = (str) => { if (peek(str)) { i += str.length; return true; } return false; };
  function primary() {
    ws();
    if (eat('(')) { const v = or(); eat(')'); return v; }
    if (eat('!')) return !truthy(unary());
    if (eat('-')) return -(Number(unary()) || 0);
    const ch = s[i];
    if (ch === '"' || ch === "'") { let j = i + 1, out = ''; while (j < s.length && s[j] !== ch) { out += s[j] === '\\' ? s[++j] : s[j]; j++; } i = j + 1; return out; }
    const numM = /^\d+(\.\d+)?/.exec(s.slice(i)); if (numM) { i += numM[0].length; return parseFloat(numM[0]); }
    const idM = /^\$?[A-Za-z_][A-Za-z0-9_.]*/.exec(s.slice(i));
    if (idM) {
      i += idM[0].length; const id = idM[0];
      if (id === 'true') return true; if (id === 'false') return false; if (id === 'null') return null;
      if (FNS[id] && eat('(')) { const args = []; if (!peek(')')) { do { args.push(or()); } while (eat(',')); } eat(')'); return FNS[id].apply(null, args); }
      return lookup(id, scope);
    }
    i++; return undefined;   // skip an unknown char rather than loop forever
  }
  function unary() { return primary(); }
  function mul() { let v = unary(); for (;;) { if (eat('*')) v = (Number(v) || 0) * (Number(unary()) || 0); else if (eat('/')) { const d = Number(unary()) || 0; v = d ? (Number(v) || 0) / d : 0; } else if (eat('%')) { const d = Number(unary()) || 0; v = d ? (Number(v) || 0) % d : 0; } else return v; } }
  function add() { let v = mul(); for (;;) { if (eat('+')) { const r = mul(); v = (typeof v === 'string' || typeof r === 'string') ? String(v == null ? '' : v) + String(r == null ? '' : r) : (Number(v) || 0) + (Number(r) || 0); } else if (eat('-')) v = (Number(v) || 0) - (Number(mul()) || 0); else return v; } }
  function cmp() { let v = add(); for (;;) { if (eat('>=')) v = Number(v) >= Number(add()); else if (eat('<=')) v = Number(v) <= Number(add()); else if (eat('==')) v = looseEq(v, add()); else if (eat('!=')) v = !looseEq(v, add()); else if (eat('>')) v = Number(v) > Number(add()); else if (eat('<')) v = Number(v) < Number(add()); else return v; } }
  function and() { let v = cmp(); while (eat('&&')) { const r = cmp(); v = truthy(v) && truthy(r) ? r : false; } return v; }
  function or() { let v = and(); while (eat('||')) { const r = and(); v = truthy(v) ? v : r; } return v; }
  try { const v = or(); return v; } catch (e) { return undefined; }
}
function looseEq(a, b) { if (a == null || b == null) return a == b; if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b); return String(a) === String(b); }
export function truthy(v) { return !(v === undefined || v === null || v === false || v === 0 || v === '' || v === 'false'); }
/* "{expr|filter:arg}" inside any string. A string that is exactly one
   binding keeps its raw type (so a bound `visible` can be boolean). */
export function interpolate(str, scope) {
  if (typeof str !== 'string' || str.indexOf('{') < 0) return str;
  const one = /^\{([^{}]+)\}$/.exec(str);
  if (one) return applyFilters(one[1], scope);
  return str.replace(/\{([^{}]+)\}/g, (m, inner) => { const v = applyFilters(inner, scope); return v == null ? '' : String(v); });
}
function applyFilters(inner, scope) {
  const parts = inner.split('|');
  let v = evalExpr(parts[0], scope);
  for (let k = 1; k < parts.length; k++) { const [name, arg] = parts[k].trim().split(':'); const f = FILTERS[name.trim()]; if (f) v = f(v, arg); }
  return v;
}
