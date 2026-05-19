const { useState, useEffect, useMemo, useRef } = React;

/* ============================================================
   ICONS — minimal stroke set
   ============================================================ */
const Icon = ({ name, size = 16, className = "" }) => {
  const paths = {
    vault: <><rect x="3" y="5" width="18" height="14" rx="1" /><circle cx="12" cy="12" r="3.2" /><path d="M12 8.8v-1M12 16.2v-1M8.8 12h-1M16.2 12h-1" /></>,
    merc: <><path d="M12 12a4 4 0 100-8 4 4 0 000 8z" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" /></>,
    market: <><path d="M3 7h18l-1.5 9.5a2 2 0 01-2 1.7H6.5a2 2 0 01-2-1.7L3 7z" /><path d="M8 7V5a4 4 0 018 0v2" /></>,
    loan: <><rect x="3" y="6" width="18" height="12" rx="1" /><circle cx="12" cy="12" r="2.5" /><path d="M6 9.5h.01M18 14.5h.01" /></>,
    ledger: <><path d="M5 4h12a2 2 0 012 2v14l-3-2-3 2-3-2-3 2V6a2 2 0 012-2z" /><path d="M8 9h8M8 13h6" /></>,
    contract: <><path d="M7 3h7l4 4v14a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1z" /><path d="M14 3v4h4M9 13l2 2 4-4" /></>,
    chart: <><path d="M4 19V5M4 19h16" /><path d="M8 15l3-4 3 2 5-7" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3h.1a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8v.1a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z" /></>,
    bell: <><path d="M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9z" /><path d="M10 21a2 2 0 004 0" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>,
    arrow_in: <><path d="M12 5v14M5 12l7 7 7-7" /></>,
    arrow_out: <><path d="M12 19V5M5 12l7-7 7 7" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    play: <><path d="M6 4l14 8-14 8V4z" /></>,
    pause: <><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></>,
    eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></>,
    shield: <><path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z" /></>,
    bolt: <><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" /></>,
    sword: <><path d="M14.5 17.5L4 7V4h3l10.5 10.5M13 19l5-5M15 17l3 3M5 21l4-4" /></>,
    ore: <><path d="M3 14l4-7h10l4 7-9 7-9-7z" /><path d="M7 7l5 7 5-7M3 14h18" /></>,
    cube: <><path d="M3 7l9-4 9 4-9 4-9-4z" /><path d="M3 7v10l9 4V11M21 7v10l-9 4" /></>,
    relic: <><path d="M12 2l3 5 5 1-4 4 1 6-5-3-5 3 1-6-4-4 5-1 3-5z" /></>,
    card: <><rect x="3" y="6" width="18" height="13" rx="1" /><path d="M3 10h18M7 15h3" /></>,
    flame: <><path d="M12 2c1 4 5 5 5 10a5 5 0 11-10 0c0-3 2-4 2-7 2 1 3 4 3 4z" /></>,
    spark: <><path d="M12 2v6M12 16v6M2 12h6M16 12h6M5 5l4 4M15 15l4 4M5 19l4-4M15 9l4-4" /></>,
    menu: <><path d="M3 6h18M3 12h18M3 18h18" /></>,
    download: <><path d="M12 3v12M5 10l7 7 7-7M5 21h14" /></>,
    chevron: <><path d="M9 6l6 6-6 6" /></>,
    check: <><path d="M5 12l4 4 10-10" /></>,
    x: <><path d="M5 5l14 14M19 5L5 19" /></>,
  };
  return (
    <svg className={`ico ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {paths[name] || null}
    </svg>
  );
};

/* ============================================================
   CURRENCY GLYPHS — Aza coin, Cinder ember
   ============================================================ */
// Real game currency art (served at site root — same origin as the
// embedded /ethos/ app). Sized to match the old glyph call sites.
const CinderGlyph = ({ size = 22 }) => (
  <img src="/assets/artwork/gameicons/Cinder.png" alt="Cinder"
    width={size} height={size}
    style={{ width: size, height: size, objectFit: "contain", verticalAlign: "middle", display: "inline-block" }} />
);
const AzaGlyph = ({ size = 22 }) => (
  <img src="/assets/artwork/gameicons/Azacoin.png" alt="Aza Coin"
    width={size} height={size}
    style={{ width: size, height: size, objectFit: "contain", verticalAlign: "middle", display: "inline-block" }} />
);

/* ============================================================
   SPARKLINE
   ============================================================ */
const Spark = ({ data, color = "#8a6bff", width = 110, height = 36 }) => {
  const max = Math.max(...data), min = Math.min(...data);
  const range = Math.max(0.0001, max - min);
  const step = width / (data.length - 1);
  const pts = data.map((v, i) => `${i * step},${height - ((v - min) / range) * (height - 4) - 2}`);
  const d = "M" + pts.join(" L");
  const area = d + ` L${width},${height} L0,${height} Z`;
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <linearGradient id={`spk-${color.replace('#','')}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#spk-${color.replace('#','')})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.4" />
    </svg>
  );
};

/* ============================================================
   BRAND MARK
   ============================================================ */
// Real Bank of Ethos medallion (served at site root — same origin as the
// embedded /ethos/ app, so the absolute path resolves). Falls back to the
// old vector mark if the asset is ever missing.
const BrandMark = () => (
  <img
    src="/assets/artwork/gameicons/Bank%20of%20Ethos.png"
    alt="Bank of Ethos"
    style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
    onError={(e) => {
      const el = e.currentTarget;
      el.onerror = null;
      el.replaceWith(Object.assign(document.createElement("div"), {
        style: "width:100%;height:100%;background:linear-gradient(135deg,#8a6bff,#ff7a3d)",
      }));
    }}
  />
);

/* ============================================================
   NUMBERS — humanized formatter
   ============================================================ */
const fmt = (n, opts = {}) => {
  if (n === undefined || n === null) return "—";
  const { decimals = 0 } = opts;
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
};
const fmtTime = (s) => {
  const h = Math.floor(s / 3600).toString().padStart(2,"0");
  const m = Math.floor((s % 3600) / 60).toString().padStart(2,"0");
  const ss = Math.floor(s % 60).toString().padStart(2,"0");
  return `${h}:${m}:${ss}`;
};

/* ============================================================
   STATIC DATA
   ============================================================ */
const NAV = [
  { group: "Treasury", items: [
    { id: "vaults", icon: "vault", label: "Vaults" },
    { id: "transfers", icon: "arrow_out", label: "Send & Request" },
    { id: "directory", icon: "merc", label: "Directory" },
    { id: "ledger", icon: "ledger", label: "Ledger" },
    { id: "loans", icon: "loan", label: "Loans", badge: "2" },
  ]},
  { group: "Operations", items: [
    { id: "mercs", icon: "merc", label: "Mercenaries", badge: "7" },
    { id: "contracts", icon: "contract", label: "Contracts" },
    { id: "ops", icon: "shield", label: "Ops Vault" },
  ]},
  { group: "Economy", items: [
    { id: "market", icon: "market", label: "Marketplace" },
    { id: "charts", icon: "chart", label: "Market Charts" },
  ]},
];

/* ============================================================
   ACCOUNTS — directory of other in-game players
   ============================================================ */
const DIRECTORY = [
  { handle: "ETH-VK4A", callsign: "Vash Korr",       initials: "VK", c1: "#ff7a3d", c2: "#8a6bff", tag: "Mercenary · Rank B",   rep: 84, online: true  },
  { handle: "ETH-IS7P", callsign: "Iyla Sten",       initials: "IS", c1: "#5ee3ff", c2: "#7c5cff", tag: "Mercenary · Rank A",   rep: 92, online: true  },
  { handle: "ETH-RV2M", callsign: "Renn Vol",        initials: "RV", c1: "#8a6bff", c2: "#ff7a3d", tag: "Mercenary · Rank S",   rep: 96, online: true  },
  { handle: "ETH-AM9X", callsign: "Auro Mid",        initials: "AM", c1: "#ffc15c", c2: "#ff7a3d", tag: "Mercenary · Rank B",   rep: 78, online: false },
  { handle: "ETH-SQ1B", callsign: "Sable Q.",        initials: "SQ", c1: "#5ae28a", c2: "#5ee3ff", tag: "Mercenary · Rank C",   rep: 64, online: true  },
  { handle: "ETH-TL8K", callsign: "Tor Linn",        initials: "TL", c1: "#ff6b8a", c2: "#8a6bff", tag: "Mercenary · Rank B",   rep: 81, online: true  },
  { handle: "ETH-KY3R", callsign: "Kova Yi",         initials: "KY", c1: "#5ee3ff", c2: "#5ae28a", tag: "Mercenary · Rank A",   rep: 88, online: true  },
  { handle: "ETH-CH00", callsign: "Camp Heights Co.",initials: "CH", c1: "#8a6bff", c2: "#ff7a3d", tag: "Operator · Corporation",rep: 100,online: true  },
  { handle: "ETH-IC5L", callsign: "Iron Cabal",      initials: "IC", c1: "#7c739b", c2: "#181339", tag: "Operator · Corporation",rep: 91, online: true  },
  { handle: "ETH-PB7Z", callsign: "Pyre Brokerage",  initials: "PB", c1: "#ff7a3d", c2: "#ffc15c", tag: "Operator · Brokerage",  rep: 73, online: false },
  { handle: "ETH-NX2V", callsign: "Nyx Vasari",      initials: "NV", c1: "#5ee3ff", c2: "#ff6b8a", tag: "Mercenary · Rank S",   rep: 95, online: false },
  { handle: "ETH-DM4Q", callsign: "Drake Mors",      initials: "DM", c1: "#5ae28a", c2: "#8a6bff", tag: "Mercenary · Rank A",   rep: 86, online: true  },
];

const MERCS = [
  { name: "Vash Korr", tag: "VK", color1: "#ff7a3d", color2: "#8a6bff", task: "Ranked Battle Ops",  in: 11_520, cinder: 72_000, battles: 14, runs: 3, status: "live" },
  { name: "Iyla Sten", tag: "IS", color1: "#5ee3ff", color2: "#7c5cff", task: "Resource Expedition", in: 8_640,  cinder: 41_200, battles: 0,  runs: 0, status: "live" },
  { name: "Renn Vol",  tag: "RV", color1: "#8a6bff", color2: "#ff7a3d", task: "Roguelite Run #7",    in: 19_440, cinder: 95_800, battles: 9,  runs: 4, status: "live" },
  { name: "Auro Mid",  tag: "AM", color1: "#ffc15c", color2: "#ff7a3d", task: "Loot Operation",      in: 27_540, cinder: 138_400, battles: 22, runs: 2, status: "warn" },
  { name: "Sable Q.",  tag: "SQ", color1: "#5ae28a", color2: "#5ee3ff", task: "Dungeon Run — Pyre",  in: 2_100,  cinder: 9_800,  battles: 2,  runs: 1, status: "live" },
  { name: "Tor Linn",  tag: "TL", color1: "#ff6b8a", color2: "#8a6bff", task: "Card Hunt",           in: 4_320,  cinder: 22_400, battles: 6,  runs: 0, status: "live" },
  { name: "Kova Yi",   tag: "KY", color1: "#5ee3ff", color2: "#5ae28a", task: "Base Defense",        in: 14_700, cinder: 58_600, battles: 11, runs: 0, status: "live" },
];

const RESOURCES = [
  { name: "Ether Ore",      qty: 1_482, icon: "ore",   tone: "var(--aza)" },
  { name: "Cinder Shard",   qty: 624,   icon: "flame", tone: "var(--cinder)" },
  { name: "Scrap Metal",    qty: 9_440, icon: "cube",  tone: "var(--ink-dim)" },
  { name: "Bone Resin",     qty: 318,   icon: "cube",  tone: "#bda77a" },
  { name: "Voidsteel Ingot",qty: 47,    icon: "cube",  tone: "var(--violet)" },
  { name: "Soulglass",      qty: 12,    icon: "relic", tone: "#ff9eb0" },
];

const MARKET = [
  { name: "Pyrelord Relic",     rarity: "legend", rarityLabel: "Legendary", glyph: "relic",  price: 48_500, currency: "cinder", seller: "Vash Korr",   stock: 1 },
  { name: "Ether Ore × 100",    rarity: "rare",   rarityLabel: "Resource",  glyph: "ore",    price: 1_240,  currency: "aza",    seller: "Treasury",    stock: 38 },
  { name: "Hollow Saint Card",  rarity: "epic",   rarityLabel: "Epic",      glyph: "card",   price: 18_900, currency: "aza",    seller: "Renn Vol",    stock: 2 },
  { name: "Voidsteel Ingot × 5",rarity: "epic",   rarityLabel: "Material",  glyph: "cube",   price: 32_000, currency: "cinder", seller: "Iron Cabal",  stock: 6 },
  { name: "Ascendant Blade",    rarity: "legend", rarityLabel: "Legendary", glyph: "sword",  price: 124_000,currency: "aza",    seller: "Auro Mid",    stock: 1 },
  { name: "Soul-Bound Shield",  rarity: "rare",   rarityLabel: "Rare",      glyph: "shield", price: 9_400,  currency: "cinder", seller: "Tor Linn",    stock: 3 },
  { name: "Cinder Shard × 50",  rarity: "rare",   rarityLabel: "Resource",  glyph: "flame",  price: 4_120,  currency: "cinder", seller: "Treasury",    stock: 91 },
  { name: "Storm-Gate Card",    rarity: "epic",   rarityLabel: "Epic",      glyph: "card",   price: 21_500, currency: "aza",    seller: "Kova Yi",     stock: 1 },
];

const LOANS = [
  { id: "L-204A", type: "Mercenary Payroll", principal: 240_000, currency: "cinder", apr: 4.8, term: 14, remaining: 8, status: "active", paid: 120_000 },
  { id: "L-198C", type: "Base Upgrade",      principal: 92_500,  currency: "aza",    apr: 6.2, term: 30, remaining: 22, status: "active", paid: 18_500 },
  { id: "L-187B", type: "Resource Operation",principal: 60_000,  currency: "cinder", apr: 5.4, term: 7,  remaining: 0, status: "closed", paid: 60_000 },
];

const LEDGER = [
  { t: "12:42:18", type: "Payout",        actor: "Vash Korr",        memo: "Ranked Battle session payout",      amt: -43_200, cur: "cinder" },
  { t: "12:40:09", type: "Vault Deposit", actor: "Auto",             memo: "Employer share — 40% split",         amt:  28_800, cur: "cinder" },
  { t: "12:39:55", type: "Loot",          actor: "Operations",       memo: "Ether Ore ×42, Relics ×3, Cards ×2", amt: null,    cur: null },
  { t: "12:31:02", type: "Trade",         actor: "Marketplace",      memo: "Sold: Storm-Gate Card",              amt:  21_500, cur: "aza" },
  { t: "12:18:44", type: "Loan Payment",  actor: "L-204A",           memo: "Mercenary Payroll Loan installment", amt: -12_000, cur: "cinder" },
  { t: "11:56:30", type: "Withdraw",      actor: "You",              memo: "External transfer to Bank of Aza",   amt: -5_000,  cur: "aza" },
  { t: "11:44:01", type: "Deposit",       actor: "Sable Q.",         memo: "Mercenary 60% cut deposit",          amt:  5_880,  cur: "cinder" },
  { t: "11:12:55", type: "Auction Won",   actor: "Marketplace",      memo: "Pyrelord Relic acquired",            amt: -48_500, cur: "cinder" },
  { t: "10:48:20", type: "Trade",         actor: "Iron Cabal",       memo: "Voidsteel Ingot ×5 purchased",       amt: -32_000, cur: "cinder" },
];

const SPK_CINDER = [40, 44, 39, 48, 52, 50, 58, 56, 62, 60, 66, 72, 70, 75, 78, 74, 82, 88, 92, 86];
const SPK_AZA    = [62, 60, 64, 63, 66, 64, 67, 65, 68, 66, 70, 69, 72, 71, 75, 73, 76, 78, 77, 80];

/* ============================================================
   TWEAKS — defaults
   ============================================================ */
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "role": "employer",
  "accent": "#8a6bff"
}/*EDITMODE-END*/;

/* ============================================================
   ACCOUNT — persistent local state
   ============================================================ */
const STORAGE = "boe.account.v1";
const STORAGE_TX = "boe.transfers.v1";

function loadAccount() {
  try { return JSON.parse(localStorage.getItem(STORAGE)); } catch (e) { return null; }
}
function saveAccount(acc) { localStorage.setItem(STORAGE, JSON.stringify(acc)); }
function loadTransfers() {
  try { return JSON.parse(localStorage.getItem(STORAGE_TX)) || []; } catch (e) { return []; }
}
function saveTransfers(t) { localStorage.setItem(STORAGE_TX, JSON.stringify(t)); }

// Ask the parent game to move REAL Cinder / Aza / resources between the
// player's wallet and their Bank of Ethos vault. The parent re-validates
// every amount against the real Profile/ledger and re-seeds us after.
//   kind: 'cinder' | 'aza' | 'res'   op: 'deposit' | 'withdraw'
function boeTx(op, kind, amount, resId) {
  var n = Math.floor(Number(amount) || 0);
  if (!(n > 0)) return false;
  try { window.parent.postMessage({ type: 'boe:tx', op: op, kind: kind, amount: n, resId: resId || null }, '*'); return true; } catch (e) { return false; }
}
// Cross-player Cinder request actions. The parent is authoritative and
// re-validates / re-seeds; we just transmit the intent.
//   op: 'create' | 'pay' | 'decline' | 'cancel'
function boeReq(op, args) {
  try { window.parent.postMessage(Object.assign({ type: 'boe:request', op: op }, args || {}), '*'); return true; } catch (e) { return false; }
}
// Apply for / pay / pay off a hero-collateralized loan.
//   op: 'apply' | 'pay' | 'payoff'
function boeLoan(op, args) {
  try { window.parent.postMessage(Object.assign({ type: 'boe:loan', op: op }, args || {}), '*'); return true; } catch (e) { return false; }
}
// Mercenary marketplace actions.
//   op: 'list' | 'unlist' | 'hire' | 'clockin' | 'pause' | 'clockout'
function boeMerc(op, args) {
  try { window.parent.postMessage(Object.assign({ type: 'boe:merc', op: op }, args || {}), '*'); return true; } catch (e) { return false; }
}
// Contract postings — either side posts a specific job; the other side accepts.
//   op: 'create' | 'cancel' | 'accept'
function boePost(op, args) {
  try { window.parent.postMessage(Object.assign({ type: 'boe:post', op: op }, args || {}), '*'); return true; } catch (e) { return false; }
}
// Marketplace actions.
//   op: 'list' | 'cancel' | 'buy' | 'bid'
function boeMkt(op, args) {
  try { window.parent.postMessage(Object.assign({ type: 'boe:market', op: op }, args || {}), '*'); return true; } catch (e) { return false; }
}
// 🧾 Print-to-PDF statement. Opens a styled popup the player can "Save as
// PDF" via the system print dialog. Pure client-side, no libraries.
function openStatementWindow(account) {
  try {
    var w = window.open("", "BoeStatement", "width=820,height=1000");
    if (!w) { alert("Pop-up blocked — allow pop-ups to print the statement."); return; }
    var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); };
    var fmtN = function (n) { return Number(n || 0).toLocaleString(); };
    var fmtDate = function (ms) { try { return new Date(ms).toLocaleString(); } catch (e) { return ""; } };
    var v = (account && account.vault) || {};
    var cat = v.resCatalog || [];
    var bRes = v.bankRes || {};
    var resRows = cat.filter(function (r) { return (bRes[r.id] | 0) > 0; })
      .map(function (r) { return "<tr><td>" + esc(r.icon || "") + " " + esc(r.name) + "</td><td style='text-align:right'>" + fmtN(bRes[r.id]) + "</td></tr>"; })
      .join("");
    if (!resRows) resRows = "<tr><td colspan='2' style='color:#888;text-align:center'>(none)</td></tr>";
    var led = Array.isArray(account.ledger) ? account.ledger : [];
    var ledRows = led.length ? led.slice(0, 60).map(function (e) {
      var c = (e.cinder | 0), a = (e.aza | 0);
      var amt = (c ? (c > 0 ? "+" : "") + fmtN(c) + " 🜂 Cinder" : "") + (c && a ? " · " : "") + (a ? (a > 0 ? "+" : "") + fmtN(a) + " ◉ Aza" : "");
      if (!amt) amt = "—";
      return "<tr><td>" + esc(fmtDate(e.ts)) + "</td><td>" + esc(e.kind || "") + "</td><td>" + esc(e.note || "") + (e.counterparty ? " · " + esc(e.counterparty) : "") + "</td><td style='text-align:right;white-space:nowrap'>" + amt + "</td></tr>";
    }).join("") : "<tr><td colspan='4' style='color:#888;text-align:center'>(none)</td></tr>";
    var html = "<!doctype html><html><head><meta charset='utf-8'><title>Bank of Ethos — Statement</title><style>"
      + "body{margin:0;font:14px/1.5 'Space Grotesk',system-ui,Arial,sans-serif;background:#fff;color:#161616;padding:36px 44px}"
      + "h1{font-size:22px;margin:0 0 4px;letter-spacing:-0.01em}h2{font-size:14px;margin:24px 0 8px;letter-spacing:0.06em;text-transform:uppercase;color:#444}"
      + ".muted{color:#777;font-size:12px}.row{display:flex;justify-content:space-between;gap:24px}"
      + "table{width:100%;border-collapse:collapse;font-size:12.5px}td{padding:6px 8px;border-bottom:1px solid #eee;vertical-align:top}"
      + ".bar{height:1px;background:#000;margin:14px 0 18px}"
      + ".chip{display:inline-block;border:1px solid #ccc;padding:4px 10px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#444;margin-right:6px}"
      + "@media print{body{padding:18mm 16mm}}"
      + "</style></head><body>"
      + "<h1>🏛 Bank of Ethos — Statement</h1>"
      + "<div class='muted'>" + esc(account.callsign || "") + " · <span style='font-family:monospace'>" + esc(account.handle || "") + "</span> · Generated " + esc(fmtDate(Date.now())) + "</div>"
      + "<div class='bar'></div>"
      + "<h2>Balance</h2>"
      + "<table>"
        + "<tr><td>🜂 Cinder · in bank</td><td style='text-align:right'>" + fmtN(account.cinder) + "</td></tr>"
        + "<tr><td>🜂 Cinder · in wallet</td><td style='text-align:right'>" + fmtN(account.walletCinder) + "</td></tr>"
        + "<tr><td>◉ Aza Coin · in bank</td><td style='text-align:right'>" + fmtN(account.aza) + "</td></tr>"
        + "<tr><td>◉ Aza Coin · in wallet</td><td style='text-align:right'>" + fmtN(account.walletAza) + "</td></tr>"
      + "</table>"
      + "<h2>Banked Resources</h2><table><tr><th style='text-align:left'>Resource</th><th style='text-align:right'>Units</th></tr>" + resRows + "</table>"
      + "<h2>Transaction Ledger</h2><table><tr><th style='text-align:left'>When</th><th style='text-align:left'>Kind</th><th style='text-align:left'>Note</th><th style='text-align:right'>Amount</th></tr>" + ledRows + "</table>"
      + "<div class='muted' style='margin-top:24px'>End of statement. Bank of Ethos · Camp Heights Treasury.</div>"
      + "<script>setTimeout(function(){window.print();},250);</" + "script>"
      + "</body></html>";
    w.document.open(); w.document.write(html); w.document.close();
  } catch (e) { try { alert("Could not open statement."); } catch (e2) {} }
}

function genHandle() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "ETH-";
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

const AVATAR_PALETTES = [
  ["#ff7a3d", "#8a6bff"],
  ["#5ee3ff", "#7c5cff"],
  ["#ffc15c", "#ff7a3d"],
  ["#5ae28a", "#5ee3ff"],
  ["#ff6b8a", "#8a6bff"],
  ["#8a6bff", "#ff7a3d"],
];

/* ============================================================
   APP
   ============================================================ */
function App() {
  const [account, setAccount] = useState(() => loadAccount());
  const [transfers, setTransfers] = useState(() => loadTransfers());
  const [toasts, setToasts] = useState([]);
  const _embedded = (function () { try { return window.parent && window.parent !== window; } catch (e) { return false; } })();
  const [linking, setLinking] = useState(_embedded && !account);

  // 🔗 Game bridge: when embedded in Mythic Spellbook the parent seeds the
  // player's real identity + balances (Cinder bank balance, Aza coin), so
  // there's no separate signup and the dashboard shows REAL numbers.
  useEffect(() => {
    if (!_embedded) return;
    function onMsg(e) {
      var d = e && e.data;
      if (!d || d.type !== 'boe:seed') return;
      setAccount(function (prev) {
        // Build a COMPLETE account (same shape a successful create-signup
        // produces) — not a merge over a possibly-broken prior account —
        // so every dashboard component has the fields it expects.
        var cs = (d.callsign || (prev && prev.callsign) || 'Operator') + '';
        var ini = (cs.trim().split(/\s+/).map(function (w) { return w[0]; }).slice(0, 2).join('') || 'OP').toUpperCase();
        var pal = (typeof AVATAR_PALETTES !== 'undefined' && AVATAR_PALETTES[0]) || ['#8a6bff', '#ff7a3d'];
        var next = {
          handle: (d.handle || (prev && prev.handle) || 'operator') + '',
          callsign: cs,
          initials: ini,
          c1: (prev && prev.c1) || pal[0],
          c2: (prev && prev.c2) || pal[1],
          cinder: Math.max(0, Number(d.cinder) || 0),
          aza: Math.max(0, Number(d.aza) || 0),
          // real spendable wallet balances + the salvage ledger / banked
          // resources, so deposit/withdraw shows true numbers everywhere.
          walletCinder: Math.max(0, Number(d.walletCinder) || 0),
          walletAza: Math.max(0, Number(d.walletAza) || 0),
          vault: {
            resCatalog: Array.isArray(d.resCatalog) ? d.resCatalog : ((prev && prev.vault && prev.vault.resCatalog) || []),
            walletRes: (d.walletRes && typeof d.walletRes === 'object') ? d.walletRes : {},
            bankRes: (d.bankRes && typeof d.bankRes === 'object') ? d.bankRes : {},
            bankReady: !!d.bankReady,
            extCols: !!d.extCols,
          },
          // Real ledger + Cinder requests (incoming pending = ask to pay,
          // outgoing = ones we sent).
          ledger: Array.isArray(d.ledger) ? d.ledger : ((prev && prev.ledger) || []),
          reqIn: Array.isArray(d.reqIn) ? d.reqIn : ((prev && prev.reqIn) || []),
          reqOut: Array.isArray(d.reqOut) ? d.reqOut : ((prev && prev.reqOut) || []),
          // Hero-collateralized loans + the player's current capacity.
          loans: Array.isArray(d.loans) ? d.loans : ((prev && prev.loans) || []),
          loanCap: (d.loanCap && typeof d.loanCap === 'object') ? d.loanCap : ((prev && prev.loanCap) || { aza: 0, max: 20, perLv: 5, heroLv: 0, perCinder: 5000 }),
          // Mercenary marketplace: open listings + my contracts (both
          // sides) + the canonical 40/52/8 split.
          mercListings: Array.isArray(d.mercListings) ? d.mercListings : ((prev && prev.mercListings) || []),
          mercAsEmployer: Array.isArray(d.mercAsEmployer) ? d.mercAsEmployer : ((prev && prev.mercAsEmployer) || []),
          mercAsMerc: Array.isArray(d.mercAsMerc) ? d.mercAsMerc : ((prev && prev.mercAsMerc) || []),
          mercPosts: Array.isArray(d.mercPosts) ? d.mercPosts : ((prev && prev.mercPosts) || []),
          // Marketplace (open + my listings) + bank-of-ethos handle directory
          market: Array.isArray(d.market) ? d.market : ((prev && prev.market) || []),
          marketMine: Array.isArray(d.marketMine) ? d.marketMine : ((prev && prev.marketMine) || []),
          directory: Array.isArray(d.directory) ? d.directory : ((prev && prev.directory) || []),
          // Real owned cards (id+name+icon+rarity+count) — must be captured
          // so the Marketplace listing modal can pick from real collection.
          cards: Array.isArray(d.cards) ? d.cards : ((prev && prev.cards) || []),
          mercSplit: (d.mercSplit && typeof d.mercSplit === 'object') ? d.mercSplit : ((prev && prev.mercSplit) || { merc: 0.40, employer: 0.52, tax: 0.08, perCinder: 5000, maxHours: 24, maxTarget: 5000000 }),
          created: (prev && prev.created) || new Date().toISOString(),
          recoveryKey: (prev && prev.recoveryKey) || '—',
          application: (prev && prev.application) || { org: cs, role: 'Operator', region: 'Camp Heights', purpose: 'Treasury access', linked: true },
          _gameLinked: true,
        };
        try { saveAccount(next); } catch (e2) {}
        return next;
      });
      setLinking(false);
    }
    window.addEventListener('message', onMsg);
    try { window.parent.postMessage({ type: 'boe:hello' }, '*'); } catch (e) {}
    var hi = setInterval(function () { try { window.parent.postMessage({ type: 'boe:hello' }, '*'); } catch (e) {} }, 1200);
    var stop = setTimeout(function () { clearInterval(hi); setLinking(false); }, 8000);
    return function () { window.removeEventListener('message', onMsg); clearInterval(hi); clearTimeout(stop); };
  }, []);

  if (!account) {
    if (linking) {
      return (
        <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', color: '#caa46a', fontFamily: 'inherit' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 30, marginBottom: 8 }}>🏦</div>
            <div style={{ fontWeight: 700 }}>Linking to your Mythic Spellbook account…</div>
          </div>
        </div>
      );
    }
    return <AuthScreen onAccount={(a) => { saveAccount(a); setAccount(a); }} />;
  }

  const updateAccount = (patch) => {
    const next = { ...account, ...patch };
    setAccount(next);
    saveAccount(next);
  };
  const pushToast = (toast) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((ts) => [...ts, { ...toast, id }]);
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 4200);
  };
  const sendMoney = ({ to, currency, amount, memo }) => {
    if (currency === "cinder" && amount > account.cinder) return false;
    if (currency === "aza" && amount > account.aza) return false;
    const next = { ...account };
    if (currency === "cinder") next.cinder = +(next.cinder - amount).toFixed(2);
    else next.aza = +(next.aza - amount).toFixed(2);
    setAccount(next); saveAccount(next);
    const tx = {
      id: "TX-" + Math.random().toString(36).slice(2, 8).toUpperCase(),
      t: new Date().toISOString(),
      from: account.handle, fromName: account.callsign,
      to: to.handle, toName: to.callsign,
      currency, amount, memo, direction: "out",
    };
    const updated = [tx, ...transfers].slice(0, 50);
    setTransfers(updated); saveTransfers(updated);
    pushToast({
      tone: currency,
      title: `Sent ${fmt(amount)} ${currency === "cinder" ? "CDR" : "AZA"}`,
      body: `To ${to.callsign} · ${to.handle}`,
    });
    return true;
  };

  return <AppInner
    account={account}
    updateAccount={updateAccount}
    transfers={transfers}
    sendMoney={sendMoney}
    pushToast={pushToast}
    onLogout={() => { localStorage.removeItem(STORAGE); localStorage.removeItem(STORAGE_TX); setAccount(null); setTransfers([]); }}
    toasts={toasts}
  />;
}

// Page-level error boundary: a single failing widget shows an inline
// message instead of blanking the whole dashboard (and surfaces the cause).
class PageBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err: err }; }
  componentDidCatch(err) { try { console.error('[BankOfEthos] page error:', err); } catch (e) {} }
  render() {
    if (this.state.err) {
      return (
        <div style={{ padding: '28px', color: '#ffb499', fontFamily: 'JetBrains Mono, monospace' }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: '#ff8a8a' }}>⚠ This panel hit an error.</div>
          <div style={{ fontSize: 12, opacity: 0.85, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
            {String((this.state.err && (this.state.err.stack || this.state.err.message)) || this.state.err).slice(0, 800)}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
function AppInner({ account, updateAccount, transfers, sendMoney, pushToast, onLogout, toasts }) {
  const [route, setRoute] = useState("vaults");
  const [t, setTweak] = (window.useTweaks || (() => [TWEAK_DEFAULTS, () => {}]))(TWEAK_DEFAULTS);
  const [sendTo, setSendTo] = useState(null); // contact object or null

  // live clock simulator for active session
  const [sessionSec, setSessionSec] = useState(11_520);
  const [running, setRunning] = useState(true);
  const [liveCinder, setLiveCinder] = useState(72_000);
  useEffect(() => {
    if (!running) return;
    const i = setInterval(() => {
      setSessionSec(s => Math.min(s + 1, 8*3600));
      setLiveCinder(c => c + Math.round(2 + Math.random() * 6));
    }, 1000);
    return () => clearInterval(i);
  }, [running]);

  const role = t.role;
  const accent = t.accent;
  useEffect(() => {
    document.documentElement.style.setProperty("--violet", accent);
  }, [accent]);

  return (
    <div className="shell">
      <Sidebar route={route} setRoute={setRoute} account={account} onLogout={onLogout} />
      <div className="main">
        <Topbar account={account} onSend={() => setSendTo({})} onLogout={onLogout} />
        <div className="content">
          <PageBoundary key={route} route={route}>
          {route === "vaults" && <PageVaults role={role} account={account} liveCinder={liveCinder} sessionSec={sessionSec} onSend={() => setSendTo({})} />}
          {route === "transfers" && <PageTransfers account={account} transfers={transfers} onSend={(c) => setSendTo(c || {})} />}
          {route === "directory" && <PageDirectory account={account} onSend={(c) => setSendTo(c)} />}
          {route === "ledger" && <PageLedger account={account} transfers={transfers} />}
          {route === "loans" && <PageLoans account={account} />}
          {route === "mercs" && <PageMercs account={account} role={role} sessionSec={sessionSec} liveCinder={liveCinder} running={running} setRunning={setRunning} />}
          {route === "contracts" && <PageContracts />}
          {route === "ops" && <PageOpsVault account={account} />}
          {route === "market" && <PageMarket account={account} />}
          {route === "charts" && <PageCharts />}
          </PageBoundary>
        </div>
      </div>
      <TweaksPanelHost t={t} setTweak={setTweak} />
      {sendTo !== null && (
        <SendModal
          account={account}
          initialContact={sendTo && sendTo.handle ? sendTo : null}
          onClose={() => setSendTo(null)}
          onSend={(payload) => { const ok = sendMoney(payload); if (ok) setSendTo(null); return ok; }}
        />
      )}
      <ToastHost toasts={toasts} />
    </div>
  );
}

/* ============================================================
   SIDEBAR
   ============================================================ */
function Sidebar({ route, setRoute, account, onLogout }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark"><BrandMark /></div>
        <div>
          <div className="brand-name">Bank of Ethos</div>
          <div className="brand-sub">CAMP HEIGHTS · TREASURY</div>
        </div>
      </div>
      <nav style={{ overflowY: "auto", flex: 1, marginRight: -8, paddingRight: 8 }}>
        {NAV.map(g => (
          <div key={g.group} className="stack-sm">
            <div className="nav-group-label">{g.group}</div>
            {g.items.map(it => (
              <div key={it.id} className={`nav-item ${route === it.id ? "active" : ""}`} onClick={() => setRoute(it.id)}>
                <Icon name={it.icon} className="ico" />
                <span>{it.label}</span>
                {it.badge && <span className="badge">{it.badge}</span>}
              </div>
            ))}
          </div>
        ))}
      </nav>
      <div className="user-card">
        <div className="avatar" style={{ background: `linear-gradient(135deg, ${account.c1}, ${account.c2})` }}>{account.initials}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{account.callsign}</div>
          <div className="mono" style={{ fontSize: 10, color: "var(--violet)", letterSpacing: "0.06em" }}>{account.handle}</div>
        </div>
        <div className="icon-btn" style={{ width: 26, height: 26 }} title="Sign out" onClick={onLogout}><Icon name="arrow_out" size={12} /></div>
      </div>
    </aside>
  );
}

/* ============================================================
   TOPBAR
   ============================================================ */
function Topbar({ account, onSend, onLogout }) {
  return (
    <div className="topbar">
      <div className="search">
        <Icon name="search" size={14} />
        <input placeholder="Search vaults, mercenaries, listings, ledger…" />
        <kbd>⌘ K</kbd>
      </div>
      <div className="right">
        <span className="pill"><span className="dot" style={{ background: "var(--good)", boxShadow: "0 0 8px var(--good)" }}></span>Network · Stable</span>
        <span className="pill"><CinderGlyph size={14} /> <span className="mono">1 CDR</span> · <span className="mono" style={{ color: "var(--cinder)" }}>0.214 AZA</span> <span className="mono" style={{ color: "var(--good)" }}>▲ 2.4%</span></span>
        <span className="pill"><AzaGlyph size={14} /> <span className="mono">1 AZA</span> · <span className="mono" style={{ color: "var(--aza)" }}>4.67 CDR</span> <span className="mono" style={{ color: "var(--bad)" }}>▼ 0.6%</span></span>
        <button className="btn primary" onClick={onSend}><Icon name="arrow_out" size={14} /> Send</button>
        <div className="icon-btn"><Icon name="bell" size={16} /><span className="ping"></span></div>
        <div className="icon-btn"><Icon name="settings" size={16} /></div>
        <div style={{ display:"flex", alignItems:"center", gap:10, paddingLeft: 10, borderLeft: "1px solid var(--hair)" }}>
          <div className="avatar" style={{ background: `linear-gradient(135deg, ${account.c1}, ${account.c2})` }}>{account.initials}</div>
          <div style={{ lineHeight: 1.1 }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{account.callsign}</div>
            <div className="mono" style={{ fontSize: 10, color: "var(--violet)", letterSpacing: "0.06em" }}>{account.handle}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   PAGE: VAULTS (Dashboard)
   ============================================================ */
function PageVaults({ role, account, liveCinder, sessionSec, onSend }) {
  const [depOpen, setDepOpen] = useState(false);
  return (
    <div>
      {depOpen && <DepositModal account={account} onClose={() => setDepOpen(false)} />}
      <div className="page-head">
        <div>
          <div className="page-crumb">Treasury / Vaults Overview</div>
          <div className="page-title display">{account.callsign}'s Vault</div>
        </div>
        <div className="page-actions">
          <button className="btn ghost" onClick={() => openStatementWindow(account)}><Icon name="download" size={14} /> Statement</button>
          <button className="btn" onClick={onSend}><Icon name="arrow_out" size={14} /> Send</button>
          <button className="btn primary" onClick={() => setDepOpen(true)}><Icon name="arrow_in" size={14} /> Deposit</button>
        </div>
      </div>

      {/* dual balance + recent metrics */}
      <div className="grid g-2" style={{ marginBottom: 14 }}>
        <BalanceCard kind="cinder" amount={account.cinder} wallet={account.walletCinder || 0} bankReady={!!(account.vault && account.vault.bankReady)} delta="+4.2%" spark={SPK_CINDER} onSend={onSend} />
        <BalanceCard kind="aza"    amount={account.aza}    wallet={account.walletAza || 0}    bankReady={!!(account.vault && account.vault.bankReady && account.vault.extCols)} delta="-0.6%" spark={SPK_AZA} onSend={onSend} />
      </div>

      {/* Real summary tiles. Resources reflect deposits made via Operation
          Vault — Camp Heights immediately (bankRes is re-seeded after every
          boe:tx). */}
      {(() => {
        const v = (account && account.vault) || {};
        const cat = v.resCatalog || [];
        const bRes = v.bankRes || {};
        const bankedTotal = Object.keys(bRes).reduce((s, k) => s + (bRes[k] | 0), 0);
        const bankedTypes = cat.filter(r => (bRes[r.id] | 0) > 0).length;
        const loans = Array.isArray(account && account.loans) ? account.loans : [];
        const activeLoans = loans.filter(l => l && l.status === "active");
        const owed = activeLoans.reduce((s, l) => s + Math.max(0, (l.cinder_owed | 0) - (l.cinder_paid | 0)), 0);
        const asMerc = Array.isArray(account && account.mercAsMerc) ? account.mercAsMerc : [];
        const asEmp  = Array.isArray(account && account.mercAsEmployer) ? account.mercAsEmployer : [];
        const activeContracts = asMerc.concat(asEmp).filter(c => c && (c.status === "active" || c.status === "paused" || c.status === "offered"));
        const ledger = Array.isArray(account && account.ledger) ? account.ledger : [];
        const last24 = Date.now() - 24 * 3600 * 1000;
        const inflow24 = ledger.filter(e => (e.ts || 0) >= last24 && (e.cinder | 0) > 0).reduce((s, e) => s + (e.cinder | 0), 0);
        return (
          <div className="grid g-4" style={{ marginBottom: 14 }}>
            <Metric k="Resources in Bank" v={fmt(bankedTotal) + " units"} sub={bankedTotal > 0 ? bankedTypes + " of " + cat.length + " types" : "deposit via Ops Vault"} />
            <Metric k="Cinder Inflow (24h)" v={fmt(inflow24)} sub={<><CinderGlyph size={11}/> CDR</>} />
            <Metric k="Active Mercenary Contracts" v={String(activeContracts.length)} sub={activeContracts.length ? "see Mercenary Ops" : "(none)"} />
            <Metric k="Active Loans" v={activeLoans.length ? activeLoans.length + " · " + fmt(owed) : "0"} sub={activeLoans.length ? <><CinderGlyph size={11}/> CDR owed</> : "(none)"} />
          </div>
        );
      })()}

      <div className="grid" style={{ gridTemplateColumns: "1.4fr 1fr", gap: 14, marginBottom: 14 }}>
        {/* Active session live panel */}
        <div className="panel">
          <div className="panel-h">
            <div className="row" style={{ gap: 8 }}>
              <span className="live-dot"></span>
              <h3>Live Session — Vash Korr · Ranked Battle Ops</h3>
            </div>
            <span className="chip live"><span className="dot" style={{ background: "var(--good)" }}></span>Clocked In</span>
          </div>
          <div className="panel-b">
            <div className="row between" style={{ alignItems: "flex-end", marginBottom: 16 }}>
              <div>
                <div className="label">Session Time · Auto clock-out at 08:00:00</div>
                <div className="clock-time mono">{fmtTime(sessionSec)}<span className="ms"> / 08:00:00</span></div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="label">Cinder generated</div>
                <div className="display" style={{ fontSize: 30, fontWeight: 600, color: "var(--cinder)" }} >{fmt(liveCinder)}</div>
                <div className="mono" style={{ fontSize: 11, color: "var(--ink-mute)" }}>+12/sec · battle stream</div>
              </div>
            </div>
            <div className="bar" style={{ marginBottom: 16 }}>
              <div style={{ width: `${(sessionSec / (8*3600)) * 100}%`, background: "linear-gradient(90deg, var(--violet), var(--cinder))" }}></div>
            </div>
            <div className="grid g-3" style={{ gap: 10 }}>
              <SplitCard label="Mercenary cut · 60%" value={Math.round(liveCinder * 0.6)} kind="cinder" />
              <SplitCard label="Employer cut · 40%" value={Math.round(liveCinder * 0.4)} kind="cinder" />
              <SplitCard label="Loot value est." value={18_240} kind="aza" decimals={0} />
            </div>
          </div>
        </div>

        {/* Vault composition */}
        <div className="panel">
          <div className="panel-h"><h3>Vault Composition</h3><span className="label">Last 30D</span></div>
          <div className="panel-b">
            <Donut />
            <div className="stack-sm" style={{ marginTop: 14 }}>
              {[
                { c: "var(--cinder)", n: "Cinder (CDR)",    v: "62%" },
                { c: "var(--aza)",    n: "Aza Coin (AZA)",  v: "21%" },
                { c: "var(--violet)", n: "Resources/Loot",  v: "12%" },
                { c: "var(--warn)",   n: "Cards & Relics",  v: "5%" },
              ].map(r => (
                <div key={r.n} className="row between">
                  <div className="row" style={{ gap: 8 }}><span style={{ width: 8, height: 8, background: r.c, display: "inline-block" }}></span><span style={{ fontSize: 12 }}>{r.n}</span></div>
                  <span className="mono" style={{ fontSize: 12 }}>{r.v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Active Mercs + Live profit feed */}
      <div className="grid" style={{ gridTemplateColumns: "1.6fr 1fr", gap: 14 }}>
        <div className="panel">
          <div className="panel-h">
            <h3>Active Mercenaries</h3>
            <div className="row">
              <span className="chip live"><span className="live-dot"></span>7 online</span>
              <button className="btn sm ghost">View all →</button>
            </div>
          </div>
          <div>
            {MERCS.slice(0, 5).map(m => <MercRow key={m.name} m={m} />)}
          </div>
        </div>

        <div className="panel">
          <div className="panel-h"><h3>Live Profit Feed</h3><span className="chip live"><span className="live-dot"></span>Streaming</span></div>
          <div className="panel-b stack-sm" style={{ maxHeight: 360, overflowY: "auto" }}>
            {LEDGER.slice(0, 7).map((e, i) => <FeedRow key={i} e={e} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   COMPOSITE PIECES
   ============================================================ */
// Shared compact modal frame so Deposit / Request match the dashboard's
// dark gold-bronze aesthetic without growing a CSS surface area.
function ModalFrame({ title, onClose, children }) {
  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(4,3,8,0.78)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div role="dialog" aria-modal="true" style={{ width: "min(440px,92vw)", background: "linear-gradient(180deg,#13101f,#0a0815)", border: "1px solid var(--hair)", boxShadow: "0 24px 60px rgba(0,0,0,0.7)", padding: 20, color: "var(--ink)" }}>
        <div className="row between" style={{ marginBottom: 12 }}>
          <div className="display" style={{ fontWeight: 700, fontSize: 18, color: "var(--ink)" }}>{title}</div>
          <button className="btn sm ghost" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function DepositModal({ account, onClose }) {
  const [kind, setKind] = useState("cinder");
  const [amt, setAmt] = useState("");
  const isCinder = kind === "cinder";
  const wallet = isCinder ? (account.walletCinder | 0) : (account.walletAza | 0);
  const n = Math.max(0, Math.floor(Number(amt) || 0));
  const submit = () => {
    if (!(n > 0)) return;
    if (n > wallet) { setAmt(String(wallet)); return; }
    if (boeTx("deposit", kind, n)) onClose();
  };
  return (
    <ModalFrame title="Deposit to Bank" onClose={onClose}>
      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        <button className={"btn sm" + (isCinder ? "" : " ghost")} onClick={() => setKind("cinder")}><CinderGlyph size={14} /> Cinder</button>
        <button className={"btn sm" + (!isCinder ? "" : " ghost")} onClick={() => setKind("aza")}><AzaGlyph size={14} /> Aza Coin</button>
      </div>
      <div className="small-text" style={{ color: "var(--ink-dim)", marginBottom: 8 }}>You have <b>{fmt(wallet)}</b> {isCinder ? "Cinder" : "Aza"} in your wallet.</div>
      <div className="row" style={{ gap: 8, marginBottom: 14 }}>
        <input type="number" min="1" step="1" placeholder="amount" value={amt}
          onChange={(e) => setAmt(e.target.value)}
          style={{ flex: 1, background: "var(--bg-2)", border: "1px solid var(--hair)", color: "var(--ink)", padding: "8px 10px", fontFamily: "JetBrains Mono, monospace" }} />
        <button className="btn sm ghost" onClick={() => setAmt(String(wallet))}>Max</button>
      </div>
      <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={submit} disabled={!(n > 0)}>Deposit</button>
      </div>
    </ModalFrame>
  );
}

function RequestModal({ account, onClose }) {
  const [to, setTo] = useState("");
  const [amt, setAmt] = useState("");
  const [msg, setMsg] = useState("");
  const n = Math.max(0, Math.floor(Number(amt) || 0));
  const submit = () => {
    const h = to.trim();
    if (!h || !(n > 0)) return;
    if (boeReq("create", { toHandle: h, amount: n, message: msg })) onClose();
  };
  return (
    <ModalFrame title="Request Cinder" onClose={onClose}>
      <div className="small-text" style={{ color: "var(--ink-dim)", marginBottom: 10 }}>Ask another Bank of Ethos holder for Cinder. They see a pending request and choose to Pay or Decline. Paid Cinder lands in your bank automatically.</div>
      <div className="stack-sm" style={{ marginBottom: 14 }}>
        <input placeholder="@handle (exact)" value={to}
          onChange={(e) => setTo(e.target.value)}
          style={{ background: "var(--bg-2)", border: "1px solid var(--hair)", color: "var(--ink)", padding: "8px 10px", fontFamily: "JetBrains Mono, monospace" }} />
        <input type="number" min="1" step="1" placeholder="amount of Cinder" value={amt}
          onChange={(e) => setAmt(e.target.value)}
          style={{ background: "var(--bg-2)", border: "1px solid var(--hair)", color: "var(--ink)", padding: "8px 10px", fontFamily: "JetBrains Mono, monospace" }} />
        <input placeholder="message (optional)" value={msg} maxLength={200}
          onChange={(e) => setMsg(e.target.value)}
          style={{ background: "var(--bg-2)", border: "1px solid var(--hair)", color: "var(--ink)", padding: "8px 10px" }} />
      </div>
      <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={submit} disabled={!to.trim() || !(n > 0)}>Send Request</button>
      </div>
    </ModalFrame>
  );
}

function BalanceCard({ kind, amount, decimals = 0, delta, spark, onSend, wallet = 0, bankReady = true }) {
  const isCinder = kind === "cinder";
  const sym = isCinder ? "🔥" : "👑";
  const [amt, setAmt] = useState("");
  const n = Math.max(0, Math.floor(Number(amt) || 0));
  const act = (op) => {
    const max = op === "deposit" ? wallet : amount;
    if (!(n > 0)) return;
    if (n > max) { setAmt(String(max)); return; }
    if (boeTx(op, kind, n)) setAmt("");
  };
  return (
    <div className={`bal ${kind}`}>
      <div className="row between" style={{ position: "relative", zIndex: 1 }}>
        <div className="bal-head">
          <div className="bal-coin">{isCinder ? <CinderGlyph size={22} /> : <AzaGlyph size={22} />}</div>
          <div>
            <div className="bal-name">{isCinder ? "Cinder Reserve · CDR" : "Aza Coin · AZA"}</div>
            <div className="bal-tic">{isCinder ? "VOLATILE · COMBAT-GENERATED" : "STABLE · MARKET-PEGGED"}</div>
          </div>
        </div>
        <Spark data={spark} color={isCinder ? "#ff7a3d" : "#5ee3ff"} />
      </div>
      <div className="bal-amt" style={{ position: "relative", zIndex: 1 }}>
        {fmt(amount, { decimals })}
        <span className="sub" style={{ marginLeft: 8 }}>{isCinder ? "CDR" : "AZA"} · in bank</span>
      </div>
      <div className="bal-row" style={{ position: "relative", zIndex: 1 }}>
        <span className="chip" style={{ color: delta.startsWith("+") ? "var(--good)" : "var(--bad)", borderColor: delta.startsWith("+") ? "rgba(90,226,138,0.3)" : "rgba(255,107,138,0.3)" }}>
          {delta.startsWith("+") ? "▲" : "▼"} {delta} · 24h
        </span>
        <div className="row" style={{ gap: 6 }}>
          {!isCinder && (
            <button
              className="chip-btn"
              title="Exchange Aza Coin → Cinder"
              onClick={() => { try { window.parent.postMessage({ type: "boe:exchange-open" }, "*"); } catch (e) {} }}
            >Exchange</button>
          )}
          <button className="chip-btn" onClick={onSend}>Send</button>
        </div>
      </div>
      {/* Deposit / withdraw against the player's REAL wallet */}
      <div className="row" style={{ gap: 8, marginTop: 12, position: "relative", zIndex: 1, flexWrap: "wrap" }}>
        <input
          className="mono"
          type="number" min="1" step="1" placeholder={`amount ${sym}`}
          value={amt}
          onChange={(e) => setAmt(e.target.value)}
          style={{ flex: "1 1 110px", minWidth: 90, background: "var(--bg-2)", border: "1px solid var(--hair)", color: "var(--ink)", padding: "8px 10px", fontSize: 13 }}
        />
        <button className="btn sm" disabled={!bankReady} onClick={() => act("deposit")} title={`Move ${sym} from wallet into the bank`}>Deposit</button>
        <button className="btn sm ghost" disabled={!bankReady} onClick={() => act("withdraw")} title={`Move ${sym} from the bank to your wallet`}>Withdraw</button>
      </div>
      <div className="bal-foot" style={{ position: "relative", zIndex: 1 }}>
        <div style={{ flex: 1 }}><div className="k">In Bank</div><div className="v">{fmt(amount, { decimals })}</div></div>
        <div style={{ flex: 1 }}><div className="k">In Wallet</div><div className="v">{fmt(wallet, { decimals })}</div></div>
        <div style={{ flex: 1 }}><div className="k">Total</div><div className="v">{fmt(amount + wallet, { decimals })}</div></div>
      </div>
    </div>
  );
}

function Metric({ k, v, sub, d, dir }) {
  return (
    <div className="metric">
      <div className="k">{k}</div>
      <div className="v display row" style={{ gap: 6 }}>{v} {sub && <span style={{ fontSize: 11, color: "var(--ink-mute)", fontFamily: "JetBrains Mono", display: "inline-flex", alignItems: "center", gap: 4 }}>{sub}</span>}</div>
      {d && <div className={`d ${dir === "up" ? "up" : "down"}`}>{dir === "up" ? "▲" : "▼"} {d}</div>}
    </div>
  );
}

function SplitCard({ label, value, kind, decimals = 0 }) {
  return (
    <div style={{ border: "1px solid var(--hair)", padding: 12, background: "var(--bg-1)" }}>
      <div className="label">{label}</div>
      <div className="row" style={{ gap: 8, marginTop: 6 }}>
        {kind === "cinder" ? <CinderGlyph size={16} /> : <AzaGlyph size={16} />}
        <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{fmt(value, { decimals })}</div>
        <div className="mono" style={{ fontSize: 11, color: "var(--ink-mute)" }}>{kind === "cinder" ? "CDR" : "AZA"}</div>
      </div>
    </div>
  );
}

function Donut() {
  const segs = [
    { c: "#ff7a3d", v: 62 },
    { c: "#5ee3ff", v: 21 },
    { c: "#8a6bff", v: 12 },
    { c: "#ffc15c", v: 5 },
  ];
  let acc = 0;
  const r = 60, C = 2 * Math.PI * r;
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "10px 0" }}>
      <svg width="160" height="160" viewBox="0 0 160 160" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="80" cy="80" r={r} fill="none" stroke="var(--bg-2)" strokeWidth="18" />
        {segs.map((s, i) => {
          const dash = (s.v / 100) * C;
          const off = (acc / 100) * C;
          acc += s.v;
          return <circle key={i} cx="80" cy="80" r={r} fill="none" stroke={s.c} strokeWidth="18" strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-off} />;
        })}
        <text x="80" y="78" textAnchor="middle" fill="#efeaff" fontFamily="Space Grotesk" fontSize="20" fontWeight="600" transform="rotate(90 80 80)">3.46M</text>
        <text x="80" y="92" textAnchor="middle" fill="#7c739b" fontFamily="JetBrains Mono" fontSize="9" letterSpacing="2" transform="rotate(90 80 80)">TOTAL · CDR EQ</text>
      </svg>
    </div>
  );
}

function MercRow({ m }) {
  return (
    <div className="merc-row">
      <div className="merc-av" style={{ background: `linear-gradient(135deg, ${m.color1}, ${m.color2})` }}>{m.tag}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{m.name}</div>
        <div className="mono" style={{ fontSize: 11, color: "var(--ink-mute)", letterSpacing: "0.04em" }}>{m.task}</div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div className="label">Clocked</div>
        <div className="mono" style={{ fontSize: 12 }}>{fmtTime(m.in)}</div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div className="label">Cinder · 60% cut</div>
        <div className="mono" style={{ fontSize: 12, color: "var(--cinder)" }}>{fmt(Math.round(m.cinder * 0.6))}</div>
      </div>
      <span className={`chip ${m.status === "warn" ? "warn" : "live"}`}>
        {m.status === "warn" ? <><span className="dot" style={{ background: "var(--warn)" }}></span>Near limit</> : <><span className="live-dot"></span>Live</>}
      </span>
    </div>
  );
}

function FeedRow({ e }) {
  const cur = e.cur;
  const color = cur === "cinder" ? "var(--cinder)" : cur === "aza" ? "var(--aza)" : "var(--ink-dim)";
  const sign = e.amt > 0 ? "+" : "";
  return (
    <div className="row between" style={{ padding: "8px 0", borderBottom: "1px solid var(--hair)" }}>
      <div style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 8 }}>
          <span className="chip">{e.type}</span>
          <span style={{ fontSize: 12 }}>{e.actor}</span>
        </div>
        <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 4 }}>{e.memo}</div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div className="mono" style={{ fontSize: 13, fontWeight: 600, color: e.amt === null ? "var(--ink-dim)" : color }}>
          {e.amt === null ? "—" : `${sign}${fmt(e.amt)} ${cur === "cinder" ? "CDR" : cur === "aza" ? "AZA" : ""}`}
        </div>
        <div className="mono" style={{ fontSize: 10, color: "var(--ink-mute)" }}>{e.t}</div>
      </div>
    </div>
  );
}

/* ============================================================
   PAGE: MERCENARIES
   ============================================================ */
// Modal: list yourself as available for hire on the mercenary board.
function ListMyselfModal({ account, onClose }) {
  const [rate, setRate] = useState("");
  const [bio, setBio] = useState("");
  const submit = () => {
    const r = Math.max(0, Math.floor(Number(rate) || 0));
    if (boeMerc("list", { ratePerHour: r, bio: bio })) onClose();
  };
  return (
    <ModalFrame title="List Myself for Hire" onClose={onClose}>
      <div className="small-text" style={{ color: "var(--ink-dim)", marginBottom: 12 }}>
        Post yourself on the Mercenary Operations board. Employers see your handle, optional rate, and bio, and can hire you for a contract. You can withdraw or update your listing at any time.
      </div>
      <div className="stack-sm" style={{ marginBottom: 14 }}>
        <label className="label">Advertised rate (Cinder / hour, optional)</label>
        <input type="number" min="0" step="1" placeholder="0 = no rate set" value={rate}
          onChange={(e) => setRate(e.target.value)}
          style={{ background: "var(--bg-2)", border: "1px solid var(--hair)", color: "var(--ink)", padding: "8px 10px", fontFamily: "JetBrains Mono, monospace" }} />
        <label className="label">Bio (optional)</label>
        <textarea placeholder="What kind of work you take, your strengths…" value={bio} maxLength={280} rows="3"
          onChange={(e) => setBio(e.target.value)}
          style={{ background: "var(--bg-2)", border: "1px solid var(--hair)", color: "var(--ink)", padding: "8px 10px", fontFamily: "inherit", resize: "vertical" }} />
      </div>
      <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={submit}>Publish Listing</button>
      </div>
    </ModalFrame>
  );
}

// Modal: hire a mercenary. Shows 40/52/8 split preview live.
function HireMercModal({ account, listing, onClose }) {
  const split = (account && account.mercSplit) || { merc: 0.40, employer: 0.52, tax: 0.08, perCinder: 5000, maxHours: 24, maxTarget: 5000000 };
  const [hours, setHours] = useState(1);
  const [target, setTarget] = useState(listing && listing.rate_per_hour ? String(listing.rate_per_hour) : "5000");
  const t = Math.max(0, Math.floor(Number(target) || 0));
  const usd = (t / Math.max(1, split.perCinder | 0));
  const mercShare = Math.floor(t * split.merc);
  const empShare = Math.floor(t * split.employer);
  const tax = Math.max(0, t - mercShare - empShare);
  const ok = t > 0 && t <= split.maxTarget && hours > 0 && hours <= split.maxHours;
  const submit = () => { if (!ok) return; if (boeMerc("hire", { listingId: listing.id, hours: hours, target: t })) onClose(); };
  return (
    <ModalFrame title={"Hire " + (listing.label || listing.handle || "Mercenary")} onClose={onClose}>
      <div className="small-text" style={{ color: "var(--ink-dim)", marginBottom: 10 }}>
        <span className="mono" style={{ color: "var(--violet)" }}>{listing.handle}</span>
        {listing.rate_per_hour ? <span> · advertised <span className="mono">{fmt(listing.rate_per_hour)} 🜂/hr</span></span> : null}
        {listing.bio ? <div style={{ marginTop: 4 }}>{listing.bio}</div> : null}
      </div>
      <div className="stack-sm" style={{ marginBottom: 12 }}>
        <label className="label">Contract length (hours, up to {split.maxHours})</label>
        <input type="number" min="1" max={split.maxHours} step="1" value={hours}
          onChange={(e) => setHours(Math.max(1, Math.min(split.maxHours, Math.floor(Number(e.target.value) || 1))))}
          style={{ background: "var(--bg-2)", border: "1px solid var(--hair)", color: "var(--ink)", padding: "8px 10px", fontFamily: "JetBrains Mono, monospace" }} />
        <label className="label">Cinder you want to achieve (target)</label>
        <input type="number" min="1" max={split.maxTarget} step="100" value={target}
          onChange={(e) => setTarget(e.target.value)}
          style={{ background: "var(--bg-2)", border: "1px solid var(--hair)", color: "var(--ink)", padding: "8px 10px", fontFamily: "JetBrains Mono, monospace" }} />
        <div className="small-text" style={{ color: "var(--ink-dim)" }}>≈ <b>${usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b> USD at the canonical peg (1 👑 = {(split.perCinder | 0).toLocaleString()} 🜂)</div>
      </div>
      <div style={{ border: "1px solid var(--hair)", background: "var(--bg-1)", padding: 12, marginBottom: 12 }}>
        <div className="row between" style={{ padding: "3px 0" }}><span className="label">Mercenary earns ({Math.round(split.merc * 100)}%)</span><span className="mono" style={{ color: "var(--cinder)" }}>{fmt(mercShare)} 🜂</span></div>
        <div className="row between" style={{ padding: "3px 0" }}><span className="label">You (Mercenary Operator) earn ({Math.round(split.employer * 100)}%)</span><span className="mono" style={{ color: "var(--good)" }}>{fmt(empShare)} 🜂</span></div>
        <div className="row between" style={{ padding: "3px 0", borderTop: "1px solid var(--hair)", marginTop: 4 }}><span className="label">Foundation Reserve tax ({Math.round(split.tax * 100)}% · 4% each side)</span><span className="mono" style={{ color: "var(--warn)" }}>{fmt(tax)} 🜂</span></div>
      </div>
      <div className="small-text" style={{ color: "var(--ink-dim)", marginBottom: 12 }}>Contract goes pending until the mercenary clocks in. On clock-out the target Cinder is generated and split as above.</div>
      <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={submit} disabled={!ok}>Send Offer</button>
      </div>
    </ModalFrame>
  );
}

// Modal: post a new contract (either as a mercenary offering services, or
// as an employer requesting work). Live 40/52/8 + USD preview.
function PostContractModal({ account, defaultRole, onClose }) {
  const split = (account && account.mercSplit) || { merc: 0.40, employer: 0.52, tax: 0.08, perCinder: 5000, maxHours: 24, maxTarget: 5000000 };
  const [role, setRole] = useState(defaultRole || "merc");
  const [hours, setHours] = useState(1);
  const [target, setTarget] = useState("10000");
  const [desc, setDesc] = useState("");
  const t = Math.max(0, Math.floor(Number(target) || 0));
  const usd = (t / Math.max(1, split.perCinder | 0));
  const mercShare = Math.floor(t * split.merc);
  const empShare = Math.floor(t * split.employer);
  const tax = Math.max(0, t - mercShare - empShare);
  const ok = t > 0 && t <= split.maxTarget && hours > 0 && hours <= split.maxHours;
  const submit = () => { if (!ok) return; if (boePost("create", { role: role, hours: hours, target: t, description: desc })) onClose(); };
  return (
    <ModalFrame title="Post a Contract" onClose={onClose}>
      <div className="small-text" style={{ color: "var(--ink-dim)", marginBottom: 10 }}>
        Choose your side. <b>Mercenary</b> = "I'll do this work for you". <b>Employer</b> = "I need this work done — willing to pay". Either kind shows up on the public Contract Postings board.
      </div>
      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        <button className={"btn sm" + (role === "merc" ? "" : " ghost")} onClick={() => setRole("merc")}>I'm the Mercenary</button>
        <button className={"btn sm" + (role === "employer" ? "" : " ghost")} onClick={() => setRole("employer")}>I'm the Employer</button>
      </div>
      <div className="stack-sm" style={{ marginBottom: 12 }}>
        <label className="label">Contract length (hours, up to {split.maxHours})</label>
        <input type="number" min="1" max={split.maxHours} step="1" value={hours}
          onChange={(e) => setHours(Math.max(1, Math.min(split.maxHours, Math.floor(Number(e.target.value) || 1))))}
          style={{ background: "var(--bg-2)", border: "1px solid var(--hair)", color: "var(--ink)", padding: "8px 10px", fontFamily: "JetBrains Mono, monospace" }} />
        <label className="label">Cinder target</label>
        <input type="number" min="1" max={split.maxTarget} step="100" value={target}
          onChange={(e) => setTarget(e.target.value)}
          style={{ background: "var(--bg-2)", border: "1px solid var(--hair)", color: "var(--ink)", padding: "8px 10px", fontFamily: "JetBrains Mono, monospace" }} />
        <div className="small-text" style={{ color: "var(--ink-dim)" }}>≈ <b>${usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b> USD at the canonical peg</div>
        <label className="label">Description (optional, ≤ 280 chars)</label>
        <textarea value={desc} maxLength={280} rows="3" placeholder="What kind of work, conditions, location…"
          onChange={(e) => setDesc(e.target.value)}
          style={{ background: "var(--bg-2)", border: "1px solid var(--hair)", color: "var(--ink)", padding: "8px 10px", fontFamily: "inherit", resize: "vertical" }} />
      </div>
      <div style={{ border: "1px solid var(--hair)", background: "var(--bg-1)", padding: 12, marginBottom: 12 }}>
        <div className="row between" style={{ padding: "3px 0" }}><span className="label">Mercenary earns ({Math.round(split.merc * 100)}%)</span><span className="mono" style={{ color: "var(--cinder)" }}>{fmt(mercShare)} 🜂</span></div>
        <div className="row between" style={{ padding: "3px 0" }}><span className="label">Employer earns ({Math.round(split.employer * 100)}%)</span><span className="mono" style={{ color: "var(--good)" }}>{fmt(empShare)} 🜂</span></div>
        <div className="row between" style={{ padding: "3px 0" }}><span className="label">Foundation Reserve tax ({Math.round(split.tax * 100)}%)</span><span className="mono" style={{ color: "var(--warn)" }}>{fmt(tax)} 🜂</span></div>
      </div>
      <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={submit} disabled={!ok}>Publish Post</button>
      </div>
    </ModalFrame>
  );
}

function _mercSession(c) {
  // Effective elapsed seconds (active time, excluding paused accum).
  if (!c) return 0;
  const inMs = c.clocked_in_at ? Date.parse(c.clocked_in_at) : 0;
  if (!inMs) return 0;
  let end = c.clocked_out_at ? Date.parse(c.clocked_out_at) : Date.now();
  if (c.status === "paused" && c.paused_at) end = Date.parse(c.paused_at);
  return Math.max(0, Math.floor((end - inMs - (c.pause_ms_accum | 0)) / 1000));
}

function ContractCard({ c, mySide, split }) {
  const me = mySide; // 'merc' | 'employer'
  const totalSec = (c.hours | 0) * 3600;
  const elapsed = _mercSession(c);
  const T = (c.target_cinder | 0);
  const liveCinder = c.status === "active" || c.status === "paused"
    ? Math.min(T, Math.floor(T * Math.min(1, elapsed / Math.max(1, totalSec))))
    : (c.status === "completed" || c.status === "completed_pending_merc" || c.status === "completed_pending_employer" ? T : 0);
  const mercShare = Math.floor(T * (split.merc || 0.40));
  const empShare = Math.floor(T * (split.employer || 0.52));
  const tax = Math.max(0, T - mercShare - empShare);
  const canClockIn = me === "merc" && c.status === "offered";
  const canPauseResume = (c.status === "active" || c.status === "paused");
  const canClockOut = (c.status === "active" || c.status === "paused");
  return (
    <div className="clock-panel" style={{ marginBottom: 14 }}>
      <div className="row between" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 18 }}>
        <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
          <div className="merc-av" style={{ width: 56, height: 56, fontSize: 18, background: "linear-gradient(135deg, #ff7a3d, #8a6bff)" }}>
            {(me === "merc" ? (c.employer_label || c.employer_handle || "EM") : (c.mercenary_label || c.mercenary_handle || "MR")).slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div className="label">{me === "merc" ? "Offer / contract from" : "Contract with"}</div>
            <div className="display" style={{ fontSize: 18, fontWeight: 600 }}>
              {me === "merc" ? (c.employer_label || c.employer_handle) : (c.mercenary_label || c.mercenary_handle)}
            </div>
            <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: "wrap" }}>
              <span className="chip">#{c.id}</span>
              <span className="chip cinder">{Math.round((split.merc || 0.4) * 100)} / {Math.round((split.employer || 0.52) * 100)} split</span>
              <span className="chip">{c.hours}h contract</span>
              <span className={"chip " + (c.status === "active" ? "live" : c.status === "completed" ? "" : "warn")}>
                {c.status === "active" ? <><span className="live-dot"></span>Active</> : c.status.toUpperCase()}
              </span>
            </div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="label">Session · auto clock-out at {String(c.hours).padStart(2, "0")}:00:00</div>
          <div className="clock-time mono">{fmtTime(elapsed)}<span className="ms"> / {String(c.hours).padStart(2, "0")}:00:00</span></div>
          <div className="row" style={{ justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
            {canClockIn && (
              <button className="btn sm primary" onClick={() => boeMerc("clockin", { id: c.id })}>
                <Icon name="play" size={12}/> Clock In
              </button>
            )}
            {canPauseResume && (
              <button className="btn sm" onClick={() => boeMerc("pause", { id: c.id, pause: c.status === "active" })}>
                <Icon name={c.status === "active" ? "pause" : "play"} size={12}/> {c.status === "active" ? "Pause stream" : "Resume"}
              </button>
            )}
            {canClockOut && (
              <button className="btn sm danger" onClick={() => boeMerc("clockout", { id: c.id, forced: me === "employer" })}>
                <Icon name="x" size={12}/> {me === "employer" ? "Force clock-out" : "Clock Out"}
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="bar" style={{ marginTop: 18, marginBottom: 18 }}>
        <div style={{ width: `${Math.min(100, (elapsed / Math.max(1, totalSec)) * 100)}%`, background: "linear-gradient(90deg, var(--violet), var(--cinder))" }}></div>
      </div>
      <div className="grid g-4">
        <SmallStat k="Cinder target" v={fmt(T)} cur="cinder" />
        <SmallStat k="Cinder generated" v={fmt(liveCinder)} cur="cinder" />
        <SmallStat k={"Mercenary earns (" + Math.round((split.merc || 0.4) * 100) + "%)"} v={fmt(mercShare)} cur="cinder" />
        <SmallStat k={"Operator earns (" + Math.round((split.employer || 0.52) * 100) + "%)"} v={fmt(empShare)} cur="cinder" />
        <SmallStat k="Time remaining" v={fmtTime(Math.max(0, totalSec - elapsed))} cur={null} />
        <SmallStat k={"Foundation Reserve tax (" + Math.round((split.tax || 0.08) * 100) + "%)"} v={fmt(tax)} cur="cinder" />
        <SmallStat k="Your role" v={me === "merc" ? "Mercenary" : "Mercenary Operator"} cur={null} />
        <SmallStat k="USD value of target" v={"$" + (T / Math.max(1, split.perCinder | 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} cur={null} />
      </div>
    </div>
  );
}

function PageMercs({ account, role, sessionSec, liveCinder, running, setRunning }) {
  const [tab, setTab] = useState("board");
  const [listOpen, setListOpen] = useState(false);
  const [hireListing, setHireListing] = useState(null);
  const [postOpen, setPostOpen] = useState(false);
  const [postRole, setPostRole] = useState("merc");
  const split = (account && account.mercSplit) || { merc: 0.40, employer: 0.52, tax: 0.08, perCinder: 5000, maxHours: 24, maxTarget: 5000000 };
  const listings = Array.isArray(account && account.mercListings) ? account.mercListings : [];
  const asEmp = Array.isArray(account && account.mercAsEmployer) ? account.mercAsEmployer : [];
  const asMerc = Array.isArray(account && account.mercAsMerc) ? account.mercAsMerc : [];
  const posts = Array.isArray(account && account.mercPosts) ? account.mercPosts : [];
  const myHandle = (account && account.handle || "").toLowerCase();
  const mercPosts = posts.filter(p => p && p.status === "open" && p.poster_role === "merc");
  const empPosts = posts.filter(p => p && p.status === "open" && p.poster_role === "employer");
  const myPosts = posts.filter(p => p && p.poster_handle && p.poster_handle.toLowerCase() === myHandle && p.status === "open");
  const myListing = listings.find(l => l.handle && account && account.handle && l.handle.toLowerCase() === String(account.handle).toLowerCase());
  const board = listings.filter(l => l && l.status === "open" && (!myListing || l.id !== myListing.id));
  const offersMerc = asMerc.filter(c => c.status === "offered" || c.status === "active" || c.status === "paused" || c.status === "completed_pending_merc");
  const contractsEmp = asEmp.filter(c => c.status !== "completed" && c.status !== "cancelled");
  const history = [...asMerc, ...asEmp].filter(c => c.status === "completed" || c.status === "completed_pending_merc" || c.status === "completed_pending_employer" || c.status === "cancelled");
  return (
    <div>
      {listOpen && <ListMyselfModal account={account} onClose={() => setListOpen(false)} />}
      {hireListing && <HireMercModal account={account} listing={hireListing} onClose={() => setHireListing(null)} />}
      {postOpen && <PostContractModal account={account} defaultRole={postRole} onClose={() => setPostOpen(false)} />}
      <div className="page-head">
        <div>
          <div className="page-crumb">Operations / Mercenaries</div>
          <div className="page-title display">Mercenary Operations</div>
        </div>
        <div className="page-actions">
          <button className="btn ghost" onClick={() => { setPostRole("merc"); setPostOpen(true); }}><Icon name="plus" size={14}/> Post a Contract</button>
          {myListing
            ? <button className="btn ghost" onClick={() => boeMerc("unlist")}>Withdraw listing</button>
            : <button className="btn ghost" onClick={() => setListOpen(true)}><Icon name="plus" size={14}/> List myself</button>}
        </div>
      </div>

      {/* Active session(s): show the player's currently active or pending
          contract front-and-center, with Clock In / Pause / Force clock-out
          wired to the real backend. */}
      {(asMerc.find(c => c.status === "active" || c.status === "paused")
        || asEmp.find(c => c.status === "active" || c.status === "paused")
        || asMerc.find(c => c.status === "offered")) && (
        <>
          {asMerc.filter(c => c.status === "active" || c.status === "paused" || c.status === "offered").map(c => (
            <ContractCard key={c.id} c={c} mySide="merc" split={split} />
          ))}
          {asEmp.filter(c => c.status === "active" || c.status === "paused").map(c => (
            <ContractCard key={c.id} c={c} mySide="employer" split={split} />
          ))}
        </>
      )}

      <div className="tabs">
        {[
          { id: "board", label: "Mercenary board · " + board.length },
          { id: "postings", label: "Contract Postings · " + (mercPosts.length + empPosts.length) },
          { id: "offers", label: "My offers · " + offersMerc.length },
          { id: "contracts", label: "My contracts · " + contractsEmp.length },
          { id: "history", label: "History · " + history.length },
        ].map(t => (
          <div key={t.id} className={"tab " + (tab === t.id ? "active" : "")} onClick={() => setTab(t.id)}>{t.label}</div>
        ))}
      </div>

      {tab === "postings" && (
        <div className="stack-sm">
          {myPosts.length > 0 && (
            <div className="panel">
              <div className="panel-h"><h3>My active posts</h3><span className="label">{myPosts.length}</span></div>
              {myPosts.map(p => (
                <div key={p.id} className="row between" style={{ padding: "10px 14px", borderBottom: "1px solid var(--hair)", gap: 8 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="row" style={{ gap: 6, alignItems: "center" }}>
                      <span className={"chip " + (p.poster_role === "merc" ? "violet" : "cinder")}>{p.poster_role === "merc" ? "I'll do work" : "Need work done"}</span>
                      <span className="mono" style={{ fontSize: 11, color: "var(--cinder)" }}>{fmt(p.target_cinder)} 🜂 · {p.hours}h</span>
                    </div>
                    {p.description && <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>{p.description}</div>}
                  </div>
                  <button className="btn sm ghost" onClick={() => boePost("cancel", { id: p.id })}>Cancel</button>
                </div>
              ))}
            </div>
          )}

          <div className="panel">
            <div className="panel-h">
              <h3>Mercenaries offering services · {mercPosts.length}</h3>
              <span className="label">Players willing to do work</span>
            </div>
            {mercPosts.length === 0 ? (
              <div className="panel-b muted" style={{ fontSize: 12 }}>No mercenaries are posting services right now. (none)</div>
            ) : mercPosts.map(p => {
              const mine = p.poster_handle && p.poster_handle.toLowerCase() === myHandle;
              return (
                <div key={p.id} className="row between" style={{ padding: "12px 16px", borderBottom: "1px solid var(--hair)", gap: 8 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="row" style={{ gap: 8, alignItems: "center" }}>
                      <div className="merc-av" style={{ background: "linear-gradient(135deg, #ff7a3d, #8a6bff)", width: 28, height: 28, fontSize: 10 }}>{(p.poster_label || p.poster_handle || "MR").slice(0, 2).toUpperCase()}</div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{p.poster_label || p.poster_handle}</div>
                        <div className="mono" style={{ fontSize: 10, color: "var(--violet)" }}>{p.poster_handle}</div>
                      </div>
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--cinder)", marginTop: 6 }}>{fmt(p.target_cinder)} 🜂 target · {p.hours}h · earn {fmt(Math.floor((p.target_cinder | 0) * split.merc))} 🜂 (40 %) · operator yield {fmt(Math.floor((p.target_cinder | 0) * split.employer))} 🜂 (52 %)</div>
                    {p.description && <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>{p.description}</div>}
                  </div>
                  <button className="btn sm primary" disabled={mine} onClick={() => boePost("accept", { id: p.id })}>{mine ? "(your post)" : "Hire (Accept)"}</button>
                </div>
              );
            })}
          </div>

          <div className="panel">
            <div className="panel-h">
              <h3>Employers posting jobs · {empPosts.length}</h3>
              <span className="label">Players hiring</span>
            </div>
            {empPosts.length === 0 ? (
              <div className="panel-b muted" style={{ fontSize: 12 }}>No open jobs right now. (none)</div>
            ) : empPosts.map(p => {
              const mine = p.poster_handle && p.poster_handle.toLowerCase() === myHandle;
              return (
                <div key={p.id} className="row between" style={{ padding: "12px 16px", borderBottom: "1px solid var(--hair)", gap: 8 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="row" style={{ gap: 8, alignItems: "center" }}>
                      <div className="merc-av" style={{ background: "linear-gradient(135deg, #5ee3ff, #8a6bff)", width: 28, height: 28, fontSize: 10 }}>{(p.poster_label || p.poster_handle || "EM").slice(0, 2).toUpperCase()}</div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{p.poster_label || p.poster_handle}</div>
                        <div className="mono" style={{ fontSize: 10, color: "var(--violet)" }}>{p.poster_handle}</div>
                      </div>
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--cinder)", marginTop: 6 }}>{fmt(p.target_cinder)} 🜂 target · {p.hours}h · you earn {fmt(Math.floor((p.target_cinder | 0) * split.merc))} 🜂 (40 %) as the mercenary</div>
                    {p.description && <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>{p.description}</div>}
                  </div>
                  <button className="btn sm primary" disabled={mine} onClick={() => boePost("accept", { id: p.id })}>{mine ? "(your post)" : "Take Job (Accept)"}</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "board" && (
        <div className="panel">
          {board.length === 0 ? (
            <div className="panel-b muted" style={{ fontSize: 12 }}>No mercenaries listed right now. (none) — be the first: <b>List myself</b>.</div>
          ) : (
            <table className="t">
              <thead>
                <tr><th>Mercenary</th><th>Advertised rate</th><th>Bio</th><th>Listed</th><th></th></tr>
              </thead>
              <tbody>
                {board.map(l => (
                  <tr key={l.id}>
                    <td>
                      <div className="row" style={{ gap: 10 }}>
                        <div className="merc-av" style={{ background: "linear-gradient(135deg, #ff7a3d, #8a6bff)", width: 32, height: 32, fontSize: 11 }}>
                          {(l.label || l.handle || "MR").slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600 }}>{l.label || l.handle}</div>
                          <div className="mono" style={{ fontSize: 10, color: "var(--violet)" }}>{l.handle}</div>
                        </div>
                      </div>
                    </td>
                    <td className="mono">{l.rate_per_hour ? fmt(l.rate_per_hour) + " 🜂/hr" : "—"}</td>
                    <td className="dim" style={{ maxWidth: 360 }}>{l.bio || ""}</td>
                    <td className="mono dim">{l.updated_at ? new Date(l.updated_at).toLocaleDateString() : ""}</td>
                    <td><button className="btn sm primary" onClick={() => setHireListing(l)}><Icon name="plus" size={12}/> Hire</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "offers" && (
        <div className="panel">
          {offersMerc.length === 0 ? (
            <div className="panel-b muted" style={{ fontSize: 12 }}>No employers have hired you yet. (none) — list yourself on the board to receive offers.</div>
          ) : offersMerc.map(c => (
            <div key={c.id} className="row between" style={{ padding: "12px 16px", borderBottom: "1px solid var(--hair)", gap: 8 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>From <span className="mono" style={{ color: "var(--violet)" }}>{c.employer_handle}</span></div>
                <div className="mono" style={{ fontSize: 11, color: "var(--cinder)", marginTop: 2 }}>{fmt(c.target_cinder)} 🜂 target · {c.hours}h · earn {fmt(Math.floor((c.target_cinder | 0) * split.merc))} 🜂 (40%)</div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <span className="chip">{c.status.toUpperCase()}</span>
                {c.status === "offered" && <button className="btn sm primary" onClick={() => boeMerc("clockin", { id: c.id })}>Clock In</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "contracts" && (
        <div className="panel">
          {contractsEmp.length === 0 ? (
            <div className="panel-b muted" style={{ fontSize: 12 }}>No active contracts. (none) — <b>Hire</b> a mercenary from the board.</div>
          ) : contractsEmp.map(c => (
            <div key={c.id} className="row between" style={{ padding: "12px 16px", borderBottom: "1px solid var(--hair)", gap: 8 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Hired <span className="mono" style={{ color: "var(--violet)" }}>{c.mercenary_handle}</span></div>
                <div className="mono" style={{ fontSize: 11, color: "var(--cinder)", marginTop: 2 }}>{fmt(c.target_cinder)} 🜂 target · {c.hours}h · yield {fmt(Math.floor((c.target_cinder | 0) * split.employer))} 🜂 (52%)</div>
              </div>
              <span className="chip">{c.status.toUpperCase()}</span>
            </div>
          ))}
        </div>
      )}

      {tab === "history" && (
        <div className="panel">
          {history.length === 0 ? (
            <div className="panel-b muted" style={{ fontSize: 12 }}>No completed contracts yet. (none)</div>
          ) : (
            <table className="t">
              <thead><tr><th>#</th><th>Role</th><th>Counterparty</th><th>Target</th><th>Your share</th><th>Status</th></tr></thead>
              <tbody>
                {history.map(c => {
                  const isMerc = account && account.handle && c.mercenary_handle && c.mercenary_handle.toLowerCase() === String(account.handle).toLowerCase();
                  const share = isMerc ? (c.merc_payout | 0) : (c.employer_payout | 0);
                  return (
                    <tr key={c.id}>
                      <td className="mono">{c.id}</td>
                      <td>{isMerc ? "Mercenary" : "Operator"}</td>
                      <td className="mono dim">{isMerc ? c.employer_handle : c.mercenary_handle}</td>
                      <td className="mono">{fmt(c.target_cinder)}</td>
                      <td className="mono" style={{ color: "var(--good)" }}>{fmt(share)}</td>
                      <td><span className="chip">{c.status.toUpperCase()}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function SmallStat({ k, v, sub, cur }) {
  const color = cur === "cinder" ? "var(--cinder)" : cur === "aza" ? "var(--aza)" : "var(--ink)";
  return (
    <div style={{ border: "1px solid var(--hair)", padding: 12, background: "rgba(255,255,255,0.015)" }}>
      <div className="label">{k}</div>
      <div className="display row" style={{ gap: 6, alignItems: "baseline", fontSize: 18, fontWeight: 600, marginTop: 4, color }}>
        {cur === "cinder" && <CinderGlyph size={14} />}
        {cur === "aza" && <AzaGlyph size={14} />}
        {v}
      </div>
      {sub && <div className="mono" style={{ fontSize: 10, color: "var(--ink-mute)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

/* ============================================================
   PAGE: CONTRACTS — clock-in + recent
   ============================================================ */
function PageContracts() {
  const [split, setSplit] = useState(60);
  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-crumb">Operations / Contracts</div>
          <div className="page-title display">New Mercenary Contract</div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1.2fr 1fr", gap: 14 }}>
        <div className="panel">
          <div className="panel-h"><h3>Draft Contract</h3><span className="label">Contract #C-205</span></div>
          <div className="panel-b stack-lg">
            <div className="grid g-2">
              <div className="field"><label>Mercenary</label><select defaultValue="Sable Q."><option>Sable Q.</option><option>Tor Linn</option><option>Kova Yi</option></select></div>
              <div className="field"><label>Operation division</label><select><option>Camp Heights Recovery Division</option><option>Iron Cabal Operations</option></select></div>
            </div>
            <div className="grid g-2">
              <div className="field"><label>Permitted activities</label>
                <select multiple style={{ height: 110 }} defaultValue={["ranked","rogue","resource"]}>
                  <option value="ranked">Ranked Battle Ops</option>
                  <option value="rogue">Roguelite Runs</option>
                  <option value="resource">Resource Expeditions</option>
                  <option value="dungeon">Dungeon Runs</option>
                  <option value="loot">Loot Operations</option>
                  <option value="defense">Base Defense</option>
                  <option value="card">Card Hunts</option>
                </select>
              </div>
              <div className="stack">
                <div className="field">
                  <label>Cinder split — Mercenary cut: <span className="mono" style={{ color: "var(--cinder)" }}>{split}%</span> · Employer: <span className="mono" style={{ color: "var(--violet)" }}>{100-split}%</span></label>
                  <input type="range" min="40" max="80" value={split} onChange={(e) => setSplit(+e.target.value)} />
                </div>
                <div className="field"><label>Max session length</label><select defaultValue="8"><option value="2">2 hours</option><option value="4">4 hours</option><option value="8">8 hours (max)</option></select></div>
                <div className="field"><label>Resource & loot routing</label><select><option>All to Employer Vault</option><option>50/50 split</option><option>Mercenary keeps loot</option></select></div>
              </div>
            </div>
            <div className="field"><label>Contract notes</label><textarea rows="3" defaultValue="Focus ranked PvP and roguelite progression. No raid participation without sign-off."></textarea></div>
            <div className="row between" style={{ paddingTop: 8, borderTop: "1px solid var(--hair)" }}>
              <div className="dim" style={{ fontSize: 12 }}>Auto clock-out enforced at 8h · work report generated automatically</div>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn">Save draft</button>
                <button className="btn primary"><Icon name="check" size={14} /> Issue & request clock-in</button>
              </div>
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="panel">
            <div className="panel-h"><h3>Estimated payout</h3><span className="label">8h projection</span></div>
            <div className="panel-b stack-sm">
              <ProjectionRow label="Cinder generated (proj.)" v="180,000" cur="cinder" />
              <ProjectionRow label={`Mercenary · ${split}%`} v={fmt(180_000 * split/100)} cur="cinder" />
              <ProjectionRow label={`Employer · ${100-split}%`} v={fmt(180_000 * (100-split)/100)} cur="cinder" />
              <ProjectionRow label="Loot to vault (est.)" v="22,400" cur="aza" />
              <div className="row between" style={{ paddingTop: 12, borderTop: "1px solid var(--hair)" }}>
                <span className="label">Net to employer</span>
                <span className="display" style={{ fontSize: 22, fontWeight: 600 }}>{fmt(180_000 * (100-split)/100 + 22_400 * 4.67)}<span className="muted" style={{ fontSize: 13 }}> CDR eq</span></span>
              </div>
            </div>
          </div>
          <div className="panel">
            <div className="panel-h"><h3>Recent contracts</h3></div>
            <div>
              {[
                { id: "C-204A", merc: "Vash Korr",  task: "Ranked Battle Ops",  status: "live", t: "3h 12m" },
                { id: "C-204B", merc: "Iyla Sten",  task: "Resource Expedition", status: "live", t: "2h 24m" },
                { id: "C-203F", merc: "Auro Mid",   task: "Loot Operation",      status: "warn", t: "7h 39m" },
                { id: "C-203A", merc: "Renn Vol",   task: "Roguelite Run #7",    status: "live", t: "5h 24m" },
                { id: "C-201Z", merc: "Brimm",      task: "Card Hunt",           status: "done", t: "8h · paid" },
              ].map(c => (
                <div key={c.id} className="row between" style={{ padding: "10px 16px", borderBottom: "1px solid var(--hair)" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{c.merc} · <span className="muted">{c.task}</span></div>
                    <div className="label" style={{ marginTop: 2 }}>{c.id}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span className={`chip ${c.status === "warn" ? "warn" : c.status === "done" ? "" : "live"}`}>
                      {c.status === "warn" ? <><span className="dot" style={{ background: "var(--warn)" }}></span>Near limit</>
                        : c.status === "done" ? <><span className="dot" style={{ background: "var(--ink-mute)" }}></span>Completed</>
                        : <><span className="live-dot"></span>Live</>}
                    </span>
                    <div className="mono" style={{ fontSize: 11, marginTop: 4, color: "var(--ink-mute)" }}>{c.t}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProjectionRow({ label, v, cur }) {
  const color = cur === "cinder" ? "var(--cinder)" : "var(--aza)";
  return (
    <div className="row between" style={{ padding: "6px 0" }}>
      <span className="dim" style={{ fontSize: 12 }}>{label}</span>
      <span className="row" style={{ gap: 6 }}>
        {cur === "cinder" ? <CinderGlyph size={12} /> : <AzaGlyph size={12} />}
        <span className="mono" style={{ fontSize: 14, fontWeight: 600, color }}>{v}</span>
      </span>
    </div>
  );
}

/* ============================================================
   PAGE: OPS VAULT — resources, cards, relics
   ============================================================ */
function OpsResCard({ meta, banked, inWallet, canBank }) {
  const [amt, setAmt] = useState("");
  const n = Math.max(0, Math.floor(Number(amt) || 0));
  const tone = meta.color || "var(--violet)";
  const total = banked + inWallet;
  const act = (op) => {
    const max = op === "deposit" ? inWallet : banked;
    if (!(n > 0)) return;
    if (n > max) { setAmt(String(max)); return; }
    if (boeTx(op, "res", n, meta.id)) setAmt("");
  };
  return (
    <div className="panel" style={{ padding: 16 }}>
      <div className="row" style={{ gap: 12 }}>
        <div style={{ width: 56, height: 56, background: `linear-gradient(135deg, ${tone}, transparent)`, border: "1px solid var(--hair)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>
          <span>{meta.icon || "📦"}</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{meta.name}</div>
          <div className="row" style={{ gap: 8, marginTop: 4 }}>
            <span className="mono" style={{ fontSize: 20, fontWeight: 600 }}>{fmt(banked)}</span>
            <span className="label">in bank</span>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="label">In wallet</div>
          <div className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{fmt(inWallet)}</div>
        </div>
      </div>
      <div className="bar" style={{ marginTop: 14 }}>
        <div style={{ width: `${total > 0 ? Math.round((banked / total) * 100) : 0}%`, background: tone }}></div>
      </div>
      <div className="row" style={{ gap: 6, marginTop: 12, flexWrap: "wrap" }}>
        <input
          className="mono" type="number" min="1" step="1" placeholder="amount"
          value={amt} onChange={(e) => setAmt(e.target.value)}
          style={{ flex: "1 1 80px", minWidth: 70, background: "var(--bg-2)", border: "1px solid var(--hair)", color: "var(--ink)", padding: "7px 9px", fontSize: 13 }}
        />
        <button className="btn sm" disabled={!canBank || inWallet <= 0} onClick={() => act("deposit")} title="Move from wallet into the bank">Deposit</button>
        <button className="btn sm ghost" disabled={!canBank || banked <= 0} onClick={() => act("withdraw")} title="Move from the bank to your wallet">Withdraw</button>
      </div>
    </div>
  );
}

function PageOpsVault({ account }) {
  const vault = (account && account.vault) || null;
  const cat = (vault && vault.resCatalog) || [];
  const wRes = (vault && vault.walletRes) || {};
  const bRes = (vault && vault.bankRes) || {};
  const canBank = !!(vault && vault.bankReady && vault.extCols);

  const bankedTotal = Object.keys(bRes).reduce((s, k) => s + (bRes[k] | 0), 0);
  const walletTotal = cat.reduce((s, r) => s + (wRes[r.id] | 0), 0);
  const bankedTypes = cat.filter(r => (bRes[r.id] | 0) > 0).length;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-crumb">Operations / Ops Vault</div>
          <div className="page-title display">Operation Vault — Camp Heights</div>
        </div>
        <div className="page-actions">
          <span className="chip"><span className="dot" style={{ background: canBank ? "var(--good)" : "var(--warn)" }}></span>{canBank ? "Vault online" : "Banking offline"}</span>
        </div>
      </div>

      <div className="grid g-4" style={{ marginBottom: 14 }}>
        <Metric k="Resources in bank" v={`${fmt(bankedTotal)} units`} sub={`${bankedTypes} of ${cat.length} types`} />
        <Metric k="Resources in wallet" v={`${fmt(walletTotal)} units`} sub="loose salvage" />
        <Metric k="Cinder in bank" v={fmt(account ? account.cinder : 0)} sub="🔥 CDR" />
        <Metric k="Aza in bank" v={fmt(account ? account.aza : 0)} sub="👑 AZA" />
      </div>

      {!vault && (
        <div className="panel" style={{ padding: 22, textAlign: "center", color: "var(--ink-dim)" }}>Syncing resource ledger…</div>
      )}
      {vault && !canBank && (
        <div className="panel" style={{ padding: "12px 16px", marginBottom: 14, color: "var(--warn)", fontSize: 12.5 }}>
          Resource &amp; Aza banking needs the latest <span className="mono">api.sql</span> upgrade. Your live quantities are shown below; deposits unlock once the operator runs it.
        </div>
      )}

      {vault && (
        <div className="grid g-3">
          {cat.map(r => (
            <OpsResCard
              key={r.id}
              meta={r}
              banked={bRes[r.id] | 0}
              inWallet={wRes[r.id] | 0}
              canBank={canBank}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   PAGE: MARKETPLACE
   ============================================================ */
// Modal: post a new marketplace listing (4 kinds + optional auction).
function NewListingModal({ account, defaultAuction, onClose }) {
  // Real owned cards (id + name + icon + count) from the parent seed,
  // and the real salvage ledger for resource listings.
  const cards = Array.isArray(account && account.cards) ? account.cards : [];
  const vault = (account && account.vault) || {};
  const cat = vault.resCatalog || [];
  const walletRes = vault.walletRes || {};
  const [kind, setKind] = useState("card");
  const [itemId, setItemId] = useState("");
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("1000");
  const [currency, setCurrency] = useState("cinder");
  const [isAuction, setAuction] = useState(!!defaultAuction);
  const [hours, setHours] = useState(24);
  const n = Math.max(1, Math.floor(Number(qty) || 1));
  const p = Math.max(1, Math.floor(Number(price) || 0));
  const ok = (kind === "card" ? !!itemId : kind === "resource" ? !!itemId : !!name.trim()) && n > 0 && p > 0;
  const submit = () => {
    if (!ok) return;
    if (boeMkt("list", { kind: kind, itemId: itemId, name: name, qty: n, price: p, currency: currency, isAuction: isAuction, hours: hours })) onClose();
  };
  return (
    <ModalFrame title={isAuction ? "Create Auction" : "List Item for Sale"} onClose={onClose}>
      <div className="row" style={{ gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {["card", "item", "resource", "relic"].map(k => (
          <button key={k} className={"btn sm" + (kind === k ? "" : " ghost")} onClick={() => { setKind(k); setItemId(""); setName(""); }}>{k.charAt(0).toUpperCase() + k.slice(1)}</button>
        ))}
      </div>
      <div className="stack-sm" style={{ marginBottom: 12 }}>
        {kind === "card" && (
          <>
            <label className="label">Pick a card you own</label>
            <select value={itemId} onChange={(e) => setItemId(e.target.value)} style={{ background: "var(--bg-2)", border: "1px solid var(--hair)", color: "var(--ink)", padding: "8px 10px" }}>
              <option value="">— select —</option>
              {cards.map(c => (
                <option key={c.id} value={c.id}>{c.icon ? c.icon + " " : ""}{c.name} (×{c.count}{c.rarity ? " · " + c.rarity : ""})</option>
              ))}
            </select>
            {cards.length === 0 && <div className="small-text" style={{ color: "var(--warn)" }}>You don't own any cards yet.</div>}
          </>
        )}
        {kind === "resource" && (
          <>
            <label className="label">Pick a resource you own</label>
            <select value={itemId} onChange={(e) => setItemId(e.target.value)} style={{ background: "var(--bg-2)", border: "1px solid var(--hair)", color: "var(--ink)", padding: "8px 10px" }}>
              <option value="">— select —</option>
              {cat.filter(r => (walletRes[r.id] | 0) > 0).map(r => (
                <option key={r.id} value={r.id}>{r.icon} {r.name} (×{walletRes[r.id]})</option>
              ))}
            </select>
          </>
        )}
        {(kind === "item" || kind === "relic") && (
          <>
            <label className="label">{kind === "item" ? "Item" : "Relic"} name</label>
            <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={kind === "item" ? "e.g. Steel Plating Bundle" : "e.g. Pyrelord Relic"}
              style={{ background: "var(--bg-2)", border: "1px solid var(--hair)", color: "var(--ink)", padding: "8px 10px" }} />
            <div className="small-text" style={{ color: "var(--ink-dim)" }}>Items / relics are name-only listings (no inventory enforcement in this build).</div>
          </>
        )}
        <label className="label">Quantity</label>
        <input type="number" min="1" step="1" value={qty} onChange={(e) => setQty(e.target.value)}
          style={{ background: "var(--bg-2)", border: "1px solid var(--hair)", color: "var(--ink)", padding: "8px 10px", fontFamily: "JetBrains Mono, monospace" }} />
        <label className="label">{isAuction ? "Starting bid" : "Price"}</label>
        <div className="row" style={{ gap: 6 }}>
          <input type="number" min="1" step="1" value={price} onChange={(e) => setPrice(e.target.value)}
            style={{ flex: 1, background: "var(--bg-2)", border: "1px solid var(--hair)", color: "var(--ink)", padding: "8px 10px", fontFamily: "JetBrains Mono, monospace" }} />
          <button className={"btn sm" + (currency === "cinder" ? "" : " ghost")} onClick={() => setCurrency("cinder")}><CinderGlyph size={12}/> CDR</button>
          <button className={"btn sm" + (currency === "aza" ? "" : " ghost")} onClick={() => setCurrency("aza")}><AzaGlyph size={12}/> AZA</button>
        </div>
        <label className="row" style={{ gap: 8, cursor: "pointer", marginTop: 6 }}>
          <input type="checkbox" checked={isAuction} onChange={(e) => setAuction(e.target.checked)} />
          <span className="small-text">Auction (highest bid wins)</span>
        </label>
        {isAuction && (
          <>
            <label className="label">Duration (hours, up to 168)</label>
            <input type="number" min="1" max="168" step="1" value={hours} onChange={(e) => setHours(Math.max(1, Math.min(168, Math.floor(Number(e.target.value) || 1))))}
              style={{ background: "var(--bg-2)", border: "1px solid var(--hair)", color: "var(--ink)", padding: "8px 10px", fontFamily: "JetBrains Mono, monospace" }} />
          </>
        )}
      </div>
      <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={submit} disabled={!ok}>{isAuction ? "Start Auction" : "List for Sale"}</button>
      </div>
    </ModalFrame>
  );
}

function MarketCard({ l, mine, myHandle, onBuy, onBid, onCancel }) {
  const isAuction = !!l.is_auction;
  const cur = l.currency === "aza" ? "AZA" : "CDR";
  const Glyph = l.currency === "aza" ? AzaGlyph : CinderGlyph;
  const price = Math.floor(Number(l.is_auction ? (l.current_bid || l.price) : l.price) || 0);
  const tagColor = l.kind === "card" ? "var(--violet)" : l.kind === "resource" ? "var(--aza)" : l.kind === "relic" ? "var(--warn)" : "var(--ink-dim)";
  const [bid, setBid] = useState("");
  const isMine = mine || (l.seller_handle && myHandle && l.seller_handle.toLowerCase() === myHandle);
  return (
    <div className={"listing"}>
      <div className="img" style={{ position: "relative" }}>
        <span className="rarity-tag" style={{ color: tagColor }}>{l.kind.toUpperCase()}{isAuction ? " · AUCTION" : ""}</span>
        <div style={{ fontSize: 48 }}>{l.item_icon || (l.kind === "card" ? "🃏" : l.kind === "resource" ? "📦" : l.kind === "relic" ? "🏺" : "🎁")}</div>
      </div>
      <div className="body">
        <div className="name">{l.item_name}</div>
        <div className="meta">
          <span>by <span className="mono" style={{ color: "var(--violet)" }}>{l.seller_handle}</span></span>
          <span>×{l.qty}</span>
        </div>
        {isAuction && (
          <div className="small-text" style={{ marginTop: 4, color: "var(--ink-dim)" }}>
            {l.current_bid ? <>Top bid: <b>{fmt(l.current_bid)}</b> by <span className="mono">{l.current_bidder_handle}</span></> : <>Starting bid: <b>{fmt(l.price)}</b></>}
            {l.ends_at ? <> · ends {new Date(l.ends_at).toLocaleString()}</> : null}
          </div>
        )}
      </div>
      <div className="price" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
        <span className="amt row" style={{ gap: 6, color: l.currency === "cinder" ? "var(--cinder)" : "var(--aza)" }}>
          <Glyph size={14}/> {fmt(price)}
        </span>
        {isMine ? (
          <button className="btn sm ghost" onClick={() => onCancel(l.id)}>Cancel</button>
        ) : isAuction ? (
          <div className="row" style={{ gap: 4 }}>
            <input type="number" min="1" step="1" placeholder="bid"
              value={bid} onChange={(e) => setBid(e.target.value)}
              style={{ flex: 1, background: "var(--bg-2)", border: "1px solid var(--hair)", color: "var(--ink)", padding: "5px 8px", fontFamily: "JetBrains Mono, monospace", fontSize: 12 }} />
            <button className={"btn sm " + (l.currency === "cinder" ? "cinder" : "aza")} onClick={() => { const n = Math.floor(Number(bid) || 0); if (n > 0) { onBid(l.id, n); setBid(""); } }}>Bid</button>
          </div>
        ) : (
          <button className={"btn sm " + (l.currency === "cinder" ? "cinder" : "aza")} onClick={() => onBuy(l.id)}>Buy now</button>
        )}
      </div>
    </div>
  );
}

function PageMarket({ account }) {
  const [tab, setTab] = useState("all");
  const [filter, setFilter] = useState("all");
  const [newOpen, setNewOpen] = useState(false);
  const [auctionMode, setAuctionMode] = useState(false);
  const market = Array.isArray(account && account.market) ? account.market : [];
  const mine = Array.isArray(account && account.marketMine) ? account.marketMine : [];
  const myHandle = (account && account.handle || "").toLowerCase();
  const active = market.filter(l => l.status === "active");
  const byKind = (kind) => filter === "all" || filter === "auctions" ? (filter === "auctions" ? active.filter(l => l.is_auction) : active) : active.filter(l => l.kind === filter);
  const list = byKind(filter);
  const mineActive = mine.filter(l => l.status === "active");
  const mineHistory = mine.filter(l => l.status !== "active");
  return (
    <div>
      {newOpen && <NewListingModal account={account} defaultAuction={auctionMode} onClose={() => setNewOpen(false)} />}
      <div className="page-head">
        <div>
          <div className="page-crumb">Economy / Marketplace</div>
          <div className="page-title display">Bank of Ethos Marketplace</div>
        </div>
        <div className="page-actions">
          <button className="btn ghost" onClick={() => setTab("mine")}><Icon name="eye" size={14}/> My listings · {mineActive.length}</button>
          <button className="btn" onClick={() => { setAuctionMode(true); setNewOpen(true); }}><Icon name="bolt" size={14}/> Create auction</button>
          <button className="btn primary" onClick={() => { setAuctionMode(false); setNewOpen(true); }}><Icon name="plus" size={14}/> List item</button>
        </div>
      </div>

      <div className="tabs">
        {[
          { id: "all", label: "Browse · " + active.length },
          { id: "mine", label: "My Listings · " + mineActive.length },
          { id: "history", label: "History · " + mineHistory.length },
        ].map(t => (
          <div key={t.id} className={"tab " + (tab === t.id ? "active" : "")} onClick={() => setTab(t.id)}>{t.label}</div>
        ))}
      </div>

      {tab === "all" && (
        <>
          <div className="row" style={{ marginBottom: 14, gap: 8, flexWrap: "wrap" }}>
            {[
              { id: "all", label: "All" },
              { id: "card", label: "Cards" },
              { id: "item", label: "Items" },
              { id: "resource", label: "Resources" },
              { id: "relic", label: "Relics" },
              { id: "auctions", label: "Auctions" },
            ].map(f => (
              <button key={f.id} className={"btn sm" + (filter === f.id ? "" : " ghost")} onClick={() => setFilter(f.id)}>{f.label}</button>
            ))}
          </div>

          {list.length === 0 ? (
            <div className="panel" style={{ padding: 22, textAlign: "center", color: "var(--ink-dim)" }}>No active listings. <span style={{ color: "var(--ink-mute)" }}>(none)</span></div>
          ) : (
            <div className="grid g-4">
              {list.map(l => (
                <MarketCard key={l.id} l={l} myHandle={myHandle}
                  onBuy={(id) => boeMkt("buy", { id: id })}
                  onBid={(id, b) => boeMkt("bid", { id: id, bid: b })}
                  onCancel={(id) => boeMkt("cancel", { id: id })} />
              ))}
            </div>
          )}
        </>
      )}

      {tab === "mine" && (
        <div className="panel">
          {mineActive.length === 0 ? (
            <div className="panel-b muted" style={{ fontSize: 12 }}>You have no active listings. (none) — use <b>List item</b> or <b>Create auction</b>.</div>
          ) : (
            <table className="t">
              <thead><tr><th>Kind</th><th>Item</th><th>Qty</th><th>Price / Top bid</th><th>Type</th><th></th></tr></thead>
              <tbody>
                {mineActive.map(l => (
                  <tr key={l.id}>
                    <td><span className="chip">{l.kind.toUpperCase()}</span></td>
                    <td>{l.item_icon ? <span>{l.item_icon} </span> : null}{l.item_name}</td>
                    <td className="mono">{fmt(l.qty)}</td>
                    <td className="mono" style={{ color: l.currency === "cinder" ? "var(--cinder)" : "var(--aza)" }}>{fmt(l.is_auction ? (l.current_bid || l.price) : l.price)} {l.currency === "cinder" ? "🜂" : "👑"}</td>
                    <td>{l.is_auction ? <span className="chip violet">Auction</span> : <span className="chip">Buy-now</span>}</td>
                    <td><button className="btn sm ghost" onClick={() => boeMkt("cancel", { id: l.id })}>Cancel</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "history" && (
        <div className="panel">
          {mineHistory.length === 0 ? (
            <div className="panel-b muted" style={{ fontSize: 12 }}>No completed listings yet. (none)</div>
          ) : (
            <table className="t">
              <thead><tr><th>Kind</th><th>Item</th><th>Qty</th><th>Price</th><th>Status</th><th>Counterparty</th></tr></thead>
              <tbody>
                {mineHistory.map(l => (
                  <tr key={l.id}>
                    <td><span className="chip">{l.kind.toUpperCase()}</span></td>
                    <td>{l.item_icon ? <span>{l.item_icon} </span> : null}{l.item_name}</td>
                    <td className="mono">{fmt(l.qty)}</td>
                    <td className="mono" style={{ color: l.currency === "cinder" ? "var(--cinder)" : "var(--aza)" }}>{fmt(l.price)}</td>
                    <td><span className="chip">{l.status.toUpperCase()}</span></td>
                    <td className="mono dim">{l.buyer_handle || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   PAGE: LOANS
   ============================================================ */
// Modal: apply for a hero-collateralized loan. Validates against the
// player's hero-derived capacity before posting boe:loan 'apply'.
function ApplyLoanModal({ account, onClose }) {
  const cap = (account && account.loanCap) || { aza: 0, max: 20, perLv: 5, heroLv: 0, perCinder: 5000 };
  const [aza, setAza] = useState(cap.aza > 0 ? String(Math.min(cap.aza, 5)) : "");
  const [inst, setInst] = useState(4);
  const [accept, setAccept] = useState(false);
  const n = Math.max(0, Math.floor(Number(aza) || 0));
  const cinder = n * (cap.perCinder | 0);
  const per = inst > 0 ? Math.ceil(cinder / inst) : 0;
  const finalDate = new Date(Date.now() + inst * 7 * 86400000);
  const ok = n > 0 && n <= cap.aza && inst > 0 && accept;
  const submit = () => { if (!ok) return; if (boeLoan("apply", { aza: n, installments: inst })) onClose(); };
  return (
    <ModalFrame title="Apply for Loan" onClose={onClose}>
      <div className="small-text" style={{ color: "var(--ink-dim)", marginBottom: 10 }}>
        Hero collateral: <b>{cap.heroLv.toLocaleString()}</b> total hero levels grant up to <b>{cap.aza} 👑</b> (1 Aza per {cap.perLv} levels · max {cap.max}).
        Principal is credited to your bank as Cinder at <b>1 👑 = {(cap.perCinder | 0).toLocaleString()} 🔥</b>. Repaid in Cinder on a weekly schedule.
      </div>
      <div className="stack-sm" style={{ marginBottom: 12 }}>
        <label className="label">Loan amount (Aza)</label>
        <div className="row" style={{ gap: 8 }}>
          <input type="number" min="1" max={cap.aza} step="1" value={aza}
            onChange={(e) => setAza(e.target.value)}
            style={{ flex: 1, background: "var(--bg-2)", border: "1px solid var(--hair)", color: "var(--ink)", padding: "8px 10px", fontFamily: "JetBrains Mono, monospace" }} />
          <button className="btn sm ghost" disabled={!cap.aza} onClick={() => setAza(String(cap.aza))}>Max ({cap.aza})</button>
        </div>
      </div>
      <div className="stack-sm" style={{ marginBottom: 14 }}>
        <label className="label">Repayment installments (weekly)</label>
        <div className="row" style={{ gap: 6 }}>
          {[2, 4, 8, 12].map(v => (
            <button key={v} className={"btn sm" + (inst === v ? "" : " ghost")} onClick={() => setInst(v)}>{v} × wk</button>
          ))}
        </div>
      </div>
      <div style={{ border: "1px solid var(--hair)", background: "var(--bg-1)", padding: 12, marginBottom: 12 }}>
        <div className="row between" style={{ padding: "3px 0" }}><span className="label">Principal credited to bank</span><span className="mono">{fmt(cinder)} 🜂 ({n} 👑)</span></div>
        <div className="row between" style={{ padding: "3px 0" }}><span className="label">Per installment</span><span className="mono">{fmt(per)} 🜂 / week</span></div>
        <div className="row between" style={{ padding: "3px 0" }}><span className="label">Final payment due</span><span className="mono">{cinder > 0 ? finalDate.toLocaleDateString() : "—"}</span></div>
        <div className="row between" style={{ padding: "3px 0" }}><span className="label">Total repaid</span><span className="mono">{fmt(cinder)} 🜂 (no interest)</span></div>
      </div>
      <label className="row" style={{ gap: 8, marginBottom: 14, cursor: "pointer" }}>
        <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
        <span className="small-text" style={{ color: "var(--ink-dim)" }}>I accept the repayment schedule. The bank may garnish my Cinder if the loan defaults.</span>
      </label>
      <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={submit} disabled={!ok}>Apply</button>
      </div>
    </ModalFrame>
  );
}

function LoanRow({ loan }) {
  const owed = Math.max(0, (loan.cinder_owed | 0) - (loan.cinder_paid | 0));
  const per = Math.ceil((loan.cinder_owed | 0) / Math.max(1, loan.installments | 0));
  const paidCount = Math.min(loan.installments | 0, Math.floor((loan.cinder_paid | 0) / Math.max(1, per)));
  const startMs = loan.started_at ? Date.parse(loan.started_at) : Date.now();
  const periodMs = (loan.period_days | 0 || 7) * 86400000;
  const schedule = [];
  for (let i = 0; i < (loan.installments | 0); i++) {
    const dueAmt = (i === (loan.installments | 0) - 1) ? Math.max(0, (loan.cinder_owed | 0) - per * ((loan.installments | 0) - 1)) : per;
    schedule.push({ i: i + 1, due: new Date(startMs + (i + 1) * periodMs), amt: dueAmt, paid: i < paidCount });
  }
  const active = loan.status === "active";
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div className="panel-h">
        <h3>Loan #{loan.id} · <span className="mono" style={{ color: "var(--aza)" }}>{fmt(loan.aza_amount)} 👑</span></h3>
        {active
          ? <span className="chip live"><span className="live-dot"></span>Active</span>
          : <span className="chip"><span className="dot" style={{ background: "var(--ink-mute)" }}></span>{(loan.status || "closed").toUpperCase()}</span>}
      </div>
      <div className="panel-b">
        <div className="grid g-4" style={{ marginBottom: 10 }}>
          <div><div className="label">Principal</div><div className="mono" style={{ color: "var(--cinder)" }}>{fmt(loan.cinder_owed)} 🜂</div></div>
          <div><div className="label">Paid</div><div className="mono">{fmt(loan.cinder_paid)} 🜂</div></div>
          <div><div className="label">Remaining</div><div className="mono" style={{ color: owed > 0 ? "var(--warn)" : "var(--good)" }}>{fmt(owed)} 🜂</div></div>
          <div><div className="label">Per installment</div><div className="mono">{fmt(per)} 🜂 / week</div></div>
        </div>
        <div className="bar" style={{ marginBottom: 12 }}>
          <div style={{ width: `${Math.min(100, ((loan.cinder_paid | 0) / Math.max(1, loan.cinder_owed | 0)) * 100)}%`, background: "linear-gradient(90deg, var(--violet), var(--cinder))" }}></div>
        </div>
        <div className="label" style={{ marginBottom: 6 }}>Repayment schedule</div>
        <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--hair)" }}>
          <table className="t" style={{ width: "100%" }}>
            <thead><tr><th style={{ width: 40 }}>#</th><th>Due</th><th style={{ textAlign: "right" }}>Amount</th><th style={{ width: 90 }}>Status</th></tr></thead>
            <tbody>
              {schedule.map(s => (
                <tr key={s.i}>
                  <td className="mono dim">{s.i}</td>
                  <td className="mono">{s.due.toLocaleDateString()}</td>
                  <td className="mono" style={{ textAlign: "right" }}>{fmt(s.amt)} 🜂</td>
                  <td>{s.paid ? <span className="chip" style={{ borderColor: "rgba(90,226,138,0.4)", color: "var(--good)" }}>Paid</span> : <span className="chip">Due</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {active && (
          <div className="row" style={{ gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
            <button className="btn ghost" onClick={() => boeLoan("payoff", { id: loan.id })}>Pay Full ({fmt(owed)} 🜂)</button>
            <button className="btn primary" onClick={() => boeLoan("pay", { id: loan.id })}>Pay Installment</button>
          </div>
        )}
      </div>
    </div>
  );
}

function PageLoans({ account }) {
  const [applyOpen, setApplyOpen] = useState(false);
  const loans = Array.isArray(account && account.loans) ? account.loans : [];
  const cap = (account && account.loanCap) || { aza: 0, max: 20, perLv: 5, heroLv: 0, perCinder: 5000 };
  const active = loans.filter(l => l && l.status === "active");
  const past = loans.filter(l => l && l.status !== "active");
  const canApply = cap.aza > 0 && active.length === 0;
  return (
    <div>
      {applyOpen && <ApplyLoanModal account={account} onClose={() => setApplyOpen(false)} />}
      <div className="page-head">
        <div>
          <div className="page-crumb">Treasury / Loans</div>
          <div className="page-title display">Loans & Credit Lines</div>
        </div>
        <div className="page-actions">
          <button className="btn primary" disabled={!canApply} onClick={() => setApplyOpen(true)} title={!canApply ? (active.length > 0 ? "Pay off your active loan first" : "Train heroes to unlock loan capacity") : ""}>
            <Icon name="plus" size={14}/> Apply for Loan
          </button>
        </div>
      </div>

      <div className="grid g-4" style={{ marginBottom: 14 }}>
        <Metric k="Active loans" v={String(active.length)} sub={active.length ? fmt(active.reduce((s, l) => s + Math.max(0, (l.cinder_owed | 0) - (l.cinder_paid | 0)), 0)) + " 🜂 outstanding" : "(none)"} />
        <Metric k="Hero levels" v={fmt(cap.heroLv)} sub="collateral basis" />
        <Metric k="Loan capacity" v={cap.aza + " 👑"} sub={"max " + cap.max + " 👑"} />
        <Metric k="Cinder per Aza" v={fmt(cap.perCinder | 0)} sub="canonical peg" />
      </div>

      {active.length === 0 && past.length === 0 ? (
        <div className="panel" style={{ padding: 22, textAlign: "center", color: "var(--ink-dim)" }}>
          <div style={{ fontSize: 14, marginBottom: 6 }}>No loans on record. <span style={{ color: "var(--ink-mute)" }}>(none)</span></div>
          {cap.aza > 0
            ? <div className="small-text">You're approved for up to <b style={{ color: "var(--aza)" }}>{cap.aza} 👑</b> — credited as <b style={{ color: "var(--cinder)" }}>{fmt(cap.aza * (cap.perCinder | 0))} 🜂</b> on apply.</div>
            : <div className="small-text">Train a hero to at least Lv {cap.perLv} to unlock 1 👑 of loan capacity.</div>}
        </div>
      ) : (
        <>
          {active.map(l => <LoanRow key={l.id} loan={l} />)}
          {past.length > 0 && (
            <div className="panel">
              <div className="panel-h"><h3>Closed loans</h3><span className="label">{past.length} record{past.length === 1 ? "" : "s"}</span></div>
              <table className="t">
                <thead><tr><th>ID</th><th>Aza</th><th>Cinder principal</th><th>Status</th><th>Closed</th></tr></thead>
                <tbody>
                  {past.map(l => (
                    <tr key={l.id}>
                      <td className="mono">{l.id}</td>
                      <td className="mono" style={{ color: "var(--aza)" }}>{fmt(l.aza_amount)}</td>
                      <td className="mono" style={{ color: "var(--cinder)" }}>{fmt(l.cinder_owed)}</td>
                      <td><span className="chip">{(l.status || "").toUpperCase()}</span></td>
                      <td className="mono dim">{l.closed_at ? new Date(l.closed_at).toLocaleDateString() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ============================================================
   PAGE: LEDGER
   ============================================================ */
function PageLedger({ account, transfers = [] }) {
  // Real ledger from the parent (deposit/withdraw/exchange/resource ops +
  // request settlements). Each entry may carry cinder OR aza OR both
  // (exchange) — we surface both on one row.
  const ledger = Array.isArray(account && account.ledger) ? account.ledger : [];
  const fmtT = (ms) => { try { return new Date(ms).toLocaleString(); } catch (e) { return ""; } };
  const merged = ledger.map(e => ({
    t: fmtT(e.ts),
    type: e.kind || "—",
    actor: e.counterparty || "",
    memo: e.note || "",
    cinder: e.cinder | 0,
    aza: e.aza | 0,
  }));
  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-crumb">Treasury / Ledger</div>
          <div className="page-title display">Transaction Ledger</div>
        </div>
        <div className="page-actions">
          <button className="btn ghost"><Icon name="download" size={14}/> Export CSV</button>
          <button className="btn"><Icon name="eye" size={14}/> Filter</button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-h">
          <div className="row" style={{ gap: 10 }}>
            <span className="chip live"><span className="live-dot"></span>Live · 2026-05-19</span>
            <span className="chip">Today · 38 entries</span>
            <span className="chip cinder">CDR flow +94,200</span>
            <span className="chip aza">AZA flow +21,500</span>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm ghost">All</button>
            <button className="btn sm ghost">Deposits</button>
            <button className="btn sm ghost">Withdrawals</button>
            <button className="btn sm ghost">Trades</button>
            <button className="btn sm ghost">Loans</button>
          </div>
        </div>
        <table className="t">
          <thead>
            <tr><th>Time</th><th>Type</th><th>Counterparty</th><th>Memo</th><th style={{ textAlign: "right" }}>Amount</th><th>Currency</th><th></th></tr>
          </thead>
          <tbody>
            {merged.map((e, i) => (
              <tr key={i}>
                <td className="mono dim">{e.t}</td>
                <td><span className="chip">{e.type}</span></td>
                <td>{e.actor}</td>
                <td className="dim">{e.memo}</td>
                <td className="mono" style={{ textAlign: "right", color: e.cinder > 0 ? "var(--good)" : e.cinder < 0 ? "var(--bad)" : "var(--ink-dim)", fontWeight: 600 }}>
                  {e.cinder ? <span><span className="row" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}><CinderGlyph size={12}/>{(e.cinder > 0 ? "+" : "") + fmt(e.cinder)}</span></span> : "—"}
                  {e.aza ? <span style={{ marginLeft: 8, color: e.aza > 0 ? "var(--good)" : "var(--bad)" }}><span className="row" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}><AzaGlyph size={12}/>{(e.aza > 0 ? "+" : "") + fmt(e.aza)}</span></span> : null}
                </td>
                <td className="dim mono">{e.cinder && e.aza ? "CDR · AZA" : (e.cinder ? "CDR" : (e.aza ? "AZA" : "—"))}</td>
                <td></td>
              </tr>
            ))}
            {merged.length === 0 && (
              <tr><td colSpan="7" className="dim" style={{ textAlign: "center", padding: 28, fontStyle: "italic" }}>(none) — no transactions yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ============================================================
   PAGE: CHARTS
   ============================================================ */
function PageCharts() {
  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-crumb">Economy / Market Charts</div>
          <div className="page-title display">Currency & Market Health</div>
        </div>
      </div>

      <div className="grid g-2" style={{ marginBottom: 14 }}>
        <BigChart title="CDR / AZA" color="#ff7a3d" data={SPK_CINDER} value="0.214 AZA" delta="+2.4%" />
        <BigChart title="AZA / CDR" color="#5ee3ff" data={SPK_AZA} value="4.67 CDR" delta="-0.6%" />
      </div>

      <div className="grid g-3">
        <div className="panel">
          <div className="panel-h"><h3>Top mercenary earners</h3></div>
          <div>
            {MERCS.slice(0, 5).sort((a,b)=>b.cinder-a.cinder).map(m => (
              <div key={m.name} className="row between" style={{ padding: "10px 16px", borderBottom: "1px solid var(--hair)" }}>
                <div className="row" style={{ gap: 10 }}>
                  <div className="merc-av" style={{ background: `linear-gradient(135deg, ${m.color1}, ${m.color2})`, width: 28, height: 28, fontSize: 10 }}>{m.tag}</div>
                  <span style={{ fontSize: 12 }}>{m.name}</span>
                </div>
                <span className="mono" style={{ fontSize: 12, color: "var(--cinder)" }}>{fmt(m.cinder)} CDR</span>
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <div className="panel-h"><h3>Resource flows · 24h</h3></div>
          <div className="panel-b stack-sm">
            {RESOURCES.map(r => (
              <div key={r.name}>
                <div className="row between"><span style={{ fontSize: 12 }}>{r.name}</span><span className="mono" style={{ fontSize: 12 }}>+{fmt(Math.round(r.qty*0.04))}</span></div>
                <div className="bar"><div style={{ width: `${(r.qty/1500)*100}%`, background: r.tone }}></div></div>
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <div className="panel-h"><h3>Auction heat</h3></div>
          <div>
            {MARKET.slice(0, 5).map((m, i) => (
              <div key={i} className="row between" style={{ padding: "10px 16px", borderBottom: "1px solid var(--hair)" }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{m.name}</div>
                  <div className="label" style={{ marginTop: 2 }}>{m.rarityLabel}</div>
                </div>
                <span className="row" style={{ gap: 4, color: m.currency === "cinder" ? "var(--cinder)" : "var(--aza)" }}>
                  {m.currency === "cinder" ? <CinderGlyph size={12}/> : <AzaGlyph size={12}/>}
                  <span className="mono" style={{ fontSize: 12 }}>{fmt(m.price)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function BigChart({ title, color, data, value, delta }) {
  const W = 540, H = 160;
  const max = Math.max(...data), min = Math.min(...data);
  const range = max - min || 1;
  const step = W / (data.length - 1);
  const pts = data.map((v, i) => `${i * step},${H - ((v - min) / range) * (H - 16) - 8}`);
  const line = "M" + pts.join(" L");
  const up = delta.startsWith("+");
  return (
    <div className="panel" style={{ padding: 18 }}>
      <div className="row between">
        <div>
          <div className="label">{title}</div>
          <div className="display row" style={{ alignItems: "baseline", gap: 8, fontSize: 28, fontWeight: 600, marginTop: 4 }}>
            {value}
            <span className="mono" style={{ fontSize: 12, color: up ? "var(--good)" : "var(--bad)" }}>{up ? "▲" : "▼"} {delta}</span>
          </div>
        </div>
        <div className="row" style={{ gap: 4 }}>
          {["1H","24H","7D","30D","ALL"].map(t => <button key={t} className={`btn sm ${t === "24H" ? "" : "ghost"}`}>{t}</button>)}
        </div>
      </div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{ marginTop: 14 }}>
        <defs>
          <linearGradient id={`g-${color.slice(1)}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0,1,2,3].map(i => <line key={i} x1="0" x2={W} y1={(H/4)*i} y2={(H/4)*i} stroke="rgba(255,255,255,0.04)" />)}
        <path d={line + ` L${W},${H} L0,${H} Z`} fill={`url(#g-${color.slice(1)})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="2" />
      </svg>
    </div>
  );
}

/* ============================================================
   TWEAKS PANEL
   ============================================================ */
function TweaksPanelHost({ t, setTweak }) {
  if (!window.TweaksPanel) return null;
  const { TweaksPanel, TweakSection, TweakRadio, TweakColor } = window;
  return (
    <TweaksPanel title="Tweaks">
      <TweakSection title="View">
        <TweakRadio
          label="Role"
          value={t.role}
          onChange={(v) => setTweak("role", v)}
          options={["employer", "mercenary"]}
        />
      </TweakSection>
      <TweakSection title="Accent">
        <TweakColor
          label="Primary accent"
          value={t.accent}
          onChange={(v) => setTweak("accent", v)}
          options={["#8a6bff", "#ff7a3d", "#5ee3ff", "#5ae28a"]}
        />
      </TweakSection>
    </TweaksPanel>
  );
}

/* ============================================================
   AUTH SCREEN — Create / Sign in to account
   ============================================================ */
function AuthScreen({ onAccount }) {
  const [mode, setMode] = useState("create"); // create | signin
  const [stage, setStage] = useState("intro"); // intro | application
  const [callsign, setCallsign] = useState("");
  const [handle, setHandle] = useState(genHandle());
  const [palette, setPalette] = useState(0);
  const [signinHandle, setSigninHandle] = useState("");
  const [error, setError] = useState("");

  const initials = (callsign || "??").trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase() || "??";

  const proceedToForm = () => {
    setError("");
    const cs = callsign.trim();
    if (cs.length < 2) { setError("Choose a callsign at least 2 characters long."); return; }
    setStage("application");
  };

  const finalizeAccount = (formData) => {
    const acc = {
      handle,
      callsign: callsign.trim(),
      initials,
      c1: AVATAR_PALETTES[palette][0],
      c2: AVATAR_PALETTES[palette][1],
      cinder: 5_000,
      aza: 1_000,
      created: new Date().toISOString(),
      recoveryKey: Math.random().toString(36).slice(2, 14).toUpperCase(),
      application: formData,
    };
    onAccount(acc);
  };

  const signinSubmit = () => {
    setError("");
    if (!signinHandle.trim()) { setError("Enter your account handle."); return; }
    const acc = {
      handle: signinHandle.trim().toUpperCase(),
      callsign: "Returning Operator",
      initials: "RO",
      c1: "#8a6bff", c2: "#ff7a3d",
      cinder: 12_400, aza: 2_640,
      created: new Date().toISOString(),
      recoveryKey: "—",
    };
    onAccount(acc);
  };

  if (stage === "application") {
    return <ApplicationForm
      callsign={callsign}
      handle={handle}
      initials={initials}
      palette={AVATAR_PALETTES[palette]}
      onBack={() => setStage("intro")}
      onSubmit={finalizeAccount}
    />;
  }

  return (
    <div className="auth-shell">
      <div className="auth-art">
        <div className="row" style={{ gap: 12 }}>
          <div style={{ width: 44, height: 44 }}><BrandMark /></div>
          <div>
            <div className="display" style={{ fontWeight: 700, fontSize: 18 }}>Bank of Ethos</div>
            <div className="label" style={{ marginTop: 2 }}>Camp Heights · Treasury Network</div>
          </div>
        </div>

        <div>
          <div className="auth-h1 display">The market<br/>never sleeps.</div>
          <div className="auth-lede">
            Open an Ethos account to hire mercenaries, manage operation vaults, take loans, and move Cinder &amp; Aza coin between survivors across Camp Heights.
          </div>

          <div className="auth-features">
            <div className="auth-feature">
              <div className="label">Dual Currency</div>
              <div className="v row" style={{ gap: 8 }}><CinderGlyph size={14} /> Cinder · <AzaGlyph size={14} /> Aza</div>
            </div>
            <div className="auth-feature">
              <div className="label">Starter gift</div>
              <div className="v" style={{ color: "var(--cinder)" }}>5,000 CDR + 1,000 AZA</div>
            </div>
            <div className="auth-feature">
              <div className="label">P2P transfers</div>
              <div className="v">Instant, no fee under 10K</div>
            </div>
            <div className="auth-feature">
              <div className="label">Vault security</div>
              <div className="v">Ethos cold storage</div>
            </div>
          </div>
        </div>

        <div className="row" style={{ gap: 14, fontSize: 11, color: "var(--ink-mute)" }}>
          <span className="mono">v2.4.0 · MAINNET</span>
          <span>•</span>
          <span>By opening an account you accept the Ethos Charter.</span>
        </div>
      </div>

      <div className="auth-form">
        <div className="auth-tabs">
          <div className={`auth-tab ${mode === "create" ? "active" : ""}`} onClick={() => setMode("create")}>Open new account</div>
          <div className={`auth-tab ${mode === "signin" ? "active" : ""}`} onClick={() => setMode("signin")}>Sign in</div>
        </div>

        {mode === "create" ? (
          <div className="stack-lg">
            <div className="field">
              <label>Account handle · auto-generated</label>
              <div className="row" style={{ gap: 10 }}>
                <div className="handle-preview">
                  <Icon name="vault" size={18} /> {handle}
                </div>
                <button className="btn" onClick={() => setHandle(genHandle())}><Icon name="spark" size={12}/> Regenerate</button>
              </div>
              <div className="muted" style={{ fontSize: 11 }}>This is how other players send you Cinder &amp; Aza. Share it like a wallet address.</div>
            </div>

            <div className="grid g-2" style={{ gap: 14 }}>
              <div className="field">
                <label>Callsign</label>
                <input value={callsign} onChange={(e) => setCallsign(e.target.value)} placeholder="e.g. Vash Korr" maxLength={24} />
              </div>
              <div className="field">
                <label>Avatar palette</label>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  {AVATAR_PALETTES.map((p, i) => (
                    <div key={i} onClick={() => setPalette(i)} style={{
                      width: 40, height: 40, cursor: "pointer",
                      background: `linear-gradient(135deg, ${p[0]}, ${p[1]})`,
                      border: i === palette ? `2px solid #fff` : `1px solid var(--hair)`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontWeight: 700, color: "#fff", fontSize: 12,
                    }}>{initials}</div>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ padding: 14, border: "1px solid var(--hair)", background: "var(--bg-1)" }}>
              <div className="label">Starting deposit · Ethos welcome grant</div>
              <div className="row" style={{ gap: 18, marginTop: 8 }}>
                <div className="row" style={{ gap: 8 }}>
                  <CinderGlyph size={20} />
                  <div>
                    <div className="mono" style={{ fontSize: 18, fontWeight: 600, color: "var(--cinder)" }}>5,000</div>
                    <div className="label">Cinder</div>
                  </div>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <AzaGlyph size={20} />
                  <div>
                    <div className="mono" style={{ fontSize: 18, fontWeight: 600, color: "var(--aza)" }}>1,000</div>
                    <div className="label">Aza Coin</div>
                  </div>
                </div>
              </div>
            </div>

            {error && <div className="chip warn" style={{ alignSelf: "flex-start" }}>{error}</div>}

            <div className="row" style={{ gap: 10 }}>
              <button className="btn primary" onClick={proceedToForm} style={{ padding: "10px 18px" }}><Icon name="check" size={14}/> Continue → Application form</button>
              <span className="muted" style={{ fontSize: 11 }}>Form is required. Survivor protocol.</span>
            </div>
          </div>
        ) : (
          <div className="stack-lg">
            <div className="field">
              <label>Account handle</label>
              <input value={signinHandle} onChange={(e) => setSigninHandle(e.target.value.toUpperCase())} placeholder="ETH-XXXX" />
            </div>
            <div className="field">
              <label>Recovery key</label>
              <input placeholder="••••••••••••" />
              <div className="muted" style={{ fontSize: 11 }}>Demo build · any handle restores a sample account.</div>
            </div>
            {error && <div className="chip warn" style={{ alignSelf: "flex-start" }}>{error}</div>}
            <div className="row" style={{ gap: 10 }}>
              <button className="btn primary" onClick={signinSubmit} style={{ padding: "10px 18px" }}><Icon name="check" size={14}/> Sign in</button>
              <span className="muted" style={{ fontSize: 11 }}>Lost your key? <a style={{ color: "var(--violet)" }}>Contact a registrar</a></span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   APPLICATION FORM — official BoE account opening
   ============================================================ */
function SignaturePad({ onChange }) {
  const canvasRef = useRef(null);
  const [hasInk, setHasInk] = useState(false);
  const drawingRef = useRef(false);
  const lastRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    // size canvas to its bounding box, hi-dpi
    const resize = () => {
      const r = c.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      c.width = r.width * dpr;
      c.height = r.height * dpr;
      const ctx = c.getContext("2d");
      ctx.scale(dpr, dpr);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#efeaff";
      ctx.lineWidth = 2.2;
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  const pos = (e) => {
    const c = canvasRef.current;
    const r = c.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const start = (e) => {
    e.preventDefault();
    drawingRef.current = true;
    lastRef.current = pos(e);
    canvasRef.current.setPointerCapture(e.pointerId);
  };
  const move = (e) => {
    if (!drawingRef.current) return;
    const p = pos(e);
    const ctx = canvasRef.current.getContext("2d");
    ctx.beginPath();
    ctx.moveTo(lastRef.current.x, lastRef.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastRef.current = p;
    if (!hasInk) { setHasInk(true); }
  };
  const end = (e) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    try { canvasRef.current.releasePointerCapture(e.pointerId); } catch {}
    onChange && onChange(canvasRef.current.toDataURL("image/png"));
  };

  const clear = () => {
    const c = canvasRef.current;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
    onChange && onChange(null);
  };

  return (
    <div className="sig-wrap">
      <div className="sig-pad">
        <canvas
          ref={canvasRef}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onPointerLeave={end}
        />
        {!hasInk && <div className="sig-hint">Sign here with mouse, stylus, or finger</div>}
        <div className="sig-x"></div>
        <div className="sig-watermark">× SURVIVOR SIGNATURE · BANK OF ETHOS · BOE-001 ·</div>
      </div>
      <div className="sig-actions">
        <span className="label" style={{ color: hasInk ? "var(--good)" : "var(--ink-mute)" }}>
          {hasInk ? "✓ Signature captured" : "Signature required"}
        </span>
        <button type="button" className="btn sm" onClick={clear}><Icon name="x" size={11}/> Clear</button>
      </div>
    </div>
  );
}

function Check({ label, checked, onChange }) {
  return (
    <label className={`form-check ${checked ? "checked" : ""}`} onClick={(e) => { e.preventDefault(); onChange(!checked); }}>
      <span className="box"><Icon name="check" size={10}/></span>
      <span>{label}</span>
    </label>
  );
}

function ApplicationForm({ callsign, handle, initials, palette, onBack, onSubmit }) {
  const [full, setFull] = useState(callsign);
  const [camp, setCamp] = useState("");
  const [nick, setNick] = useState("");
  const [occupation, setOccupation] = useState({});
  const [deaths, setDeaths] = useState("");
  const [cinder, setCinder] = useState("");
  const [wealth, setWealth] = useState({});
  const [fraud, setFraud] = useState("");
  const [password, setPassword] = useState("");
  const [backup, setBackup] = useState("");
  const [node, setNode] = useState("");
  const [payouts, setPayouts] = useState("");
  const [bloodType, setBloodType] = useState("");
  const [cannedFood, setCannedFood] = useState("");
  const [human, setHuman] = useState(false);
  const [sig, setSig] = useState(null);
  const [error, setError] = useState("");

  const toggle = (obj, setObj, key) => setObj({ ...obj, [key]: !obj[key] });

  const submit = () => {
    setError("");
    if (!full.trim()) { setError("Section 1 — Full Survivor Name is required."); return; }
    if (!human) { setError("Confirm you are probably human."); return; }
    if (!sig) { setError("E-signature required. Please sign the document above."); return; }
    onSubmit({
      fullName: full, camp, nickname: nick, occupation, deaths,
      cinder, wealth, fraud, password, backup, node, payouts,
      bloodType, cannedFood, signature: sig,
      signedAt: new Date().toISOString(),
    });
  };

  const OCC = ["Scavenger","Mercenary","Card Addict","Black Market Trader","Professional Loot Goblin","Corporate Tax Evader","Relic Smuggler","\u201CIt's complicated\u201D"];
  const DEATHS = ["0","1–3","4–7","Please stop asking questions"];
  const WEALTH = ["Hard work","Marketplace trading","Salvage operations","Gym betting","Extremely suspicious activities","I found a glowing cube and now I hear whispers"];
  const FRAUD = ["No","No officially","Define \u201Cfraud\u201D"];
  const PASS = ["password123","beans123","SCPILoveMoney","Nice try, fed"];
  const BACKUP = ["Camp medic","Local mercenary","Giant mech operator","Weird old man behind the gas station"];
  const NODE = ["Yes","No","I sold my last node for canned beans"];
  const PAYOUT = ["Yes","Absolutely","Please save me from poverty"];

  return (
    <div className="form-page">
      <div className="row between" style={{ maxWidth: 860, margin: "0 auto 18px" }}>
        <div className="row" style={{ gap: 10 }}>
          <button className="btn sm" onClick={onBack}>← Back to intake</button>
          <span className="mono" style={{ fontSize: 11, color: "var(--ink-mute)" }}>Filing as: <span style={{ color: "var(--violet)" }}>{handle}</span> · {callsign}</span>
        </div>
        <span className="chip violet"><span className="dot" style={{ background: "var(--violet)" }}></span>FORM BOE-001 · IN PROGRESS</span>
      </div>

      <div className="form-card">
        {/* Stamp / header */}
        <div className="form-stamp">
          <div className="row" style={{ gap: 12 }}>
            <div style={{ width: 38, height: 38 }}><BrandMark /></div>
            <div className="mono" style={{ fontSize: 10, letterSpacing: "0.22em", color: "var(--ink-mute)" }}>BANK OF ETHOS · CAMP HEIGHTS TREASURY</div>
          </div>
          <h1>Official Account Creation Form</h1>
          <div className="sub">"Your Cinder. Probably Safe."<span className="muted" style={{ marginLeft: 6 }}>*</span></div>
          <div className="tag">Welcome to the Bank of Ethos — the most trusted financial institution still standing after the collapse of civilization.</div>
          <div className="disc">* Trust level not legally guaranteed. Please complete the following application to open your official survivor banking account.</div>
        </div>

        {/* SECTION 1 */}
        <div className="form-section">
          <div className="form-section-head"><span className="num">01</span><h2>Survivor Information</h2></div>
          <div className="form-q">
            <div className="form-q-label"><span className="qno">1.1</span> Full Survivor Name</div>
            <input className="line-input" value={full} onChange={(e) => setFull(e.target.value)} placeholder="Surname, given name, or post-apocalyptic moniker" />
          </div>
          <div className="form-q">
            <div className="form-q-label"><span className="qno">1.2</span> Camp Affiliation</div>
            <input className="line-input" value={camp} onChange={(e) => setCamp(e.target.value)} placeholder="e.g. Camp Heights, Iron Cabal, Unaffiliated drifter" />
          </div>
          <div className="form-q">
            <div className="form-q-label"><span className="qno">1.3</span> Nickname Used In Illegal Trade Chats</div>
            <input className="line-input" value={nick} onChange={(e) => setNick(e.target.value)} placeholder="Optional. We don't ask, we don't tell." />
          </div>
          <div className="form-q">
            <div className="form-q-label"><span className="qno">1.4</span> Current Occupation <span className="muted" style={{ fontWeight: 400, fontSize: 11 }}>(check all that apply)</span></div>
            <div className="form-check-list">
              {OCC.map(o => <Check key={o} label={o} checked={!!occupation[o]} onChange={() => toggle(occupation, setOccupation, o)} />)}
            </div>
          </div>
          <div className="form-q">
            <div className="form-q-label"><span className="qno">1.5</span> How many times have you almost died this week?</div>
            <div className="form-check-list">
              {DEATHS.map(o => <Check key={o} label={o} checked={deaths === o} onChange={() => setDeaths(o)} />)}
            </div>
          </div>
        </div>

        {/* SECTION 2 */}
        <div className="form-section">
          <div className="form-section-head"><span className="num">02</span><h2>Financial Status</h2></div>
          <div className="form-q">
            <div className="form-q-label"><span className="qno">2.1</span> Current Cinder Balance <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>(approximate, no judgment)</span></div>
            <input className="line-input" value={cinder} onChange={(e) => setCinder(e.target.value)} placeholder="e.g. 12,000 CDR — or 'three beans and a prayer'" />
          </div>
          <div className="form-q">
            <div className="form-q-label"><span className="qno">2.2</span> How did you obtain your wealth?</div>
            <div className="form-check-list">
              {WEALTH.map(o => <Check key={o} label={o} checked={!!wealth[o]} onChange={() => toggle(wealth, setWealth, o)} />)}
            </div>
          </div>
          <div className="form-q">
            <div className="form-q-label"><span className="qno">2.3</span> Have you ever committed tax fraud against the Foundation Reserve?</div>
            <div className="form-check-list">
              {FRAUD.map(o => <Check key={o} label={o} checked={fraud === o} onChange={() => setFraud(o)} />)}
            </div>
          </div>
        </div>

        {/* SECTION 3 */}
        <div className="form-section">
          <div className="form-section-head"><span className="num">03</span><h2>Security Questions</h2></div>
          <div className="form-q">
            <div className="form-q-label"><span className="qno">3.1</span> If your account is compromised, which of these would you use as a password?</div>
            <div className="form-check-list">
              {PASS.map(o => <Check key={o} label={o} checked={password === o} onChange={() => setPassword(o)} />)}
            </div>
          </div>
          <div className="form-q">
            <div className="form-q-label"><span className="qno">3.2</span> Choose your emergency backup contact</div>
            <div className="form-check-list">
              {BACKUP.map(o => <Check key={o} label={o} checked={backup === o} onChange={() => setBackup(o)} />)}
            </div>
          </div>
        </div>

        {/* SECTION 4 */}
        <div className="form-section">
          <div className="form-section-head"><span className="num">04</span><h2>Node Holder Status</h2></div>
          <div className="form-q">
            <div className="form-q-label"><span className="qno">4.1</span> Do you currently own a Foundation Reserve Node?</div>
            <div className="form-check-list">
              {NODE.map(o => <Check key={o} label={o} checked={node === o} onChange={() => setNode(o)} />)}
            </div>
          </div>
          <div className="form-q">
            <div className="form-q-label"><span className="qno">4.2</span> Would you like to receive Reserve payouts directly to your Bank of Ethos account?</div>
            <div className="form-check-list">
              {PAYOUT.map(o => <Check key={o} label={o} checked={payouts === o} onChange={() => setPayouts(o)} />)}
            </div>
          </div>
        </div>

        {/* SECTION 5 */}
        <div className="form-section" style={{ position: "relative" }}>
          <div className="stamp-rotate">PENDING · UNSIGNED</div>
          <div className="form-section-head"><span className="num">05</span><h2>Final Agreement</h2></div>

          <div className="agreement-list" style={{ marginBottom: 18 }}>
            <div style={{ fontWeight: 600, color: "var(--ink)", marginBottom: 8 }}>By signing below, you agree that:</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>The <strong>Bank of Ethos</strong> is not responsible for stolen relics, missing mercenaries, dimensional anomalies, or rogue gym leaders.</li>
              <li>Any suspicious deposits may be investigated by the <strong>Foundation Treasury Division</strong>.</li>
              <li>Attempting to rob the bank may result in <strong>immediate emotional damage</strong>.</li>
              <li>All Cinder deposits are fictional and exist inside the game universe.</li>
              <li>If the vault alarms begin screaming, please <strong>remain calm</strong>.</li>
            </ul>
          </div>

          <div className="grid g-2" style={{ gap: 18, marginBottom: 18 }}>
            <div className="form-q" style={{ margin: 0 }}>
              <div className="form-q-label"><span className="qno">5.1</span> Blood Type <span className="muted" style={{ fontWeight: 400, fontSize: 11 }}>(for liability purposes)</span></div>
              <input className="line-input" value={bloodType} onChange={(e) => setBloodType(e.target.value)} placeholder="A+, O−, glowing green, etc." />
            </div>
            <div className="form-q" style={{ margin: 0 }}>
              <div className="form-q-label"><span className="qno">5.2</span> Favorite Canned Food</div>
              <input className="line-input" value={cannedFood} onChange={(e) => setCannedFood(e.target.value)} placeholder="Beans. Always beans." />
            </div>
          </div>

          <div className="form-q">
            <div className="form-q-label"><span className="qno">5.3</span> Survivor Signature <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>(legally binding under the Ethos Charter)</span></div>
            <SignaturePad onChange={setSig} />
          </div>

          <div className="form-check-list one" style={{ marginTop: 10 }}>
            <Check label="I confirm I am probably human." checked={human} onChange={setHuman} />
          </div>
        </div>

        {/* FOOTER */}
        <div className="form-footer">
          <div className="row between">
            <div className="seal">
              <div className="seal-circle">
                <svg width="34" height="34" viewBox="0 0 40 40"><BrandMarkInner /></svg>
              </div>
              <div>
                <div style={{ color: "var(--ink)", fontSize: 12, fontWeight: 600, fontFamily: "Space Grotesk", letterSpacing: 0 }}>BANK OF ETHOS</div>
                <div>FOUNDATION RESERVE · CAMP HEIGHTS BRANCH</div>
                <div style={{ marginTop: 2 }}>FILE NO. BOE-001 · {new Date().toLocaleDateString()}</div>
              </div>
            </div>
            <div style={{ textAlign: "right", fontSize: 11, color: "var(--ink-mute)", fontFamily: "JetBrains Mono", letterSpacing: "0.06em" }}>
              <div>HANDLE ASSIGNED</div>
              <div style={{ fontSize: 16, color: "var(--violet)", marginTop: 2 }}>{handle}</div>
            </div>
          </div>

          {error && <div className="chip warn" style={{ alignSelf: "flex-start" }}>{error}</div>}

          <div className="row between">
            <div className="muted" style={{ fontSize: 11 }}>By submitting, your signature, answers, and the timestamp are appended to your account record on this device.</div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn" onClick={onBack}>Cancel</button>
              <button className="btn primary" onClick={submit} style={{ padding: "10px 18px" }}>
                <Icon name="check" size={14}/> Open Account
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// re-usable inner brand glyph for the wax seal
function BrandMarkInner() {
  return (
    <g>
      <path d="M10 28V14l10-6 10 6v14" fill="none" stroke="#8a6bff" strokeWidth="1.8" />
      <path d="M14 28V18M20 28V16M26 28V18M8 30h24" stroke="#8a6bff" strokeWidth="1.8" strokeLinecap="square" />
    </g>
  );
}
function SendModal({ account, initialContact, onClose, onSend }) {
  const [contact, setContact] = useState(initialContact || null);
  const [query, setQuery] = useState("");
  const [currency, setCurrency] = useState("cinder");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [step, setStep] = useState(initialContact ? "amount" : "recipient");
  const [error, setError] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return DIRECTORY.slice(0, 8);
    return DIRECTORY.filter(c =>
      c.handle.toUpperCase().includes(q) ||
      c.callsign.toUpperCase().includes(q)
    ).slice(0, 10);
  }, [query]);

  const balance = currency === "cinder" ? account.cinder : account.aza;
  const amt = parseFloat(amount) || 0;
  const fee = amt > 10_000 ? Math.round(amt * 0.001) : 0;
  const total = amt + fee;

  const handleSubmit = () => {
    setError("");
    if (!contact) { setError("Pick a recipient."); return; }
    if (amt <= 0) { setError("Enter an amount."); return; }
    if (total > balance) { setError("Insufficient balance."); return; }
    onSend({ to: contact, currency, amount: amt, memo });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-h">
          <div>
            <h3>Send {currency === "cinder" ? "Cinder" : "Aza Coin"}</h3>
            <div className="label" style={{ marginTop: 2 }}>From {account.handle} · {account.callsign}</div>
          </div>
          <div className="icon-btn" onClick={onClose}><Icon name="x" size={14}/></div>
        </div>
        <div className="modal-b stack-lg">
          {/* Step 1: recipient */}
          {step === "recipient" && (
            <div className="stack">
              <div className="field">
                <label>Recipient</label>
                <div className="search">
                  <Icon name="search" size={14}/>
                  <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by handle (ETH-…) or callsign" />
                </div>
              </div>
              <div className="stack-sm" style={{ maxHeight: 260, overflowY: "auto" }}>
                {results.map(c => (
                  <div key={c.handle} className={`contact-row ${contact && contact.handle === c.handle ? "selected" : ""}`} onClick={() => setContact(c)}>
                    <div className="merc-av" style={{ background: `linear-gradient(135deg, ${c.c1}, ${c.c2})`, width: 32, height: 32, fontSize: 11 }}>{c.initials}</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{c.callsign} {c.online && <span className="live-dot" style={{ display: "inline-block", marginLeft: 4 }}></span>}</div>
                      <div className="mono" style={{ fontSize: 11, color: "var(--violet)" }}>{c.handle} <span className="muted" style={{ marginLeft: 6 }}>{c.tag}</span></div>
                    </div>
                    <Icon name="chevron" size={14} className="muted" />
                  </div>
                ))}
                {results.length === 0 && <div className="muted" style={{ fontSize: 12, padding: 12 }}>No accounts match — try a partial handle.</div>}
              </div>
            </div>
          )}

          {/* Step 2: amount */}
          {step === "amount" && (
            <div className="stack">
              {contact && (
                <div className="contact-row selected" style={{ cursor: "default" }}>
                  <div className="merc-av" style={{ background: `linear-gradient(135deg, ${contact.c1 || "#8a6bff"}, ${contact.c2 || "#ff7a3d"})`, width: 32, height: 32, fontSize: 11 }}>{contact.initials}</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{contact.callsign}</div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--violet)" }}>{contact.handle}</div>
                  </div>
                  <button className="chip-btn" onClick={() => setStep("recipient")}>Change</button>
                </div>
              )}

              <div className="field">
                <label>Currency</label>
                <div className="currency-toggle">
                  <button className={`cinder ${currency === "cinder" ? "active" : ""}`} onClick={() => setCurrency("cinder")}>
                    <CinderGlyph size={16}/> Cinder · CDR
                  </button>
                  <button className={`aza ${currency === "aza" ? "active" : ""}`} onClick={() => setCurrency("aza")}>
                    <AzaGlyph size={16}/> Aza Coin · AZA
                  </button>
                </div>
              </div>

              <div className="field">
                <div className="row between">
                  <label>Amount</label>
                  <span className="label">Available: <span className="mono" style={{ color: currency === "cinder" ? "var(--cinder)" : "var(--aza)" }}>{fmt(balance)} {currency === "cinder" ? "CDR" : "AZA"}</span></span>
                </div>
                <div className="amount-input">
                  {currency === "cinder" ? <CinderGlyph size={20}/> : <AzaGlyph size={20}/>}
                  <input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" />
                  <span className="mono muted" style={{ fontSize: 14 }}>{currency === "cinder" ? "CDR" : "AZA"}</span>
                </div>
                <div className="row" style={{ gap: 6, marginTop: 6 }}>
                  {[100, 1000, 10_000].map(v => (
                    <button key={v} className="chip-btn" onClick={() => setAmount(String(v))}>{v.toLocaleString()}</button>
                  ))}
                  <button className="chip-btn" onClick={() => setAmount(String(Math.floor(balance * 0.25)))}>25%</button>
                  <button className="chip-btn" onClick={() => setAmount(String(Math.floor(balance * 0.5)))}>50%</button>
                  <button className="chip-btn" onClick={() => setAmount(String(Math.floor(balance)))}>MAX</button>
                </div>
              </div>

              <div className="field">
                <label>Memo (optional)</label>
                <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="e.g. Mercenary contract C-204A payout" maxLength={80} />
              </div>

              <div style={{ padding: 12, background: "var(--bg-1)", border: "1px solid var(--hair)" }}>
                <div className="row between" style={{ padding: "4px 0" }}><span className="label">Amount</span><span className="mono">{fmt(amt)}</span></div>
                <div className="row between" style={{ padding: "4px 0" }}><span className="label">Network fee</span><span className="mono">{fee === 0 ? "FREE (under 10K)" : fmt(fee)}</span></div>
                <div className="row between" style={{ padding: "8px 0 4px", borderTop: "1px solid var(--hair)", marginTop: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Total deducted</span>
                  <span className="mono" style={{ fontSize: 16, fontWeight: 700, color: currency === "cinder" ? "var(--cinder)" : "var(--aza)" }}>{fmt(total)} {currency === "cinder" ? "CDR" : "AZA"}</span>
                </div>
              </div>

              {error && <div className="chip warn">{error}</div>}
            </div>
          )}
        </div>
        <div className="modal-f">
          {step === "recipient" ? (
            <>
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn primary" disabled={!contact} onClick={() => setStep("amount")} style={{ opacity: contact ? 1 : 0.5 }}>Continue → Amount</button>
            </>
          ) : (
            <>
              <button className="btn" onClick={() => setStep("recipient")}>← Back</button>
              <button className={`btn ${currency === "cinder" ? "cinder" : "aza"}`} onClick={handleSubmit}>
                <Icon name="bolt" size={12}/> Send {amt > 0 ? fmt(amt) : ""} {currency === "cinder" ? "CDR" : "AZA"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   PAGE: SEND & REQUEST
   ============================================================ */
function PageTransfers({ account, transfers, onSend }) {
  const [reqOpen, setReqOpen] = useState(false);
  const reqIn = Array.isArray(account.reqIn) ? account.reqIn : [];
  const reqOut = Array.isArray(account.reqOut) ? account.reqOut : [];
  const pendIn = reqIn.filter(r => r.status === "pending");
  const pendOut = reqOut.filter(r => r.status === "pending");
  const histOut = reqOut.filter(r => r.status !== "pending");
  return (
    <div>
      {reqOpen && <RequestModal account={account} onClose={() => setReqOpen(false)} />}
      <div className="page-head">
        <div>
          <div className="page-crumb">Treasury / Send & Request</div>
          <div className="page-title display">Send & Request</div>
        </div>
        <div className="page-actions">
          <button className="btn ghost" onClick={() => setReqOpen(true)}><Icon name="arrow_in" size={14}/> Request Cinder</button>
          <button className="btn primary" onClick={() => onSend()}><Icon name="arrow_out" size={14}/> Send money</button>
        </div>
      </div>

      <div className="grid g-2" style={{ marginBottom: 14 }}>
        <BalanceCard kind="cinder" amount={account.cinder} wallet={account.walletCinder || 0} bankReady={!!(account.vault && account.vault.bankReady)} delta="+4.2%" spark={SPK_CINDER} onSend={() => onSend()} />
        <BalanceCard kind="aza"    amount={account.aza}    wallet={account.walletAza || 0}    bankReady={!!(account.vault && account.vault.bankReady && account.vault.extCols)} delta="-0.6%" spark={SPK_AZA} onSend={() => onSend()} />
      </div>

      {/* Cinder requests — incoming (pay or decline) + outgoing status. */}
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div className="panel">
          <div className="panel-h"><h3>Incoming Requests</h3><span className="label">{pendIn.length} pending</span></div>
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {pendIn.length === 0 ? (
              <div className="panel-b muted" style={{ fontSize: 12 }}>No one is asking you for Cinder. (none)</div>
            ) : pendIn.map(r => (
              <div key={r.id} className="row between" style={{ padding: "10px 14px", borderBottom: "1px solid var(--hair)", gap: 8 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>From <span className="mono" style={{ color: "var(--violet)" }}>{r.from_handle}</span></div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--cinder)", marginTop: 2 }}>{fmt(r.amount)} CDR</div>
                  {r.message && <div style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 2 }}>{r.message}</div>}
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn sm primary" onClick={() => boeReq("pay", { id: r.id })}>Pay</button>
                  <button className="btn sm ghost" onClick={() => boeReq("decline", { id: r.id })}>Decline</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-h"><h3>Outgoing Requests</h3><span className="label">{pendOut.length} pending · {histOut.length} history</span></div>
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {(pendOut.length + histOut.length) === 0 ? (
              <div className="panel-b muted" style={{ fontSize: 12 }}>You haven't requested any Cinder yet. (none)</div>
            ) : (
              [...pendOut, ...histOut].map(r => (
                <div key={r.id} className="row between" style={{ padding: "10px 14px", borderBottom: "1px solid var(--hair)", gap: 8 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>To <span className="mono" style={{ color: "var(--violet)" }}>{r.to_handle}</span></div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--cinder)", marginTop: 2 }}>{fmt(r.amount)} CDR · <span style={{ color: "var(--ink-dim)" }}>{r.status}</span></div>
                    {r.message && <div style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 2 }}>{r.message}</div>}
                  </div>
                  {r.status === "pending" && (
                    <button className="btn sm ghost" onClick={() => boeReq("cancel", { id: r.id })}>Cancel</button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div className="panel">
          <div className="panel-h"><h3>Quick send · recent contacts</h3></div>
          <div className="panel-b">
            <div className="grid" style={{ gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
              {DIRECTORY.slice(0, 6).map(c => (
                <div key={c.handle} className="contact-row" onClick={() => onSend(c)}>
                  <div className="merc-av" style={{ background: `linear-gradient(135deg, ${c.c1}, ${c.c2})`, width: 32, height: 32, fontSize: 11 }}>{c.initials}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{c.callsign}</div>
                    <div className="mono" style={{ fontSize: 10, color: "var(--violet)" }}>{c.handle}</div>
                  </div>
                  <Icon name="arrow_out" size={14} className="muted"/>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-h"><h3>My transfers</h3><span className="label">{transfers.length} on this device</span></div>
          <div style={{ maxHeight: 380, overflowY: "auto" }}>
            {transfers.length === 0 ? (
              <div className="panel-b muted" style={{ fontSize: 12 }}>No transfers yet. Hit <strong>Send</strong> to move Cinder or Aza to another player by their <span className="mono" style={{ color: "var(--violet)" }}>ETH-XXXX</span> handle.</div>
            ) : transfers.map(tx => (
              <div key={tx.id} className="row between" style={{ padding: "12px 16px", borderBottom: "1px solid var(--hair)" }}>
                <div className="row" style={{ gap: 10 }}>
                  <div style={{ width: 28, height: 28, border: "1px solid var(--hair)", display: "flex", alignItems: "center", justifyContent: "center", color: tx.currency === "cinder" ? "var(--cinder)" : "var(--aza)" }}>
                    <Icon name="arrow_out" size={12}/>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>To {tx.toName}</div>
                    <div className="mono" style={{ fontSize: 10, color: "var(--ink-mute)" }}>{tx.to} · {new Date(tx.t).toLocaleString()}</div>
                    {tx.memo && <div style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 2 }}>{tx.memo}</div>}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="mono" style={{ fontSize: 14, fontWeight: 600, color: tx.currency === "cinder" ? "var(--cinder)" : "var(--aza)" }}>−{fmt(tx.amount)} {tx.currency === "cinder" ? "CDR" : "AZA"}</div>
                  <div className="mono" style={{ fontSize: 10, color: "var(--ink-mute)" }}>{tx.id}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   PAGE: DIRECTORY
   ============================================================ */
function PageDirectory({ account, onSend }) {
  const [q, setQ] = useState("");
  const dir = Array.isArray(account && account.directory) ? account.directory : [];
  // Build display rows from the REAL boe_directory only — i.e. players
  // who actually have a Bank of Ethos account. Each row gets a stable
  // initials/avatar derived from the label.
  const myHandle = (account && account.handle || "").toLowerCase();
  const rows = useMemo(() => {
    const all = dir
      .filter(d => d && d.handle)
      .map(d => {
        const label = d.label || d.handle || "Operator";
        const initials = (label.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("") || "OP").toUpperCase();
        return { handle: d.handle, label: label, initials: initials, isMe: d.handle && d.handle.toLowerCase() === myHandle };
      });
    const s = q.trim().toLowerCase();
    if (!s) return all;
    return all.filter(c => c.handle.toLowerCase().includes(s) || c.label.toLowerCase().includes(s));
  }, [dir, q, myHandle]);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-crumb">Treasury / Directory</div>
          <div className="page-title display">Player Directory</div>
        </div>
        <div className="page-actions">
          <button className="btn primary" onClick={() => onSend(null)}><Icon name="arrow_out" size={14}/> Send to handle</button>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-b row" style={{ gap: 12 }}>
          <div className="search" style={{ flex: 1 }}>
            <Icon name="search" size={14}/>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Bank of Ethos holders by handle or callsign…" />
          </div>
          <span className="chip">{rows.length} Bank of Ethos accounts</span>
        </div>
      </div>

      <div className="panel">
        {rows.length === 0 ? (
          <div className="panel-b muted" style={{ fontSize: 12, padding: 22, textAlign: "center" }}>
            No Bank of Ethos accounts found. <span style={{ color: "var(--ink-mute)" }}>(none)</span>
          </div>
        ) : (
          <table className="t">
            <thead>
              <tr><th>Account</th><th>Handle</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.handle}>
                  <td>
                    <div className="row" style={{ gap: 10 }}>
                      <div className="merc-av" style={{ background: "linear-gradient(135deg, #8a6bff, #ff7a3d)", width: 32, height: 32, fontSize: 11 }}>{c.initials}</div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{c.label} {c.isMe && <span className="chip" style={{ marginLeft: 6 }}>You</span>}</div>
                    </div>
                  </td>
                  <td className="mono" style={{ color: "var(--violet)" }}>{c.handle}</td>
                  <td style={{ textAlign: "right" }}>
                    {!c.isMe && <button className="btn sm" onClick={() => onSend({ handle: c.handle, callsign: c.label, initials: c.initials, c1: "#8a6bff", c2: "#ff7a3d" })}><Icon name="arrow_out" size={11}/> Send</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   TOAST HOST
   ============================================================ */
function ToastHost({ toasts }) {
  return (
    <div className="toast-wrap">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.tone || ""}`}>
          <div className="title">{t.title}</div>
          <div className="body">{t.body}</div>
        </div>
      ))}
    </div>
  );
}

/* ============================================================
   MOUNT
   ============================================================ */
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
