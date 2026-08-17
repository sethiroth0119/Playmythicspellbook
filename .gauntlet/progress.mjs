#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
   THE LIVE PROGRESS PAGE.

   Reads .gauntlet/rounds.json (the loop's record, written by the lead after
   each round) plus the captured framings, and emits a single self-contained
   HTML file. Images go in as base64 data URIs because the Artifact CSP blocks
   every external host — and only the three most recent rounds carry their
   images, because the page has a 16 MB ceiling and three jpegs a round is
   ~600 KB.

   Usage: node .gauntlet/progress.mjs [out.html]
   ══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(process.cwd());
const G = path.join(REPO, '.gauntlet');
const OUT = process.argv[2] || path.join(G, 'progress.html');

const rounds = JSON.parse(fs.readFileSync(path.join(G, 'rounds.json'), 'utf8'));

/* The 12 rubric dimensions, in BAR.md's order. The page's spine: every round
   scores against the same twelve, so the matrix is what shows evolution. */
const DIMS = [
  ['Palette & grade',      'res'],
  ['Lighting & shadow',    'res'],
  ['Building silhouette',  'com'],
  ['Building surface',     'com'],
  ['The plot',             'ind'],
  ['Roads',                'ind'],
  ['Street furniture',     'ind'],
  ['Vehicles',             'off'],
  ['Citizens',             'off'],
  ['Vegetation',           'res'],
  ['Density & zoning read','com'],
  ['UI legibility',        'off'],
];
const FRAMINGS = ['aerial', 'street', 'district'];

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

function img(round, framing) {
  const dir = path.join(G, 'shots', `r${round}`);
  for (const n of [`r${round}-${framing}.jpg`, `baseline-${framing}.jpg`, `r${round}-${framing}.png`, `baseline-${framing}.png`]) {
    const f = path.join(dir, n);
    if (fs.existsSync(f)) {
      const mime = n.endsWith('.png') ? 'image/png' : 'image/jpeg';
      return `data:${mime};base64,${fs.readFileSync(f).toString('base64')}`;
    }
  }
  return null;
}

/* Score for one dimension in one round, or null if that round did not judge it. */
const scoreOf = (r, dim) => {
  const hit = (r.scores || []).find(s =>
    s.dimension.toLowerCase().includes(dim.toLowerCase().split(' ')[0]) ||
    dim.toLowerCase().includes(s.dimension.toLowerCase().split(' ')[0]));
  return hit ? +hit.score : null;
};

const latest = rounds[rounds.length - 1];
const first  = rounds[0];
const withImgs = rounds.slice(-3).map(r => r.round);

/* ── the matrix ─────────────────────────────────────────────────────────── */
const matrixRows = DIMS.map(([dim, zone], i) => {
  const cells = rounds.map(r => {
    const v = scoreOf(r, dim);
    return v == null
      ? `<td class="s s--none" title="not judged in round ${r.round}">·</td>`
      : `<td class="s s--${v >= 8 ? 'win' : v >= 6 ? 'close' : v >= 4 ? 'behind' : 'bad'}">${v}</td>`;
  }).join('');
  const now = scoreOf(latest, dim);
  const was = scoreOf(first, dim);
  const delta = (now != null && was != null) ? now - was : null;
  return `<tr>
    <th scope="row"><span class="zdot z--${zone}" aria-hidden="true"></span>${esc(dim)}</th>
    ${cells}
    <td class="delta">${delta == null ? '' : (delta > 0 ? `+${delta}` : delta === 0 ? '—' : String(delta))}</td>
    <td class="meter"><span style="--v:${now == null ? 0 : now * 10}%"></span></td>
  </tr>`;
}).join('\n');

/* ── one band per round ─────────────────────────────────────────────────── */
const bands = [...rounds].reverse().map(r => {
  const shots = withImgs.includes(r.round) ? FRAMINGS.map(f => {
    const d = img(r.round, f);
    return d ? `<figure class="shot">
        <img src="${d}" alt="Round ${r.round}, ${f} framing" loading="lazy">
        <figcaption>${f}</figcaption>
      </figure>` : '';
  }).join('') : `<p class="dropped">Framings for this round are in the repo at
      <code>.gauntlet/shots/r${r.round}/</code> — only the three most recent rounds
      are embedded here, to keep the page under its size ceiling.</p>`;

  const pieces = (r.pieces || []).map(p => `<article class="piece">
      <header>
        <h4>${esc(p.title)}</h4>
        <span class="verdict v--${(p.verdict || 'none').toLowerCase()}">${esc(p.verdict || '—')}</span>
      </header>
      ${p.summary ? `<p class="did">${esc(p.summary)}</p>` : ''}
      ${p.gap ? `<p class="gap"><span class="gap-label">next</span>${esc(p.gap)}</p>` : ''}
    </article>`).join('');

  return `<section class="round${r.round === latest.round ? ' round--current' : ''}" id="r${r.round}">
    <div class="round-head">
      <h3>${r.round === 0 ? 'Baseline' : `Round ${r.round}`}</h3>
      <p class="round-sub">${esc(r.headline || '')}</p>
      <dl class="round-stats">
        <div><dt>mean</dt><dd>${r.meanScore ?? '—'}</dd></div>
        <div><dt>stranger test</dt><dd>${esc(r.strangerTest || '—')}</dd></div>
        <div><dt>triangles</dt><dd>${r.tris ? Number(r.tris).toLocaleString('en-US') : '—'}</dd></div>
      </dl>
    </div>
    <div class="shots">${shots}</div>
    ${pieces ? `<div class="pieces">${pieces}</div>` : ''}
    ${r.note ? `<p class="round-note">${esc(r.note)}</p>` : ''}
  </section>`;
}).join('\n');

const running = latest.status === 'running';

const html = `<title>Node City Gauntlet</title>
<style>
  /* ── tokens: light is the base, both dark paths redefine only these ────── */
  :root{
    --ground:#F2F4F3; --sheet:#FFFFFF; --sunk:#E7EBEA;
    --rule:#CBD5D3; --rule-soft:#E1E7E5;
    --ink:#12191B; --ink-2:#465254; --ink-3:#71807F;
    --mark:#C9922A;                       /* road-marking yellow, the one bold spend */
    --res:#4E8F4C; --com:#3B7FB4; --ind:#B8862E; --off:#348A83;
    --win:#2F7D4E; --close:#8A7A24; --behind:#A9612B; --bad:#9E3B36;
    --shadow:0 1px 2px rgba(18,25,27,.06), 0 8px 24px -12px rgba(18,25,27,.18);
  }
  @media (prefers-color-scheme: dark){
    :root:not([data-theme="light"]){
      --ground:#0D1315; --sheet:#141C1E; --sunk:#0A1012;
      --rule:#2A3739; --rule-soft:#1E2A2C;
      --ink:#DCE6E5; --ink-2:#94A5A4; --ink-3:#6B7C7B;
      --mark:#F2C14E;
      --res:#6FBB69; --com:#5AAEE0; --ind:#E0AC4C; --off:#4FBDB3;
      --win:#63BE86; --close:#CBB44E; --behind:#DB9059; --bad:#E0706A;
      --shadow:0 1px 2px rgba(0,0,0,.4), 0 12px 32px -16px rgba(0,0,0,.7);
    }
  }
  :root[data-theme="dark"]{
    --ground:#0D1315; --sheet:#141C1E; --sunk:#0A1012;
    --rule:#2A3739; --rule-soft:#1E2A2C;
    --ink:#DCE6E5; --ink-2:#94A5A4; --ink-3:#6B7C7B;
    --mark:#F2C14E;
    --res:#6FBB69; --com:#5AAEE0; --ind:#E0AC4C; --off:#4FBDB3;
    --win:#63BE86; --close:#CBB44E; --behind:#DB9059; --bad:#E0706A;
    --shadow:0 1px 2px rgba(0,0,0,.4), 0 12px 32px -16px rgba(0,0,0,.7);
  }

  *{box-sizing:border-box}
  body{
    margin:0; background:var(--ground); color:var(--ink);
    font:400 16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  .mono{font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
        font-variant-numeric:tabular-nums}
  .wrap{max-width:1160px;margin:0 auto;padding:0 24px 96px}

  /* ── masthead ─────────────────────────────────────────────────────────── */
  header.top{padding:56px 0 28px;border-bottom:2px solid var(--ink)}
  .eyebrow{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;
    letter-spacing:.22em;text-transform:uppercase;color:var(--ink-3);margin:0 0 14px}
  h1{margin:0;font-size:clamp(34px,5.4vw,60px);line-height:1.02;letter-spacing:-.035em;
     font-weight:750;text-wrap:balance;max-width:16ch}
  .standfirst{margin:18px 0 0;max-width:62ch;color:var(--ink-2);font-size:17.5px}
  .status{display:flex;flex-wrap:wrap;gap:10px 26px;margin:26px 0 0;padding:0;list-style:none;
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;
    letter-spacing:.04em;color:var(--ink-2);font-variant-numeric:tabular-nums}
  .status b{color:var(--ink);font-weight:600}
  .live{display:inline-flex;align-items:center;gap:7px;color:var(--mark)}
  .live i{width:7px;height:7px;border-radius:50%;background:var(--mark);
    animation:pulse 1.8s ease-in-out infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}
  @media (prefers-reduced-motion:reduce){.live i{animation:none}}

  h2{font-size:13px;letter-spacing:.2em;text-transform:uppercase;color:var(--ink-3);
     font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:500;
     margin:0 0 4px}
  .sec-note{margin:0 0 22px;color:var(--ink-2);max-width:64ch;font-size:15px}
  section.block{padding-top:52px}

  /* ── the matrix ───────────────────────────────────────────────────────── */
  .matrix-scroll{overflow-x:auto;border:1px solid var(--rule-soft);border-radius:3px;
    background:var(--sheet);box-shadow:var(--shadow)}
  table{border-collapse:collapse;width:100%;min-width:640px;font-size:14px}
  thead th{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;
    letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3);font-weight:500;
    padding:14px 10px;text-align:center;border-bottom:1px solid var(--rule);white-space:nowrap}
  thead th:first-child{text-align:left;padding-left:18px}
  tbody th{text-align:left;font-weight:450;padding:11px 10px 11px 18px;color:var(--ink);
    border-bottom:1px solid var(--rule-soft);white-space:nowrap}
  tbody td{padding:11px 10px;text-align:center;border-bottom:1px solid var(--rule-soft);
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums}
  tbody tr:last-child th,tbody tr:last-child td{border-bottom:0}
  .zdot{display:inline-block;width:7px;height:7px;border-radius:1px;margin-right:9px;
    vertical-align:1px}
  .z--res{background:var(--res)} .z--com{background:var(--com)}
  .z--ind{background:var(--ind)} .z--off{background:var(--off)}
  .s{font-weight:600}
  .s--win{color:var(--win)} .s--close{color:var(--close)}
  .s--behind{color:var(--behind)} .s--bad{color:var(--bad)}
  .s--none{color:var(--ink-3);font-weight:400}
  .delta{color:var(--ink-2);font-size:12.5px}
  .meter{width:88px;padding-right:18px}
  .meter span{display:block;height:5px;border-radius:3px;background:var(--sunk);
    position:relative;overflow:hidden}
  .meter span::after{content:"";position:absolute;inset:0 auto 0 0;width:var(--v,0%);
    background:var(--mark)}

  /* ── rounds ───────────────────────────────────────────────────────────── */
  .round{padding:34px 0;border-top:1px solid var(--rule-soft)}
  .round--current{border-top:2px solid var(--mark)}
  .round-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 22px;margin-bottom:20px}
  .round h3{margin:0;font-size:22px;letter-spacing:-.02em;font-weight:700}
  .round--current h3::after{content:"current";margin-left:10px;font-size:10px;
    letter-spacing:.18em;text-transform:uppercase;color:var(--mark);vertical-align:3px;
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:500}
  .round-sub{margin:0;color:var(--ink-2);flex:1 1 300px;font-size:15px}
  .round-stats{display:flex;gap:22px;margin:0}
  .round-stats div{display:flex;flex-direction:column;gap:1px}
  .round-stats dt{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;
    letter-spacing:.16em;text-transform:uppercase;color:var(--ink-3)}
  .round-stats dd{margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
    font-size:15px;font-variant-numeric:tabular-nums;color:var(--ink)}

  .shots{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}
  .shot{margin:0;background:var(--sheet);border:1px solid var(--rule-soft);border-radius:3px;
    overflow:hidden;box-shadow:var(--shadow)}
  .shot img{display:block;width:100%;height:auto}
  .shot figcaption{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;
    letter-spacing:.16em;text-transform:uppercase;color:var(--ink-3);padding:9px 12px;
    border-top:1px solid var(--rule-soft)}
  .dropped{color:var(--ink-3);font-size:14px;margin:0;padding:18px;border:1px dashed var(--rule);
    border-radius:3px}
  .dropped code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}

  .pieces{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1px;
    margin-top:22px;background:var(--rule-soft);border:1px solid var(--rule-soft);border-radius:3px}
  .piece{background:var(--sheet);padding:16px 18px}
  .piece header{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
  .piece h4{margin:0 0 8px;font-size:14.5px;font-weight:650;letter-spacing:-.01em}
  .verdict{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;
    letter-spacing:.16em;text-transform:uppercase;white-space:nowrap}
  .v--wins{color:var(--win)} .v--close{color:var(--close)} .v--behind{color:var(--behind)}
  .v--none{color:var(--ink-3)}
  .did{margin:0 0 10px;font-size:14px;color:var(--ink-2)}
  .gap{margin:0;font-size:13.5px;color:var(--ink);padding-left:12px;
    border-left:2px solid var(--mark)}
  .gap-label{display:block;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9.5px;
    letter-spacing:.2em;text-transform:uppercase;color:var(--ink-3);margin-bottom:3px}
  .round-note{margin:20px 0 0;font-size:14px;color:var(--ink-2);max-width:70ch}

  footer{margin-top:64px;padding-top:22px;border-top:1px solid var(--rule-soft);
    color:var(--ink-3);font-size:13px;max-width:70ch}
  a{color:inherit}
</style>

<div class="wrap">
  <header class="top">
    <p class="eyebrow">Mythic Spellbook · node city</p>
    <h1>Chasing Cities: Skylines&nbsp;II</h1>
    <p class="standfirst">A build-and-critique loop on the procedural city renderer.
      Each round, builders take one piece of the frame; separate critics with no
      memory of the work photograph the running game, compare it blind against the
      previous round, and name the one gap that decides the next round.</p>
    <ul class="status">
      <li>${running ? '<span class="live"><i></i>round ' + latest.round + ' in flight</span>'
                    : '<b>' + (latest.round === 0 ? 'baseline captured' : 'round ' + latest.round + ' judged') + '</b>'}</li>
      <li>rounds run <b>${rounds.filter(r => r.round > 0).length}</b></li>
      <li>mean score <b>${latest.meanScore ?? '—'}</b> / 10</li>
      <li>stranger test <b>${esc(latest.strangerTest || '—')}</b></li>
    </ul>
  </header>

  <section class="block">
    <h2>The bar, scored</h2>
    <p class="sec-note">Twelve dimensions transcribed from the five reference
      screenshots. A dimension is won at 8 — and only when the critic cannot name a
      gap a first-time viewer would notice in a side-by-side. A dot means no critic
      judged that dimension in that round.</p>
    <div class="matrix-scroll">
      <table>
        <thead><tr><th>Dimension</th>${rounds.map(r =>
          `<th>${r.round === 0 ? 'base' : 'r' + r.round}</th>`).join('')}<th>Δ</th><th>now</th></tr></thead>
        <tbody>${matrixRows}</tbody>
      </table>
    </div>
  </section>

  <section class="block">
    <h2>The work, round by round</h2>
    <p class="sec-note">Newest first. Every frame below is the real game, booted in
      headless Chromium and photographed through the shipped placement path — never
      a mock-up and never a diff.</p>
    ${bands}
  </section>

  <footer>
    <p>Frames captured by <code class="mono">.gauntlet/capture.mjs</code> at 1600×900,
    SwiftShader WebGL2, from a fixed 172-tile district. Camera framings are derived
    from the bounding box of the placed meshes, so the same three shots are
    comparable across every round.</p>
    <p>Generated ${esc(new Date().toISOString().slice(0, 16).replace('T', ' '))} UTC.</p>
  </footer>
</div>`;

fs.writeFileSync(OUT, html);
const mb = (Buffer.byteLength(html) / 1048576).toFixed(2);
console.log(`${OUT}  ${mb} MB  ·  ${rounds.length} rounds, images embedded for r${withImgs.join(', r')}`);
if (+mb > 15) console.warn('⚠ approaching the 16 MB artifact ceiling — drop an older round\'s images');
