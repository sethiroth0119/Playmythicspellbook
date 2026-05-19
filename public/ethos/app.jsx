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
const CinderGlyph = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24">
    <defs>
      <radialGradient id="cg" cx="35%" cy="30%">
        <stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
        <stop offset="60%" stopColor="#ffb066" stopOpacity="0" />
      </radialGradient>
    </defs>
    <path d="M12 3c1.2 3.4 5 4.6 5 9a5 5 0 11-10 0c0-2.8 1.8-3.8 2-6.5 2 1 2 3.2 3 -2.5z" fill="#fff" opacity="0.95" />
    <ellipse cx="10" cy="10" rx="4" ry="3" fill="url(#cg)" />
  </svg>
);
const AzaGlyph = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24">
    <defs>
      <radialGradient id="ag" cx="35%" cy="30%">
        <stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
        <stop offset="60%" stopColor="#8ff0ff" stopOpacity="0" />
      </radialGradient>
    </defs>
    <polygon points="12,3 19,8 19,16 12,21 5,16 5,8" fill="#06222b" />
    <polygon points="12,5 17,8.5 17,15.5 12,19 7,15.5 7,8.5" fill="none" stroke="#fff" strokeWidth="1.4" opacity="0.95" />
    <text x="12" y="14.5" textAnchor="middle" fontSize="7" fontFamily="Space Grotesk" fontWeight="700" fill="#fff">A</text>
    <ellipse cx="10" cy="10" rx="4" ry="3" fill="url(#ag)" />
  </svg>
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
const BrandMark = () => (
  <svg viewBox="0 0 40 40">
    <defs>
      <linearGradient id="bm" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#8a6bff" />
        <stop offset="100%" stopColor="#ff7a3d" />
      </linearGradient>
    </defs>
    <rect x="2" y="2" width="36" height="36" fill="url(#bm)" />
    <path d="M10 28V14l10-6 10 6v14" fill="none" stroke="#fff" strokeWidth="1.6" />
    <path d="M14 28V18M20 28V16M26 28V18M8 30h24" stroke="#fff" strokeWidth="1.6" strokeLinecap="square" />
  </svg>
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
        var next = Object.assign({}, prev || {}, {
          handle: d.handle || (prev && prev.handle) || 'operator',
          callsign: d.callsign || (prev && prev.callsign) || 'Operator',
          cinder: Math.max(0, Number(d.cinder) || 0),
          aza: Math.max(0, Number(d.aza) || 0),
          _gameLinked: true,
        });
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
          {route === "vaults" && <PageVaults role={role} account={account} liveCinder={liveCinder} sessionSec={sessionSec} onSend={() => setSendTo({})} />}
          {route === "transfers" && <PageTransfers account={account} transfers={transfers} onSend={(c) => setSendTo(c || {})} />}
          {route === "directory" && <PageDirectory account={account} onSend={(c) => setSendTo(c)} />}
          {route === "ledger" && <PageLedger transfers={transfers} />}
          {route === "loans" && <PageLoans />}
          {route === "mercs" && <PageMercs role={role} sessionSec={sessionSec} liveCinder={liveCinder} running={running} setRunning={setRunning} />}
          {route === "contracts" && <PageContracts />}
          {route === "ops" && <PageOpsVault />}
          {route === "market" && <PageMarket />}
          {route === "charts" && <PageCharts />}
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
  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-crumb">Treasury / Vaults Overview</div>
          <div className="page-title display">{account.callsign}'s Vault</div>
        </div>
        <div className="page-actions">
          <button className="btn ghost"><Icon name="download" size={14} /> Statement</button>
          <button className="btn" onClick={onSend}><Icon name="arrow_out" size={14} /> Send</button>
          <button className="btn primary"><Icon name="arrow_in" size={14} /> Deposit</button>
        </div>
      </div>

      {/* dual balance + recent metrics */}
      <div className="grid g-2" style={{ marginBottom: 14 }}>
        <BalanceCard kind="cinder" amount={account.cinder} delta="+4.2%" spark={SPK_CINDER} onSend={onSend} />
        <BalanceCard kind="aza"    amount={account.aza}    decimals={2} delta="-0.6%" spark={SPK_AZA} onSend={onSend} />
      </div>

      <div className="grid g-4" style={{ marginBottom: 14 }}>
        <Metric k="Mercenaries Online" v="7" d="+2 since 04:00" dir="up" />
        <Metric k="Live Profit Feed (24h)" v="142,820" sub={<><CinderGlyph size={11}/> CDR</>} d="+12.4%" dir="up" />
        <Metric k="Payroll Outstanding" v="68,400" sub={<><CinderGlyph size={11}/> CDR</>} d="-3.1%" dir="down" />
        <Metric k="Active Loans" v="2 · 332,500" sub={<><AzaGlyph size={11}/> mixed</>} />
      </div>

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
function BalanceCard({ kind, amount, decimals = 0, delta, spark, onSend }) {
  const isCinder = kind === "cinder";
  const color = isCinder ? "var(--cinder)" : "var(--aza)";
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
        <span className="sub" style={{ marginLeft: 8 }}>{isCinder ? "CDR" : "AZA"}</span>
      </div>
      <div className="bal-row" style={{ position: "relative", zIndex: 1 }}>
        <span className="chip" style={{ color: delta.startsWith("+") ? "var(--good)" : "var(--bad)", borderColor: delta.startsWith("+") ? "rgba(90,226,138,0.3)" : "rgba(255,107,138,0.3)" }}>
          {delta.startsWith("+") ? "▲" : "▼"} {delta} · 24h
        </span>
        <div className="row" style={{ gap: 6 }}>
          <button className="chip-btn" onClick={onSend}>Send</button>
          <button className="chip-btn">Receive</button>
          <button className="chip-btn">Swap</button>
        </div>
      </div>
      <div className="bal-foot" style={{ position: "relative", zIndex: 1 }}>
        <div style={{ flex: 1 }}><div className="k">Available</div><div className="v">{fmt(amount * 0.92, { decimals })}</div></div>
        <div style={{ flex: 1 }}><div className="k">Pledged</div><div className="v">{fmt(amount * 0.06, { decimals })}</div></div>
        <div style={{ flex: 1 }}><div className="k">Pending</div><div className="v">{fmt(amount * 0.02, { decimals })}</div></div>
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
function PageMercs({ role, sessionSec, liveCinder, running, setRunning }) {
  const [filter, setFilter] = useState("all");
  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-crumb">Operations / Mercenaries</div>
          <div className="page-title display">Mercenary Operations</div>
        </div>
        <div className="page-actions">
          <button className="btn ghost"><Icon name="download" size={14} /> Work reports</button>
          <button className="btn primary"><Icon name="plus" size={14} /> Hire mercenary</button>
        </div>
      </div>

      {/* Featured live contract */}
      <div className="clock-panel" style={{ marginBottom: 14 }}>
        <div className="row between" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 18 }}>
          <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
            <div className="merc-av" style={{ width: 64, height: 64, fontSize: 22, background: "linear-gradient(135deg, #ff7a3d, #8a6bff)" }}>VK</div>
            <div>
              <div className="label">Featured contract · live</div>
              <div className="display" style={{ fontSize: 22, fontWeight: 600 }}>Vash Korr <span className="muted" style={{ fontWeight: 400 }}>under</span> Camp Heights Recovery Div.</div>
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                <span className="chip violet">Roguelite + Ranked</span>
                <span className="chip cinder">60 / 40 default split</span>
                <span className="chip">Contract #C-204A</span>
              </div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="label">Session · auto clock-out at 08:00:00</div>
            <div className="clock-time mono">{fmtTime(sessionSec)}<span className="ms"> / 08:00:00</span></div>
            <div className="row" style={{ justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
              <button className="btn sm" onClick={() => setRunning(r => !r)}>
                <Icon name={running ? "pause" : "play"} size={12} /> {running ? "Pause stream" : "Resume"}
              </button>
              <button className="btn sm danger"><Icon name="x" size={12} /> Force clock-out</button>
            </div>
          </div>
        </div>

        <div className="bar" style={{ marginTop: 18, marginBottom: 18 }}>
          <div style={{ width: `${(sessionSec / (8*3600)) * 100}%`, background: "linear-gradient(90deg, var(--violet), var(--cinder))" }}></div>
        </div>

        <div className="grid g-4">
          <SmallStat k="Battles completed" v="14" cur={null} />
          <SmallStat k="Roguelite runs" v="3" cur={null} />
          <SmallStat k="Cinder generated" v={fmt(liveCinder)} cur="cinder" />
          <SmallStat k="Loot recovered" v="47 items" sub="Ether ×42 · Relics ×3 · Cards ×2" cur={null} />
          <SmallStat k="Mercenary earns (60%)" v={fmt(Math.round(liveCinder * 0.6))} cur="cinder" />
          <SmallStat k="Employer earns (40%)" v={fmt(Math.round(liveCinder * 0.4))} cur="cinder" />
          <SmallStat k="Live tick rate" v="+12 / sec" cur="cinder" />
          <SmallStat k="Time remaining" v={fmtTime(8*3600 - sessionSec)} cur={null} />
        </div>
      </div>

      {/* Filter tabs */}
      <div className="tabs">
        {[
          { id: "all", label: "All mercenaries" },
          { id: "online", label: "Online · 7" },
          { id: "near", label: "Near limit · 1" },
          { id: "history", label: "Session history" },
        ].map(t => (
          <div key={t.id} className={`tab ${filter === t.id ? "active" : ""}`} onClick={() => setFilter(t.id)}>{t.label}</div>
        ))}
      </div>

      {/* Mercenary table */}
      <div className="panel">
        <table className="t">
          <thead>
            <tr>
              <th>Mercenary</th>
              <th>Current task</th>
              <th>Clocked in</th>
              <th>Battles · Runs</th>
              <th>Cinder generated</th>
              <th>Loot value</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {MERCS.map(m => (
              <tr key={m.name}>
                <td>
                  <div className="row" style={{ gap: 10 }}>
                    <div className="merc-av" style={{ background: `linear-gradient(135deg, ${m.color1}, ${m.color2})` }}>{m.tag}</div>
                    <div>
                      <div style={{ fontWeight: 600 }}>{m.name}</div>
                      <div className="label" style={{ marginTop: 2 }}>Rank B · Reputation 84</div>
                    </div>
                  </div>
                </td>
                <td className="dim">{m.task}</td>
                <td className="mono">{fmtTime(m.in)}</td>
                <td className="mono">{m.battles} · {m.runs}</td>
                <td><span className="row" style={{ gap: 6 }}><CinderGlyph size={12} /><span className="mono" style={{ color: "var(--cinder)" }}>{fmt(m.cinder)}</span></span></td>
                <td><span className="row" style={{ gap: 6 }}><AzaGlyph size={12} /><span className="mono" style={{ color: "var(--aza)" }}>{fmt(Math.round(m.cinder * 0.18))}</span></span></td>
                <td><span className={`chip ${m.status === "warn" ? "warn" : "live"}`}>{m.status === "warn" ? <><span className="dot" style={{ background: "var(--warn)" }}></span>2h to limit</> : <><span className="live-dot"></span>Live</>}</span></td>
                <td><button className="btn sm">Manage</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
function PageOpsVault() {
  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-crumb">Operations / Ops Vault</div>
          <div className="page-title display">Operation Vault — Camp Heights</div>
        </div>
        <div className="page-actions">
          <button className="btn ghost"><Icon name="eye" size={14}/> Audit log</button>
          <button className="btn"><Icon name="market" size={14}/> List on Market</button>
          <button className="btn primary"><Icon name="arrow_out" size={14}/> Transfer</button>
        </div>
      </div>

      <div className="grid g-4" style={{ marginBottom: 14 }}>
        <Metric k="Total resources" v="11,923 units" sub="14 types" />
        <Metric k="Cards stored" v="64" sub="3 legendary" />
        <Metric k="Relics secured" v="8" sub="2 unique" />
        <Metric k="Vault value · CDR eq" v="1.84M" d="+8.2%" dir="up" />
      </div>

      <div className="tabs">
        <div className="tab active">Resources</div>
        <div className="tab">Cards (64)</div>
        <div className="tab">Relics (8)</div>
        <div className="tab">Craft Materials</div>
        <div className="tab">Payroll Log</div>
      </div>

      <div className="grid g-3">
        {RESOURCES.map(r => (
          <div key={r.name} className="panel" style={{ padding: 16 }}>
            <div className="row" style={{ gap: 12 }}>
              <div style={{ width: 56, height: 56, background: `linear-gradient(135deg, ${r.tone}, transparent)`, border: "1px solid var(--hair)", display: "flex", alignItems: "center", justifyContent: "center", color: r.tone }}>
                <Icon name={r.icon} size={26} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{r.name}</div>
                <div className="row" style={{ gap: 8, marginTop: 4 }}>
                  <span className="mono" style={{ fontSize: 20, fontWeight: 600 }}>{fmt(r.qty)}</span>
                  <span className="label">units</span>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="label">Last in</div>
                <div className="mono" style={{ fontSize: 11 }}>4m ago</div>
              </div>
            </div>
            <div className="bar" style={{ marginTop: 14 }}><div style={{ width: `${Math.min(100, r.qty/50)}%`, background: r.tone }}></div></div>
            <div className="row between" style={{ marginTop: 12 }}>
              <span className="label">Market · {fmt(r.qty * (12 + Math.random()*8), { decimals: 0 })} AZA</span>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn sm ghost">Transfer</button>
                <button className="btn sm">List</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   PAGE: MARKETPLACE
   ============================================================ */
function PageMarket() {
  const [tab, setTab] = useState("all");
  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-crumb">Economy / Marketplace</div>
          <div className="page-title display">Bank of Ethos Marketplace</div>
        </div>
        <div className="page-actions">
          <button className="btn ghost"><Icon name="eye" size={14}/> My listings · 4</button>
          <button className="btn"><Icon name="bolt" size={14}/> Create auction</button>
          <button className="btn primary"><Icon name="plus" size={14}/> List item</button>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 14, gap: 8, flexWrap: "wrap" }}>
        <div className="search" style={{ flex: "1 1 280px" }}>
          <Icon name="search" size={14} />
          <input placeholder="Search cards, resources, loot, materials…" />
        </div>
        <button className="btn">All items</button>
        <button className="btn ghost">Cards</button>
        <button className="btn ghost">Resources</button>
        <button className="btn ghost">Relics</button>
        <button className="btn ghost">Materials</button>
        <button className="btn ghost">Auctions</button>
        <div style={{ flex: 1 }}></div>
        <button className="btn ghost">Pay in <CinderGlyph size={12}/> CDR</button>
        <button className="btn ghost">Pay in <AzaGlyph size={12}/> AZA</button>
      </div>

      <div className="grid g-4">
        {MARKET.map((m, i) => (
          <div key={i} className={`listing rarity-${m.rarity}`}>
            <div className="img">
              <span className="rarity-tag" style={{ color: m.rarity === "legend" ? "var(--warn)" : m.rarity === "epic" ? "var(--cinder)" : "var(--violet)" }}>{m.rarityLabel}</span>
              <Icon name={m.glyph} size={56} className="glyph" />
            </div>
            <div className="body">
              <div className="name">{m.name}</div>
              <div className="meta">
                <span>by {m.seller}</span>
                <span>×{m.stock}</span>
              </div>
            </div>
            <div className="price">
              <span className="amt row" style={{ gap: 6, color: m.currency === "cinder" ? "var(--cinder)" : "var(--aza)" }}>
                {m.currency === "cinder" ? <CinderGlyph size={14}/> : <AzaGlyph size={14}/>}
                {fmt(m.price)}
              </span>
              <button className={`btn sm ${m.currency === "cinder" ? "cinder" : "aza"}`}>Buy</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   PAGE: LOANS
   ============================================================ */
function PageLoans() {
  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-crumb">Treasury / Loans</div>
          <div className="page-title display">Loans & Credit Lines</div>
        </div>
        <div className="page-actions">
          <button className="btn ghost">Repayment schedule</button>
          <button className="btn primary"><Icon name="plus" size={14}/> Apply for loan</button>
        </div>
      </div>

      <div className="grid g-4" style={{ marginBottom: 14 }}>
        <Metric k="Active loans" v="2" sub="332,500 outstanding" />
        <Metric k="Avg APR" v="5.5%" d="−0.4 pts" dir="up" />
        <Metric k="Credit score" v="784 · A−" d="+12 this cycle" dir="up" />
        <Metric k="Approved ceiling" v="1.2M CDR eq" sub="based on vault wealth" />
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1.4fr 1fr", gap: 14 }}>
        <div className="panel">
          <div className="panel-h"><h3>Active & past loans</h3><span className="label">3 records</span></div>
          <table className="t">
            <thead><tr><th>ID</th><th>Type</th><th>Principal</th><th>APR</th><th>Term · remaining</th><th>Progress</th><th>Status</th></tr></thead>
            <tbody>
              {LOANS.map(l => (
                <tr key={l.id}>
                  <td className="mono">{l.id}</td>
                  <td>{l.type}</td>
                  <td>
                    <span className="row" style={{ gap: 6 }}>
                      {l.currency === "cinder" ? <CinderGlyph size={12}/> : <AzaGlyph size={12}/>}
                      <span className="mono" style={{ color: l.currency === "cinder" ? "var(--cinder)" : "var(--aza)" }}>{fmt(l.principal)}</span>
                    </span>
                  </td>
                  <td className="mono">{l.apr}%</td>
                  <td className="mono">{l.term}d · {l.remaining}d</td>
                  <td style={{ minWidth: 140 }}>
                    <div className="bar" style={{ marginBottom: 4 }}><div style={{ width: `${(l.paid/l.principal)*100}%` }}></div></div>
                    <span className="mono" style={{ fontSize: 10, color: "var(--ink-mute)" }}>{fmt(l.paid)} / {fmt(l.principal)}</span>
                  </td>
                  <td>
                    {l.status === "active"
                      ? <span className="chip live"><span className="live-dot"></span>Active</span>
                      : <span className="chip"><span className="dot" style={{ background: "var(--ink-mute)" }}></span>Closed</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="panel-h"><h3>Loan products</h3></div>
          <div>
            {[
              { name: "Business Loan",           apr: "4.5–7.2%", max: "500K CDR" },
              { name: "Mercenary Payroll Loan",  apr: "3.8–6.0%", max: "300K CDR", featured: true },
              { name: "Corporation Expansion",   apr: "5.0–9.0%", max: "2M AZA" },
              { name: "Base Upgrade",            apr: "5.5–8.0%", max: "150K AZA" },
              { name: "Real Estate",             apr: "6.0–10%",  max: "1.5M AZA" },
              { name: "Resource Operation",      apr: "4.0–6.5%", max: "200K CDR" },
            ].map(p => (
              <div key={p.name} className="row between" style={{ padding: "12px 16px", borderBottom: "1px solid var(--hair)", background: p.featured ? "linear-gradient(90deg, rgba(138,107,255,0.08), transparent)" : "transparent" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name} {p.featured && <span className="chip violet" style={{ marginLeft: 6 }}>Pre-approved</span>}</div>
                  <div className="label" style={{ marginTop: 2 }}>APR {p.apr} · up to {p.max}</div>
                </div>
                <button className="btn sm">Apply →</button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 14 }}>
        <div className="panel-h"><h3>Approval factors</h3><span className="label">Your standing</span></div>
        <div className="panel-b">
          <div className="grid g-3" style={{ gap: 18 }}>
            {[
              { k: "Vault wealth",        v: 92 },
              { k: "Business ownership",  v: 78 },
              { k: "Battle activity",     v: 88 },
              { k: "Economic reputation", v: 84 },
              { k: "Repayment history",   v: 96 },
              { k: "Corporation status",  v: 70 },
            ].map(f => (
              <div key={f.k}>
                <div className="row between" style={{ marginBottom: 6 }}><span className="label">{f.k}</span><span className="mono" style={{ fontSize: 12 }}>{f.v}/100</span></div>
                <div className="bar"><div style={{ width: `${f.v}%`, background: f.v > 85 ? "var(--good)" : f.v > 75 ? "var(--violet)" : "var(--warn)" }}></div></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   PAGE: LEDGER
   ============================================================ */
function PageLedger({ transfers = [] }) {
  // merge user transfers (most recent first) with mock ledger entries
  const merged = [
    ...transfers.map(tx => ({
      t: new Date(tx.t).toLocaleTimeString("en-US", { hour12: false }),
      type: "P2P Send",
      actor: tx.toName + " · " + tx.to,
      memo: tx.memo || "Player-to-player transfer",
      amt: -tx.amount,
      cur: tx.currency,
    })),
    ...LEDGER,
  ];
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
                <td className="mono" style={{ textAlign: "right", color: e.amt === null ? "var(--ink-dim)" : (e.amt > 0 ? "var(--good)" : "var(--bad)"), fontWeight: 600 }}>
                  {e.amt === null ? "—" : `${e.amt > 0 ? "+" : ""}${fmt(e.amt)}`}
                </td>
                <td>
                  {e.cur === "cinder" && <span className="row" style={{ gap: 6 }}><CinderGlyph size={12}/><span className="mono dim">CDR</span></span>}
                  {e.cur === "aza" && <span className="row" style={{ gap: 6 }}><AzaGlyph size={12}/><span className="mono dim">AZA</span></span>}
                  {e.cur === null && <span className="dim mono">items</span>}
                </td>
                <td><button className="btn sm ghost">View</button></td>
              </tr>
            ))}
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
  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-crumb">Treasury / Send & Request</div>
          <div className="page-title display">Send & Request</div>
        </div>
        <div className="page-actions">
          <button className="btn ghost"><Icon name="arrow_in" size={14}/> Request Cinder</button>
          <button className="btn primary" onClick={() => onSend()}><Icon name="arrow_out" size={14}/> Send money</button>
        </div>
      </div>

      <div className="grid g-2" style={{ marginBottom: 14 }}>
        <BalanceCard kind="cinder" amount={account.cinder} delta="+4.2%" spark={SPK_CINDER} onSend={() => onSend()} />
        <BalanceCard kind="aza"    amount={account.aza}    decimals={2} delta="-0.6%" spark={SPK_AZA} onSend={() => onSend()} />
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
  const results = useMemo(() => {
    const s = q.trim().toUpperCase();
    if (!s) return DIRECTORY;
    return DIRECTORY.filter(c => c.handle.toUpperCase().includes(s) || c.callsign.toUpperCase().includes(s));
  }, [q]);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-crumb">Treasury / Directory</div>
          <div className="page-title display">Player Directory</div>
        </div>
        <div className="page-actions">
          <button className="btn ghost"><Icon name="plus" size={14}/> Save contact</button>
          <button className="btn primary" onClick={() => onSend(null)}><Icon name="arrow_out" size={14}/> Send to handle</button>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-b row" style={{ gap: 12 }}>
          <div className="search" style={{ flex: 1 }}>
            <Icon name="search" size={14}/>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by callsign or ETH-XXXX handle…" />
          </div>
          <span className="chip">{results.length} accounts</span>
          <span className="chip live"><span className="live-dot"></span>{results.filter(r => r.online).length} online</span>
        </div>
      </div>

      <div className="panel">
        <table className="t">
          <thead>
            <tr><th>Account</th><th>Handle</th><th>Status</th><th>Reputation</th><th>Type</th><th></th></tr>
          </thead>
          <tbody>
            {results.map(c => (
              <tr key={c.handle}>
                <td>
                  <div className="row" style={{ gap: 10 }}>
                    <div className="merc-av" style={{ background: `linear-gradient(135deg, ${c.c1}, ${c.c2})`, width: 32, height: 32, fontSize: 11 }}>{c.initials}</div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{c.callsign}</div>
                  </div>
                </td>
                <td className="mono" style={{ color: "var(--violet)" }}>{c.handle}</td>
                <td>
                  {c.online
                    ? <span className="chip live"><span className="live-dot"></span>Online</span>
                    : <span className="chip"><span className="dot" style={{ background: "var(--ink-mute)" }}></span>Offline</span>}
                </td>
                <td>
                  <div className="row" style={{ gap: 8 }}>
                    <div className="bar" style={{ width: 90 }}><div style={{ width: `${c.rep}%`, background: c.rep > 85 ? "var(--good)" : "var(--violet)" }}></div></div>
                    <span className="mono" style={{ fontSize: 12 }}>{c.rep}</span>
                  </div>
                </td>
                <td className="dim" style={{ fontSize: 12 }}>{c.tag}</td>
                <td style={{ textAlign: "right" }}>
                  <button className="btn sm" onClick={() => onSend(c)}><Icon name="arrow_out" size={11}/> Send</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
