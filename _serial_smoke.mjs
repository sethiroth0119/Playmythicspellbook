/* #️⃣ SERIALIZED CARDS — the press run.  Run: node _serial_smoke.mjs
   ═══════════════════════════════════════════════════════════════════════════
   Owner: "Make a button where we can make cards Serialized … make it where I
   can make it 1 out of 10000 copies in the forge where it will only be 10k of
   that card ever put into the game. I click it in the forge the admins get 3
   and the rest go to the market until they are gone." Plus: "Give each card
   serial numbers and allow for players to look up cards with the serial number
   in the player market."

   🔴 WHAT THIS SUITE IS ACTUALLY DEFENDING. The feature's entire value is one
      sentence — "only 10,000 of this card will ever exist" — and that sentence
      is false the moment any second route can add a copy. There are three ways
      to break it and this file tests all three:

        1. The press issues two numbers for one slot. Prevented in Postgres, not
           here: sql/137 claims under `for update` and takes out of escrow with a
           conditional UPDATE. §4 asserts those two constructs are still in the
           file, because a refactor that drops the lock leaves every test in this
           suite passing and the guarantee gone.
        2. A card that is pressed keeps dropping from packs, loot or crafting.
           §2 runs the real predicate and requires the refusal.
        3. The bypass the press itself needs (`serialOk`) becomes a general
           bypass. §3 requires admin-only and unreleased to still beat it.

   ⚠ §5 IS A NEGATIVE CONTROL. It deletes the serialized clause out of the
     shipped predicate and requires §2's refusal to stop happening. A check that
     cannot be made to fail is not evidence that the rule is there — this file
     exists partly because a sibling suite spent a release asserting the WORDING
     of a rule rather than the rule, and passed happily through a refactor that
     could have removed it. */
import { readFileSync } from 'fs';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
const SQL = readFileSync('./sql/137_serialized_cards.sql', 'utf8').replace(/\r\n/g, '\n');

function fnText(name, src) {
  const s = src || SRC;
  const i = s.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name);
  let d = 0, started = false;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return s.slice(i, j + 1); }
  }
  throw new Error('unbalanced ' + name);
}

/* Strip JS comments so a check can match CODE and not prose ABOUT the code.
   String-aware: a `//` inside a quoted URL is not a comment. Template literals
   are treated as opaque strings, which is right for this file's purposes — a
   `${…}` hole in one never contains the calls these checks look for. */
function stripComments(src) {
  let out = '', i = 0, q = null;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (q) {
      out += c;
      if (c === '\\') { out += d || ''; i += 2; continue; }
      if (c === q) q = null;
      i++; continue;
    }
    if (c === "'" || c === '"' || c === '`') { q = c; out += c; i++; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i + 2); i = e < 0 ? src.length : e; continue; }
    out += c; i++;
  }
  return out;
}

/* Lift the real predicate and drive it. isPressRunCard is stubbed off a set so
   the test controls which cards are pressed; everything else mirrors
   _cardgate_smoke's harness so the two agree about what the defaults are.
   ⚠ THE STUB IS isPressRunCard AND NOT THE BROADER "has serials" PREDICATE, and
     that is the shape of the bug §7 exists to catch: while only the press
     existed, "serialized" and "limited" were the same sentence and one predicate
     served both. Catalogue runs make every card serialized, so a gate asking the
     broad question would refuse every grant in the game. */
function buildPredicate(src) {
  const rules = Object.create(null);
  const pressed = new Set();
  const env = {
    isForgeAdminOnly: (kind, id) => !!(rules[id] && rules[id].adminOnly),
    isCardReleased:   (id) => !(rules[id] && rules[id].unreleased),
    getForgeObt:      (kind, id) => Object.assign({ craftable: true, lootable: true, adminOnly: false }, rules[id] || {}),
    isPressRunCard: (id) => pressed.has(id),
  };
  const fn = new Function(...Object.keys(env),
    fnText('cardGrantRefusalReason', src) + '\nreturn cardGrantRefusalReason;')(...Object.values(env));
  return { fn, rules, pressed };
}

console.log('\n=== 1. the ladder is a ladder, anchored where the owner put it ===');
{
  const m = /const SERIAL_RUN_SIZE = \{([\s\S]*?)\};/.exec(SRC);
  ok(!!m, 'SERIAL_RUN_SIZE exists');
  const sizes = {};
  if (m) for (const line of m[1].split('\n')) {
    const p = /(\w+):\s*(\d+)/.exec(line);
    if (p) sizes[p[1]] = Number(p[2]);
  }
  ok(sizes.common === 10000, 'Common is the 10,000 the owner asked for', String(sizes.common));
  /* The rarity ids are not this file's to invent — they come from RARITIES in
     index.html, and a run size for a rarity that does not exist is dead config
     while a rarity with no run size silently falls back to Common's 10,000. */
  const rar = /const RARITIES = \[([\s\S]*?)\];/.exec(SRC);
  const ids = rar ? [...rar[1].matchAll(/id:\s*'(\w+)'/g)].map(x => x[1]) : [];
  ok(ids.length > 0, 'RARITIES is readable', String(ids.length));
  ok(ids.every(id => sizes[id] > 0), 'every rarity in RARITIES has a run size — none falls through to the Common default',
    ids.filter(id => !(sizes[id] > 0)).join(','));
  ok(Object.keys(sizes).every(k => ids.indexOf(k) >= 0), 'and no run size names a rarity that does not exist',
    Object.keys(sizes).filter(k => ids.indexOf(k) < 0).join(','));
  let mono = true;
  for (let i = 1; i < ids.length; i++) if (sizes[ids[i]] > sizes[ids[i - 1]]) mono = false;
  ok(mono, 'the ladder never gets LESS scarce as rarity rises', ids.map(i => i + '=' + sizes[i]).join(' '));
  ok(/const SERIAL_ADMIN_RESERVE = 3;/.test(SRC), 'the admin reserve is 3 — "the admins get 3"');
}

console.log('\n=== 2. a pressed card leaves every other supply ===');
{
  const { fn, rules, pressed } = buildPredicate();
  rules.plain = {};
  ok(fn('plain') === null, 'an ordinary card is still obtainable (the gate did not become a wall)');

  pressed.add('ser');
  rules.ser = { craftable: false, lootable: false };   // what serialMintRun writes
  const why = fn('ser');
  ok(typeof why === 'string' && /serial/i.test(why), 'a serialized card is refused, and the reason says so', String(why));
  ok(fn('ser', {}) !== null, '…with an options object that does not claim a serial');
  ok(fn('ser', { adminGrant: true }) !== null,
    '…and adminGrant does NOT get past it here — grantCard checks that flag before it ever asks, so honouring it inside the predicate would be a second, looser door');
  ok(fn('ser', { serialOk: true }) === null, 'serialOk — a server-issued number — is the way through');

  /* ⚠ THE ORDER OF THE TWO CLAUSES IS LOAD-BEARING and this is the check that
     holds it. Pressing sets craftable+lootable false, so a serialized card is
     ALSO a "no obtainment route" card. If the route clause ran first, a real
     purchase would be refused by the clause meant for abandoned cards. */
  ok(fn('ser', { serialOk: true }) === null && fn('ser') !== null,
    'the serialized clause is tested BEFORE the no-route clause, so a legitimate claim is not refused by the wrong rule');
}

console.log('\n=== 3. serialOk buys past exactly one rule and no others ===');
{
  const { fn, rules, pressed } = buildPredicate();
  pressed.add('locked'); rules.locked = { adminOnly: true, craftable: false, lootable: false };
  ok(fn('locked', { serialOk: true }) === 'admin-only', 'an admin-only card stays admin-only even with a serial in hand', String(fn('locked', { serialOk: true })));
  pressed.add('soon'); rules.soon = { unreleased: true, craftable: false, lootable: false };
  ok(fn('soon', { serialOk: true }) === 'unreleased', 'an unreleased card stays unreleased even with a serial in hand', String(fn('soon', { serialOk: true })));
}

console.log('\n=== 4. the seam: the client asks, the server decides ===');
{
  const g = fnText('grantCard');
  ok(/cardGrantRefusalReason\(id,\s*o\)/.test(g),
    'grantCard forwards its OPTIONS to the predicate — without this serialOk can never arrive and the press cannot grant its own card');

  const mint = fnText('serialMintRun');
  ok(/rpc\('serial_mint_run'/.test(mint), 'the Forge button mints through the RPC, not locally');
  ok(!/Math\.random|Date\.now\(\)\s*%/.test(mint.split("rpc('serial_mint_run'")[0]),
    '…and does not invent a number of its own before asking');
  ok(/setForgeObt\('card', cardId, 'craftable', false\)/.test(mint) && /setForgeObt\('card', cardId, 'lootable', false\)/.test(mint),
    'pressing a card closes its other supply routes in the same breath');

  /* 🔴 THE PAYMENT RULE MOVED SERVER-SIDE (sql/139) AND THESE CHECKS MOVED WITH IT.
     They used to assert "the client charges before it claims, and refunds on
     failure". That order was right for a client-side charge, but a client-side
     charge was the bug: the number is issued by the server, so a console call to
     serial_claim took a limited-edition copy for free.
     ⚠ AND THE OLD CHECK WOULD HAVE PASSED ON A COMMENT. It located the charge with
       indexOf('chargeCinderAtomic') — and the replacement code carries a comment
       saying "this used to call chargeCinderAtomic". A check that finds the name
       of a removed call in prose describing its removal is asserting nothing. So
       these match CALLS — a name followed by an open paren — against the function
       with its comments stripped, and a negative control in §9 puts the client
       charge back to prove they notice. */
  const buyCode = stripComments(fnText('serialBuyCopy'));
  ok(/rpc\('serial_claim'/.test(buyCode), 'the buy path claims through the server');
  ok(!/chargeCinderAtomic\s*\(/.test(buyCode),
    'the client does NOT charge — the claim does, in one server transaction, so no number can be taken without paying');
  ok(!/addGems\s*\(/.test(buyCode),
    '…and so there is no refund branch: a claim that fails charged nothing, and an unreachable refund is a place a later edit starts minting Cinder');
  ok(/_applyServerCharge\s*\(/.test(buyCode),
    'the balance the server debited is adopted through the one shared helper, not a second inline copy');

  /* The scarcity guarantee lives in these three constructs. A client test can
     only assert they are still there. */
  ok(/card_id\s+text not null unique/.test(SQL), 'SQL: one run per card, ever — UNIQUE(card_id) is the "only ever" clause');
  ok(/primary key \(run_id, serial\)/.test(SQL), 'SQL: a number can only be issued once inside a run');
  ok(/from public\.serialized_runs where id = p_run_id for update/.test(SQL),
    'SQL: serial_claim takes a row lock, so two buyers of the last copy are serialised');
  ok(/owner_id is null and escrow_by is not null/.test(SQL),
    'SQL: the escrow take is a conditional UPDATE, so exactly one buyer can win a listed copy');
  ok(/create policy sr_sel[\s\S]{0,400}create policy sc_sel/.test(SQL), 'SQL: both tables ship their RLS in the same file');
  ok(!/for (insert|update|delete)/.test(SQL.split('-- ── who may mint')[0]),
    'SQL: neither table has a direct write policy — every write goes through a SECURITY DEFINER function');

  /* The admin list is duplicated on purpose (a client-side list is a
     suggestion). Duplicated means it can drift, so this is the check that it
     has not. */
  const cl = [...(/const ADMIN_EMAILS = new Set\(\[([\s\S]*?)\]\);/.exec(SRC) || [, ''])[1].matchAll(/'([^']+@[^']+)'/g)].map(x => x[1].toLowerCase()).sort();
  const sq = [...(/function public\.serial_is_admin\(\)[\s\S]*?\$fn\$([\s\S]*?)\$fn\$/.exec(SQL) || [, ''])[1].matchAll(/'([^']+@[^']+)'/g)].map(x => x[1].toLowerCase()).sort();
  ok(cl.length > 0 && cl.join(',') === sq.join(','),
    'the mint allow-list in sql/137 still matches ADMIN_EMAILS in index.html', cl.join(',') + '  vs  ' + sq.join(','));

  /* Every RPC the client calls has to exist in a migration, or the feature is a
     set of buttons that fail at runtime on a project where the SQL WAS applied.
     ⚠ SCOPED TO BOTH FILES, not just 137. This read 137 alone and went red when
       serial_reconcile landed in 138 — the rule ("nothing is called that is not
       defined") was satisfied the whole time; the check was simply looking in
       one of the two places the answer lives. §8 asserts the same union, which
       is the one that has to keep passing as more migrations arrive. */
  const called = [...SRC.matchAll(/rpc\('(serial_\w+)'/g)].map(x => x[1]);
  ok(called.length >= 6, 'the client calls the serial RPCs', called.join(','));
  const defined = SQL + readFileSync('./sql/138_serial_catalogue.sql', 'utf8').replace(/\r\n/g, '\n');
  const missing = [...new Set(called)].filter(n => defined.indexOf('function public.' + n + '(') < 0);
  ok(missing.length === 0, 'every serial_* RPC the client calls is defined in the migrations', missing.join(','));
}

console.log('\n=== 5. the number survives a sale, and only one of it exists ===');
{
  const esc = fnText('_escrowCardCopy');
  ok(/rpc\('serial_escrow'/.test(esc), 'listing a serialized card puts its number into server escrow');
  ok(/_escrowCardCopy\._serial/.test(esc), '…and reports which number left, so the listing can carry it');
  const grant = fnText('_cmGrantPurchase');
  ok(/__serial__/.test(grant), 'the purchase grant reads the serial off the listing');
  ok(grant.indexOf('__serial__') < grant.indexOf("id: 'cc_bought_"),
    'a serialized copy is handled BEFORE the id-minting branch — it keeps its own id, because a minted id detaches a copy from the run its number lives in');
  const buyL = fnText('cardMarketBuy');
  const iTake = buyL.indexOf("rpc('serial_take'"), iPay = buyL.indexOf('Profile.gems = (Profile.gems');
  ok(iTake > 0 && iPay > 0 && iTake < iPay, 'the buyer takes the number out of escrow BEFORE being charged for it');
  ok(/status: 'open', buyer_id: null/.test(buyL), '…and the listing reopens if they lose the race, rather than being stranded as sold');
}

console.log('\n=== 6. NEGATIVE CONTROL — break the rule, require the check to notice ===');
{
  /* Delete the serialized clause out of the shipped predicate. §2's central
     assertion must stop holding. If it still holds, §2 was not testing this
     rule and every PASS above it is decoration. */
  const real = fnText('cardGrantRefusalReason');
  const broken = real.replace(/if \(typeof isPressRunCard === 'function' && isPressRunCard\(id\)\) \{[\s\S]*?\n    \}\n/, '');
  ok(broken !== real, 'the control actually removed the clause (if this fails, the control proved nothing)');
  const { fn, rules, pressed } = buildPredicate(SRC.replace(real, broken));
  pressed.add('ser'); rules.ser = { craftable: false, lootable: false };
  const why = fn('ser');
  ok(why !== null && !/serial/i.test(String(why)),
    'with the clause gone the refusal is no longer the serialized one — the check bites', String(why));
  const { fn: fn2, rules: r2, pressed: p2 } = buildPredicate(SRC.replace(real, broken));
  p2.add('open'); r2.open = {};   // pressed, but its routes left open
  ok(fn2('open') === null,
    'and a pressed card with its routes still open is allowed straight through — which is exactly the leak the clause prevents');
}


console.log('\n=== 7. the catalogue register numbers cards without restricting them ===');
{
  /* 🔴 THE CHECK THIS WHOLE SECTION EXISTS FOR. cardGrantRefusalReason refuses
     any card the gate predicate accepts. Catalogue runs give EVERY card in the
     game a run, so a gate that asked "does this card have serial numbers"
     instead of "is this card a limited press run" would refuse every grant in
     the game — no pack, no drop, no reward, no mission return. That failure is
     total, silent at the call sites (grantCard just returns 0), and would look
     from the outside like the game simply stopped giving cards out. */
  const src = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
  const pred = fnText('cardGrantRefusalReason', src);
  ok(/isPressRunCard\(id\)/.test(pred),
    'the grant gate asks isPressRunCard — the narrow, press-only question');
  ok(!/cardHasSerials\(/.test(pred),
    '…and never the broad "does it have numbers" question, which every card answers yes to once the catalogue exists');

  /* Run it: a card with a catalogue run and its routes OPEN must be grantable,
     because that is every card in the game after sql/138. */
  const rules = Object.create(null);
  const env = {
    isForgeAdminOnly: () => false,
    isCardReleased:   () => true,
    getForgeObt:      (kind, id) => Object.assign({ craftable: true, lootable: true, adminOnly: false }, rules[id] || {}),
    isPressRunCard:   () => false,            // catalogue runs are not press runs
    /* ⚠ THIS STUB IS WHAT MAKES THE RUNTIME CHECK BITE. Without it, a gate
       rewritten to ask the broad question would find cardHasSerials undefined,
       the `typeof … === 'function'` guard would read false, and the card would
       be allowed — the test passing for the wrong reason while the real client,
       where the function DOES exist, refused every card in the game. Stubbing it
       true reproduces production: if the gate asks it, this card gets refused
       and the assertion below fails, which is the whole point. */
    cardHasSerials:   () => true,
  };
  const fn = new Function(...Object.keys(env), pred + '\nreturn cardGrantRefusalReason;')(...Object.values(env));
  rules.catalogued = {};
  ok(fn('catalogued') === null, 'a catalogued card is granted normally — numbering is a register, not a restriction');
  ok(fn('catalogued', { serialOk: true }) === null, '…and still granted when a number did come with it');

  /* The one predicate is gone by name, not merely unused. An ambiguous name that
     still resolves is how the two meanings merge back together. */
  ok(!/\bisSerializedCard\b/.test(src),
    'the ambiguous single predicate is deleted from index.html — a grep for it returns nothing');

  /* The two run sizes must not be the same knob. The owner asked for 500,000 on
     the catalogue "but still want that button for that 10k only". */
  const cat = /const SERIAL_CATALOGUE_RUN = (\d+);/.exec(src);
  ok(!!cat && Number(cat[1]) === 500000, 'the catalogue register is 500,000 deep', cat && cat[1]);
  const common = /common:\s*(\d+),/.exec(/const SERIAL_RUN_SIZE = \{([\s\S]*?)\};/.exec(src)[1]);
  ok(!!common && Number(common[1]) === 10000, 'and the press button is still 10,000 for a Common — a separate number, not a rescaled one', common && common[1]);
  ok(Number(cat[1]) !== Number(common[1]), 'the two are genuinely different knobs');
}

console.log('\n=== 8. the register issues numbers without touching the 39 grant sites ===');
{
  const SQL2 = readFileSync('./sql/138_serial_catalogue.sql', 'utf8').replace(/\r\n/g, '\n');
  ok(/create or replace function public\.serial_issue_for_user\(p_user uuid\)/.test(SQL2),
    'one server function issues numbers for a user — the same path serves the backfill and every future grant');
  ok(/from public\.user_profiles p,[\s\S]{0,200}__cardCollection__/.test(SQL2),
    '…reading the user\'s OWN uploaded collection, so no grant site has to block on the network to be issued a number');
  ok(/revoke all on function public\.serial_issue_for_user\(uuid\) from public, authenticated;/.test(SQL2),
    'the by-user-id function is NOT callable by a client — otherwise any player could issue numbers against anyone\'s collection');
  ok(/serial_reconcile\(\)[\s\S]{0,400}serial_issue_for_user\(auth\.uid\(\)\)/.test(SQL2),
    'the client-callable wrapper passes auth.uid() and nothing else');
  ok(/order by a\.created_at asc/.test(SQL2),
    'the backfill hands out low numbers in ACCOUNT-CREATION order — the owner\'s choice, and the only ordering backed by data we actually hold');
  ok(/exit when v_next > v_total/.test(SQL2),
    'and it stops at the register ceiling rather than issuing a number past the run size');
  ok(/for update/.test(SQL2), 'issuing locks the run, so two sessions cannot be handed the same number');

  const cl = [...SRC.matchAll(/rpc\('(serial_\w+)'/g)].map(x => x[1]);
  const both = SQL + SQL2;
  const missing = [...new Set(cl)].filter(n => both.indexOf('function public.' + n + '(') < 0);
  ok(missing.length === 0, 'every serial_* RPC the client calls is defined in 137 or 138', missing.join(','));
}

console.log('\n=== 9. sql/139 — the press takes its own payment, and the register fits a reply ===');
{
  /* Three defects in 137, found by checking what v121v169 would SHOW after the
     catalogue backfill rather than trusting the backfill's own "backfilled". */
  const S9 = readFileSync('./sql/139_serial_claim_and_mine.sql', 'utf8').replace(/\r\n/g, '\n');
  const claim = (/create function public\.serial_claim\(p_run_id uuid\)[\s\S]*?end \$fn\$;/.exec(S9) || [''])[0];

  ok(claim.length > 0, '139 defines serial_claim with EXACTLY the old argument list — a changed list adds an overload and leaves the free one callable');
  ok(/drop function if exists public\.serial_claim\(uuid\);/.test(S9) && /drop function if exists public\.serial_mine\(\);/.test(S9),
    'both functions are dropped first — their return types change, and create-or-replace fails with 42P13 (the error that stopped 138)');
  ok(/grant execute on function public\.serial_claim\(uuid\) to authenticated;/.test(S9) && /grant execute on function public\.serial_mine\(\)\s+to authenticated;/.test(S9),
    'EXECUTE is re-granted explicitly — a drop takes the grant with it');

  const iCharge = claim.indexOf('public.wallet_charge(');
  const iInsert = claim.indexOf('insert into public.serial_copies');
  ok(iCharge > 0 && iInsert > 0 && iCharge < iInsert,
    'serial_claim charges BEFORE it issues, inside one transaction — a failed issue rolls the charge back');
  ok(/if w is null or not w\.ok then[\s\S]{0,300}return;/.test(claim),
    '…and returns without issuing when the charge is refused');
  ok(/select r\.total, r\.kind, r\.price/.test(claim) && !/p_price/.test(claim),
    'the price is read from the RUN ROW — there is no price argument for a caller to choose');
  ok(/if v_kind is distinct from 'press' then[\s\S]{0,200}'not for sale'/.test(claim),
    'a catalogue register is refused — its numbers are issued against cards already held, not sold');
  ok(/for update/.test(claim), 'the run row is still locked, so two buyers of the last copy are serialised');

  ok(/returns table\(card_id text, card_name text, serials integer\[\]/.test(S9) && /array_agg\(c\.serial order by c\.serial\)/.test(S9),
    'serial_mine returns ONE ROW PER CARD with the numbers as an array — at most 635 rows, where per-copy rows reached 4,407 for one player against a 1,000-row reply cap');

  /* The client side of the same three fixes. */
  const fetchCode = stripComments(fnText('serialFetchRuns'));
  ok(/Array\.isArray\(r\.serials\)/.test(fetchCode) && /return;/.test(fetchCode.split('Array.isArray(r.serials)')[1] || ''),
    'the client REFUSES a reply in the old per-copy shape instead of reading it as "no numbers" — replacing the cache from it would wipe every badge');
  ok(!/row\.serial\s*\|\s*0\)/.test(fetchCode), '…and no longer reads the per-copy field at all');

  const mkt = stripComments(fnText('renderSerialMarket'));
  ok(/Serial\.runs \|\| \[\]\)\.filter\(r => r && r\.kind === 'press'\)/.test(mkt),
    'the press list shows PRESS runs only — the 635 catalogue registers are not for sale');
  ok(/serials/.test(mkt), 'the "your copies" panel reads the per-card shape');

  const ch = stripComments(fnText('chargeCinderAtomic'));
  const helper = stripComments(fnText('_applyServerCharge'));
  ok(/_applyServerCharge\s*\(/.test(ch) && !/_gemsTaxExempt/.test(ch),
    'chargeCinderAtomic adopts a server debit through the shared helper and no longer carries its own copy');
  ok(/_gemsTaxExempt\s*\(/.test(helper),
    'the helper sets the balance EXEMPT from the poll watcher — a plain write is mirrored as a second, local spend');
}

console.log('\n=== 10. NEGATIVE CONTROLS for §9 — put each bug back, require a check to notice ===');
{
  /* Rebuild the relevant fragment with the defect restored and re-run the
     assertion against it. Each must go red, or the §9 check above is decoration. */
  const buyReal = fnText('serialBuyCopy');

  // (a) the client charge comes back
  const buyCharged = buyReal.replace("let res;\n  try { res = await Cloud.client.rpc('serial_claim'",
    "const charge = await chargeCinderAtomic(price, 'x');\n  let res;\n  try { res = await Cloud.client.rpc('serial_claim'");
  ok(buyCharged !== buyReal, 'control (a) actually re-inserted a client charge');
  ok(/chargeCinderAtomic\s*\(/.test(stripComments(buyCharged)),
    'control (a): a restored client-side charge IS seen by the "client does not charge" check');

  // (b) the comment that fooled the old check is still there — and must NOT count as a call
  ok(/chargeCinderAtomic/.test(buyReal) && !/chargeCinderAtomic\s*\(/.test(stripComments(buyReal)),
    'control (b): the name survives in a COMMENT in the shipped function, and the check correctly ignores it — the exact case the old indexOf passed on');

  // (c) the press list lists everything again
  const mktReal = fnText('renderSerialMarket');
  const mktAll = mktReal.replace(".filter(r => r && r.kind === 'press')", '.slice(0)');
  ok(mktAll !== mktReal, 'control (c) actually removed the press filter');
  ok(!/Serial\.runs \|\| \[\]\)\.filter\(r => r && r\.kind === 'press'\)/.test(stripComments(mktAll)),
    'control (c): an unfiltered press list IS seen by the press-only check');

  // (d) the claim loses its kind check
  const S9 = readFileSync('./sql/139_serial_claim_and_mine.sql', 'utf8').replace(/\r\n/g, '\n');
  const noKind = S9.replace(/if v_kind is distinct from 'press' then[\s\S]*?end if;\n/, '');
  ok(noKind !== S9, 'control (d) actually removed the kind check');
  ok(!/if v_kind is distinct from 'press' then[\s\S]{0,200}'not for sale'/.test(noKind),
    'control (d): a claim that sells off a register IS seen by the kind check');

  // (e) the charge moves AFTER the insert
  const late = S9.replace(/  if coalesce\(v_price, 0\) > 0 then[\s\S]*?\n  end if;\n/, '')
                 .replace("  return query select true, 'claimed'", "  select * into w from public.wallet_charge(v_price::bigint, 'x');\n  return query select true, 'claimed'");
  const lc = (/create function public\.serial_claim\(p_run_id uuid\)[\s\S]*?end \$fn\$;/.exec(late) || [''])[0];
  const i1 = lc.indexOf('public.wallet_charge('), i2 = lc.indexOf('insert into public.serial_copies');
  ok(late !== S9 && i1 > i2, 'control (e): a charge moved after the issue IS seen by the ordering check');
}

console.log(fails ? `\n❌ ${fails} FAILED\n` : '\n✅ all serialized-card checks passed\n');
process.exit(fails ? 1 : 0);
