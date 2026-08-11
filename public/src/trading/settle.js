/* ============================================================================
   ⚖ ATOMIC SETTLEMENT — the part that moves real player property.
   ============================================================================
   ONE transaction, in the only sense a client-side ledger can have one:
     1. CHECK EVERY LEG before touching anything.
     2. Move, remembering exactly what was moved.
     3. If ANY leg fails, unwind EVERY leg already taken, in reverse.
   A trade either happens completely or does not happen at all. There is no
   third outcome and no half-delivery.

   🔴 WHY THIS FILE EXISTS AT ALL — the addRes() trap.
   `addRes()` enforces the stash cap and, when the vault is full, calls a toast
   and RETURNS WITHOUT ADDING. That is correct for loot (you cannot carry what
   you have no room for) and CATASTROPHIC for a payout or a refund: this week
   it destroyed 215 units of a player's resources in exactly that way. The
   index.html ledger already carries the antidote, `_refundRes()` — an UNCAPPED
   put-back used by the cost system (see the long comment on _refundRes and
   _campSpendCost). This module follows that precedent exactly:
       • a REFUND (undoing a deduction this call stack just made) → refundRes
       • a GAIN (goods arriving from a trade)                     → addRes
   ...and because addRes can silently swallow a gain, every give-leg is
   VERIFIED after the fact by re-reading the balance. A short delivery is
   treated as a failed leg and rolls the whole trade back. Belt AND braces:
   the preflight should already have refused, but "should have" is how the
   215 units went missing.

   🔴 IF THE BUYER IS AT THE STASH CAP THE TRADE FAILS CLEANLY.
   Not a partial fill, not a clamped delivery, not "you got 40 of the 100".
   The preflight refuses before a single unit moves, so the failing case costs
   the buyer nothing at all.

   PURE + INJECTED IO. This module reads no globals (the `Profile`/`Cloud`/
   `App` top-level-const trap means it could not anyway) and imports nothing.
   Everything it touches arrives in `io`, which makes the atomicity claim
   DRIVEN rather than asserted: a test can hand in an io whose N-th call fails
   and then diff every real balance byte-for-byte.
   ============================================================================ */

/* A LEG is one movement of one kind of property.
     { dir: 'take'|'give', kind: 'res'|'cinder'|'aza'|'item'|'card', id?, n }
   `take` leaves the acting player; `give` arrives at the acting player.

   IO CONTRACT — every mutator returns TRUTHY on success and FALSY on refusal.
   That uniformity is what lets a driven test fail any single leg by wrapping
   one function, and it is why the bridge wrappers in index.html end in
   `return true` instead of returning undefined.
     readers  : getRes(id) · gems() · aza() · ownCount(kind,id)
                resourceCap() · resourceUnits()
     mutators : spendRes(id,n) · addRes(id,n) · refundRes(id,n)
                spendGems(n) · addGems(n) · spendAza(n) · addAza(n)
                takeOwned(kind,id,n) · giveOwned(kind,id,n) · save() */

export const OK = 'OK';

function _int(n) { const v = Math.floor(Number(n)); return isFinite(v) ? v : 0; }

function _fn(io, name) { return io && typeof io[name] === 'function' ? io[name] : null; }

/* Normalise + reject nonsense before anything else looks at the plan. */
export function normalizeLegs(legs) {
  const out = [];
  for (const raw of (legs || [])) {
    if (!raw) continue;
    const n = _int(raw.n);
    if (n <= 0) continue;                       // zero-legs are dropped, not "moved"
    const dir = raw.dir === 'give' ? 'give' : 'take';
    const kind = String(raw.kind || 'res');
    out.push({ dir, kind, id: raw.id || null, n, label: raw.label || '' });
  }
  // Takes ALWAYS execute before gives. Two reasons, both load-bearing:
  //  • the goods you hand over free stash space for the goods you receive, so
  //    a fair swap must not fail a cap check it would pass a millisecond later;
  //  • the leg most likely to fail (you cannot pay) is then the cheapest to
  //    unwind, because nothing has been delivered yet.
  out.sort((a, b) => (a.dir === b.dir ? 0 : (a.dir === 'take' ? -1 : 1)));
  return out;
}

/* ── PHASE 1 ────────────────────────────────────────────────────────────────
   Check everything. Returns { ok:true } or { ok:false, code, why }.
   Touches NOTHING. A false here means the player's balances are untouched. */
export function preflight(legs, io) {
  legs = normalizeLegs(legs);
  if (!legs.length) return { ok: false, code: 'EMPTY', why: 'Nothing to trade.' };

  const getRes    = _fn(io, 'getRes');
  const gems      = _fn(io, 'gems');
  const aza       = _fn(io, 'aza');
  const ownCount  = _fn(io, 'ownCount');
  const cap       = _fn(io, 'resourceCap');
  const units     = _fn(io, 'resourceUnits');

  // Aggregate demands per (kind,id) so two legs asking for the same purse
  // cannot each pass on their own and fail together.
  const need = new Map();
  let inRes = 0, outRes = 0;
  for (const l of legs) {
    if (l.dir === 'take') {
      const key = l.kind + '::' + (l.id || '');
      need.set(key, (need.get(key) || 0) + l.n);
      if (l.kind === 'res') outRes += l.n;
    } else if (l.kind === 'res') {
      inRes += l.n;
    }
  }
  for (const [key, n] of need) {
    const [kind, id] = key.split('::');
    let have = 0;
    if (kind === 'res')          have = getRes   ? _int(getRes(id))          : -1;
    else if (kind === 'cinder')  have = gems     ? _int(gems())              : -1;
    else if (kind === 'aza')     have = aza      ? _int(aza())               : -1;
    else if (kind === 'item' || kind === 'card') have = ownCount ? _int(ownCount(kind, id)) : -1;
    else return { ok: false, code: 'BAD_KIND', why: `Unknown property type "${kind}".` };
    if (have < 0) return { ok: false, code: 'NO_IO', why: 'The ledger is unavailable — nothing was moved.' };
    if (have < n) return { ok: false, code: 'SHORT', why: `You need ${n.toLocaleString()} and have ${have.toLocaleString()}.`, kind, id, need: n, have };
  }

  /* 🏰 THE STASH CAP CHECK — the one that makes "fail cleanly" true.
     Headroom is measured AFTER the outgoing resources leave, because takes run
     first. A swap of 100 wood for 100 metal therefore needs zero net space and
     succeeds at a completely full stash; a purchase of 100 metal for Cinder at
     a full stash is refused outright, before a single Cinder is charged. */
  if (inRes > 0) {
    if (!cap || !units) return { ok: false, code: 'NO_IO', why: 'The stash ledger is unavailable — nothing was moved.' };
    const capacity = _int(cap());
    const held     = _int(units());
    const headroom = capacity - held + outRes;
    if (inRes > headroom) {
      return {
        ok: false, code: 'STASH_FULL',
        why: `Your stash cannot hold this — ${inRes.toLocaleString()} units are coming in and only ${Math.max(0, headroom).toLocaleString()} fit. Nothing was moved.`,
        incoming: inRes, headroom: Math.max(0, headroom), capacity, held,
      };
    }
  }
  return { ok: true, code: OK, why: '', legs };
}

/* ── PHASES 2+3 ─────────────────────────────────────────────────────────────
   Execute, and unwind completely on any failure.
   Returns { ok, code, why, moved:[legs], rolledBack, failedLeg }. */
export function settle(legs, io) {
  const pre = preflight(legs, io);
  if (!pre.ok) return { ok: false, code: pre.code, why: pre.why, moved: [], rolledBack: false, failedLeg: -1, detail: pre };
  const plan = pre.legs;

  const getRes    = _fn(io, 'getRes');
  const spendRes  = _fn(io, 'spendRes');
  const addRes    = _fn(io, 'addRes');
  const refundRes = _fn(io, 'refundRes');
  const spendGems = _fn(io, 'spendGems');
  const addGems   = _fn(io, 'addGems');
  const spendAza  = _fn(io, 'spendAza');
  const addAza    = _fn(io, 'addAza');
  const takeOwned = _fn(io, 'takeOwned');
  const giveOwned = _fn(io, 'giveOwned');
  const save      = _fn(io, 'save');

  const done = [];
  let failedLeg = -1, why = '', code = '';

  /* 🔴 UNWIND. Reverse order, so the ledger retraces exactly the steps it took
     (the _campSpendCost precedent). Refunds of a TAKE go through refundRes,
     never addRes — see the header. Undoing a GIVE removes units that arrived
     moments ago, so the ordinary capped spend path is correct there. */
  const rollback = () => {
    for (let i = done.length - 1; i >= 0; i--) {
      const l = done[i];
      try {
        if (l.dir === 'take') {
          if (l.kind === 'res')          { if (refundRes) refundRes(l.id, l.n); }
          else if (l.kind === 'cinder')  { if (addGems)   addGems(l.n); }
          else if (l.kind === 'aza')     { if (addAza)    addAza(l.n); }
          else                           { if (giveOwned) giveOwned(l.kind, l.id, l.n); }
        } else {
          if (l.kind === 'res')          { if (spendRes)  spendRes(l.id, l.n); }
          else if (l.kind === 'cinder')  { if (spendGems) spendGems(l.n); }
          else if (l.kind === 'aza')     { if (spendAza)  spendAza(l.n); }
          else                           { if (takeOwned) takeOwned(l.kind, l.id, l.n); }
        }
      } catch (e) { /* an unwind must never throw past this point */ }
    }
    done.length = 0;
  };

  for (let i = 0; i < plan.length; i++) {
    const l = plan[i];
    let ok = false;
    try {
      if (l.dir === 'take') {
        if (l.kind === 'res')          ok = !!(spendRes  && spendRes(l.id, l.n));
        else if (l.kind === 'cinder')  ok = !!(spendGems && spendGems(l.n));
        else if (l.kind === 'aza')     ok = !!(spendAza  && spendAza(l.n));
        else                           ok = !!(takeOwned && takeOwned(l.kind, l.id, l.n));
      } else {
        if (l.kind === 'res') {
          /* 🔴 VERIFIED DELIVERY. addRes() can clamp to the stash cap and
             return having added nothing — silently. The preflight has already
             refused that case, but this re-read is what turns "should not
             happen" into "cannot happen unnoticed": a short delivery becomes a
             failed leg and the whole trade unwinds. */
          const before = getRes ? _int(getRes(l.id)) : null;
          if (addRes) addRes(l.id, l.n);
          const after = getRes ? _int(getRes(l.id)) : null;
          ok = (before == null || after == null) ? !!addRes : ((after - before) === l.n);
          if (!ok && before != null && after != null && after > before) {
            // Partially landed. Take the fragment straight back out so the
            // rollback below starts from a known state.
            try { if (spendRes) spendRes(l.id, after - before); } catch (e) {}
          }
          if (!ok) { code = 'SHORT_DELIVERY'; why = 'Your stash filled up mid-trade — the trade was cancelled and everything returned.'; }
        }
        else if (l.kind === 'cinder')  ok = !!(addGems   && addGems(l.n));
        else if (l.kind === 'aza')     ok = !!(addAza    && addAza(l.n));
        else                           ok = !!(giveOwned && giveOwned(l.kind, l.id, l.n));
      }
    } catch (e) {
      ok = false; code = code || 'THREW'; why = why || ('The ledger refused the move: ' + (e && e.message ? e.message : e));
    }
    if (!ok) {
      failedLeg = i;
      code = code || 'LEG_FAILED';
      why = why || `The ${l.dir === 'take' ? 'payment' : 'delivery'} leg failed — nothing was traded.`;
      rollback();
      if (save) { try { save(); } catch (e) {} }
      return { ok: false, code, why, moved: [], rolledBack: true, failedLeg, plan };
    }
    done.push(l);
  }

  if (save) { try { save(); } catch (e) {} }
  return { ok: true, code: OK, why: '', moved: done.slice(), rolledBack: false, failedLeg: -1, plan };
}

/* ── PLAN BUILDERS ──────────────────────────────────────────────────────────
   Turn a listing row + a lot count into legs, from the BUYER's point of view.
   Kept here so the exchange never hand-rolls a leg list at a call site. */
export function buyerLegs({ resource, lotSize, lots, currency, pricePerLot, wantRes, wantQtyPerLot, wantKind, wantId }) {
  const n = Math.max(0, Math.floor(Number(lots) || 0));
  const legs = [];
  const cur = currency || 'cinders';
  if (cur === 'trade')       legs.push({ dir: 'take', kind: 'res',    id: wantRes, n: Math.max(0, Math.floor(Number(wantQtyPerLot) || 0)) * n });
  else if (cur === 'barter') legs.push({ dir: 'take', kind: (wantKind === 'card' ? 'card' : 'item'), id: wantId, n: n });
  else if (cur === 'aza')    legs.push({ dir: 'take', kind: 'aza',    n: Math.max(0, Math.floor(Number(pricePerLot) || 0)) * n });
  else                       legs.push({ dir: 'take', kind: 'cinder', n: Math.max(0, Math.floor(Number(pricePerLot) || 0)) * n });
  legs.push({ dir: 'give', kind: 'res', id: resource, n: Math.max(0, Math.floor(Number(lotSize) || 0)) * n });
  return legs;
}

/* The SELLER's escrow legs: goods leave the stash the moment the listing is
   created, never when it sells. Nothing else in this file knows about
   listings, so the same settle() proves escrow atomic too. */
export function escrowLegs({ resource, lotSize, lots }) {
  return [{ dir: 'take', kind: 'res', id: resource, n: Math.max(0, Math.floor(Number(lotSize) || 0)) * Math.max(0, Math.floor(Number(lots) || 0)) }];
}

export default { settle, preflight, normalizeLegs, buyerLegs, escrowLegs, OK };
