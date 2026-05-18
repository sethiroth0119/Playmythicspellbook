/* eslint-disable */
// panel.jsx — right-side room detail panel

function Panel({ room, onClose }) {
  if (!room) return null;
  const isEmpty = room.art === "empty";

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
        <button className="panel-close" onClick={onClose} aria-label="Close panel">✕</button>
      </header>

      <div className="panel-body">

        {!isEmpty && (
          <section className="panel-section">
            <h4>Output</h4>
            <div className="kv-grid">
              <div className="kv">
                <span className="k">{room.output.label}</span>
                <span className={`v ${room.output.tone}`}>{room.output.value} <small>{room.output.unit}</small></span>
              </div>
              <div className="kv">
                <span className="k">{room.secondary.label}</span>
                <span className={`v ${room.secondary.tone}`}>{room.secondary.value} <small>{room.secondary.unit}</small></span>
              </div>
              <div className="kv">
                <span className="k">WORKERS</span>
                <span className="v">{room.workers.on} / {room.workers.max}</span>
              </div>
              <div className="kv">
                <span className="k">UPKEEP</span>
                <span className="v bronze">{room.cost.power > 0 ? "−" : "+"}{Math.abs(room.cost.power)} <small>MW</small></span>
              </div>
            </div>
          </section>
        )}

        {!isEmpty && (
          <section className="panel-section">
            <h4>Assigned crew · {room.crew.filter((c) => !c.empty).length}/{room.workers.max}</h4>
            <div className="assign-list">
              {room.crew.map((c, i) => (
                <div className={`assign-row ${c.empty ? "empty" : ""}`} key={i}>
                  <span className="assign-avatar">{c.i}</span>
                  <span>
                    {c.n}
                    <span style={{ marginLeft: 8, color: "var(--text-3)", fontSize: 10 }}>{c.role}</span>
                  </span>
                  <span className="assign-stat"><b>{c.st}</b></span>
                </div>
              ))}
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
                  <div className={`upg-tier ${cls}`} key={i}>
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
                <div className="assign-row" key={b.id} style={{ cursor: "pointer" }}>
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
            <button className="cta" onClick={onClose}>Cancel</button>
            <button className="cta primary">Begin Build <span className="cost">−240 ⛁</span></button>
          </>
        ) : room.bridge ? (
          <>
            <button className="cta" onClick={onClose}>Close</button>
            <button
              className="cta primary"
              onClick={() => {
                try { window.parent.postMessage({ type: "base:action", action: room.bridge, room: room.id }, "*"); } catch (e) {}
              }}
            >
              {room.bridgeLabel || "Open"}
            </button>
          </>
        ) : (
          <>
            <button className="cta">Reassign</button>
            <button className="cta primary">
              Upgrade <span className="cost">−{room.cost.scrap} ⛁</span>
            </button>
          </>
        )}
      </footer>
    </aside>
  );
}

Object.assign(window, { Panel });
