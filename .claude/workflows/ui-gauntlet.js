export const meta = {
  name: 'ui-gauntlet',
  description: 'Gauntlet loop: build a set of UI surfaces up to a design bar, judged blind by independent critics against a renderable comp, looping until they win',
  whenToUse: 'Any "make these screens look like this" job where a design comp exists and quality matters more than speed. Point it at a spec + comp pages and a list of surfaces.',
  phases: [
    { title: 'Plan' },
    { title: 'Build' },
    { title: 'Judge' },
    { title: 'Integrate' },
  ],
}

// ═══════════════════════════════════════════════════════════════════════════
// REUSABLE GAUNTLET
//
// Invoke with:
//   Workflow({ name: 'ui-gauntlet', args: {
//     goal:      'one paragraph — what surfaces, what outcome',
//     spec:      'docs/hub-ui-bar.md',              // specification of record
//     comps:     ['docs/bar/comp-main.html', …],    // renderable pixel references
//     surfaces:  ['Battle Hall', 'Forge Sanctum'],  // what is in scope
//     branch:    'claude/whatever-xyz',
//     requirements: ['keep all handlers working', …],   // optional, appended verbatim
//     shotCmd:   'node tools/shot.mjs <page> out.png', // optional
//     maxRounds: 3,
//   }})
//
// WHY IT IS SHAPED THIS WAY — two failures paid for in the first run of this:
//
// 1. THE COMP MUST BE RENDERABLE. The first run judged against prose, because
//    the design comps were images pasted into a chat that no subagent could
//    see. Critics passed anything vaguely on-theme. Converting the comps into
//    in-repo HTML that renders to a PNG is what makes "blind A/B" mean
//    anything. If you have no renderable comp, BUILD ONE FIRST — it is worth a
//    whole workflow of its own.
//
// 2. THE BAR IS NOT THE CURRENT PRODUCT. The first run silently calibrated
//    against the app's existing menu, which turned out to be a generation
//    behind the comp, and spent a round polishing toward the wrong target. The
//    goal text says plainly which is the bar and that the current code is not.
// ═══════════════════════════════════════════════════════════════════════════

const A = (typeof args === 'object' && args) || {}
if (!A.goal) return { error: 'ui-gauntlet needs args.goal' }

const SPEC      = A.spec || ''
const COMPS     = A.comps || []
const SURFACES  = A.surfaces || []
const BRANCH    = A.branch || ''
const MAX_ROUNDS = A.maxRounds || 3
const SHOT_CMD  = A.shotCmd || ''
const SCRATCH   = A.scratch || '/tmp/gauntlet'

const GOAL = `
GOAL
${A.goal}

${SURFACES.length ? `SURFACES IN SCOPE:\n${SURFACES.map(s => `  - ${s}`).join('\n')}\n` : ''}
THE BAR — read these first, they are the whole brief:
${SPEC ? `  ${SPEC}\n      The specification of record. Where it and the current code disagree, IT WINS.\n` : ''}${COMPS.map(c => `  ${c}\n      Renderable comp. THE pixel reference — render it and compare.`).join('\n')}

What the product looks like today is NOT the bar. Do not calibrate against it.

${(A.requirements || []).length ? `HARD REQUIREMENTS\n${A.requirements.map(r => `- ${r}`).join('\n')}` : ''}
`.trim()

const SHOT = `
RENDERING (dependency-free — do NOT npm install a browser driver):
${SHOT_CMD ? `  ${SHOT_CMD}\n` : ''}  /opt/pw-browsers/chromium-1194/chrome-linux/chrome --headless=new --no-sandbox --disable-gpu \\
    --hide-scrollbars --virtual-time-budget=9000 --window-size=1920,1080 \\
    --screenshot=OUT.png "file:///ABSOLUTE/PATH.html"
Read the PNG back with the Read tool and actually LOOK at it. SSL errors on stderr are harmless.

THREE ENVIRONMENT TRAPS, each already paid for once — do not rediscover them:
1. --window-size=1920,1080 lays out a 1920x993 viewport and pads the PNG to 1080. A hard
   height:1080px canvas silently loses its bottom 87px. Use 100vh.
2. fonts.googleapis.com is unreachable here. A bare <link> to a web font silently renders a system
   fallback, which makes work look wrong for reasons unrelated to the work. Inline the font as a
   woff2 data URI when rendering in isolation.
3. Chromium paints text-shadow ON TOP of a background-clip:text fill, hollowing glyphs into an
   outline. Type with a gradient fill takes its shadow from filter: drop-shadow(), never text-shadow.
`.trim()

// ─────────────────────────────────────────────────────────────────────────────
phase('Plan')

const plan = await agent(`${GOAL}

${SHOT}

You are the LEAD. Choose the approach — nobody is prescribing one to you.

First see the gap yourself: render the comp(s) AND the live surfaces, and Read them side by side.
Then read the code that produces those surfaces.

Divide the goal into the SMALLEST pieces that can each be built and judged independently — a piece a
critic can look at and call a win or a loss without needing the others. For each unit give a
self-contained build brief, the specific clause of the bar it is judged against, and the exact files
it owns.

CONCURRENCY RULE (a property of this harness, not of your design): units build in parallel, so no
two units may write the same file. Any unit that must edit a large shared file sets
edits_shared_file=true — those are serialized one at a time. Push whatever you can into files a unit
can own alone.

Aim for 4-6 units. Order them so the foundation lands first.`,
  { label: 'lead-plan', phase: 'Plan', effort: 'high', schema: {
    type: 'object', additionalProperties: false,
    required: ['units', 'approach', 'gap_assessment'],
    properties: {
      approach: { type: 'string' },
      gap_assessment: { type: 'string' },
      units: { type: 'array', maxItems: 6, items: { type: 'object', additionalProperties: false,
        required: ['id', 'title', 'brief', 'bar', 'files_owned', 'edits_shared_file'],
        properties: {
          id: { type: 'string' }, title: { type: 'string' }, brief: { type: 'string' },
          bar: { type: 'string' },
          files_owned: { type: 'array', items: { type: 'string' } },
          edits_shared_file: { type: 'boolean' },
        } } },
    } } })

if (!plan || !plan.units || !plan.units.length) return { error: 'lead produced no plan' }
log(`Lead: ${plan.approach}`)
log(`${plan.units.length} units: ${plan.units.map(u => u.id).join(', ')}`)

// ─────────────────────────────────────────────────────────────────────────────
// THE GAUNTLET. Build → two independent critics with fresh context → the single
// biggest gap goes back into the next round's build prompt. A unit leaves only
// when both critics say it wins. Rounds are not fixed.
//
// Two critics with DIFFERENT LENSES, not two identical ones: a redundant pair
// agrees with itself. Craft catches what the pixels look like; feel catches the
// regression the pretty screenshot hides.
// ─────────────────────────────────────────────────────────────────────────────
const CRITIC_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['verdict', 'score_ours', 'score_bar', 'biggest_gap', 'evidence', 'fix_brief'],
  properties: {
    verdict: { type: 'string', enum: ['WINS', 'LOSES'] },
    score_ours: { type: 'number' }, score_bar: { type: 'number' },
    biggest_gap: { type: 'string' }, evidence: { type: 'string' }, fix_brief: { type: 'string' },
  },
}

const LENSES = [
  { key: 'craft', ask: 'Craft and fidelity to the comp. Put our render and the comp render side by side and look at them as a stranger would: frame construction and corner treatment, type (weight, tracking, optical size, whether it reads as a crafted surface or as coloured text), colour weights, spacing rhythm, icon weight, ornament placement, how much art is let through and at what luminance. Which looks like it shipped from a studio? Judge the PIXELS.' },
  { key: 'feel',  ask: 'Feel and function. Read the code and drive the states: hover, active, focus-visible, disabled, back navigation, transition in and out, reduced motion, and narrow / wide widths. Did any existing handler, badge, live count, gate or route break? A regression is an automatic LOSES. Cheap motion — linear easing, no press state, popping transitions, animation that replays on every re-render — is a LOSES.' },
]

const history = {}
let open = plan.units.slice()
const won = []
let round = 0

while (open.length && round < MAX_ROUNDS) {
  round++
  const roundNo = round

  phase(`Build r${roundNo}`)
  log(`Round ${roundNo}: building ${open.map(u => u.id).join(', ')}`)

  const buildPrompt = (u) => `${GOAL}

${SHOT}

YOUR UNIT — ${u.title}
${u.brief}

The clause of the bar you are judged against: ${u.bar}
Files you own — write ONLY these${u.edits_shared_file ? ' (you are serialized; nobody else is editing the shared file right now)' : ' (another agent may be editing the shared file right now — do NOT touch it)'}:
${u.files_owned.join('\n')}

${history[u.id] && history[u.id].length ? `THIS IS ROUND ${roundNo}. Two independent critics looked at your last round and it LOST.
Close the biggest gap first:

${history[u.id][history[u.id].length - 1]}

Do not restate the plan — change the output.` : 'This is round 1.'}

Build it. Then render your surface AND the comp, Read both PNGs, and compare before you finish — if
you would not call yours a win, keep going. Do not commit or push; an integrator does that.

Return what you changed and what you honestly believe is still weak.`

  const par = open.filter(u => !u.edits_shared_file)
  const ser = open.filter(u => u.edits_shared_file)
  if (par.length) await parallel(par.map(u => () => agent(buildPrompt(u), { label: `build:${u.id}`, phase: `Build r${roundNo}` })))
  for (const u of ser) await agent(buildPrompt(u), { label: `build:${u.id}`, phase: `Build r${roundNo}` })

  phase(`Judge r${roundNo}`)
  const judged = await parallel(open.map(u => () =>
    parallel(LENSES.map(L => () => agent(`${GOAL}

${SHOT}

You are an independent CRITIC with fresh context. You did not build this and you owe it nothing.
Your default is LOSES. Only a genuine win flips it.

UNDER REVIEW — ${u.title}
${u.brief}
The clause of the bar it is judged against: ${u.bar}

YOUR LENS — ${L.ask}

METHOD (do this, do not skip to a verdict):
1. Render the comp AND our live surface. Read BOTH images.
2. Blind A/B: write the two PNGs to ${SCRATCH}/ab/r${roundNo}-${u.id}-${L.key}/ as a.png and b.png in
   an order you pick, and judge them on craft alone before checking which is which.
3. Inspect the real output — the actual files, the actual rendered pixels. Never review from the
   diff or from the builder's claims about what it did.
4. Name the ONE biggest remaining gap. Specific and actionable: which element, what is wrong, what
   would fix it. "Polish the spacing" is useless. "The frame's inner bevel is a flat 1px rgba white
   instead of the comp's two-stop inset highlight, so tiles read as CSS boxes rather than metal" is
   useful.
5. score_ours / score_bar: 0-10 on your lens. WINS requires score_ours >= score_bar.

Return your verdict.`, { label: `critic:${u.id}:${L.key}`, phase: `Judge r${roundNo}`, effort: 'high', schema: CRITIC_SCHEMA })))
      .then(vs => ({ unit: u, votes: vs.filter(Boolean) }))
  ))

  const results = judged.filter(Boolean)
  const stillOpen = []
  for (const r of results) {
    if (r.votes.length > 0 && r.votes.every(v => v.verdict === 'WINS')) {
      won.push({ id: r.unit.id, round: roundNo, scores: r.votes.map(v => `${v.score_ours}/${v.score_bar}`) })
      log(`✅ ${r.unit.id} WINS (round ${roundNo})`)
    } else {
      history[r.unit.id] = (history[r.unit.id] || []).concat(
        r.votes.map(v => `[${v.verdict} ${v.score_ours} vs bar ${v.score_bar}] BIGGEST GAP: ${v.biggest_gap}\nEVIDENCE: ${v.evidence}\nFIX: ${v.fix_brief}`).join('\n\n'))
      stillOpen.push(r.unit)
      log(`↻ ${r.unit.id} loses round ${roundNo} — gap sent back`)
    }
  }
  open = stillOpen

  phase('Integrate')
  await agent(`Gauntlet round ${roundNo} just finished${BRANCH ? ` on branch ${BRANCH}` : ''}. You are the integrator and scribe. Two jobs.

1. INTEGRATE AND VERIFY. Run the project's own fast checks. Render every surface in scope and Read
   each PNG — confirm nothing is broken, blank or regressed, and that any new stylesheet the builders
   wrote is actually LINKED from the page that needs it. Unlinked CSS is dead weight and has silently
   wasted a whole round before. Fix only outright breakage: syntax errors, a surface that no longer
   renders, duplicate rules fighting each other, a missing link. Do NOT do design work.
   Then commit and push${BRANCH ? ` to ${BRANCH}` : ''}, with a real message about what changed this
   round. No model names in the message.

2. LIVE PROGRESS PAGE. Create or UPDATE docs/gauntlet-progress.html — one self-contained page
   showing the work evolving. APPEND round ${roundNo}; never overwrite earlier rounds. Per unit:
   status, which round it won, and each critic's biggest gap verbatim. Keep a timeline so the
   improvement over rounds is legible at a glance. Inline images as data URIs or omit them.

Round ${roundNo}:
WON SO FAR: ${JSON.stringify(won)}
STILL OPEN: ${JSON.stringify(open.map(u => u.id))}
CRITIQUES:
${results.map(r => `--- ${r.unit.id} ---\n${r.votes.map(v => `${v.verdict} (${v.score_ours} vs ${v.score_bar}) [${v.biggest_gap}]`).join('\n')}`).join('\n\n')}

Return an honest one-paragraph status: what landed, what is still weak, anything broken.`,
    { label: `integrate:r${roundNo}`, phase: 'Integrate' })

  if (!open.length) { log(`Every unit cleared the gauntlet in ${roundNo} round(s).`); break }
}

return {
  approach: plan.approach,
  gap_assessment: plan.gap_assessment,
  won,
  still_open: open.map(u => ({ id: u.id, last_critique: (history[u.id] || []).slice(-1)[0] || '' })),
  rounds_run: round,
  progress_page: 'docs/gauntlet-progress.html',
}
