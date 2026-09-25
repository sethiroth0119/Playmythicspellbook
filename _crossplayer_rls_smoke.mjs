/* 🔒 NO PLAYER CAN REWRITE ANOTHER PLAYER'S ROWS (sql/143, draft).

   Asked for: "make sure multiplayer and the game is fully a multiplayer online
   game where players have their own accounts and data and nobody data mix
   with each other." Measured 2026-09-17: 27 write policies in `public` had a
   bare `true`; with the 19 on these tables any signed-in player could wipe another
   player's gym, delete any sponsor ad, rewrite any court verdict, forge a
   Criminal Registry line, or delete every shared exchange price.

   sql/143 is proven on the live database inside a rolled-back DO block (80
   probes as real user ids: every cross-player write refused, every write the
   shipped client performs still lands). This suite cannot reach Postgres, so
   it guards the two things that silently undo that proof later:

     · THE MIGRATION DRIFTS. A policy re-opened to `true`, a dropped guard
       trigger, a non-idempotent CREATE, or a data statement slipped into an
       RLS-only file all leave the SQL "valid" and the hole back open.
     · THE CLIENT GROWS A NEW WRITER. The policies were shaped around an exact
       inventory of client write sites (gymRecordDefense writes the DEFENDER'S
       row on purpose, the node owner pauses STUDIO ads, …). A new
       `.from('gyms').update(...)` elsewhere is either blocked by 143 in
       production — a silent no-op, because these callers swallow errors — or
       is a reason to reopen a policy. Either way someone must look, so an
       unknown writer is a FAIL here, not a surprise after deploy.

   Also pins the client facts the triggers assume (a claim starts at streak 0
   and never sends gym_level/hq; a defence adds exactly one; stamina max 100;
   a non-admin ad is submitted 'pending'), because a client change there turns
   a legitimate write into a refused one.

   Section N is the negative control: every check above is re-run against
   deliberately broken copies and must FAIL on each.

   Run: node _crossplayer_rls_smoke.mjs */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

let fails = 0, passes = 0;
const ok = (c, m, x) => {
  console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  <- ' + x));
  if (c) passes++; else fails++;
};

const SQL_PATH = './sql/143_cross_player_write_rls.sql';
const SQL = readFileSync(SQL_PATH, 'utf8');
const INDEX = readFileSync('./public/index.html', 'utf8');

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(m?js|html)$/.test(f)) out.push(p);
  }
  return out;
}
const OTHER_SOURCES = [
  './public/node-city/index.html',
  './public/main-menu/index.html',
  ...walk('./public/src'),
].filter((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });

const TABLES = ['gyms', 'gym_meta', 'tw_node_ads', 'court_cases', 'court_records', 'cx_prices',
  'site_updates', 'tw_ownership', 'tw_defense_data', 'tw_node_capture_progress', 'tw_guard_decks',
  'tw_node_shop_upgrades', 'tw_regions', 'tw_sectors', 'tw_territories', 'tw_world_feed'];

/* The 19 policies 143 must replace or drop — each one was a bare `true`
   (gym_upd is replaced but keeps USING true behind its trigger). */
const TARGETS = [
  ['gyms', 'gym_ins'], ['gyms', 'gym_upd'], ['gym_meta', 'gm_upd'],
  ['tw_node_ads', 'tw_node_ads_upd'], ['tw_node_ads', 'tw_node_ads_del'],
  ['court_cases', 'ccz_upd'], ['court_records', 'crr_ins'], ['cx_prices', 'cxp_write'],
  ['site_updates', 'su_ins'], ['site_updates', 'su_upd'], ['tw_ownership', 'two_write'],
  ['tw_defense_data', 'twdd_write'], ['tw_node_capture_progress', 'twncp_write'],
  ['tw_guard_decks', 'twgd_admin'], ['tw_node_shop_upgrades', 'twnsu_admin'],
  ['tw_regions', 'twr_admin'], ['tw_sectors', 'tws_admin'], ['tw_territories', 'twt_admin'],
  ['tw_world_feed', 'twwf_ins'],
];
/* Policies that may keep a bare `true`, and in which clause. */
const OPEN_ALLOWED = { 'gyms.gym_upd': 'using', 'tw_ownership.two_upd': 'using' };

/* The shipped client write sites, by enclosing function. */
const WRITERS_EXPECTED = {
  'court_cases insert courtFile': 1, 'court_cases update courtTakeRole': 1, 'court_cases update courtRule': 1,
  'court_records insert courtRule': 1,
  'gyms upsert gymClaim': 1, 'gyms update gymRecordDefense': 1, 'gyms update gymContribute': 1,
  'gyms update gymReinforceStamina': 1, 'gyms update gymUpgradeLevel': 1, 'gyms update gymSetMotto': 1,
  'gyms update gymAdvanceSeason': 1, 'gym_meta update gymAdvanceSeason': 1, 'gyms update gymHeartbeat': 1,
  'cx_prices upsert _cxCloudFlush': 1,
  'tw_world_feed insert tw_cloudPostFeed': 1,
  'tw_node_ads upsert tw_cloudUpsertNodeAd': 1, 'tw_node_ads update tw_cloudSetAdStatus': 1,
  'tw_node_ads delete tw_cloudDeleteAd': 1,
  'tw_ownership upsert tw_cloudUpsertOwnership': 1, 'tw_ownership delete renderTerritoryWarsAdmin': 1,
};

// ── helpers ──────────────────────────────────────────────────────────────────
/* Code with -- comments and $fn$ bodies removed: what runs at top level. */
function topLevel(sql) {
  const noComments = sql.split(/\r?\n/).map((l) => l.replace(/--.*$/, '')).join('\n');
  return noComments.replace(/\$fn\$[\s\S]*?\$fn\$/g, '$fn$<body>$fn$');
}
function stripComments(sql) {
  return sql.split(/\r?\n/).map((l) => l.replace(/--.*$/, '')).join('\n');
}
/* Parse `create policy NAME on public.T for CMD to ROLE using (...) with check (...);` */
function policies(sql) {
  const code = topLevel(sql);
  const out = [];
  const re = /create policy (\w+) on public\.(\w+)\s+for (\w+)\s+to (\w+)([\s\S]*?);/g;
  let m;
  while ((m = re.exec(code))) {
    const rest = m[5];
    const using = (rest.match(/\busing\s*\(([\s\S]*?)\)\s*(?:with check|$)/) || [])[1];
    const check = (rest.match(/\bwith check\s*\(([\s\S]*)\)\s*$/) || [])[1];
    out.push({ name: m[1], table: m[2], cmd: m[3], role: m[4], using: using && using.trim(), check: check && check.trim(), at: m.index });
  }
  return out;
}
function enclosingFn(src, idx) {
  const before = src.slice(Math.max(0, idx - 60000), idx);
  const fns = [...before.matchAll(/(?:^|\n)\s*(?:async\s+)?function\s+([\w$]+)\s*\(/g)];
  return fns.length ? fns[fns.length - 1][1] : '?';
}
function writers(src) {
  const re = new RegExp("\\.from\\(\\s*['\"](" + TABLES.join('|') + ")['\"]\\s*\\)\\s*\\.(insert|update|upsert|delete)\\b", 'g');
  const found = {};
  let m;
  while ((m = re.exec(src))) {
    const k = m[1] + ' ' + m[2] + ' ' + enclosingFn(src, m.index);
    found[k] = (found[k] || 0) + 1;
  }
  return found;
}
function fnText(src, name) {
  const i = src.search(new RegExp('(?:async\\s+)?function\\s+' + name.replace(/\$/g, '\\$') + '\\s*\\('));
  if (i < 0) return '';
  const next = src.slice(i + 10).search(/\n(?:async\s+)?function\s+[\w$]+\s*\(/);
  return src.slice(i, next < 0 ? undefined : i + 10 + next);
}

// ── the checks, as a function so section N can re-run them on broken copies ──
function checkSql(sql, say) {
  const code = stripComments(sql);
  const top = topLevel(sql);
  const pols = policies(sql);

  // 1. RLS only, no data.
  say(!/\b(insert\s+into|update\s+public\.|delete\s+from|truncate|alter\s+table|create\s+table|drop\s+table)\b/i.test(top),
    'S1 no data or table statement at top level (RLS + triggers only)');

  // 2. Idempotent.
  const undropped = pols.filter((p) => !new RegExp('drop policy if exists ' + p.name + ' on public\\.' + p.table + '\\b').test(top.slice(0, p.at)));
  say(pols.length >= 20 && undropped.length === 0,
    'S2 every one of ' + pols.length + ' create policy is preceded by its own drop policy if exists',
    undropped.map((p) => p.table + '.' + p.name).join(', '));
  const fnCreates = [...top.matchAll(/create\s+(or\s+replace\s+)?function\s+public\.(\w+)/g)];
  say(fnCreates.length === 3 && fnCreates.every((m) => m[1]),
    'S3 all 3 functions are create or replace (' + fnCreates.map((m) => m[2]).join(', ') + ')');
  const trig = [...top.matchAll(/create trigger (\w+)\s+before update on public\.(\w+)/g)];
  say(trig.length === 2 && trig.every((t) => new RegExp('drop trigger if exists ' + t[1] + ' on public\\.' + t[2]).test(top)),
    'S4 both guard triggers are dropped before being created');
  say(trig.some((t) => t[1] === 'gyms_guard_cross_player' && t[2] === 'gyms')
      && trig.some((t) => t[1] === 'court_cases_guard_update' && t[2] === 'court_cases'),
    'S5 the triggers sit on gyms and court_cases, BEFORE UPDATE');
  const dollars = (code.match(/\$fn\$/g) || []).length;
  say(dollars === 6, 'S6 $fn$ delimiters balanced for 3 bodies (' + dollars + ')');

  // 3. Every target replaced.
  const missing = TARGETS.filter(([t, p]) => !new RegExp('drop policy if exists ' + p + ' on public\\.' + t + '\\b').test(top));
  say(missing.length === 0, 'S7 all ' + TARGETS.length + ' open policies are dropped or replaced', missing.map((x) => x.join('.')).join(', '));

  // 4. No bare true left except the two documented USING clauses.
  const open = [];
  for (const p of pols) {
    if (p.using === 'true' && OPEN_ALLOWED[p.table + '.' + p.name] !== 'using') open.push(p.table + '.' + p.name + ' using');
    if (p.check === 'true') open.push(p.table + '.' + p.name + ' check');
  }
  say(open.length === 0, 'S8 no write policy is `true` except gym_upd/two_upd USING', open.join(', '));
  say(pols.every((p) => p.role === 'authenticated'), 'S9 every policy is scoped to authenticated (anon gets nothing)');

  // 5. The predicates that do the work.
  const P = Object.fromEntries(pols.map((p) => [p.table + '.' + p.name, p]));
  const has = (k, part, re) => !!(P[k] && P[k][part] && re.test(P[k][part]));
  say(has('gyms.gym_ins', 'check', /leader_id = auth\.uid\(\)/), 'S10 a gym can only be inserted with yourself as leader');
  say(has('tw_node_ads.tw_node_ads_upd', 'using', /created_by = auth\.uid\(\)/) && has('tw_node_ads.tw_node_ads_upd', 'using', /tw_node_ad_manager\(node_id\)/)
      && has('tw_node_ads.tw_node_ads_del', 'using', /created_by = auth\.uid\(\)/),
    'S11 ads: update/delete need the creator or the node manager');
  say(has('tw_node_ads.tw_node_ads_upd', 'check', /status in \('pending', 'paused'\)/) && has('tw_node_ads.tw_node_ads_ins', 'check', /status in \('pending', 'paused'\)/),
    'S12 ads: a non-admin can never write status active (no self-approval)');
  say(has('court_cases.ccz_upd', 'using', /judge_id = auth\.uid\(\)/) && has('court_cases.ccz_upd', 'using', /court_officials/),
    'S13 court cases: only the presiding judge or a registered official reaches the row');
  say(has('court_records.crr_ins', 'check', /c\.judge_id = auth\.uid\(\)/) && has('court_records.crr_ins', 'check', /c\.defendant_name = court_records\.offender_name/),
    'S14 a registry line needs the presiding judge of a guilty case, for that defendant');
  say(has('tw_ownership.two_ins', 'check', /is_corp_member\(owner_corp_id/) && has('tw_ownership.two_upd', 'check', /is_corp_member\(owner_corp_id/)
      && has('tw_ownership.two_del', 'using', /^public\.is_admin\(\)$/),
    'S15 territory: the new owner is the caller\'s corp; only an admin deletes');
  say(has('tw_world_feed.twwf_ins', 'check', /actor = auth\.uid\(\)/), 'S16 world feed: you post only as yourself');
  const adminOnly = ['tw_defense_data.twdd_admin_write', 'tw_node_capture_progress.twncp_admin_write', 'tw_guard_decks.twgd_admin',
    'tw_node_shop_upgrades.twnsu_admin', 'tw_regions.twr_admin', 'tw_sectors.tws_admin', 'tw_territories.twt_admin',
    'site_updates.su_ins', 'site_updates.su_upd', 'gym_meta.gm_upd'];
  const notAdmin = adminOnly.filter((k) => !P[k] || (P[k].using && P[k].using !== 'public.is_admin()') || P[k].check !== 'public.is_admin()');
  say(notAdmin.length === 0, 'S17 the ' + adminOnly.length + ' world/admin write policies are exactly public.is_admin()', notAdmin.join(', '));
  say(!/create policy \w+ on public\.cx_prices/.test(top) && /drop policy if exists cxp_write on public\.cx_prices/.test(top),
    'S18 cx_prices: the FOR ALL true policy is dropped and nothing new is opened');

  // 6. Trigger bodies: the rules the proof relied on.
  const gymBody = (code.match(/function public\.gyms_guard_cross_player\(\)[\s\S]*?\$fn\$([\s\S]*?)\$fn\$/) || [])[1] || '';
  say(/current_user not in \('authenticated', 'anon'\)/.test(gymBody) && !/if v_uid is null then\s*return new/.test(gymBody),
    'S19 gyms trigger trusts current_user, never a missing auth.uid()');
  say(/coalesce\(old\.defense_streak, 0\) \+ 1/.test(gymBody) && /new\.peak_streak := greatest\(/.test(gymBody),
    'S20 gyms trigger: a defence adds exactly one, the peak is derived');
  say(/new\.stamina > 100\b/.test(gymBody) && /new\.leader_deck/.test(gymBody) && /new\.gym_level is distinct from old\.gym_level/.test(gymBody),
    'S21 gyms trigger: stamina capped at 100, deck and level belong to the leader');
  const courtBody = (code.match(/function public\.court_cases_guard_update\(\)[\s\S]*?\$fn\$([\s\S]*?)\$fn\$/) || [])[1] || '';
  say(/current_user not in \('authenticated', 'anon'\)/.test(courtBody) && /new\.summary/.test(courtBody) && /old\.prosecutor_name is not null/.test(courtBody)
      && /raise exception 'court: you are not an officer of this case'/.test(courtBody),
    'S22 court trigger: filing immutable, slots fill once, anyone else refused');
  const mgr = (code.match(/function public\.tw_node_ad_manager\(p_node_id text\)[\s\S]*?\$fn\$([\s\S]*?)\$fn\$/) || [])[0] || '';
  say(/security definer/.test(mgr) && /set search_path = public/.test(mgr) && /grant execute on function public\.tw_node_ad_manager\(text\) to authenticated/.test(top),
    'S23 tw_node_ad_manager is SECURITY DEFINER with a pinned search_path, granted to authenticated');

  // 7. Verify block.
  const verify = code.slice(code.lastIndexOf('select p.tablename'));
  say(/from pg_policies p/.test(verify) && /else 'UNEXPECTED'/.test(verify) && /'gyms\.gym_upd'/.test(verify) && /'tw_ownership\.two_upd'/.test(verify)
      && /'cx_prices\.cx_prices_update'/.test(verify),
    'S24 the file ends with a verify query that justifies each surviving open policy and flags anything else');
  say(/Status: DRAFT — NOT APPLIED/.test(sql), 'S25 header says DRAFT — NOT APPLIED');
}

function checkClient(index, others, say) {
  const w = writers(index);
  const unknown = Object.keys(w).filter((k) => !WRITERS_EXPECTED[k] || w[k] !== WRITERS_EXPECTED[k]);
  const gone = Object.keys(WRITERS_EXPECTED).filter((k) => !w[k]);
  say(unknown.length === 0, 'C1 index.html writes these tables only at the ' + Object.keys(WRITERS_EXPECTED).length + ' reviewed sites', unknown.join(' | '));
  say(gone.length === 0, 'C2 every reviewed writer still exists (a vanished one means the inventory is stale)', gone.join(' | '));
  const elsewhere = [];
  for (const [p, src] of others) for (const k of Object.keys(writers(src))) elsewhere.push(p + ': ' + k);
  say(elsewhere.length === 0, 'C3 no module or other page writes these tables directly (' + others.length + ' files scanned)', elsewhere.join(' | '));

  const claim = fnText(index, 'gymClaim');
  const row = (claim.match(/const row = \{([\s\S]*?)\};/) || [])[1] || '';
  say(/defense_streak:\s*0/.test(row) && /peak_streak:\s*0/.test(row) && !/gym_level|\bhq\b/.test(row),
    'C4 gymClaim starts a reign at streak 0 and never sends gym_level or hq (the trigger refuses otherwise)');
  const def = fnText(index, 'gymRecordDefense');
  say(/const newStreak = \(row\.defense_streak \|\| 0\) \+ 1/.test(def) && /\.eq\('leader_id', row\.leader_id\)/.test(def),
    'C5 gymRecordDefense adds exactly one defence to the current leader\'s row');
  say(/const GYM_STAMINA_MAX\s*=\s*100\s*;/.test(index), 'C6 GYM_STAMINA_MAX is still 100 (the trigger hard-codes it)');
  const contrib = fnText(index, 'gymContribute');
  say(/Math\.min\(GYM_STAMINA_MAX,/.test(contrib) && !/defense_streak|leader_name|gym_level/.test((contrib.match(/from\('gyms'\)\.update\(\{([\s\S]*?)\}\)/) || [])[1] || 'x'),
    'C7 gymContribute moves only stamina on the leader\'s row');
  say(/if \(!\(\(typeof isAdmin === 'function'\) && isAdmin\(\)\)\) return/.test(fnText(index, 'gymAdvanceSeason')),
    'C8 gymAdvanceSeason is admin-gated client-side (gym_meta is admin-only server-side)');
  say(/status: _esnAdmin\(\) \? 'active' : 'pending'/.test(index), 'C9 a non-admin sponsor ad is submitted as pending');
  say(/created_by: userId/.test(fnText(index, 'tw_cloudUpsertNodeAd')), 'C10 tw_cloudUpsertNodeAd stamps created_by with the caller');
  say(/actor: userId/.test(fnText(index, 'tw_cloudPostFeed')), 'C11 tw_cloudPostFeed posts as the caller');
  say(/updated_by: me/.test(fnText(index, '_cxCloudFlush')), 'C12 _cxCloudFlush stamps updated_by with the caller');
  const take = fnText(index, 'courtTakeRole');
  say(/if \(c\.judge_id\) \{ showToast/.test(take) && /c\.prosecutor_name\) \{ showToast/.test(take) && /c\.defender_name\) \{ showToast/.test(take),
    'C13 courtTakeRole only fills an empty bench or an empty counsel slot');
  const rule = fnText(index, 'courtRule');
  say(/if \(c\.judge_id && c\.judge_id !== Profile\.cloud\.userId\)/.test(rule) && /offender_name: c\.defendant_name/.test(rule),
    'C14 courtRule is the presiding judge\'s and records the case\'s own defendant');
}

// ── run ──────────────────────────────────────────────────────────────────────
console.log('\n── sql/143 ──');
checkSql(SQL, ok);
console.log('\n── client write inventory ──');
const OTHERS = OTHER_SOURCES.map((p) => [p, readFileSync(p, 'utf8')]);
checkClient(INDEX, OTHERS, ok);

// ── N. negative control: each mutation must make at least one check fail ────
console.log('\n── N. negative control ──');
function failsOn(fn) {
  let f = 0;
  fn((c) => { if (!c) f++; });
  return f;
}
const sqlMutants = [
  ['gym_ins reopened to true', SQL.replace("with check (leader_id = auth.uid() or public.is_admin());", 'with check (true);')],
  ['ads delete back to using (true)', SQL.replace("create policy tw_node_ads_del on public.tw_node_ads for delete to authenticated\n  using (public.is_admin() or created_by = auth.uid() or public.tw_node_ad_manager(node_id));", 'create policy tw_node_ads_del on public.tw_node_ads for delete to authenticated\n  using (true);')],
  ['cxp_write drop removed', SQL.replace('drop policy if exists cxp_write on public.cx_prices;', '')],
  ['gyms trigger dropped', SQL.replace(/create trigger gyms_guard_cross_player[\s\S]*?execute function public\.gyms_guard_cross_player\(\);/, '')],
  ['trigger trusts a missing uid', SQL.replace("if v_uid is null then\n    raise exception 'gyms: sign in to write a gym' using errcode = '42501';", 'if v_uid is null then\n    return new;')],
  ['a create policy without its drop', SQL.replace('drop policy if exists twwf_ins on public.tw_world_feed;', '')],
  ['a data statement slipped in', SQL.replace('-- ── verify', "update public.gyms set stamina = 100;\n-- ── verify")],
  ['admin table left open', SQL.replace('create policy twr_admin on public.tw_regions for all to authenticated\n  using (public.is_admin()) with check (public.is_admin());', 'create policy twr_admin on public.tw_regions for all to authenticated\n  using (true) with check (true);')],
  ['ads can self-approve', SQL.split("and status in ('pending', 'paused')").join('')],
  ['stamina cap removed', SQL.replace('new.stamina > 100', 'new.stamina > 100000')],
  ['verify block removed', SQL.slice(0, SQL.indexOf('-- ── verify'))],
];
for (const [label, mutated] of sqlMutants) {
  ok(mutated !== SQL && failsOn((say) => checkSql(mutated, say)) > 0, 'N-sql  the checks catch: ' + label);
}
const fakeWriter = '\nasync function gymPrank(coreId) { await Cloud.client.from(\'gyms\').delete().eq(\'core_id\', coreId); }\n';
const clientMutants = [
  ['a new gyms writer in index.html', INDEX + fakeWriter, OTHERS],
  ['a module writing tw_node_ads directly', INDEX, [...OTHERS, ['fake/module.js', "export const x = () => sb.from('tw_node_ads').update({ status: 'active' });"]]],
  ['gymClaim carrying the old streak', INDEX.replace(/defense_streak: 0, peak_streak: 0,/, 'defense_streak: prev ? prev.defense_streak : 0, peak_streak: 0,'), OTHERS],
  ['ads submitted as active', INDEX.replace("status: _esnAdmin() ? 'active' : 'pending'", "status: 'active'"), OTHERS],
  ['GYM_STAMINA_MAX raised', INDEX.replace(/const GYM_STAMINA_MAX(\s*)=\s*100\s*;/, 'const GYM_STAMINA_MAX$1= 150;'), OTHERS],
  ['feed posted without actor', INDEX.replace('actor: userId,', 'actor: null,'), OTHERS],
];
for (const [label, idx, others] of clientMutants) {
  ok((idx !== INDEX || others !== OTHERS) && failsOn((say) => checkClient(idx, others, say)) > 0, 'N-client  the checks catch: ' + label);
}

console.log('\n' + (fails ? '❌ ' + fails + ' FAILURES' : '✅ cross-player RLS: ' + passes + ' checks') + '\n');
process.exit(fails ? 1 : 0);
