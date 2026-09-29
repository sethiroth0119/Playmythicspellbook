/* 🗺 A SHRINK REFUSAL IS NO LONGER A DEAD END (v121v69).

   Reported, for the third time: "I have added a new node and it is not saving
   again — Publish refused, that map has 41 nodes and the live one has 42."

   The refusal is correct and stays. What was wrong is that there was no way
   out of it, and the loop is invisible from inside:

     · this device's map is behind (another session published, or a fetch it
       never adopted);
     · the admin adds a node: 41 local against 42 live, and _twMapDirty is set;
     · the automatic publish is refused as a shrink, so dirty is never cleared;
     · and tw_cloudFetchWorldMap refuses to refresh WHILE dirty — that guard
       exists so a fetch cannot eat an unsaved node;
     · so the device can never learn about the live 42, and every publish for
       the rest of the session is refused with the same sentence.

   The fix is a union, not a force: both lists are true. 41 ∪ 42 = 43.

   Run: node _mapmerge_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
function fnText(name) {
  let i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name);
  if (SRC.slice(i - 6, i) === 'async ') i -= 6;
  let d = 0, j = SRC.indexOf('{', i);
  for (let k = j; k < SRC.length; k++) { if (SRC[k] === '{') d++; else if (SRC[k] === '}') { d--; if (!d) return SRC.slice(i, k + 1); } }
}

/* ── the merge itself, run for real ── */
{
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(fnText('_twMergeNodeLists'), ctx);
  const merge = (a, b) => vm.runInContext('_twMergeNodeLists(' + JSON.stringify(a) + ',' + JSON.stringify(b) + ')', ctx);
  const ids = (r) => r.nodes.map((n) => n.id).join(',');

  const live = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const mine = [{ id: 'a' }, { id: 'b' }, { id: 'z' }];
  const m = merge(live, mine);
  ok(ids(m) === 'a,b,c,z', 'the union keeps live order and appends what only this device has', ids(m));
  ok(m.added === 1, 'and counts what it contributed', String(m.added));

  /* The exact reported numbers. */
  const L = Array.from({ length: 42 }, (_, i) => ({ id: 'n' + i }));
  const M = Array.from({ length: 40 }, (_, i) => ({ id: 'n' + i })).concat([{ id: 'brand-new' }]);
  const r2 = merge(L, M);
  ok(r2.nodes.length === 43, '41 local against 42 live merges to 43 — nobody loses a node', String(r2.nodes.length));
  ok(r2.nodes.some((n) => n.id === 'brand-new'), "the admin's new node is in it");
  ok(r2.added === 1, 'and it is the only thing this device added');

  ok(ids(merge(live, [])) === 'a,b,c', 'an empty local list contributes nothing rather than wiping live');
  ok(ids(merge([], mine)) === 'a,b,z', 'and an unreadable live list does not delete the local one');
  ok(merge(live, live).added === 0, 'identical lists add nothing');
  ok(ids(merge([{ id: 'a' }, { id: 'a' }], [{ id: 'a' }])) === 'a', 'a duplicated id is taken once');
  ok(ids(merge([{ id: 1 }, null, { }], [{ id: 2 }])) === '1,2', 'junk rows without an id are dropped, not published');
  {
    /* ids are compared as strings, because that is how every other node lookup
       in this file keys them. */
    const mixed = merge([{ id: 7 }], [{ id: '7' }, { id: 8 }]);
    ok(mixed.nodes.length === 2 && mixed.added === 1, 'a numeric id and its string form are the same node', String(mixed.nodes.length));
  }
}

/* ── the hook, and what it must not do ── */
ok(/return await _twReconcileAndPublish\(_sent, _have\);/.test(SRC), 'the automatic refusal now reconciles instead of stopping');
{
  const i = SRC.indexOf("if (data && data.why === 'shrink')");
  const seg = SRC.slice(i, i + 1500);
  ok(/if \(!opts\.allowConfirm\) \{/.test(seg) && seg.indexOf('_twReconcileAndPublish') < seg.indexOf('gcConfirm'),
    'only the AUTOMATIC path merges');
  ok(/gcConfirm\(/.test(seg) && /force: true/.test(seg),
    'the explicit Publish Map button still asks a human and can still force — a deletion must stay possible');
}
{
  const f = fnText('_twReconcileAndPublish');
  ok(/if \(App\._twReconciling\) return null;/.test(f), 'it attempts once — a reconcile that refused cannot loop');
  ok(/finally \{ App\._twReconciling = false; \}/.test(f), 'and the latch always clears');
  ok(!/force: true/.test(f), 'it NEVER forces — forcing is what would let a stale device wipe the world');
  ok(/App\._twMapDirty = false;/.test(f), 'adopting live clears the dirty flag that was blocking every refresh');
  ok(/t\.regions = row\.doc\.regions \|\| t\.regions/.test(f), 'the live doc\'s other sections come with it — they were as stale as the nodes');
  ok(/if \(m\.nodes\.length <= \(row\.doc\.nodes \|\| \[\]\)\.length\)/.test(f),
    'a union no bigger than live is a deletion or a no-op, and is NOT published automatically');
  ok(/Could not read the live map/.test(f), 'and an unreadable live map changes nothing and says so');
}
{
  const f = fnText('_twLiveMapRow');
  ok(/from\('tw_world_map'\)/.test(f) && !/api\/worldmap/.test(f),
    'the live read goes to the table, not the edge cache that caused the original stale-map bug');
}

/* ── the guard that made it invisible still protects the edit ── */
{
  const i = SRC.indexOf("if (App._twMapDirty && typeof isAdmin === 'function' && isAdmin()) {");
  ok(i > 0, 'an unpublished edit still blocks a refresh that would eat it');
  ok(/refresh held — this device has an unpublished map edit/.test(SRC), 'and now says so in the console instead of nothing at all');
}
ok(/window\.BUILD_VERSION = 'v121v(69|[7-9]\d|\d{3,})'/.test(SRC), 'build v121v69 or later');
console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
