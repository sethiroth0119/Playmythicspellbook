/* ══════════════════════════════════════════════════════════════════════════
   🚛 DRIVE-DEPOT-GATE — the CLIENT half of sql/075's destination rule.

   The rule itself is enforced by a BEFORE INSERT trigger on
   transport_contracts and nothing here can weaken it. What this driver covers
   is everything the player actually reads, all of which lives in this repo:

     1. the refusal SENTENCE — failCoded() must turn the bare trigger code
        `no_depot_at_destination` into a sentence that NAMES THE NODE, taken out
        of the raise's DETAIL payload. Without the CODES entry the player reads
        the raw code; without parseDetail they read "undefined has no depot".
     2. the PANEL — renderExchange() must warn about a destination the server
        will refuse, and must say NOTHING in the three states where the rule is
        not in force or could not be read. A client that warns about a rule the
        server is not applying is worse than one that stays quiet.
     3. 🔴 THE CONTROL: the same view with the gate switched off, and with the
        gate unreadable, must produce no depot text at all — so (2) is evidence
        about the gate rather than a panel that always prints the same line.

   These are pure functions over a plain object; no browser is needed, which is
   the whole reason depot.render.js is a string builder.

   Run:  node .gauntlet/drive-depot-gate.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { failCoded } from '../public/src/transport/contracts.js';
import { renderExchange } from '../public/src/transport/depot.render.js';
import api from '../public/src/transport/index.js';

const bad = [];
const ok = (name, cond, detail) => { if (!cond) bad.push(name + (detail ? ' — ' + detail : '')); };

/* ── 1 · the sentence ────────────────────────────────────────────────────── */
// Exactly the shape supabase-js hands over for a `raise exception … using
// detail = jsonb, hint = text`: message is the bare code, details is a STRING.
const refusal = failCoded({ message: 'no_depot_at_destination',
                            details: '{"to_node":"N-25"}',
                            hint: 'build one' });
ok('code is carried through', refusal.code === 'no_depot_at_destination', JSON.stringify(refusal.code));
ok('the sentence names the node', /N-25/.test(refusal.why || ''), refusal.why);
ok('the sentence explains the mechanism', /Transport Depot/i.test(refusal.why + ' ' + refusal.fix));
ok('the fix is actionable', /build|route picker/i.test(refusal.fix || ''), refusal.fix);

// A raise that carried NO detail must still read as English. This is the arm
// parseDetail() answers {} for, and the one that would print "undefined".
const noDetail = failCoded({ message: 'no_depot_at_destination' });
ok('degrades without a detail payload', /^That destination/.test(noDetail.why || ''), noDetail.why);
ok('never prints undefined', !/undefined/.test(noDetail.why + ' ' + noDetail.fix), noDetail.why);

// An UNRELATED message must not be dressed up as a known code.
const other = failCoded({ message: 'duplicate key value violates unique constraint "x"' });
ok('unknown messages are left verbatim', other.why === undefined && /duplicate key/.test(other.error));

/* ── 1b · the same table, lent to index.html's Haulage Board ─────────────── */
// index.html cannot import from /src (the module boundary), so it reads the
// sentence through MythicTransport.explainError. If that name ever goes away
// the board silently goes back to toasting the raw code, which is precisely
// the regression this line catches.
ok('the api publishes explainError', typeof api.explainError === 'function');
ok('the api publishes depotGate', typeof api.depotGate === 'function');
const lent = api.explainError({ message: 'no_depot_at_destination', details: '{"to_node":"N-09"}' });
ok('lent sentence names the node', !!lent && /N-09/.test(lent.text || ''), JSON.stringify(lent));
ok('lent sentence carries the code', !!lent && lent.code === 'no_depot_at_destination');
ok('lent lookup answers null on an unknown message',
   api.explainError({ message: 'permission denied for table transport_rigs' }) === null);

/* ── 2 · the panel ───────────────────────────────────────────────────────── */
const view = (gate, to) => ({
  form: { from: 'N-02', to: to || '', resId: 'scrap', units: 10, carrierId: '' },
  gate, carriers: [], contracts: [], quote: null, cinder: 1000,
});
const html = (gate, to) => renderExchange(view(gate, to));

const GATE_ON = { required: true, unknown: false, nodes: ['N-02', 'N-07', 'N-25'] };

const onBad  = html(GATE_ON, 'N-31');           // a destination with no depot
const onGood = html(GATE_ON, 'N-25');           // a destination with one
const onNone = html({ required: true, unknown: false, nodes: [] }, 'N-31');

ok('warns about a destination the server will refuse', /N-31 has no finished Transport Depot/.test(onBad));
ok('lists the nodes that do work', /Accepting freight now \(3\)/.test(onBad) && /N-25/.test(onBad));
ok('does NOT warn about a destination that works', !/has no finished Transport Depot/.test(onGood));
ok('still lists the working nodes on a good destination', /Accepting freight now \(3\)/.test(onGood));
ok('says so when nowhere in the world has a depot', /No city has built a Transport Depot yet/.test(onNone));
ok('the empty-world line does not also print an empty list', !/Accepting freight now/.test(onNone));

/* ── 3 · THE CONTROL — three states that must say nothing ────────────────── */
const offHtml     = html({ required: false, unknown: false, nodes: ['N-02'] }, 'N-31');
const unknownHtml = html({ required: false, unknown: true, nodes: null }, 'N-31');
const nullHtml    = html(null, 'N-31');
const silent = (s) => !/Transport Depot|Accepting freight/.test(s);

ok('CONTROL: rule switched off → silent', silent(offHtml));
ok('CONTROL: rule unreadable (075 not applied) → silent', silent(unknownHtml));
ok('CONTROL: not asked yet → silent', silent(nullHtml));
// …and the control is only meaningful if the panel itself still drew.
ok('CONTROL: the exchange still rendered', /Quote a haul/.test(offHtml) && /Quote a haul/.test(nullHtml));

console.log(bad.length
  ? '❌ FAIL\n  · ' + bad.join('\n  · ')
  : '✅ PASS — the refusal names the node, the panel warns only when the rule is in force, and all three silent states are silent.');
process.exit(bad.length ? 1 : 0);
