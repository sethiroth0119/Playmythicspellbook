/* screens.js — 🗂 Screens: every page of the game in one place, and the
   STRINGS table — every player-facing text on a screen, editable in a list.

   The legacy game has no string table: its text is written straight into
   the DOM by index.html. So the table is built by SCANNING the screen that
   is on stage (buttons, links, headings, labels, tabs — elements with their
   own text), and an edit becomes a page rule (the ✎ Edit UI mechanism,
   widgets.format.js → normalizePage) keyed by the element's selector and
   scoped to the screen. Nothing in the game's code changes; a rule is
   applied by the runtime to every player once the page doc is live, and
   deleting the rule restores the original. Other screens are not on stage,
   so for them the table shows the rules already saved and a Go-there
   button; navigation is the bridge's own (MythicBridge.ui.actions.navigate).

   Also here: the Rules list of a screen, the Widgets & themes list with
   their targets, find-and-replace across the visible strings, and a
   text-only JSON export / import of every page document (backup, or
   moving a redesign between accounts). Admin-only, like the live editor. */

import { normalize, clone, selectorFor, uid } from './widgets.format.js';
import { setPageDraft, currentScreen, elementText, liveDocs, reload as reloadLive } from './widgets.runtime.js';
import { loadPageDocFor, openLiveEditor, closeLiveEditor } from './live-editor.js';
import { openDesigner } from './widgets.editor.js';
import * as api from './widgets.api.js';

/* The game's screens (App.screen values) with labels. The bridge may add more
   via ui.screens(); saved page docs and the current screen are merged in. */
export const SCREEN_CATALOG = [
  ['title', 'Main hub'], ['camp', 'The Camp'], ['campView', 'Camp view'], ['cardShop', 'Card Shop'], ['battle', 'Battle Hall'], ['vsScreen', 'Versus'], ['deckSelect', 'Deck select'], ['deck', 'Deck'], ['collection', 'Collection'], ['heroLoadout', 'Hero loadout'],
  ['forge', 'Forge Sanctum'], ['crafting', 'Crafting'], ['lab', 'Lab'], ['market', 'Ruin Exchange'], ['vendorMarket', 'Vendor Market'], ['vendor', 'Vendor'], ['justBusiness', 'Just Business'], ['crashExchange', 'Crash / Exchange'], ['wagerHall', 'Wager Hall'], ['cinderShop', 'Cinder Shop'], ['dojoShop', 'Tutor Shop'], ['tutor', 'Tutor'],
  ['bankDesk', 'Bank of Ethos'], ['bankOffice', 'Bank office'], ['bankCharter', 'Bank charter'], ['princePortfolios', 'Portfolios'], ['baseVault', 'Vault'], ['vehicleMarket', 'Vehicle market'], ['fuelCommand', 'Fuel command'], ['gasStationsDirectory', 'Gas stations'],
  ['rlcList', 'City Nodes'], ['rlcMap', 'Territory map'], ['rlcEvent', 'Node event'], ['rlcResult', 'Node result'], ['rlcReward', 'Node reward'], ['territoryWars', 'Territory Wars'], ['twWarMap', 'War map'], ['gymWars', 'Gym Wars'], ['coliseum', 'Coliseum'], ['campaign', 'Campaign'], ['campaignChapter', 'Campaign chapter'], ['blackRiver', 'Black River'], ['woodsFishing', 'Woods fishing'], ['farm', 'Homestead Farm'],
  ['bookOfKnowledge', 'The Codex'], ['bestiary', 'Bestiary'], ['replays', 'Replays'], ['seasonPass', 'Season pass'], ['daily', 'Daily'], ['profile', 'Profile'], ['playerProfile', 'Player profile'], ['settings', 'Arcanum / settings'], ['packOpening', 'Pack opening'], ['starterPick', 'Starter pick'], ['onboarding', 'Onboarding'], ['authGate', 'Sign in'],
];
export function screenList() {
  const out = new Map(SCREEN_CATALOG.map(([id, label]) => [id, { id, label }]));
  try { const b = window.MythicBridge; const extra = b && b.ui && typeof b.ui.screens === 'function' ? b.ui.screens() : null; (extra || []).forEach(s => { if (s && s.id && !out.has(s.id)) out.set(s.id, { id: String(s.id), label: String(s.label || s.id) }); }); } catch (e) {}
  const cur = currentScreen(); if (cur && !out.has(cur)) out.set(cur, { id: cur, label: cur });
  return Array.from(out.values());
}

/* Scan the on-stage screen for player-facing strings: elements with their
   own (direct) text, skipping our own panels, hidden things and huge blobs.
   One row per selector; `n` = how many elements the selector matches. */
export const SCAN_SELECTOR = 'button, a, h1, h2, h3, h4, h5, h6, label, summary, option, th, td, li, p, span, div, small, b, strong, em, i, legend';
export function scanStrings(root) {
  root = root || document.body;
  const rows = []; const seen = new Set();
  const els = Array.from(root.querySelectorAll(SCAN_SELECTOR));
  for (const el of els) {
    if (el.closest('#aw-live, #aw-screens, #aw-root, #mf-root, #aw-picklayer, script, style, template')) continue;
    const text = elementText(el); if (!text || text.length > 160) continue;
    if (!/[A-Za-z0-9]/.test(text)) continue;                                     // icons alone
    const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect(); if (!r.width && !r.height) continue;
    const sel = selectorFor(el); if (seen.has(sel)) continue; seen.add(sel);
    let n = 1; try { n = document.querySelectorAll(sel).length; } catch (e) {}
    rows.push({ sel, text, tag: el.tagName.toLowerCase(), n, el });
    if (rows.length >= 400) break;
  }
  return rows;
}

let SC = null;
export function isScreensOpen() { return !!SC; }
export function closeScreens() { if (SC) SC.close(); }
export async function openScreens(opts) {
  opts = opts || {};
  if (SC) return SC;
  if (!api.isAdmin() && !opts.force) { bridgeToast('The Screens view is admin-only.'); return null; }
  ensureCss();
  const root = document.createElement('div'); root.id = 'aw-screens'; document.body.appendChild(root);
  const $ = (q) => root.querySelector(q);
  const S = { screen: opts.screen || currentScreen() || 'title', tab: opts.tab || 'strings', q: '', docs: new Map(), source: new Map(), dirty: new Set(), rows: [], widgets: [] };
  const toast = (m, ms) => { const t = $('.aw-stoast'); if (!t) return; t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms || 2600); };
  const confirmDlg = async (m) => { try { const b = window.MythicBridge; if (b && b.confirm) return !!(await b.confirm(m)); } catch (e) {} return window.confirm(m); };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  async function docFor(screen) { if (!S.docs.has(screen)) { const got = await loadPageDocFor(screen); S.docs.set(screen, got.doc); S.source.set(screen, got.source); } return S.docs.get(screen); }
  function ruleFor(doc, sel, create, label) { let r = doc.page.rules.find(x => x.sel === sel); if (!r && create) { r = { id: uid('r_'), sel, label: (label || sel).slice(0, 80) }; doc.page.rules.push(r); } return r; }
  function applyDraft(screen) { const d = S.docs.get(screen); if (screen === currentScreen() && d) setPageDraft(normalize(d)); }
  function markDirty(screen) { S.dirty.add(screen); renderHead(); }

  root.innerHTML = `<div class="aw-swin">
    <div class="aw-shead"><span class="brand">🗂 SCREENS</span><span class="sub" id="aw-s-sub"></span><span class="state" id="aw-s-state"></span>
      <button id="aw-s-export" title="Download every page document as JSON (text only)">⇩ Export</button><button id="aw-s-import" title="Load page documents from a JSON file">⇧ Import</button><input type="file" id="aw-s-file" accept="application/json" hidden>
      <button id="aw-s-save" class="primary">💾 Save</button><button id="aw-s-live" title="Publish this screen's rules to every player (admin)">★ Live</button><button id="aw-s-close" title="Close">✕</button></div>
    <div class="aw-sbody"><div class="aw-slist" id="aw-s-list"></div><div class="aw-smain">
      <div class="aw-stabs"><button data-tab="strings">🔤 Strings</button><button data-tab="rules">📏 Rules</button><button data-tab="widgets">🧩 Widgets</button><span class="sp"></span><button id="aw-s-here" title="Go to this screen in the game">➜ Go there</button><button id="aw-s-edit" title="Open ✎ Edit UI on this screen">✎ Edit UI</button></div>
      <div class="aw-scontent" id="aw-s-content"></div></div></div>
    <div class="aw-stoast"></div></div>`;
  $('#aw-s-close').onclick = () => close(false);
  $('#aw-s-save').onclick = saveAll; $('#aw-s-live').onclick = setLive;
  $('#aw-s-export').onclick = exportAll; $('#aw-s-import').onclick = () => $('#aw-s-file').click();
  $('#aw-s-file').onchange = (e) => { const f = e.target.files && e.target.files[0]; if (f) importFile(f); e.target.value = ''; };
  root.querySelectorAll('.aw-stabs [data-tab]').forEach(b => b.onclick = () => { S.tab = b.dataset.tab; renderMain(); });
  $('#aw-s-here').onclick = () => goTo(S.screen);
  $('#aw-s-edit').onclick = async () => { await goTo(S.screen); await close(true); openLiveEditor({ screen: S.screen }); };
  async function goTo(screen) {
    try { const b = window.MythicBridge; if (b && b.ui && b.ui.actions && b.ui.actions.navigate) b.ui.actions.navigate(screen); } catch (e) {}
    await new Promise(r => setTimeout(r, 250));
    renderAll();
  }
  function renderHead() {
    const cur = currentScreen(); const item = screenList().find(s => s.id === S.screen) || { label: S.screen };
    $('#aw-s-sub').textContent = item.label + ' · ' + S.screen + (cur === S.screen ? ' · on stage' : ' · not on stage (go there to scan its text)');
    const d = S.docs.get(S.screen); const src = S.source.get(S.screen);
    $('#aw-s-state').textContent = S.dirty.size ? '● ' + S.dirty.size + ' unsaved' : (d ? (src === 'cloud' ? '☁ saved' : src === 'local' ? '💾 device' : 'new') : '');
  }
  function renderList() {
    const cur = currentScreen(); const lv = liveDocs().filter(d => d.kind === 'page');
    const rulesOf = (id) => { const d = S.docs.get(id); if (d) return d.page.rules.length; const l = lv.find(x => x.page.screen === id); return l ? l.page.rules.length : 0; };
    $('#aw-s-list').innerHTML = '<input type="text" id="aw-s-filter" placeholder="Filter screens…">' + screenList().map(s => `<div class="aw-srow ${s.id === S.screen ? 'cur' : ''}" data-screen="${esc(s.id)}"><span class="lb">${esc(s.label)}</span><span class="id">${esc(s.id)}</span>${s.id === cur ? '<span class="tag on">on stage</span>' : ''}${rulesOf(s.id) ? '<span class="tag">' + rulesOf(s.id) + ' rules</span>' : ''}${lv.find(x => x.page.screen === s.id) ? '<span class="tag live">LIVE</span>' : ''}</div>`).join('');
    $('#aw-s-filter').oninput = (e) => { const q = e.target.value.toLowerCase(); root.querySelectorAll('.aw-srow').forEach(r => { r.style.display = r.textContent.toLowerCase().includes(q) ? '' : 'none'; }); };
    root.querySelectorAll('.aw-srow').forEach(r => r.onclick = () => { S.screen = r.dataset.screen; S.q = ''; renderAll(); });
  }
  async function renderMain() {
    root.querySelectorAll('.aw-stabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
    const box = $('#aw-s-content'); const doc = await docFor(S.screen); const onStage = currentScreen() === S.screen;
    if (S.tab === 'strings') {
      S.rows = onStage ? scanStrings() : [];
      const overr = (sel) => { const r = ruleFor(doc, sel, false); return r && typeof r.text === 'string' ? r.text : null; };
      // rules with text for elements not on stage right now still deserve a row
      const extra = doc.page.rules.filter(r => typeof r.text === 'string' && !S.rows.find(x => x.sel === r.sel)).map(r => ({ sel: r.sel, text: r.text, tag: '·', n: 0, saved: true }));
      const all = S.rows.concat(extra).filter(r => !S.q || (r.text + ' ' + (overr(r.sel) || '') + ' ' + r.sel).toLowerCase().includes(S.q.toLowerCase()));
      box.innerHTML = `<div class="aw-sbar"><input type="text" id="aw-s-q" placeholder="Search strings…" value="${esc(S.q)}"><span class="n">${all.length} strings</span><input type="text" id="aw-s-find" placeholder="find"><input type="text" id="aw-s-repl" placeholder="replace with"><button id="aw-s-doreplace">Replace in all</button></div>
        ${onStage ? '' : '<div class="aw-sempty">This screen is not on stage, so its text cannot be scanned. <b>➜ Go there</b> first — the rules already saved for it are listed below.</div>'}
        <table class="aw-stable"><thead><tr><th>Element</th><th>Original</th><th>Shown as</th><th></th></tr></thead><tbody>${all.map((r, i) => { const o = overr(r.sel); return `<tr data-i="${i}" class="${o != null ? 'ov' : ''}"><td class="el"><span class="tag">${esc(r.tag)}</span>${r.n > 1 ? '<span class="tag warn">×' + r.n + '</span>' : ''}<code title="${esc(r.sel)}">${esc(r.sel)}</code></td><td class="orig">${esc(r.saved ? '(not on stage)' : r.text)}</td><td><input type="text" data-sel="${esc(r.sel)}" value="${esc(o != null ? o : r.text)}"></td><td>${o != null ? '<button class="x" data-reset="' + esc(r.sel) + '" title="Back to the original">↺</button>' : ''}</td></tr>`; }).join('') || '<tr><td colspan="4" class="aw-sempty">Nothing to show.</td></tr>'}</tbody></table>
        <p class="aw-shint">Edit a cell and press Enter or Tab. Icons and sub-labels inside an element are kept; only its own text changes. ×N marks a selector that matches several elements (they all change). Save, then ★ Live for every player.</p>`;
      $('#aw-s-q').oninput = (e) => { S.q = e.target.value; renderMain().then(() => { const q = $('#aw-s-q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }); };
      box.querySelectorAll('input[data-sel]').forEach(inp => inp.onchange = () => { const sel = inp.dataset.sel; const row = all.find(r => r.sel === sel); const v = inp.value; const r = ruleFor(doc, sel, true, row && row.text); if (row && !row.saved && v === row.text) { delete r.text; if (!r.hide && !r.style && !r.attrs) doc.page.rules = doc.page.rules.filter(x => x !== r); } else r.text = v; markDirty(S.screen); applyDraft(S.screen); renderMain(); });
      box.querySelectorAll('[data-reset]').forEach(b => b.onclick = () => { const r = ruleFor(doc, b.dataset.reset, false); if (r) { delete r.text; if (!r.hide && !r.style && !r.attrs) doc.page.rules = doc.page.rules.filter(x => x !== r); } markDirty(S.screen); applyDraft(S.screen); renderMain(); });
      $('#aw-s-doreplace').onclick = () => { const f = $('#aw-s-find').value, rp = $('#aw-s-repl').value; if (!f) return; let n = 0; all.forEach(r => { const cur = overr(r.sel) != null ? overr(r.sel) : r.text; if (!cur.includes(f)) return; const rule = ruleFor(doc, r.sel, true, r.text); rule.text = cur.split(f).join(rp); n++; }); if (n) { markDirty(S.screen); applyDraft(S.screen); renderMain(); } toast(n + ' string' + (n === 1 ? '' : 's') + ' changed.'); };
    } else if (S.tab === 'rules') {
      const rules = doc.page.rules;
      box.innerHTML = `<div class="aw-sbar"><span class="n">${rules.length} rules on ${esc(S.screen)}</span>${rules.length ? '<button id="aw-s-clear" class="danger">Reset page</button>' : ''}</div>
        <table class="aw-stable"><thead><tr><th>Element</th><th>Text</th><th>Style</th><th>Hidden</th><th></th></tr></thead><tbody>${rules.map(r => `<tr><td class="el"><code title="${esc(r.sel)}">${esc(r.label || r.sel)}</code><small>${esc(r.sel)}</small></td><td>${typeof r.text === 'string' ? esc(r.text) : '<i>—</i>'}</td><td><small>${r.style ? esc(Object.keys(r.style).map(k => k + ': ' + r.style[k]).join('; ')) : '—'}</small></td><td>${r.hide ? '✔' : ''}</td><td><button class="x" data-del="${esc(r.id)}" title="Delete rule">✕</button></td></tr>`).join('') || '<tr><td colspan="5" class="aw-sempty">No rules yet — use the Strings tab or ✎ Edit UI.</td></tr>'}</tbody></table>`;
      box.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { doc.page.rules = doc.page.rules.filter(r => r.id !== b.dataset.del); markDirty(S.screen); applyDraft(S.screen); renderMain(); renderList(); });
      const cl = $('#aw-s-clear'); if (cl) cl.onclick = async () => { if (await confirmDlg('Remove every rule on ' + S.screen + '?')) { doc.page.rules = []; markDirty(S.screen); applyDraft(S.screen); renderMain(); renderList(); } };
    } else {
      const all = await api.listAll(); S.widgets = all.rows.filter(r => r.kind !== 'page');
      const here = (r) => (r.target && r.target.mode === 'slot' && r.target.slot && r.target.slot.split('.')[0] === S.screen) || (r.target && r.target.mode === 'selector');
      box.innerHTML = `<div class="aw-sbar"><span class="n">${S.widgets.length} widgets & themes</span><button id="aw-s-newwidget">＋ New widget</button></div>
        <table class="aw-stable"><thead><tr><th></th><th>Name</th><th>Target</th><th>Where</th><th></th></tr></thead><tbody>${S.widgets.map(r => `<tr class="${here(r) ? 'ov' : ''}"><td>${r.kind === 'theme' ? '🎨' : '🧩'}</td><td>${esc(r.name)}${r.live ? ' <span class="tag live">LIVE</span>' : ''}</td><td><small>${r.kind === 'theme' ? 'whole game' : r.target && r.target.mode !== 'none' ? esc(r.target.mode + ': ' + (r.target.slot || r.target.selector || '')) : 'no target'}</small></td><td><small>${esc(r.source)}${!r.mine ? ' · by ' + esc(r.owner_name || '?') : ''}</small></td><td><button data-open="${esc(r.id)}" data-src="${esc(r.source)}">Open</button></td></tr>`).join('') || '<tr><td colspan="5" class="aw-sempty">No widgets saved yet.</td></tr>'}</tbody></table>
        <p class="aw-shint">Highlighted rows target this screen (a slot named after it, or any selector). Open goes to the Widget Designer.</p>`;
      box.querySelectorAll('[data-open]').forEach(b => b.onclick = async () => { await close(true); openDesigner({ id: b.dataset.open, source: b.dataset.src }); });
      $('#aw-s-newwidget').onclick = async () => { await close(true); openDesigner({ kind: 'widget' }); };
    }
    renderHead();
  }
  async function renderAll() { renderList(); await renderMain(); }
  async function saveAll() {
    const ids = Array.from(S.dirty); if (!ids.length) { toast('Nothing to save.'); return true; }
    let ok = true;
    for (const screen of ids) {
      const doc = normalize(S.docs.get(screen)); doc.target = { mode: 'none', slot: 'page:' + screen, selector: '', place: 'append' }; S.docs.set(screen, doc);
      const src = S.source.get(screen) || (api.userId() ? 'cloud' : 'local');
      const r = await api.save(doc, src);
      if (!r.ok) { ok = false; toast('Save failed for ' + screen + ': ' + (r.error || 'unknown')); continue; }
      S.source.set(screen, r.source || src); S.dirty.delete(screen);
    }
    renderHead(); renderList(); if (ok) toast('Saved.');
    return ok;
  }
  async function setLive() {
    if (S.dirty.size) { const ok = await saveAll(); if (!ok) return; }
    const doc = S.docs.get(S.screen); const src = S.source.get(S.screen); if (!doc || !src) { toast('Nothing saved for this screen yet.'); return; }
    const r = await api.setLive(doc.id, src, true);
    if (!r.ok) { toast('Could not set live: ' + (r.error || 'unknown')); return; }
    toast('★ Live — every player on “' + S.screen + '” now sees these strings.', 3600);
    try { window.dispatchEvent(new CustomEvent('athena-ui:changed')); } catch (e) {}
    await reloadLive(); renderList();
  }
  function exportAll() {
    const docs = Array.from(S.docs.values()).map(normalize);
    liveDocs().filter(d => d.kind === 'page' && !docs.find(x => x.id === d.id)).forEach(d => docs.push(clone(d)));
    const blob = new Blob([JSON.stringify({ v: 1, kind: 'athena-pages', pages: docs }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'athena-pages.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Exported ' + docs.length + ' page document' + (docs.length === 1 ? '' : 's') + '.');
  }
  function importFile(file) {
    const rd = new FileReader();
    rd.onload = () => { try { const n = importJson(JSON.parse(String(rd.result))); toast('Imported ' + n + ' page document' + (n === 1 ? '' : 's') + ' — Save to keep them.'); renderAll(); } catch (e) { toast('Not a pages export.'); } };
    rd.readAsText(file);
  }
  function importJson(j) {
    const list = Array.isArray(j) ? j : (j && Array.isArray(j.pages) ? j.pages : []);
    let n = 0;
    list.forEach(raw => { const d = normalize(raw); if (d.kind !== 'page' || !d.page.screen) return; const cur = S.docs.get(d.page.screen); if (cur) { d.id = cur.id; } S.docs.set(d.page.screen, d); if (!S.source.has(d.page.screen)) S.source.set(d.page.screen, null); S.dirty.add(d.page.screen); applyDraft(d.page.screen); n++; });
    return n;
  }
  async function close(force) {
    if (!SC) return;
    if (!force && S.dirty.size && !(await confirmDlg('You have unsaved string changes. Close anyway?'))) return;
    root.remove(); setPageDraft(null); SC = null;
  }
  SC = { root, S, close, refresh: renderAll, save: saveAll, setLive, importJson, exportAll, scan: () => scanStrings(), docFor, go: goTo, setScreen: (id) => { S.screen = id; return renderAll(); }, setTab: (t) => { S.tab = t; return renderMain(); } };
  await renderAll();
  return SC;
}
function bridgeToast(m) { try { const b = window.MythicBridge; if (b && b.toast) return b.toast(m); } catch (e) {} try { console.warn('[widgets] ' + m); } catch (e) {} }
function ensureCss() { if (document.getElementById('aw-css')) return; const l = document.createElement('link'); l.id = 'aw-css'; l.rel = 'stylesheet'; l.href = new URL('./widgets.css', import.meta.url).href; document.head.appendChild(l); }
