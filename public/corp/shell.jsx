/* shell.jsx — sidebar, topbar, ticker, shared atoms (asset glyphs, rarity strips, etc.) */

const { useState, useEffect, useMemo, useRef, useCallback } = React;

// ──────────────────────────────────────────────────────────────────────────
// Utilities
// ──────────────────────────────────────────────────────────────────────────

const fmt = (n) => {
  if (n == null) return '—';
  if (Math.abs(n) >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (Math.abs(n) >= 1)    return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return n.toFixed(2);
};
const fmtAza = (n) => `${fmt(n)} Aza coin`;
/* Integer money. Deliberately NOT fmt(): fmt(0) returns "0.00" and
   fmt(null) returns "—", and a treasury with no movements is required to
   read as a plain 0 rather than a dash or a decimal. Anything non-finite
   collapses to 0, so NaN/undefined can never reach a balance on screen. */
const fmtC = (n) => {
  const v = Number(n);
  return (isFinite(v) ? Math.round(v) : 0).toLocaleString('en-US');
};

/* The RAW integer behind fmtC — the value, before it is formatted. This
   exists because `x | 0` was doing this job in six places, and `| 0` is a
   32-BIT CAST, not a rounding helper: a treasury above 2,147,483,647
   wraps to a NEGATIVE balance. That is a wrong number that then also
   silently refuses every spend (every gate is written `treasury < cost`)
   and disagrees with `select sum(amount) from corp_treasury`, which the
   headline is required to equal TO THE UNIT. Non-finite collapses to 0,
   so NaN/undefined can never reach a balance or a comparison either.
   Rejected: Math.trunc — the ledger stores numeric, and truncating a
   fractional row would make the sum on screen disagree with the sum in
   the database by up to a unit per row. corpTreasuryFetch() rounds the
   same way, so the two round trips agree. */
const numC = (n) => { const v = Number(n); return isFinite(v) ? Math.round(v) : 0; };

const RAR = window.ECON.RARITY;

// ──────────────────────────────────────────────────────────────────────────
// 📮 Corp activity feed — shared helpers (Mailbox screen + sidebar badge)
// ──────────────────────────────────────────────────────────────────────────
// The feed itself is assembled in the parent game (_jbActivityFetch) from five
// existing ledgers and arrives as econ.corpActivity. These helpers live in
// shell.jsx because BOTH the badge (here) and the screen (screens.jsx, loaded
// after this file) need the identical "what counts as new" rule — two copies
// of that rule is how a badge ends up disagreeing with the list under it.

// Read-only view of the bridged feed. Always an array, so callers never guard.
const jbActivity = () => {
  const e = (window.__JB && window.__JB.econ) || null;
  return (e && Array.isArray(e.corpActivity)) ? e.corpActivity : [];
};

// Last-seen is per corporation: leaving one corp and joining another must not
// carry a stale mark that hides the new corp's whole history.
const mailSeenKey = () => {
  const e = (window.__JB && window.__JB.econ) || null;
  const id = (e && e.corp && e.corp.id) ? e.corp.id : 'none';
  return 'jb.mail.seen.' + id;
};
// localStorage throws in a partitioned/blocked iframe. A throw here must not
// take the sidebar down with it, so both accessors swallow and degrade to
// "never seen anything" — which over-counts rather than hiding activity.
const mailSeenGet = () => {
  try { return window.localStorage.getItem(mailSeenKey()) || ''; } catch (e) { return ''; }
};
const mailSeenSet = (iso) => {
  try { if (iso) window.localStorage.setItem(mailSeenKey(), iso); } catch (e) {}
  try { window.dispatchEvent(new Event('jb:mailseen')); } catch (e) {}
};
// Entries strictly newer than the mark. ISO-8601 UTC strings compare correctly
// as text (see the sort in _jbActivityFetch). An empty mark = everything new;
// an empty feed = 0, which is the whole reason the fixed "2" badge had to go.
const mailNewCount = (list, seen) => {
  const xs = Array.isArray(list) ? list : [];
  if (!seen) return xs.length;
  let n = 0;
  for (const a of xs) if (a && a.at && a.at > seen) n++;
  return n;
};

// ──────────────────────────────────────────────────────────────────────────
// Asset glyph — simple monogram tile (no hand-drawn icons; mono initials)
// ──────────────────────────────────────────────────────────────────────────

function AssetGlyph({ asset, size = 'sm' }) {
  const initials = useMemo(() => {
    const s = (asset?.name || '?').replace(/[^A-Z0-9 ]/gi, '').split(/\s+/);
    if (s.length === 1) return s[0].slice(0, 2).toUpperCase();
    return (s[0][0] + s[1][0]).toUpperCase();
  }, [asset?.name]);
  return (
    <div className={'glyph-box' + (size === 'lg' ? ' lg' : '')} data-rar={asset?.rarity}>
      {initials}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Rarity chip
// ──────────────────────────────────────────────────────────────────────────

function RarityChip({ rarity }) {
  const r = RAR[rarity] || RAR.common;
  const cls = ({
    legendary: 'aza', mythic: 'rust', unique: 'aza',
    anomaly: 'void', epic: 'void', rare: 'flat', common: 'flat',
  })[rarity] || 'flat';
  return <span className={'chip ' + cls}>{r.label}</span>;
}

// ──────────────────────────────────────────────────────────────────────────
// Trend marker
// ──────────────────────────────────────────────────────────────────────────

function Trend({ dir }) {
  const ch = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '◆';
  return <span className={'trend ' + dir + ' mono'} style={{ fontSize: 10 }}>{ch}</span>;
}

// ──────────────────────────────────────────────────────────────────────────
// Risk pips
// ──────────────────────────────────────────────────────────────────────────

function RiskPips({ level }) {
  const n = ({ low: 1, medium: 2, high: 3, extreme: 4 })[level] || 0;
  return (
    <span className="risk" data-r={level} title={`Risk: ${level}`}>
      {[0,1,2,3].map(i => <i key={i} data-on={i < n ? '1' : '0'} />)}
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Sidebar
// ──────────────────────────────────────────────────────────────────────────

// 🏦 The bank's back office. Labelled with the bank's OWN name — an owner
// looking for "Ashford & Keel" should not have to recognise a generic "Bank".
//
// ⚠ Shown when the player owns the bank OPERATION *or* holds a charter — NOT
// on `bankName` alone. bankName comes from the charter row, so gating on it
// hid this entry from exactly the players whose charter is missing, which is
// the one situation where they most need to get in: the back office's own
// "No bank yet" state carries the button that opens/repairs the charter.
// Hiding the door because the room is empty is how "I own a bank and there is
// nowhere to go" happened.
function bankNavRow(econ) {
  if (!econ) return null;
  const nm = econ.bankName;
  if (!nm && !econ.ownsBankOp) return null;
  return { id: 'bankOffice', label: String(nm || 'My Bank').slice(0, 22), ico: '🏦', action: 'openBankOffice' };
}
const NAV = [
  { group: 'Holdings' },
  { id: 'vault',      label: 'Vault',          ico: '◇' },
  { id: 'corp',       label: 'Corp Treasury',  ico: '◈' },
  { id: 'guild',      label: 'Guild & Hiring', ico: '👥', modal: 'guild' },
  { id: 'operations', label: 'Operations',     ico: '⛏' },
  /* No badge. It carried a literal `badge: 3` that never moved for anyone,
     and there is still no unread/attention count for freight to bind one
     to — so the field is GONE rather than faked or hidden at render. */
  { id: 'logistics',  label: 'Logistics',      ico: '⇄' },
  { group: 'Economy' },
  { id: 'market',     label: 'Marketplace',    ico: '▤' },
  // 🚗 Player-to-player vehicle marketplace — no corp required.
  // Triggers parent-window navigation to the standalone Vehicle Market
  // screen via the existing jb:open bridge.
  { id: 'vehicleMarket', label: 'Vehicle Market', ico: '🚗', action: 'openVehicleMarket' },
  /* 📦 Hire storage from other players. Deliberately in Economy rather than
     under My Companies: the player who needs this most is the one who does NOT
     own a warehouse and keeps hitting STASH FULL, so gating it behind owning
     one would hide it from its whole audience. */
  { id: 'storageMarket', label: 'Ceiling Space', ico: '📊', action: 'openStorageMarket' },
  { id: 'realestate', label: 'Real Estate',    ico: '⌂' },
  /* No literal badge here either. It carried `badge: '6'`, which the render
     below already ignores in favour of the real BLACK_MARKET length — so the
     constant was dead, but a dead fabricated number sitting in the nav table
     is one prop-rename away from being lit again. Removed rather than left
     shadowed. The count comes from app.jsx's blackCount. */
  { id: 'black',      label: 'Black Market',   ico: '▥', badgeCls: 'toxic' },
  { id: 'feed',       label: 'Guild Wire',      ico: '☷' },
  { group: 'Comms' },
  /* 📮 No literal badge. It used to be `badge: 2` — a constant lit next to an
     inbox that was hardcoded empty, so it advertised two messages that could
     not exist. The count is computed in Sidebar from the real activity feed. */
  { id: 'mail',       label: 'Mailbox',        ico: '✉', badgeCls: 'alert' },
  { id: 'trade',      label: 'Trade Window',   ico: '⇋' },
];

// Map of op_type → door, or op_type → [door, door, …], where a door is
// { label, ico, action } for an op that has a dedicated mini-game accessed from
// the sidebar. Owned ops appear under "My Companies", one row per door.
// An op may own SEVERAL doors (see `oil`), so the value is a list wherever one
// op reaches more than one screen; `companyDoors` flattens either shape.
const COMPANY_PAGES = {
  fishing: { label: 'Woods Fishing',          ico: '⚓', action: 'openWoodsFishing' },
  cars:    { label: 'Prince Portfolios',      ico: '🚗', action: 'openPrincePortfolios' },
  /* ⛽🛢 TWO DOORS ON ONE OP. This object used to declare `oil` twice — once
     here for Black River Petroleum and once further down for The Cracking Yard.
     A duplicate key in an object literal is not an error, the later one simply
     wins, so every oil owner silently lost the Black River door while the
     comment on the surviving entry went on calling the operation "the unlock"
     for a screen that had vanished from the menu. Both screens are real
     (index.html's JB_action handles 'openBlackRiver' at its ⛽ block and
     'openRefinery' at its 🛢 block) and the refinery's own contract screen
     tells players to take work "Black River Petroleum → Refinery Complex", so
     the fix is one key that owns both doors, not a choice between them. Owning
     the `oil` operation IS the unlock for both, the same rule as the lab and
     the hospital — no second flag to drift out of step. */
  oil: [
    { label: 'Black River Petroleum',  ico: '⛽', action: 'openBlackRiver' },
    { label: 'The Cracking Yard',      ico: '🛢️', action: 'openRefinery' },
  ],
  gas:     { label: 'Ethos Fuel Command',     ico: '⛽', action: 'openFuelCommand' },
  /* 🔧 The bench. Keyed on the OPS_ECON op id ('weaponsmith'), so the entry
     appears only once the operation is actually founded — which is the same
     gate the licence uses, rather than a second copy of that rule living here.
     'openWeaponSmith' is already handled by index.html; this is the emitter it
     was waiting on. */
  weaponsmith: { label: 'The Weapon Smith',   ico: '🔧', action: 'openWeaponSmith' },
  /* 📦 Keyed on the OPS_ECON op id, so the entry appears the moment a Warehouse
     is founded and never before. The office is where an owner rents spare
     capacity out; the market below is open to everyone. */
  warehouse:   { label: 'Warehouse',          ico: '📦', action: 'openWarehouse' },
  /* 🚛 Reported missing: "the transport company is not showing in just business
     so we can see the functions". Keyed on the OPS_ECON id, so the row appears
     the moment a Transportation Company is founded and never before — the same
     gate every entry above uses. It opens the haulage board, which is the
     function a haulier actually needs: see contracts, take one, track it. */
  transport:   { label: 'Haulage Board',     ico: '🚛', action: 'openHaulBoard' },
  /* 🌾 Keyed on the OPS_ECON op id like every row above: the Homestead Farm
     appears the moment a Feed Operation is founded. 'openFarm' is handled in
     index.html's JB_action. */
  feed:        { label: 'Homestead Farm',     ico: '🐄', action: 'openFarm' },
  /* 🍔 Keyed on the OPS_ECON op id, so the entry appears the moment a
     Restaurant is founded and never before — the same gate the licence uses
     rather than a second copy of that rule. 'openMythicKitchen' is handled
     in index.html's JB_action; this is the emitter it was waiting on. */
  restaurant:  { label: 'Mythic Kitchen',     ico: '🍔', action: 'openMythicKitchen' },
  /* ☣️ THE RESEARCH FACILITY'S MINIGAME. Asked for: "when the Research Facility
     operation is purchased in Just Business give that player access to the
     Containment Lab mini game — it should appear in My Companies."
     Keyed on the OPS_ECON op id ('research'), so the row appears the moment the
     operation is founded and never before — the same gate every entry above
     uses, rather than a second copy of that rule. Buying the facility IS the
     unlock; there is no separate flag to get out of step with it.
     'openContainmentLab' is handled in index.html's JB_action. */
  research:    { label: 'Containment Lab',    ico: '☣️', action: 'openContainmentLab' },
  /* 🏥 The far end of the same pipe. 'openHospital' is handled in index.html's
     JB_action; owning the operation IS the unlock, exactly as for the lab. */
  medical:     { label: 'The Hospital',       ico: '🏥', action: 'openHospital' },
  /* ♻️ THE TRASH CRUSHER OPENS THE HAULAGE BOARD, exactly as the Transportation
     Company does, and that shared destination IS the connection between the two
     businesses rather than a label claiming one.
     A crusher's product is bulky, low-value and in the wrong place — baled
     recyclate is 2🔥 a unit — so the plant only pays if somebody else moves it.
     The board is where the crusher posts a `scrap` run and a player-owned
     Transport Depot takes it: one screen, two businesses, opposite sides of the
     same contract. Giving the crusher a private shipping panel would have been
     a second haulage system that hauliers could not see.
     Keyed on the OPS_ECON op id, so the row appears the moment the operation is
     founded and never before — the same gate every entry above uses. */
  trashcrusher: { label: 'Post a Scrap Run',  ico: '♻️', action: 'openHaulBoard' },
};
// Every door an op_type opens, as a list — [] when the op has no page.
// Accepts both shapes of COMPANY_PAGES value so a single-door op stays a plain
// object and only multi-door ops pay for the brackets.
function companyDoors(opType) {
  const v = opType ? COMPANY_PAGES[opType] : null;
  if (!v) return [];
  return Array.isArray(v) ? v.filter(Boolean) : [v];
}

function Sidebar({ route, setRoute, blackCount }) {
  const { PLAYER } = window.ECON;
  const JB = (window.__JB && window.__JB.econ) || null;
  /* 📮 Mailbox badge = real activity newer than this player's last-seen mark.
     The `mailCount` prop is GONE, not ignored: it was derived from
     window.ECON.MAIL, an array hardcoded empty whose "unread" flag only ever
     moved because a button in the old inbox flipped React state, and a dead
     prop left in the signature is how a dead number comes back. app.jsx no
     longer computes or passes it. Recomputed on 'jbdata' (new
     feed) and on 'jb:mailseen' (the screen marked the feed read), so the badge
     clears the moment the Mailbox is opened rather than on the next reload. */
  const [mailNew, setMailNew] = useState(0);
  useEffect(() => {
    const recount = () => setMailNew(mailNewCount(jbActivity(), mailSeenGet()));
    recount();
    window.addEventListener('jbdata', recount);
    window.addEventListener('jb:mailseen', recount);
    return () => {
      window.removeEventListener('jbdata', recount);
      window.removeEventListener('jb:mailseen', recount);
    };
  }, []);
  const corpName = JB ? (JB.corp ? JB.corp.name : 'Independent') : PLAYER.corp;
  const corpRole = JB ? (JB.corp ? String(JB.corp.role || 'member').toUpperCase() : 'Unincorporated') : PLAYER.corpRole;
  /* 🔴 THE CORP CARD USED TO BE PURE CHROME: a fixed rank chip for a rank
     ladder that does not exist, a progress bar pinned at 64%, a rounded
     treasury constant and a war countdown — four fixed strings that never
     moved for anyone. Each is now either real or absent:
       tag      → the corporation's own tag (there is no rank ladder to show);
       bar      → seats filled, memberCount / memberCap, the same pair the
                  Guild & Hiring cap is enforced against;
       treasury → econ.corpTreasury, the SAME sum(amount) the Corp Treasury
                  screen headlines and the Fund button gates on. `unread` is
                  distinguished from zero, because "offline" is not "broke".
     There is no war timer anywhere in this game, so WAR is gone rather than
     replaced with a made-up countdown. */
  const hasCorp = !!(JB && JB.corp);
  const corpTag = hasCorp ? String(JB.corp.tag || '').toUpperCase() : '';
  const memCount = hasCorp ? ((JB.memberCount | 0) || ((JB.roster || []).length)) : 0;
  const memCap = hasCorp ? ((JB.memberCap | 0) || 25) : 0;
  const fillPct = memCap > 0 ? Math.max(0, Math.min(100, Math.round((memCount / memCap) * 100))) : 0;
  const treasStr = !hasCorp ? '—' : (JB.corpTreasuryKnown === false ? 'unread' : (fmtC(numC(JB.corpTreasury)) + ' 🔥'));

  /* 🚪 THE DOOR. "Open full vault" on the Corp Treasury screen was a dead
     <span> — a finished control with nothing behind it is this codebase's
     most-repeated defect. Route state lives in app.jsx and the nav already
     holds setRoute, so the nav is where the event lands; screens.jsx just
     fires window 'jb:route'. Re-subscribing when setRoute changes identity is
     cheaper than a ref and cannot go stale. */
  useEffect(() => {
    const onRoute = (e) => {
      const d = e && e.detail;
      if (typeof d === 'string' && d) setRoute(d);
    };
    window.addEventListener('jb:route', onRoute);
    return () => window.removeEventListener('jb:route', onRoute);
  }, [setRoute]);
  // 🏢 Owned ops the player has funded — turn each of their doors into a
  //    "My Companies" sidebar entry (one op can have several, e.g. oil).
  //    Clicking the Fishing Company tab opens the Woods Fishing maritime ops
  //    screen (handled by the parent).
  const ownedCompanies = ((JB && JB.operations) || [])
    .filter(o => o && o.op_type)
    .flatMap(o => companyDoors(o.op_type).map(door => ({
      op_type: o.op_type,
      ...door,
      workers: o.workers | 0,
      net: o.net | 0,
    })));
  return (
    <aside className="sidebar">
      <button onClick={() => { try { window.JB_back && window.JB_back(); } catch (e) {} }}
        style={{ display: 'block', width: '100%', cursor: 'pointer', margin: '0 0 12px',
          border: '1px solid rgba(212,175,55,0.5)', background: 'rgba(212,175,55,0.10)',
          /* borderRadius 4, not 8: DESIGN-BAR §3 caps a panel/control at 6px and
             every other control in this sub-app is 4 (--radius). This one is an
             INLINE style, which is why the styles.css radius sweep missed it. */
          color: '#ffcf5a', borderRadius: 4, padding: '0.5rem 0.7rem', fontWeight: 700,
          fontFamily: 'var(--f-display)', letterSpacing: '.02em', fontSize: 13 }}>
        ← Ruin Exchange
      </button>
      <div className="brand">
        <div className="mark"><span className="glyph" />Just Business</div>
        <div className="sub">PLAYER ECONOMY · v0.34</div>
      </div>
      <nav className="nav">
        {(function () {
          // Insert the owner's bank right under Operations — it IS one of their
          // businesses, so it belongs in Holdings rather than a section of its own.
          const row = bankNavRow((window.__JB && window.__JB.econ) || null);
          if (!row) return NAV;
          const i = NAV.findIndex(n => n && n.id === 'operations');
          if (i < 0) return NAV.concat([row]);
          return NAV.slice(0, i + 1).concat([row], NAV.slice(i + 1));
        })().map((n, i) => n.group ? (
          <div key={'g'+i} className="group">{n.group}</div>
        ) : (
          <button key={n.id} data-active={route === n.id ? '1' : '0'}
            onClick={() => {
              if (n.modal) { try { window.dispatchEvent(new CustomEvent('jb:open', { detail: n.modal })); } catch (e) {} }
              else if (n.action) { try { window.JB_action && window.JB_action({ kind: n.action }); } catch (e) {} }
              else { setRoute(n.id); }
            }}>
            <span className="ico mono">{n.ico}</span>
            <span>{n.label}</span>
            {n.id === 'mail' && mailNew > 0 && <span className="badge alert">{mailNew}</span>}
            {n.id === 'black' && blackCount > 0 && <span className="badge toxic">{blackCount}</span>}
            {/* 🔴 A hardcoded badge "3" sat here permanently: it never moved,
                counted nothing, and told every player forever that three
                logistics items were waiting. There is no logistics counter to
                bind it to yet, so the badge is GONE rather than faked. */}
            {n.badge != null && !['mail','black'].includes(n.id) && (
              <span className={'badge ' + (n.badgeCls || '')}>{n.badge}</span>
            )}
          </button>
        ))}

        {ownedCompanies.length > 0 && (
          <React.Fragment>
            <div className="group">My Companies</div>
            {/* Keyed on op_type AND action: one op can put two rows here
                (oil → Black River + Cracking Yard) and a key that was only the
                op_type would collide on the second. */}
            {ownedCompanies.map(c => (
              <button key={'co_' + c.op_type + '_' + c.action} data-active="0"
                title={'Open ' + c.label + ' — managed via the parent app'}
                onClick={() => {
                  try { window.JB_action && window.JB_action({ kind: c.action }); } catch (e) {}
                }}
                style={{ position: 'relative' }}>
                <span className="ico mono" style={{ color: '#6cd4ff' }}>{c.ico}</span>
                <span>{c.label}</span>
                <span className="badge" style={{
                  background: 'linear-gradient(180deg,rgba(108,212,255,0.22),rgba(108,212,255,0.06))',
                  color: '#6cd4ff', borderColor: '#6cd4ff' }}>OPEN</span>
              </button>
            ))}
          </React.Fragment>
        )}
      </nav>

      <div className="corp-card">
        <div className="row">
          <div>
            <div className="name">{corpName}</div>
            <div className="role">{corpRole}</div>
          </div>
          {hasCorp && corpTag ? <span className="chip rust">{corpTag}</span> : null}
        </div>
        {hasCorp && (
          <div className="bar" title={memCount + ' of ' + memCap + ' seats filled'}>
            <i style={{ width: fillPct + '%' }} />
          </div>
        )}
        <div className="stats">
          <span>TREASURY <b>{treasStr}</b></span>
          <span>MEMBERS <b>{hasCorp ? (memCount + '/' + memCap) : '—'}</b></span>
        </div>
      </div>
    </aside>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Topbar
// ──────────────────────────────────────────────────────────────────────────

function Topbar({ route, balances }) {
  const { PLAYER } = window.ECON;
  const _jb = (window.__JB && window.__JB.econ) || null;
  const handle = (_jb && _jb.handle) ? _jb.handle : PLAYER.handle;
  const path = ({
    vault:     ['Holdings', 'Vault'],
    corp:      ['Holdings', 'Corp Treasury'],
    logistics: ['Holdings', 'Logistics'],
    market:    ['Economy', 'Marketplace'],
    realestate:['Economy', 'Real Estate'],
    property:  ['Economy', 'Real Estate', 'Listing'],
    black:     ['Economy', 'Black Market'],
    feed:      ['Economy', 'Guild Wire'],
    mail:      ['Comms',   'Mailbox'],
    trade:     ['Comms',   'Trade'],
    relic:     ['Holdings','Vault', 'Relic'],
  })[route] || ['—'];

  return (
    <header className="topbar">
      <div className="crumb">
        {path.map((seg, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span style={{ margin: '0 8px', color: 'var(--dim)' }}>/</span>}
            {i === path.length - 1 ? <b>{seg}</b> : seg}
          </React.Fragment>
        ))}
      </div>

      <div className="spacer" />

      <div className="balances">
        <div className="bal aza">
          CINDER <span className="num">{fmt(balances.aza)}</span>
        </div>
        <div className="bal" title="Aza Coin — your premium currency">
          AZA COIN <span className="num">{fmt(balances.sovs || 0)}</span>
        </div>
        {/* Ⓜ Mythic Token. When a wallet is linked the chip says so and shows
            the address, because MT and "MT held at a linked wallet" are not the
            same claim — an unlinked player still has a balance in the Bank of
            Ethos mirror, and conflating the two would misreport ownership. */}
        <div className="bal"
             title={balances.wallet
               ? ('Mythic Token · wallet ' + String(balances.wallet).slice(0, 6) + '…' + String(balances.wallet).slice(-4))
               : 'Mythic Token — held in the Bank of Ethos. Link a wallet to hold it on-chain.'}>
          {balances.wallet ? '🦊 MYTHIC TOKEN' : 'MYTHIC TOKEN'} <span className="num">{fmt(balances.mt || 0)}</span>
        </div>
      </div>

      <button className="me" title="My Resources — view everything you hold"
        onClick={() => { try { window.dispatchEvent(new CustomEvent('jb:open', { detail: 'resources' })); } catch (e) {} }}
        style={{ cursor: 'pointer', background: 'transparent', border: 0, font: 'inherit', color: 'inherit', textAlign: 'left' }}>
        <div className="av">{String(handle).slice(0, 2).toUpperCase()}</div>
        <div>
          <div className="name">{handle}</div>
          <div className="role">My Resources ▾</div>
        </div>
      </button>
    </header>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Ticker
// ──────────────────────────────────────────────────────────────────────────

function Ticker({ events }) {
  // Render twice for seamless loop
  const row = (key) => events.map((e, i) => (
    <span key={key + i} className="ev" data-tone={e.tone}>
      <span className="tag">{e.tag}</span>
      <span>{e.text}</span>
    </span>
  ));
  return (
    <div className="ticker">
      <span className="label">LIVE</span>
      <div className="track">{row('a')}{row('b')}</div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Screen head
// ──────────────────────────────────────────────────────────────────────────

function ScreenHead({ title, desc, idTag, right }) {
  return (
    <div className="screen-head">
      <div style={{ flex: 1 }}>
        <h1>{title}</h1>
        {desc && <div className="desc" style={{ marginTop: 6 }}>{desc}</div>}
      </div>
      {right}
      {idTag && <div className="id">{idTag}</div>}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Modal
// ──────────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" style={wide ? { width: 'min(1080px, 94vw)' } : null} onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="x" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Toast host
// ──────────────────────────────────────────────────────────────────────────

function ToastHost({ toasts }) {
  return (
    <div className="toasts">
      {toasts.map(t => (
        <div key={t.id} className="toast">
          <span className={t.bad ? 'bad' : 'ok'} style={{ fontWeight: 600 }}>
            {t.bad ? 'ERR' : 'OK'}
          </span>
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Sparkline (8 bars, randomized-but-stable per seed)
// ──────────────────────────────────────────────────────────────────────────

function Sparkline({ seed = 1, bars = 10, color = 'var(--rust)' }) {
  const heights = useMemo(() => {
    let s = seed * 1337;
    return Array.from({ length: bars }, () => {
      s = (s * 9301 + 49297) % 233280;
      return 24 + ((s / 233280) * 38);
    });
  }, [seed, bars]);
  return (
    <span className="barline" style={{ '--c': color }}>
      {heights.map((h, i) => <i key={i} style={{ height: h + '%', background: i === heights.length - 1 ? color : 'color-mix(in oklab, ' + color + ' 65%, transparent)' }} />)}
    </span>
  );
}

Object.assign(window, {
  fmt, fmtAza, fmtC,
  jbActivity, mailSeenGet, mailSeenSet, mailNewCount,
  AssetGlyph, RarityChip, Trend, RiskPips,
  Sidebar, Topbar, Ticker, ScreenHead,
  Modal, ToastHost, Sparkline,
});
