/* ══════════════════════════════════════════════════════════════════════════
   🔢 DRIVE-SCALE-PER — "…for EACH matching card in a zone".

   THE ASK: "Deal 10 damage to a unit or enemy hero for each Abra Morpher in
   your graveyard… some will draw cards for how many."

   The engine already carries `scalePer` — a modifier that multiplies an
   effect's Amount by how many cards match a filter in a chosen zone, so ONE
   switch scales ANY effect rather than needing damagePerCard, drawPerCard,
   summonPerCard… What this pins is that it actually WORKS, in every zone the
   ask names, and — the part that was missing — that it works on the EXTRA
   effect slots too, which is how one card both burns and draws per Morpher.

   Each claim has a control, because a multiplier that is always applied and a
   multiplier that is never applied both look like "a number came out".

     · grave / hand / void all count, and count only what MATCHES
     · a card that merely COUNTS AS the named one (treatAs) is tallied
     · zero matches ⇒ the effect fizzles rather than firing at base
     · CONTROL: no scalePer ⇒ the flat Amount, untouched
     · CONTROL: a filter that matches nothing ⇒ ×0, not ×all
     · the EXTRA slots scale too (this is the new half)

   Run:  node .gauntlet/drive-scale-per.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const P = 8830 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('typeof applyOnPlayEffect === "function" && typeof initGame === "function"', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(2500);

const out = await pg.evaluate(() => {
  const o = {};
  o.reachable = typeof applyOnPlayEffect === 'function' && typeof _applyOnPlayOne === 'function';
  if (!o.reachable) return o;

  const MORPH = (n) => ({ id: 'abra_' + n, name: 'Abra Morpher', type: 'unit', cost: 2 });
  const OTHER = (n) => ({ id: 'other_' + n, name: 'Bystander', type: 'unit', cost: 2 });

  /* The caster is the AI so a targeted effect resolves immediately instead of
     queueing the player's picker — the picker is a different test. */
  const board = (fill) => {
    App.battlePrep = App.battlePrep || {};
    const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
    App.battlePrep.hero = me; App.battlePrep.multiplayer = false;
    const s = initGame(me, foe, [], true, null);
    s.log = []; s.turn = 'ai'; s.turnNumber = 2; s.gameOver = null;
    s.ai = { ...s.ai, hand: [], graveyard: [], void: [], deck: [], energy: 20 };
    s.player = { ...s.player, hand: [], graveyard: [], void: [], deck: [] };
    const mk = (id, owner, x, y) => ({
      id, owner, name: id, isHero: false, alive: true, level: 5,
      currentHp: 900, maxHp: 900,
      stats: { hp: 900, atk: 10, def: 10, mag: 10, res: 10, spd: 1 },
      elements: ['neutral'], passives: [], statusEffects: [], stages: {},
      pos: { x, y }, moves: [], hasAttacked: false, hasMoved: false,
    });
    s.units = [mk('CASTER', 'ai', 4, 4), mk('T1', 'player', 5, 4), mk('T2', 'player', 3, 4)];
    if (typeof fill === 'function') fill(s);
    App.state = s;
    return s;
  };
  const caster = (s) => s.units.find(u => u.id === 'CASTER');
  const hpOf = (st, id) => (st.units.find(u => u.id === id) || {}).currentHp;
  const fire = (s, onPlay, extra) => applyOnPlayEffect(s, caster(s), {
    id: 'sc', name: 'Scaler', onPlay, onPlayExtra: extra || null });

  const strike = (scalePer) => ({ type: 'targetStrike', targeted: true, amount: 10, tSide: 'enemy',
                                  _targetId: 'T1', ...(scalePer ? { scalePer } : {}) });
  const graveScale = { zone: 'grave', side: 'owner', filter: { nameIncludes: 'Abra Morpher' } };

  // ── 1 · the headline card: 10 damage per Morpher in your graveyard ───────
  {
    const s = board((st) => { st.ai.graveyard = [MORPH(1), MORPH(2), MORPH(3), OTHER(1)]; });
    const after = fire(s, strike(graveScale));
    o.threeMorphers = 900 - hpOf(after, 'T1');            // 3 × 10 = 30
  }
  // CONTROL: no scalePer at all → the flat 10
  {
    const s = board((st) => { st.ai.graveyard = [MORPH(1), MORPH(2), MORPH(3)]; });
    const after = fire(s, strike(null));
    o.flat = 900 - hpOf(after, 'T1');
  }
  // CONTROL: the filter matches nothing → ×0, not ×everything
  {
    const s = board((st) => { st.ai.graveyard = [OTHER(1), OTHER(2), OTHER(3)]; });
    const after = fire(s, strike(graveScale));
    o.noMatches = 900 - hpOf(after, 'T1');
  }
  // ── 2 · the other zones the ask names ───────────────────────────────────
  {
    const s = board((st) => { st.ai.hand = [MORPH(1), MORPH(2)]; });
    const after = fire(s, strike({ ...graveScale, zone: 'hand' }));
    o.handTwo = 900 - hpOf(after, 'T1');
  }
  {
    const s = board((st) => { st.ai.void = [MORPH(1), MORPH(2), MORPH(3), MORPH(4)]; });
    const after = fire(s, strike({ ...graveScale, zone: 'void' }));
    o.voidFour = 900 - hpOf(after, 'T1');
  }
  // an alias counts as the name
  {
    const s = board((st) => { st.ai.graveyard = [{ id: 'x', name: 'Stand-In', treatAs: 'Abra Morpher' }]; });
    const after = fire(s, strike(graveScale));
    o.aliasCounts = 900 - hpOf(after, 'T1');
  }
  // ── 3 · "draw cards for how many" ───────────────────────────────────────
  {
    const s = board((st) => {
      st.ai.graveyard = [MORPH(1), MORPH(2)];
      st.ai.deck = [OTHER(1), OTHER(2), OTHER(3), OTHER(4), OTHER(5)];
    });
    const after = fire(s, { type: 'drawCards', amount: 1, scalePer: graveScale });
    o.drewPerMorpher = (after.ai.hand || []).length;      // 1 × 2 = 2
  }
  // ── 4 · THE EXTRA SLOTS — one card that burns AND draws, both per Morpher
  {
    const s = board((st) => {
      st.ai.graveyard = [MORPH(1), MORPH(2), MORPH(3)];
      st.ai.deck = [OTHER(1), OTHER(2), OTHER(3), OTHER(4), OTHER(5)];
    });
    const after = fire(s, strike(graveScale),
                       [{ type: 'drawCards', amount: 1, scalePer: graveScale }]);
    o.extra = { dmg: 900 - hpOf(after, 'T1'), drew: (after.ai.hand || []).length };
  }
  // ── 5 · no filter at all ⇒ every card in the pile counts ────────────────
  {
    const s = board((st) => { st.ai.graveyard = [MORPH(1), OTHER(1), OTHER(2)]; });
    const after = fire(s, strike({ zone: 'grave', side: 'owner' }));
    o.unfiltered = 900 - hpOf(after, 'T1');               // 3 × 10
  }
  // ── 6 · whose zone — the ENEMY's graveyard, not yours ───────────────────
  {
    const s = board((st) => { st.player.graveyard = [MORPH(1), MORPH(2)]; st.ai.graveyard = []; });
    const after = fire(s, strike({ ...graveScale, side: 'enemy' }));
    o.enemySide = 900 - hpOf(after, 'T1');
    const s2 = board((st) => { st.player.graveyard = [MORPH(1), MORPH(2)]; st.ai.graveyard = []; });
    o.enemySideControl = 900 - hpOf(fire(s2, strike(graveScale)), 'T1');  // yours is empty → 0
  }

  /* ── 7 · THE CARD HAS TO SAY IT ─────────────────────────────────────────
     A scaled card whose rules text reads like a flat one is the bug an author
     would ship without noticing: the printed Amount is per-copy. */
  if (typeof describeOnPlayEffect === 'function') {
    o.text = describeOnPlayEffect({ type: 'targetStrike', targeted: true, amount: 10,
                                    scalePer: graveScale });
    o.textFlat = describeOnPlayEffect({ type: 'targetStrike', targeted: true, amount: 10 });
  }

  /* ── 8 · THE AUTHORING ROUND-TRIP ───────────────────────────────────────
     Renders the real card editor, fills it the way an author would, and reads
     it back through the real save. This is what was actually missing: the
     engine scaled extras all along, but no editor control wrote scalePer onto
     one, so "burn per Morpher AND draw per Morpher" was unauthorable. */
  try {
    App.editingCardId = 'NEW'; App._newCardDraft = makeNewCardDraft();
    const host = document.createElement('div');
    host.innerHTML = renderCardEditor();
    document.body.appendChild(host);
    /* The preview sentence is wired by bindCardEditor, not by the template, so
       the driver has to bind the way the app does or it is testing a dead DOM. */
    try { if (typeof bindCardEditor === 'function') bindCardEditor(); } catch (e) { o.bindError = String(e).slice(0, 160); }
    /* Sets the field the way a person does — value THEN an input event — so the
       editor''s delegated listeners (live capture, the preview sentence) run.
       Assigning .value alone fires nothing and would test a dead form. */
    const set = (id, val) => {
      const el = document.getElementById(id); if (!el) return false;
      el.value = val;
      try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
      try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
      return el.value === String(val);
    };
    o.ui = {
      primaryZone: !!document.getElementById('ed-onplay-scalezone'),
      extraZone:   !!document.getElementById('ed-onplayx-0-scalezone'),
      extraSide:   !!document.getElementById('ed-onplayx-0-scaleside'),
    };
    set('ed-onplay-type', 'targetStrike'); set('ed-onplay-amount', '10');
    set('ed-onplay-scalezone', 'grave'); set('ed-onplay-scaleside', 'owner');
    /* The counted card is named in the BLOCK's own field now. The 🎴 Card
       Filter is deliberately left EMPTY: if the save still read the name from
       there, scalePer would come back unnamed and this would fail. */
    set('ed-onplay-scalename', 'Abra Morpher');
    set('ed-onplayx-0-type', 'drawCards'); set('ed-onplayx-0-amount', '1');
    set('ed-onplayx-0-fname', 'Abra Morpher'); set('ed-onplayx-0-scalezone', 'grave');
    const draft = { id: 'rt', name: 'Round Trip', type: 'spell' };
    captureEditorIntoCard(draft);
    o.saved = {
      primary: draft.onPlay && draft.onPlay.scalePer || null,
      extra: draft.onPlayExtra && draft.onPlayExtra[0] && draft.onPlayExtra[0].scalePer || null,
    };
    // CONTROL: a slot left on "Off" must not carry a dead scalePer.
    set('ed-onplayx-0-scalezone', '');
    const draft2 = { id: 'rt2', name: 'Round Trip 2', type: 'spell' };
    captureEditorIntoCard(draft2);
    o.savedOff = (draft2.onPlayExtra && draft2.onPlayExtra[0] && draft2.onPlayExtra[0].scalePer) || null;
    /* ── THE SEPARATION, WHICH IS THE WHOLE POINT OF THE MOVE ─────────────
       'Hit ANY unit, but count only Abra Morphers' was not expressible while
       one input answered both questions. Set them to DIFFERENT values and
       both must survive: the effect's own filter says Bystander, the count
       says Abra Morpher. */
    set('ed-onplay-scalename', 'Abra Morpher');
    set('ed-onplay-filter-name', 'Bystander');
    const draft3 = { id: 'rt3', name: 'Round Trip 3', type: 'spell' };
    captureEditorIntoCard(draft3);
    o.split = {
      counts: draft3.onPlay && draft3.onPlay.scalePer && draft3.onPlay.scalePer.filter
              && draft3.onPlay.scalePer.filter.nameIncludes,
      hits: draft3.onPlay && draft3.onPlay.filter && draft3.onPlay.filter.nameIncludes,
    };
    // the live sentence the author reads back
    o.preview = (document.getElementById('ed-scale-preview') || {}).textContent || '';
    // …and the CONTROL: switched Off, it says so rather than inventing a rule
    set('ed-onplay-scalezone', '');
    try { document.querySelector('.card-editor').dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
    o.previewOff = (document.getElementById('ed-scale-preview') || {}).textContent || '';
    host.remove();
  } catch (e) { o.uiError = String(e).slice(0, 200); }

  return o;
});

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
if (!out.reachable) bad.push('the on-play engine is not reachable');
else {
  need('10 damage × 3 Morphers in the graveyard = 30', out.threeMorphers === 30, out.threeMorphers);
  need('CONTROL: no scalePer → the flat 10', out.flat === 10, out.flat);
  need('CONTROL: nothing matches → nothing happens', out.noMatches === 0, out.noMatches);
  need('the HAND counts (×2)', out.handTwo === 20, out.handTwo);
  need('the VOID counts (×4)', out.voidFour === 40, out.voidFour);
  need('a treatAs alias is tallied', out.aliasCounts === 10, out.aliasCounts);
  need('draw 1 per Morpher drew 2', out.drewPerMorpher === 2, out.drewPerMorpher);
  need('an EXTRA slot scales too — burn 30', out.extra.dmg === 30, out.extra);
  need('…and draws 3 in the same play', out.extra.drew === 3, out.extra);
  need('no filter → every card counts (×3)', out.unfiltered === 30, out.unfiltered);
  need("the ENEMY's zone can be counted (×2)", out.enemySide === 20, out.enemySide);
  need('CONTROL: …and yours, being empty, gives 0', out.enemySideControl === 0, out.enemySideControl);
  need('the card TEXT names what it counts', /for EACH "Abra Morpher" in your graveyard/.test(out.text || ''), out.text);
  need('CONTROL: a flat card says no such thing', !/for EACH/.test(out.textFlat || ''), out.textFlat);
  need('the editor offers …for each on the primary slot', !!(out.ui && out.ui.primaryZone), out.ui);
  need('…and on the EXTRA slots (zone + side)', !!(out.ui && out.ui.extraZone && out.ui.extraSide), out.ui);
  need('the primary save round-trips scalePer', !!(out.saved && out.saved.primary && out.saved.primary.zone === 'grave'
       && out.saved.primary.filter && out.saved.primary.filter.nameIncludes === 'Abra Morpher'), out.saved);
  need('the EXTRA save round-trips scalePer', !!(out.saved && out.saved.extra && out.saved.extra.zone === 'grave'
       && out.saved.extra.filter && out.saved.extra.filter.nameIncludes === 'Abra Morpher'), out.saved);
  need('CONTROL: a slot on "Off" stores no scalePer', out.savedOff === null, out.savedOff);
  need('the block names the counted card in its OWN field',
       !!(out.split && out.split.counts === 'Abra Morpher'), out.split);
  need('…and the effect keeps a DIFFERENT hit filter (one input no longer serves two questions)',
       !!(out.split && out.split.hits === 'Bystander'), out.split);
  need('the author can read the rule back as a sentence',
       /Amount 10 . how many "Abra Morpher" are in your graveyard/.test(out.preview || ''), out.preview);
  need('CONTROL: switched Off, the sentence says Off', /Off/.test(out.previewOff || ''), out.previewOff);
  need('the editor did not throw', !out.uiError, out.uiError);
}

console.log(JSON.stringify({ ...out, pageErrors: errs.slice(0, 4) }, null, 2));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — any effect scales by what is in the zone, in every zone, on the primary and the extras.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
