-- ============================================================================
-- 038_mercenary_board.sql
-- ⚔ THE MERCENARY BOARD — hire another player to deliver Forge resources and
--   Custom cards, with the Cinder held in ESCROW until the goods land.
--
-- Idempotent. Re-runnable. RLS ships in this file. Ends with verify queries.
-- Apply BY HAND in the Supabase SQL editor for project ktsiasyjusesawtrwrjc
-- (there is no CLI login in this repo — CLAUDE.md, "Migrations").
--
-- Nothing in the client REQUIRES this to have been applied: /src/mercenary
-- detects the missing tables (PGRST205) and renders "the board is not set up
-- yet" instead of breaking. Applying it is an upgrade, not a gate.
--
-- ── THE DEAL, IN ONE PARAGRAPH ──────────────────────────────────────────────
--   1. An EMPLOYER posts a contract: a MANIFEST (n resources and/or cards) and
--      a Cinder reward. Posting CHARGES the reward immediately — that charge
--      IS the escrow. There is no "promise to pay" state anywhere in here.
--   2. MERCENARIES apply. The employer hires one.
--   3. The mercenary DELIVERS: the goods leave their stash client-side and a
--      delivery row is written here. When the manifest is complete the
--      contract settles itself — the employer does NOT get a veto. That is
--      deliberate; see "WHY DELIVERY AUTO-SETTLES" below.
--   4. Both sides CLAIM: the mercenary claims the Cinder, the employer claims
--      the goods. A claim is an INSERT with a composite PK, so it happens
--      exactly once no matter how many times a flaky client retries.
--
-- ── WHY DELIVERY AUTO-SETTLES (a rejected design, recorded) ─────────────────
-- The obvious build is "mercenary delivers → employer presses Accept → money
-- moves". That hands the employer a free option: take the goods, never press
-- the button, and the mercenary is out a stash with no recourse but a support
-- ticket. Since the manifest is written down at post time, the server can tell
-- whether it was met without asking anyone's opinion — so it does, and the
-- employer's judgement is removed from the payment path entirely. The employer
-- is protected on the other side by the manifest itself: they wrote it, and a
-- delivery that does not match it does not settle.
--
-- ── WHY NOT boe_merc_listings / boe_merc_contracts ─────────────────────────
-- Those already exist and are NOT this. They are the Bank of Ethos HOURLY WAGE
-- clock (clocked_in_at / pause_ms_accum / rate_per_hour) — you rent a player's
-- time and boe_merc_settle() pays by the hour. This is piece-work against a
-- goods manifest with escrow. Sharing tables would mean one status column
-- meaning two different things; they stay separate on purpose.
--
-- ── WHY NOT wallet_holds ───────────────────────────────────────────────────
-- The name is a trap. public.wallet_holds is NOT an escrow ledger: it is the
-- overflow buffer for wallet_credit's 24h credit ceiling, drained by
-- wallet_holds_release(). Parking contract escrow in it would put player money
-- in a queue whose whole job is to hand it back to the same player. Escrow is
-- a real wallet_charge plus the append-only merc_escrow ledger below.
--
-- ── WHY RESOURCE IDS ARE NOT VALIDATED ─────────────────────────────────────
-- The whole point of the feature is "every resource that was created in the
-- Forge". Forge.customResources is authored client-side and published through
-- the catalog row; there is no server-side registry that contains them, and
-- _wh_known_resource() would reject exactly the custom resources this board
-- exists to trade. So ids are length-checked and stored verbatim, and the
-- client resolves them through _meta(). Same for custom card ids.
-- ============================================================================

begin;

-- ── 1. WHO IS FOR HIRE ─────────────────────────────────────────────────────
-- ⚠ THERE ARE NO COUNTER COLUMNS ON THIS TABLE, and that is load-bearing.
--   RLS gates ROWS, never COLUMNS (sql/029, sql/031 both say so). A player
--   must be able to UPDATE their own bio, so any jobs_done / cinder_earned
--   column sitting beside it would be player-writable — a badge you can type
--   into yourself. Standing is DERIVED instead, by the view further down, from
--   contracts nobody can forge.
create table if not exists public.merc_profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  label      text not null default 'Survivor',   -- display name at register time
  bio        text not null default '',
  rate_hint  bigint not null default 0 check (rate_hint >= 0 and rate_hint <= 100000000),
  tags       text[] not null default '{}',       -- 'hauling', 'cards', 'rare-res', …
  status     text not null default 'open'
             check (status in ('open', 'busy', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists merc_profiles_status_idx on public.merc_profiles (status, updated_at desc);

-- ── 2. THE CONTRACT ────────────────────────────────────────────────────────
-- `manifest` is the whole agreement: a jsonb array of
--     {"kind":"res"|"card", "id":"...", "name":"...", "qty":n}
-- It is written once at post time and NEVER edited — merc_deliver() measures
-- delivery against it, so a mutable manifest would be a mutable payout.
create table if not exists public.merc_contracts (
  id            uuid primary key default gen_random_uuid(),
  employer_id   uuid not null references auth.users(id) on delete cascade,
  employer_name text not null default 'Survivor',
  merc_id       uuid references auth.users(id) on delete set null,
  merc_name     text,
  title         text not null,
  brief         text not null default '',
  manifest      jsonb not null,
  reward        bigint not null check (reward > 0 and reward <= 2000000),
  status        text not null default 'open'
                check (status in ('open', 'hired', 'settled', 'cancelled')),
  deadline_at   timestamptz,
  hired_at      timestamptz,
  settled_at    timestamptz,
  cancelled_at  timestamptz,
  eb_post_id    uuid,                       -- the Emergency Broadcast feed post
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists merc_contracts_open_idx     on public.merc_contracts (status, created_at desc);
create index if not exists merc_contracts_employer_idx on public.merc_contracts (employer_id, created_at desc);
create index if not exists merc_contracts_merc_idx     on public.merc_contracts (merc_id, created_at desc);

-- ⚠ reward <= 2000000 mirrors wallet_credit's c_max_single. A reward above it
--   could be CHARGED at post time and then refuse to CREDIT at settle, which
--   is the one shape of bug that eats a player's money outright. Refusing the
--   post is the only honest answer, so the ceiling lives here too.

-- ── 3. APPLICATIONS — the "services" side of the board ─────────────────────
create table if not exists public.merc_applications (
  id          bigint generated always as identity primary key,
  contract_id uuid not null references public.merc_contracts(id) on delete cascade,
  merc_id     uuid not null references auth.users(id) on delete cascade,
  merc_name   text not null default 'Survivor',
  pitch       text not null default '',
  status      text not null default 'pending'
              check (status in ('pending', 'accepted', 'declined', 'withdrawn')),
  created_at  timestamptz not null default now(),
  unique (contract_id, merc_id)
);
create index if not exists merc_applications_contract_idx on public.merc_applications (contract_id, created_at desc);
create index if not exists merc_applications_merc_idx     on public.merc_applications (merc_id, created_at desc);

-- ── 4. THE ESCROW LEDGER (append-only) ─────────────────────────────────────
-- Per CLAUDE.md: balance = sum(amount). Nothing here is ever UPDATEd and there
-- is no balance column to drift. `amount` is SIGNED — funding is positive,
-- release and refund are negative — so "what is still escrowed on this
-- contract" is one sum() and can never disagree with its own history.
create table if not exists public.merc_escrow (
  id          bigint generated always as identity primary key,
  contract_id uuid not null,               -- deliberately NOT a FK: deleting a
                                           -- contract must never erase money history
  kind        text   not null check (kind in ('fund', 'release', 'refund')),
  user_id     uuid   not null,             -- whose money moved
  amount      bigint not null check (amount <> 0),
  reason      text   not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists merc_escrow_contract_idx on public.merc_escrow (contract_id, created_at);
create index if not exists merc_escrow_user_idx     on public.merc_escrow (user_id, created_at desc);

-- ── 5. DELIVERIES (append-only) ────────────────────────────────────────────
-- One row per drop. The goods left the mercenary's stash CLIENT-SIDE before
-- the row was written (escrow-first, exactly as /src/trading does it), so a
-- failed insert is refunded by the caller — see merc.api.js deliver().
create table if not exists public.merc_deliveries (
  id          bigint generated always as identity primary key,
  contract_id uuid   not null references public.merc_contracts(id) on delete cascade,
  merc_id     uuid   not null,
  employer_id uuid   not null,
  kind        text   not null check (kind in ('res', 'card')),
  item_id     text   not null check (length(item_id) between 1 and 120),
  item_name   text   not null default '',
  qty         integer not null check (qty > 0 and qty <= 999999),
  created_at  timestamptz not null default now()
);
create index if not exists merc_deliveries_contract_idx on public.merc_deliveries (contract_id, created_at);

-- ── 6. CLAIMS (append-only; the INSERT is the lock) ────────────────────────
-- Same proven shape as resource_trade_claims (sql/019). A party collects
-- exactly once; a client that dies mid-collect simply collects next visit.
--   merc_cinder   → the mercenary takes the reward
--   employer_goods→ the employer takes the delivered manifest
--   merc_return   → a cancelled contract hands part-delivered goods back
create table if not exists public.merc_claims (
  contract_id uuid not null references public.merc_contracts(id) on delete cascade,
  party       text not null check (party in ('merc_cinder', 'employer_goods', 'merc_return')),
  claimed_by  uuid not null,
  claimed_at  timestamptz not null default now(),
  primary key (contract_id, party)
);

-- ── 7. BADGES ──────────────────────────────────────────────────────────────
-- 🎖 Public by design: the Emergency Broadcast site renders these on a
-- player's profile, so `anon` may read them. NOBODY may write them — there is
-- no insert/update/delete policy at all, and merc_award_badges() (SECURITY
-- DEFINER) is the only writer in existence. A badge you can award yourself is
-- not a badge.
create table if not exists public.merc_badges (
  user_id    uuid not null references auth.users(id) on delete cascade,
  badge_id   text not null,
  tier       integer not null default 1 check (tier between 1 and 3),
  meta       jsonb   not null default '{}'::jsonb,
  awarded_at timestamptz not null default now(),
  primary key (user_id, badge_id)
);
create index if not exists merc_badges_user_idx on public.merc_badges (user_id, awarded_at desc);

-- ── 8. RLS ─────────────────────────────────────────────────────────────────
-- 🔴 REVIEW EVERY LINE. RLS is the entire security boundary (CLAUDE.md).
alter table public.merc_profiles     enable row level security;
alter table public.merc_contracts    enable row level security;
alter table public.merc_applications enable row level security;
alter table public.merc_escrow       enable row level security;
alter table public.merc_deliveries   enable row level security;
alter table public.merc_claims       enable row level security;
alter table public.merc_badges       enable row level security;

-- Profiles: the hire board is public reading. You write only your own row, and
-- `with check` repeats the predicate so an UPDATE cannot hand the row away.
drop policy if exists mp_sel on public.merc_profiles;
create policy mp_sel on public.merc_profiles for select to anon, authenticated using (true);
drop policy if exists mp_ins on public.merc_profiles;
create policy mp_ins on public.merc_profiles for insert to authenticated with check (user_id = auth.uid());
drop policy if exists mp_upd on public.merc_profiles;
create policy mp_upd on public.merc_profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists mp_del on public.merc_profiles;
create policy mp_del on public.merc_profiles for delete to authenticated using (user_id = auth.uid());

-- Contracts: the OPEN board is public (that is what makes it a board); a
-- closed contract is visible only to its two parties.
-- ⚠ NO insert/update/delete policy. Every write goes through the RPCs below,
--   which are SECURITY DEFINER and therefore bypass RLS. A direct UPDATE from
--   a client matches zero rows — which is exactly how sql/019 closed the hole
--   that let anyone rewrite an open resource listing.
drop policy if exists mc_sel on public.merc_contracts;
create policy mc_sel on public.merc_contracts for select to anon, authenticated
  using (status = 'open' or employer_id = auth.uid() or merc_id = auth.uid());

-- Applications: the employer sees everyone who applied to THEIR contract; an
-- applicant sees only their own. Note the contract lookup is a subquery on
-- merc_contracts, NOT on merc_applications — a policy on a table that queries
-- itself is the recursion trap CLAUDE.md warns about.
drop policy if exists ma_sel on public.merc_applications;
create policy ma_sel on public.merc_applications for select to authenticated
  using (merc_id = auth.uid()
         or exists (select 1 from public.merc_contracts c
                     where c.id = contract_id and c.employer_id = auth.uid()));

-- Escrow + deliveries + claims: readable by the parties, writable by nobody.
drop policy if exists me_sel on public.merc_escrow;
create policy me_sel on public.merc_escrow for select to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.merc_contracts c
                     where c.id = contract_id
                       and (c.employer_id = auth.uid() or c.merc_id = auth.uid())));

drop policy if exists md_sel on public.merc_deliveries;
create policy md_sel on public.merc_deliveries for select to authenticated
  using (merc_id = auth.uid() or employer_id = auth.uid());

drop policy if exists mcl_sel on public.merc_claims;
create policy mcl_sel on public.merc_claims for select to authenticated
  using (claimed_by = auth.uid());

-- Badges: world-readable, so the Emergency Broadcast profile page can show
-- them to a logged-out visitor. Still no write policy for anyone.
drop policy if exists mb_sel on public.merc_badges;
create policy mb_sel on public.merc_badges for select to anon, authenticated using (true);

-- Belt and braces on top of "no policy": strip the table grants too, so a
-- future policy added in haste cannot open a write path by itself.
revoke insert, update, delete on public.merc_contracts    from anon, authenticated;
revoke insert, update, delete on public.merc_applications from anon, authenticated;
revoke insert, update, delete on public.merc_escrow       from anon, authenticated;
revoke insert, update, delete on public.merc_deliveries   from anon, authenticated;
revoke insert, update, delete on public.merc_claims       from anon, authenticated;
revoke insert, update, delete on public.merc_badges       from anon, authenticated;
grant select on public.merc_contracts, public.merc_applications, public.merc_escrow,
                public.merc_deliveries, public.merc_claims to authenticated;
grant select on public.merc_badges, public.merc_profiles to anon, authenticated;
grant select on public.merc_contracts to anon;   -- the open board, signed out

commit;

-- ============================================================================
-- 9. HELPERS
-- ============================================================================

-- Is this manifest something we are willing to be held to? Called by the post
-- RPC before a single Cinder moves.
create or replace function public.merc_manifest_ok(p_manifest jsonb)
returns boolean
language plpgsql immutable set search_path = public, pg_temp as $$
declare it jsonb; n integer;
begin
  if p_manifest is null or jsonb_typeof(p_manifest) <> 'array' then return false; end if;
  n := jsonb_array_length(p_manifest);
  if n < 1 or n > 12 then return false; end if;
  for it in select * from jsonb_array_elements(p_manifest) loop
    if jsonb_typeof(it) <> 'object' then return false; end if;
    if coalesce(it ->> 'kind', '') not in ('res', 'card') then return false; end if;
    if coalesce(length(it ->> 'id'), 0) not between 1 and 120 then return false; end if;
    -- ⚠ `is null or` is load-bearing. A manifest line with no qty key gives
    -- NULL here, and `NULL !~ …` is NULL, which IF treats as false — the line
    -- would sail through this check AND the range check below on the same NULL.
    if (it ->> 'qty') is null or (it ->> 'qty') !~ '^[0-9]+$' then return false; end if;
    if (it ->> 'qty')::bigint < 1 or (it ->> 'qty')::bigint > 999999 then return false; end if;
  end loop;
  return true;
end $$;

-- What is still owed on a contract, per manifest line. The single source of
-- truth for "is it done yet" — merc_deliver() and the UI both read this one
-- function, so the progress bar can never disagree with the payout.
create or replace function public.merc_outstanding(p_contract uuid)
returns table (kind text, item_id text, item_name text, want bigint, got bigint, still bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  with want as (
    select it ->> 'kind' as kind,
           it ->> 'id'   as item_id,
           coalesce(it ->> 'name', it ->> 'id') as item_name,
           sum((it ->> 'qty')::bigint) as want
      from public.merc_contracts c,
           lateral jsonb_array_elements(c.manifest) it
     where c.id = p_contract
       and (c.employer_id = auth.uid() or c.merc_id = auth.uid() or c.status = 'open')
     group by 1, 2, 3
  ), got as (
    select d.kind, d.item_id, sum(d.qty)::bigint as got
      from public.merc_deliveries d
     where d.contract_id = p_contract
     group by 1, 2
  )
  select w.kind, w.item_id, w.item_name, w.want,
         coalesce(g.got, 0),
         greatest(0, w.want - coalesce(g.got, 0))
    from want w left join got g on g.kind = w.kind and g.item_id = w.item_id
   order by w.kind, w.item_id
$$;

-- ============================================================================
-- 10. RPCs. Every one derives the actor from auth.uid() and NEVER trusts a
--     caller-supplied identity, amount or payout.
-- ============================================================================

-- ── REGISTER AS A MERCENARY ────────────────────────────────────────────────
create or replace function public.merc_register(
  p_label text default null,
  p_bio   text default '',
  p_rate  bigint default 0,
  p_tags  text[] default '{}',
  p_status text default 'open'
) returns public.merc_profiles
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); row public.merc_profiles;
begin
  if me is null then raise exception 'NOT_SIGNED_IN'; end if;
  if coalesce(p_status, 'open') not in ('open', 'busy', 'retired') then raise exception 'BAD_STATUS'; end if;
  insert into public.merc_profiles (user_id, label, bio, rate_hint, tags, status)
  values (me, left(coalesce(nullif(btrim(p_label), ''), 'Survivor'), 40),
          left(coalesce(p_bio, ''), 600),
          least(greatest(coalesce(p_rate, 0), 0), 100000000),
          coalesce(p_tags, '{}'), coalesce(p_status, 'open'))
  on conflict (user_id) do update
     set label = excluded.label, bio = excluded.bio, rate_hint = excluded.rate_hint,
         tags = excluded.tags, status = excluded.status, updated_at = now()
  returning * into row;
  return row;
end $$;

-- ⚠ RETURN TYPES CHANGED during development, and `create or replace function`
--   refuses to change a return type. These drops are what keep this file
--   re-runnable on a database where an earlier revision was already applied.
drop function if exists public.merc_post_contract(text,text,jsonb,bigint,integer,text);
drop function if exists public.merc_cancel_contract(uuid);
drop function if exists public.merc_claim(uuid,text);

-- ── POST A CONTRACT (the escrow happens HERE) ──────────────────────────────
-- One transaction: charge, contract, ledger, feed post. If any of it fails,
-- none of it happened — including the charge. That is the entire reason the
-- wallet_charge call lives inside this function instead of in the client.
create or replace function public.merc_post_contract(
  p_title    text,
  p_brief    text,
  p_manifest jsonb,
  p_reward   bigint,
  p_deadline_hours integer default 72,
  p_employer_name  text default null
) returns jsonb
-- 🔴 RETURNS jsonb, NOT the contract row. The escrow charge happens in here,
--    so the client's local Cinder mirror (Profile.gems) is stale the instant
--    this returns. index.html's own chargeCinderAtomic adopts three numbers
--    after a wallet_charge — new_balance, tax_amount and wallet_seq — and
--    skipping any of them is a documented way to lose a player's money on the
--    next boot (see the walletFetchProgress note in index.html). Handing them
--    back here lets /src/mercenary reuse that exact adoption path instead of
--    guessing, and costs no extra round trip.
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me    uuid := auth.uid();
  n     integer;
  chg   record;
  row   public.merc_contracts;
  v_post uuid;
begin
  if me is null then raise exception 'NOT_SIGNED_IN'; end if;
  if coalesce(btrim(p_title), '') = '' then raise exception 'BAD_TITLE'; end if;
  if not public.merc_manifest_ok(p_manifest) then raise exception 'BAD_MANIFEST'; end if;
  if p_reward is null or p_reward < 1 or p_reward > 2000000 then raise exception 'BAD_REWARD'; end if;
  if coalesce(p_deadline_hours, 72) < 1 or coalesce(p_deadline_hours, 72) > 720 then raise exception 'BAD_DEADLINE'; end if;

  -- Anti-spam, server side. The client enforces these too; the client is not
  -- the enforcement. (Same wording and same reason as sql/019.)
  select count(*) into n from public.merc_contracts where employer_id = me and status in ('open', 'hired');
  if n >= 10 then raise exception 'TOO_MANY_CONTRACTS'; end if;
  select count(*) into n from public.merc_contracts where employer_id = me and created_at > now() - interval '5 seconds';
  if n > 0 then raise exception 'TOO_FAST'; end if;

  -- 🔥 THE ESCROW. wallet_charge is SECURITY DEFINER and reads auth.uid()
  -- itself, which is still the employer inside this function, so it charges
  -- the right wallet and applies the 2% Foundation Tax that every other spend
  -- in the game pays. No new economy number is introduced here — CLAUDE.md.
  select * into chg from public.wallet_charge(p_reward, 'Mercenary contract escrow');
  if chg.ok is not true then
    raise exception 'ESCROW_FAILED:%', coalesce(chg.reason, 'insufficient');
  end if;

  insert into public.merc_contracts
    (employer_id, employer_name, title, brief, manifest, reward, status, deadline_at)
  values
    (me, left(coalesce(nullif(btrim(p_employer_name), ''), 'Survivor'), 40),
     left(btrim(p_title), 120), left(coalesce(p_brief, ''), 1200),
     p_manifest, p_reward, 'open', now() + make_interval(hours => coalesce(p_deadline_hours, 72)))
  returning * into row;

  insert into public.merc_escrow (contract_id, kind, user_id, amount, reason)
  values (row.id, 'fund', me, p_reward, 'Contract posted');

  -- 📡 EMERGENCY BROADCAST — the job goes out on the network feed, which is
  -- what makes this a public board rather than a private DM. Wrapped: the EB
  -- tables live with the mythicspellbook.xyz site and a missing one must cost
  -- the post its publicity, never the contract or the player's Cinder.
  begin
    insert into public.eb_posts (user_id, body, kind)
    values (me, '⚔ MERCENARY CONTRACT — ' || left(btrim(p_title), 120)
                || ' · reward ' || p_reward || ' Cinder. Apply in-game: Emergency Broadcast → Mercenaries.',
            'merc_job')
    returning id into v_post;
    update public.merc_contracts set eb_post_id = v_post where id = row.id;
    row.eb_post_id := v_post;
  exception when others then null;
  end;

  return jsonb_build_object(
    'contract',    to_jsonb(row),
    'new_balance', chg.new_balance,
    'tax_amount',  chg.tax_amount,
    'wallet_seq',  chg.wallet_seq);
end $$;

-- ── APPLY ──────────────────────────────────────────────────────────────────
create or replace function public.merc_apply(
  p_contract uuid,
  p_pitch    text default '',
  p_name     text default null
) returns public.merc_applications
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); c public.merc_contracts; app public.merc_applications; n integer;
begin
  if me is null then raise exception 'NOT_SIGNED_IN'; end if;
  select * into c from public.merc_contracts where id = p_contract;
  if not found then raise exception 'CONTRACT_GONE'; end if;
  if c.status <> 'open' then raise exception 'NOT_OPEN'; end if;
  if c.employer_id = me then raise exception 'OWN_CONTRACT'; end if;

  select count(*) into n from public.merc_applications
   where merc_id = me and created_at > now() - interval '3 seconds';
  if n > 0 then raise exception 'TOO_FAST'; end if;

  insert into public.merc_applications (contract_id, merc_id, merc_name, pitch)
  values (p_contract, me, left(coalesce(nullif(btrim(p_name), ''), 'Survivor'), 40),
          left(coalesce(p_pitch, ''), 600))
  on conflict (contract_id, merc_id) do update
     set pitch = excluded.pitch, status = 'pending', created_at = now()
  returning * into app;

  -- 📡 Tell the employer on Emergency Broadcast. Wrapped for the same reason
  -- as the feed post above.
  begin
    insert into public.eb_notifications (user_id, actor_id, kind, post_id, body)
    values (c.employer_id, me, 'merc_apply', c.eb_post_id,
            left(coalesce(nullif(btrim(p_name), ''), 'A mercenary'), 40)
            || ' applied to “' || c.title || '”.');
  exception when others then null;
  end;

  return app;
end $$;

create or replace function public.merc_withdraw_application(p_contract uuid)
returns public.merc_applications
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); app public.merc_applications;
begin
  if me is null then raise exception 'NOT_SIGNED_IN'; end if;
  update public.merc_applications set status = 'withdrawn'
   where contract_id = p_contract and merc_id = me and status = 'pending'
  returning * into app;
  if not found then raise exception 'NO_APPLICATION'; end if;
  return app;
end $$;

-- ── HIRE ───────────────────────────────────────────────────────────────────
create or replace function public.merc_hire(p_contract uuid, p_merc uuid)
returns public.merc_contracts
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); c public.merc_contracts; app public.merc_applications;
begin
  if me is null then raise exception 'NOT_SIGNED_IN'; end if;
  -- FOR UPDATE: two taps on Hire must not both win and leave the loser's
  -- application marked accepted on a contract someone else is working.
  select * into c from public.merc_contracts where id = p_contract for update;
  if not found then raise exception 'CONTRACT_GONE'; end if;
  if c.employer_id <> me then raise exception 'NOT_YOURS'; end if;
  if c.status <> 'open' then raise exception 'NOT_OPEN'; end if;
  if p_merc = me then raise exception 'CANNOT_HIRE_SELF'; end if;

  select * into app from public.merc_applications
   where contract_id = p_contract and merc_id = p_merc and status = 'pending';
  if not found then raise exception 'NO_APPLICATION'; end if;

  update public.merc_applications set status = 'accepted'
   where contract_id = p_contract and merc_id = p_merc;
  update public.merc_applications set status = 'declined'
   where contract_id = p_contract and merc_id <> p_merc and status = 'pending';

  update public.merc_contracts
     set merc_id = p_merc, merc_name = app.merc_name, status = 'hired',
         hired_at = now(), updated_at = now()
   where id = p_contract
  returning * into c;

  begin
    insert into public.eb_notifications (user_id, actor_id, kind, post_id, body)
    values (p_merc, me, 'merc_hired', c.eb_post_id,
            'You were hired for “' || c.title || '” — ' || c.reward || ' Cinder in escrow.');
  exception when others then null;
  end;

  return c;
end $$;

-- ── DELIVER (and settle, when the manifest is met) ─────────────────────────
-- p_items is [{"kind":"res"|"card","id":"...","name":"...","qty":n}].
--
-- 🔴 THE GOODS HAVE ALREADY LEFT THE MERCENARY'S STASH when this is called.
--    /src/mercenary deducts first and refunds if this throws — the same
--    escrow-first order /src/trading uses, and for the same reason: the only
--    alternative is writing the row first and discovering the player never had
--    the goods, which mints them out of nothing.
create or replace function public.merc_deliver(p_contract uuid, p_items jsonb)
returns table (status text, complete boolean, delivered integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me   uuid := auth.uid();
  c    public.merc_contracts;
  it   jsonb;
  k    text; iid text; nm text; q bigint;
  cnt  integer := 0;
  v_owed bigint;      -- ⚠ NOT `over`: that is a reserved word (window OVER)
  v_line bigint;
begin
  if me is null then raise exception 'NOT_SIGNED_IN'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'NOTHING_TO_DELIVER';
  end if;

  select * into c from public.merc_contracts where id = p_contract for update;
  if not found then raise exception 'CONTRACT_GONE'; end if;
  if c.merc_id is distinct from me then raise exception 'NOT_YOUR_JOB'; end if;
  if c.status <> 'hired' then raise exception 'NOT_HIRED'; end if;

  for it in select * from jsonb_array_elements(p_items) loop
    k   := it ->> 'kind';
    iid := it ->> 'id';
    nm  := left(coalesce(it ->> 'name', iid), 120);
    if k not in ('res', 'card') then raise exception 'BAD_KIND'; end if;
    if coalesce(length(iid), 0) not between 1 and 120 then raise exception 'BAD_ITEM'; end if;
    if (it ->> 'qty') is null or (it ->> 'qty') !~ '^[0-9]+$' then raise exception 'BAD_QTY'; end if;
    q := (it ->> 'qty')::bigint;
    if q < 1 or q > 999999 then raise exception 'BAD_QTY'; end if;

    -- ⚠ REFUSE OVER-DELIVERY rather than accepting it. A mercenary who ships
    --   200 Scrap against a 100 Scrap line would otherwise hand 100 units to
    --   the employer for free and have no way to get them back — the contract
    --   settles and the surplus has nowhere to go. Better to bounce the call
    --   and let the client refund the stash it already debited.
    select o.still into v_line from public.merc_outstanding(p_contract) o
     where o.kind = k and o.item_id = iid;
    if v_line is null then raise exception 'NOT_ON_MANIFEST:%', iid; end if;
    if q > v_line then raise exception 'OVER_DELIVERY:%', iid; end if;

    insert into public.merc_deliveries (contract_id, merc_id, employer_id, kind, item_id, item_name, qty)
    values (p_contract, me, c.employer_id, k, iid, nm, q::integer);
    cnt := cnt + 1;
  end loop;

  select coalesce(sum(o.still), 0) into v_owed from public.merc_outstanding(p_contract) o;

  if v_owed > 0 then
    return query select c.status, false, cnt; return;
  end if;

  -- 🎉 MANIFEST MET → the contract settles itself. See the header: the
  -- employer gets no veto over a delivery they specified themselves.
  update public.merc_contracts
     set status = 'settled', settled_at = now(), updated_at = now()
   where id = p_contract;

  insert into public.merc_escrow (contract_id, kind, user_id, amount, reason)
  values (p_contract, 'release', c.merc_id, -c.reward, 'Manifest delivered');

  perform public.merc_award_badges(me);

  begin
    insert into public.eb_notifications (user_id, actor_id, kind, post_id, body)
    values (c.employer_id, me, 'merc_delivered', c.eb_post_id,
            'Manifest delivered on “' || c.title || '”. Collect it in-game.');
    insert into public.eb_notifications (user_id, actor_id, kind, post_id, body)
    values (me, c.employer_id, 'merc_paid', c.eb_post_id,
            'Contract complete — ' || c.reward || ' Cinder released. Collect it in-game.');
  exception when others then null;
  end;

  return query select 'settled'::text, true, cnt;
end $$;

-- ── CANCEL ─────────────────────────────────────────────────────────────────
-- The employer can always cancel an OPEN contract. A HIRED one can only be
-- cancelled once its deadline has passed — otherwise "cancel" would be a way
-- to pull the reward out from under a mercenary who is halfway through the
-- haul. Anything already delivered goes back to the mercenary via a claim.
create or replace function public.merc_cancel_contract(p_contract uuid)
returns jsonb   -- same reason as merc_post_contract: the caller's mirror moved
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); c public.merc_contracts; v_bal bigint;
begin
  if me is null then raise exception 'NOT_SIGNED_IN'; end if;
  select * into c from public.merc_contracts where id = p_contract for update;
  if not found then raise exception 'CONTRACT_GONE'; end if;
  if c.employer_id <> me then raise exception 'NOT_YOURS'; end if;
  if c.status not in ('open', 'hired') then raise exception 'ALREADY_CLOSED'; end if;
  if c.status = 'hired' and c.deadline_at is not null and now() < c.deadline_at then
    raise exception 'DEADLINE_NOT_PASSED';
  end if;

  update public.merc_contracts
     set status = 'cancelled', cancelled_at = now(), updated_at = now()
   where id = p_contract
  returning * into c;
  update public.merc_applications set status = 'declined'
   where contract_id = p_contract and status = 'pending';

  insert into public.merc_escrow (contract_id, kind, user_id, amount, reason)
  values (p_contract, 'refund', me, -c.reward, 'Contract cancelled');

  -- The refund is immediate because the caller IS the employer — wallet_credit
  -- reads auth.uid() and its p_ref makes a double-cancel a no-op. Goods still
  -- go through a claim (they land in a client-side stash we cannot write).
  v_bal := public.wallet_credit(c.reward, 'Mercenary escrow refunded', 'merc:refund:' || p_contract::text);

  if c.merc_id is not null then
    begin
      insert into public.eb_notifications (user_id, actor_id, kind, post_id, body)
      values (c.merc_id, me, 'merc_cancelled', c.eb_post_id,
              '“' || c.title || '” was cancelled. Anything you already delivered is waiting to be collected.');
    exception when others then null;
    end;
  end if;

  return jsonb_build_object('contract', to_jsonb(c), 'new_balance', v_bal);
end $$;

-- ── WHAT IS WAITING FOR ME ─────────────────────────────────────────────────
-- Read-only, and shaped exactly like rl_claimable(): the CLIENT decides what
-- it can physically accept (a stash at its cap can accept nothing) and claims
-- only that, so a payout is never half-delivered and never silently clamped.
create or replace function public.merc_claimable()
returns table (contract_id uuid, party text, title text, counterparty text,
               reward bigint, items jsonb, settled_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  -- the mercenary's money
  select c.id, 'merc_cinder'::text, c.title, c.employer_name, c.reward, '[]'::jsonb, c.settled_at
    from public.merc_contracts c
   where c.merc_id = auth.uid() and c.status = 'settled'
     and not exists (select 1 from public.merc_claims k
                      where k.contract_id = c.id and k.party = 'merc_cinder')
  union all
  -- the employer's goods
  select c.id, 'employer_goods'::text, c.title, coalesce(c.merc_name, 'Mercenary'), 0::bigint,
         coalesce((select jsonb_agg(jsonb_build_object('kind', d.kind, 'id', d.item_id,
                                                       'name', d.item_name, 'qty', d.qty))
                     from public.merc_deliveries d where d.contract_id = c.id), '[]'::jsonb),
         c.settled_at
    from public.merc_contracts c
   where c.employer_id = auth.uid() and c.status = 'settled'
     and not exists (select 1 from public.merc_claims k
                      where k.contract_id = c.id and k.party = 'employer_goods')
  union all
  -- goods coming BACK to a mercenary whose contract was cancelled under them
  select c.id, 'merc_return'::text, c.title, c.employer_name, 0::bigint,
         coalesce((select jsonb_agg(jsonb_build_object('kind', d.kind, 'id', d.item_id,
                                                       'name', d.item_name, 'qty', d.qty))
                     from public.merc_deliveries d where d.contract_id = c.id), '[]'::jsonb),
         c.cancelled_at
    from public.merc_contracts c
   where c.merc_id = auth.uid() and c.status = 'cancelled'
     and exists (select 1 from public.merc_deliveries d where d.contract_id = c.id)
     and not exists (select 1 from public.merc_claims k
                      where k.contract_id = c.id and k.party = 'merc_return')
$$;

-- ── CLAIM (insert-once; the PK is the lock) ────────────────────────────────
-- Returns the row that was actually claimed, or nothing at all if this party
-- had already collected. "Nothing" is the correct answer to a double-tap: the
-- caller must treat an empty result as "already had it", never as an error to
-- retry, and never as a reason to grant the goods a second time.
create or replace function public.merc_claim(p_contract uuid, p_party text)
returns table (contract_id uuid, party text, reward bigint, items jsonb, new_balance bigint)
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); c public.merc_contracts; ins integer; v_bal bigint;
begin
  if me is null then raise exception 'NOT_SIGNED_IN'; end if;
  if p_party not in ('merc_cinder', 'employer_goods', 'merc_return') then raise exception 'BAD_PARTY'; end if;
  select * into c from public.merc_contracts where id = p_contract;
  if not found then raise exception 'CONTRACT_GONE'; end if;

  -- Authorise the party against the contract, not against what the caller says
  -- they are. Every one of these is "you are that side AND the contract is in
  -- the state that owes it".
  if p_party = 'merc_cinder' and not (c.merc_id = me and c.status = 'settled') then raise exception 'NOT_OWED'; end if;
  if p_party = 'employer_goods' and not (c.employer_id = me and c.status = 'settled') then raise exception 'NOT_OWED'; end if;
  if p_party = 'merc_return' and not (c.merc_id = me and c.status = 'cancelled') then raise exception 'NOT_OWED'; end if;

  -- ⚠ `on conflict on constraint`, NOT `on conflict (contract_id, party)`.
  --   This function's RETURNS TABLE declares output columns named contract_id
  --   and party, and plpgsql exposes those as VARIABLES — so a bare column
  --   reference in the conflict target raises "column reference is ambiguous"
  --   at runtime and every claim in the game starts failing. Exactly the trap
  --   wallet_charge documents about its own `wallet_seq`. Naming the primary
  --   key removes the ambiguity without renaming the client-facing columns.
  insert into public.merc_claims (contract_id, party, claimed_by)
  values (p_contract, p_party, me)
  on conflict on constraint merc_claims_pkey do nothing;
  get diagnostics ins = row_count;
  if ins = 0 then return; end if;   -- already collected — say nothing, grant nothing

  if p_party = 'merc_cinder' then
    -- Idempotent twice over: the claim PK above, and wallet_credit's own p_ref.
    v_bal := public.wallet_credit(c.reward, 'Mercenary contract payout', 'merc:pay:' || p_contract::text);
    return query select c.id, p_party, c.reward, '[]'::jsonb, v_bal;
    return;
  end if;

  return query
    select c.id, p_party, 0::bigint,
           coalesce((select jsonb_agg(jsonb_build_object('kind', d.kind, 'id', d.item_id,
                                                         'name', d.item_name, 'qty', d.qty))
                       from public.merc_deliveries d where d.contract_id = c.id), '[]'::jsonb),
           null::bigint;
end $$;

-- ============================================================================
-- 11. 🎖 BADGES
-- ============================================================================
-- Derived from contracts and deliveries — never from anything a player writes.
-- Tiers only ever go UP: a re-award of a tier already held is a no-op, so this
-- is safe to call on every settle, and safe to backfill by hand.
create or replace function public.merc_award_badges(p_user uuid)
returns setof public.merc_badges
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_jobs   bigint;
  v_cinder bigint;
  v_units  bigint;
  v_cards  bigint;
  v_early  bigint;
  v_tier   integer;
begin
  if p_user is null then return; end if;

  select count(*), coalesce(sum(c.reward), 0)
    into v_jobs, v_cinder
    from public.merc_contracts c
   where c.merc_id = p_user and c.status = 'settled';

  select coalesce(sum(d.qty) filter (where d.kind = 'res'), 0),
         coalesce(sum(d.qty) filter (where d.kind = 'card'), 0)
    into v_units, v_cards
    from public.merc_deliveries d
    join public.merc_contracts c on c.id = d.contract_id and c.status = 'settled'
   where d.merc_id = p_user;

  select count(*) into v_early
    from public.merc_contracts c
   where c.merc_id = p_user and c.status = 'settled'
     and c.deadline_at is not null and c.settled_at is not null
     and c.settled_at < c.deadline_at;

  -- ⚠ ONE ROW PER BADGE, tier carried in a column. The alternative — a row per
  --   tier — makes "which Runner are they" a max() everywhere it is read, and
  --   the EB profile would render three copies of the same badge.
  if v_jobs >= 1 then
    perform public._merc_badge(p_user, 'first_contract', 1, jsonb_build_object('jobs', v_jobs));
  end if;

  v_tier := case when v_jobs >= 100 then 3 when v_jobs >= 25 then 2 when v_jobs >= 5 then 1 else 0 end;
  if v_tier > 0 then perform public._merc_badge(p_user, 'runner', v_tier, jsonb_build_object('jobs', v_jobs)); end if;

  v_tier := case when v_units >= 1000000 then 3 when v_units >= 100000 then 2 when v_units >= 10000 then 1 else 0 end;
  if v_tier > 0 then perform public._merc_badge(p_user, 'quartermaster', v_tier, jsonb_build_object('units', v_units)); end if;

  v_tier := case when v_cards >= 250 then 3 when v_cards >= 50 then 2 when v_cards >= 10 then 1 else 0 end;
  if v_tier > 0 then perform public._merc_badge(p_user, 'archivist', v_tier, jsonb_build_object('cards', v_cards)); end if;

  v_tier := case when v_early >= 50 then 3 when v_early >= 20 then 2 when v_early >= 5 then 1 else 0 end;
  if v_tier > 0 then perform public._merc_badge(p_user, 'punctual', v_tier, jsonb_build_object('early', v_early)); end if;

  v_tier := case when v_cinder >= 10000000 then 3 when v_cinder >= 1000000 then 2 when v_cinder >= 100000 then 1 else 0 end;
  if v_tier > 0 then perform public._merc_badge(p_user, 'bankroll', v_tier, jsonb_build_object('cinder', v_cinder)); end if;

  return query select * from public.merc_badges where user_id = p_user;
end $$;

-- Award-or-promote one badge. Private helper; never granted to a client role.
create or replace function public._merc_badge(p_user uuid, p_badge text, p_tier integer, p_meta jsonb)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_new boolean := false; v_old integer;
begin
  select tier into v_old from public.merc_badges where user_id = p_user and badge_id = p_badge;
  insert into public.merc_badges (user_id, badge_id, tier, meta)
  values (p_user, p_badge, p_tier, coalesce(p_meta, '{}'::jsonb))
  on conflict (user_id, badge_id) do update
     set tier = greatest(public.merc_badges.tier, excluded.tier),
         meta = excluded.meta,
         awarded_at = case when excluded.tier > public.merc_badges.tier then now()
                           else public.merc_badges.awarded_at end;
  v_new := (v_old is null or p_tier > v_old);
  if v_new then
    begin
      insert into public.eb_notifications (user_id, actor_id, kind, body)
      values (p_user, p_user, 'merc_badge',
              '🎖 Mercenary badge earned: ' || p_badge || ' (tier ' || p_tier || ').');
    exception when others then null;
    end;
  end if;
end $$;

-- ── THE PUBLIC BOARD, for mythicspellbook.xyz ──────────────────────────────
-- 🔴 WHY THE COUNTS COME FROM A SECURITY DEFINER FUNCTION AND NOT FROM THE
--    VIEW'S OWN SUBQUERIES. They used to be plain subqueries over
--    merc_contracts. Under security_invoker that subquery obeys mc_sel, which
--    only shows a caller contracts that are OPEN or their own — so a settled
--    contract is invisible to everybody except its two parties, and the board
--    reported "0 jobs, 0 Cinder" for a mercenary with a hundred runs behind
--    them. Caught by running the view as `anon` in a throwaway Postgres; it
--    reads perfectly as the mercenary themselves, which is exactly why it
--    would have shipped.
--
--    So the aggregate is computed by a definer function that bypasses RLS and
--    can express NOTHING ELSE: two integers, and only for a player who has a
--    merc_profiles row — i.e. who chose to list themselves for hire. Someone
--    who never registered returns zeros no matter who asks.
create or replace function public.merc_public_stats(p_user uuid)
returns table (jobs_done bigint, cinder_earned bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(count(c.id), 0),
         coalesce(sum(c.reward), 0)
    from public.merc_profiles p
    left join public.merc_contracts c
           on c.merc_id = p.user_id and c.status = 'settled'
   where p.user_id = p_user
$$;

create or replace view public.merc_public_standing as
  select p.user_id,
         coalesce(e.handle, p.label) as handle,
         p.label, p.bio, p.rate_hint, p.tags, p.status,
         st.jobs_done,
         st.cinder_earned,
         (select coalesce(jsonb_agg(jsonb_build_object('id', b.badge_id, 'tier', b.tier)
                                     order by b.awarded_at), '[]'::jsonb)
            from public.merc_badges b where b.user_id = p.user_id)        as badges,
         p.updated_at
    from public.merc_profiles p
    left join public.eb_profiles e on e.user_id = p.user_id
    cross join lateral public.merc_public_stats(p.user_id) st;
-- ⚠ THE eb_profiles JOIN IS A DEPENDENCY, not a convenience. Under
--   security_invoker the view runs as the CALLER, so a signed-out visitor
--   needs SELECT on eb_profiles for this to return anything at all. Verified
--   against the live project: anon holds SELECT and the eb_prof_read policy is
--   `using (true)`. If that is ever tightened, drop the join and serve
--   p.label alone — do not "fix" it by turning security_invoker off, which
--   would hand the view every row merc_profiles' RLS is there to gate.

-- ⚠ security_invoker: without it the view runs as its OWNER and would leak
--   past merc_profiles' RLS. Every row it reads is world-readable anyway, so
--   this changes nothing today — it is here so that tightening a policy later
--   tightens the view with it, instead of silently not doing so.
alter view public.merc_public_standing set (security_invoker = on);
grant select on public.merc_public_standing to anon, authenticated;
grant execute on function public.merc_public_stats(uuid) to anon, authenticated;

-- ── GRANTS ─────────────────────────────────────────────────────────────────
revoke all on function public.merc_register(text,text,bigint,text[],text)          from public, anon;
revoke all on function public.merc_post_contract(text,text,jsonb,bigint,integer,text) from public, anon;
revoke all on function public.merc_apply(uuid,text,text)                            from public, anon;
revoke all on function public.merc_withdraw_application(uuid)                       from public, anon;
revoke all on function public.merc_hire(uuid,uuid)                                  from public, anon;
revoke all on function public.merc_deliver(uuid,jsonb)                              from public, anon;
revoke all on function public.merc_cancel_contract(uuid)                            from public, anon;
revoke all on function public.merc_claimable()                                      from public, anon;
revoke all on function public.merc_claim(uuid,text)                                 from public, anon;
revoke all on function public.merc_outstanding(uuid)                                from public, anon;
-- 🔴 The badge writers are NOT callable by a client, ever. They are invoked by
--    merc_deliver() inside the same transaction that settles the contract.
revoke all on function public.merc_award_badges(uuid)                               from public, anon, authenticated;
revoke all on function public._merc_badge(uuid,text,integer,jsonb)                  from public, anon, authenticated;

grant execute on function public.merc_register(text,text,bigint,text[],text)          to authenticated;
grant execute on function public.merc_post_contract(text,text,jsonb,bigint,integer,text) to authenticated;
grant execute on function public.merc_apply(uuid,text,text)                            to authenticated;
grant execute on function public.merc_withdraw_application(uuid)                       to authenticated;
grant execute on function public.merc_hire(uuid,uuid)                                  to authenticated;
grant execute on function public.merc_deliver(uuid,jsonb)                              to authenticated;
grant execute on function public.merc_cancel_contract(uuid)                            to authenticated;
grant execute on function public.merc_claimable()                                      to authenticated;
grant execute on function public.merc_claim(uuid,text)                                 to authenticated;
grant execute on function public.merc_outstanding(uuid)                                to authenticated;
grant execute on function public.merc_manifest_ok(jsonb)                               to authenticated;

-- ============================================================================
-- VERIFY
--
-- 0) Everything exists:
--
-- select (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
--          where n.nspname='public' and c.relname in
--          ('merc_profiles','merc_contracts','merc_applications','merc_escrow',
--           'merc_deliveries','merc_claims','merc_badges')) as tables,   -- expect 7
--        (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--          where n.nspname='public' and p.proname like 'merc%') as fns,   -- expect 13
--        to_regclass('public.merc_public_standing') as board_view;        -- not null
--
-- 1) RLS is on for all seven:
--
-- select relname, relrowsecurity from pg_class
--  where relname like 'merc\_%' and relkind = 'r'
--    and relnamespace = 'public'::regnamespace order by 1;
-- -> every row true
--
-- 2) Nobody can write a contract, an escrow row, a delivery or a badge directly:
--
-- select tablename, cmd, policyname from pg_policies
--  where schemaname='public' and tablename like 'merc\_%' order by 1,2;
-- -> merc_contracts / merc_escrow / merc_deliveries / merc_claims / merc_badges
--    have SELECT policies ONLY. merc_profiles has all four, each on user_id.
--
-- 3) A manifest the board must refuse:
--
-- select public.merc_manifest_ok('[]'::jsonb)                                as empty_no,
--        public.merc_manifest_ok('[{"kind":"gold","id":"x","qty":1}]')       as badkind_no,
--        public.merc_manifest_ok('[{"kind":"res","id":"scrap","qty":0}]')    as zero_no,
--        public.merc_manifest_ok('[{"kind":"res","id":"scrap","name":"Scrap","qty":100}]') as ok_yes;
-- -> false, false, false, true
--
-- 4) End to end, as two real accounts (run each block signed in as that user):
--
--    -- employer:
--    select id from public.merc_post_contract(
--      'Haul 100 Scrap', 'Camp Heights drop', 
--      '[{"kind":"res","id":"scrap","name":"Scrap","qty":100}]'::jsonb, 500, 24, 'Employer');
--    -- mercenary:
--    select * from public.merc_apply('<contract>', 'On it.', 'Merc');
--    -- employer:
--    select status from public.merc_hire('<contract>', '<merc uuid>');   -- 'hired'
--    -- mercenary (partial, then the rest):
--    select * from public.merc_deliver('<contract>', '[{"kind":"res","id":"scrap","qty":40}]');
--    -- -> complete = false
--    select * from public.merc_deliver('<contract>', '[{"kind":"res","id":"scrap","qty":60}]');
--    -- -> status 'settled', complete = true
--    select * from public.merc_claimable();      -- one merc_cinder row
--    select * from public.merc_claim('<contract>', 'merc_cinder');   -- reward = 500
--    select * from public.merc_claim('<contract>', 'merc_cinder');   -- ZERO ROWS. no second payout
--
-- 5) The attacks that must all fail:
--
--    select * from public.merc_deliver('<contract>', '[{"kind":"res","id":"scrap","qty":9999}]');
--    -- -> ERROR OVER_DELIVERY:scrap
--    select * from public.merc_claim('<someone elses contract>', 'merc_cinder');
--    -- -> ERROR NOT_OWED
--    update public.merc_contracts set reward = 2000000 where id = '<contract>';
--    -- -> UPDATE 0  (no update policy exists)
--    insert into public.merc_badges (user_id, badge_id, tier) values (auth.uid(), 'runner', 3);
--    -- -> ERROR permission denied for table merc_badges
--
-- 6) Escrow never disagrees with itself — every settled/cancelled contract
--    must net to exactly zero, and every open/hired one to its full reward:
--
-- select c.status, count(*), sum(e.bal) as escrow_total
--   from public.merc_contracts c
--   join lateral (select coalesce(sum(amount),0) bal from public.merc_escrow
--                  where contract_id = c.id) e on true
--  group by 1;
-- -> settled/cancelled: escrow_total = 0.  open/hired: = sum of their rewards.
-- ============================================================================
