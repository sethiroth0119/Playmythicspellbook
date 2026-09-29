/* 👤🏷 TWO THINGS THAT WERE INVISIBLE FOR THE SAME REASON (v121v71).

   Reported: "this keeps appearing, what is it" (a chip reading c55 / c59), and
   "I cannot find the sell node button to start the process".

   1. c55 IS A CITIZEN ID. citAdd mints 'c' + seq, and a save carrying one in
      the NAME slot puts it on the workforce row, the speech bubble and the
      People modal — everywhere c.name is printed. Both writers have always
      used citName(), so the bad rows are historical and round-trip through
      citSave; only a repair on load can clear them.

   2. THE SELL BUTTON WAS HIDDEN BY "DON'T KNOW", NOT BY "NOT YOURS".
      _twNodeOwnerUser answers null both when a node is unowned and when
      tw_node_owners has not been read — and this file already documents that
      an unauthenticated select on that table returns zero rows and NO error.
      The section read that as "not the owner" and returned an empty string, so
      the owner got no button and no reason. _twOwnersReady() exists exactly to
      tell those apart; this render site was the one not asking.

   Run: node _citname_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
const NC  = readFileSync('./public/node-city/index.html', 'utf8');

/* ── the name repair, run for real ── */
{
  /* citName and the restore rule, lifted and driven together. */
  const i = NC.indexOf('function citName(seq) {');
  const citName = NC.slice(i, NC.indexOf('}', NC.indexOf('return', i)) + 1);
  const given = NC.slice(NC.indexOf('const CIT_GIVEN'), NC.indexOf('];', NC.indexOf('const CIT_GIVEN')) + 2);
  const family = NC.slice(NC.indexOf('const CIT_FAMILY'), NC.indexOf('];', NC.indexOf('const CIT_FAMILY')) + 2);
  const seqOf = NC.slice(NC.indexOf('function citSeqOf('), NC.indexOf('\n', NC.indexOf('function citSeqOf(')));
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext([given, family, citName, seqOf].join('\n'), ctx);
  /* 🔴 v121v154 — THE SHIPPED EXPRESSION, LIFTED. NOT RETYPED.
     This block used to hand vm a hand-written copy of the rule under the
     comment "the shipped expression, verbatim". It was not verbatim: the copy
     had the backslash (/^c\d+$/) and the page had lost it (/^cd+$/), so the
     suite drove a CORRECT REIMPLEMENTATION, passed on every run, and watched a
     dead repair ship. "c87" reached the speech bubble for several builds with
     this file green the whole time.
     The predicate is now cut out of node-city/index.html, so what runs here is
     what runs in the game. If the anchor ever stops matching, that is a FAIL
     rather than a silent fallback to a copy — the fallback is what caused this. */
  const _nameLine = (NC.match(/name: \(typeof r\.n === 'string'[^\n]*\n[^\n]*\n[^\n]*/) || [])[0] || '';
  ok(!!_nameLine && _nameLine.indexOf('r.n.trim()') > 0, 'the shipped name-repair expression was found in the page');
  const _pred = (_nameLine.match(/!(\/\^[^/]*\/)\.test\(r\.n\.trim\(\)\)/) || [])[1] || '';
  ok(!!_pred, 'and its id-shape pattern was lifted out of it', _pred);
  ok(_pred === '/^c\\d+$/',
    'THE LIFTED PATTERN IS /^c\\d+$/ — the backslash is the whole bug; /^cd+$/ matches "cd"/"cdd" and never a real id, which is how the repair came to do nothing at all',
    _pred);
  vm.runInContext(
    "function restoreName(n, id) { return (typeof n === 'string' && n.trim() && !" + _pred + ".test(n.trim())) ? n.trim().slice(0, 40) : citName(citSeqOf(id)); }",
    ctx);
  const nm = (n, id) => vm.runInContext('restoreName(' + JSON.stringify(n) + ',' + JSON.stringify(id) + ')', ctx);

  ok(nm('c55', 'c55') !== 'c55', 'a name that is its own id is repaired, not printed', nm('c55', 'c55'));
  ok(/^[A-Z]/.test(nm('c55', 'c55')) && nm('c55', 'c55').includes(' '), 'and becomes a real Given Family name', nm('c55', 'c55'));
  ok(nm('c59', 'c59') === nm('c59', 'c59'), 'deterministically — the same citizen is the same person every load');
  ok(nm('c55', 'c55') !== nm('c59', 'c59'), 'and two citizens are two people', nm('c55', 'c55') + ' / ' + nm('c59', 'c59'));
  /* It must not eat a legitimate name. */
  ok(nm('Tam Ashcroft', 'c55') === 'Tam Ashcroft', 'a real name is untouched');
  ok(nm('Cass', 'c7') === 'Cass', 'a short name starting with c is untouched');
  ok(nm('c55 Rusk', 'c55') === 'c55 Rusk', 'and so is a name that merely CONTAINS the shape');
  ok(nm('', 'c3') !== '' && nm(null, 'c3') !== null, 'an empty or absent name still generates one');
  {
    /* The repair is only safe because citName can never produce the id shape. */
    const bad = [];
    for (let n = 0; n < 400; n++) { const v = vm.runInContext('citName(' + n + ')', ctx); if (/^c\d+$/.test(v)) bad.push(n); }
    ok(bad.length === 0, 'no generated name can ever collide with the id shape — checked across 400 sequences', bad.join(','));
  }
}
ok(/A NAME THAT IS THE ID IS NOT A NAME/.test(NC), 'the repair records what it is repairing and why');
ok(/THE BACKSLASH IS THE WHOLE BUG/.test(NC),
  'and the comment no longer states the BROKEN pattern as the intended rule — prose describing a bug invites the next reader to "fix" the code back to match it');

/* ── the sell button ── */
ok(/const ownersKnown = \(typeof _twOwnersReady === 'function'\) \? _twOwnersReady\(\) : true;/.test(SRC),
  'the node modal now asks whether ownership is even KNOWN');
{
  const i = SRC.indexOf('if (!iOwn && me && !ownersKnown) {');
  ok(i > 0, 'and unknown gets its own branch');
  const seg = SRC.slice(i, i + 700);
  ok(/Still reading who owns this node/.test(seg), 'which says so instead of rendering nothing');
  ok(/List for Sale<\/b> button appears here/.test(seg), 'and tells the owner what to expect');
  /* The empty return must still exist — for a node that genuinely is not yours. */
  const j = SRC.indexOf("if (!iOwn) return '';", i);
  ok(j > i && (j - i) < 700, 'a node that really is not yours still shows nothing');
}
{
  const i = SRC.indexOf('const _ownHere = !!(_me && _nid && !App._cityOwnerId');
  ok(i > 0 && /\(_ownerHere === _me \|\| !_ownersKnown\)/.test(SRC.slice(i, i + 200)),
    'the city host bar takes the same fix — an unread owners table does not remove the button');
  ok(/!App\._cityOwnerId/.test(SRC.slice(i, i + 200)),
    'while a mayor in a CLIENT city still never sees it — that gate is untouched');
}
ok(/window\.__mg\._twSellNode = _twSellNode/.test(SRC), 'the seller entry point is still reachable from the modal');
ok(/window\.BUILD_VERSION = 'v121v(7[1-9]|[8-9]\d|\d{3,})'/.test(SRC), 'build v121v71 or later');
console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
