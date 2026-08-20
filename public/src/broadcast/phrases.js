/* ══════════════════════════════════════════════════════════════════════════
   ✍ PHRASES — the vocabulary the composer draws from.

   🔴 TEMPLATES COMPOSE, THEY ARE NOT PICKED WHOLE. Nothing in this file is a
   finished post. A body is built as

       frame( opener × clause × tail ) + hashtags

   where the opener and tail come from the poster's VOICE (voices.js), the
   clause comes from the SUBJECT and the SEVERITY BAND, and the hashtags come
   from the subject table. A pool of 40 finished sentences would be exhausted
   in one session; this multiplies out to thousands per subject and, more
   importantly, means the same event told by two different people genuinely
   reads as two different people rather than as the same person twice.

   SLOTS a clause may use:
     {tag}   the subject's canonical hashtag, INLINE — this is the reference's
             "Our #electricity production is not meeting demand", where the tag
             is part of the sentence rather than bolted on the end.
     {n}     A HEADCOUNT OF RESIDENTS, always, as a plain integer. The clause
             supplies the noun ("{n} residents", "{n} of us"). Keeping one slot
             to one unit is not tidiness: the first cut let each observer
             format {n} however it liked, and the Health Department published
             "4 residents residents cannot be treated" while the Food office
             published "we are 4 short on #food per cycle" about a headcount.
             Both composed correctly. Both were nonsense.
     {v}     THE EVENT'S OWN HEADLINE VALUE, already carrying its unit — "62%",
             "wave 7", "3". Whatever is not a count of people goes here.
     🔴 A clause containing {n} or {v} is DROPPED when the event has no number
        for it. It is never filled with a plausible one — a fabricated figure
        in a feed the player makes decisions on is the exact failure this
        module exists to avoid, and a silently-substituted "some" would hide
        it.
     {p}     a real place: a business name, a street name, a building. Same
             rule — no place, no clause.
     {w}     the weather's own name, from node-city's WEATHER table.

   ⚠ HASHTAGS ARE DERIVED, NOT SPRINKLED. Every tag in this file is `{tag}`;
     the literal words live in subjects.js so one problem has one tag. At most
     BCAST.feed.tagsMax per post — a post wearing five tags scans as spam and
     stops being a filter, which is the only thing tags are for.
   ══════════════════════════════════════════════════════════════════════════ */

/* Sentence frames. `{o}` opener, `{S}` clause, `{t}` tail. Empty openers and
   tails are legal and common — that is what makes the terse voice terse. */
export const FRAMES = [
  '{o} {S}.',
  '{S}.',
  '{o} {S} — {t}.',
  '{S} — {t}.',
  '{o} {S}, {t}.',
  '{S}, {t}.',
];

/* Intensity words, banded. The composer never picks across bands: a 4%
   shortfall cannot borrow "catastrophic" from the severe pool, because the
   adjective is part of the reading. */
export const INTENSITY = {
  mild:    ['a bit', 'slightly', 'a touch', 'marginally', 'here and there'],
  notable: ['badly', 'properly', 'seriously', 'really', 'noticeably'],
  severe:  ['catastrophically', 'completely', 'utterly', 'dangerously', 'totally'],
};

const B = (mild, notable, severe) => ({ mild, notable, severe });
const G = (good, great) => ({ good, great });

/* ══════════════════════════════════════════════════════════════════════════
   THE CLAUSE TABLE.
     cit   what a resident says
     dept  what the institution says — first person plural, factual, names the
           shortfall and the mitigation, per the reference's Electricity post
     biz   what a business says about itself
   ══════════════════════════════════════════════════════════════════════════ */
export const PHRASES = {

  power: {
    cit: {
      bad: B(
        ['the {tag} flickered again last night', 'my {tag} keeps dipping', 'the lights went {i} odd for a minute',
         'we lost {tag} for a bit this evening', 'the {tag} here is {i} unreliable'],
        ['the {tag} is out {i} more often than it is on', 'I have lost {tag} three times today',
         'nothing in my flat runs on the {tag} we actually get', 'the {tag} cuts out every time I need it',
         'we are {i} short of {tag} and everyone knows it'],
        ['there is no {tag} on this block at all', 'the {tag} has {i} failed here',
         'we have been in the dark for hours — the {tag} is gone', 'no {tag}, no heat, no answers',
         '{n} of us are sitting here with no {tag}']
      ),
      good: G(
        ['the {tag} has been steady all week', 'no {tag} cuts for days now', 'the {tag} here just works'],
        ['the {tag} has not so much as blinked', 'best {tag} I have had since I moved here',
         'whoever fixed the {tag} — thank you']
      ),
    },
    dept: {
      bad: B(
        ['{tag} production is running {i} under demand, so some load is being smoothed across the grid'],
        ['our {tag} production is not meeting demand, so we are forced to import some from our neighbours',
         'demand for {tag} has outrun what the city generates and we are shedding non-critical load',
         '{n} residents are short of {tag} at peak and we are managing it by rotation'],
        ['{tag} supply has {i} failed to meet demand and rolling outages are in effect',
         'the grid cannot carry the city as built — {tag} is being rationed block by block',
         '{n} residents are short of {tag}. Until generation is added, outages will continue']
      ),
      good: G(
        ['{tag} supply is comfortably ahead of demand across the city'],
        ['{tag} generation is holding a full reserve margin; no load is being shed anywhere']
      ),
    },
  },

  water: {
    cit: {
      bad: B(
        ['the {tag} pressure is {i} down again', 'my taps are running thin on {tag}',
         'the {tag} tastes of the pipe this week'],
        ['there is {i} not enough {tag} coming through', 'I queued for {tag} again this morning',
         '{n} of us are short of {tag} on this block'],
        ['we have no {tag} at all', 'the {tag} has {i} run out here', 'dry taps. No {tag}. Nobody has said why']
      ),
      good: G(
        ['the {tag} is clean and it keeps coming', 'no complaints about the {tag} for once'],
        ['best {tag} in the region and I will not be taking questions']
      ),
    },
    dept: {
      bad: B(
        ['{tag} draw is running slightly ahead of what the works can deliver'],
        ['we cannot meet the city’s {tag} demand — {n} residents short — and are prioritising homes over industry',
         '{tag} demand exceeds our pumping capacity and pressure is being reduced at peak'],
        ['the city is {i} short of {tag}. {n} residents are going unserved and rationing is in force',
         '{tag} reserves are exhausted at current draw. Additional capacity is required immediately']
      ),
      good: G(
        ['{tag} supply meets demand across every district'],
        ['{tag} capacity is well ahead of draw and the aquifers are recharging']
      ),
    },
  },

  /* 🚱 Extraction, spoken only by the department — a citizen cannot see an
     aquifer level, so `cit` is deliberately empty and subjects.js sets
     citizen:false to match. Every clause here talks about the GROUND, never
     about taps or rationing: that was the conflation that made this feed
     contradict the vitals card. */
  water_draw: {
    cit: { bad: B([], [], []), good: G([], []) },
    dept: {
      bad: B(
        ['we are drawing on the aquifer a little faster than it refills'],
        ['{n} units of demand are outrunning what the ground yields — reserves are falling'],
        ['extraction is {i} beyond the aquifer\'s recharge and the water table is dropping']
      ),
      good: G([], []),
    },
  },
  water_q: {
    cit: {
      bad: B(
        ['the {tag} has a taste to it'],
        ['I would not give this {tag} to a plant'],
        ['the {tag} coming out of my tap is {i} filthy']
      ),
      good: G([], []),
    },
    dept: {
      bad: B(
        ['groundwater purity has slipped; the {tag} is still within limits'],
        ['contamination has reached the aquifer we draw from and {tag} purity is falling'],
        ['{tag} purity is {i} compromised. Treatment cannot keep pace with what is entering the ground']
      ),
      good: G([], []),
    },
  },

  food: {
    cit: {
      bad: B(
        ['the shelves are thin on {tag} again', 'not much {tag} about this week'],
        ['I could not get {tag} anywhere today', 'we are {i} short of {tag} and it shows',
         '{n} of us went without {tag} today'],
        ['there is no {tag} left in this city', 'people are {i} going hungry — there is no {tag}']
      ),
      good: G(
        ['plenty of {tag} on the shelves', 'ate well tonight — no shortage of {tag}'],
        ['the {tag} in this city is better than anywhere I have lived']
      ),
    },
    dept: {
      bad: B(
        ['{tag} supply is a little behind demand; stocks are covering the gap for now'],
        ['{tag} production is not keeping pace with the population and reserves are drawing down',
         '{n} residents are not fed by what the city produces, and we are drawing on stored stock'],
        ['{tag} supply has {i} failed to meet demand. Reserves are gone and rationing is in effect']
      ),
      good: G(
        ['{tag} supply is meeting demand with stock in reserve'],
        ['{tag} production is comfortably ahead of what the city eats']
      ),
    },
  },

  health: {
    cit: {
      bad: B(
        ['the wait for {tag} is getting long'],
        ['I am appalled at how {tag} is run in this city. You never know if you are going to get treatment or not',
         'you cannot get seen. The {tag} here is {i} overstretched', '{n} of us have no {tag} cover at all'],
        ['there is no {tag} to speak of here', 'people are going untreated. The {tag} in this city has {i} collapsed']
      ),
      good: G(
        ['got seen the same day — the {tag} here is holding up'],
        ['the {tag} in this city is genuinely good and somebody should say so']
      ),
    },
    dept: {
      bad: B(
        ['{tag} capacity is a little short of need; waiting times have lengthened'],
        ['our {tag} capacity does not cover the population — {n} residents are outside our reach',
         'demand on {tag} exceeds what our clinics can treat and we are triaging'],
        ['{tag} provision has {i} failed. {n} residents cannot be treated at current capacity']
      ),
      good: G(
        ['{tag} capacity covers the city with margin'],
        ['every district is inside our {tag} coverage and waiting times are nil']
      ),
    },
  },

  safety: {
    cit: {
      bad: B(
        ['I would not walk this street after dark — not much {tag} about'],
        ['the {tag} here is {i} thin. Nobody comes when you call', '{n} of us live outside any {tag} patrol'],
        ['there is no {tag} in this district at all', 'we are {i} on our own out here. No {tag}, no patrols']
      ),
      good: G(
        ['felt safe walking home. Good {tag} on this street'],
        ['the {tag} here is the best thing about the city']
      ),
    },
    dept: {
      bad: B(
        ['{tag} patrols are stretched thin across the outer blocks'],
        ['our {tag} coverage does not reach every district — {n} residents are outside a patrol route'],
        ['{tag} coverage has {i} broken down. Most of the city is unpatrolled']
      ),
      good: G(
        ['every district is inside a {tag} patrol route', '{tag} coverage reaches the outer blocks again'],
        ['{tag} coverage is complete and response times are at target',
         'no district in the city is unpatrolled']
      ),
    },
  },

  leisure: {
    cit: {
      bad: B(
        ['not a lot to do around here. Could use some {tag}'],
        ['there is {i} nothing to do in this city. No {tag} worth the walk'],
        ['work, sleep, repeat. No {tag} at all in this place']
      ),
      good: G(
        ['plenty of free time', 'good week. Actually had time for some {tag}'],
        ['plenty of free time and somewhere to spend it', 'the {tag} in this city is worth staying for']
      ),
    },
    dept: {
      bad: B(
        ['{tag} provision is short of what the population is asking for'],
        ['{tag} capacity covers only part of the city — {n} residents have nothing within reach'],
        ['there is {i} no {tag} provision for the population as it now stands']
      ),
      good: G(
        ['{tag} provision meets demand citywide', '{tag} capacity is ahead of what residents are asking for'],
        ['every district has {tag} within walking distance', 'no resident is outside {tag} provision']
      ),
    },
  },

  light: {
    cit: {
      bad: B(
        ['a couple of the {tag} are out on my road'],
        ['half this district has no working {tag}', 'the {tag} here are {i} out and it is pitch dark'],
        ['there are no {tag} at all on this side of the city']
      ),
      good: G(
        ['the {tag} are all on and it makes a difference', 'walked home lit the whole way',
         'every lamp on my road works'],
        ['the {tag} here make the place feel looked after', 'not one dark corner on the whole walk home']
      ),
    },
    dept: {
      bad: B(
        ['{tag} coverage is short in the newer blocks'],
        ['{n} residents live outside {tag} coverage'],
        ['{tag} coverage has {i} fallen behind construction. Most new blocks are unlit']
      ),
      good: G(
        ['{tag} coverage reaches every built block', 'the newer blocks are inside {tag} coverage now'],
        ['the whole city is lit; no block is outside a lamp radius',
         '{tag} coverage is complete across the built area']
      ),
    },
  },

  air: {
    cit: {
      bad: B(
        ['the {tag} has a smell to it today'],
        ['you can taste the {tag} out here', 'the {tag} in this district is {i} bad and it is getting worse'],
        ['I cannot open a window. The {tag} is {i} unbreathable']
      ),
      good: G(
        /* 🔴 'I love the rain' WAS HERE AND IT WAS INVENTED. The verifier caught
           it firing three times in one run while `game.wx` and `window.WEATHER`
           were both null — this city has no weather state at all, and the post's
           own source was `pollution | citizen air exposure 0.004`, which says
           nothing about rain. A clause may only claim what its SOURCE observed;
           clean air is clean air, whatever the sky is doing. Restore the rain
           variant only when a real weather signal feeds this subject. */
        ['the {tag} is clear today and it is lovely', 'I can actually breathe out here — the {tag} is clean'],
        ['cleanest {tag} this city has had. Whatever changed, keep doing it']
      ),
    },
    dept: {
      bad: B(
        ['{tag} quality has slipped downwind of the industrial blocks'],
        ['{tag} quality is below standard across {v} of the city and health demand is rising with it'],
        ['{tag} quality has {i} failed in the residential districts. Exposure is at a level we would advise against']
      ),
      good: G(
        ['{tag} quality is within standard across every district',
         '{tag} readings are inside limits everywhere people live'],
        ['{tag} quality is excellent citywide', '{tag} readings have not been this clean since the city was founded']
      ),
    },
  },

  rent: {
    cit: {
      bad: B(
        ['{tag} has crept up again'],
        ['I cannot make the {tag} on what this city pays', '{tag} here is {i} more than the work is worth'],
        ['I am being priced out. The {tag} has {i} outrun my wages and I am going to have to go']
      ),
      good: G([], []),
    },
    dept: {
      bad: B(
        ['{tag} pressure is rising relative to local wages'],
        ['{n} residents left this cycle because {tag} outran what they earn'],
        ['{tag} burden has {i} exceeded what this city’s wages support. {n} residents have left over it']
      ),
      good: G([], []),
    },
  },

  jobs: {
    cit: {
      bad: B(
        ['there is not much work going at the moment'],
        ['I have been looking for {tag} for weeks', 'no {tag} anywhere in this city and I have tried'],
        ['there is {i} no {tag} here. {n} of us are looking and there is nothing']
      ),
      good: G(
        ['there is work about if you want it', 'saw three places hiring on the way in',
         'no shortage of {tag} at the moment', 'anyone looking for {tag} — there is plenty going'],
        ['plenty of {tag} going in this city right now', 'you can walk into work here',
         'this city cannot fill its {tag} fast enough']
      ),
    },
    dept: {
      bad: B(
        ['posted vacancies are running behind the number of people seeking work'],
        ['{n} residents are seeking work against the vacancies this city has posted'],
        ['unemployment has {i} outrun the vacancies available. {n} residents cannot find work here']
      ),
      good: G(
        ['vacancies exceed the number of residents seeking work'],
        ['{v} vacancies stand open against a labour force that is already fully employed']
      ),
    },
  },

  traffic: {
    cit: {
      bad: B(
        ['the commute is dragging a bit lately'],
        ['{i} stuck on the way in again — the {tag} on {p} is hopeless',
         'the {tag} in this city eats an hour of my day'],
        ['the roads have {i} seized up. Nothing moves']
      ),
      good: G(
        ['{tag} was clear this morning for once', '{p} moved properly today', 'no queue on {p} at all'],
        ['got across the whole city in minutes. Whoever planned these roads, well done',
         '{p} at rush hour and I did not stop once']
      ),
    },
    dept: {
      bad: B(
        ['{tag} on {p} is running above comfortable capacity at peak'],
        ['{p} is carrying more {tag} than it was built for and journey times are lengthening'],
        ['{tag} on {p} has {i} exceeded capacity. The corridor is at a standstill at peak']
      ),
      good: G(
        ['{tag} is flowing freely on every corridor', '{p} is running well under capacity at peak'],
        ['no corridor in the city is near its {tag} capacity', '{p} is clear even at rush hour']
      ),
    },
  },

  weather: {
    cit: {
      bad: B(
        ['this {w} is a nuisance'],
        ['the {w} is making everything harder today'],
        ['the {w} out there is {i} frightening. Stay in']
      ),
      good: G(
        ['I just love this {tag}! Not too hot, not too cold', 'lovely {tag} today', 'this {tag} is exactly right'],
        ['I just love this {tag}! Not too hot, not too cold', 'perfect {tag}. Perfect day. Nothing to complain about']
      ),
    },
    /* ⚠ THIS WAS B([], [], []) — an empty register. Nothing spoke for the
       weather desk because nothing ever posted as it; the forecast does, and an
       empty tier renders an empty post. The severe tier is the one a warning
       lands in (severity 0.9), and it is written to name the MITIGATION, which
       is the whole reason to warn early rather than report late. */
    dept: {
      bad: B(
        ['we are tracking a {w} off the city limits and will update as it turns'],
        ['a {w} is forming and expected to reach us shortly. Secure what you can'],
        ['EMERGENCY BROADCAST: a {w} is inbound. You have time to prepare — clear what will burn, '
          + 'move what you cannot replace, and keep crews off the open ground until it passes']
      ),
      good: G([], []),
    },
  },

  raid: {
    cit: {
      bad: B(
        ['heard the sirens again'],
        ['a {tag} came through and I did not sleep after it'],
        ['they broke the line. The {tag} got into the district and I am {i} shaken']
      ),
      good: G(
        ['the {tag} was held. Sleeping fine', 'they turned back at the line. Quiet night after that',
         'heard it end before it started'],
        ['the wall held and nobody was hurt. Good work out there',
         'they did not get past the perimeter and I slept through it']
      ),
    },
    dept: {
      bad: B(
        ['a raider probe was turned back at the perimeter'],
        ['wave {v} breached the defensive line and crews are assessing damage'],
        ['the defensive line has {i} failed. Wave {v} is inside the city and residents should shelter']
      ),
      good: G(['wave {v} was held at the line with no losses'], ['the siege was broken at wave {v}. The city is secure']),
    },
  },

  damage: {
    cit: {
      bad: B(
        ['there is a mess to clear up at {p}'],
        ['{p} took a hit and it is still standing there broken'],
        ['{p} is {i} destroyed. Nothing left of it']
      ),
      good: G([], []),
    },
    dept: {
      bad: B(
        ['minor damage reported at {p}; crews are scheduled'],
        ['{p} is out of service pending repair'],
        ['{p} has been {i} destroyed and will have to be rebuilt']
      ),
      good: G([], []),
    },
  },

  opening: {
    biz: {
      good: G(
        ['we are open at {p}', 'doors are open at {p}', '{p} is open for business'],
        ['we are open at {p} and we would love to see you', 'first day at {p} — come and find us']
      ),
      bad: B([], [], []),
    },
    dept: {
      good: G(['{p} has completed construction and is now in service'], ['{p} is open and trading']),
      bad: B([], [], []),
    },
  },

  hiring: {
    biz: {
      good: G(
        ['we are {tag} at {p}', '{p} has {n} seats to fill'],
        ['we are {tag} at {p} and we need people now']
      ),
      bad: B([], [], []),
    },
    dept: { good: G([], []), bad: B([], [], []) },
  },

  stock: {
    biz: {
      bad: B(
        ['we are running low on stock at {p}'],
        ['we cannot get supply at {p} and it is starting to show'],
        ['we have {i} run dry at {p}. Nothing is coming in']
      ),
      good: G([], []),
    },
    dept: { bad: B([], [], []), good: G([], []) },
  },

  market: {
    cit: {
      bad: B(
        ['prices have crept up again'],
        ['everything on the {tag} costs more than it did last cycle'],
        ['the {tag} has {i} run away from ordinary wages']
      ),
      good: G(['{tag} prices have eased off'], ['everything got cheaper this cycle and I am not complaining']),
    },
    dept: {
      bad: B(
        ['{p} is trading {v} above its base price'],
        ['{p} has moved {v} on the {tag} this cycle — supply is not meeting demand'],
        ['{p} has {i} spiked, {v} above base. Anything that consumes it is exposed']
      ),
      good: G(
        ['{p} has settled {v} below base on the {tag}'],
        ['{p} has fallen {v} — supply is comfortably ahead of demand']
      ),
    },
  },

  crash: {
    dept: {
      bad: B(
        ['one firm has entered distress this cycle'],
        ['{v} firms are in default and are cutting output',
         '{v} firms have failed. Their seats and their supply are gone with them'],
        ['{v} firms have {i} collapsed in a single cycle. This is a market-wide failure, not a bad quarter']
      ),
      good: G([], []),
    },
  },

  trade: {
    dept: {
      bad: B(
        ['import volumes are down on the previous cycle'],
        ['the city is importing to cover a domestic shortfall'],
        ['the city has {i} lost its outside connection. No goods are moving either way']
      ),
      good: G(
        ['imports are covering the city’s gaps and the route is clear'],
        ['{v} trade partners are active and every route is running']
      ),
    },
  },

  /* ── LIFE PATH. Written in the first person about the poster's own life.
        These are the posts the reference's "Shannon Durham" and "Steve Quinlan"
        rows are made of, and the ones the brief calls life-path integration. */
  grad: {
    cit: {
      good: G(
        ['I finished my course', 'that is my {tag} done', 'passed. Officially qualified'],
        ['I finished my course and I am looking for work already',
         'my {tag} came through — first in my family']
      ),
      bad: B([], [], []),
    },
  },

  hired: {
    cit: {
      good: G(
        ['I got taken on at {p}', 'started at {p} today', 'I have work again — {p}'],
        ['I got taken on at {p} and I could cry', 'first shift at {p} done and I am staying']
      ),
      bad: B([], [], []),
    },
  },

  laid: {
    cit: {
      bad: B(
        ['my hours at {p} got cut'],
        ['I lost my seat at {p}'],
        ['{p} let me go. I have nothing lined up and I am {i} worried']
      ),
      good: G([], []),
    },
  },

  movedin: {
    cit: {
      good: G(
        ['moved in today', 'new place on {p}. Hello, everyone', 'first night in the city'],
        ['moved in today and it already feels right', 'new place on {p} and I am not leaving']
      ),
      bad: B([], [], []),
    },
  },

  leaving: {
    cit: {
      bad: B(
        ['I am thinking about moving on'],
        ['I am leaving the city. It stopped working for me'],
        ['I am {i} done. Packing up and going — this place could not keep me']
      ),
      good: G([], []),
    },
  },

  mood: {
    cit: {
      bad: B(
        ['it has been a long week'],
        ['I am {i} worn down by this place'],
        ['I do not know how much more of this I can take']
      ),
      good: G(
        ['things are going alright, actually', 'good day today', 'no complaints from me'],
        ['best I have felt since I got here', 'this city is treating me well and I am staying']
      ),
    },
  },
};

/* The pools a given (subject, poster kind, polarity, band) has. Returns [] —
   never null — so a caller can test `.length` and fall through to a different
   poster rather than branch on two kinds of empty. */
export function clauses(subjectId, posterKind, pole, band) {
  const s = PHRASES[subjectId]; if (!s) return [];
  const byKind = s[posterKind]; if (!byKind) return [];
  const byPole = byKind[pole]; if (!byPole) return [];
  return byPole[band] || [];
}

export default { FRAMES, INTENSITY, PHRASES, clauses };
