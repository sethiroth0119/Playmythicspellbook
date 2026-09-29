import { bootMatch } from './boot.mjs';

const { page, close, started, pageErrors } = await bootMatch();
console.log('startBattleWithPrep ->', JSON.stringify(started));
const info = await page.evaluate(() => {
  const out = {};
  const t = (name, fn) => { try { out[name] = fn(); } catch (e) { out[name] = 'THREW: ' + (e && e.message); } };
  t('BOARD_W', () => BOARD_W);
  t('BOARD_H', () => BOARD_H);
  t('boardRows', () => App.state.board.length);
  t('boardCols', () => App.state.board[0].length);
  t('units', () => App.state.units.length);
  t('distanceFn', () => typeof distance);
  t('hexNeighborsFn', () => typeof hexNeighbors);
  t('hexDirTowardFn', () => typeof hexDirToward);
  t('hexStepFn', () => typeof hexStep);
  t('getMovePathFn', () => typeof getMovePath);
  t('getValidMovesFn', () => typeof getValidMoves);
  t('tilesWithinRangeFn', () => typeof tilesWithinRange);
  t('offsetToCubeFn', () => typeof offsetToCube);
  t('slideOnIceArity', () => _slideOnIce.length);
  return out;
});
console.log(JSON.stringify(info, null, 1));
console.log('pageErrors:', pageErrors.length, pageErrors.slice(0, 5));
await close();
