/* eslint-disable */
// app.jsx — main wiring

const { useState, useEffect } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "chrome": "bronze",
  "showSurface": true,
  "ambientGlow": 1
}/*EDITMODE-END*/;

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [activeId, setActiveId] = useState(null);
  const [speed, setSpeed]   = useState(1);
  const [paused, setPaused] = useState(false);

  // 🔌 Re-render whenever the embedding game pushes fresh bridged data
  // (real resources etc.) so the mock UI reflects live state.
  const [, _bridgeBump] = useState(0);
  useEffect(() => {
    const f = () => _bridgeBump((n) => n + 1);
    window.addEventListener("bridgedata", f);
    return () => window.removeEventListener("bridgedata", f);
  }, []);

  const rooms  = window.ROOMS;
  const active = rooms.find((r) => r.id === activeId) || null;

  // simple ticking clock for HUD flavor
  const [clock, setClock] = useState({ h: 2, m: 14, s: 32 });
  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      setClock((c) => {
        let s = c.s + 1 * speed;
        let m = c.m, h = c.h;
        if (s >= 60) { m += Math.floor(s / 60); s %= 60; }
        if (m >= 60) { h += Math.floor(m / 60); m %= 60; }
        if (h >= 24) { h %= 24; }
        return { h, m, s };
      });
    }, 1000);
    return () => clearInterval(id);
  }, [speed, paused]);

  // close on Escape
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") setActiveId(null);
      if (e.key === " ")      { e.preventDefault(); setPaused((p) => !p); }
      if (e.key === "1")      setSpeed(1);
      if (e.key === "2")      setSpeed(2);
      if (e.key === "4")      setSpeed(4);
      // W — Ethos Heights, the district map in the parent game (see hud.jsx).
      if ((e.key === "w" || e.key === "W") && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || "")) {
        try { window.parent.postMessage({ type: "base:action", action: "ethos" }, window.location.origin); } catch (err) {}
      }
      // A — Camp Ops, the other door (the old Assign button's hotkey).
      if ((e.key === "a" || e.key === "A") && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || "")) {
        try { window.parent.postMessage({ type: "base:action", action: "nav:campOps" }, window.location.origin); } catch (err) {}
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const fmt = (n) => String(n).padStart(2, "0");
  const clockStr = `${fmt(clock.h)}:${fmt(clock.m)}:${fmt(clock.s)}`;

  return (
    <div
      className={`app chrome-${t.chrome}`}
    >
      <TopBar day="DAY 047" clock={clockStr} threat={38} />
      <LeftColumn />
      <RightColumn />

      <main className="stage" onClick={(e) => {
        // background click closes panel
        if (e.target === e.currentTarget) setActiveId(null);
      }}>
        <div className="stage-viewport">
          <div className="base-frame">
            {t.showSurface && (
              <div className="surface-strip">
                <span>SURFACE — DEAD ZONE</span>
                <span>WIND 14kt NW</span>
                <span>RAD 2.3 µSv</span>
                <span>VIS 80m · STORM</span>
              </div>
            )}

            <div className="depth-gauge">
              <div className="depth-tick"><em>−12m</em><span>surface</span></div>
              <div className="depth-tick"><em>−40m</em><span>mid</span></div>
              <div className="depth-tick"><em>−72m</em><span>deep</span></div>
            </div>

            <div className="base-cutaway">
              <div className="base-hull">
                <div className="room-grid">
                  {/* 🖼 FOR SHOW. Asked for: "Remove all of these modals from the
                      bunker pictures when they are clicked on. I just want them to
                      be for show." A room paints and glows; it opens nothing. The
                      two doors a player actually needs are the big Camp and Ethos
                      Heights buttons on the left (hud.jsx LeftColumn). */}
                  {rooms.map((r) => (
                    <Room
                      key={r.id}
                      room={r}
                      active={false}
                      onClick={undefined}
                    />
                  ))}
                </div>
                <div className="shaft">
                  <div className="shaft-car" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* The room panel is retired with the room click — nothing sets activeId
            any more, so this renders nothing; kept mounted so a future room CTA
            has its host back without re-wiring. */}
        <Panel room={null} onClose={() => setActiveId(null)} />
      </main>

      <BottomBar
        activeId={activeId}
        onSelect={setActiveId}
        speed={speed}
        setSpeed={setSpeed}
        paused={paused}
        setPaused={setPaused}
      />

      <TweaksPanel>
        <TweakSection label="Stage" />
        <TweakSlider
          label="Ambient glow"
          value={t.ambientGlow} min={0} max={2} step={0.1}
          onChange={(v) => setTweak("ambientGlow", v)}
        />
        <TweakToggle
          label="Surface strip"
          value={t.showSurface}
          onChange={(v) => setTweak("showSurface", v)}
        />

        <TweakSection label="UI Chrome" />
        <TweakRadio
          label="Style"
          value={t.chrome}
          options={[
            { value: "bronze", label: "Bronze" },
            { value: "holo",   label: "Holo" },
            { value: "mono",   label: "Mono" },
          ]}
          onChange={(v) => setTweak("chrome", v)}
        />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
