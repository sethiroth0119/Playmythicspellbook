/* eslint-disable */
// panel.jsx — right-side room detail panel. REAL data only (bridged from
// the game via window.__BRIDGE.camprooms[roomId]); no mock numbers.

function Panel({ room, onClose }) {
  if (!room) return null;
  const isEmpty = room.art === "empty";

  const bb =
    (window.__BRIDGE && window.__BRIDGE.camprooms && window.__BRIDGE.camprooms[room.id]) || null;
  const level   = bb ? bb.level : 0;
  const facMax  = bb && bb.facMax ? bb.facMax : 0;
  const facName = (bb && bb.facName) || "";
  const fx      = (bb && bb.fx) || "";
  const staffed = !!(bb && bb.staffed);
  const crew    = (bb && Array.isArray(bb.crew) && bb.crew.length) ? bb.crew : [];
  const req     = !!(bb && bb.req);

  return (
    <aside className={`panel ${room ? "open" : ""}`}>
      <header className="panel-hd">
        <div>
          <div className="panel-id">
            <span style={{ color: "var(--text-3)" }}>{room.code} ▸ </span>
            {room.tier} TIER · {room.depth}m
          </div>
          <h2 className="panel-title">{room.name}</h2>
          <div className="panel-sub">
            {bb
              ? <>Facility LV {level}{facMax ? ` / ${facMax}` : ""}{facName ? ` · ${facName}` : ""}</>
              : "—"}
          </div>
        </div>
        <button className="panel-close" onClick={onClose} aria-label="Close panel" title="Close (Esc)">✕</button>
      </header>

      <div className="panel-body">
        {!isEmpty && (
          <section className="panel-section">
            <h4>Function</h4>
            <div className="lore">
              {fx
                ? <>While staffed, this room: <strong>{fx}</strong>.</>
                : "This room contributes its facility bonus while its upgrade level rises in Camp Ops."}
              {req && !staffed && (
                <div style={{ marginTop: 6, color: "var(--amber, #ffc24a)", fontWeight: 700 }}>
                  ⚠ Hard-gated — it does nothing until a worker is stationed here.
                </div>
              )}
            </div>
          </section>
        )}

        {!isEmpty && (
          <section className="panel-section">
            <h4>
              Stationed crew{" "}
              <span style={{ color: staffed ? "var(--green,#7fdca0)" : "var(--text-3)" }}>
                {staffed ? "· ON DUTY" : "· UNSTAFFED"}
              </span>
            </h4>
            <div className="assign-list">
              {crew.length === 0 && (
                <div className="assign-row empty" title="No one stationed — open this room and assign a unit or hire an NPC">
                  <span className="assign-avatar">·</span>
                  <span>Unstaffed</span>
                  <span className="assign-stat"><b>—</b></span>
                </div>
              )}
              {crew.map((c, i) => (
                <div
                  className="assign-row"
                  key={i}
                  title={`${c.n} · ${c.role || "crew"} · ${c.kind === "unit" ? "your unit (deck-reserved)" : "hired NPC"}`}
                >
                  <span className="assign-avatar">{c.i}</span>
                  <span>
                    {c.n}
                    <span style={{ marginLeft: 8, color: "var(--text-3)", fontSize: 10 }}>{c.role}</span>
                  </span>
                  <span className="assign-stat"><b>{c.kind === "unit" ? "UNIT" : "NPC"}</b></span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      <footer className="panel-cta">
        {isEmpty ? (
          <button className="cta" onClick={onClose} title="Nothing built here yet">Close</button>
        ) : (
          <>
            <button className="cta" onClick={onClose} title="Close (Esc)">Close</button>
            <button
              className="cta primary"
              title={`Open the real ${room.name} system`}
              onClick={() => {
                try {
                  window.parent.postMessage(
                    { type: "base:action", action: room.bridge || "nav:campOps", room: room.id },
                    "*"
                  );
                } catch (e) {}
              }}
            >
              {room.bridgeLabel || "Manage"}
            </button>
          </>
        )}
      </footer>
    </aside>
  );
}

Object.assign(window, { Panel });
