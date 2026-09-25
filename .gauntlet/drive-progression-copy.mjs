/* ══════════════════════════════════════════════════════════════════════════
   🏅 DRIVE-PROGRESSION-COPY — does the Progression screen print developer
   identifiers at a player?

   THE BUG THIS EXISTS FOR. Every milestone row carried exactly ONE provenance
   field, `source`, and panel.js printed it verbatim:

       '<div class="pgrsrc">' + esc(m.label) + ' — ' + esc(m.source) + '</div>'

   so the Milestones tab read "Population — node-city cityPop(), handed over as
   ctx.pop()", and the Achievements tab read "trigger: builtCount() ≥ 1". One
   field was doing two jobs: the maintainer's grep string AND the player's
   caption. Six renderers were affected (the milestone caption, the achievement
   trigger line, the "Where these numbers come from" block, the two static
   blurbs on the Achievements tab, and every degraded-state `why`).

   🔴 THE FIX IS NOT "DELETE THE LINE", AND THIS FILE IS WRITTEN TO CATCH THAT
      TOO. milestones.js states the rule at its head: every figure traces to a
      live call and the panel says which. That rule is right. So §2 asserts the
      captions are CLEAN, and §3 asserts they still EXIST, are still rendered,
      and still read like an answer to "where did this number come from" — a
      row whose caption went empty or turned into a name fails here.

   WHAT IS ASSERTED vs WHAT IS REPORTED. This driver runs in bare Node on
   win32, which is the whole reason the scope is /src/progression: the module
   imports cleanly with no DOM. It therefore asserts on the STRINGS the
   renderers are handed and on the render lines' presence in panel.js source.
   It CANNOT assert on pixels — .gauntlet/shot.mjs imports Playwright from a
   Linux path and this checkout has no .gauntlet/package — so nothing here is
   a claim about how the panel LOOKS. §4 prints every caption for a human to
   read, because "still answers the question" is not a regex.

   Run:  node .gauntlet/drive-progression-copy.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'fs';

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  OK   ' : '  FAIL ') + name + (detail == null ? '' : '   ' + detail));
};

/* 🔴 THE REGEX IS THE BAR, COPIED EXACTLY. Call signatures `()`, host handles
   `ctx.` / `window.` / `Mythic*.`, file and module names, the one bare
   identifier that is neither (`prodPerMin`), and camelCase in general — which
   is what catches `cityPop`, `builtCount`, `cinderRate` and `hasLicence`
   without having to list them. `NaN` is caught by the camelCase clause too
   (`aN`), which is deliberate: String(NaN) reaching a caption is the
   commonest degraded read there is. */
const DEV = /\(\)|ctx\.|window\.|Mythic[A-Za-z]*\.|node-city|\/src\/|prodPerMin|[a-z][a-z0-9]*[A-Z]/;
const hit = (s) => { const m = DEV.exec(String(s == null ? '' : s)); return m ? m[0] : null; };
const clean = (label, s) => ok(label, !hit(s), hit(s) ? 'LEAKED ' + JSON.stringify(hit(s)) + ' in ' + JSON.stringify(s) : trunc(s));
const trunc = (s) => { s = String(s == null ? '' : s); return s.length > 78 ? s.slice(0, 75) + '…' : s; };

/* The district metric asks `window` and the zoning achievement asks it too;
   absent, both take their degraded branch, which is one of the branches under
   test. A bare object rather than a shim, so nothing is faked into existence. */
if (!global.window) global.window = {};

const M = await import('../public/src/progression/milestones.js');
const SRC = (f) => readFileSync(new URL('../public/src/progression/' + f, import.meta.url), 'utf8');
const panelSrc = SRC('panel.js');
const indexSrc = SRC('index.js');
const stateSrc = SRC('state.js');

/* ── 1. the maintainer's cross-reference SURVIVED ──────────────────────────
   The fix had to split the audience, not drop provenance. If `trace` is
   missing, milestones.js has stopped being greppable and the rule at its head
   has been quietly repealed. */
console.log('\n1. the grep string is preserved, off-screen');
for (const k of Object.keys(M.METRICS)) {
  ok('  METRICS.' + k + ' keeps a trace', !!M.METRICS[k].trace, trunc(M.METRICS[k].trace));
}
for (const a of M.ACHIEVEMENTS) {
  ok('  ' + a.id + ' keeps a trace', !!a.trace, trunc(a.trace));
}
ok('  report() never copies trace into the view model',
   !/\btrace\b\s*:/.test(indexSrc.replace(/\/\*[\s\S]*?\*\//g, '')),
   'index.js assigns no trace field outside comments');

/* ── 2. nothing a player can read carries a developer identifier ───────── */
console.log('\n2. every player-facing string is clean');
/* The caption line is `label — source`, and the sources block is `label —
   source` too, so the LABEL is half of what a player reads and is checked as
   part of it. It is also the fallback the milestone row uses when a metric is
   missing, which is where `cinderRate` used to get onto the screen. */
for (const k of Object.keys(M.METRICS)) clean('  METRICS.' + k + '.label', M.METRICS[k].label);
for (const k of Object.keys(M.METRICS)) clean('  METRICS.' + k + '.source', M.METRICS[k].source);
for (const m of M.MILESTONES) { clean('  ' + m.id + '.name', m.name); clean('  ' + m.id + '.desc', m.desc); }
for (const a of M.ACHIEVEMENTS) { clean('  ' + a.id + '.name', a.name); clean('  ' + a.id + '.desc', a.desc); }
for (const a of M.ACHIEVEMENTS) clean('  ' + a.id + '.how', a.how);

/* The three literals built in report() rather than in a table. Read out of the
   source because they are pushed inside a function this driver cannot call
   without a live host — regexing the literals is the honest way to reach them. */
const pushes = [...indexSrc.matchAll(/sources\.push\(\{[^}]*source:\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
ok('  all three sources.push literals found', pushes.length === 3, pushes.length + ' found');
pushes.forEach((s, i) => clean('  sources.push #' + (i + 1), s));

/* The two static blurbs. Same reason: they live inside makePanel(). */
const blurbs = [
  ['Achievements intro', /pgcatb">Things this city did[\s\S]*?<\/div>'/],
  ['card-reward side panel', /pgsh">About rewards[\s\S]*?<\/div><\/div>';/],
];
for (const [name, re] of blurbs) {
  const m = re.exec(panelSrc);
  ok('  ' + name + ' found in panel.js', !!m);
  if (m) clean('  ' + name, m[0].replace(/<[^>]*>/g, ' ').replace(/'\s*\+\s*\r?\n\s*'/g, ''));
}

/* ── 3. the degraded branches, which is where a leak hides ──────────────── */
console.log('\n3. degraded states — empty ctx, NaN, null, and a thrown reader');
const CASES = {
  'empty ctx': {},
  'NaN readers': { pop: () => NaN, built: () => NaN, cinderRate: () => NaN },
  'null readers': { pop: () => null, built: () => null, cinderRate: () => null },
};
for (const [cname, ctx] of Object.entries(CASES)) {
  for (const k of Object.keys(M.METRICS)) {
    const r = M.METRICS[k].read(ctx);
    /* 🔴 UNAVAILABLE IS NEVER COLLAPSED INTO 0 — milestones.js forbids it in
       so many words, and it is load-bearing: "0 / 100" is a claim about the
       city, "unmeasurable" is a claim about the reader. */
    ok('  ' + cname + ' / ' + k + ' reads unavailable, not 0', r && r.ok === false && r.value === undefined,
       r && r.ok ? 'RETURNED A VALUE: ' + r.value : null);
    clean('  ' + cname + ' / ' + k + '.why', r && r.why);
  }
}

/* ⚠ A THROWING READER IS DRIVEN THROUGH THE SHIPPED GUARD, NOT AROUND IT, AND
   THAT IS A CORRECTION TO THIS FILE. It first called read() directly with a
   throwing ctx and reported three leaks — which were this driver's own
   fallback string, because `read()` deliberately does not catch: the ONE
   catch arm is state.js readMetrics(), and it is the only caller. Asserting
   on a string the driver invented would have been a red that meant nothing,
   and the same shape of mistake in the other direction would have been a
   green. So this drives makeState() for real. */
const throwCtx = {
  pop: () => { throw new Error('ctx.pop() blew up inside cityPop'); },
  built: () => { throw new Error('builtCount() blew up'); },
  cinderRate: () => { throw new Error('prodPerMin is undefined'); },
};
const { makeState } = await import('../public/src/progression/state.js');
const thrown = makeState(throwCtx).readMetrics();
for (const k of Object.keys(M.METRICS)) {
  const r = thrown[k];
  ok('  throwing reader / ' + k + ' is contained and reads unavailable, not 0',
     r && r.ok === false && r.value === undefined, r && r.ok ? 'RETURNED A VALUE: ' + r.value : null);
  clean('  throwing reader / ' + k + '.why', r && r.why);
  /* The caption survives the throw: the row still says where the number would
     have come from, which is the half a delete-the-line fix would lose. */
  clean('  throwing reader / ' + k + '.source', r && r.source);
  ok('  throwing reader / ' + k + ' still carries its caption', !!(r && r.source && r.label));
}
for (const a of M.ACHIEVEMENTS) {
  let r;
  try { r = a.test({}, null); } catch (e) { r = { ok: false, why: 'THREW OUT: ' + e.message }; }
  ok('  ' + a.id + '.test({}, null) answered', !!r && typeof r === 'object');
  if (r && !r.ok) clean('  ' + a.id + '.why', r.why);
  else ok('  ' + a.id + ' degraded cleanly', r && r.ok === true, 'ok:true with at=' + trunc(r && r.at));
}

/* The three `why` strings that live outside milestones.js but are printed by
   the same panel: state.js licenceState + the two catch arms, and the unknown
   metric fallback in report(). Source-regexed for the same reason as above. */
console.log('\n4. the why strings the other two files own');
const whys = [
  ...[...stateSrc.matchAll(/why:\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => ['state.js', m[1]]),
  ...[...indexSrc.matchAll(/why:\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => ['index.js', m[1]]),
];
ok('  found the why literals to check', whys.length >= 5, whys.length + ' found');
for (const [f, w] of whys) clean('  ' + f + ' why', w);
const fallback = /source:\s*'((?:[^'\\]|\\.)*)'/.exec(indexSrc.slice(indexSrc.indexOf('Not measured')));
ok('  the unknown-metric row has a caption of its own', !!fallback);
if (fallback) clean('  unknown-metric source', fallback[1]);

/* ── 5. the renderers still RENDER — a fix by deletion fails here ──────── */
console.log('\n5. the fix was not made by deleting the line');
ok('  panel.js still prints the milestone caption',
   panelSrc.includes("esc(m.label) + ' — ' + esc(m.source)"));
ok('  panel.js still prints the achievement caption',
   /pgrsrc">'\s*\+\s*esc\(a\.how\)/.test(panelSrc));
ok('  panel.js still prints the sources block',
   panelSrc.includes("esc(s.label) + ' — ' + esc(s.source)"));
ok('  the sources block still has its heading',
   panelSrc.includes('Where these numbers come from'));
ok('  report() still carries source onto every milestone row',
   /source:\s*met\.source/.test(indexSrc));
ok('  report() still carries how onto every achievement row',
   /how:\s*a\.how/.test(indexSrc));
ok('  the card-reward disclosure was reworded, not dropped',
   /not switched on yet/.test(panelSrc) && /reward: reserved/.test(panelSrc),
   'the only place a player is told card rewards are not live');

/* ── 6. every caption, printed for a human ─────────────────────────────────
   REPORTED, NOT ASSERTED. "Does this still answer where the number came from"
   is a reading, not a regex, and a driver that pretended otherwise would be
   green on a caption that says nothing. */
console.log('\n6. READ THESE — each must still answer "where did this number come from"');
for (const k of Object.keys(M.METRICS)) {
  console.log('   ' + M.METRICS[k].label + ' — ' + M.METRICS[k].source);
  console.log('        trace (never shown): ' + M.METRICS[k].trace);
}
for (const a of M.ACHIEVEMENTS) {
  console.log('   ' + a.name + ' — ' + a.how);
  console.log('        trace (never shown): ' + a.trace);
}
for (const s of pushes) console.log('   · ' + s);

console.log(fails ? '\n' + fails + ' CHECK(S) FAILED' : '\nALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
