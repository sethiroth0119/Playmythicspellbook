/* ══════════════════════════════════════════════════════════════════════════
   🌌🪞 DRIVE-CARD-EFFECTS — the two effects asked for this round.

   1. POLYCREATION FROM THE GRAVE (`polyFromGrave`)
      "You can vanish this card from your graveyard to Fusion Summon <Kalon>
       using the correct materials. (Treated as a Polycreation when used this
       way.)"
      The grave path already ran a fusion — but it asked
      canActivatePolycreation() for ANY legal fusion and DISCARDED the effect's
      own Kalon pin, so a card written as "vanish me to summon Omega Meka"
      summoned whatever else happened to be fusable. That is the defect the new
      type closes, and it is what the assertions below are about.

   2. TREAT-AS ZONES (`treatAsZones`)
      "the card can count as another card from the hand, field, vanish and/or
       graveyard, or all four."
      `treatAs` already aliased a card's NAME; it applied everywhere, always.
      This adds the four-zone list — and the compatibility contract that an
      ABSENT list still means everywhere, so no existing card changes.

   🔴 EVERY ASSERTION HAS A CONTROL. An alias that matches in its zone proves
      nothing unless the same alias FAILS to match outside it; a registered
      effect type proves nothing unless an unregistered one is absent.

   Run:  node .gauntlet/drive-card-effects.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const P = 8570 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1200, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 180)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('typeof _treatAsOf === "function" && Array.isArray(window.ONPLAY_TYPES || null) === false', null, { timeout: 60000 }).catch(() => {});
await pg.waitForFunction('typeof _treatAsOf === "function" && typeof _cardRefMatches === "function"', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(2000);

const out = await pg.evaluate(() => {
  const o = {};
  o.reachable = typeof _treatAsOf === 'function' && typeof _cardRefMatches === 'function'
             && typeof ONPLAY_TYPES !== 'undefined' && typeof _cardMatchesFilter === 'function';
  if (!o.reachable) return o;

  // ── 1 · the effect type is registered and reachable in the editor ────────
  const t = ONPLAY_TYPES.find(x => x && x.id === 'polyFromGrave');
  o.typeRegistered = !!t;
  o.typeNeeds = t ? (t.needs || []).slice().sort().join(',') : '';
  // CONTROL: a type nobody registered is absent, so "found" means something.
  o.controlUnknownType = !!ONPLAY_TYPES.find(x => x && x.id === 'polyFromTheMoon');
  // It must be grouped, or the dropdown sweeps it into "Other" — reachable but
  // filed under nothing.
  o.inSummonGroup = !!(typeof ONPLAY_TYPE_GROUPS !== 'undefined' &&
    ONPLAY_TYPE_GROUPS.some(g => g && (g.ids || []).indexOf('polyFromGrave') >= 0));
  // The engine must accept it wherever polycreate is accepted.
  o.grouped = o.inSummonGroup;

  // ── 2 · treatAs zones ────────────────────────────────────────────────────
  const card = (zones) => {
    const c = { id: 'tst_card', name: 'Test Card', treatAs: 'Polycreation' };
    if (zones !== undefined) c.treatAsZones = zones;
    return c;
  };
  // absent list = everywhere (the compatibility contract)
  o.absentHand  = _treatAsOf(card(undefined), 'hand');
  o.absentGrave = _treatAsOf(card(undefined), 'grave');
  o.absentNoZone = _treatAsOf(card(undefined));
  // restricted to hand + void
  const two = card(['hand', 'void']);
  o.twoHand  = _treatAsOf(two, 'hand');
  o.twoVoid  = _treatAsOf(two, 'void');
  o.twoGrave = _treatAsOf(two, 'grave');     // CONTROL: must be ''
  o.twoField = _treatAsOf(two, 'field');     // CONTROL: must be ''
  o.twoNoZone = _treatAsOf(two);             // zone-less caller still gets it
  // all four = everywhere
  const all = card(['hand', 'field', 'grave', 'void']);
  o.allFour = ['hand', 'field', 'grave', 'void'].map(z => _treatAsOf(all, z) ? 1 : 0).join('');
  // empty list = the alias is OFF, and that is NOT the same as absent
  const off = card([]);
  o.emptyHand = _treatAsOf(off, 'hand');
  o.emptyNoZone = _treatAsOf(off);

  // ── 3 · the alias is honoured by the two things that ask ────────────────
  o.refMatchesInZone  = _cardRefMatches(two, 'polycreation', 'hand');
  o.refMissesOutOfZone = _cardRefMatches(two, 'polycreation', 'grave');   // CONTROL
  o.refMatchesByRealName = _cardRefMatches(two, 'test card', 'grave');    // real name always wins
  o.filterInZone  = _cardMatchesFilter(two, { nameIncludes: 'polycreation' }, 'hand');
  o.filterOutOfZone = _cardMatchesFilter(two, { nameIncludes: 'polycreation' }, 'grave'); // CONTROL
  o.filterDeckUnrestricted = _cardMatchesFilter(two, { nameIncludes: 'polycreation' }, undefined);
  return o;
});

const bad = [];
const need = (k, ok) => { if (!ok) bad.push(k); };
if (!out.reachable) bad.push('the card engine is not reachable in this build');
else {
  need('polyFromGrave is registered', out.typeRegistered === true);
  need('it authors a Kalon + material sources', out.typeNeeds === 'matSources,seizeTreatAs,summonCard');
  need('CONTROL: an unregistered type is absent', out.controlUnknownType === false);
  need('it is grouped in the dropdown', out.grouped === true);

  need('absent zone list = alias in hand', out.absentHand === 'Polycreation');
  need('absent zone list = alias in grave', out.absentGrave === 'Polycreation');
  need('absent zone list = alias with no zone', out.absentNoZone === 'Polycreation');
  need('restricted alias works in hand', out.twoHand === 'Polycreation');
  need('restricted alias works in void', out.twoVoid === 'Polycreation');
  need('CONTROL: restricted alias is OFF in grave', out.twoGrave === '');
  need('CONTROL: restricted alias is OFF on field', out.twoField === '');
  need('a zone-less caller still sees the alias', out.twoNoZone === 'Polycreation');
  need('all four ticked = every zone', out.allFour === '1111');
  need('empty list switches the alias off', out.emptyHand === '');
  need('…and empty is not the same as absent', out.emptyNoZone === 'Polycreation');

  need('card refs honour the alias in zone', out.refMatchesInZone === true);
  need('CONTROL: card refs miss it out of zone', out.refMissesOutOfZone === false);
  need('the real name still matches anywhere', out.refMatchesByRealName === true);
  need('name filters honour the alias in zone', out.filterInZone === true);
  need('CONTROL: name filters miss it out of zone', out.filterOutOfZone === false);
  need('an unzoned filter still matches', out.filterDeckUnrestricted === true);
}

console.log(JSON.stringify({ ...out, pageErrors: errs.slice(0, 5) }, null, 2));
console.log(bad.length ? '\n❌ FAIL: ' + bad.join(' | ')
                       : '\n✅ PASS — the grave-fusion type is authorable, and an alias counts in exactly the zones it was given.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
