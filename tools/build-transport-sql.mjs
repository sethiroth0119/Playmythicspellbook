#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
   🚛 BUILD-TRANSPORT-SQL — assemble the whole freight business into ONE file
   that can be pasted into the Supabase SQL editor in a single go.

   🔴 WHY A GENERATOR AND NOT A HAND-WRITTEN BUNDLE. The obvious way to ship
      "one file with all the transport SQL" is to paste the four migrations into
      a fifth file. That file is a SECOND COPY of ~4,700 lines, and the first
      time anyone edits 073 to fix a policy, the bundle keeps the old one — and
      the bundle is the file people actually run. This repo has already paid for
      that class of mistake twice (the stale FAT snapshot in v118m4; the
      migration-re-run hazard that put sql/075's gate in a trigger instead of
      inside transport_quote). A generated file cannot drift: the four
      migrations remain the only authority, and this reassembles them.

   ORDER IS NOT ALPHABETICAL, IT IS DEPENDENCY ORDER:
     073  the business  — charters, rigs, contracts, ledger, config, the money
     074  the board     — haul requests, the offer step before a shipment
     075  the depot gate— the node index + "freight needs a depot to land at"
     076  the earnings  — the index fix, the unloading fee and the claim

   ⚠ 075 §4 (THE SWITCH) is emitted before 075 §3 (THE READERS) because that is
     the order inside the file itself — transport_depot_gate() is `language sql`
     and Postgres validates its body at CREATE, so the config column has to
     exist first. Nothing here re-orders anything; the files are emitted whole.

   Run:  node tools/build-transport-sql.mjs
   Out:  sql/RUN_TRANSPORT_ALL.sql   (regenerate; never hand-edit)
   ══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const PARTS = [
  ['073_transport_companies.sql', 'THE BUSINESS — charters, rigs, contracts, the ledger, the caps, the money path'],
  ['074_haul_requests.sql',       'THE BOARD — a shipper posts, a carrier accepts (atomic)'],
  ['075_node_depot_index.sql',    'THE DEPOT GATE — which nodes can receive freight, and the refusal'],
  ['076_depot_earnings.sql',      'THE EARNINGS — the index fix, the unloading fee, and claiming it'],
];

const stamp = process.argv.includes('--stamp') ? process.argv[process.argv.indexOf('--stamp') + 1] : null;
const bar = '-- ' + '═'.repeat(74);
let out = [
  bar,
  '-- 🚛 MYTHIC SPELLBOOK — THE TRANSPORT BUSINESS, WHOLE, IN ONE PASTE',
  '--',
  '-- 🔴 GENERATED FILE. DO NOT EDIT. Edit the migrations it is built from and',
  '--    re-run:  node tools/build-transport-sql.mjs',
  '--    Hand-editing this file makes it disagree with the four files that are',
  '--    the authority, and this is the one people run.',
  '--',
  '-- Paste the whole thing into the Supabase SQL editor for project',
  '-- ktsiasyjusesawtrwrjc and run it. Every part is idempotent and re-runnable:',
  '-- running it against a database that already has the feature changes nothing',
  '-- and re-asserts every policy, cap and trigger.',
  '--',
  '-- ⚠ IT ENDS WITH FOUR VERIFY BLOCKS, one per part. They are SELECTs, so the',
  '--   editor shows only the last result set — run each part separately if you',
  '--   want to read all four.',
  '--',
  '-- WHAT IS IN HERE, in dependency order:',
  ...PARTS.map(([f, what], i) => '--   ' + (i + 1) + '. ' + f.padEnd(30) + what),
  stamp ? '--\n-- Assembled ' + stamp : null,
  bar,
  '',
].filter(x => x !== null);

let lines = 0;
for (const [file, what] of PARTS) {
  const p = path.join(ROOT, 'sql', file);
  const src = fs.readFileSync(p, 'utf8');
  lines += src.split('\n').length;
  out.push('', bar, '-- ▓▓▓ ' + file + ' — ' + what, bar, '', src.replace(/\s+$/, ''), '');
}

const dest = path.join(ROOT, 'sql', 'RUN_TRANSPORT_ALL.sql');
fs.writeFileSync(dest, out.join('\n') + '\n');
console.log('✅ sql/RUN_TRANSPORT_ALL.sql — ' + PARTS.length + ' migrations, ' +
            lines.toLocaleString() + ' source lines, ' +
            Math.round(fs.statSync(dest).size / 1024) + ' KB');
