/* ════════════════════════════════════════════════════════════════════════════
   🐄 HOMESTEAD FARM — pure helpers for the living layer: seasons, the farm's
   own weather, the seeded RNG the event windows use, and animal names.
   ----------------------------------------------------------------------------
   Everything here is a pure function of (seed, time). That is what makes an
   offline stretch replayable: two devices that both wake up after the same
   night roll the SAME fog, the SAME raid and the SAME fox, so the cloud merge
   never has to reconcile two different histories.
   ════════════════════════════════════════════════════════════════════════════ */

import { FARM_ECON } from './farm.data.js';

const H = 3600000;

export function hash32(str) {
  let h = 2166136261 >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
/* xorshift32 — tiny, deterministic, good enough for a fox. */
export function rngFor(seed) {
  let x = (hash32(seed) || 0x9e3779b9) >>> 0;
  return () => {
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    return (x >>> 0) / 4294967296;
  };
}
export function pickWeighted(rnd, table) {
  const keys = Object.keys(table);
  const total = keys.reduce((a, k) => a + (table[k].weight || 0), 0);
  let r = rnd() * total;
  for (const k of keys) { r -= (table[k].weight || 0); if (r <= 0) return k; }
  return keys[keys.length - 1];
}

/* 🍂 Season by calendar month. */
export function seasonFor(now) {
  const m = new Date(now || Date.now()).getMonth();
  const keys = Object.keys(FARM_ECON.seasons);
  for (const k of keys) if (FARM_ECON.seasons[k].months.indexOf(m) >= 0) return Object.assign({ key: k }, FARM_ECON.seasons[k]);
  return Object.assign({ key: keys[0] }, FARM_ECON.seasons[keys[0]]);
}

/* 🌦 Weather for the window containing `now`. */
export function weatherWindowIndex(now) { return Math.floor((now || Date.now()) / (FARM_ECON.weatherWindowH * H)); }
export function weatherAt(seed, now) {
  const idx = weatherWindowIndex(now);
  const key = pickWeighted(rngFor('wx:' + seed + ':' + idx), FARM_ECON.weather);
  return Object.assign({ key, idx, until: (idx + 1) * FARM_ECON.weatherWindowH * H }, FARM_ECON.weather[key]);
}

/* ⚔ Event windows crossed between `from` and `to` (exclusive of the one
   `from` sits in, inclusive of `to`'s). Each is rolled with its own seed. */
export function eventWindowsBetween(from, to) {
  const W = FARM_ECON.eventWindowH * H;
  const a = Math.floor(from / W), b = Math.floor(to / W);
  const out = [];
  for (let i = a + 1; i <= b && out.length < 400; i++) out.push({ idx: i, at: i * W });
  return out;
}

/* 🏷 Names. Seeded by animal id so the same beast keeps the same name on
   every device until the owner renames it. */
const NAMES = {
  chicken: ['Henrietta', 'Pecky', 'Marigold', 'Nugget', 'Dotty', 'Clementine', 'Biscuit', 'Peggy', 'Goldie', 'Feathers'],
  cow:     ['Buttercup', 'Daisy', 'Bessie', 'Clover', 'Maple', 'Duchess', 'Rosie', 'Marigold', 'Bramble', 'Juniper'],
  pig:     ['Wilbur', 'Truffle', 'Porkchop', 'Hamlet', 'Peppa', 'Rasher', 'Tubs', 'Pudding', 'Snout', 'Babe'],
  sheep:   ['Shaun', 'Woolly', 'Dolly', 'Fleece', 'Lamb Chop', 'Cotton', 'Merino', 'Baabara', 'Nimbus', 'Ewenice'],
  goat:    ['Billy', 'Nanny', 'Gruff', 'Pickles', 'Capra', 'Heidi', 'Rocky', 'Cinnamon', 'Butthead', 'Gizmo'],
  terrier: ['Scrappy', 'Biscuit', 'Rufus', 'Pip', 'Tilly'],
  collie:  ['Lassie', 'Fly', 'Meg', 'Skye', 'Bramble'],
  mastiff: ['Brutus', 'Bear', 'Hulk', 'Tank', 'Duchess'],
  donkey:  ['Eeyore', 'Benjamin', 'Dominic', 'Jenny', 'Balthazar'],
};
export function defaultName(sp, id) {
  const list = NAMES[sp] || ['Beast'];
  return list[hash32('nm:' + sp + ':' + id) % list.length];
}

/* 🏴 Rival raiders. Real camp names from Territory Wars when the bridge can
   supply them; otherwise bandit gangs, so the story never reads "undefined". */
const GANGS = ['the Ashfield Reavers', 'the Sludge Queen\'s runners', 'the Hollow Road gang', 'the Rustwater Cartel', 'Voss\'s deserters', 'the Cinder Foxes'];
export function rivalName(rnd, rivals) {
  const list = Array.isArray(rivals) ? rivals.filter(n => typeof n === 'string' && n.trim()) : [];
  if (list.length && rnd() < 0.7) return list[Math.floor(rnd() * list.length)];
  return GANGS[Math.floor(rnd() * GANGS.length)];
}

export function ageLabel(hours) {
  if (!(hours > 0)) return 'newborn';
  if (hours < 24) return Math.floor(hours) + 'h';
  const d = Math.floor(hours / 24);
  if (d < 60) return d + 'd';
  return Math.floor(d / 30) + 'mo';
}
