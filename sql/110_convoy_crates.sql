-- ═══════════════════════════════════════════════════════════════════════════
-- 110 · A CONVOY MAY CARRY CRATES AND NO DISHES
--
-- The Loading Bay now ships PANTRY SUPPLIES (the crates a kitchen made on the
-- Supplies sheet) as well as cooked dishes, so another player can cook with
-- them. Crates ride in `items` under `ing:<ingredient>` keys and are credited
-- into the recipient's pantry by the client on the first claim; `dishes`
-- stays what it always was — the cooked boxes the server pays FOOD for.
--
-- 🔴 THE ONE LINE THIS CHANGES. kitchen_convoy_launch (sql/072) clamps
--    p_dishes with greatest(…, 1): a load of crates and no dishes was stored as
--    ONE dish, and the claim then paid one unit of food that nobody cooked. The
--    floor becomes 0. Everything else — quota, capacity, transit, the hold-up —
--    is untouched, and the function is rewritten IN PLACE from its own
--    definition rather than retyped, so nothing else can have drifted.
--    kitchen_convoy_quota_ok already takes greatest(p_dishes, 0).
--
-- Idempotent: re-running finds nothing to replace and says so.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare d text; n text;
begin
  select pg_get_functiondef(p.oid) into d
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'kitchen_convoy_launch';
  if d is null then raise exception 'kitchen_convoy_launch not found — run sql/072 first'; end if;
  n := replace(d,
    'least(greatest(coalesce(p_dishes, 0), 1), greatest(t.capacity, 1), 500)',
    'least(greatest(coalesce(p_dishes, 0), 0), greatest(t.capacity, 1), 500)');
  if n = d then
    if position('greatest(coalesce(p_dishes, 0), 0)' in d) > 0 then
      raise notice 'sql/110: already applied';
      return;
    end if;
    raise exception 'sql/110: the p_dishes clamp is not the sql/072 text — inspect kitchen_convoy_launch by hand';
  end if;
  execute n;
  raise notice 'sql/110: kitchen_convoy_launch now accepts a crates-only load';
end $$;

-- VERIFY
--   select position('greatest(coalesce(p_dishes, 0), 0)' in pg_get_functiondef(p.oid)) > 0 as crates_ok
--     from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
--    where ns.nspname = 'public' and p.proname = 'kitchen_convoy_launch';
