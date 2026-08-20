/* ══════════════════════════════════════════════════════════════════════════
   🪵 THE TABLE — one companion, laid out whole.       ranch / piece: the sheet
   ──────────────────────────────────────────────────────────────────────────
   🔴 WHY THIS SCREEN EXISTS AT ALL — it adds no mechanic.
   Everything on this table already existed and already persisted. The problem
   was that no single view ever showed a unit as a PERSON, because the pieces
   were scattered across four screens that were each built for a different job:

     bond / morale / trauma / fatigue → the camp slot row (renderCamp)
     temperament / memories / rapport → the owned-card detail modal
     Resonance spread + rank         → the Bunkhouse overlay
     career numbers (fielded, kills) → stored, never rendered anywhere

   A player could have a Sworn companion with forty battles, three memories and
   a maxed SPD spread and never once see those facts in the same place. This is
   the one place they meet. Monster Rancher's ranch screen is the reference:
   you walk in, your monster is THERE, and looking at it is the activity.

   ⚠ READ-MOSTLY BY DESIGN. The only writes are the judgement buttons (which go
   through /src/ranch/judgement.js and the bridge's adjustBond) and the gift.
   Nothing here sells, releases, deploys or deletes — a screen you visit to
   feel something about a unit is the wrong place for an irreversible button
   sitting one mis-tap away.

   🔴 THE GLOBALS TRAP (CLAUDE.md). `Profile`, `App`, `getBondTier`,
   `resolveDeckCard`, `_staticSpriteThumb` and friends are top-level `const` /
   `function` declarations in index.html. They are global LEXICAL bindings —
   NOT properties of `window` — so this module cannot see one of them, and
   `window.Profile` being truthy in a console proves nothing. Everything
   arrives through `window.MythicRanchBridge`, which index.html builds by hand.
   If the bridge is missing, every entry point below no-ops and the game is
   exactly as it was.
   ══════════════════════════════════════════════════════════════════════════ */
import * as J from './judgement.js';

function B() { try { return window.MythicRanchBridge || null; } catch (e) { return null; } }
function REZ() { try { return (window.MythicResonance && typeof window.MythicResonance.get === 'function') ? window.MythicResonance : null; } catch (e) { return null; } }

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* ── the greeting ──────────────────────────────────────────────────────────
   The unit reacts to you SITTING DOWN. This is the cheapest warmth in the
   whole feature and the thing players will actually remember, so it is picked
   in a deliberate order: a companion in real trouble says so FIRST, whatever
   it thinks of you. A Sworn unit that is bleeding trauma greeting you with
   "Whatever you need" would read as the screen not noticing — and an
   unnoticed condition is indistinguishable from a bug. Loyalty only chooses
   the line once the unit is actually all right. */
const NEED_GREETING = [
  { k: 'refuse',     test: p => !!p.refuseDeploy,        line: "I'm not going out again. Not the way you've been fighting." },
  { k: 'trauma',     test: p => (p.trauma || 0) >= 40,   line: "I keep seeing it. Every time I close my eyes, I'm back there." },
  { k: 'corruption', test: p => (p.corruption || 0) >= 40, line: "Something followed me back. I can feel it under my skin." },
  { k: 'fatigue',    test: p => (p.fatigue || 0) >= 55,  line: "How long since I slept? Properly, I mean." },
  { k: 'morale',     test: p => (p.morale != null ? p.morale : 80) <= 35, line: "What are we even doing out here?" },
];
/* Indexed by bond tier (Wary → Sworn), so the same screen is a different
   room depending on what you have put in. */
const BOND_GREETING = [
  ['You need something?', 'I know your face. That is about all I know.'],
  ['Commander.', 'Ready when you are.'],
  ['Good to see you. Sit, if you like.', 'Been meaning to talk, actually.'],
  ['You look tired. Sit down before you fall down.', 'Whatever you need. You know that.'],
  ['I would follow you into worse than this. I have.', "Say the word. That's all it takes."],
  ['Wherever you go. However it ends.', 'There is nothing left to prove between us.'],
];

export function greeting(prof, tierIdx, seed) {
  try {
    for (const g of NEED_GREETING) if (g.test(prof)) return { line: g.line, urgent: true, kind: g.k };
    const pool = BOND_GREETING[clamp(tierIdx | 0, 0, BOND_GREETING.length - 1)];
    return { line: pool[Math.abs(seed | 0) % pool.length], urgent: false, kind: 'bond' };
  } catch (e) { return { line: '…', urgent: false, kind: 'none' }; }
}

/* Condition rows. `bad` is "higher is worse" — morale is the one that inverts,
   and getting that backwards would paint a happy unit red. */
const COND = [
  { k: 'morale',     ico: '🙂', label: 'Morale',     bad: false, def: 80 },
  { k: 'trauma',     ico: '💀', label: 'Trauma',     bad: true,  def: 0 },
  { k: 'corruption', ico: '☣',  label: 'Corruption', bad: true,  def: 0 },
  { k: 'fatigue',    ico: '😖', label: 'Fatigue',    bad: true,  def: 0 },
];

const CSS = `
#rt-ov{position:fixed;inset:0;z-index:2147483500;background:rgba(4,3,8,.9);backdrop-filter:blur(6px);
  display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:1.4rem 1rem 3rem;}
#rt-ov *{box-sizing:border-box;}
.rt-wrap{width:min(980px,96vw);}
/* The table itself. The lamp is a radial that takes the BOND TIER's colour —
   a Wary unit sits under a cold grey light and a Sworn one under gold, so the
   room reads before a single number is parsed. */
.rt-table{position:relative;border-radius:16px;padding:1.4rem 1.5rem 1.5rem;
  background:radial-gradient(120% 90% at 22% 0%, var(--rt-lamp,#8883) 0%, transparent 58%),
             linear-gradient(168deg,#241a12 0%,#180f0b 46%,#100a08 100%);
  border:1px solid rgba(212,175,55,.26);box-shadow:0 30px 90px rgba(0,0,0,.75), inset 0 1px 0 rgba(255,255,255,.05);}
.rt-grain{position:absolute;inset:0;border-radius:16px;pointer-events:none;opacity:.35;
  background:repeating-linear-gradient(94deg,rgba(255,255,255,.022) 0 2px,transparent 2px 7px);}
.rt-close{position:absolute;top:.7rem;right:.8rem;z-index:3;width:34px;height:34px;border-radius:9px;
  border:1px solid rgba(212,175,55,.35);background:rgba(0,0,0,.45);color:#e8d9a8;font-size:1.1rem;cursor:pointer;line-height:1;}
.rt-close:hover{border-color:#ffd166;color:#ffd166;}
.rt-top{position:relative;z-index:2;display:flex;gap:1.4rem;flex-wrap:wrap;align-items:flex-start;}

/* The card, laid down rather than displayed. The tilt is the whole trick. */
/* Sticky, because the sheet is far taller than the card and a fixed card left
   ~900px of dead column beside it. Keeping the portrait in view while you read
   the record is also just the right feeling for this screen: the companion
   does not leave the table when you look down at your notes. */
.rt-cardcol{flex:0 0 200px;display:flex;flex-direction:column;align-items:center;gap:.55rem;
  position:sticky;top:.4rem;align-self:flex-start;}
.rt-card{width:186px;border-radius:12px;padding:.7rem .7rem .8rem;transform:rotate(-2.4deg);
  background:linear-gradient(170deg,#1d1730,#120c1e);border:1px solid var(--rt-tier,#8a8a8a);
  box-shadow:0 16px 34px rgba(0,0,0,.6), 0 0 0 1px rgba(0,0,0,.4);}
.rt-card.glow{box-shadow:0 16px 34px rgba(0,0,0,.6), 0 0 26px -4px var(--rt-tier,#8a8a8a);}
.rt-portrait{height:120px;display:flex;align-items:center;justify-content:center;font-size:3.6rem;line-height:1;
  border-radius:8px;background:rgba(0,0,0,.32);overflow:hidden;margin-bottom:.5rem;}
.rt-portrait img{max-width:100%;max-height:100%;image-rendering:pixelated;}
.rt-cname{font-family:'Cinzel',serif;color:#f3e6c4;font-size:.95rem;line-height:1.25;text-align:center;}
.rt-csub{color:#a2937040;text-align:center;}
.rt-sigil{font-size:.7rem;letter-spacing:.14em;text-align:center;margin-top:.3rem;color:var(--rt-tier,#8a8a8a);font-family:'Cinzel',serif;}
.rt-mat{width:196px;height:12px;border-radius:50%;margin-top:-4px;
  background:radial-gradient(closest-side, var(--rt-lamp,#8883), transparent 78%);}

.rt-sheet{flex:1 1 340px;min-width:290px;}
.rt-name{font-family:'Cinzel',serif;color:#ffd166;font-size:1.4rem;letter-spacing:.03em;line-height:1.15;}
.rt-tierline{margin-top:.2rem;font-size:.82rem;color:var(--rt-tier,#9aa0a6);font-family:'Roboto Mono',monospace;}
.rt-bondbar{height:6px;border-radius:3px;background:rgba(255,255,255,.09);margin:.45rem 0 .1rem;overflow:hidden;}
.rt-bondfill{height:100%;border-radius:3px;background:var(--rt-tier,#9aa0a6);}
.rt-greet{margin:.9rem 0 .2rem;padding:.7rem .85rem;border-radius:10px;border-left:3px solid var(--rt-tier,#9aa0a6);
  background:rgba(0,0,0,.3);color:#e9dfc6;font-size:.95rem;line-height:1.5;font-style:italic;}
.rt-greet.urgent{border-left-color:#e07a5f;color:#f2ccc0;}

.rt-hdr{font-size:.66rem;letter-spacing:.13em;text-transform:uppercase;color:#8f8264;margin:1.05rem 0 .4rem;
  font-family:'Cinzel',serif;border-bottom:1px solid rgba(212,175,55,.14);padding-bottom:.22rem;}
.rt-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:.4rem;}
/* Condition needs its own, wider track. At the 148px the record grid uses, a
   meter is icon + 74px label + number + whatever is left, and "whatever is
   left" was ~20px — the bar rendered as an unreadable dash. An unreadable
   meter is worse than no meter: it looks like a rendering fault. */
.rt-grid.cond{grid-template-columns:repeat(auto-fit,minmax(226px,1fr));}
.rt-kv{display:flex;justify-content:space-between;gap:.5rem;padding:.32rem .55rem;border-radius:7px;
  background:rgba(255,255,255,.035);font-size:.78rem;color:#bfae87;}
.rt-kv b{color:#e2eaff;font-family:'Roboto Mono',monospace;font-weight:600;}
.rt-meter{display:flex;align-items:center;gap:.5rem;padding:.3rem .55rem;border-radius:7px;background:rgba(255,255,255,.035);font-size:.76rem;color:#bfae87;}
/* 🔴 display:block IS LOAD-BEARING ON BOTH LINES. These are span elements, and
   the height property does not apply to an inline box — the track collapsed to
   a 2px dash and the fill inside it never painted at all, so every meter on the
   sheet rendered as an empty groove. The track survived on its own because a
   flex parent blockifies its children; the FILL is one level deeper and does
   not. (This comment sits INSIDE the CSS template literal — no backticks.) */
.rt-meter .rt-track{display:block;flex:1;height:5px;border-radius:3px;background:rgba(0,0,0,.45);overflow:hidden;}
.rt-meter .rt-fillm{display:block;height:100%;border-radius:3px;}
.rt-meter b{font-family:'Roboto Mono',monospace;color:#e2eaff;min-width:28px;text-align:right;}
.rt-stat{display:flex;align-items:center;gap:.5rem;font-size:.74rem;color:#bfae87;margin-bottom:3px;}
.rt-stat span:first-child{width:34px;color:#8f8264;font-family:'Roboto Mono',monospace;letter-spacing:.06em;}
.rt-stat .rt-track{display:block;flex:1;height:6px;border-radius:3px;background:rgba(0,0,0,.45);overflow:hidden;}
.rt-stat .rt-fillm{display:block;height:100%;border-radius:3px;background:linear-gradient(90deg,#6f7fd4,#b48cff);}
.rt-stat b{font-family:'Roboto Mono',monospace;color:#c9bfff;min-width:46px;text-align:right;}
.rt-chip{display:inline-flex;align-items:center;gap:.25rem;padding:2px 9px;border-radius:999px;font-size:.72rem;margin:0 4px 4px 0;}
.rt-mem{font-size:.78rem;color:#cbbf9e;line-height:1.55;}
.rt-mem .rt-x{color:#8f8264;}
.rt-note{color:#8f8264;font-size:.72rem;line-height:1.5;font-style:italic;}
.rt-temper{display:flex;gap:.6rem;align-items:flex-start;padding:.5rem .65rem;border-radius:9px;
  border:1px solid rgba(212,175,55,.24);background:rgba(212,175,55,.055);}

/* The deck, fanned along the bottom edge of the table. Overlapping is the
   point — it should read as cards resting on wood, not as a list. */
.rt-deck{position:relative;z-index:2;margin-top:1.3rem;padding-top:1rem;border-top:1px solid rgba(212,175,55,.14);}
.rt-fan{display:flex;flex-wrap:wrap;padding-left:16px;}
.rt-fc{width:74px;height:96px;margin-left:-16px;border-radius:8px;padding:.35rem .3rem;flex:0 0 auto;
  background:linear-gradient(168deg,#191428,#0f0a1a);border:1px solid rgba(212,175,55,.2);
  box-shadow:0 8px 18px rgba(0,0,0,.5);display:flex;flex-direction:column;align-items:center;justify-content:flex-start;
  gap:.2rem;transition:transform .12s ease;}
.rt-fc:hover{transform:translateY(-9px);z-index:5;}
.rt-fc.me{border-color:#ffd166;box-shadow:0 8px 22px rgba(0,0,0,.55),0 0 16px -3px #ffd16688;transform:translateY(-11px);}
.rt-fc .rt-fi{font-size:1.5rem;line-height:1;height:34px;display:flex;align-items:center;justify-content:center;overflow:hidden;}
.rt-fc .rt-fi img{max-width:100%;max-height:100%;image-rendering:pixelated;}
.rt-fc .rt-fn{font-size:.58rem;line-height:1.15;text-align:center;color:#c7bb9c;overflow:hidden;}

.rt-btn{padding:.42rem .85rem;border-radius:8px;border:1px solid rgba(212,175,55,.45);
  background:rgba(212,175,55,.12);color:#ffd166;font-family:'Cinzel',serif;font-size:.8rem;cursor:pointer;}
.rt-btn:hover{background:rgba(212,175,55,.2);}
.rt-btn[disabled]{opacity:.4;cursor:not-allowed;}
.rt-btn.warm{border-color:#7fd8a077;background:#7fd8a018;color:#9fe0b0;}
.rt-btn.cold{border-color:#cf686877;background:#cf686818;color:#e89a9a;}
@media (max-width:640px){ .rt-cardcol{flex:1 1 100%;} .rt-card{width:170px;} }
`;
let cssDone = false;
function ensureCss() {
  if (cssDone) return; cssDone = true;
  const s = document.createElement('style'); s.id = 'ranch-table-css'; s.textContent = CSS; document.head.appendChild(s);
}

/* Every deck that contains this card, with its full card list — so the fan can
   show the unit IN CONTEXT ("this is who it stands beside") rather than as an
   orphan. Uses the bridge's own deck-key resolver: keys in the wild are
   'unit:<id>', 'custom:<id>' and legacy 'u_<id>', and matching them by hand
   here would silently miss forged units, which is most of the roster. */
function decksWith(cardId) {
  const b = B(); if (!b) return [];
  try {
    return (b.decks() || []).filter(d => d && Array.isArray(d.cards) &&
      d.cards.some(k => b.deckKeyCardId(k) === cardId));
  } catch (e) { return []; }
}

function meterRow(row, val) {
  const v = clamp(Math.round(val), 0, 100);
  // A "bad" stat is red as it rises; morale is green as it rises. Same bar,
  // inverted reading — hence the explicit `bad` flag rather than a heuristic.
  const good = row.bad ? (100 - v) : v;
  const col = good >= 66 ? '#7fd8a0' : good >= 33 ? '#e8c46a' : '#e07a5f';
  return `<div class="rt-meter"><span>${row.ico}</span><span style="min-width:74px">${row.label}</span>
    <span class="rt-track"><span class="rt-fillm" style="width:${v}%;background:${col}"></span></span><b>${v}</b></div>`;
}

/* `inject` lands directly under the greeting. The judgement strip used to be
   appended after the deck fan, which put the single most important control on
   the screen ~1400px below the fold — the companion said its piece at the top
   and the three buttons that answer it were off-screen entirely. It belongs in
   the conversation, not in an appendix. */
export function sheetHtml(cardId, inject) {
  const b = B(); if (!b) return '';
  const card = b.card(cardId) || { id: cardId, name: cardId, icon: '❔' };
  const prof = b.unitProf(cardId) || {};
  const tier = b.bondTier(prof.bond || 0);
  const tierIdx = b.bondTierIndex(prof.bond || 0);
  const temper = b.temper(cardId, prof) || null;
  const rez = REZ();
  const key = 'u:' + cardId;
  const spread = rez ? rez.get(key) : null;
  const rank = rez ? rez.rank(key) : null;
  const total = rez ? rez.total(key) : 0;
  const seed = (prof.fielded | 0) + (prof.level | 0) + (b.battleCount() | 0);
  const g = greeting(prof, tierIdx, seed);

  /* Discovery follows the rule the card-detail modal already set: the more a
     unit trusts you, the more of itself it shows. Repeating that here (rather
     than printing everything because this screen is "the detailed one") keeps
     bond meaningful — otherwise the table becomes the cheat sheet that makes
     the tier gate on every other screen pointless. */
  const known = tierIdx >= 2;   // Steady

  let h = '';

  // ── the card, face up on the mat ───────────────────────────────────────
  h += `<div class="rt-top"><div class="rt-cardcol">
    <div class="rt-card${rank && rank.glow ? ' glow' : ''}">
      <div class="rt-portrait">${b.spriteThumb('u_' + cardId, card.icon || '🪖')}</div>
      <div class="rt-cname">${esc(card.name || cardId)}</div>
      <div class="rt-csub" style="color:#8f8264;font-size:.66rem;text-align:center;margin-top:.2rem">
        Lv ${prof.level | 0 || 1}${card.rarity ? ' · ' + esc(String(card.rarity).toUpperCase()) : ''}</div>
      ${rank ? `<div class="rt-sigil">${rank.sigil ? '✦ ' : ''}${esc(rank.name.toUpperCase())}${rank.sigil ? ' ✦' : ''}</div>` : ''}
    </div>
    <div class="rt-mat"></div>
  </div>`;

  // ── the sheet ──────────────────────────────────────────────────────────
  h += `<div class="rt-sheet">
    <div class="rt-name">${esc(card.name || cardId)}</div>
    <div class="rt-tierline">💗 ${esc(tier.name)} · ${prof.bond | 0} / ${b.bondMax()}</div>
    <div class="rt-bondbar"><div class="rt-bondfill" style="width:${clamp((prof.bond || 0) / b.bondMax() * 100, 0, 100)}%"></div></div>
    <div class="rt-greet${g.urgent ? ' urgent' : ''}">“${esc(g.line)}”</div>
    ${inject || ''}`;

  // temperament
  if (temper) {
    h += `<div class="rt-hdr">🎭 Temperament</div><div class="rt-temper">
      <span style="font-size:1.5rem;line-height:1">${temper.icon}</span>
      <div style="flex:1;min-width:0">
        <div style="color:#f5c453;font-weight:800">${esc(temper.name)}</div>
        <div style="color:#c2b184;font-size:.76rem;line-height:1.45">${esc(temper.blurb)}</div>
        ${known ? `<div style="color:#9ad17a;font-size:.74rem;margin-top:.2rem">✦ ${esc(temper.quirk)}</div>`
                : `<div class="rt-note" style="margin-top:.2rem">Reach Steady to learn what makes them different.</div>`}
      </div></div>`;
  }

  // ── condition ──────────────────────────────────────────────────────────
  h += `<div class="rt-hdr">🩺 Condition</div><div class="rt-grid cond">`
    + COND.map(r => meterRow(r, prof[r.k] != null ? prof[r.k] : r.def)).join('') + `</div>`;
  if (prof.refuseDeploy) {
    h += `<div class="rt-note" style="color:#e89a9a;margin-top:.35rem;font-style:normal">
      ⚠ Refusing to deploy. Overrule them below, change how you fight, or let them go.</div>`;
  }

  // ── career ─────────────────────────────────────────────────────────────
  // Numbers the game has always stored and never once shown as a RECORD. A
  // unit with 60 battles behind it should be able to point at that.
  h += `<div class="rt-hdr">🎖 Service Record</div><div class="rt-grid">
    <div class="rt-kv"><span>Battles fought</span><b>${prof.fielded | 0}</b></div>
    <div class="rt-kv"><span>At your side</span><b>${prof.together | 0}</b></div>
    <div class="rt-kv"><span>Kills</span><b>${prof.kills | 0}</b></div>
    <div class="rt-kv"><span>Level</span><b>${prof.level | 0 || 1}</b></div>
  </div>`;

  // ── resonance ──────────────────────────────────────────────────────────
  if (rez && spread) {
    const STATS = [['hp', 'HP'], ['atk', 'ATK'], ['mag', 'MAG'], ['def', 'DEF'], ['res', 'RES'], ['spd', 'SPD']];
    const cap = rez.MODEL ? rez.MODEL.STAT_CAP : 252;
    h += `<div class="rt-hdr">🔮 Resonance · ${total} / ${rez.MODEL ? rez.MODEL.TOTAL_CAP : 510}</div>`
      + STATS.map(([k, lbl]) => {
          const v = spread[k] | 0;
          return `<div class="rt-stat"><span>${lbl}</span>
            <span class="rt-track"><span class="rt-fillm" style="width:${clamp(v / cap * 100, 0, 100)}%"></span></span>
            <b>${v}</b></div>`;
        }).join('')
      + `<div class="rt-note" style="margin-top:.3rem">Trained in the Bunkhouse. The ceiling is the same for everyone.</div>`;
  }

  // ── values + conviction ────────────────────────────────────────────────
  // Conviction is the visible consequence of every praise and scold, so it is
  // shown ON the pole it belongs to rather than as its own number somewhere.
  const vp = (b.valueProfile(card) || []);
  if (vp.length) {
    h += `<div class="rt-hdr">🎭 What They Believe</div>`;
    if (!known) {
      h += vp.map(() => `<span class="rt-chip" style="border:1px solid #8a7f9a55;background:#8a7f9a18;color:#8a7f9a">🎭 ? ? ?</span>`).join('')
        + `<div class="rt-note">Bond to Steady to learn what this companion values.</div>`;
    } else {
      h += vp.map(e => {
        const cv = J.convictionOf(prof, e.pole);
        const arrow = cv > 0 ? ` ▲${cv}` : cv < 0 ? ` ▼${Math.abs(cv)}` : '';
        const col = cv > 0 ? '#ffd166' : cv < 0 ? '#8fa2c4' : '#d4af37';
        return `<span class="rt-chip" title="${esc(b.poleDesc(e.pole) || '')}"
          style="border:1px solid ${col}55;background:${col}18;color:${col}">${esc(b.poleLabel(e.pole) || e.pole)}${arrow}</span>`;
      }).join('')
      + `<div class="rt-note">▲ hardened by praise · ▼ softened by rebuke — this is how sharply they react in the field.</div>`;
    }
  }
  h += `</div></div>`;   // /rt-sheet /rt-top

  // ── shared history ─────────────────────────────────────────────────────
  const mems = Array.isArray(prof.memories) ? prof.memories.slice().reverse() : [];
  h += `<div class="rt-deck"><div class="rt-hdr">📖 Shared History${prof.together ? ' · ' + (prof.together | 0) + ' battle' + ((prof.together | 0) === 1 ? '' : 's') : ''}</div>`;
  if (!mems.length) {
    h += `<div class="rt-note">Nothing between you yet. Fight alongside them.</div>`;
  } else {
    const KIND = b.memoryKinds() || {};
    h += mems.slice(0, 10).map(m => {
      const k = KIND[m.k]; if (!k) return '';
      const n = (m.n | 0) > 1 ? ` <span class="rt-x">×${m.n | 0}</span>` : '';
      return `<div class="rt-mem">${k.icon} ${esc(k.text)}${n}${m.d ? ` <span class="rt-x">(${esc(m.d)})</span>` : ''}</div>`;
    }).join('');
  }
  h += `</div>`;

  // ── bound items ────────────────────────────────────────────────────────
  const items = Array.isArray(prof.boundItems) ? prof.boundItems : [];
  if (items.length) {
    h += `<div class="rt-deck"><div class="rt-hdr">🎁 Given To Them</div>`
      + items.map(id => `<span class="rt-chip" style="border:1px solid #d4af3755;background:#d4af3718;color:#e8c46a">🎁 ${esc(b.itemName(id))}</span>`).join('')
      + `<div class="rt-note">Things they asked for, and you found.</div></div>`;
  }

  // ── rapport ────────────────────────────────────────────────────────────
  const partners = b.rapportPartners(cardId) || [];
  if (partners.length) {
    h += `<div class="rt-deck"><div class="rt-hdr">🤝 Fights Best Beside</div>`
      + partners.slice(0, 6).map(pid => {
          const pc = b.card(pid);
          return `<span class="rt-chip" title="Rapport ${b.rapportWith(cardId, pid)} / ${b.rapportMax()}"
            style="border:1px solid #7fd8a055;background:#7fd8a018;color:#7fd8a0">🤝 ${esc((pc && pc.name) || pid)}</span>`;
        }).join('')
      + `<div class="rt-note">Deployed together, each gains +${b.rapportBonus().atk} ATK / +${b.rapportBonus().def} DEF.</div></div>`;
  }

  // ── the deck, fanned ───────────────────────────────────────────────────
  const decks = decksWith(cardId);
  h += `<div class="rt-deck"><div class="rt-hdr">🃏 ${decks.length ? esc(decks[0].name || 'Their Deck') : 'No Deck'}</div>`;
  if (!decks.length) {
    h += `<div class="rt-note">Not in any deck. They are sitting this campaign out.</div>`;
  } else {
    const d = decks[0];
    h += `<div class="rt-fan">` + d.cards.slice(0, 24).map(k => {
      const c = b.resolveDeckCard(k);
      const isMe = b.deckKeyCardId(k) === cardId;
      return `<div class="rt-fc${isMe ? ' me' : ''}" title="${esc((c && c.name) || k)}">
        <div class="rt-fi">${c ? b.spriteThumb('u_' + (c.id || ''), c.icon || '🃏') : '🃏'}</div>
        <div class="rt-fn">${esc(((c && c.name) || k).slice(0, 22))}</div></div>`;
    }).join('') + `</div>`;
    if (decks.length > 1) h += `<div class="rt-note" style="margin-top:.5rem">…and ${decks.length - 1} other deck${decks.length === 2 ? '' : 's'}.</div>`;
  }
  h += `</div>`;

  return h;
}

/* ── the judgement strip ────────────────────────────────────────────────────
   Only rendered when the unit has something QUEUED to be judged (`_banter`).
   Deliberately not a permanent "praise this unit" button: praise you can press
   at will is a loyalty faucet, and the whole value of the verb is that it is a
   reply to something the companion actually said. */
function judgeStripHtml(cardId) {
  const b = B(); const prof = b.unitProf(cardId) || {};
  const ban = prof._banter;
  if (!ban) return '';
  const pool = (b.banterLines(ban.pole, ban.verdict)) || [];
  if (!pool.length) return '';
  const line = pool[((b.battleCount() | 0) + (prof.fielded | 0)) % pool.length];
  const L = J.labels(ban.verdict);
  const oppose = ban.verdict === 'oppose';
  return `<div id="rt-judge">
    <div class="rt-hdr">💬 They Have Something To Say</div>
    <div class="rt-greet" style="border-left-color:${oppose ? '#e07a5f' : '#7fd8a0'};color:${oppose ? '#f2ccc0' : '#d8f0dc'}">“${esc(line)}”</div>
    <div class="rt-note" style="margin:.35rem 0 .7rem">${esc(b.poleLabel(ban.pole) || ban.pole)} · ${(ban.net > 0 ? '+' : '') + (ban.net | 0)} loyalty from that fight</div>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap">
      <button class="rt-btn warm" data-judge="praise">${esc(L.praise)}</button>
      <button class="rt-btn" data-judge="silence">${esc(L.silence)}</button>
      <button class="rt-btn cold" data-judge="scold">${esc(L.scold)}</button>
    </div></div>`;
}

function paint(host, cardId) {
  const b = B(); if (!b) return;
  host.innerHTML = `<div class="rt-table" id="rt-table">
      <div class="rt-grain"></div>
      <button class="rt-close" id="rt-x" title="Leave the table">✕</button>
      ${sheetHtml(cardId, judgeStripHtml(cardId))}
    </div>`;
  const prof = b.unitProf(cardId) || {};
  const tier = b.bondTier(prof.bond || 0);
  const t = host.querySelector('#rt-table');
  if (t) { t.style.setProperty('--rt-tier', tier.color); t.style.setProperty('--rt-lamp', tier.color + '26'); }
  const x = host.querySelector('#rt-x');
  if (x) x.onclick = () => close();
  host.querySelectorAll('[data-judge]').forEach(el => {
    el.onclick = () => { judge(cardId, el.dataset.judge); paint(host, cardId); };
  });
}

/** Apply one judgement. The ONLY write path on this screen besides the gift.
 *  Bond goes through the bridge's adjustBond — never by assignment — because
 *  the bond CEILING (sale count, first-owner Sworn) and the temperament
 *  multiplier both live in there, and writing `prof.bond = x` would walk
 *  straight through both. */
export function judge(cardId, choice) {
  const b = B(); if (!b) return null;
  const prof = b.unitProf(cardId); if (!prof || !prof._banter) return null;
  const ban = prof._banter;
  const temper = b.temper(cardId, prof) || { id: 'stoic' };
  const res = J.resolve({
    choice, verdict: ban.verdict, pole: ban.pole, temperId: temper.id,
    conviction: J.convictionOf(prof, ban.pole),
    seed: (b.battleCount() | 0) + (prof.fielded | 0) + (prof.bond | 0),
  });

  if (res.bond) b.adjustBond(prof, res.bond);
  if (res.grief) prof.grievance = Math.max(0, (prof.grievance | 0) + res.grief);
  if (res.conviction) {
    if (!prof.conviction || typeof prof.conviction !== 'object') prof.conviction = {};
    prof.conviction[ban.pole] = res.convictionNext;
  }
  /* 🔓 The refuseDeploy release. `< 12` is not a number invented here — it is
     the SAME threshold `_lqValuesEval` uses to clear the flag after a battle
     (index.html), quoted deliberately so a companion cannot be stuck in a
     state the battle loop would already have let it out of. Both replies to an
     aggrieved unit discharge grievance, so both can free it; overruling just
     discharges enough to do it in one press at a threshold-level grudge, while
     conceding takes longer and hardens the pole on the way. */
  if (prof.refuseDeploy && (prof.grievance | 0) < 12) { prof.refuseDeploy = false; prof.grievanceFlare = false; }

  // Tally, for the table's own record of how you have treated them.
  if (!prof.judged || typeof prof.judged !== 'object') prof.judged = {};
  prof.judged[res.choice] = (prof.judged[res.choice] | 0) + 1;
  prof.judged.last = Date.now();

  delete prof._banter;
  try { b.saveProfile(); } catch (e) {}

  const card = b.card(cardId) || { name: 'They' };
  const sign = res.bond > 0 ? '+' : '';
  const note = J.convictionNote(res, b.poleLabel(ban.pole) || 'That conviction');
  b.showToast(`${res.tone === 'warm' ? '💗' : res.tone === 'cold' ? '💔' : '🫥'} ${card.name}: “${res.line}” — ${sign}${res.bond} loyalty.${note ? ' ' + note : ''}`, 6000);
  return res;
}

/* ── mount ─────────────────────────────────────────────────────────────────
   A body-level overlay rather than a screen, for the same reason the Bunkhouse
   is one: the Camp screen mounts `#base-builder-frame`, a full-viewport iframe
   at z-index 2147483300, and anything appended to renderCamp()'s output sits
   UNDERNEATH the bunker the player is actually looking at. This sits above it. */
export function open(cardId) {
  const b = B(); if (!b || !b.Profile || !cardId) return false;
  ensureCss();
  close();
  const ov = document.createElement('div');
  ov.id = 'rt-ov';
  const wrap = document.createElement('div');
  wrap.className = 'rt-wrap';
  ov.appendChild(wrap);
  ov.addEventListener('click', (ev) => { if (ev.target === ov) close(); });
  document.body.appendChild(ov);
  paint(wrap, cardId);
  // Esc closes. Bound to the overlay's own lifetime so it cannot leak a
  // listener that swallows Esc for the rest of the session.
  ov._esc = (ev) => { if (ev.key === 'Escape') close(); };
  document.addEventListener('keydown', ov._esc);
  return true;
}

export function close() {
  const ov = document.getElementById('rt-ov');
  if (!ov) return;
  try { if (ov._esc) document.removeEventListener('keydown', ov._esc); } catch (e) {}
  ov.remove();
}
