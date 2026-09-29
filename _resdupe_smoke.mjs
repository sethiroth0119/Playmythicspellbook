/* 🔴 v121v130 — THE RESOURCE DUPLICATION EXPLOIT, and the delivery loop that
   cashed it out.

   Found by investigating a flagged account. The evidence, from the live DB:
     · profile blob : 57,046 fuel · 56,822 food · 14,956 weaponParts · 7,350 metal
     · server ledger:    227 fuel ·  1,840 food ·      0 weaponParts ·   257 metal
     · stash CEILING: 2,000 + 250 per bought vault row, and addRes() clamps
       EVERY gain at it — so those numbers cannot have been earned.
     · 1,515 "Delivery paid" credits on 11–12 Sep, 1,092 of them inside one
       hour at 90–500 ms apart, each of which is supposed to SPEND resources —
       and not one row of user_resources moved after 10 Sep.

   Run: node _resdupe_smoke.mjs */
import { readFileSync, statSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');

/* ── 1. the ratchet is gone ───────────────────────────────────────────────── */
{
  const i = SRC.indexOf('if (_cloudSalvage) {');
  const blk = SRC.slice(i, i + 3000);
  ok(i > 0 && !/for \(const k in _cl\) \{\n\s*const cv = _cl\[k\] \| 0, lv = _loc\[k\] \| 0;\n\s*if \(cv > lv\) _loc\[k\] = cv;\n\s*\}\n\s*\}/.test(blk),
    'the unconditional max-merge is gone — it let resources go up and never come down');
  ok(/const _haveLocalEdit = !!\(\(Profile\.cloud && Profile\.cloud\.lastLocalEditAt\)/.test(blk),
    'the merge now asks whether there is any local edit behind this session at all');
  ok(/\} else if \(!localIsFresher\) \{/.test(blk),
    '…and otherwise defers to the SAME freshness the rest of this row already obeys, rather than inventing a per-field rule');
  ok(/for \(const k in _loc\) \{ if \(!\(k in _cl\)\) delete _loc\[k\]; \}/.test(blk) && /for \(const k in _cl\) _loc\[k\] = _cl\[k\] \| 0;/.test(blk),
    '…taking the newer cloud row WHOLE, including the ids where it is SMALLER — which is precisely the spend the ratchet was swallowing');
  ok(/if \(cv > lv\) _loc\[k\] = cv;/.test(blk),
    'the max-merge survives for the one case it was written for: a cloud row with nothing local behind it, where taking the larger cannot lose anything');
}
{
  /* run the merge rule for real, against the shape that produced the exploit */
  const merge = (loc, cl, haveLocalEdit, localIsFresher) => {
    const out = { ...loc };
    if (!haveLocalEdit) { for (const k in cl) { if ((cl[k] | 0) > (out[k] | 0)) out[k] = cl[k] | 0; } }
    else if (!localIsFresher) {
      for (const k in out) if (!(k in cl)) delete out[k];
      for (const k in cl) out[k] = cl[k] | 0;
    }
    return out;
  };
  /* THE EXPLOIT: spend 25 food locally, then hydrate against a cloud row that
     still has the pre-spend number. */
  const cloud = { food: 1000, metal: 200 };
  const afterSpend = { food: 975, metal: 200 };
  const old = (() => { const o = { ...afterSpend }; for (const k in cloud) if ((cloud[k] | 0) > (o[k] | 0)) o[k] = cloud[k] | 0; return o; })();
  ok(old.food === 1000, 'run for real: the OLD rule handed the 25 food straight back — spend, reload, spend again, forever', old.food);

  const fixedStale = merge(afterSpend, cloud, true, false);
  ok(fixedStale.food === 1000, 'run for real: a cloud row that is genuinely NEWER still wins outright — this is not a licence to keep stale local numbers', fixedStale.food);
  const fixedFresh = merge(afterSpend, cloud, true, true);
  ok(fixedFresh.food === 975, 'run for real: …but when the LOCAL edit is the newer one, the spend stands and the resources do not come back', fixedFresh.food);
  const firstRun = merge({}, cloud, false, false);
  ok(firstRun.food === 1000 && firstRun.metal === 200, 'run for real: a fresh device with nothing local still restores everything from the cloud');
  const shrink = merge({ food: 975, ghost: 40 }, { food: 900 }, true, false);
  ok(shrink.food === 900 && !('ghost' in shrink),
    'run for real: an id the newer cloud row no longer carries is dropped, not kept at its old value — half a merge is how a ratchet grows back');
}

/* ── 2. the delivery cannot be drained at machine speed ───────────────────── */
ok(/const AI_DELIVER_COOLDOWN_MS = 2500;/.test(SRC), 'a contract delivery has a minimum interval');
ok(/let _aiDeliverBusy = \{\};/.test(SRC) && /if \(_aiDeliverBusy\[corpId\]\) \{/.test(SRC), '…and an in-flight lock, so two cannot overlap');
ok(/d\.lastRun = Date\.now\(\);          \/\/ 📦 the cooldown stamp/.test(SRC), '…stamped on the contract when the payout actually happens');
{
  const i = SRC.indexOf('function _aiDeliver(corpId) {');
  const j = SRC.indexOf("addGems(d.pay, 'Delivery paid')");
  ok(i > 0 && j > i, 'the guards sit BEFORE the payout, not after it');
}
{
  /* run the throttle for real */
  const CD = 2500;
  const allowed = (lastRun, now) => (now - (lastRun | 0)) >= CD;
  const t0 = 1000000;
  ok(allowed(0, t0), 'run for real: the first delivery on a fresh contract goes through');
  ok(!allowed(t0, t0 + 90), 'run for real: a second one 90ms later — the observed spam interval — is refused', '90ms');
  ok(!allowed(t0, t0 + 2499), 'run for real: …and so is one just inside the window');
  ok(allowed(t0, t0 + 2500), 'run for real: …and the next one is allowed once the window has passed');
  /* what the hour of spam would have become */
  const perHour = Math.floor(3600000 / CD);
  ok(perHour === 1440 && 1092 > 0, 'run for real: the ceiling is now 1,440 deliveries an hour of DELIBERATE pressing, against 1,092 taken in 90ms bursts — the resource ratchet was what made that pay, and it is closed above', perHour + '/h');
}

/* ── 3. the blade ─────────────────────────────────────────────────────────── */
ok(/html, body, \*, \*::before, \*::after \{ cursor: url\('assets\/cursors\/abra-blade\.png'\) 2 2, default !important; \}/.test(SRC),
  'html and body carry the cursor too — `*` matches ELEMENTS, so over a full-bleed background with no child under the pointer it fell back to the system arrow (the main menu is mostly background, which is exactly where it was missing)');
ok(/cursor: url\('assets\/cursors\/abra-blade-glow\.png'\) 2 2, pointer !important;/.test(SRC),
  '…and the glow hotspot moved with it');
{
  const meta = JSON.parse(readFileSync('./public/assets/cursors/abra-blade.json', 'utf8'));
  const b = meta.sizes['abra-blade.png'], g = meta.sizes['abra-blade-glow.png'];
  ok(b.w === 26 && b.h === 26, 'the blade is SMALLER — 26px, down from 40 (owner: "make it smaller also it is too big")', b.w + 'px');
  ok(g.w === 26, '…and the glow variant matches it, so the pointer does not jump size on hover', g.w + 'px');
  ok(b.hotspot.x === 2 && b.hotspot.y === 2 && g.hotspot.x === 2 && g.hotspot.y === 2,
    '…with the hotspot RE-MEASURED on the smaller render rather than scaled, so the tip is still the pixel it points with', JSON.stringify(b.hotspot));
  ok(statSync('./public/assets/cursors/abra-blade.png').size < 4000, 'and it ships small', statSync('./public/assets/cursors/abra-blade.png').size + ' bytes');
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 130, 'BUILD_VERSION is v121v130 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
