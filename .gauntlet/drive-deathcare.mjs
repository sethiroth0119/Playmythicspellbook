/* ══════════════════════════════════════════════════════════════════════════
   🪦 DRIVE-DEATHCARE — the driven half of the mortality round's evidence.

   Boots public/node-city/index.html in real Chromium, serves public/ over
   loopback, and fulfils the page's three@0.171.0 import map out of
   node_modules (the box cannot reach a CDN). Then drives the five claims a
   node harness cannot make:

     1  THE FEED STOPS LYING — retire a named citizen and read what
        /src/broadcast publishes. Before this round a vanished id was
        subject 'leaving', poster sub "former resident", body "I am leaving the
        city. It stopped working for me." The check asserts the subject, the
        department, the name in the body — and that no 'leaving' post was
        produced for the same person.
     2  THE COMPLAINT IS FREE — with no graveyard, deathcare appears on the
        vitals card (game.cov.pct), in the citizen's own dialogue as the
        weakest mood term with its `why` string, and in the demand panel's fix
        list — WITHOUT the graveyard being typed anywhere: demogGrowth()'s
        fixFor DERIVES it from BUILDINGS' svc.need.
     3  THE BREAKDOWN SURVIVES — citMoodTarget() and ctTerms() agree inside the
        0.1 the talk panel silently drops the whole explanation over, and the
        five weights still sum to 1.00. BOTH numbers are printed.
     4  NOT AN INVISIBLE BUILDING — buildMesh gives a non-zero bbox for both
        rows at all three levels, WITH A CONTROL: a type that has no arm, which
        is the empty Group the check exists to catch.
     5  THE PLOT FACTOR BITES — fill a graveyard and its deathcare supply stops.

   Run:  node .gauntlet/drive-deathcare.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
/* three@0.171.0, vendored. node_modules carries 0.128 and the page's import map
   is pinned to 0.171's WebGPU build — a different major of the renderer is not
   the thing under test. */
const THREE_DIR = path.resolve(process.cwd(), '.gauntlet/three171');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 8700 + (process.pid % 90);

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.startsWith('/__three/')) {
    const f = path.join(THREE_DIR, p.slice('/__three/'.length));
    if (fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return fs.createReadStream(f).pipe(res); }
    res.writeHead(404); return res.end('nf');
  }
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });

await page.route('**/*', (route) => {
  const u = route.request().url();
  if (u.includes('cdn.jsdelivr.net') && u.includes('three@')) {
    /* FULFIL, never redirect. Playwright refuses to override an https request
       with an http URL ("New URL must have same protocol"), and the page's
       import map is pinned to the CDN, so the bytes are handed over here. */
    const rel = new URL(u).pathname.replace(/^\/npm\/three@[^/]+\//, '');
    const f = path.join(THREE_DIR, rel);
    return fs.existsSync(f)
      ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) })
      : route.fulfill({ status: 404, body: 'no vendored three at ' + rel });
  }
  if (u.includes('127.0.0.1') || u.includes('localhost')) return route.continue();
  return route.abort();
});

const logs = [];
page.on('console', (m) => logs.push(m.type() + ': ' + m.text().slice(0, 260)));
page.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 260)));

await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction('!!window.__nc', null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(9000);

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name + (detail == null ? '' : '   ' + detail));
};

/* ── 0. BOOT ─────────────────────────────────────────────────────────── */
console.log('\n0. boot');
const boot = await page.evaluate(() => ({
  nc: !!window.__nc,
  mort: !!(window.MythicMortality && window.MythicMortality.ready()),
  retire: !!(window.MythicCitizens && window.MythicCitizens.retire),
  deaths: !!(window.MythicCitizens && window.MythicCitizens.deaths),
  bcast: !!(window.MythicBroadcast && window.MythicBroadcast.ready()),
  demog: !!(window.MythicDemographics && window.MythicDemographics.ready()),
  roster: window.MythicCitizens ? window.MythicCitizens.count() : 0,
  needs: window.__nc ? window.__nc.NEEDS : null,
}));
ok('the page booted with the diagnostics seam', boot.nc);
ok('/src/mortality mounted', boot.mort);
ok('the roster has a removal verb AND a deaths ring', boot.retire && boot.deaths);
ok('/src/broadcast is live', boot.bcast);
ok('NEEDS carries deathcare', !!(boot.needs && boot.needs.includes('deathcare')), JSON.stringify(boot.needs));
console.log('   roster: ' + boot.roster + ' named residents · demographics ' + (boot.demog ? 'up' : 'absent'));

/* ── 4. NOT AN INVISIBLE BUILDING, WITH A CONTROL ────────────────────── */
console.log('\n4. buildMesh arms — and a CONTROL that has none');
{
  const r = await page.evaluate(() => {
    const out = { rows: [], control: null };
    for (const t of ['graveyard', 'cemetery']) for (const l of [1, 2, 3]) out.rows.push(window.__nc.meshBox(t, l));
    /* THE CONTROL. `__nc_no_such_type` has no BUILDINGS row and no buildMesh
       arm, so it is exactly the empty Group this probe exists to catch. If the
       control does NOT read zero, the probe is measuring something else. */
    out.control = window.__nc.meshBox('__nc_no_such_type', 1);
    return out;
  });
  console.log('   CONTROL (a type with no arm): ' + JSON.stringify(r.control));
  ok('the control reads EMPTY — the probe can see the failure it is testing for',
     r.control && r.control.meshes === 0 && r.control.empty === true);
  for (const row of r.rows) {
    console.log('   ' + row.type + ' L' + row.lvl + ': ' + JSON.stringify(row));
    ok(row.type + ' L' + row.lvl + ' has geometry', !row.empty && row.meshes > 0 && row.w > 0.5 && row.h > 0.05,
       row.meshes + ' meshes, ' + row.w + '×' + row.h + '×' + row.d);
  }
  /* A level adds INSTANCES (more rows of stones), not meshes — that is what
     using an InstancedMesh buys, and a probe that counted only meshes would
     report "the level does nothing" about a building where it plainly does. */
  for (const t of ['graveyard', 'cemetery']) {
    const a = r.rows.find((x) => x.type === t && x.lvl === 1);
    const b = r.rows.find((x) => x.type === t && x.lvl === 3);
    ok(t + ': a level lays out more ground', a && b && b.instances > a.instances,
       'L1 ' + (a && a.instances) + ' → L3 ' + (b && b.instances) + ' drawn things, ' +
       (a && a.meshes) + ' draw calls either way');
  }
}

/* ── 3. THE MOOD BREAKDOWN SURVIVES ──────────────────────────────────── */
console.log('\n3. citMoodTarget() vs ctTerms() — the cross-check the panel runs');
{
  const r = await page.evaluate(() => {
    const cz = window.MythicCitizens, ui = window.MythicCitizenUI;
    const list = cz.list();
    if (!list.length) return { none: true };
    const out = [];
    for (const c of list.slice(0, 6)) {
      const terms = ui.terms(c.id);
      const sum = terms.reduce((a, t) => a + t.w * t.v, 0) * 100;
      const target = cz.moodTarget(c.id);
      out.push({ id: c.id, name: c.name, sum: +sum.toFixed(4), target: +target.toFixed(4),
                 gap: +Math.abs(sum - target).toFixed(6),
                 weights: +terms.reduce((a, t) => a + t.w, 0).toFixed(6),
                 keys: terms.map((t) => t.k).join('+'),
                 rest: terms.find((t) => t.k === 'rest') || null });
    }
    return { rows: out, cov: (window.__nc.game.cov.pct || {}).deathcare };
  });
  if (r.none) { ok('there is a roster to check', false); }
  else {
    for (const row of r.rows.slice(0, 3)) {
      console.log('   ' + row.name + ': ctTerms Σ=' + row.sum + '  citMoodTarget=' + row.target +
                  '  |gap|=' + row.gap + '  Σw=' + row.weights + '  terms=' + row.keys);
    }
    ok('five terms, not four', r.rows.every((x) => x.keys === 'morale+need+work+safe+rest'), r.rows[0].keys);
    ok('the weights still sum to exactly 1.00', r.rows.every((x) => Math.abs(x.weights - 1) < 1e-9),
       'Σw = ' + r.rows[0].weights);
    ok('the two functions agree well inside the 0.1 the panel drops at',
       r.rows.every((x) => x.gap <= 0.1), 'worst |gap| = ' + Math.max(...r.rows.map((x) => x.gap)));
    ok('the deathcare term is present and sourced', !!(r.rows[0].rest && r.rows[0].rest.src),
       r.rows[0].rest ? r.rows[0].rest.lab + ' ×' + r.rows[0].rest.w + ' = ' +
         Math.round(r.rows[0].rest.v * 100) + '% (' + r.rows[0].rest.src + ')' : '');
  }
}

/* ── 2. THE COMPLAINT IS FREE ────────────────────────────────────────── */
console.log('\n2. the complaint, through the four channels that already existed');
{
  /* Force the shortfall to be real and past the demand ramp: no graveyard is
     standing on a fresh city anyway, so this only has to run the coverage
     function once with the ramp spent. */
  const r = await page.evaluate(() => {
    const nc = window.__nc;
    nc.game.cov.ramp = 1e6;                       // the grace period, spent
    const pct = nc.coverage();
    const out = { deathcare: pct.deathcare, dem: nc.game.cov.demand.deathcare,
                  sup: (nc.game.cov.supply || {}).deathcare,
                  mortDemand: window.MythicMortality.demandPerMin(),
                  source: window.MythicMortality.report().source };
    /* CHANNEL 1 — the vitals card. It maps over NEEDS, so the row exists iff
       the need does; assert the number it would print. */
    out.card = Math.round((pct.deathcare == null ? 1 : pct.deathcare) * 100) + '%';
    /* CHANNEL 2 — "what fixes this". needFix() DERIVES the cheapest three tiles
       that answer a need from BUILDINGS' own svc.need; nothing anywhere types
       'graveyard'. Read here off the RENDERED vitals card, not by re-deriving
       it — the chip's title is where a player meets it. */
    /* …read below, after the panel's own tick has repainted it. renderVitals()
       is a top-level function in the host's module script (the globals trap
       again) and it diffs against its last html, so the honest way to read the
       chip is to spend the ramp here and let the city's own beat repaint. */
    /* CHANNEL 3 — the citizen's own dialogue, sentence 3: the weakest term.
       ⚠ A BRAND-NEW CITY HAS NOTHING, so safety is ALSO 0% and wins the tie on
         array order — a true statement about that city and a useless test of
         this branch. So every other coverage figure is pinned to met and only
         deathcare is left short, which is the state the branch exists for: a
         working city that has not thought about where the dead go. */
    const list = window.MythicCitizens.list();
    if (list.length) {
      const saved = { ...nc.game.cov.pct };
      for (const k of nc.NEEDS) nc.game.cov.pct[k] = 1;
      nc.game.cov.pct.deathcare = 0;
      const lines = window.MythicCitizenUI.lines(list[0].id);
      const terms = window.MythicCitizenUI.terms(list[0].id);
      let low = terms[0]; for (const t of terms) if (t.v < low.v) low = t;
      out.who = list[0].name;
      out.said = lines.map((l) => ({ text: l.text, why: l.why }));
      out.weakest = low.k;
      /* …and the cross-check has to survive the pinned state too, because that
         is what the panel would be running against. */
      out.pinnedGap = Math.abs(terms.reduce((a, t) => a + t.w * t.v, 0) * 100 -
                               window.MythicCitizens.moodTarget(list[0].id));
      nc.game.cov.pct = saved;
    }
    return out;
  });
  console.log('   deathcare coverage ' + r.card + '  (demand ' + Number(r.dem).toExponential(3) +
              '/min from "' + r.source + '", supply ' + (r.sup || 0) + ')');
  ok('the vitals card has a number to print for deathcare', r.deathcare != null && isFinite(r.deathcare));
  ok('a city with no graveyard reads 0% — not 100%, not undefined', r.deathcare === 0, String(r.deathcare));
  ok('the module supplied the demand, not the fallback constant',
     r.mortDemand != null && Math.abs(r.mortDemand - r.dem) < 1e-12,
     'MythicMortality.demandPerMin() = ' + Number(r.mortDemand).toExponential(3));
  /* The card repaints on the city's own beat — give it one. */
  await page.waitForTimeout(4000);
  const card = await page.evaluate(() => {
    const el = document.getElementById('vitalscard');
    const chips = el ? Array.from(el.querySelectorAll('.vchip')) : [];
    const c = chips.find((x) => /Deathcare/.test(x.getAttribute('title') || ''));
    return { chips: chips.length, title: c ? c.getAttribute('title') : null,
             text: c ? c.textContent.trim() : null };
  });
  console.log('   vitals chip: "' + card.text + '"  title=' + JSON.stringify(card.title) +
              '   (' + card.chips + ' chips rendered)');
  ok('the vitals card grew an EIGHTH chip', card.chips === 8, String(card.chips));
  ok('the chip DERIVES the graveyard as the fix — nothing types it',
     !!(card.title && /build Graveyard or Cemetery/.test(card.title)), String(card.title));
  if (r.said) {
    console.log('   ' + r.who + ' says:');
    for (const s of r.said) console.log('      "' + s.text + '"\n          why: ' + s.why);
  }
  ok('deathcare is the weakest mood term when it is the only thing short', r.weakest === 'rest', String(r.weakest));
  ok('…and sentence 3 speaks to it, with its provenance',
     !!(r.said && r.said.some((s) => /deathcare coverage/.test(s.why || ''))));
  ok('…and the mood cross-check still holds in that state', r.pinnedGap <= 0.1,
     '|gap| = ' + Number(r.pinnedGap).toFixed(6));
}

/* ── 2b. THE TWO POPULATION LAYERS AGREE ─────────────────────────────────
   🔴 AND THE RELATIONSHIP IS "SAMPLE OF", NOT "PLUS". The roster is ≤ CIT.MAX
   named people standing in for a city of hundreds, so roster deaths are the
   SAME deaths the aggregate counted, taken at the roster's share of the
   population. ADDING them would count every named person's death twice — which
   is exactly the "two different stories about the same person" failure
   node-city flags at :38310, :38400 and :37905. So the check is a ratio. */
console.log('\n2b. the aggregate and the roster tell the same story');
{
  const r = await page.evaluate(() => {
    const D = window.MythicDemographics, M = window.MythicMortality, cz = window.MythicCitizens;
    const rep = D.report();
    const st = D.state();
    const before = cz.count();
    /* A REAL CITY, not the eight-person boot city: with roster ≈ pop the share
       is 1 and the sampling is invisible. game.pop.npc is the NPC citizenry
       cityPop() reports, so this is the same number the whole layer reads.
       Restored below — nothing else is touched. */
    const savedPop = window.__nc.game.pop.npc;
    window.__nc.game.pop.npc = 400;
    const pop = window.__nc.pop();
    const share = before / pop;
    /* THREE TICKS THAT PIN THE SAMPLER'S THREE PROPERTIES, in order, from a
       debt of zero (nothing has called retireSome before this):
         a  a tick owing HALF a named death retires nobody — the roster does
            not die at 0.5 people a tick
         b  the tick that carries the debt PAST one retires exactly one
         c  a tick owing fifty retires ONE, because the per-tick cap exists so
            a population collapse cannot empty the roster on a single frame */
    const owe = (n) => n / share;
    const a = M.retireSome(owe(0.5)) || 0;
    const b = M.retireSome(owe(0.6)) || 0;
    const c = M.retireSome(owe(50)) || 0;
    window.__nc.game.pop.npc = savedPop;
    return {
      flowDied: rep.flow ? rep.flow.died : null,
      deathsTotal: rep.deathsTotal,
      cursor: st.deaths,
      mortLifetime: M.report().deaths,
      source: M.report().source,
      pop, share, before, after: cz.count(), a, b, c,
      ringNames: cz.deaths().map((d) => d.name),
    };
  });
  console.log('   demographics: deathsTotal ' + Number(r.deathsTotal).toFixed(4) +
              ' people · flow.died ' + Number(r.flowDied).toFixed(4) + '/day');
  console.log('   mortality:    lifetime ' + Number(r.mortLifetime).toFixed(4) +
              ' people, read "' + r.source + '"');
  console.log('   roster:       ' + r.before + ' named of ' + r.pop + ' residents = a ' +
              (r.share * 100).toFixed(2) + '% share, so ' + (1 / r.share).toFixed(1) +
              ' city deaths owe 1 named death');
  console.log('                 tick owing 0.5 → ' + r.a + ' retired · owing 0.6 more → ' + r.b +
              ' · owing 50 → ' + r.c + '   (roster ' + r.before + ' → ' + r.after + ')');
  ok('report() publishes a died bucket', r.flowDied != null && isFinite(r.flowDied));
  ok('report().deathsTotal IS the pipeline cursor, not a second count',
     Math.abs(r.deathsTotal - r.cursor) < 1e-9, r.deathsTotal + ' vs ' + r.cursor);
  ok('/src/mortality integrated the same counter (never more than it)',
     r.mortLifetime <= r.deathsTotal + 1e-6,
     'mortality ' + Number(r.mortLifetime).toFixed(4) + ' <= demographics ' + Number(r.deathsTotal).toFixed(4));
  ok('half a named death retires nobody — the roster is a SAMPLE, not a second set of deaths', r.a === 0, String(r.a));
  ok('crossing one retires exactly one', r.b === 1, String(r.b));
  ok('a collapse cannot empty the roster in a frame (per-tick cap)', r.c === 1, String(r.c));
  ok('the roster shrank by exactly the two it retired', r.after === r.before - 2, r.before + ' → ' + r.after);
  ok('every removal is in the ring under a name', r.ringNames.length >= 2, JSON.stringify(r.ringNames));
}

/* ── 5. THE PLOT FACTOR BITES ────────────────────────────────────────── */
console.log('\n5. a full graveyard stops covering deathcare');
{
  const r = await page.evaluate(() => {
    const M = window.MythicMortality, S = M.state();
    const before = M.plotFactor('7,7', 24);
    /* Fill it by hand through the model's own step — 24 plots, 40 dead. */
    S.used['7,7'] = 24;
    const after = M.plotFactor('7,7', 24);
    const afterUpgrade = M.plotFactor('7,7', 48);
    delete S.used['7,7'];
    return { before, after, afterUpgrade };
  });
  ok('an empty plot supplies at full rate', r.before === 1, String(r.before));
  ok('a full plot supplies NOTHING', r.after === 0, String(r.after));
  ok('extending the ground (a level) reopens it', r.afterUpgrade === 1, String(r.afterUpgrade));
}

/* ── 1. THE FEED STOPS LYING ─────────────────────────────────────────── */
console.log('\n1. the feed, after a real death');
{
  const r = await page.evaluate(async () => {
    const B = window.MythicBroadcast, cz = window.MythicCitizens;
    /* Baseline the roster snapshot so the diff has a `prev` to work from. */
    B._observe();
    const list = cz.list();
    const victim = list[0];
    const okRetire = cz.retire(victim.id, 'age');
    const ring = cz.deaths();
    const evs = B._observe();
    return {
      victim: { id: victim.id, name: victim.name },
      okRetire,
      ring,
      evs: evs.map((e) => ({ subject: e.subject, posterKind: e.posterKind, why: e.why,
                             facts: e.facts, key: e.key })),
      gone: !cz.get(victim.id),
      count: cz.count(),
    };
  });
  console.log('   retired: ' + r.victim.name + ' (' + r.victim.id + ') → ' + r.okRetire);
  console.log('   ring:    ' + JSON.stringify(r.ring));
  const deathEvs = r.evs.filter((e) => e.subject === 'death');
  const leaveEvs = r.evs.filter((e) => e.subject === 'leaving');
  console.log('   events:  ' + JSON.stringify(r.evs.filter((e) => /death|leaving|movedin/.test(e.subject)), null, 0));
  ok('the removal verb worked and the id is gone', r.okRetire && r.gone);
  ok('the ring names them', r.ring.some((d) => d.id === r.victim.id));
  ok('the observer emitted a DEATH', deathEvs.length === 1, JSON.stringify(deathEvs[0] || null));
  ok('…and NOT a "leaving" for that person',
     !leaveEvs.some((e) => e.key === 'left|' + r.victim.id), JSON.stringify(leaveEvs));
  ok('the deceased is named in the event facts', !!(deathEvs[0] && deathEvs[0].facts.q === r.victim.name),
     deathEvs[0] ? String(deathEvs[0].facts.q) : '—');
  ok('the poster is the department, not the dead person',
     !!(deathEvs[0] && deathEvs[0].posterKind === 'dept'));

  /* Now COMPOSE and PUBLISH it, and read the post the player would actually
     see.
     ⚠ `_publish(ev)` and not `_pass()`, and the reason is a real property of
       the feed rather than a convenience. A pass ranks candidates by severity
       and takes three, at most one of them institutional — and the city this
       driver boots has NOTHING built, so every one of the seven other needs is
       a 100%-severity collapse and outranks one person dying. That ranking is
       CORRECT (a death in a city that is already failing is not the top story)
       and it is not what this check is about, which is whether the composed
       post reads as a death. So the event goes straight to the composer.
     ⚠ A SECOND DEATH IS RETIRED FIRST: `_observe()` is documented as NOT free
       of side effects — it re-takes the roster snapshot — so the events read
       above are already consumed. */
  const p = await page.evaluate(() => {
    const B = window.MythicBroadcast, cz = window.MythicCitizens;
    const next = cz.list()[0];
    cz.retire(next.id, 'age');
    const evs = B._observe();
    const ev = evs.find((e) => e.subject === 'death');
    const made = ev ? [B._publish(ev)] : [];
    const subs = B.subjects().find((s) => s.id === 'death');
    const posts = B.posts({ limit: 30 }) || [];
    return {
      made: (made || []).filter(Boolean).map((x) => ({ subject: x.subject, body: x.body })),
      posts: posts.slice(0, 12).map((x) => ({ subject: x.subject, body: x.body,
                                              name: (x.poster && x.poster.name) || x.name || null,
                                              sub: (x.poster && x.poster.sub) || x.sub || null })),
      subjectRow: subs,
      variants: B.variants().bySubject.death,
      variantsCare: B.variants().bySubject.deathcare,
      deceased: next.name,
    };
  });
  console.log('   subject row: ' + JSON.stringify(p.subjectRow));
  console.log('   composer variants — death: ' + p.variants + ', deathcare: ' + p.variantsCare);
  const dp = p.posts.filter((x) => x.subject === 'death');
  for (const x of p.posts.slice(0, 8)) console.log('   [' + x.subject + '] ' + (x.name || '?') + (x.sub ? ' · ' + x.sub : '') + ' — ' + x.body);
  ok('the death subject carries the Deathcare department',
     !!(p.subjectRow && /Deathcare/i.test(p.subjectRow.dept || '')), p.subjectRow && p.subjectRow.dept);
  ok('the composer can actually reach a death post', p.variants > 0, p.variants + ' distinct bodies');
  ok('…and a deathcare complaint too', p.variantsCare > 0, p.variantsCare + ' distinct bodies');
  const published = dp[0] || null;
  ok('a death post reached the feed', !!published, published ? published.body : '(none in the last 12)');
  if (published) {
    ok('the body names the deceased', published.body.includes(p.deceased.split(' ')[0]), published.body);
    ok('the post is NOT signed "former resident"', published.sub !== 'former resident', String(published.sub));
    ok('the post does not say they moved away', !/leaving the city|moving on|packing up/i.test(published.body));
  }
}

await browser.close();
await new Promise((r) => server.close(r));

const noise = logs.filter((l) => /not mounted|self-check FAILED|pageerror/i.test(l));
if (noise.length) { console.log('\nconsole of interest:'); console.log(noise.slice(0, 15).join('\n')); }
console.log('\n' + (fails ? '❌ ' + fails + ' CHECK(S) FAILED' : '✅ DEATHCARE DRIVEN GATE PASSED'));
process.exit(fails ? 1 : 0);
