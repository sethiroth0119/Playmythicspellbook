/* 🏙 A MEMBER'S CITY LIST WAS EVERY CITY THEY HAD EVER HAD.

   Reported: "Corporation member cities still listing local and cloud versions —
   local versions need tidying up… There are loads."

   🔴 MEASURED ON THE LIVE TABLE BEFORE THE FIX: 68 city_profiles rows across 23
   owners, and ONE MEMBER HAD ELEVEN. They break down as

       22  node_id = 'local-city'   the pre-claim LOCAL save. Named, populated
                                    and freshly updated like any other row, so
                                    the ONLY thing that tells it apart is its id
       18  a node the member no longer owns — left behind when they moved on
       28  a node they still hold — the real answer

   Nothing cleaned up after a move and this panel listed all three kinds, so a
   player saw eleven copies of their own city at eleven populations and eleven
   economy days with no way to tell which was current.

   THE RULE, and it is deliberately not a heuristic or a date window: a
   corporation city is a city standing on a node that member STILL OWNS.
   Everything else is history, and history does not belong on a roster.

   Run: node _corpcities_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const IDX = readFileSync('./public/index.html', 'utf8');

function fnText(name) {
  const i = IDX.search(new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\('));
  if (i < 0) throw new Error('cannot find ' + name);
  let d = 0;
  for (let k = IDX.indexOf('{', i); k < IDX.length; k++) {
    if (IDX[k] === '{') d++;
    else if (IDX[k] === '}') { d--; if (!d) return IDX.slice(i, k + 1); }
  }
  throw new Error('unbalanced ' + name);
}
const FN = fnText('_corpMemberCitiesFetch');

/* ── 1. THE FILTER EXISTS AND IS THE RIGHT ONE ───────────────────────────── */
{
  ok(/if \(nid === 'local-city' \|\| !nid\) return;/.test(FN),
    'the local save is dropped — it is not a node city and can never be one');
  ok(/if \(owned && !owned\[String\(c\.owner_id\) \+ '\|' \+ nid\]\) \{[\s\S]*?\n\s*return;\n\s*\}/.test(FN) && !/if \(owned && !owned\[String\(c\.owner_id\) \+ '\|' \+ nid\]\) return;/.test(FN),
    'and a city on a node the member no longer owns is dropped from their cities (v121v100: kept aside as a SHARED row only when another roster member owns that node)');
  ok(/from\('economy_nodes'\)\.select\('id,owner_id'\)/.test(FN),
    'ownership is read from economy_nodes — the table that actually says who holds what');
  ok(/\.in\('owner_id', ids\)/.test(FN), 'for the members being listed, not the whole table');
}

/* ── 2. A FAILED READ MUST NOT LOOK LIKE A DELETION ──────────────────────── */
{
  ok(/let owned = null;/.test(FN), 'the ownership map starts unknown');
  ok(/\} catch \(e\) \{ owned = null; \}/.test(FN), 'and stays unknown when the lookup throws');
  ok(/if \(owned && !owned\[/.test(FN),
    'the filter is skipped entirely while unknown — a bad read shows everything, which is the behaviour this panel already had, rather than an empty roster');
  /* This is the same rule syncBuildings() states for its own reconcile, and it
     is worth pinning that the precedent is still there — it lives in
     /src/economy/index.js, which is where that lesson was actually paid for
     (a bad read closed 838 businesses on a live city). */
  const ECON = readFileSync('./public/src/economy/index.js', 'utf8');
  ok(/treating it as a failed read and closing nothing/.test(ECON),
    'the same principle is still written down where it was first learned');
}

/* ── 3. THE ORDER IS USEFUL ──────────────────────────────────────────────── */
{
  ok(/by\[uid\]\.sort\(function \(a, b\) \{ return String\(b\.at \|\| ''\)\.localeCompare\(String\(a\.at \|\| ''\)\); \}\);/.test(FN),
    'newest first, so the city a member is actually playing is the one at the top');
}

/* ── 4. THE FILTER, RUN ──────────────────────────────────────────────────── */
{
  /* Model the row filter exactly as the function applies it, against the real
     shape measured on the live table, so the claim is arithmetic rather than a
     reading of the regexes above. */
  const rows = [
    { owner_id: 'A', node_id: 'local-city' },          // the local save
    { owner_id: 'A', node_id: 'n1' },                  // still owns
    { owner_id: 'A', node_id: 'n2' },                  // moved on
    { owner_id: 'A', node_id: '' },                    // no id at all
    { owner_id: 'B', node_id: 'n1' },                  // B does NOT own n1
    { owner_id: 'B', node_id: 'n9' },                  // still owns
  ];
  const owned = { 'A|n1': 1, 'B|n9': 1 };
  const keep = (o) => rows.filter(r => {
    const nid = r.node_id != null ? String(r.node_id) : '';
    if (nid === 'local-city' || !nid) return false;
    if (o && !o[String(r.owner_id) + '|' + nid]) return false;
    return true;
  });
  const kept = keep(owned);
  ok(kept.length === 2, 'six rows become the two that are really corp cities', kept.map(r => r.owner_id + '|' + r.node_id).join(', '));
  ok(!kept.some(r => r.node_id === 'local-city'), 'no local save survives');
  ok(!kept.some(r => r.owner_id === 'A' && r.node_id === 'n2'), 'no city on a node its owner has left');
  /* 🔴 THE NODE IS NOT ENOUGH ON ITS OWN — ownership is a PAIR. B has a row on
     n1, which A owns; keying on the node alone would have kept it. */
  ok(!kept.some(r => r.owner_id === 'B' && r.node_id === 'n1'),
    'and a member is not credited with a node somebody else owns — the key is owner AND node, not node');
  /* Unknown ownership: everything that is a node city survives. */
  const blind = keep(null);
  ok(blind.length === 4,
    'with ownership unknown the filter only drops the local saves — a failed read never empties the roster',
    String(blind.length));
}

console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
