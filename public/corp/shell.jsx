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

const RAR = window.ECON.RARITY;

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
  { id: 'logistics',  label: 'Logistics',      ico: '⇄', badge: 3 },
  { group: 'Economy' },
  { id: 'market',     label: 'Marketplace',    ico: '▤' },
  // 🚗 Player-to-player vehicle marketplace — no corp required.
  // Triggers parent-window navigation to the standalone Vehicle Market
  // screen via the existing jb:open bridge.
  { id: 'vehicleMarket', label: 'Vehicle Market', ico: '🚗', action: 'openVehicleMarket' },
  { id: 'realestate', label: 'Real Estate',    ico: '⌂' },
  { id: 'black',      label: 'Black Market',   ico: '▥', badgeCls: 'toxic', badge: '6' },
  { id: 'feed',       label: 'Guild Wire',      ico: '☷' },
  { group: 'Comms' },
  { id: 'mail',       label: 'Mailbox',        ico: '✉', badgeCls: 'alert', badge: 2 },
  { id: 'trade',      label: 'Trade Window',   ico: '⇋' },
];

// Map of op_type → { label, ico, action } for ops that have a dedicated
// mini-game accessed from the sidebar. Owned ops appear under "My Companies".
const COMPANY_PAGES = {
  fishing: { label: 'Woods Fishing',          ico: '⚓', action: 'openWoodsFishing' },
  cars:    { label: 'Prince Portfolios',      ico: '🚗', action: 'openPrincePortfolios' },
  oil:     { label: 'Black River Petroleum',  ico: '⛽', action: 'openBlackRiver' },
  gas:     { label: 'Ethos Fuel Command',     ico: '⛽', action: 'openFuelCommand' },
};

function Sidebar({ route, setRoute, mailCount, blackCount }) {
  const { PLAYER } = window.ECON;
  const JB = (window.__JB && window.__JB.econ) || null;
  const corpName = JB ? (JB.corp ? JB.corp.name : 'Independent') : PLAYER.corp;
  const corpRole = JB ? (JB.corp ? String(JB.corp.role || 'member').toUpperCase() : 'Unincorporated') : PLAYER.corpRole;
  // 🏢 Owned ops the player has funded — turn each into a "My Companies"
  //    sidebar entry. Clicking the Fishing Company tab opens the Woods
  //    Fishing maritime ops screen (handled by the parent).
  const ownedCompanies = ((JB && JB.operations) || [])
    .filter(o => o && o.op_type && COMPANY_PAGES[o.op_type])
    .map(o => ({
      op_type: o.op_type,
      ...COMPANY_PAGES[o.op_type],
      workers: o.workers | 0,
      net: o.net | 0,
    }));
  return (
    <aside className="sidebar">
      <button onClick={() => { try { window.JB_back && window.JB_back(); } catch (e) {} }}
        style={{ display: 'block', width: '100%', cursor: 'pointer', margin: '0 0 12px',
          border: '1px solid rgba(212,175,55,0.5)', background: 'rgba(212,175,55,0.10)',
          color: '#ffcf5a', borderRadius: 8, padding: '0.5rem 0.7rem', fontWeight: 700,
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
            {n.id === 'mail' && mailCount > 0 && <span className="badge alert">{mailCount}</span>}
            {n.id === 'black' && blackCount > 0 && <span className="badge toxic">{blackCount}</span>}
            {n.id === 'logistics' && <span className="badge">3</span>}
            {n.badge != null && !['mail','black','logistics'].includes(n.id) && (
              <span className={'badge ' + (n.badgeCls || '')}>{n.badge}</span>
            )}
          </button>
        ))}

        {ownedCompanies.length > 0 && (
          <React.Fragment>
            <div className="group">My Companies</div>
            {ownedCompanies.map(c => (
              <button key={'co_' + c.op_type} data-active="0"
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
          <span className="chip rust">RANK 04</span>
        </div>
        <div className="bar"><i style={{ width: '64%' }} /></div>
        <div className="stats">
          <span>TREASURY <b>2.4M</b></span>
          <span>WAR <b>14d</b></span>
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
  fmt, fmtAza,
  AssetGlyph, RarityChip, Trend, RiskPips,
  Sidebar, Topbar, Ticker, ScreenHead,
  Modal, ToastHost, Sparkline,
});
