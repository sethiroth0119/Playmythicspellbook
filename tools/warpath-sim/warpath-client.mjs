// ─────────────────────────────────────────────────────────────────────────────
// 🔌 One WARPATH player = one PostgreSQL connection.
//
// ⚠ THE SESSION IS THE IDENTITY. supabase/tests/warpath_milestone_1_test.sql
// switches auth.uid() through a shared `_testctx` table, which is correct for
// one player and silently wrong for four: concurrent sessions overwrite each
// other's row and every RPC starts running as whoever wrote last. This project
// has already published one completely false concurrency result that way. Here
// each Player owns its own connection and its own session-local GUC
// (request.jwt.claim.sub — the same setting PostgREST populates), so there is
// no shared mutable identity anywhere in the harness.
//
// Players also `set role authenticated`, so RLS and the grant matrix in
// PART 6 of the migration are exercised rather than bypassed. Only the
// Observer connects as the owner, and it never mutates anything.
// ─────────────────────────────────────────────────────────────────────────────
import pg from 'pg';

export const W = 44, H = 30;

export const CONN = {
  host: process.env.WP_PGHOST || '/var/tmp/wpsim',
  port: Number(process.env.WP_PGPORT || 55432),
  database: process.env.WP_PGDATABASE || 'warpath',
  user: process.env.WP_PGUSER || 'postgres',
};

export class Session {
  constructor(label) { this.label = label; this.client = new pg.Client(CONN); this.calls = 0; this.pgErrors = []; }

  async open(uid) {
    await this.client.connect();
    if (uid) {
      await this.client.query('select public.set_uid($1)', [uid]);
      await this.client.query('set role authenticated');
    }
  }

  /** Call an RPC exactly the way the browser client would: one function, JSON in, JSON out.
   *
   *  ⚠ A raw PostgreSQL error is NOT turned into a thrown exception here. Four
   *  concurrent players can make warpath_end_turn deadlock (40P01), and a
   *  harness that dies on the first one measures the bug exactly once. Errors
   *  are shaped like an ordinary refusal, counted, and the run carries on —
   *  which is also what the browser sees: PostgREST returns the SQLSTATE and
   *  the client gets a rejected promise, not a `{ok:false}` payload. */
  async rpc(fn, args = []) {
    this.calls++;
    const ph = args.map((_, i) => `$${i + 1}`).join(', ');
    try {
      const { rows } = await this.client.query(`select public.${fn}(${ph}) as r`, args);
      return rows[0].r;
    } catch (e) {
      this.pgErrors.push({ fn, code: e.code, message: e.message });
      return { ok: false, reason: 'pg_error', pg_code: e.code, pg_message: e.message };
    }
  }

  async sql(text, args = []) { return (await this.client.query(text, args)).rows; }
  async whoami() { return (await this.sql('select auth.uid() as u'))[0].u; }
  async close() { try { await this.client.end(); } catch { /* already gone */ } }
}

// ── Map derivation ──────────────────────────────────────────────────────────
// public/warpath/warpath-mapgen.js computes terrain, nodes and structures in
// the browser from the run seed; the wp_* functions are its server-side twin.
// The bots need the same picture a real client has, so the harness pulls it
// once per run through the Observer. This is NOT privileged information: every
// tile of it is derivable from `seed`, which warpath_state() hands the client.
export async function loadMap(obs, seed) {
  const rows = await obs.sql(
    `with c as (select public.wp_cores($1::bigint) k)
     select x, y,
            public.wp_is_water($1::bigint, x, y)                             as water,
            public.wp_move_cost($1::bigint, x, y,
                                public.wp_biome_at($1::bigint, x, y, c.k))   as mc,
            public.wp_node_at($1::bigint, x, y,
                              public.wp_biome_at($1::bigint, x, y, c.k))     as node
       from generate_series(0, ${W - 1}) x, generate_series(0, ${H - 1}) y, c`,
    [String(seed)]);

  const water = Array.from({ length: H }, () => new Array(W).fill(false));
  const cost  = Array.from({ length: H }, () => new Array(W).fill(9));
  const node  = Array.from({ length: H }, () => new Array(W).fill(null));
  for (const r of rows) { water[r.y][r.x] = r.water; cost[r.y][r.x] = r.mc; node[r.y][r.x] = r.node; }

  const structures = (await obs.sql('select public.wp_structures($1::bigint) as s', [String(seed)]))[0].s;
  return { seed, water, cost, node, structures,
           gates: structures.filter(s => s.k === 'gate'),
           sites: structures.filter(s => s.k === 'site'),
           landmarks: structures.filter(s => s.k === 'landmark') };
}

export const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
export const key = (x, y) => y * W + x;

/** Dijkstra over the movement grid, capped at `budget`. Mirrors wp_path_cost. */
export function reach(map, sx, sy, budget) {
  const dist = new Map([[key(sx, sy), 0]]);
  let frontier = [[sx, sy]];
  for (let step = 0; step < budget && frontier.length; step++) {
    const next = [];
    for (const [x, y] of frontier) {
      const d = dist.get(key(x, y));
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (map.water[ny][nx]) continue;
        const nd = d + map.cost[ny][nx];
        if (nd > budget) continue;
        if (nd < (dist.get(key(nx, ny)) ?? Infinity)) { dist.set(key(nx, ny), nd); next.push([nx, ny]); }
      }
    }
    frontier = next;
  }
  return dist;
}

/** The player's own fog, straight out of warpath_state(). */
export function fogReader(b64) {
  const buf = Buffer.from(b64 || '', 'base64');
  return (x, y) => { const i = y * W + x; return ((buf[i >> 3] ?? 0) >> (i & 7)) & 1; };
}

/** Deterministic per-bot RNG so a surprising run can be replayed exactly. */
export function rng(seed) {
  let s = seed >>> 0;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
