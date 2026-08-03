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
  // Live threat from the embedding game (campRaidRisk) when bridged.
  if (window.__BRIDGE && typeof window.__BRIDGE.threat === "number") threat = window.__BRIDGE.threat;
  return (
    <div className="hud-top">
      <div className="brand" title="Your underground camp — Sector-7, depth -72m">
        <button
          title="Back to the main menu"
          onClick={() => {
            try {
              if (window.BB_back) window.BB_back();
              else window.parent.postMessage({ type: "base:back" }, window.location.origin);
            } catch (e) {}
          }}
          style={{
            cursor: "pointer",
            fontWeight: 800,
            fontSize: 11,
            letterSpacing: ".06em",
            color: "#ffe9b8",
            background: "linear-gradient(180deg,rgba(60,40,110,0.95),rgba(28,16,52,0.96))",
            border: "1px solid rgba(212,175,55,0.6)",
            borderRadius: 999,
            padding: "5px 11px",
            marginRight: 4,
            whiteSpace: "nowrap",
          }}
        >
          ← Menu
        </button>
        <div className="brand-mark" />
        <div>
          <div className="brand-name">CAMP</div>
          <div className="brand-sub">SECTOR-7 ▾ depth -72m</div>
        </div>
      </div>

      <div className="res-bar" title="Everything secured in your camp stockpile — scroll to see it all">
        <div
          className="res-bar-label"
          title="📒 Open My Resources — every resource you own (craft / sell / trade / Black Market)"
          style={{ cursor: "pointer" }}
          onClick={() => { try { window.parent.postMessage({ type: "base:action", action: "ledger" }, window.location.origin); } catch (e) {} }}
        >
          <b>CAMP</b><span>RESOURCES 📒</span>
        </div>
        {((window.__BRIDGE && window.__BRIDGE.resources) || window.RESOURCES).map((r) => (
          <div
            className="res"
            key={r.key}
            title={
              r.tip ||
              `${r.label}: ${r.val}${r.unit ? " " + r.unit : ""}` +
                (r.delta ? `  (${r.delta}${r.neg ? " — draining" : ""})` : "") +
                "\nSecured camp stockpile. Spent on crafting & upkeep."
            }
          >
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
        <div className="clock-block" title="Day cycle since the camp was founded">
          <span className="clock-lbl">Cycle</span>
          <span className="clock-val day">{day}</span>
        </div>
        <div className="clock-block" title="Bunker local clock">
          <span className="clock-lbl">Local Time</span>
          <span className="clock-val">{clock}</span>
        </div>
        <div
          className="clock-block"
          title={
            `Raider threat: ${threat}%\n` +
            "Chance the camp gets attacked. Driven by supply shortages & time since the last raid — keep Ammo stocked."
          }
        >
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
  const ALERTS = (window.__BRIDGE && window.__BRIDGE.alerts) || window.ALERTS;
  const ROSTER = (window.__BRIDGE && window.__BRIDGE.roster) || window.ROSTER;
  const BAG = (window.__BRIDGE && window.__BRIDGE.bag) || null;
  const bagLocked = !!(BAG && BAG.locked);
  const bagAccent = bagLocked ? "#7ec0ff" : "#ffd166";
  const depositBag = () => {
    if (bagLocked) return;
    try { window.parent.postMessage({ type: "base:action", action: "deposit" }, window.location.origin); } catch (e) {}
  };
  const plain = (s) => String(s || "").replace(/<[^>]+>/g, "");
  const isImg = (s) => /^(https?:|data:|blob:|\/)/i.test(String(s || ""));
  const openCard = (id) => {
    if (!id) return;
    try { window.parent.postMessage({ type: "base:action", action: "card", id }, window.location.origin); } catch (e) {}
  };
  const Avatar = ({ p }) =>
    isImg(p.icon)
      ? <img src={p.icon} alt={p.n} className="roster-art"
             style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 4 }} />
      : <span>{p.icon || p.i}</span>;
  return (
    <aside className="hud-left">
      {BAG && BAG.has && (
        <div
          className="left-section bag"
          title={
            bagLocked
              ? "You're on an expedition — the bunker can't bank loot mid-run. Reach a 🚚 Convoy node (or extract at the boss) to secure it."
              : "Loot you're carrying is UNSECURED — it's lost if you fall in battle. Deposit it here to add it to the secured camp stockpile (usable for crafting, upkeep & trade)."
          }
          style={{
            border: `1px solid ${bagAccent}`,
            boxShadow: `0 0 18px ${bagLocked ? "rgba(126,192,255,0.22)" : "rgba(255,209,102,0.22)"}`,
          }}
        >
          <div className="sec-hd" style={{ color: bagAccent }}>
            Field Bag{" "}
            <span className="count">
              {BAG.used}/{BAG.cap} · {bagLocked ? "on expedition" : "unsecured"}
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, margin: "4px 0 8px" }}>
            {BAG.items.map((it, i) => (
              <span
                key={i}
                title={`${it.name} ×${it.n}`}
                style={{
                  fontSize: 11,
                  padding: "2px 7px",
                  borderRadius: 9,
                  border: `1px solid ${bagLocked ? "rgba(126,192,255,0.45)" : "rgba(255,209,102,0.45)"}`,
                  background: bagLocked ? "rgba(126,192,255,0.12)" : "rgba(255,209,102,0.12)",
                  color: "var(--text-1, #ffe9b8)",
                }}
              >
                {it.icon} {it.name} <strong>{it.n}</strong>
              </span>
            ))}
          </div>
          {bagLocked ? (
            <div
              title="Banking is locked while a roguelite run is active. Use a 🚚 Convoy node in the run to extract loot to camp."
              style={{
                width: "100%",
                boxSizing: "border-box",
                textAlign: "center",
                fontWeight: 800,
                fontSize: 11.5,
                letterSpacing: ".02em",
                padding: "7px 10px",
                borderRadius: 9,
                border: "1px solid rgba(126,192,255,0.55)",
                background: "rgba(126,192,255,0.10)",
                color: "#bcdcff",
              }}
            >
              🔒 On expedition — bank loot at a Convoy
            </div>
          ) : (
            <button
              onClick={depositBag}
              title="Move all carried loot into secured camp storage"
              style={{
                width: "100%",
                cursor: "pointer",
                fontWeight: 800,
                fontSize: 12,
                letterSpacing: ".02em",
                padding: "7px 10px",
                borderRadius: 9,
                border: "1px solid var(--amber, #ffd166)",
                background: "linear-gradient(180deg,#caa23e,#8a6a1e)",
                color: "#1a1206",
              }}
            >
              📥 Deposit All to Camp Storage
            </button>
          )}
        </div>
      )}

      <div className="left-section alerts" title="Live camp alerts — world events, supply shortages & raider threat">
        <div className="sec-hd">Alerts <span className="count">{ALERTS.length}</span></div>
        {ALERTS.map((a, i) => (
          <div
            className={`alert ${a.sev}`}
            key={i}
            title={`[${(a.sev || "info").toUpperCase()}] ${a.time ? a.time + " · " : ""}${plain(a.body)}`}
          >
            <span className="alert-pulse" />
            <span
              className="alert-body"
              dangerouslySetInnerHTML={{ __html: a.body }}
            />
            <span className="alert-time">{a.time}</span>
          </div>
        ))}
      </div>

    </aside>
  );
}

// ───────────────────────────────────────────────────────────────
// 🛏 BEDS RACK — right-side panel showing each hero's energy /
// fatigue / stress and a state pill (READY / TIRED / EXHAUSTED).
// Bridged in via window.__BRIDGE.heroBeds from the parent app.
// Clicking a bed posts a "rest" action back so the parent opens
// the full Hero Rest panel.
// ───────────────────────────────────────────────────────────────
function BedsRack() {
  const BEDS = (window.__BRIDGE && Array.isArray(window.__BRIDGE.heroBeds)) ? window.__BRIDGE.heroBeds : [];
  const isImg = (s) => /^(https?:|data:|blob:|\/)/i.test(String(s || ""));
  const openRest = () => {
    try { window.parent.postMessage({ type: "base:action", action: "rest" }, window.location.origin); } catch (e) {}
  };
  // ALWAYS render the rack so the player can see where heroes go to rest.
  // If the bridge hasn't delivered any beds yet (cold open / fresh profile),
  // show an empty-state card pointing at Hero Loadout.
  if (BEDS.length === 0) {
    return (
      <aside className="hud-beds-rack" title="Hero Beds — assign heroes via Hero Loadout. They'll appear here for one-tap resting.">
        <div className="beds-rack-h">
          <span className="beds-rack-icon">🛏</span>
          <span className="beds-rack-title">HERO BEDS</span>
          <span className="beds-rack-count">0</span>
        </div>
        <div className="beds-rack-list">
          <div className="bed-card" style={{ opacity: 0.7, cursor: "default" }}>
            <div className="bed-icon"><span style={{ fontSize: 18 }}>🛌</span></div>
            <div className="bed-meta">
              <div className="bed-name">No heroes assigned</div>
              <div className="bed-bar"><div className="bed-bar-fill" style={{ width: "0%" }} /></div>
              <div className="bed-foot">
                <span className="bed-val">—</span>
                <span className="bed-state" style={{ color: "#bcdcff", borderColor: "#bcdcff" }}>EMPTY</span>
              </div>
            </div>
          </div>
        </div>
        <button className="beds-rack-cta" onClick={openRest} title="Open the Hero Rest panel in the main game">
          🦸 Pick Heroes
        </button>
      </aside>
    );
  }
  return (
    <aside className="hud-beds-rack" title="Hero Beds — each owned hero's recovery state. Hover for full numbers. Click to open the Rest panel.">
      <div className="beds-rack-h">
        <span className="beds-rack-icon">🛏</span>
        <span className="beds-rack-title">HERO BEDS</span>
        <span className="beds-rack-count">{BEDS.length}</span>
      </div>
      <div className="beds-rack-list">
        {BEDS.map((b) => {
          const pct = Math.max(0, Math.min(100, Math.round((b.energy / (b.energyMax || 100)) * 100)));
          const stateLabel = b.state === "exhausted" ? "EXHAUSTED"
                          : b.state === "ready"      ? "READY"
                          : "TIRED";
          const stateColor = b.state === "exhausted" ? "var(--ember, #ff7755)"
                          : b.state === "ready"     ? "var(--toxic, #4ade80)"
                          : "var(--amber, #ffd166)";
          return (
            <button
              key={b.id}
              className={`bed-card bed-${b.state}`}
              onClick={openRest}
              title={
                `${b.name}\n` +
                `Energy ${b.energy}/${b.energyMax || 100} · Fatigue ${b.fatigue}/100 · Stress ${b.stress}/100\n` +
                (b.state === "exhausted"
                  ? "Exhausted — taking deployment penalty. Rest before next battle."
                  : b.state === "ready"
                    ? "Fully rested — ready to deploy."
                    : "Tired — could use a rest before next match.") +
                "\nClick to open the Rest panel."
              }
            >
              <div className="bed-icon">
                {isImg(b.icon)
                  ? <img src={b.icon} alt={b.name} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 4 }} />
                  : <span style={{ fontSize: 18 }}>{b.icon || "🦸"}</span>}
              </div>
              <div className="bed-meta">
                <div className="bed-name">{b.name}</div>
                <div className="bed-bar">
                  <div className="bed-bar-fill" style={{ width: pct + "%" }} />
                </div>
                <div className="bed-foot">
                  <span className="bed-val">{b.energy}/{b.energyMax || 100}</span>
                  <span className="bed-state" style={{ color: stateColor, borderColor: stateColor }}>{stateLabel}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <button className="beds-rack-cta" onClick={openRest} title="Open the full Hero Rest panel — rest 1h, or pay Cinder Sprint">
        🛌 Open Rest Panel
      </button>
    </aside>
  );
}

// ───────────────────────────────────────────────────────────────
// BOTTOM RIBBON — minimap + actions + tick speed
// ───────────────────────────────────────────────────────────────
// ───────────────────────────────────────────────────────────────
// 👥 ROSTER PANEL — moved out of the left rail so both hero lists
// (roster + beds) live together in the right rail. Row layout is
// portrait / name+role / state pill.
// ───────────────────────────────────────────────────────────────
function RosterPanel() {
  const ROSTER = (window.__BRIDGE && window.__BRIDGE.roster) || window.ROSTER || [];
  const isImg = (s) => /^(https?:|data:|blob:|\/)/i.test(String(s || ""));
  const openCard = (id) => {
    if (!id) return;
    try { window.parent.postMessage({ type: "base:action", action: "card", id }, window.location.origin); } catch (e) {}
  };
  const CAP = 12;
  const stateOf = (st) => st === "hurt" ? { label: "INJURED",  cls: "hurt" }
                        : st === "busy" ? { label: "DEPLOYED", cls: "busy" }
                        :                 { label: "READY",    cls: "ready" };
  return (
    <div className="right-section roster" title="Your owned units & hired workers stationed at the camp">
      <div className="sec-hd">
        Roster <span className="count">{ROSTER.length}</span>
      </div>
      <div className="roster-list">
        {ROSTER.slice(0, CAP).map((p, idx) => {
          const st = stateOf(p.state);
          return (
            <div
              className={`roster-row ${st.cls}`}
              key={idx}
              onClick={() => openCard(p.id)}
              style={p.id ? { cursor: "pointer" } : undefined}
              title={
                `${p.n}${p.t ? "  ·  " + p.t : ""}` +
                (p.tip ? `\n${p.tip}` : "") +
                `\nStatus: ${st.label.toLowerCase()}`
              }
            >
              <span className="roster-avatar">
                {isImg(p.icon)
                  ? <img src={p.icon} alt={p.n} className="roster-art" />
                  : <span>{p.icon || p.i}</span>}
              </span>
              <span className="roster-id">
                <span className="roster-name">{p.n}</span>
                <span className="roster-tag">{p.t}</span>
              </span>
              <span className={`roster-state ${st.cls}`}>{st.label}</span>
            </div>
          );
        })}
        {ROSTER.length === 0 && (
          <div className="roster-empty">
            No one stationed yet — assign a unit or hire a worker at a room.
          </div>
        )}
        {ROSTER.length > CAP && (
          <div className="roster-more" title={`${ROSTER.length - CAP} more on the roster`}>
            +{ROSTER.length - CAP} more…
          </div>
        )}
      </div>
    </div>
  );
}

// The docked right rail. Grid track 3 on desktop, an overlay rail on
// narrow screens (see .hud-right in styles.css).
function RightColumn() {
  return (
    <aside className="hud-right">
      <RosterPanel />
      <BedsRack />
    </aside>
  );
}

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
              title={
                `${window.ROOMS[i].name}` +
                (window.ROOMS[i].status ? `  ·  ${String(window.ROOMS[i].status).toUpperCase()}` : "") +
                "\nClick to open this room"
              }
            />
          ))}
        </div>
        <div className="minimap-info" title="Bunker overview map — each cell is a room">
          <b>SECTOR — 7</b>
          <span>9 rooms · 3 tiers · expandable</span>
        </div>
      </div>

      <div className="actions">
        <button className="act primary" title="Build a new room in an empty slot (hotkey: B)">
          {Ic.build}
          <span className="act-lbl">Build</span>
          <span className="act-hot">B</span>
        </button>
        <a
          className="act"
          href="World Map.html"
          style={{ textDecoration: "none" }}
          title="Open the World Map — expeditions & roguelite runs (hotkey: W)"
        >
          {Ic.scout}
          <span className="act-lbl">World</span>
          <span className="act-hot">W</span>
        </a>
        <button
          className="act"
          title="Open Camp Ops — station units, assign Rest / Study / Raid, build & upgrade facilities (hotkey: A)"
          onClick={() => { try { window.parent.postMessage({ type: "base:action", action: "nav:campOps" }, window.location.origin); } catch (e) {} }}
        >
          {Ic.recruit}
          <span className="act-lbl">Assign</span>
          <span className="act-hot">A</span>
        </button>
        <button
          className="act"
          title="Hire NPC staff / station units to run the camp rooms"
          onClick={() => { try { window.parent.postMessage({ type: "base:action", action: "workers" }, window.location.origin); } catch (e) {} }}
        >
          {Ic.research}
          <span className="act-lbl">Hire</span>
          <span className="act-hot">H</span>
        </button>
      </div>

      <div className="tick">
        <button
          className="tick-pause"
          onClick={() => setPaused(!paused)}
          title={paused ? "Resume time (Space)" : "Pause time (Space)"}
        >
          {paused ? Ic.play : Ic.pause}
        </button>
        <div className="tick-speed" title="Simulation speed (keys 1 / 2 / 4)">
          {[1, 2, 4].map((s) => (
            <button
              key={s}
              className={speed === s ? "on" : ""}
              onClick={() => setSpeed(s)}
              title={`Run at ×${s} speed`}
            >×{s}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { TopBar, LeftColumn, BottomBar, Ic });
