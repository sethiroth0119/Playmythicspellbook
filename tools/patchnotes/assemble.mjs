import fs from 'fs';

const article = fs.readFileSync(process.argv[2], 'utf8');
const toc = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const md = fs.readFileSync(process.argv[4], 'utf8').trim();
const outPath = process.argv[5];

const railLinks = toc
  .map(t => `      <li><a href="#${t.id}" data-for="${t.id}">${t.label}</a></li>`)
  .join('\n');

// The markdown rides along verbatim for the Copy-as-Markdown button. It lives in a
// text/plain script, so the only sequence that could break out is a script close tag.
if (/<\/script/i.test(md)) throw new Error('markdown contains a script close tag');

const page = `<title>Ashfall Ledger</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700&family=Spectral:ital,wght@0,300;0,400;0,600;1,400&family=JetBrains+Mono:wght@400;500;700&display=swap">
<style>
/* ═══ The page commits to one visual world — the game's own: plum-black ground,
   inscriptional gold, parchment text. Every colour is painted explicitly so the
   page holds on any host background. ═══ */
:root{
  --ground:#120e18; --ground-2:#0d0a12;
  --surface:#1a1524; --surface-2:#221b2e;
  --rule:#332941; --rule-soft:#251e31;
  --parchment:#ece3d0; --body:#d6cbb8; --muted:#9a8fab;
  --gold:#d4af37; --gold-bright:#ffd166; --gold-dim:#8a7330;
  --ember:#ff8a5c; --sky:#6cd4ff; --leaf:#8fd48a;
  --measure:68ch;
  color-scheme:dark;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
@media (prefers-reduced-motion:reduce){
  html{scroll-behavior:auto}
  *{animation-duration:.01ms!important; transition-duration:.01ms!important}
}
body{
  margin:0; background:var(--ground); color:var(--body);
  font-family:'Spectral',Georgia,'Times New Roman',serif;
  font-size:17px; line-height:1.62; -webkit-font-smoothing:antialiased;
}
::selection{background:rgba(212,175,55,.28); color:#fff}
a{color:var(--gold-bright); text-underline-offset:3px}
:focus-visible{outline:2px solid var(--gold-bright); outline-offset:3px; border-radius:2px}

/* ── masthead plate ─────────────────────────────────────── */
.plate{
  border-bottom:1px solid var(--rule);
  background:
    radial-gradient(120% 140% at 50% -20%, rgba(212,175,55,.10), transparent 62%),
    linear-gradient(180deg,#171122 0%, var(--ground) 100%);
}
.plate-in{max-width:1180px; margin:0 auto; padding:64px 28px 52px}
.eyebrow{
  font-family:'JetBrains Mono',ui-monospace,monospace; font-size:11px; font-weight:500;
  letter-spacing:.22em; text-transform:uppercase; color:var(--gold); margin:0 0 22px;
  display:flex; align-items:center; gap:14px;
}
.eyebrow::after{content:""; flex:1 1 60px; height:1px; min-width:30px;
  background:linear-gradient(90deg,var(--gold-dim),transparent)}
h1.title{
  font-family:'Cinzel',Georgia,serif; font-weight:600; color:var(--parchment);
  font-size:clamp(2.1rem,6.2vw,4.1rem); line-height:1.05; letter-spacing:.01em;
  margin:0 0 8px; text-wrap:balance;
}
h1.title em{font-style:normal; color:var(--gold-bright)}
.subtitle{
  font-family:'Cinzel',Georgia,serif; font-size:clamp(.9rem,2.2vw,1.1rem); font-weight:500;
  letter-spacing:.06em; color:var(--muted); margin:0 0 30px;
}
.standfirst{max-width:64ch; font-size:1.09rem; margin:0 0 32px; text-wrap:pretty}
.standfirst strong{color:var(--parchment); font-weight:600}
.meta{display:flex; gap:10px; flex-wrap:wrap; margin:0 0 30px; padding:0; list-style:none}
.meta li{
  font-family:'JetBrains Mono',monospace; font-size:11.5px; letter-spacing:.08em;
  text-transform:uppercase; padding:6px 11px; border:1px solid var(--rule);
  background:var(--surface); color:var(--muted); border-radius:2px;
}
.meta b{color:var(--gold-bright); font-weight:500}
.tools{display:flex; gap:10px; flex-wrap:wrap; align-items:center}
button.tool{
  font-family:'JetBrains Mono',monospace; font-size:12px; font-weight:500;
  letter-spacing:.10em; text-transform:uppercase; cursor:pointer; padding:11px 17px;
  border-radius:2px; border:1px solid var(--gold-dim);
  background:rgba(212,175,55,.09); color:var(--gold-bright);
  transition:background .15s,border-color .15s,color .15s;
}
button.tool:hover{background:rgba(255,209,102,.17); border-color:var(--gold)}
button.tool.ghost{border-color:var(--rule); background:var(--surface); color:var(--muted)}
button.tool.ghost:hover{border-color:var(--gold-dim); color:var(--parchment)}
button.tool.ok{border-color:var(--leaf); color:var(--leaf); background:rgba(143,212,138,.10)}
.tool-note{font-size:13.5px; color:var(--muted); flex-basis:100%; margin:2px 0 0}

/* ── plain-text drawer ──────────────────────────────────── */
.raw{max-width:1180px; margin:0 auto; padding:0 28px}
.raw-in{border:1px solid var(--rule); border-top:none; background:var(--ground-2); padding:18px}
.raw-hd{font-family:'JetBrains Mono',monospace; font-size:11px; letter-spacing:.14em;
  text-transform:uppercase; color:var(--gold); margin:0 0 12px}
.raw textarea{
  width:100%; height:340px; resize:vertical; background:transparent; color:var(--body);
  border:none; font-family:'JetBrains Mono',monospace; font-size:12.5px; line-height:1.6;
}
.raw textarea:focus{outline:none}

/* ── shell: contents rail beside one reading column ─────── */
.shell{max-width:1180px; margin:0 auto; padding:0 28px 90px;
  display:grid; gap:52px; grid-template-columns:214px minmax(0,1fr)}
@media (max-width:900px){.shell{grid-template-columns:minmax(0,1fr); gap:0}}
.rail{position:sticky; top:0; align-self:start; padding:44px 0; max-height:100vh; overflow-y:auto}
@media (max-width:900px){
  .rail{position:static; max-height:none; padding:32px 0 28px; border-bottom:1px solid var(--rule)}
}
.rail h2{font-family:'JetBrains Mono',monospace; font-size:10.5px; font-weight:500;
  letter-spacing:.2em; text-transform:uppercase; color:var(--gold); margin:0 0 16px}
.rail ol{list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:1px;
  counter-reset:none}
.rail a{display:block; padding:6px 0 6px 14px; font-size:14px; line-height:1.35;
  color:var(--muted); text-decoration:none; border-left:2px solid var(--rule-soft);
  transition:color .15s,border-color .15s}
.rail a:hover{color:var(--parchment); border-left-color:var(--gold-dim)}
.rail a.on{color:var(--gold-bright); border-left-color:var(--gold)}

/* ── the document ───────────────────────────────────────── */
.doc{padding:44px 0 0; max-width:var(--measure); min-width:0}
.doc section{scroll-margin-top:20px}
.doc h2{
  font-family:'Cinzel',Georgia,serif; font-weight:600; color:var(--parchment);
  font-size:clamp(1.5rem,3.6vw,2rem); line-height:1.16; margin:74px 0 6px;
  padding-top:30px; border-top:1px solid var(--rule); position:relative; text-wrap:balance;
}
.doc h2::before{content:""; position:absolute; top:-1px; left:0; width:74px; height:2px;
  background:linear-gradient(90deg,var(--gold),var(--gold-dim))}
.doc section:first-child h2{margin-top:0}
.doc h3{font-family:'Cinzel',Georgia,serif; font-weight:600; color:var(--gold-bright);
  font-size:1.135rem; letter-spacing:.035em; margin:40px 0 12px; text-wrap:balance}
.doc h4{font-family:'JetBrains Mono',monospace; font-size:11.5px; font-weight:500;
  letter-spacing:.16em; text-transform:uppercase; color:var(--muted); margin:28px 0 10px}
.doc p{margin:0 0 17px; text-wrap:pretty}
.doc strong{color:var(--parchment); font-weight:600}
.doc code{font-family:'JetBrains Mono',monospace; font-size:.86em; background:var(--surface-2);
  border:1px solid var(--rule); border-radius:2px; padding:1px 5px; color:var(--gold-bright)}
.doc hr{border:none; height:1px; background:var(--rule-soft); margin:40px 0 0}
.doc ul{margin:0 0 18px; padding:0; list-style:none; display:flex; flex-direction:column; gap:11px}
.doc ul li{position:relative; padding-left:20px}
.doc ul li::before{content:"\\25C6"; position:absolute; left:0; top:0;
  color:var(--gold-dim); font-size:.66em; line-height:2.5}
.doc ol{margin:0 0 18px; padding-left:22px; display:flex; flex-direction:column; gap:11px}
.doc ol li::marker{color:var(--gold-dim); font-family:'JetBrains Mono',monospace; font-size:.85em}

/* Change-kind chips. The tag is information, not decoration: it says whether an
   entry is new behaviour, a fix, or something that was costing players real things. */
.tag{display:inline-block; font-family:'JetBrains Mono',monospace; font-size:9.5px;
  font-weight:700; letter-spacing:.14em; text-transform:uppercase; padding:2px 7px;
  border-radius:2px; vertical-align:.14em; margin-right:9px; white-space:nowrap; border:1px solid}
.tag-fix{color:var(--sky); border-color:rgba(108,212,255,.4); background:rgba(108,212,255,.10)}
.tag-major{color:var(--ember); border-color:rgba(255,138,92,.45); background:rgba(255,138,92,.11)}
li.tagged{padding-left:0}
li.tagged::before{display:none}
li.tagged:has(.tag-major), p.tagged:has(.tag-major){
  border-left:2px solid rgba(255,138,92,.38); padding-left:18px}

/* ── tables ─────────────────────────────────────────────── */
.tw{overflow-x:auto; margin:0 0 22px; border:1px solid var(--rule); background:var(--surface)}
.doc table{border-collapse:collapse; width:100%; min-width:340px; font-size:15px}
.doc th{font-family:'JetBrains Mono',monospace; font-size:10.5px; font-weight:500;
  letter-spacing:.14em; text-transform:uppercase; color:var(--gold); text-align:left;
  padding:12px 16px; border-bottom:1px solid var(--rule); background:var(--surface-2);
  white-space:nowrap}
.doc td{padding:11px 16px; border-bottom:1px solid var(--rule-soft);
  font-variant-numeric:tabular-nums}
.doc tbody tr:last-child td{border-bottom:none}
.doc td:first-child{color:var(--parchment)}
.doc td strong{color:var(--gold-bright)}

/* The headlines list is the page's one lifted element. */
#headlines ul{background:var(--surface); border:1px solid var(--rule);
  border-left:2px solid var(--gold); padding:24px 26px 24px 40px; gap:14px}
#headlines ul li::before{color:var(--gold)}

.colophon{max-width:1180px; margin:0 auto; padding:0 28px 72px;
  font-family:'JetBrains Mono',monospace; font-size:11.5px; letter-spacing:.12em;
  text-transform:uppercase; color:var(--muted)}
.colophon span{display:block; max-width:var(--measure); padding-top:26px;
  border-top:1px solid var(--rule)}
</style>

<header class="plate">
  <div class="plate-in">
    <p class="eyebrow">Mythic Spellbook &middot; Patch Notes</p>
    <h1 class="title">The <em>Ashfall</em> Ledger</h1>
    <p class="subtitle">Builds v119r8 &rarr; v120w6 &middot; 30 July &ndash; 13 August 2026</p>
    <p class="standfirst">The largest run of changes the game has had. <strong>Four new systems</strong> &mdash; Communities, the Crafting Station, player-owned banks and the Node hierarchy &mdash; <strong>two new card types</strong>, a real supply chain underneath the whole economy, and a long list of fixes to saves, wallets and vaults that were quietly costing players things they had paid for.</p>
    <ul class="meta">
      <li>Live build <b>v120w6</b></li>
      <li><b>263</b> commits</li>
      <li><b>14</b> sections</li>
      <li>Window <b>30 Jul &ndash; 13 Aug</b></li>
    </ul>
    <div class="tools">
      <button class="tool" id="copyMd" type="button">Copy as Markdown</button>
      <button class="tool" id="copyHtml" type="button">Copy as HTML</button>
      <button class="tool ghost" id="showRaw" type="button" aria-expanded="false" aria-controls="rawWrap">Show plain text</button>
      <p class="tool-note">Markdown for a CMS or a store post &middot; HTML to drop straight into the site.</p>
    </div>
  </div>
</header>

<div class="raw" id="rawWrap" hidden>
  <div class="raw-in">
    <p class="raw-hd">Select all &amp; copy</p>
    <textarea id="rawText" readonly spellcheck="false" aria-label="Patch notes as plain markdown"></textarea>
  </div>
</div>

<div class="shell">
  <nav class="rail" aria-label="Contents">
    <h2>Contents</h2>
    <ol>
${railLinks}
    </ol>
  </nav>
  <main class="doc" id="doc">
${article}
  </main>
</div>

<p class="colophon"><span>Mythic Spellbook &middot; builds v119r8 &rarr; v120w6 &middot; 263 commits</span></p>

<script type="text/plain" id="src">
${md}
</script>

<script>
(function () {
  var md = document.getElementById('src').textContent.trim();
  document.getElementById('rawText').value = md;

  // ── contents rail: highlight the section being read ──
  var links = {};
  Array.prototype.forEach.call(document.querySelectorAll('.rail a'), function (a) {
    links[a.dataset.for] = a;
  });
  if ('IntersectionObserver' in window) {
    var current = null;
    var io = new IntersectionObserver(function (items) {
      items.forEach(function (it) {
        if (!it.isIntersecting) return;
        if (current) current.classList.remove('on');
        current = links[it.target.id];
        if (current) current.classList.add('on');
      });
    }, { rootMargin: '0px 0px -72% 0px', threshold: 0 });
    Array.prototype.forEach.call(document.querySelectorAll('.doc section'), function (s) {
      io.observe(s);
    });
  }

  // ── copy ──
  function flash(btn, msg) {
    var was = btn.textContent, cls = btn.className;
    btn.textContent = msg;
    btn.className = cls + ' ok';
    setTimeout(function () { btn.textContent = was; btn.className = cls; }, 1800);
  }
  function revealRaw() {
    var w = document.getElementById('rawWrap');
    w.hidden = false;
    document.getElementById('showRaw').setAttribute('aria-expanded', 'true');
    document.getElementById('showRaw').textContent = 'Hide plain text';
    var ta = document.getElementById('rawText');
    ta.focus();
    ta.select();
  }
  function copy(text, btn) {
    function manual() {           // clipboard refused — hand the text over instead
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.parentNode.removeChild(ta);
      if (ok) { flash(btn, 'Copied'); }
      else { revealRaw(); flash(btn, 'Copy from below'); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { flash(btn, 'Copied'); }, manual);
    } else { manual(); }
  }

  document.getElementById('copyMd').addEventListener('click', function () {
    copy(md, this);
  });
  document.getElementById('copyHtml').addEventListener('click', function () {
    var body = Array.prototype.map.call(
      document.querySelectorAll('.doc section'),
      function (s) { return s.outerHTML; }
    ).join('\\n');
    copy('<article class="patch-notes">\\n' + body + '\\n</article>', this);
  });
  document.getElementById('showRaw').addEventListener('click', function () {
    var w = document.getElementById('rawWrap');
    if (w.hidden) { revealRaw(); }
    else {
      w.hidden = true;
      this.setAttribute('aria-expanded', 'false');
      this.textContent = 'Show plain text';
    }
  });
})();
</script>
`;

fs.writeFileSync(outPath, page);
console.error('page bytes: ' + page.length + '  rail entries: ' + toc.length);
