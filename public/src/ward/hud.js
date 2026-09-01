/* ══════════════════════════════════════════════════════════════════════════
   🏥 WARD HUD — every pixel of the Medical Corporation, and its stylesheet.
   ──────────────────────────────────────────────────────────────────────────
   The style block is inlined for the same reason /src/biolab/hud.js inlines
   its own: the ward is an overlay opened on top of a live game, and a
   stylesheet that 404s (a missed ?v= bump against the service worker —
   CLAUDE.md warns about exactly this) would leave the player looking at
   unstyled markup over their save. Inlined, it mounts whole or not at all.

   🔴 THE WARD IS NOT THE LAB, AND MUST NOT LOOK LIKE IT. The containment lab
   is a dark hazard-striped industrial room; this is a clinic — lighter,
   quieter, and organised as a patient list rather than a bench. If the two
   screens read the same, the player stops being able to tell which side of
   the pipe they are on.

   ⚠ Every string that can carry another player's text — carrier names, lab
     names, shipper names — goes through `esc`.
   ══════════════════════════════════════════════════════════════════════════ */

import { stageLabel, stageColor, DOSE_COST, CLEAR_THRESHOLD } from './triage.js';
import { carrierNote } from './intake.js';

export function esc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const num = (n) => (Number(n) || 0).toLocaleString();
const pct = (v) => Math.round((+v || 0) * 100) + '%';

export const CSS = `
.wd-root{position:fixed;inset:0;z-index:2400;background:#0d1117;color:#dde4ee;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow:auto;overscroll-behavior:contain}
.wd-inner{max-width:1080px;margin:0 auto;padding:0 16px 64px}

/* ── header: a clinic board, not a hazard sign ── */
.wd-top{position:sticky;top:0;z-index:5;background:linear-gradient(#0d1117,#0d1117f2 70%,#0d111700);
  padding:14px 0 12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.wd-title{font-size:13px;letter-spacing:.14em;color:#8fd4c8;font-weight:700}
.wd-sub{font-size:11px;color:#7b8494}
.wd-sp{flex:1}
.wd-x{background:#161d27;border:1px solid #29323f;color:#dde4ee;border-radius:6px;padding:7px 13px;
  font:inherit;font-size:11px;cursor:pointer}
.wd-x:hover{border-color:#8fd4c8;color:#8fd4c8}
.wd-x.alt{border-color:#3a4a5e;color:#9fb4d8}
.wd-x.alt:hover{border-color:#9fb4d8}

h2.wd-h{font-size:10.5px;letter-spacing:.18em;color:#6f7889;font-weight:700;margin:22px 0 9px;
  text-transform:uppercase;border-bottom:1px solid #1d2530;padding-bottom:7px}

/* ── crates ── */
.wd-crate{background:#131a23;border:1px solid #222c39;border-radius:10px;padding:14px;margin-bottom:10px}
.wd-crate.sel{border-color:#8fd4c8}
.wd-crate.bad{border-color:#8c3440}
.wd-crate-top{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;font-size:12.5px}
.wd-crate-top b{color:#eef3fa}
.wd-meta{font-size:10.5px;color:#7b8494;line-height:1.65;margin-top:5px}
.wd-note{font-size:10.5px;line-height:1.6;margin-top:7px;color:#8a93a3;border-left:2px solid #2a3441;padding-left:9px}
.wd-note.warn{border-left-color:#d99a4e;color:#d9b184}
.wd-note.bad{border-left-color:#c84b58;color:#e39aa4}

.wd-grade{display:inline-block;border-radius:5px;padding:3px 9px;font-size:11px;font-weight:700;letter-spacing:.05em}
.wd-sealed{display:inline-block;border:1px dashed #3c4756;border-radius:5px;padding:3px 9px;font-size:10.5px;color:#7b8494}

.wd-acts{display:flex;gap:7px;flex-wrap:wrap;margin-top:11px}
.wd-btn{background:#18212c;border:1px solid #2b3644;color:#dde4ee;border-radius:6px;padding:8px 13px;
  font:inherit;font-size:11px;cursor:pointer}
.wd-btn:hover:not(:disabled){border-color:#8fd4c8;color:#8fd4c8}
.wd-btn:disabled{opacity:.38;cursor:not-allowed}
.wd-btn.go{background:#123028;border-color:#2f6f5c;color:#8fd4c8}
.wd-btn.no{background:#2a1218;border-color:#6a2c34;color:#e39aa4}

/* ── the dose meter ── */
.wd-doses{position:sticky;bottom:0;background:#0f151de8;border-top:1px solid #222c39;
  margin:14px -16px 0;padding:11px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.wd-bar{flex:1;min-width:160px;height:11px;border-radius:6px;background:#1b232e;overflow:hidden}
.wd-bar i{display:block;height:100%;width:0;background:#8fd4c8}
.wd-bar i.over{background:#c84b58}
.wd-dnum{font-size:11.5px;font-variant-numeric:tabular-nums;white-space:nowrap}

/* ── patients ── */
.wd-beds{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:8px}
.wd-bed{background:#131a23;border:1px solid #222c39;border-radius:9px;padding:10px 11px;cursor:pointer;
  display:flex;gap:9px;align-items:flex-start;text-align:left;font:inherit;color:inherit;width:100%}
.wd-bed:hover{border-color:#3c4756}
.wd-bed.on{border-color:#8fd4c8;background:#152029}
.wd-bed.over{opacity:.45}
.wd-tick{width:17px;height:17px;border-radius:4px;border:1px solid #3c4756;flex:0 0 auto;margin-top:1px;
  display:flex;align-items:center;justify-content:center;font-size:11px;color:#0d1117}
.wd-bed.on .wd-tick{background:#8fd4c8;border-color:#8fd4c8}
.wd-bed-b{flex:1;min-width:0}
.wd-nm{font-size:12px;color:#eef3fa;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wd-st{font-size:10px;margin-top:3px;letter-spacing:.06em}
.wd-cost{font-size:10px;color:#7b8494;margin-top:2px}

.wd-empty{background:#131a23;border:1px dashed #2b3644;border-radius:10px;padding:20px;
  font-size:11.5px;color:#7b8494;line-height:1.75;text-align:center}
.wd-empty b{color:#dde4ee}

/* ── coverage readout: the number the whole ward turns on ── */
.wd-cov{background:#131a23;border:1px solid #222c39;border-radius:10px;padding:12px 14px;margin:12px 0}
.wd-cov-top{display:flex;justify-content:space-between;align-items:baseline;font-size:11.5px;flex-wrap:wrap;gap:8px}
.wd-cov-bar{height:13px;border-radius:7px;background:#1b232e;margin:9px 0 7px;position:relative;overflow:hidden}
.wd-cov-bar i{display:block;height:100%;background:#d99a4e}
.wd-cov-bar i.ok{background:#4faa86}
.wd-cov-bar u{position:absolute;top:-3px;bottom:-3px;width:2px;background:#eef3fa;text-decoration:none}
.wd-cov-say{font-size:10.5px;color:#8a93a3;line-height:1.6}
.wd-cov-say b{color:#eef3fa}

.wd-toasts{position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:20;
  display:flex;flex-direction:column;gap:6px;width:min(92vw,560px)}
.wd-toast{background:#131a23f5;border:1px solid #29323f;border-left-width:3px;border-radius:7px;
  padding:8px 13px;font-size:11.5px;line-height:1.6}
.wd-toast.good{border-left-color:#4faa86}
.wd-toast.warn{border-left-color:#d99a4e}
.wd-toast.bad{border-left-color:#c84b58}

@media (max-width:640px){ .wd-beds{grid-template-columns:1fr} }
@media (prefers-reduced-motion:reduce){ *{transition:none!important;animation:none!important} }
`;

export function shell() {
  return `
    <div class="wd-toasts"></div>
    <div class="wd-inner">
      <div class="wd-top">
        <span class="wd-title">🏥 THE WARD</span>
        <span class="wd-sub"></span>
        <span class="wd-sp"></span>
        <button class="wd-x alt" data-act="bench">⚗️ CONTAINMENT LAB</button>
        <button class="wd-x" data-act="exit">LEAVE ✕</button>
      </div>
      <div class="wd-body"></div>
    </div>`;
}

/* ── the crate list ────────────────────────────────────────────────────────
   An unscreened crate shows the DISPATCH grade only — what the shipper claimed
   before the drive — and never what arrived. Those two differ exactly when the
   cold chain broke, which is the case worth catching, so showing the arrived
   grade for free would delete the decision this screen exists for. */
export function crateHtml(view, opts, selected) {
  const o = opts;
  const bad = view.screened && view.arrivedGrade.key === 'iatrogenic';
  const g = view.screened ? view.arrivedGrade : view.dispatchGrade;

  const gradeChip = view.screened
    ? '<span class="wd-grade" style="background:' + g.color + '22;color:' + g.color +
      ';border:1px solid ' + g.color + '55">' + esc(g.icon + ' ' + g.label) + '</span>'
    : '<span class="wd-sealed">🔒 UNSCREENED — shipper declared ' +
      esc(view.dispatchGrade.label) + '</span>';

  const detail = view.screened
    ? '<div class="wd-meta">stability <b>' + view.stability + '%</b> · purity <b>' + view.purity +
      '%</b> · mutation risk <b>' + pct(view.risk) + '</b>' +
      (view.degraded ? ' · <span style="color:#e39aa4">DEGRADED IN TRANSIT</span>' : '') + '</div>'
    : '';

  const noteClass = view.suspicion === 'high' ? 'wd-note warn' : 'wd-note';
  const verdict = bad
    ? '<div class="wd-note bad">☣️ This is not a cure. Putting it into people is how a new strain gets out — ' +
      'and refusing it is the only thing that stops that.</div>'
    : view.screened && view.coldChainBroken
      ? '<div class="wd-note warn">🧊 The cold chain broke on the way. It left the bench better than this.</div>'
      : '';

  return '<div class="wd-crate' + (selected ? ' sel' : '') + (bad ? ' bad' : '') + '" data-act="pick" data-id="' + esc(view.id) + '">' +
    '<div class="wd-crate-top"><b>' + esc(view.strainName) + '</b>' +
      (view.strainIsolate ? ' <span class="wd-sub">' + esc(view.strainIsolate) + '</span>' : '') +
      ' ' + gradeChip + '</div>' +
    '<div class="wd-meta">' + num(view.doses) + ' doses' +
      (view.dosesLost ? ' · <span style="color:#d9b184">' + num(view.dosesLost) + ' spoiled in transit</span>' : '') +
      '</div>' + detail +
    '<div class="' + noteClass + '">' + esc(carrierNote(view)) + '</div>' + verdict +
    '<div class="wd-acts">' +
      (view.screened ? ''
        : '<button class="wd-btn" data-act="screen" data-id="' + esc(view.id) + '">🔬 ' +
          esc(o.screen.label) + ' — ' + o.screen.cost + ' 💊</button>') +
      '<button class="wd-btn ' + (o.administer.danger ? '' : 'go') + '" data-act="open" data-id="' + esc(view.id) + '">🛏 TRIAGE &amp; ADMINISTER</button>' +
      '<button class="wd-btn no" data-act="refuse" data-id="' + esc(view.id) + '">🔥 ' + esc(o.refuse.label) + '</button>' +
    '</div>' +
    '<div class="wd-note">' + esc(o.administer.why) + '</div>' +
    '</div>';
}

/* ── the triage screen ─────────────────────────────────────────────────────
   Coverage is rendered as a bar with the clearance threshold marked, because
   "you need 80%" is a rule the player has to be able to SEE themselves
   approaching. A number alone makes under-dosing feel like a trick. */
export function triageHtml(ctx) {
  const { view, list, assign, price, activeCases, cov, opts } = ctx;
  const chosen = new Set((assign || []).map(String));
  const over = price.doses > view.doses;

  const beds = list.length
    ? list.map((p) => {
        const on = chosen.has(String(p.id));
        return '<button class="wd-bed' + (on ? ' on' : '') + '" data-act="bed" data-id="' + esc(p.id) + '">' +
          '<span class="wd-tick">' + (on ? '✓' : '') + '</span>' +
          '<span class="wd-bed-b">' +
            '<span class="wd-nm">' + esc(p.name) + '</span>' +
            '<div class="wd-st" style="color:' + stageColor(p.stage) + '">' + esc(stageLabel(p.stage)) + '</div>' +
            '<div class="wd-cost">' + p.cost + ' dose' + (p.cost === 1 ? '' : 's') + '</div>' +
          '</span></button>';
      }).join('')
    : '<div class="wd-empty">No treatable patients. Incubating cases cannot be seen yet — ' +
      '<b>you can only treat people who are already showing symptoms</b>, which is why a crate that ' +
      'arrives early cannot pre-empt an outbreak.</div>';

  const covPct = Math.min(100, cov.share * 100);
  return '<h2 class="wd-h">The crate</h2>' +
    '<div class="wd-crate">' +
      '<div class="wd-crate-top"><b>' + esc(view.strainName) + '</b> ' +
      (view.screened
        ? '<span class="wd-grade" style="background:' + view.arrivedGrade.color + '22;color:' + view.arrivedGrade.color +
          ';border:1px solid ' + view.arrivedGrade.color + '55">' + esc(view.arrivedGrade.icon + ' ' + view.arrivedGrade.label) + '</span>'
        : '<span class="wd-sealed">🔒 UNSCREENED</span>') + '</div>' +
      '<div class="wd-note">' + esc(opts.administer.why) + '</div>' +
    '</div>' +

    '<div class="wd-cov">' +
      '<div class="wd-cov-top"><span>CLEARANCE COVERAGE</span>' +
      '<b style="color:' + (cov.clears ? '#4faa86' : '#d99a4e') + '">' + Math.round(cov.share * 100) + '%</b></div>' +
      '<div class="wd-cov-bar"><i class="' + (cov.clears ? 'ok' : '') + '" style="width:' + covPct + '%"></i>' +
      '<u style="left:' + (CLEAR_THRESHOLD * 100) + '%"></u></div>' +
      '<div class="wd-cov-say">' +
        (cov.clears
          ? '<b>Enough.</b> Treating this many retires ' + esc(view.strainName) + ' outright — if the chemistry holds.'
          : '<b>' + cov.shortfall + ' short.</b> The people you do not reach carry it on: a perfect cure that ' +
            'covers too few leaves a reservoir, and the strain survives it.') +
        ' Threshold is ' + Math.round(CLEAR_THRESHOLD * 100) + '% of all ' + activeCases +
        ' active case' + (activeCases === 1 ? '' : 's') + ', including the ' +
        Math.max(0, activeCases - list.length) + ' still incubating and invisible to you.' +
      '</div>' +
    '</div>' +

    '<h2 class="wd-h">Beds — ' + list.length + ' treatable</h2>' +
    '<div class="wd-acts" style="margin:0 0 10px">' +
      '<button class="wd-btn" data-act="plan-critical">TREAT THE SICKEST FIRST</button>' +
      '<button class="wd-btn" data-act="plan-widest">TREAT THE MOST PEOPLE</button>' +
      '<button class="wd-btn" data-act="plan-clear">CLEAR SELECTION</button>' +
    '</div>' +
    '<div class="wd-beds">' + beds + '</div>' +

    '<div class="wd-doses">' +
      '<span class="wd-dnum">' + price.doses + ' / ' + view.doses + ' doses</span>' +
      '<div class="wd-bar"><i class="' + (over ? 'over' : '') + '" style="width:' +
        Math.min(100, view.doses ? (price.doses / view.doses) * 100 : 0) + '%"></i></div>' +
      '<span class="wd-dnum">' + price.treated + ' patient' + (price.treated === 1 ? '' : 's') + '</span>' +
      '<button class="wd-btn ' + (opts.administer.danger ? '' : 'go') + '" data-act="commit"' +
        (price.treated && !over ? '' : ' disabled') + '>💉 ADMINISTER</button>' +
      '<button class="wd-btn" data-act="back">← BACK</button>' +
    '</div>';
}

export function toast(root, text, kind) {
  try {
    const host = root.querySelector('.wd-toasts');
    if (!host) return;
    const d = document.createElement('div');
    d.className = 'wd-toast ' + (kind || '');
    d.textContent = text;
    host.appendChild(d);
    setTimeout(() => { try { d.remove(); } catch (e) {} }, kind === 'bad' ? 9000 : 5200);
    while (host.children.length > 5) host.firstChild.remove();
  } catch (e) {}
}

export function doseCostNote() {
  return 'A critical patient takes ' + DOSE_COST.critical + ' doses, a symptomatic one ' +
    DOSE_COST.symptomatic + '. Treating the sickest costs twice as much and does not slow the spread — ' +
    'someone that ill is not at work infecting anyone. The ward does not resolve that for you.';
}
