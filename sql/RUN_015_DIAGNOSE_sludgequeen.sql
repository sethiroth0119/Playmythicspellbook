-- ============================================================================
-- RUN_015 — DIAGNOSE the erased "Sludgequeen" city.  READ-ONLY. Changes nothing.
--
-- WHY THIS EXISTS
-- "Sludgequeen" is a NODE name; the city is rendered as "<node name> City".
-- But `city_state` is ONE ROW PER USER (`onConflict: 'user_id'`), not per node.
-- So the question is not "which city row is empty" — it is "does the row
-- belonging to whoever owns node Sludgequeen still contain its tiles".
--
-- ⚠ RUN THESE IN ORDER AND STOP AT THE FIRST ONE THAT ANSWERS THE QUESTION.
--    Do NOT run any restore until Q2 tells you what is actually in the row.
-- ============================================================================

-- ── Q1. Who owns the node, and what is their user_id? ───────────────────────
-- Nodes live in the Forge JSONB blob, so search it rather than a nodes table.
select f.user_id,
       p.display_name,
       n->>'id'   as node_id,
       n->>'name' as node_name
from   forge f
       cross join lateral jsonb_array_elements(coalesce(f.data->'nodes','[]'::jsonb)) as n
       left join profiles p on p.user_id = f.user_id
where  n->>'name' ilike '%sludgequeen%';

-- If that returns nothing, the node lives on another player's blob. Widen it:
-- select user_id, data from forge where data::text ilike '%sludgequeen%' limit 20;


-- ── Q2. ⭐ THE ACTUAL QUESTION: is the city row empty, or just unreadable? ──
-- Paste the user_id from Q1. `tile_count` is the answer:
--   > 0  → THE CITY IS NOT ERASED. It is failing to LOAD (almost always RLS —
--          see Q3). Do not restore anything; fix the read.
--   = 0  → the row was overwritten with an empty city.
--   no row → never saved, or the row itself was deleted.
select cs.user_id,
       cs.updated_at,
       cs.node_id,
       jsonb_typeof(cs.state)                                as state_type,
       coalesce(jsonb_array_length(
         coalesce(jsonb_path_query_array(cs.state,'$.tiles.keyvalue()'),'[]'::jsonb)), 0) as tile_count,
       coalesce((cs.state->>'age')::numeric, 0)              as city_age,
       pg_column_size(cs.state)                              as state_bytes
from   city_state cs
where  cs.user_id = '<PASTE user_id FROM Q1>';


-- ── Q3. Is a mayor/manager relationship involved? ──────────────────────────
-- This is the documented erasure path: an owner-only SELECT policy returns ZERO
-- ROWS to a mayor rather than an error, so the mayor's client boots an EMPTY
-- grid and the next save overwrites the owner's real city. If a mayor is set
-- here and sql/014 was never applied (or its policy does not cover this pair),
-- that is almost certainly what happened.
select * from city_mayors where owner_id = '<PASTE user_id FROM Q1>'
                             or mayor_id = '<PASTE user_id FROM Q1>';

-- Are the policies that were supposed to fix it actually present?
select schemaname, tablename, policyname, cmd, qual, with_check
from   pg_policies
where  tablename = 'city_state'
order  by policyname;


-- ── Q4. Is there ANY older copy of this row still on the server? ───────────
-- There is no history table by design (the row is upserted), so this is the
-- honest check that it is genuinely unrecoverable from SQL alone.
select table_schema, table_name
from   information_schema.tables
where  table_name ilike '%city_state%';
-- If only `city_state` comes back, the previous contents are NOT in the
-- database and must come from Point-In-Time Recovery (Supabase → Database →
-- Backups) or from the player's own browser — see the notes in the reply.
