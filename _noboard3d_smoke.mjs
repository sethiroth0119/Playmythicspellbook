/* 🗺️ THE 3D BATTLE BOARD IS RETIRED (v121v72).

   Asked for: "Remove this from the game, this board do not even matter it is
   dead code. Also make sure to fix anything that it is connected to that it
   might break."

   WHAT WAS REMOVED: the settings card, its toggle, and the Battlemap Editor
   button — every way a human could turn it on — plus the handlers behind them.
   _b3dEnabled() returns false at its first statement, and every mount path in
   the battle screen gates on that one function, so the board cannot mount for
   anyone regardless of an old save, a published Forge row, the durable
   localStorage key, or an App.ui runtime override.

   WHAT WAS DELIBERATELY KEPT, and this suite is mostly here to hold the line:

     · THE SUMMON CINEMATIC PREVIEWS. They shared the card but are nothing to
       do with the board — the card's own text says Normal and Transform are
       LIVE in battle. They moved to their own section rather than being
       deleted along with the thing they were sitting next to.
     · THE CLASSIC BOARD. The whole point of a retirement is that the battle
       screen is unchanged, so the guards that choose the classic path must
       still be there and must still be the ones running.

   Run: node _noboard3d_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
function fnText(name) {
  let i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name);
  if (SRC.slice(i - 6, i) === 'async ') i -= 6;
  let d = 0, j = SRC.indexOf('{', i);
  for (let k = j; k < SRC.length; k++) { if (SRC[k] === '{') d++; else if (SRC[k] === '}') { d--; if (!d) return SRC.slice(i, k + 1); } }
}

/* ── the switch, run for real against every way it used to turn on ── */
{
  const world = (opts) => {
    const ctx = {
      console,
      App: { ui: opts.runtime === undefined ? {} : { board3d: opts.runtime } },
      Forge: { battleMap3d: { enabled: !!opts.forge } },
      localStorage: { getItem: () => (opts.durable === undefined ? null : (opts.durable ? '1' : '0')), setItem: () => {} },
      _b3dDurableOn: () => (opts.durable === undefined ? null : !!opts.durable),
      _b3dEnsureLoaded: () => {},
    };
    vm.createContext(ctx);
    vm.runInContext(fnText('_b3dEnabled'), ctx);
    return vm.runInContext('_b3dEnabled()', ctx);
  };
  ok(world({}) === false, 'off by default');
  ok(world({ forge: true }) === false, 'a published Forge.battleMap3d.enabled cannot switch it back on');
  ok(world({ durable: true }) === false, 'nor can the durable localStorage key an admin had saved');
  ok(world({ runtime: true }) === false, 'nor can an App.ui.board3d runtime override');
  ok(world({ forge: true, durable: true, runtime: true }) === false, 'nor all three together', String(world({ forge: true, durable: true, runtime: true })));
}
{
  const f = fnText('_b3dEnabled');
  const iReturn = f.indexOf('return false;');
  const iFirstIf = f.indexOf('if (');
  ok(iReturn > 0 && iReturn < iFirstIf, 'the refusal is the FIRST statement, ahead of every old branch', String(iReturn) + ' vs ' + String(iFirstIf));
  ok(/RETIRED \(v121v72\)/.test(f), 'and it says what it is and when');
}

/* ── the UI is gone ── */
ok(!/3D Battle Board/.test(SRC), 'the settings card is gone');
ok(!/id="set-board3d"/.test(SRC) && !/getElementById\('set-board3d'\)/.test(SRC), 'the toggle and its handler are gone');
ok(!/open-battlemap-editor/.test(SRC), 'the Battlemap Editor button and its handler are gone');
ok(!/_bmeOpen\(\);/.test(SRC.replace(/function _bmeOpen\(\)\{/, '')), 'nothing calls the editor overlay any more');
ok(!/3D board is ON/.test(SRC) && !/classic board\)/.test(SRC), 'and none of its copy survives to confuse anyone');

/* ── what must NOT have been removed ── */
{
  ok((SRC.match(/data-vsm-prev="/g) || []).length === 2 && (SRC.match(/data-vms-prev="/g) || []).length === 1,
    'all three summon-cinematic previews survive — they were never part of the board');
  ok(/Summon Cinematics \(preview\)/.test(SRC), 'in a section of their own');
  ok(/live in battle/.test(SRC), 'still saying that Normal and Transform are live');
  ok(/document\.querySelectorAll\('\[data-vsm-prev\]'\)/.test(SRC) && /_previewSummonVfx\(/.test(SRC),
    'and their handlers are untouched — they bind by selector, so moving the buttons cannot unwire them');
  ok(/_previewMythicSummonRitual\(/.test(SRC), 'including the mythic ritual preview');
}
{
  /* The retirement is only safe if the classic path is the one that runs. */
  ok(/if \(App\.screen !== 'battle' \|\| !_b3dEnabled\(\)\) \{ if \(_B3D\.on\) _b3dUnmount\(\); return; \}/.test(SRC),
    'the battle tick still asks, and now always unmounts instead of mounting');
  ok(/if \(!\(typeof _b3dEnabled === 'function' && _b3dEnabled\(\)\)\) \{/.test(SRC),
    'and the board bridge still takes its not-enabled branch, which is the classic board');
  ok(/Athena Engine/.test(SRC), 'the Athena Engine map creator — a different feature that sat below it — is untouched');
}
ok(/window\.BUILD_VERSION = 'v121v(7[2-9]|[8-9]\d|\d{3,})'/.test(SRC), 'build v121v72 or later');
console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
