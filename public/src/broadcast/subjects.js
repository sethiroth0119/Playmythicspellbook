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
  /* 🪦 The office that registers a death and finds it a plot. hue 262 —
     checked against the fifteen above (0/12/24/36/46/54/92/130/160/176/198/
     208/220/286/344) rather than picked; the nearest is Parks at 286 and 24°
     of hue is a distinguishable avatar at 28px. */
  death:   { id: 'death',   name: 'Registry & Deathcare',   ico: '🪦', hue: 262 },
};

/* ── THE SUBJECT TABLE ────────────────────────────────────────────────────
     id        the key an observer emits
     label     what a panel calls it
     tag       the INLINE hashtag ({tag} in a phrase)
     tagsBad   appended tags legal on a COMPLAINT — drawn from, never invented
     tagsGood  appended tags legal on a CONTENTED post. Split by polarity
               because one shared list put "#smog" on "the air is clear today"
               and "#happylife" on "there is no leisure provision" — both
               composed correctly, both flatly wrong, and both invisible in a
               diff of the template that produced them.
     dept      institutional poster, or null when there honestly isn't one
     scope     'city'   the reading is a citywide headcount
               'local'  the reading is the people at one place
               'person' the reading is one life and the people around it
     citizen   may a citizen speak about this at all
     poles     which polarities exist: complaints, contentment, or both */
export const SUBJECTS = {
  power:    { id: 'power',    label: 'Electricity', tag: 'electricity', tagsBad: ['grid', 'blackout'], tagsGood: ['grid'], dept: 'power',   scope: 'city',   citizen: true,  poles: ['bad', 'good'] },
  water:    { id: 'water',    label: 'Water',       tag: 'water',       tagsBad: ['taps'], tagsGood: ['taps'],             dept: 'water',   scope: 'city',   citizen: true,  poles: ['bad', 'good'] },
  food:     { id: 'food',     label: 'Food',        tag: 'food',        tagsBad: ['groceries'], tagsGood: ['groceries'],        dept: 'food',    scope: 'city',   citizen: true,  poles: ['bad', 'good'] },
  health:   { id: 'health',   label: 'Healthcare',  tag: 'healthcare',  tagsBad: ['clinics'], tagsGood: ['clinics'],          dept: 'health',  scope: 'city',   citizen: true,  poles: ['bad', 'good'] },
  safety:   { id: 'safety',   label: 'Safety',      tag: 'safety',      tagsBad: ['patrols'], tagsGood: ['patrols'],          dept: 'safety',  scope: 'city',   citizen: true,  poles: ['bad', 'good'] },
  leisure:  { id: 'leisure',  label: 'Free time',   tag: 'leisure',     tagsBad: ['nothingtodo'], tagsGood: ['happylife'],        dept: 'leisure', scope: 'city',   citizen: true,  poles: ['bad', 'good'] },
  light:    { id: 'light',    label: 'Streetlights',tag: 'streetlights',tagsBad: ['darkstreets'], tagsGood: ['welllit'],      dept: 'light',   scope: 'city',   citizen: true,  poles: ['bad', 'good'] },
  air:      { id: 'air',      label: 'Air quality', tag: 'air',         tagsBad: ['smog'], tagsGood: ['cleaner', 'perfect'],  dept: 'env',     scope: 'city',   citizen: true,  poles: ['bad', 'good'] },
  water_q:  { id: 'water_q',  label: 'Water purity',tag: 'water',       tagsBad: ['pollution'], tagsGood: [],        dept: 'env',     scope: 'city',   citizen: true,  poles: ['bad'] },
  /* 🚱 OVER-EXTRACTION, not thirst. Kept separate from `water` because they are
     two problems with two fixes: `water` is "the taps are dry" (node-city's own
     coverage), this is "we are pumping the aquifer faster than it recharges"
     (the hydrology module's draw-vs-capacity). One post claiming both is what
     made the feed's loudest recurring line contradict the vitals card. A
     department speaks it; a citizen cannot see an aquifer level. */
  water_draw:{ id: 'water_draw', label: 'Water extraction', tag: 'water', tagsBad: ['aquifer'], tagsGood: [], dept: 'water', scope: 'city', citizen: false, poles: ['bad'] },
  /* 🪦 DEATHCARE — the city's own interment capacity against the rate people
     die at, i.e. node-city's eighth NEED read exactly like the other seven
     (fromCoverage). Kept SEPARATE from `death` below for the same reason
     `water` and `water_draw` are separate: this is "there is nowhere to bury
     anybody", which is a thing the player fixes by building a graveyard; that
     is "somebody died", which is a life and is nobody's fault. One post
     claiming both would be the feed's loudest line contradicting the vitals
     card, which is the bug the water split already fixed once. */
  deathcare:{ id: 'deathcare', label: 'Deathcare',  tag: 'deathcare',   tagsBad: ['unburied', 'graves'], tagsGood: ['restinpeace'], dept: 'death', scope: 'city', citizen: true, poles: ['bad', 'good'] },
  rent:     { id: 'rent',     label: 'Rent',        tag: 'rent',        tagsBad: ['housing'], tagsGood: [],          dept: 'housing', scope: 'city',   citizen: true,  poles: ['bad'] },
  jobs:     { id: 'jobs',     label: 'Work',        tag: 'jobs',        tagsBad: ['nowork'], tagsGood: ['hiring'],           dept: 'labour',  scope: 'city',   citizen: true,  poles: ['bad', 'good'] },
  traffic:  { id: 'traffic',  label: 'Traffic',     tag: 'traffic',     tagsBad: ['commute'], tagsGood: ['commute'],          dept: 'roads',   scope: 'city',   citizen: true,  poles: ['bad', 'good'] },
  weather:  { id: 'weather',  label: 'Weather',     tag: 'weather',     tagsBad: ['storm'], tagsGood: ['perfect'],          dept: null,      scope: 'city',   citizen: true,  poles: ['bad', 'good'] },
  raid:     { id: 'raid',     label: 'Raiders',     tag: 'raid',        tagsBad: ['defence'], tagsGood: ['defence'],          dept: 'civil',   scope: 'city',   citizen: true,  poles: ['bad', 'good'] },
  damage:   { id: 'damage',   label: 'Damage',      tag: 'damage',      tagsBad: ['repairs'], tagsGood: [],          dept: 'works',   scope: 'local',  citizen: true,  poles: ['bad'] },
  opening:  { id: 'opening',  label: 'New business',tag: 'openingday',  tagsBad: [], tagsGood: ['nowopen'],          dept: 'works',   scope: 'local',  citizen: false, poles: ['good'] },
  stock:    { id: 'stock',    label: 'Supply',      tag: 'supply',      tagsBad: ['shortage'], tagsGood: [],         dept: 'market',  scope: 'local',  citizen: false, poles: ['bad'] },
  hiring:   { id: 'hiring',   label: 'Hiring',      tag: 'hiring',      tagsBad: [], tagsGood: ['jobs'],             dept: 'labour',  scope: 'local',  citizen: false, poles: ['good'] },
  market:   { id: 'market',   label: 'Prices',      tag: 'market',      tagsBad: ['prices'], tagsGood: ['prices'],           dept: 'market',  scope: 'city',   citizen: true,  poles: ['bad', 'good'] },
  crash:    { id: 'crash',    label: 'Insolvency',  tag: 'crash',       tagsBad: ['market'], tagsGood: [],           dept: 'market',  scope: 'city',   citizen: false, poles: ['bad'] },
  trade:    { id: 'trade',    label: 'Trade',       tag: 'trade',       tagsBad: ['imports'], tagsGood: ['imports'],          dept: 'trade',   scope: 'city',   citizen: false, poles: ['bad', 'good'] },
  /* ── life path. scope 'person': the reading is ONE life. See likes.js. ── */
  grad:     { id: 'grad',     label: 'Graduation',  tag: 'graduation',  tagsBad: [], tagsGood: ['newstart'],         dept: null,      scope: 'person', citizen: true,  poles: ['good'] },
  hired:    { id: 'hired',    label: 'New job',     tag: 'newjob',      tagsBad: [], tagsGood: ['work'],             dept: null,      scope: 'person', citizen: true,  poles: ['good'] },
  laid:     { id: 'laid',     label: 'Lost work',   tag: 'laidoff',     tagsBad: ['jobs'], tagsGood: [],             dept: null,      scope: 'person', citizen: true,  poles: ['bad'] },
  movedin:  { id: 'movedin',  label: 'Moved in',    tag: 'newhome',     tagsBad: [], tagsGood: ['hello'],            dept: null,      scope: 'person', citizen: true,  poles: ['good'] },
  leaving:  { id: 'leaving',  label: 'Leaving',     tag: 'movingout',   tagsBad: ['goodbye'], tagsGood: [],          dept: null,      scope: 'person', citizen: true,  poles: ['bad'] },
  /* ⚰ A DEATH. Person-scope, and the ONE life event with a department on it.
     🔴 WHY THE REGISTRY SPEAKS AND NOT A RESIDENT. Every other person-scope
     subject is written in the FIRST PERSON about the poster's own life (see
     phrases.js, "I finished my course", "I am leaving the city") — and the
     poster of a death cannot be its subject. Handing it to a mourner instead
     would mean this module choosing, from a mood-weighted draw, which resident
     was close to the deceased; the game has no relationship state to support
     that claim, and inventing one is exactly what phrases.js's {p} rule
     forbids. So the institution states it, factually, and names them. The
     GRIEF, such as the city models it, is the deathcare shortfall above and
     the mood term node-city added in the same change.
     `citizen: false` for that reason — the cit pool would be an invention.
     ⚠ Before this subject existed, /src/broadcast/sources.js fromRoster()
       published every death as subject 'leaving' with poster sub "former
       resident" and the body "I am leaving the city. It stopped working for
       me." Ship the two together or the feed goes on lying. */
  death:    { id: 'death',    label: 'A death',     tag: 'inmemoriam',  tagsBad: ['deathcare'], tagsGood: [],        dept: 'death',   scope: 'person', citizen: false, poles: ['bad'] },
  mood:     { id: 'mood',     label: 'How it goes', tag: 'cityliving',  tagsBad: ['worndown'], tagsGood: ['happylife'],        dept: null,      scope: 'person', citizen: true,  poles: ['bad', 'good'] },
};

export function subjectOf(id) { return SUBJECTS[String(id)] || null; }
export function deptOf(id) {
  const s = subjectOf(id);
  return (s && s.dept && DEPTS[s.dept]) || null;
}
export function subjectIds() { return Object.keys(SUBJECTS); }

export default { SUBJECTS, DEPTS, subjectOf, deptOf, subjectIds };
