/* 🍀 v121v148 — Luck is a real hero stat, it replaces Speed in the skill tree,
   and it makes battle loot BETTER. Run: node _luck_smoke.mjs

   Owner: "Add a new Stat to heros 'Luck' That will increase the better the loot
   that the hero and units finds in Battle. And replace the stats increase for
   Speed for luck in the Skill tree and only give where the points only give you
   1% luck."

   The Speed→Luck swap is player-visible — a hero who already spent points on
   those stars loses that Speed, which costs movement and attack reach, with
   Respec as the recovery. That was flagged before building and the owner
   confirmed: "yes". */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');

/* ── the stat exists everywhere it must ───────────────────────────────────── */
ok(/luck: 'Luck %'/.test(SRC), 'the skill tree labels the stat');
ok(/luck: 'What the field yields up\.'/.test(SRC), '…and describes it');
ok(/luck:  \['Fortune', 'Lucky Find'/.test(SRC),
  '…and has its own name bank, so a generated Luck star reads like the rest of the constellation instead of printing the raw key');
ok(/const out = \{ atk: 0, def: 0, mag: 0, res: 0, hp: 0, spd: 0, crit: 0, dodge: 0, rng: 0, cost: 0, luck: 0 \};/.test(SRC),
  'THE ACCUMULATOR KNOWS IT — its own `if (k in out)` filter would otherwise drop every Luck node on the floor');

/* ── 1% per node, at every builder ────────────────────────────────────────── */
ok(/const _cLuck1 = \(o\) => \{ try \{ if \(o && typeof o === 'object' && 'luck' in o\) o\.luck = 1; \} catch \(e\) \{\} return o; \};/.test(SRC),
  'ONE clamp: a Luck grant is always exactly 1');
ok(/const _cS  = \(o\) => _cLuck1\(o\);/.test(SRC), '…applied to every hand-authored constellation row');
ok(/if \(stat === 'luck'\) amt = 1;/.test(SRC),
  '…and to the AUTO-GENERATOR, which derives a branch theme from the authored tally and would otherwise emit luck 3/4/5 minors');
ok(/_cLuck1\(mfx\);/.test(SRC) && /_cLuck1\(kfx\);/.test(SRC),
  '…and to the Mastery (6/4) and Ascendant keystone (8/6) stars, which build their fx directly');
ok(/otherwise emit luck 3\/4\/5\/6\/8 nodes/.test(SRC),
  'the reason the clamp is at the BUILDERS rather than on each node is written down');

/* ── the swap ─────────────────────────────────────────────────────────────── */
{
  /* the constellation block only */
  const lo = SRC.indexOf('const _cS  = (o) => _cLuck1(o);');
  const hi = SRC.indexOf('function getHeroCosmicStatBonuses');
  ok(lo > 0 && hi > lo, 'the constellation block is locatable');
  const tree = SRC.slice(lo, hi);
  ok(!/_cS\(\{[^}]*\bspd:\s*\d/.test(tree),
    'NO skill-tree star grants Speed any more — the swap the owner asked for');
  ok(/_cS\(\{ luck: 1 \}\)/.test(tree), '…and Luck stars are there instead');
  ok((tree.match(/luck: 1/g) || []).length >= 9,
    'all nine Speed grants moved, including the bundled ones (GHOST, Versatility, ASCENDANT ARTS, Shadow Clone)',
    String((tree.match(/luck: 1/g) || []).length));
  ok(/'Quick Hands', 'Quick enough to pocket what others miss\.'/.test(tree)
     && /'Fleet', 'First to the spoils, every time\.'/.test(tree)
     && /'Footwork', 'Standing where the good things fall\.'/.test(tree),
    'THE DESCRIPTIONS NO LONGER PROMISE SPEED — "Fleet: cover more ground each turn" on a Luck star is a lie the player reads every time they open the tree');
  ok(/'Quick Hands'/.test(tree) && /'Fleet'/.test(tree) && /'Footwork'/.test(tree),
    '…while the NAMES are kept, because saved allocations key off node identity and renaming would orphan every hero who already bought one');
}
/* Speed itself is untouched OUTSIDE the tree */
ok(/stats: \{ spd: 1 \}/.test(SRC), 'items still grant SPD — this was scoped to the skill tree, not to the stat');
ok(/haste:\{id:"haste"/.test(SRC) || /spdMod/.test(SRC), '…and the status effects that modify SPD are untouched');

/* ── luck reaches the loot ────────────────────────────────────────────────── */
ok(/function _playerLuckPct\(\) \{/.test(SRC), "the player's total Luck can be read");
{
  const f = SRC.slice(SRC.indexOf('function _playerLuckPct() {'), SRC.indexOf('function _luckWeightedRarity'));
  ok(/getHeroCosmicStatBonuses\(heroId\)/.test(f), 'it sums the skill tree');
  ok(/h\.stats && isFinite\(\+h\.stats\.luck\)/.test(f), '…plus any Luck authored on the hero itself');
  ok(/return Math\.min\(LUCK_MAX_PCT, luck\);/.test(f),
    '…and is CAPPED, because a runaway multiplier on a rarity table turns "better loot" into "only mythics", which is not better');
  ok(/App\.battlePrep && App\.battlePrep\.hero/.test(f), '…with a fallback for grants rolled outside a battle');
}
ok(/function _luckWeightedRarity\(weights, luckPct\) \{/.test(SRC), 'the rarity table can be re-weighted');
{
  const f = SRC.slice(SRC.indexOf('function _luckWeightedRarity(weights, luckPct) {'), SRC.indexOf('function _rollLootCard'));
  ok(/if \(!weights \|\| !luckPct\) return weights;/.test(f),
    'AT ZERO LUCK THE TABLE IS RETURNED UNCHANGED — a player with no Luck sees exactly the old behaviour');
  ok(/const mul = tier <= 0 \? 1 : \(1 \+ \(luckPct \/ 100\) \* tier \* 0\.4\);/.test(f),
    'the multiplier grows with how rare a tier already is, so Luck nudges mythic far more than common');
}
ok(/_luckWeightedRarity\(DEFAULT_PACK_RARITY_WEIGHTS, _lk\)/.test(SRC), 'the battle card drop uses it');
ok(/const _exp = 1 - \(_lkI \/ 100\) \* 0\.5;/.test(SRC) && /Math\.pow\(price, _exp\)/.test(SRC),
  'the battle ITEM drop softens its price exponent, flattening the curve toward the pricier end rather than adding a flat bonus');
ok(/QUALITY, NOT FREQUENCY/.test(SRC),
  'drop CHANCE is deliberately untouched, and the reason is written down — the two knobs compound much faster than they look');

/* ── run the maths for real ───────────────────────────────────────────────── */
{
  const W = { common: 600, uncommon: 300, rare: 70, epic: 20, legendary: 8, mythic: 1.5 };
  const ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
  const reweight = (weights, luckPct) => {
    if (!weights || !luckPct) return weights;
    const out = {};
    for (const k in weights) {
      const tier = ORDER.indexOf(k);
      const mul = tier <= 0 ? 1 : (1 + (luckPct / 100) * tier * 0.4);
      out[k] = Math.max(0.0001, (+weights[k] || 0) * mul);
    }
    return out;
  };
  ok(reweight(W, 0) === W, 'run for real: ZERO Luck returns the very same table object — no behaviour change for a player without it');
  const w10 = reweight(W, 10);
  ok(w10.common === 600, 'run for real: common is never inflated — Luck must not make the floor likelier');
  ok(w10.mythic > W.mythic && w10.legendary > W.legendary, 'run for real: the rare tiers get likelier');
  ok((w10.mythic / W.mythic) > (w10.rare / W.rare),
    'run for real: …and mythic gains PROPORTIONALLY more than rare, which is what "better loot" means');
  const share = (w) => w.mythic / Object.keys(w).reduce((a, k) => a + w[k], 0);
  ok(share(reweight(W, 60)) > share(W) * 1.5,
    'run for real: at max Luck a mythic is meaningfully likelier, but still rare', (share(reweight(W, 60)) * 100).toFixed(3) + '%');
  ok(share(reweight(W, 60)) < 0.02, 'run for real: …and never common — the cap keeps the table a table', (share(reweight(W, 60)) * 100).toFixed(3) + '%');

  /* the item price curve */
  const wOf = (price, luck) => Math.max(1, Math.round(3000 / Math.pow(price, 1 - (luck / 100) * 0.5)));
  ok(wOf(50, 0) === Math.max(1, Math.round(3000 / 50)), 'run for real: at zero Luck the item formula is byte-identical to the original');
  ok(wOf(2000, 60) > wOf(2000, 0), 'run for real: an expensive relic gets likelier with Luck');
  ok((wOf(2000, 60) / wOf(2000, 0)) > (wOf(50, 60) / wOf(50, 0)),
    'run for real: …and gains proportionally more than a cheap consumable, which is the whole point of flattening the curve');

  /* the 1% clamp */
  const clamp = (o) => { if (o && typeof o === 'object' && 'luck' in o) o.luck = 1; return o; };
  ok(clamp({ luck: 8 }).luck === 1, 'run for real: an 8-point keystone Luck grant is clamped to 1');
  ok(clamp({ atk: 5, luck: 4 }).atk === 5, 'run for real: …and the other stats in the same node are untouched');
  ok(clamp({ atk: 5 }).luck === undefined, 'run for real: a node with no Luck does not acquire one');
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 148, 'BUILD_VERSION is v121v148 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(readFileSync('./public/node-city/index.html', 'utf8')), 'NC_BUILD carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
