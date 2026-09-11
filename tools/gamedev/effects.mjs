#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// effects.mjs — run the in-app effect harness (`window.__mg.testEffect`, defined
// in public/index.html) HEADLESS, over every registered ONPLAY_TYPES id or a
// chosen few. This is the fastest way to prove a new card effect actually does
// something, before opening a browser.
//
//   node tools/gamedev/effects.mjs                    # sweep every effect
//   node tools/gamedev/effects.mjs heal drawCards     # just these
//   node tools/gamedev/effects.mjs heal --opts '{"amount":5,"radius":3}'
//   node tools/gamedev/effects.mjs --json             # machine-readable rows
//   node tools/gamedev/effects.mjs --strict           # exit 1 on QUIET too (default: only on THREW)
//   node tools/gamedev/effects.mjs --show heal        # print the full before/after diff + log
//
// Verdicts (from the harness itself):
//   ✅ works    — the sandbox state changed
//   ⏳ queued   — the effect opened a target chooser (correct: it needs a pick)
//   ⚠ quiet    — nothing changed. NOT automatically a bug: the fixture board may
//                lack what the effect needs (a matching tribe, a void card, a
//                held item…). Treat a NEW effect going quiet as a red flag; treat
//                a long-standing one as "needs a richer fixture" — see the
//                baseline list in tools/gamedev/effects.baseline.json.
//   ❌ threw    — a JS exception. ALWAYS a bug.
//
// The baseline file records which effects were quiet when this tool was added,
// so `--strict` only fails on effects that REGRESS to quiet, not the known set.
// Regenerate it deliberately with --write-baseline after improving the fixture.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine, argFlag, argValue, positional } from './headless.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASELINE = join(__dirname, 'effects.baseline.json');

const eng = loadEngine();
if (typeof eng.mg.testEffect !== 'function') {
  console.error('window.__mg.testEffect is not defined in public/index.html — the in-app harness moved or was removed.');
  process.exit(2);
}
const wanted = positional(['opts', 'show']);
const showId = argValue('show');
const opts = argValue('opts') ? JSON.parse(argValue('opts')) : {};
const ids = wanted.length ? wanted : (eng.ONPLAY_TYPES || []).map((t) => t.id);
const registered = new Set((eng.ONPLAY_TYPES || []).map((t) => t.id));

const rows = [];
for (const id of ids) {
  const r = eng.mg.testEffect(id, opts);
  const kind = r.error ? 'threw' : r.awaitingTarget ? 'queued' : Object.keys(r.changed || {}).length ? 'works' : 'quiet';
  rows.push({ id, kind, registered: registered.has(id), changed: Object.keys(r.changed || {}), error: r.error || null, log: r.log || [], full: r });
}

if (showId) {
  const r = rows.find((x) => x.id === showId) || (() => { const f = eng.mg.testEffect(showId, opts); return { id: showId, full: f }; })();
  console.log(JSON.stringify({ ...r.full, args: undefined }, null, 2));
  process.exit(0);
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { quiet: [] };
if (argFlag('write-baseline')) {
  const quiet = rows.filter((r) => r.kind === 'quiet').map((r) => r.id).sort();
  writeFileSync(BASELINE, JSON.stringify({ note: 'Effects that change nothing in the __mg.testEffect fixture. Known, not necessarily bugs. Regenerate with: node tools/gamedev/effects.mjs --write-baseline', generated: new Date().toISOString().slice(0, 10), quiet }, null, 1) + '\n');
  console.log('wrote ' + BASELINE + ' (' + quiet.length + ' quiet effects)');
}

if (argFlag('json')) { console.log(JSON.stringify(rows.map(({ full, ...r }) => r), null, 1)); }
else {
  const icon = { works: '✅', queued: '⏳', quiet: '⚠ ', threw: '❌' };
  rows.forEach((r) => console.log('  ' + icon[r.kind] + ' ' + r.id.padEnd(20) + (r.kind === 'threw' ? r.error : r.changed.join(', ')) + (!r.registered ? '   (not in ONPLAY_TYPES)' : '')));
  const c = (k) => rows.filter((r) => r.kind === k).length;
  console.log('\n' + rows.length + ' effects: ' + c('works') + ' work, ' + c('queued') + ' queued for targeting, ' + c('quiet') + ' quiet, ' + c('threw') + ' threw   (engine load ' + eng.loadMs + ' ms)');
}

const threw = rows.filter((r) => r.kind === 'threw');
const newQuiet = rows.filter((r) => r.kind === 'quiet' && !baseline.quiet.includes(r.id));
if (newQuiet.length) console.error('\n⚠ quiet and NOT in the baseline (new or regressed): ' + newQuiet.map((r) => r.id).join(', '));
if (threw.length) { console.error('\n❌ ' + threw.length + ' effect(s) threw — that is always a bug.'); process.exit(1); }
if (argFlag('strict') && newQuiet.length) process.exit(1);
