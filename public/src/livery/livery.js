/* ══════════════════════════════════════════════════════════════════════════
   🎨 VAN LIVERY — the pure part

   No DOM, no THREE, no Supabase. Presets, placement maths and the status
   vocabulary live here so they can be driven directly and so the two consumers
   (decal.js, which paints a van, and shop.js, which draws the UI) cannot drift
   apart about what a livery IS.

   ── THE SPLIT THAT MATTERS ────────────────────────────────────────────────
   A livery has two halves and they have completely different rules:

     THE SAFE HALF — paint, accent, a preset emblem, the fleet name, placement.
     Nothing here is authored by a player except a short name, which the server
     masks. It applies instantly, it needs no review, and it works forever even
     if a moderation provider is never contracted. This is the half that makes
     the van feel like yours.

     THE LOGO HALF — an uploaded image. Invisible to everyone but its owner
     until a machine AND a person have both said yes. See sql/063 and livery.js
     at the repo root.

   ⚠ isVisible() BELOW IS THE CLIENT'S COPY OF INVARIANT 2, AND IT IS ONLY A
     CONVENIENCE. The server decides — van_livery_public simply does not carry
     a path for anything except 'approved', so a client that got this wrong
     would render nothing rather than render something unreviewed. Do not ever
     "fix" a missing logo by loosening this function; if a logo is missing, the
     row is not approved, and that is the system working.
   ══════════════════════════════════════════════════════════════════════════ */

/* ── Preset emblems ────────────────────────────────────────────────────────
   Drawn procedurally on a canvas at paint time — no files, no fetches, no
   moderation, and they recolour themselves to the player's accent. This list
   is the reason a player who never uploads anything still gets a van with
   their mark on it. */
export const EMBLEMS = [
  { id: 'none',     name: 'No emblem',       draw: null },
  { id: 'chevron',  name: 'Haulier Chevron', hint: 'Old freight-line stripe.' },
  { id: 'cog',      name: 'Works Cog',       hint: 'Industry, and no apologies.' },
  { id: 'anvil',    name: 'Anvil',           hint: 'For the forges.' },
  { id: 'crown',    name: 'Merchant Crown',  hint: 'Trade royalty.' },
  { id: 'flask',    name: 'Alchemy Flask',   hint: 'Handle with care.' },
  { id: 'bolt',     name: 'Live Current',    hint: 'Power haulage.' },
  { id: 'wing',     name: 'Courier Wing',    hint: 'Fast, and says so.' },
  { id: 'shield',   name: 'Warden Shield',   hint: 'Escorted cargo.' },
  { id: 'star',     name: 'Company Star',    hint: 'Plain, and never wrong.' },
  { id: 'wave',     name: 'River Line',      hint: 'Docks and barges.' },
  { id: 'skull',    name: "Prospector's Mark", hint: 'Anomalous freight.' },
  { id: 'compass',  name: 'Long Haul Rose',  hint: 'Everywhere, eventually.' },
];
export const EMBLEM_IDS = EMBLEMS.map((e) => e.id);

/* ── Paint schemes. Named, because "#2f4f4f" is not a thing anyone is proud
      of and "Dockside Green" is. ─────────────────────────────────────────── */
export const SCHEMES = [
  { id: 'works',    name: 'Works White',     paint: '#e8e4da', accent: '#c6a04a' },
  { id: 'dockside', name: 'Dockside Green',  paint: '#2f4f43', accent: '#d9c079' },
  { id: 'ember',    name: 'Ember Red',       paint: '#7d2320', accent: '#e8cea0' },
  { id: 'ashfall',  name: 'Ashfall Grey',    paint: '#3c3f44', accent: '#9fb2c4' },
  { id: 'cinder',   name: 'Cinder Black',    paint: '#17181b', accent: '#d4af37' },
  { id: 'harbour',  name: 'Harbour Blue',    paint: '#22384f', accent: '#e2e6ea' },
  { id: 'bone',     name: 'Bone & Brass',    paint: '#d8cdb4', accent: '#8a6a2f' },
  { id: 'moss',     name: 'Deep Moss',       paint: '#37402b', accent: '#c3cf8e' },
  { id: 'rust',     name: 'Honest Rust',     paint: '#6b3f27', accent: '#e0b064' },
  { id: 'sovereign',name: 'Sovereign Purple',paint: '#3b2a52', accent: '#e6c96b' },
];

export const DEFAULTS = Object.freeze({
  paint: '#e8e4da', accent: '#c6a04a', emblem: 'none', fleetName: '',
  place: { side: { x: 0, y: 0, s: 1, r: 0 }, rear: { x: 0, y: 0, s: 1, r: 0 } },
});

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const LOGO_MIMES = ['image/png', 'image/jpeg', 'image/webp'];
export const MAX_FLEET_NAME = 28;

/* ── Status vocabulary ─────────────────────────────────────────────────────
   The wording is deliberate. A player whose logo is waiting has not done
   anything wrong and should not be read a policy document; a player whose logo
   was refused should be told plainly, once, without a lecture and without a
   score they could tune against. */
const STATUS = {
  none:            { label: 'No logo',            tone: 'idle',  say: 'Your van wears its paint and emblem.' },
  uploaded:        { label: 'In the paint booth',  tone: 'work',  say: 'Your artwork is being checked. This is usually quick.' },
  scanning:        { label: 'In the paint booth',  tone: 'work',  say: 'Your artwork is being checked. This is usually quick.' },
  awaiting_review: { label: 'Waiting on the shop', tone: 'work',  say: 'Checked and queued for a person to sign off.' },
  approved:        { label: 'On the road',         tone: 'good',  say: 'Your logo is live. Every van you own wears it.' },
  rejected:        { label: 'Turned down',         tone: 'bad',   say: 'That artwork was not accepted. You can submit a different one.' },
  frozen:          { label: 'Blocked',             tone: 'bad',   say: 'This account cannot submit artwork. Contact support.' },
  revoked:         { label: 'Taken down',          tone: 'bad',   say: 'That logo was removed. You can submit a different one.' },
  scan_failed:     { label: 'Could not be checked',tone: 'warn',  say: 'The check did not complete, so the logo is not live. Try again later.' },
};
export function statusInfo(s) {
  return STATUS[s] || { label: 'Unknown', tone: 'warn',
    // 🔒 An unrecognised state must READ as not-live, because that is what the
    //    server will do with it. Optimism here would be a lie in the UI.
    say: 'This logo is not on the road.' };
}
export function isVisible(status) { return status === 'approved'; }
export function isBusy(status) {
  return status === 'uploaded' || status === 'scanning' || status === 'awaiting_review';
}
/* Can the player start a NEW upload? Not while one is in flight, and never
   from a frozen account. */
export function canSubmit(status) { return !isBusy(status) && status !== 'frozen'; }

/* ── Validation. Mirrors the CHECK constraints in sql/063 so the player is
      told before the round-trip, never instead of it. ────────────────────── */
export function isHex(c) { return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c); }

export function checkFile(file) {
  if (!file) return { ok: false, why: 'Pick an image first.' };
  if (!LOGO_MIMES.includes(file.type)) return { ok: false, why: 'PNG, JPEG or WebP only.' };
  if (!(file.size > 0)) return { ok: false, why: 'That file is empty.' };
  if (file.size > MAX_LOGO_BYTES) {
    return { ok: false, why: 'Keep it under 2 MB — yours is ' + (file.size / 1048576).toFixed(1) + ' MB.' };
  }
  return { ok: true };
}

/* ── Placement ─────────────────────────────────────────────────────────────
   Panel-local, in metres, with the origin at the middle of the panel. Clamped
   so a decal cannot be walked off the bodywork and float beside the van —
   which is what happens if you let the slider run and trust the art. */
export const PANELS = {
  side: { w: 3.30, h: 1.85 },     // the cargo-box flank, between the arches
  rear: { w: 1.75, h: 1.60 },     // the roller door
};
export function clampPlace(panel, p) {
  const P = PANELS[panel] || PANELS.side;
  const s = Math.max(0.25, Math.min(1, Number(p && p.s) || 1));
  // The decal is s × the panel, so its half-extent is what limits travel.
  const mx = Math.max(0, (P.w - P.w * s) / 2);
  const my = Math.max(0, (P.h - P.h * s) / 2);
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    x: Math.max(-mx, Math.min(mx, num(p && p.x))),
    y: Math.max(-my, Math.min(my, num(p && p.y))),
    s,
    r: ((num(p && p.r) % 360) + 360) % 360,
  };
}
export function normalisePlace(place) {
  const p = place || {};
  return { side: clampPlace('side', p.side), rear: clampPlace('rear', p.rear) };
}

/* ── A whole livery, normalised. Anything unrecognised falls back to the
      default rather than reaching a shader or a CHECK constraint. ───────── */
export function normalise(row) {
  const r = row || {};
  const emblem = EMBLEM_IDS.includes(r.emblem) ? r.emblem : 'none';
  let name = String(r.fleet_name || r.fleetName || '').slice(0, MAX_FLEET_NAME);
  return {
    paint:  isHex(r.paint)  ? r.paint  : DEFAULTS.paint,
    accent: isHex(r.accent) ? r.accent : DEFAULTS.accent,
    emblem,
    fleetName: name,
    place: normalisePlace(r.place),
    logoStatus: r.logo_status || r.logoStatus || 'none',
    logoUrl: r.logoUrl || null,
  };
}

/* What the renderer should actually draw. The one place the "approved or
   nothing" rule turns into a decision, so there is one place to read. */
export function renderPlan(liv) {
  const L = normalise(liv);
  return {
    paint: L.paint, accent: L.accent,
    emblem: L.emblem === 'none' ? null : L.emblem,
    fleetName: L.fleetName,
    place: L.place,
    logoUrl: (isVisible(L.logoStatus) && L.logoUrl) ? L.logoUrl : null,
  };
}

export default { EMBLEMS, EMBLEM_IDS, SCHEMES, DEFAULTS, PANELS, statusInfo, isVisible,
                 isBusy, canSubmit, isHex, checkFile, clampPlace, normalisePlace,
                 normalise, renderPlan, MAX_LOGO_BYTES, LOGO_MIMES, MAX_FLEET_NAME };
