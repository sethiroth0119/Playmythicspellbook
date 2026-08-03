/* eslint-disable */
// rooms.jsx — cinematic wireframe placeholders for each room
// Each art is an inline SVG silhouette + CSS glow layer. No painterly art —
// these are stylized diagrammatic placeholders to be replaced by real art later.

const { useMemo } = React;

// ───────────────────────────────────────────────────────────────
// Re-usable atoms
// ───────────────────────────────────────────────────────────────
const Floor = ({ y = 88, color = "#1c1124" }) => (
  <rect x="0" y={y} width="100" height={100 - y} fill={color} />
);
const Wall = () => (
  <>
    <rect x="0" y="0"  width="2" height="100" fill="#0a0612" />
    <rect x="98" y="0" width="2" height="100" fill="#0a0612" />
    <rect x="0" y="0"  width="100" height="2" fill="#06030a" />
  </>
);
// Tiny figure silhouette
const Figure = ({ x, y, scale = 1, fill = "#3a2d4a", arms = false }) => (
  <g transform={`translate(${x} ${y}) scale(${scale})`} fill={fill}>
    <ellipse cx="0" cy="-7" rx="1.4" ry="1.7" />
    <rect x="-1.4" y="-5.4" width="2.8" height="4.5" rx="0.4" />
    <rect x="-1.2" y="-1.0" width="1.1" height="3.2" />
    <rect x=" 0.1" y="-1.0" width="1.1" height="3.2" />
    {arms && <>
      <rect x="-2.6" y="-5" width="1" height="3" />
      <rect x=" 1.6" y="-5" width="1" height="3" />
    </>}
  </g>
);

// pipe / cable bundle along ceiling
const CeilingPipes = ({ stroke = "#2a1f38" }) => (
  <g stroke={stroke} strokeWidth="0.6" fill="none">
    <path d="M0 4 H100" />
    <path d="M0 6 H100" />
    <path d="M0 8 H100" strokeDasharray="2 2" />
    <circle cx="10" cy="4" r="0.7" fill={stroke} />
    <circle cx="38" cy="4" r="0.7" fill={stroke} />
    <circle cx="72" cy="4" r="0.7" fill={stroke} />
  </g>
);

// ───────────────────────────────────────────────────────────────
// COMMAND CENTER
// ───────────────────────────────────────────────────────────────
const ArtCommand = () => (
  <svg viewBox="0 0 100 100" preserveAspectRatio="none">
    <Wall />
    <Floor />
    <CeilingPipes />
    {/* big holo table center */}
    <ellipse cx="50" cy="78" rx="22" ry="2.5" fill="#1a1024" />
    <rect x="32" y="72" width="36" height="6" fill="#241636" stroke="#3a2050" strokeWidth="0.4" />
    {/* projected globe */}
    <g opacity="0.9">
      <circle cx="50" cy="58" r="11" fill="none" stroke="#c08a3c" strokeWidth="0.4" opacity=".6" />
      <ellipse cx="50" cy="58" rx="11" ry="3.5" fill="none" stroke="#c08a3c" strokeWidth="0.3" opacity=".6"/>
      <ellipse cx="50" cy="58" rx="11" ry="6.5" fill="none" stroke="#c08a3c" strokeWidth="0.3" opacity=".5"/>
      <path d="M40 58 Q44 54 50 56 Q56 58 60 55" fill="none" stroke="#e6b66a" strokeWidth=".3"/>
      <path d="M42 60 Q47 62 53 60 Q57 59 58 61" fill="none" stroke="#e6b66a" strokeWidth=".3"/>
      <circle cx="50" cy="58" r="11" fill="url(#cmd-glow)" opacity=".55"/>
    </g>
    <defs>
      <radialGradient id="cmd-glow">
        <stop offset="0%" stopColor="#e6b66a" stopOpacity=".5"/>
        <stop offset="100%" stopColor="#c08a3c" stopOpacity="0"/>
      </radialGradient>
    </defs>
    {/* light beam */}
    <path d="M50 18 L42 72 L58 72 Z" fill="#c08a3c" opacity=".08"/>
    {/* monitors back */}
    <rect x="10" y="42" width="14" height="10" fill="#0a0612" stroke="#3a2a4a" strokeWidth="0.3"/>
    <rect x="11" y="43" width="12" height="8" fill="#1a3a5a" opacity=".7"/>
    <rect x="76" y="42" width="14" height="10" fill="#0a0612" stroke="#3a2a4a" strokeWidth="0.3"/>
    <rect x="77" y="43" width="12" height="8" fill="#3a1a2a" opacity=".5"/>
    {/* figures around table */}
    <Figure x="34" y="86" scale="0.9" fill="#4a3a5a" />
    <Figure x="42" y="86" scale="0.9" fill="#4a3a5a" arms />
    <Figure x="58" y="86" scale="0.9" fill="#4a3a5a" />
    <Figure x="66" y="86" scale="0.9" fill="#4a3a5a" />
  </svg>
);

// ───────────────────────────────────────────────────────────────
// BARRACKS
// ───────────────────────────────────────────────────────────────
const ArtBarracks = () => (
  <svg viewBox="0 0 100 100" preserveAspectRatio="none">
    <Wall /><Floor />
    <CeilingPipes />
    {/* bunk beds — 3 stacks of 2 */}
    {[12, 44, 76].map((x, i) => (
      <g key={i}>
        {/* lower */}
        <rect x={x} y="76" width="14" height="6" fill="#1a1024" stroke="#3a2a4a" strokeWidth="0.3"/>
        <rect x={x+2} y="74" width="10" height="2" fill="#3a2a4a" opacity=".6"/>
        {/* upper */}
        <rect x={x} y="56" width="14" height="6" fill="#1a1024" stroke="#3a2a4a" strokeWidth="0.3"/>
        <rect x={x+2} y="54" width="10" height="2" fill="#3a2a4a" opacity=".6"/>
        {/* posts */}
        <rect x={x} y="56" width="0.8" height="26" fill="#2a1f38"/>
        <rect x={x+13.2} y="56" width="0.8" height="26" fill="#2a1f38"/>
        {/* sleeping figure (one in lower-left, blanket lump) */}
        {i===0 && <ellipse cx={x+7} cy="78" rx="5" ry="1.5" fill="#3a2d4a"/>}
        {i===2 && <ellipse cx={x+7} cy="58" rx="5" ry="1.5" fill="#3a2d4a"/>}
        {/* hanging jacket */}
        <line x1={x+13.5} y1="63" x2={x+15} y2="68" stroke="#c08a3c" strokeWidth="0.3" opacity=".5"/>
      </g>
    ))}
    {/* dim wall lamp */}
    <rect x="48" y="22" width="4" height="3" fill="#c08a3c" opacity=".4"/>
    <path d="M50 25 L42 50 L58 50 Z" fill="#c08a3c" opacity=".06"/>
    {/* one standing figure */}
    <Figure x="30" y="88" scale="0.9" fill="#4a3a5a" />
  </svg>
);

// ───────────────────────────────────────────────────────────────
// MEDICAL
// ───────────────────────────────────────────────────────────────
const ArtMedical = () => (
  <svg viewBox="0 0 100 100" preserveAspectRatio="none">
    <Wall /><Floor color="#0e1a24"/>
    <CeilingPipes stroke="#1f3a5a"/>
    {/* surgical light */}
    <circle cx="50" cy="28" r="6" fill="#7ec0ff" opacity=".25"/>
    <circle cx="50" cy="28" r="3" fill="#9fcfff" opacity=".7"/>
    <line x1="50" y1="2" x2="50" y2="22" stroke="#1f3a5a" strokeWidth="0.4"/>
    <path d="M50 32 L40 78 L60 78 Z" fill="#9fcfff" opacity=".09"/>
    {/* operating table */}
    <rect x="34" y="76" width="32" height="4" fill="#1a2230" stroke="#1f3a5a" strokeWidth="0.3"/>
    <rect x="38" y="74" width="24" height="2.5" fill="#e8e2d0" opacity=".6"/>
    <rect x="36" y="80" width="3" height="6" fill="#1a2230"/>
    <rect x="61" y="80" width="3" height="6" fill="#1a2230"/>
    {/* patient outline */}
    <ellipse cx="50" cy="73.5" rx="9" ry="1.4" fill="#4a3a5a"/>
    {/* heart monitor */}
    <rect x="10" y="46" width="14" height="10" fill="#0a0612" stroke="#1f3a5a" strokeWidth="0.3"/>
    <polyline points="11,52 13,52 14,49 15,54 16,52 18,52 19,50 22,50" fill="none" stroke="#4ad6a0" strokeWidth="0.4"/>
    {/* IV pole */}
    <line x1="74" y1="55" x2="74" y2="80" stroke="#3a2a4a" strokeWidth="0.4"/>
    <rect x="72" y="55" width="4" height="6" fill="#9fcfff" opacity=".3" stroke="#1f3a5a" strokeWidth="0.2"/>
    {/* medic standing */}
    <Figure x="76" y="86" scale="0.9" fill="#4a5a6a" arms/>
  </svg>
);

// ───────────────────────────────────────────────────────────────
// AI LAB
// ───────────────────────────────────────────────────────────────
const ArtAI = () => (
  <svg viewBox="0 0 100 100" preserveAspectRatio="none">
    <Wall /><Floor color="#0a1422"/>
    <CeilingPipes stroke="#1f3a5a"/>
    {/* server racks */}
    {[6, 18, 78, 90].map((x, i) => (
      <g key={i}>
        <rect x={x} y="20" width="6" height="64" fill="#08101c" stroke="#1f3a5a" strokeWidth="0.3"/>
        {Array.from({length: 10}, (_, j) => (
          <rect key={j} x={x+0.6} y={22 + j*6} width="4.8" height="4" fill={j%3===0 ? "#3a8fd4" : "#14253a"} opacity={j%3===0 ? .7 : 1}/>
        ))}
      </g>
    ))}
    {/* central ATHENA core */}
    <ellipse cx="50" cy="86" rx="14" ry="2" fill="#0a1422"/>
    <g>
      <circle cx="50" cy="58" r="14" fill="none" stroke="#4fa3ff" strokeWidth="0.5" opacity=".7"/>
      <circle cx="50" cy="58" r="10" fill="none" stroke="#7ec0ff" strokeWidth="0.4" opacity=".6"/>
      <circle cx="50" cy="58" r="6" fill="#9fcfff" opacity=".6"/>
      <circle cx="50" cy="58" r="3" fill="#fff" opacity=".9"/>
      <line x1="36" y1="58" x2="64" y2="58" stroke="#7ec0ff" strokeWidth=".25" opacity=".5"/>
      <line x1="50" y1="44" x2="50" y2="72" stroke="#7ec0ff" strokeWidth=".25" opacity=".5"/>
    </g>
    {/* core glow ring on floor */}
    <ellipse cx="50" cy="84" rx="16" ry="2.5" fill="#4fa3ff" opacity=".25"/>
    {/* holo bracket cables */}
    <line x1="50" y1="58" x2="40" y2="84" stroke="#1f3a5a" strokeWidth="0.4"/>
    <line x1="50" y1="58" x2="60" y2="84" stroke="#1f3a5a" strokeWidth="0.4"/>
    <line x1="50" y1="58" x2="50" y2="20" stroke="#1f3a5a" strokeWidth="0.4"/>
    {/* scientist */}
    <Figure x="32" y="88" scale="0.9" fill="#3a5a7a" arms/>
    <Figure x="68" y="88" scale="0.9" fill="#3a5a7a"/>
  </svg>
);

// ───────────────────────────────────────────────────────────────
// CARD FORGE
// ───────────────────────────────────────────────────────────────
const ArtForge = () => (
  <svg viewBox="0 0 100 100" preserveAspectRatio="none">
    <Wall /><Floor color="#1a0c22"/>
    <CeilingPipes stroke="#3a2050"/>
    {/* anvil / forge block */}
    <rect x="30" y="76" width="40" height="10" fill="#241636" stroke="#3a2050" strokeWidth="0.3"/>
    <rect x="34" y="72" width="32" height="4" fill="#3a2050"/>
    {/* molten glow inside */}
    <ellipse cx="50" cy="74" rx="14" ry="1.5" fill="#b48cff" opacity=".7"/>
    <ellipse cx="50" cy="74" rx="10" ry="1" fill="#e6b66a" opacity=".8"/>
    {/* floating cards above forge */}
    {[
      { x: 38, y: 50, rot: -10 },
      { x: 50, y: 42, rot: 4  },
      { x: 62, y: 50, rot: 12 },
    ].map((c, i) => (
      <g key={i} transform={`translate(${c.x} ${c.y}) rotate(${c.rot})`}>
        <rect x="-5" y="-7" width="10" height="14" rx="0.8" fill="#1a0a24" stroke="#b48cff" strokeWidth=".4"/>
        <rect x="-3.5" y="-5" width="7" height="4.5" fill="#b48cff" opacity=".5"/>
        <line x1="-3.5" y1="2" x2="3.5" y2="2" stroke="#b48cff" strokeWidth=".3"/>
        <line x1="-3.5" y1="4" x2="2" y2="4" stroke="#b48cff" strokeWidth=".3" opacity=".5"/>
      </g>
    ))}
    {/* glyph circle on floor */}
    <ellipse cx="50" cy="86" rx="22" ry="2.5" fill="#8b5cff" opacity=".25"/>
    {/* hammer / tool on wall */}
    <line x1="14" y1="40" x2="20" y2="46" stroke="#c08a3c" strokeWidth="0.5"/>
    <rect x="11" y="36" width="6" height="3" fill="#3a2a4a" stroke="#c08a3c" strokeWidth=".3"/>
    {/* sparks */}
    {[ [40,68],[50,66],[60,68],[44,72],[56,72] ].map(([x,y], i) => (
      <circle key={i} cx={x} cy={y} r="0.5" fill="#e6b66a"/>
    ))}
    <Figure x="22" y="88" scale="0.9" fill="#5a3a7a" arms/>
    <Figure x="78" y="88" scale="0.9" fill="#5a3a7a" arms/>
  </svg>
);

// ───────────────────────────────────────────────────────────────
// TRAINING
// ───────────────────────────────────────────────────────────────
const ArtTraining = () => (
  <svg viewBox="0 0 100 100" preserveAspectRatio="none">
    <Wall /><Floor />
    <CeilingPipes />
    {/* mat */}
    <rect x="12" y="80" width="76" height="6" fill="#241636" opacity=".7"/>
    {/* dummies */}
    {[20, 50, 80].map((x, i) => (
      <g key={i}>
        <line x1={x} y1="50" x2={x} y2="80" stroke="#3a2a4a" strokeWidth="0.8"/>
        <circle cx={x} cy="48" r="2.5" fill="#3a2a4a"/>
        <rect x={x-3} y="52" width="6" height="8" fill="#3a2a4a"/>
        <line x1={x-4} y1="55" x2={x-7} y2="62" stroke="#3a2a4a" strokeWidth="0.8"/>
        <line x1={x+4} y1="55" x2={x+7} y2="62" stroke="#3a2a4a" strokeWidth="0.8"/>
      </g>
    ))}
    {/* holo opponent */}
    <g opacity=".7">
      <rect x="62" y="50" width="6" height="14" fill="#4fa3ff" opacity=".4"/>
      <circle cx="65" cy="46" r="2.5" fill="#7ec0ff" opacity=".6"/>
      <line x1="65" y1="50" x2="65" y2="80" stroke="#7ec0ff" strokeWidth=".4" opacity=".5" strokeDasharray="1 1"/>
    </g>
    {/* trainee mid-swing */}
    <Figure x="34" y="86" scale="1" fill="#4a3a5a" arms/>
    <Figure x="46" y="86" scale="1" fill="#4a3a5a"/>
    {/* ceiling spotlight */}
    <path d="M50 14 L36 80 L64 80 Z" fill="#c08a3c" opacity=".06"/>
    <rect x="48" y="10" width="4" height="4" fill="#c08a3c" opacity=".5"/>
  </svg>
);

// ───────────────────────────────────────────────────────────────
// REACTOR
// ───────────────────────────────────────────────────────────────
const ArtReactor = () => (
  <svg viewBox="0 0 100 100" preserveAspectRatio="none">
    <Wall /><Floor color="#1a0a22"/>
    <CeilingPipes stroke="#3a2050"/>
    {/* cooling towers L & R */}
    <path d="M8 86 L8 50 L14 32 L20 50 L20 86 Z" fill="#1a1024" stroke="#3a2050" strokeWidth=".4"/>
    <path d="M80 86 L80 50 L86 32 L92 50 L92 86 Z" fill="#1a1024" stroke="#3a2050" strokeWidth=".4"/>
    {/* steam */}
    <ellipse cx="14" cy="28" rx="5" ry="2" fill="#fff" opacity=".06"/>
    <ellipse cx="86" cy="28" rx="5" ry="2" fill="#fff" opacity=".06"/>
    {/* central core */}
    <rect x="32" y="48" width="36" height="38" fill="#1a0a22" stroke="#3a2050" strokeWidth=".4"/>
    <circle cx="50" cy="64" r="11" fill="#3a2050"/>
    <circle cx="50" cy="64" r="8"  fill="#8b5cff" opacity=".75"/>
    <circle cx="50" cy="64" r="4"  fill="#fff" opacity=".9"/>
    {/* containment ring */}
    <circle cx="50" cy="64" r="13" fill="none" stroke="#b48cff" strokeWidth=".5" strokeDasharray="2 2"/>
    {/* cable bundles to towers */}
    <path d="M32 56 Q22 56 20 50" stroke="#3a2050" strokeWidth=".6" fill="none"/>
    <path d="M68 56 Q78 56 80 50" stroke="#3a2050" strokeWidth=".6" fill="none"/>
    {/* warning stripe floor */}
    <rect x="26" y="82" width="48" height="4" fill="url(#hazard)"/>
    <defs>
      <pattern id="hazard" patternUnits="userSpaceOnUse" width="4" height="4">
        <rect width="4" height="4" fill="#2a1a08"/>
        <path d="M0 4 L4 0" stroke="#e6b66a" strokeWidth="0.6"/>
      </pattern>
    </defs>
    <Figure x="26" y="88" scale="0.85" fill="#5a3a7a"/>
    <Figure x="74" y="88" scale="0.85" fill="#5a3a7a" arms/>
  </svg>
);

// ───────────────────────────────────────────────────────────────
// CONTAINMENT
// ───────────────────────────────────────────────────────────────
const ArtContainment = () => (
  <svg viewBox="0 0 100 100" preserveAspectRatio="none">
    <Wall /><Floor color="#22090a"/>
    <CeilingPipes stroke="#3a1a14"/>
    {/* containment tank */}
    <rect x="28" y="22" width="44" height="60" fill="#0a0408" stroke="#ff5a4a" strokeWidth=".5" opacity=".9"/>
    {/* energy lattice */}
    <g stroke="#ff5a4a" strokeWidth=".25" opacity=".7">
      {Array.from({length: 8}, (_, i) => <line key={i} x1="28" y1={22 + i*7.5} x2="72" y2={22 + i*7.5}/>)}
      {Array.from({length: 6}, (_, i) => <line key={i} x1={28 + i*8.8} y1="22" x2={28 + i*8.8} y2="82"/>)}
    </g>
    {/* the thing inside */}
    <g opacity=".95">
      <path d="M40 70 Q44 50 50 48 Q56 50 60 70 Z" fill="#1a0408" stroke="#ff5a4a" strokeWidth=".4"/>
      <ellipse cx="50" cy="44" rx="6" ry="5" fill="#0a0408" stroke="#ff5a4a" strokeWidth=".4"/>
      {/* eyes */}
      <circle cx="47" cy="44" r="1" fill="#ff5a4a"/>
      <circle cx="53" cy="44" r="1" fill="#ff5a4a"/>
      {/* chains */}
      <line x1="42" y1="60" x2="30" y2="72" stroke="#3a2a14" strokeWidth=".5"/>
      <line x1="58" y1="60" x2="70" y2="72" stroke="#3a2a14" strokeWidth=".5"/>
    </g>
    {/* warning lights flashing */}
    <circle cx="14" cy="14" r="2.5" fill="#ff5a4a" opacity=".9"/>
    <circle cx="86" cy="14" r="2.5" fill="#ff5a4a" opacity=".9"/>
    <path d="M14 14 L4 36" stroke="#ff5a4a" strokeWidth=".4" opacity=".4"/>
    <path d="M86 14 L96 36" stroke="#ff5a4a" strokeWidth=".4" opacity=".4"/>
    {/* observer in booth */}
    <rect x="6" y="62" width="14" height="20" fill="#1a0a14" stroke="#3a1a14" strokeWidth=".3"/>
    <rect x="7" y="66" width="12" height="6" fill="#7ec0ff" opacity=".15"/>
    <Figure x="13" y="80" scale="0.7" fill="#5a3a3a"/>
  </svg>
);

// ───────────────────────────────────────────────────────────────
// RELIC VAULT
// ───────────────────────────────────────────────────────────────
const ArtVault = () => (
  <svg viewBox="0 0 100 100" preserveAspectRatio="none">
    <Wall /><Floor color="#1a0c22"/>
    <CeilingPipes stroke="#3a2050"/>
    {/* vault columns */}
    {[14, 50, 86].map((x, i) => (
      <g key={i}>
        <rect x={x-7} y="28" width="14" height="50" fill="#0a0612" stroke="#c08a3c" strokeWidth=".4"/>
        <rect x={x-7} y="28" width="14" height="4"  fill="#241636"/>
        <rect x={x-7} y="74" width="14" height="4"  fill="#241636"/>
        {/* relic inside */}
        <g transform={`translate(${x} 54)`}>
          <polygon points="0,-8 6,-2 4,8 -4,8 -6,-2" fill="#8b5cff" opacity=".7" stroke="#b48cff" strokeWidth=".3"/>
          <polygon points="0,-8 6,-2 4,8 -4,8 -6,-2" fill="none" stroke="#e6b66a" strokeWidth=".25"/>
          <circle cx="0" cy="0" r="2" fill="#fff" opacity=".7"/>
        </g>
        {/* glow */}
        <ellipse cx={x} cy="78" rx="8" ry="1.5" fill="#8b5cff" opacity=".4"/>
        {/* energy barrier shimmer */}
        <line x1={x-7} y1="40" x2={x+7} y2="40" stroke="#b48cff" strokeWidth=".25" strokeDasharray="1 1" opacity=".7"/>
        <line x1={x-7} y1="68" x2={x+7} y2="68" stroke="#b48cff" strokeWidth=".25" strokeDasharray="1 1" opacity=".7"/>
      </g>
    ))}
    {/* door at right edge — circular vault door */}
    <Figure x="32" y="88" scale="0.85" fill="#5a3a7a"/>
    <Figure x="68" y="88" scale="0.85" fill="#5a3a7a" arms/>
  </svg>
);

// ───────────────────────────────────────────────────────────────
// EMPTY (under-construction / available)
// ───────────────────────────────────────────────────────────────
const ArtEmpty = () => (
  <svg viewBox="0 0 100 100" preserveAspectRatio="none">
    <rect x="2" y="2" width="96" height="96" fill="none" stroke="#3a2a4a" strokeWidth=".4" strokeDasharray="3 3"/>
    {/* scaffolding */}
    <line x1="20" y1="86" x2="20" y2="40" stroke="#3a2a4a" strokeWidth=".4"/>
    <line x1="80" y1="86" x2="80" y2="40" stroke="#3a2a4a" strokeWidth=".4"/>
    <line x1="20" y1="60" x2="80" y2="60" stroke="#3a2a4a" strokeWidth=".4"/>
    <line x1="20" y1="48" x2="80" y2="48" stroke="#3a2a4a" strokeWidth=".4"/>
    {/* plus */}
    <line x1="50" y1="42" x2="50" y2="62" stroke="#4d4654" strokeWidth=".8"/>
    <line x1="40" y1="52" x2="60" y2="52" stroke="#4d4654" strokeWidth=".8"/>
  </svg>
);

// ───────────────────────────────────────────────────────────────
// Real painted backdrops (public/assets/camp/*.png). The base builder
// runs from /base/index.html, so assets resolve at the site root.
// If a PNG fails to load we fall back to the SVG diagram so a room is
// never blank.
// ───────────────────────────────────────────────────────────────
const CAMP_ART_BASE = "/assets/camp/";
function makeArtImage(file, Fallback) {
  const src = CAMP_ART_BASE + file;
  return function ArtImage() {
    const [err, setErr] = React.useState(false);
    if (err) return <Fallback />;
    return (
      <img
        className="room-bg"
        src={src}
        alt=""
        draggable={false}
        onError={() => setErr(true)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: "center",
          display: "block",
        }}
      />
    );
  };
}

const ART_MAP = {
  command:    makeArtImage("command%20center.png", ArtCommand),
  barracks:   makeArtImage("camp.png",             ArtBarracks),
  medical:    makeArtImage("medical%20Bay.png",    ArtMedical),
  ai:         makeArtImage("ai%20lab.png",         ArtAI),
  forge:      makeArtImage("card%20forge.png",     ArtForge),
  training:   makeArtImage("training%20ground.png",ArtTraining),
  reactor:    makeArtImage("power%20reactor.png",  ArtReactor),
  containment:makeArtImage("containment.png",      ArtContainment),
  vault:      makeArtImage("relic%20%20vault.png", ArtVault),
  empty:      ArtEmpty,
};

// ───────────────────────────────────────────────────────────────
// Live stationed-unit sprite — cycles the real game sprite frames
// (bridged from window.__BRIDGE.camprooms) inside the room box.
// ───────────────────────────────────────────────────────────────
function _BBSprite({ frames, ms }) {
  const [i, setI] = React.useState(0);
  React.useEffect(() => {
    if (!frames || frames.length < 2) return undefined;
    const id = setInterval(
      () => setI((n) => (n + 1) % frames.length),
      Math.max(80, ms || 500)
    );
    return () => clearInterval(id);
  }, [frames, ms]);
  if (!frames || !frames.length) return null;
  return (
    <img
      src={frames[i] || frames[0]}
      alt=""
      draggable={false}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "contain",
        imageRendering: "pixelated",
        filter: "drop-shadow(0 3px 4px rgba(0,0,0,0.6))",
      }}
    />
  );
}

// ───────────────────────────────────────────────────────────────
// Room cell wrapper
// ───────────────────────────────────────────────────────────────
function Room({ room, active, onClick }) {
  const bb =
    (window.__BRIDGE && window.__BRIDGE.camprooms && window.__BRIDGE.camprooms[room.id]) || null;
  const bbOcc = (bb && Array.isArray(bb.occ)) ? bb.occ : [];
  const ArtComp = ART_MAP[room.art] || ArtEmpty;
  const isEmpty = room.art === "empty";
  // 🖼 per-room uploaded art + the admin upload slot, both bridged in
  const bbArt = (bb && typeof bb.art === "string" && bb.art) ? bb.art : "";
  const isAdm = !!(window.__BRIDGE && window.__BRIDGE.isAdmin);
  const askArt = (e) => {
    e.stopPropagation();
    try { window.parent.postMessage({ type: "base:action", action: "roomArt", id: room.id }, window.location.origin); } catch (err) {}
  };
  const clearArt = (e) => {
    e.stopPropagation();
    try { window.parent.postMessage({ type: "base:action", action: "roomArtClear", id: room.id }, window.location.origin); } catch (err) {}
  };

  const statusGlyph =
    room.status === "ok"    ? "OK"
  : room.status === "warn"  ? "!"
  : room.status === "crit"  ? "X"
  : room.status === "build" ? "↺"
  : "·";

  // tiny dust particles
  const dust = useMemo(() => Array.from({ length: 4 }, (_, i) => ({
    left: 10 + Math.random() * 80,
    delay: Math.random() * 6,
    dur: 5 + Math.random() * 4,
  })), [room.id]);

  return (
    <div
      className={`room ${active ? "active" : ""} ${isEmpty ? "empty" : ""}`}
      onClick={onClick}
      style={{ "--glow": room.glow }}
      data-room={room.id}
    >
      <div className="room-art">
        {/* 🖼 UPLOADED ROOM ART (admin) wins over the themed placeholder.
            A scrim keeps the plate/status text readable over any picture; the
            beams, dust and stationed workers still paint ABOVE it. */}
        {bbArt
          ? (<div className="room-photo" style={{ backgroundImage: `url("${bbArt}")` }}>
               <span className="room-photo-scrim" />
             </div>)
          : <ArtComp />}
        {!isEmpty && <span className="beam l" style={{ "--beam": `${room.glow}33` }} />}
        {!isEmpty && <span className="beam r" style={{ "--beam": `${room.glow}22` }} />}
        {!isEmpty && (
          <div className="dust">
            {dust.map((d, i) => (
              <i key={i} style={{
                left: `${d.left}%`,
                bottom: "20%",
                animationDelay: `${d.delay}s`,
                animationDuration: `${d.dur}s`,
              }} />
            ))}
          </div>
        )}
        {bbOcc.length > 0 && (
          <div
            className="room-occupants"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: "8%",
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
              gap: "5%",
              pointerEvents: "none",
              zIndex: 4,
            }}
          >
            {bbOcc.slice(0, 4).map((o, idx) => (
              <div key={idx} title={o.name} style={{ width: "15%", height: "44%" }}>
                <_BBSprite frames={o.frames} ms={o.ms} />
              </div>
            ))}
          </div>
        )}
        {bb && bb.req && !bb.staffed && (
          <div
            title="This room is hard-gated — station a worker (hire a Blacksmith or deploy an Artificer unit) to run it."
            style={{
              position: "absolute",
              top: "8%",
              left: "50%",
              transform: "translateX(-50%)",
              padding: "2px 9px",
              borderRadius: 999,
              border: "1px solid rgba(255,194,74,0.7)",
              background: "rgba(70,45,25,0.78)",
              color: "#ffc24a",
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: ".06em",
              whiteSpace: "nowrap",
              pointerEvents: "none",
              zIndex: 5,
            }}
          >
            ⚠ NEEDS STAFF
          </div>
        )}
      </div>

      {isAdm && (
        <div className="room-artslot">
          <button className="room-artbtn" onClick={askArt} title="Upload art for this room">📷</button>
          {bbArt && <button className="room-artbtn" onClick={clearArt} title="Remove this room's art">✕</button>}
        </div>
      )}
      <div className="room-plate">
        <span className="id">{room.code}</span>
        <span className="nm">{room.name}</span>
        {!isEmpty && (
          <span className="lvl" title={bb ? "Live camp facility level" : undefined}>
            LV {bb ? bb.level : room.level}
          </span>
        )}
      </div>

      <div className="room-status">
        <span className={`badge ${room.status}`}>{statusGlyph}</span>
      </div>

      {!isEmpty && (
        <div className="room-foot">
          <div className="workers">
            {Array.from({ length: room.workers.max }, (_, i) => (
              <span key={i} className={`worker-pip ${i < room.workers.on ? "on" : ""}`} />
            ))}
          </div>
          {room.progress != null && (
            <div className="room-progress">
              <i style={{ width: `${room.progress * 100}%` }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

Object.assign(window, { Room });
