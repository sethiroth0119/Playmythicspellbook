-- ═══════════════════════════════════════════════════════════════════════════
-- 015 · STADIUM EVENTS + THE PAYOUT LEDGER
--
-- The server half of /src/city/stadium.economy.js. Its whole job is the one
-- sentence the spec is emphatic about:
--
--     "Partial settlement is unacceptable: other players are being paid here."
--
-- So `stadium_settle_event` is ONE function, and a Postgres function body is
-- ONE transaction: either every row of a settlement lands or none of it does.
-- There is no loop that commits as it goes and no second RPC to "finish" a
-- settlement, because both are ways for a settlement to be half-done.
--
-- APPEND-ONLY, the same way corp_treasury and community_ledger are. Balance is
-- `sum(amount)`. There is no balance column, because a balance column is a
-- thing that can drift from its own history — and here the history is the only
-- evidence that somebody else's shop was paid.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 STATUS: THIS FILE HAS NEVER BEEN RUN. Read /src/city/stadium.city.js's
--    `postToServer` header before wiring it: nothing INSERTs `stadium_events`,
--    nothing SELECTs `stadium_payouts`, and node-city deliberately passes
--    `cloud: () => null`. Applying this file alone does not make a payout reach
--    another player; it makes the table that a claim path could one day read.
--
-- 🔴 WHAT r10 FIXED, and it was the reason this file was unshippable.
--    The r9 settle function inserted the client's payload verbatim: unbounded,
--    UNSIGNED `amount`, arbitrary `to_id`, no cross-check against the event
--    row. Two HTTP calls (insert a planned event, settle it with
--    `[{"kind":"ticket_revenue","toId":"<me>","amount":1e9}]`) minted a
--    billion Cinder into an append-only ledger, and
--    `{"kind":"spillover_payout","toId":"<rival>","amount":-5000000}`
--    permanently poisoned another player's `sum(amount)`. The header above
--    promised exactly that could not happen. It now cannot: see §4.
--
-- ⚖ THE LIMIT OF WHAT A SERVER CAN CHECK HERE, stated plainly rather than
--    implied. node-city's entire world — tiles, stock, buildings, coverage —
--    lives on the client and is saved as an opaque blob. There is no
--    server-side city, so the server CANNOT recompute a settlement from first
--    principles; it can only bound one. What it bounds, from the event row it
--    owns and from STADIUM_ECON's own published maxima:
--      · sign        — nothing but a `refund` may be negative, ever
--      · address     — every row must name a real user; gate revenue, the
--                      vendor fee and refunds may only be addressed to the host
--      · magnitude   — no row, and no per-kind subtotal, may exceed a ceiling
--                      derived from `attendance` (itself clamped to the seat
--                      count for the stadium's own level)
--      · arity       — one settlement per event, one row per (kind, building)
--    A dishonest host can still overstate a spillover payout to a confederate
--    WITHIN that ceiling. Closing that needs a server-side city model, which is
--    a different project. Do not read this file as claiming otherwise.
--
-- 🔑 `service_role` is NOT revoked below and carries BYPASSRLS in Supabase, so
--    the "WRITE: nobody" claim is about anon/authenticated — i.e. about every
--    client. A leaked service key writes anything; that is true of every table
--    in this project and is a key-handling problem, not an RLS one.
--
-- 🔴 RLS IS THE ENTIRE SECURITY BOUNDARY (CLAUDE.md). Every policy below was
--    written to answer one question: who may read this, and who may write it?
--      · stadium_events   — the host owns it. A settled event is readable by
--                           the host and by the PAYEES of that event, and by
--                           nobody else (r9 exposed every settled event's
--                           pricing to every authenticated user).
--                           WRITE: insert your own planned event; delete your
--                           own planned event. No UPDATE at all — retuning goes
--                           through the two setter RPCs so their clamps are
--                           rules and not suggestions.
--      · stadium_payouts  — READ: the host of the event, or the payee.
--                           WRITE: nobody. Not the host, not the payee. Only
--                           the SECURITY DEFINER function below, which is the
--                           only code that can prove the payout belongs to the
--                           event and fits inside its ceiling.
--    A payee-writable payout table is a self-service money printer. That is why
--    `revoke insert, update, delete` is not decoration here.
--
-- Idempotent and re-runnable. No 001-014 dependency.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. THE EVENT ─────────────────────────────────────────────────────────
create table if not exists public.stadium_events (
  id            uuid primary key default gen_random_uuid(),
  host_id       uuid not null references auth.users(id) on delete cascade,
  host_name     text,
  node_id       text,                       -- world node the stadium sits on
  stadium_key   text,                       -- "x,z" tile key inside that city
  stadium_lvl   int  not null default 1 check (stadium_lvl between 1 and 3),
  -- The settlement summary, so a dispute can be read without recomputing it.
  -- ⚠ r9 declared these and then never wrote them — they sat at 0/0/0 while the
  --   comment claimed otherwise, and they were host-writable, so any player
  --   could mint a public record of 2,147,483,647 attendance at satisfaction
  --   100. They are now written by `stadium_settle_event` and by nothing else,
  --   and `attendance` is bounded by the largest stadium in the game (8,000
  --   seats at level 3 — STADIUM_ECON.seats). The function clamps harder still,
  --   against this row's own `stadium_lvl`.
  attendance    int  not null default 0,
  satisfaction  int  not null default 0 check (satisfaction between 0 and 100),
  fulfilment    numeric not null default 0 check (fulfilment between 0 and 1),
  vendor_fee_pct int not null default 0 check (vendor_fee_pct between 0 and 25),
  -- Player-set pricing. jsonb rather than three columns because the tier list
  -- is TICKET_TIERS' business and adding a fourth tier must not be a migration.
  pricing       jsonb not null default '{}'::jsonb,
  markup_pct    int  not null default 240 check (markup_pct between 100 and 400),
  -- 'planned' → the prep phase.  'settled' → money moved and cannot move again.
  status        text not null default 'planned'
                  check (status in ('planned','settled','void')),
  settled_at    timestamptz,
  created_at    timestamptz not null default now()
);
-- Re-runnable on a database that already has the 'pre-pricing' shape of this
-- table. `add column if not exists` is the whole reason this file can be
-- pasted into the SQL editor twice without thinking about it.
alter table public.stadium_events add column if not exists pricing    jsonb not null default '{}'::jsonb;
alter table public.stadium_events add column if not exists markup_pct int   not null default 240;

-- 🔒 ATTENDANCE IS BOUNDED, because the payout ceiling in §4 is a function of
--    it. An unbounded attendance is an unbounded ceiling, which is no ceiling.
alter table public.stadium_events drop constraint if exists stadium_events_attendance_check;
alter table public.stadium_events drop constraint if exists stadium_events_attendance_ck;
alter table public.stadium_events add constraint stadium_events_attendance_ck
  check (attendance between 0 and 8000);

-- 🔒 PRICING HAS A SHAPE. r9 left `pricing jsonb` with no constraint at all,
--    which made `stadium_set_pricing`'s server-side 0.25x-4x clamp DECORATIVE:
--    a plain PostgREST `.update({pricing:{box:99999999}})` walked straight past
--    it. The UPDATE policy is gone now (see §3) and this is the belt to that
--    braces — the bounds are TICKET_TIERS' base prices × 0.25 and × 4.
--    A non-numeric value raises on the cast, which rejects the row. Fail closed.
alter table public.stadium_events drop constraint if exists stadium_events_pricing_ck;
alter table public.stadium_events add constraint stadium_events_pricing_ck check (
  jsonb_typeof(pricing) = 'object'
  and coalesce((pricing->>'standing')::numeric,  60) between  15 and  240
  and coalesce((pricing->>'seated')::numeric,   180) between  45 and  720
  and coalesce((pricing->>'box')::numeric,      650) between 163 and 2600
);

create index if not exists stadium_events_host on public.stadium_events (host_id, created_at desc);
create index if not exists stadium_events_node on public.stadium_events (node_id, created_at desc);

-- ─── 2. THE LEDGER ────────────────────────────────────────────────────────
-- One row per payment. `to_id` may be ANOTHER PLAYER — that is the point of the
-- table. `event_id` is not nullable: the spec requires every payout to carry
-- the event id "so any dispute can be audited", and a nullable column is a
-- column that will eventually be null.
create table if not exists public.stadium_payouts (
  id          bigserial primary key,
  event_id    uuid not null references public.stadium_events(id) on delete cascade,
  to_id       uuid references auth.users(id) on delete set null,
  to_name     text,
  kind        text not null
                check (kind in ('ticket_revenue','concession_revenue',
                                'spillover_payout','vendor_fee','refund')),
  amount      numeric not null,             -- Cinder. Signed: a refund is negative.
  amount_doc  numeric,                      -- the design pack's raw figure, for audit
  building_key text,
  memo        text,
  created_at  timestamptz not null default now()
);

-- 🔒 THE SIGN RULE, and it is the whole of the "steal a payout" fix.
--    `amount numeric` unconstrained in SIGN was an attack, not a rounding
--    concern: one settle call with a negative `spillover_payout` addressed to a
--    rival permanently poisons their `sum(amount)` in an append-only table that
--    by design has no UPDATE path to correct it. Only a `refund` is negative,
--    and §4 additionally requires a refund to be addressed to the host — you
--    may refund your own gate, you may not "refund" somebody else's balance.
alter table public.stadium_payouts drop constraint if exists stadium_payouts_sign_ck;
alter table public.stadium_payouts add constraint stadium_payouts_sign_ck check (
  (kind = 'refund' and amount < 0) or (kind <> 'refund' and amount > 0)
);
-- ⚠ WHY THERE IS NO `check (to_id is not null)` COLUMN CONSTRAINT, though an
--   unaddressed payout is meaningless: the FK is `on delete set null` so that
--   deleting a user does not delete the audit history of what they were paid.
--   A NOT NULL check would turn every account deletion into a constraint
--   violation. The requirement is enforced where it belongs — on the way IN,
--   in §4, which rejects any payload row without a `toId`. History may become
--   unaddressed; a payout may never be created unaddressed.

create index if not exists stadium_payouts_event on public.stadium_payouts (event_id);
create index if not exists stadium_payouts_to    on public.stadium_payouts (to_id, created_at desc);
-- 🔴 ONE ROW PER (event, kind, building). This is what makes a retry SAFE: a
--    settlement that half-succeeded at the network layer and is sent again
--    cannot double-pay, because the second insert collides. Combined with the
--    status guard below it is belt and braces, and both are wanted.
--    ⚠ Known snag: two payload rows of the same kind with no building_key (two
--      `refund` rows, say) abort the settlement with an opaque 23505.
--      stadium.economy.js emits at most one row per kind per building, so this
--      is unreachable from the shipped client — but a hand-built payload will
--      see it, and the error will not explain itself.
create unique index if not exists stadium_payouts_once
  on public.stadium_payouts (event_id, kind, coalesce(building_key, ''));

-- ─── 3. RLS ───────────────────────────────────────────────────────────────
alter table public.stadium_events  enable row level security;
alter table public.stadium_payouts enable row level security;

-- 🔎 SECURITY DEFINER helpers. A policy on stadium_payouts that needs to know
--    who hosted the event has to read stadium_events, and a policy on
--    stadium_events that needs to know who was paid has to read
--    stadium_payouts. Written as plain subqueries those two policies recurse
--    into each other and every query on either table errors. Routing both
--    lookups through definer functions bypasses RLS and therefore TERMINATES —
--    the same pattern CLAUDE.md prescribes for is_community_member.
create or replace function public.stadium_event_host(p_event_id uuid)
returns uuid language sql security definer stable set search_path = public as $$
  select host_id from public.stadium_events where id = p_event_id
$$;
revoke all on function public.stadium_event_host(uuid) from public, anon;
grant execute on function public.stadium_event_host(uuid) to authenticated;

-- "Was the CALLER paid out of this event?" Deliberately a boolean about
-- auth.uid() and not a list of payees: the r9 helper took an arbitrary uuid and
-- returned the host of ANY event including a private planned one, which is more
-- than any caller needed. A definer helper should answer the caller's question
-- and nothing wider.
create or replace function public.stadium_event_payee(p_event_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.stadium_payouts
     where event_id = p_event_id and to_id = auth.uid()
  )
$$;
revoke all on function public.stadium_event_payee(uuid) from public, anon;
grant execute on function public.stadium_event_payee(uuid) to authenticated;

-- EVENTS · read. The host always. Otherwise ONLY a player this event actually
-- paid, and only once it is settled.
-- ⚠ r9 was `host_id = auth.uid() or status = 'settled'`. The stated rationale —
--   "the payees must be able to see the event they were paid from" — justifies
--   exposure to PAYEES, and the policy granted it to every authenticated user
--   in the game: everyone could read everyone's pricing, markup, vendor fee,
--   node_id and stadium_key. Scoped to the rationale.
drop policy if exists sev_sel on public.stadium_events;
create policy sev_sel on public.stadium_events for select to authenticated
  using (host_id = auth.uid()
         or (status = 'settled' and public.stadium_event_payee(id)));

-- EVENTS · insert. Only in your own name. Only as 'planned'.
-- ⚠ `status = 'planned'` is load-bearing: without it a host could INSERT a row
--   that is already 'settled', and the settle function's "refuse if not
--   planned" guard would then be trivially bypassed in the other direction —
--   worse, a host could mint a settled event with an attendance and
--   satisfaction of their choosing and use it as a reputation record.
drop policy if exists sev_ins on public.stadium_events;
create policy sev_ins on public.stadium_events for insert to authenticated
  with check (host_id = auth.uid() and status = 'planned');

-- EVENTS · update. 🔴 NOBODY. There is deliberately no UPDATE policy any more.
-- ⚠ THE r9 BUG THIS REPLACES. `sev_upd` said, in its own comment, that the host
--   may retune "pricing, vendor fee, the event's own level — and nothing else,
--   ever". POSTGRES RLS HAS NO COLUMN GRANULARITY. A row-level UPDATE policy
--   permits every column of that row, so the host could rewrite `pricing`
--   (defeating stadium_set_pricing's clamp), `attendance` and `satisfaction`
--   (minting a settlement record), and anything else on the row. The comment
--   described an intent the mechanism could not express.
--   Retuning now goes exclusively through the two SECURITY DEFINER setters in
--   §5, which is what makes their clamps rules. The grant is revoked as well,
--   so the denial does not depend on this policy staying deleted.
drop policy if exists sev_upd on public.stadium_events;
revoke update on public.stadium_events from anon, authenticated;

-- EVENTS · delete. A planned event may be cancelled. A settled one is history.
drop policy if exists sev_del on public.stadium_events;
create policy sev_del on public.stadium_events for delete to authenticated
  using (host_id = auth.uid() and status = 'planned');

-- PAYOUTS · read. The host of the event (they need the full spillover report)
-- and the payee (they need to see what they were paid and why). Nobody else:
-- a third player has no business reading two other players' settlement.
drop policy if exists spo_sel on public.stadium_payouts;
create policy spo_sel on public.stadium_payouts for select to authenticated
  using (to_id = auth.uid() or public.stadium_event_host(event_id) = auth.uid());

-- PAYOUTS · write. NOBODY. Not even the host.
-- 🔴 There is deliberately NO insert/update/delete policy. With RLS enabled and
--    no policy, every such statement is denied — and the grants are revoked as
--    well so the denial does not depend on a policy file staying deleted. The
--    only writer is stadium_settle_event() below, which is SECURITY DEFINER and
--    therefore runs outside RLS.
revoke insert, update, delete on public.stadium_payouts from anon, authenticated;
-- ⚠ r9's second revoke here named stadium_payouts again — a no-op duplicate of
--   the line above it, sitting under a comment about stadium_events. The line
--   it meant to be is `revoke update on public.stadium_events`, which is issued
--   in the sev_upd block above where it belongs. The `delete` grant on
--   stadium_events is intentionally NOT revoked, so `sev_del` can still cancel
--   a planned event.

-- ─── 4. SETTLEMENT — ONE TRANSACTION, NO PARTIAL PAYOUTS ──────────────────
-- p_payload is the ledger array produced by stadium.economy.js `settleEvent`.
-- Each element: { kind, toId, toName, amount, amountDoc, memo, buildingKey }.
--
-- 🔴 THE FOUR THINGS THAT MAKE THIS ATOMIC, in order. They are body steps 1, 2,
--    4 and 5 — step 3 is the r10 validation block, which is about safety rather
--    than atomicity and is listed separately underneath:
--   1. `for update` on the event row. Two clients settling the same event race
--      to this lock; the loser then sees status='settled' and raises. Without
--      the lock both would read 'planned' and both would pay.
--   2. `if status <> 'planned' then raise` — the idempotency guard. A raise
--      inside a function aborts the whole function, which aborts its
--      transaction, which un-inserts anything already inserted.
--   3. `insert ... select` over the whole payload in ONE statement. There is no
--      loop, so there is no point at which half the rows exist and the next one
--      fails. A constraint violation on any element rejects all of them.
--   4. The status flip is the LAST statement. If anything above it raises, the
--      event is still 'planned' and can be settled again from scratch — which
--      is the correct recovery, not a half-paid event that can never be fixed.
-- Any exception at all propagates: this function does NOT swallow errors,
-- because a swallowed error here reads to the client as a successful
-- settlement that paid nobody.
--
-- 🔴 AND THE FIVE THINGS THAT MAKE IT SAFE, which r9 had none of. Every one is
--    checked BEFORE the insert and every one raises with the rule it broke:
--   A. addressed   — no row without a `toId`; gate revenue, vendor fee and
--                    refunds may only be addressed to the host
--   B. signed      — only a `refund` may be negative, and nothing may be zero
--   C. bounded     — no single row, and no per-kind subtotal, above a ceiling
--                    derived from this event's own clamped attendance
--   D. summarised  — attendance/satisfaction/fulfilment are written HERE from
--                    validated parameters, not accepted as host-written columns
--   E. finite      — the payload is length-capped
--
-- ⚠ SIGNATURE CHANGED at r10 (three new parameters). The old two-argument form
--   is dropped so the two do not coexist as overloads — an old client calling
--   the old shape must fail loudly, not silently settle without a summary.
drop function if exists public.stadium_settle_event(uuid, jsonb);

create or replace function public.stadium_settle_event(
  p_event_id     uuid,
  p_attendance   int,
  p_satisfaction int,
  p_fulfilment   numeric,
  p_payload      jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_ev     public.stadium_events%rowtype;
  v_rows   int;
  v_paid   numeric;
  v_seats  int;
  v_att    int;
  v_sat    int;
  v_ful    numeric;
  v_cap    numeric;
  v_n           int;
  v_unaddressed int;
  v_misdirected int;
  v_badsign     int;
  v_badkind     int;
  v_oversize    int;
  v_host_sum    numeric;
  v_spill_sum   numeric;
begin
  if v_uid is null then
    raise exception 'stadium_settle_event: not signed in';
  end if;

  -- 1 · lock the event. Also the authorisation check: only its host settles it.
  select * into v_ev from public.stadium_events where id = p_event_id for update;
  if not found then
    raise exception 'stadium_settle_event: no such event %', p_event_id;
  end if;
  if v_ev.host_id <> v_uid then
    raise exception 'stadium_settle_event: % does not host this event', v_uid;
  end if;

  -- 2 · idempotency. Settling twice is the failure mode that pays twice.
  if v_ev.status <> 'planned' then
    raise exception 'stadium_settle_event: event % is already %', p_event_id, v_ev.status;
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'array' then
    raise exception 'stadium_settle_event: payload must be a json array';
  end if;
  -- E · finite. Radius 6 Chebyshev is 168 tiles; 4 host rows on top. 200 is
  --     generous and it is a bound, which an unbounded array is not.
  if jsonb_array_length(p_payload) > 200 then
    raise exception 'stadium_settle_event: payload has % rows (max 200)', jsonb_array_length(p_payload);
  end if;

  -- 3 · D · THE SUMMARY, derived here from validated parameters. Attendance is
  --     clamped against the seat count for THIS event's stadium level
  --     (STADIUM_ECON.seats = 900 / 2600 / 8000) — the crowd cannot exceed the
  --     room, and everything below is a function of this number.
  v_seats := case v_ev.stadium_lvl when 1 then 900 when 2 then 2600 else 8000 end;
  v_att := greatest(0, least(coalesce(p_attendance, 0), v_seats));
  v_sat := greatest(0, least(coalesce(p_satisfaction, 0), 100));
  v_ful := greatest(0, least(coalesce(p_fulfilment, 0), 1));

  -- C · THE CEILING, and where it comes from. STADIUM_ECON's own published
  --     maxima, all applied at once even though they cannot co-occur:
  --       box seat at the 4x price cap            650 × 4     = 2600.0 raw 🔥
  --       concession spend at markup 400%, box mix 34 × 4 × 1.9 =  258.4 raw 🔥
  --       satisfaction revenue multiplier at 100                ×    1.25
  --       ÷ cinderDivisor 2000                                 =  1.7865 🔥/head
  --     so one attendee can be worth at most ~1.79 Cinder to the host, and the
  --     district's whole spillover is held to the same ceiling separately.
  --     For scale: a driven 3,222-attendee event paid the host 396 Cinder and
  --     the district 27, against a ceiling of 5,757 each. This is a bound, not
  --     a model — see the header's note on what a server can and cannot check.
  v_cap := ceil(v_att * 1.7865) + 1;

  -- A/B/C · validate the whole payload before a single row is written.
  select
    count(*),
    count(*) filter (where q.to_id is null),
    count(*) filter (where q.kind <> 'spillover_payout' and q.to_id is distinct from v_ev.host_id),
    count(*) filter (where (q.kind = 'refund') <> (q.amount < 0) or q.amount = 0),
    count(*) filter (where q.kind is null or q.kind not in
      ('ticket_revenue','concession_revenue','spillover_payout','vendor_fee','refund')),
    count(*) filter (where abs(q.amount) > v_cap),
    coalesce(sum(q.amount) filter (where q.kind <> 'spillover_payout'), 0),
    coalesce(sum(q.amount) filter (where q.kind =  'spillover_payout'), 0)
  into v_n, v_unaddressed, v_misdirected, v_badsign, v_badkind, v_oversize, v_host_sum, v_spill_sum
  from (
    select nullif(r->>'toId','')::uuid           as to_id,
           r->>'kind'                            as kind,
           coalesce((r->>'amount')::numeric, 0)  as amount
      from jsonb_array_elements(p_payload) as r
  ) q;

  if v_unaddressed > 0 then
    raise exception 'stadium_settle_event: % payout row(s) have no toId — a payout nobody can claim is not a payout', v_unaddressed;
  end if;
  if v_misdirected > 0 then
    raise exception 'stadium_settle_event: % row(s) of gate revenue / vendor fee / refund addressed to someone other than the host', v_misdirected;
  end if;
  if v_badkind > 0 then
    raise exception 'stadium_settle_event: % row(s) with an unknown kind', v_badkind;
  end if;
  if v_badsign > 0 then
    raise exception 'stadium_settle_event: % row(s) with a bad sign — only a refund may be negative, and no row may be zero', v_badsign;
  end if;
  if v_oversize > 0 then
    raise exception 'stadium_settle_event: % row(s) above the % Cinder ceiling for a % attendee event', v_oversize, v_cap, v_att;
  end if;
  if v_host_sum > v_cap or v_host_sum < -v_cap then
    raise exception 'stadium_settle_event: host total % is outside +/-% for a % attendee event', v_host_sum, v_cap, v_att;
  end if;
  if v_spill_sum < 0 or v_spill_sum > v_cap then
    raise exception 'stadium_settle_event: spillover total % is outside 0..% for a % attendee event', v_spill_sum, v_cap, v_att;
  end if;

  -- 4 · every row, in one statement.
  -- ⚠ `to_id` is resolved against auth.users by the FK. A payload naming a
  --    user id that does not exist fails the whole insert, which is correct:
  --    a settlement that silently drops one payee has quietly stolen from them.
  --    The casts here are the same ones the validation above ran, so a payload
  --    that survived validation cannot fail differently down here.
  insert into public.stadium_payouts
    (event_id, to_id, to_name, kind, amount, amount_doc, building_key, memo)
  select
    p_event_id,
    nullif(r->>'toId','')::uuid,
    left(coalesce(r->>'toName',''), 40),
    r->>'kind',
    coalesce((r->>'amount')::numeric, 0),
    coalesce((r->>'amountDoc')::numeric, 0),
    nullif(r->>'buildingKey',''),
    left(coalesce(r->>'memo',''), 200)
  from jsonb_array_elements(p_payload) as r;
  get diagnostics v_rows = row_count;

  select coalesce(sum(amount), 0) into v_paid
    from public.stadium_payouts
   where event_id = p_event_id and kind = 'spillover_payout';

  -- 5 · and only now is the event settled — with its summary, written from the
  --     clamped parameters and by nothing else.
  update public.stadium_events
     set status       = 'settled',
         settled_at   = now(),
         attendance   = v_att,
         satisfaction = v_sat,
         fulfilment   = v_ful
   where id = p_event_id;

  return jsonb_build_object('ok', true, 'rows', v_rows, 'payload_rows', v_n,
                            'spillover_paid', v_paid, 'attendance', v_att, 'ceiling', v_cap);
end $$;

revoke all on function public.stadium_settle_event(uuid, int, int, numeric, jsonb) from public, anon;
grant execute on function public.stadium_settle_event(uuid, int, int, numeric, jsonb) to authenticated;

-- ─── 5. THE TWO SETTERS THE SPEC NAMES ────────────────────────────────────
-- Both are host-only and both refuse a settled event. They are RPCs rather
-- than plain UPDATEs so the clamps live on the server — and since r10 removed
-- the UPDATE policy and revoked the UPDATE grant, they are now the ONLY way a
-- planned event changes. That is what turns the clamps from a suggestion into
-- a rule; in r9 they were neither, because `.update()` walked past them.
create or replace function public.stadium_set_pricing(p_event_id uuid, p_tiers jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_host uuid; v_status text; v_clean jsonb;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select host_id, status into v_host, v_status from public.stadium_events where id = p_event_id for update;
  if v_host is null then raise exception 'no such event'; end if;
  if v_host <> v_uid then raise exception 'not your event'; end if;
  if v_status <> 'planned' then raise exception 'event is already %', v_status; end if;
  if p_tiers is null or jsonb_typeof(p_tiers) <> 'object' then
    raise exception 'pricing must be a json object';
  end if;
  -- 🔴 THE 0.25x-4x CLAMP IS APPLIED HERE, on the server, against the SAME base
  --    prices TICKET_TIERS publishes (standing 60 / seated 180 / box 650).
  --    Anything not in the three known tiers is DROPPED rather than stored, so
  --    a hand-crafted RPC call cannot smuggle a fourth tier into the row.
  --    The same bounds are duplicated as a CHECK constraint in §1, so even a
  --    future code path that writes `pricing` directly cannot exceed them.
  select jsonb_object_agg(k, v) into v_clean from (
    select 'standing' as k,
           greatest(15,  least(240,  coalesce((p_tiers->>'standing')::numeric, 60)))  as v
    union all select 'seated',
           greatest(45,  least(720,  coalesce((p_tiers->>'seated')::numeric, 180)))
    union all select 'box',
           greatest(163, least(2600, coalesce((p_tiers->>'box')::numeric, 650)))
  ) t;
  update public.stadium_events set pricing = v_clean where id = p_event_id;
end $$;
revoke all on function public.stadium_set_pricing(uuid, jsonb) from public, anon;
grant execute on function public.stadium_set_pricing(uuid, jsonb) to authenticated;

create or replace function public.stadium_set_vendor_fee(p_event_id uuid, p_pct int)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_host uuid; v_status text;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select host_id, status into v_host, v_status from public.stadium_events where id = p_event_id for update;
  if v_host is null then raise exception 'no such event'; end if;
  if v_host <> v_uid then raise exception 'not your event'; end if;
  if v_status <> 'planned' then raise exception 'event is already %', v_status; end if;
  -- 🔴 THE CLAMP IS HERE, not in the slider. 0-25% is the design's whole
  --    "real business decision with no correct answer"; a 90% fee would make it
  --    a tax with one correct answer.
  update public.stadium_events
     set vendor_fee_pct = greatest(0, least(25, coalesce(p_pct, 0)))
   where id = p_event_id;
end $$;
revoke all on function public.stadium_set_vendor_fee(uuid, int) from public, anon;
grant execute on function public.stadium_set_vendor_fee(uuid, int) to authenticated;

-- ─── VERIFY ───────────────────────────────────────────────────────────────
-- ⚠ COUNT THEM. r9 asserted `policies = 6` when the file created 5, and the
--   mismatch survived into two documents because the query was never run. The
--   four policies are sev_sel, sev_ins, sev_del (stadium_events — there is
--   deliberately no sev_upd) and spo_sel (stadium_payouts). The five functions
--   are stadium_settle_event, stadium_set_pricing, stadium_set_vendor_fee,
--   stadium_event_host and stadium_event_payee. The three CHECK constraints
--   this file adds by name are the attendance bound, the pricing shape and the
--   payout sign rule — the ones doing the security work.
-- Expect: tables 2 · policies 4 · rpcs 5 · retry_guard 1 · guards 3 · no_upd 0
select
  (select count(*) from pg_tables where schemaname='public'
     and tablename in ('stadium_events','stadium_payouts'))                       as tables,
  (select count(*) from pg_policies where schemaname='public'
     and tablename in ('stadium_events','stadium_payouts'))                       as policies,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname in
       ('stadium_settle_event','stadium_set_pricing','stadium_set_vendor_fee',
        'stadium_event_host','stadium_event_payee'))                              as rpcs,
  (select count(*) from pg_indexes where schemaname='public'
     and indexname='stadium_payouts_once')                                        as retry_guard,
  (select count(*) from pg_constraint where conname in
       ('stadium_events_attendance_ck','stadium_events_pricing_ck',
        'stadium_payouts_sign_ck'))                                               as guards,
  (select count(*) from pg_policies where schemaname='public'
     and tablename='stadium_events' and cmd='UPDATE')                             as no_upd;
