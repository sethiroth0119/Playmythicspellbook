import { makeWorld } from './critlife-harness.mjs';
const W = makeWorld();
const M = await import('../public/src/lifepath/model.js');
const T = await import('../public/src/lifepath/tuning.js');
const { ECON } = await import('../public/src/economy/tuning.js');
M.bind(W.ctx);
const clk = M.clock();
const r = (x, n = 6) => +x.toFixed(n);
console.log(JSON.stringify({
  ok: clk.ok,
  src: clk.src,
  daysPerYear: r(clk.daysPerYear, 4),
  handAlgebra_1_over_agePerDay_times_52: r(1 / (0.0008 * 52), 4),
  secPerDay: clk.secPerDay, secPerYear: r(clk.secPerYear, 4),
  hoursPerYear: r(clk.hoursPerYear, 4),
  gradeYears: r(clk.gradeYears, 4),
  gradeRealHours: r(clk.gradeYears * clk.hoursPerYear, 2),
  youngYears: r(clk.youngYears, 4),
  retirementYears: r(clk.retirementYears, 4),
  lifeExpectancy: r(clk.lifeExpectancy, 4),
  bands: clk.bands,
  ECON_eduOrder: ECON.demographics.education.order,
  ECON_turnoverComment_impliedYear: r(1 / 0.012 / 3.5, 3),
  LIFE: T.LIFE,
}, null, 1));
