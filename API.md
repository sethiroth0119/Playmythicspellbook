# Mythic Spellbook — Public Game API

Base URL: `https://playmythicspellbook.com`
All endpoints are **GET**, **read-only**, **public**, JSON, CORS `*` (so
abraxascodex.com can fetch them straight from the browser or server).
Responses are cached ~30s at the edge.

## Endpoints

| Endpoint | Returns |
|---|---|
| `GET /api` | discovery / endpoint list |
| `GET /api/v1/health` | `{ ok, service, api, time }` — liveness, no DB |
| `GET /api/v1/corporations?limit=200` | `{ count, corporations:[{name,tag,faction,element,members,founded}] }` |
| `GET /api/v1/reserve` | `{ resources:[{resource,total,points,contributors}] }` |
| `GET /api/v1/tax` | `{ total_tax, day, week, month, black_market, corporation, tx_count }` |
| `GET /api/v1/nodes?limit=300` | `{ nodes:[{id,name,node_type,resource,level,status,x,y,corp_tag,created_at}] }` |
| `GET /api/v1/updates?limit=20` | `{ updates:[{id,title,body,tag,url,source,published_at}] }` |

No player ids, emails, or PII are ever returned — the API only reads the
curated `api_*` views from `api.sql`.

## abraxascodex → game ("Keep up with updates")

The game does **not** accept writes. abraxascodex.com publishes updates by
inserting rows into the Supabase `site_updates` table using **its own**
Supabase credentials/service key (kept on the abraxascodex backend — never
in the game). Columns: `title` (req), `body`, `tag`, `url`,
`source` (default `'abraxascodex'`), `published_at`. The game then reads
them back via `GET /api/v1/updates`.

## Drop-in client (use on abraxascodex.com)

```js
// Mythic Spellbook API client — paste into abraxascodex.com.
const MS_API = 'https://playmythicspellbook.com/api/v1';
async function msGet(path) {
  const r = await fetch(MS_API + path, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error('Mythic API ' + r.status);
  return r.json();
}
export const MythicSpellbook = {
  health:        ()      => msGet('/health'),
  corporations:  (n=200) => msGet('/corporations?limit=' + n),
  reserve:       ()      => msGet('/reserve'),
  tax:           ()      => msGet('/tax'),
  nodes:         (n=300) => msGet('/nodes?limit=' + n),
  updates:       (n=20)  => msGet('/updates?limit=' + n),
};
```

## Setup (one-time, you)

1. Run `api.sql` in the Supabase SQL editor (idempotent). It creates the
   `economy_nodes` (node system) + `site_updates` tables and the public
   `api_*` views.
2. The Worker is already wired (`worker.js` + `wrangler.jsonc`); deploying
   the game also deploys the API on the same domain. The static game site
   is unaffected — only `/api/*` is handled by the Worker.

`/api/v1/health` works immediately. The DB-backed endpoints return data
once `api.sql` has been run; until then they reply `502 {error:'upstream'}`.
