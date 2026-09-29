/* ════════════════════════════════════════════════════════════════════════════
   SUPPLY CHAIN · data.js — assembles the REAL wave-1 modules into the `data`
   bundle every derived piece takes: {catalog, businesses, recipes, coverage,
   shipping, loot, graph}.

   WHY THIS IS A SEPARATE FILE FROM graph.js. graph.js takes its siblings as
   parameters so a test can hand it a mutated copy and watch the matching report
   row turn red. Something still has to import the real ones; doing it here, in
   one place, means no view and no derived piece (partners, plan, proposal) ever
   imports a truth file on its own and ends up reading a different catalogue
   from the one the graph was built with.

   Pure: imports only pure siblings, plus ONE read-only game file (the city's
   building catalogue, see the import below). Never the bridge — live facts are
   INJECTED:
     liveCatalog  rows / {rows,…} from the bridge (resources(), salvageRes()…);
                  catalog.withLive() lets the running game override the snapshot
     ctx          shipping session facts, e.g. shipping.sessionCtx(bridge)
                  (offline / signed-out only ever LOWER what is shown as enforced)
     opsEcon      {opId:{inputs,yields}} so recipes can re-check itself live
     systemMakes / channelScope   test overrides for SYSTEM_MAKES / CHANNEL_SCOPE
   ════════════════════════════════════════════════════════════════════════════ */

import * as catalogMod from './catalog.js';
import * as businesses from './businesses.js';
import * as recipes from './recipes.js';
import * as coverage from './coverage.js';
import * as shipping from './shipping.js';
import * as loot from './loot.js';
import { buildGraph } from './graph.js';
/* THE ONE IMPORT FROM OUTSIDE THIS FOLDER, read-only. It is the game's own
   catalogue of city buildings. WHY NOT A HAND-TYPED LIST in loot.js or
   recipes.js: round 3 had exactly one city-made id written down (ingots) and the
   map therefore showed the City Builder producing one thing, while this file
   lists 130 ids that city buildings bank into the player's ledger — cloth from
   the Textile Mill among them, the owner's own example resource. A typed copy
   would be stale the day a building is added; this cannot drift. It is pure
   (its only import is the pure chain catalogue), so Node still imports data.js. */
import { CITY_PRODUCTION } from '../city/production.data.js';

/* The sentences in the owner's goal that name a concrete route. graph.js turns
   each into a hard check (owner-example-broken) so the one flow the owner will
   look for first cannot silently re-route. WHY HERE and not in graph.js: that
   file authors no fact, and this is not a game fact either — it is the brief,
   quoted. Add a row only for something the owner actually wrote. */
export const OWNER_EXAMPLES = Object.freeze([
  Object.freeze({ res: 'cloth', from: 'fashion', to: 'medical',
    quote: 'the fashion designer company can produce cloth and can send through transport to medical company', cite: 'owner goal, verbatim' }),
  /* The PDF's own worked example (p1 and p3), in two halves because it IS two
     hops: a truck lane, then a sale over a marketplace counter to players.
     `sale:true` = check the channel edge and its onward edge to the buyers, not a
     truck lane and not a coverage use (battlers buy a car as an item). */
  Object.freeze({ res: 'cars', from: 'carfactory', to: 'cars',
    quote: 'a car dealership purchases vehicles from a car factory', cite: 'owner PDF p1 / p3 (Just Business), verbatim' }),
  Object.freeze({ res: 'cars', from: 'cars', to: 'sys:battle', sale: true,
    quote: 'and sells them to players for battles and delivery missions', cite: 'owner PDF p1 / p3 (Just Business), verbatim' }),
]);

/* WHAT EACH SYSTEM MAKES that is not a business recipe and not a drop. Today
   that is the City Builder: every `yields` key of every city building, with the
   building named so a card can say "City Builder (Textile Mill)". Deterministic:
   catalogue order of the game's own array, first building wins the label, the
   rest are kept in `alsoBy`. No yield AMOUNT is copied — contract rule 2. */
const CITY_CITE = 'CITY_PRODUCTION yields (public/src/city/production.data.js) — collected into the player ledger';
function cityMakes() {
  const byId = new Map();
  for (const b of Array.isArray(CITY_PRODUCTION) ? CITY_PRODUCTION : []) {
    for (const id of Object.keys((b && b.yields) || {})) {
      if (!byId.has(id)) byId.set(id, { id, by: b.name || b.id, building: b.id, alsoBy: [], live: true, cite: CITY_CITE });
      else byId.get(id).alsoBy.push(b.name || b.id);
    }
  }
  return Array.from(byId.values());
}
export const SYSTEM_MAKES = Object.freeze({ 'sys:city': Object.freeze(cityMakes().map((r) => Object.freeze(r))) });

/* HOW A MARKETPLACE ICON IS READ when it narrows what is sold there. Not a game
   fact and not invented cargo: it is the PDF legend, quoted, the same way
   OWNER_EXAMPLES quotes the goal. Round 3 copied a seller's whole product list
   onto the Car Marketplace, so the map said wheat, eggs and asphalt are sold
   from a tow truck. Families come from catalog.family(). A tile left with
   nothing in scope is drawn with an EMPTY counter and a note if its icon is an
   open ambiguity (D: Agri and Home Feed), and is an error otherwise. */
export const CHANNEL_SCOPE = Object.freeze({
  'ch:carmarket': Object.freeze({ families: Object.freeze(['vehicle', 'energy']),
    why: 'The legend icon is a tow truck carrying a car: vehicles, and the fuel that goes in them.', cite: 'owner PDF p6 legend, Car Marketplace' }),
});

/* The catalogue slot keeps the module's helpers (byId, family, colorOf) but its
   ROWS can be swapped for the live ones. A plain object, because a module
   namespace cannot be extended. */
function catalogFor(liveCatalog) {
  if (!liveCatalog) return catalogMod;
  let live = null;
  try { live = catalogMod.withLive(liveCatalog); } catch (_) { live = null; }
  /* withLive() returns a catalogue object; anything unexpected falls back to the
     snapshot rather than blanking the map. */
  const rows = live && (Array.isArray(live) ? live : typeof live.all === 'function' ? live.all() : live.CATALOG || live.rows);
  if (!Array.isArray(rows) || !rows.length) return catalogMod;
  const byId = new Map(rows.map((r) => [r.id, r]));
  return Object.assign({}, catalogMod, {
    CATALOG: rows, all: () => rows, byId: (id) => byId.get(id) || null, has: (id) => byId.has(id), liveOverride: true,
  });
}

export function assemble(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const data = {
    catalog: catalogFor(o.liveCatalog), businesses, recipes, coverage, shipping, loot,
    ctx: o.ctx && typeof o.ctx === 'object' ? o.ctx : undefined,
    opsEcon: o.opsEcon && typeof o.opsEcon === 'object' ? o.opsEcon : undefined,
    ownerExamples: Array.isArray(o.ownerExamples) ? o.ownerExamples : OWNER_EXAMPLES,
    systemMakes: o.systemMakes && typeof o.systemMakes === 'object' ? o.systemMakes : SYSTEM_MAKES,
    channelScope: o.channelScope && typeof o.channelScope === 'object' ? o.channelScope : CHANNEL_SCOPE,
    /* pin:false = build it, but do not make it the graph the one-argument
       neighbours(id) / resourceFlow(id) fall back to (graph.js, STALENESS). A
       what-if or test bundle must never replace the map a view is showing.
       Views should not depend on the pin at all: call data.graph.resourceFlow(id). */
    pin: o.pin === false ? false : undefined,
  };
  data.graph = buildGraph(data);
  return data;
}

/* The snapshot-only bundle, built once. Node tests and the first paint use it;
   the shell calls assemble({liveCatalog, ctx}) again once the bridge is ready. */
let _static = null;
export function getData() { return _static || (_static = assemble()); }

export default getData;
