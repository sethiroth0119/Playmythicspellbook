/* 🏕 → CAMP ON THE POST-BATTLE SCREEN (bug-mu0pejur).

   Asked for: a quick button from the battle result to Camp Ops (where the
   gathered resources are emptied and the Vault button is), instead of walking
   the menus after every fight. The shipped bindGameOverEvents is cut out of
   index.html and run against stub buttons — not reimplemented.
   Run: node _gocamp_smoke.mjs */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
function fnText(name) {
  const i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find function ' + name);
  let d = 0, started = false;
  for (let j = i; j < SRC.length; j++) {
    const c = SRC[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return SRC.slice(i, j + 1); }
  }
  throw new Error('unbalanced ' + name);
}

/* the button is in the result modal's link row, not in the three-button row */
const modal = SRC.slice(SRC.indexOf('<div class="gameover-actions gox-actions">'), SRC.indexOf('function bindGameOverEvents('));
ok(/<div class="gox-sharerow">[^\n]*id="btn-go-camp"[^\n]*→ Camp<\/button><\/div>/.test(modal), 'the result screen renders a "→ Camp" button in the link row');
ok((modal.match(/gameover-btn gox-btn/g) || []).length === 3, 'the action row still has exactly three buttons');
ok((SRC.match(/id="btn-go-camp"/g) || []).length === 1, 'it exists only on the post-battle screen');

const BIND = fnText('bindGameOverEvents');
function run(app, click) {
  const els = {};
  const mk = (id) => (els[id] = { id, hidden: false, onclick: null, dataset: {} });
  for (const id of ['btn-view-field', 'btn-play-again', 'btn-exit-game', 'btn-go-camp', 'btn-share-broadcast', 'btn-share-broadcast-2']) mk(id);
  const document = { getElementById: (id) => els[id] || null };
  let rendered = 0;
  const f = new Function('App', 'document', 'render', 'renderBattle', 'showToast', 'saveProfile', 'Profile', 'Forge',
    BIND + '\nbindGameOverEvents();');
  f(app, document, () => { rendered++; }, () => {}, () => {}, () => {}, {}, {});
  if (click && els[click].onclick) els[click].onclick({ type: 'click' });
  return { els, rendered };
}

{
  const App = { ui: {}, state: { gameOver: 'player' }, battlePrep: {}, screen: 'battle' };
  const r = run(App, 'btn-go-camp');
  ok(!r.els['btn-go-camp'].hidden, 'shown after an ordinary battle');
  ok(App.screen === 'campOps' && App._campReturnsToBunker === true && r.rendered === 1, 'click → Camp Ops (same nav as the Bunker uses), rendered once', App.screen);
  ok(App.state === null && App.ui._gameOverHidden === false, 'with the same teardown as Exit');
}
{
  const App = { ui: {}, state: { gameOver: 'player' }, battlePrep: {}, screen: 'battle' };
  run(App, 'btn-exit-game');
  ok(App.screen === 'title', 'Exit to Menu still goes to the menu (the click event is not read as "to camp")', App.screen);
}
for (const [flag, label] of [['_rlcPendingAfterBattle', 'roguelite'], ['_gymPendingAfterBattle', 'gym'], ['_warpathAfter', 'Warpath'], ['_worldAfter', 'world']]) {
  const App = { ui: {}, state: {}, battlePrep: {}, screen: 'battle', [flag]: { x: 1 } };
  const r = run(App, null);
  ok(r.els['btn-go-camp'].hidden === true, 'hidden in ' + label + ' runs, whose after-battle hook owns navigation');
}

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
