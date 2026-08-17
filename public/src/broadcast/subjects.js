/* ══════════════════════════════════════════════════════════════════════════
   🏷 SUBJECTS — what the feed is allowed to be about, and who owns each one.

   A subject is the join between an OBSERVATION (sources.js), a HASHTAG
   (phrases.js) and an INSTITUTION. Nothing composes a post about something
   that is not in this table, which is the structural half of "every post must
   trace to something real": there is no code path from a template to the feed
   that does not go through a subject id, and every subject id is produced by
   an observer reading live city state.

   🔴 THE HASHTAGS LIVE HERE, NOT IN THE TEMPLATES. The reference feed scans by
   tag (#electricity #air #healthcare #perfect #happylife), which only works if
   a tag means the same thing every time it appears. A template that invents
   its own tag would give the player two words for one problem and no way to
   tell they were the same. So a phrase asks for `{tag}` and the subject
   decides what that is.

   `dept` is the institutional poster for the subject, and it is deliberately
   ABSENT on some of them: there is no Department of Weather, and inventing one
   to fill a column would be the kind of plausible-looking invention this whole
   module is built to refuse. A subject with no dept can only ever be spoken
   about by a citizen.
   ══════════════════════════════════════════════════════════════════════════ */

/* Departments. `hue` is a 0..359 avatar colour, fixed per department so the
   Electricity Department is the same colour in every city — the player learns
   the colour before they read the name. */
export const DEPTS = {
  power:   { id: 'power',   name: 'Electricity Department', ico: '⚡', hue: 46 },
  water:   { id: 'water',   name: 'Water Department',       ico: '💧', hue: 198 },
  health:  { id: 'health',  name: 'Health Department',      ico: '🩹', hue: 344 },
  food:    { id: 'food',    name: 'Food & Markets Office',  ico: '🍱', hue: 92 },
  safety:  { id: 'safety',  name: 'Public Safety',          ico: '🛡️', hue: 220 },
  leisure: { id: 'leisure', name: 'Parks & Leisure',        ico: '🎵', hue: 286 },
  light:   { id: 'light',   name: 'Streetlighting',         ico: '💡', hue: 54 },
  env:     { id: 'env',     name: 'Environment Department', ico: '☁', hue: 160 },
  roads:   { id: 'roads',   name: 'Roads Department',       ico: '🛣', hue: 24 },
  housing: { id: 'housing', name: 'Housing Office',         ico: '🏠', hue: 12 },
  labour:  { id: 'labour',  name: 'Labour Exchange',        ico: '🔨', hue: 208 },
  market:  { id: 'market',  name: 'Market Watch',           ico: '📈', hue: 130 },
  trade:   { id: 'trade',   name: 'Trade Desk',             ico: '🚚', hue: 176 },
  works:   { id: 'works',   name: 'Municipal Works',        ico: '🏗', hue: 36 },
  civil:   { id: 'civil',   name: 'Civil Defence',          ico: '⚔️', hue: 0 },
};

/* ── THE SUBJECT TABLE ────────────────────────────────────────────────────
     id        the key an observer emits
     label     what a panel calls it
     tag       the INLINE hashtag ({tag} in a phrase)
     extraTags optional appended tags, drawn from — never invented
     dept      institutional poster, or null when there honestly isn't one
     scope     'city'   the reading is a citywide headcount
               'local'  the reading is the people at one place
               'person' the reading is one life and the people around it
     citizen   may a citizen speak about this at all
     poles     which polarities exist: complaints, contentment, or both */
export const SUBJECTS = {
  power:    { id: 'power',    label: 'Electricity', tag: 'electricity', extraTags: ['grid', 'blackout'], dept: 'power',   scope: 'city',   citizen: true,  poles: ['bad', 'good'] },
  water:    { id: 'water',    label: 'Water',       tag: 'water',       extraTags: ['taps'],             dept: 'water',   scope: 'city',   citizen: true,  poles: ['bad', 'good'] },
  food:     { id: 'food',     label: 'Food',        tag: 'food',        extraTags: ['groceries'],        dept: 'food',    scope: 'city',   citizen: true,  poles: ['bad', 'good'] },
  health:   { id: 'health',   label: 'Healthcare',  tag: 'healthcare',  extraTags: ['clinics'],          dept: 'health',  scope: 'city',   citizen: true,  poles: ['bad', 'good'] },
  safety:   { id: 'safety',   label: 'Safety',      tag: 'safety',      extraTags: ['patrols'],          dept: 'safety',  scope: 'city',   citizen: true,  poles: ['bad', 'good'] },
  leisure:  { id: 'leisure',  label: 'Free time',   tag: 'leisure',     extraTags: ['happylife'],        dept: 'leisure', scope: 'city',   citizen: true,  poles: ['bad', 'good'] },
  light:    { id: 'light',    label: 'Streetlights',tag: 'streetlights',extraTags: ['darkstreets'],      dept: 'light',   scope: 'city',   citizen: true,  poles: ['bad', 'good'] },
  air:      { id: 'air',      label: 'Air quality', tag: 'air',         extraTags: ['cleaner', 'smog'],  dept: 'env',     scope: 'city',   citizen: true,  poles: ['bad', 'good'] },
  water_q:  { id: 'water_q',  label: 'Water purity',tag: 'water',       extraTags: ['pollution'],        dept: 'env',     scope: 'city',   citizen: true,  poles: ['bad'] },
  rent:     { id: 'rent',     label: 'Rent',        tag: 'rent',        extraTags: ['housing'],          dept: 'housing', scope: 'city',   citizen: true,  poles: ['bad'] },
  jobs:     { id: 'jobs',     label: 'Work',        tag: 'jobs',        extraTags: ['hiring'],           dept: 'labour',  scope: 'city',   citizen: true,  poles: ['bad', 'good'] },
  traffic:  { id: 'traffic',  label: 'Traffic',     tag: 'traffic',     extraTags: ['commute'],          dept: 'roads',   scope: 'city',   citizen: true,  poles: ['bad', 'good'] },
  weather:  { id: 'weather',  label: 'Weather',     tag: 'weather',     extraTags: ['perfect'],          dept: null,      scope: 'city',   citizen: true,  poles: ['bad', 'good'] },
  raid:     { id: 'raid',     label: 'Raiders',     tag: 'raid',        extraTags: ['defence'],          dept: 'civil',   scope: 'city',   citizen: true,  poles: ['bad', 'good'] },
  damage:   { id: 'damage',   label: 'Damage',      tag: 'damage',      extraTags: ['repairs'],          dept: 'works',   scope: 'local',  citizen: true,  poles: ['bad'] },
  opening:  { id: 'opening',  label: 'New business',tag: 'openingday',  extraTags: ['nowopen'],          dept: 'works',   scope: 'local',  citizen: false, poles: ['good'] },
  stock:    { id: 'stock',    label: 'Supply',      tag: 'supply',      extraTags: ['shortage'],         dept: 'market',  scope: 'local',  citizen: false, poles: ['bad'] },
  hiring:   { id: 'hiring',   label: 'Hiring',      tag: 'hiring',      extraTags: ['jobs'],             dept: 'labour',  scope: 'local',  citizen: false, poles: ['good'] },
  market:   { id: 'market',   label: 'Prices',      tag: 'market',      extraTags: ['prices'],           dept: 'market',  scope: 'city',   citizen: true,  poles: ['bad', 'good'] },
  crash:    { id: 'crash',    label: 'Insolvency',  tag: 'crash',       extraTags: ['market'],           dept: 'market',  scope: 'city',   citizen: false, poles: ['bad'] },
  trade:    { id: 'trade',    label: 'Trade',       tag: 'trade',       extraTags: ['imports'],          dept: 'trade',   scope: 'city',   citizen: false, poles: ['bad', 'good'] },
  /* ── life path. scope 'person': the reading is ONE life. See likes.js. ── */
  grad:     { id: 'grad',     label: 'Graduation',  tag: 'graduation',  extraTags: ['newstart'],         dept: null,      scope: 'person', citizen: true,  poles: ['good'] },
  hired:    { id: 'hired',    label: 'New job',     tag: 'newjob',      extraTags: ['work'],             dept: null,      scope: 'person', citizen: true,  poles: ['good'] },
  laid:     { id: 'laid',     label: 'Lost work',   tag: 'laidoff',     extraTags: ['jobs'],             dept: null,      scope: 'person', citizen: true,  poles: ['bad'] },
  movedin:  { id: 'movedin',  label: 'Moved in',    tag: 'newhome',     extraTags: ['hello'],            dept: null,      scope: 'person', citizen: true,  poles: ['good'] },
  leaving:  { id: 'leaving',  label: 'Leaving',     tag: 'movingout',   extraTags: ['goodbye'],          dept: null,      scope: 'person', citizen: true,  poles: ['bad'] },
  mood:     { id: 'mood',     label: 'How it goes', tag: 'cityliving',  extraTags: ['happylife'],        dept: null,      scope: 'person', citizen: true,  poles: ['bad', 'good'] },
};

export function subjectOf(id) { return SUBJECTS[String(id)] || null; }
export function deptOf(id) {
  const s = subjectOf(id);
  return (s && s.dept && DEPTS[s.dept]) || null;
}
export function subjectIds() { return Object.keys(SUBJECTS); }

export default { SUBJECTS, DEPTS, subjectOf, deptOf, subjectIds };
