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
const fmtAza = (n) => `${fmt(n)} AZA`;

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

const NAV = [
  { group: 'Holdings' },
  { id: 'vault',      label: 'Vault',          ico: '◇' },
  { id: 'corp',       label: 'Corp Treasury',  ico: '◈' },
  { id: 'logistics',  label: 'Logistics',      ico: '⇄', badge: 3 },
  { group: 'Economy' },
  { id: 'market',     label: 'Marketplace',    ico: '▤' },
  { id: 'realestate', label: 'Real Estate',    ico: '⌂' },
  { id: 'black',      label: 'Black Market',   ico: '▥', badgeCls: 'toxic', badge: '6' },
  { id: 'feed',       label: 'Live Feed',      ico: '☷' },
  { group: 'Comms' },
  { id: 'mail',       label: 'Mailbox',        ico: '✉', badgeCls: 'alert', badge: 2 },
  { id: 'trade',      label: 'Trade Window',   ico: '⇋' },
];

function Sidebar({ route, setRoute, mailCount, blackCount }) {
  const { PLAYER } = window.ECON;
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="mark"><span className="glyph" />Just Business</div>
        <div className="sub">PLAYER ECONOMY · v0.34</div>
      </div>
      <nav className="nav">
        {NAV.map((n, i) => n.group ? (
          <div key={'g'+i} className="group">{n.group}</div>
        ) : (
          <button key={n.id} data-active={route === n.id ? '1' : '0'} onClick={() => setRoute(n.id)}>
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
      </nav>

      <div className="corp-card">
        <div className="row">
          <div>
            <div className="name">{PLAYER.corp}</div>
            <div className="role">{PLAYER.corpRole}</div>
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
  const path = ({
    vault:     ['Holdings', 'Vault'],
    corp:      ['Holdings', 'Corp Treasury'],
    logistics: ['Holdings', 'Logistics'],
    market:    ['Economy', 'Marketplace'],
    realestate:['Economy', 'Real Estate'],
    property:  ['Economy', 'Real Estate', 'Listing'],
    black:     ['Economy', 'Black Market'],
    feed:      ['Economy', 'Live Feed'],
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
        <div className="bal">
          IRON <span className="num">{fmt(balances.iron)}</span>
        </div>
        <div className="bal">
          ESSENCE <span className="num">{balances.essence}</span>
        </div>
      </div>

      <div className="me">
        <div className="av">{PLAYER.handle.slice(0, 2)}</div>
        <div>
          <div className="name">{PLAYER.handle}</div>
          <div className="role">{PLAYER.title} · REP {Math.round(PLAYER.rep * 100)}</div>
        </div>
      </div>
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
