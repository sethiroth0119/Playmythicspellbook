#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════
   🚦 GAUNTLET DISPATCH — renders docs/gauntlet-progress.html from the JSON
   records the gauntlet agents drop on disk.
   ----------------------------------------------------------------------------
   WHY A GENERATOR AND NOT AN AGENT WRITING HTML. The page is rebuilt after every
   round. If an agent authored the markup each time, the page's DESIGN would
   drift round to round and two agents finishing at once would tear one file.
   Agents write small, disjoint JSON records; exactly one program renders them.
   So the layout is stable, the render is free, and there is no write race.

   Reads:
     docs/gauntlet/run.json                    the plan + the bar (written once)
     docs/gauntlet/rounds/<piece>-r<n>.json    one record per critic verdict
   Writes:
     docs/gauntlet-progress.html

   ⚠ No dependencies, by design — CLAUDE.md forbids adding npm packages, and a
     progress page is the last thing that should own a dependency tree.
   ════════════════════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GDIR = join(ROOT, 'docs', 'gauntlet');
const OUT  = join(ROOT, 'docs', 'gauntlet-progress.html');

const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Every read is tolerant. A half-written record from an agent that died mid-write
   must degrade to "that round is missing", never to a crashed render — the page's
   whole job is to be readable while the run is still in flight. */
function readJson(p, fallback) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) { return fallback; }
}

const run = readJson(join(GDIR, 'run.json'), null);

let rounds = [];
const rdir = join(GDIR, 'rounds');
if (existsSync(rdir)) {
  for (const f of readdirSync(rdir)) {
    if (!f.endsWith('.json')) continue;
    const r = readJson(join(rdir, f), null);
    if (r && r.pieceId) rounds.push(r);
  }
}
rounds.sort((a, b) => (a.pieceId || '').localeCompare(b.pieceId || '') || (a.round | 0) - (b.round | 0));

const byPiece = {};
for (const r of rounds) (byPiece[r.pieceId] = byPiece[r.pieceId] || []).push(r);

const pieces = (run && Array.isArray(run.pieces)) ? run.pieces : [];
const totalRounds = rounds.length;
const won   = pieces.filter(p => (byPiece[p.id] || []).some(r => r.wins)).length;
const active = pieces.filter(p => (byPiece[p.id] || []).length && !(byPiece[p.id] || []).some(r => r.wins)).length;
const idle  = pieces.length - won - active;

/* Status of a piece drives its colour everywhere, so it is decided once. */
function pieceStatus(p) {
  const rs = byPiece[p.id] || [];
  if (!rs.length) return 'queued';
  if (rs.some(r => r.wins)) return 'passed';
  return 'contested';
}

const STATUS_LABEL = { queued: 'Queued', contested: 'Contested', passed: 'Cleared' };

function sevClass(s) {
  const v = String(s || '').toLowerCase();
  if (v === 'blocking' || v === 'critical' || v === 'high') return 'sev-high';
  if (v === 'moderate' || v === 'medium') return 'sev-mid';
  return 'sev-low';
}

/* ── A single round, as a manifest line. The evolution the user asked to see is
      the SEQUENCE of these: what the critic said, and what changed next round. */
function roundHtml(r, prev) {
  const cls = r.wins ? 'rd-pass' : 'rd-fail';
  const gap = r.wins ? '' : `
        <div class="rd-gap">
          <span class="rd-gap-label ${sevClass(r.gap_severity)}">${esc(r.gap_severity || 'gap')}</span>
          <p>${esc(r.biggest_gap || 'No gap recorded.')}</p>
        </div>`;
  const ev = r.evidence ? `<p class="rd-ev">${esc(r.evidence)}</p>` : '';
  const built = (r.files_written && r.files_written.length)
    ? `<ul class="rd-files">${r.files_written.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : '';
  const delta = (prev && !prev.wins && r.builder_response)
    ? `<p class="rd-delta"><span>answered</span> ${esc(r.builder_response)}</p>` : '';
  const ab = r.ab_choice
    ? `<span class="rd-ab" title="blind A/B outcome">blind A/B → ${esc(r.ab_choice)}</span>` : '';
  return `
      <li class="rd ${cls}">
        <div class="rd-head">
          <span class="rd-n">R${r.round | 0}</span>
          <span class="rd-verdict">${r.wins ? 'clears the bar' : 'below the bar'}</span>
          ${ab}
        </div>
        ${delta}
        ${built}
        ${r.verdict ? `<p class="rd-body">${esc(r.verdict)}</p>` : ''}
        ${ev}
        ${gap}
      </li>`;
}

function pieceHtml(p) {
  const st = pieceStatus(p);
  const rs = byPiece[p.id] || [];
  const track = rs.length
    ? rs.map(r => `<span class="tick ${r.wins ? 'tick-pass' : 'tick-fail'}">R${r.round | 0}</span>`).join('<span class="tick-rule"></span>')
    : '<span class="tick tick-idle">not started</span>';
  return `
    <article class="piece" id="piece-${esc(p.id)}">
      <header class="piece-head">
        <div class="piece-id">
          <h3>${esc(p.title || p.id)}</h3>
          <p class="piece-goal">${esc(p.goal || '')}</p>
        </div>
        <span class="badge badge-${st}">${STATUS_LABEL[st]}</span>
      </header>
      <div class="piece-meta">
        <div><span class="mk">Owns</span><ul class="paths">${(p.files || []).map(f => `<li>${esc(f)}</li>`).join('') || '<li>—</li>'}</ul></div>
        <div><span class="mk">Judged against</span><ul class="paths"><li>${esc(p.bar_file || '—')}</li></ul></div>
      </div>
      <div class="track">${track}</div>
      ${rs.length ? `<ol class="rounds">${rs.map((r, i) => roundHtml(r, rs[i - 1])).join('')}</ol>` : ''}
    </article>`;
}

const barHtml = (run && Array.isArray(run.bar) && run.bar.length)
  ? `<ul class="bar-list">${run.bar.map(b => `<li><code>${esc(b.path)}</code><span>${esc(b.why_it_is_the_bar || b.kind || '')}</span></li>`).join('')}</ul>`
  : '<p class="empty">The bar has not been fixed yet.</p>';

const html = `<title>Freight Gauntlet</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap">
<style>
/* ── Tokens. Complete light palette on bare :root; dark redefines TOKENS ONLY,
      twice, so both the un-stamped system default and an explicit toggle land. */
:root {
  --ground:      #e9eaec;
  --panel:       #f6f6f7;
  --panel-2:     #eeeff1;
  --ink:         #1a1d23;
  --ink-soft:    #4d545f;
  --ink-faint:   #7d8590;
  --rule:        #cfd2d7;
  --rule-soft:   #dee0e4;
  --accent:      #b06d18;   /* road signage ochre */
  --accent-ink:  #8a5410;
  --pass:        #2f6b4f;
  --pass-bg:     #dcebe3;
  --fail:        #9c3f2b;
  --fail-bg:     #f2ddd7;
  --hazard:      #a8791d;
  --shadow:      0 1px 0 rgba(26,29,35,.06), 0 2px 10px rgba(26,29,35,.05);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --ground:    #14161a;
    --panel:     #1b1e24;
    --panel-2:   #21252c;
    --ink:       #e5e7ea;
    --ink-soft:  #a8afba;
    --ink-faint: #767d88;
    --rule:      #30353d;
    --rule-soft: #262b32;
    --accent:    #e0a34a;
    --accent-ink:#f0bd72;
    --pass:      #7fc5a1;
    --pass-bg:   #1b2b23;
    --fail:      #e08a70;
    --fail-bg:   #2c1e1a;
    --hazard:    #d9ae5c;
    --shadow:    0 1px 0 rgba(0,0,0,.3), 0 2px 12px rgba(0,0,0,.35);
  }
}
:root[data-theme="dark"] {
  --ground:    #14161a;
  --panel:     #1b1e24;
  --panel-2:   #21252c;
  --ink:       #e5e7ea;
  --ink-soft:  #a8afba;
  --ink-faint: #767d88;
  --rule:      #30353d;
  --rule-soft: #262b32;
  --accent:    #e0a34a;
  --accent-ink:#f0bd72;
  --pass:      #7fc5a1;
  --pass-bg:   #1b2b23;
  --fail:      #e08a70;
  --fail-bg:   #2c1e1a;
  --hazard:    #d9ae5c;
  --shadow:    0 1px 0 rgba(0,0,0,.3), 0 2px 12px rgba(0,0,0,.35);
}

* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--ground);
  color: var(--ink);
  font-family: "Source Serif 4", Georgia, "Times New Roman", serif;
  font-size: 16px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 1080px; margin: 0 auto; padding: 2.5rem 1.5rem 5rem; }

h1, h2, h3, .mk, .badge, .tick, .rd-n, .rd-verdict {
  font-family: "Barlow Condensed", "Arial Narrow", Helvetica, sans-serif;
}
code, .paths, .rd-files, .stat-n, .rd-ab {
  font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
}

/* ── Masthead: a dispatch header, not a hero. */
.mast { border-bottom: 2px solid var(--ink); padding-bottom: 1.1rem; margin-bottom: .75rem; }
.eyebrow {
  font-family: "IBM Plex Mono", monospace;
  font-size: .7rem; letter-spacing: .18em; text-transform: uppercase;
  color: var(--accent-ink); margin: 0 0 .5rem;
}
h1 {
  font-size: clamp(2.4rem, 6vw, 3.6rem); font-weight: 700;
  letter-spacing: .01em; line-height: .95; margin: 0;
  text-transform: uppercase; text-wrap: balance;
}
.dek { margin: .7rem 0 0; max-width: 62ch; color: var(--ink-soft); font-size: 1.03rem; }

/* ── The status strip. Encodes state in form (rule weight) as well as number. */
.strip {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 1px; background: var(--rule); border: 1px solid var(--rule);
  margin: 1.6rem 0 2.6rem;
}
.stat { background: var(--panel); padding: .85rem 1rem; }
.stat-n { font-size: 1.9rem; font-weight: 600; line-height: 1; font-variant-numeric: tabular-nums; display: block; }
.stat-l {
  font-family: "Barlow Condensed", sans-serif; text-transform: uppercase;
  letter-spacing: .1em; font-size: .78rem; color: var(--ink-faint); display: block; margin-top: .35rem;
}
.stat-pass .stat-n { color: var(--pass); }
.stat-live .stat-n { color: var(--accent); }

h2 {
  font-size: 1.5rem; text-transform: uppercase; letter-spacing: .06em;
  margin: 3rem 0 1rem; padding-bottom: .4rem; border-bottom: 1px solid var(--rule);
}
h2:first-of-type { margin-top: 0; }

.note { color: var(--ink-soft); max-width: 68ch; }
.empty { color: var(--ink-faint); font-style: italic; }

/* ── The bar. */
.bar-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 1px; background: var(--rule-soft); border: 1px solid var(--rule-soft); }
.bar-list li { background: var(--panel); padding: .7rem .9rem; display: grid; grid-template-columns: minmax(200px, 22rem) 1fr; gap: 1rem; align-items: baseline; }
.bar-list code { font-size: .82rem; color: var(--accent-ink); word-break: break-all; }
.bar-list span { color: var(--ink-soft); font-size: .92rem; }
@media (max-width: 720px) { .bar-list li { grid-template-columns: 1fr; gap: .25rem; } }

/* ── Pieces. */
.pieces { display: grid; gap: 1.5rem; }
.piece { background: var(--panel); border: 1px solid var(--rule); box-shadow: var(--shadow); }
.piece-head { display: flex; gap: 1rem; align-items: flex-start; justify-content: space-between; padding: 1.1rem 1.2rem .8rem; }
.piece-head h3 { margin: 0; font-size: 1.32rem; text-transform: uppercase; letter-spacing: .04em; }
.piece-goal { margin: .35rem 0 0; color: var(--ink-soft); font-size: .95rem; max-width: 60ch; }
.badge {
  flex: none; text-transform: uppercase; letter-spacing: .1em; font-size: .74rem;
  font-weight: 600; padding: .25rem .6rem; border: 1px solid currentColor; white-space: nowrap;
}
.badge-queued    { color: var(--ink-faint); }
.badge-contested { color: var(--accent); }
.badge-passed    { color: var(--pass); }

.piece-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; padding: 0 1.2rem .9rem; }
@media (max-width: 720px) { .piece-meta { grid-template-columns: 1fr; } }
.mk { display: block; text-transform: uppercase; letter-spacing: .11em; font-size: .7rem; color: var(--ink-faint); margin-bottom: .3rem; }
.paths { list-style: none; padding: 0; margin: 0; font-size: .78rem; color: var(--ink-soft); }
.paths li { word-break: break-all; }

/* The track is the evolution at a glance — one tick per round, left to right. */
.track { display: flex; align-items: center; flex-wrap: wrap; gap: 0; padding: .7rem 1.2rem; background: var(--panel-2); border-top: 1px solid var(--rule-soft); border-bottom: 1px solid var(--rule-soft); overflow-x: auto; }
.tick { font-size: .82rem; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; padding: .18rem .55rem; border: 1px solid currentColor; white-space: nowrap; }
.tick-pass { color: var(--pass); background: var(--pass-bg); }
.tick-fail { color: var(--fail); background: var(--fail-bg); }
.tick-idle { color: var(--ink-faint); border-style: dashed; }
.tick-rule { width: 1.4rem; height: 1px; background: var(--rule); flex: none; }

.rounds { list-style: none; margin: 0; padding: 0; }
.rd { padding: 1rem 1.2rem; border-top: 1px solid var(--rule-soft); }
.rd-head { display: flex; align-items: baseline; gap: .7rem; flex-wrap: wrap; }
.rd-n { font-size: 1.05rem; font-weight: 700; letter-spacing: .08em; color: var(--ink-faint); }
.rd-verdict { text-transform: uppercase; letter-spacing: .1em; font-size: .8rem; font-weight: 600; }
.rd-pass .rd-verdict { color: var(--pass); }
.rd-fail .rd-verdict { color: var(--fail); }
.rd-ab { margin-left: auto; font-size: .72rem; color: var(--ink-faint); }
.rd-body { margin: .5rem 0 0; font-size: .95rem; color: var(--ink-soft); max-width: 68ch; }
.rd-ev { margin: .45rem 0 0; font-size: .88rem; color: var(--ink-faint); max-width: 68ch; }
.rd-delta { margin: .45rem 0 0; font-size: .9rem; color: var(--ink-soft); }
.rd-delta span { text-transform: uppercase; letter-spacing: .1em; font-size: .7rem; color: var(--accent-ink); font-family: "Barlow Condensed", sans-serif; margin-right: .4rem; }
.rd-files { list-style: none; padding: 0; margin: .45rem 0 0; font-size: .76rem; color: var(--ink-faint); }
.rd-files li { word-break: break-all; }
.rd-gap { margin-top: .7rem; padding-left: .8rem; border-left: 3px solid var(--fail); }
.rd-gap p { margin: .25rem 0 0; font-size: .95rem; max-width: 68ch; }
.rd-gap-label { text-transform: uppercase; letter-spacing: .11em; font-size: .7rem; font-weight: 600; font-family: "Barlow Condensed", sans-serif; }
.sev-high { color: var(--fail); }
.sev-mid  { color: var(--hazard); }
.sev-low  { color: var(--ink-faint); }

footer { margin-top: 3.5rem; padding-top: 1rem; border-top: 1px solid var(--rule); color: var(--ink-faint); font-size: .85rem; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
</style>

<div class="wrap">
  <header class="mast">
    <p class="eyebrow">Mythic Spellbook · gauntlet run</p>
    <h1>Freight Gauntlet</h1>
    <p class="dek">Building the Transportation Company feature by attrition. Every piece is written by
    a builder with no prior context, then judged by a separate critic who opens the real file and
    compares it blind against this repo&rsquo;s own best work. Losing rounds go back.</p>
  </header>

  <div class="strip">
    <div class="stat"><span class="stat-n">${pieces.length}</span><span class="stat-l">Pieces</span></div>
    <div class="stat stat-live"><span class="stat-n">${totalRounds}</span><span class="stat-l">Rounds judged</span></div>
    <div class="stat stat-pass"><span class="stat-n">${won}</span><span class="stat-l">Cleared</span></div>
    <div class="stat"><span class="stat-n">${active}</span><span class="stat-l">Contested</span></div>
    <div class="stat"><span class="stat-n">${idle}</span><span class="stat-l">Queued</span></div>
  </div>

  <h2>The bar</h2>
  <p class="note">No external reference was supplied, so the bar is the repo&rsquo;s own ceiling: the files
  where the original author clearly cared. A critic that only reads a rubric grades against an idea of
  quality; one holding a real file grades against this codebase.</p>
  ${barHtml}

  <h2>Pieces</h2>
  ${pieces.length
    ? `<div class="pieces">${pieces.map(pieceHtml).join('')}</div>`
    : '<p class="empty">The lead agent has not returned a decomposition yet.</p>'}

  ${run && run.strategy ? `<h2>Why this decomposition</h2><p class="note">${esc(run.strategy)}</p>` : ''}

  <footer>
    Rendered from ${totalRounds} round record${totalRounds === 1 ? '' : 's'} on disk.
    Rebuild with <code>node tools/gauntlet-page.mjs</code>.
  </footer>
</div>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html, 'utf8');
console.log(`gauntlet-page: ${pieces.length} pieces, ${totalRounds} rounds -> ${OUT}`);
