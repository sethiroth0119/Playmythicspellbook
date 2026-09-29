/* ══════════════════════════════════════════════════════════════════════════
   🏷 DRIVE-NODE-MANAGER-INDEX — public/index.html never says "Mayor" to a
   player. Companion of drive-node-manager-label.mjs (which owns node-city).

   THE ASK (owner, 2026-09-17): "Change the mayor name to Node Manager."

   WHY TWO HALVES. index.html has ~330 lines that say mayor and almost all of
   them MUST keep saying it: comments that explain past bugs, _twIAmMayorOf,
   cityMayorGet (node-city's bridge calls it by name), node_mayors /
   mayor_dashboard / city_set_mayor (the database), MAYOR_HIRE_FEE. A grep
   cannot tell those from a violation, so:
     S  STATIC — every string/template token inside every inline <script>
        (acorn's tokenizer, so comments and identifiers are never mistaken for
        text) plus all markup outside scripts/styles/comments. A token that
        contains a space is prose; one that does not (node_mayors,
        'mayor-there', 'node_id,mayor_id,…') is an identifier-shaped value.
        Prose containing "mayor" is a FAIL. Separately, every identifier token
        and identifier-shaped string that HEAD had must still be there — the
        rename is text only.
     W  _nodeMgrWord — the display mapping for text the SERVER already wrote
        (1,655 wallet_ledger rows read 'Mayor revenue share (N%) — …'), run
        against a table of inputs, including identifiers it must NOT touch.
     P  PAGE — the real index.html in headless chromium, every off-origin
        request aborted (never near Supabase), Cloud.client stubbed. It drives
        the transaction-history modal and both phone ledger feeds with an old
        'Mayor revenue share' row, the appoint flow (broke + paid), the hiring
        pay claim, the client-city door with no clients, and cityMayorGet /
        _twIAmMayorOf with a seeded contract. It reads every toast (showToast is
        wrapped) plus the modal's innerText and title attributes.

     R  RENAME ALONE — the working tree's diff also carries the corp Node
        Manager desk (sql/142) and the account side-store lane, which are not
        this rename. nodemgr-rename-only.mjs holds the rename as a manifest;
        applied to the pre-rename blob it gives RENAME-ONLY (base + rename and
        nothing else). Every token-level difference base→RENAME-ONLY must be
        TEXT (a literal that said mayor), DEFINE (_nodeMgrWord) or one of the
        three declared WRAP call sites — zero BEHAVIOUR — and P is run against
        RENAME-ONLY too, so the rename is proven to work without the corp code.
        The regions are printed, and RENAME-ONLY + its patch are written to
        %TEMP%/nodemgr-rename-only/ for a reviewer to read in full.

   ⚠ NEGATIVE CONTROLS.
     C1  S against HEAD's blob must find the old prose (while HEAD predates the
         rename). Once HEAD carries it, a synthetic page (the working tree with
         two strings put back) is used instead. NM_SYNTH_CONTROL=1 forces that.
     C2  W with an identity mapping must fail its table.
     C3  P against the same control page must SEE "mayor" in a toast and in
         the ledger rows — a probe that sees nothing there is blind.
     C4  the classifier must call a one-token behaviour change in RENAME-ONLY
         (cut <= 0 → cut < 0) BEHAVIOUR, and likewise an identifier rename and
         an edit to a string that never said mayor.

     G  GIT SPLIT — the rename patch is applied with `git apply --cached` to a
        throwaway index on HEAD: the staged blob must equal RENAME-ONLY, the
        commit diff must be small, move none of the watched identifiers
        (tw_fetchNodeMayors, _twMayors, mayor_pct, corp_share …), remove only
        mayor lines or the 3 call sites, and the remainder (commit 2) must hold
        no rename region. Integrator recipe:
          node .gauntlet/nodemgr-rename-only.mjs --patch
     C5  staging the whole three-lane tree as one commit must trip G3 and G4.

   Output: PASS/FAIL lines, plus the R region list and an info line naming
   the other lanes' regions in the working tree. No account, no email, no network.
   Run:  node .gauntlet/drive-node-manager-index.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const RO = await import(pathToFileURL(path.resolve(process.cwd(), '.gauntlet/nodemgr-rename-only.mjs')).href);

const acorn = await import(pathToFileURL(path.resolve(process.cwd(), 'node_modules/acorn/dist/acorn.mjs')).href);
const ROOT = path.resolve(process.cwd(), 'public');
let passes = 0, fails = 0;
const ok = (name, cond, detail) => {
  if (cond) passes++; else fails++;
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (detail ? '   ' + detail : ''));
  return !!cond;
};

const WT = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
let HEADPAGE = null;
try {
  HEADPAGE = execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'show', 'HEAD:public/index.html'], { maxBuffer: 128 * 1024 * 1024 }).toString('utf8');
} catch (e) { HEADPAGE = null; }
const HEAD_IS_OLD = !process.env.NM_SYNTH_CONTROL && !!HEADPAGE && HEADPAGE.includes("' appointed Mayor — '");
/* The synthetic control: two visible strings put back and the display mapping
   neutered — exactly the three ways this rename can regress.

   🔴 EVERY OCCURRENCE, AND THE COUNT IS CHECKED. This used String.replace with
      a string needle, which replaces the FIRST match only. Both toasts now
      exist TWICE in the page (the node-aware appoint path added with sql/148,
      and the older fallback beside it), and the probe drives the second one —
      so the "control" page rendered the NEW wording, C3 saw no "mayor", and the
      toast half of this suite proved nothing while every product check passed.
      A control that cannot fail is worse than no control: it reads as evidence.
   ⚠ A needle that stops matching is now a FAILURE, not a silent no-op. If a
      literal is reworded again, this suite says so instead of going quietly
      vacuous — which is the same failure in a different disguise. */
const SYNTH_EDITS = [
  ["' appointed Node Manager — '", "' appointed Mayor — '"],
  ["'🎩 Appointing a Node Manager costs '", "'🎩 Appointing a mayor costs '"],
  ['function _nodeMgrWord(s) {', 'function _nodeMgrWord(s) { return s;'],
];
const SYNTH_MISSES = [];
const SYNTH = SYNTH_EDITS.reduce((src, [from, to]) => {
  const n = src.split(from).length - 1;
  if (!n) { SYNTH_MISSES.push(from); return src; }
  return src.split(from).join(to);
}, WT);
const CONTROL = HEAD_IS_OLD ? HEADPAGE : SYNTH;
console.log('control page: ' + (HEAD_IS_OLD ? 'HEAD blob (pre-rename)' : 'synthetic (working tree with the old wording put back)'));

/* ── S: static scan ─────────────────────────────────────────────────────── */
function scan(src) {
  const ls = [0]; for (let k = 0; k < src.length; k++) if (src.charCodeAt(k) === 10) ls.push(k + 1);
  const lineAt = (i) => { let lo = 0, hi = ls.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ls[mid] <= i) lo = mid; else hi = mid - 1; } return lo + 1; };
  const prose = [], idents = new Map(), errors = [];
  const bump = (k) => idents.set(k, (idents.get(k) || 0) + 1);
  const re = /<script(\b[^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(src))) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/.test(attrs)) continue;
    if (/type\s*=\s*["'](?!module|text\/javascript)/i.test(attrs)) continue;
    const body = m[2];
    if (!/mayor/i.test(body)) continue;
    const base = m.index + m[0].indexOf('>') + 1;
    try {
      for (const t of acorn.tokenizer(body, { ecmaVersion: 'latest', sourceType: /module/.test(attrs) ? 'module' : 'script', allowHashBang: true })) {
        const lbl = t.type.label;
        if (lbl === 'name' && /mayor/i.test(t.value)) bump('id:' + t.value);
        else if ((lbl === 'string' || lbl === 'template') && /mayor/i.test(String(t.value))) {
          const v = String(t.value);
          if (/\s/.test(v)) prose.push(lineAt(base + t.start) + ' ' + JSON.stringify(v).slice(0, 90));
          else bump('str:' + v);
        }
      }
    } catch (e) { errors.push(String(e.message)); }
  }
  const blank = (x) => x.replace(/[^\n]/g, ' ');
  const markup = src.replace(/<script\b[\s\S]*?<\/script>/gi, blank).replace(/<style\b[\s\S]*?<\/style>/gi, blank).replace(/<!--[\s\S]*?-->/g, blank);
  markup.split('\n').forEach((l, i) => { if (/mayor/i.test(l)) prose.push((i + 1) + ' markup ' + JSON.stringify(l.trim()).slice(0, 90)); });
  return { prose, idents, errors };
}
const sWT = scan(WT);
ok('S1: every inline script tokenises', sWT.errors.length === 0, sWT.errors.slice(0, 2).join(' | '));
ok('S2: no player-visible "mayor" in any string, template or markup', sWT.prose.length === 0, sWT.prose.slice(0, 6).join(' | '));
ok('S3: the scan is not vacuous (identifier tokens seen)', sWT.idents.size >= 20, 'distinct=' + sWT.idents.size);
if (HEADPAGE) {
  const sH = scan(HEADPAGE);
  const lost = [...sH.idents.keys()].filter((k) => !sWT.idents.has(k));
  ok('S4: every mayor-named identifier / key HEAD had is still present (text-only rename)', lost.length === 0, lost.slice(0, 8).join(', '));
} else ok('S4: HEAD blob readable', false, 'git show failed');
for (const fn of ['function _twIAmMayorOf(', 'window.cityMayorGet = async function', 'async function tw_fetchNodeMayors(', 'window.cityMayorSet = async function', "Cloud.client.rpc('mayor_dashboard')"]) {
  ok('S5: still defined — ' + fn, WT.includes(fn));
}
const sC = scan(CONTROL);
ok('C1: the same scan FINDS the old wording on the control page', sC.prose.length >= (HEAD_IS_OLD ? 10 : 2), 'found=' + sC.prose.length);

/* ── W: the display mapping ─────────────────────────────────────────────── */
const fnSrc = (WT.match(/function _nodeMgrWord\(s\) \{[\s\S]*?\n\}/) || [])[0];
ok('W0: _nodeMgrWord is present', !!fnSrc);
const TABLE = [
  ['Mayor revenue share (12%) — city on node N-25', 'Node Manager revenue share (12%) — city on node N-25'],
  ['Paid by your mayor', 'Paid by your Node Manager'],
  ['Two mayors', 'Two Node Managers'],
  ['Mayor Hall contract', 'Node Manager Hall contract'],
  ['MAYOR PAY', 'NODE MANAGER PAY'],
  ['a mayoral contract', 'a Node Manager contract'],
  ['node_mayors', 'node_mayors'],
  ['mayor_id', 'mayor_id'],
  ['Mayorga Quarry', 'Mayorga Quarry'],
  ['Daily reward', 'Daily reward'],
];
const runTable = (f) => TABLE.filter(([a, b]) => f(a) !== b).map(([a]) => a);
if (fnSrc) {
  const f = new Function(fnSrc + '\nreturn _nodeMgrWord;')();
  const bad = runTable(f);
  ok('W1: every table row maps as expected (' + TABLE.length + ' rows)', bad.length === 0, bad.join(' | '));
  ok('W2: null / undefined pass through', f(null) === null && f(undefined) === undefined);
}
ok('C2: an identity mapping FAILS the same table', runTable((s) => s).length >= 5);

/* ── R: the rename alone ────────────────────────────────────────────────── */
const BASE = RO.findBase();
ok('R0: a pre-rename base blob was found', !!BASE.page, BASE.rev ? 'base=' + BASE.rev : 'tried ' + (BASE.tried || []).join(','));
let RENAME_ONLY = null;
if (BASE.page) {
  const built = RO.buildRenameOnly(BASE.page);
  ok('R1: the manifest applies to the base exactly (every anchor at its expected count)', built.problems.length === 0, built.problems.join(' | '));
  RENAME_ONLY = built.page;
  const miss = RO.missingFromTree(WT);
  ok('R2: every rename edit is in the working tree (RENAME-ONLY is a subset of what ships)', miss.length === 0, miss.join(' | '));
  const cls = RO.classifyPages(BASE.page, RENAME_ONLY);
  ok('R3: markup outside scripts is byte-identical and the script count unchanged', cls.markupSame && cls.scriptCountSame);
  const n = (k) => cls.regions.filter((r) => r.kind === k).length;
  for (const r of cls.regions) console.log('  · ' + r.kind.padEnd(9) + ' L' + r.line + '  - ' + JSON.stringify(r.del).slice(0, 70) + '  + ' + JSON.stringify(r.add).slice(0, 70));
  ok('R4: base→RENAME-ONLY has zero BEHAVIOUR regions', n('BEHAVIOUR') === 0 && cls.errors.length === 0, cls.errors.join(' | '));
  // 17 literals change; two of them sit a few tokens apart and share a region.
  const lits = cls.regions.filter((r) => r.kind === 'TEXT').reduce((t, r) => t + r.lits, 0);
  ok('R5: ...and is exactly 17 literals (in 16 TEXT regions) + 1 DEFINE + 3 WRAP', lits === 17 && n('TEXT') === 16 && n('DEFINE') === 1 && n('WRAP') === 3 && cls.regions.length === 20,
    'literals=' + lits + ' TEXT=' + n('TEXT') + ' DEFINE=' + n('DEFINE') + ' WRAP=' + n('WRAP') + ' all=' + cls.regions.length);
  const perr = [];
  for (const m of RENAME_ONLY.matchAll(/<script(\b[^>]*)>([\s\S]*?)<\/script>/gi)) {
    const at = m[1] || '';
    if (/\bsrc\s*=/.test(at) || /type\s*=\s*["'](?!module|text\/javascript)/i.test(at)) continue;
    try { acorn.parse(m[2], { ecmaVersion: 'latest', sourceType: /module/.test(at) ? 'module' : 'script', allowHashBang: true }); } catch (e) { perr.push(e.message); }
  }
  ok('R6: every inline script of RENAME-ONLY parses', perr.length === 0, perr.slice(0, 2).join(' | '));
  const sRO = scan(RENAME_ONLY), sB = scan(BASE.page);
  ok('R7: RENAME-ONLY alone leaves no player-visible "mayor"', sRO.prose.length === 0, sRO.prose.slice(0, 4).join(' | '));
  const idDiff = [...new Set([...sB.idents.keys(), ...sRO.idents.keys()])].filter((k) => sB.idents.get(k) !== sRO.idents.get(k));
  ok('R8: RENAME-ONLY has exactly the base\'s mayor identifiers and keys, same counts', idDiff.length === 0 && sB.idents.size >= 20, idDiff.slice(0, 6).join(', '));
  // C4 — the classifier is not a rubber stamp.
  const mut = (a, b) => { const c = RENAME_ONLY.split(a).length - 1; return c === 1 ? RO.classifyPages(BASE.page, RENAME_ONLY.replace(a, b)).regions.filter((r) => r.kind === 'BEHAVIOUR').length : -1; };
  ok('C4: a one-token behaviour change is BEHAVIOUR', mut('    if (cut <= 0) return false;', '    if (cut < 0) return false;') === 1);
  ok('C4: an identifier rename is BEHAVIOUR', mut('function _twIAmMayorOf(', 'function _twIAmNodeManagerOf(') === 1);
  ok('C4: editing a string that never said mayor is BEHAVIOUR', mut("'Cinder spending (older build)'", "'Cinder spending (old build)'") === 1);
  const art = RO.writeArtifacts(BASE.page, RENAME_ONLY);
  console.log('  rename-only page + patch: ' + art.dir + ' (' + art.patch.split('\n').filter((l) => /^[+-][^+-]/.test(l)).length + ' changed lines)');
  /* G — the rename as a real git commit. The round-2 critic read
     `git diff HEAD` (three lanes, 705+/75-). The split is made in a
     THROWAWAY index (GIT_INDEX_FILE under %TEMP%; the repo's index is never
     touched): `git apply --cached` of the rename patch must stage exactly
     RENAME-ONLY, and the resulting commit diff must be rename-only by git's
     own reading, not just by our classifier. */
  const gpatch = RO.gitPatchFrom(art.patch);
  const st = RO.stageSplit(gpatch, { tag: 'rename', base: BASE.rev });
  ok('G1: git apply --cached stages the rename patch onto HEAD', st.applied, st.err);
  if (st.applied) {
    ok('G2: the staged blob is byte-identical to RENAME-ONLY', st.staged === RENAME_ONLY);
    const [ins, del] = st.numstat.split(/\s+/).map(Number);
    console.log('  staged commit 1: ' + st.numstat.replace(/\s+/g, ' ') + '  (patch: ' + st.patchPath + ')');
    ok('G3: commit 1 touches only public/index.html, a small diff (<=60+ / <=25-)', /^\d+\s+\d+\s+public\/index\.html$/.test(st.numstat) && ins <= 60 && del <= 25, st.numstat);
    const bal = RO.identBalance(st.diff);
    const moved = Object.entries(bal).filter(([, v]) => v !== 0);
    ok('G4: commit 1 adds no use of ' + RO.WATCH_IDENTS.length + ' watched identifiers (tw_fetchNodeMayors, _twMayors, _twMayorCutBadge, mayor_id, mayor_pct, corp_share, _cityCutReport, corpNm …)', moved.length === 0, JSON.stringify(moved));
    const minus = st.diff.split('\n').filter((l) => /^-/.test(l) && !/^--- /.test(l));
    ok('G5: every line commit 1 removes said "mayor" or is one of the 3 declared call sites', minus.every((l) => /mayor/i.test(l) || /escapeHtml\(r\.reason \|\| ''\)|_cinderLedgerLoad\(\)\.slice\(\)|return raw \|\| \(\(\{ charge: 'Spend'/.test(l)), minus.filter((l) => !/mayor/i.test(l)).map((l) => l.slice(0, 80)).join(' | '));
    const c1 = RO.classifyPages(BASE.page, st.staged).regions;
    ok('G6: HEAD→commit 1 classifies as 0 BEHAVIOUR, 20 regions', c1.length === 20 && !c1.some((r) => r.kind === 'BEHAVIOUR'));
    // Commit 2 = commit 1 → working tree. It must hold none of the rename
    // (nothing left behind) and the rename must hold none of it.
    const c2 = RO.classifyPages(st.staged, WT).regions;
    ok('G7: commit 2 (commit 1 → working tree) holds no rename region (no TEXT / DEFINE / WRAP)', c2.every((r) => r.kind === 'BEHAVIOUR'), c2.filter((r) => r.kind !== 'BEHAVIOUR').map((r) => r.kind + ' L' + r.line).join(', '));
    console.log('  info: commit 2 carries ' + c2.length + ' region(s) of the other lanes');
    // C5 — the same git checks on a split that did NOT separate the lanes
    // (the whole working tree staged as one commit) must fail.
    /* ⚠ Against the SAME base as commit 1. Read against HEAD this control
       compares the tree with itself once the lanes are committed, and 'staging
       everything' looks as small as the rename — the control stops controlling. */
    const bad = RO.stageSplit(null, { tag: 'control', page: WT, base: BASE.rev });
    const badMoved = bad.applied ? Object.entries(RO.identBalance(bad.diff)).filter(([, v]) => v !== 0) : [];
    ok('C5: staging the three-lane tree as one commit trips G4 (watched identifiers move)', bad.applied && badMoved.length >= 2, bad.err || JSON.stringify(badMoved));
    const bn = bad.numstat.split(/\s+/).map(Number);
    ok('C5: ...and G3 (the diff is far larger than the rename)', bad.applied && bn[0] > 60, bad.numstat);
  }
  // Info, not a gate: what else the working tree changes, so an integrator
  // can see the other lanes' hunks are theirs and not this rename's.
  const other = RO.classifyPages(BASE.page, WT).regions.filter((r) => r.kind === 'BEHAVIOUR');
  console.log('  info: working tree has ' + other.length + ' region(s) outside the rename (corp desk / account lanes), at lines ' + other.map((r) => r.line).slice(0, 40).join(','));
}

/* ── P: page probe ──────────────────────────────────────────────────────── */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain' };
let BODY = WT;
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/' || p === '/index.html') { res.writeHead(200, { 'Content-Type': MIME['.html'] }); return res.end(BODY); }
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
const PORT = 9180 + (process.pid % 50);
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const ORIGIN = 'http://127.0.0.1:' + PORT;

async function probe(browser, page0) {
  BODY = page0;
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', (route) => (route.request().url().startsWith(ORIGIN) ? route.continue() : route.abort()));
  const page = await context.newPage();
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  try {
    await page.goto(ORIGIN + '/', { waitUntil: 'load', timeout: 180000 });
    await page.waitForFunction(() => { try { return typeof Profile !== 'undefined' && typeof showToast === 'function' && typeof cityMayorGet === 'function'; } catch (e) { return false; } },
      null, { timeout: 120000, polling: 250 });
    await page.waitForTimeout(400);
    return await page.evaluate(async () => {
      const out = { toasts: [], err: [] };
      const OLD = 'Mayor revenue share (7%) — city on node N-25';
      const realToast = window.showToast;
      window.showToast = function (msg) { out.toasts.push(String(msg)); };
      const me = '00000000-0000-4000-8000-0000000000aa';
      const client = {
        rpc: async (name) => {
          if (name === 'get_my_ledger') return { data: [{ created_at: new Date().toISOString(), op: 'credit', resource: 'cinder', delta: 7, balance_after: 107, reason: OLD }], error: null };
          return { data: null, error: null };
        },
        from: (t) => {
          const q = { _t: t, select() { return q; }, eq() { return q; }, in() { return q; }, update() { return q; }, limit() { return q; },
            then(res, rej) { return Promise.resolve(t === 'city_mayor_pay' ? { data: [{ id: 1, amount: 500, from_name: 'Owner Olive' }], error: null } : { data: [], error: null }).then(res, rej); } };
          return q;
        },
      };
      try { Cloud.client = client; Cloud.ready = true; } catch (e) { out.err.push('cloud ' + e.message); }
      try { Profile.cloud = Object.assign({}, Profile.cloud || {}, { signedIn: true, userId: me, displayName: 'Tester' }); } catch (e) { out.err.push('profile ' + e.message); }
      try { window.initCloud = () => true; } catch (e) {}
      // 1. transaction history modal
      try {
        await openTransactionsModal();
        const root = document.getElementById('tx-modal-root');
        out.txText = root ? root.innerText : '';
        out.txTitles = root ? [...root.querySelectorAll('[title]')].map((e) => e.getAttribute('title')) : [];
        if (root) root.remove();
      } catch (e) { out.err.push('tx ' + e.message); }
      // 2. phone feeds
      try { const r = await window.MythicBank.serverLedger(); out.server = (r.rows || []).map((x) => x.r); } catch (e) { out.err.push('srv ' + e.message); }
      try {
        const rows = _cinderLedgerLoad();
        rows.unshift({ t: Date.now(), d: 7, r: OLD, b: 107 });
        out.diary = window.MythicBank.ledger().slice(0, 1).map((x) => x.r);
        out.diaryStored = _cinderLedgerLoad()[0].r;
        rows.shift();
      } catch (e) { out.err.push('diary ' + e.message); }
      // 3. appoint, broke then paid
      try {
        window.searchPlayers = async () => [{ userId: 'u-pick', name: 'Pick Pat' }];
        window.spendGems = () => false; window.spendCinders = () => false;
        await cityMayorSet('Pick Pat');
        window.spendGems = () => true;
        const r = await cityMayorSet('Pick Pat');
        out.appointed = !!(r && r.mayorId === 'u-pick');
      } catch (e) { out.err.push('appoint ' + e.message); }
      // 4. hiring pay claim
      try { window.addCinders = () => {}; App._mayorPayAt = 0; await _mayorPayClaim(); } catch (e) { out.err.push('pay ' + e.message); }
      // 5. the client-city door with no contracts, then a seeded contract
      try {
        _twMayors = {};
        _openClientCity();
        _twMayors = { 'N-77': { node_id: 'N-77', mayor_id: 'u-other', owner_id: me, active: true } };
        App._cityNodeId = 'N-77';
        window._lookupUserNames = async () => ({});
        const g = await cityMayorGet();
        out.seat = g;
        out.iAm = _twIAmMayorOf('N-77');
        _twMayors['N-77'].mayor_id = me;
        out.iAmNow = _twIAmMayorOf('N-77');
      } catch (e) { out.err.push('seat ' + e.message); }
      window.showToast = realToast;
      return out;
    });
  } finally { await context.close().catch(() => {}); }
}

const browser = await chromium.launch();
try {
  const bad = (s) => /mayor/i.test(String(s || ''));
  const checkProbe = (tag, r) => {
    ok(tag + 'P0: the drive ran without a page-side exception', r.err.length === 0, r.err.join(' | '));
    ok(tag + 'P1: transaction history shows the row, with no "mayor" in text or tooltips', !!r.txText && !bad(r.txText) && !r.txTitles.some(bad), JSON.stringify(r.txTitles).slice(0, 120));
    ok(tag + 'P2: ...and the old server row reads "Node Manager revenue share"', r.txTitles.some((t) => /^Node Manager revenue share \(7%\)/.test(t)));
    ok(tag + 'P3: phone server audit renames the old row', (r.server || []).length === 1 && /^Node Manager revenue share/.test(r.server[0]), JSON.stringify(r.server));
    ok(tag + 'P4: phone wallet diary renames it for display', (r.diary || [])[0] && /^Node Manager revenue share/.test(r.diary[0]), JSON.stringify(r.diary));
    ok(tag + 'P5: ...while the diary on record keeps the words it was written with', /^Mayor revenue share/.test(r.diaryStored || ''), JSON.stringify(r.diaryStored));
    ok(tag + 'P6: appoint flow still appoints', r.appointed === true);
    ok(tag + 'P7: toasts were captured (broke, appointed, hiring pay, no clients)', r.toasts.length >= 4, r.toasts.length + ' toasts');
    ok(tag + 'P8: no toast says "mayor"', !r.toasts.some(bad), r.toasts.filter(bad).join(' | '));
    ok(tag + 'P9: the toasts name the office', r.toasts.filter((t) => /Node Manager/.test(t)).length >= 4, JSON.stringify(r.toasts).slice(0, 200));
    ok(tag + 'P10: cityMayorGet still reads the contract seat', !!r.seat && r.seat.mayorId === 'u-other' && r.seat.contract === true, JSON.stringify(r.seat));
    ok(tag + 'P11: an unnamed seat reads "the hired Node Manager"', !!r.seat && r.seat.mayorName === 'the hired Node Manager', JSON.stringify(r.seat && r.seat.mayorName));
    ok(tag + 'P12: _twIAmMayorOf answers per contract (false, then true)', r.iAm === false && r.iAmNow === true);
  };
  checkProbe('', await probe(browser, WT));
  if (RENAME_ONLY) checkProbe('RO/', await probe(browser, RENAME_ONLY));
  /* The control has to be a real control. Every needle must have matched, and
     on the synthetic path the page must differ from the working tree — a
     needle that silently stops matching is how C3 went vacuous once already. */
  ok('C2: every control replacement matched the live source', SYNTH_MISSES.length === 0, SYNTH_MISSES.join(' | '));
  ok('C2: the control page is not the page under test', CONTROL !== WT);
  const c = await probe(browser, CONTROL);
  ok('C3: the same probe SEES "mayor" in a toast on the control page', c.toasts.some(bad), c.toasts.length + ' toasts');
  ok('C3: ...and in the phone server audit row', (c.server || []).some(bad), JSON.stringify(c.server));
} catch (e) {
  ok('page probe ran to the end', false, String((e && e.message) || e).slice(0, 240));
} finally {
  await browser.close().catch(() => {});
  server.close();
}
console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
