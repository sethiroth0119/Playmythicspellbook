/* 🔎 FIND-THE-EFFECT — the driver. Opens the REAL editor for a unit, a spell and
   a trap card, and measures the four bars:
     1. every rendered <optgroup> holds <= 12 options;
     2. typing "discard" leaves ONLY options whose label matches, and clearing
        restores every option — with the select's VALUE unchanged throughout;
     3. picking an effect renders its meaning in the DOM, no modal, and the text
        EQUALS _onplayTypeDesc(id) — the registry string, not an eyeball;
     4. the nine classic spell effects (and the seven trap ones) are still there
        and still AHEAD of the first <optgroup>.
   Screenshots the open list for each of the three selects.
   Run: node .gauntlet/_fxfind-drive.mjs */
import { bootPage, openCardEditor, REPO } from './_forge-harness.mjs';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };

const { page, close, errors } = await bootPage({ assetsFrom: REPO });

async function editorFor(type) {
  await openCardEditor(page, 'NEW', { paintSettleMs: 900 });
  if (type !== 'unit') {
    await page.evaluate((t) => { const d = App._newCardDraft; if (d) d.type = t; App.editingCardId = 'NEW'; renderForge(); }, type);
    await page.waitForTimeout(250);
  }
}

const report = {};
for (const type of ['unit', 'spell', 'trap']) {
  console.log('\n=== ' + type.toUpperCase() + ' EDITOR ===');
  await editorFor(type);

  const primary = { unit: 'ed-onplay-type', spell: 'ed-spell-effect', trap: 'ed-trap-effect' }[type];

  const shape = await page.evaluate((pid) => {
    const ed = document.querySelector('.card-editor');
    const ids = new Set(ONPLAY_TYPES.map(t => t.id));
    const sels = Array.from(ed.querySelectorAll('select')).filter(s => {
      let n = 0; for (const o of s.options) if (ids.has(o.value)) n++; return n >= 40;
    });
    const groups = [];
    sels.forEach(s => s.querySelectorAll('optgroup').forEach(g => groups.push([g.label, g.children.length])));
    const p = document.getElementById(pid);
    const pGroups = p ? Array.from(p.querySelectorAll('optgroup')).map(g => [g.label, g.children.length]) : [];
    // options before the first optgroup — the hand-written classics
    const lead = [];
    if (p) for (const c of p.children) { if (c.tagName === 'OPTGROUP') break; lead.push(c.value); }
    return {
      selects: sels.length,
      wired: sels.filter(s => s.dataset.fxFind === '1').length,
      bars: ed.querySelectorAll('.fx-find').length,
      descs: ed.querySelectorAll('.fx-find-desc').length,
      idsOnInjected: ed.querySelectorAll('.fx-find-in[id], .fx-find-desc[id]').length,
      injectedAreFields: ed.querySelectorAll('.fx-find.editor-field, .fx-find-desc.editor-field').length,
      editorFields: document.querySelectorAll('.editor-field').length,
      maxGroup: groups.length ? Math.max(...groups.map(g => g[1])) : 0,
      groupCount: groups.length,
      pGroups, lead,
      pOptions: p ? p.options.length : 0,
    };
  }, primary);
  report[type] = shape;
  console.log('  selects=' + shape.selects + ' wired=' + shape.wired + ' filter-bars=' + shape.bars
    + ' desc-lines=' + shape.descs + ' .editor-field=' + shape.editorFields);
  console.log('  ' + primary + ': ' + shape.pOptions + ' options in ' + shape.pGroups.length + ' optgroups');
  shape.pGroups.forEach(g => console.log('      ' + String(g[1]).padStart(3) + '  ' + g[0]));

  ok(shape.selects > 0 && shape.wired === shape.selects, 'every effect picker is wired', shape.wired + '/' + shape.selects);
  ok(shape.bars === shape.selects && shape.descs === shape.selects, 'one filter box and one explanation per picker', shape.bars + '/' + shape.descs);
  ok(shape.idsOnInjected === 0, 'no injected node carries an id (the gate walks [id])', String(shape.idsOnInjected));
  ok(shape.injectedAreFields === 0, 'no injected node is an .editor-field (the empty-section sweep counts those)', String(shape.injectedAreFields));
  ok(shape.maxGroup <= 12, 'no rendered optgroup holds more than 12 options — across all ' + shape.groupCount + ' of them', 'max=' + shape.maxGroup);

  if (type === 'spell' || type === 'trap') {
    const want = type === 'spell'
      ? ['damage', 'heal', 'buffAll', 'draw', 'restoreEnergy', 'restoreKalon', 'kalonLock', 'summon', 'purgeAscended']
      : ['damage', 'stun', 'draw', 'bounce', 'destroyUnit', 'paintSurface', 'summonGrave'];
    ok(shape.lead.join() === want.join(), 'the ' + want.length + ' classics are still listed and still AHEAD of the groups', shape.lead.join());
  }

  /* ── the filter ─────────────────────────────────────────────────────── */
  const filt = await page.evaluate(async (pid) => {
    const sel = document.getElementById(pid);
    const box = sel.previousElementSibling.querySelector('.fx-find-in');
    const fire = (v) => { box.value = v; box.dispatchEvent(new Event('input', { bubbles: true })); };
    const visible = () => Array.from(sel.options).filter(o => !o.hidden && o.value).map(o => o.value);
    const texts = () => Array.from(sel.options).filter(o => !o.hidden && o.value).map(o => o.text);
    const allValued = Array.from(sel.options).filter(o => o.value).length;
    const domBefore = sel.options.length;
    const valueBefore = sel.value;
    fire('discard');
    const afterIds = visible(), afterTexts = texts();
    const valueDuring = sel.value;
    const groupsLeft = Array.from(sel.querySelectorAll('optgroup')).filter(g => !g.hidden).length;
    const groupsEmptyShown = Array.from(sel.querySelectorAll('optgroup'))
      .filter(g => !g.hidden && !Array.from(g.children).some(o => !o.hidden)).length;
    /* a heading whose "(n)" does not count what is under it is a wrong number
       on screen — the whole reason this file exists is that those get caught */
    const headingCountsWrong = Array.from(sel.querySelectorAll('optgroup'))
      .filter(g => !g.hidden)
      .filter(g => {
        const m = /\((\d+)\)\s*$/.exec(g.label);
        const live = Array.from(g.children).filter(o => !o.hidden).length;
        return !m || Number(m[1]) !== live;
      }).map(g => g.label);
    const labelsRestore = [];
    const nText = sel._fxFindN ? sel._fxFindN.textContent : '';
    // the whole point of hiding rather than removing: the option count must not
    // move, because an option that leaves the DOM takes its value with it
    const stillInDom = sel.options.length;
    const domUnchanged = stillInDom === domBefore;
    fire('');
    const restored = visible().length;
    const valueAfter = sel.value;
    Array.from(sel.querySelectorAll('optgroup')).forEach(g => {
      const m = /\((\d+)\)\s*$/.exec(g.label);
      const live = Array.from(g.children).filter(o => !o.hidden).length;
      if (!m || Number(m[1]) !== live) labelsRestore.push(g.label + ' over ' + live);
    });
    return {
      allValued, afterIds, afterTexts, valueBefore, valueDuring, valueAfter,
      groupsLeft, groupsEmptyShown, nText, stillInDom, domBefore, domUnchanged, restored,
      headingCountsWrong, labelsRestore,
      nonMatching: afterTexts.filter(t => t.toLowerCase().indexOf('discard') < 0),
    };
  }, primary);

  console.log('  filter "discard": ' + filt.afterIds.length + ' of ' + filt.allValued
    + ' left  [' + filt.afterIds.join(', ') + ']  counter="' + filt.nText + '"');
  ok(filt.afterIds.length > 0 && filt.nonMatching.length === 0,
    'only options whose label matches "discard" survive the filter', filt.nonMatching.join(' | '));
  ok(filt.afterIds.length < filt.allValued, 'the filter actually narrows (' + filt.afterIds.length + ' < ' + filt.allValued + ')');
  ok(filt.groupsEmptyShown === 0, 'no heading is left standing over an empty group', String(filt.groupsEmptyShown));
  ok(filt.domUnchanged, 'options are HIDDEN, never removed — ' + filt.domBefore + ' in the DOM before, '
    + filt.stillInDom + ' after, while only ' + filt.afterIds.length + ' showed');
  ok(filt.headingCountsWrong.length === 0,
    'every surviving heading counts what is actually under it while filtered',
    filt.headingCountsWrong.join(' | '));
  ok(filt.restored === filt.allValued, 'clearing restores all ' + filt.allValued + ' options', String(filt.restored));
  ok(filt.labelsRestore.length === 0, 'and every heading count goes back to its full number',
    filt.labelsRestore.join(' | '));
  ok(filt.valueBefore === filt.valueDuring && filt.valueDuring === filt.valueAfter,
    'the select value never moves while filtering', filt.valueBefore + ' / ' + filt.valueDuring + ' / ' + filt.valueAfter);

  /* ── the inline explanation, against the registry ────────────────────── */
  const desc = await page.evaluate((pid) => {
    const sel = document.getElementById(pid);
    const box = sel.nextElementSibling;
    const out = { tag: box && box.className, rows: [], modals: 0 };
    const modalsBefore = document.querySelectorAll('.modal, .modal-overlay, [class*="modal"]').length;
    const ids = Array.from(sel.options).map(o => o.value).filter(Boolean);
    const pick = ids.filter(id => ONPLAY_TYPES.some(t => t.id === id)).slice(0, 6);
    for (const id of pick) {
      sel.value = id;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      out.rows.push({ id: id, dom: box.textContent, want: _onplayTypeDesc(id), shown: box.style.display !== 'none' });
    }
    out.modals = document.querySelectorAll('.modal, .modal-overlay, [class*="modal"]').length - modalsBefore;
    sel.value = ids[0];
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return out;
  }, primary);

  desc.rows.forEach(r => console.log('    ' + (r.dom === r.want && r.shown ? '✓' : '✗') + ' ' + r.id + ' → "' + r.dom + '"'));
  ok(desc.rows.length >= 5 && desc.rows.every(r => r.dom === r.want && r.want && r.shown),
    'the rendered explanation EQUALS the registry description for all ' + desc.rows.length + ' sampled effects');
  ok(desc.modals === 0, 'and it opens no modal', String(desc.modals));

  /* ── the screenshot: the open list, with the filter live ─────────────
     ⚠ A NEW EDITOR RENDERS EVERY <details> SHUT (harness note on _fxOpen), so a
       plain page.screenshot() here photographs four collapsed section headers —
       which is exactly the confident-wrong-picture failure the harness exists
       for. Every ancestor <details> is forced open first.
     ⚠ AND a <select> popup is drawn by the OS, not the page: it can never appear
       in a screenshot. The list is photographed as a size=N listbox instead —
       the same options, the same optgroup headings, the same order, painted by
       the page so the camera can see them. */
  const box = await page.evaluate((pid) => {
    const sel = document.getElementById(pid);
    for (let el = sel.parentElement; el; el = el.parentElement) {
      if (el.tagName === 'DETAILS') el.open = true;
      if (el.style && el.style.display === 'none') el.style.display = '';
    }
    sel.size = 20;
    sel.style.minHeight = '560px';
    /* …and WIDEN IT FOR THE CAMERA. Chrome's real dropdown popup sizes itself to
       the longest option; a size=N listbox is stuck at the control's width, so
       without this the photograph shows every label truncated and looks like a
       bug this piece introduced. Nothing about the option list changes. */
    sel.style.width = '860px'; sel.style.maxWidth = 'none';
    sel.previousElementSibling.style.width = '860px';
    sel.scrollIntoView({ block: 'center' });
    /* ⚠ THE EXPLANATION LINE HIDES ITSELF when the picked effect has nothing to
       add (the classic "⚡ Restore Energy" case), and a display:none node
       measures 0×0 — clipping to it produced a negative height and Playwright
       refused the screenshot. The clip is the UNION of whatever is actually on
       screen instead. */
    return window.__fxUnion(sel);
  }, primary);
  await page.waitForTimeout(400);
  const shot = '.gauntlet/_fxfind-' + type + '.png';
  await page.screenshot({ path: shot, clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
  console.log('  📸 ' + shot + '  (' + Math.round(box.w) + '×' + Math.round(box.h) + ')');
  // …and the same picker with "discard" typed in, so the filter is photographed
  // doing its job rather than described as doing it.
  await page.evaluate((pid) => {
    const sel = document.getElementById(pid);
    const inp = sel.previousElementSibling.querySelector('.fx-find-in');
    inp.value = 'discard';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    sel.size = 8; sel.style.minHeight = '';
  }, primary);
  await page.waitForTimeout(300);
  const box2 = await page.evaluate((pid) => {
    const sel = document.getElementById(pid);
    const a = sel.previousElementSibling.getBoundingClientRect();
    const b = sel.nextElementSibling.getBoundingClientRect();
    return { x: Math.max(0, a.left - 14), y: Math.max(0, a.top - 34),
             w: Math.max(a.width, b.width) + 28, h: (b.bottom - a.top) + 48 };
  }, primary);
  const shot2 = '.gauntlet/_fxfind-' + type + '-filtered.png';
  await page.screenshot({ path: shot2, clip: { x: box2.x, y: box2.y, width: box2.w, height: box2.h } });
  console.log('  📸 ' + shot2);

  /* …and one HONEST shot: the picker at its real width, closed, filter cleared,
     which is what the author actually sees. The two above widen the control to
     860px so the listbox stops truncating labels, and a reader is entitled to
     see the un-widened thing too. */
  const box3 = await page.evaluate((pid) => {
    const sel = document.getElementById(pid);
    const inp = sel.previousElementSibling.querySelector('.fx-find-in');
    inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true }));
    sel.size = 0; sel.style.width = ''; sel.style.maxWidth = ''; sel.style.minHeight = '';
    sel.previousElementSibling.style.width = '';
    if (sel.options.length) { sel.selectedIndex = Math.min(4, sel.options.length - 1); sel.dispatchEvent(new Event('change', { bubbles: true })); }
    sel.scrollIntoView({ block: 'center' });
    const f = sel.closest('.editor-field') || sel.parentElement;
    const r = f.getBoundingClientRect();
    return { x: Math.max(0, r.left - 12), y: Math.max(0, r.top - 12), w: r.width + 24, h: r.height + 24 };
  }, primary);
  await page.waitForTimeout(250);
  const shot3 = '.gauntlet/_fxfind-' + type + '-natural.png';
  await page.screenshot({ path: shot3, clip: { x: box3.x, y: box3.y, width: box3.w, height: box3.h } });
  console.log('  📸 ' + shot3 + '  (' + Math.round(box3.w) + '×' + Math.round(box3.h) + ', real width)');
}

console.log('\n=== page errors ===');
ok(errors.length === 0, 'no page errors', errors.slice(0, 3).join(' | '));

console.log('\n' + (fails ? fails + ' FAILURE(S)' : 'ALL PASS'));
console.log(JSON.stringify({ maxGroupByType: Object.fromEntries(Object.entries(report).map(([k, v]) => [k, v.maxGroup])) }));
await close();
process.exit(fails ? 1 : 0);
