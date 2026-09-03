import sys
import os; S=os.path.dirname(os.path.abspath(__file__)); REPO=os.path.abspath(S+'/../..')
css=open(REPO+'/public/src/mapforge/mapforge.css').read()
bundle=open(S+'/artifact/bundle.js').read()
page = r'''<meta charset="utf-8">
<title>Athena Engine</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&display=swap">
<style>
  /* Deliberately single-theme: this is the editor's own dark chrome, so the
     landing frame commits to the same ground instead of inverting around it. */
  :root{--ground:#0b0d14;--panel:#12151f;--panel2:#171b27;--line:rgba(212,175,55,.22);--gold:#d4af37;--gold2:#e7c757;--ink:#e8e2d0;--dim:#9a937f;--ok:#5fd38a;color-scheme:dark}
  html,body{background:var(--ground);color:var(--ink);min-height:100%}
  body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:14px;line-height:1.55;margin:0}
  .wrap{max-width:760px;margin:0 auto;padding:48px 22px 56px}
  .brand{font-family:"Cinzel",Georgia,serif;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:var(--gold2);font-size:13px;display:flex;align-items:center;gap:10px}
  .brand:before{content:"⚒";font-size:18px}
  h1{font-family:"Cinzel",Georgia,serif;font-weight:600;font-size:clamp(26px,4.5vw,38px);line-height:1.15;margin:14px 0 10px;color:#fff3d1;text-wrap:balance}
  .lede{color:var(--dim);max-width:60ch;margin:0 0 26px;font-size:15px}
  .open{display:inline-flex;align-items:center;gap:10px;font:700 15px/1 system-ui,sans-serif;background:linear-gradient(180deg,var(--gold2),var(--gold));color:#1a1206;border:1px solid var(--gold2);border-radius:8px;padding:14px 22px;cursor:pointer;box-shadow:0 8px 28px rgba(212,175,55,.18)}
  .open:hover{filter:brightness(1.07)}.open:focus-visible{outline:2px solid #fff;outline-offset:3px}
  .open[disabled]{opacity:.55;cursor:progress}
  .status{margin:12px 0 0;font-size:12.5px;color:var(--dim);min-height:1.4em}
  .cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-top:34px}
  .box{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:16px 18px}
  .box h2{font-size:10.5px;letter-spacing:.22em;text-transform:uppercase;color:var(--gold);margin:0 0 10px;font-weight:600}
  .box ul{margin:0;padding:0;list-style:none;display:grid;gap:7px}
  .box li{display:grid;grid-template-columns:auto 1fr;gap:9px;align-items:baseline;font-size:13px}
  kbd{font:11px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--ground);border:1px solid var(--line);border-radius:4px;padding:2px 6px;color:#ffe9a8;white-space:nowrap}
  .note{margin-top:22px;font-size:12.5px;color:var(--dim);border-left:2px solid var(--line);padding-left:12px}
  .note b{color:var(--ink);font-weight:600}
</style>
<style id="mf-css">
''' + css + r'''
</style>
<div class="wrap">
  <div class="brand">Athena Engine</div>
  <h1>Build a ruined world, then walk it.</h1>
  <p class="lede">The Mythic Spellbook map creator and mini-game engine, running here on its own. Sculpt terrain, set the water, place the post-apocalyptic city set or your own <code>.glb</code> models, give them collision, tune the sky, then press Play and walk the map you just made.</p>
  <button class="open" id="open">▶ Open Athena Engine</button>
  <p class="status" id="status">Loads three.js on first open (about 1 MB).</p>
  <div class="cols">
    <div class="box"><h2>Unreal hotkeys (default)</h2><ul>
      <li><kbd>Q</kbd><span>Select · <kbd>W</kbd> move · <kbd>E</kbd> rotate · <kbd>R</kbd> scale · <kbd>End</kbd> drop to floor</span></li>
      <li><kbd>RMB</kbd><span>Hold right mouse + <kbd>W A S D</kbd> to fly the viewport; wheel zooms.</span></li>
      <li><kbd>2</kbd><span>Sculpt. Hold <kbd>Shift</kbd> to lower, <kbd>Ctrl</kbd> smooth, <kbd>Alt</kbd> flatten. <kbd>3</kbd> paint asphalt, rust, soot.</span></li>
      <li><kbd>4</kbd><span>Place from Library → <b>Ruins</b>: towers, wrecks, barricades, pylons.</span></li>
    </ul></div>
    <div class="box"><h2>Collision &amp; Play</h2><ul>
      <li>▢<span>Select an object → <b>Add / Remove collision</b> in the inspector. <b>▢ Colliders</b> in the toolbar shows them all.</span></li>
      <li><kbd>P</kbd><span>Play from the Player Spawn marker: <kbd>W</kbd> forward, <kbd>S</kbd> back, <kbd>A</kbd> left, <kbd>D</kbd> right, <kbd>Space</kbd> jump, <kbd>Shift</kbd> run. Walls stop you, crates are climbed. <kbd>Esc</kbd> returns.</span></li>
      <li>🧊<span>Drag a <b>.glb</b> from your desktop onto the canvas; animated ones get clip, speed and loop fields.</span></li>
    </ul></div>
  </div>
  <p class="note"><b>On this preview page</b> maps save to this browser only; the Project library, URL models and Export downloads are blocked by the host. Dropped files and Import work. In the game the same editor saves to your account, exports, and reads <code>/models/</code>.</p>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/TransformControls.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js"></script>
<script type="module">
''' + bundle + r'''
const btn = document.getElementById('open'), st = document.getElementById('status');
btn.addEventListener('click', async () => {
  btn.disabled = true; st.textContent = window.THREE ? 'Opening…' : 'Fetching three.js…';
  const ed = await window.AthenaEngine.open({ onClose: () => { btn.disabled = false; st.textContent = 'Closed. Your map is kept in this browser — open again to continue.'; } });
  st.textContent = ed ? 'Editor open. Press H inside for all controls.' : 'three.js could not load — check the connection and try again.';
  if (!ed) btn.disabled = false;
});
</script>
'''
open(S+'/artifact/worldforge.html','w').write(page)
print('page bytes', len(page))
