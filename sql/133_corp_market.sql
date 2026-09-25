/* ═══════════════════════════════════════════════════════════════════════════
   133 — THE CORPORATION MARKET (v121v121)

   The Crash Exchange's OPERATIONS desk lists every player corporation and lets
   anyone buy a stake in one. Two things have to cross a privacy line to do it,
   and exactly two things are allowed through:

   🔴 corp_treasury and corp_vault are MEMBERS-ONLY BY POLICY (sql/046, applied:
      ct_sel / cv_sel are is_corp_member(...)). A rival's ledger must stay
      unreadable. corp_market_list() is SECURITY DEFINER and returns ONLY
      AGGREGATES — a balance, a weekly change, a unit count, a member count.
      No row, no note, no depositor, no item is ever exposed. That is the same
      bargain a real market makes: you see the published figures, not the books.

   🔴 Shares are HELD SERVER-SIDE (corp_shares) so the float is shared: what
      everyone else owns is what makes a stake dear. A holder reads their own
      rows; the float is published per corp by corp_share_float(), again as an
      aggregate. Cinder still moves through the client wallet the way every
      other Crash Exchange trade does — this file deliberately does NOT invent
      a second wallet authority (see sql/107 for the one that exists).

   Apply in the Supabase SQL editor (project ktsiasyjusesawtrwrjc).
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── the float ────────────────────────────────────────────────────────────── */
create table if not exists public.corp_shares (
  corp_id    uuid        not null references public.corporations(id) on delete cascade,
  holder_id  uuid        not null references auth.users(id)          on delete cascade,
  qty        integer     not null default 0 check (qty >= 0),
  avg_cost   numeric     not null default 0 check (avg_cost >= 0),
  updated_at timestamptz not null default now(),
  primary key (corp_id, holder_id)
);
create index if not exists corp_shares_holder_idx on public.corp_shares(holder_id);
alter table public.corp_shares enable row level security;

/* A holder reads and writes their OWN rows only. The float that everyone
   trades against is published through corp_share_float(), not through this
   table — nobody gets a cap table of who owns what. */
drop policy if exists cs_sel on public.corp_shares;
create policy cs_sel on public.corp_shares for select to authenticated using (holder_id = auth.uid());
drop policy if exists cs_ins on public.corp_shares;
create policy cs_ins on public.corp_shares for insert to authenticated with check (holder_id = auth.uid());
drop policy if exists cs_upd on public.corp_shares;
create policy cs_upd on public.corp_shares for update to authenticated using (holder_id = auth.uid()) with check (holder_id = auth.uid());
drop policy if exists cs_del on public.corp_shares;
create policy cs_del on public.corp_shares for delete to authenticated using (holder_id = auth.uid());

/* ── what the desk may publish about a corporation ────────────────────────── */
create or replace function public.corp_market_list()
returns table (
  corp_id        uuid,
  name           text,
  tag            text,
  faction        text,
  element        text,
  founded_at     timestamptz,
  members        integer,
  treasury       numeric,     -- cinder on hand, now
  treasury_7d    numeric,     -- cinder on hand a week ago
  inflow_7d      numeric,     -- cinder paid in over the week
  outflow_7d     numeric,     -- cinder paid out over the week (positive number)
  vault_units    numeric,     -- resource units held
  vault_kinds    integer,     -- distinct resources held
  ops_active     integer,     -- operations running
  last_move_at   timestamptz, -- newest treasury row
  float_held     integer      -- shares held by all players
)
language sql
security definer
set search_path = public
stable
as $$
  with tre as (
    select corp_id,
           coalesce(sum(amount), 0)                                                          as bal,
           coalesce(sum(amount) filter (where created_at < now() - interval '7 days'), 0)    as bal_7d,
           coalesce(sum(amount) filter (where amount > 0 and created_at >= now() - interval '7 days'), 0) as inflow,
           coalesce(-sum(amount) filter (where amount < 0 and created_at >= now() - interval '7 days'), 0) as outflow,
           max(created_at)                                                                    as last_at
      from public.corp_treasury group by corp_id
  ), vlt as (
    select corp_id, coalesce(sum(qty), 0) as units, count(distinct item_id)::int as kinds
      from public.corp_vault group by corp_id
  ), mem as (
    select corp_id, count(*)::int as n from public.corp_members group by corp_id
  ), ops as (
    select corp_id, count(*)::int as n from public.corp_operations where coalesce(status, '') <> 'ended' group by corp_id
  ), flt as (
    select corp_id, coalesce(sum(qty), 0)::int as held from public.corp_shares group by corp_id
  )
  select c.id, c.name, c.tag, c.faction, c.element, c.created_at,
         coalesce(mem.n, 0),
         coalesce(tre.bal, 0), coalesce(tre.bal_7d, 0), coalesce(tre.inflow, 0), coalesce(tre.outflow, 0),
         coalesce(vlt.units, 0), coalesce(vlt.kinds, 0),
         coalesce(ops.n, 0),
         tre.last_at,
         coalesce(flt.held, 0)
    from public.corporations c
    left join tre on tre.corp_id = c.id
    left join vlt on vlt.corp_id = c.id
    left join mem on mem.corp_id = c.id
    left join ops on ops.corp_id = c.id
    left join flt on flt.corp_id = c.id
   order by coalesce(tre.bal, 0) desc, c.created_at asc
   limit 400;
$$;
revoke all on function public.corp_market_list() from public;
grant execute on function public.corp_market_list() to authenticated;

/* The float alone, for a repaint that does not need the whole desk. */
create or replace function public.corp_share_float(p_corp_id uuid)
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(sum(qty), 0)::int from public.corp_shares where corp_id = p_corp_id;
$$;
revoke all on function public.corp_share_float(uuid) from public;
grant execute on function public.corp_share_float(uuid) to authenticated;

/* ── a trade ──────────────────────────────────────────────────────────────── */
/* Buys and sells of a stake. p_qty > 0 buys, p_qty < 0 sells. The CINDER leg
   is the client wallet's, exactly as it is for every other Crash Exchange
   trade (public/index.html _cxExecuteBuy) — this function owns the SHARE leg
   and nothing else, so it can never be used to mint or burn currency. It
   refuses a sale of shares the holder does not have, which is the one thing
   the client must not be trusted with. */
create or replace function public.corp_share_trade(p_corp_id uuid, p_qty integer, p_px numeric)
returns table (qty integer, avg_cost numeric, float_held integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_have integer := 0;
  v_cost numeric := 0;
  v_new  integer;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_qty = 0 then raise exception 'no quantity'; end if;
  if abs(p_qty) > 100000 then raise exception 'order too large'; end if;
  if p_px is null or p_px <= 0 then raise exception 'no price'; end if;
  if not exists (select 1 from public.corporations where id = p_corp_id) then raise exception 'no such corporation'; end if;

  select qty, avg_cost into v_have, v_cost from public.corp_shares
   where corp_id = p_corp_id and holder_id = v_uid for update;
  v_have := coalesce(v_have, 0); v_cost := coalesce(v_cost, 0);
  v_new := v_have + p_qty;
  if v_new < 0 then raise exception 'you hold % shares', v_have; end if;

  insert into public.corp_shares (corp_id, holder_id, qty, avg_cost, updated_at)
  values (p_corp_id, v_uid, v_new,
          case when p_qty > 0 and v_new > 0 then ((v_have * v_cost) + (p_qty * p_px)) / v_new else v_cost end,
          now())
  on conflict (corp_id, holder_id) do update
    set qty = excluded.qty, avg_cost = excluded.avg_cost, updated_at = now();

  return query
    select cs.qty, cs.avg_cost, public.corp_share_float(p_corp_id)
      from public.corp_shares cs where cs.corp_id = p_corp_id and cs.holder_id = v_uid;
end;
$$;
revoke all on function public.corp_share_trade(uuid, integer, numeric) from public;
grant execute on function public.corp_share_trade(uuid, integer, numeric) to authenticated;
