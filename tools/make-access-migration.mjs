// Builds supabase/migrations/20260828000000_warehouse_access_roles.sql by
// lifting the CURRENT text of the two functions that need to change out of the
// original warehouse migration and applying one surgical edit to each.
//
// Retyping a 60-line security-definer function by hand to change one condition
// is how you silently drop a check. This copies the body byte-for-byte and
// fails loudly if the anchor it expects is not found exactly once.
import fs from 'node:fs';

const SRC = 'supabase/migrations/20260812000000_warehouse_storage.sql';
const OUT = 'supabase/migrations/20260828000000_warehouse_access_roles.sql';
// The source is CRLF; normalise so the anchors below can be written plainly.
const sql = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');

function extract(name) {
  const start = sql.indexOf('create or replace function public.' + name + '(');
  if (start < 0) throw new Error('function not found: ' + name);
  const end = sql.indexOf('$$;', start);
  if (end < 0) throw new Error('unterminated function: ' + name);
  return sql.slice(start, end + 3);
}

function replaceOnce(text, from, to, label) {
  const i = text.indexOf(from);
  if (i < 0) throw new Error('anchor missing (' + label + ')');
  if (text.indexOf(from, i + 1) >= 0) throw new Error('anchor not unique (' + label + ')');
  return text.slice(0, i) + to + text.slice(i + from.length);
}

// ── 1) wh_store_crate: let the owner's hired staff unload as well ────────────
let storeCrate = extract('wh_store_crate');
storeCrate = replaceOnce(
  storeCrate,
  `  -- …and the caller still has to be someone entitled to touch this warehouse:
  -- the owner (who does the hauling) or the renter themselves.
  if v_w.owner_id is distinct from v_uid and v_u.renter_id is distinct from v_uid then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;`,
  `  -- …and the caller still has to be someone entitled to touch this warehouse:
  -- the owner (who does the hauling), a worker hired into the owner's corp, or
  -- the renter themselves. Staff may only ever put crates IN — wh_withdraw
  -- stays renter-only, so a hired hand can never empty a customer's bay.
  if v_w.owner_id is distinct from v_uid
     and v_u.renter_id is distinct from v_uid
     and not public.wh_is_staff(v_w.id, v_uid) then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;`,
  'store_crate caller check'
);

// ── 2) wh_warehouse_json: report the viewer's role, and let staff see enough
//       of a bay to do the job (is it occupied, will the crate fit) without
//       exposing what is inside it. ─────────────────────────────────────────
let json = extract('wh_warehouse_json');

json = replaceOnce(
  json,
  `declare v_uid uuid := auth.uid(); v_w public.wh_warehouses; v_is_owner boolean;`,
  `declare v_uid uuid := auth.uid(); v_w public.wh_warehouses; v_is_owner boolean;
        v_is_staff boolean; v_role text;`,
  'json declare'
);

json = replaceOnce(
  json,
  `  v_is_owner := (v_w.owner_id = v_uid);
  return jsonb_build_object(
    'ok', true,
    'is_owner', v_is_owner,`,
  `  v_is_owner := (v_w.owner_id = v_uid);
  -- Hired = a member of the same corporation as the owner. Never true for the
  -- owner themselves, so the two roles stay disjoint in the payload.
  v_is_staff := (not v_is_owner) and public.wh_is_staff(v_w.id, v_uid);
  v_role := case
              when v_is_owner then 'owner'
              when v_is_staff then 'staff'
              when exists (select 1 from public.wh_units u
                            where u.warehouse_id = v_w.id and u.renter_id = v_uid) then 'renter'
              else 'visitor'
            end;
  return jsonb_build_object(
    'ok', true,
    'is_owner', v_is_owner,
    -- The client gates every control off these two. They are advisory for the
    -- UI only: each RPC re-checks for itself, because a hidden button is not a
    -- permission.
    'is_staff', v_is_staff,
    'viewer_role', v_role,`,
  'json role fields'
);

// Staff need occupancy + capacity to unload; contents stay owner/renter-only.
json = replaceOnce(
  json,
  `        'used_kg',     case when v_is_owner or u.renter_id = v_uid then u.used_kg     else null end,`,
  `        'used_kg',     case when v_is_owner or v_is_staff or u.renter_id = v_uid then u.used_kg else null end,`,
  'used_kg mask'
);
json = replaceOnce(
  json,
  `        'capacity_kg', case when v_is_owner or u.renter_id = v_uid then u.capacity_kg else null end,`,
  `        'capacity_kg', case when v_is_owner or v_is_staff or u.renter_id = v_uid then u.capacity_kg else null end,`,
  'capacity mask'
);
json = replaceOnce(
  json,
  `        'renter_name', case when v_is_owner or u.renter_id = v_uid then u.renter_name else null end,`,
  `        'renter_name', case when v_is_owner or v_is_staff or u.renter_id = v_uid then u.renter_name else null end,`,
  'renter_name mask'
);
// NOTE: 'renter_id' (a raw auth.users id) and 'contents' are deliberately NOT
// widened to staff. Knowing which bays hold what is exactly the "worth
// diverting" list the original migration refused to publish.

const header = `-- ===============================================================
-- Warehouse access roles — who may touch someone else's yard.
--
-- Before this, the warehouse recognised two kinds of person: the owner, and
-- the renter of a given bay. A visitor was kept out of most things only by the
-- client hiding buttons, which is not a control — the RPCs are callable from a
-- console.
--
-- The model now:
--   owner    — everything.
--   staff    — a player hired into the OWNER'S corporation (corp_members).
--              May work the floor: use the workstation, and carry crates INTO
--              any bay. May NOT withdraw from a bay, may NOT spend the owner's
--              money, may NOT see what is stored in a bay.
--   renter   — their own bay, and nothing else.
--   visitor  — may look. Nothing else.
--
-- Spending was already safe and is untouched: wh_buy_unit / wh_upgrade_tier
-- resolve the warehouse with "where owner_id = auth.uid()", so no one but the
-- owner can ever charge the owner. wh_withdraw was already renter-only.
--
-- Idempotent. Generated by tools/make-access-migration.mjs from the original
-- warehouse migration, so the untouched parts of these functions are
-- byte-identical to what is live.
-- ===============================================================

-- ─── 👷 wh_is_staff — is p_uid hired into the warehouse owner's corp? ────────
-- Wrapped in an exception handler on purpose: a deployment without the
-- corporations tables simply has no staff, rather than breaking every crate
-- that anyone tries to store.
create or replace function public.wh_is_staff(p_warehouse_id uuid, p_uid uuid default auth.uid())
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid; v_corp uuid; v_ok boolean := false;
begin
  if p_uid is null or p_warehouse_id is null then return false; end if;
  select owner_id into v_owner from public.wh_warehouses where id = p_warehouse_id;
  if v_owner is null then return false; end if;
  if v_owner = p_uid then return true; end if;          -- the owner is trivially staff
  begin
    -- The owner's corporation: the one they were hired into, else one they founded.
    select corp_id into v_corp from public.corp_members where user_id = v_owner limit 1;
    if v_corp is null then
      select id into v_corp from public.corporations where founder_id = v_owner limit 1;
    end if;
    if v_corp is null then return false; end if;        -- an owner with no corp has no staff
    select exists (
      select 1 from public.corp_members m where m.corp_id = v_corp and m.user_id = p_uid
      union all
      select 1 from public.corporations c where c.id = v_corp and c.founder_id = p_uid
    ) into v_ok;
  exception when others then
    return false;                                        -- no corp tables in this deployment
  end;
  return coalesce(v_ok, false);
end; $$;
grant execute on function public.wh_is_staff(uuid, uuid) to authenticated;

-- ─── 📦 wh_store_crate — owner, hired staff, or the bay's own renter ─────────
${storeCrate}
grant execute on function public.wh_store_crate(uuid, uuid) to authenticated;

-- ─── 🏬 wh_warehouse_json — now reports viewer_role ─────────────────────────
${json}
grant execute on function public.wh_warehouse_json(uuid) to authenticated;
`;

fs.writeFileSync(OUT, header);
console.log('wrote ' + OUT + '  (' + header.length + ' bytes)');
console.log('  wh_store_crate     : ' + storeCrate.length + ' bytes');
console.log('  wh_warehouse_json  : ' + json.length + ' bytes');
