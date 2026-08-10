-- ===========================================================================
-- 014a - RUN THIS FIRST. It changes nothing; it tells you whether 014 will
--        actually cover YOUR mayors.
--
-- WHY. There are TWO ways a mayor gets seated in this game, and 014's policy
-- only knows about one of them:
--
--   A. MAYOR HALL (market-deploy) - negotiation, then an accept RPC writes a
--      row into public.node_mayors. The game reads that table. 014 keys on it.
--
--   B. THE IN-GAME "Appoint Mayor" BUTTON on the city Governance card, which
--      calls the RPC  city_set_mayor(p_mayor_id, p_mayor_name, p_pay, p_from).
--      That function has NO definition anywhere in this repository - it exists
--      only in the live database, if at all. So I cannot tell from the code
--      which table it writes, and I am not going to guess.
--
-- If B writes node_mayors, 014 covers everyone and you are done.
-- If B writes something else, mayors appointed in-game will STILL be unable to
-- save, and section 3 below tells you what to add.
-- ===========================================================================


-- --- 1. Does city_set_mayor exist, and what does it do? --------------------
-- Read the body it prints. Look for the INSERT / UPDATE and note the table.
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       pg_get_functiondef(p.oid)                 as definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'city_set_mayor';
-- 0 rows = the in-game Appoint Mayor button has never worked against this
--          database. That is worth knowing on its own.


-- --- 2. Where do your real mayors actually live? ---------------------------
-- Any table with both a mayor-ish and an owner-ish column is a candidate.
select table_name,
       string_agg(column_name, ', ' order by ordinal_position) as columns
  from information_schema.columns
 where table_schema = 'public'
   and table_name in (
     select table_name from information_schema.columns
      where table_schema = 'public' and column_name in ('mayor_id','mayor_name')
   )
 group by table_name
 order by table_name;


-- --- 3. How many active contracts are in node_mayors right now? ------------
-- If your managers are live in-game but this is 0, they were seated by path B
-- and 014 alone will not help them.
select count(*) filter (where active)     as active_contracts,
       count(*)                           as rows_total,
       count(distinct owner_id)           as owners,
       count(distinct mayor_id)           as mayors
  from public.node_mayors;
-- ERROR "relation does not exist" = supabase-ALL-PENDING.sql was never applied.
-- Apply that BEFORE 014, or 014's function will reference a missing table.


-- ===========================================================================
-- WHAT TO DO WITH THE ANSWERS
--
--   * node_mayors exists AND has your active contracts  -> run 014 as written.
--
--   * city_set_mayor writes a DIFFERENT table (say public.city_mayors with
--     columns owner_id / mayor_id) -> run 014, then widen the function by
--     adding a second EXISTS to city_state_can_write:
--
--         or exists (
--           select 1 from public.city_mayors cm
--            where cm.owner_id = p_owner
--              and cm.mayor_id = auth.uid()
--         )
--
--     Send me the output of section 1 and I will write that exactly rather
--     than you adapting it by hand - the column names have to match or the
--     clause silently never matches and nothing improves.
--
--   * city_set_mayor does not exist at all -> the Governance "Appoint Mayor"
--     button has been failing silently. Separate bug; tell me and I will fix
--     the client to say so instead of pretending it worked.
-- ===========================================================================
