/* 🧮 THE STASH MERGES ON THE SERVER (bug-mu8vnos5, sql/190_salvage_merge.sql).

   Reported: "bought 4-5 stacks of 100 ammo, Cinder deducted, ammo not received."
   Two devices open: the buy landed on one, and the other (idle, stale) uploaded
   its whole ledger next — user_profiles is last-writer-wins. The 7dc274b0 stamp
   made the NEWER ledger win by device clock, which a fast clock can abuse.

   Now the upload carries base + current and sql/190's trigger adds the
   device's change onto what the row holds. This smoke models that trigger in
   JS (same arithmetic and the same four branches as the SQL — keep them in
   step) and drives the REAL client functions lifted from index.html:
     two devices buy/donate concurrently → both changes survive
     a lost reply + retry applies once
     sql/190 not applied (no ack) → the old path, unchanged
     a device with its clock set ahead cannot erase another device's gains

   Run: node _salvagemerge_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
const SQL = readFileSync('./sql/190_salvage_merge.sql', 'utf8');
function fnText(name) {
  let i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name);
  if (SRC.slice(i - 6, i) === 'async ') i -= 6;
  let d = 0, j = SRC.indexOf('{', i);
  for (let k = j; k < SRC.length; k++) { if (SRC[k] === '{') d++; else if (SRC[k] === '}') { d--; if (!d) return SRC.slice(i, k + 1); } }
}
const J = (o) => JSON.stringify(o);
const clone = (o) => JSON.parse(JSON.stringify(o));

// ── the server: a JS model of public.up_salvage_merge() ──────────────────────
const num = (v) => (typeof v === 'number' ? v : 0);
function mergeCalc(stored, cur, base) {          // = public.salvage_merge_calc
  stored = stored || {}; cur = cur || {}; base = base || {};
  const out = {};
  for (const k of new Set([...Object.keys(stored), ...Object.keys(cur)])) out[k] = Math.max(0, Math.trunc(num(stored[k]) + num(cur[k]) - num(base[k])));
  return out;
}
function makeServer(salvage, { trigger = true } = {}) {
  const S = { user: 'u1', forge: { __salvage__: clone(salvage) }, devices: {}, trigger, dropReply: 0, parseErr: false, writes: 0 };
  S.update = (NEW) => {                           // BEFORE UPDATE, then the row is written
    const OLDf = S.forge;
    if (!S.trigger) { S.forge = NEW; return NEW; }
    const stored = OLDf && OLDf.__salvage__ && typeof OLDf.__salvage__ === 'object' ? OLDf.__salvage__ : null;
    if (!('__salvage__' in NEW)) {                                      // (a)
      if (stored) { NEW.__salvage__ = stored; if ('__salvageAck__' in OLDf) NEW.__salvageAck__ = OLDf.__salvageAck__; }
      S.forge = NEW; return NEW;
    }
    if (!('__salvageSync__' in NEW)) { S.forge = NEW; return NEW; }     // (b)
    const req = NEW.__salvageSync__; delete NEW.__salvageSync__;
    const cur = NEW.__salvage__;
    const bad = !req || typeof req !== 'object' || !cur || typeof cur !== 'object' || !req.base || typeof req.base !== 'object'
             || typeof req.dev !== 'string' || req.dev.length < 8 || req.dev.length > 64 || typeof req.wid !== 'number' || req.wid <= 0;
    if (bad) { S.forge = NEW; return NEW; }
    const bid = typeof req.bid === 'number' ? req.bid : 0;
    const st = S.devices[req.dev];
    if (st && req.wid <= st.last) {                                     // (c) replay
      NEW.__salvage__ = stored || cur; NEW.__salvageAck__ = { dev: req.dev, wid: req.wid, replay: true };
      S.forge = NEW; return NEW;
    }
    let merged;                                                         // (d)
    if (!stored) merged = mergeCalc({}, cur, {});
    else merged = mergeCalc(stored, cur, (st && bid < st.last && st.cur) ? st.cur : req.base);
    S.devices[req.dev] = { last: req.wid, cur: clone(cur) };
    NEW.__salvage__ = merged; NEW.__salvageAck__ = { dev: req.dev, wid: req.wid };
    S.forge = NEW; S.writes++; return NEW;
  };
  S.client = {
    from: () => ({
      upsert: (row) => {
        const exec = (sel) => {
          if (sel && S.parseErr) return { data: null, error: { code: 'PGRST100', message: 'failed to parse select' } };
          const f = S.update(clone(row.forge));
          if (S.dropReply > 0) { S.dropReply--; return { data: null, error: { message: 'Failed to fetch' } }; }
          return { data: sel ? [{ salv: f.__salvage__ ?? null, sack: f.__salvageAck__ ?? null }] : null, error: null };
        };
        return { then: (res, rej) => Promise.resolve(exec(false)).then(res, rej), select: () => Promise.resolve(exec(true)) };
      },
    }),
  };
  return S;
}

// ── a device: the REAL client functions in their own context ─────────────────
const FNS = ['_salvageStampIfChanged', '_salvageHydrate', '_salvageClone', '_salvageSame', '_salvageNoteBoot',
  '_salvageSyncState', '_salvageSyncRequest', '_salvageAdoptReply', '_salvageHydrateSync', '_profileUpsert'];
function device(S, salvage, opts = {}) {
  const store = {};
  const Profile = { salvage: clone(salvage), cloud: { userId: opts.uid || 'u1' } };
  const clock = { now: opts.now || 1_000_000 };
  const ctx = {
    console: { log() {}, warn() {}, info() {} }, JSON, Math, Number, Set, Object, Array, String, Promise,
    Date: { now: () => clock.now },
    Profile, Cloud: { client: S.client },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    _ensureResources: () => Profile.salvage,
    _persistResourcesSoon: () => { ctx.__persisted = (ctx.__persisted || 0) + 1; },
  };
  vm.createContext(ctx);
  vm.runInContext('var _salvageSig = null; var _salvageBootBase = null; var _salvageSelectOff = false;\n' + FNS.map(fnText).join('\n'), ctx);
  const dev = {
    ctx, Profile, clock, S,
    hydrate: () => ctx._salvageHydrateSync(clone(S.forge.__salvage__), clone(S.forge)),
    // the salvage lines of cloudSyncProfile: build → strip (deep copy) → upsert → adopt
    async sync({ midFlight } = {}) {
      const rowRaw = { forge: { __salvage__: Profile.salvage, __salvageAt__: 0, __salvageSync__: ctx._salvageSyncRequest() } };
      const row = clone(rowRaw);
      const p = ctx._profileUpsert(row);
      if (midFlight) midFlight();
      const res = await p;
      if (res.error) return { error: res.error, row };
      return { adopted: ctx._salvageAdoptReply(row.forge, Array.isArray(res.data) ? res.data[0] : res.data), row };
    },
    async retry(row) {                     // _retryCloudOp resends the SAME row
      const res = await ctx._profileUpsert(row);
      if (res.error) return { error: res.error };
      return { adopted: ctx._salvageAdoptReply(row.forge, Array.isArray(res.data) ? res.data[0] : res.data) };
    },
  };
  return dev;
}

console.log('── the reported bug: two devices, both changes survive ──');
{
  const S = makeServer({ ammo: 100, metal: 50 });
  const A = device(S, {}), B = device(S, {});
  ok(A.hydrate() !== 'none' && B.hydrate() !== 'none', 'both devices hydrate from the row');
  A.Profile.salvage.ammo += 400;                       // 4 stacks of 100 ammo bought on the desktop
  B.Profile.salvage.metal -= 50;                       // the phone donates its Metal, never having seen the ammo
  const ra = await A.sync(), rb = await B.sync();
  ok(ra.adopted === 'merged' && rb.adopted === 'merged', 'both uploads are merged by the server', ra.adopted + '/' + rb.adopted);
  ok(J(S.forge.__salvage__) === J({ ammo: 500, metal: 0 }), 'the row holds the ammo AND the donation', J(S.forge.__salvage__));
  ok(B.Profile.salvage.ammo === 500 && B.Profile.salvage.metal === 0, 'the stale device now shows the ammo bought elsewhere', J(B.Profile.salvage));
  ok(A.hydrate() === 'server' && A.Profile.salvage.metal === 0, 'the buyer adopts the donation on its next fetch (no MAX resurrection)', J(A.Profile.salvage));
}
{
  const S = makeServer({ ammo: 100 });
  const A = device(S, {}), B = device(S, {});
  A.hydrate(); B.hydrate();
  A.Profile.salvage.ammo = 500; await A.sync();
  const before = J(S.forge.__salvage__);
  await B.sync();                                      // idle device: its debounced save fires with the stale map
  ok(J(S.forge.__salvage__) === before, 'an idle stale device uploading changes nothing (mu8vnos5)', J(S.forge.__salvage__));
}
{
  const S = makeServer({ ammo: 100 });
  const A = device(S, {}), B = device(S, {});
  A.hydrate(); B.hydrate();
  await A.sync({ midFlight: () => { A.Profile.salvage.ammo += 7; } });   // spent/gained while the request was out
  B.Profile.salvage.ammo += 10; await B.sync();
  A.Profile.salvage.ammo += 0; await A.sync();
  ok(S.forge.__salvage__.ammo === 117, 'a change made while the request was in flight is kept and uploaded once', S.forge.__salvage__.ammo);
}

console.log('── idempotency: a lost reply is applied once ──');
{
  const S = makeServer({ ammo: 100 });
  const A = device(S, {}); A.hydrate();
  A.Profile.salvage.ammo = 300;
  S.dropReply = 1;                                     // the write lands, the reply is lost
  const r1 = await A.sync();
  ok(r1.error && S.forge.__salvage__.ammo === 300, 'the first attempt landed but reported an error', J(S.forge.__salvage__));
  const r2 = await A.retry(r1.row);                    // transient-retry resends the same row / write id
  ok(r2.adopted === 'merged' && S.forge.__salvageAck__.replay === true, 'the retry is recognised as a replay');
  ok(S.forge.__salvage__.ammo === 300 && A.Profile.salvage.ammo === 300, 'and the +200 is NOT applied twice', S.forge.__salvage__.ammo);
}
{
  const S = makeServer({ ammo: 100 });
  const A = device(S, {}), B = device(S, {}); A.hydrate(); B.hydrate();
  A.Profile.salvage.ammo = 300;
  S.dropReply = 1; await A.sync();                     // landed, reply lost, retries all failed → next save builds a NEW request
  B.Profile.salvage.ammo += 5; await B.sync();
  A.Profile.salvage.ammo += 50; await A.sync();        // base is still the pre-300 one
  ok(S.forge.__salvage__.ammo === 355, 'a new write on a stale base uses the server\'s record of the landed write (100+200+5+50)', S.forge.__salvage__.ammo);
}
{
  const S = makeServer({ ammo: 100 });
  const A = device(S, {}); A.hydrate();
  A.Profile.salvage.ammo = 300;
  S.dropReply = 1; await A.sync();                     // landed, reply lost
  ok(A.hydrate() === 'held', 'hydration with an unacknowledged write holds the ledger instead of guessing');
  ok(A.ctx.__persisted > 0, 'and schedules the upload that reconciles it');
  await A.sync();
  ok(S.forge.__salvage__.ammo === 300 && A.Profile.salvage.ammo === 300, 'which then settles at the true count', J(S.forge.__salvage__));
}

console.log('── sql/190 not applied: the old path, unchanged ──');
{
  const S = makeServer({ ammo: 100 }, { trigger: false });
  const A = device(S, {}); A.hydrate();
  A.Profile.salvage.ammo = 250;
  const r = await A.sync();
  ok(r.adopted === 'plain', 'no acknowledgement → nothing adopted', r.adopted);
  ok(J(S.forge.__salvage__) === J({ ammo: 250 }) && A.Profile.salvage.ammo === 250, 'the row holds exactly what was sent (whole-map write, as today)');
  ok(A.hydrate() !== 'server' && A.hydrate() !== 'held', 'hydration of an unmerged row goes through the stamp logic (7dc274b0)');
  S.trigger = true;                                    // the file is applied later: no restart needed
  const B = device(S, {}); B.hydrate();
  B.Profile.salvage.ammo += 10; A.Profile.salvage.ammo -= 50;
  await B.sync(); await A.sync();
  ok(S.forge.__salvage__.ammo === 210, 'once applied, the next saves merge (250+10−50)', S.forge.__salvage__.ammo);
}
{
  const S = makeServer({ ammo: 100 });
  S.parseErr = true;                                   // PostgREST refuses the select (never expected)
  const A = device(S, {}); A.hydrate();
  A.Profile.salvage.ammo = 120;
  const r = await A.sync();
  ok(!r.error && S.forge.__salvage__.ammo === 120, 'a rejected select falls back to the plain upsert — the save still lands', J(r.error));
  ok(A.ctx._salvageSelectOff === true || vm.runInContext('_salvageSelectOff', A.ctx) === true, 'and the select stays off for the session');
}
{
  const S = makeServer({ ammo: 100 });
  const A = device(S, { ammo: 100 });                  // local-is-fresher boot: no hydration at all
  A.ctx._salvageNoteBoot({ salvage: { ammo: 100 } });
  A.Profile.salvage.ammo = 90;
  const r = await A.sync();
  ok(r.row.forge.__salvageSync__ && J(r.row.forge.__salvageSync__.base) === J({ ammo: 100 }), 'with no hydration the boot ledger is the base, so even the first save merges');
  const C = device(S, {});                             // a device with nothing at all: no base → whole-map write once
  ok(C.ctx._salvageSyncRequest() === null, 'a device with no base sends no merge request (old behaviour for that one write)');
}

console.log('── a clock set ahead cannot erase gains ──');
{
  const S = makeServer({ ammo: 100, gold: 10 });
  const A = device(S, {}), F = device(S, {}, { now: 9e12 });   // F's clock is years fast
  A.hydrate(); F.hydrate();
  A.Profile.salvage.ammo += 400; await A.sync();
  F.Profile.salvage.gold += 1; F.ctx.Profile.salvageAt = 9e12; await F.sync();
  ok(S.forge.__salvage__.ammo === 500 && S.forge.__salvage__.gold === 11, 'the fast-clock device adds its gold and the ammo survives', J(S.forge.__salvage__));
  A.Profile.salvage.ammo += 1; await A.sync();
  ok(S.forge.__salvage__.ammo === 501, 'write ids are per device, so a huge id on one device never blocks another', S.forge.__salvage__.ammo);
}

console.log('── accounts and devices ──');
{
  const S = makeServer({ ammo: 100 });
  const A = device(S, {}); A.hydrate();
  const dev1 = A.Profile.salvageSync.dev;
  A.Profile.cloud.userId = 'u2';                        // another account signs in on this device
  const st = A.ctx._salvageSyncState();
  ok(st.base === null && st.seq === 0, 'a different account never inherits the previous account\'s base');
  ok(st.dev === dev1, 'but the device keeps its id');
  const B = device(S, {}); B.Profile.salvageSync = clone(A.Profile.salvageSync);   // a save copied between devices
  B.ctx.localStorage.setItem('hg_salvage_dev', 'other-device-id');
  ok(B.ctx._salvageSyncState().dev === 'other-device-id', 'a Profile copied onto another device does not share its write-id stream');
}
{
  const S = makeServer({ ammo: 100 });
  S.update({ webPurchases: [] });                      // the receipt write sets forge = { webPurchases }
  ok(J(S.forge.__salvage__) === J({ ammo: 100 }), 'a forge write that omits __salvage__ keeps the stored ledger');
}

console.log('── the JS model matches the SQL ──');
ok(/greatest\(0::numeric, trunc\(public\.salvage_num\(s\.j -> keys\.k\)\s*\+ public\.salvage_num\(c\.j -> keys\.k\)\s*- public\.salvage_num\(b\.j -> keys\.k\)\)\)/.test(SQL), 'merge = max(0, trunc(stored + cur − base))');
ok(/if have and wid <= st_last then/.test(SQL), 'replay branch: wid <= last applied');
ok(/when have and bid < st_last and jsonb_typeof\(st_cur\) = 'object'\s*then st_cur else cbase/.test(SQL), 'stale-base branch uses the stored last_cur');
ok(/if not \(NEW\.forge \? '__salvage__'\) then/.test(SQL) && /if not \(NEW\.forge \? '__salvageSync__'\) then\s*return NEW;/.test(SQL), 'no ledger → keep stored; no request → last writer wins');
ok(/NEW\.forge := NEW\.forge - '__salvageSync__'/.test(SQL), 'the request is never stored');
ok(/create trigger up_salvage_merge before update on public\.user_profiles/.test(SQL), 'the trigger is BEFORE UPDATE only (a BEFORE INSERT would rewrite EXCLUDED)');

console.log('── wiring in cloudSyncProfile / cloudFetchProfile / the loader ──');
const sync = fnText('cloudSyncProfile');
ok(/__salvageSync__: _salvageSyncRequest\(\),/.test(sync), 'the upload carries the merge request');
ok(/let \{ data: _salvReply, error \} = await _profileUpsert\(row\);/.test(sync), 'the upsert reads the merged ledger back');
ok(/\(\) => _profileUpsert\(row\),/.test(sync) && /_salvReply = r\.result && r\.result\.data;/.test(sync), 'the transient retry resends the same row and keeps its reply');
ok(/_salvageAdoptReply\(row\.forge, Array\.isArray\(_salvReply\)/.test(sync), 'success adopts the reply');
ok(/_salvageHydrateSync\(_cloudSalvage, data\.forge\);/.test(fnText('cloudFetchProfile')), 'hydration goes through _salvageHydrateSync');
ok(/_salvageNoteBoot\(p\);/.test(SRC), 'the local loader restores the sync state');

console.log(fails ? `\n✗ ${fails} failed` : '\n✓ all passed');
process.exit(fails ? 1 : 0);
