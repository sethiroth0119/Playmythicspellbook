#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// sql-lint.mjs — the CLAUDE.md migration rules, enforced on sql/*.sql.
//
//   node tools/gamedev/sql-lint.mjs             # all numbered migrations
//   node tools/gamedev/sql-lint.mjs sql/040_x.sql
//   node tools/gamedev/sql-lint.mjs --json | --strict
//
// Rules (each maps to a sentence in CLAUDE.md → "Migrations"):
//   rls.enable      every CREATE TABLE has ALTER TABLE … ENABLE ROW LEVEL SECURITY   (ERROR)
//   rls.policy      CREATE TABLE with RLS and zero policies = service-role-only; the
//                   file must say so in a comment                                    (WARN)
//   rls.using       a policy body without USING/WITH CHECK is wide open               (ERROR)
//   rls.recursion   a SELECT/ALL policy on T that selects from T recurses — must go
//                   through a SECURITY DEFINER helper (is_community_member/leader)   (ERROR)
//   idem.table      CREATE TABLE must be IF NOT EXISTS                                 (WARN)
//   idem.function   CREATE FUNCTION must be CREATE OR REPLACE                          (WARN)
//   idem.policy     CREATE POLICY should be preceded by DROP POLICY IF EXISTS          (WARN)
//   idem.index      CREATE INDEX must be IF NOT EXISTS                                 (WARN)
//   verify.tail     file ends with a verification SELECT                               (WARN)
//   ledger.update   UPDATE … SET <balance-ish column> — ledgers are append-only        (WARN)
//   definer.search  SECURITY DEFINER function without SET search_path                  (WARN)
// RLS is the entire security boundary; a missing USING looks fine in review. That is
// why this is a machine, not a checklist.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { ROOT, argFlag, positional } from './headless.mjs';

const files = positional().length ? positional() : readdirSync(join(ROOT, 'sql')).filter((f) => /^\d.*\.sql$/.test(f)).sort().map((f) => join('sql', f));
const findings = [];
const add = (level, file, rule, msg) => findings.push({ level, file: basename(file), rule, msg });

// strip comments so a commented-out statement never satisfies or trips a rule
const strip = (sql) => sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const ident = (s) => s.replace(/^public\./i, '').replace(/"/g, '').toLowerCase();

for (const rel of files) {
  const raw = readFileSync(join(ROOT, rel), 'utf8');
  const sql = strip(raw);
  const low = sql.toLowerCase();

  const tables = [...sql.matchAll(/create\s+table\s+(if\s+not\s+exists\s+)?([\w."]+)/gi)].map((m) => ({ name: ident(m[2]), ifne: !!m[1] }));
  for (const t of tables) {
    if (!t.ifne) add('WARN', rel, 'idem.table', 'CREATE TABLE ' + t.name + ' is not IF NOT EXISTS — file is not re-runnable');
    const rlsRe = new RegExp('alter\\s+table\\s+(?:public\\.)?"?' + t.name + '"?\\s+enable\\s+row\\s+level\\s+security', 'i');
    if (!rlsRe.test(sql)) add('ERROR', rel, 'rls.enable', 'table ' + t.name + ' is created but RLS is never enabled');
    const polRe = new RegExp('create\\s+policy\\s+[^;]*?\\s+on\\s+(?:public\\.)?"?' + t.name + '"?\\b', 'ig');
    const pols = [...sql.matchAll(polRe)];
    // RLS on + zero policies = only the service role can touch it. That is a real
    // and common pattern here (anti-dupe enforcement tables, push config), so it is
    // a WARN that asks for the intent to be written down, not an ERROR.
    if (!pols.length) {
      const near = raw.toLowerCase();
      const stated = /service[- ]role|server[- ]only|no (client )?polic|edge function only|not readable by clients/.test(near);
      add(stated ? 'INFO' : 'WARN', rel, 'rls.policy', 'table ' + t.name + ' has RLS enabled and no policy → service-role-only' + (stated ? ' (intent stated in file — ok)' : '. If that is intended, say "service role only" in a comment; if clients need it, add policies'));
    }
  }

  for (const m of sql.matchAll(/create\s+policy\s+("[^"]+"|\w+)\s+on\s+([\w."]+)([^;]*);/gi)) {
    const [, pname, tname, body] = m; const b = body.toLowerCase();
    if (!/\busing\b/.test(b) && !/with\s+check/.test(b)) add('ERROR', rel, 'rls.using', 'policy ' + pname + ' on ' + ident(tname) + ' has no USING / WITH CHECK — it grants everything to everyone it applies to');
    // Recursion: a SELECT (or ALL) policy on T whose body selects from T re-enters
    // itself. An UPDATE/INSERT/DELETE policy's subselect only triggers T's SELECT
    // policies, so those are fine unless the SELECT policy is the one that recurses.
    const cmd = (b.match(/\bfor\s+(select|insert|update|delete|all)\b/) || [, 'all'])[1];
    const selfRef = new RegExp('\\bfrom\\s+(?:public\\.)?"?' + ident(tname).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"?\\b').test(b);
    if (selfRef && (cmd === 'select' || cmd === 'all')) add('ERROR', rel, 'rls.recursion', 'policy ' + pname + ' (' + cmd + ') on ' + ident(tname) + ' selects from ' + ident(tname) + ' — infinite recursion; go through a SECURITY DEFINER helper (is_community_member / is_community_leader pattern)');
    else if (selfRef) add('INFO', rel, 'rls.recursion', 'policy ' + pname + ' (' + cmd + ') on ' + ident(tname) + ' selects from its own table — safe only while the SELECT policy on it does not recurse');
    const before = sql.slice(0, m.index).toLowerCase();
    const dropRe = new RegExp('drop\\s+policy\\s+if\\s+exists\\s+' + pname.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!dropRe.test(before)) add('WARN', rel, 'idem.policy', 'CREATE POLICY ' + pname + ' has no preceding DROP POLICY IF EXISTS — re-running the file fails');
  }

  for (const m of sql.matchAll(/create\s+(or\s+replace\s+)?function\s+([\w."]+)/gi)) if (!m[1]) add('WARN', rel, 'idem.function', 'CREATE FUNCTION ' + ident(m[2]) + ' without OR REPLACE');
  for (const m of sql.matchAll(/create\s+(unique\s+)?index\s+(if\s+not\s+exists\s+)?(\w+)/gi)) if (!m[2]) add('WARN', rel, 'idem.index', 'CREATE INDEX ' + m[3] + ' without IF NOT EXISTS');

  // SECURITY DEFINER without a pinned search_path is a privilege-escalation classic.
  for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([\w."]+)[\s\S]*?(?=create\s+(?:or\s+replace\s+)?function|\Z)/gi)) {
    const chunk = m[0].toLowerCase();
    if (/security\s+definer/.test(chunk) && !/set\s+search_path/.test(chunk)) add('WARN', rel, 'definer.search', 'SECURITY DEFINER function ' + ident(m[1]) + ' does not SET search_path');
  }

  // Ledgers are append-only: balance = sum(amount). An UPDATE that sets a balance-ish
  // column is the pattern CLAUDE.md forbids. (Locked wallet columns from 026 are the
  // enforcement; this is the early warning.)
  for (const m of sql.matchAll(/update\s+([\w."]+)\s+set\s+([^;]*);/gi)) {
    if (/\b(balance|gems|cinder|aza|boe|treasury|wallet)\w*\s*=/.test(m[2].toLowerCase())) add('WARN', rel, 'ledger.update', 'UPDATE ' + ident(m[1]) + ' SET a balance-like column — ledgers are append-only (insert a row, balance = sum(amount))');
  }

  const tail = low.trim().split(';').filter((s) => s.trim()).slice(-2).join(';');
  if (!/\bselect\b/.test(tail)) add('WARN', rel, 'verify.tail', 'file does not end with a verification SELECT');
}

const by = (l) => findings.filter((f) => f.level === l);
if (argFlag('json')) console.log(JSON.stringify(findings, null, 1));
else {
  ['ERROR', 'WARN'].forEach((lvl) => { const rows = by(lvl); if (!rows.length) return; console.log('\n' + lvl + ' (' + rows.length + ')'); rows.forEach((f) => console.log('  ' + (lvl === 'ERROR' ? '✗' : '!') + ' ' + f.file.padEnd(38) + '[' + f.rule + '] ' + f.msg)); });
  console.log('\n' + files.length + ' migration file(s): ' + by('ERROR').length + ' error(s), ' + by('WARN').length + ' warning(s)');
}
process.exit(by('ERROR').length || (argFlag('strict') && by('WARN').length) ? 1 : 0);
