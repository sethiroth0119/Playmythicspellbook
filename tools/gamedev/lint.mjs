#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// lint.mjs — cross-reference integrity for the game's data + effect system.
// The catalogs are plain data that reference each other by string id (a move
// applies a status id, a unit learns move ids, a card's onPlay names an effect
// id that the resolver must have a branch for). Nothing in the browser checks
// those strings — a typo silently becomes "this move does nothing". This does.
//
//   node tools/gamedev/lint.mjs            # human report, exit 1 on any ERROR
//   node tools/gamedev/lint.mjs --json
//   node tools/gamedev/lint.mjs --strict   # WARN also fails
//
// First run (2026-09-11) found a real one: MOVES.sunder applies status
// 'armorBreak', which STATUS_EFFECTS never defined — Sunder's "halves DEF for 2
// turns" had never happened. Keep that in mind when you are tempted to skip
// running this after a catalog edit.
//
// Rules are grouped by the catalog they protect. Each rule is a function that
// pushes {level, rule, msg}. Add a rule = add a function to RULES.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadEngine, argFlag, ROOT } from './headless.mjs';

const eng = loadEngine();
const src = eng.script.code;
const lines = src.split('\n');
const findings = [];
const err = (rule, msg) => findings.push({ level: 'ERROR', rule, msg });
const warn = (rule, msg) => findings.push({ level: 'WARN', rule, msg });
const info = (rule, msg) => findings.push({ level: 'INFO', rule, msg });

/** Source text of a top-level `function NAME` up to the next top-level function. */
function fnRegion(name) {
  const s = lines.findIndex((l) => l.startsWith('function ' + name + '('));
  if (s === -1) return null;
  let e = lines.findIndex((l, i) => i > s && /^function /.test(l));
  if (e === -1) e = lines.length;
  return { start: s, end: e, text: lines.slice(s, e).join('\n') };
}
const uniq = (arr) => [...new Set(arr)];
const idsOf = (list) => new Set((list || []).map((x) => x.id));
const ELEMENT_OK = new Set([...(eng.ELEMENTS || []), 'neutral', 'none']);   // 'neutral'/'none' are the typeless moves — deliberate
const FACTION_IDS = idsOf(eng.FACTIONS);
const RARITY_IDS = idsOf(eng.RARITIES);
const ONPLAY_IDS = idsOf(eng.ONPLAY_TYPES);
const STATUS = eng.STATUS_EFFECTS || {};
const MOVES = eng.MOVES || {};
const PASSIVES = eng.PASSIVES || {};

const RULES = {
  moves() {
    for (const [key, m] of Object.entries(MOVES)) {
      const tag = 'MOVES.' + key;
      if (m.id !== key) err('moves.key-id', tag + ': key "' + key + '" ≠ id "' + m.id + '"');
      if (!ELEMENT_OK.has(m.element)) err('moves.element', tag + ': element "' + m.element + '" is not in ELEMENTS');
      if (!['attack', 'ability', 'movement'].includes(m.kind)) err('moves.kind', tag + ': kind "' + m.kind + '" (expected attack|ability|movement)');
      if (m.type != null && !['physical', 'magic'].includes(m.type)) err('moves.type', tag + ': type "' + m.type + '" (expected physical|magic)');
      if ((m.power | 0) > 0 && !m.type) warn('moves.type-missing', tag + ': has power ' + m.power + ' but no damage type — calculateDamage will read ATK/DEF by default');
      for (const s of [m.applyStatus, ...(m.applyStatuses || []), m.spreadsStatus].filter(Boolean)) {
        if (!STATUS[s.id]) err('moves.status-ref', tag + ': applies status "' + s.id + '" which STATUS_EFFECTS does not define — the status silently never lands');
      }
      if (!m.desc) warn('moves.desc', tag + ': no desc (the card face and Forge tooltip will be blank)');
      if (typeof m.range !== 'number' || typeof m.cost !== 'number') err('moves.numeric', tag + ': range/cost must be numbers');
    }
  },
  statuses() {
    for (const [key, s] of Object.entries(STATUS)) {
      if (s.id !== key) err('statuses.key-id', 'STATUS_EFFECTS.' + key + ': key ≠ id "' + s.id + '"');
      if ((s.dmgMin != null) !== (s.dmgMax != null)) err('statuses.dot', 'STATUS_EFFECTS.' + key + ': dmgMin/dmgMax must come as a pair');
      if (s.dmgMin != null && !s.when) warn('statuses.when', 'STATUS_EFFECTS.' + key + ': DoT without `when` (turnStart|turnEnd)');
    }
    for (const [key, p] of Object.entries(PASSIVES)) if (p.id !== key) err('passives.key-id', 'PASSIVES.' + key + ': key ≠ id "' + p.id + '"');
  },
  cards() {
    const all = [];
    const pools = { UNIT_CARDS: eng.UNIT_CARDS, SPELL_CARDS: eng.SPELL_CARDS, TRAP_CARDS: eng.TRAP_CARDS, LOCATION_CARDS: eng.LOCATION_CARDS, WALL_CARDS: eng.WALL_CARDS, EVENT_CARDS: eng.EVENT_CARDS, WEATHER_CARDS: eng.WEATHER_CARDS, STARTER_HEROES: eng.STARTER_HEROES };
    for (const [pool, list] of Object.entries(pools)) {
      for (const c of list || []) {
        all.push({ pool, id: c.id });
        const tag = pool + '.' + c.id;
        (c.elements || []).forEach((e) => { if (!ELEMENT_OK.has(e)) err('cards.element', tag + ': element "' + e + '"'); });
        (c.factions || []).forEach((f) => { if (!FACTION_IDS.has(f)) err('cards.faction', tag + ': faction "' + f + '" not in FACTIONS'); });
        (c.learnset || []).forEach((l) => { if (!MOVES[l.m]) err('cards.learnset', tag + ': learnset move "' + l.m + '" not in MOVES'); });
        if (c.passive && !PASSIVES[c.passive]) err('cards.passive', tag + ': passive "' + c.passive + '" not in PASSIVES');
        if (c.onPlay && c.onPlay.type && !ONPLAY_IDS.has(c.onPlay.type)) err('cards.onplay', tag + ': onPlay.type "' + c.onPlay.type + '" not in ONPLAY_TYPES');
      }
    }
    const seen = {};
    all.forEach(({ pool, id }) => { (seen[id] = seen[id] || []).push(pool); });
    Object.entries(seen).filter(([, p]) => p.length > 1).forEach(([id, p]) => warn('cards.dup-id', 'card id "' + id + '" defined in ' + p.join(' + ') + ' — lookups by id are ambiguous'));
  },
  typeChart() {
    const chart = eng.TYPE_CHART || {}; const els = eng.ELEMENTS || [];
    els.forEach((a) => {
      if (!chart[a]) return err('typechart.row', 'TYPE_CHART has no row for element "' + a + '"');
      els.forEach((d) => { if (chart[a][d] == null) err('typechart.cell', 'TYPE_CHART.' + a + '.' + d + ' missing'); });
    });
    Object.keys(chart).forEach((a) => { if (!els.includes(a)) warn('typechart.extra', 'TYPE_CHART row "' + a + '" is not an ELEMENT'); });
  },
  effectRegistry() {
    // Every authorable effect id must have a handler branch; every handler
    // branch should be authorable (or it is dead code / a hidden internal).
    const raw = fnRegion('_applyOnPlayOneRaw');
    const trg = fnRegion('_applyTriggerEffect');
    if (!raw) return err('effects.region', 'could not find function _applyOnPlayOneRaw in index.html — the dispatcher moved; update lint.mjs');
    const handled = new Set([...raw.text.matchAll(/\beff\.type === '([A-Za-z_]+)'/g)].map((m) => m[1]));
    const trgCases = new Set(trg ? [...trg.text.matchAll(/case '([A-Za-z_]+)':/g)].map((m) => m[1]) : []);
    for (const t of eng.ONPLAY_TYPES || []) {
      if (!handled.has(t.id) && !trgCases.has(t.id)) err('effects.unhandled', 'ONPLAY_TYPES "' + t.id + '" has NO branch in _applyOnPlayOneRaw — authorable in the Forge but does nothing');
    }
    for (const id of handled) if (!ONPLAY_IDS.has(id)) warn('effects.unregistered', '_applyOnPlayOneRaw handles "' + id + '" but ONPLAY_TYPES does not list it — cannot be authored in the Forge editor (internal-only?)');
    const grouped = new Set((eng.ONPLAY_TYPE_GROUPS || []).flatMap((g) => g.ids));
    for (const id of grouped) if (!ONPLAY_IDS.has(id)) err('effects.group-ref', 'ONPLAY_TYPE_GROUPS lists "' + id + '" which is not in ONPLAY_TYPES');
    for (const t of eng.ONPLAY_TYPES || []) if (!grouped.has(t.id)) warn('effects.ungrouped', 'ONPLAY_TYPES "' + t.id + '" is in no ONPLAY_TYPE_GROUPS group — it falls into "🔧 Other" in the editor');
    const trgIds = idsOf(eng.TRIGGER_EFFECTS);
    for (const id of trgIds) if (!trgCases.has(id)) info('triggers.default', 'TRIGGER_EFFECTS "' + id + '" has no explicit case in _applyTriggerEffect (falls to default → _applyOnPlayOne)');
  },
  cardsets() {
    // cardsets/*.json are Forge import batches. public/cardsets is the served
    // copy — the two must stay byte-identical or players import stale cards.
    const dir = join(ROOT, 'cardsets'); const pub = join(ROOT, 'public', 'cardsets');
    if (!existsSync(dir)) return;
    // Classic vocabularies, read LIVE from the engine (they are Sets in index.html).
    // Spells resolve through card.effect: classic ids take the classic path, anything
    // else falls through to applyOnPlayEffect. Traps likewise. Units have ONLY the
    // on-play path, so a classic word on a unit resolves to nothing.
    const classicSpell = new Set(eng._CLASSIC_SPELL_FX || []);
    const classicTrap = new Set(eng._CLASSIC_TRAP_FX || []);
    const classic = new Set([...classicSpell, ...classicTrap]);
    const counter = new Set(['negate', 'riposte', 'repel', 'mirror', 'bounce']);   // counter-chain effects (grep `eff.type === 'riposte'`)
    const grave = idsOf(eng.IN_GRAVE_TRIGGERS);
    let total = 0; const counts = {};
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const a = readFileSync(join(dir, f), 'utf8');
      const pubFile = join(pub, f);
      if (!existsSync(pubFile)) err('cardsets.served', 'cardsets/' + f + ' has no copy in public/cardsets/ (not served)');
      else if (readFileSync(pubFile, 'utf8') !== a) err('cardsets.drift', 'cardsets/' + f + ' differs from public/cardsets/' + f + ' — copy it over');
      let cards; try { cards = JSON.parse(a); } catch (e) { err('cardsets.json', 'cardsets/' + f + ': invalid JSON — ' + e.message); continue; }
      counts[f] = cards.length; total += cards.length;
      cards.forEach((c, i) => {
        const tag = f + '#' + i + ' "' + c.name + '"';
        (c.elements || []).forEach((e) => { if (!ELEMENT_OK.has(e)) err('cardsets.element', tag + ': element "' + e + '"'); });
        // The importer keeps only known factions (`entity.factions.filter(f => FACTION_BY_ID[f])`),
        // so an unknown one is not a crash — the card just silently loses that tribe.
        (c.factions || []).forEach((x) => { if (!FACTION_IDS.has(x)) warn('cardsets.faction', tag + ': faction "' + x + '" is not in FACTIONS — the importer drops it silently, so tribe filters/synergies will not see this card'); });
        if (c.rarity && !RARITY_IDS.has(c.rarity)) err('cardsets.rarity', tag + ': rarity "' + c.rarity + '"');
        const effs = [c.onPlay, ...(c.onPlayExtra || [])].filter((e) => e && e.type);
        effs.forEach((e) => {
          if (!ONPLAY_IDS.has(e.type)) {
            const ct = c.type || 'unit';
            const okHere = (ct === 'spell' && classicSpell.has(e.type)) || (ct === 'trap' && classicTrap.has(e.type)) || (ct === 'counter' && counter.has(e.type));
            if (okHere) info('cardsets.onplay', tag + ': "' + e.type + '" is a classic ' + ct + ' word, not an on-play id — fine on a ' + ct + ' (resolves via card.effect)');
            else err('cardsets.onplay', tag + ' (' + ct + '): onPlay type "' + e.type + '" is not in ONPLAY_TYPES — _applyOnPlayOneRaw has no branch, the card resolves to NOTHING' + (e.type === 'draw' ? ' (use drawCards)' : e.type === 'destroyUnit' ? ' (use destroyTarget)' : ''));
          }
          if (e.status && !STATUS[e.status]) err('cardsets.status', tag + ': onPlay status "' + e.status + '" not in STATUS_EFFECTS');
        });
        if (c.effect && c.effect.type && !classic.has(c.effect.type) && !counter.has(c.effect.type) && !ONPLAY_IDS.has(c.effect.type)) warn('cardsets.effect', tag + ': effect.type "' + c.effect.type + '" is not a known classic/counter/onPlay vocabulary word');
        if (c.onGrave && c.onGrave.type && !grave.has(c.onGrave.type) && !ONPLAY_IDS.has(c.onGrave.type)) warn('cardsets.ongrave', tag + ': onGrave.type "' + c.onGrave.type + '" not in IN_GRAVE_TRIGGERS/ONPLAY_TYPES');
      });
    }
    const idx = join(pub, 'index.json');
    if (existsSync(idx)) {
      const j = JSON.parse(readFileSync(idx, 'utf8'));
      (j.sets || []).forEach((s) => { if (counts[s.file] != null && counts[s.file] !== s.cards) err('cardsets.index', 'public/cardsets/index.json says ' + s.file + ' has ' + s.cards + ' cards; file has ' + counts[s.file]); });
      if (j.totalCards != null && j.totalCards !== total) err('cardsets.index', 'public/cardsets/index.json totalCards=' + j.totalCards + ' but files hold ' + total);
    }
  },
  engineFreshness() {
    // The Colyseus server ships a generated copy of the catalogs. Stale = MP drift.
    const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'extract-engine-data.mjs'), '--check'], { encoding: 'utf8' });
    if (r.status !== 0) err('engine.stale', 'engine/colyseus catalogs are STALE vs index.html — run: node tools/extract-engine-data.mjs');
  },
};

for (const [name, fn] of Object.entries(RULES)) {
  try { fn(); } catch (e) { err('lint.' + name, 'rule crashed: ' + e.message); }
}

const by = (lvl) => findings.filter((f) => f.level === lvl);
if (argFlag('json')) console.log(JSON.stringify(findings, null, 1));
else {
  const order = ['ERROR', 'WARN', 'INFO'];
  order.forEach((lvl) => { const rows = by(lvl); if (!rows.length) return; console.log('\n' + lvl + ' (' + rows.length + ')'); rows.forEach((f) => console.log('  ' + (lvl === 'ERROR' ? '✗' : lvl === 'WARN' ? '!' : '·') + ' [' + f.rule + '] ' + f.msg)); });
  console.log('\n' + by('ERROR').length + ' error(s), ' + by('WARN').length + ' warning(s), ' + by('INFO').length + ' info   (' + Object.keys(RULES).length + ' rule groups, engine load ' + eng.loadMs + ' ms)');
}
process.exit(by('ERROR').length || (argFlag('strict') && by('WARN').length) ? 1 : 0);
