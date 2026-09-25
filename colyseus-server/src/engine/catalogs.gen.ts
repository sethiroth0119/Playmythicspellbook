// ─────────────────────────────────────────────────────────────────────────────
// Typed re-export of the GENERATED engine catalogs (catalogs.gen.json), which is
// extracted verbatim from public/index.html by tools/extract-engine-data.mjs.
// This is the DRIFT-FREE source of engine DATA for the server.
//
// The hand-mirrored catalogs.ts is kept for now; test/catalog-parity.mjs diffs the
// two so we KNOW the hand-mirror matches the live client before retiring it. Once
// parity is green and consumers are switched over, catalogs.ts's data literals can
// be deleted and this becomes the only source.
// ─────────────────────────────────────────────────────────────────────────────
import gen from './catalogs.gen.json';

export const STATUS_EFFECTS = gen.STATUS_EFFECTS as Record<string, any>;
export const PASSIVES = gen.PASSIVES as Record<string, any>;
export const WEATHERBORN_PASSIVES = gen.WEATHERBORN_PASSIVES as Record<string, any>;
export const ELEMENTS = gen.ELEMENTS as string[];
export const STRONG_VS = gen.STRONG_VS as Record<string, string[]>;
export const TYPE_CHART = gen.TYPE_CHART as Record<string, Record<string, number>>;
export const TYPE_IMMUNITIES = (gen as any).TYPE_IMMUNITIES as Record<string, string[]>;
export const MOVES = gen.MOVES as Record<string, any>;

export default gen;
