/* ═══════════════════════════════════════════════════════════════════════════
   🧩 BRUCE PRINTS — the game's real code, drawn the way Unreal draws Blueprints.

   The owner asked to see how the game fits together: "put all of the code of
   the game that work with each other in blue print format so I can see how it
   works". This is the generator. It does NOT describe the game from memory or
   from a design doc — it PARSES the shipped source with acorn, finds every
   function, finds who calls whom, and lays the result out as node graphs under
   Content/BrucePrints/, one folder per system, exactly like an Unreal Content
   Browser. A print that disagrees with the code is a bug in this file.

   What a node is: one function. What a wire is: one call. White exec wires run
   left to right in call order; a node's colour is its kind, the way Unreal
   colours events red, functions blue and pure functions green:

       🔴 EVENT     an entry point — a screen, a button handler, a tick
       🔵 FUNCTION  does something: writes state, calls out, renders
       🟢 PURE      reads and returns; writes nothing
       🟣 DATA      touches persistent state (Profile / Forge / Corp / Cloud)

   Run:  node tools/bruceprints/build.mjs
   Out:  Content/BrucePrints/<System>/<Print>.bp.json  +  manifest.json
   View: Content/BrucePrints/index.html (pan, zoom, click a node for its file
         and line — every node carries the real path and line number).
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative, sep } from 'path';
import * as acorn from 'acorn';

const ROOT = process.cwd();
const OUT = join(ROOT, 'Content', 'BrucePrints');
/* Deployed copy: public/ is the site root, so this is the one the engine's
   Content Browser fetches (/bruce-prints/manifest.json). Same bytes, two
   places - the repo folder is for reading, this one is for the game. */
const OUT_WEB = join(ROOT, 'public', 'bruce-prints');

/* ── 1. WHAT COUNTS AS A SYSTEM ────────────────────────────────────────────
   A system is a name pattern plus a set of entry points. The patterns are
   deliberately narrow: a function lands in at most one system, first match
   wins, and anything unmatched goes nowhere rather than into a junk drawer —
   a print with everything in it shows nothing. */
const SYSTEMS = [
  { id: 'Economy',      label: 'Economy & Crash Exchange', icon: '📈',
    match: /^(_?cx|getMarketPrice|tickMarketDecay|bumpMarketPrice|dropMarketPrice|cxProduce|cxMarket|cxYield|cxSupply|cxImpacted|recordMarketTxn|getCrashExchange|renderCrashExchange)/ },
  { id: 'Corporations', label: 'Corporations & Treasury', icon: '🏢',
    match: /^(_?corp|boeCorp|_op[A-Z]|cityHallFetch|renderCityHall)/ },
  { id: 'Wallet',       label: 'Wallet, Cinder & Aza', icon: '🔥',
    match: /^(addGems|spendGems|_gems|wallet|_sov|spendSovereigns|addSovereigns|_serverMirror|boe[A-Z])/ },
  { id: 'Haul',         label: 'Highway Haul', icon: '🚛',
    match: /^(haul|_haul|raider|plan Run|planRun|rigProfile|cargoClass|upgradeEffects)/ },
  { id: 'City',         label: 'City & Nodes', icon: '🏙',
    match: /^(_?tw[A-Z]|_node[A-Z]|node[A-Z]|city[A-Z]|_city|_openClientCity|MythicCity)/ },
  { id: 'Cards',        label: 'Cards, Moves & Battle', icon: '🃏',
    match: /^(_?card|move[A-Z]|applyMove|battle|_battle|deck|_deck|forgeCard|captureEditorIntoCard)/ },
  { id: 'Market',       label: 'LUNI Marketplace', icon: '🛒',
    match: /^(_?res(Market|Listing)|renderMarket|Market[A-Z]|_cardRowToListing|_luni|trader)/ },
  { id: 'Profile',      label: 'Profile, Save & Cloud', icon: '💾',
    match: /^(saveProfile|loadProfile|_persist|cloud[A-Z]|_cloud|saveForge|loadForge|_saveCx|_loadCx|_profile)/ },
  { id: 'Missions',     label: 'Missions & Progression', icon: '🎯',
    match: /^(_?mission|trackMission|_rollMission|xpFor|addXp|_levelUp|progress)/ },
  { id: 'Farm',         label: 'Farm & Feed', icon: '🌾',   match: /^(farm|_farm|feed[A-Z]|coop|barn)/ },
  { id: 'Foundry',      label: 'Foundry & Salvage', icon: '🔨', match: /^(foundry|_foundry|crusher|salvage[A-Z])/ },
  { id: 'Closet',       label: 'Player Closet', icon: '👕',  match: /^(closet|_closet|dress|measure|placeItem)/ },
  { id: 'Athena',       label: 'Athena Engine', icon: '🛠',  match: /^(mf[A-Z]|athena|_athena|widget|prefab|relinkAsset|askText)/ },
];

/* ── 2. THE SOURCES ────────────────────────────────────────────────────────
   index.html carries one 13 MB inline script; node-city carries another. Both
   are parsed as scripts, the modules under public/src as modules. */
function inlineScripts(file) {
  const src = readFileSync(file, 'utf8');
  const out = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(src))) {
    if (m[1].trim().length < 4000) continue;                 // skip the small inline boots
    if (/^\s*\{/.test(m[1])) continue;                        // importmap / JSON-LD
    const line = src.slice(0, m.index).split('\n').length;
    out.push({ code: m[1], lineOffset: line, type: 'script' });
  }
  return out;
}
function walkDir(dir, hit) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (!/node_modules|\.git/.test(p)) walkDir(p, hit); }
    else if (/\.(js|mjs|jsx)$/.test(name)) hit(p);
  }
}
function sources() {
  const list = [];
  const idx = join(ROOT, 'public', 'index.html');
  if (existsSync(idx)) for (const s of inlineScripts(idx)) list.push({ file: 'public/index.html', ...s });
  const nc = join(ROOT, 'public', 'node-city', 'index.html');
  if (existsSync(nc)) for (const s of inlineScripts(nc)) list.push({ file: 'public/node-city/index.html', ...s });
  const srcDir = join(ROOT, 'public', 'src');
  if (existsSync(srcDir)) walkDir(srcDir, (p) => {
    if (/\.jsx$/.test(p)) return;                              // JSX is not parseable by acorn alone
    list.push({ file: relative(ROOT, p).split(sep).join('/'), code: readFileSync(p, 'utf8'), lineOffset: 1, type: 'module' });
  });
  return list;
}

/* ── 3. PARSE ──────────────────────────────────────────────────────────────
   One pass per source. For every named function we record where it is, what it
   takes, who it calls, and which persistent stores it reads or writes — the
   last is what turns a plain call graph into something worth looking at, since
   "this function writes Profile.gems" is the fact a player's bug usually turns
   on. */
const STORES = ['Profile', 'Forge', 'Corp', 'App', 'Cloud', 'CXHist', 'Market', 'ResMarket', 'CityHall', 'Haul', 'BankEthos'];
const fns = new Map();          // name → node
const nameCount = new Map();    // duplicate names across files

function lineOf(code, pos, offset) { let n = 1; for (let i = 0; i < pos && i < code.length; i++) if (code.charCodeAt(i) === 10) n++; return n + offset - 1; }

function parseSource(s) {
  /* An inline <script type="module"> parses only as a module, and a classic
     script only as a script — node-city's 40k-line inline script is a module,
     which is why the first pass over it found nothing. Try both. */
  const opts = { ecmaVersion: 2023, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, allowHashBang: true };
  const order = s.type === 'module' ? ['module', 'script'] : ['script', 'module'];
  let ast = null, lastErr = null;
  for (const sourceType of order) {
    try { ast = acorn.parse(s.code, { ...opts, sourceType }); break; } catch (e) { lastErr = e; }
  }
  if (!ast) { console.log('  ! parse failed ' + s.file + ' — ' + lastErr.message.slice(0, 90)); return; }

  const stack = [];
  const push = (name, node) => {
    if (!name) return null;
    const rec = {
      name, file: s.file, line: lineOf(s.code, node.start, s.lineOffset),
      params: (node.params || []).map(pName).filter(Boolean),
      calls: new Set(), reads: new Set(), writes: new Set(),
      isAsync: !!node.async, returns: false, mutates: false,
    };
    nameCount.set(name, (nameCount.get(name) || 0) + 1);
    if (!fns.has(name)) fns.set(name, rec);
    return rec;
  };
  const pName = (p) => (p && p.type === 'Identifier') ? p.name : (p && p.type === 'AssignmentPattern' && p.left.type === 'Identifier') ? p.left.name : (p && p.type === 'RestElement' && p.argument.type === 'Identifier' ? '…' + p.argument.name : null);
  const cur = () => stack[stack.length - 1] || null;

  (function walk(node, parent) {
    if (!node || typeof node.type !== 'string') return;
    let opened = null;
    if (node.type === 'FunctionDeclaration' && node.id) opened = push(node.id.name, node);
    else if ((node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') && parent) {
      if (parent.type === 'VariableDeclarator' && parent.id && parent.id.type === 'Identifier') opened = push(parent.id.name, node);
      else if (parent.type === 'Property' && parent.key && (parent.key.name || parent.key.value)) opened = push(String(parent.key.name || parent.key.value), node);
      else if (parent.type === 'AssignmentExpression' && parent.left.type === 'MemberExpression' && parent.left.property && parent.left.property.name) opened = push(parent.left.property.name, node);
    }
    if (opened) stack.push(fns.get(opened.name) === opened ? opened : fns.get(opened.name));

    const c = cur();
    if (c) {
      if (node.type === 'CallExpression') {
        const callee = node.callee;
        if (callee.type === 'Identifier') c.calls.add(callee.name);
        else if (callee.type === 'MemberExpression' && callee.property && callee.property.name) {
          const objName = callee.object && callee.object.type === 'Identifier' ? callee.object.name : '';
          if (objName && STORES.indexOf(objName) < 0 && /^[A-Z_]/.test(objName)) c.calls.add(objName + '.' + callee.property.name);
          else c.calls.add(callee.property.name);
        }
      } else if (node.type === 'MemberExpression' && node.object && node.object.type === 'Identifier' && STORES.indexOf(node.object.name) >= 0) {
        const path = node.object.name + '.' + (node.property && (node.property.name || node.property.value) || '*');
        if (parent && parent.type === 'AssignmentExpression' && parent.left === node) { c.writes.add(path); c.mutates = true; }
        else if (parent && parent.type === 'UpdateExpression') { c.writes.add(path); c.mutates = true; }
        else c.reads.add(path);
      } else if (node.type === 'ReturnStatement' && node.argument) c.returns = true;
    }

    for (const k in node) {
      if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue;
      const v = node[k];
      if (Array.isArray(v)) { for (const x of v) if (x && typeof x.type === 'string') walk(x, node); }
      else if (v && typeof v.type === 'string') walk(v, node);
    }
    if (opened) stack.pop();
  })(ast, null);
}

/* ── 4. SORT INTO SYSTEMS, AND DRAW ───────────────────────────────────────── */
function systemOf(name) { for (const sys of SYSTEMS) if (sys.match.test(name)) return sys.id; return null; }
function kindOf(f) {
  if (/^(render|open|on[A-Z]|handle|init|boot|tick|_?cxExecute|start|play|main)/.test(f.name)) return 'event';
  if (f.writes.size > 0) return 'data';
  if (!f.mutates && f.returns && f.calls.size <= 3) return 'pure';
  return 'function';
}

/* Layered left→right layout: a node sits one column right of whoever calls it,
   which is how a Blueprint reads. Cycles are broken by first-seen depth. */
function layout(nodes, edges) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of edges) if (indeg.has(e.to)) indeg.set(e.to, indeg.get(e.to) + 1);
  const depth = new Map();
  const roots = nodes.filter((n) => (indeg.get(n.id) || 0) === 0).map((n) => n.id);
  const queue = roots.length ? roots.slice() : [nodes[0] && nodes[0].id].filter(Boolean);
  for (const r of queue) depth.set(r, 0);
  const adj = new Map();
  for (const e of edges) { if (!adj.has(e.from)) adj.set(e.from, []); adj.get(e.from).push(e.to); }
  let guard = 0;
  while (queue.length && guard++ < 20000) {
    const id = queue.shift(), d = depth.get(id) || 0;
    for (const to of (adj.get(id) || [])) {
      if (!depth.has(to) || depth.get(to) < d + 1) { if ((depth.get(to) || 0) < 12) { depth.set(to, d + 1); queue.push(to); } }
    }
  }
  const cols = new Map();
  for (const n of nodes) { const d = Math.min(12, depth.has(n.id) ? depth.get(n.id) : 0); if (!cols.has(d)) cols.set(d, []); cols.get(d).push(n); }
  const COL_W = 340, ROW_H = 132;
  for (const [d, list] of cols) list.forEach((n, i) => { n.x = 80 + d * COL_W; n.y = 80 + i * ROW_H; });
  return nodes;
}

function buildPrint(sysId, members) {
  const ids = new Set(members.map((f) => f.name));
  const nodes = members.map((f) => ({
    id: f.name, name: f.name, kind: kindOf(f), file: f.file, line: f.line,
    params: f.params.slice(0, 6), async: f.isAsync,
    reads: Array.from(f.reads).slice(0, 8), writes: Array.from(f.writes).slice(0, 8),
    calls: Array.from(f.calls).filter((c) => ids.has(c)).length,
  }));
  const edges = [];
  for (const f of members) for (const c of f.calls) if (ids.has(c) && c !== f.name) edges.push({ from: f.name, to: c });
  layout(nodes, edges);
  return { nodes, edges };
}

/* ── 5. RUN ───────────────────────────────────────────────────────────────── */
console.log('🧩 BRUCE PRINTS — reading the game');
const srcs = sources();
for (const s of srcs) parseSource(s);
console.log('  parsed ' + srcs.length + ' sources → ' + fns.size + ' named functions');

const bySys = new Map(SYSTEMS.map((s) => [s.id, []]));
for (const f of fns.values()) { const sid = systemOf(f.name); if (sid) bySys.get(sid).push(f); }

mkdirSync(OUT, { recursive: true });
const manifest = { generated: new Date().toISOString(), functions: fns.size, sources: srcs.length, systems: [] };
const MAX_NODES = 70;
for (const sys of SYSTEMS) {
  let members = bySys.get(sys.id);
  if (!members.length) continue;
  const ids = new Set(members.map((m) => m.name));
  members.sort((a, b) => {
    const ca = Array.from(a.calls).filter((c) => ids.has(c)).length + a.writes.size;
    const cb = Array.from(b.calls).filter((c) => ids.has(c)).length + b.writes.size;
    return cb - ca;
  });
  const dir = join(OUT, sys.id);
  mkdirSync(dir, { recursive: true });
  const prints = [];
  for (let i = 0, page = 1; i < members.length; i += MAX_NODES, page++) {
    const slice = members.slice(i, i + MAX_NODES);
    const g = buildPrint(sys.id, slice);
    const pname = page === 1 ? 'Overview' : 'Detail_' + page;
    writeFileSync(join(dir, pname + '.bp.json'), JSON.stringify({ system: sys.id, label: sys.label, icon: sys.icon, print: pname, ...g }, null, 1));
    prints.push({ name: pname, nodes: g.nodes.length, edges: g.edges.length });
  }
  manifest.systems.push({ id: sys.id, label: sys.label, icon: sys.icon, functions: members.length, prints });
  console.log('  ' + sys.icon + ' ' + sys.label.padEnd(32) + members.length + ' functions → ' + prints.length + ' print(s)');
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
/* mirror everything to public/ */
mkdirSync(OUT_WEB, { recursive: true });
const copyTree = (from, to) => {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const a = join(from, name), b = join(to, name);
    if (statSync(a).isDirectory()) copyTree(a, b);
    else writeFileSync(b, readFileSync(a));
  }
};
copyTree(OUT, OUT_WEB);
console.log('wrote ' + relative(ROOT, OUT) + '  and  ' + relative(ROOT, OUT_WEB));
