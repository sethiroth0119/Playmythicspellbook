/* ════════════════════════════════════════════════════════════════════════════
   ⚖️ FORMATS — Supabase access, guarded.
   ----------------------------------------------------------------------------
   🔴 EVERY CALL DEGRADES (CLAUDE.md non-negotiable). The app must work offline
   and before sql/100 is applied. So: no throw ever escapes this file, a missing
   table is remembered in `_missing` and stops us hammering it, and "no format"
   is a completely valid state meaning *legacy rules* — each card's own
   `restriction` decides its limit, exactly as before this folder existed.

   ⚠ NEVER CACHE THE BANLIST ACROSS A PUBLISH. An admin activating a format has
   to reach players promptly or they build decks that are rejected at the door.
   TTL is short and `refresh()` is called on the deck builder opening.
   ════════════════════════════════════════════════════════════════════════════ */

import { fromRow, toRow, slugify } from './formats.data.js';

const TABLE = 'card_formats';
const TTL = 60000;

const S = {
  active: null,          // the live format, or null for legacy rules
  all: null,             // admin listing
  at: 0,
  missing: false,        // table not there — stop asking
  fetching: null,
};

function b() { try { return window.MythicFormatsBridge || null; } catch (e) { return null; } }
function tbl() {
  try {
    const br = b();
    const c = br && br.client && br.client();
    if (!c) return null;
    return c.from(TABLE);
  } catch (e) { return null; }
}

function noteMissing(err) {
  // PostgREST says 42P01 for "relation does not exist"; the message check
  // covers older clients that only surface a string.
  const code = err && (err.code || err.status);
  const msg = String((err && err.message) || '');
  if (code === '42P01' || /does not exist|schema cache/i.test(msg)) {
    S.missing = true;
    try { console.info('[formats] card_formats not present — legacy card restrictions in effect. Apply sql/100.'); } catch (e) {}
  }
}

export function activeFormat() { return S.active; }
export function allFormats() { return S.all || []; }
export function tableMissing() { return S.missing; }

/* Load the active format. Safe to call often — TTL-gated and de-duplicated, so
   the deck builder can call it on every open without a storm of requests. */
export async function refresh(force) {
  if (S.missing) return S.active;
  if (!force && S.at && Date.now() - S.at < TTL) return S.active;
  if (S.fetching) return S.fetching;

  S.fetching = (async () => {
    try {
      const t = tbl();
      if (!t) return S.active;
      const r = await t.select('*').eq('active', true).maybeSingle();
      if (r && r.error) { noteMissing(r.error); return S.active; }
      S.active = r && r.data ? fromRow(r.data) : null;
      S.at = Date.now();
      return S.active;
    } catch (e) { noteMissing(e); return S.active; }
    finally { S.fetching = null; }
  })();
  return S.fetching;
}

/* Admin listing — every format, newest first. */
export async function list() {
  if (S.missing) return [];
  try {
    const t = tbl();
    if (!t) return [];
    const r = await t.select('*').order('active', { ascending: false }).order('name');
    if (r && r.error) { noteMissing(r.error); return []; }
    S.all = (r.data || []).map(fromRow).filter(Boolean);
    return S.all;
  } catch (e) { noteMissing(e); return []; }
}

/* Create or update. Returns { ok, format, why }.
   ⚠ The admin gate here is a COURTESY — it produces a clean message instead of
   a raw RLS rejection. The real gate is the RLS policy in sql/100; never treat
   a client-side isAdmin() as the security boundary. */
export async function save(fmt) {
  const br = b();
  if (!br || !br.isAdmin || !br.isAdmin()) return { ok: false, why: 'admin only' };
  if (S.missing) return { ok: false, why: 'card_formats table not applied (sql/100)' };
  try {
    const t = tbl();
    if (!t) return { ok: false, why: 'offline' };
    const row = toRow({ ...fmt, slug: fmt.slug || slugify(fmt.name) });
    let r;
    if (fmt.id) r = await t.update(row).eq('id', fmt.id).select('*').maybeSingle();
    else        r = await t.insert(row).select('*').maybeSingle();
    if (r && r.error) { noteMissing(r.error); return { ok: false, why: r.error.message || 'write refused' }; }
    const saved = fromRow(r && r.data);
    S.at = 0;                                  // force the next read to re-fetch
    if (saved && saved.active) S.active = saved;
    return { ok: true, format: saved };
  } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }
}

/* Make one format live. Goes through the RPC so the swap is ONE statement —
   see the note in sql/100 about why two writes are not acceptable here. */
export async function activate(slug) {
  const br = b();
  if (!br || !br.isAdmin || !br.isAdmin()) return { ok: false, why: 'admin only' };
  try {
    const c = br.client && br.client();
    if (!c) return { ok: false, why: 'offline' };
    const r = await c.rpc('activate_card_format', { p_slug: slug });
    if (r && r.error) return { ok: false, why: r.error.message || 'activation refused' };
    S.at = 0;
    await refresh(true);
    return { ok: true, format: S.active };
  } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }
}

export async function remove(id) {
  const br = b();
  if (!br || !br.isAdmin || !br.isAdmin()) return { ok: false, why: 'admin only' };
  try {
    const t = tbl();
    if (!t) return { ok: false, why: 'offline' };
    const r = await t.delete().eq('id', id);
    if (r && r.error) return { ok: false, why: r.error.message || 'delete refused' };
    S.at = 0; S.all = null;
    if (S.active && S.active.id === id) S.active = null;
    return { ok: true };
  } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }
}
