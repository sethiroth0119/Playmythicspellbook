/* ══════════════════════════════════════════════════════════════════════════
   🏙 DRIVE-CITY-CLAIM-OWNER — a settler must not re-key their only city onto
   somebody else's node.

   THE BUG. sql/065 made node_id half of city_state's primary key, so
   _cityNodeKey() now returns the real node id. But App._cityNodeId is whatever
   node is being LOOKED AT, and _openNodeCity deliberately lets a CONNECTED
   SETTLER open a node owned by another player — it says so in as many words:
   "there is one city per USER, not per node". So the settler's read misses on
   (me, theirNode) and _cityClaimNode fires city_claim_node('their-node'),
   which is ONE-WAY AND ONE-TIME (sql/065's header) and keys entirely on
   auth.uid(): it tests nothing about who owns p_node. Their one and only city
   is re-keyed onto a node they do not own, and retrying does not undo it.

   ⚠ THE REFUSAL MUST TRIGGER ON POSITIVE PROOF, NEVER ON `!iOwnIt`.
     "I do not own it" is also true when the ownership cache is cold or was
     never fetched — and refusing there hands a REAL settler the empty grid
     that sql/065's migration-hazard note calls the worse outcome, with no
     second chance. So unknown ownership must still adopt. Half of the checks
     below exist purely to fail an over-eager fix.

   ⚠ THIS DRIVES THE SHIPPED FUNCTION, NOT A COPY. _cityClaimNode is a
     module-scope `async function` — per CLAUDE.md's globals trap it is NOT
     reachable as window._cityClaimNode — so the driver extracts the real
     source text out of public/index.html and evaluates THAT, the same way
     drive-city-nodekey.mjs does. _twNodeOwnerUser is extracted too, so the
     ownership lookup under test is the shipped one and not a stand-in. A
     driver that tested a hand-written copy would pass while index.html stayed
     broken.

   ⚠ THE SERVER HALF IS READ, NOT RUN. sql/068_city_claim_node_owner_check.sql
     cannot be executed here — there is no database in this environment — so
     the last section asserts, textually, that it decides the UNKNOWN-OWNER
     case the same way the client does. A disagreement is a real failure: the
     player would get the toast without the re-key, or the re-key without the
     toast.

   Run:  node .gauntlet/drive-city-claim-owner.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';

const SRC = fs.readFileSync('public/index.html', 'utf8');
const SQL = fs.readFileSync('sql/068_city_claim_node_owner_check.sql', 'utf8');
const SENTINEL = '00000000-0000-0000-0000-000000000000';

/* ── §extract · pull the real function out of the shipped file ───────────── */
function extract(name) {
  // Matches `async function` too — _cityClaimNode is async, and a plain
  // '\nfunction ' probe silently returns null, which reads as "the function is
  // missing" when it is right there. (Same trap drive-city-nodekey.mjs records.)
  let at = SRC.indexOf('\nfunction ' + name + '(');
  if (at < 0) at = SRC.indexOf('\nasync function ' + name + '(');
  if (at < 0) return null;
  let i = SRC.indexOf('{', at), depth = 0, end = -1;
  for (let k = i; k < SRC.length; k++) {
    const c = SRC[k];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = k + 1; break; } }
  }
  return end < 0 ? null : SRC.slice(at + 1, end);
}

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  OK   ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };

const claimSrc = extract('_cityClaimNode');
const ownerSrc = extract('_twNodeOwnerUser');
if (!claimSrc) { console.error('FATAL: _cityClaimNode not found in public/index.html'); process.exit(1); }
if (!ownerSrc) { console.error('FATAL: _twNodeOwnerUser not found in public/index.html'); process.exit(1); }

/* ── the rig · the shipped function, with a recording rpc ────────────────── */
const ME = 'me-11111111-1111-1111-1111-111111111111';
const THEM = 'them-2222-2222-2222-2222-222222222222';

function rig(owners, meId, bodySrc) {
  const rec = [];
  const App = { _twNodeOwners: owners };
  const Profile = { cloud: meId ? { userId: meId } : null };
  const Cloud = {
    ready: true,
    client: {
      rpc: (name, args) => {
        rec.push({ name, args });
        // Answer the way sql/065 answers a settler with one sentinel city:
        // the re-key HAS happened by the time this resolves.
        return Promise.resolve({ error: null, data: { ok: true, action: 'adopted', tiles: 12, node: args && args.p_node } });
      },
    },
  };
  const f = new Function('Cloud', 'App', 'Profile', 'CITY_NODE_SENTINEL', 'showToast',
    ownerSrc + '\n' + (bodySrc || claimSrc) + '\nreturn _cityClaimNode;'
  )(Cloud, App, Profile, SENTINEL, () => {});
  return { call: (k) => f(k), rec };
}

/* 🔴 THE CONTROL — the body that shipped with sql/065, verbatim. Without it an
   over-eager fix and a correct one are indistinguishable: this one MUST fire
   the RPC on somebody else's node. */
const OLD_BODY = `async function _cityClaimNode(nodeKey) {
  try {
    if (!Cloud || !Cloud.ready || !Cloud.client) return false;
    if (!nodeKey || nodeKey === CITY_NODE_SENTINEL) return false;
    if (App._cityOwnerId) return false;
    const r = await Cloud.client.rpc('city_claim_node', { p_node: nodeKey });
    if (!r || r.error || !r.data) return false;
    if (r.data.action === 'adopted') { try { showToast('x'); } catch (_) {} return true; }
    return false;
  } catch (e) { return false; }
}`;

const NODE = 'N-25';
const owned = (uid) => ({ at: Date.now(), byNode: { [NODE]: { user_id: uid, display_name: 'GreyDragon' } } });

console.log('\n\u{1F3D9} CITY CLAIM · A SETTLER MUST NOT RE-KEY THEIR CITY ONTO ANOTHER PLAYER\'S NODE\n');

/* ── 1. the node belongs to somebody else → NOT ONE RPC ──────────────────── */
console.log('  ── the node is owned by another player');
{
  const r = rig(owned(THEM), ME);
  const out = await r.call(NODE);
  ok('\u{1F3AF} zero city_claim_node RPCs were issued', r.rec.length === 0, r.rec.length + ' call(s)');
  ok('\u{1F3AF} and it answers false, so the caller does not re-read', out === false, String(out));
}
{
  const c = rig(owned(THEM), ME, OLD_BODY);
  await c.call(NODE);
  ok('CONTROL · the sql/065-era body DID fire it (this is the bug)', c.rec.length === 1,
     c.rec.length + ' call(s) ' + JSON.stringify(c.rec[0] && c.rec[0].args));
}

/* ── 2. the node is mine → adopt, exactly once ───────────────────────────── */
console.log('\n  ── the node is mine');
{
  const r = rig(owned(ME), ME);
  const out = await r.call(NODE);
  ok('\u{1F3AF} exactly one city_claim_node RPC', r.rec.length === 1, r.rec.length + ' call(s)');
  ok('it was called with this node', !!(r.rec[0] && r.rec[0].args && r.rec[0].args.p_node === NODE),
     JSON.stringify(r.rec[0] && r.rec[0].args));
  ok('and the adoption is reported to the caller', out === true, String(out));
}

/* ── 3. no ownership data at all → STILL ADOPT ───────────────────────────── */
/* This is the half that must not regress. A cold cache is not evidence of a
   foreign owner, and refusing here costs a legitimate settler their city with
   no way back — sql/065's header calls the empty grid the worse outcome. */
console.log('\n  ── ownership data is not loaded (cold cache) — must NOT refuse');
{
  const r = rig(undefined, ME);
  const out = await r.call(NODE);
  ok('\u{1F3AF} exactly one city_claim_node RPC', r.rec.length === 1, r.rec.length + ' call(s)');
  ok('\u{1F3AF} the city is still adopted', out === true, String(out));
}
{
  // Loaded, but this node simply has no owner row — the common case.
  const r = rig({ at: Date.now(), byNode: { 'N-20': { user_id: THEM } } }, ME);
  const out = await r.call(NODE);
  ok('\u{1F3AF} loaded cache, no row for this node → one RPC, adopted',
     r.rec.length === 1 && out === true, r.rec.length + ' call(s), ' + String(out));
}
{
  // A row with a null user_id is not proof of anyone.
  const r = rig(owned(null), ME);
  const out = await r.call(NODE);
  ok('\u{1F3AF} owner row with a null user_id → one RPC, adopted',
     r.rec.length === 1 && out === true, r.rec.length + ' call(s), ' + String(out));
}

/* ── 4. the guards that were already there still hold ────────────────────── */
console.log('\n  ── the pre-existing guards are untouched');
{
  const App = { _cityOwnerId: 'someone-else', _twNodeOwners: undefined };
  const rec = [];
  const f = new Function('Cloud', 'App', 'Profile', 'CITY_NODE_SENTINEL', 'showToast',
    ownerSrc + '\n' + claimSrc + '\nreturn _cityClaimNode;'
  )({ ready: true, client: { rpc: (n, a) => { rec.push(a); return Promise.resolve({ data: {} }); } } },
    App, { cloud: { userId: ME } }, SENTINEL, () => {});
  const out = await f(NODE);
  ok('\u{1F3AF} a mayor still never re-keys the owner’s city', out === false && rec.length === 0,
     rec.length + ' call(s)');
}
{
  const r = rig(undefined, ME);
  const out = await r.call(SENTINEL);
  ok('the sentinel is still never claimed', out === false && r.rec.length === 0, r.rec.length + ' call(s)');
}
ok('\u{1F3AF} the refusal is NOT written as `!iOwnIt`',
   !/if\s*\(\s*!\s*iOwnIt\s*\)/.test(claimSrc), 'positive-proof test only');

/* ── 5. THE SERVER HALF · read, not run ──────────────────────────────────── */
/* sql/068 cannot be executed here. What CAN be checked is that it decides the
   unknown-owner case the same way the client just did, because a disagreement
   is what produces "the toast without the re-key" or "the re-key without the
   toast". */
console.log('\n  ── sql/068 · the server half (NOT applied — read only, no database here)');
const ownerBlock = (SQL.match(/if exists \(\s*select 1 from public\.tw_node_owners[\s\S]*?end if;/) || [''])[0];
ok('\u{1F3AF} sql/068 exists and consults tw_node_owners', ownerBlock.length > 0);
ok('\u{1F3AF} it answers not_your_node, and as action new_city',
   /'action',\s*'new_city',\s*'reason',\s*'not_your_node'/.test(ownerBlock));
ok('\u{1F3AF} that branch never answers adopted', !/adopted/.test(ownerBlock));
ok('\u{1F3AF} POSITIVE PROOF — it requires a non-null user_id that is not mine',
   /o\.user_id is not null/.test(ownerBlock) && /o\.user_id <> v_uid/.test(ownerBlock));
ok('\u{1F3AF} …so a node with NO ownership row still adopts (AGREES with the client)',
   ownerBlock.startsWith('if exists (') && !/not exists/.test(ownerBlock));
/* Measured inside the FUNCTION BODY, not the file: the header prose mentions
   not_your_node too, and an offset taken from the top of the file would be
   satisfied by a check that never made it into the body at all. */
const fnAt = SQL.indexOf('create or replace function public.city_claim_node');
const BODY = fnAt < 0 ? '' : SQL.slice(fnAt);
const iOwner = BODY.indexOf('not_your_node');
const iUpdate = BODY.indexOf('set node_id = p_node');
ok('\u{1F3AF} the check runs BEFORE the update that re-keys the row, in the BODY',
   iOwner > 0 && iUpdate > 0 && iOwner < iUpdate, 'body offsets ' + iOwner + ' < ' + iUpdate);
ok('\u{1F3AF} the history insert is not double-fired',
   (SQL.match(/insert into public\.city_state_history/g) || []).length === 1);
ok('it ships its own grants', /grant execute on function public\.city_claim_node\(text\) to authenticated/.test(SQL)
   && /revoke all on function public\.city_claim_node\(text\)/.test(SQL));
ok('it is idempotent / re-runnable', /create or replace function public\.city_claim_node/.test(SQL));
ok('it ends with a verify query', /VERIFY/.test(SQL) && /pg_proc/.test(SQL));
ok('\u{1F3AF} its header says NOBODY HERE CAN APPLY IT', /NOT APPLIED/.test(SQL));

console.log(fails ? ('\n' + fails + ' CHECK(S) FAILED') : '\nALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
