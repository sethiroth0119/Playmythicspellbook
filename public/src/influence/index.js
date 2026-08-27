/* ============================================================================
   🎖 INFLUENCE — the wiring. Registers `window.MythicInfluence`.
   ============================================================================
   WHAT THIS IS. A standing track for a player and their camp. Envoys arrive on
   their own; each carries Cinder, a card, a survivor asking to join, or a
   resource convoy. What they carry follows three things the player already has:
   their node tier, their Influence level, and their Foundation Reserve rep.

   ── TWO PATHS, AND THE DIFFERENCE IS THE WALLET ────────────────────────────
   SERVER (sql/038 applied, player signed in) — the real one. The server owns
   the clock, the RNG, the level, the standing and every amount; Cinder is
   credited to the canonical wallet before the reply is even sent. The client
   asks, renders, and applies the non-monetary half.

   LOCAL (signed out, offline, or sql/038 not yet applied) — a degraded envoy
   that hands out cards and resources but NEVER Cinder. That asymmetry is the
   whole point: cards and resources are ordinary client-held progression, the
   same trust boundary loot already sits on, while Cinder is cashable-out money
   and there is nothing offline that can name an amount except the browser —
   which is exactly the hole sql/038 was written to close.

   🔴 NEVER addGems() ON THE SERVER PATH. influence_resolve() has already
   credited the wallet by the time it returns. Crediting again here would pay
   one envoy twice — once for real and once into the profile mirror that later
   reconciles UP. `balance` in the reply is the canonical post-credit figure and
   the only correct use of it is to raise the local display to match.

   🔴 THE GLOBALS TRAP (CLAUDE.md, and it has cost real time three times now).
   `Profile`, `Cloud`, `Forge`, `FoundationReserve`, `addGems`, `addRes` are
   top-level `const`/function declarations in index.html — LEXICAL globals, not
   properties of window. Nothing here reaches for one; everything arrives
   through `window.MythicInfluenceBridge`.
   ============================================================================ */

import * as M from './model.js';
import * as E from './envoys.js';
import * as R from './render.js';
import * as S from './server.js';

const B = () => { try { return (typeof window !== 'undefined' ? window.MythicInfluenceBridge : null) || null; } catch (e) { return null; } };

function warnOnce(msg) {
  if (warnOnce._done) return; warnOnce._done = true;
  try { console.warn('[influence] ' + msg); } catch (e) {}
}

/* ── Local state ────────────────────────────────────────────────────────────
   `Profile.influence` is two things at once, deliberately:
     • the LEDGER for the local path (xp, lastAt, hosted, pending), and
     • a MIRROR of the server's numbers, so the CAMP STATUS bar — which renders
       synchronously, many times a screen — can print a level and a waiting
       count without an await.
   The mirror is never authoritative. Opening the modal always asks the server. */
function state() {
  const b = B();
  try {
    const s = b && typeof b.state === 'function' ? b.state() : null;
    if (!s) return { xp: 0, lastAt: 0, hosted: 0, pending: null };
    if (typeof s.xp !== 'number') s.xp = 0;
    if (typeof s.lastAt !== 'number') s.lastAt = 0;
    if (typeof s.hosted !== 'number') s.hosted = 0;
    return s;
  } catch (e) { return { xp: 0, lastAt: 0, hosted: 0, pending: null }; }
}
function save() { const b = B(); try { if (b && b.save) b.save(); } catch (e) {} }

let _mode = 'unknown';        // 'server' | 'local' | 'unknown'
let _enc = null;              // the encounter on screen (hydrated, display shape)
let _result = null;           // the outcome being shown
let _busy = false;            // an RPC is in flight — buttons must not double-fire

/* ── Inputs (local path + display) ──────────────────────────────────────────
   On the server path these are recomputed server-side from tables the player
   cannot write; these readers exist for the offline envoy and for the meters. */
function repPoints() { const b = B(); try { return Math.max(0, (b && b.repPoints ? b.repPoints() : 0) | 0); } catch (e) { return 0; } }
function repRank() {
  const b = B();
  try { return (b && b.repRank ? b.repRank() : null) || { name: 'Resource Runner', icon: '🎒', index: 0 }; }
  catch (e) { return { name: 'Resource Runner', icon: '🎒', index: 0 }; }
}
function nodeTier() {
  const b = B();
  try { return (b && b.nodeTier ? b.nodeTier() : null) || { id: 'free', name: 'Free', rate: 0.5, rankIndex: 0, rankCount: 7 }; }
  catch (e) { return { id: 'free', name: 'Free', rate: 0.5, rankIndex: 0, rankCount: 7 }; }
}

export function level() {
  const s = state();
  // The server's level wins whenever we have mirrored one.
  if (s.srvLevel > 0) return s.srvLevel | 0;
  return M.effectiveLevel(s.xp, repRank().index | 0);
}
export function standing() {
  const s = state();
  if (typeof s.srvStanding === 'number') return Math.max(0, Math.min(1, s.srvStanding));
  const nt = nodeTier();
  return M.standing({
    nodeRankIndex: nt.rankIndex | 0, nodeRankCount: nt.rankCount | 0,
    level: level(), repPoints: repPoints(),
  });
}

/* Envoys waiting, projected from whichever clock we last heard from.
   On the server path we hold `srvNextAt` (an absolute local timestamp derived
   from next_seconds) and project forward from it. That projection is display
   only — influence_claim() re-decides on the server clock, so a wrong guess
   here costs a hopeful button, never a payout. */
export function ready() {
  const s = state();
  if (_mode === 'server' && typeof s.srvReady === 'number') {
    const base = Math.max(0, s.srvReady | 0);
    if (!s.srvNextAt) return Math.min(M.ENVOY_BANK_CAP, base);
    const now = Date.now();
    if (now < s.srvNextAt) return Math.min(M.ENVOY_BANK_CAP, base);
    const extra = 1 + Math.floor((now - s.srvNextAt) / M.ENVOY_INTERVAL_MS);
    return Math.min(M.ENVOY_BANK_CAP, base + extra);
  }
  return M.envoysReady(s.lastAt, Date.now(), M.ENVOY_INTERVAL_MS, M.ENVOY_BANK_CAP);
}

function nextMs() {
  const s = state();
  if (_mode === 'server' && s.srvNextAt) {
    const now = Date.now();
    if (now < s.srvNextAt) return s.srvNextAt - now;
    const since = now - s.srvNextAt;
    return M.ENVOY_INTERVAL_MS - (since % M.ENVOY_INTERVAL_MS);
  }
  return M.msToNextEnvoy(s.lastAt, Date.now(), M.ENVOY_INTERVAL_MS);
}

/* The synchronous one-liner the CAMP STATUS bar prints. Never awaits. */
export function status() {
  const s = state();
  const lv = level();
  return {
    level: lv,
    name: M.levelMeta(lv).name,
    icon: M.levelMeta(lv).icon,
    xp: (s.srvLevel > 0 ? (s.srvXp | 0) : (s.xp | 0)),
    waiting: (ready() | 0) + (_enc ? 1 : (s.pending ? 1 : 0)),
    nextMs: nextMs(),
    standing: standing(),
    hosted: s.hosted | 0,
    mode: _mode,
  };
}

/* ── ctx ────────────────────────────────────────────────────────────────────
   Shared by the local roller and the server hydrator. Thin on purpose so a
   driven test can replace ONE entry and prove a payout against real balances. */
function ctx(extra) {
  const b = B();
  const base = {
    level: level(),
    standing: standing(),
    rng: Math.random,
    cardPool: () => { try { return (b && b.cardPool ? b.cardPool() : []) || []; } catch (e) { return []; } },
    cardMarketValue: (c) => { try { return (b && b.cardMarketValue ? b.cardMarketValue(c) : 0) | 0; } catch (e) { return 0; } },
    ownedCount: (id) => { try { return (b && b.ownedCount ? b.ownedCount(id) : 0) | 0; } catch (e) { return 0; } },
    grantCard: (id) => { try { return !!(b && b.grantCard && b.grantCard(id)); } catch (e) { return false; } },
    addCinder: (n) => { try { return !!(b && b.addGems && b.addGems(n | 0, 'influence_envoy')); } catch (e) { return false; } },
    resources: () => { try { return (b && b.resources ? b.resources() : []) || []; } catch (e) { return []; } },
    addRes: (id, q) => { try { if (b && b.addRes) b.addRes(id, q | 0); } catch (e) {} },
    resourceHeadroom: () => {
      try { return (b && b.resourceHeadroom ? b.resourceHeadroom() : null) || { cap: 0, units: 0, free: Infinity }; }
      catch (e) { return { cap: 0, units: 0, free: Infinity }; }
    },
    save,
  };
  return Object.assign(base, extra || {});
}

/* Only what the modal draws and a resolution needs. A whole custom card carries
   art blobs, and this object rides the profile blob that uploads on every save. */
function compactCard(card) {
  if (!card) return null;
  return {
    id: card.id, name: card.name, type: card.type || 'unit',
    rarity: String(card.rarity || 'common').toLowerCase(),
    cost: card.cost | 0, icon: card.icon || card.emoji || '',
    stats: card.stats ? { hp: card.stats.hp | 0, atk: card.stats.atk | 0, def: card.stats.def | 0, spd: card.stats.spd | 0 } : null,
    text: card.text ? String(card.text).slice(0, 160) : '',
  };
}
function compactEnc(enc) {
  if (!enc) return null;
  const c = Object.assign({}, enc);
  if (c.card) c.card = compactCard(c.card);
  return c;
}

/* Mirror the server's numbers so the camp bar can read them synchronously. */
function mirror(d) {
  if (!d) return;
  const s = state();
  if (d.level != null) s.srvLevel = d.level | 0;
  if (d.xp != null) s.srvXp = d.xp | 0;
  if (d.standing != null) s.srvStanding = Number(d.standing) || 0;
  if (d.hosted != null) s.hosted = d.hosted | 0;
  if (d.ready != null) s.srvReady = d.ready | 0;
  if (d.next_seconds != null) s.srvNextAt = Date.now() + Math.max(0, (d.next_seconds | 0)) * 1000;
  save();
}

/* Ask the server where things stand, and repaint the camp bar if it moved.
   Fire-and-forget: a failure just leaves the mirror as it was. */
export async function refresh() {
  const b = B();
  if (!b) return false;
  const d = await S.peek(b);
  if (d && d.ok) {
    _mode = 'server';
    mirror(d);
    try { if (b.render) b.render(); } catch (e) {}
    return true;
  }
  if (d && d.offline) _mode = 'local';
  return false;
}

/* ── Dealing ────────────────────────────────────────────────────────────────
   Server first, always. The local roller only runs when the server could not
   be reached at all — never merely because it said "no envoy yet". */
async function deal() {
  const b = B();
  const d = await S.claim(b);

  if (d && d.ok && d.encounter) {
    _mode = 'server';
    mirror(d);
    const enc = E.fromServer(d.encounter, ctx());
    if (enc) {
      _enc = enc;
      // Cached for display only, so closing and reopening shows the same
      // visitor without a round trip. The SERVER holds the real pending row.
      const s = state(); s.pending = compactEnc(enc); save();
      return enc;
    }
    /* 🔴 THE SERVER DEALT A CARD ENCOUNTER AND THIS CLIENT HAS NO CARD TO SHOW.
       Real and not rare: `Forge.useCustomOnlyPool` skips the whole built-in
       catalogue, and getAllCustomCards() is empty until the catalog fetch lands
       — so a signed-out or still-booting client has a pool of ZERO. A browser
       run caught it: ~half of all envoys are gift or recruit.

       This used to silently `decline` server-side and return null, which painted
       "No one is at the gate". The envoy was spent, the player saw nothing, and
       there was nothing to tell them why. Never do that — an envoy the player
       never saw must not be consumed on their behalf.

       So: leave the server row PENDING (it resumes the moment a catalogue
       exists) and show the visitor as unreceivable, with the decision left to
       the player. Closing keeps them waiting; declining is an explicit choice.
       That is also why this cannot simply block forever — a player whose pool
       is permanently empty still has a way to clear the gate. */
    _enc = {
      kind: 'unavailable', srvKind: d.encounter.kind,
      rarity: String(d.encounter.rarity || '').toLowerCase(),
      level: (d.encounter.level | 0) || 1, standing: Number(d.encounter.standing) || 0,
      envoy: { name: 'A courier', title: (d.encounter.kind === 'recruit' ? 'Unaffiliated Survivor' : 'Archive Runner'),
               line: 'I have something for you, but you have nowhere to put it yet.' },
    };
    const s2 = state(); s2.pending = compactEnc(_enc); save();
    return _enc;
  }

  if (d && d.ok === false && !d.offline) {
    // A real server answer: no envoy is due. Do NOT fall through to the local
    // roller — that would deal one anyway and make the 48h clock advisory.
    _mode = 'server';
    if (d.next_seconds != null) { const s = state(); s.srvReady = 0; s.srvNextAt = Date.now() + (d.next_seconds | 0) * 1000; save(); }
    _enc = null;
    return null;
  }

  // Unreachable → the offline envoy. No Cinder; see the header.
  _mode = 'local';
  const s = state();

  /* 🔴 RESUME BEFORE ROLLING. On the server path the pending row lives on the
     server and influence_claim() hands it back; offline, the ONLY copy is the
     one persisted here, so it has to be read back into memory or closing and
     reopening the modal loses the visitor outright — the envoy already spent
     from the clock, and nothing to show for it. Worse, it is the anti-reroll
     guarantee: without this a player closes and reopens until the rarity table
     gives them something better.
     A driven test caught this: the old assertion only checked the persisted
     mirror, which was still correct, while the modal itself had gone blank. */
  if (s.pending) { _enc = s.pending; return _enc; }

  if (M.envoysReady(s.lastAt, Date.now(), M.ENVOY_INTERVAL_MS, M.ENVOY_BANK_CAP) <= 0) { _enc = null; return null; }
  const enc = E.rollEncounter(ctx({ allowCinder: false }));
  /* ⚠ ROLL FIRST, SPEND SECOND. The clock used to advance before this check, so
     a client that could produce no encounter at all — empty card pool, no
     resource accessors — burned an envoy to show "No one is at the gate".
     Nothing was dealt, so nothing is spent. */
  if (!enc) { s.pending = null; save(); _enc = null; return null; }
  s.lastAt = M.consumeStamp(s.lastAt || Date.now(), Date.now(), M.ENVOY_INTERVAL_MS, M.ENVOY_BANK_CAP);
  _enc = enc;
  s.pending = compactEnc(enc);
  save();
  return enc;
}

function view() {
  const s = state();
  const lv = level();
  const nt = nodeTier();
  const b = B();
  return {
    level: lv,
    levelMeta: M.levelMeta(lv),
    progress: M.levelProgress(s.srvLevel > 0 ? (s.srvXp | 0) : (s.xp | 0), repRank().index | 0),
    standing: standing(),
    parts: M.standingParts({ nodeRankIndex: nt.rankIndex | 0, nodeRankCount: nt.rankCount | 0, level: lv, repPoints: repPoints() }),
    nodeTier: nt,
    repRank: repRank(),
    repPoints: repPoints(),
    ready: ready(),
    nextMs: nextMs(),
    mode: _mode,
    busy: _busy,
    enc: (_result && _result.enc) || _enc || null,
    result: _result,
    rarityMeta: (id) => { try { return b && b.rarityMeta ? b.rarityMeta(id) : null; } catch (e) { return null; } },
    cardArt: (id) => { try { return b && b.cardArt ? b.cardArt(id) : null; } catch (e) { return null; } },
  };
}

function draw() { R.mount(view(), handlers); }

/* Bank the outcome and show it. One funnel, so no path can forget to clear the
   encounter and leave a visitor who can be resolved twice. */
function settle(res, enc) {
  const s = state();
  if (_mode !== 'server') {
    // The local path keeps its own ledger; the server path is told by the RPC.
    s.xp = Math.max(0, (s.xp | 0) + ((res && res.xp) | 0));
  }
  s.hosted = (s.hosted | 0) + 1;
  s.pending = null;
  save();
  _enc = null;
  _result = res ? Object.assign({}, res, { enc: enc }) : null;
  const b = B();
  try { if (res && res.toast && b && b.toast) b.toast(res.toast, res.refused ? 6000 : 4200); } catch (e) {}
  try { if (b && b.render) b.render(); } catch (e) {}
  draw();
}

/* ── Server-path resolution ─────────────────────────────────────────────────
   The RPC decides and pays; this applies the half that lives on the client and
   translates the reply into the same {ok, xp, toast, dialog} shape the local
   resolvers return, so the renderer needs to know nothing about which path ran. */
async function resolveServer(choice) {
  const b = B();
  const enc = _enc;
  if (!enc) return;
  const head = enc.kind === 'supply' ? (enc.space || E.spaceFor(ctx(), enc.total)) : null;
  const d = await S.resolve(b, choice, {
    cardId: enc.card ? enc.card.id : null,
    salePrice: choice === 'sell' ? (enc.value | 0) : 0,
    freeSpace: head ? head.free : null,
  });

  if (!d || d.ok !== true) {
    /* The envoy is NOT consumed locally on a failed call — the server row still
       holds it, so reopening resumes rather than losing it. */
    const why = (d && (d.error || (d.offline ? 'offline' : ''))) || 'failed';
    try { if (b && b.toast) b.toast('⚠ The envoy could not be settled (' + why + '). They are still waiting.', 5200); } catch (e) {}
    _busy = false; draw();
    return;
  }

  mirror({ level: d.level, xp: d.xp_total });
  const s = state();
  if (d.level != null) s.srvLevel = d.level | 0;
  s.srvXp = Math.max(0, (s.srvXp | 0) + ((d.xp | 0)));
  save();

  // 💰 The wallet already moved server-side. Raise the local display to match;
  //    never credit again. See the header.
  if ((d.cinder | 0) > 0 && d.balance != null) {
    try { if (b && b.syncCinder) b.syncCinder(d.balance | 0); } catch (e) {}
  }

  let res;
  if (choice === 'decline') {
    res = { ok: true, xp: d.xp | 0, toast: '🚪 You sent them on their way.' };
  } else if (enc.kind === 'cinder') {
    res = { ok: true, xp: d.xp | 0, cinder: d.cinder | 0,
            toast: '🔥 +' + (d.cinder | 0).toLocaleString() + ' Cinder from ' + enc.envoy.name + '.' };
  } else if (enc.kind === 'gift') {
    const got = ctx().grantCard(enc.card.id);
    res = got ? { ok: true, xp: d.xp | 0, toast: '🃏 ' + (enc.card.name || 'A card') + ' added to your collection.' }
              : { ok: false, xp: d.xp | 0, toast: '⚠ That card could not be added to your collection.' };
  } else if (enc.kind === 'recruit' && choice === 'accept') {
    const got = ctx().grantCard(enc.card.id);
    res = { ok: !!got, xp: d.xp | 0, dialog: 'Then I am yours. Point me at something.',
            toast: got ? '🤝 ' + (enc.card.name || 'A survivor') + ' joined your camp.'
                       : '⚠ They could not be added to your collection.' };
  } else if (enc.kind === 'recruit' && choice === 'sell') {
    res = { ok: true, xp: d.xp | 0, cinder: d.cinder | 0, dialog: 'Fair enough. Somebody else will want me.',
            toast: '🔥 +' + (d.cinder | 0).toLocaleString() + ' Cinder — ' + (enc.card.name || 'the recruit') + ' signed elsewhere.' };
  } else {
    // supply — the SERVER decided whether there was room, from the headroom we
    // reported. Applying the grants only when it says so keeps one decision.
    if (d.refused) {
      res = { ok: false, refused: true, xp: d.xp | 0, dialog: E.NO_SPACE_LINE,
              toast: '📦 The convoy moved on — your stash is full (' +
                     ((head && head.free === Infinity) ? '∞' : ((head && head.free) | 0).toLocaleString()) +
                     ' free, ' + (d.needed | 0).toLocaleString() + ' needed).' };
    } else {
      const c = ctx();
      for (const g of (enc.grants || [])) c.addRes(g.id, g.qty | 0);
      save();
      res = { ok: true, xp: d.xp | 0, delivered: d.needed | 0, dialog: 'Unloaded. Sign here.',
              toast: '📦 ' + (enc.grants || []).map((g) => g.icon + ' ' + g.qty.toLocaleString()).join('  ') + ' delivered.' };
    }
  }
  _busy = false;
  settle(res, enc);
}

/* One guard for every button: an in-flight RPC must not be double-fired, and a
   double click must not resolve two envoys. */
function act(fn) {
  return () => {
    if (_busy) return;
    const enc = _enc;
    if (!enc) return;
    _busy = true;
    draw();
    Promise.resolve().then(fn).catch((e) => {
      try { console.warn('[influence] resolve failed', e); } catch (e2) {}
      _busy = false; draw();
    });
  };
}

const handlers = {
  onClose: () => { _result = null; _busy = false; R.unmount(); const b = B(); try { if (b && b.render) b.render(); } catch (e) {} },
  onNext: () => { _result = null; _busy = true; draw(); deal().then(() => { _busy = false; draw(); }).catch(() => { _busy = false; draw(); }); },
  onTake: act(() => {
    const enc = _enc;
    if (_mode === 'server') return resolveServer('take');
    _busy = false;
    if (enc.kind === 'gift') return settle(E.resolveGift(ctx(), enc), enc);
    if (enc.kind === 'supply') return settle(E.resolveSupply(ctx(), enc), enc);
    return settle(E.resolveCinder(ctx(), enc), enc);
  }),
  onAccept: act(() => {
    const enc = _enc;
    if (_mode === 'server') return resolveServer('accept');
    _busy = false; return settle(E.acceptRecruit(ctx(), enc), enc);
  }),
  onSell: act(() => {
    const enc = _enc;
    if (_mode === 'server') return resolveServer('sell');
    _busy = false; return settle(E.sellRecruit(ctx(), enc), enc);
  }),
  onDecline: act(() => {
    const enc = _enc;
    if (_mode === 'server') return resolveServer('decline');
    _busy = false; return settle(E.dismiss(), enc);
  }),
  /* "Leave them waiting" on an unreceivable encounter: close WITHOUT resolving,
     so the server row keeps the envoy for a session that can actually show it. */
  onWait: () => { _result = null; _busy = false; R.unmount(); const b = B(); try { if (b && b.render) b.render(); } catch (e) {} },
};

export async function open() {
  if (!B()) { warnOnce('window.MythicInfluenceBridge is missing — index.html has not handed this module anything, so it stays inert.'); return false; }
  _result = null;
  _busy = true;
  R.injectStyles();
  draw();                       // paint immediately; the RPC fills it in
  try { await deal(); } catch (e) { try { console.warn('[influence] deal failed', e); } catch (e2) {} }
  _busy = false;
  draw();
  return true;
}

export function close() { handlers.onClose(); }

try {
  if (typeof window !== 'undefined') {
    window.MythicInfluence = {
      MODEL: M, ENVOYS: E, SERVER: S,
      open, close, status, level, standing, ready, refresh,
      isOpen: R.isOpen,
      formatEta: M.formatEta,
      NO_SPACE_LINE: E.NO_SPACE_LINE,
      mode: () => _mode,
    };
    /* Learn which path we are on shortly after boot, so the CAMP STATUS bar
       shows a real waiting count on first paint rather than a local guess.
       Deferred and fire-and-forget — it must never delay the game's start. */
    setTimeout(() => { try { refresh(); } catch (e) {} }, 2500);
  }
} catch (e) {}
