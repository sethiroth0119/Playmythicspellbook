// ============================================================================
// 📲 THE INSTALL GATE — make the installed app the way people play.
// ----------------------------------------------------------------------------
// WHY THIS EXISTS
// The game was installable long before this file (manifest.json + the window.PWA
// helpers in index.html), but the only thing advertising it was a chip in the
// top-left corner that AUTO-HID AFTER 10 SECONDS. Practically nobody installed,
// so practically everybody played in a browser tab, and the browser tab is what
// was confusing players — Safari/Chrome bars eating the viewport, the back
// gesture leaving the game, a URL bar that makes it read like a web page instead
// of a game, and (worst) the same account open in a tab AND in the installed app
// at once, which is two save states and two Colyseus connections fighting.
//
// So: in a browser we show a full-screen wall instead of the game, and the only
// way through it is to install.
//
// ⚠ THE WALL IS NOT UNCONDITIONAL, AND MUST NOT BECOME UNCONDITIONAL.
// A large slice of traffic physically CANNOT install a PWA, and walling those
// players is not a strong funnel, it is a blank screen they bounce off:
//   • Firefox desktop      — no PWA install of any kind.
//   • In-app browsers      — a link opened inside Discord, Instagram, Facebook,
//                            X, TikTok etc. runs in an embedded WebView with no
//                            install path. This is a LOT of shared-link traffic.
//   • Chrome iOS / Firefox iOS — only real Safari can Add to Home Screen.
//   • Incognito / private  — beforeinstallprompt never fires.
//   • Desktop Safari       — "Add to Dock" is a File-menu item with no API.
// detect() below routes every one of those to 'none', which plays in the browser
// exactly as before. Only browsers that can genuinely finish the job get walled.
//
// ⚠ AND IT IS NEVER A TRAP. Even on a gated browser an escape hatch appears —
// immediately once the player DECLINES the native install dialog (they answered;
// walling them again is just a dead end), and otherwise after ESCAPE_AFTER_MS.
// Tune both knobs below. Setting ESCAPE_AFTER_MS to Infinity and
// ESCAPE_ON_DECLINE to false gives a truly hard wall — at the cost of every
// player whose install silently fails for a reason we did not predict.
//
// This module owns its own DOM and styles and reads NOTHING from index.html
// except window.PWA (which is a real window property — see the globals trap in
// CLAUDE.md; Profile/App/Cloud are top-level `const` and invisible here).
// If it throws, 404s, or is blocked, the game plays in the browser as before.
// ============================================================================

const ESCAPE_AFTER_MS   = 45000;  // ms on the wall before "Continue in browser" appears
const ESCAPE_ON_DECLINE = true;   // also reveal it the moment they dismiss the install dialog
const PROMPT_WAIT_MS    = 4000;   // if a "can install" browser never fires the event, stand down

// Bumped by the appinstalled handler in index.html. Survives a browser restart,
// so a returning player who lands on the tab again gets the "open the app"
// wall rather than a pointless second install pitch.
const INSTALLED_KEY = 'hg_pwa_installed';
// Set when a player escapes the wall. Honoured for the rest of the tab's
// session only (sessionStorage) — a player who chose "continue in browser"
// should not have to re-fight the wall on every in-game reload, but they SHOULD
// see it again next time they come back.
const ESCAPED_KEY = 'hg_install_gate_escaped';

const ART = '/assets/artwork/Mythic Spellbook.png';

function ls(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function ss(key) { try { return sessionStorage.getItem(key); } catch (e) { return null; } }

// Running as the installed app already? Then this file has no business here.
function isStandalone() {
  try {
    if (window.PWA && window.PWA.installed) return true;
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
    if (window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches) return true;
    if (window.matchMedia && window.matchMedia('(display-mode: minimal-ui)').matches) return true;
    if (window.navigator.standalone === true) return true;   // iOS home-screen launch
  } catch (e) {}
  return false;
}

// → 'prompt'      one-click install is available (Chromium desktop / Android)
// → 'manual-ios'  real Safari on iOS: Add to Home Screen, no API, instructions only
// → 'none'        cannot install at all — never wall these, just let them play
function detect() {
  const ua = navigator.userAgent || '';

  // Embedded WebViews first: several of them also match the Safari/Chrome
  // patterns below, so testing them later would misclassify shared-link traffic
  // as installable and wall the single biggest group we must not wall.
  const inApp = /FBAN|FBAV|FB_IAB|FBIOS|Instagram|Line\/|Twitter|TwitterAndroid|Snapchat|Pinterest|LinkedInApp|MicroMessenger|WhatsApp|Discord|TikTok|musical_ly|GSA\//i.test(ua)
             || /;\s*wv\)/i.test(ua);           // Android WebView marker
  if (inApp) return 'none';

  // iPadOS 13+ lies and reports as a Mac; the touch-point count gives it away.
  const isIOS = (/iPad|iPhone|iPod/.test(ua) && !window.MSStream)
             || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
  if (isIOS) {
    // Every iOS browser is WebKit underneath, but only Safari proper exposes
    // Add to Home Screen. Chrome/Firefox/Edge/Opera on iOS cannot install.
    if (/CriOS|FxiOS|EdgiOS|OPiOS|Mercury/i.test(ua)) return 'none';
    return 'manual-ios';
  }

  // Firefox on the desktop has no install path whatsoever.
  if (/Firefox/i.test(ua) && !/Android/i.test(ua)) return 'none';

  // Feature detection beats UA sniffing for the happy path: if the browser
  // knows the event, it can install. Covers Chrome/Edge/Brave/Opera, desktop
  // and Android, without us maintaining a browser list.
  if ('onbeforeinstallprompt' in window) return 'prompt';

  // Desktop Safari 17+ can Add to Dock, but from the File menu with no event to
  // hook and no way for us to confirm it happened. Not worth a wall.
  return 'none';
}

function injectStyles() {
  if (document.getElementById('mythic-gate-css')) return;
  const st = document.createElement('style');
  st.id = 'mythic-gate-css';
  st.textContent = `
#mythic-install-gate{position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;
 justify-content:center;padding:24px;overflow-y:auto;
 background:radial-gradient(120% 90% at 50% 0%,#1a1430 0%,#03020a 70%);
 font-family:inherit;color:#f2ecff;-webkit-font-smoothing:antialiased;
 opacity:0;transition:opacity .35s ease}
#mythic-install-gate.is-in{opacity:1}
.mg-card{width:100%;max-width:460px;text-align:center;margin:auto}
.mg-art{width:132px;height:132px;object-fit:contain;border-radius:26px;margin:0 auto 20px;display:block;
 box-shadow:0 18px 54px rgba(0,0,0,.65),0 0 40px rgba(150,110,240,.28)}
.mg-title{font-size:1.6rem;font-weight:800;letter-spacing:.01em;margin:0 0 10px;line-height:1.2}
.mg-sub{font-size:.98rem;line-height:1.6;color:#c3b6e4;margin:0 0 22px}
.mg-perks{list-style:none;margin:0 0 24px;padding:0;text-align:left;display:inline-block}
.mg-perks li{font-size:.92rem;line-height:1.5;color:#d6cbf0;margin:0 0 9px;padding-left:26px;position:relative}
.mg-perks li::before{content:'✦';position:absolute;left:6px;top:0;color:#9d7cf0}
.mg-btn{display:block;width:100%;cursor:pointer;border:none;border-radius:13px;
 background:linear-gradient(180deg,#7a52d6,#5a34b0);color:#fff;font-family:inherit;
 font-size:1.06rem;font-weight:800;letter-spacing:.02em;padding:15px 20px;
 box-shadow:0 10px 30px rgba(122,82,214,.42);transition:transform .12s ease,box-shadow .12s ease}
.mg-btn:hover{transform:translateY(-1px);box-shadow:0 14px 36px rgba(122,82,214,.55)}
.mg-btn:active{transform:translateY(1px)}
.mg-btn[disabled]{opacity:.6;cursor:default;transform:none}
.mg-steps{counter-reset:mgstep;list-style:none;margin:0 0 22px;padding:0;text-align:left}
.mg-steps li{counter-increment:mgstep;position:relative;padding:2px 0 0 40px;margin:0 0 14px;
 font-size:.95rem;line-height:1.5;color:#ded4f4;min-height:28px}
.mg-steps li::before{content:counter(mgstep);position:absolute;left:0;top:0;width:28px;height:28px;
 border-radius:50%;background:rgba(122,82,214,.24);border:1px solid rgba(157,124,240,.5);
 color:#c9b4ff;font-weight:800;font-size:.85rem;display:flex;align-items:center;justify-content:center}
.mg-steps b{color:#fff}
.mg-escape{margin-top:22px;min-height:20px}
.mg-escape a{color:#8b7cae;font-size:.85rem;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.mg-escape a:hover{color:#c3b6e4}
.mg-note{margin-top:16px;font-size:.82rem;color:#7d719c;line-height:1.5;font-style:italic}
@media (max-width:420px){.mg-title{font-size:1.36rem}.mg-art{width:108px;height:108px}}
@media (prefers-reduced-motion:reduce){#mythic-install-gate{transition:none}.mg-btn{transition:none}}
`;
  document.head.appendChild(st);
}

let overlay = null;

function mount(html) {
  injectStyles();
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'mythic-install-gate';
    // Keyboard focus must not wander into the game sitting behind the wall.
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    document.body.appendChild(overlay);
    // setTimeout, not requestAnimationFrame: RAF does not fire in a background
    // tab, and an un-faded wall means opacity:0 over a page we just scroll-locked.
    setTimeout(() => { try { if (overlay) overlay.classList.add('is-in'); } catch (e) {} }, 16);
  }
  overlay.innerHTML = '<div class="mg-card">' + html + '</div>';
  // The game keeps running underneath (we cannot safely pause 215k lines of it
  // from out here), so stop the page behind from scrolling at least.
  try { document.documentElement.style.overflow = 'hidden'; } catch (e) {}
  return overlay;
}

function unmount() {
  try { document.documentElement.style.overflow = ''; } catch (e) {}
  if (!overlay) return;
  const el = overlay;
  overlay = null;
  try {
    el.classList.remove('is-in');
    setTimeout(() => { try { el.remove(); } catch (e) {} }, 380);
  } catch (e) { try { el.remove(); } catch (e2) {} }
}

function escapeHatch() {
  return '<div class="mg-escape" id="mg-escape"></div>';
}

// Reveals "Continue in browser". Called on decline and on the timeout — never
// wired straight into the initial markup, so the wall reads as a wall first.
function revealEscape(reason) {
  const box = document.getElementById('mg-escape');
  if (!box || box.dataset.shown === '1') return;
  box.dataset.shown = '1';
  box.innerHTML = '<a id="mg-escape-link">Continue in the browser instead</a>';
  const link = document.getElementById('mg-escape-link');
  if (!link) return;
  link.onclick = () => {
    try { sessionStorage.setItem(ESCAPED_KEY, '1'); } catch (e) {}
    try { console.info('[install-gate] escaped (' + reason + ') — playing in browser'); } catch (e) {}
    unmount();
  };
}

function armEscape(reason, ms) {
  if (!isFinite(ms)) return;
  setTimeout(() => revealEscape(reason), ms);
}

// ── The three walls ────────────────────────────────────────────────────────

function showPromptWall() {
  mount(
    '<img class="mg-art" src="' + ART + '" alt="Mythic Spellbook">' +
    '<h1 class="mg-title">Install Mythic Spellbook</h1>' +
    '<p class="mg-sub">Mythic runs as its own app. Install it once and play from your ' +
    'home screen or desktop — no browser bars, no lost tabs.</p>' +
    '<ul class="mg-perks">' +
      '<li>Its own window — the whole screen is the game</li>' +
      '<li>Opens from your home screen like any other app</li>' +
      '<li>Loads faster, and holds its place if you drop signal</li>' +
      '<li>One place to play, so your progress never splits in two</li>' +
    '</ul>' +
    '<button class="mg-btn" id="mg-install">Install Mythic</button>' +
    escapeHatch()
  );

  const btn = document.getElementById('mg-install');

  // beforeinstallprompt is asynchronous and fires only once. If it has not
  // landed by PROMPT_WAIT_MS the browser is not actually going to offer an
  // install (already installed, incognito, an engine that reports the event
  // but never fires it) — standing down beats a button that does nothing.
  let armed = !!(window.PWA && window.PWA.installEvent);
  const standDown = setTimeout(() => {
    if (armed) return;
    try { console.info('[install-gate] no install offer arrived — playing in browser'); } catch (e) {}
    unmount();
  }, PROMPT_WAIT_MS);

  try {
    if (window.PWA && typeof window.PWA.onInstallStateChange === 'function') {
      window.PWA.onInstallStateChange((s) => {
        if (s && s.available) { armed = true; clearTimeout(standDown); }
      });
    }
  } catch (e) {}

  btn.onclick = async () => {
    btn.disabled = true;
    let outcome = 'unavailable';
    try { outcome = await window.PWA.prompt(); } catch (e) { outcome = 'error'; }

    if (outcome === 'accepted') {
      // appinstalled fires right behind this and swaps in the handoff wall.
      btn.textContent = 'Installing…';
      return;
    }
    btn.disabled = false;
    if (outcome === 'dismissed') {
      // They saw the real dialog and said no. Asking again through the same
      // button is fine, but the wall must stop being a dead end.
      btn.textContent = 'Install Mythic';
      if (ESCAPE_ON_DECLINE) revealEscape('declined');
      return;
    }
    // 'unavailable' / 'error' — the prompt is gone or never existed. Nothing
    // we show here can install anything, so get out of the way entirely.
    try { console.info('[install-gate] install prompt unavailable (' + outcome + ')'); } catch (e) {}
    unmount();
  };

  armEscape('timeout', ESCAPE_AFTER_MS);
}

function showIOSWall() {
  mount(
    '<img class="mg-art" src="' + ART + '" alt="Mythic Spellbook">' +
    '<h1 class="mg-title">Add Mythic to your Home Screen</h1>' +
    '<p class="mg-sub">Three taps and Mythic becomes a real app on your iPhone or iPad — ' +
    'full screen, no Safari bars.</p>' +
    '<ol class="mg-steps">' +
      '<li>Tap the <b>Share</b> button in Safari — the square with an arrow&nbsp;↑</li>' +
      '<li>Scroll down and tap <b>Add to Home Screen</b></li>' +
      '<li>Tap <b>Add</b>, then open Mythic from your home screen</li>' +
    '</ol>' +
    '<p class="mg-note">iOS has no one-tap install — Apple only allows this through the Share menu.</p>' +
    escapeHatch()
  );
  // Nothing here can confirm the add happened (iOS fires no event), so the
  // timeout is the ONLY way off this wall. Never let it be Infinity.
  armEscape('ios-timeout', isFinite(ESCAPE_AFTER_MS) ? ESCAPE_AFTER_MS : 45000);
}

// The tab that installed it, or a tab reopened later by someone who already has
// the app. This is the wall that actually kills the two-sessions-at-once bug:
// it refuses to be a second playable surface.
function showHandoffWall(justInstalled) {
  mount(
    '<img class="mg-art" src="' + ART + '" alt="Mythic Spellbook">' +
    '<h1 class="mg-title">' + (justInstalled ? 'Mythic is installed 🎉' : 'Mythic is already installed') + '</h1>' +
    '<p class="mg-sub">Open it from your home screen, dock, or app list — look for the ' +
    'Mythic Spellbook icon. You can close this browser tab.</p>' +
    '<p class="mg-note">Playing in the app and in a browser tab at the same time means two ' +
    'sessions on one account, which is how progress goes missing. Use the app.</p>' +
    escapeHatch()
  );
  // Someone who uninstalled still needs a way back in.
  armEscape('handoff', ESCAPE_AFTER_MS);
}

// ── Boot ───────────────────────────────────────────────────────────────────

function boot() {
  if (isStandalone()) {
    try { localStorage.setItem(INSTALLED_KEY, '1'); } catch (e) {}
    return;                                   // this IS the app — nothing to sell
  }
  if (ss(ESCAPED_KEY) === '1') return;        // they chose the browser this session

  const tier = detect();
  try { console.info('[install-gate] browser tier: ' + tier); } catch (e) {}
  if (tier === 'none') return;                // cannot install — never wall them

  if (ls(INSTALLED_KEY) === '1') { showHandoffWall(false); return; }
  if (tier === 'manual-ios') { showIOSWall(); return; }
  showPromptWall();
}

// Chrome can convert a running tab into the installed app, and fires the
// display-mode change rather than a navigation. Drop the wall when that happens.
try {
  const mq = window.matchMedia && window.matchMedia('(display-mode: standalone)');
  if (mq && mq.addEventListener) {
    mq.addEventListener('change', (e) => { if (e.matches) unmount(); });
  }
} catch (e) {}

// index.html's own appinstalled listener sets window.PWA.installed and the
// localStorage flag; ours swaps the wall over to the handoff.
try {
  window.addEventListener('appinstalled', () => {
    try { localStorage.setItem(INSTALLED_KEY, '1'); } catch (e) {}
    if (!isStandalone()) showHandoffWall(true);
  });
} catch (e) {}

// A wall that throws must never be a black screen over a working game.
try { boot(); }
catch (err) {
  try { console.warn('[install-gate] failed, playing in browser:', err); } catch (e) {}
  try { unmount(); } catch (e) {}
}

// Escape hatch for support: __mg.gateOff() in the console clears the wall and
// the session flag for a player we are debugging with.
try {
  window.__mg = window.__mg || {};
  window.__mg.gateOff = function () {
    try { sessionStorage.setItem(ESCAPED_KEY, '1'); } catch (e) {}
    unmount();
    return 'install gate off for this tab';
  };
  window.__mg.gateTier = detect;
} catch (e) {}
