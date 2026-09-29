/* ══════════════════════════════════════════════════════════════════════════
   🏦 DRIVE-VAULTMOVE — EXECUTE the vault deposit/withdraw bridge, don't parse it.

   _synckcheck.mjs proves index.html PARSES. It says nothing about whether a
   withdrawal actually credits the player, whether it credits the number the
   SERVER moved or the number the client asked for, or whether an unapplied
   migration is told apart from a real refusal. All three are runtime claims,
   and the first one is the difference between a working feature and minting.

   So `_jbHandleAction`, `_jbRpcMissing` and `_jbCardArtUrl` are lifted out of
   the SHIPPED public/index.html by brace matching and run against fake
   PostgREST clients. Nothing below is a copy of any of them.

   Run:  node .gauntlet/drive-vaultmove.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';

const SRC = fs.readFileSync(path.resolve(process.cwd(), 'public/index.html'), 'utf8');

function fnAt(src, sig) {
  const at = src.indexOf(sig);
  if (at < 0) return null;
  let i = src.indexOf('{', at + sig.length);
  if (i < 0) return null;
  let d = 0;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (ch === '{') d++;
    else if (ch === '}') { d--; if (d === 0) return src.slice(at, j + 1); }
  }
  return null;
}

const FN_ACT  = fnAt(SRC, 'function _jbHandleAction(a)');
const FN_MISS = fnAt(SRC, 'function _jbRpcMissing(err)');
const FN_ART  = fnAt(SRC, 'function _jbCardArtUrl(id)');

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name + (detail == null ? '' : '   ' + detail));
};

console.log('\n0. everything under test was lifted out of the SHIPPED file');
ok('_jbHandleAction found', !!FN_ACT, FN_ACT ? FN_ACT.length + ' chars' : 'NOT FOUND');
ok('_jbRpcMissing found', !!FN_MISS, FN_MISS ? FN_MISS.length + ' chars' : 'NOT FOUND');
ok('_jbCardArtUrl found', !!FN_ART, FN_ART ? FN_ART.length + ' chars' : 'NOT FOUND');
if (!FN_ACT || !FN_MISS || !FN_ART) { console.log('\n❌ cannot continue'); process.exit(1); }

/* ── the world the handler runs in ─────────────────────────────────────────
   Every identifier the vault paths touch is a named parameter, so nothing
   silently falls through to a real global. */
const PARAMS = ['Corp', 'Profile', 'Cloud', 'initCloud', 'showToast', '_jbSendData',
  'corpEnsure', 'saveProfile', '_jbEcon', '_resolveAnyCardById', '_jbItemMeta',
  '_ensureResources', '_meta', '_jbDeckNeed', 'Forge', 'getThumb', '_frameUrl'];

function build() {
  return new Function(...PARAMS,
    FN_MISS + '\n' + FN_ART + '\n' + FN_ACT + '\nreturn { act: _jbHandleAction, missing: _jbRpcMissing, art: _jbCardArtUrl };');
}

/* A fake PostgREST client. `rpc` answers from a table of scripted results;
   every call is recorded so "which path did it take" is measured, not assumed. */
function makeCloud(script, log) {
  const chain = (table) => {
    const q = {
      select() { return q; },
      eq() { return q; },
      maybeSingle() { log.push({ op: 'maybeSingle', table }); return Promise.resolve(script.row || { data: null }); },
      limit() { return Promise.resolve(script.rows || { data: [] }); },
      upsert(obj) { log.push({ op: 'upsert', table, obj }); return Promise.resolve(script.upsert || {}); },
    };
    return q;
  };
  return {
    client: {
      from(t) { log.push({ op: 'from', table: t }); return chain(t); },
      rpc(name, args) {
        log.push({ op: 'rpc', name, args });
        const r = script.rpc && script.rpc[name];
        return Promise.resolve(typeof r === 'function' ? r(args) : (r || { data: null }));
      },
    },
  };
}

async function run(action, script, seed) {
  const log = [];
  const toasts = [];
  const saves = { n: 0 };
  const Profile = Object.assign({
    cloud: { signedIn: true, userId: 'u-me', displayName: 'Charlie' },
    cardCollection: {}, itemInventory: {}, salvage: {},
  }, (seed && seed.Profile) || {});
  const Corp = Object.assign({ mine: { id: 'corp-1', name: 'BLACK SUN' }, vault: [], vaultRpc: 'unknown' },
                             (seed && seed.Corp) || {});
  const Cloud = makeCloud(script || {}, log);
  const api = build()(
    Corp, Profile, Cloud,
    () => true,
    (m) => toasts.push(String(m)),
    () => { log.push({ op: 'sendData' }); },
    () => { log.push({ op: 'corpEnsure' }); return Promise.resolve(); },
    () => { saves.n++; },
    () => ({ handle: 'Charlie' }),
    (id) => ({ id, name: 'Card ' + id, icon: '🃏' }),
    (id) => ({ name: 'Item ' + id, icon: '🎒' }),
    () => Profile.salvage,
    (id) => ({ name: 'Res ' + id, icon: '⚙' }),
    () => ({}),
    (seed && seed.Forge) || {},
    (seed && seed.getThumb) || (() => null),
    (v) => (typeof v === 'string' ? v : ''),
  );
  api.act(action);
  // The handler runs its work in an async IIFE; let the microtask chain drain.
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 5));
  return { Corp, Profile, log, toasts, saves, api };
}

const rpcCalls = (log, name) => log.filter((e) => e.op === 'rpc' && e.name === name);

// ── 1. WITHDRAW: the happy path ─────────────────────────────────────────────
console.log('\n1. withdraw credits the player and asks the right RPC');
{
  const { Corp, Profile, log, toasts, saves } = await run(
    { kind: 'vaultWithdraw', itemKind: 'resource', itemId: 'scrapMetal', qty: 5 },
    { rpc: { corp_vault_withdraw: { data: 5 } } },
    { Profile: { salvage: { scrapMetal: 2 } } });
  const c = rpcCalls(log, 'corp_vault_withdraw');
  ok('🔴 it calls corp_vault_withdraw, once', c.length === 1, JSON.stringify(c.map((x) => x.name)));
  ok('…with the corp, kind, item and qty it was given',
     c.length === 1 && c[0].args.p_corp_id === 'corp-1' && c[0].args.p_kind === 'resource'
     && c[0].args.p_item_id === 'scrapMetal' && c[0].args.p_qty === 5, JSON.stringify(c[0] && c[0].args));
  ok('…and the actor name, so the ledger row has someone on it', c[0].args.p_actor_name === 'Charlie');
  ok('🔴 the resource is credited by exactly the amount withdrawn (2 → 7)', Profile.salvage.scrapMetal === 7,
     String(Profile.salvage.scrapMetal));
  ok('the profile is saved', saves.n === 1, String(saves.n));
  ok('the vault is re-read so the screen cannot show the pre-withdrawal list',
     log.some((e) => e.op === 'corpEnsure'));
  ok('the player is told what moved', toasts.some((t) => /Withdrew 5/.test(t)), JSON.stringify(toasts));
  ok('the RPC being present is remembered', Corp.vaultRpc === 'ok', Corp.vaultRpc);
  ok('no direct write to corp_vault was attempted', !log.some((e) => e.op === 'upsert'));
}

// ── 2. it credits what the SERVER moved, never what was asked ───────────────
console.log('\n2. the server is the authority on how much moved');
{
  const { Profile, toasts } = await run(
    { kind: 'vaultWithdraw', itemKind: 'resource', itemId: 'scrapMetal', qty: 10 },
    { rpc: { corp_vault_withdraw: { data: 4 } } },
    { Profile: { salvage: {} } });
  ok('🔴 asked for 10, server moved 4 → the player gets 4, not 10', Profile.salvage.scrapMetal === 4,
     String(Profile.salvage.scrapMetal));
  ok('…and is told 4', toasts.some((t) => /Withdrew 4/.test(t)), JSON.stringify(toasts));
}
{
  const { Profile, toasts } = await run(
    { kind: 'vaultWithdraw', itemKind: 'resource', itemId: 'scrapMetal', qty: 3 },
    { rpc: { corp_vault_withdraw: { data: 0 } } },
    { Profile: { salvage: { scrapMetal: 9 } } });
  ok('🔴 a zero return credits nothing at all', Profile.salvage.scrapMetal === 9, String(Profile.salvage.scrapMetal));
  ok('…and says so instead of claiming success', toasts.some((t) => /Nothing was withdrawn/.test(t)), JSON.stringify(toasts));
}

// ── 3. cards and items land in the right inventory ──────────────────────────
console.log('\n3. each kind is credited to its own inventory');
{
  const { Profile } = await run(
    { kind: 'vaultWithdraw', itemKind: 'card', itemId: 'card:ashen', qty: 2 },
    { rpc: { corp_vault_withdraw: { data: 2 } } },
    { Profile: { cardCollection: { 'card:ashen': 1 } } });
  ok('a card goes to Profile.cardCollection (1 → 3)', Profile.cardCollection['card:ashen'] === 3,
     String(Profile.cardCollection['card:ashen']));
  ok('…and nothing leaks into the other two inventories',
     Object.keys(Profile.itemInventory).length === 0 && Object.keys(Profile.salvage).length === 0);
}
{
  const { Profile } = await run(
    { kind: 'vaultWithdraw', itemKind: 'item', itemId: 'relic:coil', qty: 1 },
    { rpc: { corp_vault_withdraw: { data: 1 } } }, {});
  ok('an item goes to Profile.itemInventory', Profile.itemInventory['relic:coil'] === 1,
     String(Profile.itemInventory['relic:coil']));
}

// ── 4. the two failure modes are told apart ─────────────────────────────────
console.log('\n4. an unapplied migration is not a failed action');
{
  const { Corp, Profile, toasts } = await run(
    { kind: 'vaultWithdraw', itemKind: 'resource', itemId: 'scrapMetal', qty: 5 },
    { rpc: { corp_vault_withdraw: { error: { code: 'PGRST202', message: 'Could not find the function public.corp_vault_withdraw in the schema cache' } } } },
    { Profile: { salvage: { scrapMetal: 2 } } });
  ok('🔴 PGRST202 names the file to apply', toasts.some((t) => /sql\/045_corp_vault_rpcs\.sql/.test(t)), JSON.stringify(toasts));
  ok('🔴 …and marks the feature missing so the screen can disable it', Corp.vaultRpc === 'missing', Corp.vaultRpc);
  ok('🔴 …and credits the player NOTHING', Profile.salvage.scrapMetal === 2, String(Profile.salvage.scrapMetal));
}
{
  const { Corp, Profile, toasts } = await run(
    { kind: 'vaultWithdraw', itemKind: 'resource', itemId: 'scrapMetal', qty: 500 },
    { rpc: { corp_vault_withdraw: { error: { code: 'P0001', message: 'the vault holds only 12 of Scrap Metal' } } } },
    { Profile: { salvage: { scrapMetal: 2 } } });
  ok("🔴 a real refusal shows the server's own reason", toasts.some((t) => /holds only 12/.test(t)), JSON.stringify(toasts));
  ok('…and does NOT blame the migration', !toasts.some((t) => /045/.test(t)));
  ok('…and does not mark the feature missing', Corp.vaultRpc !== 'missing', Corp.vaultRpc);
  ok('…and credits nothing', Profile.salvage.scrapMetal === 2, String(Profile.salvage.scrapMetal));
}

// ── 5. the guards ───────────────────────────────────────────────────────────
console.log('\n5. nothing moves on a malformed or impossible request');
for (const [label, action, seed] of [
  ['qty 0',           { kind: 'vaultWithdraw', itemKind: 'resource', itemId: 'scrapMetal', qty: 0 }, {}],
  ['negative qty',    { kind: 'vaultWithdraw', itemKind: 'resource', itemId: 'scrapMetal', qty: -5 }, {}],
  ['qty undefined',   { kind: 'vaultWithdraw', itemKind: 'resource', itemId: 'scrapMetal' }, {}],
  ['unknown kind',    { kind: 'vaultWithdraw', itemKind: 'deed', itemId: 'x', qty: 1 }, {}],
  ['no item id',      { kind: 'vaultWithdraw', itemKind: 'resource', itemId: '', qty: 1 }, {}],
  ['no corporation',  { kind: 'vaultWithdraw', itemKind: 'resource', itemId: 'scrapMetal', qty: 1 }, { Corp: { mine: null } }],
]) {
  const { log, Profile } = await run(action, { rpc: { corp_vault_withdraw: { data: 999 } } }, seed);
  ok(label + ' → no RPC, no credit',
     rpcCalls(log, 'corp_vault_withdraw').length === 0
     && Object.keys(Profile.salvage).length === 0 && Object.keys(Profile.itemInventory).length === 0);
}

// ── 6. DEPOSIT now goes through the RPC, and degrades to the old upsert ─────
console.log('\n6. deposit');
{
  const { Corp, Profile, log } = await run(
    { kind: 'vaultDeposit', itemKind: 'resource', itemId: 'scrapMetal', qty: 30 },
    { rpc: { corp_vault_deposit: { data: 30 } } },
    { Profile: { salvage: { scrapMetal: 100 } } });
  const c = rpcCalls(log, 'corp_vault_deposit');
  ok('🔴 it calls corp_vault_deposit — the path that also writes corp_vault_log', c.length === 1);
  ok('…with the real name and icon on it', c.length === 1 && c[0].args.p_name === 'Res scrapMetal' && c[0].args.p_icon === '⚙',
     JSON.stringify(c[0] && c[0].args));
  ok('🔴 and does NOT also run the old direct upsert', !log.some((e) => e.op === 'upsert'));
  ok('the goods left the player exactly once (100 → 70)', Profile.salvage.scrapMetal === 70, String(Profile.salvage.scrapMetal));
  ok('the RPC being present is remembered', Corp.vaultRpc === 'ok', Corp.vaultRpc);
}
{
  const { Corp, Profile, log } = await run(
    { kind: 'vaultDeposit', itemKind: 'resource', itemId: 'scrapMetal', qty: 30 },
    { rpc: { corp_vault_deposit: { error: { code: 'PGRST202', message: 'Could not find the function in the schema cache' } } },
      row: { data: { qty: 5 } }, upsert: {} },
    { Profile: { salvage: { scrapMetal: 100 } } });
  const ups = log.filter((e) => e.op === 'upsert');
  ok('🔴 with sql/045 unapplied the deposit still lands, via the old direct upsert', ups.length === 1);
  ok('…accumulating onto the existing row rather than replacing it (5 + 30)',
     ups.length === 1 && ups[0].obj.qty === 35, JSON.stringify(ups[0] && ups[0].obj.qty));
  ok('…and the goods still left the player exactly once', Profile.salvage.scrapMetal === 70, String(Profile.salvage.scrapMetal));
  ok('…and the missing migration is remembered', Corp.vaultRpc === 'missing', Corp.vaultRpc);
}
{
  const { Profile, toasts, log } = await run(
    { kind: 'vaultDeposit', itemKind: 'resource', itemId: 'scrapMetal', qty: 30 },
    { rpc: { corp_vault_deposit: { error: { code: '42501', message: 'new row violates row-level security policy' } } } },
    { Profile: { salvage: { scrapMetal: 100 } } });
  ok('🔴 a REAL deposit failure refunds — the goods are not eaten', Profile.salvage.scrapMetal === 100,
     String(Profile.salvage.scrapMetal));
  ok('…and says so', toasts.some((t) => /returned to your collection/.test(t)), JSON.stringify(toasts));
  ok('…and does not fall back to the direct upsert on an RLS refusal', !log.some((e) => e.op === 'upsert'));
}

// ── 7. _jbRpcMissing classification ─────────────────────────────────────────
console.log('\n7. what counts as "the migration is not applied"');
{
  const api = build()(...PARAMS.map(() => ({})));
  const m = api.missing;
  ok('PGRST202 (function not in schema cache) → yes', m({ code: 'PGRST202', message: 'x' }) === true);
  ok('PGRST205 (table not in schema cache) → yes', m({ code: 'PGRST205', message: 'x' }) === true);
  ok('42883 / 42P01 (raw postgres) → yes', m({ code: '42883' }) === true && m({ code: '42P01' }) === true);
  ok('a message naming the schema cache → yes', m({ message: 'Could not find the function public.corp_vault_withdraw in the schema cache' }) === true);
  ok('🔴 an RLS refusal → NO (it must not be reported as an unapplied migration)',
     m({ code: '42501', message: 'new row violates row-level security policy for table "corp_vault"' }) === false);
  ok('🔴 the function\'s own overdraw refusal → NO',
     m({ code: 'P0001', message: 'the vault holds only 12 of Scrap Metal' }) === false);
  ok('null / undefined → no', m(null) === false && m(undefined) === false);
}

// ── 8. _jbCardArtUrl resolution order ───────────────────────────────────────
console.log('\n8. card art resolves the way the game resolves it');
{
  const mk = (over) => {
    const p = PARAMS.map((n) => (over[n] !== undefined ? over[n] : {}));
    return build()(...p).art;
  };
  const CLOUD = 'https://cdn.example/art/ashen.png';
  ok('a cloud URL in Forge.cardArtUrl wins',
     mk({ Forge: { cardArtUrl: { 'card:a': CLOUD }, cardArt: { 'card:a': 'data:image/png;base64,AAAA' } },
          _resolveAnyCardById: () => ({ artUrl: 'https://other/x.png' }) })('card:a') === CLOUD);
  ok("…then the card's own artUrl",
     mk({ Forge: {}, _resolveAnyCardById: () => ({ artUrl: 'https://other/x.png' }) })('card:a') === 'https://other/x.png');
  ok('🔴 a local full-res base64 original is NOT shipped (it would bloat every bridge push)',
     mk({ Forge: { cardArt: { 'card:a': 'data:image/png;base64,' + 'A'.repeat(400) } },
          _resolveAnyCardById: () => null,
          _frameUrl: (v) => v,
          getThumb: () => null })('card:a') === '');
  ok('…but a blob: handle is cheap and does pass through',
     mk({ Forge: { cardArt: { 'card:a': 'blob:http://x/1' } }, _resolveAnyCardById: () => null,
          _frameUrl: (v) => v, getThumb: () => null })('card:a') === 'blob:http://x/1');
  ok('…and a 128px thumbnail is the last resort, not a generic glyph',
     mk({ Forge: {}, _resolveAnyCardById: () => null, getThumb: () => 'data:image/webp;base64,TH' })('card:a')
     === 'data:image/webp;base64,TH');
  ok('nothing resolvable → empty string, so the screen falls back to the stored icon',
     mk({ Forge: {}, _resolveAnyCardById: () => null, getThumb: () => null })('card:a') === '');
  ok('no id → empty string', mk({})('') === '');
}

console.log('\n' + (fails ? '❌ ' + fails + ' FAILED' : '✅ ALL PASS'));
process.exit(fails ? 1 : 0);
