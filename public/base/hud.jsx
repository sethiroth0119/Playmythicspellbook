/* eslint-disable */
// hud.jsx — top resource bar, left alerts + roster column, bottom action ribbon
// All inline-SVG icons, no emoji.

// ───────────────────────────────────────────────────────────────
// ICONS — small, sharp, line-style. 16-grid.
// ───────────────────────────────────────────────────────────────
const Ic = {
  scrap:    (<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 11 L8 4 L14 11 L11 13 H5 Z"/><path d="M5 11 H11"/></svg>),
  power:    (<svg viewBox="0 0 16 16" fill="currentColor"><path d="M9 1 L3 9 H7 L6 15 L13 7 H9 Z"/></svg>),
  relic:    (<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M8 2 L13 6 L11 13 H5 L3 6 Z"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/></svg>),
  food:     (<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="9" r="5"/><path d="M5 5 L8 2 L11 5"/></svg>),
  survivor: (<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="5" r="2.4"/><path d="M3 14 C3 10 5 9 8 9 C11 9 13 10 13 14"/></svg>),
  build:    (<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 12 L8 4 L14 12"/><path d="M2 14 H14"/><circle cx="8" cy="8" r="1" fill="currentColor"/></svg>),
  recruit:  (<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="6" cy="6" r="2.2"/><path d="M2 13 C2 10 4 9 6 9 C8 9 10 10 10 13"/><path d="M12 6 V12 M9 9 H15"/></svg>),
  scout:    (<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="5"/><path d="M8 2 V4 M8 12 V14 M2 8 H4 M12 8 H14"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/></svg>),
  research: (<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="7" cy="7" r="4"/><path d="M10 10 L14 14"/></svg>),
  raid:     (<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 14 L8 8 L14 2"/><path d="M14 2 H10 V6"/><path d="M2 14 L5 11 L8 14"/></svg>),
  pause:    (<svg viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="3" width="3" height="10"/><rect x="9" y="3" width="3" height="10"/></svg>),
  play:     (<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 3 L13 8 L4 13 Z"/></svg>),
};

// ───────────────────────────────────────────────────────────────
// TOP BAR
// ───────────────────────────────────────────────────────────────
function TopBar({ day = "DAY 047", clock = "02:14:32", threat = 38 }) {
  return (
    <div className="hud-top">
      <div className="brand">
        <div className="brand-mark" />
        <div>
          <div className="brand-name">BUNKER</div>
          <div className="brand-sub">SECTOR-7 ▾ depth -72m</div>
        </div>
      </div>

      <div className="res-bar">
        {((window.__BRIDGE && window.__BRIDGE.resources) || window.RESOURCES).map((r) => (
          <div className="res" key={r.key}>
            <span className="res-glyph">{Ic[r.key] || <span style={{ fontSize: 13 }}>{r.glyph || ""}</span>}</span>
            <div className="res-val">
              <span className="res-num">
                {r.val}{r.unit && <small style={{ fontSize: 9, color: "var(--text-3)", marginLeft: 3 }}>{r.unit}</small>}
                <span className={`res-delta ${r.neg ? "neg" : ""}`}>{r.delta}</span>
              </span>
              <span className="res-lbl">{r.label}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="hud-clock">
        <div className="clock-block">
          <span className="clock-lbl">Cycle</span>
          <span className="clock-val day">{day}</span>
        </div>
        <div className="clock-block">
          <span className="clock-lbl">Local Time</span>
          <span className="clock-val">{clock}</span>
        </div>
        <div className="clock-block">
          <span className="clock-lbl">Threat</span>
          <span className="clock-val threat">{threat}%</span>
          <div className="threat-meter"><i style={{ width: `${threat}%` }} /></div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────
// LEFT COLUMN — alerts + roster
// ───────────────────────────────────────────────────────────────
function LeftColumn() {
  return (
    <aside className="hud-left">
      <div className="left-section alerts">
        <div className="sec-hd">Alerts <span className="count">{window.ALERTS.length}</span></div>
        {window.ALERTS.map((a, i) => (
          <div className={`alert ${a.sev}`} key={i}>
            <span className="alert-pulse" />
            <span
              className="alert-body"
              dangerouslySetInnerHTML={{ __html: a.body }}
            />
            <span className="alert-time">{a.time}</span>
          </div>
        ))}
      </div>

      <div className="left-section roster">
        <div className="sec-hd">Roster <span className="count">{window.ROSTER.length}/31</span></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {window.ROSTER.slice(0, 9).map((p) => (
            <div className={`roster-row ${p.state}`} key={p.i}>
              <span className="roster-avatar">{p.i}</span>
              <span className="roster-name">{p.n}</span>
              <span className="roster-tag">{p.t}</span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

// ───────────────────────────────────────────────────────────────
// BOTTOM RIBBON — minimap + actions + tick speed
// ───────────────────────────────────────────────────────────────
function BottomBar({ activeId, onSelect, speed, setSpeed, paused, setPaused }) {
  const minimapCells = window.ROOMS.map((r) => {
    const cls =
      r.id === activeId ? "active"
      : r.status === "crit" ? "crit"
      : r.status === "warn" ? "warn"
      : r.art === "empty"   ? "empty"
      : "";
    return cls;
  });

  return (
    <div className="hud-bot">
      <div className="minimap">
        <div className="minimap-grid">
          {minimapCells.map((c, i) => (
            <button
              key={i}
              className={`minimap-cell ${c}`}
              onClick={() => onSelect(window.ROOMS[i].id)}
              title={window.ROOMS[i].name}
            />
          ))}
        </div>
        <div className="minimap-info">
          <b>SECTOR — 7</b>
          <span>9 rooms · 3 tiers · expandable</span>
        </div>
      </div>

      <div className="actions">
        <button className="act primary">
          {Ic.build}
          <span className="act-lbl">Build</span>
          <span className="act-hot">B</span>
        </button>
        <a className="act" href="World Map.html" style={{ textDecoration: "none" }}>
          {Ic.scout}
          <span className="act-lbl">World</span>
          <span className="act-hot">W</span>
        </a>
        <button className="act">
          {Ic.recruit}
          <span className="act-lbl">Assign</span>
          <span className="act-hot">A</span>
        </button>
        <button className="act">
          {Ic.research}
          <span className="act-lbl">Research</span>
          <span className="act-hot">R</span>
        </button>
        <button className="act">
          {Ic.scout}
          <span className="act-lbl">Scout</span>
          <span className="act-hot">S</span>
        </button>
        <button className="act">
          {Ic.raid}
          <span className="act-lbl">Sortie</span>
          <span className="act-hot">X</span>
        </button>
      </div>

      <div className="tick">
        <button className="tick-pause" onClick={() => setPaused(!paused)}>
          {paused ? Ic.play : Ic.pause}
        </button>
        <div className="tick-speed">
          {[1, 2, 4].map((s) => (
            <button
              key={s}
              className={speed === s ? "on" : ""}
              onClick={() => setSpeed(s)}
            >×{s}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { TopBar, LeftColumn, BottomBar, Ic });
