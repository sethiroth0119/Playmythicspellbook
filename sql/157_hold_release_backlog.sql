-- ===========================================================================
-- 157 — ONE-OFF: RELEASE THE HELD CINDER THAT THE BROKEN 093 RELEASE STRANDED.
-- DRAFT — NOT APPLIED. Run by the owner in the Supabase SQL editor for project
-- ktsiasyjusesawtrwrjc, AFTER sql/156 is applied. Idempotent: safe to re-run.
--
-- WHY: until sql/156, wallet_holds_release() paid holds one row at a time and
-- timed out (statement_timeout 8s) for any player with tens of thousands of
-- small hold rows, rolling back every attempt. Those players' Cinder has sat in
-- wallet_holds ever since. See sql/156's header for the measurements.
--
-- WHO (measured read-only on live, 2026-09-18 03:50 UTC — the only open holds):
--
--   display name   user id    open hold rows   held Cinder   wallet today
--   ------------   --------   --------------   -----------   ------------
--   ClareyV        6b721987           35,688       315,908     13,773,946
--
--   Total: 1 player, 315,908 Cinder. Every other player's holds had already
--   released (8,851 hold rows / 3,514,102 Cinder across 4 players).
--   A rolled-back rehearsal of exactly this call as ClareyV released 315,908 in
--   622 ms into a wallet of 14,089,854; a second call released 0.
--
-- HOW: the SAME worker the players call (public._wallet_holds_release_for,
-- sql/156) — the same 4,500,000-per-24h room rule, oldest hold first, same
-- locks, same _ct_cinder_give credit. Nothing here computes an amount.
--
-- 🔴 NEVER TWICE. The worker only pays amount - released of an open hold and
--    raises `released` by exactly that in the same transaction, under a lock
--    on the player's wallet row and on the hold rows. Re-running this file
--    finds nothing open (or only what the room rule still holds back) and
--    pays 0 again. Nothing is minted: the paid total equals the growth in
--    wallet_holds.released.
-- ⚠ If a player's last-24h window is ALREADY full when this runs, the room rule
--   releases only what fits and the rest waits for the client's normal calls
--   (now that they work). The final SELECT shows anything still held.
--   ClareyV had 4,452,112 of room at measurement time — far more than 315,908.
-- ⚠ HELD-FIRST (sql/156 section 3): once 156 is applied, wallet_credit itself
--   runs this same worker before paying any new income, so ClareyV's first
--   credit after 156 may already release her backlog before this file runs.
--   That is fine: this file then finds nothing open for her, releases 0, and
--   the VERIFY below still shows her row (still_held 0, released_total up by
--   315,908 plus whatever she has been held since). Either path is the SAME
--   worker, so the backlog can never be paid twice.
-- ===========================================================================

do $backlog$
declare
  r   record;
  j   jsonb;
  tot bigint := 0;
begin
  if to_regprocedure('public._wallet_holds_release_for(uuid)') is null then
    raise exception 'sql/156 is not applied — apply it first (this file uses its worker)';
  end if;

  for r in
    select h.user_id, left(h.user_id::text, 8) as uid8, p.display_name,
           sum(h.amount - h.released) as held, count(*) as n
      from public.wallet_holds h
      left join public.user_profiles p on p.user_id = h.user_id
     where h.released < h.amount
     group by h.user_id, p.display_name
     order by min(h.created_at)
  loop
    j := public._wallet_holds_release_for(r.user_id);
    tot := tot + coalesce((j ->> 'released')::bigint, 0);
    raise notice '% (%): held % in % rows -> released %, still held %, wallet %',
      coalesce(r.display_name, '?'), r.uid8, r.held, r.n,
      j ->> 'released', j ->> 'held', j ->> 'cinder';
  end loop;
  raise notice 'backlog release total: %', tot;
end
$backlog$;

-- ===========================================================================
-- VERIFY — expect zero rows (nothing still held), or only players whose
-- 24-hour window is full right now (they drain on their next client call).
-- ===========================================================================
select left(h.user_id::text, 8) as uid8, p.display_name,
       count(*) filter (where h.released < h.amount) as open_rows,
       sum(h.amount - h.released)                    as still_held,
       sum(h.released)                               as released_total,
       (select cinder from public.user_progress up where up.user_id = h.user_id) as wallet
  from public.wallet_holds h
  left join public.user_profiles p on p.user_id = h.user_id
 group by h.user_id, p.display_name
having sum(h.amount - h.released) > 0
    or h.user_id = '6b721987-c16b-42c7-af03-c394323ebdec'   -- always show ClareyV
 order by still_held desc;
