/* ══════════════════════════════════════════════════════════════════════════
   🎯 DRIVE-MM-PAIRING-SQL — the matchmaker, checked as SQL instead of as prose

   ⚠ THIS DRIVER CANNOT PROVE PAIRING WORKS. It never opens a socket. The
     pairing logic lives in Postgres on project ktsiasyjusesawtrwrjc, nothing
     in this repo can execute SQL there, and proving pairing end-to-end needs
     two real signed-in accounts queueing inside the same 30-second window.
     What it CAN do is stop the file from silently rotting, and that is the
     failure mode that actually happened: try_pair_match() existed only as text
     inside a JS template literal (public/index.html:56674), where no test, no
     linter and no reviewer ever looked at it as code.

   So this driver reads sql/066_matchmaking_server.sql the way the SQL editor
   would and asserts four things a human would otherwise have to eyeball:

     1. Every statement is re-runnable. Somebody WILL paste this twice.
     2. The trigger body is still the shipped one. The whole point of the
        migration is that it carries over index.html:56823-56858 with exactly
        two behavioural changes — so it diffs the two bodies line by line and
        fails on any third difference. A rewrite that "improves" the matchmaker
        while transcribing it is the way this file stops matching the server.
     3. The staleness cutoff is still above MATCHMAKING_AI_FALLBACK_MS. That
        constant is in index.html and can be lowered by someone who has never
        read this SQL; if it ever passes 45s the migration starts discarding
        players who are still sitting on the search screen.
     4. mm_try_pair is still SECURITY DEFINER, still search_path-pinned, and
        still not granted to anon.

   🔴 THE CONTROL: the pre-fix body — the one live on the server right now — is
     run through the same staleness assertions and MUST fail them. Without that
     half, a migration that copied index.html verbatim and fixed nothing would
     score full marks.

   Run:  node .gauntlet/drive-mm-pairing-sql.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';

const SQL_PATH = 'sql/066_matchmaking_server.sql';
const SQL = fs.readFileSync(SQL_PATH, 'utf8');
const HTML = fs.readFileSync('public/index.html', 'utf8');

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  OK   ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };

/* ⚠ The destructive-statement scans MUST run on code, not on the whole file.
   The header of 066 says in prose "contains no DROP TABLE, no TRUNCATE" — and
   a scan over the raw text read its own promise as a violation. Strip `--` to
   end-of-line first. (Safe for this file: no string literal in it contains a
   double hyphen.) */
const CODE = SQL.split(/\r?\n/).map((l) => l.replace(/--.*$/, '')).join('\n');

console.log('\n\u{1F3AF} MATCHMAKING SQL · THE PAIRING SCHEMA, READ AS CODE\n');

/* ── pull a plpgsql body out of either file ──────────────────────────────── */
function fnBody(src, name) {
  const head = 'create or replace function public.' + name + '(';
  const at = src.indexOf(head);
  if (at < 0) return null;
  const end = src.indexOf('\nend $$;', at);
  return end < 0 ? null : src.slice(at, end + '\nend $$;'.length);
}
/* Statements only: comments and blank lines are where the two files are
   MEANT to differ (the migration explains itself; the JS literal does not). */
const statements = (body) => body
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('--'));

const sqlTrig  = fnBody(SQL, 'try_pair_match');
const htmlTrig = fnBody(HTML, 'try_pair_match');
const sqlRpc   = fnBody(SQL, 'mm_try_pair');

console.log('  ── the file exists and knows what it is');
ok('\u{1F3AF} sql/066_matchmaking_server.sql is present', !!SQL);
ok('\u{1F3AF} try_pair_match was found in the migration', !!sqlTrig);
ok('\u{1F3AF} try_pair_match was found in index.html (the source of truth)', !!htmlTrig);
ok('\u{1F3AF} mm_try_pair was found in the migration', !!sqlRpc);
/* The one claim that matters more than any assertion below: a reader must not
   come away thinking the server changed. */
ok('\u{1F3AF} the header says plainly it has NOT been applied',
   /HAS NOT BEEN APPLIED/.test(SQL) && /ktsiasyjusesawtrwrjc/.test(SQL));
ok('\u{1F3AF} the header claims no deployment',
   !/\b(is now (live|applied|deployed))\b/i.test(SQL));

console.log('\n  ── only the matchmaking objects came across');
/* 🔴 CLOUD_SQL_SCHEMA also contains `drop policy if exists` against LIVE
   user_profiles / friends / card_catalog. Dragging those along would strip
   policies off tables this migration has no business touching. */
for (const stowaway of ['user_profiles', 'friends', 'card_catalog', 'touch_updated_at', 'storage.objects']) {
  ok('\u{1F3AF} no ' + stowaway.padEnd(17) + ' statements', !new RegExp('(create|alter|drop)[^\\n]*' + stowaway.replace('.', '\\.')).test(CODE));
}

console.log('\n  ── re-runnable: somebody will paste this twice');
const creates = SQL.match(/^create (?:table|policy|trigger|or replace function)[^\n]*/gmi) || [];
ok('\u{1F3AF} found the create statements to check', creates.length >= 8, creates.length + ' found');
for (const c of creates) {
  const kind = /^create table/i.test(c) ? 'table'
             : /^create policy/i.test(c) ? 'policy'
             : /^create trigger/i.test(c) ? 'trigger' : 'function';
  let guarded = false;
  if (kind === 'table')    guarded = /if not exists/i.test(c);
  if (kind === 'function') guarded = true; // `create or replace`
  if (kind === 'policy' || kind === 'trigger') {
    // the matching drop must appear somewhere ABOVE this create
    const name = (c.match(/^create (?:policy|trigger)\s+("[^"]+"|\S+)/i) || [])[1];
    const dropAt = SQL.indexOf('drop ' + kind + ' if exists ' + name);
    guarded = dropAt >= 0 && dropAt < SQL.indexOf(c);
  }
  ok('\u{1F3AF} guarded: ' + c.slice(0, 62), guarded);
}
for (const alt of SQL.match(/^alter table[^\n]*add column[^\n]*/gmi) || []) {
  ok('\u{1F3AF} guarded: ' + alt.slice(0, 62), /add column if not exists/i.test(alt));
}

console.log('\n  ── RLS on both tables, with policies');
for (const t of ['matchmaking_queue', 'matches']) {
  ok('\u{1F3AF} ' + t.padEnd(18) + ' enables row level security',
     new RegExp('alter table public\\.' + t + ' enable row level security').test(SQL));
  const pols = (SQL.match(new RegExp('create policy [^\\n]+ on public\\.' + t, 'g')) || []).length;
  ok('\u{1F3AF} ' + t.padEnd(18) + ' ships at least one policy', pols >= 1, pols + ' policies');
}

console.log('\n  ── nothing destructive');
ok('\u{1F3AF} no DROP TABLE', !/drop\s+table/i.test(CODE));
ok('\u{1F3AF} no TRUNCATE', !/truncate/i.test(CODE));
/* Every DELETE in this file must carry a WHERE on the same line. The two
   sweeps and the two-row cleanup all do; a bare `delete from` would empty the
   live queue for everyone currently searching. */
const deletes = CODE.match(/^\s*delete from[\s\S]*?;/gmi) || [];
ok('\u{1F3AF} found the delete statements to check', deletes.length >= 4, deletes.length + ' found');
for (const d of deletes) ok('\u{1F3AF} has a WHERE: ' + d.replace(/\s+/g, ' ').slice(0, 58), /\bwhere\b/i.test(d));

console.log('\n  ── the staleness cutoff vs. the AI fallback');
/* 30000 today. If someone lowers it below the SQL cutoff, the migration starts
   sweeping players who are still watching the search screen. */
const fbMs = Number((HTML.match(/const MATCHMAKING_AI_FALLBACK_MS\s*=\s*(\d+)/) || [])[1]);
ok('\u{1F3AF} MATCHMAKING_AI_FALLBACK_MS read out of index.html', Number.isFinite(fbMs), fbMs + 'ms');
const cutoffs = [...SQL.matchAll(/interval\s+'(\d+)\s+seconds'/g)].map((m) => Number(m[1]));
ok('\u{1F3AF} the migration states a staleness interval', cutoffs.length >= 4, JSON.stringify(cutoffs));
ok('\u{1F3AF} every cutoff sits at or above the AI fallback window',
   cutoffs.length > 0 && cutoffs.every((s) => s * 1000 >= fbMs),
   'cutoffs=' + JSON.stringify(cutoffs) + ' fallback=' + (fbMs / 1000) + 's');

console.log('\n  ── the sweep runs BEFORE anything is selected');
for (const [name, body] of [['try_pair_match', sqlTrig], ['mm_try_pair', sqlRpc]]) {
  if (!body) { ok('\u{1F3AF} ' + name + ' body available', false); continue; }
  const sweep = body.search(/delete from public\.matchmaking_queue where queued_at </);
  const sel   = body.search(/select \* into opp/);
  ok('\u{1F3AF} ' + name.padEnd(15) + ' sweeps stale rows', sweep >= 0);
  ok('\u{1F3AF} ' + name.padEnd(15) + ' sweep precedes the opponent SELECT', sweep >= 0 && sel > sweep, 'sweep@' + sweep + ' select@' + sel);
  ok('\u{1F3AF} ' + name.padEnd(15) + ' bounds the opponent by queued_at',
     /and queued_at > now\(\) - interval '\d+ seconds'/.test(body));
  ok('\u{1F3AF} ' + name.padEnd(15) + ' keeps the 500-point MMR band', /abs\(mmr - \w+\.mmr\) < 500/.test(body));
  ok('\u{1F3AF} ' + name.padEnd(15) + ' keeps mode equality', /and mode = \w+\.mode/.test(body));
  ok('\u{1F3AF} ' + name.padEnd(15) + ' keeps FOR UPDATE SKIP LOCKED', /for update skip locked/.test(body));
}

/* 🔴 THE CONTROL — the body that is live on the server right now. It must FAIL
   both staleness assertions, otherwise the two above prove nothing. */
console.log('\n  ── \u{1F534} control: the body live on the server today must FAIL these');
ok('\u{1F534} live try_pair_match has NO sweep (this is bug 1)',
   !!htmlTrig && !/delete from public\.matchmaking_queue where queued_at </.test(htmlTrig));
ok('\u{1F534} live try_pair_match has NO queued_at bound (this is bug 1)',
   !!htmlTrig && !/and queued_at > now\(\)/.test(htmlTrig));
ok('\u{1F534} live schema has no mm_try_pair at all (this is bug 2)',
   !/create or replace function public\.mm_try_pair/.test(HTML));

console.log('\n  ── the trigger body is a transcription, not a rewrite');
/* Strip the two intended additions from the migration's body; what is left
   must be the shipped body statement-for-statement. A third difference — a
   renamed variable, a widened MMR band, a dropped SKIP LOCKED — fails here. */
if (sqlTrig && htmlTrig) {
  const added = [];
  const sqlLines = statements(sqlTrig).filter((l) => {
    if (/^delete from public\.matchmaking_queue where queued_at < now\(\) - interval '\d+ seconds';$/.test(l)) { added.push(l); return false; }
    if (/^and queued_at > now\(\) - interval '\d+ seconds'$/.test(l)) { added.push(l); return false; }
    return true;
  });
  const htmlLines = statements(htmlTrig);
  ok('\u{1F3AF} exactly two lines were added to the trigger', added.length === 2, JSON.stringify(added));
  ok('\u{1F3AF} the remaining body is line-for-line the shipped one',
     sqlLines.length === htmlLines.length && sqlLines.every((l, i) => l === htmlLines[i]),
     sqlLines.length === htmlLines.length
       ? (sqlLines.find((l, i) => l !== htmlLines[i]) || '')
       : 'line count ' + sqlLines.length + ' vs ' + htmlLines.length);
}
ok('\u{1F3AF} the trigger is still AFTER INSERT on matchmaking_queue',
   /create trigger trigger_pair_match\s*\n\s*after insert on public\.matchmaking_queue/.test(SQL));
ok('\u{1F3AF} the trigger is dropped before it is created',
   SQL.indexOf('drop trigger if exists trigger_pair_match') < SQL.indexOf('create trigger trigger_pair_match'));

console.log('\n  ── mm_try_pair cannot be aimed at somebody else');
ok('\u{1F3AF} returns jsonb', /create or replace function public\.mm_try_pair\(\)\s*\r?\n?\s*returns jsonb/.test(SQL));
ok('\u{1F3AF} SECURITY DEFINER', !!sqlRpc && /security definer/.test(sqlRpc));
ok('\u{1F3AF} search_path is pinned to public', !!sqlRpc && /set search_path = public/.test(sqlRpc));
ok('\u{1F3AF} takes NO arguments — the caller cannot name a victim', /public\.mm_try_pair\(\)/.test(SQL) && !/public\.mm_try_pair\([^)]+\)/.test(SQL));
ok('\u{1F3AF} scopes itself by auth.uid()', !!sqlRpc && /where user_id = auth\.uid\(\)/.test(sqlRpc));
ok('\u{1F3AF} refuses an unauthenticated caller', !!sqlRpc && /if auth\.uid\(\) is null then/.test(sqlRpc));
ok('\u{1F3AF} execute revoked from anon', /revoke execute on function public\.mm_try_pair\(\) from anon;/.test(SQL));
ok('\u{1F3AF} execute revoked from public', /revoke execute on function public\.mm_try_pair\(\) from public;/.test(SQL));
ok('\u{1F3AF} execute granted to authenticated', /grant execute on function public\.mm_try_pair\(\) to authenticated;/.test(SQL));
ok('\u{1F3AF} not granted to anon anywhere', !/grant[^\n]*mm_try_pair[^\n]*anon/.test(SQL));

console.log('\n  ── the verify at the foot of the file fails against today’s server');
/* A verify that would pass BEFORE the migration proves nothing. It has to
   assert something only the new body has. */
const verify = SQL.slice(SQL.lastIndexOf('-- VERIFY'));
ok('\u{1F3AF} there is a verify block', verify.length > 200);
ok('\u{1F3AF} it inspects the live function body', /pg_get_functiondef/.test(verify));
ok('\u{1F3AF} it asserts the queued_at bound — absent from the live body, so it fails today',
   /queued_at > now\(\)/.test(verify));
ok('\u{1F3AF} it asserts mm_try_pair exists — absent today', /mm_try_pair/.test(verify));

console.log('\n  ── the client half has since landed');
/* This line used to assert the OPPOSITE — "nothing in index.html calls
   mm_try_pair yet (that is a later piece)". That later piece is now in: branch
   (b) of the poll tick calls rpc('mm_try_pair') on every tick and falls back
   once per search to a delete-then-insert re-queue when the server answers
   PGRST202 — which it does TODAY, because this SQL file has still not been
   applied anywhere. Driven in .gauntlet/drive-matchmaking.mjs. Kept as a live
   assertion rather than deleted so the function and its only caller cannot
   drift apart unnoticed. */
ok('\u{1F3AF} the poll tick calls rpc(mm_try_pair) — see .gauntlet/drive-matchmaking.mjs',
   /rpc\(\s*['"]mm_try_pair['"]/.test(HTML));

console.log(fails ? ('\n' + fails + ' CHECK(S) FAILED') : '\nALL CHECKS PASSED');
console.log('⚠ Reminder: this driver proves the FILE is right. It proves nothing about');
console.log('  the live database — sql/066 has not been applied and pairing on the server');
console.log('  is unchanged until a human runs it in the SQL editor.\n');
process.exit(fails ? 1 : 0);
