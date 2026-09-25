/* ════════════════════════════════════════════════════════════════════════════
   💰 COST GRAMMAR — normalise, price, afford, and spend ATOMICALLY.
   ----------------------------------------------------------------------------
   Spec: CLAUDE_TASK_buildings.md §2. This is the module-side half; index.html
   carries the same grammar for CAMP_FACILITIES (_normCost / _facCostAt /
   _campSpendCost) because those costs are read by legacy render paths that
   cannot import an ES module.

   ⚠ TWO COPIES OF THE RULES, ONE SET OF RULES. That duplication is deliberate
   and bounded: the shape (`{ cinder, <resourceId>: n }`) and the atomicity
   contract are identical, and both are ~40 lines. The alternative — index.html
   importing from here — is impossible, because index.html's cost readers run
   synchronously during render() while a module is deferred by definition. If
   you change the grammar, change BOTH; there is a driven test for each.

   🔴 THE GLOBALS TRAP (CLAUDE.md). Nothing in this file may touch `Profile`,
   `spendGems`, `addRes` or any other legacy binding. They are top-level `const`
   in index.html — global LEXICAL bindings, not properties of `window` — so an
   ES module genuinely cannot see them, and `window.Profile` is undefined no
   matter how global `const Profile` looks. Every read and every write goes
   through the host object handed in by window.MythicCityBridge.
   ════════════════════════════════════════════════════════════════════════════ */

/* A cost entry may be a legacy NUMBER (Cinder only) or a resource dict.
   ALWAYS read costs through this — never index cost[] directly.
   Back-compat is not optional: existing saves and admin-published catalogs hold
   numbers, and a player on a week-old catalog must still be able to build. */
export function normCost(entry) {
  if (entry == null) return { cinder: 0 };
  if (typeof entry === 'number' || typeof entry === 'string') {
    const n = Number(entry);
    return { cinder: (isFinite(n) && n > 0) ? Math.floor(n) : 0 };
  }
  if (typeof entry !== 'object') return { cinder: 0 };
  const out = {};
  for (const k in entry) {
    if (!Object.prototype.hasOwnProperty.call(entry, k)) continue;
    const v = Number(entry[k]);
    // Zero / negative / NaN legs are dropped: a leg that is present but zero is
    // not a price, and it would render as an empty "⛓️ 0" chip.
    if (isFinite(v) && v > 0) out[k] = Math.floor(v);
  }
  return out;
}

const UNPRICED = 999999;   // an absent level stays unaffordable, never free

/* 🎚 THE ECONOMY DIAL — applied at the ONE place a cost is read.
   ────────────────────────────────────────────────────────────────────────────
   Buildings got harder to put up and cheaper in currency:
     • RESOURCES  ×2.5 — the real gate. You must PRODUCE your way to expansion.
     • CINDER     ÷3   — currency is no longer what stops you.

   WHY THE SPLIT, and it is the whole point: Cinder is farmable, so pricing
   expansion in Cinder meant farming Cinder bought expansion. Resources are
   produced by the very buildings you are trying to place, so pricing expansion
   in resources makes the city fund its own growth and turns output into a sink
   instead of a faucet.

   ⚠ APPLIED HERE, NOT BAKED INTO THE 51 COST ENTRIES, on purpose. One knob to
     turn, the authored numbers stay readable as the design intent, and there is
     no chance of a hand-edit desyncing one of three levels on one of 17
     buildings. canAfford/shortfall/spendCost all route through this function,
     so the UI and the spend can never disagree about the price.
   ⚠ Cinder is FLOORED AT 1 when the authored price was non-zero — a building
     that used to cost currency must never become literally free, or the sink
     disappears entirely rather than shrinking. */
export const RESOURCE_COST_MULT = 2.5;
export const CINDER_COST_DIV    = 3;

/* Resolve a building's cost at a 1-based level. */
export function buildingCostAt(def, level) {
  const arr = Array.isArray(def && def.cost) ? def.cost : [];
  const i = Math.max(0, (level | 0) - 1);
  // 🔴 A missing entry must be UNAFFORDABLE, not free. normCost(undefined)
  // returns { cinder: 0 }, and letting that through would turn "this level has
  // no price" into "this level is free" — strictly worse than the bug being fixed.
  if (arr[i] == null) return { cinder: UNPRICED };
  const base = normCost(arr[i]);
  const out = {};
  for (const k in base) {
    if (k === 'cinder') {
      out.cinder = Math.max(1, Math.floor(base.cinder / CINDER_COST_DIV));
    } else {
      out[k] = Math.max(1, Math.ceil(base[k] * RESOURCE_COST_MULT));
    }
  }
  return out;
}

/* Split a normalised dict into its Cinder leg and its resource legs. */
export function splitCost(cost) {
  cost = cost || {};
  const res = {};
  for (const k in cost) if (k !== 'cinder' && (cost[k] | 0) > 0) res[k] = cost[k] | 0;
  return { cinder: cost.cinder | 0, res };
}

/* Can the player pay the WHOLE basket? One answer for the UI and for the spend
   path, so a build button can never be enabled for a cost the spend will refuse. */
export function canAfford(host, cost) {
  const { cinder, res } = splitCost(cost);
  if (cinder > 0 && (host.gems() | 0) < cinder) return false;
  for (const k in res) if ((host.getRes(k) | 0) < res[k]) return false;
  return true;
}

/* Everything the player is short of, for the "you need N more" line. */
export function shortfall(host, cost) {
  const { cinder, res } = splitCost(cost);
  const out = {};
  if (cinder > 0) { const d = cinder - (host.gems() | 0); if (d > 0) out.cinder = d; }
  for (const k in res) { const d = res[k] - (host.getRes(k) | 0); if (d > 0) out[k] = d; }
  return out;
}

/* ════════════════════════════════════════════════════════════════════════════
   🔴 ATOMIC SPEND. Check every leg, THEN deduct; if any leg fails after
   deduction has begun, refund every leg already taken.
   §2: "A partial deduction on a failed build is the worst possible bug here."

   The order matters. Resources go first and Cinder last, because Cinder is the
   leg that can fail for reasons outside this function (a concurrent tab, a
   server wallet reconcile) — so it is the one most likely to trigger an unwind,
   and unwinding N resource legs is cheaper and safer than unwinding a Cinder
   spend that has already fired a cloud write-through.

   `simulateFailAt` exists ONLY for the driven atomicity test: it forces a leg to
   fail after earlier legs have been deducted, which is the exact path that can
   never be reached by ordinary play and therefore never gets exercised. It is a
   parameter rather than a global switch so no production call site can set it.
   ════════════════════════════════════════════════════════════════════════════ */
export function spendCost(host, cost, opts) {
  opts = opts || {};
  const failAt = opts.simulateFailAt || null;
  const { cinder, res } = splitCost(cost);

  // ── Phase 1: verify EVERYTHING before touching a single balance.
  if (cinder > 0 && (host.gems() | 0) < cinder) {
    return { ok: false, why: `Not enough Cinder — need ${cinder}, have ${host.gems() | 0}.` };
  }
  for (const k in res) {
    if ((host.getRes(k) | 0) < res[k]) {
      return { ok: false, why: `Not enough ${host.resName(k)} — need ${res[k]}, have ${host.getRes(k) | 0}.` };
    }
  }

  // ── Phase 2: deduct, recording each leg so it can be put back exactly.
  const taken = [];
  /* 🔴 REFUND USES host.refundRes, NOT host.addRes.
     addRes enforces the stash cap and returns WITHOUT ADDING when the vault is
     full — so a refund into a full vault silently evaporated. A driven test
     caught exactly that: 95 metal and 70 supplies deducted, "refunded", and
     gone. A refund is an UNDO of units the player held moments ago, so it must
     bypass the ceiling. Unwound in reverse so the ledger retraces its steps. */
  const refund = () => {
    for (let i = taken.length - 1; i >= 0; i--) {
      const t = taken[i];
      try {
        if (t.kind === 'res') { if (host.refundRes) host.refundRes(t.id, t.n); else host.addRes(t.id, t.n); }
        else host.addGems(t.n);
      } catch (e) {}
    }
    taken.length = 0;
  };

  for (const k in res) {
    if (failAt === k) { refund(); return { ok: false, why: `Simulated failure on ${k} — every deducted leg was refunded.`, refunded: true }; }
    if (!host.spendRes(k, res[k])) {
      refund();
      return { ok: false, why: `The ledger refused ${host.resName(k)} — every deducted leg was refunded.`, refunded: true };
    }
    taken.push({ kind: 'res', id: k, n: res[k] });
  }

  if (cinder > 0) {
    if (failAt === 'cinder') { refund(); return { ok: false, why: 'Simulated Cinder failure — every resource leg was refunded.', refunded: true }; }
    // spendGems() re-checks the balance and CAN still say no. That is precisely
    // the failure the refund above exists for.
    if (!host.spendGems(cinder)) {
      refund();
      return { ok: false, why: 'Cinder spend failed — every resource leg was refunded.', refunded: true };
    }
    taken.push({ kind: 'gems', n: cinder });
  }

  // The caller may still fail while RECORDING the purchase (a save throw, a bad
  // placement). Handing back `refund` means that path can unwind too, rather
  // than leaving the player paid-up with nothing built.
  return { ok: true, refund };
}

/* 🧾 THE COST LINE — every leg with its RESOURCES icon and colour, shortfalls
   in red with "(have n)" so a dead build button always states its reason.
   An invisible cost is the bug this whole file exists to prevent: a cost naming
   a resource the ledger has never heard of must SHOW, flagged, not silently
   vanish from the render while still blocking the build. */
export function costHtml(host, cost, opts) {
  opts = opts || {};
  cost = cost || {};
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const keys = Object.keys(cost).filter(k => (cost[k] | 0) > 0)
    .sort((a, b) => (a === 'cinder' ? -1 : b === 'cinder' ? 1 : 0));
  if (!keys.length) return '<span style="opacity:0.6">free</span>';
  return keys.map(id => {
    const need = cost[id] | 0;
    const got = (id === 'cinder') ? (host.gems() | 0) : (host.getRes(id) | 0);
    const short = got < need;
    const meta = (id === 'cinder')
      ? { name: 'Cinder', icon: '🔥', color: '#ffb347', known: true }
      : host.resMeta(id);
    const col = short ? '#e0556a' : (meta.color || '#cfd6e4');
    const warn = meta.known === false ? ' ⚠' : '';
    return `<span class="cprod-cost${short ? ' is-short' : ''}" style="color:${col};border-color:${short ? '#e0556a55' : 'rgba(255,255,255,0.12)'}" title="${esc(meta.name)}${meta.known === false ? ' — unknown resource id' : ''}">`
      + `<span class="cprod-cost-i">${meta.icon}</span><strong>${need}</strong>`
      + `${opts.withNames === false ? '' : `<span class="cprod-cost-n">${esc(meta.name)}</span>`}${warn}`
      + `${short ? `<span class="cprod-cost-have">(have ${got})</span>` : ''}</span>`;
  }).join('');
}
