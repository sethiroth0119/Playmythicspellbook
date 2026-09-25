export const meta = {
  name: 'ruin-ledger-theme-gauntlet',
  description: 'Survey every screen against DESIGN-BAR.md, then builder/critic rounds until each wins',
  phases: [
    { title: 'Survey', detail: 'a lead agent decides the decomposition and scores every screen' },
    { title: 'Improve', detail: 'builder + fresh-context critic per piece, looping until the critic passes' },
    { title: 'Verify', detail: 'all syntax gates + drivers on the finished tree' },
  ],
};

/* ══════════════════════════════════════════════════════════════════════════
   ⚠ TWO ARCHITECTURE CONSTRAINTS, chosen for CORRECTNESS not for style —
   everything else is left to the lead agent as asked.

   1. public/index.html is ONE 14.6 MB file. Two builders editing it at the same
      time will clobber each other, and the loser is silent. So work items that
      touch it run SEQUENTIALLY; everything else (node-city, corp/*.jsx,
      src/**, css) runs in parallel.
   2. NOTHING DEPLOYS. This is an unsupervised overnight run against a live
      game. Every agent is told, in its own prompt, that deploy.mjs is
      forbidden — a branch the owner reviews in the morning is the deliverable.
   ══════════════════════════════════════════════════════════════════════════ */

const RULES = `
HARD RULES — these outrank the task.
- Branch: gauntlet-theme-pass. NEVER checkout/merge another branch.
- NEVER run deploy.mjs, wrangler, npm run deploy, or bump version.txt /
  BUILD_VERSION / sw.js CACHE_VERSION / NC_BUILD. The owner deploys, not you.
- node is not on PATH. Prefix every command:
    export PATH="$PATH:/c/Program Files/nodejs";
- After ANY edit, run the gates that cover what you touched:
    node _synckcheck.mjs                            (public/index.html)
    node _synckcheck.mjs public/node-city/index.html
    node .gauntlet/modcheck.mjs                     (public/src/**)
    node .gauntlet/jsxcheck.mjs                     (public/corp/*.jsx)
  A failing gate means REVERT your edit, not "note it and move on".
- Do NOT run tools/economy-tests/run.mjs — it is slow and the final Verify
  phase runs it once.
- Files are CRLF. If you patch with a script, normalise and restore.
- Comments in this codebase explain WHY, including past bugs and rejected
  designs. PRESERVE them. Adding to them is welcome; deleting them is not.
- Read CLAUDE.md before your first edit. The globals trap in it is real:
  Profile / Cloud / App / Corp / Forge are top-level const and are NOT on
  window; an ES module cannot see them.
- Do not delete anything from public/index.html unless a driver exercises the
  feature before and after. Prefer deferring/lazy-loading over deleting.
- Never touch battle, card or economy logic to achieve a VISUAL goal.
`;

const BAR = `The quality bar is the file DESIGN-BAR.md at the repo root. READ IT
FIRST, in full. It is a WRITTEN bar because the reference material is
screenshots that cannot be handed to you — you cannot see them, and the file
says so and says what that costs. Its measurable tests (chrome colour-channel,
border-radius, heading font family, horizontal overflow) are what you fail a
screen on; the rest is judgement and must be labelled as judgement.`;

phase('Survey');
log('Reading the bar and deciding the decomposition…');

const SURVEY_SCHEMA = {
  type: 'object',
  required: ['items', 'notes'],
  properties: {
    notes: { type: 'string', description: 'What you found overall, and anything the owner must decide.' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'title', 'files', 'touchesIndexHtml', 'why', 'priority'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          touchesIndexHtml: { type: 'boolean' },
          why: { type: 'string', description: 'The concrete gap against the bar, measured where possible.' },
          priority: { type: 'integer', description: '1 = biggest visible win' },
        },
      },
    },
  },
};

const survey = await agent(`You are the LEAD for a theme-consistency pass on the
Mythic Spellbook game at D:/game-deploy.

${BAR}

${RULES}

YOUR JOB IN THIS PHASE IS TO DECIDE THE WORK, NOT TO DO IT.

Survey the game's screens and divide the goal into the SMALLEST pieces that can
be improved and judged INDEPENDENTLY. A good piece is one where a builder can
change it and a critic can render it and score it without touching anything
else.

The goal has four strands — weigh them yourself:
  (a) every page matched to the theme in DESIGN-BAR.md (a CONSISTENCY pass:
      several screens already hit the bar and are the reference — changing one
      of those is a FAILURE);
  (b) performance and dead code (read section 7 of the bar; it is the riskiest
      strand and the bar tells you the order of preference);
  (c) city builder Camp tab: list every player registered to the city owner's
      node with their camp/city and vital stats (bar section 6a);
  (d) city builder: Cities-Skylines-2 style happy/frowning emoji when a
      building/road/pipe is placed, for businesses AND residents. The mood model
      ALREADY EXISTS (pmFace/pmGlyph, /src/plotmood, MythicPlotVerdict) — bar
      section 6b. Do not build a second one.

Also fold in one small item the owner asked for separately: verify the city
builder's day runs a FULL 24 hours, and that weather disasters cannot fire
back-to-back. Find the day-length and weather-event code in
public/node-city/index.html, report what it actually does, and make it an item
only if it is genuinely wrong.

Return 8-20 items. Mark touchesIndexHtml truthfully — it decides whether the
item runs in parallel or in a queue. Explore the repo properly before you
answer; a decomposition invented without reading the code will waste every
round that follows.`, {
  label: 'lead:survey',
  schema: SURVEY_SCHEMA,
  effort: 'high',
});

const items = (survey && Array.isArray(survey.items) ? survey.items : [])
  .slice(0, 20)
  .sort((a, b) => (a.priority | 0) - (b.priority | 0));

log(`Lead returned ${items.length} pieces. ${items.filter(i => i.touchesIndexHtml).length} touch index.html and will be queued; the rest run in parallel.`);
log(survey && survey.notes ? String(survey.notes).slice(0, 600) : '');

/* ── One piece, taken through builder → critic rounds until the critic passes
      or the rounds run out. The critic gets FRESH CONTEXT every round and is
      told to inspect the real output, never the diff. ─────────────────────── */
const VERDICT = {
  type: 'object',
  required: ['pass', 'biggestGap', 'measured', 'judgement'],
  properties: {
    pass: { type: 'boolean' },
    biggestGap: { type: 'string', description: 'The single biggest remaining gap, concrete enough to act on. Empty if pass.' },
    measured: { type: 'string', description: 'What you actually MEASURED (numbers, computed styles, screenshots taken).' },
    judgement: { type: 'string', description: 'What is taste rather than measurement, labelled as such.' },
  },
};

const MAX_ROUNDS = 3;

async function improve(item) {
  let feedback = '';
  let lastVerdict = null;
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const built = await agent(`You are a BUILDER on the Mythic Spellbook theme pass.

${BAR}

${RULES}

YOUR PIECE — work on this and NOTHING else:
  ${item.title}
  Files: ${(item.files || []).join(', ')}
  The gap the lead found: ${item.why}

${feedback ? `A CRITIC LOOKED AT YOUR LAST ATTEMPT AND SAID:\n${feedback}\n\nFix that specific gap. Do not start over.` : ''}

Make the change, run the gates that cover what you touched, and report what you
actually did in 6 lines or fewer. If you conclude the piece needs NO change,
say so plainly and say what you checked — that is a valid outcome and is much
better than churn for its own sake.`, {
      label: `build:${item.id}:r${round}`,
      phase: 'Improve',
      effort: 'high',
    });

    const verdict = await agent(`You are a CRITIC on the Mythic Spellbook theme
pass. You have FRESH CONTEXT and you have not seen the builder's reasoning.
Repo: D:/game-deploy, branch gauntlet-theme-pass.

${BAR}

THE PIECE UNDER REVIEW:
  ${item.title}
  Files: ${(item.files || []).join(', ')}
  The gap it was supposed to close: ${item.why}
  What the builder says they did: ${String(built || '(no report)').slice(0, 1200)}

YOUR JOB — inspect the REAL OUTPUT, never the diff and never the builder's
claim. Serve public/ over http and drive it with Playwright the way the files in
.gauntlet/ do; take a screenshot; read computed styles.

node needs: export PATH="$PATH:/c/Program Files/nodejs";
The Browser pane's requestAnimationFrame fires at ~0.56 Hz, so render() is
effectively a no-op inside a synchronous driver and canvas rects read 0x0.
Call renderers directly. See CLAUDE.md.

Apply the MEASURABLE tests in DESIGN-BAR.md sections 1-5 first — the chrome
colour-channel test, border-radius <= 6px, serif headings, no horizontal
overflow. Then make the taste call: would this screen look like it belongs
beside the Bank of Ethos reference described in the bar?

Return pass=false unless it genuinely meets the bar, and when you do, name the
SINGLE biggest remaining gap concretely enough that a builder can act on it
without ever seeing the reference image. Separate what you MEASURED from what
is JUDGEMENT — a critic that says "looks good" with no measurement has not done
the job, and one that fails a screen without naming the fix has not either.`, {
      label: `crit:${item.id}:r${round}`,
      phase: 'Improve',
      schema: VERDICT,
      effort: 'high',
    });

    lastVerdict = verdict;
    if (!verdict) break;
    if (verdict.pass) {
      log(`PASS ${item.id} on round ${round}`);
      return { item, rounds: round, pass: true, verdict };
    }
    feedback = String(verdict.biggestGap || '');
    log(`RETRY ${item.id} round ${round}: ${feedback.slice(0, 160)}`);
  }
  log(`STUCK ${item.id} used all ${MAX_ROUNDS} rounds without passing`);
  return { item, rounds: MAX_ROUNDS, pass: false, verdict: lastVerdict };
}

phase('Improve');

/* index.html work is QUEUED — see the header. Everything else fans out. */
const indexItems = items.filter(i => i.touchesIndexHtml);
const otherItems = items.filter(i => !i.touchesIndexHtml);

log(`Fanning out ${otherItems.length} independent pieces…`);
const parallelDone = parallel(otherItems.map((it) => () => improve(it)));

const queuedResults = [];
for (let i = 0; i < indexItems.length; i++) {
  log(`index.html queue ${i + 1}/${indexItems.length}: ${indexItems[i].title}`);
  queuedResults.push(await improve(indexItems[i]));
}

const results = [...(await parallelDone).filter(Boolean), ...queuedResults];

phase('Verify');
const verify = await agent(`You are the VERIFIER for the Mythic Spellbook theme
pass. Repo D:/game-deploy, branch gauntlet-theme-pass.

${RULES}

Run EVERY gate on the finished tree and report the raw verdicts:
  export PATH="$PATH:/c/Program Files/nodejs";
  node _synckcheck.mjs
  node _synckcheck.mjs public/node-city/index.html
  node .gauntlet/modcheck.mjs
  node .gauntlet/jsxcheck.mjs
  node .gauntlet/precommit-scan.mjs
  node tools/economy-tests/run.mjs
  node tools/stash-tests/run.mjs
  node tools/fieldshop-tests/run.mjs

Then run these drivers and report pass/fail for each:
  node .gauntlet/drive-lightpoles.mjs
  node .gauntlet/drive-shopneeds.mjs
  node .gauntlet/drive-jobfair-ui.mjs
  node .gauntlet/drive-fieldshop.mjs
  node .gauntlet/drive-corp-pay.mjs

Do NOT deploy. Do not run the economy gauntlet at the same time as anything
that minifies index.html — it reads that file as SOURCE and reports five
phantom failures if it is minified mid-run.

If a gate fails, find which piece broke it and FIX IT or revert that piece.
Report honestly: which gates are green, which are red, and what you did. Do not
report success you did not observe.`, {
  label: 'verify:gates',
  effort: 'high',
});

const passed = results.filter(r => r && r.pass);
const stuck = results.filter(r => r && !r.pass);

return {
  surveyNotes: survey && survey.notes,
  pieces: results.length,
  passed: passed.map(r => r.item.title),
  stuck: stuck.map(r => ({ title: r.item.title, gap: r.verdict && r.verdict.biggestGap })),
  verify,
};
