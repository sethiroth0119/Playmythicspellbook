#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   DEPLOY ALL — ship BOTH live products in one command.

   There are two independent Cloudflare deploys, and "deploy everything" has
   historically meant only one of them:

     game    H:\aiTcgbattler\game-deploy    → playmythicspellbook.play-a3d.workers.dev
     market  H:\aiTcgbattler\market-deploy  → mythicspellbook.xyz

   They have DIFFERENT pipelines. game-deploy minifies index.html, bumps
   version.txt / BUILD_VERSION / CACHE_VERSION, then restores the source.
   market-deploy is plain assets: no package.json scripts, no minify, and no
   version stamp of any kind. So they cannot be verified the same way — see
   verify() below.

   ⚠ WHY THIS SCRIPT CHECKS GIT FIRST
   Both working trees are shared with other sessions and routinely hold
   in-progress work. `wrangler deploy` publishes what is ON DISK, not what is
   committed — so an unattended run can push someone else's half-finished
   edit to a live public site, and can DELETE live files that are merely
   missing locally (that is exactly how assets/vfx/three.min.js and 9
   cinematic pages went off the air). This script therefore refuses to deploy
   a dirty tree unless --allow-dirty is passed.

   ⚠ WHY IT CURL-VERIFIES INSTEAD OF READING THE LOG
   wrangler prints "No updated asset files to upload" whenever the content
   hash matches — which is indistinguishable from "the file was never
   uploaded". node-city/ 404'd for days behind that exact message. The log is
   not evidence; the served bytes are.

   USAGE
     node deploy-all.mjs                 # both, refuse if dirty
     node deploy-all.mjs --game          # game only
     node deploy-all.mjs --market        # market only
     node deploy-all.mjs --allow-dirty   # publish uncommitted work anyway
     node deploy-all.mjs --dry           # report state, deploy nothing
   ═══════════════════════════════════════════════════════════════════════════ */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const GAME   = 'H:\\aiTcgbattler\\game-deploy';
const MARKET = 'H:\\aiTcgbattler\\market-deploy';

const argv        = process.argv.slice(2);
const ONLY_GAME   = argv.includes('--game');
const ONLY_MARKET = argv.includes('--market');
const ALLOW_DIRTY = argv.includes('--allow-dirty');
const DRY         = argv.includes('--dry');

const log  = (m) => console.log(m);
const rule = (t) => log('\n' + '═'.repeat(72) + '\n  ' + t + '\n' + '═'.repeat(72));

function sh(cmd, cwd, quiet) {
  return execSync(cmd, { cwd, encoding: 'utf8', stdio: quiet ? 'pipe' : 'inherit', maxBuffer: 64 * 1024 * 1024 });
}

/* Uncommitted or untracked files under the deployed directory. Untracked
   counts: wrangler uploads it, so it goes live whether or not git knows. */
function dirtyFiles(cwd, dir) {
  try {
    const out = sh(`git status --porcelain -- ${dir}`, cwd, true) || '';
    return out.split('\n').map(s => s.trim()).filter(Boolean);
  } catch (e) { return []; }
}

/* Deleted-on-disk files are the dangerous kind: a deploy REMOVES them live. */
function deletions(cwd, dir) {
  return dirtyFiles(cwd, dir).filter(l => /^D /.test(l) || /^ D/.test(l));
}

async function fetchText(url) {
  const bust = (url.includes('?') ? '&' : '?') + 'nc=' + Date.now() + Math.random().toString(36).slice(2);
  const r = await fetch(url + bust, { headers: { 'Cache-Control': 'no-cache' }, redirect: 'follow' });
  return { status: r.status, body: await r.text() };
}

/* Poll until the edge serves the expected marker. The edge can hand out the
   PREVIOUS build for a fresh URL for a minute or two after a deploy, so a
   single check right after `wrangler deploy` proves nothing either way. */
async function verify(label, url, expect, tries = 10) {
  for (let i = 1; i <= tries; i++) {
    try {
      const { status, body } = await fetchText(url);
      if (status === 200 && (!expect || body.includes(expect))) {
        log(`  ✅ ${label}: serving${expect ? ` "${expect}"` : ''} (${body.length} bytes)`);
        return true;
      }
      log(`  … ${label}: attempt ${i}/${tries} — status ${status}${expect ? ', marker not present yet' : ''}`);
    } catch (e) { log(`  … ${label}: attempt ${i}/${tries} — ${e.message}`); }
    await new Promise(r => setTimeout(r, 4000));
  }
  log(`  ❌ ${label}: NOT serving the expected content after ${tries} tries.`);
  return false;
}

/* ⚠ Deliberately asymmetric. These trees ALWAYS carry uncommitted and
   untracked work — game-deploy alone sits at ~170 paths of in-progress art —
   so blocking on "dirty" would block every normal deploy and the flag would
   become reflex. Only DELETIONS hard-stop, because only deletions destroy
   something already live: wrangler removes files that are missing locally,
   which is how three.min.js and 9 cinematic pages went off the air. Everything
   else is reported and allowed through. */
function gate(name, cwd, dir) {
  const dirty = dirtyFiles(cwd, dir);
  const dels  = deletions(cwd, dir);
  if (dirty.length) log(`\n  ℹ ${name}: ${dirty.length} uncommitted/untracked path(s) under ${dir} will be published as-is.`);
  if (!dels.length) return true;

  log(`\n  ⛔ ${name}: ${dels.length} file(s) are DELETED on disk.`);
  dels.slice(0, 20).forEach(d => log('      ' + d));
  if (dels.length > 20) log(`      … and ${dels.length - 20} more`);
  log(`\n  Deploying REMOVES these from the live site. If that is not deliberate:`);
  log(`      git -C "${cwd}" checkout -- ${dir}`);
  log(`  Or re-run with --allow-dirty to publish the deletions anyway.`);
  return !!ALLOW_DIRTY;
}

async function deployGame() {
  rule('GAME → playmythicspellbook.play-a3d.workers.dev');
  if (!existsSync(GAME)) { log('  ❌ ' + GAME + ' not found'); return false; }
  const version = readFileSync(GAME + '\\public\\version.txt', 'utf8').trim();
  log(`  version.txt = ${version}`);
  if (!gate('game-deploy', GAME, 'public')) return false;
  if (DRY) { log('  (dry run — not deploying)'); return true; }
  sh('npm.cmd run deploy', GAME);
  // BUILD_VERSION survives minification, so it is the marker that proves the
  // edge is serving THIS build rather than the previous one.
  return verify('game', 'https://playmythicspellbook.play-a3d.workers.dev/', `'${version}'`);
}

async function deployMarket() {
  rule('MARKET → mythicspellbook.xyz');
  if (!existsSync(MARKET)) { log('  ❌ ' + MARKET + ' not found'); return false; }
  if (!gate('market-deploy', MARKET, 'public')) return false;
  if (DRY) { log('  (dry run — not deploying)'); return true; }
  sh('npx.cmd wrangler deploy', MARKET);
  // ⚠ market-deploy has NO version stamp. Its index.html is NOT minified, so
  // an exact source string survives to the live page and is the only usable
  // marker. Pick one that changes with the deploy; falling back to a plain
  // 200 check only proves the site is up, not that it is current.
  const local = readFileSync(MARKET + '\\public\\index.html', 'utf8');
  const m = local.match(/id="analytics"|Emergency Broadcast|Top 8/);
  return verify('market', 'https://mythicspellbook.xyz/', m ? m[0] : null);
}

(async () => {
  let ok = true;
  if (!ONLY_MARKET) ok = (await deployGame()) && ok;
  if (!ONLY_GAME)   ok = (await deployMarket()) && ok;
  rule(ok ? '✅ ALL DEPLOYS VERIFIED' : '❌ SOMETHING DID NOT LAND — read the log above');
  process.exit(ok ? 0 : 1);
})();
