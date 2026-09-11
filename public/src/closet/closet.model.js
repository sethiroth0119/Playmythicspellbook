/* closet.model.js — the PLAYER CLOSET's data: what a piece of clothing IS.

   Asked for: "a character / Player Closet creator where players change the
   clothes of their characters; in the Athena Engine let me add clothing and
   connect it correctly to the models so a watch measured against the human
   models fits them rightfully; hats, shirts, backpacks, sneakers, watches,
   jewellery (earrings, chains), gloves, scarves; when a category is picked
   the camera swings to the part being changed; clothing brands like Watch
   Dogs 2's Plainstock; later, clothing stores."

   Three documents, all plain JSON so they survive Supabase, localStorage and
   a hub's position packet alike:

     brand  { id, name, tagline, logo (an emoji), color, owner_id }
     item   { id, brand, cat, name, url, fit, dims, price, currency, published, tags }
     body   { id, name, url, scale, faces, published }   — a base character
                                                          (a mannequin) the
                                                          creator dresses
     outfit { body: bodyId, wear: { hat: itemId, shirt: itemId, … } }  — on the
                                                          PROFILE, account-wide

   ⚠ A category is a SLOT ON THE BODY, not a shelf label. Every entry below
     names the bone family it hangs from, how the item is measured against
     that part of the body (closet.rig.js does the measuring), and where the
     camera goes when the player opens it. Add a category by adding a row —
     nothing else in the closet knows the list. */

export const CLOSET_VERSION = 1;

/* ── the categories ──
   part      which measured body part the item is fitted to (closet.rig.js PARTS)
   pair      the item is worn on BOTH sides: the right side is the left mirrored
   k         how big the item's `axis` dimension is, as a multiple of the
             part's `paxis` dimension — a hat is a little wider than the head,
             a watch wraps a wrist, a scarf drapes wider than the neck
   axis      the item's key dimension (x width · y height · z depth)
   paxis     the part's dimension it is measured against
   anchor    [itemFace, partFace] — which face of the scaled item sits on which
             face of the part ('c' centre, 'top', 'bottom', 'front', 'back')
   focus     the camera swing: which part to look at, from where
             ('front' | 'back' | 'side'), and how close (a multiple of the
             part's largest dimension; never closer than `min` metres) */
export const CATEGORIES = [
  { id: 'hat',      label: 'Hats',      icon: '🧢', part: 'head',   k: 1.08, axis: 'x', paxis: 'x', anchor: ['bottom', 'top'],  focus: { part: 'head',  from: 'front', dist: 4.2, min: 0.9 } },
  { id: 'shirt',    label: 'Shirts',    icon: '👕', part: 'chest',  k: 1.04, axis: 'x', paxis: 'x', anchor: ['c', 'c'],         focus: { part: 'chest', from: 'front', dist: 3.4, min: 1.3 } },
  { id: 'backpack', label: 'Backpacks', icon: '🎒', part: 'chest',  k: 0.88, axis: 'x', paxis: 'x', anchor: ['front', 'back'],  focus: { part: 'chest', from: 'back',  dist: 3.4, min: 1.3 } },
  { id: 'sneakers', label: 'Sneakers',  icon: '👟', part: 'foot',   k: 1.06, axis: 'z', paxis: 'z', anchor: ['bottom', 'bottom'], pair: true, focus: { part: 'foot', from: 'front', dist: 4.5, min: 0.9 } },
  { id: 'watch',    label: 'Watches',   icon: '⌚', part: 'wrist',  k: 1.05, axis: 'x', paxis: 'x', anchor: ['c', 'c'],         focus: { part: 'wrist', from: 'side',  dist: 5.0, min: 0.7 } },
  { id: 'earrings', label: 'Earrings',  icon: '💎', part: 'ear',    k: 1.00, axis: 'y', paxis: 'y', anchor: ['top', 'c'],       pair: true, focus: { part: 'ear',   from: 'side',  dist: 6.0, min: 0.6 } },
  { id: 'chain',    label: 'Chains',    icon: '📿', part: 'neck',   k: 1.45, axis: 'x', paxis: 'x', anchor: ['top', 'bottom'],  focus: { part: 'neck',  from: 'front', dist: 5.0, min: 0.8 } },
  { id: 'gloves',   label: 'Gloves',    icon: '🧤', part: 'hand',   k: 1.04, axis: 'y', paxis: 'y', anchor: ['c', 'c'],         pair: true, focus: { part: 'hand',  from: 'front', dist: 5.0, min: 0.6 } },
  { id: 'scarf',    label: 'Scarves',   icon: '🧣', part: 'neck',   k: 1.75, axis: 'x', paxis: 'x', anchor: ['top', 'c'],       focus: { part: 'neck',  from: 'front', dist: 4.6, min: 0.8 } },
];
export const CAT_BY_ID = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));
export const CAT_IDS = CATEGORIES.map(c => c.id);

export const CURRENCIES = ['gems', 'sovereigns', 'free'];
export const CURRENCY_LABEL = { gems: 'Cinder', sovereigns: 'Aza coin', free: 'Free' };
export const CURRENCY_ICON = { gems: '🔥', sovereigns: '🪙', free: '' };

/* ── limits ── */
export const MAX_ITEMS_PER_CAT_SHOWN = 400;
export const OUTFIT_PACKET_MAX = 400;   // a hub position packet carries the outfit as one string; keep it small

const clampNum = (v, lo, hi, d) => { v = +v; return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
const str = (v, n, d) => { v = v == null ? '' : String(v); v = v.slice(0, n); return v || (d == null ? '' : d); };
const idOk = (v) => /^[A-Za-z0-9_-]{2,64}$/.test(String(v || ''));
export function uid(prefix) { return (prefix || 'c_') + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
/* the item id a player types in a store code or a brand slug — safe for a URL, a packet and a policy check */
export function slug(v) { return String(v == null ? '' : v).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40); }
export function hex(v, d) { return /^#[0-9a-fA-F]{6}$/.test(String(v || '')) ? String(v).toLowerCase() : d; }

/* A vec3 that is always three finite numbers */
export function vec3(v, d) { d = d || [0, 0, 0]; return [0, 1, 2].map(i => clampNum(Array.isArray(v) ? v[i] : undefined, -1e4, 1e4, d[i])); }

/* ── THE FIT — how an item is connected to a body, portably ──
   Everything is RELATIVE to the measured part, never absolute:
     k       target size = k × the part's `paxis` dimension  (a watch is
             1.05 wrists wide on every body, whatever the wrist)
     off     an offset in FRACTIONS of the part's size on each axis (0.5 on y
             is "half a head up"), applied after the anchor rule
     rot     Euler XYZ in radians, in the body's own frame (x right, y up,
             −z forward), so a rotation fixed on one body holds on all
     anchor  overrides the category's anchor faces when the author changed it
     bone    overrides the bone family (rare — an item worn on the other wrist)
   `ref` remembers what the author fitted AGAINST (body id, the part's size,
   the item's size) so the studio can show it and a later re-fit can compare. */
export function normalizeFit(f, cat) {
  f = f && typeof f === 'object' ? f : {};
  const C = CAT_BY_ID[cat] || CATEGORIES[0];
  const out = {
    k: clampNum(f.k, 0.01, 50, C.k),
    off: vec3(f.off, [0, 0, 0]).map(v => Math.max(-20, Math.min(20, v))),
    rot: vec3(f.rot, [0, 0, 0]).map(v => Math.max(-Math.PI * 2, Math.min(Math.PI * 2, v))),
    axis: ['x', 'y', 'z'].includes(f.axis) ? f.axis : C.axis,
  };
  if (Array.isArray(f.anchor) && f.anchor.length === 2) out.anchor = [str(f.anchor[0], 8, 'c'), str(f.anchor[1], 8, 'c')];
  if (f.bone && typeof f.bone === 'string') out.bone = str(f.bone, 40);
  if (f.side === 'right') out.side = 'right';
  if (f.ref && typeof f.ref === 'object') out.ref = { body: str(f.ref.body, 64), part: vec3(f.ref.part, [0, 0, 0]), item: vec3(f.ref.item, [0, 0, 0]) };
  return out;
}

export function normalizeBrand(b) {
  b = b && typeof b === 'object' ? b : {};
  return {
    id: idOk(b.id) ? String(b.id) : uid('br_'),
    name: str(b.name, 40, 'Brand'),
    tagline: str(b.tagline, 90),
    logo: str(b.logo, 4, '🏷'),
    color: hex(b.color, '#d4af37'),
    owner_id: b.owner_id ? str(b.owner_id, 64) : null,
    owner_name: str(b.owner_name, 60),
    published: b.published !== false,
    created_at: +b.created_at || 0,
  };
}

export function normalizeItem(it) {
  it = it && typeof it === 'object' ? it : {};
  const cat = CAT_BY_ID[it.cat] ? it.cat : CATEGORIES[0].id;
  const currency = CURRENCIES.includes(it.currency) ? it.currency : 'gems';
  return {
    id: idOk(it.id) ? String(it.id) : uid('ci_'),
    brand: idOk(it.brand) ? String(it.brand) : '',
    cat,
    name: str(it.name, 60, 'Item'),
    url: str(it.url, 1000),
    fit: normalizeFit(it.fit, cat),
    dims: vec3(it.dims, [0, 0, 0]),   // the model's own size at scale 1, metres — measured by the studio on import
    price: currency === 'free' ? 0 : Math.max(0, Math.min(1e9, Math.floor(+it.price || 0))),
    currency,
    published: it.published !== false,
    tags: (Array.isArray(it.tags) ? it.tags : String(it.tags || '').split(',')).map(t => slug(t)).filter(Boolean).slice(0, 12),
    owner_id: it.owner_id ? str(it.owner_id, 64) : null,
    owner_name: str(it.owner_name, 60),
    created_at: +it.created_at || 0,
  };
}

export function normalizeBody(b) {
  b = b && typeof b === 'object' ? b : {};
  return {
    id: idOk(b.id) ? String(b.id) : uid('cb_'),
    name: str(b.name, 40, 'Character'),
    url: str(b.url, 1000),
    scale: clampNum(b.scale, 0.01, 50, 1),
    faces: b.faces === 'z' ? 'z' : '-z',
    anim: b.anim && typeof b.anim === 'object' ? { idle: str(b.anim.idle, 80) } : {},
    published: b.published !== false,
    owner_id: b.owner_id ? str(b.owner_id, 64) : null,
    owner_name: str(b.owner_name, 60),
    created_at: +b.created_at || 0,
  };
}

/* The outfit on a profile: one body, at most one item per category. Unknown
   categories are dropped so an old profile never carries a slot the body
   cannot wear. */
export function normalizeOutfit(o) {
  o = o && typeof o === 'object' ? o : {};
  const wear = {};
  const src = o.wear && typeof o.wear === 'object' ? o.wear : {};
  CAT_IDS.forEach(c => { if (idOk(src[c])) wear[c] = String(src[c]); });
  return { body: idOk(o.body) ? String(o.body) : '', wear };
}

/* ── the outfit as ONE SHORT STRING — for a hub's position packet ──
   `body|hat=id,shirt=id`. Ids are [A-Za-z0-9_-] so no escaping is needed;
   anything that does not parse is an empty outfit rather than an error. */
export function packOutfit(o) {
  o = normalizeOutfit(o);
  const s = o.body + '|' + Object.keys(o.wear).map(c => c + '=' + o.wear[c]).join(',');
  return s.length > OUTFIT_PACKET_MAX ? o.body + '|' : s;
}
export function unpackOutfit(s) {
  if (!s || typeof s !== 'string' || s.length > OUTFIT_PACKET_MAX) return normalizeOutfit(null);
  const i = s.indexOf('|'); if (i < 0) return normalizeOutfit(null);
  const wear = {};
  s.slice(i + 1).split(',').forEach(p => { const j = p.indexOf('='); if (j > 0) wear[p.slice(0, j)] = p.slice(j + 1); });
  return normalizeOutfit({ body: s.slice(0, i), wear });
}
export function outfitEquals(a, b) { return packOutfit(a) === packOutfit(b); }

/* what an item costs, as words */
export function priceLabel(it) {
  if (!it || it.currency === 'free' || !(it.price > 0)) return 'Free';
  return it.price.toLocaleString() + ' ' + (CURRENCY_ICON[it.currency] || '') + ' ' + (CURRENCY_LABEL[it.currency] || it.currency);
}
