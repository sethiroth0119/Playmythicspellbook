/* CRITIC scratch driver — read-only probe of /src/lifepath in plain node.
   Stubs only the window seams the module itself probes.

   ⚠ ONE THING TO KNOW ABOUT `state.day`. model.js memoises the economy's day
     count against the `now()` reading that asked for it — snapshot() is an
     expensive object and cardSeam() walks the whole roster in one pass. In the
     real game the two clocks advance together so the cache is at most one frame
     stale; in here `now` is frozen, so CHANGING `state.day` MID-RUN WITHOUT
     MOVING `now` will read the stale value. Call `M.bind(W.ctx)` after doing
     it — bind() clears the cache, and it is the module's own reset seam. */
export function makeWorld(opts = {}) {
  const state = {
    now: opts.now ?? 100000,
    ages: opts.ages ?? { child: 30, young: 25, adult: 60, senior: 12 },
    roster: [],
    employers: {},           // id -> {id,name,ind,tile}
    /* firmId -> {id,name,level[,foundedDay]}. `foundedDay` mirrors the field
       firms.js `found()` now writes: the ECONOMIC DAY the business opened.
       Leaving it off is a firm with no stamp — an old save — which is a real
       state the model has to handle, so several rounds below rely on it. */
    firms: {},
    tileBorn: opts.tileBorn ?? {},   // tileKey -> born seconds
    /* The economy's own day counter. Two clocks run in this game and they are
       not the same clock: `now` is game.cityAge in seconds, `day` is S.day in
       economic days. The model reads this one through MythicEconomy.snapshot()
       and must never subtract a founding stamp from cityAge. */
    day: opts.day ?? 0,
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
      /* Only `day` is read from here. The shipped snapshot() carries forty
         other fields and none of them reaches /src/lifepath. */
      snapshot: () => ({ day: state.day }),
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
