/* ══════════════════════════════════════════════════════════════════════════
   🧠 PROBE-AI-BLINDSPOTS — which systems does the battle AI never look at?

   "Make the AI smarter and understand the new systems" is not actionable until
   you know WHICH systems it is blind to. Guessing produces a rewrite; measuring
   produces a list.

   METHOD. Two vocabularies, compared:
     · WHAT THE GAME HAS — every property the engine reads off a unit or the
       battle state, harvested from the whole file (u.foo / unit.foo /
       state.foo / s.foo), with a frequency count so the important ones sort up.
     · WHAT THE AI READS — the same harvest, but only inside the source range of
       the AI's own functions (ai*, _ai*, doAIStep and friends).
   A property the engine uses often and the AI never mentions is a blind spot:
   the AI is playing a game with those rules switched off.

   ⚠ THIS IS A LEAD, NOT A VERDICT. A property can be read indirectly through a
     helper the AI calls (getEffectiveAttackRange reads weaponRange, so the AI
     "sees" it without naming it). Every hit needs confirming by reading the
     call path before anyone writes code. Reported as candidates, ranked, with
     the caveat attached rather than implied.

   Run: node .gauntlet/_probe-ai-blindspots.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';

const SRC = fs.readFileSync('public/index.html', 'utf8');
const lines = SRC.split(/\r?\n/);

/* ── 1 · find the AI's own source ranges ────────────────────────────────── */
const AI_FN = /^\s*(?:async\s+)?function\s+(_?ai[A-Za-z0-9_]*|doAIStep|scheduleAIStep|finishAIPhase|setAIActor|_runAIStepWhenClear)\s*\(/;
const ANY_FN = /^\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/;
const ranges = [];
for (let i = 0; i < lines.length; i++) {
  const m = AI_FN.exec(lines[i]);
  if (!m) continue;
  let depth = 0, started = false, end = i;
  /* 🔴 NO LINE CAP. The first cut stopped at 900 lines, which TRUNCATED
     doAIStep — the function that holds most of the AI's actual reasoning —
     and the probe then reported surfaces as "never read" when the movement
     loop penalises fire at -45, oil at -12 and water in a lightning storm.
     A measuring tool that quietly stops reading is worse than no tool: it
     produces a confident list of work that does not need doing. */
  for (let j = i; j < lines.length; j++) {
    for (const ch of lines[j]) { if (ch === '{') { depth++; started = true; } else if (ch === '}') depth--; }
    if (started && depth <= 0) { end = j; break; }
  }
  ranges.push({ name: m[1], from: i, to: end });
}
const aiText = ranges.map(r => lines.slice(r.from, r.to + 1).join('\n')).join('\n');

/* ── 2 · harvest the property vocabulary ───────────────────────────────── */
const harvest = (text) => {
  const counts = {};
  const re = /\b(?:u|unit|unt|target|tgt|atk|def|s|st|state|App\.state)\.([a-zA-Z_][a-zA-Z0-9_]*)/g;
  let m;
  while ((m = re.exec(text))) counts[m[1]] = (counts[m[1]] || 0) + 1;
  return counts;
};
const all = harvest(SRC);
const ai  = harvest(aiText);

/* Properties that are plumbing rather than game systems. */
const NOISE = new Set(['length','map','filter','forEach','find','push','slice','indexOf','includes','some','every',
  'id','name','icon','toString','then','catch','concat','join','split','sort','keys','x','y','pos','owner','type',
  'state','units','player','ai','turn','hand','deck','board','log','gameOver','call','apply','bind','prototype',
  'constructor','hasOwnProperty','reduce','shift','pop','splice','trim','replace','match','test','toLowerCase',
  'toUpperCase','padStart','value','data','error','width','height','style','className','textContent']);

const rows = Object.keys(all)
  .filter(k => !NOISE.has(k))
  .filter(k => all[k] >= 12)                 // used by the engine with real weight
  .map(k => ({ prop: k, engine: all[k], aiUses: ai[k] || 0 }))
  .filter(r => r.aiUses === 0)
  .sort((a, b) => b.engine - a.engine);

console.log('\n🧠 AI BLIND SPOTS · properties the engine uses and the AI never names\n');
console.log('   AI source scanned: ' + ranges.length + ' functions, '
  + aiText.split(/\r?\n/).length.toLocaleString() + ' lines');
console.log('   (a hit can still be read INDIRECTLY through a helper — confirm before coding)\n');
console.log('   engine uses   property');
for (const r of rows.slice(0, 40)) {
  console.log('   ' + String(r.engine).padStart(9) + '   ' + r.prop);
}
console.log('\n   ' + rows.length + ' candidate blind spots (engine ≥12 uses, AI 0)\n');

/* ── 3 · a few named systems, checked directly ─────────────────────────── */
const SYSTEMS = [
  ['gems / sockets',        /socketedGems|gemFor|_gemStat/],
  ['equipment',             /equipment|weaponRange|_loadoutCrit/],
  ['hero skill tree',       /_skillRange|_attackerSkillFlag|skillTree/],
  ['traits',                /traits\b|hasTrait/],
  ['temperament / morale',  /temperament|morale|fatigue/],
  ['surfaces',              /surface/],
  ['locations',             /\.location\b|getLocationRangeBonus/],
  ['weather',               /weather/],
  ['Kalon transform',       /kalon/i],
  ['counters / traps',      /counter|isFaceDown|trap/i],
  ['priority moves',        /priority/],
  ['stances / reactions',   /stance|reaction|ambushGuard|predatorsEye/],
  ['status effects',        /statusEffects/],
  ['bleeding / downed',     /_bleeding|stabilize/],
];
console.log('   system                    engine    AI');
for (const [label, re] of SYSTEMS) {
  const e = (SRC.match(new RegExp(re.source, 'g' + (re.flags.includes('i') ? 'i' : ''))) || []).length;
  const a = (aiText.match(new RegExp(re.source, 'g' + (re.flags.includes('i') ? 'i' : ''))) || []).length;
  console.log('   ' + label.padEnd(24) + String(e).padStart(6) + String(a).padStart(6)
    + (a === 0 ? '   \x1b[31m← never\x1b[0m' : (a < e / 40 ? '   \x1b[33m← barely\x1b[0m' : '')));
}
console.log('');
