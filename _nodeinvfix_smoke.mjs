/* 📦⚡🔨 v121v144 — the Node Inventory button actually collects and pays the
   node's own yield; the Vault's Crafting button is gone; an Archon may cost zero
   Kalon Source. Run: node _nodeinvfix_smoke.mjs

   Owner: "This button is not working fix this here, Make sure it gives players
   their node resource yield." · "Remove this crafting button from the Vault
   base." · "Archon Summon should not consume Kalon Source Points. Have it where
   I can make it zero."

   ⚠ WHY THE COLLECT BUTTON DID NOTHING — the trap this file already documents
     for the "Make capital" button. _nodeInvCollect resolved the node from
     FoundationReserve.nodes (PRN rows keyed by economy_nodes.id, a UUID) while
     the modal that renders the button shows TERRITORY-WAR nodes keyed 'N-01'
     (tw_node_owners.node_id, TEXT). The find() missed on EVERY click. Its only
     fallback read App._twSelNode — a name that appeared there and NOWHERE ELSE
     in the file, never assigned, always null. And past that it called
     node_inventory_claim(uuid) against economy_nodes, a table this node is not
     in, so the claim could not have succeeded either. Two dead lookups and a
     wrong-table RPC: "the button does nothing", exactly as reported. */
import { readFileSync, existsSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');

/* ── the claim clock lives in the TW id space ─────────────────────────────── */
ok(existsSync('./sql/135_tw_node_inventory.sql'), 'the TW claim clock has a migration');
{
  const q = readFileSync('./sql/135_tw_node_inventory.sql', 'utf8');
  ok(/create table if not exists public\.tw_node_inventory/.test(q), 'a table keyed by the TEXT node id');
  ok(/node_id    text        not null/.test(q), '…TEXT, because tw_node_owners.node_id is text and economy_nodes.id is a uuid');
  ok(/select user_id into v_owner from tw_node_owners where node_id = p_node_id;/.test(q),
    'ownership is checked against tw_node_owners — the same table the map and the modal read');
  ok(/if v_owner <> v_me then return jsonb_build_object\('ok', false, 'why', 'not-owner'\); end if;/.test(q),
    '…so the button can never pay someone who does not hold the node');
  ok(/v_since := v_now - interval '24 hours';/.test(q),
    'a shelf never emptied starts A DAY FULL — the owner chose to keep the head start this screen has been promising');
  ok(/on conflict \(node_id, user_id\) do update set inv_at = v_now/.test(q),
    'the stamp is upserted, so two devices cannot bank the same hours twice');
  ok(/for select using \(user_id = auth\.uid\(\)\)/.test(q), 'the owner may READ their own clock, and only their own');
  ok(/security definer/.test(q) && /grant execute on function public\.tw_node_inventory_claim\(text, numeric\) to authenticated/.test(q),
    'the RPC is the only writer');
  ok(/NOT a re-point of 132/.test(q),
    'the migration records WHY it is a second clock rather than a fix to 132 — the id spaces cannot be joined');
}

/* ── the client reads that clock ──────────────────────────────────────────── */
ok(/function _twInvHoursOf\(nodeId\) \{/.test(SRC) && /async function _twInvFetch\(nodeId\) \{/.test(SRC),
  'the panel reads the real clock instead of meta.invAt');
ok(/const hours = _twInvHoursOf\(id\);/.test(SRC),
  '…which is why the panel no longer reads "24.0 h" on every node forever');
ok(/A TW node has no meta, so _nodeInvHoursOf above always fell through to its/.test(SRC),
  'the reason the old number never moved is written down');
ok(/function _nodeInvHoursOf\(n\) \{/.test(SRC),
  'the PRN version is UNTOUCHED — those nodes do have meta.invAt and collect correctly today');

/* ── it pays the node's own yield ─────────────────────────────────────────── */
ok(/function _twNodeYieldRates\(selNode\) \{/.test(SRC) && /const ry = selNode && selNode\.resourceYield;/.test(SRC),
  "IT PAYS THE NODE'S OWN resourceYield — the same field the RESOURCE YIELD panel beside it renders");
ok(/if \(!out\.length\) out\.push\(\{ res: String\(\(selNode && selNode\.resource\) \|\| 'supplies'\), perH: NODE_INV_BASE_PER_H \}\);/.test(SRC),
  '…and a node with NO authored yield falls back to the old flat rate, so nothing that paid out before stops paying');
ok(/function _twInvAmounts\(selNode, hours, mult\) \{/.test(SRC) && /qty: Math\.floor\(h \* r\.perH \* mult\)/.test(SRC),
  'the tier / node-power / city-level multiplier the panel advertises is still applied');
{
  const f = SRC.slice(SRC.indexOf('window.__mg._nodeInvCollect'), SRC.indexOf('/* ═══ end node inventory ═══ */'));
  ok(/const rows = _twInvAmounts\(n, \+d\.hours \|\| 0, mult\);/.test(f), 'the collect pays from the same helper the panel displays from');
  ok(/addRes\(row\.res, row\.qty\)/.test(f), 'EVERY resource the node yields is credited, not just one');
  ok(/rpc\('tw_node_inventory_claim', \{ p_node_id: String\(nodeId\), p_cap_hours: NODE_INV_CAP_H \}\)/.test(f),
    'it calls the TEXT-keyed RPC, not the uuid one against economy_nodes');
  ok(!/rpc\('node_inventory_claim'/.test(f), '…and the old uuid call is gone from this path');
  ok(/App\._twNodeSel && App\._twNodeSel\.id === nodeId/.test(f),
    "the node comes from the modal's own selection rather than a table it is not in");
  ok(/d\.why === 'signed-out'/.test(f), 'a signed-out player is told to sign in rather than "try again"');
}
ok(/try \{ App\._twNodeSel = selNode \|\| null; \} catch \(e\) \{\}/.test(SRC),
  'THE SELECTION IS ACTUALLY ASSIGNED — the old code read App._twSelNode, which nothing in the file ever set');
ok((SRC.match(/App\._twSelNode/g) || []).length === 2,
  '…and the only remaining mentions of the dead name are the two comments explaining it', String((SRC.match(/App\._twSelNode/g) || []).length));

/* ── the Vault's Crafting button ──────────────────────────────────────────── */
ok(!/id="vault-crafting"/.test(SRC), 'the Vault Crafting button is gone');
ok(!/getElementById\('vault-crafting'\)/.test(SRC), '…and so is its click handler, not just the markup');
ok(/CRAFTING REMOVED \(v121v144\)/.test(SRC), '…with a note where it stood, like the ⟳ ROTATE removal beside it');
ok(/App\.screen = App\.craftingReturnScreen \|\| 'title';/.test(SRC),
  "the Crafting screen's Back no longer defaults to 'baseVault' — the Vault button was the ONLY caller that ever set that field, so every other entrance was dumping players into a room they never came from");
ok(/The field itself is KEPT/.test(SRC), '…and the field survives, so a future entrance can still say where the player came from');

/* ── zero-cost Archons ────────────────────────────────────────────────────── */
ok(/0 IS A REAL VALUE/.test(SRC), 'the save can store a Kalon Source cost of 0');
ok(/return Math\.max\(0, Math\.min\(20, isFinite\(_k\) \? _k : 1\)\);/.test(SRC),
  '…because it tests isFinite rather than truthiness — 0 is falsy, which is exactly why "|| 1" ate it');
ok(/Number\.isFinite\(\+_arc\.kalonCost\)/.test(SRC),
  'the editor renders a stored 0 as 0, instead of looking like the box rejected the keystroke');
ok(/const kalon = Number\.isFinite\(\+sp\.kalonCost\) \? Math\.max\(0, \+sp\.kalonCost \| 0\) : 1;/.test(SRC),
  'the rules text prints 0 rather than claiming a free Archon costs 1');
ok(!/\(sp\.kalonCost \| 0\) \|\| 1/.test(SRC) && !/\(_arc\.kalonCost \| 0\) \|\| 1/.test(SRC),
  'NO "|| 1" fallback survives anywhere — there were FOUR, including the Realm Deck list badge');
ok(/const kc = Math\.max\(0, opts\.kalonCost \| 0\);/.test(SRC),
  'the engine already spent Math.max(0, …) — it always understood zero; only the round-trip undid it');

/* ── run the rules for real ───────────────────────────────────────────────── */
{
  const NODE_INV_CAP_H = 48, BASE = 10;
  const rates = (n) => {
    const out = [];
    const ry = n && n.resourceYield;
    if (ry && typeof ry === 'object') for (const k in ry) { const v = +ry[k]; if (k && isFinite(v) && v > 0) out.push({ res: k, perH: v }); }
    if (!out.length) out.push({ res: String((n && n.resource) || 'supplies'), perH: BASE });
    return out;
  };
  const amounts = (n, hours, mult) => {
    const h = Math.max(0, Math.min(NODE_INV_CAP_H, +hours || 0));
    return rates(n).map(r => ({ res: r.res, qty: Math.floor(h * r.perH * mult) })).filter(r => r.qty > 0);
  };
  ok(JSON.stringify(amounts({ resourceYield: { fuel: 7 } }, 24, 1)) === '[{"res":"fuel","qty":168}]',
    "run for real: FUEL +7/hr over 24h pays 168 fuel — the node's own advertised rate");
  ok(amounts({ resourceYield: { fuel: 7, food: 3 } }, 10, 1).length === 2,
    'run for real: a node yielding two resources pays both');
  ok(JSON.stringify(amounts({ resource: 'supplies' }, 24, 1)) === '[{"res":"supplies","qty":240}]',
    'run for real: a node with no authored yield still pays the old 10/h — 240 in 24h, exactly what the screenshot promised');
  ok(amounts({ resourceYield: { fuel: 7 } }, 24, 1.5)[0].qty === 252,
    'run for real: the ×1.5 curve still applies on top');
  ok(amounts({ resourceYield: { fuel: 7 } }, 999, 1)[0].qty === 7 * 48,
    'run for real: hours are capped at the 48h shelf, so an idle node cannot bank forever');
  ok(amounts({ resourceYield: { fuel: 0, food: -3 } }, 24, 1).length === 1,
    'run for real: a zero or negative authored rate is ignored rather than paying nothing or debiting');
  ok(amounts({ resourceYield: { fuel: 7 } }, 0, 1).length === 0,
    'run for real: nothing accrued pays nothing, and the button disables');
  /* the kalon round-trip */
  const save = (typed) => { const k = parseInt(typed, 10); return Math.max(0, Math.min(20, isFinite(k) ? k : 1)); };
  ok(save('0') === 0, 'run for real: a typed 0 SURVIVES the save — the whole bug');
  ok(save('3') === 3 && save('') === 1 && save('abc') === 1, 'run for real: a real number is kept, and only a missing value defaults to 1');
  ok(save('-5') === 0 && save('99') === 20, 'run for real: …still clamped to 0..20');
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 144, 'BUILD_VERSION is v121v144 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(readFileSync('./public/node-city/index.html', 'utf8')), 'NC_BUILD carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
