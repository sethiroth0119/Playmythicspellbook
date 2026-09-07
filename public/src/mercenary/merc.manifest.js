/* ═══════════════════════════════════════════════════════════════════════════
   merc.manifest.js — what a contract ASKS FOR, and whether it can be paid.

   Pure maths and pure validation. No Supabase, no DOM, no globals: everything
   it needs about the player arrives as the `ctx` object built in index.js.
   That is what makes the escrow arithmetic testable against real balances
   rather than against a mock.

   A MANIFEST is an array of lines:
       { kind: 'res' | 'card', id, name, qty }
   `res` ids are Forge resource ids (including admin-authored custom ones);
   `card` ids are custom card ids from the Forge / published catalog.
   ═══════════════════════════════════════════════════════════════════════════ */

export const MAX_LINES  = 12;         // mirrors merc_manifest_ok() in sql/038
export const MAX_QTY    = 999999;
export const MAX_REWARD = 2000000;    // mirrors wallet_credit's c_max_single

/* ── SHAPE ───────────────────────────────────────────────────────────────── */

export function cleanLine(line) {
  if (!line || typeof line !== 'object') return null;
  const kind = (line.kind === 'card') ? 'card' : (line.kind === 'res' ? 'res' : null);
  const id = String(line.id || '').trim();
  const qty = Math.floor(Number(line.qty) || 0);
  if (!kind || !id || id.length > 120) return null;
  if (!(qty >= 1 && qty <= MAX_QTY)) return null;
  return { kind, id, name: String(line.name || id).slice(0, 120), qty };
}

/* Collapse duplicate lines. Two "50 Scrap" rows are one "100 Scrap" line — the
   server groups by (kind,id) when it measures delivery, so a manifest that did
   NOT collapse would show the player two progress bars for one target. */
export function normalise(lines) {
  const by = new Map();
  (lines || []).forEach((raw) => {
    const l = cleanLine(raw);
    if (!l) return;
    const key = l.kind + ' ' + l.id;
    const prev = by.get(key);
    if (prev) prev.qty = Math.min(MAX_QTY, prev.qty + l.qty);
    else by.set(key, l);
  });
  return Array.from(by.values()).slice(0, MAX_LINES);
}

/** Why this manifest cannot be posted, or null if it can. The server checks
    all of this again in merc_manifest_ok(); this exists so the player is told
    BEFORE their Cinder is charged, not by a failed RPC afterwards. */
export function validate(lines, reward) {
  const m = normalise(lines);
  if (!m.length) return 'Add at least one resource or card to the manifest.';
  if (m.length > MAX_LINES) return `A contract can ask for at most ${MAX_LINES} different things.`;
  const r = Math.floor(Number(reward) || 0);
  if (r < 1) return 'Set a Cinder reward — a contract with no reward is not a contract.';
  if (r > MAX_REWARD) return `The most a single contract can pay is ${MAX_REWARD.toLocaleString()} Cinder.`;
  return null;
}

/* ── PROGRESS ────────────────────────────────────────────────────────────── */

/** Merge a manifest with merc_outstanding() rows into one list the UI can
    render directly. Tolerates a missing outstanding fetch (offline, or the
    read raced the delivery) by reporting nothing delivered rather than
    claiming the job is done. */
export function progress(manifest, outstanding) {
  const got = new Map();
  (outstanding || []).forEach((o) => {
    if (!o) return;
    got.set(String(o.kind) + ' ' + String(o.item_id), Math.max(0, Number(o.got) || 0));
  });
  return normalise(manifest).map((l) => {
    const have = got.get(l.kind + ' ' + l.id) || 0;
    return { kind: l.kind, id: l.id, name: l.name, qty: l.qty,
             got: Math.min(l.qty, have), still: Math.max(0, l.qty - have) };
  });
}

export function isComplete(rows) {
  return (rows || []).length > 0 && rows.every((r) => (r.still | 0) <= 0);
}

export function pctDone(rows) {
  const want = (rows || []).reduce((n, r) => n + (r.qty | 0), 0);
  if (!want) return 0;
  const got = (rows || []).reduce((n, r) => n + Math.min(r.qty | 0, r.got | 0), 0);
  return Math.max(0, Math.min(100, Math.round(got / want * 100)));
}

/* ── CAN I ACTUALLY SHIP THIS? ───────────────────────────────────────────── */

/** What the mercenary can hand over RIGHT NOW, given what is in their stash
    and collection. Returns the deliverable slice AND what is short, so the UI
    can offer a partial drop instead of an all-or-nothing button that is
    disabled for reasons the player cannot see.

    ctx: { getRes(id), ownCount(kind, id) } */
export function deliverable(rows, ctx) {
  const send = [];
  const short = [];
  (rows || []).forEach((r) => {
    const still = Math.max(0, r.still | 0);
    if (!still) return;
    const have = (r.kind === 'res') ? (ctx.getRes(r.id) | 0) : (ctx.ownCount('card', r.id) | 0);
    const n = Math.min(still, Math.max(0, have));
    if (n > 0) send.push({ kind: r.kind, id: r.id, name: r.name, qty: n });
    if (n < still) short.push({ kind: r.kind, id: r.id, name: r.name, qty: r.qty,
                                missing: still - n, have });
  });
  return { send, short, canSendAll: short.length === 0 && send.length > 0 };
}

/** What the EMPLOYER's stash must have room for. A claim that would be clamped
    by the resource cap is refused up front rather than half-landed — the same
    rule /src/trading applies to a sale payout.

    ctx: { resourceCap(), resourceUnits() } */
export function acceptable(items, ctx) {
  const units = (items || []).reduce((n, i) => n + (i && i.kind === 'res' ? (i.qty | 0) : 0), 0);
  const cap = ctx.resourceCap() | 0;
  const used = ctx.resourceUnits() | 0;
  // A cap of 0 means "this build does not cap the stash". Never read it as
  // "no room" — that would make every claim on the board impossible.
  if (cap <= 0) return { ok: true, units, room: Infinity };
  const room = Math.max(0, cap - used);
  return { ok: units <= room, units, room };
}

/* ── LABELS ──────────────────────────────────────────────────────────────── */

/** "100 Scrap · 2 Sunspear", with icons. ctx.meta resolves Forge resource
    icons, so a custom resource authored this morning renders with its own. */
export function summary(lines, ctx, max = 4) {
  const m = normalise(lines);
  if (!m.length) return 'nothing';
  const bits = m.slice(0, max).map((l) => {
    if (l.kind === 'res') {
      const meta = ctx.meta(l.id) || {};
      return `${l.qty.toLocaleString()} ${meta.icon || '📦'} ${meta.name || l.id}`;
    }
    return `${l.qty} 🃏 ${l.name || l.id}`;
  });
  if (m.length > max) bits.push(`+${m.length - max} more`);
  return bits.join(' · ');
}
