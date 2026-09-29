/* 🎴 COUNTER SURFACES DRAW CARD ART, NEVER EMOJIS.  Run: node _counterart_smoke.mjs
   ═══════════════════════════════════════════════════════════════════════════
   Owner (v121v169), with two screenshots of the counter prompt: "Add card art
   of the people who is using spell counters. Same for counter cards no emojis."

   🔴 THE BUG WAS A LOOKUP ONE DEGREE OFF. _fieldCounterHolders took
      `card.id || card.cardId || …` as the card id. For a unit on the field,
      `card` IS the unit and `id` is its INSTANCE ("u_…"), which no art is filed
      under — so Krystal Anomaly Lynx Ruby, whose art loads fine (HTTP 200),
      showed 🔵. The rest of the battle code resolves originalCardId / cardId
      FIRST; _cardArtIdOf is that rule in one place.

   ⚠ THE ANNOUNCER BOT'S 🦄 WAS NOT THIS BUG. Its art was uploaded at 07:14 UTC,
     fourteen minutes after the card was created (07:00, both 2026-09-16 — read
     from the card id and the base36 ?v= stamp on its art URL). A battle that
     loaded the card in between had no art to show. The fix there is the
     fallback: the card back, not a glyph.

   This is the STATIC half. The rendered half — the real renderCounterPrompt,
   flash and chain overlay, in Chromium, with the two real cards — is
   .gauntlet/counterart-probe.mjs, which needs the preview server and so cannot
   live in the fast gate. It was red on the pre-fix file (the field row resolved
   to "u_probe_lynx_1" and drew an emoji) and green after.

   §5 is a negative control: it puts the instance-id-first order back and
   requires §2 to go red. */
import { readFileSync } from 'fs';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');

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
/* Strip comments so a check matches code, not prose about the code. */
function stripComments(src) {
  let out = '', i = 0, q = null;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (q) { out += c; if (c === '\\') { out += d || ''; i += 2; continue; } if (c === q) q = null; i++; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; out += c; i++; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i + 2); i = e < 0 ? src.length : e; continue; }
    out += c; i++;
  }
  return out;
}

console.log('\n=== 1. the id rule, run for real ===');
{
  const f = new Function(fnText('_cardArtIdOf') + '\nreturn _cardArtIdOf;')();
  const unit = { id: 'u_inst_7', cardId: 'cc_1788390821686', originalCardId: 'cc_1788390821686' };
  ok(f(unit) === 'cc_1788390821686', 'a field unit resolves to its CARD id, not its instance id', f(unit));
  ok(f({ id: 'u_inst_7', cardId: 'cc_x' }) === 'cc_x', '…using cardId when there is no originalCardId');
  ok(f({ id: 'cc_1789542059946', instanceId: 'iid_1' }) === 'cc_1789542059946', 'a hand card, which carries neither, resolves to its id — which IS its card id');
  ok(f({ id: 'u_copy', cardId: 'cc_copy', originalCardId: 'cc_orig' }) === 'cc_orig', 'originalCardId wins — a copy is drawn as the card it copied, matching the battle code');
  ok(f(null) === null, 'no card, no id');
}

console.log('\n=== 2. every counter surface uses it ===');
{
  const holders = stripComments(fnText('_fieldCounterHolders'));
  ok(/cardId:\s*_cardArtIdOf\(card\)/.test(holders), 'field counter holders take their art id through _cardArtIdOf');
  ok(!/cardId:\s*card\.id\s*\|\|/.test(holders), '…and no longer try the instance id first');

  const cc = stripComments(fnText('_ccLinkArt'));
  ok(/_cardArtIdOf\(card\)/.test(cc), 'the chain overlay uses the same rule');
  ok(/_cardArtFromDef\(/.test(cc), '…and falls back to the card definition');

  const flashSets = SRC.match(/App\.ui\.counterFlash = \{[^}]*\}/g) || [];
  ok(flashSets.length >= 3, 'three places set the COUNTERED flash (hand, grave, field)', String(flashSets.length));
  ok(flashSets.every(x => /cardId: _cardArtIdOf\(card\)/.test(x)),
    '…and every one records which card fired, so the flash can draw it', flashSets.filter(x => !/cardId/.test(x)).join(' | '));

  const tok = stripComments(fnText('_battleActivateTokenCounter'));
  const iStash = tok.indexOf('_lastPlayerCounterCard'), iResolve = tok.indexOf('prompt.resolve(true)');
  ok(iStash > 0 && iResolve > 0 && iStash < iResolve,
    'the field-counter path records its card for the chain overlay BEFORE resolving — otherwise the chain showed a nameless "Counter"');

  const grave = stripComments(fnText('_battleActivateGraveReaction'));
  const iG = grave.indexOf('s._lastPlayerCounterCard'), iNs = grave.indexOf('let ns = { ...s }');
  ok(iG > 0 && iNs > 0 && iG < iNs,
    'the grave path records its card on the object the chain holds, before App.state is replaced');
}

console.log('\n=== 3. no emoji where a card is drawn ===');
{
  const prompt = fnText('renderCounterPrompt');
  const rows = prompt.match(/counter-prompt-card-icon">\$\{[^\n]*<\/div>/g) || [];
  ok(rows.length === 4, 'the prompt draws four kinds of row (hand, grave, field, trap)', String(rows.length));
  ok(rows.every(r => /noEmoji:\s*true/.test(r)), 'every row asks the art helper for NO emoji',
    rows.filter(r => !/noEmoji/.test(r)).join(' | '));
  ok(/counter-flash-icon">\$\{cf\.cardId \? _battleCardArtHtml\(cf\.cardId, cf\.icon, '', \{ noEmoji: true \}\)/.test(prompt),
    'the COUNTERED flash draws the card, not its glyph');

  const trapArt = SRC.match(/art: \(typeof _battleCardArtHtml === 'function'\) \? _battleCardArtHtml\([^\n]*/);
  ok(!!trapArt && /noEmoji: true/.test(trapArt[0]), 'the trap row\'s precomputed art asks for no emoji too');

  const chain = fnText('_renderCounterChainOverlay');
  ok(chain.indexOf('<div class="cc-card-icon">${icon}</div>') < 0,
    'the chain overlay no longer draws a glyph face for a link with no art');
  ok(/BATTLE_CARD_BACK/.test(chain), '…it draws the card back instead');

  const helper = stripComments(fnText('_battleCardArtHtml'));
  ok(/const _noEmoji = !!\(opts && opts\.noEmoji\) && !!cardId;/.test(helper),
    'noEmoji is OPT-IN and needs a card id — cost rows with no card behind them keep their glyph');
  ok(/if \(_noEmoji\) \{\s*return '<img[^']*' \+ \(cls/.test(helper) && /BATTLE_CARD_BACK/.test(helper),
    'with noEmoji and no art, the helper returns the card back image');
  ok(/this\.dataset\.fb\)\{this\.onerror=null;return;\}/.test(helper),
    'a broken art URL swaps to the card back ONCE — a failing back cannot loop');
  ok(/_cardArtFromDef\(cardId\)/.test(helper), 'the helper consults the card definition before giving up');
}

console.log('\n=== 4. the definition fallback refuses heavy and dead URLs ===');
{
  const defs = { good: { artUrl: 'https://x/a.webp' }, rel: { img: 'assets/a.png' }, data: { artUrl: 'data:image/png;base64,AAAA' },
    blob: { artUrl: 'blob:http://x/1' }, none: {} };
  const f = new Function('_cardDefById', fnText('_cardArtFromDef') + '\nreturn _cardArtFromDef;')((id) => defs[id] || null);
  ok(f('good') === 'https://x/a.webp', 'a hosted artUrl is used');
  ok(f('rel') === 'assets/a.png', 'a relative asset path is used');
  ok(f('data') === null, 'a data: URL is refused — full-res base64 is what the streaming budget keeps out of eager decodes');
  ok(f('blob') === null, 'a blob: URL is refused — it is device-local and dead after a reload');
  ok(f('none') === null && f('missing') === null, 'no art, no URL');
}

console.log('\n=== 5. online: the opponent\'s counter carries its card ===');
{
  ok(/sendColyseusFx\('counterResp', \{ reqId: d\.reqId, countered: !!ok, cardName, cardId \}\)/.test(SRC),
    'the defender sends the card id with the card name');
  ok(/card: \{ name: d\.cardName \|\| 'Counter', cardId: d\.cardId \|\| null,/.test(SRC),
    'the attacker keeps it — and an older client that sends none still gets a card back, not a glyph');
}

console.log('\n=== 6. NEGATIVE CONTROL — put the instance-id-first order back ===');
{
  const real = fnText('_fieldCounterHolders');
  const broken = real.replace('cardId: _cardArtIdOf(card),', 'cardId: card.id || card.cardId || card.originalCardId || null,');
  ok(broken !== real, 'the control actually restored the old order');
  const b = stripComments(broken);
  ok(!/cardId:\s*_cardArtIdOf\(card\)/.test(b) && /cardId:\s*card\.id\s*\|\|/.test(b),
    'the §2 checks see the old order — they would go red on the pre-fix code');
  /* …and run it: the old order hands back the unit's INSTANCE id. */
  const oldRule = (card) => card.id || card.cardId || card.originalCardId || null;
  const unit = { id: 'u_inst_7', cardId: 'cc_1788390821686' };
  ok(oldRule(unit) === 'u_inst_7', 'run for real, the old order returns the instance id — the id nothing is filed under');
}

console.log(fails ? `\n❌ ${fails} FAILED\n` : '\n✅ counter surfaces draw card art\n');
process.exit(fails ? 1 : 0);
