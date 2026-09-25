/* 👷 PLAYER STAFF + NEGOTIATED WAGES + CITY INCOME (v121v49, sql/117).

   Asked for: "both: players pay NPCs AND players in the corp; players can
   negotiate how much they get paid"; "when the city builder gives players
   Cinder show that, and do not stop because they left the city builder".

   Defends, headless:
     · sql/117: the corp_staff table, the five negotiation RPCs, payroll from
       the treasury through _ct_cinder_give with a named ledger row, the 36 h
       cap, the officer test, RLS + grants;
     · the host: staff rows ride with opFetch, production counts players while
       op_salary counts only NPCs, payroll runs on settle, the payload carries
       staff / myId / staffRpc, the five actions route to the RPCs;
     · the corp app: the Staff & Wages block with offer / apply / counter /
       accept / end, uncontrolled inputs read at click time, compiles;
     · the city: income is booked as "City builder income" and the offline
       catch-up runs a week, not three days.

   Run: node _corpstaff_smoke.mjs */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
const SQL = readFileSync('./sql/117_corp_staff.sql', 'utf8');
const JSX = readFileSync('./public/corp/screens.jsx', 'utf8');
const NC  = readFileSync('./public/node-city/index.html', 'utf8');
const TUN = readFileSync('./public/src/economy/tuning.js', 'utf8');
function fnText(name) {
  const i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name);
  let d = 0, j = SRC.indexOf('{', i);
  for (let k = j; k < SRC.length; k++) { if (SRC[k] === '{') d++; else if (SRC[k] === '}') { d--; if (!d) return SRC.slice(i, k + 1); } }
}

/* ── sql/117 ── */
ok(/create table if not exists public\.corp_staff \(/.test(SQL) && /unique \(op_id, user_id\)/.test(SQL), 'corp_staff table, one row per worker per operation');
ok(/status\s+text\s+not null default 'offered'/.test(SQL) && /offered_hr/.test(SQL) && /asked_hr/.test(SQL) && /wage_hr/.test(SQL), 'offered / asked / agreed numbers live on the row');
['corp_staff_offer', 'corp_staff_apply', 'corp_staff_counter', 'corp_staff_accept', 'corp_staff_end', 'corp_staff_list', 'corp_staff_payroll'].forEach((f) => {
  ok(new RegExp('create or replace function public\\.' + f + '\\(').test(SQL) && new RegExp('grant execute on function public\\.' + f + '\\([^)]*\\) to authenticated').test(SQL), f + ' exists and is granted');
});
ok(/_corp_is_officer\(p_corp_id, v_uid\)/.test(SQL) && /founder_id = p_uid/.test(SQL) && /in \('founder','owner','ceo'\)/.test(SQL), 'the officer test is the treasury one');
ok(/v_wage := v_row\.offered_hr;/.test(SQL) && /v_wage := v_row\.asked_hr;/.test(SQL), "accept takes the OTHER side's number");
ok(/least\(36, greatest\(0, extract\(epoch from \(now\(\) - r\.last_paid_at\)\) \/ 3600\.0\)\)/.test(SQL), 'payroll caps at 36 hours');
ok(/if v_bal < v_amt then v_short := v_short \+ v_amt; continue; end if;/.test(SQL), 'a short treasury skips the row and reports it');
ok(/perform public\._ct_cinder_give\(r\.user_id, v_amt, 'Wages from ' \|\| coalesce\(v_corp, 'your corporation'\) \|\| ' — ' \|\| coalesce\(r\.op_type, 'operation'\)\)/.test(SQL), 'the worker is paid through _ct_cinder_give with a named ledger row');
ok(/values \(p_corp_id, r\.user_id, -v_amt, 'staff_wage',/.test(SQL), 'the treasury row is staff_wage');
ok(/status = 'claimed', now\(\)\)/.test(SQL) || /'claimed', now\(\)\)/.test(SQL), 'a settled corp_transfers row is written');
ok(/if v_row\.status = 'agreed' then perform public\.corp_staff_payroll\(v_row\.corp_id\); end if;/.test(SQL), 'ending a job pays what is owed first');
ok(/p_wage_hr > 100000/.test(SQL) && /p_user_id = v_uid then raise exception 'you cannot put yourself on payroll'/.test(SQL), 'wage ceiling and no self-payroll');
ok(/enable row level security/.test(SQL) && /revoke insert, update, delete on public\.corp_staff from authenticated, anon/.test(SQL), 'RLS on, no direct writes');
/* 🔒 Supabase's default privileges grant EXECUTE to `anon` as a SECOND ACL entry;
   `from public` alone leaves it standing (verified live on 2026-09-06). */
ok((SQL.match(/^revoke all on function [^\n;]*? from public, anon;$/gm) || []).length === 8 && !/ from public;$/m.test(SQL), 'every function revoke names anon as well as public');

/* ── host ── */
ok(fnText('corpStaffFetch').indexOf("rpc('corp_staff_list'") > 0, 'corpStaffFetch reads through the RPC');
ok(/offers you a job: /.test(fnText('corpStaffFetch')), 'a fresh offer for me is announced');
const pay = fnText('corpStaffPayroll');
ok(pay.indexOf("rpc('corp_staff_payroll'") > 0 && /10 \* 60 \* 1000/.test(pay) && /MythicWalletWatch\.soon\(300\)/.test(pay), 'payroll is throttled and wakes the wallet watcher when I was paid');
ok(/try \{ await corpStaffFetch\(\); \} catch \(e\) \{\}\n    try \{ corpStaffPayroll\(false\); \} catch \(e\) \{\}/.test(SRC), 'staff and payroll ride with opFetch');
ok(/const wNpc = Math\.max\(0, o\.workers \| 0\);\n  const wPpl = \(typeof _opStaffCount === 'function' && o\.id\) \? _opStaffCount\(o\.id\) : 0;/.test(SRC), 'production counts NPCs plus players');
ok(/const salaryPerHr = wNpc \* e\.salaryPerWorkerHr;/.test(SRC), 'op_salary counts NPCs only');
ok(/try \{ await corpStaffPayroll\(true\); \} catch \(e\) \{\}/.test(SRC), 'settle runs payroll');
ok(/myId: \(Profile\.cloud && Profile\.cloud\.userId\) \|\| '',\n    staff: \(Corp\.staff \|\| \[\]\),\n    staffRpc: Corp\.staffRpc \|\| 'unknown',/.test(SRC), 'payload carries staff, myId, staffRpc');
ok(/a\.kind === 'staffOffer' \|\| a\.kind === 'staffApply' \|\| a\.kind === 'staffCounter' \|\| a\.kind === 'staffAccept' \|\| a\.kind === 'staffEnd'/.test(SRC), 'the five actions route');
const act = fnText('_corpStaffAction');
['corp_staff_offer', 'corp_staff_apply', 'corp_staff_counter', 'corp_staff_accept', 'corp_staff_end'].forEach((f) => ok(act.indexOf("'" + f + "'") > 0, '_corpStaffAction calls ' + f));
ok(/run sql\/117_corp_staff\.sql/.test(act), 'a missing RPC names the file');
ok(/window\.MythicCorpStaff = \{ fetch: corpStaffFetch, payroll: corpStaffPayroll/.test(SRC), 'seam on window');

/* ── corp app ── */
ok(/PLAYER STAFF & WAGES/.test(JSX) && /kind: 'staffOffer'/.test(JSX) && /kind: 'staffApply'/.test(JSX) && /kind: 'staffCounter'/.test(JSX) && /kind: 'staffAccept'/.test(JSX) && /kind: 'staffEnd'/.test(JSX), 'the Staff & Wages block posts all five actions');
ok(/defaultValue=\{dv\}/.test(JSX) && /const val = \(id\) =>/.test(JSX), 'inputs are uncontrolled and read at click time');
ok(/const canAccept = isMe \? \(s\.status === 'offered'\) : \(isOwner && s\.status === 'countered'\);/.test(JSX), 'only the other side can accept');
ok(/screens\.jsx\?v=121v49/.test(readFileSync('./public/corp/index.html', 'utf8')) && /corp\/\?v=121v49/.test(SRC), 'corp app cache tags moved');

/* ── city income ── */
ok(/window\.cityAddCinders = \(n, why\) =>/.test(SRC) && /addCinders\(n, why \|\| 'City builder income'\)/.test(SRC), 'city income is booked as City builder income');
ok(/P\.addCinders\)\(n, 'City builder income'\); return true;/.test(NC), 'the city passes the reason through the bridge');
ok(/maxCatchUpDays: 7,/.test(TUN), 'offline catch-up runs a week');
ok(/window\.BUILD_VERSION = 'v121v(49|[5-9]\d|\d{3,})'/.test(SRC), 'build v121v49 or later');

console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
