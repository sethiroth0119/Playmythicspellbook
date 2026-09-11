-- ═══════════════════════════════════════════════════════════════════════════
-- 067 · THE MARKET NEVER VANISHES — history, and a refusal to destroy
--
-- ⚠ THIS FILE HAS NOT BEEN APPLIED. NOTHING IN IT HAS RUN ANYWHERE.
--   Nobody in the environment that wrote it can execute SQL against project
--   ktsiasyjusesawtrwrjc — no database connection, no service-role key, no
--   migration runner. Listings are being lost on the live server EXACTLY as
--   they were before this file existed, and stay that way until a human opens
--       https://supabase.com/dashboard/project/ktsiasyjusesawtrwrjc/sql/new
--   pastes this in, and clicks Run.
--
-- ── THE REPORT ─────────────────────────────────────────────────────────────
--   "Items that were in the player market have been removed. I said do not
--    remove anything that is added, anything saved — make sure it isn't
--    removed. Restore all items that were missing on the marketplace."
--
-- ── WHAT WAS FOUND, READING THE SHIPPED CODE AND THE SHIPPED RLS ───────────
--
--   1. 🔴 ANY SIGNED-IN PLAYER CAN REWRITE ANY LIVE LISTING. This is the one
--      that removes other people's items, and it needs no bug to fire — the
--      policy grants it:
--
--        create policy cml_upd on public.card_market_listings
--          for update to authenticated
--          using (status = 'open' or seller_id = auth.uid())
--          with check (true);
--
--      `using (status = 'open')` is EVERY live listing in the game, and
--      `with check (true)` places no limit on what the row may become. So one
--      account can flip another player's listing to status='sold' — it leaves
--      the board instantly and looks exactly like "my item was removed" — or
--      rewrite its price, its buyer, or its seller_id. The policy exists
--      because a BUYER has to be able to claim an open row (index.html:59797,
--      :59905, :59682 all UPDATE somebody else's listing), and a policy alone
--      cannot express "only this transition" because RLS cannot see OLD.
--      A trigger can. §2 is that trigger.
--
--   2. 🔴 EXPIRY IS A HARD DELETE, AND THE RETURN IS CLIENT-SIDE.
--      index.html:59669 — every time the market loads, the client finds its own
--      listings older than CARD_MARKET_TTL_MS (14 days) and DELETEs the row,
--      then hands the card back with _restoreCardCopy(). The row is destroyed
--      first and the item is re-granted second, in the browser, by a save that
--      may never be written. Close the tab in between and the listing is gone
--      from the database and the card is not in the collection. There is no
--      copy of the row anywhere. Same shape at :59694 for an auction that ends
--      with no bids.
--
--   3. Nothing else in this repo deletes a listing — no cron job, no admin
--      wipe, no cascade other than `on delete cascade` from auth.users (which
--      only fires if the ACCOUNT is deleted). Ruled out by search, not assumed.
--
-- ── WHAT THIS FILE DOES ────────────────────────────────────────────────────
--   §1 every version of every listing is kept forever, append-only, including
--      the version that was about to be deleted
--   §2 a write that is not a legal market transition is REFUSED, not archived-
--      and-allowed. Closes the hole in 1 without breaking the current client.
--   §3 `anon` cannot touch the table at all
--   §4 restore: what is recoverable is recovered, and what is not is NAMED
--   §5 the same archive treatment for resource_listings, if it exists
--
-- ⚠ DELETE IS DELIBERATELY STILL ALLOWED TO THE SELLER. Revoking it would
--   break the expiry path in 2 — the client only returns the card when the
--   delete reports a row — and an expired listing would then sit on the board
--   forever with the card locked inside it. The delete now copies the row to
--   history first, so the destructive half is gone while the client keeps
--   working unchanged. Making expiry a status flip is a CLIENT change and is
--   listed at the end of this file, not done here.
--
-- Idempotent and re-runnable. RLS ships in this file. Ends with a verify query.
-- Modelled on sql/064_cities_never_wipe.sql, which does this for cities.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 0. A shared admin test (062/064 create this; repeated so 067 can run alone)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.ms_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(lower(auth.jwt() ->> 'email'), '') in (
    'richaegisop@gmail.com', 'play@mythicsoa.com', 'dev@mythicspellbook.com');
$$;
revoke all on function public.ms_is_admin() from public;
grant execute on function public.ms_is_admin() to authenticated, anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- 0b. READ-ONLY DIAGNOSIS — run this section on its own FIRST if you want to
--     see the damage before changing anything. It writes nothing.
-- ═══════════════════════════════════════════════════════════════════════════
--   select status, count(*), min(created_at), max(created_at)
--     from public.card_market_listings group by status order by 2 desc;
--
--   -- listings that left the board but are still in the table: RECOVERABLE
--   select count(*) as sold_with_no_buyer
--     from public.card_market_listings
--    where status = 'sold' and buyer_id is null;
--
--   -- who is holding what
--   select seller_id, seller_name, status, count(*)
--     from public.card_market_listings group by 1,2,3 order by 4 desc limit 50;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. HISTORY — every version of every listing, forever
--
-- The trigger in §2 writes here BEFORE the row changes or disappears, so the
-- copy exists even when the change is one that gets refused later in the same
-- statement. Append-only by grant: nothing but the definer functions may
-- update or delete a history row.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.card_market_listings_history (
  hid           bigserial primary key,
  id            uuid not null,
  seller_id     uuid,
  seller_name   text,
  kind          text,
  card_id       text,
  card_json     jsonb,
  unit_json     jsonb,
  listing_type  text,
  currency      text,
  price         integer,
  starting_bid  integer,
  current_bid   integer,
  current_bidder_id uuid,
  buy_now_price integer,
  bid_history   jsonb,
  ends_at       timestamptz,
  buyer_id      uuid,
  status        text,
  paid_out      boolean,
  row_created   timestamptz,
  reason        text not null,           -- 'update' | 'delete' | 'seed' | 'restore'
  actor_id      uuid,                    -- who caused it (auth.uid() at the time)
  archived_at   timestamptz not null default now()
);
create index if not exists cmlh_id_idx     on public.card_market_listings_history (id, archived_at desc);
create index if not exists cmlh_seller_idx on public.card_market_listings_history (seller_id, archived_at desc);
create index if not exists cmlh_reason_idx on public.card_market_listings_history (reason, archived_at desc);

alter table public.card_market_listings_history enable row level security;

-- A player may read their own history (their listings, their purchases).
-- Admins read everything. Nobody writes through the API — only the triggers,
-- which run as definer.
drop policy if exists cmlh_sel on public.card_market_listings_history;
create policy cmlh_sel on public.card_market_listings_history
  for select to authenticated
  using (seller_id = auth.uid() or buyer_id = auth.uid() or public.ms_is_admin());

revoke insert, update, delete on public.card_market_listings_history from anon, authenticated;
revoke all on public.card_market_listings_history from anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. THE GUARD — archive first, then allow only a legal transition
--
-- RLS cannot express this: a policy sees only the NEW row, so it cannot say
-- "status may go open→sold but nothing else may move". A BEFORE trigger sees
-- OLD and NEW and can. The legal transitions below are exactly the ones the
-- shipped client performs, so applying this file changes nothing a player can
-- legitimately do and refuses everything else.
--
--   SELLER (or admin) may:  price, starting_bid, buy_now_price, ends_at,
--                           paid_out, status → 'cancelled' | 'sold' | 'open'
--   BUYER  may, and only in one of these two shapes:
--       CLAIM  status 'open' → 'sold', buyer_id = self
--              (current_bid / current_bidder_* may move with it — Buy Now
--               writes them in the same statement, index.html:59905)
--       BID    status stays 'open', current_bid strictly increases,
--              current_bidder_id = self, bid_history may grow
--   NOBODY may change: id, seller_id, kind, card_id, card_json, unit_json,
--                      listing_type, currency, created_at.
--      That list is the identity of the listing. A market where the seller of
--      a row can be rewritten is not a market.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.cml_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_admin boolean := public.ms_is_admin();
  v_seller boolean;
begin
  -- ── archive the outgoing version FIRST, whatever happens next ────────────
  insert into public.card_market_listings_history
    (id, seller_id, seller_name, kind, card_id, card_json, unit_json, listing_type,
     currency, price, starting_bid, current_bid, current_bidder_id, buy_now_price,
     bid_history, ends_at, buyer_id, status, paid_out, row_created, reason, actor_id)
  values
    (OLD.id, OLD.seller_id, OLD.seller_name, OLD.kind, OLD.card_id, OLD.card_json,
     OLD.unit_json, OLD.listing_type, OLD.currency, OLD.price, OLD.starting_bid,
     OLD.current_bid, OLD.current_bidder_id, OLD.buy_now_price, OLD.bid_history,
     OLD.ends_at, OLD.buyer_id, OLD.status, OLD.paid_out, OLD.created_at,
     lower(TG_OP), v_uid);

  if TG_OP = 'DELETE' then
    -- The row is now recoverable, so the delete may proceed. Only the seller
    -- can reach here at all (policy cml_del), and the client only fires it for
    -- an expired or bidless listing.
    return OLD;
  end if;

  v_seller := (v_uid is not null and v_uid = OLD.seller_id);

  -- ── identity is immutable for everyone, including the seller ─────────────
  if NEW.id            is distinct from OLD.id
     or NEW.seller_id  is distinct from OLD.seller_id
     or NEW.kind       is distinct from OLD.kind
     or NEW.card_id    is distinct from OLD.card_id
     or NEW.card_json  is distinct from OLD.card_json
     or NEW.unit_json  is distinct from OLD.unit_json
     or NEW.listing_type is distinct from OLD.listing_type
     or NEW.currency   is distinct from OLD.currency
     or NEW.created_at is distinct from OLD.created_at then
    raise exception 'market: a listing''s identity cannot be rewritten (id/seller/card/type)'
      using errcode = 'check_violation';
  end if;

  if v_admin or v_seller then
    return NEW;                       -- the owner may manage their own listing
  end if;

  -- ── from here down the writer is NOT the seller ──────────────────────────
  if v_uid is null then
    raise exception 'market: anonymous writes are not allowed' using errcode = 'check_violation';
  end if;

  -- CLAIM: open → sold, by the buyer, naming themselves
  if OLD.status = 'open' and NEW.status = 'sold' and NEW.buyer_id = v_uid then
    if NEW.price is distinct from OLD.price
       or NEW.starting_bid  is distinct from OLD.starting_bid
       or NEW.buy_now_price is distinct from OLD.buy_now_price
       or NEW.ends_at       is distinct from OLD.ends_at
       or NEW.paid_out      is distinct from OLD.paid_out then
      raise exception 'market: a buyer may not change the terms while buying'
        using errcode = 'check_violation';
    end if;
    return NEW;
  end if;

  -- BID: stays open, the bid goes UP, the bidder names themselves
  if OLD.status = 'open' and NEW.status = 'open'
     and NEW.buyer_id is not distinct from OLD.buyer_id
     and NEW.current_bidder_id = v_uid
     and coalesce(NEW.current_bid, 0) > coalesce(OLD.current_bid, 0) then
    if NEW.price is distinct from OLD.price
       or NEW.starting_bid  is distinct from OLD.starting_bid
       or NEW.buy_now_price is distinct from OLD.buy_now_price
       or NEW.ends_at       is distinct from OLD.ends_at
       or NEW.paid_out      is distinct from OLD.paid_out then
      raise exception 'market: a bidder may not change the terms while bidding'
        using errcode = 'check_violation';
    end if;
    return NEW;
  end if;

  -- Anything else by a non-seller is the hole this file closes.
  raise exception 'market: only the seller may change this listing (attempted % → %)',
        OLD.status, NEW.status
    using errcode = 'check_violation';
end $$;

revoke all on function public.cml_guard() from public, anon, authenticated;

drop trigger if exists cml_guard_upd on public.card_market_listings;
create trigger cml_guard_upd
  before update on public.card_market_listings
  for each row execute function public.cml_guard();

drop trigger if exists cml_guard_del on public.card_market_listings;
create trigger cml_guard_del
  before delete on public.card_market_listings
  for each row execute function public.cml_guard();

-- Tighten what is left of the policy. The trigger is the real enforcement —
-- this only stops `anon` and keeps the surface honest.
revoke all on public.card_market_listings from anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. RESTORE
--
-- 🔴 READ THIS BEFORE RUNNING ANYTHING IN §3.
--   What can be recovered depends entirely on whether the row still exists:
--
--   RECOVERABLE NOW — the row is in the table but off the board. A listing
--     flipped to 'sold' by somebody who never paid for it, or a status this
--     file's guard would now refuse. §3a finds them; §3b re-opens them.
--
--   RECOVERABLE ONLY IF IT WAS ARCHIVED — history starts the moment this file
--     is applied. A row hard-deleted last week was never copied anywhere and
--     is NOT in it. §3c restores from history for everything after today.
--
--   NOT RECOVERABLE HERE — rows hard-deleted before this file was applied.
--     There is no backup table for the market (cities have one,
--     city_state_backup_20260825; the market never got one). The only route
--     is Supabase Point-in-Time Recovery:
--       Dashboard → Database → Backups → Point in Time
--     restore to a timestamp before the loss into a CLONE, then copy the rows
--     out of the clone. Do not PITR the live project over the top of itself —
--     that would roll every other table back with it.
--     If PITR is not enabled on this plan, those rows are gone, and saying so
--     is better than pretending a function can bring them back.
-- ═══════════════════════════════════════════════════════════════════════════

-- 3a. WHAT IS SITTING THERE, RECOVERABLE, RIGHT NOW (read-only)
create or replace function public.cml_recoverable()
returns table (id uuid, seller_id uuid, seller_name text, card_id text,
               status text, buyer_id uuid, paid_out boolean, created_at timestamptz, why text)
language sql stable security definer set search_path = public as $$
  select l.id, l.seller_id, l.seller_name, l.card_id, l.status, l.buyer_id,
         l.paid_out, l.created_at,
         case
           when l.status = 'sold' and l.buyer_id is null
             then 'left the board with no buyer — nobody bought this'
           when l.status not in ('open','sold','cancelled')
             then 'unknown status: ' || coalesce(l.status,'(null)')
           else 'off the board'
         end
    from public.card_market_listings l
   where l.status <> 'open'
   order by l.created_at desc;
$$;
revoke all on function public.cml_recoverable() from public, anon;
grant execute on function public.cml_recoverable() to authenticated;

-- 3b. PUT THEM BACK ON THE BOARD.
--     Only touches rows that left with NO buyer — a genuine sale is left alone.
--     Admin-only, and it is itself archived by the guard, so an unwanted
--     restore can be undone from history.
create or replace function public.cml_restore_unsold()
returns table (restored integer, skipped integer)
language plpgsql security definer set search_path = public as $$
declare v_restored integer := 0;
begin
  if not public.ms_is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;
  update public.card_market_listings
     set status = 'open', buyer_id = null
   where status = 'sold' and buyer_id is null;
  get diagnostics v_restored = row_count;
  return query select v_restored,
    (select count(*)::integer from public.card_market_listings
      where status = 'sold' and buyer_id is not null);
end $$;
revoke all on function public.cml_restore_unsold() from public, anon, authenticated;
grant execute on function public.cml_restore_unsold() to authenticated;   -- gated inside

-- 3c. RESURRECT A SPECIFIC LISTING FROM HISTORY (works for anything archived
--     after this file is applied). Re-inserts the newest archived version.
create or replace function public.cml_restore_from_history(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare h public.card_market_listings_history;
begin
  if not public.ms_is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.card_market_listings where id = p_id) then
    return 'still present — nothing to restore';
  end if;
  select * into h from public.card_market_listings_history
   where id = p_id order by archived_at desc limit 1;
  if h.hid is null then
    return 'no archived copy — this row predates the history table (see §3, PITR)';
  end if;
  insert into public.card_market_listings
    (id, seller_id, seller_name, kind, card_id, card_json, unit_json, listing_type,
     currency, price, starting_bid, current_bid, current_bidder_id, buy_now_price,
     bid_history, ends_at, buyer_id, status, paid_out, created_at)
  values
    (h.id, h.seller_id, h.seller_name, h.kind, h.card_id, h.card_json, h.unit_json,
     h.listing_type, h.currency, h.price, h.starting_bid, h.current_bid,
     h.current_bidder_id, h.buy_now_price, h.bid_history, h.ends_at, h.buyer_id,
     'open', h.paid_out, h.created_at);
  return 'restored from ' || h.archived_at::text;
end $$;
revoke all on function public.cml_restore_from_history(uuid) from public, anon, authenticated;
grant execute on function public.cml_restore_from_history(uuid) to authenticated;  -- gated inside

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. THE RESOURCE MARKET, same treatment — only if that table exists.
--    Guarded so this file runs on a project that never created it.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
begin
  if to_regclass('public.resource_listings') is not null then
    execute $sql$
      create table if not exists public.resource_listings_history (
        hid bigserial primary key,
        row_id uuid,
        payload jsonb not null,
        reason text not null,
        actor_id uuid,
        archived_at timestamptz not null default now()
      );
      alter table public.resource_listings_history enable row level security;
      revoke insert, update, delete on public.resource_listings_history from anon, authenticated;

      create or replace function public.reslisting_archive()
      returns trigger language plpgsql security definer set search_path = public as $fn$
      begin
        insert into public.resource_listings_history (row_id, payload, reason, actor_id)
        values ((to_jsonb(OLD) ->> 'id')::uuid, to_jsonb(OLD), lower(TG_OP), auth.uid());
        -- 🔴 BEFORE UPDATE writes the row it returns. `return OLD` here made every
        --    update to resource_listings a silent no-op (expiry, cancel and sale
        --    never stuck; refunds repeated on every sweep). See sql/113.
        if TG_OP = 'DELETE' then return OLD; end if;
        return NEW;
      end $fn$;

      drop trigger if exists reslisting_archive_upd on public.resource_listings;
      create trigger reslisting_archive_upd before update on public.resource_listings
        for each row execute function public.reslisting_archive();
      drop trigger if exists reslisting_archive_del on public.resource_listings;
      create trigger reslisting_archive_del before delete on public.resource_listings
        for each row execute function public.reslisting_archive();
    $sql$;
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY — every line should read want = got
-- ═══════════════════════════════════════════════════════════════════════════
select 'history table exists' as check,
       (to_regclass('public.card_market_listings_history') is not null)::text as got,
       'true' as want
union all
select 'guard armed on UPDATE',
       (select count(*)::text from pg_trigger
         where tgrelid = 'public.card_market_listings'::regclass and tgname = 'cml_guard_upd'), '1'
union all
select 'guard armed on DELETE',
       (select count(*)::text from pg_trigger
         where tgrelid = 'public.card_market_listings'::regclass and tgname = 'cml_guard_del'), '1'
union all
select 'anon can write listings',
       has_table_privilege('anon','public.card_market_listings','UPDATE')::text, 'false'
union all
select 'listings off the board, recoverable now',
       (select count(*)::text from public.card_market_listings where status <> 'open'), 'run cml_recoverable() to see them'
union all
select 'open listings on the board',
       (select count(*)::text from public.card_market_listings where status = 'open'), 'the market as players see it';

-- ═══════════════════════════════════════════════════════════════════════════
-- AFTER APPLYING — the two client changes this file deliberately does NOT make
--
--   1. index.html:59669 / :59694 — expiry and bidless-auction reclaim should
--      become `update status='cancelled'` + return, not DELETE + return. The
--      guard makes the delete non-destructive today, but a listing that is
--      cancelled instead of deleted can be shown back to the seller as
--      "returned to you" and audited. That is a code change, not SQL.
--   2. CARD_MARKET_TTL_MS is 14 days (index.html:59562). If the report is
--      "my listing disappeared" and the listing was two weeks old, that is
--      this constant working as designed — decide whether 14 days is the
--      policy you want before treating it as a bug.
-- ═══════════════════════════════════════════════════════════════════════════
