/* eslint-disable */
// panel.jsx — right-side room detail panel

function Panel({ room, onClose }) {
  if (!room) return null;
  const isEmpty = room.art === "empty";
  // Real stationed workers (units/NPCs) for this room replace the mock crew
  // when present; otherwise the ambient placeholder crew stays as flavor.
  const _bbCrew =
    (window.__BRIDGE && window.__BRIDGE.camprooms && window.__BRIDGE.camprooms[room.id] &&
     window.__BRIDGE.camprooms[room.id].crew) || null;
  const realCrew = _bbCrew && _bbCrew.length ? _bbCrew : null;
  const crew = realCrew || room.crew || [];

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
            LV {room.level} / {room.levelMax} · status&nbsp;
            <em style={{
              fontStyle: "normal",
              color:
                room.status === "ok"   ? "var(--green)"
              : room.status === "warn" ? "var(--amber)"
              : room.status === "crit" ? "var(--red)"
              : "var(--blue-hi)"
            }}>
              {room.status.toUpperCase()}
            </em>
          </div>
        </div>
        <button className="panel-close" onClick={onClose} aria-label="Close panel" title="Close (Esc)">✕</button>
      </header>

      <div className="panel-body">

        {!isEmpty && (
          <section className="panel-section">
            <h4>Output</h4>
            <div className="kv-grid">
              <div className="kv" title={`Primary output of this room: ${room.output.label} ${room.output.value} ${room.output.unit || ""}`}>
                <span className="k">{room.output.label}</span>
                <span className={`v ${room.output.tone}`}>{room.output.value} <small>{room.output.unit}</small></span>
              </div>
              <div className="kv" title={`Secondary output: ${room.secondary.label} ${room.secondary.value} ${room.secondary.unit || ""}`}>
                <span className="k">{room.secondary.label}</span>
                <span className={`v ${room.secondary.tone}`}>{room.secondary.value} <small>{room.secondary.unit}</small></span>
              </div>
              <div className="kv" title={`Crew assigned: ${room.workers.on} of ${room.workers.max} slots filled`}>
                <span className="k">WORKERS</span>
                <span className="v">{room.workers.on} / {room.workers.max}</span>
              </div>
              <div className="kv" title={room.cost.power > 0 ? `Consumes ${Math.abs(room.cost.power)} MW of power` : `Generates ${Math.abs(room.cost.power)} MW of power`}>
                <span className="k">UPKEEP</span>
                <span className="v bronze">{room.cost.power > 0 ? "−" : "+"}{Math.abs(room.cost.power)} <small>MW</small></span>
              </div>
            </div>
          </section>
        )}

        {!isEmpty && (
          <section className="panel-section">
            <h4>
              {realCrew ? "Stationed crew" : "Assigned crew"} ·{" "}
              {crew.filter((c) => !c.empty).length}
              {realCrew ? "" : `/${room.workers.max}`}
            </h4>
            <div className="assign-list">
              {crew.length === 0 && (
                <div className="assign-row empty" title="No one stationed — assign in Camp Ops">
                  <span className="assign-avatar">·</span>
                  <span>Unstaffed</span>
                  <span className="assign-stat"><b>—</b></span>
                </div>
              )}
              {crew.map((c, i) => {
                const stat = c.st || (realCrew ? (c.kind === "unit" ? "UNIT" : "STAFF") : "");
                return (
                <div
                  className={`assign-row ${c.empty ? "empty" : ""}`}
                  key={i}
                  title={c.empty ? "Empty crew slot — assign someone here" : `${c.n} · ${c.role || "crew"}${stat ? " · " + stat : ""}`}
                >
                  <span className="assign-avatar">{c.i}</span>
                  <span>
                    {c.n}
                    <span style={{ marginLeft: 8, color: "var(--text-3)", fontSize: 10 }}>{c.role}</span>
                  </span>
                  <span className="assign-stat"><b>{stat}</b></span>
                </div>
                );
              })}
            </div>
          </section>
        )}

        {!isEmpty && (
          <section className="panel-section">
            <h4>Upgrade Path</h4>
            <div className="upgrade">
              {room.upgrade.map((u, i) => {
                const done = i + 1 < room.level;
                const cur  = i + 1 === room.level;
                const cls  = done ? "done" : cur ? "cur" : "";
                return (
                  <div
                    className={`upg-tier ${cls}`}
                    key={i}
                    title={`${u.t} — ${u.d}${done ? "  (built)" : cur ? "  (current level)" : "  (locked — upgrade to unlock)"}`}
                  >
                    <span className="t">{u.t}</span>
                    <span className="v">{u.d.split(",")[0]}</span>
                    <span className="desc">{u.d}</span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section className="panel-section">
          <h4>Field Log</h4>
          <div className="lore">{room.lore}</div>
        </section>

        {isEmpty && (
          <section className="panel-section">
            <h4>Available Builds</h4>
            <div className="assign-list">
              {[
                { id: "FRM", n: "Hydro Farm",      tag: "+18 food/cycle" },
                { id: "WPN", n: "Weapon Crafting", tag: "+ gear tier" },
                { id: "SUM", n: "Summoning Hall",  tag: "card → unit" },
                { id: "WKS", n: "Workshop",        tag: "+ scrap rate" },
              ].map((b) => (
                <div
                  className="assign-row"
                  key={b.id}
                  style={{ cursor: "pointer" }}
                  title={`Build ${b.n} — ${b.tag}`}
                >
                  <span className="assign-avatar">{b.id}</span>
                  <span>{b.n}</span>
                  <span className="assign-stat"><b>{b.tag}</b></span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      <footer className="panel-cta">
        {isEmpty ? (
          <>
            <button className="cta" onClick={onClose} title="Cancel and close this panel">Cancel</button>
            <button className="cta primary" title="Start construction here (costs 240 scrap)">Begin Build <span className="cost">−240 ⛁</span></button>
          </>
        ) : room.bridge ? (
          <>
            <button className="cta" onClick={onClose} title="Close (Esc)">Close</button>
            <button
              className="cta primary"
              title={`Opens the real ${room.name} system`}
              onClick={() => {
                try { window.parent.postMessage({ type: "base:action", action: room.bridge, room: room.id }, "*"); } catch (e) {}
              }}
            >
              {room.bridgeLabel || "Open"}
            </button>
          </>
        ) : (
          <>
            <button className="cta" title="Reassign the crew working in this room">Reassign</button>
            <button className="cta primary" title={`Upgrade this room to the next tier (costs ${room.cost.scrap} scrap)`}>
              Upgrade <span className="cost">−{room.cost.scrap} ⛁</span>
            </button>
          </>
        )}
      </footer>
    </aside>
  );
}

Object.assign(window, { Panel });
