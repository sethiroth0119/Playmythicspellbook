/* ══════════════════════════════════════════════════════════════════════════
   🎨 THE FLEET WRAP SHOP — where a van stops being "a van" and becomes yours

   Mounts inside the warehouse page and repaints the ACTUAL truck in the yard as
   the player drags. Not a swatch, not a thumbnail — the vehicle standing on the
   apron changes colour under them. That is the whole design brief: the point of
   this feature is ownership, and ownership is felt when the thing you own
   visibly answers to you.

   ── WHAT APPLIES INSTANTLY AND WHAT WAITS ─────────────────────────────────
   Paint, accent, emblem, fleet name and placement are live the moment they are
   saved. They are not user-authored artwork, so they are not reviewed, so
   there is nothing to wait for. A player who never touches the logo section
   still drives away with a van in their colours, wearing their mark, with their
   company name signwritten on the flank.

   The uploaded logo is the ONLY thing that waits, and the shop says so in those
   words. It never shows an upload control that will fail: /api/livery/config
   reports whether the moderated lane is actually open, and when it is not the
   section explains that instead of pretending.

   ⚠ THIS FILE HAS NO CREDENTIALS AND CANNOT REACH SUPABASE. The warehouse page
     is an iframe that talks to the game over postMessage; every read, write and
     upload here goes through host.rpc() / host.upload(). That is not
     ceremony — it is why an XSS in this panel cannot become a storage write.
   ══════════════════════════════════════════════════════════════════════════ */

import { EMBLEMS, SCHEMES, DEFAULTS, PANELS, statusInfo, canSubmit, isBusy,
         checkFile, clampPlace, normalise, MAX_FLEET_NAME } from './livery.js';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function mountWrapShop(host) {
  const doc = host.document || document;
  let liv = normalise(host.initial || {});
  let cfg = { configured: false, verified: false };
  let panel = 'side';
  let el = null, dirty = false, saveTimer = null;

  const say = (m, ms) => { try { host.toast && host.toast(m, ms || 2600); } catch (e) {} };

  /* Repaint the real truck. Called on every input, so it must be cheap and it
     must not stack decals — decal.js clears its own work first. */
  function repaint() { try { host.repaint && host.repaint(liv); } catch (e) {} }

  function saveSoon() {
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 700);
  }
  /* 🔴 A FAILED SAVE USED TO BE INVISIBLE, AND THAT IS HOW A WRAP GOT LOST.
     This cleared `dirty` BEFORE the call and had no catch, so an rpc that
     rejected — a function missing from the database, an expired session, a
     dropped connection — threw into nothing: no retry, because dirty was
     already false, and no message, because nobody was listening. The player
     saw the van repaint (that is local), left, came back, and it was white.
     THE REPORT: "when a player wraps their truck in warehouse save it, it is
     not saving." The paint was never reaching the server, and the shop had no
     way of telling them so.
     Now the flag is only cleared once the write has actually landed, and a
     failure says so and stays dirty so the next edit — or close() — retries. */
  async function save() {
    if (!dirty) return;
    let r;
    try {
      r = await host.rpc('van_livery_save_safe', {
        p_paint: liv.paint, p_accent: liv.accent,
        p_emblem: liv.emblem === 'none' ? null : liv.emblem,
        p_fleet_name: liv.fleetName || null,
        p_place: liv.place,
      });
    } catch (e) {
      try { console.warn('[livery] save failed', e); } catch (_) {}
      say('🎨 The wrap did not save — the shop could not reach the depot. It will try again.', 4200);
      return;                       // still dirty: the next edit or close() retries
    }
    dirty = false;
    /* ⚠ The server MAY have changed the fleet name — chat_clean masks it there,
       not here. Taking the server's copy back is what stops the van showing the
       player one thing and everybody else another. */
    if (r && r.fleet_name !== undefined) {
      const back = normalise(r);
      if (back.fleetName !== liv.fleetName) {
        liv.fleetName = back.fleetName;
        repaint(); render();
        say('The name on the door was adjusted.', 3200);
      }
    }
  }

  /* ── markup ─────────────────────────────────────────────────────────────── */
  function schemeRow() {
    return SCHEMES.map((s) => {
      const on = s.paint.toLowerCase() === liv.paint.toLowerCase()
              && s.accent.toLowerCase() === liv.accent.toLowerCase();
      return '<button class="wl-scheme' + (on ? ' on' : '') + '" data-scheme="' + s.id + '" title="' + esc(s.name) + '">'
        + '<span class="wl-sw" style="background:' + s.paint + '"><i style="background:' + s.accent + '"></i></span>'
        + '<span class="wl-swn">' + esc(s.name) + '</span></button>';
    }).join('');
  }
  function emblemGrid() {
    return EMBLEMS.map((e) => {
      const on = e.id === liv.emblem;
      return '<button class="wl-em' + (on ? ' on' : '') + '" data-emblem="' + e.id + '" title="' + esc(e.hint || e.name) + '">'
        + '<canvas width="52" height="52" data-emcanvas="' + e.id + '"></canvas>'
        + '<span>' + esc(e.name) + '</span></button>';
    }).join('');
  }
  function logoSection() {
    const st = statusInfo(liv.logoStatus);
    /* Three different worlds, and each gets a different panel rather than one
       disabled button with a tooltip nobody reads. */
    if (!cfg.configured || !cfg.verified) {
      return '<div class="wl-logo wl-shut">'
        + '<div class="wl-lh">🖼 Your own logo</div>'
        + '<p>Custom artwork is not open yet. When it is, your logo goes through an '
        + 'independent safety check and a person in the shop before it goes on the road — '
        + 'that is the deal that lets us host it at all.</p>'
        + '<p class="wl-dim">Everything else on this panel is yours right now.</p></div>';
    }
    const rows = ['<div class="wl-logo">', '<div class="wl-lh">🖼 Your own logo</div>',
      '<div class="wl-st wl-' + st.tone + '"><b>' + esc(st.label) + '</b><span>' + esc(st.say) + '</span></div>'];
    if (canSubmit(liv.logoStatus)) {
      rows.push('<input type="file" id="wl-file" accept="image/png,image/jpeg,image/webp">');
      rows.push('<button class="wl-btn gold" id="wl-send">Send it to the shop</button>');
      rows.push('<p class="wl-dim">PNG, JPEG or WebP · up to 2 MB · it goes on both flanks and the rear door.</p>');
    } else if (isBusy(liv.logoStatus)) {
      rows.push('<div class="wl-bar"><i></i></div>');
      rows.push('<p class="wl-dim">You can keep changing your paint while it is in the booth.</p>');
    }
    rows.push('</div>');
    return rows.join('');
  }
  function placeRow() {
    const p = liv.place[panel], P = PANELS[panel];
    const mx = ((P.w - P.w * p.s) / 2).toFixed(2), my = ((P.h - P.h * p.s) / 2).toFixed(2);
    return ''
      + '<div class="wl-tabs">'
      +   '<button class="wl-tab' + (panel === 'side' ? ' on' : '') + '" data-panel="side">Flanks</button>'
      +   '<button class="wl-tab' + (panel === 'rear' ? ' on' : '') + '" data-panel="rear">Rear door</button>'
      + '</div>'
      + '<label class="wl-sl">Size<input type="range" data-pl="s" min="0.25" max="1" step="0.01" value="' + p.s + '"></label>'
      + '<label class="wl-sl">Across<input type="range" data-pl="x" min="-' + mx + '" max="' + mx + '" step="0.01" value="' + p.x + '"></label>'
      + '<label class="wl-sl">Height<input type="range" data-pl="y" min="-' + my + '" max="' + my + '" step="0.01" value="' + p.y + '"></label>'
      + '<label class="wl-sl">Tilt<input type="range" data-pl="r" min="0" max="359" step="1" value="' + p.r + '"></label>';
  }

  function render() {
    if (!el) return;
    el.innerHTML = ''
      + '<div class="wl-h">🎨 Fleet Wrap Shop</div>'
      + '<div class="wl-sub">This is your van. Paint it.</div>'
      + '<div class="wl-sec">Paint</div><div class="wl-schemes">' + schemeRow() + '</div>'
      + '<div class="wl-custom">'
      +   '<label class="wl-c">Body<input type="color" id="wl-paint" value="' + liv.paint + '"></label>'
      +   '<label class="wl-c">Trim<input type="color" id="wl-accent" value="' + liv.accent + '"></label>'
      + '</div>'
      + '<div class="wl-sec">Mark</div><div class="wl-ems">' + emblemGrid() + '</div>'
      + '<div class="wl-sec">Name on the door</div>'
      + '<input class="wl-name" id="wl-name" maxlength="' + MAX_FLEET_NAME + '" placeholder="e.g. Ashvane Haulage" value="' + esc(liv.fleetName) + '">'
      + '<div class="wl-sec">Where it sits</div>' + placeRow()
      + logoSection()
      + '<button class="wl-btn" id="wl-close">Done</button>';

    // Emblem thumbnails are drawn with the same routine that paints the van, so
    // the button and the bodywork can never show different art.
    el.querySelectorAll('[data-emcanvas]').forEach((c) => {
      const id = c.getAttribute('data-emcanvas');
      const ctx = c.getContext('2d'); if (!ctx) return;
      ctx.clearRect(0, 0, 52, 52);
      if (id !== 'none' && host.drawEmblem) host.drawEmblem(ctx, id, 52, 52, liv.accent);
      else if (id === 'none') { ctx.strokeStyle = '#6a6255'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(14, 38); ctx.lineTo(38, 14); ctx.stroke(); }
    });
    bind();
  }

  function bind() {
    const $ = (id) => el.querySelector('#' + id);
    el.querySelectorAll('[data-scheme]').forEach((b) => b.onclick = () => {
      const s = SCHEMES.find((x) => x.id === b.getAttribute('data-scheme'));
      if (!s) return;
      liv.paint = s.paint; liv.accent = s.accent;
      repaint(); saveSoon(); render();
    });
    el.querySelectorAll('[data-emblem]').forEach((b) => b.onclick = () => {
      liv.emblem = b.getAttribute('data-emblem');
      repaint(); saveSoon(); render();
    });
    el.querySelectorAll('[data-panel]').forEach((b) => b.onclick = () => {
      panel = b.getAttribute('data-panel'); render();
    });
    el.querySelectorAll('[data-pl]').forEach((r) => {
      r.oninput = () => {
        const k = r.getAttribute('data-pl');
        const next = { ...liv.place[panel] };
        next[k] = parseFloat(r.value);
        liv.place[panel] = clampPlace(panel, next);
        repaint(); saveSoon();
      };
    });
    const pc = $('wl-paint'), ac = $('wl-accent');
    if (pc) pc.oninput = () => { liv.paint = pc.value; repaint(); saveSoon(); };
    if (ac) ac.oninput = () => { liv.accent = ac.value; repaint(); saveSoon(); };
    const nm = $('wl-name');
    if (nm) nm.oninput = () => { liv.fleetName = nm.value.slice(0, MAX_FLEET_NAME); repaint(); saveSoon(); };
    const cl = $('wl-close'); if (cl) cl.onclick = () => close();

    const send = $('wl-send');
    if (send) send.onclick = async () => {
      const f = ($('wl-file') || {}).files && $('wl-file').files[0];
      const v = checkFile(f);
      if (!v.ok) { say('🖼 ' + v.why, 3600); return; }
      send.disabled = true; send.textContent = 'Sending…';
      const r = await host.upload(f);
      send.disabled = false; send.textContent = 'Send it to the shop';
      if (!r || !r.ok) { say('🖼 ' + ((r && r.why) || 'That did not go through. Try again.'), 4200); return; }
      liv.logoStatus = r.status || 'uploaded';
      render();
      say('🎨 In the paint booth. We will put it on as soon as it is cleared.', 4200);
    };
  }

  /* Saves are debounced 700ms so dragging a colour picker is not 40 writes.
     That leaves a window where the player has finished, hit Done, and walked
     out of the warehouse before the timer ever fired — and on the way out the
     page goes with it. Closing the shop is the player saying "that is the one",
     so it flushes immediately rather than waiting out the debounce. */
  function flush() {
    if (!dirty) return;
    clearTimeout(saveTimer);
    try { save(); } catch (e) { try { console.warn('[livery] flush', e); } catch (_) {} }
  }
  function close() {
    flush();
    if (el) el.classList.remove('on');
    if (host.onClose) host.onClose();
  }
  /* …and the same on the way off the page, for the player who never closes the
     shop at all and just hits Back. Best effort: the request may not outlive
     the unload, but an unsent write is strictly worse than a raced one. */
  try {
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('pagehide', flush);
      doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'hidden') flush(); });
    }
  } catch (e) {}

  return {
    async mount(container) {
      el = doc.createElement('div');
      el.id = 'wrapshop';
      container.appendChild(el);
      injectCss(doc);
      /* Ask the server what the player already has AND whether the logo lane is
         open, before drawing anything — a shop that renders an upload box and
         then hides it is worse than one that waits 200 ms. */
      try {
        const [row, conf] = await Promise.all([
          host.rpc('van_livery_mine', {}),
          host.config ? host.config() : Promise.resolve(null),
        ]);
        if (row) liv = normalise(row);
        if (conf) cfg = conf;
      } catch (e) {}
      repaint(); render();
      return this;
    },
    open() { if (el) { el.classList.add('on'); render(); } },
    close,
    isOpen: () => !!(el && el.classList.contains('on')),
    livery: () => liv,
    setStatus(s) { liv.logoStatus = s; render(); },
  };
}

function injectCss(doc) {
  if (doc.getElementById('wrapshop-css')) return;
  const s = doc.createElement('style');
  s.id = 'wrapshop-css';
  s.textContent = `
#wrapshop{position:absolute;top:64px;right:12px;width:296px;z-index:11;display:none;
  background:linear-gradient(180deg,rgba(22,19,16,.97),rgba(14,13,11,.97));
  border:1px solid rgba(198,160,74,.34);border-radius:3px;padding:12px 13px;
  box-shadow:inset 0 0 0 3px rgba(0,0,0,.5),inset 0 0 0 4px rgba(198,160,74,.14),0 12px 34px rgba(0,0,0,.6);
  max-height:calc(100% - 150px);overflow-y:auto;color:#e8dfc9;font-size:12px}
#wrapshop.on{display:block}
#wrapshop .wl-h{font-family:'Cinzel',Georgia,serif;font-variant:small-caps;letter-spacing:.14em;color:#f0d98a;font-size:13.5px}
#wrapshop .wl-sub{font-size:10.5px;color:#9d907a;margin-bottom:9px}
#wrapshop .wl-sec{font-variant:small-caps;letter-spacing:.12em;color:#c6a04a;font-size:10.5px;
  margin:12px 0 6px;padding-top:8px;border-top:1px solid rgba(198,160,74,.15)}
#wrapshop .wl-schemes{display:grid;grid-template-columns:1fr 1fr;gap:5px}
#wrapshop .wl-scheme{display:flex;align-items:center;gap:6px;padding:5px 6px;border-radius:3px;cursor:pointer;
  background:rgba(0,0,0,.35);border:1px solid rgba(198,160,74,.2);color:#e8dfc9;font:inherit;font-size:10.5px;text-align:left}
#wrapshop .wl-scheme.on{border-color:#d4af37;background:rgba(212,175,55,.16)}
#wrapshop .wl-sw{width:20px;height:20px;border-radius:2px;flex:0 0 auto;position:relative;border:1px solid rgba(0,0,0,.5)}
#wrapshop .wl-sw i{position:absolute;right:1px;bottom:1px;width:8px;height:8px;border-radius:1px}
#wrapshop .wl-swn{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#wrapshop .wl-custom{display:flex;gap:8px;margin-top:7px}
#wrapshop .wl-c{flex:1;display:flex;align-items:center;justify-content:space-between;font-size:10.5px;color:#9d907a}
#wrapshop .wl-c input{width:44px;height:24px;border:1px solid rgba(198,160,74,.3);background:none;padding:0;cursor:pointer}
#wrapshop .wl-ems{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}
#wrapshop .wl-em{padding:4px 2px;border-radius:3px;cursor:pointer;background:rgba(0,0,0,.35);
  border:1px solid rgba(198,160,74,.2);color:#9d907a;font:inherit;font-size:8.5px;line-height:1.15;
  display:flex;flex-direction:column;align-items:center;gap:2px}
#wrapshop .wl-em.on{border-color:#d4af37;background:rgba(212,175,55,.16);color:#e8dfc9}
#wrapshop .wl-em canvas{width:34px;height:34px}
#wrapshop .wl-name{width:100%;padding:6px 8px;border-radius:3px;background:rgba(0,0,0,.4);
  border:1px solid rgba(198,160,74,.25);color:#e8dfc9;font:inherit;font-size:12px}
#wrapshop .wl-tabs{display:flex;gap:5px;margin-bottom:6px}
#wrapshop .wl-tab{flex:1;padding:4px;border-radius:3px;cursor:pointer;background:rgba(0,0,0,.35);
  border:1px solid rgba(198,160,74,.2);color:#9d907a;font:inherit;font-size:10.5px}
#wrapshop .wl-tab.on{border-color:#d4af37;color:#e8dfc9;background:rgba(212,175,55,.16)}
#wrapshop .wl-sl{display:flex;align-items:center;gap:7px;font-size:10.5px;color:#9d907a;margin-top:4px}
#wrapshop .wl-sl input{flex:1;accent-color:#c6a04a}
#wrapshop .wl-logo{margin-top:12px;padding-top:9px;border-top:1px solid rgba(198,160,74,.15)}
#wrapshop .wl-lh{font-variant:small-caps;letter-spacing:.12em;color:#c6a04a;font-size:10.5px;margin-bottom:5px}
#wrapshop .wl-logo p{font-size:10.5px;color:#9d907a;line-height:1.5;margin:5px 0}
#wrapshop .wl-dim{color:#7d7365}
#wrapshop .wl-st{display:flex;flex-direction:column;gap:2px;padding:6px 8px;border-radius:3px;
  background:rgba(0,0,0,.4);border-left:2px solid #6a6255;margin-bottom:6px}
#wrapshop .wl-st b{font-size:11.5px}
#wrapshop .wl-st span{font-size:10px;color:#9d907a;line-height:1.4}
#wrapshop .wl-good{border-left-color:#6fbf85}#wrapshop .wl-good b{color:#8fd8a3}
#wrapshop .wl-work{border-left-color:#c6a04a}#wrapshop .wl-work b{color:#f0d98a}
#wrapshop .wl-bad{border-left-color:#b4564c}#wrapshop .wl-bad b{color:#e08a80}
#wrapshop .wl-warn{border-left-color:#9a7f3f}#wrapshop .wl-warn b{color:#d8bd76}
#wrapshop .wl-bar{height:3px;border-radius:2px;background:rgba(0,0,0,.5);overflow:hidden}
#wrapshop .wl-bar i{display:block;height:100%;width:40%;background:linear-gradient(90deg,transparent,#c6a04a,transparent);
  animation:wlb 1.5s linear infinite}
@keyframes wlb{from{transform:translateX(-100%)}to{transform:translateX(320%)}}
#wrapshop input[type=file]{width:100%;font-size:10.5px;color:#9d907a;margin:4px 0}
#wrapshop .wl-btn{width:100%;margin-top:9px;padding:7px;border-radius:3px;cursor:pointer;
  background:rgba(0,0,0,.4);border:1px solid rgba(198,160,74,.3);color:#e8dfc9;font:inherit;font-size:11.5px}
#wrapshop .wl-btn.gold{border-color:#d4af37;background:rgba(212,175,55,.18);color:#f0d98a}
#wrapshop .wl-btn:hover{border-color:rgba(212,175,55,.7)}
#wrapshop .wl-shut{opacity:.85}
`;
  doc.head.appendChild(s);
}

export default { mountWrapShop };
