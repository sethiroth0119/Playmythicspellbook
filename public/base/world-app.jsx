/* eslint-disable */
// world-app.jsx — Ethos Heights map view

const { useState, useEffect, useMemo, useRef } = React;

// ─────────────────────────────────────────────────────────────
// Resource glyphs (tiny inline SVGs, 16-grid)
// ─────────────────────────────────────────────────────────────
const Glyph = ({ kind }) => {
  const G = (children) => <svg viewBox="0 0 16 16">{children}</svg>;
  switch (kind) {
    case "food":    return G(<g fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="9" r="5"/><path d="M5 5 L8 2 L11 5"/></g>);
    case "water":   return G(<g fill="currentColor"><path d="M8 1 L3 9 A5 6 0 1 0 13 9 Z"/></g>);
    case "med":     return G(<g fill="currentColor"><rect x="6" y="2" width="4" height="12"/><rect x="2" y="6" width="12" height="4"/></g>);
    case "crate":   return G(<g fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="2" y="4" width="12" height="9"/><path d="M2 7 H14 M8 4 V13"/></g>);
    case "fuel":    return G(<g fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="3" y="3" width="7" height="11"/><path d="M10 6 L13 6 L13 11"/><path d="M3 7 H10"/></g>);
    case "ammo":    return G(<g fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="6" y="3" width="4" height="9"/><path d="M6 5 L8 2 L10 5"/><path d="M6 11 H10 V14 H6 Z" fill="currentColor"/></g>);
    case "metal":   return G(<g fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M2 12 L8 4 L14 12 Z"/><path d="M5 12 H11"/></g>);
    case "wood":    return G(<g fill="none" stroke="currentColor" strokeWidth="1.3"><ellipse cx="8" cy="8" rx="6" ry="3"/><ellipse cx="8" cy="8" rx="3" ry="1.5"/></g>);
    case "fabric":  return G(<g fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M3 4 L13 4 L11 13 L5 13 Z"/><path d="M5 4 V13 M11 4 V13"/></g>);
    case "chip":    return G(<g fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="4" y="4" width="8" height="8"/><path d="M2 6 H4 M2 8 H4 M2 10 H4 M12 6 H14 M12 8 H14 M12 10 H14 M6 2 V4 M8 2 V4 M10 2 V4 M6 12 V14 M8 12 V14 M10 12 V14"/></g>);
    case "batt":    return G(<g fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="2" y="5" width="11" height="6"/><rect x="13" y="7" width="2" height="2" fill="currentColor"/><path d="M5 7 V9 M5 8 H7"/></g>);
    case "block":   return G(<g fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="2" y="5" width="12" height="8"/><path d="M2 9 H14 M6 5 V13 M10 5 V13"/></g>);
    case "gear":    return G(<g fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="8" cy="8" r="3"/><path d="M8 2 V4 M8 12 V14 M2 8 H4 M12 8 H14 M3.5 3.5 L5 5 M11 11 L12.5 12.5 M3.5 12.5 L5 11 M11 5 L12.5 3.5"/></g>);
    case "wire":    return G(<g fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M2 8 Q5 4 8 8 T14 8"/></g>);
    case "sun":     return G(<g fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="8" cy="8" r="3"/><path d="M8 1 V3 M8 13 V15 M1 8 H3 M13 8 H15 M3 3 L4.5 4.5 M11.5 11.5 L13 13 M3 13 L4.5 11.5 M11.5 4.5 L13 3"/></g>);
    case "plate":   return G(<g fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="2" y="4" width="12" height="8"/><circle cx="4" cy="6" r=".7" fill="currentColor"/><circle cx="12" cy="6" r=".7" fill="currentColor"/><circle cx="4" cy="10" r=".7" fill="currentColor"/><circle cx="12" cy="10" r=".7" fill="currentColor"/></g>);
    case "dna":     return G(<g fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M4 2 Q12 6 4 10 Q12 14 4 14 M12 2 Q4 6 12 10 Q4 14 12 14"/></g>);
    case "organ":   return G(<g fill="currentColor"><path d="M8 3 Q3 4 4 9 Q5 13 8 13 Q11 13 12 9 Q13 4 8 3 Z"/></g>);
    case "vial":    return G(<g fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M6 2 H10 V5 L12 9 V13 H4 V9 L6 5 Z"/><path d="M4 11 H12" fill="currentColor"/></g>);
    case "brain":   return G(<g fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M5 5 Q3 8 5 11 Q7 13 8 11 M11 5 Q13 8 11 11 Q9 13 8 11 M8 3 V13"/></g>);
    case "bone":    return G(<g fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M3 5 Q3 3 5 3 Q5 5 7 5 L11 9 Q13 11 11 13 Q11 11 9 11 Z"/></g>);
    case "spore":   return G(<g fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="8" cy="9" r="3"/><circle cx="5" cy="5" r="1.5"/><circle cx="11" cy="5" r="1.5"/><circle cx="13" cy="9" r="1"/></g>);
    case "coin":    return G(<g fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="8" cy="8" r="6"/><path d="M6 5 H10 M6 11 H10 M8 4 V12 M6.5 7.5 H10.5"/></g>);
    case "token":   return G(<g fill="none" stroke="currentColor" strokeWidth="1.3"><polygon points="8,2 13,6 11,13 5,13 3,6"/><path d="M8 5 V11 M6 8 H10"/></g>);
    case "file":    return G(<g fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M3 2 H10 L13 5 V14 H3 Z"/><path d="M5 7 H11 M5 10 H11 M5 12 H9"/></g>);
    case "stamp":   return G(<g fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M5 2 L11 2 L10 6 H6 Z"/><rect x="3" y="6" width="10" height="3"/><path d="M3 11 H13"/></g>);
    case "lock":    return G(<g fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="3" y="7" width="10" height="7"/><path d="M5 7 V5 Q5 2 8 2 Q11 2 11 5 V7"/></g>);
    case "rune":    return G(<g fill="none" stroke="currentColor" strokeWidth="1.3"><polygon points="8,2 13,8 8,14 3,8"/><path d="M5 8 H11 M8 5 V11"/></g>);
    case "shard":   return G(<g fill="none" stroke="currentColor" strokeWidth="1.3"><polygon points="8,1 13,7 10,14 6,14 3,7"/><path d="M6 6 L8 4 L10 6"/></g>);
    case "relic":   return G(<g fill="none" stroke="currentColor" strokeWidth="1.3"><polygon points="8,2 14,8 8,14 2,8"/><circle cx="8" cy="8" r="2" fill="currentColor"/></g>);
    case "void":    return G(<g fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="8" cy="8" r="5"/><circle cx="8" cy="8" r="2" fill="currentColor"/></g>);
    case "core":    return G(<g fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="8" cy="8" r="5"/><polygon points="8,4 11,8 8,12 5,8" fill="currentColor"/></g>);
    case "kalon":   return G(<g fill="none" stroke="currentColor" strokeWidth="1.3"><polygon points="8,2 12,5 12,11 8,14 4,11 4,5"/><circle cx="8" cy="8" r="2"/></g>);
    case "dust":    return G(<g fill="currentColor"><circle cx="4" cy="4" r="1"/><circle cx="12" cy="5" r="1.2"/><circle cx="8" cy="9" r="1.4"/><circle cx="5" cy="12" r="1"/><circle cx="11" cy="11" r=".8"/></g>);
    case "book":    return G(<g fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M2 3 Q5 4 8 3 Q11 2 14 3 V13 Q11 12 8 13 Q5 14 2 13 Z"/><path d="M8 3 V13"/></g>);
    case "seed":    return G(<g fill="none" stroke="currentColor" strokeWidth="1.3"><ellipse cx="8" cy="9" rx="4" ry="5"/><path d="M8 4 L8 2 L10 3"/></g>);
    case "crystal": return G(<g fill="none" stroke="currentColor" strokeWidth="1.3"><polygon points="8,2 12,6 10,14 6,14 4,6"/><path d="M4 6 H12 M8 2 V14"/></g>);
    case "ash":     return G(<g fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M5 3 Q8 6 5 9 Q8 12 5 14 M11 3 Q8 6 11 9 Q8 12 11 14"/></g>);
    case "ice":     return G(<g fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M8 2 V14 M2 8 H14 M3.5 3.5 L12.5 12.5 M12.5 3.5 L3.5 12.5"/></g>);
    case "flame":   return G(<g fill="currentColor"><path d="M8 2 Q5 5 5 8 Q5 12 8 14 Q11 12 11 8 Q11 5 8 2 Z M8 7 Q7 8 7 10 Q7 12 8 13 Q9 12 9 10 Q9 8 8 7 Z" fillRule="evenodd"/></g>);
    default:        return G(<rect x="3" y="3" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.3"/>);
  }
};

// ─────────────────────────────────────────────────────────────
// Marker
// ─────────────────────────────────────────────────────────────
function Marker({ zone, event, active, onSelect, hidden }) {
  if (hidden) return null;
  const sev =
    event?.severity === "crit"    ? "sev-crit"
  : event?.severity === "warn"    ? "sev-warn"
  : event?.severity === "anomaly" ? "sev-anom"
  : event?.severity === "info"    ? "sev-info"
  : "";

  return (
    <div
      className={`marker ${sev} ${active ? "active" : ""}`}
      style={{ left: `${zone.x}%`, top: `${zone.y}%` }}
      onClick={(e) => { e.stopPropagation(); onSelect(zone.id); }}
    >
      {event && <div className="marker-event">{event.label}</div>}
      <div className="marker-pulse" />
      <div className="marker-pulse late" />
      <div className="marker-dot" />
      <div className="marker-line" />
      <div className="marker-flag">
        <span className="name">{zone.name}</span>
        <span className="tag">{zone.tag}</span>
      </div>
      <div className="marker-threat" title={`Threat ${zone.threat}/5`}>
        {Array.from({ length: 5 }, (_, i) => (
          <i key={i} className={i < zone.threat ? "on" : ""} />
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Side panel
// ─────────────────────────────────────────────────────────────
function ZonePanel({ zone, event, onClose, onScout }) {
  if (!zone) return null;
  const threatTone =
    zone.threat <= 1 ? "green" : zone.threat <= 2 ? "amber" : zone.threat <= 3 ? "amber" : "red";
  const threatLabel =
    zone.threat <= 1 ? "Low"  : zone.threat <= 2 ? "Mild"  : zone.threat <= 3 ? "Moderate"
  : zone.threat <= 4 ? "High" : "Lethal";

  const encounters = window.WorldMap._encounters()[zone.id] || [];
  const slots = Array.from({ length: zone.encounterSlots }, (_, i) => encounters[i] || null);

  return (
    <aside className="panel">
      <header className="panel-hd">
        <div className="top">
          <div>
            <div className="panel-tag">{zone.id.replace(/-/g, " · ").toUpperCase()}</div>
            <h2 className="panel-name">{zone.name}</h2>
            <div className="panel-sub">{zone.tag} · biome {zone.biome} · {zone.control}</div>
          </div>
          <button className="panel-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="panel-stats">
          <div className="pstat">
            <span className="k">Threat</span>
            <span className={`v ${threatTone}`}>{threatLabel}</span>
            <div className={`threat-bar t${zone.threat}`}>
              {Array.from({ length: 5 }, (_, i) => <i key={i} className={i < zone.threat ? "on" : ""} />)}
            </div>
          </div>
          <div className="pstat">
            <span className="k">Active Event</span>
            <span className={`v ${event ? (event.severity === "crit" ? "red" : event.severity === "warn" ? "amber" : "purple") : ""}`}>
              {event ? event.label : "—"}
            </span>
          </div>
          <div className="pstat">
            <span className="k">Encounter Slots</span>
            <span className="v bronze">{encounters.length}/{zone.encounterSlots}</span>
          </div>
          <div className="pstat">
            <span className="k">Yield Rolls</span>
            <span className="v">3–5</span>
          </div>
        </div>
      </header>

      <div className="panel-body">
        <section className="panel-section">
          <h4>Field Log</h4>
          <div className="blurb">{zone.blurb}</div>
        </section>

        <section className="panel-section">
          <h4>Resource Yields</h4>
          <div>
            {zone.yields.map((y) => {
              const res = window.RESOURCES[y.r] || { label: y.r, tier: 1, glyph: "crate" };
              return (
                <div className="yield-row" key={y.r} data-tier={res.tier}>
                  <span className="yg"><Glyph kind={res.glyph} /></span>
                  <div className="yn-wrap">
                    <span className="yn">{res.label}</span>
                    <span className="yt">T{res.tier} · per roll</span>
                  </div>
                  <span className="yp"><i style={{ width: `${Math.min(100, y.p * 1.5)}%` }} /></span>
                  <span className="yp-pct">{y.p}%</span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel-section">
          <h4>Encounters</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {slots.map((e, i) => (
              e ? (
                <div className="enc-row" key={e.id}>
                  <div>
                    <div className="et">{e.title}</div>
                    <div className="eb">{e.brief}</div>
                  </div>
                  <div className="ew">w{e.weight}</div>
                </div>
              ) : (
                <div className="enc-row empty" key={`empty-${i}`}>
                  <div>
                    <div className="et">// empty encounter slot</div>
                    <div className="eb">WorldMap.registerEncounter("{zone.id}", {`{…}`})</div>
                  </div>
                  <div className="ew">—</div>
                </div>
              )
            ))}
          </div>
        </section>
      </div>

      <footer className="panel-cta">
        <button className="cta" onClick={onClose}>Stand Down</button>
        <button className="cta primary" onClick={() => onScout(zone.id)}>
          Scout <span className="cost">−4 fuel</span>
        </button>
      </footer>
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────
// Top + bottom bars
// ─────────────────────────────────────────────────────────────
const FILTERS = [
  { id: "all",   label: "All",      tone: "ok"   },
  { id: "event", label: "Events",   tone: "warn" },
  { id: "anom",  label: "Anomaly",  tone: "anom" },
  { id: "safe",  label: "Safe",     tone: "info" },
];

function TopBar({ filter, setFilter }) {
  return (
    <div className="hud-top">
      <div className="brand">
        <div className="brand-mark" />
        <div>
          <div className="brand-name">BUNKER</div>
          <div className="brand-sub">Tactical Overlay · v0.4</div>
        </div>
      </div>
      <div className="crumbs">
        <a href="index.html">◂ Base</a>
        <span className="sep">/</span>
        <span className="here">World Map · Ethos Heights</span>
      </div>
      <div className="filters">
        {FILTERS.map((f) => (
          <button key={f.id}
            className={`chip ${filter === f.id ? "on" : ""}`}
            onClick={() => setFilter(f.id)}
          >
            <span className={`dot`} style={{ color:
              f.tone === "warn" ? "var(--amber)"
            : f.tone === "anom" ? "var(--purple-hi)"
            : f.tone === "info" ? "var(--blue)"
            : "var(--bronze-hi)"
            }}/>
            {f.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function BottomBar({ onRollAll, hint }) {
  return (
    <div className="hud-bot">
      <div className="legend">
        <span className="legend-item"><span className="legend-dot ok"/>Yield site</span>
        <span className="legend-item"><span className="legend-dot warn"/>Patrol</span>
        <span className="legend-item"><span className="legend-dot crit"/>Hostile</span>
        <span className="legend-item"><span className="legend-dot anom"/>Anomaly</span>
        <span className="legend-item"><span className="legend-dot info"/>Friendly</span>
      </div>
      <div className="bot-mid">
        <button className="btn" onClick={onRollAll}>Roll Encounter</button>
        <button className="btn primary">Dispatch Squad</button>
      </div>
      <div className="tip">{hint}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────
function App() {
  const [activeId, setActiveId] = useState(null);
  const [filter, setFilter]     = useState("all");
  const [coords, setCoords]     = useState(null);
  const [toast, setToast]       = useState(null);
  const [briefDest, setBriefDest] = useState(null);
  const [run, setRun]           = useState(null);
  const [_, force]              = useState(0); // re-render on WorldMap mutation
  const mapRef = useRef(null);

  useEffect(() => {
    const onChange = () => force((n) => n + 1);
    window.addEventListener("worldmap:changed", onChange);
    return () => window.removeEventListener("worldmap:changed", onChange);
  }, []);

  // close on Esc — but only top-most layer
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (run)          { /* expedition handles its own abort */ }
      else if (briefDest) setBriefDest(null);
      else                setActiveId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run, briefDest]);

  const zones        = window.ZONES;
  const destinations = window.DESTINATIONS;
  const worldEvents  = window.WORLD_EVENTS;
  const events       = window.WorldMap._events();
  const active       = zones.find((z) => z.id === activeId) || null;
  const activeEvent  = activeId ? events[activeId] : null;

  // begin expedition: hide brief, open run overlay
  const beginExpedition = (destId) => {
    const r = window.WorldMap.beginExpedition(destId);
    setRun({ ...r });
    setBriefDest(null);
  };
  const advanceNode = (nodeId) => {
    const r = window.WorldMap.advanceToNode(nodeId);
    if (r) setRun({ ...r });
  };
  const abortRun = () => {
    window.WorldMap.abandonExpedition();
    setRun(null);
  };
  const resolveNode = (node) => {
    // STUB — game code can override window.onResolveNode(node, run)
    if (typeof window.onResolveNode === "function") {
      try { window.onResolveNode(node, run); } catch (e) { console.error(e); }
    }
    setToast({
      id: Date.now(),
      zone: node.name,
      title: `${window.WorldMap.nodeTypes[node.type]?.label || "Encounter"} resolved`,
      brief: "Stub: hook into onResolveNode(node, run) to handle combat / shop / mystery."
    });
    setTimeout(() => setToast(null), 3000);
  };

  // marker visibility per filter
  const isHidden = (z) => {
    const e = events[z.id];
    if (filter === "all")   return false;
    if (filter === "event") return !e;
    if (filter === "anom")  return !(e && e.severity === "anomaly") && z.control !== "anomaly";
    if (filter === "safe")  return z.threat > 2;
    return false;
  };

  const onMouseMove = (e) => {
    const r = mapRef.current?.getBoundingClientRect();
    if (!r) return;
    const x = ((e.clientX - r.left) / r.width) * 100;
    const y = ((e.clientY - r.top) / r.height) * 100;
    if (x < 0 || y < 0 || x > 100 || y > 100) { setCoords(null); return; }
    setCoords({ x, y });
  };

  const scout = (id) => {
    const enc = window.WorldMap.rollEncounter(id);
    if (enc) {
      const z = window.WorldMap.getZone(id);
      setToast({ id: Date.now(), zone: z.name, title: enc.title, brief: enc.brief });
      setTimeout(() => setToast(null), 4200);
    } else {
      setToast({ id: Date.now(), zone: "—", title: "No encounter rolled", brief: "Quiet streets. Returning to base." });
      setTimeout(() => setToast(null), 3000);
    }
  };

  const rollAll = () => {
    // Roll for a random non-empty zone — flavor for the demo.
    const pool = Object.keys(window.WorldMap._encounters()).filter(
      (k) => window.WorldMap._encounters()[k].length
    );
    if (!pool.length) return;
    const id = pool[Math.floor(Math.random() * pool.length)];
    scout(id);
    setActiveId(id);
  };

  return (
    <div className="app">
      <TopBar filter={filter} setFilter={setFilter} />

      <main className={`stage ${!active ? "no-panel" : ""}`}>
        <div className="map-wrap">
          <div
            className="map"
            ref={mapRef}
            onClick={() => setActiveId(null)}
            onMouseMove={onMouseMove}
            onMouseLeave={() => setCoords(null)}
          >
            <div className="map-img" />
            <div className="map-vignette" />
            <div className="map-grain" />

            <div className="map-bracket tl" />
            <div className="map-bracket tr" />
            <div className="map-bracket bl" />
            <div className="map-bracket br" />

            <div className="map-compass">
              <div className="arrow" /> N · ETHOS HEIGHTS
            </div>
            {coords && (
              <div className="map-coords">
                X <em>{coords.x.toFixed(1)}</em>  ·  Y <em>{coords.y.toFixed(1)}</em>
              </div>
            )}
            <div className="map-scale">
              <div className="bar"><i/><i/><i/><i/></div> 500 m
            </div>

            <WorldEventsRibbon
              events={worldEvents}
              onFocus={(e) => {
                // jump to first affected destination if it's a destination
                const did = e.affects.find((id) => destinations.some((d) => d.id === id));
                if (did) setBriefDest(window.WorldMap.getDestination(did));
              }}
            />

            {zones.map((z) => (
              <Marker
                key={z.id}
                zone={z}
                event={events[z.id]}
                active={z.id === activeId}
                hidden={isHidden(z)}
                onSelect={setActiveId}
              />
            ))}

            {destinations.map((d) => (
              <DestMarker
                key={d.id}
                dest={d}
                active={briefDest?.id === d.id}
                onSelect={(id) => setBriefDest(window.WorldMap.getDestination(id))}
              />
            ))}
          </div>
        </div>

        {active && (
          <ZonePanel
            zone={active}
            event={activeEvent}
            onClose={() => setActiveId(null)}
            onScout={scout}
          />
        )}

        {toast && (
          <div className="toast" key={toast.id}>
            <div>
              <div className="label">{toast.zone} · encounter rolled</div>
              <div className="title">{toast.title}</div>
              <div className="brief">{toast.brief}</div>
            </div>
            <button onClick={() => setToast(null)}>Dismiss</button>
          </div>
        )}
      </main>

      <BottomBar
        onRollAll={rollAll}
        hint={<>Tip · click a <em>diamond</em> marker to plan an expedition. <em>Esc</em> backs out.</>}
      />

      {briefDest && !run && (
        <TravelBrief
          dest={briefDest}
          onClose={() => setBriefDest(null)}
          onBegin={beginExpedition}
        />
      )}

      {run && (
        <ExpeditionOverlay
          run={run}
          onAdvance={advanceNode}
          onAbort={abortRun}
          onResolve={resolveNode}
        />
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
