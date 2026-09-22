-- ════════════════════════════════════════════════════════════════════════════
-- 190 · THE STASH MERGES ON THE SERVER — two devices can no longer overwrite
--       each other's resource ledger (forge.__salvage__)
--
-- ── THE BUG ───────────────────────────────────────────────────────────────
--
--   cloudSyncProfile() upserts the WHOLE user_profiles row, and the resource
--   ledger rides inside it as forge.__salvage__. With two devices open (phone
--   + desktop, browser + desktop app) the last writer wins the whole map:
--     • bug-mu8vnos5 — "bought 4-5 stacks of 100 ammo, Cinder taken, no ammo":
--       the buy credited the ledger on device A and uploaded; device B, idle
--       with its stale ledger, uploaded next and put the old count back.
--     • bug-mu83ph17 — donated resources came back: the reverse direction.
--   The client stop-gap (7dc274b0, Profile.salvageAt) lets the NEWEST ledger
--   win by device clock. That stops items coming back, but a device whose
--   clock runs ahead can win and erase gains made on the other device.
--
-- ── THE FIX: A 3-WAY MERGE, DONE WHERE THE ROW IS LOCKED ──────────────────
--
--   The client remembers `base` = the ledger as of its last server-
--   acknowledged sync, and uploads base + current. The server applies this
--   device's CHANGE (current − base) onto the row's CURRENT stored ledger,
--   per resource, clamped at 0, and returns the result, which the client
--   adopts as its ledger and its new base. Two devices' changes now ADD.
--
--   Idempotency: each upload carries a per-device, strictly increasing write
--   id (`wid`) and the id of the write whose reply produced its base (`bid`).
--   salvage_sync_devices keeps, per user+device, the last applied id and the
--   ledger it applied (`last_cur`).
--     • wid <= last applied  → a retry of a write that already landed (reply
--       lost): nothing is applied again; the stored ledger is returned.
--     • bid <  last applied  → the device never heard back about a write that
--       DID land, so its `base` is older than what the server already holds
--       from it. The server uses its own `last_cur` as the base instead —
--       otherwise the landed change would be counted twice.
--
-- ── WHY A TRIGGER ON THE EXISTING UPSERT, NOT A SEPARATE RPC ──────────────
--
--   The whole-row upsert has to keep running (it carries ~80 other fields).
--   A separate salvage RPC would still race it: device B's plain upsert
--   landing between A's upsert and A's RPC writes B's stale map over the
--   merged one. Doing the merge in a BEFORE UPDATE trigger puts it inside the
--   same statement, under the same row lock, so there is no window at all —
--   and the client needs one round trip, reading the merged map back through
--   the upsert's own RETURNING (`.select('…forge->__salvage__…')`).
--   The trigger is SECURITY DEFINER only so it can write salvage_sync_devices;
--   it touches nothing but NEW (the row the caller is already allowed to
--   write under user_profiles' RLS) and that user's own device rows.
--
-- ── OPT-IN, SO IT IS SAFE IN EITHER ORDER ─────────────────────────────────
--
--   The merge only runs when the upload carries forge.__salvageSync__. Older
--   builds never send it and keep last-writer-wins exactly as today. A client
--   that sends it before this file is applied just stores a small extra key
--   and gets no acknowledgement, so it keeps its old behaviour too. The
--   client ships first; this file can go on whenever.
--
--   ⚠ ALSO: an UPDATE whose forge omits __salvage__ entirely no longer drops
--     the ledger — the stored one is carried over (same shape as the live
--     up_farm_keep trigger for __farm__). The web-purchase receipt write in
--     index.html sets forge = { webPurchases } and was wiping it.
--
--   Trigger order on user_profiles (alphabetical, all BEFORE UPDATE):
--     up_farm_keep → up_guard_upd → up_salvage_merge → user_profiles_touch
--   so up_guard's repair of an emptied forge has already happened when the
--   merge reads NEW.
--
-- RUN THIS WHOLE FILE. It is idempotent and safe to re-run. Expect the verify
-- block at the bottom to print ok = true on every line.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ── 1 · PER-DEVICE WRITE LOG ──────────────────────────────────────────────
-- One row per user+device. Tiny (≤ ~250 numeric keys in last_cur). Written
-- ONLY by the trigger below — service role only for writes; a player may
-- read their own rows (useful for support, never needed by the client).
create table if not exists public.salvage_sync_devices (
  user_id        uuid        not null,
  device_id      text        not null,
  last_write_id  bigint      not null default 0,
  last_cur       jsonb,
  updated_at     timestamptz not null default now(),
  primary key (user_id, device_id)
);

alter table public.salvage_sync_devices enable row level security;

drop policy if exists ssd_select_own on public.salvage_sync_devices;
create policy ssd_select_own on public.salvage_sync_devices
  for select to authenticated using (user_id = auth.uid());

-- No insert/update/delete policies: service role only. Revoke the table
-- privileges as well so a missing policy is not the only thing in the way.
revoke insert, update, delete, truncate on public.salvage_sync_devices from anon, authenticated;

-- ── 2 · THE ARITHMETIC, AS A PURE FUNCTION ────────────────────────────────
-- merged[k] = max(0, trunc(stored[k] + cur[k] − base[k])) over the keys of
-- stored ∪ cur. A key only in `base` would come out ≤ 0 → 0, so it is not
-- emitted. Non-numbers count as 0 (the ledger is integers; checked live
-- 2026-09-22: every value is a JSON number, none fractional).
-- Pure and immutable so the verify block can test it without a user row, and
-- so _salvagemerge_smoke.mjs can mirror it line for line.
create or replace function public.salvage_num(v jsonb)
returns numeric language sql immutable as $$
  select case when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric else 0 end;
$$;

create or replace function public.salvage_merge_calc(p_stored jsonb, p_cur jsonb, p_base jsonb)
returns jsonb language sql immutable as $$
  with s as (select case when jsonb_typeof(p_stored) = 'object' then p_stored else '{}'::jsonb end j),
       c as (select case when jsonb_typeof(p_cur)    = 'object' then p_cur    else '{}'::jsonb end j),
       b as (select case when jsonb_typeof(p_base)   = 'object' then p_base   else '{}'::jsonb end j),
       keys as (select jsonb_object_keys(s.j) k from s
                union
                select jsonb_object_keys(c.j) from c)
  select coalesce(jsonb_object_agg(keys.k,
           to_jsonb(greatest(0::numeric, trunc(public.salvage_num(s.j -> keys.k)
                                            + public.salvage_num(c.j -> keys.k)
                                            - public.salvage_num(b.j -> keys.k)))))
         , '{}'::jsonb)
    from keys, s, c, b;
$$;

-- ── 3 · THE TRIGGER ───────────────────────────────────────────────────────
create or replace function public.up_salvage_merge()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  req      jsonb;
  dev      text;
  wid      bigint;
  bid      bigint;
  cur      jsonb;
  cbase    jsonb;
  stored   jsonb;
  eff      jsonb;
  merged   jsonb;
  st_last  bigint;
  st_cur   jsonb;
  have     boolean;
begin
  if NEW.forge is null or jsonb_typeof(NEW.forge) <> 'object' then
    return NEW;
  end if;

  stored := case when OLD.forge is not null and jsonb_typeof(OLD.forge -> '__salvage__') = 'object'
                 then OLD.forge -> '__salvage__' end;

  -- (a) A write that does not mention the ledger must not erase it.
  if not (NEW.forge ? '__salvage__') then
    if stored is not null then
      NEW.forge := NEW.forge || jsonb_build_object('__salvage__', stored);
      if OLD.forge ? '__salvageAck__' then
        NEW.forge := NEW.forge || jsonb_build_object('__salvageAck__', OLD.forge -> '__salvageAck__');
      end if;
    end if;
    return NEW;
  end if;

  -- (b) No merge request → an older build: last writer wins, exactly as before.
  if not (NEW.forge ? '__salvageSync__') then
    return NEW;
  end if;
  req := NEW.forge -> '__salvageSync__';
  NEW.forge := NEW.forge - '__salvageSync__';          -- the request is never stored

  -- Anything malformed falls back to (b), never to an error: this statement
  -- is the player's whole save, and failing it would lose far more than the
  -- ledger. RLS already pins the row to auth.uid(); the check below is the
  -- belt to that brace, because this function runs as its owner.
  if jsonb_typeof(req) <> 'object' then return NEW; end if;
  if auth.uid() is not null and auth.uid() <> NEW.user_id then return NEW; end if;
  cur   := NEW.forge -> '__salvage__';
  cbase := req -> 'base';
  if jsonb_typeof(cur) <> 'object' or jsonb_typeof(cbase) <> 'object' then return NEW; end if;
  if (select count(*) from jsonb_object_keys(cur)) > 4000 then return NEW; end if;
  dev := req ->> 'dev';
  if dev is null or length(dev) < 8 or length(dev) > 64 then return NEW; end if;
  if jsonb_typeof(req -> 'wid') <> 'number' then return NEW; end if;
  begin
    wid := (req ->> 'wid')::bigint;
    bid := coalesce(case when jsonb_typeof(req -> 'bid') = 'number' then (req ->> 'bid')::bigint end, 0);
  exception when others then
    return NEW;
  end;
  if wid is null or wid <= 0 then return NEW; end if;

  select d.last_write_id, d.last_cur into st_last, st_cur
    from public.salvage_sync_devices d
   where d.user_id = NEW.user_id and d.device_id = dev
   for update;
  have := found;

  -- (c) A retry of a write that already landed: apply nothing, return what is stored.
  if have and wid <= st_last then
    NEW.forge := NEW.forge || jsonb_build_object(
      '__salvage__',    coalesce(stored, cur),
      '__salvageAck__', jsonb_build_object('dev', dev, 'wid', wid, 'replay', true));
    return NEW;
  end if;

  -- (d) Merge. Nothing stored yet (first save, or a legacy row that kept its
  --     ledger elsewhere) → there is nothing to merge into; take the upload.
  if stored is null then
    merged := public.salvage_merge_calc('{}'::jsonb, cur, '{}'::jsonb);
  else
    eff := case when have and bid < st_last and jsonb_typeof(st_cur) = 'object'
                then st_cur else cbase end;
    merged := public.salvage_merge_calc(stored, cur, eff);
  end if;

  insert into public.salvage_sync_devices as d (user_id, device_id, last_write_id, last_cur, updated_at)
  values (NEW.user_id, dev, wid, cur, now())
  on conflict (user_id, device_id) do update
     set last_write_id = excluded.last_write_id,
         last_cur      = excluded.last_cur,
         updated_at    = now();

  NEW.forge := NEW.forge || jsonb_build_object(
    '__salvage__',    merged,
    '__salvageAck__', jsonb_build_object('dev', dev, 'wid', wid));
  return NEW;
end;
$fn$;

revoke all on function public.up_salvage_merge() from public, anon, authenticated;

drop trigger if exists up_salvage_merge on public.user_profiles;
create trigger up_salvage_merge before update on public.user_profiles
  for each row execute function public.up_salvage_merge();

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFY — every line should say ok = true.
-- ════════════════════════════════════════════════════════════════════════════
select 'table + RLS' as check,
       exists (select 1 from pg_class where oid = 'public.salvage_sync_devices'::regclass and relrowsecurity) as ok
union all
select 'select-own policy',
       exists (select 1 from pg_policies where tablename = 'salvage_sync_devices' and policyname = 'ssd_select_own')
union all
select 'trigger armed',
       exists (select 1 from pg_trigger where tgrelid = 'public.user_profiles'::regclass
                 and tgname = 'up_salvage_merge' and tgenabled <> 'D')
union all
select 'two devices add (A bought 400 ammo, B donated 50 metal)',
       public.salvage_merge_calc('{"ammo":500,"metal":50}', '{"ammo":100,"metal":0}', '{"ammo":100,"metal":50}')
         = '{"ammo":500,"metal":0}'::jsonb
union all
select 'idle stale device changes nothing',
       public.salvage_merge_calc('{"ammo":500}', '{"ammo":100}', '{"ammo":100}') = '{"ammo":500}'::jsonb
union all
select 'clamped at zero',
       public.salvage_merge_calc('{"metal":10}', '{"metal":0}', '{"metal":50}') = '{"metal":0}'::jsonb
union all
select 'new resource from either side kept',
       public.salvage_merge_calc('{"a":1}', '{"a":1,"b":7}', '{"a":1}') = '{"a":1,"b":7}'::jsonb;
