/* realestate.jsx — Property listings: map + cards + detail view.
   Inspired by real-estate map platforms; styled as a faction-territory chart
   in the dark warm post-industrial aesthetic. */

// ── Map ──────────────────────────────────────────────────────────────────
// Stylized irregular district polygons in an SVG viewBox 0–100.
// District shape coords are hand-tuned to feel like a fictional city map.

const DISTRICT_PATHS = {
  foundry: 'M 6 18 L 32 14 L 38 22 L 36 38 L 30 54 L 14 54 L 4 38 Z',
  lower:   'M 30 54 L 36 38 L 50 36 L 60 50 L 58 78 L 36 82 L 28 70 Z',
  drowned: 'M 8 64 L 28 70 L 36 82 L 30 96 L 6 92 L 2 78 Z',
  verge:   'M 60 50 L 74 32 L 92 36 L 96 56 L 80 60 L 66 64 Z',
  ai:      'M 38 22 L 60 12 L 80 12 L 92 22 L 92 36 L 74 32 L 60 50 L 50 36 L 36 38 Z',
  anomaly: 'M 80 60 L 96 56 L 98 84 L 76 90 L 66 72 Z',
};

const DISTRICT_TONE_FILL = {
  foundry: 'rgba(198, 74, 42, 0.10)',
  lower:   'rgba(180, 170, 150, 0.06)',
  drowned: 'rgba(95, 45, 45, 0.16)',
  verge:   'rgba(199, 93, 212, 0.10)',
  ai:      'rgba(95, 130, 200, 0.10)',
  anomaly: 'rgba(199, 93, 212, 0.18)',
};

function PropertyMap({ properties, hovered, selected, onHover, onSelect, filterTier }) {
  const { DISTRICTS } = window.ECON;
  const showProp = (p) => filterTier === 'any' || p.tier === filterTier;

  return (
    <div className="prop-map">
      <div className="prop-map-img" />
      <div className="prop-map-vignette" />

      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" className="prop-map-svg">
        <defs>
          <pattern id="grid" width="4" height="4" patternUnits="userSpaceOnUse">
            <path d="M 4 0 L 0 0 0 4" fill="none" stroke="rgba(255,255,255,0.025)" strokeWidth="0.12" />
          </pattern>
          <pattern id="hatch" width="2" height="2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="2" stroke="rgba(199, 93, 212, 0.22)" strokeWidth="0.4" />
          </pattern>
          <radialGradient id="anom-glow" cx="50%" cy="50%">
            <stop offset="0%" stopColor="rgba(199, 93, 212, 0.45)" />
            <stop offset="100%" stopColor="rgba(199, 93, 212, 0)" />
          </radialGradient>
        </defs>

        {/* Subtle grid overlay only */}
        <rect width="100" height="100" fill="url(#grid)" opacity="0.6" />

        {/* District zone shading — soft tints over the photo, no hard borders */}
        <g opacity="0.55">
          {/* Foundry Belt — north-west of island */}
          <ellipse cx="42" cy="22" rx="18" ry="14" fill="rgba(198, 74, 42, 0.18)" />
          {/* AI Districts — central skyscraper cluster */}
          <ellipse cx="42" cy="50" rx="12" ry="14" fill="rgba(95, 130, 200, 0.15)" />
          {/* Lower Wards — middle-south of island */}
          <ellipse cx="54" cy="40" rx="14" ry="16" fill="rgba(180, 170, 150, 0.10)" />
          {/* Drowned Quarter — south tip + waterline */}
          <ellipse cx="38" cy="78" rx="14" ry="12" fill="rgba(95, 45, 45, 0.22)" />
          {/* Outer Verge — east shore */}
          <ellipse cx="86" cy="38" rx="12" ry="22" fill="rgba(199, 93, 212, 0.14)" />
          {/* Anomaly Strip — far east bottom + hatch */}
          <ellipse cx="92" cy="78" rx="10" ry="14" fill="url(#hatch)" />
        </g>

        {/* Anomaly pulse glow */}
        <circle cx="92" cy="78" r="12" fill="url(#anom-glow)" />

        {/* District labels — float above the photo */}
        <DistrictLabel x={42} y={18} tone="rust"  name="FOUNDRY BELT"  sub="HEAVY INDUSTRY" />
        <DistrictLabel x={42} y={50} tone="rare"  name="AI DISTRICTS"  sub="COMPUTE · WALLED" />
        <DistrictLabel x={56} y={36} tone="muted" name="LOWER WARDS"   sub="HOUSING · LOW TAX" />
        <DistrictLabel x={36} y={80} tone="blood" name="DROWNED QTR."  sub="FLOODED RUIN" />
        <DistrictLabel x={86} y={32} tone="void"  name="OUTER VERGE"   sub="EDGE TERRITORY" />
        <DistrictLabel x={92} y={74} tone="void"  name="ANOMALY STRIP" sub="∅ TREATY ZONE" />
      </svg>

      {/* Property pins layer (HTML, so we can do hover cards) */}
      <div className="pin-layer">
        {properties.filter(showProp).map(p => (
          <PropPin key={p.id} p={p}
            active={selected === p.id || hovered === p.id}
            onMouseEnter={() => onHover(p.id)}
            onMouseLeave={() => onHover(null)}
            onClick={() => onSelect(p.id)} />
        ))}
      </div>

      {/* Map chrome overlay */}
      <div className="map-chrome">
        <div className="map-chrome-l">
          <div className="map-counter">
            <span className="mono" style={{ fontSize: 10.5, letterSpacing: '.16em', color: 'var(--muted)' }}>SHOWING</span>
            <b className="mono">{properties.filter(showProp).length}</b>
            <span className="mono" style={{ fontSize: 10.5, letterSpacing: '.16em', color: 'var(--muted)' }}>OF 1,402 PARCELS</span>
          </div>
        </div>
        <div className="map-chrome-r">
          <button className="btn sm ghost">⌖ Schools</button>
          <button className="btn sm ghost">▭ Draw zone</button>
        </div>
        <div className="map-zoom">
          <button className="btn icon">+</button>
          <button className="btn icon">−</button>
          <div className="map-style">
            <span className="mono" style={{ fontSize: 9, letterSpacing: '.14em', color: 'var(--muted)' }}>MAP</span>
          </div>
        </div>
        <div className="map-legend">
          <span className="mono" style={{ fontSize: 9.5, letterSpacing: '.14em', color: 'var(--muted)', marginRight: 4 }}>TIER</span>
          <Legend swatch="var(--muted)" label="T1" />
          <Legend swatch="oklch(0.78 0.10 220)" label="T2" />
          <Legend swatch="var(--void)" label="T3" />
          <Legend swatch="var(--aza)" label="T4" />
        </div>
      </div>
    </div>
  );
}

function DistrictLabel({ x, y, name, sub, tone }) {
  const color = {
    rust: 'var(--rust)',
    void: 'var(--void)',
    rare: 'oklch(0.84 0.10 220)',
    blood: 'oklch(0.78 0.14 25)',
    muted: 'rgba(255,255,255,0.62)',
  }[tone] || 'rgba(255,255,255,0.62)';
  return (
    <g style={{ filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.95)) drop-shadow(0 0 6px rgba(0,0,0,0.7))' }}>
      <text x={x} y={y} fontFamily="JetBrains Mono, monospace" fontSize="2.1" fontWeight="700" textAnchor="middle"
        fill={color} letterSpacing="0.16em">{name}</text>
      <text x={x} y={y + 2.6} fontFamily="JetBrains Mono, monospace" fontSize="1.3" textAnchor="middle"
        fill="rgba(255,255,255,0.55)" letterSpacing="0.18em">{sub}</text>
    </g>
  );
}

function Legend({ swatch, label }) {
  return (
    <span className="row" style={{ gap: 4 }}>
      <i style={{ width: 8, height: 8, borderRadius: 4, background: swatch, display: 'inline-block' }} />
      <span className="mono" style={{ fontSize: 10, color: 'var(--fg-2)' }}>{label}</span>
    </span>
  );
}

function PropPin({ p, active, onMouseEnter, onMouseLeave, onClick }) {
  const color = ({
    T1: 'var(--surface-3)',
    T2: 'oklch(0.50 0.10 220)',
    T3: 'var(--void)',
    T4: 'var(--aza)',
  })[p.tier];
  return (
    <button
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      className={'prop-pin' + (active ? ' active' : '') + (p.flag ? ' flag-' + p.flag : '')}
      style={{ left: p.x + '%', top: p.y + '%', '--c': color }}>
      <span className="prop-pin-px mono">{fmtPriceShort(p.price)}</span>
      {p.showcase && <span className="prop-pin-star">★</span>}
    </button>
  );
}

function fmtPriceShort(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return Math.round(n / 1_000) + 'K';
  return String(n);
}

// ── Listing card ─────────────────────────────────────────────────────────

function PropertyCard({ p, onSelect, onHover }) {
  const { PLAYERS, DISTRICTS } = window.ECON;
  const agent = PLAYERS.find(x => x.id === p.agent);
  // Defensive fallbacks so listings missing tier/district don't kill the
  // whole list render — falls back to T1 + lower if upstream forgot to set.
  const tierLc = (p.tier ? String(p.tier) : 'T1').toLowerCase();
  const distName = (DISTRICTS[p.district] && DISTRICTS[p.district].name) || 'Unsorted';
  return (
    <div className="prop-card"
      onMouseEnter={() => onHover(p.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onSelect(p.id)}>
      <div className={'prop-card-img tier-' + tierLc + (p.flag ? ' flag-' + p.flag : '')} style={{ position: 'relative', overflow: 'hidden' }}>
        {(() => {
          const photo = (window.JB_art && window.JB_art('re', p.id)) || '';
          return photo ? <img src={photo} alt={p.name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} /> : null;
        })()}
        {(window.JB_isAdmin && window.JB_isAdmin()) && (
          <button className="btn sm" onClick={(e) => { e.stopPropagation(); window.JB_uploadArt('re', p.id); }}
            style={{ position: 'absolute', bottom: 8, right: 8, zIndex: 3 }}>📷 Photo</button>
        )}
        {p.showcase && <span className="prop-card-tag">SHOWCASE</span>}
        {p.status === 'auction' && <span className="prop-card-tag tag-auction">AUCTION · 04:12</span>}
        <button className="prop-card-fav" onClick={(e) => e.stopPropagation()}>♡</button>
        <div className="prop-card-watermark mono">{p.id} · {p.photos} VIEWS</div>
        <div className="prop-card-paginator">
          {[0,1,2,3,4].map(i => <i key={i} data-on={i === 0 ? '1' : '0'} />)}
        </div>
      </div>
      <div className="prop-card-body">
        <div className="prop-card-price">{fmt(p.price)} <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>Aza coin</span></div>
        <div className="prop-card-stats mono">
          <b>{p.tier}</b> tier
          <span className="sep">·</span>
          <b>{p.generates}</b> @ {p.rate}
          <span className="sep">·</span>
          <b>{p.workforce}</b> wf
          <span className="sep">·</span>
          {p.area}
        </div>
        <div className="prop-card-addr">{p.name} <span className="muted">· {distName}</span></div>
        <div className="prop-card-agent">
          <span className="agent-av" style={{ background: 'linear-gradient(135deg, var(--rust), var(--void))' }}>{agent?.handle.slice(0, 2)}</span>
          <span className="mono" style={{ fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>{agent?.handle} · {agent?.corp}</span>
        </div>
      </div>
    </div>
  );
}

// ── List Property modal (admin only) ─────────────────────────────────────
// Single form → posts `realEstateList` action up to the parent. Parent
// places the house on Camp Heights and mirrors back via econ.
function ListPropertyModal({ onClose }) {
  const [name,    setName]    = useState('');
  const [address, setAddress] = useState('');
  const [price,   setPrice]   = useState(15000);
  const [tier,    setTier]    = useState('T1');
  const [district,setDistrict]= useState('lower');
  const [capacity,setCapacity]= useState(200);
  const [blurb,   setBlurb]   = useState('');
  const submit = () => {
    if (!name.trim()) { alert('Please give the property a name.'); return; }
    const id = 're_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    // Naive scatter for the map pin — picks a point inside the district's
    // ellipse so the pin lands roughly in the right zone.
    const dpos = {
      foundry: [42, 22], ai: [42, 50], lower: [56, 36],
      drowned: [36, 80], verge: [86, 38], anomaly: [92, 74],
    }[district] || [50, 50];
    const x = Math.max(4, Math.min(96, dpos[0] + (Math.random() - 0.5) * 18));
    const y = Math.max(4, Math.min(96, dpos[1] + (Math.random() - 0.5) * 16));
    try {
      window.JB_action({
        kind: 'realEstateList',
        listing: {
          id, name: name.trim(), address: address.trim(),
          price: price | 0, tier, district, capacity: capacity | 0,
          blurb: blurb.trim(), x, y, color: '#88c4ff',
        },
      });
    } catch (e) { alert('Listing failed: ' + (e.message || e)); return; }
    onClose();
  };
  return (
    <div style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'center', justifyContent:'center', backdropFilter:'blur(4px)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: 560, maxWidth: '92vw', background:'var(--bg-1, #14111a)', border:'1px solid var(--line-soft, #2a2330)', borderRadius:12, padding:'20px 22px', color:'var(--fg, #e8ddff)' }}>
        <div className="row" style={{ justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
          <h3 style={{ margin:0, fontFamily:'var(--disp)', fontSize:18 }}>🏘 List New Property</h3>
          <button className="btn ghost sm" onClick={onClose}>✕</button>
        </div>
        <div style={{ display:'grid', gap:10 }}>
          <Field label="Property name *">
            <input className="select" value={name} onChange={e => setName(e.target.value)} placeholder="Lakeview Manor" maxLength={50} />
          </Field>
          <Field label="Address (optional)">
            <input className="select" value={address} onChange={e => setAddress(e.target.value)} placeholder="14 Drowned Wharf" maxLength={60} />
          </Field>
          <div className="row" style={{ gap:10 }}>
            <Field label="Price (Cinder)" style={{ flex:1 }}>
              <input className="select" type="number" min={100} max={9999999} value={price} onChange={e => setPrice(Math.max(100, Number(e.target.value) || 0))} />
            </Field>
            <Field label="Tier" style={{ flex:1 }}>
              <select className="select" value={tier} onChange={e => setTier(e.target.value)}>
                {['T1','T2','T3','T4'].map(t => <option key={t} value={t}>Tier {t.slice(1)}</option>)}
              </select>
            </Field>
            <Field label="Stash slots" style={{ flex:1 }}>
              <input className="select" type="number" min={20} max={2000} value={capacity} onChange={e => setCapacity(Math.max(20, Number(e.target.value) || 0))} />
            </Field>
          </div>
          <Field label="District">
            <select className="select" value={district} onChange={e => setDistrict(e.target.value)}>
              {Object.values(window.ECON.DISTRICTS).map(d => (
                <option key={d.id} value={d.id}>{d.name} — {d.blurb}</option>
              ))}
            </select>
          </Field>
          <Field label="Blurb (1 sentence)">
            <textarea className="select" rows={2} value={blurb} onChange={e => setBlurb(e.target.value)} placeholder="Pre-Collapse townhouse on the safe side of the floodline."  maxLength={200} />
          </Field>
        </div>
        <div style={{ background:'rgba(199,93,212,0.06)', border:'1px dashed rgba(199,93,212,0.32)', borderRadius:6, padding:'8px 10px', marginTop:14, fontSize:12, color:'var(--muted, #9a93a8)' }}>
          🔒 <b>Single-owner deed</b> — once a player buys this, no one else can. The house will auto-place on Camp Heights so the eventual owner can walk to it.
        </div>
        <div className="row" style={{ justifyContent:'flex-end', gap:8, marginTop:16 }}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={submit}>🏘 Publish Listing</button>
        </div>
      </div>
    </div>
  );
}
function Field({ label, children, style }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:4, ...(style||{}) }}>
      <label className="mono muted" style={{ fontSize:11, letterSpacing:'.08em', textTransform:'uppercase' }}>{label}</label>
      {children}
    </div>
  );
}

// ── Real Estate screen ───────────────────────────────────────────────────

// 🏘 Live listings — derive from the parent game (window.__JB.econ.realEstateListings)
// so admin-added properties appear here. Falls back to ECON.PROPERTIES for
// standalone dev mode. Filters out listings already owned by someone other
// than the current player (single-owner deeds).
function useLiveProperties() {
  const [props, setProps] = useState(() => buildPropsList());
  useEffect(() => {
    const refresh = () => setProps(buildPropsList());
    refresh();
    window.addEventListener('jbdata', refresh);
    return () => window.removeEventListener('jbdata', refresh);
  }, []);
  return props;
}
function buildPropsList() {
  try {
    const econ = window.__JB && window.__JB.econ;
    const myUid = (econ && econ.myUid) || null;
    const live = (econ && Array.isArray(econ.realEstateListings)) ? econ.realEstateListings : null;
    if (live && live.length) {
      return live
        // 🔒 SINGLE-OWNER FILTER — hide listings claimed by another survivor.
        // The owner themselves keeps seeing it (so they can manage / view).
        .filter(p => !p.ownedBy || p.ownedBy === myUid)
        .map(p => ({
          ...p,
          status: p.ownedBy ? 'owned' : 'sale',
          agent: '',
          showcase: !!p.showcase,
        }));
    }
  } catch (e) {}
  return (window.ECON && window.ECON.PROPERTIES) || [];
}

function RealEstateScreen({ openDetail }) {
  const PROPERTIES = useLiveProperties();
  const [q, setQ] = useState('');
  const [showList, setShowList] = useState(false);
  const [status, setStatus] = useState('any');
  const [tier, setTier] = useState('any');
  const [district, setDistrict] = useState('any');
  const [priceMax, setPriceMax] = useState(250_000);
  const [sort, setSort] = useState('homes');
  const [hovered, setHovered] = useState(null);
  const [openFilter, setOpenFilter] = useState(null);

  const filtered = useMemo(() => {
    let xs = PROPERTIES.filter(p =>
      (status === 'any' || p.status === status) &&
      (tier === 'any' || p.tier === tier) &&
      (district === 'any' || p.district === district) &&
      (p.price <= priceMax) &&
      (q === '' || (p.name + ' ' + p.district).toLowerCase().includes(q.toLowerCase()))
    );
    if (sort === 'price-asc')  xs = [...xs].sort((a,b) => a.price - b.price);
    if (sort === 'price-desc') xs = [...xs].sort((a,b) => b.price - a.price);
    if (sort === 'tier')       xs = [...xs].sort((a,b) => b.tier.localeCompare(a.tier));
    return xs;
  }, [PROPERTIES, status, tier, district, priceMax, q, sort]);

  return (
    <div className="re-screen">
      <div className="re-toolbar">
        <div className="re-search">
          <span className="re-search-ic mono">⌕</span>
          <input className="re-search-in" placeholder="Address, district, faction zone, parcel ID" value={q} onChange={e => setQ(e.target.value)} />
          <button className="btn icon ghost" title="Voice">⏵</button>
        </div>

        <FilterDD label={status === 'any' ? 'For sale' : status === 'sale' ? 'For sale' : status === 'auction' ? 'Auction' : 'Rent'}>
          {[{ v:'any', l:'Any status' }, { v:'sale', l:'For sale' }, { v:'auction', l:'Auction' }, { v:'rent', l:'For rent' }].map(o => (
            <DDItem key={o.v} active={status === o.v} onClick={() => setStatus(o.v)}>{o.l}</DDItem>
          ))}
        </FilterDD>

        <FilterDD label={`Price · ≤ ${fmtPriceShort(priceMax)}`}>
          <div style={{ padding: '12px 14px', width: 220 }}>
            <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', marginBottom: 8 }}>MAX PRICE (Aza coin)</div>
            <input type="range" min={5000} max={250000} step={5000} value={priceMax} onChange={e => setPriceMax(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--rust)' }} />
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 6 }}>
              <span className="mono muted" style={{ fontSize: 10.5 }}>5K</span>
              <span className="mono" style={{ fontSize: 12, color: 'var(--aza)' }}>{fmt(priceMax)}</span>
              <span className="mono muted" style={{ fontSize: 10.5 }}>250K+</span>
            </div>
          </div>
        </FilterDD>

        <FilterDD label={tier === 'any' ? 'Tier' : `Tier ${tier}`}>
          {['any','T1','T2','T3','T4'].map(t => (
            <DDItem key={t} active={tier === t} onClick={() => setTier(t)}>{t === 'any' ? 'Any tier' : `Tier ${t}`}</DDItem>
          ))}
        </FilterDD>

        <FilterDD label={district === 'any' ? 'Property type' : window.ECON.DISTRICTS[district].name}>
          <DDItem active={district === 'any'} onClick={() => setDistrict('any')}>All districts</DDItem>
          {Object.values(window.ECON.DISTRICTS).map(d => (
            <DDItem key={d.id} active={district === d.id} onClick={() => setDistrict(d.id)}>
              <span style={{ fontWeight: 500 }}>{d.name}</span>
              <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>{d.blurb}</span>
            </DDItem>
          ))}
        </FilterDD>

        <FilterDD label={<><span className="mono" style={{ fontSize: 11 }}>≡</span> Filters</>}>
          <div style={{ padding: '12px 14px', width: 260 }}>
            <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', marginBottom: 10 }}>MORE FILTERS</div>
            <FilterChk label="Showcase only" />
            <FilterChk label="Auctions ending soon" />
            <FilterChk label="Corp-owned" />
            <FilterChk label="Hide flagged (occult/illicit)" />
            <FilterChk label="Player-realtor only" defaultChecked />
            <FilterChk label="Generates a rare resource" />
          </div>
        </FilterDD>

        <div style={{ flex: 1 }} />
        {window.JB_isAdmin && window.JB_isAdmin() && (
          <button className="btn primary" onClick={() => setShowList(true)} title="Admin: list a new property — auto-places on Camp Heights map">
            🏘 + List Property
          </button>
        )}
        <button className="btn primary">Save search</button>
      </div>
      {showList && <ListPropertyModal onClose={() => setShowList(false)} />}

      <div className="re-grid">
        <div className="re-map-wrap">
          <PropertyMap
            properties={filtered}
            hovered={hovered}
            selected={null}
            onHover={setHovered}
            onSelect={openDetail}
            filterTier={tier}
          />
        </div>

        <div className="re-list">
          <div className="re-list-head">
            <div>
              <div className="disp" style={{ fontSize: 22, fontWeight: 600 }}>Real estate & deeds for sale</div>
              <div className="muted mono" style={{ fontSize: 11, marginTop: 2, letterSpacing: '.08em' }}>{filtered.length} results · brokered by players</div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <select className="select" style={{ width: 'auto' }} value={sort} onChange={e => setSort(e.target.value)}>
                <option value="homes">Sort: Recommended</option>
                <option value="price-asc">Price ↑</option>
                <option value="price-desc">Price ↓</option>
                <option value="tier">Tier</option>
              </select>
            </div>
          </div>

          <div className="re-cards">
            {filtered.map(p => (
              <PropertyCard key={p.id} p={p} onSelect={openDetail} onHover={setHovered} />
            ))}
            {filtered.length === 0 && (
              <div style={{ padding: 40, color: 'var(--muted)', textAlign: 'center' }}>
                No properties match. Loosen filters.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Filter dropdown chrome ───────────────────────────────────────────────

function FilterDD({ label, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);
  return (
    <div className="re-dd" ref={ref}>
      <button className="re-dd-btn" data-open={open ? '1' : '0'} onClick={() => setOpen(o => !o)}>
        <span>{label}</span>
        <span className="mono" style={{ opacity: 0.5, fontSize: 9 }}>▼</span>
      </button>
      {open && <div className="re-dd-menu">{children}</div>}
    </div>
  );
}

function DDItem({ active, onClick, children }) {
  return (
    <button className="re-dd-item" data-active={active ? '1' : '0'} onClick={onClick}>{children}</button>
  );
}

function FilterChk({ label, defaultChecked }) {
  const [on, setOn] = useState(!!defaultChecked);
  return (
    <label className="row" style={{ gap: 8, padding: '6px 0', cursor: 'default' }}>
      <input type="checkbox" checked={on} onChange={() => setOn(o => !o)} />
      <span style={{ fontSize: 12.5 }}>{label}</span>
    </label>
  );
}

// ── Detail screen ────────────────────────────────────────────────────────

function PropertyDetailScreen({ propertyId, onBack }) {
  const livePROPS = useLiveProperties();
  const { PLAYERS, DISTRICTS, REVIEWS } = window.ECON;
  // Use the live (bridged) list so admin-added properties render here.
  const p = livePROPS.find(x => x.id === propertyId)
        || (window.ECON.PROPERTIES || []).find(x => x.id === propertyId)
        || livePROPS[0]
        || (window.ECON.PROPERTIES || [])[0];
  if (!p) {
    return (
      <div className="re-screen" style={{ padding: 24 }}>
        <button className="btn ghost" onClick={onBack}>← Back</button>
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', marginTop: 16 }}>No listing to display yet.</div>
      </div>
    );
  }
  const rePhoto = (window.JB_art && window.JB_art('re', p.id)) || '';
  const reAdm = !!(window.JB_isAdmin && window.JB_isAdmin());
  const agent = PLAYERS.find(x => x.id === p.agent);
  const dist = DISTRICTS[p.district];
  const reviews = REVIEWS[agent?.id] || [];
  const [activeView, setActiveView] = useState('photos');

  return (
    <div className="prop-detail">
      <div className="row" style={{ padding: '14px 24px', borderBottom: '1px solid var(--line-soft)', alignItems: 'center', gap: 12 }}>
        <button className="btn ghost sm" onClick={onBack}>←</button>
        <span className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em' }}>REAL ESTATE / {p.id}</span>
        <div style={{ flex: 1 }} />
        <button className="btn ghost sm">♡ Save</button>
        <button className="btn ghost sm">↗ Share</button>
        <button className="btn ghost sm">⋯</button>
      </div>

      <div className={'prop-hero tier-' + p.tier.toLowerCase() + (p.flag ? ' flag-' + p.flag : '')}
        style={{ position: 'relative', overflow: 'hidden', backgroundImage: rePhoto ? 'url(' + rePhoto + ')' : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }}>
        {reAdm && (
          <button className="btn sm" onClick={() => window.JB_uploadArt('re', p.id)}
            style={{ position: 'absolute', top: 12, right: 12, zIndex: 5 }}>
            📷 {rePhoto ? 'Replace photo' : 'Add photo'}
          </button>
        )}
        {!rePhoto && (
          <div className="prop-hero-watermark mono">
            <div>{p.id}</div>
            <div>{p.name.toUpperCase()}</div>
            <div style={{ fontSize: 11, opacity: .6 }}>PHOTO PLACEHOLDER · DROP IN-GAME SCREENSHOT</div>
          </div>
        )}
        <div className="prop-hero-progress">
          {Array(p.photos).fill(0).map((_, i) => <i key={i} data-on={i === 0 ? '1' : '0'} />)}
        </div>
        <div className="prop-hero-thumbs">
          <ViewTab id="photos"   icon="◰" label="Photos"      n={p.photos} active={activeView} set={setActiveView} />
          <ViewTab id="plot"     icon="◇" label="3D Plot"     active={activeView} set={setActiveView} />
          <ViewTab id="schema"   icon="▦" label="Schematic"   active={activeView} set={setActiveView} />
          <ViewTab id="inspect"  icon="✦" label="Inspection"  badge="NEW" active={activeView} set={setActiveView} />
          <ViewTab id="map"      icon="◉" label="Map"         active={activeView} set={setActiveView} />
        </div>
      </div>

      <div className="prop-detail-body">
        <div className="prop-detail-main">
          <div className="prop-detail-agent-strip" onClick={() => {}}>
            <div className="agent-av lg" style={{ background: 'linear-gradient(135deg, var(--rust), var(--void))' }}>{agent?.handle.slice(0, 2)}</div>
            <div>
              <div style={{ fontWeight: 600 }}>{agent?.handle}</div>
              <div className="muted" style={{ fontSize: 12 }}>{agent?.corp} — listed agent</div>
            </div>
            <div style={{ flex: 1 }} />
            <span className="mono muted">→</span>
          </div>

          <div className="prop-status">
            <span className="prop-status-dot" />
            <span className="mono" style={{ fontSize: 11, letterSpacing: '.12em' }}>
              {p.status === 'auction' ? 'AUCTION · 04:12 LEFT' : 'ACTIVE LISTING'}
            </span>
          </div>

          <div className="prop-price">{fmt(p.price)} <span className="prop-price-cur">Aza coin</span></div>

          <div className="prop-headline">{p.name}, <span className="muted">{dist.name}</span></div>

          <div className="prop-stat-row">
            <Big k={p.tier} v="tier" />
            <Big k={p.workforce} v="workforce" />
            <Big k={p.plots} v={p.plots === 1 ? 'plot' : 'plots'} />
            <Big k={p.area} v="lot size" mono />
          </div>

          <div className="prop-finance">
            <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>Est. yield</span>
            <span><b>{p.rate}</b> {p.generates}</span>
            <a className="finance-link">Pre-qualify production →</a>
          </div>

          <div className="prop-attrs">
            <Attr ico="◰" label={p.tier === 'T4' ? 'Tier IV deed' : p.tier === 'T3' ? 'Tier III deed' : p.tier === 'T2' ? 'Tier II deed' : 'Tier I deed'} />
            <Attr ico="◈" label={p.built === 'Pre-Coll.' ? 'Pre-Collapse build' : `Built Y${p.built.replace('Y','')}`} />
            <Attr ico="◇" label={p.area + ' lot'} />
            <Attr ico="⛬" label={p.plots + (p.plots === 1 ? ' plot' : ' plots')} />
            <Attr ico="₳" label={p.tax + ' district tax'} />
            <Attr ico="⌖" label={'Workforce ' + p.workforce} />
          </div>

          <div className="prop-section">
            <h3 className="disp" style={{ fontSize: 22, fontWeight: 600, margin: '0 0 12px' }}>What's special</h3>
            <div className="prop-tags">
              {p.special.map((s, i) => <span key={i} className="prop-tag">{s}</span>)}
            </div>
          </div>

          <div className="prop-section">
            <h3 className="disp" style={{ fontSize: 22, fontWeight: 600, margin: '0 0 12px' }}>Attributes & condition</h3>
            <ul className="prop-attr-list">
              {p.attrs.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          </div>

          <div className="prop-section">
            <h3 className="disp" style={{ fontSize: 22, fontWeight: 600, margin: '0 0 12px' }}>Production output</h3>
            <div className="prop-chain card flat" style={{ padding: 14 }}>
              <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="chip flat">{p.name}</span>
                <span className="mono muted">→</span>
                <span className="chip rust">{p.generates}</span>
                <span className="mono muted">→</span>
                <span className="chip flat">Vault / Market</span>
                <div style={{ flex: 1 }} />
                <span className="mono" style={{ color: 'var(--aza)' }}>+ {p.rate}</span>
              </div>
              <div className="prop-chain-bars">
                {Array(14).fill(0).map((_, i) => <i key={i} style={{ height: (35 + ((i * 11) % 50)) + '%' }} />)}
              </div>
              <div className="row" style={{ justifyContent: 'space-between', marginTop: 4 }}>
                <span className="mono muted" style={{ fontSize: 10.5 }}>14-day production · units / day</span>
                <span className="mono" style={{ fontSize: 11, color: 'oklch(0.78 0.15 145)' }}>+ 8.4%</span>
              </div>
            </div>
          </div>

          <div className="prop-section">
            <h3 className="disp" style={{ fontSize: 22, fontWeight: 600, margin: '0 0 12px' }}>Ownership history</h3>
            <ul className="prop-attr-list">
              <li><span className="mono muted">Y2 Q1 D08</span> &nbsp; Recovered from ruin · Founder cohort</li>
              <li><span className="mono muted">Y2 Q3 D14</span> &nbsp; Sold → IronHand Co. · 24,000 Aza coin</li>
              <li><span className="mono muted">Y3 Q2 D02</span> &nbsp; Sold → {agent?.handle} · {fmt(p.price * 0.78)} Aza coin</li>
              <li><span className="mono muted">Y3 Q3 D18</span> &nbsp; Listed at {fmt(p.price)} Aza coin</li>
            </ul>
          </div>
        </div>

        <aside className="prop-detail-aside">
          <div className="prop-agent-card">
            <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em' }}>LISTED BY</div>
            <div className="agent-portrait" style={{ background: 'linear-gradient(135deg, var(--rust), var(--void))' }}>
              <span>{agent?.handle.slice(0, 2)}</span>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div className="disp" style={{ fontSize: 20, fontWeight: 600, marginTop: 10 }}>{agent?.handle}</div>
              <div style={{ fontSize: 13, color: 'var(--fg-2)', marginTop: 2 }}>{agent?.corp}</div>
              <div className="row" style={{ justifyContent: 'center', gap: 4, marginTop: 8 }}>
                {[0,1,2,3,4].map(i => (
                  <span key={i} style={{ color: i < Math.round((agent?.rep || 0.8) * 5) ? 'var(--aza)' : 'var(--surface-3)', fontSize: 13 }}>★</span>
                ))}
                <span className="mono muted" style={{ fontSize: 11, marginLeft: 6 }}>{reviews.length || 12} reviews</span>
              </div>
            </div>

            <div className="col" style={{ gap: 6, marginTop: 14 }}>
              {(() => {
                // 🏘 BUY CTA — player-driven listings (have an .ownedBy field
                // on the live econ; PROPERTIES from window.ECON are the mock
                // pool with an agent). When ownedBy is undefined we treat as
                // a "real" listing and show the BUY action.
                const econ = (window.__JB && window.__JB.econ) || {};
                const live = (Array.isArray(econ.realEstateListings) ? econ.realEstateListings : []).find(x => x.id === p.id);
                if (!live) {
                  // Mock / default — keep the legacy agent UI.
                  return (
                    <>
                      <button className="btn primary" style={{ justifyContent: 'center' }}>Contact {agent?.handle.split('-')[0]}</button>
                      <button className="btn" style={{ justifyContent: 'center' }}>Make offer</button>
                      <button className="btn ghost" style={{ justifyContent: 'center' }}>Schedule walkthrough</button>
                    </>
                  );
                }
                const myUid = econ.myUid || null;
                const owned = !!live.ownedBy;
                const mine  = owned && live.ownedBy === myUid;
                const canBuy = !owned && (econ.cinders | 0) >= (live.price | 0);
                if (mine) {
                  return (
                    <>
                      <div style={{ padding:'8px 10px', background:'rgba(124,232,168,0.10)', border:'1px solid rgba(124,232,168,0.4)', borderRadius:6, color:'rgb(124,232,168)', fontSize:13, textAlign:'center' }}>✓ Owned by you — walk to it in Camp Heights.</div>
                      <button className="btn ghost" style={{ justifyContent: 'center' }} onClick={() => window.JB_back && window.JB_back()}>← Leave to Camp</button>
                    </>
                  );
                }
                if (owned) {
                  return (
                    <div style={{ padding:'8px 10px', background:'rgba(255,107,107,0.10)', border:'1px solid rgba(255,107,107,0.4)', borderRadius:6, color:'rgb(255,150,140)', fontSize:13, textAlign:'center' }}>🔒 Single-owner deed already claimed by another survivor.</div>
                  );
                }
                return (
                  <>
                    <button className="btn primary" style={{ justifyContent: 'center' }} disabled={!canBuy}
                      onClick={() => {
                        if (!confirm(`Buy "${live.name}" for ${(live.price|0).toLocaleString()} Cinder?\n\nThis is a single-owner deed — no other player can buy it after you.`)) return;
                        try { window.JB_action({ kind: 'realEstateBuy', listingId: live.id }); } catch (e) {}
                        onBack && onBack();
                      }}>
                      🔥 Buy for {(live.price|0).toLocaleString()} Cinder
                    </button>
                    {!canBuy && <div style={{ fontSize:11, color:'rgb(255,150,140)', textAlign:'center' }}>Not enough Cinder.</div>}
                    <button className="btn ghost" style={{ justifyContent: 'center' }} onClick={onBack}>← Back to listings</button>
                  </>
                );
              })()}
            </div>

            <div style={{ borderTop: '1px solid var(--line-soft)', marginTop: 16, paddingTop: 12 }}>
              <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', marginBottom: 8 }}>AGENT STATS</div>
              <div className="row" style={{ justifyContent: 'space-between', fontSize: 12 }}>
                <span className="muted">Listings closed</span><span className="mono">28</span>
              </div>
              <div className="row" style={{ justifyContent: 'space-between', fontSize: 12, marginTop: 4 }}>
                <span className="muted">Avg. days on market</span><span className="mono">6</span>
              </div>
              <div className="row" style={{ justifyContent: 'space-between', fontSize: 12, marginTop: 4 }}>
                <span className="muted">Specializes in</span><span className="mono">{dist.name}</span>
              </div>
            </div>
          </div>

          <div className="prop-agent-reviews">
            <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', marginBottom: 10 }}>REVIEWS</div>
            {(reviews.length ? reviews : [
              { who:'PlayerX', stars:4, text:'Solid agent. Closed in 8 days.' },
              { who:'Dr. Mire', stars:5, text:'Discreet and on-message.' },
            ]).map((r, i) => (
              <div key={i} style={{ paddingBottom: 12, marginBottom: 12, borderBottom: '1px dashed var(--line-soft)' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="mono" style={{ fontSize: 11 }}>{r.who}</span>
                  <span style={{ color: 'var(--aza)', fontSize: 11 }}>{'★'.repeat(r.stars)}</span>
                </div>
                <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--fg-2)' }}>{r.text}</p>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

function ViewTab({ id, icon, label, n, badge, active, set }) {
  return (
    <button className="view-tab" data-active={active === id ? '1' : '0'} onClick={() => set(id)}>
      <span className="view-tab-ic mono">{icon}</span>
      <div>
        <div style={{ fontWeight: 500, fontSize: 12 }}>{label}</div>
        {n != null && <div className="mono muted" style={{ fontSize: 10 }}>{n} items</div>}
      </div>
      {badge && <span className="chip void" style={{ position: 'absolute', top: -6, right: -6, fontSize: 9 }}>{badge}</span>}
    </button>
  );
}

function Big({ k, v, mono }) {
  return (
    <div className="big-stat">
      <div className={'big-stat-k ' + (mono ? 'mono' : 'disp')}>{k}</div>
      <div className="big-stat-v mono">{v}</div>
    </div>
  );
}

function Attr({ ico, label }) {
  return (
    <div className="attr-pill">
      <span className="attr-pill-ic mono">{ico}</span>
      <span>{label}</span>
    </div>
  );
}

Object.assign(window, { RealEstateScreen, PropertyDetailScreen });
