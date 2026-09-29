/* ══════════════════════════════════════════════════════════════════════════
   🗣 DRIVE-PLAIN-ENGLISH — the panels must speak to a player, not to a compiler.

   THE REPORT, with two screenshots: "Fix the code speak, the text is not saying
   the right things, it is speaking in code." What was on screen:

     Zone Demand      "read from /src/economy snapshot().want / .unmet"
                      "read from /src/economy labourMarket() + /src/demographics
                       ladder()"
                      "read from /src/zoning stats()"
     Citizen dossier  "Doing: Going to work — agent.phase = work,
                       agent.state = travel."
                      "MythicDossier.householdOf(7,9) — 1 resident"
                      "MythicCitizens.get().job = 12,8"
                      "citEmpSync() found no firm on tile 12,8"
                      "ECON.firm.levels gates on employees, revenue and customers"
                      "/src/mortality retires the OLDEST resident (never
                       citEnsure()'s newest-first trim, which is emigration)"

   WHERE IT CAME FROM, and it is worth naming because the intent was good: both
   panels are built under a rule that every figure must name where it was read
   from, so that nothing on screen can be quietly invented. That rule stays.
   What was wrong is that the provenance was written in the vocabulary of the
   person who wrote the module rather than of the person reading the panel — a
   maintainer's note printed in a player's dialogue. Every line still says where
   its number came from; it now says it in words.

   🔴 THIS DRIVES THE SHIPPED RENDER PATH, NOT THE SOURCE. A grep over the files
      proves the identifiers were edited out of the ones I looked at. It cannot
      prove the panel a player opens is free of them, because the text is
      assembled from four modules at run time and the ageing model's sentences
      are quoted verbatim into the citizen panel — which is exactly how
      "/src/mortality retires the OLDEST resident" reached the screen from a
      file the panel does not contain. So the citizen dossier is rendered for
      EVERY person on the roster and the demand modal is opened on all four
      categories, and the assertion is made against the text that comes out.

   Pinned, with controls, because "no code found" and "no text found" look
   identical from the outside:
     · every citizen dossier is free of code tokens
     · every demand category is free of code tokens
     · CONTROL: the detector fires on the exact strings that were reported
     · CONTROL: a real amount of text was harvested, from real causes and rows
     · the panels still say where their numbers came from

   Run:  node .gauntlet/drive-plain-english.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const P = 8670 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/node-city/index.html', { waitUntil: 'load', timeout: 120000 });
await pg.waitForFunction('!!(window.__nc && window.__nc.place)', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(6000);

/* 🔴 .gauntlet/scene.js IS NOT USED HERE, AND THE REASON IS WORTH WRITING DOWN.
   It is the standard district every capture in this directory is taken of, and
   on this machine it does not return: measured at over 120 s with the page
   otherwise healthy (__nc.place ready, 8 citizens on the roster, the demand
   panel importable). That is a pre-existing fault in the harness and nothing
   to do with the text this file is about — but a driver that hangs proves
   nothing at all, so this one is built on the city node-city starts with.
   ⚠ WHAT THAT COSTS: a smaller roster, and fewer branches reached by luck. It
     is paid for below by driving the five activity branches THROUGH THE
     SHIPPED activityOf() rather than hoping a pedestrian happens to be in
     each state — which is stronger than the scene would have been anyway,
     since "agent.phase = work, agent.state = travel" is a branch a still
     city never renders. */
const built = { scene: 'not used — see the note in this file', placed: null };
await pg.waitForTimeout(2000);

const out = await pg.evaluate(async () => {
  const o = { harvest: [] };
  const nc = window.__nc;
  o.reachable = !!(nc && window.MythicCitizen && window.MythicCitizens);
  if (!o.reachable) return o;

  /* Walk the crowd by hand. rAF does not run in a headless pane, so without
     this every citizen is "not on the street" and the whole travelling branch
     of the activity note — which is where "agent.phase = work" lived — never
     renders and never gets checked. */
  try { nc.manageAgents(); } catch (e) {}
  try { window.MythicCitizens.refresh(true); } catch (e) {}
  for (let i = 0; i < 240; i++) { try { nc.agentTick(1 / 30); } catch (e) { break; } }
  try { window.MythicCitizens.refresh(true); } catch (e) {}

  const strip = (html) => String(html || '')
    .replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();

  /* ── 1 · the citizen dossier, for EVERYONE ─────────────────────────────
     Every row branches on what this city can answer for that person, so one
     citizen exercises perhaps half the strings. The roster is small; render
     all of it. */
  /* ── 0 · THE FIVE ACTIVITY BRANCHES, DRIVEN ────────────────────────────
     The line the report actually showed — "Doing: Going to work — agent.phase
     = work, agent.state = travel." — is written by ONE arm of activityOf(),
     and a city where nobody happens to be walking never renders it. So the
     shipped function is called with a stand-in for the pedestrian snapshot it
     reads, once per arm. Everything inside activityOf is the real thing; only
     C.agentOf is posed. */
  try {
    const F = await import('/src/citizen/facts.js');
    const ctx = window.MythicCitizen._ctx();
    const real = ctx.agentOf;
    const poses = [
      { state: 'inside', inside: null, at: null, phase: 'home' },
      { state: 'enter', inside: null, phase: 'work' },
      { state: 'exit', inside: null, phase: 'home' },
      { state: 'travel', dwell: 1, phase: 'home' },
      { state: 'travel', phase: 'work', dest: null, i: 0, steps: 4 },
      { state: 'travel', phase: 'home', dest: null, i: 1, steps: 5 },
    ];
    for (const pose of poses) {
      ctx.agentOf = () => pose;
      const a = F.activityOf(ctx, 'probe');
      o.harvest.push({ where: 'activity — ' + pose.state + '/' + pose.phase,
                       text: [a.label, a.note, a.why].filter(Boolean).join(' — ') });
    }
    ctx.agentOf = () => null;                       // and the not-walking arm
    const nn = F.activityOf(ctx, 'probe');
    o.harvest.push({ where: 'activity — not walking', text: String(nn.why || '') });
    ctx.agentOf = real;
    o.activityArms = poses.length + 1;
  } catch (e) { o.activityErr = String(e).slice(0, 160); }

  /* ── 0b · the ageing model's own sentences ─────────────────────────────
     Quoted VERBATIM into the Age row, from a file the citizen panel does not
     contain — which is exactly how "/src/mortality retires the OLDEST
     resident (never citEnsure()'s newest-first trim)" reached the screen. */
  try {
    const LP = window.MythicLifepath;
    if (LP) {
      const mo = LP.mortality ? LP.mortality() : null;
      if (mo) o.harvest.push({ where: 'ageing model — mortality', text: [mo.note, mo.why].filter(Boolean).join(' — ') });
      const di = LP.distribution ? LP.distribution() : null;
      if (di) o.harvest.push({ where: 'ageing model — drift', text: String(di.drift || di.why || '') });
      const ck = LP.clock ? LP.clock() : null;
      if (ck && ck.why) o.harvest.push({ where: 'ageing model — clock', text: String(ck.why) });
      o.lifepath = true;
    }
  } catch (e) { o.lifepathErr = String(e).slice(0, 160); }

  const roster = window.MythicCitizens.list() || [];
  o.roster = roster.length;
  o.states = {};
  for (const c of roster) {
    let html = '';
    try { html = window.MythicCitizen.html(c.id); } catch (e) { html = ''; }
    if (html) o.harvest.push({ where: 'citizen dossier', text: strip(html) });
    try {
      const a = window.MythicCitizen.activity(c.id);
      const k = a && a.ok ? (a.state || '?') + '/' + (a.phase || '?') : 'not-walking';
      o.states[k] = (o.states[k] || 0) + 1;
    } catch (e) {}
  }

  /* ── 2 · the Zone Demand modal, all four categories ────────────────────
     Imported by the SAME specifier hud/index.js uses, so this is the mounted
     instance and not a second copy with its own state. */
  let Panel = null;
  try { Panel = await import('/src/hud/panel.js'); } catch (e) { o.panelErr = String(e).slice(0, 140); }
  o.panel = !!(Panel && Panel.open);
  if (Panel && Panel.open) {
    try { Panel.open(); } catch (e) {}
    for (const cat of ['res', 'com', 'off', 'ind']) {
      try { Panel.select(cat); } catch (e) {}
      try { Panel.render(true); } catch (e) {}
      const t = ['#ncdm-list', '#ncdm-detail', '#ncdm-foot']
        .map((s) => { const el = document.querySelector(s); return el ? el.textContent : ''; })
        .join(' · ');
      o.harvest.push({ where: 'zone demand — ' + cat, text: strip(t) });
    }
    /* Did the meters actually have causes to print? A panel that rendered
       "Not modelled yet" four times is code-free for the wrong reason. */
    o.causeRows = document.querySelectorAll('#ncdm-detail .drow').length;
    o.srcLines = document.querySelectorAll('#ncdm-detail .dsrc').length;
    try { Panel.close(); } catch (e) {}
  }
  o.chars = o.harvest.reduce((a, h) => a + h.text.length, 0);
  return o;
});

/* ── the detector ─────────────────────────────────────────────────────────
   Run in node rather than in the page so that the SAME function can be turned
   on the strings that were reported. A detector that has never fired is not
   evidence of anything. */
const CODE = [
  [/\/src\/[a-z]/, 'a module path'],
  [/\bMythic[A-Z]\w*\s*\./, 'a bridge global'],
  [/\bECON\./, 'the tuning table'],
  [/\bagent\.[a-z]/, 'pedestrian internals'],
  [/\b(tile|game)\.[a-z]\w+/, 'a host object field'],
  [/\b[a-z]\w*\(\)/, 'a function call'],
  [/\b(citEmpSync|citEnsure|buildMesh|loadState|syncBuildings|homesIndex|householdOf|wealthOf|labourMarket|structuralGaps|agePerDay|graduatePerDay|retiredLeavePerDay|bldgK|cityAge|dayMin)\b/, 'an internal name'],
  [/\b\w+\.js\b/, 'a filename'],
  [/=\s*(null|true|false)\b/, 'a literal assignment'],
];
const findCode = (text) => {
  const hits = [];
  for (const [re, what] of CODE) {
    const m = re.exec(text);
    if (m) hits.push(what + ': "' + text.slice(Math.max(0, m.index - 30), m.index + 60).trim() + '"');
  }
  return hits;
};

/* CONTROL — the exact lines off the two screenshots. If the detector cannot
   see these, a clean run below means nothing at all. */
const REPORTED = [
  'read from /src/economy snapshot().want / .unmet',
  'read from /src/economy labourMarket() + /src/demographics ladder()',
  'read from /src/zoning stats()',
  'Doing: Going to work — agent.phase = work, agent.state = travel.',
  'MythicDossier.householdOf(7,9) — 1 resident, sharing an address rather than a name',
  'MythicCitizens.get().job = 12,8 — they hold one of that building’s crew seats',
  'citEmpSync() found no firm on tile 12,8, so the economy names no business',
  'ECON.firm.levels gates on employees, revenue and customers',
  'read back out of demographics.lifecycle.agePerDay (0.0008/day over a 52-year working life)',
];
const controlMissed = REPORTED.filter((r) => findCode(r).length === 0);

const found = [];
for (const h of (out.harvest || [])) {
  const hits = findCode(h.text);
  for (const x of hits) found.push(h.where + ' — ' + x);
}
/* One line per distinct complaint; a roster of 40 would otherwise print the
   same sentence forty times and bury the others. */
const uniq = [...new Set(found)];

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
if (!out.reachable) bad.push('node-city / the citizen module are not reachable');
else {
  need('CONTROL: the detector sees every line that was reported', controlMissed.length === 0, controlMissed);
  need('CONTROL: there are citizens to open a dossier on', (out.roster | 0) > 0, out.roster);
  need('CONTROL: all six activity branches were driven', (out.activityArms | 0) === 7, out.activityErr || out.activityArms);
  need('CONTROL: the ageing model was read for its own sentences', out.lifepath === true, out.lifepathErr || out.lifepath);
  need('CONTROL: the demand panel is mounted and was opened', out.panel === true, out.panelErr || out.panel);
  need('CONTROL: the meters printed real causes, not four blanks', (out.causeRows | 0) > 0, out.causeRows);
  need('CONTROL: those causes still say where they came from', (out.srcLines | 0) > 0, out.srcLines);
  need('CONTROL: a real amount of text was read', (out.chars | 0) > 4000, out.chars);
  need('THE REPORT: nothing a player reads is written in code', uniq.length === 0, uniq.slice(0, 14));
}

console.log(JSON.stringify({
  scene: built.scene,
  roster: out.roster, walking: out.states, panel: out.panel,
  activityArms: out.activityArms, lifepath: out.lifepath,
  causeRows: out.causeRows, srcLines: out.srcLines, chars: out.chars,
  controlMissed, codeFound: uniq.slice(0, 14), pageErrors: errs.slice(0, 3),
}, null, 2));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — both panels still say where every number came from, in words a player reads.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
