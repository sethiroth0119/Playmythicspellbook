#!/usr/bin/env node
// ============================================================================
// 🔁 CROSS-DEVICE SAVE AUDIT
// ----------------------------------------------------------------------------
// WHY THIS EXISTS
// Cross-device progress is a HAND-MAINTAINED WHITELIST WITH TWO HALVES. As the
// comment on __aiTrade__ in index.html puts it:
//
//     "Profile.* is NOT synced automatically; a key only travels if it is named
//      here AND read back in the hydration block. Without both halves a signed
//      contract would quietly vanish on the next device."
//
// Add a field to Profile, save it to localStorage, forget the upload half, and
// the game is perfect on your machine and silently lossy on everybody else's.
// That has already happened to itemInventory, archonDeck, sideDeck,
// socketedGems, heroLoadouts, bagsOwned/bagCap, gearResetApplied,
// purgeResetApplied and seasonResetApplied — every one found only after players
// lost the data. The failure is invisible in review and invisible in testing on
// one device. This script is what makes it visible.
//
// WHAT IT CHECKS
//   A. Uploaded but never hydrated — written to the cloud, never read back.
//   B. Restored from local hg_profile but never uploaded — the real killer:
//      the field persists on THIS device, so it looks like it works, and is
//      gone the moment the player signs in anywhere else.
//
// Run it before a deploy:  node _syncaudit.mjs
// Exit 1 means a field regressed. Add it to the payload AND the hydration
// block, or to KNOWN_DEVICE_LOCAL below with a reason.
// ============================================================================

import { readFileSync } from 'node:fs';

const FILE = 'public/index.html';

// Fields that are DELIBERATELY device-local. Every entry needs a reason — an
// unexplained entry here is just a silenced bug.
const KNOWN_DEVICE_LOCAL = {
  replays:      'Battle replay blobs. Large, regenerable, and worthless on another device.',
  bagTier:      'Derived — _recalcBagCap() recomputes it from _bagsOwned(), which DOES sync (__bagsOwned__).',
  resources:    'Legacy pre-_resMergedV1 bag; folded into the live ledger on load and never re-read.',
  settings:     'Sent as its own user_profiles column, not via the forge JSONB.',
};

// Balances are server-canonical: sql/024-026 moved them to a ledger and REVOKED
// the column privileges, so they must never appear in the upsert. Not a gap.
const SERVER_CANONICAL = ['gems', 'sovereigns', 'lockedGems', 'lockedSov'];

// Dedicated user_profiles columns in the upsert row.
const COLUMNS = ['records', 'competitive', 'heroes', 'units', 'deckHistory',
                 'deckByHero', 'settings', 'account', 'cloud'];

const src = readFileSync(FILE, 'utf8');
const lines = src.split('\n');

// --- Locate the upload payload by content, not line number, so this does not
// --- rot the next time something is inserted above it.
function findRegion(startRe, endRe, label) {
  const start = lines.findIndex(l => startRe.test(l));
  if (start < 0) throw new Error(`could not locate the start of ${label} (${startRe})`);
  const end = lines.findIndex((l, i) => i > start && endRe.test(l));
  if (end < 0) throw new Error(`could not locate the end of ${label} (${endRe})`);
  return { start, end, text: lines.slice(start, end + 1).join('\n') };
}

const upload = findRegion(/const forgeSmall = \{/, /updated_at:\s*new Date\(\)\.toISOString\(\)/, 'the upload payload');

// The local hg_profile restore block: starts at the defensive JSON.parse, ends
// where the profile fields stop being read off `p`.
const localStart = lines.findIndex(l => /hg_profile is corrupt\/truncated/.test(l));
if (localStart < 0) throw new Error('could not locate the local hg_profile restore block');
let localEnd = localStart;
for (let i = localStart; i < Math.min(localStart + 600, lines.length); i++) {
  if (/\bp\.\w+/.test(lines[i])) localEnd = i;
}
const localText = lines.slice(localStart, localEnd + 1).join('\n');

const uploaded  = new Set([...upload.text.matchAll(/\bProfile\.(\w+)/g)].map(m => m[1]));
const hydrated  = new Set([...src.matchAll(/\.(__\w+__)/g)].map(m => m[1]));
const forgeKeys = new Map();
for (const m of upload.text.matchAll(/(__\w+__)\s*:\s*[^,\n]*?Profile\.(\w+)/g)) {
  if (!forgeKeys.has(m[1])) forgeKeys.set(m[1], m[2]);
}
const localRead = new Set([...localText.matchAll(/\bp\.(\w+)\b/g)].map(m => m[1]));

const synced = new Set([...uploaded, ...COLUMNS, ...SERVER_CANONICAL]);

console.log('🔁 Cross-device save audit');
console.log(`   upload payload   : ${FILE}:${upload.start + 1}-${upload.end + 1}`);
console.log(`   local restore    : ${FILE}:${localStart + 1}-${localEnd + 1}`);
console.log(`   forge keys       : ${forgeKeys.size} uploaded, ${[...forgeKeys.keys()].filter(k => hydrated.has(k)).length} hydrated`);
console.log(`   Profile fields   : ${uploaded.size} on the payload, ${localRead.size} restored from local\n`);

let bad = 0;

// --- A. uploaded, never read back
const orphans = [...forgeKeys.keys()].filter(k => !hydrated.has(k)).sort();
if (orphans.length) {
  bad += orphans.length;
  console.log(`❌ A. UPLOADED BUT NEVER HYDRATED (${orphans.length})`);
  console.log('   Written to the cloud and never restored — the upload is dead weight.');
  for (const k of orphans) console.log(`      ${k}  <- Profile.${forgeKeys.get(k)}`);
  console.log();
} else {
  console.log('✅ A. Every uploaded forge key is read back.\n');
}

// --- B. restored locally, never uploaded  (the one that actually loses data)
const lost = [...localRead].filter(f => !synced.has(f) && !KNOWN_DEVICE_LOCAL[f]).sort();
if (lost.length) {
  bad += lost.length;
  console.log(`❌ B. LOST ON A NEW BROWSER OR DEVICE (${lost.length})`);
  console.log('   Restored from localStorage, never uploaded. Works on the device that');
  console.log('   made it; gone everywhere else. This is the bug players report.');
  for (const f of lost) {
    const m = new RegExp(`^.*\\bp\\.${f}\\b.*$`, 'm').exec(localText);
    const note = m && /\/\/\s*(.+)$/.exec(m[0]);
    console.log(`      Profile.${f}${note ? '  — ' + note[1].trim() : ''}`);
  }
  console.log();
} else {
  console.log('✅ B. Every locally-restored field also travels to the cloud.\n');
}

if (Object.keys(KNOWN_DEVICE_LOCAL).length) {
  console.log('ℹ  Intentionally device-local:');
  for (const [f, why] of Object.entries(KNOWN_DEVICE_LOCAL)) console.log(`      Profile.${f} — ${why}`);
  console.log();
}

if (bad) {
  console.log(`💥 ${bad} field${bad === 1 ? '' : 's'} would not survive a device change.`);
  console.log('   Fix: add each to the forge payload AND the hydration block (both halves),');
  console.log('   or to KNOWN_DEVICE_LOCAL with a reason.');
  process.exit(1);
}
console.log('✅ Cross-device save surface is complete.');
