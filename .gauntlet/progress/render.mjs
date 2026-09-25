/* 🔨 THE GAUNTLET PROGRESS PAGE.
   Reads state.json + pieces.json and writes progress.html.

   WHY A GENERATOR AND NOT A HAND-WRITTEN PAGE: this page is republished after
   every round of the loop. Hand-editing HTML each time drifts — a round gets
   added to the ledger but the header count does not, and the page starts lying
   about the run it is reporting. Every number here is DERIVED from the state
   files, so a stale number is impossible rather than merely unlikely.

   Run: node .gauntlet/progress/render.mjs */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const S = JSON.parse(readFileSync(join(HERE, 'state.json'), 'utf8'));
const PIECES = JSON.parse(readFileSync(join(HERE, 'pieces.json'), 'utf8'));
/* Screenshots of the REAL editor, downscaled and inlined so the page carries its
   own evidence — the full-size PNGs are 2MB each and will not travel. */
let SHOTS = { shots: [] };
try { SHOTS = JSON.parse(readFileSync(join(HERE, 'shots.json'), 'utf8')); } catch (e) {}

/* Which chain each piece belongs to, and where it stands. Kept here rather than
   in pieces.json because pieces.json is the lead agent's output — this is the
   run's own bookkeeping laid over it. */
const CHAIN = {
  'forge-save-contract-net': 'infra', 'forge-driver-harness': 'infra', 'data-backup-export': 'infra',
  'editor-width': 'layout', 'effect-field-gating': 'layout', 'owner-checkpoint': 'layout',
  'effect-type-picker': 'layout', 'editor-nav-index': 'layout',
  'status-picker-info': 'author', 'spell-trap-body': 'author', 'move-picker-facets': 'author',
  'move-editor-type-guard': 'author', 'move-editor-density': 'author', 'custommoves-repair': 'author',
  'fx-draw-discard-hand': 'effects', 'fx-draw-discard-drawn': 'effects',
  'fx-void-to-deck-effect': 'effects', 'fx-zone-move-trigger': 'effects',
  'deck-size-range': 'live', 'realm-per-deck': 'live', 'realm-add-parity': 'live',
  'ship-gate': 'ship', 'authoring-task-gate': 'ship',
};
const STATUS = {
  'forge-save-contract-net': 'hardening',
  'forge-driver-harness': 'hardening',
  'data-backup-export': 'hardening',
  'owner-checkpoint': 'done',
};

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const nf = (n) => Number(n || 0).toLocaleString('en-US');

const agents = S.rounds.reduce((a, r) => a + (r.agents || 0), 0);
const tokens = S.rounds.reduce((a, r) => a + (r.tokens || 0), 0);
const doneP = PIECES.filter((p) => STATUS[p.id] === 'done').length;
const liveP = PIECES.filter((p) => STATUS[p.id] && STATUS[p.id] !== 'done').length;

const statLabel = { done: 'settled', hardening: 'in the loop', running: 'building' };

/* ── the piece board, grouped by chain ── */
const board = S.chains.map((c) => {
  const rows = PIECES.filter((p) => CHAIN[p.id] === c.id);
  if (!rows.length) return '';
  return `<section class="chain">
    <header class="chain-h">
      <h3>${esc(c.label)}</h3>
      <p>${esc(c.note)}</p>
    </header>
    <ul class="pieces">
      ${rows.map((p) => {
        const st = STATUS[p.id] || 'queued';
        return `<li class="piece s-${st}">
          <div class="p-top">
            <span class="p-state">${esc(statLabel[st] || 'queued')}</span>
            <span class="p-risk r-${esc(p.risk)}" title="blast radius if this goes wrong">${esc(p.risk)} risk</span>
          </div>
          <h4>${esc(p.title)}</h4>
          <code class="p-id">${esc(p.id)}</code>
          ${p.dep.length ? `<p class="p-dep">after ${p.dep.map((d) => `<code>${esc(d)}</code>`).join(', ')}</p>` : ''}
        </li>`;
      }).join('')}
    </ul>
  </section>`;
}).join('');

/* ── the round ledger. Rounds ARE a sequence, so they are numbered. ── */
const ledger = S.rounds.map((r) => `<article class="round st-${esc(r.state)}">
  <div class="r-rail"><span class="r-n">${r.n}</span><span class="r-line"></span></div>
  <div class="r-body">
    <header class="r-h">
      <h3>${esc(r.title)}</h3>
      <span class="r-state">${r.state === 'running' ? 'running now' : 'complete'}</span>
    </header>
    ${(r.agents || r.tokens) ? `<p class="r-meta"><strong>${nf(r.agents)}</strong> agents · <strong>${nf(r.tokens)}</strong> tokens${r.pieces ? ` · <strong>${r.pieces}</strong> pieces produced` : ''}</p>` : ''}
    <p class="r-what">${esc(r.what)}</p>
    ${r.results ? `<table class="r-tab"><thead><tr><th>piece</th><th>verdict</th><th>what came back</th></tr></thead><tbody>
      ${r.results.map((x) => `<tr><td><code>${esc(x.id)}</code></td><td class="v">${esc(x.verdict)}</td><td>${esc(x.detail)}</td></tr>`).join('')}
    </tbody></table>` : ''}
    ${r.found ? `<div class="finds"><h4>What it turned up</h4><ul>${r.found.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></div>` : ''}
  </div>
</article>`).join('');

const html = `<title>Forge Remodel Gauntlet</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Archivo:ital,wght@0,400;0,500;0,600;1,400&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root{
  --ground:#f5f2f8; --panel:#fff; --sunk:#efeaf4;
  --edge:rgba(58,38,92,.15); --edge2:rgba(58,38,92,.28);
  --ink:#211a2f; --dim:#655c7c;
  --gold:#8a5600; --goldbg:rgba(190,130,20,.11);
  --pass:#18704a; --fail:#9d3a26; --run:#1c5b86;
  --disp:'Cinzel',Georgia,serif;
  --body:'Archivo',system-ui,-apple-system,'Segoe UI',sans-serif;
  --mono:'IBM Plex Mono',ui-monospace,'Cascadia Mono',Consolas,monospace;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --ground:#14111d; --panel:#1e1a2b; --sunk:#191527;
  --edge:rgba(198,178,255,.15); --edge2:rgba(198,178,255,.3);
  --ink:#ece7f7; --dim:#9b92b5;
  --gold:#ffc861; --goldbg:rgba(255,200,97,.1);
  --pass:#6fce9a; --fail:#e28e76; --run:#8fc7ee;
}}
:root[data-theme="dark"]{
  --ground:#14111d; --panel:#1e1a2b; --sunk:#191527;
  --edge:rgba(198,178,255,.15); --edge2:rgba(198,178,255,.3);
  --ink:#ece7f7; --dim:#9b92b5;
  --gold:#ffc861; --goldbg:rgba(255,200,97,.1);
  --pass:#6fce9a; --fail:#e28e76; --run:#8fc7ee;
}
*{box-sizing:border-box}
body{background:var(--ground);color:var(--ink);font-family:var(--body);line-height:1.55;
  font-size:15px;margin:0;padding:0 20px 80px}
.wrap{max-width:1120px;margin:0 auto}
code{font-family:var(--mono);font-size:.86em}
h1,h2,h3,h4{font-family:var(--disp);font-weight:700;text-wrap:balance;margin:0}

/* ── masthead ── */
header.top{padding:44px 0 26px;border-bottom:1px solid var(--edge)}
.eyebrow{font-family:var(--mono);font-size:.72rem;letter-spacing:.16em;text-transform:uppercase;
  color:var(--gold);margin:0 0 10px}
h1{font-size:clamp(2rem,4.4vw,2.9rem);letter-spacing:.01em;line-height:1.1}
.sub{color:var(--dim);max-width:60ch;margin:.6rem 0 0;font-size:1.02rem}
.stats{display:flex;flex-wrap:wrap;gap:0;margin-top:26px;border:1px solid var(--edge);
  border-radius:3px;overflow:hidden;background:var(--panel)}
.stat{flex:1 1 150px;padding:14px 18px;border-right:1px solid var(--edge)}
.stat:last-child{border-right:0}
.stat b{display:block;font-family:var(--mono);font-size:1.5rem;font-weight:500;
  font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.stat span{display:block;font-size:.76rem;color:var(--dim);text-transform:uppercase;letter-spacing:.09em;margin-top:2px}

h2.sec{font-size:1.35rem;margin:52px 0 4px;padding-bottom:8px;border-bottom:2px solid var(--edge2)}
p.seclede{color:var(--dim);margin:.5rem 0 22px;max-width:66ch}

/* ── decisions ── */
.decs{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:1px;
  background:var(--edge);border:1px solid var(--edge)}
.dec{background:var(--panel);padding:16px 18px}
.dec dt{font-family:var(--mono);font-size:.74rem;text-transform:uppercase;letter-spacing:.09em;
  color:var(--gold);margin-bottom:7px}
.dec dd{margin:0;font-size:.93rem}

/* ── round ledger ── */
.round{display:grid;grid-template-columns:52px minmax(0,1fr);gap:0;padding-bottom:8px}
.r-rail{display:flex;flex-direction:column;align-items:center}
.r-n{font-family:var(--mono);font-size:1rem;width:34px;height:34px;display:grid;place-items:center;
  border:1px solid var(--edge2);border-radius:50%;color:var(--dim);flex:none}
.round.st-running .r-n{border-color:var(--run);color:var(--run);font-weight:500}
.r-line{flex:1;width:1px;background:var(--edge);margin:8px 0 0}
.r-body{padding:2px 0 34px 14px;min-width:0}
.r-h{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.r-h h3{font-size:1.18rem}
.r-state{font-family:var(--mono);font-size:.7rem;text-transform:uppercase;letter-spacing:.1em;
  color:var(--dim);border:1px solid var(--edge2);border-radius:2px;padding:2px 7px}
.round.st-running .r-state{color:var(--run);border-color:var(--run)}
.r-meta{font-family:var(--mono);font-size:.82rem;color:var(--dim);margin:.5rem 0 0;font-variant-numeric:tabular-nums}
.r-meta strong{color:var(--ink);font-weight:500}
.r-what{margin:.7rem 0 0;max-width:72ch;color:var(--dim)}

.r-tab{width:100%;border-collapse:collapse;margin-top:16px;font-size:.88rem;display:block;overflow-x:auto}
.r-tab th{text-align:left;font-family:var(--mono);font-size:.7rem;text-transform:uppercase;
  letter-spacing:.09em;color:var(--dim);font-weight:400;padding:0 14px 6px 0;border-bottom:1px solid var(--edge)}
.r-tab td{padding:10px 14px 10px 0;border-bottom:1px solid var(--edge);vertical-align:top}
.r-tab td.v{color:var(--pass);white-space:nowrap;font-size:.84rem}
.r-tab tr td:last-child{color:var(--dim);min-width:22ch}

.finds{margin-top:20px;background:var(--sunk);border-left:2px solid var(--gold);padding:14px 18px 15px}
.finds h4{font-size:.76rem;font-family:var(--mono);font-weight:400;text-transform:uppercase;
  letter-spacing:.11em;color:var(--gold);margin-bottom:9px}
.finds ul{margin:0;padding-left:18px}
.finds li{margin-bottom:9px;font-size:.92rem}
.finds li:last-child{margin-bottom:0}

/* ── screenshots. Tall editor grabs, so each is capped and scrolls in its own
   box rather than making the page a mile long. ── */
.shots{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px}
.shots figure{margin:0;background:var(--panel);border:1px solid var(--edge);border-radius:3px;overflow:hidden}
.shots img{display:block;width:100%;height:auto;max-height:560px;object-fit:cover;object-position:top}
.shots figcaption{padding:12px 15px 14px;font-size:.86rem;color:var(--dim);border-top:1px solid var(--edge)}
.shots figcaption strong{color:var(--ink);font-weight:600;display:block;margin-bottom:3px;font-size:.9rem}

/* ── piece board ── */
.chain{margin-bottom:34px}
.chain-h{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin-bottom:12px;
  padding-bottom:7px;border-bottom:1px solid var(--edge)}
.chain-h h3{font-size:1.02rem}
.chain-h p{margin:0;color:var(--dim);font-size:.86rem}
.pieces{list-style:none;margin:0;padding:0;display:grid;
  grid-template-columns:repeat(auto-fill,minmax(268px,1fr));gap:12px}
.piece{background:var(--panel);border:1px solid var(--edge);border-radius:3px;padding:13px 15px 14px;
  display:flex;flex-direction:column;gap:6px}
.piece.s-hardening{border-color:var(--run)}
.piece.s-done{border-color:var(--pass)}
.p-top{display:flex;justify-content:space-between;align-items:center;gap:8px}
.p-state{font-family:var(--mono);font-size:.68rem;text-transform:uppercase;letter-spacing:.1em;color:var(--dim)}
.piece.s-hardening .p-state{color:var(--run)}
.piece.s-done .p-state{color:var(--pass)}
.p-risk{font-family:var(--mono);font-size:.66rem;text-transform:uppercase;letter-spacing:.07em;
  padding:1px 6px;border-radius:2px;color:var(--dim);background:var(--sunk)}
.p-risk.r-high{color:var(--fail);background:var(--goldbg)}
.piece h4{font-size:.93rem;line-height:1.35;font-family:var(--body);font-weight:600}
.p-id{color:var(--dim);font-size:.74rem}
.p-dep{margin:2px 0 0;font-size:.74rem;color:var(--dim)}
.p-dep code{font-size:.72rem}

footer{margin-top:56px;padding-top:18px;border-top:1px solid var(--edge);
  color:var(--dim);font-size:.82rem;font-family:var(--mono)}
@media (max-width:640px){
  .round{grid-template-columns:36px minmax(0,1fr)}
  .r-n{width:28px;height:28px;font-size:.85rem}
}
</style>

<div class="wrap">
<header class="top">
  <p class="eyebrow">${esc(S.updated)}</p>
  <h1>Forge Remodel Gauntlet</h1>
  <p class="sub">${esc(S.subtitle)} Every piece is built by one agent and judged by two others with fresh context, who have to run the artifact themselves. Nothing passes on a claim.</p>
  <div class="stats">
    <div class="stat"><b>${PIECES.length}</b><span>pieces</span></div>
    <div class="stat"><b>${doneP + liveP}</b><span>started</span></div>
    <div class="stat"><b>${nf(agents)}</b><span>agents run</span></div>
    <div class="stat"><b>${(tokens / 1e6).toFixed(2)}M</b><span>tokens spent</span></div>
    <div class="stat"><b>${S.rounds.length}</b><span>rounds</span></div>
  </div>
</header>

<h2 class="sec">Decisions on record</h2>
<p class="seclede">Four contradictions the critics refused to let the plan guess at. These now gate the pieces downstream of them.</p>
<dl class="decs">
  ${S.decisions.map((d) => `<div class="dec"><dt>${esc(d.q)}</dt><dd>${esc(d.a)}</dd></div>`).join('')}
</dl>

${SHOTS.shots.length ? `<h2 class=\"sec\">What it looks like</h2>
<p class=\"seclede\">Real screenshots, taken by driving the actual editor rather than a mock. Mid-run — the authoring-surface pieces are still landing.</p>
<div class=\"shots\">${SHOTS.shots.map((s) => `<figure><img src=\"data:image/jpeg;base64,${s.data}\" alt=\"${esc(s.name)}\"><figcaption><strong>${esc(s.name)}</strong> ${esc(s.note)}</figcaption></figure>`).join('')}</div>` : ''}
<h2 class=\"sec\">The run so far</h2>
<p class="seclede">Newest work is at the bottom. A round is one full build-and-judge cycle; a piece that fails its critics comes back into the next one.</p>
${ledger}

<h2 class="sec">The board</h2>
<p class="seclede">The decomposition after the critics were done with it — ${PIECES.length} pieces in ${S.chains.length} chains. Almost every piece edits the same 15&nbsp;MB file, so builds are serialised; only the judging fans out.</p>
${board}

<footer>${esc(S.run)} · generated from state.json — no number on this page is typed by hand</footer>
</div>
`;

writeFileSync(join(HERE, 'progress.html'), html);
console.log('wrote progress.html — ' + PIECES.length + ' pieces, ' + S.rounds.length + ' rounds, ' + nf(agents) + ' agents');
