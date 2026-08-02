-- ═══════════════════════════════════════════════════════════════════════════
-- 🏦 BANK CHARTER — pricing ladder + sale listing
-- ---------------------------------------------------------------------------
-- Run ONCE in the Supabase SQL editor, AFTER player_banks.sql.
-- Replaces one function, adds two columns and one RPC. No tables dropped,
-- no bank rows touched. Safe to re-run.
--
-- ── WHY THE NUMBERS CHANGED ────────────────────────────────────────────────
-- Agreed price to open a bank: **$200 worth of Mythic Token, staked**.
-- MT quotes at $0.10, so that is 2,000 MT.
--
-- player_banks.sql shipped the mockup's ladder (200 / 750 / 2,100 MT stake).
-- Setting tier 1 to 2,000 in isolation would have made the ENTRY tier cost
-- nearly as much as the top tier — the ladder would no longer ascend. So the
-- whole ladder is scaled ×10, preserving the mockup's 1 : 3.75 : 10.5 ratio:
--
--   Tier 1  Lending House    fee     0 · stake  2,000 MT  →   $200   (entry)
--   Tier 2  Chartered Bank   fee 1,500 · stake  7,500 MT  →   $900
--   Tier 3  Mythic Reserve   fee 4,000 · stake 21,000 MT  → $2,500
--
-- Tier 1 burns NOTHING so the advertised "$200" is exactly what leaves the
-- wallet; upgrading burns a filing fee, as the mockup intended.
-- The stake is LOCKED, not spent — it is the bank's capitalisation.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Sale listing: a charter can be sold, which returns the seller's stake at
--    once because the buyer posts their own (path II in the mockup).
alter table public.player_banks add column if not exists for_sale      boolean not null default false;
alter table public.player_banks add column if not exists asking_price  bigint  not null default 0;
alter table public.player_banks add column if not exists branches      int     not null default 0;

create or replace function public.bank_open_charter(
  p_tier int, p_stake numeric, p_bank_name text, p_tagline text default ''
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_fee numeric;
  v_min numeric;
  v_bal numeric;
  v_name text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;

  -- ⚠ The price table lives HERE, not in the client, so a player cannot
  -- dictate their own charter price by editing the request.
  v_fee := case p_tier when 1 then 0     when 2 then 1500 when 3 then 4000  else null end;
  v_min := case p_tier when 1 then 2000  when 2 then 7500 when 3 then 21000 else null end;
  if v_fee is null then return jsonb_build_object('ok', false, 'error', 'bad_tier'); end if;
  if p_stake < v_min then
    return jsonb_build_object('ok', false, 'error', 'stake_too_low', 'required', v_min);
  end if;

  select coalesce(mt, 0) into v_bal from public.mythic_balances where user_id = v_uid;
  if v_bal is null then v_bal := 0; end if;
  if v_bal < (v_fee + p_stake) then
    return jsonb_build_object('ok', false, 'error', 'insufficient_mt',
                              'need', v_fee + p_stake, 'have', v_bal);
  end if;

  update public.mythic_balances set mt = mt - (v_fee + p_stake) where user_id = v_uid;

  select coalesce(display_name, 'Banker') into v_name
    from public.public_profiles where user_id = v_uid;

  insert into public.player_banks (owner_id, owner_name, bank_name, tagline, charter_tier,
                                   mt_burned, mt_staked, mt_overstake)
  values (v_uid, coalesce(v_name,'Banker'), coalesce(nullif(p_bank_name,''),'Lending House'),
          coalesce(p_tagline,''), p_tier, v_fee, v_min, greatest(0, p_stake - v_min))
  on conflict (owner_id) do update set
    charter_tier = greatest(public.player_banks.charter_tier, excluded.charter_tier),
    bank_name    = excluded.bank_name,
    tagline      = excluded.tagline,
    mt_burned    = public.player_banks.mt_burned + excluded.mt_burned,
    mt_staked    = public.player_banks.mt_staked + excluded.mt_staked,
    mt_overstake = public.player_banks.mt_overstake + excluded.mt_overstake,
    updated_at   = now();

  insert into public.bank_ledger (bank_id, kind, amount, actor_id, actor_name, note)
  values (v_uid, 'charter', 0, v_uid, coalesce(v_name,'Banker'),
          'Charter ' || p_tier || ' — ' || v_fee || ' MT burned, ' || p_stake || ' MT staked');

  return jsonb_build_object('ok', true, 'tier', p_tier, 'burned', v_fee, 'staked', p_stake);
end $$;

-- ── Add to an existing stake (over-stake tops up deposit capacity) ─────────
create or replace function public.bank_add_stake(p_amount numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_bal numeric;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  if p_amount is null or p_amount <= 0 then return jsonb_build_object('ok', false, 'error', 'bad_amount'); end if;
  if not exists (select 1 from public.player_banks where owner_id = v_uid) then
    return jsonb_build_object('ok', false, 'error', 'no_bank');
  end if;
  select coalesce(mt, 0) into v_bal from public.mythic_balances where user_id = v_uid;
  if coalesce(v_bal,0) < p_amount then
    return jsonb_build_object('ok', false, 'error', 'insufficient_mt', 'need', p_amount, 'have', coalesce(v_bal,0));
  end if;
  update public.mythic_balances set mt = mt - p_amount where user_id = v_uid;
  update public.player_banks set mt_overstake = mt_overstake + p_amount, updated_at = now()
   where owner_id = v_uid;
  insert into public.bank_ledger (bank_id, kind, amount, actor_id, note)
  values (v_uid, 'charter', 0, v_uid, 'Over-stake +' || p_amount || ' MT');
  return jsonb_build_object('ok', true, 'added', p_amount);
end $$;

-- ── List / delist the charter for sale ────────────────────────────────────
create or replace function public.bank_set_sale(p_for_sale boolean, p_price bigint default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  update public.player_banks
     set for_sale = coalesce(p_for_sale, false),
         asking_price = greatest(0, coalesce(p_price, 0)),
         updated_at = now()
   where owner_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_bank'); end if;
  insert into public.bank_ledger (bank_id, kind, amount, actor_id, note)
  values (v_uid, 'fee', coalesce(p_price,0), v_uid,
          case when p_for_sale then 'Charter listed for sale' else 'Charter delisted' end);
  return jsonb_build_object('ok', true, 'for_sale', coalesce(p_for_sale,false), 'price', coalesce(p_price,0));
end $$;

grant execute on function public.bank_open_charter(int, numeric, text, text) to authenticated;
grant execute on function public.bank_add_stake(numeric) to authenticated;
grant execute on function public.bank_set_sale(boolean, bigint) to authenticated;

-- VERIFY
--   select public.bank_open_charter(1, 2000, 'Test House');   -- burned 0, staked 2000
--   select owner_id, charter_tier, mt_burned, mt_staked, for_sale from public.player_banks;
--   -- clean up a test row:  delete from public.player_banks where owner_id = auth.uid();
