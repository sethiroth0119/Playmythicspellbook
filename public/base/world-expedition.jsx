/* eslint-disable */
// world-expedition.jsx
// Two flows on top of the world map:
//   1. TravelBrief  — modal that opens when a Destination POI is clicked.
//                     Shows threat, distance, known threats, rewards, active
//                     world-event modifiers. CTA → begins an expedition.
//   2. ExpeditionOverlay — full-screen node-graph view of the active run.
//                     Player advances node-by-node; stubs in resolve hooks
//                     for combat / shop / mystery handlers.
// All state lives in WorldMap (world-data.jsx). UI just renders + dispatches.

const { useState, useEffect, useMemo } = React;

// ─────────────────────────────────────────────────────────────
// Destination glyphs — diamond marker icons keyed to dest.glyph
// ─────────────────────────────────────────────────────────────
const DestGlyph = ({ kind }) => {
  switch (kind) {
    case "bazaar":    return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 6 L8 2 L13 6 V13 H3 Z"/><path d="M6 13 V9 H10 V13"/><path d="M3 6 H13"/></svg>;
    case "biohazard": return <svg viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="5" r="2"/><circle cx="5" cy="11" r="2"/><circle cx="11" cy="11" r="2"/><circle cx="8" cy="8" r="1.4" fill="#0a0612"/></svg>;
    case "ruins":     return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 13 L2 6 L5 4 L5 13 M5 8 L9 6 L9 13 M9 5 L13 3 L13 13"/></svg>;
    case "arena":     return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="6"/><path d="M5 5 L11 11 M5 11 L11 5"/></svg>;
    case "home":      return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 8 L8 3 L14 8 V13 H2 Z"/><rect x="6" y="9" width="4" height="4"/></svg>;
    case "unknown":   return <svg viewBox="0 0 16 16" fill="currentColor"><text x="8" y="12" textAnchor="middle" fontSize="14" fontWeight="700">?</text></svg>;
    default:          return <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5" fill="currentColor"/></svg>;
  }
};

const NodeGlyph = ({ kind }) => {
  switch (kind) {
    case "blade":    return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 13 L11 5 L13 3 L13 5 L5 13 Z"/><path d="M3 13 L5 11"/></svg>;
    case "skull":    return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M4 7 Q4 3 8 3 Q12 3 12 7 V10 H10 V13 H6 V10 H4 Z"/><circle cx="6" cy="8" r="1" fill="currentColor"/><circle cx="10" cy="8" r="1" fill="currentColor"/></svg>;
    case "path":     return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 14 Q4 8 8 8 Q12 8 14 2"/><circle cx="2" cy="14" r="1.2" fill="currentColor"/><circle cx="14" cy="2" r="1.2" fill="currentColor"/></svg>;
    case "spark":    return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M8 2 V6 M8 10 V14 M2 8 H6 M10 8 H14 M4 4 L6 6 M10 10 L12 12 M4 12 L6 10 M10 6 L12 4"/></svg>;
    case "coin":     return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="6"/><path d="M6 5 H10 M6 11 H10 M8 4 V12"/></svg>;
    case "fire":     return <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 2 Q5 5 5 8 Q5 12 8 14 Q11 12 11 8 Q11 5 8 2 Z"/></svg>;
    case "question": return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M5 6 Q5 3 8 3 Q11 3 11 6 Q11 8 8 9 V11"/><circle cx="8" cy="13" r=".8" fill="currentColor"/></svg>;
    case "shield":   return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M8 2 L13 4 V8 Q13 12 8 14 Q3 12 3 8 V4 Z"/></svg>;
    case "rune":     return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><polygon points="8,2 13,8 8,14 3,8"/><path d="M5 8 H11 M8 5 V11"/></svg>;
    case "star":     return <svg viewBox="0 0 16 16" fill="currentColor"><polygon points="8,2 10,6.5 14.5,7 11,10.5 12,15 8,12.7 4,15 5,10.5 1.5,7 6,6.5"/></svg>;
    case "home":     return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 8 L8 3 L14 8 V13 H2 Z"/></svg>;
    default:         return <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="4" fill="currentColor"/></svg>;
  }
};

// Icon for world-event ribbon
const EventIcon = ({ kind }) => {
  switch (kind) {
    case "shield": return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M8 2 L13 4 V8 Q13 12 8 14 Q3 12 3 8 V4 Z"/></svg>;
    case "skull":  return <svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 7 Q4 3 8 3 Q12 3 12 7 V10 H10 V13 H6 V10 H4 Z" fillRule="evenodd"/></svg>;
    case "storm":  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 5 L9 5 L7 9 L11 9 L5 14 L7 10 L4 10 Z"/></svg>;
    case "radio":  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="2"/><path d="M3 3 Q1 8 3 13 M13 3 Q15 8 13 13 M5 5 Q4 8 5 11 M11 5 Q12 8 11 11"/></svg>;
    default:       return <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="4" fill="currentColor"/></svg>;
  }
};

// ─────────────────────────────────────────────────────────────
// Destination marker — diamond, larger, glyph inside
// ─────────────────────────────────────────────────────────────
function DestMarker({ dest, active, onSelect }) {
  if (dest.locked) {
    return (
      <div
        className="dest-marker locked"
        style={{ left: `${dest.x}%`, top: `${dest.y}%` }}
        title={`${dest.name} — locked`}
      >
        <div className="dest-diamond"><div className="dest-glyph"><DestGlyph kind="unknown" /></div></div>
        <div className="dest-flag">
          <span className="name">???</span>
          <span className="tag">Hidden</span>
        </div>
      </div>
    );
  }
  return (
    <div
      className={`dest-marker kind-${dest.kind} ${active ? "active" : ""}`}
      style={{ left: `${dest.x}%`, top: `${dest.y}%` }}
      onClick={(e) => { e.stopPropagation(); onSelect(dest.id); }}
    >
      <div className="dest-ring" />
      <div className="dest-ring late" />
      <div className="dest-diamond">
        <div className="dest-glyph"><DestGlyph kind={dest.glyph} /></div>
      </div>
      <div className="dest-flag">
        <span className="name">{dest.name}</span>
        <span className="tag">{dest.tag}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// World events ribbon — floating at top of stage
// ─────────────────────────────────────────────────────────────
function WorldEventsRibbon({ events, onFocus }) {
  if (!events.length) return null;
  return (
    <div className="events-ribbon">
      {events.map((e) => {
        const affects = e.affects.map((id) => {
          const d = window.WorldMap.getDestination(id);
          const z = window.WorldMap.getZone(id);
          return (d || z)?.name;
        }).filter(Boolean).join(" · ");
        return (
          <button
            key={e.id}
            className={`event-card sev-${e.severity}`}
            onClick={() => onFocus(e)}
            data-tip={`${e.body}\n\nAffects: ${affects}`}
          >
            <span className="event-ic"><EventIcon kind={e.icon} /></span>
            <div className="event-text">
              <span className="event-title">{e.title}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Travel Brief — modal shown when a destination is selected.
//   props: dest, onClose, onBegin
// ─────────────────────────────────────────────────────────────
function TravelBrief({ dest, onClose, onBegin }) {
  const events = window.WorldMap.worldEvents.filter((e) => e.affects.includes(dest.id));
  const isRlc = !!dest.campaignId;
  const nodeCount = dest.distance || 0;
  const threatLabel =
    dest.threat <= 1 ? "Low"  : dest.threat <= 2 ? "Mild" : dest.threat <= 3 ? "Moderate"
  : dest.threat <= 4 ? "High" : "Lethal";

  return (
    <div className="brief-backdrop" onClick={onClose}>
      <aside className="brief" onClick={(e) => e.stopPropagation()}>
        <header className="brief-hd">
          <div className="brief-glyph"><DestGlyph kind={dest.glyph} /></div>
          <div className="brief-titles">
            <div className="brief-tag">{dest.tag}</div>
            <h2 className="brief-name">{dest.name}</h2>
            <div className="brief-sub">
              {isRlc ? "Region briefing · launches a real roguelite run" : "Region briefing"}
            </div>
          </div>
          <button className="brief-close" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <div className="brief-stats">
          <div className="bstat">
            <span className="k">Threat Level</span>
            <span className={`v threat-${dest.threat <= 2 ? "low" : dest.threat <= 3 ? "mid" : "high"}`}>
              {threatLabel}
            </span>
            <div className="threat-bar">
              {Array.from({ length: 5 }, (_, i) => <i key={i} className={i < dest.threat ? "on" : ""} />)}
            </div>
          </div>
          <div className="bstat">
            <span className="k">Map Size</span>
            <span className="v">{nodeCount} <small>nodes</small></span>
          </div>
          <div className="bstat">
            <span className="k">Run Type</span>
            <span className="v purple">{isRlc ? "ROGUELITE" : "—"}</span>
          </div>
          <div className="bstat">
            <span className="k">Bank Loot</span>
            <span className="v bronze">🚚 Convoy</span>
          </div>
        </div>

        <div className="brief-body">
          <section className="brief-section">
            <h4>Intel</h4>
            <div className="brief-blurb">{dest.blurb}</div>
          </section>

          <div className="brief-cols">
            <section className="brief-section">
              <h4>Known Threats</h4>
              <ul className="brief-list threat-list">
                {dest.knownThreats?.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </section>
            <section className="brief-section">
              <h4>Potential Rewards</h4>
              <ul className="brief-list reward-list">
                {dest.rewards?.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </section>
          </div>

          {events.length > 0 && (
            <section className="brief-section">
              <h4>Active World Events</h4>
              {events.map((e) => (
                <div className={`brief-event sev-${e.severity}`} key={e.id}>
                  <span className="ic"><EventIcon kind={e.icon} /></span>
                  <div>
                    <div className="t">{e.title}</div>
                    <div className="b">{e.body}</div>
                    <div className="m">
                      {e.mods.extraNodes  ? <span>+{e.mods.extraNodes} nodes</span> : null}
                      {e.mods.dangerBoost ? <span>+{e.mods.dangerBoost} danger</span> : null}
                      {e.mods.rewardBoost ? <span>+{e.mods.rewardBoost}% reward</span> : null}
                    </div>
                  </div>
                </div>
              ))}
            </section>
          )}

          <section className="brief-section">
            <h4>Extraction</h4>
            <div className="brief-extract">
              Reaching <em>{dest.name}</em> is half the run. Survivors must carry enough
              fuel, medicine, and inventory to make it home — every node consumed
              counts against the trip back.
            </div>
          </section>
        </div>

        <footer className="brief-cta">
          <button className="cta" onClick={onClose}>Stand Down</button>
          <button className="cta primary" onClick={() => onBegin(dest.id)}>
            {dest.campaignId
              ? (dest.inProgress ? "Continue Run" : "Launch Campaign")
              : "Begin Expedition"}
            <span className="cost">
              {dest.campaignId ? "real roguelite" : "−4 fuel · −2 supplies"}
            </span>
          </button>
        </footer>
      </aside>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Expedition Overlay — full-screen node-graph view
// ─────────────────────────────────────────────────────────────
function ExpeditionOverlay({ run, onAdvance, onAbort, onResolve }) {
  if (!run) return null;
  const { route } = run;
  const dest = window.WorldMap.getDestination(route.destId);
  const currentNode = route.nodes.find((n) => n.id === run.currentId);
  const nextIds = currentNode?.next || [];

  // Layout: column positions (X), rows (Y).
  // We use viewBox 0..100 for layout math, then scale via CSS.
  const colCount = route.cols;
  const xOf = (col) => 6 + (col / Math.max(1, colCount - 1)) * 88;
  const yOf = (row) => 22 + row * 28;   // rows 0..2 → 22 / 50 / 78

  const isVisited = (id) => run.visited.has(id);
  const isCurrent = (id) => id === run.currentId;
  const isReachable = (id) => nextIds.includes(id);

  return (
    <div className="exp-overlay">
      <header className="exp-hd">
        <div>
          <div className="exp-tag">Active Expedition</div>
          <h2 className="exp-name">{dest.name}</h2>
          <div className="exp-sub">{dest.tag} · seed #{route.seed}</div>
        </div>
        <div className="exp-progress">
          <div className="exp-pbar">
            <i style={{ width: `${(currentNode.col / (colCount - 1)) * 100}%` }} />
          </div>
          <div className="exp-pcount">
            Node <em>{currentNode.col + 1}</em> of <em>{colCount}</em>
            {run.status === "arrived" && <span className="exp-arrived"> · ARRIVED</span>}
          </div>
        </div>
        <button className="brief-close" onClick={onAbort} aria-label="Abort">✕</button>
      </header>

      <div className="exp-stage">
        <svg className="exp-edges" viewBox="0 0 100 100" preserveAspectRatio="none">
          {route.nodes.flatMap((n) =>
            (n.next || []).map((tid) => {
              const t = route.nodes.find((x) => x.id === tid);
              const active = isVisited(n.id) && isVisited(tid);
              const live = isCurrent(n.id) && isReachable(tid);
              return (
                <line
                  key={`${n.id}-${tid}`}
                  x1={xOf(n.col)} y1={yOf(n.row)}
                  x2={xOf(t.col)} y2={yOf(t.row)}
                  className={`edge ${active ? "done" : ""} ${live ? "live" : ""}`}
                />
              );
            })
          )}
        </svg>

        {route.nodes.map((n) => {
          const meta = window.WorldMap.nodeTypes[n.type] || {};
          const cls = [
            "exp-node",
            `t-${n.type}`,
            `tone-${meta.tone || "bronze"}`,
            isVisited(n.id) && "visited",
            isCurrent(n.id) && "current",
            isReachable(n.id) && "reachable",
            run.status === "arrived" && n.id === route.endId && "arrived",
          ].filter(Boolean).join(" ");
          return (
            <button
              key={n.id}
              className={cls}
              style={{ left: `${xOf(n.col)}%`, top: `${yOf(n.row)}%` }}
              disabled={!isReachable(n.id) && !isCurrent(n.id)}
              onClick={() => isReachable(n.id) && onAdvance(n.id)}
            >
              <div className="node-disc">
                <div className="node-glyph"><NodeGlyph kind={meta.glyph} /></div>
              </div>
              <div className="node-label">
                <span className="node-type">{meta.label}</span>
                <span className="node-name">{n.name}</span>
              </div>
              {n.danger > 0 && (
                <div className="node-danger">
                  {Array.from({ length: Math.min(5, n.danger) }, (_, i) => <i key={i} />)}
                </div>
              )}
            </button>
          );
        })}
      </div>

      <aside className="exp-side">
        <h4>Run Log</h4>
        <div className="exp-log">
          {run.log.slice().reverse().map((l, i) => (
            <div className="log-row" key={i}>
              <span className="log-t">{new Date(l.ts).toLocaleTimeString([], { hour12: false })}</span>
              <span className="log-m">{l.msg}</span>
            </div>
          ))}
        </div>

        {currentNode && currentNode.type !== "start" && (
          <div className="exp-actions">
            <button className="cta" onClick={() => onResolve(currentNode)}>
              Resolve · {window.WorldMap.nodeTypes[currentNode.type]?.label}
            </button>
          </div>
        )}

        <div className="exp-tip">
          Pick a connected node to advance. Once you reach <em>{dest.name}</em>,
          the expedition completes and you return to camp. Resolve hooks for combat,
          shops, and mysteries are stubs — replace in <code>onResolve</code>.
        </div>

        <div className="exp-cta">
          <button className="cta" onClick={onAbort}>Abandon Run</button>
          {run.status === "arrived" && (
            <button className="cta primary" onClick={onAbort}>Complete Run</button>
          )}
        </div>
      </aside>
    </div>
  );
}

Object.assign(window, {
  DestMarker, WorldEventsRibbon, TravelBrief, ExpeditionOverlay,
  DestGlyph, NodeGlyph, EventIcon,
});
