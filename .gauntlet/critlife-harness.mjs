/* CRITIC scratch driver — read-only probe of /src/lifepath in plain node.
   Stubs only the window seams the module itself probes. */
export function makeWorld(opts = {}) {
  const state = {
    now: opts.now ?? 100000,
    ages: opts.ages ?? { child: 30, young: 25, adult: 60, senior: 12 },
    roster: [],
    employers: {},           // id -> {id,name,ind,tile}
    firms: {},               // firmId -> {id,name,level}
    tileBorn: opts.tileBorn ?? {},   // tileKey -> born seconds
  };
  const win = {
    MythicDemographics: {
      report: () => ({ ok: true, ages: Object.entries(state.ages).map(([k, v]) => ({ k, v })) }),
    },
    MythicCitizens: {
      list: () => state.roster.slice(),
      count: () => state.roster.length,
      employer: (id) => state.employers[id] || null,
    },
    MythicEconomy: {
      firm: (fid) => state.firms[fid] || null,
    },
  };
  globalThis.window = win;
  state.win = win;
  state.ctx = {
    now: () => state.now,
    tileBorn: (k) => (k in state.tileBorn ? state.tileBorn[k] : null),
    cycleMin: () => 20,
  };
  state.setRoster = (n, start = 1) => {
    state.roster = [];
    for (let i = start; i < start + n; i++) state.roster.push({ id: 'c' + i, name: 'P' + i });
  };
  return state;
}
