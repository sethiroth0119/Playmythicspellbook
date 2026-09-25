/* ══════════════════════════════════════════════════════════════════════════
   ACTIVATION ART PROBE — does the full-screen activation panel get CARD ART?

   Owner: a Kalon transform showed a frame + ⭐, and "No Hero ability should show
   this it should always be their card art" (frame + 🦄). This panel was
   declared fixed twice before, so this measures what reaches ActivateFX.

   Runs the REAL _afxAnnounce with window.ActivateFX stubbed to capture the spec.
   Art is seeded the way a live account holds it: a Kalon form's art only as the
   catalogue `artUrl` on its published card, a hero's portrait only under 'h_' in
   the card-art URL map. PASS = spec.artUrl is that art (not null → no emoji).

   Usage: node .gauntlet/afxart-probe.mjs [candidate.html]   (:8787 up)
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import fs from 'node:fs';

const b = await chromium.launch();
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(String(e.message || e)));
if (process.argv[2]) {
  const html = fs.readFileSync(process.argv[2], 'utf8');
  await p.route('**/index.html', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
}
await p.goto('http://localhost:8787/index.html', { waitUntil: 'load', timeout: 60000 });
await p.waitForFunction(() => typeof window._afxAnnounce === 'function');

const out = await p.evaluate(() => {
  const R = [];
  const ok = (label, cond, detail) => R.push({ label, pass: !!cond, detail: detail == null ? '' : String(detail) });
  const KALON_ART = 'https://art.example/abraxas-true-source.png';
  const BASE_ART  = 'https://art.example/abraxas-base.png';
  const HERO_ART  = 'https://art.example/max-survivor.png';
  // seed — a Kalon form's art only as a catalogue artUrl; the hero's only under h_
  Forge.customCards = (Forge.customCards || []).concat([
    { id: 'k_abraxas_true', name: 'Abraxas True Source Form', type: 'unit', artUrl: KALON_ART },
  ]);
  Forge.cardArtUrl = Object.assign({}, Forge.cardArtUrl || {}, { h_maxsurvivor: HERO_ART, abraxas: BASE_ART });
  if (Forge.cardArtUrl.k_abraxas_true) delete Forge.cardArtUrl.k_abraxas_true;   // must come from the catalogue

  let spec = null;
  /* _afxAnnounce only speaks on the battle screen; the harness sits on the
     sign-in gate, so without this it returns before the art lookup and every
     check would fail for a reason that has nothing to do with art. */
  const realScreen = App.screen;
  App.screen = 'battle';
  const realFX = window.ActivateFX;
  window.ActivateFX = { announce: (s) => { spec = s; }, pulse: () => {} };
  const snap = (typeof _afxSnapshot === 'function') ? _afxSnapshot({ units: [], log: [] }) : null;
  const run = (unit, card) => {
    spec = null;
    try { _afxAnnounce(snap, { units: [unit], log: [] }, unit, card, null); } catch (e) { return 'THREW ' + e.message; }
    return spec;
  };
  try {
    // ── a Kalon form ─────────────────────────────────────────────────────
    const kalon = { id: 'u1', name: 'Abraxas True Source Form', owner: 'player', alive: true, pos: { x: 1, y: 1 },
      cardId: 'k_abraxas_true', originalCardId: 'abraxas', icon: '⭐' };
    const k = run(kalon, { id: 'k_abraxas_true', name: 'Abraxas True Source Form', type: 'unit', icon: '⭐',
                           onPlay: { type: 'buffSelf', status: 'strong' }, _actZone: 'field' });
    ok('K1 the Kalon transform panel was announced', !!(k && typeof k === 'object'), typeof k === 'string' ? k : '');
    ok('K2 …with the Kalon FORM\'s card art (from the catalogue artUrl)', k && k.artUrl === KALON_ART, k && k.artUrl);
    // a form with no art of its own falls back to the base card, never the emoji
    const k2 = run(Object.assign({}, kalon, { cardId: 'k_unpainted' }),
      { id: 'k_unpainted', name: 'Unpainted Form', type: 'unit', icon: '⭐', onPlay: { type: 'buffSelf' }, _actZone: 'field' });
    ok('K3 a form with no art shows the BASE card\'s art, not ⭐', k2 && k2.artUrl === BASE_ART, k2 && k2.artUrl);

    // ── a hero ability ──────────────────────────────────────────────────
    const hero = { id: 'h1', name: 'Max Survivor the Scrap Mage', owner: 'player', alive: true, isHero: true,
      heroId: 'maxsurvivor', pos: { x: 2, y: 2 }, icon: '🦄' };
    const h = run(hero, { id: 'passive_scrapstorm', name: 'Scrap Storm', type: 'hero', icon: '🦄',
                          onPlay: { type: 'buffSelf', status: 'strong' }, _actZone: 'field' });
    ok('H1 the hero ability panel was announced', !!(h && typeof h === 'object'), typeof h === 'string' ? h : '');
    ok('H2 …with the HERO\'s card art, although card.id is the ability', h && h.artUrl === HERO_ART, h && h.artUrl);

    // ── control: genuinely no art anywhere keeps the frame fallback ─────
    const n = run({ id: 'z', name: 'Nobody', owner: 'player', alive: true, pos: { x: 3, y: 3 }, cardId: 'nothing_here' },
      { id: 'nothing_here', name: 'Nobody', type: 'unit', icon: '❔', onPlay: { type: 'buffSelf' }, _actZone: 'field' });
    ok('C1 a card with no art anywhere still announces (frame fallback, no crash)', n && typeof n === 'object' && !n.artUrl, n && n.artUrl);
  } finally { window.ActivateFX = realFX; App.screen = realScreen; }
  return R;
});
await b.close();
let fails = 0;
for (const r of out) { if (!r.pass) fails++; console.log((r.pass ? '  ok   ' : '  FAIL ') + r.label + (r.pass ? '' : '   ← ' + r.detail)); }
if (errs.length) console.log('page errors: ' + errs.slice(0, 3).join(' | '));
console.log('\n' + (fails ? fails + ' FAILED' : 'ALL ' + out.length + ' PASS'));
process.exit(fails ? 1 : 0);
