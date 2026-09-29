/* ============================================================================
   src/azahistory/index.js — AZA HISTORY + "AZA ARRIVED" NOTICES   (bug-mu2s9wa7)

   The report, from a player holding 94 AZA:
     "I seem to have 94 AZA in my wallet, however, I didn't buy all of them and
      I can't spend them in the game. I am not sure where these AZA came from."
   Every one of those 94 was accounted for in the database — their own four
   150-packs, 35 from gift claims (two of them REFERRAL gifts), 4 from covert
   missions, minus warehouse, Secret Stash and trader-membership spends — but
   none of it was visible to them anywhere. The owner's call: "add it and give
   notification on where it comes from." So this file does two things:

     1. open()  — a history of the player's own AZA, newest first, each row
                  labelled in plain words, a summary line on top and a line
                  saying where AZA can actually be spent (the "I can't spend
                  them" half of the report).
     2. tick()  — watches the balance and, when it goes UP, says so: a toast
                  plus an entry in the phone's Notifications, naming the
                  source when the game knows it and saying "see AZA history"
                  when it does not. It never speaks when the balance goes down:
                  the player's own spends already have their own feedback.

   ── WHERE THE ROWS COME FROM (all read on the player's own JWT) ───────────
   wallet_ledger WHERE resource = 'sovereigns' is the primary source: every
   server path that moves AZA (_sov_apply, _wh_charge, sov_refund,
   ws_grant_blueprint) writes a row there with a reason. It only begins on
   2026-08-10 19:33 UTC, so three side tables fill the gap before that and add
   what the ledger reason does not say:
     aza_purchases   — pack receipts; matched to ledger rows by session id.
     aza_reward_log  — reward rolls; matched by kind + amount + time.
     gifts (__aza__) — the ledger only says "Aza gift claim"; gifts.from_label
                       says whether it was a Referral, an Admin grant or a Shop
                       gift. Matched by amount + claimed_at, which is the same
                       now() as the ledger row (same transaction).
   RLS (checked live, read-only, 2026-09-17): every one of these has a SELECT
   policy of user_id / to_user = auth.uid(), and authenticated has no INSERT on
   wallet_ledger / aza_purchases / aza_reward_log. So no new RPC was needed; the
   .eq(user filter) calls below are self-documentation, NOT the boundary.
   The ledger read falls back to get_my_ledger() (SECURITY DEFINER, own rows) if
   the direct select is refused.

   ── THE GLOBALS TRAP ──────────────────────────────────────────────────────
   `Profile`, `Cloud` are top-level const in index.html — not on window. The
   page hands this module window.MythicAzaHost; nothing below reaches past it.
   Every host call is guarded: offline or before tables exist, the view says
   so and still lists the AZA sinks, and tick() does nothing.

   ── PURE PARTS ────────────────────────────────────────────────────────────
   classify / buildHistory / summaryLine / arrivalLines take plain data and are
   exported so _azahistory_smoke.mjs runs them in Node without a browser.
   ========================================================================== */

const W = (typeof window !== 'undefined') ? window : null;
const host = () => (W && W.MythicAzaHost) || null;
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* The earliest wallet_ledger row for resource 'sovereigns', measured live. Only
   used in the footnote; the reconciliation below uses the player's OWN first row. */
export const LEDGER_START_TEXT = 'Aug 10, 2026';

/* aza_reward_rules.kind → words. The names come from the rules' own notes
   (read live), not from guesses: cv_resource is the Covert "Resource Run",
   cv_recruit the "Recruitment Drive". An unknown kind is prettified, never
   dropped — a new rule must still show up as a reward. */
export const REWARD_LABELS = {
  cv_resource: 'Covert mission: Resource Run',
  cv_recruit: 'Covert mission: Recruitment Drive',
  chest_t1: 'Scavenger Chest',
  chest_t2: 'Warden Chest',
  chest_t3: 'Mythic Chest',
  chest_t4: 'Abraxas Chest',
  dark_event_sabotage: 'Dark Event sabotaged',
  tw_chosen_trophy: 'Territory Wars: Chosen trophy',
  auction_npc_sale: 'Auction sold to an NPC buyer',
  /* sql/159: season_pass, tw_loot, oilsim_contract and oilsim_emergency are
     NOT AZA rewards any more — the owner chose "give cinder instead max
     15,000" (2026-09-18). They credit Cinder (resource 'cinder'), which this
     view never reads, and the client never notes them as an AZA source, so
     their names were removed from here on purpose: an AZA history that could
     say "Reward — Season Pass tier" would be describing money that is not
     AZA. Coupons still are ("Aza reward: coupon …", above in classify). */
};
export function rewardLabel(kind) {
  const k = String(kind || '');
  if (REWARD_LABELS[k]) return REWARD_LABELS[k];
  const p = k.replace(/_/g, ' ').trim();
  return p ? p.charAt(0).toUpperCase() + p.slice(1) : 'Reward';
}

/* Where AZA can be spent — taken from the live charge reasons in wallet_ledger
   and the spendSovereigns / server-charge call sites in the code, not from a
   design doc. The report's "I can't spend them" was a discoverability gap. */
export const SINKS = [
  'Warehouse upgrades, lifters & storage space',
  'Secret Stash',
  'Trader memberships (Vendor Market)',
  'Weapon Smith blueprints',
  'AZA packs & Structure Decks',
  'Base Vault expansion',
  'Player Closet',
  'AZA-priced market listings & auctions',
  'Founding an operation (Just Business)',
  'Community memberships & bounties',
  'Exchange for Cinder (Bank of Ethos)',
];

/* ── one ledger row → { kind, label } ─────────────────────────────────────
   kind ∈ buy | gift | reward | spend | refund | bank | other.
   `gift` is the matched gifts row (or null) for an "Aza gift claim". */
export function classify(reason, delta, gift) {
  const r = String(reason || '').trim();
  const up = Number(delta) > 0;
  let m;
  if (/^Aza pack purchase/i.test(r)) return { kind: 'buy', label: 'Purchase — ' + Math.abs(Number(delta) || 0) + ' AZA pack' };
  if (/^Aza gift claim/i.test(r)) return giftLabel(gift);
  if ((m = r.match(/^Aza reward:\s*coupon\s+(.+)$/i))) return { kind: 'reward', label: 'Coupon code — ' + m[1] };
  if ((m = r.match(/^Aza reward:\s*(.+)$/i))) return { kind: 'reward', label: 'Reward — ' + rewardLabel(m[1]) };
  /* sql/159: Luni and broker AZA are server transfers now, with a reason on
     each side. Before these rules they fell through to the raw reason. */
  if ((m = r.match(/^Resource exchange sale\s*#?(\d+)/i))) return { kind: 'other', label: 'Luni sale #' + m[1] };
  if ((m = r.match(/^Resource exchange purchase\s*#?(\d+)/i))) return { kind: 'spend', label: 'Luni purchase #' + m[1] };
  if (/^Broker deal escrow returned/i.test(r)) return { kind: 'refund', label: 'Broker deal — escrow returned' };
  if (/^Broker deal (sale|received)/i.test(r)) return { kind: 'other', label: 'Broker deal — AZA received' };
  if (/^Broker deal (purchase|escrow)/i.test(r)) return { kind: 'spend', label: up ? 'Broker deal' : 'Broker deal — AZA paid' };
  if (/^Aza refund of/i.test(r)) return { kind: 'refund', label: 'Refund — a purchase that did not go through' };
  if (/^Exchange rollback/i.test(r)) return { kind: 'refund', label: 'Refund — Cinder exchange rolled back' };
  if (/^Bank of Ethos deposit/i.test(r)) return { kind: 'bank', label: 'Moved to your Bank of Ethos account' };
  if (/^Bank of Ethos withdrawal/i.test(r)) return { kind: 'bank', label: 'Moved from your Bank of Ethos account' };
  if (/^Aza\s*->\s*Cinder exchange/i.test(r)) return { kind: 'spend', label: 'Exchanged for Cinder' };
  if ((m = r.match(/^Warehouse:\s*upgrade to\s+(.+)$/i))) return { kind: 'spend', label: 'Warehouse upgrade — ' + m[1] };
  if (/^Warehouse:\s*open storage unit space/i.test(r)) return { kind: 'spend', label: 'Warehouse storage space' };
  if ((m = r.match(/^Warehouse:\s*(.+)$/i))) return { kind: up ? 'refund' : 'spend', label: 'Warehouse — ' + m[1] };
  if ((m = r.match(/^Secret Stash\s*[—-]\s*(.+)$/i))) return { kind: 'spend', label: 'Secret Stash — ' + m[1] };
  if ((m = r.match(/^trader membership:\s*(.+)$/i))) return { kind: 'spend', label: 'Trader membership — ' + m[1] };
  if ((m = r.match(/^Weapon Smith blueprint:\s*(.+)$/i))) return { kind: 'spend', label: 'Weapon Smith blueprint — ' + m[1] };
  if ((m = r.match(/^bounty won:\s*(.+)$/i))) return { kind: 'reward', label: 'Community bounty won — ' + m[1] };
  if ((m = r.match(/^bounty:\s*(.+)$/i))) return { kind: up ? 'refund' : 'spend', label: 'Community bounty — ' + m[1] };
  if ((m = r.match(/^community sale:\s*(.+)$/i))) return { kind: 'reward', label: 'Community membership sold — ' + m[1] };
  if ((m = r.match(/^affiliate:\s*(.+)$/i))) return { kind: 'reward', label: 'Community affiliate share — ' + m[1] };
  if ((m = r.match(/^community:\s*(.+)$/i))) return { kind: up ? 'refund' : 'spend', label: 'Community membership — ' + m[1] };
  if (/referr/i.test(r)) return { kind: 'reward', label: 'Referral reward' };
  if (/admin|grant|compensat/i.test(r)) return { kind: 'gift', label: 'Admin grant' + (/^admin grant$/i.test(r) ? '' : ' — ' + r) };
  /* sov_charge's default reason. Two call sites still charged without naming
     the item when this shipped; the row is real, only its label was lost. */
  if (/^aza spend$/i.test(r) || !r) return up ? { kind: 'other', label: 'Received' } : { kind: 'spend', label: 'Spent (item not recorded)' };
  return up ? { kind: 'other', label: r } : { kind: 'spend', label: r };
}
function giftLabel(g) {
  const from = String((g && g.from_label) || '').trim();
  if (/^referral$/i.test(from)) return { kind: 'reward', label: 'Referral reward (gift claim)' };
  if (/^admin$/i.test(from)) return { kind: 'gift', label: 'Admin grant (gift claim)' };
  if (from) return { kind: 'gift', label: 'Gift claim — from ' + from };
  return { kind: 'gift', label: 'Gift claim' };
}

const ms = (t) => { const v = Date.parse(t); return isFinite(v) ? v : 0; };
const near = (a, b, win) => Math.abs(a - b) <= win;

/* ── merge the four sources into one list, newest first ────────────────────
   input: { ledger, purchases, rewards, gifts, ledgerComplete }
     ledger    [{ id, delta, balance_after, reason, created_at }]
     purchases [{ session_id, aza, created_at }]
     rewards   [{ kind, aza, ts }]
     gifts     [{ qty, from_label, claimed_at }]   (card_id '__aza__', claimed)
   ledgerComplete: false when the ledger read hit its row limit, so older rows
   exist that we did not fetch.
   output: { rows:[{ at, delta, kind, label, bal, src }], totals, opening } */
export function buildHistory(input) {
  const I = input || {};
  const ledger = (I.ledger || []).filter((x) => x && Number(x.delta)).slice()
    .sort((a, b) => ms(a.created_at) - ms(b.created_at));
  const purchases = (I.purchases || []).filter((x) => x && Number(x.aza) > 0);
  const rewards = (I.rewards || []).filter((x) => x && Number(x.aza) > 0);
  const gifts = (I.gifts || []).filter((x) => x && Number(x.qty) > 0 && x.claimed_at);
  const complete = I.ledgerComplete !== false;

  const usedP = new Set(), usedR = new Set(), usedG = new Set();
  const rows = [];
  for (const l of ledger) {
    const at = ms(l.created_at), d = Math.round(Number(l.delta)), reason = String(l.reason || '');
    let gift = null;
    if (/^Aza pack purchase/i.test(reason)) {
      purchases.forEach((p, i) => { if (!usedP.has(i) && p.session_id && reason.indexOf(String(p.session_id)) >= 0) usedP.add(i); });
    } else if (/^Aza reward:/i.test(reason)) {
      const k = reason.replace(/^Aza reward:\s*/i, '');
      const i = rewards.findIndex((x, j) => !usedR.has(j) && x.kind === k && Math.round(Number(x.aza)) === d && near(ms(x.ts), at, 5000));
      if (i >= 0) usedR.add(i);
    } else if (/^Aza gift claim/i.test(reason)) {
      const i = gifts.findIndex((x, j) => !usedG.has(j) && Math.round(Number(x.qty)) === d && near(ms(x.claimed_at), at, 5000));
      if (i >= 0) { usedG.add(i); gift = gifts[i]; }
    }
    const c = classify(reason, d, gift);
    rows.push({ at, delta: d, kind: c.kind, label: c.label, bal: (l.balance_after == null ? null : Number(l.balance_after)), src: 'ledger' });
  }

  /* Receipts the ledger does not carry. With a complete ledger these are the
     rows from before it existed; with a truncated one, only rows NEWER than the
     oldest fetched ledger row are trusted (older ones may be in the part we
     did not fetch, and would be counted twice). */
  const first = ledger[0] || null;
  const horizon = first ? ms(first.created_at) : Infinity;
  const extra = [];
  const keep = (at) => complete || at >= horizon;
  purchases.forEach((p, i) => { const at = ms(p.created_at); if (!usedP.has(i) && keep(at)) extra.push({ at, delta: Math.round(Number(p.aza)), kind: 'buy', label: 'Purchase — ' + Math.round(Number(p.aza)) + ' AZA pack', bal: null, src: 'receipt' }); });
  rewards.forEach((x, i) => { const at = ms(x.ts); if (!usedR.has(i) && keep(at)) extra.push({ at, delta: Math.round(Number(x.aza)), kind: 'reward', label: 'Reward — ' + rewardLabel(x.kind), bal: null, src: 'receipt' }); });
  gifts.forEach((x, i) => { const at = ms(x.claimed_at); if (!usedG.has(i) && keep(at)) { const c = giftLabel(x); extra.push({ at, delta: Math.round(Number(x.qty)), kind: c.kind, label: c.label, bal: null, src: 'receipt' }); } });

  /* Reconcile the part before the ledger began, so the summary adds up to the
     balance instead of leaving a player to wonder where the rest went. The
     opening balance is the player's own first ledger row minus its delta. */
  let opening = null;
  if (first) {
    opening = Math.round(Number(first.balance_after) - Number(first.delta));
    if (!isFinite(opening)) opening = null;
  }
  const synth = [];
  if (opening != null && first) {
    const preCredits = extra.filter((x) => x.at < horizon).reduce((s, x) => s + x.delta, 0);
    const gap = complete ? (preCredits - opening) : -opening;
    const at0 = horizon - 1;
    if (gap > 0) synth.push({ at: at0, delta: -gap, kind: 'spend', label: 'Spent before itemised history began (not itemised)', bal: opening, src: 'derived' });
    else if (gap < 0) synth.push({ at: at0, delta: -gap, kind: 'other', label: 'Balance carried over from before itemised history', bal: opening, src: 'derived' });
  }

  const all = rows.concat(extra, synth).sort((a, b) => b.at - a.at || (a.src === 'derived' ? 1 : 0) - (b.src === 'derived' ? 1 : 0));
  return { rows: all, totals: totalsOf(all), opening };
}

export function totalsOf(rows) {
  const t = { bought: 0, gifts: 0, rewards: 0, spent: 0, bank: 0, other: 0, net: 0 };
  for (const r of rows || []) {
    const d = Number(r.delta) || 0;
    t.net += d;
    if (r.kind === 'buy') t.bought += d;
    else if (r.kind === 'gift') t.gifts += d;
    else if (r.kind === 'reward') t.rewards += d;
    else if (r.kind === 'spend' || r.kind === 'refund') t.spent -= d;   // a refund un-spends
    else if (r.kind === 'bank') t.bank += d;
    else t.other += d;
  }
  return t;
}

const n = (v) => Math.round(Number(v) || 0).toLocaleString('en-US');
export function summaryLine(t) {
  const x = t || {};
  let s = 'Bought ' + n(x.bought) + ' · Gifts ' + n(x.gifts) + ' · Rewards ' + n(x.rewards) + ' · Spent ' + n(x.spent);
  if (x.bank) s += ' · Bank ' + (x.bank > 0 ? '+' : '−') + n(Math.abs(x.bank));
  if (x.other) s += ' · Other ' + (x.other > 0 ? '+' : '−') + n(Math.abs(x.other));
  return s;
}

/* ── what the arrival notice says ─────────────────────────────────────────
   sources: [{ label, amount, quiet }] noted by the page's credit paths within
   the last few seconds. quiet sources (a refund of the player's own failed
   spend, a withdrawal from their own bank) move the balance up without being
   news. Returns [] when nothing should be said. */
export function arrivalLines(delta, sources) {
  const d = Math.round(Number(delta) || 0);
  if (d <= 0) return [];
  const src = (sources || []).filter((s) => s && s.label);
  if (src.length && src.every((s) => s.quiet)) return [];
  const named = src.filter((s) => !s.quiet);
  if (!named.length) return ['🪙 +' + n(d) + ' AZA arrived — see AZA history'];
  const out = [];
  let left = d;
  for (const s of named) {
    const a = Math.round(Number(s.amount) || 0) > 0 ? Math.min(Math.round(Number(s.amount)), left) : (named.length === 1 ? left : 0);
    if (a <= 0) continue;
    out.push('🪙 +' + n(a) + ' AZA — ' + s.label);
    left -= a;
  }
  const quietSum = src.filter((s) => s.quiet).reduce((q, s) => q + (Math.round(Number(s.amount)) || 0), 0);
  if (left - quietSum > 0) out.push('🪙 +' + n(left - quietSum) + ' AZA arrived — see AZA history');
  if (!out.length) out.push('🪙 +' + n(d) + ' AZA arrived — see AZA history');
  return out;
}

/* ═══════════════════════ browser half (guarded) ═══════════════════════ */

const LEDGER_LIMIT = 500;

async function safe(p) {
  try { const r = await p; return (r && !r.error) ? { ok: true, data: r.data || [] } : { ok: false, data: [], error: r && r.error }; }
  catch (e) { return { ok: false, data: [], error: e }; }
}

/* Reads the player's own rows. Every failure degrades to an empty list; the
   caller shows what it has. */
export async function fetchRaw() {
  const h = host();
  const c = h && typeof h.client === 'function' ? h.client() : null;
  const uid = h && typeof h.uid === 'function' ? h.uid() : null;
  if (!c || !uid) return { offline: true };
  let led = await safe(c.from('wallet_ledger').select('id,delta,balance_after,reason,created_at')
    .eq('user_id', uid).eq('resource', 'sovereigns').order('created_at', { ascending: false }).limit(LEDGER_LIMIT));
  let ledgerComplete = led.ok && led.data.length < LEDGER_LIMIT;
  if (!led.ok) {
    /* get_my_ledger returns every resource, so the AZA rows are a subset of
       its 500 — never treat that read as complete. */
    const g = await safe(c.rpc('get_my_ledger', { p_limit: LEDGER_LIMIT }));
    led = { ok: g.ok, data: (g.data || []).filter((x) => x && x.resource === 'sovereigns') };
    ledgerComplete = false;
  }
  const [pur, rew, gif] = await Promise.all([
    safe(c.from('aza_purchases').select('session_id,aza,created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(500)),
    safe(c.from('aza_reward_log').select('kind,aza,ts').eq('user_id', uid).order('ts', { ascending: false }).limit(500)),
    safe(c.from('gifts').select('qty,from_label,status,claimed_at').eq('to_user', uid).eq('card_id', '__aza__').eq('status', 'claimed').limit(500)),
  ]);
  return {
    offline: false,
    ledger: led.data, purchases: pur.data, rewards: rew.data, gifts: gif.data,
    ledgerComplete, anyOk: led.ok || pur.ok || rew.ok || gif.ok, ledgerOk: led.ok,
  };
}

/* ── AZA rows for the two WALLET ledgers (phone 📒 Ledger, Bank of Ethos) ──
   Asked for: "Add AZA coin to the phone ledger and bank ledger, show when AZA
   coin is added or spent." Both ledgers are classic scripts / a Babel iframe
   and cannot import, so they reach this through window.MythicAzaHistory — the
   labels are classify()'s, one mapping for three views, never a copy.
   Why a direct select and not get_my_ledger(): that RPC returns EVERY
   resource newest-first, and cinder is ~1,016,000 of its ~1,017,000 rows
   (measured 2026-09-18) — a player's 200 newest rows are almost all Cinder
   and the AZA ones fall off the end. RLS (wl_sel: user_id = auth.uid(), read
   live) makes the own-row select safe; the RPC is only the fallback, and a
   subset of it is marked incomplete.
   The gift row here is not matched against `gifts`, so a referral gift reads
   "Gift claim"; the full AZA history view names who it came from. */
export const WALLET_LIMIT = 200;
export function walletRows(ledger) {
  return (ledger || [])
    .filter((x) => x && Number(x.delta) && (x.resource == null || x.resource === 'sovereigns'))
    .map((x) => {
      const d = Math.round(Number(x.delta));
      const c = classify(x.reason, d, null);
      return { t: ms(x.created_at), d, b: (x.balance_after == null ? null : Math.round(Number(x.balance_after))), r: c.label, kind: c.kind, cur: 'aza' };
    })
    .sort((a, b) => b.t - a.t);
}
/* received / spent over AZA rows only — the callers keep these apart from the
   Cinder sums on purpose (one AZA is not one Cinder). */
export function walletTotals(rows) {
  let inSum = 0, outSum = 0;
  for (const e of rows || []) { if (!e || e.cur !== 'aza') continue; const d = Number(e.d) || 0; if (d > 0) inSum += d; else outSum -= d; }
  return { in: inSum, out: outSum };
}
const _wallet = { uid: null, rows: [], complete: true };
export async function walletLedger() {
  const h = host();
  const c = h && typeof h.client === 'function' ? h.client() : null;
  const uid = h && typeof h.uid === 'function' ? h.uid() : null;
  if (!c || !uid) return { ok: false, reason: 'signin', rows: [] };
  let led = await safe(c.from('wallet_ledger').select('id,delta,balance_after,reason,created_at,resource')
    .eq('user_id', uid).eq('resource', 'sovereigns').order('created_at', { ascending: false }).limit(WALLET_LIMIT));
  let complete = led.ok && led.data.length < WALLET_LIMIT;
  if (!led.ok) {
    const g = await safe(c.rpc('get_my_ledger', { p_limit: 500 }));
    if (!g.ok) {
      const msg = String((g.error && g.error.message) || '');
      return { ok: false, reason: /does not exist|42883|42P01|PGRST202|schema cache/i.test(msg) ? 'missing' : 'failed', rows: [] };
    }
    led = { ok: true, data: (g.data || []).filter((x) => x && x.resource === 'sovereigns') };
    complete = false;
  }
  const rows = walletRows(led.data);
  _wallet.uid = uid; _wallet.rows = rows; _wallet.complete = complete;
  return { ok: true, rows, complete };
}
/* The last walletLedger() result, for synchronous callers (the bank seed).
   Keyed by account: after a switch it is empty until the next read. */
export function cachedWalletRows() {
  const h = host();
  const uid = h && typeof h.uid === 'function' ? h.uid() : null;
  return (uid && _wallet.uid === uid) ? _wallet.rows.slice() : [];
}

const CSS = `
#aza-hist-back{position:fixed;inset:0;z-index:100050;background:rgba(6,4,3,.72);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
#aza-hist{width:min(600px,100%);max-height:min(86vh,760px);display:flex;flex-direction:column;background:linear-gradient(180deg,#1b1511,#120e0b);border:1px solid #5a4526;border-radius:10px;box-shadow:0 18px 60px rgba(0,0,0,.6);color:#e9dcc0;font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;overflow:hidden}
#aza-hist .ah-head{display:flex;align-items:center;gap:.6rem;padding:.8rem 1rem;border-bottom:1px solid #3a2d1c}
#aza-hist .ah-title{font-weight:700;letter-spacing:.06em;color:#f2d98a;flex:1}
#aza-hist .ah-bal{color:#f2e3b8;font-variant-numeric:tabular-nums}
#aza-hist .ah-x{background:none;border:1px solid #5a4526;color:#e9dcc0;border-radius:6px;width:2rem;height:2rem;cursor:pointer;font-size:1rem}
#aza-hist .ah-x:focus-visible{outline:2px solid #f6dc95;outline-offset:2px}
#aza-hist .ah-sum{padding:.7rem 1rem;background:rgba(242,217,138,.06);border-bottom:1px solid #3a2d1c;font-weight:600;color:#f2d98a;font-variant-numeric:tabular-nums}
#aza-hist .ah-where{padding:.55rem 1rem;border-bottom:1px solid #3a2d1c;font-size:.84rem;color:#bfae87}
#aza-hist .ah-where b{color:#e9dcc0}
#aza-hist .ah-list{overflow:auto;flex:1;padding:.2rem 0}
#aza-hist .ah-row{display:grid;grid-template-columns:7.4rem 1fr auto;gap:.2rem .7rem;padding:.5rem 1rem;border-bottom:1px solid rgba(90,69,38,.35);align-items:baseline}
#aza-hist .ah-when{color:#8f8166;font-size:.78rem;font-variant-numeric:tabular-nums}
#aza-hist .ah-lbl{min-width:0;overflow-wrap:anywhere}
#aza-hist .ah-amt{font-weight:700;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
#aza-hist .ah-amt.up{color:#8fd694}
#aza-hist .ah-amt.dn{color:#e6907a}
#aza-hist .ah-amt.mv{color:#bfae87}
#aza-hist .ah-meta{grid-column:2/4;color:#8f8166;font-size:.76rem}
#aza-hist .ah-note{padding:.9rem 1rem;color:#bfae87}
#aza-hist .ah-foot{padding:.55rem 1rem;border-top:1px solid #3a2d1c;color:#8f8166;font-size:.76rem}
.profile-aza-hist{margin-top:.35rem;background:rgba(242,217,138,.08);border:1px solid #5a4526;color:#f2d98a;border-radius:999px;padding:.2rem .65rem;font:600 .72rem/1.3 system-ui,sans-serif;letter-spacing:.04em;cursor:pointer}
.profile-aza-hist:hover{background:rgba(242,217,138,.16)}
.profile-aza-hist:focus-visible,[data-aza-history]:focus-visible{outline:2px solid #f6dc95;outline-offset:2px}
@media (max-width:480px){#aza-hist .ah-row{grid-template-columns:1fr auto}#aza-hist .ah-when{grid-column:1/3}#aza-hist .ah-meta{grid-column:1/3}}
`;
function ensureCss() {
  if (!W || !W.document || W.document.getElementById('aza-hist-css')) return;
  const s = W.document.createElement('style');
  s.id = 'aza-hist-css'; s.textContent = CSS;
  W.document.head.appendChild(s);
}

const fmtWhen = (t) => {
  try { return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
  catch (e) { return ''; }
};

export function renderHtml(model) {
  const M = model || {};
  const bal = Number(M.balance) || 0;
  const sinks = '<div class="ah-where"><b>Where can I spend AZA?</b> ' + SINKS.map(esc).join(' · ') + '</div>';
  let body;
  if (M.state === 'loading') body = '<div class="ah-note">Loading your AZA history…</div>';
  else if (M.state === 'offline') body = '<div class="ah-note">Sign in to see where your AZA came from and went — the history is kept on your account, not this device.</div>';
  else if (M.state === 'error') body = '<div class="ah-note">Your AZA history could not be loaded right now. Your balance is safe; try again in a moment.</div>';
  else if (!M.rows || !M.rows.length) body = '<div class="ah-note">No AZA movements on this account yet.</div>';
  else {
    body = M.rows.map((r) => {
      const cls = r.kind === 'bank' ? 'mv' : (r.delta > 0 ? 'up' : 'dn');
      const sign = r.delta > 0 ? '+' : '−';
      const meta = [];
      if (r.bal != null && r.src === 'ledger') meta.push('balance after: ' + n(r.bal));
      if (r.src === 'receipt') meta.push('from your receipts');
      if (r.src === 'derived') meta.push('worked out from your balance, not a single transaction');
      return '<div class="ah-row" data-kind="' + esc(r.kind) + '">'
        + '<div class="ah-when">' + esc(fmtWhen(r.at)) + '</div>'
        + '<div class="ah-lbl">' + esc(r.label) + '</div>'
        + '<div class="ah-amt ' + cls + '">' + sign + n(Math.abs(r.delta)) + '</div>'
        + (meta.length ? '<div class="ah-meta">' + esc(meta.join(' · ')) + '</div>' : '')
        + '</div>';
    }).join('');
  }
  const sum = (M.state === 'ready' && M.totals) ? '<div class="ah-sum" id="aza-hist-sum">' + esc(summaryLine(M.totals)) + '</div>' : '';
  const foot = (M.state === 'ready')
    ? '<div class="ah-foot">Itemised from ' + esc(LEDGER_START_TEXT) + '; earlier purchases, rewards and gifts come from your receipts.'
      + (M.mismatch ? ' Your balance is still syncing — reopen in a moment if the totals look off.' : '') + '</div>'
    : '';
  return '<div id="aza-hist" role="dialog" aria-modal="true" aria-label="AZA history">'
    + '<div class="ah-head"><span class="ah-title">🪙 AZA HISTORY</span><span class="ah-bal">' + n(bal) + ' AZA</span>'
    + '<button type="button" class="ah-x" id="aza-hist-close" aria-label="Close">✕</button></div>'
    + sum + sinks + '<div class="ah-list" id="aza-hist-list">' + body + '</div>' + foot + '</div>';
}

let _openSeq = 0;
export async function open() {
  if (!W || !W.document) return false;
  const h = host();
  ensureCss();
  close();
  const back = W.document.createElement('div');
  back.id = 'aza-hist-back';
  const balance = () => { try { return h && h.aza ? h.aza() : 0; } catch (e) { return 0; } };
  const paint = (m) => { back.innerHTML = renderHtml(Object.assign({ balance: balance() }, m)); const x = back.querySelector('#aza-hist-close'); if (x) x.onclick = close; };
  paint({ state: 'loading' });
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  W.document.body.appendChild(back);
  W.document.addEventListener('keydown', onKey, true);
  const seq = ++_openSeq;
  let raw;
  try { raw = await fetchRaw(); } catch (e) { raw = { offline: false, anyOk: false }; }
  if (seq !== _openSeq || !back.isConnected) return true;
  if (raw.offline) { paint({ state: 'offline' }); return true; }
  if (!raw.anyOk) { paint({ state: 'error' }); return true; }
  const hist = buildHistory(raw);
  /* The summary nets to the balance by construction when the ledger is whole;
     if it does not match what the wallet shows, the wallet is mid-sync. */
  const mismatch = raw.ledgerOk && raw.ledgerComplete && Math.round(hist.totals.net) !== Math.round(balance());
  paint({ state: 'ready', rows: hist.rows, totals: hist.totals, mismatch });
  return true;
}
function onKey(e) { if (e.key === 'Escape') close(); }
export function close() {
  try { const b = W && W.document && W.document.getElementById('aza-hist-back'); if (b) b.remove(); } catch (e) {}
  try { W && W.document && W.document.removeEventListener('keydown', onKey, true); } catch (e) {}
}

/* ── the arrival watcher ──────────────────────────────────────────────────
   Compares the balance to the last value this ACCOUNT was seen at. The
   baseline lives in localStorage (per user id) rather than in memory for
   three reasons: a cloud hydration at boot that raises AZA (a purchase that
   completed elsewhere, a reward on another device) is exactly the case the
   report is about and happens before any in-memory hook exists; two tabs
   share it, so only one of them announces; and an account switch reads a
   different key instead of comparing player A's balance with player B's.
   A first sight of an account only records the baseline — "+94 AZA arrived"
   on a fresh device would be a lie.
   An unnamed rise must survive two ticks before it is announced: the tab that
   actually credited it usually names it within the same second, and the
   other tab then finds the baseline already moved. */
const seenKey = (uid) => 'mythic_aza_seen:' + uid;
const _w = { pending: null, timer: null };
function readSeen(uid) { try { const v = W.localStorage.getItem(seenKey(uid)); return v == null ? null : Number(v); } catch (e) { return null; } }
function writeSeen(uid, v) { try { W.localStorage.setItem(seenKey(uid), String(Math.round(v))); } catch (e) {} }

export function tick() {
  try {
    const h = host();
    if (!h || !W) return null;
    const uid = h.uid && h.uid();
    if (!uid) return null;
    if (h.settling && h.settling()) return null;   // the server balance has not landed yet
    const cur = Math.round(Number(h.aza && h.aza()) || 0);
    const seen = readSeen(uid);
    if (seen == null || !isFinite(seen)) { writeSeen(uid, cur); _w.pending = null; return null; }
    if (cur <= seen) {
      /* Down (a spend) or unchanged: move the baseline and stay silent. */
      if (cur < seen) writeSeen(uid, cur);
      _w.pending = null;
      return null;
    }
    /* A reward is noted by its aza_reward_rules kind; the words live here. */
    const srcs = ((h.sources && h.sources()) || []).map((s) => (s && s.rewardKind) ? Object.assign({}, s, { label: rewardLabel(s.rewardKind) }) : s);
    if (!srcs.length && !(_w.pending && _w.pending.uid === uid && _w.pending.cur === cur)) {
      _w.pending = { uid, cur };
      return null;
    }
    writeSeen(uid, cur);
    _w.pending = null;
    try { h.clearSources && h.clearSources(); } catch (e) {}
    const lines = arrivalLines(cur - seen, srcs);
    if (!lines.length) return [];
    /* One toast (showToast replaces the previous one, so two calls would lose
       the first); one bell entry per source so each can be read on its own. */
    try { h.toast && h.toast(lines.join('  ·  '), 5200); } catch (e) {}
    for (const l of lines) { try { h.notify && h.notify(l); } catch (e) {} }
    return lines;
  } catch (e) { return null; }
}

function start() {
  if (!W || _w.timer) return;
  ensureCss();
  _w.timer = setInterval(tick, 2000);
  /* One delegated listener opens the view from any element carrying
     data-aza-history — the hub AZA pill, the profile's AZA figure, the
     market wallet — so a re-render never loses the binding. */
  try {
    W.document.addEventListener('click', (e) => {
      const t = e.target && e.target.closest && e.target.closest('[data-aza-history]');
      if (!t) return;
      e.preventDefault(); e.stopPropagation();
      open();
    }, true);
    W.document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const t = e.target && e.target.closest && e.target.closest('[data-aza-history]');
      if (!t || t.tagName === 'BUTTON') return;   // a real button already clicks on Enter
      e.preventDefault(); open();
    }, true);
  } catch (e) {}
}

if (W && W.document) {
  W.MythicAzaHistory = { open, close, tick, fetchRaw, buildHistory, summaryLine, arrivalLines, classify, SINKS,
    walletLedger, walletRows, walletTotals, cachedWalletRows };
  start();
}
