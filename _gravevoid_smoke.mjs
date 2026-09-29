/* ============================================================================
 * _gravevoid_smoke.mjs — 🪦🌌 GRAVE ABILITIES + THE VANISH ZONE.
 *                                               node _gravevoid_smoke.mjs
 * ----------------------------------------------------------------------------
 * Two reported bugs, one sentence: "adding cards from the graveyard to your
 * hand makes the card disappear[;] cards are not appearing in the vanish zone
 * when they are vanished."
 *
 * 🔴 BOTH FAILED SILENTLY, AND THAT IS THE POINT OF THIS FILE. A grave ability
 * banished its own card as the cost and then went looking for it in the pile it
 * had just emptied — no throw, no toast, one log line saying the ability fired.
 * And every route into the Void filed correctly while nothing in the entire
 * battle screen ever read `side.void`, so a whole zone of the game was
 * write-only. Neither would ever appear in a stack trace.
 *
 * 🟢 The AST walker carries a negative control, for the reason written up in
 * .gauntlet/README.md: an instrument gets checked when it disagrees with you
 * and trusted when it agrees, which is backwards.
 * ==========================================================================*/
import fs from 'fs';
import * as acorn from 'acorn';

const SRC = fs.readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');

let fails = 0;
/* 🔴 SUBSTRING, NOT REGEX, for assertions that pin an EXACT source line.
   Those lines are full of ( { $ | and . — every one a regex
   metacharacter, each needing a different number of backslashes depending on
   whether it passes through a shell, a node -e string, or a regex literal.
   Seven of these arrived RED for escaping reasons alone, and a check that is
   red for a transport reason teaches you to stop reading red. */
const has = (t) => SRC.indexOf(t) >= 0;
const ok = (n, c, extra = '') => { console.log((c ? '  PASS ' : '  FAIL ') + n + (c ? '' : '   <-- ' + extra)); if (!c) fails++; };

/* ── the walker, and proof it can say no ─────────────────────────────────── */
function topLevelNames(code) {
  const out = new Set();
  let prog;
  try { prog = acorn.parse(code, { ecmaVersion: 'latest', allowReturnOutsideFunction: true }); }
  catch (e) { return null; }
  for (const node of prog.body) {
    if (node.type === 'FunctionDeclaration' && node.id) out.add(node.id.name);
    else if (node.type === 'VariableDeclaration') {
      for (const d of node.declarations) if (d.id && d.id.type === 'Identifier') out.add(d.id.name);
    }
  }
  return out;
}
{
  const probe = topLevelNames('const OUTER = 1;\nfunction f(){ const INNER = 2; }\n');
  ok('control: the walker parses', !!probe);
  if (probe) {
    ok('control: it sees a top-level const', probe.has('OUTER'));
    ok('control: it refuses a nested const', !probe.has('INNER'),
       'the walker says yes to everything — the scope assertions below mean nothing');
  }
}
const re = /<script\b((?![^>]*\bsrc=)[^>]*)>([\s\S]*?)<\/script>/gi;
let host = null, m;
while ((m = re.exec(SRC)) !== null) { if (m[2].indexOf('_GRAVE_SELF_EFFECTS') >= 0) { host = m[2]; break; } }
ok('the grave vocabulary is in an inline script', !!host);
const names = host ? topLevelNames(host) : null;
ok('that script parses', !!names);
if (names) {
  ok('_GRAVE_SELF_EFFECTS is top-level', names.has('_GRAVE_SELF_EFFECTS'),
     'a function-local const here is reachable from nowhere and the waiver silently never fires');
  ok('_GRAVE_READS_PILE is top-level', names.has('_GRAVE_READS_PILE'));
}

/* ══ BUG A — the ability that ate its own target ═══════════════════════════ */
ok("'selfToHand' is named as self-referential",
   /const _GRAVE_SELF_EFFECTS = \['selfToHand'\];/.test(SRC));
ok('the pile-reading effects are enumerated',
   /_GRAVE_READS_PILE\s+= \['selfToHand', 'graveToHand', 'reviveGrave', 'graveSteal'\]/.test(SRC));

const act = /function _activateGraveCard\(owner, ref\) \{[\s\S]*?\n\}/.exec(SRC);
ok('_activateGraveCard found', !!act);
if (act) {
  ok('🔴 banish is still the DEFAULT cost', /let banish = ga\.cost !== 'none';/.test(act[0]),
     'this is the pre-existing rule and must not change — every authored card relies on it');
  ok('…but a self-referential ability waives it',
     /if \(banish && _GRAVE_SELF_EFFECTS\.indexOf\(ga\.effect\.type\) >= 0\) \{\n\s*banish = false; _banishWaived = true;/.test(act[0]),
     '"banish this card to return this card to your hand" is a contradiction, not an expensive card');
  ok('…and the log says which happened', /_banishWaived \? ' — it returns itself/.test(act[0]),
     'a waived cost that is not announced is a rules change the player cannot see');
  ok('🔴 the pre-flight is re-asked against the POST-cost state',
     /const _post = _effectCanResolve\(ns, owner, ga\.effect, card\);/.test(act[0]),
     'the original check ran BEFORE the banish, so graveToHand saw the card it was about to destroy and said yes');
  ok('…and a refusal spends nothing',
     /nothing was spent/.test(act[0]) && /_post\.ok\) \{[\s\S]{0,400}?return;/.test(act[0]));
  ok('…and it is scoped to the pile-reading effects only',
     /if \(banish && _GRAVE_READS_PILE\.indexOf\(ga\.effect\.type\) >= 0\)/.test(act[0]),
     're-checking an effect the banish cannot affect can only produce false refusals');
  const iSelf = act[0].indexOf('_GRAVE_SELF_EFFECTS.indexOf');
  const iPost = act[0].indexOf('const _post =');
  const iApply = act[0].indexOf('ns = applyOnPlayEffect(');
  ok('order: waive → pay → re-check → resolve',
     iSelf > 0 && iPost > iSelf && iApply > iPost,
     'the re-check must sit between the cost and the effect or it is checking the wrong state again');
}

const sth = /if \(eff\.type === 'selfToHand'\) \{[\s\S]*?\n  \}/.exec(SRC);
ok('the selfToHand effect found', !!sth);
if (sth) {
  ok('a miss is no longer SILENT', /could not return to hand/.test(sth[0]),
     'silence is what made a fizzled effect read as "the card disappeared"');
  ok('…and it distinguishes the Void from simply gone', /in the Void, not the graveyard/.test(sth[0]),
     'naming the pile is the difference between an explanation and a shrug');
}

/* ══ BUG B — THE ZONE I THOUGHT NOTHING READ ═══════════════════════════════
   🔴 I WAS WRONG, AND THE CORRECTION IS THE USEFUL PART.
   The first version of this file asserted that nothing in the battle screen
   read `side.void`, and built a Vanish Zone into the bsx rail on that basis.
   src/battle/hud.js already owned the zone — a 2×2 pile grid
   (DECK · GRAVE · REALM · VANISH) on both sides, with its own viewer and its
   own `__hudxVoid` / `__hudxVoidCards` bridge. The owner saw four slots on
   screen where there should be two.
   The mistake was the SCOPE of the search, not the search itself: grepping
   public/index.html for 'vanish zone' / 'void-zone' / 'voidZone' answers about
   that FILE. The zone lives in a module, under the name `vanishCell`.
   So this section now pins the two things that matter: the owner of the zone is
   hud.js, and index.html does NOT grow a second one. */
{
  let HUD = '';
  try { HUD = fs.readFileSync(new URL('./public/src/battle/hud.js', import.meta.url), 'utf8'); } catch (e) {}
  ok('hud.js is readable', HUD.length > 0, 'without it the two assertions below prove nothing');
  ok('hud.js owns the Vanish pile', /function vanishCell\(side\) \{/.test(HUD));
  ok('…and installs its own bridge, needing nothing from index.html',
     /window\.__hudxVoidCards=function/.test(HUD),
     'if this ever moves to MythicBridge, index.html becomes a participant and this section has to change with it');
}
/* 🔴 AND index.html MUST NOT GROW A SECOND ONE. These are the exact symbols the
   duplicate was built from; every one of them going to zero is what 'removed,
   not merely hidden' means. A hidden duplicate still renders on the next person
   who flips a display rule. */
/* ⚠ THE LAST TWO ARE THE RENDERED FORM, NOT THE WORDS. Checking for the string
   'VANISH ZONE' found 2 - both in the signpost comment explaining that the zone
   is NOT here. That is the third time today a check has been satisfied by prose
   describing the thing instead of the thing. Assert what would RENDER. */
for (const dead of ['_voidViewCards', 'data-bp-void', 'I_VOID', "_pileView === 'aivoid'",
                    "_slabel(I_VOID, 'VANISH ZONE')", "_slabel(I_VOID, 'FOE VOID')"]) {
  ok('no duplicate Vanish UI in index.html: ' + dead, SRC.indexOf(dead) < 0,
     'found ' + (SRC.split(dead).length - 1) + ' — src/battle/hud.js owns this zone');
}
ok('…and a signpost says where it went', /THE VANISH ZONE IS NOT IN THIS FILE/.test(SRC),
   'the next person to look here must find the answer, not the absence that sent me building one');
ok('the graveyard rail is untouched', /data-bp-grave="player"/.test(SRC) && /data-bp-grave="ai"/.test(SRC));
/* ══ 🪦→👋 A CARD TAKEN OUT OF THE GRAVEYARD STAYS OUT ═════════════════════ */
/* Owner, twice: "when cards are taken from the graveyard like summon, or
   salvage make sure that they are removed from the graveyard and not
   duplicated like I requested before."
   🔴 THE CARD WAS ALWAYS BEING REMOVED — every path conserves the pile. What
   did not was the VIEW: _graveViewCards folds in corpses the pile does not
   represent, decided by three tiers that all ask the same question — is there a
   pile card standing for this dead unit? After a deliberate removal the answer
   is no BY DESIGN, so the corpse fell through all three and pushed the card
   back on screen. Measured: salvage left pile 0 / hand 1 and the view still
   read ["Goblin"].
   The fold cannot infer "never filed" from "filed, then taken" — nothing
   recorded the taking. So the taking records it. */
ok('a card leaving the graveyard retires its corpse', has('function _graveCardLeft(state, side, card) {'));
ok('…and the fold honours that stamp', /&& !u._graveCardTaken/.test(SRC),
   'without this the view re-adds the very card the player just salvaged or summoned');
ok('…claiming ONE corpse, not every match', has('if (!hit) return state;'),
   'three copies of a card may be in the graveyard at once — salvaging one must retire one');
ok('…preferring the corpse the card was filed FOR', has('if (stamped && String(u.id) === String(stamped)) { hit = u; break; }'));
for (const [site, re] of [
  ['salvage to hand',      'state = _graveCardLeft(state, owner, c);'],
  ['the named-card picker','if (fromGrave) { try { App.state = _graveCardLeft(App.state, _dsSide, card); }'],
  ['summon from the grave',"if (zone.key === 'graveyard') state = _graveCardLeft(state, owner, pick);"],
]) ok(site + ' retires the corpse', has(re));
ok('deck and hand summons do NOT — they have no corpse', /only the GRAVEYARD has corpses to retire/.test(SRC));

/* ══ 🎴 MODALS SHOW CARD ART, NEVER A BARE EMOJI ═══════════════════════════ */
const _artRows = SRC.split('counter-prompt-card-icon">${_battleCardArtHtml').length - 1
               + SRC.split('counter-prompt-card-icon">${t.art ||').length - 1;
ok('every counter-prompt row draws art', _artRows === 4,
   'found ' + _artRows + ' of 4 — a row left on escapeHtml(icon) is the unicorn the owner photographed');
ok('…and no row renders a bare icon', !new RegExp('counter-prompt-card-icon">[$][{]escapeHtml[(]').test(SRC),
   'built with RegExp rather than a literal: the pattern contains ${ and ( and a literal regex needs them escaped three different ways');
ok('grave reactions carry a card id', /cardId: c.id || c.cardId || c.originalCardId || null,/.test(SRC),
   'the row had only name and icon — art was impossible, not merely absent');
ok('the prompt sizes its art', /counter-prompt-card-icon .bca-img{width:64px;height:88px/.test(SRC),
   'the rows draw at 2.4rem of emoji; art inherits a 1.7em default and reads as a thumbnail beside a full-size name');

console.log('');
if (fails) { console.log('❌ ' + fails + ' FAILED'); process.exit(1); }
console.log('✅ ALL PASS');
