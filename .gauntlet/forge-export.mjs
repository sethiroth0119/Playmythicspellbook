#!/usr/bin/env node
/* 🧯 FORGE EXPORT / RESTORE / DIFF — the undo the Forge remodel does not have.

   WHY THIS EXISTS
   ───────────────
   The remodel pieces queued behind this one rewrite five live structures on a
   game with real money in it:

     Forge.customCards   index.html:50517 — array, ids in `.id`
     Forge.customMoves   index.html:50523 — MAP keyed by move id, not an array
     Profile.decks       index.html:60307 — array of saved deck entries
     Profile.deckByHero  index.html:60320 — the legacy {heroId: {name,cards}} map
     Profile.archonDeck  index.html:48049 — the Realm roster ({cards:[...keys]})

   Before this file there was no export of those five and no way back. The
   in-game backup panel (index.html:80392 buildExportPayload) writes the whole
   world — sprites, cardArt, market, camp — which is too big to diff and too
   blunt to restore from: importing it non-merge REPLACES every Profile key
   (index.html:80521), wallet included. A migration review needs the opposite:
   the five fields, nothing else, byte-stable, diffable.

   THREE RULES THIS TOOL IS BUILT AROUND, each one a bug already paid for
   somewhere in this repo:

   1. RESTORE IS SURGICAL. It writes those five paths and touches nothing else.
      `gems` and `sovereigns` are real money (index.html:48049 block) and a
      restore that dragged a stale wallet back with the decks would be a mint.

   2. AN ABSENT FIELD IS NOT AN EMPTY ONE. A snapshot that has no `archonDeck`
      key means "this file does not know about the Realm roster", never "the
      Realm roster is empty". Restore SKIPS it. This is the same erase guard
      .gauntlet/save-payload-check.mjs proves for the city save, and it exists
      because writing a confident empty over player data is how saves die.

   3. BOTH DECK FIELDS TRAVEL TOGETHER. `Profile.decks` is the source of truth
      but the cloud column literally named `decks` holds the legacy
      `deckByHero` map (index.html:51083, :51846). A migration that rewrites
      one and not the other gets the old shape pushed back down from the cloud
      on the next boot, so an export that captured only one would prove
      nothing.

   4. AN UNREADABLE FIELD IS NEITHER OF THOSE. Rule 2 says an absent key means
      "this file does not know". A source that is PRESENT and does not yield
      the structure — a truncated hg_profile, a clipboard that ran out
      mid-copy, hg_customCards holding the four characters `null` — used to be
      quietly folded into rule 2 and read as an empty object. Measured on the
      seeded save: the export exited 0 having dropped 3 of the 5 structures,
      and a restore INTO that dump rewrote hg_profile from 8 keys to 3, taking
      gems 4242 and sovereigns 7 with it, and reported "0 difference(s)".
      Now: fileStore THROWS and names the STRUCTURE and the source it came
      from. `--allow-unreadable` takes a read-only salvage export instead,
      stamped `unreadable`, which restore refuses unconditionally — --force
      included.
      ⚠ THE GUARD IS AT THE RESOLVE POINT, IN ONE SHARED PASS EVERY STORE
      GOES THROUGH — not at a string parse, and not inside one store. Two
      revisions were needed to get that right and both failures are worth
      keeping in view:
        · guarding only the localStorage JSON.parse left four documented input
          shapes wide open (below);
        · guarding only inside `fileStore` left `memoryStore` — the entry
          point this header documents for migration pieces, and the one the
          live-data migrations will actually call — with no resolve pass and
          no unreadable list at all. `snapshotOf(memoryStore({Forge, Profile}))`
          with a 900-char-truncated Profile returned counts {customCards:30,
          customMoves:12, decks:null, deckByHero:null, archonDeck:null} and no
          stamp: the original signature, still reachable inside the fixed tool.
          See the `memory-truncated-profile` mutant and section 9c.
      A store now only says what its containers are and what to call them; it
      cannot forget to refuse, and neither can the next one added.
      The first revision guarded only the
      localStorage branch's JSON.parse, and shipped a note claiming the other
      shapes "hold already-parsed objects, so there is no string parse to fail
      there". FALSE, and measured false: a payload `{forge:{…},profile:"<cut
      to 900 chars>"}`, the same as `{Forge,Profile}`, a snapshot from THIS
      tool with data.profile swapped for a string, and `hg_customCards:"null"`
      each reproduced the pre-fix signature exactly — exit 0, file WRITTEN,
      3 of 5 printed ABSENT, verify said OK. `null` is the proof a parse guard
      can never be enough: nothing failed to parse and the structure still was
      not there. The question asked is "did this source yield the structure",
      once, wherever it arrived from. See `mutant` in USAGE.

   5. THE SALVAGE STAMP MUST NOT LAUNDER OFF. A salvage export is a snapshot,
      and a snapshot is a legal store shape, so `export --from salvage.json
      --out clean.json` exited 0 and handed back a file with the SAME sha256
      and NO stamp — a refused backup turned restorable by one ordinary
      command, and the sha256 matching is what made it look trustworthy. The
      stamp is now inherited at the READ (fileStore), so every path that
      copies the data carries it: re-export refuses outright, --allow-unreadable
      re-export stays stamped, restore --into it refuses, verify exits 2, and
      diff never reports a salvage side as identical.

   ⚠ ONE SOURCE CAVEAT, on purpose: localStorage `hg_customCards` is the
     data-URL-STRIPPED fast path (index.html:77206); the cards with their art
     live in IndexedDB. Exporting from a localStorage dump therefore captures
     card DATA, not card ART. The snapshot records which source it came from
     and `verify` prints it, so nobody restores art they never exported.

   USAGE
     node .gauntlet/forge-export.mjs selftest
         Proves the round trip end to end and prints the numbers.
     node .gauntlet/forge-export.mjs export --from <store.json> [--out <dir|file>]
         Writes .gauntlet/forge-backups/forge-export-<stamp>.json
         Exits 1 and writes NOTHING if any of the five is present-but-unreadable,
         or if <store.json> is itself a salvage export.
         [--allow-unreadable] downgrades that to a read-only salvage export
         (forge-salvage-<stamp>.json) that restore will always refuse. A salvage
         re-exported this way stays stamped — the mark does not come off.
     node .gauntlet/forge-export.mjs restore <snapshot.json> --into <store.json> [--dry-run]
     node .gauntlet/forge-export.mjs diff <a.json> <b.json>
         Exit 0 = identical, 2 = differences, 1 = tool error.
     node .gauntlet/forge-export.mjs verify <snapshot.json>
     node .gauntlet/forge-export.mjs seed <out.json> [--decks 5 --cards 30 --moves 12]
     node .gauntlet/forge-export.mjs mutant <name>   (`mutant list` for the names)
         Builds one known bypass and runs the REAL tool on it, so the exit code
         and message are the tool's own. Six must be REFUSED — five with no file
         written, and `memory-truncated-profile` with no snapshot returned,
         since the module entry point writes no file to begin with;
         `empty-control` must EXPORT at exit 0 with every count 0, because a
         guard that refuses everything is not a guard. Sections 9 and 9c of the
         selftest run all seven.

   <store.json> is any of: a browser localStorage dump
   (`copy(JSON.stringify(localStorage))` in devtools), an in-game backup
   payload ({forge,profile}), a snapshot this tool wrote, or {Forge,Profile}.
   Restore writes back in the SAME shape it read, leaving every other key
   in the file alone.

   As a module — this is how a migration piece and its smoke test snapshot a
   sandboxed Profile/Forge before and after the migration and diff the two:

     import { snapshotOf, restoreInto, diffData, formatDiff, memoryStore,
              fileStore, seedWorld } from './forge-export.mjs';
     const before = snapshotOf(memoryStore({ Forge, Profile }));
     migrate();                                    // the piece under review
     console.log(formatDiff(diffData(before.data, snapshotOf(memoryStore({ Forge, Profile })).data)));
     restoreInto(memoryStore({ Forge, Profile }), before);        // and back

   memoryStore refuses the same shapes the CLI does — a Profile that is a
   truncated JSON string, a Forge.customCards holding null — by THROWING, so a
   migration piece cannot get a partial `before` and only discover it when it
   tries to undo. Build the store next to the read (as above): it resolves the
   five once, at construction, and answers reads from that.

   ⚠ Importing by ABSOLUTE path on Windows needs a file:// URL —
     `import(...'D:/game-deploy/.gauntlet/forge-export.mjs')` fails with
     ERR_UNSUPPORTED_ESM_URL_SCHEME. Use a relative specifier, or
     'file:///D:/game-deploy/.gauntlet/forge-export.mjs'. */

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';   // selftest only — it drives the real CLI, exit codes included
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const TOOL = 'mythic-forge-export';
const FORMAT_VERSION = 1;

/* The five, and how each one is shaped. `kind` drives both the in-place
   restore and the counter — customMoves being a MAP and customCards an ARRAY
   is the single most common way code in index.html gets these two wrong. */
export const FIELDS = [
  { key: 'customCards', owner: 'forge',   path: 'Forge.customCards',  kind: 'array',  ls: 'hg_customCards' },
  { key: 'customMoves', owner: 'forge',   path: 'Forge.customMoves',  kind: 'map',    ls: 'hg_customMoves' },
  { key: 'decks',       owner: 'profile', path: 'Profile.decks',      kind: 'array',  ls: null },
  { key: 'deckByHero',  owner: 'profile', path: 'Profile.deckByHero', kind: 'map',    ls: null },
  { key: 'archonDeck',  owner: 'profile', path: 'Profile.archonDeck', kind: 'object', ls: null },
];
const FIELD_BY_KEY = new Map(FIELDS.map(f => [f.key, f]));

// ───────────────────────────── small shared helpers ─────────────────────────
const isPlain = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/* JSON clone on purpose, not structuredClone: every one of these five reaches
   disk through JSON.stringify (saveProfile index.html:79363, saveForge
   :77200), so a snapshot must contain exactly what persistence would keep —
   undefined dropped, Dates flattened. A snapshot that held MORE than the game
   can save would make a clean diff a lie. */
function clone(v) {
  try { return JSON.parse(JSON.stringify(v)); }
  catch (e) { throw new Error('value is not JSON-serialisable (cycle?): ' + e.message); }
}

/* Canonical JSON = same bytes for the same data whatever the key order, so the
   sha256 survives a round trip through JSON.parse/stringify and can be
   recomputed by anyone. */
function canon(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
}
const sha256 = s => createHash('sha256').update(s, 'utf8').digest('hex');
export const hashData = data => sha256(canon(data));

function countOf(key, v) {
  if (v === undefined || v === null) return null;
  if (key === 'archonDeck') return Array.isArray(v.cards) ? v.cards.length : 0;
  return Array.isArray(v) ? v.length : Object.keys(v).length;
}
/* The id list a reviewer counts against. Duplicated from `data` on purpose —
   `verify` recomputes it and fails if it drifted, which turns the duplication
   into a checkable invariant instead of a second source of truth. */
function indexOf_(data) {
  const cards = data.forge && data.forge.customCards;
  const decks = data.profile && data.profile.decks;
  const moves = data.forge && data.forge.customMoves;
  const byHero = data.profile && data.profile.deckByHero;
  return {
    cardIds: Array.isArray(cards) ? cards.map(c => (c && c.id !== undefined) ? c.id : null) : null,
    moveIds: isPlain(moves) ? Object.keys(moves) : null,
    deckIds: Array.isArray(decks) ? decks.map(d => (d && d.id !== undefined) ? d.id : null) : null,
    heroIds: isPlain(byHero) ? Object.keys(byHero) : null,
  };
}

// ─────────────────────────── THE RESOLVE PASS ───────────────────────────────
/* ONE implementation, shared by every store, and every store that is ever
   added inherits it by construction.

   🔴 THE DEFECT THIS CLOSES. The refusal used to be written INSIDE fileStore,
   so it guarded the CLI and nothing else. `memoryStore` — the entry point this
   file's own header documents for a migration piece to call, and the one the
   live-data migrations will actually run — had no resolve pass and no
   `unreadable` list, so the original silent-partial-backup signature was still
   reachable inside the fixed tool, byte for byte. Measured, before this block
   existed, with the same 900-char truncation section 8 uses:

     snapshotOf(memoryStore({ Forge, Profile: <profile JSON cut to 900 chars> }))
     → no throw, absent ["Profile.decks","Profile.deckByHero","Profile.archonDeck"],
       counts {customCards:30, customMoves:12, decks:null, deckByHero:null,
       archonDeck:null}, NO salvage stamp

   That is 3 of the 5 dropped, and `absent` is defined at the top of this file
   to mean "the source does not know about it" — a lie a migration would then
   restore from. `memoryStore({Forge, Profile: {…, customCards: null}})` reached
   it too, because snapshotOf reads null as absent.

   So the guard lives HERE, at the point where a structure is resolved out of a
   source, not in any one store. A store's only job is to say, per owner, what
   its container is and what to call it in the message. See the
   `memory-truncated-profile` mutant. */
const typeName = v => Array.isArray(v) ? 'an array'
  : v === null ? 'null'
  : typeof v === 'object' ? 'an object'
  : 'a ' + typeof v;

/* WHY a container is unusable, in the words a human needs to fix it. A string
   that will not parse is a copy that ran out; one that parses is a dump
   written in a shape this tool does not read. Both refuse: neither can say
   what the five structures are, which is the only question being asked. */
const whyBadBag = (v) => {
  if (typeof v === 'string') {
    try { return 'a JSON string holding ' + typeName(JSON.parse(v)) + ', not the object itself'; }
    catch (e) { return 'a string that will not parse as JSON (' + e.message + ') — a truncated copy?'; }
  }
  return typeName(v) + ', not an object';
};

const WANT = { array: 'an array', map: 'an object (a MAP keyed by id)', object: 'an object' };

/* spec.bag(owner)     → the container, or undefined/null for "no such bag"
   spec.source(field)  → what to call that source in the message
   spec.badBag(owner)  → why the container itself is unusable, or null
   spec.badLeaf(field) → why this one field's own source is unusable, or null
                         (localStorage keeps customCards/customMoves in two
                         separate keys, so a bad one is not a bad bag)
   Returns { resolved, unreadable, listUnreadable } and THROWS unless
   opts.allowUnreadable, in which case the caller must expose `unreadable` so
   the snapshot gets stamped and restore refuses it.
   opts.into lets a caller pass an array that ALREADY holds entries — fileStore
   seeds it with the inherited salvage stamp, which must be named by the same
   refusal and must count towards it even when all five structures resolve. */
function resolveStructures(where, spec, opts = {}) {
  const unreadable = opts.into || [];   // one entry per STRUCTURE that is present-but-unreadable
  const resolved = new Map();
  for (const f of FIELDS) {
    const src = spec.source(f);
    const bad = spec.badBag(f.owner);
    if (bad) { unreadable.push({ key: f.path, error: 'source ' + src + ' is ' + bad }); continue; }
    const leaf = spec.badLeaf ? spec.badLeaf(f) : null;
    if (leaf) { unreadable.push({ key: f.path, error: 'source ' + src + ' ' + leaf }); continue; }
    const b = spec.bag(f.owner);
    const v = b ? b[f.key] : undefined;
    if (v === undefined) continue;                       // rule 2 — genuinely absent
    /* The question is not "did a string parse" but "did this source YIELD the
       structure". `null` is the proof a parse guard can never be enough:
       nothing failed to parse and the structure still is not there. */
    if (!(f.kind === 'array' ? Array.isArray(v) : isPlain(v))) {
      unreadable.push({ key: f.path, error: 'source ' + src + ' holds ' + typeName(v) + ' for ' + f.key +
        ', where ' + WANT[f.kind] + ' was expected' });
      continue;
    }
    resolved.set(f.key, v);                              // present, right shape — EMPTY is fine here
  }
  const listUnreadable = () => unreadable.map(u => u.key + ' (' + u.error + ')').join('; ');
  if (unreadable.length && !opts.allowUnreadable) {
    throw new Error(where + ': UNREADABLE SOURCE — ' + listUnreadable() + '.\n' +
      '  Refusing to read an unreadable structure as empty. That is not "this save has no decks", it is ' +
      '"this file cannot be trusted to say", and the difference is the whole point of a backup tool.\n' +
      (spec.advice || ''));
  }
  return { resolved, unreadable, listUnreadable };
}

// ───────────────────────────────── stores ───────────────────────────────────
/* A store is the seam between the five fields and wherever they live: live
   objects inside a vm sandbox, or a JSON file on disk. Everything above this
   line works on either. */

/* Live Forge/Profile objects — what a migration piece and its smoke test hold.
   This is THE documented module entry point (see the header), which is exactly
   why it resolves through the shared pass above instead of reading the bags
   raw: `Profile` handed in as a truncated JSON string, or `Forge.customCards`
   holding null, must refuse here for the same reason the CLI refuses a
   truncated dump — the caller is about to rewrite the real thing.
   opts.allowUnreadable mirrors fileStore: a READ-ONLY salvage store, stamped
   by snapshotOf and refused by restoreInto. */
export function memoryStore(world, label, opts = {}) {
  /* Not `world || {}`: a null/string world defaulted to {} would read as five
     genuinely-absent fields and snapshot 0 of 5 without a word — the same
     silent partial this whole file exists to stop, one level further out. */
  if (!isPlain(world)) throw new Error('memoryStore needs an object holding { Forge, Profile } — got ' + typeName(world));
  const bag = owner => (owner === 'forge' ? world.Forge : world.Profile);
  const NAME = { forge: 'Forge', profile: 'Profile' };
  const { resolved, unreadable, listUnreadable } = resolveStructures(
    'memoryStore(' + (label || 'in-memory Forge/Profile') + ')',
    {
      bag,
      source: f => NAME[f.owner],
      /* Absent is still nothing (rule 2): a world with no Forge at all reads as
         five absent fields, as it always did. PRESENT and not an object is the
         truncated-copy case and refuses. */
      badBag: owner => { const b = bag(owner); return (b === undefined || isPlain(b)) ? null : whyBadBag(b); },
      advice:
        '  The live Forge/Profile handed to memoryStore() is what the caller is about to rewrite, so a\n' +
        '  snapshot that quietly dropped 3 of the 5 would be the undo path failing exactly when it is\n' +
        '  needed. Pass the real objects, or memoryStore(world, label, { allowUnreadable: true }) for a\n' +
        '  READ-ONLY salvage snapshot, which restore refuses — --force included.',
    },
    { allowUnreadable: opts.allowUnreadable },
  );
  return {
    unreadable,                 // [] on a healthy world; non-empty only under allowUnreadable
    describe: () => ({ kind: 'memory', label: label || 'in-memory Forge/Profile' }),
    /* From the RESOLVE PASS, never from the raw bag, so a structure the source
       could not say has no path back to "undefined, therefore absent". */
    read(key) { return resolved.has(key) ? resolved.get(key) : undefined; },
    write(key, value) {
      if (unreadable.length) throw new Error('refusing to WRITE into a store with unreadable key(s) — ' + listUnreadable());
      const f = FIELD_BY_KEY.get(key);
      const b = bag(f.owner);
      if (!b) throw new Error('store has no ' + NAME[f.owner]);
      writeInPlace(b, key, f.kind, value);
      // read() answers from `resolved`, so a write has to land there too or the
      // store would keep reporting the value it had before the restore.
      resolved.set(key, b[key]);
    },
    commit() {
      if (unreadable.length) throw new Error('refusing to COMMIT a store with unreadable key(s) — ' + listUnreadable());
    },
  };
}

/* IN PLACE, not by assignment. index.html hands these containers out by
   reference all over (getAllDecks(), the deck builder's `list`, the battle
   archon reader at :114191). A restore that assigned a fresh array would leave
   every one of those holding the corrupted copy the migration made, and the
   damage would reappear on the next save. Container identity is part of the
   contract; the selftest checks it. */
function writeInPlace(bag, key, kind, value) {
  const v = clone(value);
  if (kind === 'array') {
    if (!Array.isArray(bag[key])) { bag[key] = v; return; }
    bag[key].length = 0;
    for (const el of v) bag[key].push(el);
    return;
  }
  if (!isPlain(bag[key])) { bag[key] = v; return; }
  for (const k of Object.keys(bag[key])) delete bag[key][k];
  Object.assign(bag[key], v);
}

/* A JSON file in any of the four shapes the app actually produces.
   opts.allowUnreadable — see the RESOLVE PASS below. Read-only salvage; the
   store it returns refuses to write or commit. */
export function fileStore(file, opts = {}) {
  const text = readFileSync(file, 'utf8');
  let doc;
  try { doc = JSON.parse(text); }
  catch (e) { throw new Error(file + ' is not valid JSON: ' + e.message); }
  if (!isPlain(doc)) throw new Error(file + ' is not a JSON object');

  let fmt, forge, profile;
  const stringly = {};          // which localStorage values were JSON strings
  const touched = new Set();
  const unreadable = [];        // one entry per STRUCTURE that is present-but-unreadable
  const badBag = { forge: null, profile: null };   // an owner CONTAINER that will not read
  const badLs = {};             // localStorage key -> why its JSON did not parse

  /* 🔴 THE HOLE THIS CLOSES — silent data loss inside the tool that exists to
     prevent data loss. This used to be `parseMaybe`, which returned undefined
     on a JSON parse failure, and the caller `|| {}`-ed it. So a HALF-WRITTEN
     hg_profile (a truncated devtools copy, a clipboard that ran out) read as
     an EMPTY profile. Both halves were measured on the seeded save:
       · export --from a dump whose hg_profile was cut to 900 chars exited 0
         and printed Profile.decks / deckByHero / archonDeck as "ABSENT (not
         written on restore)" — 3 of the 5 gone, and ABSENT is defined by this
         file to mean "the source does not know about it", which was a lie;
       · restore of a GOOD snapshot --into that same dump rewrote hg_profile
         from 8 keys to 3 (decks, deckByHero, archonDeck), dropping gems 4242
         and sovereigns 7 — real money — and then printed "re-read from disk:
         0 difference(s)" as its verdict, because the five it was asked about
         did come back. It checked its own work and never looked at the wallet
         it had just deleted.
     So the rule is: an ABSENT key is still nothing (rule 2 at the top of this
     file), but a PRESENT source that will not yield the structure is a HARD
     ERROR naming the structure. `--allow-unreadable` downgrades that to a
     read-only salvage export; the snapshot it writes is stamped `unreadable`
     and restoreInto refuses it unconditionally, --force included. */
  const parseLs = (lsKey) => {
    const v = doc[lsKey];
    if (v === undefined) return undefined;   // key absent — legitimately nothing
    if (typeof v !== 'string') return v;     // already an object (hand-made dump)
    try { return JSON.parse(v); }
    catch (e) { badLs[lsKey] = 'will not parse as JSON (' + e.message + ')'; return undefined; }
  };

  /* Bind an owner's container, KEEPING ITS IDENTITY INSIDE `doc` so commit()
     writes through it. Absent → {} (rule 2: still nothing). Present but not an
     object → recorded, and NOT defaulted to {}: that default is exactly what
     let three structures read as ABSENT off a truncated profile. */
  const bindBag = (holder, key, owner) => {
    const v = holder[key];
    if (v === undefined) { holder[key] = {}; return holder[key]; }
    if (isPlain(v)) return v;
    badBag[owner] = whyBadBag(v);
    return {};                 // never read from — the resolve pass routes around a bad bag
  };

  if (doc.tool === TOOL && isPlain(doc.data)) {
    fmt = 'snapshot';
    forge = bindBag(doc.data, 'forge', 'forge');
    profile = bindBag(doc.data, 'profile', 'profile');
  } else if (isPlain(doc.Forge) || isPlain(doc.Profile)) {
    fmt = 'raw';
    forge = bindBag(doc, 'Forge', 'forge');
    profile = bindBag(doc, 'Profile', 'profile');
  } else if ('hg_profile' in doc || 'hg_customCards' in doc || 'hg_customMoves' in doc) {
    fmt = 'localstorage';
    stringly.hg_profile = typeof doc.hg_profile === 'string';
    stringly.hg_customCards = typeof doc.hg_customCards === 'string';
    stringly.hg_customMoves = typeof doc.hg_customMoves === 'string';
    const p = parseLs('hg_profile');
    /* `"null"`, `"7"` and `"[]"` all parse fine and are all still an unusable
       profile — same silent-empty outcome as a parse failure, so same refusal. */
    // …phrased to read after "source hg_profile is " in the resolve pass below.
    if (badLs.hg_profile) badBag.profile = 'a string that ' + badLs.hg_profile;
    else if (p !== undefined && !isPlain(p)) badBag.profile = 'parsed to ' + typeName(p) + ', not an object';
    profile = isPlain(p) ? p : {};
    forge = { customCards: parseLs('hg_customCards'), customMoves: parseLs('hg_customMoves') };
  } else if (isPlain(doc.forge) || isPlain(doc.profile)) {
    fmt = 'payload';
    forge = bindBag(doc, 'forge', 'forge');
    profile = bindBag(doc, 'profile', 'profile');
  } else {
    throw new Error(file + ': unrecognised store shape. Expected a localStorage dump ' +
      '(hg_profile/hg_customCards/hg_customMoves), an in-game backup payload ({forge,profile}), ' +
      'a snapshot from this tool, or {Forge,Profile}.');
  }
  const bag = owner => (owner === 'forge' ? forge : profile);

  /* 🔴 THE SALVAGE STAMP MUST NOT LAUNDER OFF.
     A salvage export is a snapshot, and a snapshot is a legal store shape, so
     `export --from salvage.json --out clean.json` used to exit 0 and hand back
     a file with the SAME sha256 and NO stamp — a refused backup turned into a
     restorable one by one ordinary command. The stamp is inherited here, at the
     read, so it survives every path that copies the data: re-export refuses
     outright (and under --allow-unreadable stays stamped), restore --into it
     refuses, verify already reports it. */
  if (fmt === 'snapshot' && Array.isArray(doc.unreadable)) {
    for (const u of doc.unreadable) {
      unreadable.push({ key: 'SALVAGE SOURCE ' + path.basename(file), error: String(u) });
    }
  }
  const inheritedSalvage = unreadable.length > 0;

  /* 🔴 THE REFUSAL BELONGS WHERE A STRUCTURE IS RESOLVED, NOT WHERE ONE SOURCE
     SHAPE HAPPENS TO PARSE A STRING.
     The previous revision guarded parseLs only, i.e. the localStorage branch,
     and the note shipped with it claimed the other shapes "hold already-parsed
     objects, so there is no string parse to fail there". That is FALSE, and two
     critics reached the pre-fix signature byte-for-byte through it — exit 0, a
     file WRITTEN, 3 of 5 printed ABSENT, verify OK — using only documented
     input shapes:
       · {forge:{…}, profile:"<JSON cut to 900 chars>"}   (payload)
       · {Forge:{…}, Profile:"<JSON cut to 900 chars>"}   (raw)
       · a snapshot from this very tool with data.profile swapped for a string
       · hg_customCards:"null" — parses FINE, yields no array
     `null` is the one that shows why a parse guard can never be enough: nothing
     failed to parse, and the structure still is not there.
     So the question asked below is not "did a string parse" but "did this
     source YIELD the structure": undefined = absent (rule 2, still nothing),
     anything else that is not the right container = UNREADABLE, named. */
  const SRC_OF = {
    snapshot:     { forge: 'data.forge', profile: 'data.profile' },
    raw:          { forge: 'Forge',      profile: 'Profile' },
    payload:      { forge: 'forge',      profile: 'profile' },
    localstorage: { forge: null,         profile: 'hg_profile' },  // forge is per-key, see f.ls
  }[fmt];
  /* The inherited-salvage entries are already in `unreadable`; the resolve pass
     appends to that same array, so the throw below names both. */
  const { resolved, listUnreadable } = resolveStructures(file, {
    bag,
    source: f => ((fmt === 'localstorage' && f.owner === 'forge') ? f.ls : SRC_OF[f.owner]),
    badBag: owner => badBag[owner],
    // localStorage holds customCards and customMoves in two separate keys, so
    // one of them failing to parse is a bad LEAF, not a bad profile bag.
    badLeaf: f => ((fmt === 'localstorage' && f.owner === 'forge' && badLs[f.ls]) ? badLs[f.ls] : null),
    advice:
      (inheritedSalvage
        ? '  This file is ITSELF a salvage export. Re-exporting it would hand back a copy without the ' +
          'stamp, and that copy would restore. Fix the original dump and export from THAT.\n'
        : '') +
      '  Get a complete dump (devtools console → copy(JSON.stringify(localStorage))), or pass ' +
      '--allow-unreadable to take a READ-ONLY salvage export of the structures that did resolve. A salvage ' +
      'export is stamped and can never be restored from.',
  }, { allowUnreadable: opts.allowUnreadable, into: unreadable });

  return {
    format: fmt,
    unreadable,                 // [] on a healthy store; non-empty only under allowUnreadable
    describe: () => ({ kind: 'file', format: fmt, file: path.resolve(file) }),
    /* Reads come from the RESOLVE PASS, never from the raw bag: a bag that did
       not read is not indexed at all, so there is no path back to "undefined,
       therefore absent" for a structure the source could not say. */
    read(key) { return resolved.has(key) ? resolved.get(key) : undefined; },
    write(key, value) {
      /* A salvage store is READ-ONLY, enforced here and not only at the CLI:
         `profile` is the {} the failed parse left behind, so committing it
         would write exactly the 3-key hg_profile that this guard exists to
         stop — with the wallet gone. */
      if (unreadable.length) throw new Error(file + ': refusing to WRITE into a store with unreadable key(s) — ' + listUnreadable());
      const f = FIELD_BY_KEY.get(key);
      writeInPlace(bag(f.owner), key, f.kind, value);
      // read() answers from `resolved`, so a write has to land there too or the
      // store would keep reporting the value it had before the restore.
      resolved.set(key, bag(f.owner)[key]);
      touched.add(key);
    },
    /* Read-modify-write. Only the keys we touched are rewritten, and inside
       hg_profile every unrelated field (wallet, heroes, records) rides through
       untouched because `profile` IS the whole parsed profile object. */
    commit(outFile) {
      if (unreadable.length) throw new Error(file + ': refusing to COMMIT a store with unreadable key(s) — ' + listUnreadable());
      if (fmt === 'localstorage') {
        const put = (lsKey, value) => {
          doc[lsKey] = stringly[lsKey] === false ? value : JSON.stringify(value);
        };
        for (const key of touched) {
          const f = FIELD_BY_KEY.get(key);
          if (f.owner === 'forge') put(f.ls, forge[key]);
        }
        if ([...touched].some(k => FIELD_BY_KEY.get(k).owner === 'profile')) put('hg_profile', profile);
      }
      writeFileSync(outFile || file, JSON.stringify(doc, null, 2) + '\n', 'utf8');
      return outFile || file;
    },
  };
}

// ────────────────────────────── export / restore ────────────────────────────
export function snapshotOf(store, opts = {}) {
  const data = { forge: {}, profile: {} };
  const absent = [];
  for (const f of FIELDS) {
    const v = store.read(f.key);
    if (v === undefined || v === null) { absent.push(f.path); continue; }
    data[f.owner][f.key] = clone(v);
  }
  const counts = {};
  for (const f of FIELDS) counts[f.key] = countOf(f.key, data[f.owner][f.key]);
  /* SALVAGE STAMP. Only a store opened with allowUnreadable can produce one.
     It rides in the header rather than in `data` so the sha256 still means
     "this data block is intact" — the stamp guards a different question ("was
     the SOURCE intact"), and the two must not be able to mask each other. It
     is a guard against accident, not against a determined editor: anyone who
     can strip this field can also recompute the sha256. */
  const unreadable = (store.unreadable || []).map(u => u.key + ': ' + u.error);
  return {
    tool: TOOL,
    formatVersion: FORMAT_VERSION,
    exportedAt: opts.at || new Date().toISOString(),
    label: opts.label || '',
    source: store.describe(),
    absent,                       // fields the source did not have — see rule 2
    ...(unreadable.length ? { unreadable } : {}),   // …and fields it COULD NOT SAY, which is not the same
    counts,
    index: indexOf_(data),
    sha256: hashData(data),
    data,
  };
}

export function verifySnapshot(snap) {
  const problems = [];
  if (!isPlain(snap)) return ['not a JSON object'];
  if (snap.tool !== TOOL) problems.push('not a ' + TOOL + ' file (tool=' + JSON.stringify(snap.tool) + ')');
  if (Array.isArray(snap.unreadable) && snap.unreadable.length) {
    problems.push('SALVAGE — the source had unreadable key(s): ' + snap.unreadable.join('; ') +
      '. What is missing here is UNKNOWN, not empty; restore is refused from this file.');
  }
  if (!isPlain(snap.data)) { problems.push('no data block'); return problems; }
  const got = hashData(snap.data);
  if (snap.sha256 !== got) problems.push('sha256 mismatch — file was edited or truncated (recorded ' + snap.sha256 + ', data hashes to ' + got + ')');
  for (const f of FIELDS) {
    const v = snap.data[f.owner] && snap.data[f.owner][f.key];
    if (v === undefined) continue;
    const c = countOf(f.key, v);
    if (snap.counts && snap.counts[f.key] !== undefined && snap.counts[f.key] !== c) {
      problems.push(f.path + ': header says ' + snap.counts[f.key] + ', data holds ' + c);
    }
  }
  if (snap.index) {
    const live = indexOf_(snap.data);
    for (const k of Object.keys(live)) {
      if (snap.index[k] === undefined) continue;
      if (canon(snap.index[k]) !== canon(live[k])) problems.push('index.' + k + ' does not match the data');
    }
  }
  return problems;
}

export function restoreInto(store, snap, opts = {}) {
  /* ⚠ ABOVE the force flag, on purpose, and both directions are checked.
     `--force` exists so a human can accept a recorded-hash mismatch they
     understand. It must never become a way to write data derived from a parse
     that FAILED — that is the exact edit that turned an 8-key hg_profile into
     a 3-key one with the wallet missing. Neither side of a restore may be
     built on a failed parse: not the snapshot coming in (a salvage export),
     not the store going out. */
  const salvage = (isPlain(snap) && Array.isArray(snap.unreadable)) ? snap.unreadable : [];
  if (salvage.length) {
    throw new Error('refusing to restore from a SALVAGE snapshot — its source had unreadable key(s): ' +
      salvage.join('; ') + '. The five it does carry may be partial and the ones it does not are unknown, ' +
      'not empty. Fix the source dump and export again.');
  }
  if (store.unreadable && store.unreadable.length) {
    throw new Error('refusing to restore INTO a store with unreadable key(s): ' +
      store.unreadable.map(u => u.key + ' (' + u.error + ')').join('; ') +
      '. The parse failed, so what is held for that key is an empty object — writing would save THAT ' +
      'over the player\'s real one.');
  }
  const problems = verifySnapshot(snap);
  if (problems.length && !opts.force) throw new Error('refusing to restore: ' + problems.join('; '));
  const written = [], skipped = [];
  for (const f of FIELDS) {
    const bag = snap.data[f.owner] || {};
    /* Rule 2 — absent is not empty. An old snapshot from before a field
       existed must never blank that field on a live save. */
    if (!(f.key in bag) || bag[f.key] === undefined || bag[f.key] === null) { skipped.push(f.path); continue; }
    if (!opts.dryRun) store.write(f.key, bag[f.key]);
    written.push(f.path);
  }
  if (!opts.dryRun) store.commit(opts.outFile);
  return { written, skipped, problems };
}

// ──────────────────────────────────── diff ──────────────────────────────────
/* Deep diff of two snapshot `data` blocks. Arrays whose elements all carry a
   unique `id` are matched BY ID, not by index — a migration that reorders
   customCards would otherwise report 30 changed fields and bury the one that
   matters. Reordering is still reported, once, as its own entry. */
export function diffData(a, b) {
  const out = [];
  walk(a, b, '', out);
  return out;
}
function walk(a, b, p, out) {
  if (a === undefined && b === undefined) return;
  if (a === undefined) { out.push({ op: '+', path: p, to: b }); return; }
  if (b === undefined) { out.push({ op: '-', path: p, from: a }); return; }
  const ta = kindOf(a), tb = kindOf(b);
  if (ta !== tb) { out.push({ op: '~', path: p, from: a, to: b }); return; }
  if (ta === 'array') return walkArray(a, b, p, out);
  if (ta === 'object') {
    for (const k of union(Object.keys(a), Object.keys(b))) {
      walk(a[k], b[k], p ? p + '.' + k : k, out);
    }
    return;
  }
  if (a !== b) out.push({ op: '~', path: p, from: a, to: b });
}
function kindOf(v) {
  if (Array.isArray(v)) return 'array';
  if (v !== null && typeof v === 'object') return 'object';
  return 'leaf';
}
function union(x, y) { const s = new Set(x); for (const k of y) s.add(k); return [...s]; }
function idKeyable(arr) {
  if (!arr.length) return false;
  const seen = new Set();
  for (const el of arr) {
    if (!isPlain(el)) return false;
    const id = el.id;
    if (typeof id !== 'string' && typeof id !== 'number') return false;
    if (seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}
function walkArray(a, b, p, out) {
  const keyed = (a.length + b.length) > 0 &&
                (idKeyable(a) || a.length === 0) &&
                (idKeyable(b) || b.length === 0);
  if (!keyed) return walkPositional(a, b, p, out);
  const ma = new Map(a.map(el => [el.id, el])), mb = new Map(b.map(el => [el.id, el]));
  for (const id of union([...ma.keys()], [...mb.keys()])) {
    walk(ma.get(id), mb.get(id), p + '[id=' + id + ']', out);
  }
  const common = new Set([...ma.keys()].filter(id => mb.has(id)));
  const oa = a.filter(el => common.has(el.id)).map(el => el.id);
  const ob = b.filter(el => common.has(el.id)).map(el => el.id);
  /* Joined on NUL, not a space: a card or deck id that CONTAINS the separator
     could otherwise make two different orders compare equal. Written as the
     escape rather than a literal NUL byte — the literal made grep classify
     this whole file as binary, so a repo-wide `grep -rn` answered "Binary
     file matches" and the backup tool was invisible to every text search. */
  if (oa.join('\u0000') !== ob.join('\u0000')) {
    out.push({ op: '*', path: p, from: oa, to: ob, order: true });
  }
}
/* Arrays with no usable ids — Profile.archonDeck.cards is the one that matters,
   a positional list of card KEYS where duplicates are legal (index.html:246170)
   and so is order. A straight index-by-index compare reports a single removal
   as "every element after it changed" (6 entries for one splice), which buries
   what the migration actually did. LCS alignment first, then adjacent
   delete/insert runs are paired back into in-place changes so a replacement is
   still one entry at its own index. */
function walkPositional(a, b, p, out) {
  const ka = a.map(canon), kb = b.map(canon);
  const n = ka.length, m = kb.length;
  const script = [];
  if (n * m > 1000000) {
    // Too big to align (this is a review tool, not a merge tool) — fall back to
    // the index compare and accept the cascade rather than hang.
    for (let i = 0; i < Math.max(n, m); i++) {
      if (i < n && i < m) script.push(ka[i] === kb[i] ? { t: '=', i, j: i } : null);
      if (i < n && i >= m) script.push({ t: '-', i });
      if (i >= n && i < m) script.push({ t: '+', j: i });
      if (script[script.length - 1] === null) { script[script.length - 1] = { t: '-', i }; script.push({ t: '+', j: i }); }
    }
  } else {
    const dp = [];
    for (let i = 0; i <= n; i++) dp.push(new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = (ka[i] === kb[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (ka[i] === kb[j]) { script.push({ t: '=', i, j }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { script.push({ t: '-', i }); i++; }
      else { script.push({ t: '+', j }); j++; }
    }
    while (i < n) { script.push({ t: '-', i }); i++; }
    while (j < m) { script.push({ t: '+', j }); j++; }
  }
  // Pair each run of deletes with the inserts beside it: those are edits in
  // place, and reporting them as remove+add would double every field change.
  for (let s = 0; s < script.length;) {
    if (script[s].t === '=') { s++; continue; }
    let e = s; while (e < script.length && script[e].t !== '=') e++;
    const dels = script.slice(s, e).filter(x => x.t === '-');
    const adds = script.slice(s, e).filter(x => x.t === '+');
    const paired = Math.min(dels.length, adds.length);
    for (let k = 0; k < paired; k++) walk(a[dels[k].i], b[adds[k].j], p + '[' + dels[k].i + ']', out);
    for (let k = paired; k < dels.length; k++) out.push({ op: '-', path: p + '[' + dels[k].i + ']', from: a[dels[k].i] });
    for (let k = paired; k < adds.length; k++) out.push({ op: '+', path: p + '[' + adds[k].j + ']', to: b[adds[k].j] });
    s = e;
  }
}
const short = (v, n = 90) => {
  const s = typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v === undefined ? null : v);
  return (s && s.length > n) ? s.slice(0, n) + '…(' + s.length + 'ch)' : s;
};
export function formatDiff(entries) {
  if (!entries.length) return '  (no differences)';
  return entries.map(e => {
    if (e.order) return '  * ' + e.path + '  order changed: ' + short(e.from, 60) + ' -> ' + short(e.to, 60);
    if (e.op === '+') return '  + ' + e.path + '  ' + short(e.to);
    if (e.op === '-') return '  - ' + e.path + '  ' + short(e.from);
    return '  ~ ' + e.path + '  ' + short(e.from) + ' -> ' + short(e.to);
  }).join('\n');
}

// ──────────────────────────────── seeded world ──────────────────────────────
/* Deterministic on purpose — no Date.now(), no Math.random(). Two runs produce
   byte-identical files, so a critic can diff two runs and get nothing, and any
   difference a test reports came from the test and not from the seed. Shapes
   copy the real ones: cards from index.html:50517, moves as a MAP keyed by id,
   deck entries field-for-field from the entry built at index.html:60307,
   deckByHero as {name,cards} (:60321), archonDeck as {cards:[keys]} (:48049). */
export function seedWorld(opts = {}) {
  const nCards = opts.cards === undefined ? 30 : opts.cards;
  const nDecks = opts.decks === undefined ? 5 : opts.decks;
  const nMoves = opts.moves === undefined ? 12 : opts.moves;
  const pad = n => String(n).padStart(2, '0');
  const customCards = [];
  for (let i = 0; i < nCards; i++) {
    customCards.push({
      id: 'card_' + pad(i),
      name: 'Forged Card ' + pad(i),
      type: (i % 7 === 0) ? 'hero' : 'unit',
      cost: (i % 5) + 1,
      stats: { atk: (i % 9) + 1, hp: (i % 6) + 2 },
      moves: ['mv_' + pad(i % Math.max(1, nMoves))],
      createdAt: 1700000000000 + i * 1000,
    });
  }
  const customMoves = {};
  for (let i = 0; i < nMoves; i++) {
    customMoves['mv_' + pad(i)] = { id: 'mv_' + pad(i), name: 'Gambit ' + pad(i), power: 10 + i, cost: (i % 3) + 1, tags: ['forged'] };
  }
  const decks = [], deckByHero = {};
  for (let i = 0; i < nDecks; i++) {
    const heroId = 'card_' + pad((i * 7) % Math.max(1, nCards));
    const cards = [];
    for (let k = 0; k < 8; k++) cards.push('card_' + pad((i * 3 + k) % Math.max(1, nCards)));
    const entry = {
      id: 'deck_' + i, name: 'Deck ' + i, heroId,
      heroName: 'Hero ' + i, heroIcon: '', cards,
      coverCardId: '', createdAt: 1700000000000 + i * 60000,
    };
    decks.push(entry);
    deckByHero[heroId] = { name: entry.name, cards: cards.slice(0) };
  }
  const archonDeck = { cards: [] };
  for (let i = 0; i < 8; i++) archonDeck.cards.push('archon_' + pad(i % 5));   // duplicates are legal (index.html:246170)
  return {
    Forge: { customCards, customMoves, sprites: {}, customEvents: [] },
    Profile: {
      decks, deckByHero, archonDeck,
      /* Bystanders. Nothing below this line may ever move because of a
         restore — the wallet especially (index.html:48049). */
      gems: 4242, sovereigns: 7,
      records: { wins: 12, losses: 3, battles: 15 },
      heroes: { h1: { lvl: 9 } },
      cloud: { userId: 'u-seed', lastLocalEditAt: 1700000000000 },
    },
  };
}

// ─────────────────────────────────── CLI ────────────────────────────────────
const argv = process.argv.slice(2);
function flagOf(name, def) {
  const i = argv.indexOf('--' + name);
  if (i < 0) return def;
  const nxt = argv[i + 1];
  return (nxt === undefined || nxt.startsWith('--')) ? true : nxt;
}
const hasFlag = name => argv.includes('--' + name);
function positionals() {
  const out = [];
  for (let i = 1; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { const n = argv[i + 1]; if (n !== undefined && !n.startsWith('--')) i++; continue; }
    out.push(argv[i]);
  }
  return out;
}
const stamp = d => d.toISOString().replace(/[:.]/g, '-').replace('Z', 'Z');
/* fileURLToPath, not url.pathname: on Windows the pathname is "/D:/…" and any
   space in the checkout path arrives percent-encoded. */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = path.join(HERE, 'forge-backups');

function printCounts(snap) {
  for (const f of FIELDS) {
    const c = snap.counts[f.key];
    console.log('  ' + f.path.padEnd(20) + ' ' + (c === null ? 'ABSENT (not written on restore)' : c));
  }
}

/* `over` lets `mutant` run the REAL export in this process, so the exit code
   and the message a reviewer sees are the export's own and not a paraphrase. */
function cmdExport(over = {}) {
  const from = over.from || flagOf('from', null);
  if (!from || from === true) {
    throw new Error('export needs --from <store.json>. There is no browser here: get one with\n' +
      '  devtools console →  copy(JSON.stringify(localStorage))\n' +
      'or use the in-game backup payload / a snapshot from this tool.');
  }
  /* fileStore THROWS here on an unreadable key, before anything is written —
     that is the whole fix: no export file, non-zero exit, the key named. */
  const store = fileStore(from, { allowUnreadable: over.allowUnreadable || hasFlag('allow-unreadable') });
  const snap = snapshotOf(store, { label: flagOf('label', '') === true ? '' : flagOf('label', '') });
  const salvage = Array.isArray(snap.unreadable) && snap.unreadable.length > 0;
  let out = over.out || flagOf('out', DEFAULT_OUT);
  if (out === true) out = DEFAULT_OUT;
  let outFile;
  if (/\.json$/i.test(out)) { outFile = out; mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); }
  else {
    mkdirSync(out, { recursive: true });
    /* A self-ignoring backup directory: these files are a player's real save
       and other agents commit this tree. */
    const gi = path.join(out, '.gitignore');
    if (!existsSync(gi)) writeFileSync(gi, '*\n', 'utf8');
    // Named apart so nobody reaches for a salvage in a hurry and wonders why
    // restore refuses it.
    outFile = path.join(out, (salvage ? 'forge-salvage-' : 'forge-export-') + stamp(new Date(snap.exportedAt)) + '.json');
  }
  writeFileSync(outFile, JSON.stringify(snap, null, 2) + '\n', 'utf8');
  if (salvage) {
    console.log('⚠ SALVAGE EXPORT — the source could not be fully read:');
    for (const u of snap.unreadable) console.log('    unreadable: ' + u);
    console.log('  This file CANNOT be restored from. It is a record of what survived, nothing more.');
    console.log('  A field printed as ABSENT below may be present in the real save.');
  }
  console.log('exported from ' + JSON.stringify(snap.source));
  printCounts(snap);
  console.log('  sha256 ' + snap.sha256);
  console.log('  wrote  ' + path.resolve(outFile) + ' (' + readFileSync(outFile).length + ' bytes)');
  return 0;
}

function cmdRestore() {
  const [snapFile] = positionals();
  if (!snapFile) throw new Error('restore needs <snapshot.json> [--into <store.json>]');
  const snap = JSON.parse(readFileSync(snapFile, 'utf8'));
  const into = flagOf('into', null);
  if (!into || into === true) throw new Error('restore needs --into <store.json>');
  const store = fileStore(into);
  const before = snapshotOf(store);
  const dry = hasFlag('dry-run');
  const res = restoreInto(store, snap, { dryRun: dry, force: hasFlag('force') });
  const changes = diffData(before.data, snap.data);
  console.log((dry ? 'DRY RUN — would restore ' : 'restored ') + res.written.length + ' field(s) into ' + path.resolve(into));
  if (res.skipped.length) console.log('  skipped (absent from the snapshot, left as-is): ' + res.skipped.join(', '));
  console.log('  ' + changes.length + ' difference(s) between the file and the snapshot:');
  console.log(formatDiff(changes));
  if (!dry) {
    const after = diffData(snapshotOf(fileStore(into)).data, snap.data)
      .filter(e => !res.skipped.includes(fieldPathOf(e.path)));
    console.log('  re-read from disk: ' + after.length + ' difference(s) vs the snapshot');
    if (after.length) { console.log(formatDiff(after)); return 2; }
  }
  return 0;
}
function fieldPathOf(diffPath) {
  const m = /^(forge|profile)\.([A-Za-z]+)/.exec(diffPath || '');
  if (!m) return '';
  const f = FIELD_BY_KEY.get(m[2]);
  return f ? f.path : '';
}

function loadAsData(file) {
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  /* A snapshot is read directly (no fileStore), so the salvage stamp has to be
     carried out by hand on this path too — otherwise diff is the one command
     that looks at a salvage and never says the word. */
  if (isPlain(doc) && doc.tool === TOOL && isPlain(doc.data)) {
    const salvage = Array.isArray(doc.unreadable) ? doc.unreadable.map(String) : [];
    return { data: doc.data, how: salvage.length ? 'SALVAGE snapshot' : 'snapshot', salvage };
  }
  return { data: snapshotOf(fileStore(file)).data, how: 'store file', salvage: [] };
}
function cmdDiff() {
  const [a, b] = positionals();
  if (!a || !b) throw new Error('diff needs <before.json> <after.json>');
  const A = loadAsData(a), B = loadAsData(b);
  const d = diffData(A.data, B.data);
  console.log('before ' + path.resolve(a) + ' (' + A.how + ')');
  console.log('after  ' + path.resolve(b) + ' (' + B.how + ')');
  console.log(d.length + ' difference(s)');
  console.log(formatDiff(d));
  /* Exit 0 out of diff means "these two agree", and a salvage cannot support
     that claim about the structures its source could not read: 0 differences
     there means "the two files are silent about the same things". So a salvage
     side is never 0 — it exits 2 with the reason, the same code as a real
     difference, because that is what it is. */
  const salvage = [...A.salvage, ...B.salvage];
  if (salvage.length) {
    console.log('  ⚠ SALVAGE on one side — its source had unreadable structure(s): ' + salvage.join('; '));
    console.log('    Anything absent above is UNKNOWN, not equal. This diff cannot report "identical".');
    return 2;
  }
  return d.length ? 2 : 0;
}

function cmdVerify() {
  const [f] = positionals();
  if (!f) throw new Error('verify needs <snapshot.json>');
  const snap = JSON.parse(readFileSync(f, 'utf8'));
  const problems = verifySnapshot(snap);
  console.log(path.resolve(f));
  console.log('  exportedAt ' + snap.exportedAt + (snap.label ? '  label ' + JSON.stringify(snap.label) : ''));
  console.log('  source     ' + JSON.stringify(snap.source));
  if (Array.isArray(snap.unreadable) && snap.unreadable.length) {
    console.log('  ⚠ SALVAGE: the source had unreadable key(s) — ' + snap.unreadable.join('; '));
    console.log('    ABSENT below means UNKNOWN here, not empty. restore refuses this file.');
  }
  printCounts(snap);
  console.log('  sha256 ' + snap.sha256 + (problems.length ? '' : ' (recomputed, matches)'));
  if (snap.source && snap.source.format === 'localstorage') {
    console.log('  ⚠ source was a localStorage dump: customCards here are the data-URL-stripped copy (index.html:77206). Card ART is not in this file.');
  }
  if (problems.length) { problems.forEach(p => console.log('  PROBLEM: ' + p)); return 2; }
  console.log('  OK');
  return 0;
}

function cmdSeed() {
  const [out] = positionals();
  if (!out) throw new Error('seed needs <out.json>');
  const world = seedWorld({
    cards: +flagOf('cards', 30), decks: +flagOf('decks', 5), moves: +flagOf('moves', 12),
  });
  const doc = {
    hg_profile: JSON.stringify(world.Profile),
    hg_customCards: JSON.stringify(world.Forge.customCards),
    hg_customMoves: JSON.stringify(world.Forge.customMoves),
    hg_unrelated_key: 'left alone by restore',
  };
  writeFileSync(out, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  const s = snapshotOf(memoryStore(world));
  console.log('seeded localStorage-shaped store ' + path.resolve(out));
  printCounts(s);
  return 0;
}

// ────────────────────────────── scratch space ───────────────────────────────
/* 🔴 A GATE THAT REDDENS BECAUSE A COLLEAGUE IS RUNNING IS A GATE THE RUN
   LEARNS TO IGNORE. The selftest used to wipe and reuse one FIXED path
   (tmpdir()/mythic-forge-export-selftest) and section 9 spawns six children
   against it, so two runs on this machine — and other agents do work in this
   repo — deleted each other's fixtures mid-flight and both went red for a
   reason that had nothing to do with the tool.

   Per-PID, not per-run-random, on purpose: two LIVE processes can never share
   a pid, so this directory is exclusively ours for as long as we run, the
   rmSync below can only ever clear leftovers from a process that is already
   dead, and tmp stays bounded instead of growing a directory per run. This
   process reaps nothing it did not create.

   Children spawned by the selftest inherit the parent's directory through the
   environment (spawnSync passes our env through), so their fixtures land
   inside the one directory the parent owns and prints, rather than in six more
   of their own. */
const SCRATCH_ENV = 'MYTHIC_FORGE_EXPORT_SCRATCH';
const NEST_ENV = 'MYTHIC_FORGE_EXPORT_NESTED';   // section 10's one-level recursion cap
const SCRATCH_PREFIX = 'mythic-forge-export-';
const SCRATCH_STALE_MS = 60 * 60 * 1000;

/* Per-pid directories are bounded only if the abandoned ones eventually go, so
   this sweeps the family — but ONLY a directory that fails BOTH of two
   independent liveness tests: its owning pid answers signal 0 with ESRCH (no
   process holds it), and it has not been touched for an hour, where a whole
   selftest run takes about two seconds. A directory a colleague is writing to
   right now fails the first test and is left alone; that is the property the
   fixed shared path did not have. Anything the sweep throws is swallowed: a
   reaper that can fail the run it is tidying up for is just a new false red. */
function reapDeadScratch(kind) {
  try {
    const now = Date.now();
    for (const name of readdirSync(tmpdir())) {
      const m = name.startsWith(SCRATCH_PREFIX + kind + '-') && /-(\d+)$/.exec(name);
      if (!m) continue;
      const pid = Number(m[1]);
      if (pid === process.pid) continue;
      try { process.kill(pid, 0); continue; }              // answered → a live owner, hands off
      catch (e) { if (e.code !== 'ESRCH') continue; }      // EPERM etc: assume alive
      const dir = path.join(tmpdir(), name);
      try { if (now - statSync(dir).mtimeMs < SCRATCH_STALE_MS) continue; } catch (e) { continue; }
      rmSync(dir, { recursive: true, force: true });
    }
  } catch (e) { /* tmp unreadable — not this tool's problem, and not worth a red */ }
}

function scratchDir(kind) {
  const inherited = process.env[SCRATCH_ENV];
  if (inherited) {                       // ours only by loan — never wipe the lender's tree
    const sub = path.join(inherited, kind);
    mkdirSync(sub, { recursive: true });
    return sub;
  }
  const dir = path.join(tmpdir(), SCRATCH_PREFIX + kind + '-' + process.pid);
  rmSync(dir, { recursive: true, force: true });   // ours by construction: no live process holds this pid
  mkdirSync(dir, { recursive: true });
  reapDeadScratch(kind);
  return dir;
}

// ───────────────────────────────── mutants ──────────────────────────────────
/* THE BYPASSES, EACH ONE RUNNABLE BY ONE COMMAND:
     node .gauntlet/forge-export.mjs mutant <name>
   Four of these are the shapes two critics used to walk straight past the
   previous revision's guard — exit 0, a file written, 3 of 5 printed ABSENT.
   One is the launder. One (`memory-truncated-profile`) is the same signature
   through the MODULE entry point, which the guard did not reach at all until
   the resolve pass was shared. One is the CONTROL, and it is the reason the
   other six are safe to demand: a guard that refuses everything is not a
   guard, so `empty-control` must still EXPORT, at exit 0, reporting zeros.
   The command builds the store and then runs the real tool on it in this same
   process, so what you see is the tool's own exit code and message. */
const MUTANTS = {
  'payload-truncated-profile': {
    expect: 'refuse', names: 'Profile.decks',
    why: 'in-game backup payload whose `profile` half is a JSON string cut mid-copy',
  },
  'raw-truncated-profile': {
    expect: 'refuse', names: 'Profile.decks',
    why: '{Forge,Profile} with `Profile` a JSON string cut mid-copy',
  },
  'snapshot-profile-as-string': {
    expect: 'refuse', names: 'Profile.decks',
    why: 'a snapshot from THIS tool with data.profile swapped for a string',
  },
  'customcards-null-string': {
    expect: 'refuse', names: 'Forge.customCards',
    why: 'hg_customCards = "null" — parses perfectly, yields no array',
  },
  'salvage-relaunder': {
    expect: 'refuse', names: 'SALVAGE SOURCE',
    why: 're-export of a salvage file, which used to strip the stamp and keep the sha256',
  },
  /* Not a file, and that is the point: this one goes through the MODULE entry
     point the header tells migration pieces to call, which is the one the
     guard never reached. Measured before the shared resolve pass existed:
     snapshotOf(memoryStore({Forge, Profile:<cut to 900>})) returned a snapshot
     with counts {customCards:30, customMoves:12, decks:null, deckByHero:null,
     archonDeck:null} and NO stamp — the original signature, inside the fixed
     tool. */
  'memory-truncated-profile': {
    expect: 'refuse', names: 'Profile.decks', entry: 'memory',
    why: 'snapshotOf(memoryStore({Forge, Profile})) — the documented MODULE entry point — with Profile a JSON string cut mid-copy',
  },
  'empty-control': {
    expect: 'export', names: '',
    why: 'CONTROL — every structure genuinely EMPTY. Must export at exit 0 and report 0, not refuse',
  },
};
function buildMutant(name, dir) {
  const w = seedWorld();
  const P = JSON.stringify(w.Profile);
  const C = JSON.stringify(w.Forge.customCards);
  const M = JSON.stringify(w.Forge.customMoves);
  const cut = P.slice(0, 900);           // the same 900 chars the original hole was measured at
  const put = (n, docv) => {
    const f = path.join(dir, 'mutant-' + n + '.json');
    writeFileSync(f, JSON.stringify(docv, null, 2) + '\n', 'utf8');
    return f;
  };
  if (name === 'payload-truncated-profile') {
    return put(name, { version: 1, exportedAt: '2026-01-01T00:00:00.000Z',
      forge: { customCards: w.Forge.customCards, customMoves: w.Forge.customMoves, sprites: {} },
      profile: cut });
  }
  if (name === 'raw-truncated-profile') {
    return put(name, { Forge: { customCards: w.Forge.customCards, customMoves: w.Forge.customMoves }, Profile: cut });
  }
  if (name === 'snapshot-profile-as-string') {
    const snap = snapshotOf(memoryStore(w, 'mutant seed'), { at: '2026-01-01T00:00:00.000Z' });
    snap.data.profile = cut;             // header counts/sha256 left alone: nothing reads them here
    return put(name, snap);
  }
  if (name === 'customcards-null-string') {
    return put(name, { hg_profile: P, hg_customCards: 'null', hg_customMoves: M, hg_profile_owner: 'u-seed' });
  }
  if (name === 'empty-control') {
    return put(name, {
      hg_profile: JSON.stringify({ ...w.Profile, decks: [], deckByHero: {}, archonDeck: { cards: [] } }),
      hg_customCards: '[]', hg_customMoves: '{}', hg_profile_owner: 'u-seed',
    });
  }
  if (name === 'salvage-relaunder') {
    // A REAL salvage, taken the only way the tool allows one to exist.
    const src = put('salvage-relaunder-source', { hg_profile: cut, hg_customCards: C, hg_customMoves: M });
    const salv = path.join(dir, 'mutant-salvage-relaunder.json');
    writeFileSync(salv, JSON.stringify(snapshotOf(fileStore(src, { allowUnreadable: true })), null, 2) + '\n', 'utf8');
    return salv;
  }
  throw new Error('unknown mutant ' + JSON.stringify(name) + '. One of: ' + Object.keys(MUTANTS).join(', '));
}
function cmdMutant() {
  const [name] = positionals();
  if (!name || name === 'list') {
    for (const k of Object.keys(MUTANTS)) console.log('  ' + k.padEnd(28) + MUTANTS[k].expect.padEnd(8) + MUTANTS[k].why);
    return name === 'list' ? 0 : 1;
  }
  if (!MUTANTS[name]) throw new Error('unknown mutant ' + JSON.stringify(name) + '. One of: ' + Object.keys(MUTANTS).join(', '));
  const dir = scratchDir('mutants');
  /* The MODULE entry point has no file and writes nothing, so "no file at the
     out path" is not the proof here — "no snapshot came back" is. Everything
     else is the same: the message and the exit code are the tool's own. */
  if (MUTANTS[name].entry === 'memory') {
    const w = seedWorld();
    const cut = JSON.stringify(w.Profile).slice(0, 900);   // the same 900 chars as every other mutant
    console.log('mutant ' + name + ' — ' + MUTANTS[name].why);
    console.log('  store    memoryStore({ Forge: <30 cards/12 moves>, Profile: <' + cut.length + ' chars of JSON> })');
    console.log('  expected REFUSAL naming ' + MUTANTS[name].names + ', non-zero exit, NO snapshot returned');
    console.log('  running  snapshotOf(memoryStore({ Forge, Profile }))\n');
    let snap = null, err = null;
    try { snap = snapshotOf(memoryStore({ Forge: w.Forge, Profile: cut })); }
    catch (e) { err = e; console.error('error: ' + e.message); }
    console.log('\n  exit ' + (err ? 1 : 0) + '   snapshot returned: ' + (snap !== null));
    if (err && snap === null) return 1;
    console.log('  ⚠ THE MUTANT ESCAPED — counts ' + JSON.stringify(snap.counts) +
      ', stamped ' + (snap.unreadable !== undefined) + '. That is the pre-fix signature.');
    return 3;
  }
  const store = buildMutant(name, dir);
  let out = flagOf('out', path.join(dir, name + '-OUT'));
  if (out === true) out = path.join(dir, name + '-OUT');
  rmSync(out, { recursive: true, force: true });      // so "no file written" is provable, not assumed
  console.log('mutant ' + name + ' — ' + MUTANTS[name].why);
  console.log('  store    ' + store);
  console.log('  expected ' + (MUTANTS[name].expect === 'refuse'
    ? 'REFUSAL naming ' + MUTANTS[name].names + ', non-zero exit, no file at ' + out
    : 'a clean export at exit 0 with every count 0'));
  console.log('  running  export --from <store> --out ' + out + '\n');
  let code, err = null;
  try { code = cmdExport({ from: store, out }); }
  catch (e) { err = e; console.error('error: ' + e.message); code = 1; }
  console.log('\n  exit ' + code + '   output path exists: ' + existsSync(out));
  if (MUTANTS[name].expect === 'refuse') {
    if (err && !existsSync(out)) return 1;            // refused, nothing written — as designed
    console.log('  ⚠ THE MUTANT ESCAPED — this shape was supposed to be refused.');
    return 3;
  }
  if (err) { console.log('  ⚠ THE CONTROL WAS REFUSED — a genuinely empty save is not an unreadable one.'); return 3; }
  return code;
}

// ───────────────────────────────── selftest ─────────────────────────────────
/* Everything below prints numbers. The claim "the round trip works" is worth
   nothing unless the mutation step is shown to have really broken the five
   first, so every round trip here prints the BEFORE diff too. */
function cmdSelftest() {
  let fails = 0;
  const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  <- ' + x)); if (!c) fails++; };
  const dir = scratchDir('selftest');
  /* Children (section 9 spawns six) put THEIR fixtures inside this directory
     instead of a fixed shared one, so a concurrent run of this selftest cannot
     delete them out from under us. */
  process.env[SCRATCH_ENV] = dir;
  console.log('scratch: ' + dir + '  (pid ' + process.pid + ')\n');

  // ── 1. export a seeded world ──────────────────────────────────────────────
  console.log('── 1. export ─────────────────────────────────────────────');
  const world = seedWorld();                      // 30 cards, 5 decks, 12 moves
  const snap = snapshotOf(memoryStore(world, 'selftest seed'), { label: 'selftest' });
  const file = path.join(dir, 'export-A.json');
  writeFileSync(file, JSON.stringify(snap, null, 2) + '\n', 'utf8');
  const bytes = readFileSync(file).length;
  let parsed = null, parseErr = null;
  try { parsed = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { parseErr = e.message; }
  ok(parsed !== null, 'the export file is valid JSON (' + bytes + ' bytes)', parseErr);
  console.log('  counts: ' + JSON.stringify(parsed.counts));

  const wantCards = world.Forge.customCards.map(c => c.id);
  const wantDecks = world.Profile.decks.map(d => d.id);
  const wantMoves = Object.keys(world.Forge.customMoves);
  const wantHeroes = Object.keys(world.Profile.deckByHero);
  const gotCards = new Set(parsed.data.forge.customCards.map(c => c.id));
  const gotDecks = new Set(parsed.data.profile.decks.map(d => d.id));
  const gotMoves = new Set(Object.keys(parsed.data.forge.customMoves));
  const hitCards = wantCards.filter(id => gotCards.has(id)).length;
  const hitDecks = wantDecks.filter(id => gotDecks.has(id)).length;
  const hitMoves = wantMoves.filter(id => gotMoves.has(id)).length;
  ok(wantCards.length === 30 && hitCards === 30, 'all 30 seeded card ids are in the file (' + hitCards + '/' + wantCards.length + ')');
  ok(wantDecks.length === 5 && hitDecks === 5, 'all 5 seeded deck ids are in the file (' + hitDecks + '/' + wantDecks.length + ')');
  ok(hitMoves === wantMoves.length, 'all ' + wantMoves.length + ' seeded move ids are in the file (' + hitMoves + '/' + wantMoves.length + ')');
  ok(Object.keys(parsed.data.profile.deckByHero).length === wantHeroes.length,
    'deckByHero carries ' + wantHeroes.length + ' hero key(s) (' + Object.keys(parsed.data.profile.deckByHero).length + ')');
  ok(parsed.data.profile.archonDeck.cards.length === world.Profile.archonDeck.cards.length,
    'the Realm roster carries all ' + world.Profile.archonDeck.cards.length + ' entries (duplicates kept)',
    JSON.stringify(parsed.data.profile.archonDeck.cards));
  ok(parsed.counts.customCards === 30 && parsed.counts.decks === 5 && parsed.counts.customMoves === 12,
    'the header counts agree with the data', JSON.stringify(parsed.counts));
  ok(verifySnapshot(parsed).length === 0, 'verifySnapshot is clean on a fresh export', verifySnapshot(parsed).join('; '));
  ok(parsed.data.profile.gems === undefined && parsed.data.profile.sovereigns === undefined,
    'the export carries the five and NOT the wallet', JSON.stringify(Object.keys(parsed.data.profile)));
  ok(canon(snapshotOf(memoryStore(seedWorld())).data) === canon(parsed.data),
    'the seed is deterministic — a second run hashes identically');

  // ── 2. break all five, then restore from the FILE ─────────────────────────
  console.log('\n── 2. mutate all five in memory, then restore ────────────');
  const heldCards = world.Forge.customCards, heldMoves = world.Forge.customMoves;
  const heldDecks = world.Profile.decks, heldByHero = world.Profile.deckByHero, heldArchon = world.Profile.archonDeck;

  world.Forge.customCards.splice(0, 7);                                  // 7 cards gone
  world.Forge.customCards.reverse();                                     // and reordered
  world.Forge.customCards[0].name = 'CLOBBERED';
  world.Forge.customCards.push({ id: 'card_ghost', name: 'invented by the migration' });
  for (const k of Object.keys(world.Forge.customMoves)) if (k !== 'mv_00' && k !== 'mv_01') delete world.Forge.customMoves[k];
  world.Forge.customMoves.mv_00.power = 999;
  world.Profile.decks.splice(1, 3);                                      // 3 decks gone
  world.Profile.decks[0].name = 'CLOBBERED';
  world.Profile.decks[0].cards.push('card_ghost');
  for (const k of Object.keys(world.Profile.deckByHero)) delete world.Profile.deckByHero[k];
  world.Profile.archonDeck.cards.length = 0;
  world.Profile.gems = 9999;                                            // the player earned money since the export
  world.Profile.sovereigns = 11;

  const broken = diffData(snap.data, snapshotOf(memoryStore(world)).data);
  ok(broken.length > 0, 'the mutation really did break the five — ' + broken.length + ' difference(s) before restore');
  console.log(formatDiff(broken.slice(0, 6)).split('\n').map(l => '   ' + l).join('\n') + (broken.length > 6 ? '\n    … ' + (broken.length - 6) + ' more' : ''));

  const fromDisk = JSON.parse(readFileSync(file, 'utf8'));
  const res = restoreInto(memoryStore(world), fromDisk);
  ok(res.written.length === 5 && res.skipped.length === 0, 'restore wrote all five paths', JSON.stringify(res));
  const after = diffData(fromDisk.data, snapshotOf(memoryStore(world)).data);
  console.log('  deep diff, export vs live state after restore: ' + after.length + ' difference(s)');
  console.log(formatDiff(after).split('\n').map(l => '   ' + l).join('\n'));
  ok(after.length === 0, 'ROUND TRIP: the five are deeply equal to the export', formatDiff(after));
  ok(canon(snapshotOf(memoryStore(world)).data) === canon(fromDisk.data),
    '…and hash-identical too (' + hashData(snapshotOf(memoryStore(world)).data).slice(0, 12) + '…)');

  // ── 3. what restore must NOT have touched ─────────────────────────────────
  console.log('\n── 3. blast radius ──────────────────────────────────────');
  ok(world.Profile.gems === 9999, 'gems earned after the export survive the restore', String(world.Profile.gems));
  ok(world.Profile.sovereigns === 11, 'sovereigns (real money) survive the restore', String(world.Profile.sovereigns));
  ok(world.Profile.records.wins === 12 && world.Profile.heroes.h1.lvl === 9, 'records/heroes untouched');
  ok(world.Forge.customCards === heldCards && world.Forge.customMoves === heldMoves &&
     world.Profile.decks === heldDecks && world.Profile.deckByHero === heldByHero &&
     world.Profile.archonDeck === heldArchon,
     'all five containers keep their identity (restore is in-place, not re-assign)');

  // ── 4. the diff tool on a deliberate one-field change ────────────────────
  console.log('\n── 4. one-field diff ────────────────────────────────────');
  const wA = seedWorld(), wB = seedWorld();
  const sA = snapshotOf(memoryStore(wA)), fA = path.join(dir, 'one-before.json');
  wB.Profile.decks[2].name = 'Renamed By Migration';
  const sB = snapshotOf(memoryStore(wB)), fB = path.join(dir, 'one-after.json');
  writeFileSync(fA, JSON.stringify(sA, null, 2) + '\n', 'utf8');
  writeFileSync(fB, JSON.stringify(sB, null, 2) + '\n', 'utf8');
  const d1 = diffData(JSON.parse(readFileSync(fA, 'utf8')).data, JSON.parse(readFileSync(fB, 'utf8')).data);
  console.log(formatDiff(d1).split('\n').map(l => '   ' + l).join('\n'));
  ok(d1.length === 1, 'exactly one difference reported (' + d1.length + ')');
  ok(d1.length === 1 && d1[0].path === 'profile.decks[id=deck_2].name', 'and it names that field', d1.length ? d1[0].path : '');
  ok(d1.length === 1 && d1[0].from === 'Deck 2' && d1[0].to === 'Renamed By Migration', 'with both values');

  const wC = seedWorld(); wC.Forge.customMoves.mv_03.power = 77;
  const d2 = diffData(sA.data, snapshotOf(memoryStore(wC)).data);
  ok(d2.length === 1 && d2[0].path === 'forge.customMoves.mv_03.power',
    'a one-field change inside the customMoves MAP is named exactly too', d2.map(e => e.path).join(','));

  const wD = seedWorld();
  wD.Forge.customCards.push(wD.Forge.customCards.shift());               // pure reorder, nothing else
  const d3 = diffData(sA.data, snapshotOf(memoryStore(wD)).data);
  ok(d3.length === 1 && d3[0].order, 'a pure reorder is ONE order entry, not 30 field changes', d3.length + ': ' + d3.map(e => e.path).join(','));

  const wE = seedWorld(); wE.Profile.archonDeck.cards[3] = 'archon_99';
  const d4 = diffData(sA.data, snapshotOf(memoryStore(wE)).data);
  ok(d4.length === 1 && d4[0].path === 'profile.archonDeck.cards[3]',
    'the Realm roster diffs by position (its entries are keys, and duplicates are legal)', d4.map(e => e.path).join(','));

  const wE2 = seedWorld(); wE2.Profile.archonDeck.cards.splice(2, 1);
  const d5a = diffData(sA.data, snapshotOf(memoryStore(wE2)).data);
  ok(d5a.length === 1 && d5a[0].op === '-' && d5a[0].path === 'profile.archonDeck.cards[2]',
    'ONE archon removed reports ONE removal, not a shift cascade', d5a.length + ': ' + d5a.map(e => e.op + e.path).join(','));
  const wE3 = seedWorld(); wE3.Profile.archonDeck.cards.splice(2, 0, 'archon_new');
  const d5b = diffData(sA.data, snapshotOf(memoryStore(wE3)).data);
  ok(d5b.length === 1 && d5b[0].op === '+' && d5b[0].path === 'profile.archonDeck.cards[2]',
    'ONE archon inserted reports ONE addition', d5b.length + ': ' + d5b.map(e => e.op + e.path).join(','));

  // ── 5. the guards ────────────────────────────────────────────────────────
  console.log('\n── 5. guards ────────────────────────────────────────────');
  const wF = seedWorld();
  const noArchon = JSON.parse(JSON.stringify(sA));
  delete noArchon.data.profile.archonDeck;
  delete noArchon.counts.archonDeck; delete noArchon.index;
  noArchon.sha256 = hashData(noArchon.data);                             // a legitimately older snapshot
  wF.Profile.archonDeck.cards = ['archon_keep_me'];
  const r2 = restoreInto(memoryStore(wF), noArchon);
  ok(r2.skipped.includes('Profile.archonDeck') && wF.Profile.archonDeck.cards[0] === 'archon_keep_me',
    'a snapshot with no archonDeck SKIPS it — absent is not empty', JSON.stringify(wF.Profile.archonDeck));
  ok(r2.written.length === 4, '…and still restores the other four', JSON.stringify(r2.written));

  const tampered = JSON.parse(JSON.stringify(sA));
  tampered.data.profile.decks[0].name = 'silently edited in the backup file';
  let threw = null;
  try { restoreInto(memoryStore(seedWorld()), tampered); } catch (e) { threw = e.message; }
  ok(threw !== null && /sha256 mismatch/.test(threw), 'an edited snapshot is REFUSED, not restored', threw);

  const truncFile = path.join(dir, 'truncated.json');
  writeFileSync(truncFile, JSON.stringify(sA, null, 2).slice(0, 4000), 'utf8');
  let threw2 = null;
  try { fileStore(truncFile); } catch (e) { threw2 = e.message; }
  ok(threw2 !== null && /not valid JSON/.test(threw2), 'a truncated file is refused with a real message', (threw2 || '').slice(0, 60));

  let threw3 = null;
  try { restoreInto(memoryStore(seedWorld()), { hello: 'world' }); } catch (e) { threw3 = e.message; }
  ok(threw3 !== null && /not a mythic-forge-export file/.test(threw3), 'a foreign JSON file is refused', threw3);

  const wG = seedWorld();
  const before = snapshotOf(memoryStore(wG));
  restoreInto(memoryStore(wG), sA, { dryRun: true });
  wG.Profile.decks[0].name = 'X';
  ok(canon(before.data) !== canon(snapshotOf(memoryStore(wG)).data), '(control: the diff can see a change at all)');
  const wH = seedWorld(); wH.Profile.decks[0].name = 'Y';
  const beforeH = canon(snapshotOf(memoryStore(wH)).data);
  restoreInto(memoryStore(wH), sA, { dryRun: true });
  ok(canon(snapshotOf(memoryStore(wH)).data) === beforeH, '--dry-run writes nothing');

  // ── 6. the same trip through a FILE store (localStorage dump) ────────────
  console.log('\n── 6. file store: a real localStorage dump ──────────────');
  const dump = path.join(dir, 'localstorage-dump.json');
  const w2 = seedWorld();
  writeFileSync(dump, JSON.stringify({
    hg_profile: JSON.stringify(w2.Profile),
    hg_customCards: JSON.stringify(w2.Forge.customCards),
    hg_customMoves: JSON.stringify(w2.Forge.customMoves),
    hg_sprites: '{"keep":"me"}',
    hg_profile_owner: 'u-seed',
  }, null, 2) + '\n', 'utf8');
  const st1 = fileStore(dump);
  ok(st1.format === 'localstorage', 'the dump is recognised as a localStorage dump', st1.format);
  const snapF = snapshotOf(st1);
  ok(snapF.counts.customCards === 30 && snapF.counts.decks === 5 && snapF.counts.customMoves === 12 &&
     snapF.counts.deckByHero === 5 && snapF.counts.archonDeck === 8,
    'all five read out of the dump: ' + JSON.stringify(snapF.counts));
  const snapFile = path.join(dir, 'export-B.json');
  writeFileSync(snapFile, JSON.stringify(snapF, null, 2) + '\n', 'utf8');

  // a migration mangles the file on disk
  const mangled = JSON.parse(readFileSync(dump, 'utf8'));
  const mp = JSON.parse(mangled.hg_profile);
  mp.decks = [mp.decks[0]]; mp.deckByHero = {}; mp.archonDeck = { cards: [] };
  mp.gems = 5150;                                                        // the player also earned money
  mangled.hg_profile = JSON.stringify(mp);
  mangled.hg_customMoves = JSON.stringify({});
  mangled.hg_customCards = JSON.stringify(JSON.parse(mangled.hg_customCards).slice(0, 4));
  writeFileSync(dump, JSON.stringify(mangled, null, 2) + '\n', 'utf8');
  const wrecked = snapshotOf(fileStore(dump));
  console.log('  after the "migration": ' + JSON.stringify(wrecked.counts));

  const st2 = fileStore(dump);
  const r3 = restoreInto(st2, JSON.parse(readFileSync(snapFile, 'utf8')));
  ok(r3.written.length === 5, 'restore wrote all five back into the dump file', JSON.stringify(r3.written));
  const reread = fileStore(dump);
  const d5 = diffData(JSON.parse(readFileSync(snapFile, 'utf8')).data, snapshotOf(reread).data);
  console.log('  deep diff, export-B vs the file re-read from disk: ' + d5.length + ' difference(s)');
  console.log(formatDiff(d5).split('\n').map(l => '   ' + l).join('\n'));
  ok(d5.length === 0, 'ROUND TRIP THROUGH DISK: the five come back deeply equal');
  const finalDoc = JSON.parse(readFileSync(dump, 'utf8'));
  ok(JSON.parse(finalDoc.hg_profile).gems === 5150, 'money earned after the export is STILL there after the restore', String(JSON.parse(finalDoc.hg_profile).gems));
  ok(finalDoc.hg_sprites === '{"keep":"me"}' && finalDoc.hg_profile_owner === 'u-seed',
    'unrelated localStorage keys are untouched', JSON.stringify({ s: finalDoc.hg_sprites, o: finalDoc.hg_profile_owner }));
  ok(typeof finalDoc.hg_customCards === 'string' && typeof finalDoc.hg_profile === 'string',
    'the dump stays a dump — values written back as JSON strings, as the browser stores them');

  // an in-game backup payload as a source, since that is what an admin has
  const payloadFile = path.join(dir, 'ingame-payload.json');
  const w3 = seedWorld();
  writeFileSync(payloadFile, JSON.stringify({
    version: 1, exportedAt: '2026-01-01T00:00:00.000Z',
    forge: { customCards: w3.Forge.customCards, customMoves: w3.Forge.customMoves, sprites: {} },
    profile: w3.Profile,
  }, null, 2) + '\n', 'utf8');
  const sp = snapshotOf(fileStore(payloadFile));
  ok(sp.source.format === 'payload' && sp.counts.customCards === 30 && sp.counts.decks === 5,
    'an in-game backup payload works as a source too', JSON.stringify(sp.counts));
  ok(canon(sp.data) === canon(sA.data), '…and yields the identical five');

  /* ── 7. against the REAL writer, not my idea of it ───────────────────────
     Everything above runs on shapes this file invented. This section lifts
     saveDeckEntry (index.html:60286, the function the two deck anchors live
     in) and deleteDeckEntry out of the shipped source and runs them in a vm,
     so the structures being diffed are the ones the game actually writes. */
  console.log('\n── 7. the real writer lifted from public/index.html ─────');
  const srcPath = path.join(HERE, '..', 'public', 'index.html');
  const SRC = readFileSync(srcPath, 'utf8');
  /* The async-aware lifter (_vaultcap_smoke.mjs:26). The naive version drops a
     leading `async`, which is a parse error, which reports as a CRASH with no
     FAIL line — silent green. */
  const fnText = (name) => {
    let i = SRC.indexOf('function ' + name + '(');
    if (i < 0) throw new Error('cannot find ' + name + ' in ' + srcPath);
    if (SRC.slice(i - 6, i) === 'async ') i -= 6;
    let d = 0;
    for (let k = SRC.indexOf('{', i); k < SRC.length; k++) {
      if (SRC[k] === '{') d++;
      else if (SRC[k] === '}') { d--; if (!d) return SRC.slice(i, k + 1); }
    }
    throw new Error('unbalanced braces lifting ' + name);
  };
  const wv = seedWorld();
  const saved = { n: 0 };
  const ctx = {
    console, window: {}, Profile: wv.Profile, Forge: wv.Forge,
    findHeroById: () => null,          // no catalog here → the entry keeps the deck's own snapshot
    resolveDeckCard: () => null,       // …and no hero card in the list → heroId is not re-pinned
    saveProfile: () => { saved.n++; return true; },
  };
  vm.createContext(ctx);
  vm.runInContext([fnText('getAllDecks'), fnText('saveDeckEntry'), fnText('deleteDeckEntry')].join('\n'), ctx);
  ok(true, 'lifted getAllDecks + saveDeckEntry + deleteDeckEntry from index.html (' + SRC.length + ' bytes of source)');

  const realBefore = snapshotOf(memoryStore(ctx));
  ctx.__edit = clone(ctx.Profile.decks[2]);
  ctx.__edit.name = 'Renamed By The Real Function';
  vm.runInContext('saveDeckEntry(__edit)', ctx);
  const realDiff = diffData(realBefore.data, snapshotOf(memoryStore(ctx)).data);
  console.log(formatDiff(realDiff).split('\n').map(l => '   ' + l).join('\n'));
  ok(saved.n === 1, 'the lifted function ran and persisted once', 'saveProfile calls: ' + saved.n);
  ok(realDiff.length === 2, 'renaming one deck through the REAL writer moves exactly two fields (' + realDiff.length + ')');
  ok(realDiff.some(e => e.path === 'profile.decks[id=deck_2].name') &&
     realDiff.some(e => e.path === 'profile.deckByHero.card_14.name'),
    '…the deck AND its legacy deckByHero mirror (index.html:60321) — rule 3, shown not asserted',
    realDiff.map(e => e.path).join(', '));

  const afterSave = snapshotOf(memoryStore(ctx));
  vm.runInContext('deleteDeckEntry("deck_1")', ctx);
  const delDiff = diffData(afterSave.data, snapshotOf(memoryStore(ctx)).data);
  console.log(formatDiff(delDiff).split('\n').map(l => '   ' + l).join('\n'));
  ok(delDiff.length === 1 && delDiff[0].op === '-' && delDiff[0].path === 'profile.decks[id=deck_1]',
    'deleting a deck through the REAL writer shows as exactly one removal', delDiff.map(e => e.op + e.path).join(','));
  /* Not a failure — a finding, and the reason this tool exists. deleteDeckEntry
     (index.html:60329) filters Profile.decks and never touches deckByHero, so
     the deleted deck's hero entry stays behind. Any migration piece that walks
     one field and not the other inherits this. */
  const orphan = snapshotOf(memoryStore(ctx)).data.profile.deckByHero.card_07;
  console.log('  NOTE: after deleting deck_1, deckByHero.card_07 is still there — ' + short(orphan, 70));

  /* ── 8. an UNREADABLE source ─────────────────────────────────────────────
     The hole a critic proved with a mutant and watched pass: parseMaybe
     swallowed a JSON parse failure and the caller substituted {}. Everything
     here drives the REAL CLI in a child process, because the claim being made
     is about exit codes and about which files exist afterwards — neither of
     which a function call can prove. */
  console.log('\n── 8. unreadable source: fail loud, never restore ───────');
  const SELF = fileURLToPath(import.meta.url);
  const runCli = (...a) => {
    const r = spawnSync(process.execPath, [SELF, ...a], { encoding: 'utf8' });
    return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
  };
  const fileSha = f => sha256(readFileSync(f, 'utf8'));

  const w4 = seedWorld();
  const healthy = {
    hg_profile: JSON.stringify(w4.Profile),
    hg_customCards: JSON.stringify(w4.Forge.customCards),
    hg_customMoves: JSON.stringify(w4.Forge.customMoves),
    hg_profile_owner: 'u-seed',
  };
  const profileKeys = Object.keys(w4.Profile).length;
  const okDump = path.join(dir, 'u-control.json');
  writeFileSync(okDump, JSON.stringify(healthy, null, 2) + '\n', 'utf8');
  const ctrlSnap = snapshotOf(fileStore(okDump));
  ok(ctrlSnap.counts.decks === 5 && ctrlSnap.counts.archonDeck === 8 && ctrlSnap.unreadable === undefined,
    'CONTROL: the same dump UNtruncated reads all five and is not stamped (' + JSON.stringify(ctrlSnap.counts) + ')');

  // The mutant: hg_profile cut mid-write, which is what a half-copied
  // devtools dump or a clipboard that ran out actually looks like.
  const truncDump = path.join(dir, 'u-truncated.json');
  writeFileSync(truncDump, JSON.stringify({ ...healthy, hg_profile: healthy.hg_profile.slice(0, 900) }, null, 2) + '\n', 'utf8');
  console.log('  the mutant: hg_profile cut from ' + healthy.hg_profile.length + ' chars to 900, holding ' +
    profileKeys + ' profile keys including gems ' + w4.Profile.gems + ' / sovereigns ' + w4.Profile.sovereigns);

  let uThrew = null;
  try { fileStore(truncDump); } catch (e) { uThrew = e.message; }
  ok(uThrew !== null && /UNREADABLE SOURCE/.test(uThrew) && /hg_profile/.test(uThrew),
    'fileStore REFUSES a truncated hg_profile and names the key', (uThrew || 'no throw').split('\n')[0].slice(-90));

  const noSuchDir = path.join(dir, 'u-nothing-written');
  const exp = runCli('export', '--from', truncDump, '--out', noSuchDir);
  ok(exp.code !== 0, 'export EXITS NON-ZERO on it (exit ' + exp.code + ', was 0 before this guard)');
  ok(/hg_profile/.test(exp.out) && /UNREADABLE SOURCE/.test(exp.out),
    '…and the message names the unreadable key', exp.out.trim().split('\n')[0].slice(0, 110));
  ok(!existsSync(noSuchDir), 'export wrote NO file — the output dir does not even exist', noSuchDir);
  ok(!/ABSENT/.test(exp.out), '…and it never printed a count, so nobody reads 3-of-5 as a backup');

  /* The half that destroyed data: a GOOD snapshot restored INTO the truncated
     dump. `profile` was the {} the failed parse left, so commit() wrote
     hg_profile as {decks,deckByHero,archonDeck} — measured at 8 keys down to
     3, gems and sovereigns gone. The file must now come out byte-identical. */
  const goodSnapFile = path.join(dir, 'u-good-export.json');
  writeFileSync(goodSnapFile, JSON.stringify(snapshotOf(fileStore(okDump)), null, 2) + '\n', 'utf8');
  const beforeSha = fileSha(truncDump), beforeLen = readFileSync(truncDump, 'utf8').length;
  const rest = runCli('restore', goodSnapFile, '--into', truncDump);
  ok(rest.code !== 0, 'restore INTO the truncated dump exits non-zero (exit ' + rest.code + ', was 0)');
  ok(/hg_profile/.test(rest.out), '…naming hg_profile', rest.out.trim().split('\n')[0].slice(0, 110));
  ok(fileSha(truncDump) === beforeSha,
    'the dump on disk is BYTE-IDENTICAL after the refusal (' + beforeLen + ' chars, sha ' + beforeSha.slice(0, 12) + '…)');
  const stillCut = JSON.parse(readFileSync(truncDump, 'utf8')).hg_profile;
  let reparsed = null; try { reparsed = JSON.parse(stillCut); } catch (e) { reparsed = null; }
  ok(reparsed === null && stillCut.length === 900,
    'hg_profile is still the 900-char truncation, NOT a 3-key object with the wallet missing',
    reparsed ? Object.keys(reparsed).join(',') : 'unparseable, as it was');

  // salvage: read-only, stamped, and refused by every restore path
  const salvFile = path.join(dir, 'u-salvage.json');
  const salv = runCli('export', '--from', truncDump, '--out', salvFile, '--allow-unreadable');
  ok(salv.code === 0 && existsSync(salvFile), '--allow-unreadable takes a read-only salvage export (exit ' + salv.code + ')');
  const salvSnap = JSON.parse(readFileSync(salvFile, 'utf8'));
  ok(Array.isArray(salvSnap.unreadable) && /hg_profile/.test(salvSnap.unreadable.join(';')) &&
     salvSnap.counts.customCards === 30 && salvSnap.counts.decks === null,
    'the salvage is stamped and keeps the 30 cards that DID parse (decks: ' + salvSnap.counts.decks + ' = unknown)',
    JSON.stringify(salvSnap.unreadable));
  ok(/SALVAGE EXPORT/.test(salv.out) && /CANNOT be restored from/.test(salv.out),
    '…and it says so on the way out', salv.out.trim().split('\n')[0]);
  let sThrew = null;
  try { restoreInto(memoryStore(seedWorld()), salvSnap); } catch (e) { sThrew = e.message; }
  ok(sThrew !== null && /SALVAGE/.test(sThrew), 'a salvage snapshot is REFUSED by restore', (sThrew || 'no throw').slice(0, 90));
  let fThrew = null;
  try { restoreInto(memoryStore(seedWorld()), salvSnap, { force: true }); } catch (e) { fThrew = e.message; }
  ok(fThrew !== null && /SALVAGE/.test(fThrew),
    '…and --force does NOT override it (force is for a hash a human accepted, never for a failed parse)',
    (fThrew || 'no throw — FORCE PUNCHED THROUGH').slice(0, 90));
  ok(verifySnapshot(salvSnap).some(p => /SALVAGE/.test(p)), 'verify reports it as a problem',
    verifySnapshot(salvSnap).join('; ').slice(0, 90));
  const vSalv = runCli('verify', salvFile);
  ok(vSalv.code === 2, 'the verify CLI exits 2 on a salvage (exit ' + vSalv.code + ')');
  let cThrew = null;
  try { const s = fileStore(truncDump, { allowUnreadable: true }); s.write('decks', []); } catch (e) { cThrew = e.message; }
  ok(cThrew !== null && /refusing to WRITE/.test(cThrew),
    'a salvage store refuses write() directly too — the guard is not only in the CLI', (cThrew || 'no throw').slice(0, 80));

  // the other three unreadable shapes
  const shapeCase = (name, patch, wantKey) => {
    const f = path.join(dir, 'u-' + name + '.json');
    writeFileSync(f, JSON.stringify({ ...healthy, ...patch }, null, 2) + '\n', 'utf8');
    let m = null; try { fileStore(f); } catch (e) { m = e.message; }
    ok(m !== null && m.includes(wantKey), 'refused: ' + name + ' (names ' + wantKey + ')', (m || 'NO THROW').split('\n')[0].slice(-80));
  };
  shapeCase('cards-truncated', { hg_customCards: healthy.hg_customCards.slice(0, 700) }, 'hg_customCards');
  shapeCase('moves-truncated', { hg_customMoves: healthy.hg_customMoves.slice(0, 200) }, 'hg_customMoves');
  shapeCase('profile-is-null', { hg_profile: 'null' }, 'hg_profile');

  /* Rule 2 must be untouched by all of this: a key that is genuinely ABSENT is
     still nothing, and must NOT raise a false alarm — a guard that cries wolf
     on a healthy dump gets switched off, and then the hole above is back. */
  const absentDump = path.join(dir, 'u-no-profile.json');
  const noProfile = { ...healthy }; delete noProfile.hg_profile;
  writeFileSync(absentDump, JSON.stringify(noProfile, null, 2) + '\n', 'utf8');
  let aThrew = null, aSnap = null;
  try { aSnap = snapshotOf(fileStore(absentDump)); } catch (e) { aThrew = e.message; }
  ok(aThrew === null && aSnap && aSnap.counts.customCards === 30 && aSnap.counts.decks === null &&
     aSnap.unreadable === undefined,
    'RULE 2 INTACT: hg_profile genuinely absent still reads the forge two and reports the three ABSENT',
    aThrew || JSON.stringify(aSnap && aSnap.counts));
  /* diff reads a store too, and it writes nothing — but a diff that read the
     truncated dump as empty would print "the five were removed" to a human
     about to act on it, which is the same lie one step further from the disk. */
  const dCli = runCli('diff', goodSnapFile, truncDump);
  ok(dCli.code === 1 && /UNREADABLE SOURCE/.test(dCli.out),
    'diff against an unreadable dump errors (exit ' + dCli.code + ') instead of reporting the five as removed',
    dCli.out.trim().split('\n')[0].slice(0, 100));
  const dOk = runCli('diff', goodSnapFile, okDump);
  ok(dOk.code === 0 && /0 difference\(s\)/.test(dOk.out),
    'CONTROL: the same diff against the untruncated dump is 0 difference(s) (exit ' + dOk.code + ')',
    dOk.out.trim().split('\n').slice(-2)[0]);

  const vOk = runCli('verify', goodSnapFile);
  ok(vOk.code === 0, 'CONTROL: a healthy export still verifies clean (exit ' + vOk.code + ')');

  /* ── 9. the four bypasses, and the launder ───────────────────────────────
     Section 8 only ever proved the localStorage string branch, and that is
     exactly how much of the tool was guarded. Two critics reached the pre-fix
     signature — exit 0, file WRITTEN, 3 of 5 ABSENT, verify OK — through four
     other documented shapes, and laundered a refused salvage into an accepted
     backup with one ordinary command. Every one of those is a named mutant
     here and each is ALSO runnable on its own:
       node .gauntlet/forge-export.mjs mutant <name>
     The control is in the same list on purpose: a guard that refuses
     everything would pass all four of these and be worthless. */
  console.log('\n── 9. the bypass shapes: guarded at the RESOLVE point ───');
  const mutantOut = n => path.join(dir, 'mutant-out-' + n);
  for (const n of ['payload-truncated-profile', 'raw-truncated-profile', 'snapshot-profile-as-string', 'customcards-null-string']) {
    const o = mutantOut(n);
    const r = runCli('mutant', n, '--out', o);
    const named = /UNREADABLE SOURCE/.test(r.out) && /Profile\.decks|Forge\.customCards/.test(r.out);
    ok(r.code !== 0 && named && !existsSync(o),
      'MUTANT ' + n + ': refused (exit ' + r.code + '), names the structure, NO file at the out path',
      'exit ' + r.code + ' / named ' + named + ' / wrote ' + existsSync(o) + ' :: ' +
      (r.out.split('\n').find(l => /UNREADABLE SOURCE/.test(l)) || r.out.trim().split('\n')[0] || '').slice(0, 120));
  }
  {
    const n = 'salvage-relaunder', o = mutantOut(n);
    const r = runCli('mutant', n, '--out', o);
    ok(r.code !== 0 && /SALVAGE SOURCE/.test(r.out) && !existsSync(o),
      'MUTANT ' + n + ': re-exporting a salvage is REFUSED (exit ' + r.code + '), no laundered file',
      (r.out.split('\n').find(l => /UNREADABLE SOURCE/.test(l)) || 'no refusal line').slice(0, 120));
  }
  {
    /* Both directions, or the fix has just made the tool refuse everything. */
    const n = 'empty-control', o = mutantOut(n);
    const r = runCli('mutant', n, '--out', o);
    const wrote = existsSync(o);
    ok(r.code === 0 && wrote, 'CONTROL ' + n + ': a genuinely EMPTY save still EXPORTS (exit ' + r.code + ', wrote ' + wrote + ')',
      r.out.trim().split('\n').slice(-3).join(' | ').slice(0, 140));
    ok(!/ABSENT/.test(r.out) && !/UNREADABLE/.test(r.out),
      '…and every structure is reported as 0, not as ABSENT and not as unreadable',
      r.out.split('\n').filter(l => /Forge\.|Profile\./.test(l)).join(' | ').slice(0, 150));
  }

  /* ── 9c. the MODULE entry point, which had no guard at all ──────────────
     Sections 8 and 9 drive the CLI, and the CLI reads files, so every one of
     them proves fileStore. `memoryStore` is what the header tells a migration
     piece to call and what the live-data migrations will run, and it had no
     resolve pass and no `unreadable` list: the original silent-partial-backup
     signature was still reachable inside the fixed tool. Both the mutant (the
     tool's own exit code) and the raw call (the exact line a critic measured)
     are checked here. */
  console.log('\n── 9c. memoryStore: the documented module entry point ───');
  {
    const n = 'memory-truncated-profile';
    const r = runCli('mutant', n);
    ok(r.code !== 0 && /UNREADABLE SOURCE/.test(r.out) && /Profile\.decks/.test(r.out) &&
       !/THE MUTANT ESCAPED/.test(r.out),
      'MUTANT ' + n + ': refused (exit ' + r.code + '), names the structure, no snapshot returned',
      (r.out.split('\n').find(l => /UNREADABLE SOURCE/.test(l)) || r.out.trim().split('\n')[0] || '').slice(0, 130));
  }
  const wM = seedWorld();
  const cutM = JSON.stringify(wM.Profile).slice(0, 900);
  let mThrew = null, mSnap = null;
  try { mSnap = snapshotOf(memoryStore({ Forge: wM.Forge, Profile: cutM })); } catch (e) { mThrew = e.message; }
  ok(mThrew !== null && /UNREADABLE SOURCE/.test(mThrew) && /Profile\.decks/.test(mThrew) && mSnap === null,
    'snapshotOf(memoryStore({Forge, Profile:<cut to 900>})) THROWS naming Profile.decks ' +
    '(it returned a 3-of-5 snapshot before)',
    mThrew ? mThrew.split('\n')[0].slice(-95) : 'NO THROW — counts ' + JSON.stringify(mSnap && mSnap.counts));
  let nThrewM = null;
  try { snapshotOf(memoryStore({ Forge: { customCards: null, customMoves: wM.Forge.customMoves }, Profile: wM.Profile })); }
  catch (e) { nThrewM = e.message; }
  ok(nThrewM !== null && /Forge\.customCards/.test(nThrewM),
    '…and Forge.customCards = null is refused there too, not read as absent (snapshotOf reads null as absent)',
    (nThrewM || 'NO THROW').split('\n')[0].slice(-95));
  /* Both directions, again: a guard that refuses everything is not a guard. A
     genuinely empty world, and the seeded one, must still snapshot in memory. */
  let cThrewM = null, cSnapM = null;
  try {
    cSnapM = snapshotOf(memoryStore({ Forge: { customCards: [], customMoves: {} },
      Profile: { decks: [], deckByHero: {}, archonDeck: { cards: [] }, gems: 4242 } }));
  } catch (e) { cThrewM = e.message; }
  ok(cThrewM === null && cSnapM && Object.values(cSnapM.counts).every(c => c === 0) &&
     cSnapM.absent.length === 0 && cSnapM.unreadable === undefined,
    'CONTROL: a genuinely EMPTY in-memory world still snapshots, every count 0, none ABSENT, no stamp',
    cThrewM || JSON.stringify(cSnapM && cSnapM.counts));
  let aThrewM = null, aSnapM = null;
  try { aSnapM = snapshotOf(memoryStore({ Forge: wM.Forge })); } catch (e) { aThrewM = e.message; }
  ok(aThrewM === null && aSnapM && aSnapM.counts.customCards === 30 && aSnapM.absent.length === 3,
    'RULE 2 INTACT in memory: no Profile at all is still ABSENT, not unreadable (' +
    (aSnapM ? aSnapM.absent.length : '?') + ' absent, 30 cards read)', aThrewM || '');
  /* And the salvage door, so the module entry point is not a dead end when the
     only copy of a save IS damaged — read-only, stamped, refused by restore. */
  const salvM = snapshotOf(memoryStore({ Forge: wM.Forge, Profile: cutM }, 'salvage', { allowUnreadable: true }));
  let smThrew = null;
  try { restoreInto(memoryStore(seedWorld()), salvM, { force: true }); } catch (e) { smThrew = e.message; }
  ok(Array.isArray(salvM.unreadable) && salvM.unreadable.length === 3 && salvM.counts.customCards === 30 &&
     smThrew !== null && /SALVAGE/.test(smThrew),
    'memoryStore({allowUnreadable}) yields a STAMPED read-only salvage that restore refuses, --force included',
    (smThrew || 'no throw — LAUNDERED').slice(0, 80));
  let zThrew = null, zSnap = null;
  try { zSnap = snapshotOf(memoryStore(null)); } catch (e) { zThrew = e.message; }
  ok(zThrew !== null && /memoryStore needs/.test(zThrew) && zSnap === null,
    '…and a null world throws instead of snapshotting 0 of 5 in silence',
    (zThrew || 'NO THROW — counts ' + JSON.stringify(zSnap && zSnap.counts)).slice(0, 80));
  let wmThrew = null;
  try { memoryStore({ Forge: wM.Forge, Profile: cutM }, 'salvage', { allowUnreadable: true }).write('decks', []); }
  catch (e) { wmThrew = e.message; }
  ok(wmThrew !== null && /refusing to WRITE/.test(wmThrew),
    '…and that store refuses write() directly, exactly as the file one does', (wmThrew || 'no throw').slice(0, 80));

  /* The launder, spelled out. The salvage from section 8 is a legal store
     shape, so `export --from it` used to exit 0 and write a file with the SAME
     sha256 and no stamp: a refused backup turned restorable by one command. */
  console.log('\n── 9b. laundering the salvage stamp ────────────────────');
  const laundered = path.join(dir, 'laundered.json');
  const l1 = runCli('export', '--from', salvFile, '--out', laundered);
  ok(l1.code !== 0 && !existsSync(laundered),
    'LAUNDERING CLOSED: export --from <salvage> --out <new> refuses (exit ' + l1.code + ') and writes nothing',
    (l1.out.trim().split('\n')[0] || '').slice(0, 130));
  ok(/SALVAGE SOURCE/.test(l1.out) && /hg_profile/.test(l1.out),
    '…saying it is a salvage and still naming the original unreadable source', l1.out.trim().split('\n')[0].slice(-100));
  const l2 = runCli('export', '--from', salvFile, '--out', laundered, '--allow-unreadable');
  const lSnap = existsSync(laundered) ? JSON.parse(readFileSync(laundered, 'utf8')) : null;
  ok(l2.code === 0 && lSnap && Array.isArray(lSnap.unreadable) && lSnap.unreadable.length > 0,
    '…and the copy you CAN take with --allow-unreadable still carries the mark',
    lSnap ? JSON.stringify(lSnap.unreadable).slice(0, 120) : 'no file');
  ok(lSnap && lSnap.sha256 === salvSnap.sha256,
    'the data really was copied byte-for-byte (both hash ' + (lSnap ? lSnap.sha256.slice(0, 12) : '?') + '…) — the sha256 never was the thing protecting this');
  let lThrew = null;
  try { restoreInto(memoryStore(seedWorld()), lSnap, { force: true }); } catch (e) { lThrew = e.message; }
  ok(lThrew !== null && /SALVAGE/.test(lThrew), 'the copy is refused by restore too, --force included', (lThrew || 'no throw — LAUNDERED').slice(0, 90));
  const lV = runCli('verify', laundered);
  ok(lV.code === 2 && /SALVAGE/.test(lV.out), 'verify still calls the copy a salvage (exit ' + lV.code + ')');
  const lD = runCli('diff', laundered, goodSnapFile);
  ok(lD.code === 2 && /SALVAGE/.test(lD.out),
    'diff refuses to call a salvage identical to anything (exit ' + lD.code + ')', lD.out.trim().split('\n').slice(-2)[0]);

  /* And the same both-directions check one level down, on the store itself:
     empty is a COUNT of 0, unreadable is no count at all. */
  const emptyDump = path.join(dir, 'u-empty.json');
  const w5 = seedWorld();
  writeFileSync(emptyDump, JSON.stringify({
    hg_profile: JSON.stringify({ ...w5.Profile, decks: [], deckByHero: {}, archonDeck: { cards: [] } }),
    hg_customCards: '[]', hg_customMoves: '{}',
  }, null, 2) + '\n', 'utf8');
  const eSnap = snapshotOf(fileStore(emptyDump));
  ok(eSnap.unreadable === undefined && eSnap.absent.length === 0 &&
     Object.values(eSnap.counts).every(c => c === 0),
    'EMPTY vs UNREADABLE: all five present-and-empty read as 0, none ABSENT, no stamp — ' + JSON.stringify(eSnap.counts),
    JSON.stringify({ absent: eSnap.absent, unreadable: eSnap.unreadable }));
  const nulled = path.join(dir, 'u-cards-null.json');
  writeFileSync(nulled, readFileSync(emptyDump, 'utf8').replace('"hg_customCards": "[]"', '"hg_customCards": "null"'), 'utf8');
  let nThrew = null;
  try { fileStore(nulled); } catch (e) { nThrew = e.message; }
  ok(nThrew !== null && /Forge\.customCards/.test(nThrew) && /hg_customCards/.test(nThrew),
    '…while the SAME file with hg_customCards="null" is refused, naming the structure and the source key',
    (nThrew || 'NO THROW').split('\n')[0].slice(-110));

  /* ── 10. a colleague's run must not redden this one ──────────────────────
     The scratch path used to be one FIXED directory that every run wiped on
     the way in, and section 9 spawns six children against it — so two runs on
     one machine deleted each other's fixtures mid-flight. Measured on the
     fixed path, two selftests started together: one exited 1 with
     `ENOENT … export-A.json`, zero FAIL lines, nothing wrong with the tool.
     Other agents work in this repo, and a gate that reddens because a
     colleague is running is a gate the run learns to ignore — so the second
     run is part of the gate now.
     The nested run is capped at one level by MYTHIC_FORGE_EXPORT_NESTED, and
     it must NOT inherit our scratch path or it would land in the very
     directory it is here to prove it stays out of. */
  console.log('\n── 10. concurrency: a second selftest, mid-run ─────────');
  if (process.env[NEST_ENV]) {
    console.log('  (nested run — this section is what spawned it; not recursing)');
  } else {
    ok(path.basename(dir).endsWith('-' + process.pid),
      'the scratch path carries this pid, so two runs cannot collide by construction', path.basename(dir));
    const filesBefore = readdirSync(dir).length;
    const shaBefore = fileSha(path.join(dir, 'export-A.json'));
    const env = { ...process.env, [NEST_ENV]: '1' };
    delete env[SCRATCH_ENV];                       // it must pick its OWN, exactly as a colleague would
    const r = spawnSync(process.execPath, [SELF, 'selftest'], { encoding: 'utf8', env });
    const out = (r.stdout || '') + (r.stderr || '');
    const theirDir = (out.match(/^scratch: (.+?)  \(pid/m) || [])[1];
    ok(r.status === 0, 'a SECOND selftest, run while this one holds its fixtures, exits 0 (exit ' + r.status + ')',
      out.trim().split('\n').slice(-1)[0]);
    ok((out.match(/  PASS /g) || []).length > 0 && !/  FAIL /.test(out),
      '…with ' + (out.match(/  PASS /g) || []).length + ' PASS and 0 FAIL of its own');
    ok(theirDir && theirDir !== dir, '…in its own scratch directory, not ours', theirDir + ' vs ' + dir);
    ok(existsSync(dir) && readdirSync(dir).length >= filesBefore && fileSha(path.join(dir, 'export-A.json')) === shaBefore,
      'OUR fixtures survived it untouched (' + filesBefore + ' entries, export-A sha ' + shaBefore.slice(0, 12) + '…)',
      existsSync(dir) ? readdirSync(dir).length + ' entries now' : 'OUR SCRATCH DIRECTORY IS GONE');
  }

  console.log('\n' + (fails ? fails + ' FAILED' : 'ALL CLEAN') + '  (files kept in ' + dir + ')');
  return fails ? 1 : 0;
}

function usage() {
  // Print the header block itself — found by its terminator, not by a line
  // number that goes stale the first time anyone edits the comment.
  const lines = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
  const end = lines.findIndex(l => l.trimEnd().endsWith('*/'));
  console.log(lines.slice(1, end + 1).join('\n'));
  return 1;
}

const CMDS = { export: cmdExport, restore: cmdRestore, diff: cmdDiff, verify: cmdVerify, seed: cmdSeed, mutant: cmdMutant, selftest: cmdSelftest };

/* ⚠ ONLY when this file IS the command. Without this guard, a migration piece
   doing `import { snapshotOf } from './forge-export.mjs'` would run the CLI at
   import time, print the help and process.exit() out of its caller — the
   backup tool killing the script that was trying to take a backup. */
const isMain = (() => {
  try { return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] || ''); }
  catch (e) { return false; }
})();
if (isMain) {
  const run = CMDS[argv[0]];
  if (!run) process.exit(usage());
  try { process.exit(run()); }
  catch (e) { console.error('error: ' + e.message); process.exit(1); }
}
