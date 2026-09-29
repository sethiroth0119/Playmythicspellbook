/* Structural lint for sql/048. There is no Postgres in this environment, so the
   migration cannot be EXECUTED here — it is applied by hand by the user. What
   can be checked mechanically is checked, because a $$ typo in a 600-line file
   pasted into the SQL editor fails halfway through and leaves the database in a
   half-migrated state. */
import { readFileSync } from 'fs';
const F = new URL('../sql/048_corp_trade_offers.sql', import.meta.url);
const SQL = readFileSync(F, 'utf8');
let fails = 0;
const chk = (n, ok, x) => { if (ok) console.log('  PASS  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '  ' + x : '')); } };

// Strip -- comments so a `$$` mentioned in prose does not skew the count.
const code = SQL.split(/\r?\n/).map(l => l.replace(/--.*$/, '')).join('\n');

const dollars = (code.match(/\$\$/g) || []).length;
chk('$$ dollar-quote delimiters are balanced (' + dollars + ')', dollars % 2 === 0);

// `end $$;` also terminates every plpgsql FUNCTION body, so a raw count would
// compare two different things. Match the anonymous blocks structurally instead.
const doBlocks = (code.match(/\bdo \$\$/g) || []).length;
const doWell   = (code.match(/\bdo \$\$\s*begin[\s\S]*?end \$\$;/g) || []).length;
chk('every `do $$` anonymous block is begin/end-closed (' + doWell + ' of ' + doBlocks + ')',
  doBlocks > 0 && doBlocks === doWell);
const bodies = (code.match(/language plpgsql/g) || []).length;
const endsAll = (code.match(/end \$\$;/g) || []).length;
chk('every plpgsql body + do-block ends with `end $$;` (' + bodies + '+' + doBlocks + ' = ' + endsAll + ')',
  bodies + doBlocks === endsAll);

const fns = [...code.matchAll(/create or replace function public\.([a-z_]+)\s*\(/g)].map(m => m[1]);
const want = ['is_corp_member', '_ct_norm', '_ct_cinder_take', '_ct_cinder_give', '_ct_log', '_ct_log_side',
  'corp_trade_propose', 'corp_trade_accept', 'corp_trade_decline', 'corp_trade_cancel', 'corp_trade_claim'];
chk('all 11 functions declared: ' + fns.join(', '), want.every(w => fns.includes(w)), 'got ' + fns.join(','));
chk('no function is declared twice', new Set(fns).size === fns.length);

// 🔴 The bug this round fixed. `create or replace` cannot drop a parameter
// default, so 048's copy MUST carry `default auth.uid()` exactly as 045/046 do.
chk('is_corp_member keeps `default auth.uid()` — 045/046 have it and a replace cannot remove it',
  /create or replace function public\.is_corp_member\(p_corp_id uuid, p_user_id uuid default auth\.uid\(\)\)/.test(code));
chk('…and keeps the founder branch, so it does not silently retighten the vault/treasury',
  /c\.id = p_corp_id and c\.founder_id = p_user_id/.test(code));

// Every SECURITY DEFINER function must pin search_path, or a caller-controlled
// path turns one into an arbitrary-code seam.
const defs = [...code.matchAll(/create or replace function public\.([a-z_]+)[\s\S]*?\$\$/g)];
const unpinned = defs.filter(m => /security definer/i.test(m[0]) && !/set search_path\s*=\s*public/.test(m[0])).map(m => m[1]);
chk('every SECURITY DEFINER function pins search_path', unpinned.length === 0, unpinned.join(','));

chk('RLS is enabled on the table', /alter table public\.corp_trade_offers enable row level security/.test(code));
const sel = /create policy cto_sel[\s\S]*?;/.exec(code);
chk('the SELECT policy scopes to auth.uid() AND membership',
  !!sel && /from_id = auth\.uid\(\) or to_id = auth\.uid\(\)/.test(sel[0]) && /is_corp_member\(/.test(sel[0]));
chk('no policy queries corp_members directly (RLS recursion)',
  !/create policy[\s\S]*?from\s+(public\.)?corp_members/i.test(code));
chk('direct writes are revoked from public, anon AND authenticated',
  /revoke insert, update, delete on public\.corp_trade_offers from public, anon, authenticated;/.test(code));
chk('no create policy for insert/update/delete exists on the table',
  ![...code.matchAll(/create policy \w+ on public\.corp_trade_offers for (insert|update|delete)/g)].length);

chk('every RPC is granted only to authenticated', want.filter(w => w.startsWith('corp_trade_'))
  .every(w => new RegExp('grant execute on function public\\.' + w + '\\(').test(code)));
chk('the internal _ct_* helpers are granted to nobody',
  ['_ct_norm', '_ct_cinder_take', '_ct_cinder_give', '_ct_log', '_ct_log_side']
    .every(w => new RegExp('revoke all on function public\\.' + w + '\\(').test(code)
             && !new RegExp('grant execute on function public\\.' + w + '\\(').test(code)));

chk('idempotent: table/index creation is guarded', /create table if not exists/.test(code)
  && (code.match(/create index if not exists/g) || []).length >= 3);
chk('idempotent: every policy is dropped before it is created',
  (code.match(/drop policy if exists cto_sel/g) || []).length === 1);
chk('ends with a verify query', /select[\s\S]*table_expect_1[\s\S]*client_can_write_expect_false;\s*$/.test(code.trim()));

// The verify's own arithmetic: it claims 16 columns, so count them.
const tbl = /create table if not exists public\.corp_trade_offers \(([\s\S]*?)\n\);/.exec(code);
const cols = tbl ? tbl[1].split('\n').map(l => l.trim()).filter(l => /^[a-z_]+\s+(uuid|text|jsonb|bigint|boolean|timestamptz)/.test(l)).length : -1;
chk('the verify\'s cols_expect_16 matches the actual column count (' + cols + ')', cols === 16);
const fnCount = new Set(fns.filter(f => f.startsWith('corp_trade_') || f === 'is_corp_member')).size;
chk('the verify\'s fns_expect_6 matches the granted-function count (' + fnCount + ')', fnCount === 6);

chk('self-trade is refused by a table CONSTRAINT, not only by the functions',
  /check \(from_id <> to_id\)/.test(code));
chk('accept re-checks BOTH parties\' membership at settle time',
  /is_corp_member\(r\.corp_id, r\.from_id\)/.test(code) && /is_corp_member\(r\.corp_id, r\.to_id\)/.test(code));
chk('claim is idempotent by construction (the flag is in the WHERE clause)',
  /set to_claimed = true[\s\S]{0,120}and to_claimed = false/.test(code)
  && /set from_claimed = true[\s\S]{0,140}and from_claimed = false/.test(code));
chk('the Cinder overdraw guard is in the UPDATE, not in the client',
  /where g\.user_id = p_uid and g\.cinder >= p_amt/.test(code));
chk('every debit bumps wallet_seq (sql/023 — an unbumped debit is refunded)',
  /wallet_seq = g\.wallet_seq \+ 1/.test(code));
chk('credits do NOT bump wallet_seq', !/set cinder = coalesce\(cinder,0\) \+ p_amt[\s\S]{0,80}wallet_seq/.test(code));

console.log(fails === 0 ? '\nsql/048 STRUCTURAL LINT: ALL PASS' : '\n' + fails + ' FAILED');
process.exit(fails ? 1 : 0);
