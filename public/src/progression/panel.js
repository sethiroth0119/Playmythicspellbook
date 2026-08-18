/* ══════════════════════════════════════════════════════════════════════════
   🖥 THE PROGRESSION SCREEN — markup only.

   🔴 NO NUMBER IS COMPUTED IN THIS FILE. /src/economy/render.js is documented
      the same way and it is the rule this whole batch is under. Everything on
      screen arrives in the view model from `index.js report()`, which gets it
      from a live call; this file decides where it sits and what colour it is.
      If you find yourself adding arithmetic here, the number belongs upstream.
      The one exception is CSS geometry — `col * 188` is a pixel, not a claim
      about the city.

   🔴 AND THE OTHER HALF OF THE SAME RULE: A FIGURE WITH NO MODEL BEHIND IT IS
      SHOWN AS UNAVAILABLE, WITH THE REAL REASON. Every place a value could be
      missing, this file prints `unavail()` with the `why` string the reader
      gave it — never a dash, never a zero, never a plausible number. Two
      panels in this project have had to have content ripped out for inventing
      figures; this one states its sources on screen instead.

   LAYOUT (the user's reference screenshot, top to bottom):
     PROGRESSION        [DEVELOPMENT] [MILESTONES] [ACHIEVEMENTS]
     ┌──┬──────────────────────────────────┬────────────────────┐
     │ic│  the node tree, connected by     │  the selected node │
     │on│  lines                           │  + [UNLOCK  n ⬡]   │
     └──┴──────────────────────────────────┴────────────────────┘
     AVAILABLE DEVELOPMENT POINTS: n

   ⚠ THE CSS IS SCOPED AND INJECTED FROM HERE, not added to node-city's style
     block — three other workflows are editing that file this round. Every rule
     is prefixed `#ncprog`, and the colours are node-city's own custom
     properties so this reads as the same application.
   ══════════════════════════════════════════════════════════════════════════ */

const COLW = 188, ROWH = 86, NODEW = 156, NODEH = 62, PADX = 26, PADY = 22;

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CSS = `
/* ⚠ A FULL-SCREEN SCRIM, and z-index 46 was CHECKED rather than picked: the
   HUD rails and the zone-demand card sit at 42-44, #cardpicker at 45, the shop
   veil at 60 and the boot splash at 50. Without the scrim the demand card
   printed straight through this panel's right-hand pane, which is two readouts
   overlapping and neither of them legible. */
#ncprog{position:fixed;inset:0;z-index:46;display:none;align-items:center;justify-content:center;
  background:rgba(4,3,10,.62);backdrop-filter:blur(2px);
  font-family:'Crimson Text',Georgia,serif;color:var(--bone);}
#ncprog.open{display:flex;}
#ncprog .pgcard{width:min(1180px,calc(100vw - 40px));height:min(760px,calc(100vh - var(--topbarh) - 40px));
  margin-top:var(--topbarh);background:var(--panel-solid);border:1px solid var(--edge);border-radius:10px;
  display:flex;flex-direction:column;overflow:hidden;box-shadow:0 18px 60px rgba(0,0,0,.6);}
#ncprog .pgtop{display:flex;align-items:center;gap:14px;padding:11px 16px;border-bottom:1px solid var(--edge);
  background:linear-gradient(180deg,rgba(255,122,47,.07),transparent);}
#ncprog .pgtitle{font-family:'Cinzel',serif;letter-spacing:.2em;font-size:14px;color:var(--gold);text-transform:uppercase;}
#ncprog .pgtabs{display:flex;gap:6px;margin-left:8px;}
#ncprog .pgtab{font-family:'Cinzel',serif;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;
  padding:6px 13px;border:1px solid var(--edge);border-radius:5px;background:rgba(255,255,255,.02);
  color:var(--mist);cursor:pointer;user-select:none;}
#ncprog .pgtab:hover{color:var(--bone);border-color:#4a4064;}
#ncprog .pgtab.on{color:var(--obsidian);background:var(--gold);border-color:var(--gold);font-weight:700;}
#ncprog .pgx{margin-left:auto;cursor:pointer;color:var(--mist);font-size:18px;line-height:1;padding:2px 6px;}
#ncprog .pgx:hover{color:var(--ember);}
#ncprog .pgbody{flex:1;display:flex;min-height:0;}
#ncprog .pgrail{width:62px;border-right:1px solid var(--edge);display:flex;flex-direction:column;
  padding:8px 0;gap:4px;background:rgba(0,0,0,.22);overflow-y:auto;}
#ncprog .pgrailb{margin:0 8px;height:44px;border-radius:6px;display:flex;flex-direction:column;
  align-items:center;justify-content:center;cursor:pointer;border:1px solid transparent;color:var(--mist);}
#ncprog .pgralico{font-size:19px;line-height:1;}
#ncprog .pgralct{font-size:8.5px;letter-spacing:.06em;margin-top:2px;font-variant-numeric:tabular-nums;}
#ncprog .pgrailb:hover{background:rgba(255,255,255,.05);color:var(--bone);}
#ncprog .pgrailb.on{background:rgba(255,122,47,.14);border-color:var(--ember-dim);color:var(--ember);}
#ncprog .pgmain{flex:1;min-width:0;position:relative;overflow:auto;padding:14px 18px;}
#ncprog .pgside{width:308px;border-left:1px solid var(--edge);padding:14px 16px;overflow-y:auto;
  background:rgba(0,0,0,.16);display:flex;flex-direction:column;}
#ncprog .pgfoot{border-top:1px solid var(--edge);padding:9px 16px;display:flex;align-items:center;gap:14px;
  background:rgba(0,0,0,.25);font-size:12px;color:var(--mist);}
#ncprog .pgpts{font-family:'Cinzel',serif;letter-spacing:.14em;font-size:11px;text-transform:uppercase;color:var(--mist);}
#ncprog .pgpts b{font-size:17px;color:var(--gold);margin-left:8px;font-variant-numeric:tabular-nums;}
#ncprog .pgnote{margin-left:auto;font-size:11px;color:var(--mist);font-style:italic;}

#ncprog .pgcat{font-family:'Cinzel',serif;font-size:12px;letter-spacing:.16em;text-transform:uppercase;
  color:var(--bone);margin-bottom:2px;}
#ncprog .pgcatb{font-size:12px;color:var(--mist);margin-bottom:12px;}
#ncprog .pgtree{position:relative;}
#ncprog .pgtree svg{position:absolute;inset:0;pointer-events:none;overflow:visible;}
#ncprog .pgnode{position:absolute;width:${NODEW}px;min-height:${NODEH}px;border-radius:7px;padding:7px 9px;
  border:1px solid var(--edge);background:rgba(20,17,30,.92);cursor:pointer;box-sizing:border-box;
  transition:border-color .12s,background .12s;}
#ncprog .pgnode:hover{border-color:#5b4e7c;}
#ncprog .pgnode.sel{border-color:var(--gold);box-shadow:0 0 0 1px rgba(212,175,55,.35);}
#ncprog .pgnode.st-unlocked,#ncprog .pgnode.st-granted{background:rgba(76,175,122,.13);border-color:rgba(76,175,122,.45);}
#ncprog .pgnode.st-available{background:rgba(212,175,55,.1);border-color:rgba(212,175,55,.5);}
#ncprog .pgnode.st-locked{opacity:.72;}
#ncprog .pgnn{font-size:12.5px;line-height:1.25;color:var(--bone);}
#ncprog .pgnm{display:flex;align-items:center;gap:6px;margin-top:5px;font-size:10.5px;color:var(--mist);}
#ncprog .pgcost{font-variant-numeric:tabular-nums;color:var(--gold);}
#ncprog .pgnode.st-unlocked .pgcost,#ncprog .pgnode.st-granted .pgcost{color:var(--valid);}
#ncprog .pglic{color:var(--sky);}
#ncprog .pgext{color:var(--arcane);}
#ncprog .pgtick{margin-left:auto;color:var(--valid);}

#ncprog .pgsh{font-family:'Cinzel',serif;font-size:11px;letter-spacing:.16em;text-transform:uppercase;
  color:var(--mist);margin:0 0 6px;}
#ncprog .pgsname{font-size:17px;line-height:1.25;color:var(--bone);margin-bottom:4px;}
#ncprog .pgsdesc{font-size:13px;line-height:1.55;color:#c7c0b4;margin-bottom:12px;}
#ncprog .pgpill{display:inline-block;font-family:'Cinzel',serif;font-size:9.5px;letter-spacing:.14em;
  text-transform:uppercase;padding:3px 9px;border-radius:20px;margin-bottom:10px;}
#ncprog .pgpill.locked{background:rgba(192,71,63,.14);color:#e08a80;border:1px solid rgba(192,71,63,.4);}
#ncprog .pgpill.available{background:rgba(212,175,55,.14);color:var(--gold);border:1px solid rgba(212,175,55,.45);}
#ncprog .pgpill.unlocked{background:rgba(76,175,122,.14);color:var(--valid);border:1px solid rgba(76,175,122,.45);}
#ncprog .pgpill.granted{background:rgba(127,184,255,.13);color:var(--sky);border:1px solid rgba(127,184,255,.4);}
#ncprog .pgblk{font-size:12px;line-height:1.5;color:#e0b39a;padding:5px 0 5px 14px;position:relative;}
#ncprog .pgblk:before{content:'•';position:absolute;left:2px;color:var(--invalid);}
#ncprog .pgul{font-size:12.5px;line-height:1.6;color:var(--bone);padding:2px 0 2px 16px;position:relative;}
#ncprog .pgul:before{content:'▸';position:absolute;left:2px;color:var(--ember);}
#ncprog .pgul small{color:var(--mist);}
#ncprog .pgsec{border-top:1px solid var(--edge);margin-top:12px;padding-top:10px;}
#ncprog .pgbtn{display:block;width:100%;margin-top:14px;padding:11px;border-radius:6px;cursor:pointer;
  font-family:'Cinzel',serif;font-size:12px;letter-spacing:.16em;text-transform:uppercase;font-weight:700;
  border:1px solid rgba(76,175,122,.55);background:rgba(76,175,122,.9);color:#08130d;}
#ncprog .pgbtn:hover{background:#5fd08f;}
#ncprog .pgbtn[disabled]{background:rgba(255,255,255,.05);color:var(--mist);border-color:var(--edge);cursor:not-allowed;}
#ncprog .pgbtn2{display:block;width:100%;margin-top:8px;padding:9px;border-radius:6px;cursor:pointer;
  font-family:'Cinzel',serif;font-size:11px;letter-spacing:.14em;text-transform:uppercase;
  border:1px solid rgba(127,184,255,.45);background:rgba(127,184,255,.12);color:var(--sky);}
#ncprog .pgbtn2:hover{background:rgba(127,184,255,.22);}

#ncprog .pgrow{display:flex;gap:12px;align-items:flex-start;padding:10px 12px;border:1px solid var(--edge);
  border-radius:7px;margin-bottom:8px;background:rgba(20,17,30,.72);}
#ncprog .pgrow.done{background:rgba(76,175,122,.1);border-color:rgba(76,175,122,.35);}
#ncprog .pgrow.na{opacity:.75;border-style:dashed;}
#ncprog .pgrico{font-size:19px;line-height:1.2;width:24px;text-align:center;}
#ncprog .pgrbody{flex:1;min-width:0;}
#ncprog .pgrname{font-size:14px;color:var(--bone);}
#ncprog .pgrdesc{font-size:12px;color:var(--mist);line-height:1.5;margin-top:2px;}
#ncprog .pgrsrc{font-size:10.5px;color:#7a7290;margin-top:5px;font-style:italic;}
#ncprog .pgrval{font-size:13px;font-variant-numeric:tabular-nums;color:var(--bone);white-space:nowrap;}
#ncprog .pgrval.done{color:var(--valid);}
#ncprog .pgrval.na{color:var(--invalid);font-style:italic;font-size:11.5px;white-space:normal;max-width:210px;}
#ncprog .pgrpts{font-family:'Cinzel',serif;font-size:12px;color:var(--gold);white-space:nowrap;}
#ncprog .pgbar{height:5px;border-radius:3px;background:rgba(255,255,255,.07);margin-top:6px;overflow:hidden;}
#ncprog .pgbar i{display:block;height:100%;background:linear-gradient(90deg,var(--ember-dim),var(--ember));}
#ncprog .pgempty{font-size:12.5px;color:var(--mist);font-style:italic;padding:18px 4px;line-height:1.6;}
#ncprog .pgsrcs{margin-top:16px;border-top:1px solid var(--edge);padding-top:10px;font-size:11px;color:#7a7290;line-height:1.6;}
#ncprog .pgsrcs b{color:var(--mist);font-weight:400;}
#ncprog .pglegacy{margin:0 0 12px;padding:8px 11px;border-radius:6px;font-size:12px;line-height:1.55;
  background:rgba(127,184,255,.09);border:1px solid rgba(127,184,255,.3);color:#bcd6f2;}
`;

export function makePanel(api, host) {
  let root = null, isOpen = false;
  let tab = 'dev', cat = 'civ', sel = null;

  function css() {
    if (document.getElementById('ncprog-css')) return;
    const s = document.createElement('style');
    s.id = 'ncprog-css'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  function build() {
    if (root) return root;
    css();
    root = document.createElement('div');
    root.id = 'ncprog';
    document.body.appendChild(root);
    root.addEventListener('click', onClick);
    return root;
  }

  function onClick(ev) {
    const t = ev.target.closest ? ev.target : null;
    if (!t) return;
    const tabEl = t.closest('.pgtab');
    if (tabEl) { tab = tabEl.getAttribute('data-tab'); return draw(); }
    if (t.closest('.pgx')) return open(false);
    if (!t.closest('.pgcard')) return open(false);   // a click on the scrim
    const railEl = t.closest('.pgrailb');
    if (railEl) { cat = railEl.getAttribute('data-cat'); sel = null; return draw(); }
    const nodeEl = t.closest('.pgnode');
    if (nodeEl) { sel = nodeEl.getAttribute('data-id'); return draw(); }
    const unl = t.closest('[data-act="unlock"]');
    if (unl) { api.unlock(unl.getAttribute('data-id')); return draw(); }
    const hall = t.closest('[data-act="cityhall"]');
    if (hall) { api.openCityHall(hall.getAttribute('data-lic')); return; }
  }

  /* ── DEVELOPMENT: the tree ─────────────────────────────────────────────── */
  function drawTree(v) {
    const ns = v.nodes.filter((n) => n.cat === cat);
    if (!ns.length) return '<div class="pgempty">This category has no nodes.</div>';
    const c = v.cats.find((x) => x.id === cat) || { name: cat, blurb: '' };
    let maxCol = 0, maxRow = 0;
    for (const n of ns) { if (n.col > maxCol) maxCol = n.col; if (n.row > maxRow) maxRow = n.row; }
    const W = PADX * 2 + maxCol * COLW + NODEW, H = PADY * 2 + maxRow * ROWH + NODEH;
    const at = (n) => ({ x: PADX + n.col * COLW, y: PADY + n.row * ROWH });

    /* The connection lines come from `req`, so a line exists because the data
       says two nodes are connected — never because they happen to be
       adjacent. A prerequisite in ANOTHER category cannot be drawn here and is
       shown on the node itself as a badge instead. */
    const byId = {};
    for (const n of ns) byId[n.id] = n;
    let lines = '';
    for (const n of ns) {
      const b = at(n);
      for (const r of n.req) {
        const p = byId[r]; if (!p) continue;
        const a = at(p);
        const x1 = a.x + NODEW, y1 = a.y + NODEH / 2, x2 = b.x, y2 = b.y + NODEH / 2;
        const mx = (x1 + x2) / 2;
        const lit = p.done && n.done;
        lines += '<path d="M' + x1 + ' ' + y1 + ' H' + mx + ' V' + y2 + ' H' + x2 + '" fill="none" stroke="' +
                 (lit ? 'rgba(76,175,122,.75)' : 'rgba(110,98,148,.55)') + '" stroke-width="' + (lit ? 2 : 1.4) + '"/>';
      }
    }
    let cards = '';
    for (const n of ns) {
      const p = at(n);
      const ext = n.req.filter((r) => !byId[r]).map((r) => v.nodeName[r] || r);
      cards += '<div class="pgnode st-' + n.state + (sel === n.id ? ' sel' : '') + '" data-id="' + esc(n.id) +
        '" style="left:' + p.x + 'px;top:' + p.y + 'px">' +
        '<div class="pgnn">' + esc(n.name) + '</div>' +
        '<div class="pgnm">' +
          '<span class="pgcost">' + (n.cost ? n.cost + ' ⬡' : 'free') + '</span>' +
          (n.licence ? '<span class="pglic" title="Requires a City Hall licence">🔑 ' + esc(n.licence.label || n.licence.key) + '</span>' : '') +
          (ext.length ? '<span class="pgext" title="Prerequisite in another category">↗ ' + esc(ext.join(', ')) + '</span>' : '') +
          (n.done ? '<span class="pgtick">✔</span>' : '') +
        '</div></div>';
    }
    return '<div class="pgcat">' + esc(c.ico || '') + ' ' + esc(c.name) + '</div>' +
           '<div class="pgcatb">' + esc(c.blurb) + '</div>' +
           '<div class="pgtree" style="width:' + W + 'px;height:' + H + 'px">' +
           '<svg width="' + W + '" height="' + H + '">' + lines + '</svg>' + cards + '</div>';
  }

  /* ── DEVELOPMENT: the right-hand detail pane ───────────────────────────── */
  function drawDetail(v) {
    const n = v.nodes.find((x) => x.id === sel) || v.nodes.find((x) => x.cat === cat) || null;
    if (!n) return '<div class="pgempty">Pick a node.</div>';
    let h = '<div class="pgsh">Selected</div>';
    h += '<div class="pgsname">' + esc(n.name) + '</div>';
    h += '<div class="pgsdesc">' + esc(n.desc) + '</div>';
    const pillTxt = { unlocked: 'Unlocked', granted: 'Already yours', available: 'Ready to unlock', locked: 'Locked' };
    h += '<div><span class="pgpill ' + n.state + '">' + pillTxt[n.state] + '</span></div>';
    if (n.state === 'granted') {
      h += '<div class="pgsdesc" style="font-size:12px">This city already had what this node opens when progression arrived, so it was granted free — no points were spent.</div>';
    }
    if (n.blockers.length) {
      h += '<div class="pgsec"><div class="pgsh">Requires</div>';
      for (const b of n.blockers) h += '<div class="pgblk">' + esc(b.text) + '</div>';
      h += '</div>';
    }
    const u = n.unlocks;
    h += '<div class="pgsec"><div class="pgsh">Unlocks</div>';
    if (!u.zones.length && !u.buildings.length && !u.ops.length) {
      h += '<div class="pgsdesc" style="font-size:12px;margin:0">Nothing directly. It is the prerequisite ' +
           (n.gatesFor.length ? 'for ' + esc(n.gatesFor.join(', ')) + '.' : 'for the nodes that connect to it.') + '</div>';
    } else {
      for (const z of u.zones) h += '<div class="pgul">' + esc(z.name) + ' <small>· zone</small></div>';
      for (const b of u.buildings) h += '<div class="pgul">' + esc(b.name) + ' <small>· building</small></div>';
      for (const o of u.ops) h += '<div class="pgul">' + esc(o.name) + ' <small>· operation</small></div>';
    }
    h += '</div>';
    if (n.licence) {
      h += '<div class="pgsec"><div class="pgsh">Licence</div>';
      const L = n.licence;
      if (L.held === true) {
        h += '<div class="pgsdesc" style="font-size:12px;margin:0;color:#8fd8ae">✔ You hold the ' + esc(L.label) + ' licence.</div>';
      } else if (L.held === null) {
        h += '<div class="pgsdesc" style="font-size:12px;margin:0;color:#e08a80">Unavailable — ' + esc(L.why) + '</div>';
      } else {
        h += '<div class="pgsdesc" style="font-size:12px;margin:0">The ' + esc(L.label) + ' licence is bought at City Hall' +
             (L.price ? ', for ' + Number(L.price).toLocaleString() + ' 🔥' : '') + '.</div>' +
             '<button class="pgbtn2" data-act="cityhall" data-lic="' + esc(L.key) + '">Open City Hall</button>';
      }
      h += '</div>';
    }
    if (n.state === 'available') {
      h += '<button class="pgbtn" data-act="unlock" data-id="' + esc(n.id) + '">Unlock &nbsp; ' + n.cost + ' ⬡</button>';
    } else if (n.state === 'locked') {
      h += '<button class="pgbtn" disabled>Unlock &nbsp; ' + n.cost + ' ⬡</button>';
    }
    return h;
  }

  /* ── MILESTONES ────────────────────────────────────────────────────────── */
  function drawMilestones(v) {
    let h = '<div class="pgcat">🏅 Milestones</div>' +
      '<div class="pgcatb">Passing one pays development points, permanently. A milestone once passed is never taken back.</div>';
    for (const m of v.milestones) {
      const p = m.progress;
      const cls = m.reached ? 'done' : (p.ok ? '' : 'na');
      h += '<div class="pgrow ' + cls + '">' +
        '<div class="pgrico">' + (m.reached ? '🏅' : '○') + '</div>' +
        '<div class="pgrbody"><div class="pgrname">' + esc(m.name) + '</div>' +
        '<div class="pgrdesc">' + esc(m.desc) + '</div>' +
        (p.ok ? '<div class="pgbar"><i style="width:' + p.pct + '%"></i></div>' : '') +
        '<div class="pgrsrc">' + esc(m.label) + ' — ' + esc(m.source) + '</div></div>' +
        '<div style="text-align:right">' +
          (p.ok
            ? '<div class="pgrval' + (m.reached ? ' done' : '') + '">' + esc(p.text) + '</div>'
            : '<div class="pgrval na">unavailable — ' + esc(p.why) + '</div>') +
          '<div class="pgrpts">+' + m.pts + ' ⬡</div>' +
        '</div></div>';
    }
    return h;
  }

  /* ── ACHIEVEMENTS ──────────────────────────────────────────────────────── */
  function drawAchievements(v) {
    let h = '<div class="pgcat">🏆 Achievements</div>' +
      '<div class="pgcatb">Things this city did. They pay no development points — the reward channel for these is ' +
      'MythicProgress.onAchievement(), which is where card grants will be hung.</div>';
    for (const a of v.achievements) {
      const st = a.state;
      const cls = a.earned ? 'done' : (st.ok ? '' : 'na');
      h += '<div class="pgrow ' + cls + '">' +
        '<div class="pgrico">' + esc(a.ico) + '</div>' +
        '<div class="pgrbody"><div class="pgrname">' + esc(a.name) + (a.earned ? ' <span style="color:var(--valid)">✔</span>' : '') + '</div>' +
        '<div class="pgrdesc">' + esc(a.desc) + '</div>' +
        '<div class="pgrsrc">trigger: ' + esc(a.how) + '</div></div>' +
        '<div style="text-align:right">' +
          (st.ok
            ? '<div class="pgrval' + (a.earned ? ' done' : '') + '">' + esc(st.at == null ? (st.done ? 'done' : '') : st.at) + '</div>'
            : '<div class="pgrval na">unavailable — ' + esc(st.why) + '</div>') +
          '<div class="pgrpts" style="color:var(--mist)">' + (a.reward ? esc(String(a.reward)) : 'reward: reserved') + '</div>' +
        '</div></div>';
    }
    return h;
  }

  function sourcesBlock(v) {
    let h = '<div class="pgsrcs"><b>Where these numbers come from.</b><br>';
    for (const s of v.sources) h += '· ' + esc(s.label) + ' — ' + esc(s.source) + '<br>';
    h += '</div>';
    return h;
  }

  function draw() {
    if (!root || !isOpen) return;
    const v = api.report();
    const rail = v.cats.map((c) =>
      '<div class="pgrailb' + (c.id === cat ? ' on' : '') + '" data-cat="' + esc(c.id) + '" title="' + esc(c.name + ' — ' + c.blurb) + '">' +
      '<div class="pgralico">' + esc(c.ico) + '</div><div class="pgralct">' + c.done + '/' + c.total + '</div></div>').join('');
    const tabs = [['dev', 'Development'], ['ms', 'Milestones'], ['ach', 'Achievements']]
      .map(([k, l]) => '<div class="pgtab' + (tab === k ? ' on' : '') + '" data-tab="' + k + '">' + l + '</div>').join('');

    let mainHtml, sideHtml = '', railHtml = '';
    if (tab === 'dev') {
      railHtml = rail;
      mainHtml = (v.legacy ? '<div class="pglegacy">' + esc(v.legacyNote) + '</div>' : '') + drawTree(v);
      sideHtml = drawDetail(v);
    } else if (tab === 'ms') {
      mainHtml = drawMilestones(v) + sourcesBlock(v);
      sideHtml = '<div class="pgsh">Points</div>' +
        '<div class="pgsdesc">Development points come from milestones and from nothing else. They cannot be bought, ' +
        'traded or minted — there is no balance behind them, only the list on the left.</div>' +
        '<div class="pgsec"><div class="pgsh">This city</div>' +
        '<div class="pgul">' + v.points.earned + ' ⬡ earned <small>· ' + v.reachedCount + ' of ' + v.milestones.length + ' milestones</small></div>' +
        '<div class="pgul">' + v.points.spent + ' ⬡ spent <small>· on ' + v.unlockedCount + ' nodes</small></div>' +
        '<div class="pgul">' + v.points.available + ' ⬡ available</div></div>' +
        '<div class="pgsec"><div class="pgsh">The whole tree</div>' +
        '<div class="pgul">' + v.total.cost + ' ⬡ <small>· to clear all ' + v.total.nodes + ' nodes</small></div>' +
        '<div class="pgul">' + v.total.onOffer + ' ⬡ <small>· on offer across every milestone</small></div></div>';
    } else {
      mainHtml = drawAchievements(v) + sourcesBlock(v);
      sideHtml = '<div class="pgsh">The card seam</div>' +
        '<div class="pgsdesc">City achievements are meant to unlock cards. That grant is not built here: cards live in ' +
        'the main game behind bindings an ES module cannot see, so this module fires the edge and the host does the granting.</div>' +
        '<div class="pgsec"><div class="pgul">MythicProgress.onAchievement(fn) <small>· fires once, the moment one is earned</small></div>' +
        '<div class="pgul">reward <small>· the field a card id goes in, null on every row today</small></div></div>';
    }

    root.innerHTML =
      '<div class="pgcard">' +
      '<div class="pgtop"><div class="pgtitle">Progression</div><div class="pgtabs">' + tabs + '</div>' +
      '<div class="pgx" title="Close (Esc)">✕</div></div>' +
      '<div class="pgbody">' +
        (railHtml ? '<div class="pgrail">' + railHtml + '</div>' : '') +
        '<div class="pgmain">' + mainHtml + '</div>' +
        '<div class="pgside">' + sideHtml + '</div>' +
      '</div>' +
      '<div class="pgfoot"><div class="pgpts">Available development points<b>' + v.points.available + ' ⬡</b></div>' +
      '<div class="pgnote">' + esc(v.footNote) + '</div></div>' +
      '</div>';
  }

  function open(v) {
    build();
    isOpen = (v == null) ? !isOpen : !!v;
    root.classList.toggle('open', isOpen);
    if (isOpen) { try { api.tick(); } catch (e) {} draw(); }
    return isOpen;
  }

  return {
    open, toggle: () => open(null), close: () => open(false),
    isOpen: () => isOpen,
    refresh: () => draw(),
    select: (id) => { sel = id; const n = api.nodeById(id); if (n) { cat = n.cat; tab = 'dev'; } open(true); },
    tab: (t) => { tab = t; draw(); },
  };
}
