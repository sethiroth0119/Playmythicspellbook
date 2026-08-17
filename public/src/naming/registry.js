/* ══════════════════════════════════════════════════════════════════════════
   🏷 THE NAME REGISTER — one naming concept for every building in the city.

   ONE CONCEPT, NOT TWO. Before this, exactly one class of building had a name
   of its own: an OPERATION, whose dossier header reads the licence label out
   of `corp_operations` (see openInspect's comment — "def.name is the
   blueprint; the player named this one"). Everything else showed its
   blueprint, so a city of forty buildings had forty copies of five names.

   The resolution order below is the whole design, and the operations case is
   deliberately the FIRST fallback rather than a separate system:

       1. a name the player typed on this tile      (custom, saved)
       2. the operation licence label from City Hall (the case that worked)
       3. a generated name, seeded off the tile      (auto, saved once pinned)

   ⚠ WHY AN AUTO NAME IS SAVED AND NOT JUST RE-DERIVED. The generator is a
     pure function, so re-deriving is *almost* free — but the de-duplicator is
     a function of the whole tile set, so a demolition three streets away could
     legitimately hand a surviving shop a different name. A business quietly
     renaming itself is exactly the failure this system exists to remove, so
     the resolved name is pinned into the save the first time it is used and is
     never re-rolled. The measured cost is in HANDOVER.md.

   ⚠ SANITISING. A player-typed name is rendered into the dossier header, into
     the city log and (soon) into a cloud payload. The project's position on
     that is settled: HTML in a rendered string is an injection — see
     costLabel's header in node-city/index.html and the logEsc helper the
     dossier already uses. This file does BOTH halves: angle brackets and
     control/bidi characters never make it into storage, and every render still
     goes through esc(). Belt and braces, because the two halves are written by
     different people at different times.
   ══════════════════════════════════════════════════════════════════════════ */
import { generate } from './generate.js';
import { NO_NAME } from './words.js';
import { addressFor } from './address.js';

export const NAME_MAX = 48;
const KEY_RE = /^-?\d+,-?\d+$/;

/* HTML-escape. Same table as node-city's logEsc — deliberately identical, so
   a reader comparing the two sees one convention and not two. */
export function esc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* What is allowed to be STORED. Stripping is not the security boundary —
   esc() at render is — but a stored `<` has a way of finding a code path that
   forgot to escape, and no business name needs one.
     · C0/C7 controls, zero-width and bidi overrides: invisible characters that
       let a name lie about what it says in a list.
     · angle brackets: dropped outright.
     · whitespace: collapsed, so a name cannot be padded into a layout break. */
export function sanitise(raw) {
  let s = String(raw == null ? '' : raw);
  try { s = s.normalize('NFC'); } catch (e) {}
  s = s.replace(/[<>]/g, '');
  s = s.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s.slice(0, NAME_MAX);
}

export class NameRegister {
  /* ctx: { game, opsLabel(key), saveSoon() } — the globals trap (CLAUDE.md):
     `game`, `BUILDINGS` and friends are top-level `const` in node-city's module
     script and are invisible from here. Everything arrives through ctx. */
  constructor(ctx) {
    this.ctx = ctx;
    this.names = new Map();     // key -> resolved name (auto or custom)
    this.custom = new Set();    // keys whose name the player typed
    /* Per-city salt. Two players' cities must not be the same city with the
       same shops. Generated once, then it rides the save forever — changing it
       would rename every unpinned building at once. */
    this.salt = String(Math.floor(Math.random() * 0xFFFFFFFF)) + '.' + Date.now().toString(36);
    this._loaded = false;
  }

  /* Roads, walls, gates and anchors are not premises. */
  eligible(key) {
    const t = this.ctx.game.tiles[key];
    return !!(t && t.type && !NO_NAME.has(t.type));
  }

  /* The licence label, if this tile is a sited operation and the bridge can
     answer. Guarded hard: the ops layer talks to the parent game through a
     postMessage bridge that is simply absent in standalone. */
  opsLabel(key) {
    try {
      const s = this.ctx.opsLabel && this.ctx.opsLabel(key);
      return (typeof s === 'string' && s.trim()) ? s.trim() : null;
    } catch (e) { return null; }
  }

  /* THE resolution order. Never throws, always returns a string for an
     eligible tile, returns null for a road. */
  nameFor(key) {
    if (!this.eligible(key)) return null;
    const c = this.names.get(key);
    if (c && this.custom.has(key)) return c;
    const label = this.opsLabel(key);
    if (label) return label;
    if (c) return c;
    const made = this._mint(key);
    if (made) this.names.set(key, made);
    return made;
  }

  isCustom(key) { return this.custom.has(key); }

  /* The generated name for a tile, ignoring anything the player typed — what
     the "reset" affordance in the dossier goes back to. */
  autoFor(key) {
    if (!this.eligible(key)) return null;
    if (!this.custom.has(key) && this.names.has(key)) return this.names.get(key);
    return this._mint(key, true);
  }

  /* Mint a fresh generated name, de-duplicated against everything already in
     use. `attempt` is folded into the seed, so a re-roll is a different draw
     rather than the next word along.
     64 attempts then a numeric disambiguator: with pools this size a collision
     past attempt 2 has never been observed on a 172-tile district, and the
     suffix guarantees termination rather than a hang on a pathological save. */
  _mint(key, ignoreSelf) {
    const t = this.ctx.game.tiles[key];
    if (!t) return null;
    const p = key.split(',');
    const x = +p[0], z = +p[1];
    const taken = this._taken(ignoreSelf ? null : key);
    for (let a = 0; a < 64; a++) {
      const n = generate(this.salt, t.type, x, z, a, { tenant: t.tenant || null });
      if (n && !taken.has(n.toLowerCase())) return n;
    }
    const base = generate(this.salt, t.type, x, z, 0, { tenant: t.tenant || null });
    return (base + ' II').slice(0, NAME_MAX);
  }

  /* Every name currently spoken for: pinned names, plus live operation labels
     so a generated shop can never collide with a City Hall business. */
  _taken(exceptKey) {
    const s = new Set();
    for (const [k, v] of this.names) if (k !== exceptKey && v) s.add(String(v).toLowerCase());
    try {
      for (const k in this.ctx.game.tiles) {
        if (k === exceptKey) continue;
        const l = this.opsLabel(k);
        if (l) s.add(l.toLowerCase());
      }
    } catch (e) {}
    return s;
  }

  /* Fill in every eligible tile that has no name yet, in sorted key order.
     Sorted, so a register built from an empty cache is the same register every
     time regardless of how the tile object happens to be ordered. */
  ensureAll() {
    const keys = Object.keys(this.ctx.game.tiles)
      .filter((k) => KEY_RE.test(k) && this.eligible(k) && !this.names.has(k))
      .sort((a, b) => {
        const A = a.split(','), B = b.split(',');
        return (+A[0] - +B[0]) || (+A[1] - +B[1]);
      });
    for (const k of keys) {
      if (this.opsLabel(k)) continue;      // City Hall already named this one
      const n = this._mint(k);
      if (n) this.names.set(k, n);
    }
    return keys.length;
  }

  /* ── renaming ─────────────────────────────────────────────────────────
     Returns the stored string, or null if the tile cannot be named. An empty
     or all-stripped input is treated as "put it back to the generated name",
     which is the only sensible reading of clearing the field. */
  setName(key, raw) {
    if (!this.eligible(key)) return null;
    const clean = sanitise(raw);
    if (!clean) return this.clearName(key);
    this.names.set(key, clean);
    this.custom.add(key);
    this._save();
    return clean;
  }

  clearName(key) {
    this.custom.delete(key);
    this.names.delete(key);
    const n = this.nameFor(key);
    this._save();
    return n;
  }

  _save() { try { this.ctx.saveSoon && this.ctx.saveSoon(); } catch (e) {} }

  address(key) {
    /* No salt: an address is not seeded per-city any more. The street name is
       the streets module's (via /src/dossier), the number is the grid's. */
    try { return addressFor(this.ctx.game.tiles, key); } catch (e) { return null; }
  }

  /* ── persistence ──────────────────────────────────────────────────────
     Shape:  { v:1, s:<salt>, n:{ "x,z": "name" }, c:[ "x,z", … ] }
     `c` lists the keys the PLAYER typed. It is a list rather than a flag per
     entry because most cities are mostly auto-named, and a list of the few
     exceptions is smaller than a wrapper object on every row.

     Only tiles that still exist are written. Without that a demolished
     building's name would sit in the save forever and the payload would only
     ever grow — a slow leak into a localStorage budget the city already shares
     with its tile grid. */
  save() {
    this.ensureAll();
    const n = {};
    const c = [];
    for (const [k, v] of this.names) {
      if (!v || !this.ctx.game.tiles[k]) continue;
      n[k] = String(v).slice(0, NAME_MAX);
      if (this.custom.has(k)) c.push(k);
    }
    return { v: 1, s: this.salt, n, c };
  }

  /* Absent-tolerant by construction: `load(undefined)` on a save written
     before this feature existed leaves an empty register, which ensureAll then
     fills with generated names. That is the correct reading of "this save
     predates named businesses" — the city opens full of named businesses, none
     of which claim to have been chosen by the player. */
  load(obj) {
    this._loaded = true;
    if (!obj || typeof obj !== 'object') { this.ensureAll(); return false; }
    if (typeof obj.s === 'string' && obj.s) this.salt = obj.s;
    const n = (obj.n && typeof obj.n === 'object') ? obj.n : {};
    for (const k in n) {
      if (!KEY_RE.test(k)) continue;                    // a key that is not a tile
      const v = sanitise(n[k]);                          // trust nothing off disk
      if (v) this.names.set(k, v);
    }
    if (Array.isArray(obj.c)) for (const k of obj.c) if (KEY_RE.test(k) && this.names.has(k)) this.custom.add(k);
    this.ensureAll();
    return true;
  }

  /* Diagnostics: what the register actually contains, for the seam. */
  stats() {
    let auto = 0;
    for (const k of this.names.keys()) if (!this.custom.has(k)) auto++;
    return { total: this.names.size, auto, custom: this.custom.size, salt: this.salt };
  }
}
