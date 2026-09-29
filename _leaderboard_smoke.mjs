/* 🏆 LEADERBOARDS (v121v70).

   Asked for: top cities by Cinder, by each resource and by population; and a
   battle board for wins, ranked PvP wins and the unit with the most kills.

   THE ONE RULE THIS SUITE EXISTS FOR: nothing submits a score. The obvious
   build is a table the client writes its totals into, which is a board a
   modified client can type its way to the top of — and once one player does,
   it is worth nothing to anybody. sql/124 therefore creates NO table and
   grants NO insert; every figure is derived from saves the game already syncs.

   Also pinned: ranked wins come from `matches` (the ladder's own rows, which a
   save cannot edit) rather than from the competitive blob, and the app says
   which boards are only as good as the save.

   Run: node _leaderboard_smoke.mjs */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
const HS  = readFileSync('./public/src/phone/handset.js', 'utf8');
const SQL = readFileSync('./sql/124_leaderboards.sql', 'utf8');

/* ── read-only, and provably so ── */
ok(!/create table/i.test(SQL), 'the migration creates NO table — there is nowhere to submit a score');
ok(!/\binsert into\b/i.test(SQL), 'and no insert path at all');
ok(!/grant (insert|update|delete)/i.test(SQL), 'nothing is granted a write');
ok((SQL.match(/security definer/g) || []).length >= 3, 'the read functions are definer, so they can see across players');
ok(/revoke all on function public\.lb_cities\(text, int\)\s+from public, anon;/.test(SQL)
  && /revoke all on function public\.lb_players\(text, int\)\s+from public, anon;/.test(SQL),
  'BOTH acl entries come off every function — public and anon');
ok(/grant execute on function public\.lb_cities\(text, int\)\s+to authenticated;/.test(SQL), 'signed-in players may read');
ok(/limit greatest\(1, least\(100, coalesce\(p_limit, 25\)\)\)/.test(SQL), 'the page size is bounded whatever the client asks for');

/* ── the boards themselves ── */
ok(/when p_board = 'cinder' then \(/.test(SQL) && /sum\(public\._lb_num\(t\.value -> 'earn'\)\)/.test(SQL),
  'city Cinder is summed off the city\'s own tiles');
ok(/when p_board = 'population' then public\._lb_num\(s\.state -> 'npcPop'\)/.test(SQL), 'population comes from the city save');
ok(/else public\._lb_num\(s\.state -> 'stock' -> p_board\)/.test(SQL), 'and any refined good is a board of its own');
ok(/create or replace function public\.lb_city_resources\(\)/.test(SQL),
  'the resource list is asked for, not hard-coded — it cannot drift from the city builder');
{
  /* Ranked is the board that must not be self-reported. */
  const i = SQL.indexOf("p_board = 'ranked'");
  const seg = SQL.slice(Math.max(0, i - 400), i + 200);
  ok(/from public\.matches m/.test(seg), 'ranked wins are counted from the ladder\'s own match rows');
  ok(/m\.winner_id/.test(seg), 'by winner');
  ok(!/competitive/.test(seg), 'and NOT from the competitive blob, which is part of the save');
}
ok(/p_board = 'wins' and u\.records is not null/.test(SQL), 'total wins read the player record');
{
  const i = SQL.indexOf("p_board = 'kills'");
  const seg = SQL.slice(Math.max(0, i - 700), i + 60);
  ok(/order by public\._lb_num\(e\.value -> 'kills'\) desc\s*\n\s*limit 1/.test(seg), 'the kills board takes the BEST single unit, not the sum');
  ok(/u\.heroes/.test(seg) && /u\.units/.test(seg), 'reading heroes and units, which are the same shape');
}
ok(/jsonb_typeof\(p\) = 'number'/.test(SQL) && /~ '\^-\?\[0-9\]\+\(\\\.\[0-9\]\+\)\?\$'/.test(SQL),
  'a value that ought to be a number is read defensively — one bad key cannot take a board down');
{
  /* The dead join I measured before writing it. */
  ok(!/city_profiles/.test(SQL.replace(/--[^\n]*/g, '')), 'lb_cities does NOT join city_profiles');
  ok(/ZERO of its 57 rows join/.test(SQL), 'and the file records why: a different id space, measured on the live database');
}

/* ── the seam ── */
ok(/window\.MythicLeaderboard = \{/.test(SRC), 'the seam is on window, not a top-level const');
{
  const i = SRC.indexOf('window.MythicLeaderboard = {');
  const seg = SRC.slice(i, i + 3600);
  /* One guarded helper, not three call sites: `_rpc` is where the missing /
     offline / error classification lives, so a board that reached past it
     would lose the very distinction the app renders. */
  ok(/_rpc\('lb_cities'/.test(seg) && !/Cloud\.client\.rpc\('lb_/.test(seg), 'it goes through one guarded rpc helper');
  ok(/PGRST202\|PGRST205\|42883/.test(seg), 'an absent RPC reads as "missing", not as an empty board');
  ok(/nodeName:/.test(seg) && /unitName:/.test(seg), 'the two names the server cannot know are resolved here');
  ok(/return String\(id\);/.test(seg), 'and an unresolved id keeps its id rather than being renamed to something invented');
}

/* ── the app ── */
ok(/\{ id: 'board',\s+name: 'Leaderboards',/.test(HS), 'the phone has a Leaderboards app');
ok(/else if \(id === 'board'\) \{ lbLoaded = false;/.test(HS), 'opening it resets the fetch latch');
{
  const i = HS.indexOf('function lbEnsure(');
  ok(i > 0 && /lbSide === 'city'\) \? L\.cities\(lbBoard, 25\) : L\.players\(lbBoard, 25\)/.test(HS.slice(i, i + 600)),
    'it fetches the board it is showing, on open');
}
{
  const i = HS.indexOf('if (!rows.length) {');
  const seg = HS.slice(i, i + 800);
  ok(/lbLoading \? 'Reading the board…'/.test(seg), 'an unanswered fetch says so');
  ok(/lbState === 'missing' \? 'Leaderboards are not set up on this world yet\./.test(seg), 'an unapplied migration says THAT');
  const iNone = seg.indexOf('Nobody is on this board yet');
  ok(iNone > seg.indexOf("lbLoading ?"), '"nobody yet" is the LAST branch');
}
ok(/const medal = \(i\) => \(i === 0 \? '🥇'/.test(HS), 'the top three are called out');
ok(/mine \? ' <i class="mgp-n">you<\/i>' : ''/.test(HS), 'and your own row is marked');
ok(/it is the one board a save cannot flatter/.test(HS),
  'the app says plainly which boards read a save and which one does not');
ok(/LB_CITY\.concat\(\(lbResList \|\| \[\]\)\.map/.test(HS), 'the resource boards come from the server list, not a hard-coded set');
console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
