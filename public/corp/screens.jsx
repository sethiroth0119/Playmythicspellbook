/* screens.jsx — Vault, Corp Treasury, Logistics, Marketplace, Black Market,
   Feed, Mailbox, Trade window, Relic detail. */

// ============================================================================
// VAULT — universal personal inventory
// ============================================================================

const KIND_TABS = [
  { id: 'all',      label: 'All' },
  { id: 'resource', label: 'Resources' },
  { id: 'relic',    label: 'Relics' },
  { id: 'item',     label: 'Items' },
  { id: 'hero',     label: 'Heroes' },
  { id: 'card',     label: 'Cards' },
  { id: 'deed',     label: 'Deeds' },
];

// Marketplace excludes deeds (they have a dedicated Real Estate screen).
const MARKET_KIND_TABS = KIND_TABS.filter(t => t.id !== 'deed');

function VaultScreen({ openRelic, openSend, openList }) {
  const { ASSETS } = window.ECON;
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [rar, setRar] = useState('any');
  const [sort, setSort] = useState('val');
  const [sel, setSel] = useState(null);

  const counts = useMemo(() => {
    const c = { all: ASSETS.length };
    for (const a of ASSETS) c[a.kind] = (c[a.kind] || 0) + 1;
    return c;
  }, [ASSETS]);

  const filtered = useMemo(() => {
    let xs = ASSETS.filter(a =>
      (tab === 'all' || a.kind === tab) &&
      (rar === 'any' || a.rarity === rar) &&
      (q === '' || a.name.toLowerCase().includes(q.toLowerCase()))
    );
    if (sort === 'val')  xs = [...xs].sort((a,b) => (b.market || 0) * (b.qty || 1) - (a.market || 0) * (a.qty || 1));
    if (sort === 'rare') xs = [...xs].sort((a,b) => ['common','rare','epic','legendary','mythic','anomaly','unique'].indexOf(b.rarity) - ['common','rare','epic','legendary','mythic','anomaly','unique'].indexOf(a.rarity));
    if (sort === 'name') xs = [...xs].sort((a,b) => a.name.localeCompare(b.name));
    return xs;
  }, [ASSETS, tab, q, rar, sort]);

  const totalValue = useMemo(() =>
    ASSETS.reduce((s, a) => s + ((a.market || 0) * (a.qty || 1)), 0),
    [ASSETS]
  );

  return (
    <div className="screen">
      <ScreenHead
        title="Vault"
        desc="Every transferable asset you own — resources, relics, items, heroes, cards, deeds. Universal asset framework: each carries a unique ID, ownership history, and a tradable status."
        idTag={`HOLDER ${window.ECON.PLAYER.id} · ${ASSETS.length} ASSETS`}
        right={
          <div style={{ textAlign: 'right' }}>
            <div className="mono muted" style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase' }}>Est. Net Worth</div>
            <div className="disp" style={{ fontSize: 26, color: 'var(--aza)' }}>{fmt(totalValue)} <span style={{ fontSize: 12, color: 'var(--muted)' }}>Aza coin</span></div>
          </div>
        }
      />

      <div className="tabs">
        {KIND_TABS.map(t => (
          <button key={t.id} data-active={tab === t.id ? '1' : '0'} onClick={() => setTab(t.id)}>
            {t.label}<span className="count">{counts[t.id] || 0}</span>
          </button>
        ))}
      </div>

      <div className="toolbar">
        <input className="input search" placeholder="Search vault…" value={q} onChange={e => setQ(e.target.value)} />
        <select className="select" value={rar} onChange={e => setRar(e.target.value)}>
          <option value="any">Any rarity</option>
          {Object.entries(window.ECON.RARITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="select" value={sort} onChange={e => setSort(e.target.value)}>
          <option value="val">Sort: Value</option>
          <option value="rare">Sort: Rarity</option>
          <option value="name">Sort: Name</option>
        </select>
        <div className="spacer" />
        <button className="btn">Deposit to Corp</button>
        <button className="btn primary">Send asset</button>
      </div>

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 64 }}></th>
              <th>Asset</th>
              <th>Kind</th>
              <th>Rarity</th>
              <th className="num">Qty / Lvl</th>
              <th className="num">Unit value</th>
              <th className="num">Total</th>
              <th>Status</th>
              <th style={{ width: 220 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(a => (
              <tr key={a.id}
                  data-selected={sel === a.id ? '1' : '0'}
                  className={a.flag ? 'flag-' + a.flag : ''}
                  onClick={() => setSel(a.id)}>
                <td><AssetGlyph asset={a} /></td>
                <td>
                  <div style={{ fontWeight: 500 }}>{a.name}</div>
                  <div className="mono muted" style={{ fontSize: 10.5 }}>{a.id}{a.effect ? ' · ' + a.effect : ''}</div>
                </td>
                <td className="mono muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>{a.kind}</td>
                <td><RarityChip rarity={a.rarity} /></td>
                <td className="num mono">
                  {a.kind === 'hero' ? `Lv ${a.level}` : (a.qty ? fmt(a.qty) + (a.unit ? ' ' + a.unit : '') : '1')}
                </td>
                <td className="num mono" style={{ color: 'var(--muted)' }}>
                  {a.market != null ? fmt(a.market) : (a.kind === 'relic' || a.kind === 'hero' || a.kind === 'deed' ? '—' : '—')}
                </td>
                <td className="num mono" style={{ color: 'var(--aza)' }}>
                  {a.market != null ? fmt((a.market) * (a.qty || 1)) : '—'}
                </td>
                <td>
                  {a.equipped && <span className="chip rust">EQUIPPED · {a.equipped}</span>}
                  {!a.equipped && a.flag === 'illicit' && <span className="chip toxic">ILLICIT</span>}
                  {!a.equipped && a.flag === 'anomaly' && <span className="chip void">ANOMALY</span>}
                  {!a.equipped && a.flag === 'occult'  && <span className="chip danger">OCCULT</span>}
                  {!a.equipped && !a.flag && <span className="chip flat">FREE</span>}
                </td>
                <td>
                  <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                    {a.kind === 'relic' && (
                      <button className="btn sm ghost" onClick={(e) => { e.stopPropagation(); openRelic(a.id); }}>Details</button>
                    )}
                    <button className="btn sm" onClick={(e) => { e.stopPropagation(); openSend(a); }}>Send</button>
                    <button className="btn sm primary" onClick={(e) => { e.stopPropagation(); openList(a); }}>List</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// MARKETPLACE — universal exchange
// ============================================================================

function MarketplaceScreen({ openBuy }) {
  const { LISTINGS } = window.ECON;
  const [kind, setKind] = useState('all');
  const [q, setQ] = useState('');
  const [rar, setRar] = useState('any');
  const [sort, setSort] = useState('new');
  const [scope, setScope] = useState('public'); // public | corp | mine

  const filtered = useMemo(() => {
    let xs = LISTINGS.filter(l =>
      l.kind !== 'deed' &&  // deeds live in Real Estate
      (kind === 'all' || l.kind === kind) &&
      (rar === 'any' || l.rarity === rar) &&
      (q === '' || (l.asset + ' ' + l.seller).toLowerCase().includes(q.toLowerCase())) &&
      (scope === 'public' || (scope === 'corp' && l.corp) || (scope === 'mine' && l.mine))
    );
    if (sort === 'price-asc')  xs = [...xs].sort((a,b) => a.price - b.price);
    if (sort === 'price-desc') xs = [...xs].sort((a,b) => b.price - a.price);
    if (sort === 'rare')       xs = [...xs].sort((a,b) => ['common','rare','epic','legendary','mythic','anomaly','unique'].indexOf(b.rarity) - ['common','rare','epic','legendary','mythic','anomaly','unique'].indexOf(a.rarity));
    return xs;
  }, [LISTINGS, kind, q, rar, sort, scope]);

  return (
    <div className="screen">
      <ScreenHead
        title="Marketplace"
        desc="Universal exchange. Resources, relics, items, cards, heroes and deeds — listed by players and corporations. Dynamic pricing tracks supply, scarcity, and server events."
        right={
          <div className="row" style={{ gap: 18 }}>
            <Stat label="24h Volume" value={fmtAza(1_482_300)} delta="+12%" up />
            <Stat label="Median Tax" value="3.2%" delta="−0.4" up />
            <Stat label="Active listings" value="14,402" />
          </div>
        }
      />

      <div className="tabs">
        {[{ id:'public', l:'Public' }, { id:'corp', l:'Corporation only' }, { id:'mine', l:'My listings' }].map(s => (
          <button key={s.id} data-active={scope === s.id ? '1' : '0'} onClick={() => setScope(s.id)}>{s.l}</button>
        ))}
      </div>

      <div className="toolbar">
        <input className="input search" placeholder="Search listings, sellers, corporations…" value={q} onChange={e => setQ(e.target.value)} />
        <select className="select" value={kind} onChange={e => setKind(e.target.value)}>
          <option value="all">All categories</option>
          {MARKET_KIND_TABS.slice(1).map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <select className="select" value={rar} onChange={e => setRar(e.target.value)}>
          <option value="any">Any rarity</option>
          {Object.entries(window.ECON.RARITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="select" value={sort} onChange={e => setSort(e.target.value)}>
          <option value="new">Newest</option>
          <option value="price-asc">Price ↑</option>
          <option value="price-desc">Price ↓</option>
          <option value="rare">Rarity</option>
        </select>
        <div className="spacer" />
        <button className="btn primary">+ List asset</button>
      </div>

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 56 }}></th>
              <th>Listing</th>
              <th>Seller</th>
              <th>Rarity</th>
              <th className="num">Qty</th>
              <th className="num">Unit price</th>
              <th>Trend</th>
              <th>Posted</th>
              <th style={{ width: 140 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(l => (
              <tr key={l.id}>
                <td><AssetGlyph asset={{ name: l.asset, rarity: l.rarity }} /></td>
                <td>
                  <div style={{ fontWeight: 500 }}>{l.asset}</div>
                  <div className="mono muted" style={{ fontSize: 10.5 }}>{l.id} · {l.kind}</div>
                </td>
                <td>
                  <div>{l.seller} {l.corp && <span className="chip rust" style={{ marginLeft: 6 }}>CORP</span>} {l.mine && <span className="chip aza" style={{ marginLeft: 6 }}>YOU</span>}</div>
                  <div className="mono muted" style={{ fontSize: 10.5 }}>REP {Math.round(l.sellerRep * 100)}</div>
                </td>
                <td><RarityChip rarity={l.rarity} /></td>
                <td className="num mono">{fmt(l.qty)}</td>
                <td className="num mono" style={{ color: 'var(--aza)' }}>{fmt(l.price)} Aza coin</td>
                <td><Trend dir={l.trend} /> <span className="mono muted" style={{ fontSize: 11, marginLeft: 4 }}>30d</span></td>
                <td className="mono muted" style={{ fontSize: 11 }}>{l.posted} ago</td>
                <td>
                  <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                    <button className="btn sm ghost">Watch</button>
                    <button className="btn sm primary" onClick={() => openBuy(l)} disabled={l.mine}>{l.mine ? 'Yours' : 'Buy'}</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, delta, up }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div className="mono muted" style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 500 }}>
        {value} {delta && <span className={'mono ' + (up ? 'trend up' : 'trend down')} style={{ fontSize: 11 }}>{delta}</span>}
      </div>
    </div>
  );
}

// ============================================================================
// BLACK MARKET
// ============================================================================

function BlackMarketScreen({ openBuy }) {
  const { BLACK_MARKET } = window.ECON;
  const [risk, setRisk] = useState('any');

  const filtered = BLACK_MARKET.filter(l => risk === 'any' || l.risk === risk);

  return (
    <div className="screen">
      <ScreenHead
        title="Black Market"
        desc="Restricted, contraband, and anomalous listings. Hidden inventory, smuggler routing, no tax — but raid chance, reputation damage, and government seizure are real."
        right={<Stat label="Smuggler reputation" value="0.42" delta="−0.04" />}
      />

      <div className="card" style={{ padding: 14, borderColor: 'var(--toxic-soft)', background: 'linear-gradient(180deg, transparent, oklch(0.20 0.05 130 / 0.18))', marginBottom: 18 }}>
        <div className="row" style={{ gap: 14 }}>
          <span className="chip toxic">RESTRICTED CHANNEL</span>
          <span className="muted" style={{ fontSize: 12 }}>
            All transactions on this exchange are off-ledger. Sellers and buyers are partially anonymized.
            A raid this hour has a <b style={{ color: 'var(--blood)' }}>~18%</b> chance of confiscation. Insure shipments before commit.
          </span>
        </div>
      </div>

      <div className="toolbar">
        <select className="select" value={risk} onChange={e => setRisk(e.target.value)}>
          <option value="any">Any risk</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="extreme">Extreme</option>
        </select>
        <div className="spacer" />
        <button className="btn toxic">Bribe inspector ·  220 Aza coin</button>
        <button className="btn">Insure all  ·  1,400 Aza coin</button>
      </div>

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 56 }}></th>
              <th>Listing</th>
              <th>Seller</th>
              <th>Rarity</th>
              <th className="num">Qty</th>
              <th className="num">Unit price</th>
              <th>Risk</th>
              <th>Posted</th>
              <th style={{ width: 140 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(l => (
              <tr key={l.id} className="flag-illicit">
                <td><AssetGlyph asset={{ name: l.asset, rarity: l.rarity }} /></td>
                <td>
                  <div style={{ fontWeight: 500 }}>{l.asset}</div>
                  <div className="mono muted" style={{ fontSize: 10.5 }}>{l.id} · {l.kind}</div>
                </td>
                <td><div className="mono">{l.seller}</div></td>
                <td><RarityChip rarity={l.rarity} /></td>
                <td className="num mono">{fmt(l.qty)}</td>
                <td className="num mono" style={{ color: 'var(--toxic)' }}>{fmt(l.price)} Aza coin</td>
                <td><RiskPips level={l.risk} /></td>
                <td className="mono muted" style={{ fontSize: 11 }}>{l.posted} ago</td>
                <td>
                  <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                    <button className="btn sm toxic" onClick={() => openBuy(l, true)}>Smuggle</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// LOGISTICS — convoys in transit
// ============================================================================

function LogisticsScreen() {
  const { CONVOYS } = window.ECON;
  return (
    <div className="screen">
      <ScreenHead
        title="Logistics"
        desc="Resources and assets in transit between camps, properties, vaults, and markets. Escorts reduce raid risk. Insurance partially refunds losses."
        right={<Stat label="In-transit value" value={fmtAza(48_240)} />}
      />

      <div className="card">
        <div className="row-head">
          <h3>Active convoys</h3>
          <span className="muted mono" style={{ fontSize: 11 }}>{CONVOYS.filter(c => c.status === 'in-transit').length} moving · 1 arrived</span>
          <span className="more">Dispatch new</span>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 90 }}>Convoy</th>
              <th>Route</th>
              <th>Cargo</th>
              <th>Escort</th>
              <th>Risk</th>
              <th style={{ width: 260 }}>Progress</th>
              <th>ETA</th>
              <th style={{ width: 140 }}></th>
            </tr>
          </thead>
          <tbody>
            {CONVOYS.map(c => (
              <tr key={c.id} className={c.flag ? 'flag-' + c.flag : ''}>
                <td className="mono">{c.id}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 500 }}>{c.from}</span>
                    <span className="muted mono">→</span>
                    <span style={{ fontWeight: 500 }}>{c.to}</span>
                  </div>
                </td>
                <td>{c.cargo}</td>
                <td className="mono muted" style={{ fontSize: 11 }}>{c.escort}</td>
                <td>
                  <RiskPips level={c.risk > 0.6 ? 'extreme' : c.risk > 0.35 ? 'high' : c.risk > 0.15 ? 'medium' : 'low'} />
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 4, background: 'var(--surface-3)', borderRadius: 2 }}>
                      <div style={{ width: (c.progress * 100) + '%', height: '100%', background: c.flag === 'illicit' ? 'var(--toxic)' : c.flag === 'occult' ? 'var(--blood)' : 'var(--rust)', borderRadius: 2 }} />
                    </div>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--muted)', width: 32, textAlign: 'right' }}>{Math.round(c.progress * 100)}%</span>
                  </div>
                </td>
                <td className="mono">{c.eta}</td>
                <td>
                  <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                    <button className="btn sm ghost">Track</button>
                    <button className="btn sm" disabled={c.status === 'arrived'}>Recall</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 18, marginTop: 18 }}>
        <div className="card">
          <div className="row-head"><h3>Production chains</h3></div>
          <div style={{ padding: 18 }}>
            <ChainRow chain={['Iron Foundry 04', 'Forge', 'Weapons', 'Marketplace']} rate="+ 240 Iron / h" />
            <ChainRow chain={['Tenement Row 14', 'Survivor Camp', 'Food upkeep', 'Excess → Market']} rate="+ 1,200 Food / d" />
            <ChainRow chain={['AI Lab Klyx', 'Data Cores', 'Advanced crafting', 'Relics']} rate="+ 6 Cores / h" />
            <ChainRow chain={['Drowned Chapel', 'Altar', 'Demon Essence', 'Black Market']} rate="+ 2 Essence / d" flag="occult" />
          </div>
        </div>
        <div className="card">
          <div className="row-head"><h3>Recent incidents</h3></div>
          <div className="col" style={{ padding: 14, gap: 12 }}>
            <Incident time="−4h" tag="RAID"  text="Convoy CV-011 ambushed. 200 Iron lost." />
            <Incident time="−7h" tag="THEFT" text="Vault — 12 Energy Cells unaccounted." />
            <Incident time="−1d" tag="SEIZURE" text="Contraband CV-005 seized at checkpoint." />
            <Incident time="−2d" tag="OK" text="Insurance payout received: 1,420 Aza coin." good />
          </div>
        </div>
      </div>
    </div>
  );
}

function ChainRow({ chain, rate, flag }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px dashed var(--line-soft)' }}>
      {chain.map((c, i) => (
        <React.Fragment key={i}>
          <span className={'chip ' + (flag === 'occult' && i === 2 ? 'danger' : 'flat')}>{c}</span>
          {i < chain.length - 1 && <span className="mono muted">→</span>}
        </React.Fragment>
      ))}
      <div style={{ flex: 1 }} />
      <span className="mono" style={{ color: 'var(--aza)', fontSize: 11 }}>{rate}</span>
    </div>
  );
}

function Incident({ time, tag, text, good }) {
  return (
    <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
      <span className="mono muted" style={{ fontSize: 10.5, width: 36 }}>{time}</span>
      <span className={'chip ' + (good ? 'aza' : tag === 'SEIZURE' ? 'danger' : 'rust')}>{tag}</span>
      <span style={{ fontSize: 12.5 }}>{text}</span>
    </div>
  );
}

// ============================================================================
// MAILBOX
// ============================================================================

function MailboxScreen({ mail, setMail, openTrade }) {
  const [sel, setSel] = useState(mail[0]?.id || null);
  const cur = mail.find(m => m.id === sel) || mail[0];

  const claim = (id) => {
    setMail(mail.map(m => m.id === id ? { ...m, unread: false, claimed: true } : m));
  };

  return (
    <div className="screen">
      <ScreenHead
        title="Mailbox"
        desc="Trade requests, marketplace sales, gifts, convoy reports, and government notices. Attachments can be claimed, returned, or rejected."
        right={<div className="row" style={{ gap: 10 }}>
          <button className="btn ghost">Claim all</button>
          <button className="btn">Mark all read</button>
        </div>}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 18, height: 'calc(100vh - 260px)', minHeight: 480 }}>
        <div className="card" style={{ overflow: 'auto' }}>
          {mail.map(m => (
            <div key={m.id}
                 onClick={() => setSel(m.id)}
                 style={{
                   padding: '12px 14px',
                   borderBottom: '1px solid var(--line-soft)',
                   background: sel === m.id ? 'var(--surface-2)' : 'transparent',
                   cursor: 'default',
                 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontWeight: m.unread ? 600 : 400, fontSize: 12.5 }}>{m.from}</span>
                <span className="mono muted" style={{ fontSize: 10.5 }}>{m.ts}</span>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--fg-2)', marginTop: 2 }}>
                {m.unread && <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 3, background: 'var(--rust)', marginRight: 8, transform: 'translateY(-1px)' }} />}
                {m.subject}
              </div>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.preview}</div>
              {m.attach?.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <span className="chip flat">{m.attach.length} attachment{m.attach.length > 1 ? 's' : ''}</span>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          {cur ? (
            <>
              <div style={{ padding: 18, borderBottom: '1px solid var(--line-soft)' }}>
                <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 6 }}>
                  From · {cur.from}  ·  {cur.ts} ago
                </div>
                <h2 style={{ margin: 0, fontFamily: 'var(--f-display)', fontSize: 24, fontWeight: 600 }}>{cur.subject}</h2>
              </div>

              <div style={{ padding: 18, flex: 1, fontSize: 13.5, color: 'var(--fg-2)' }}>
                <p style={{ margin: '0 0 12px' }}>{cur.preview}</p>
                <p style={{ margin: '0 0 12px', color: 'var(--muted)' }}>
                  Universal asset transfer — confirm receipt to move attachments into your vault. Rejecting returns them to the sender; expiry in 7 days.
                </p>

                {cur.attach?.length > 0 && (
                  <div className="card flat" style={{ padding: 14, marginTop: 18 }}>
                    <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 10 }}>Attachments</div>
                    <div className="col" style={{ gap: 8 }}>
                      {cur.attach.map((a, i) => (
                        <div key={i} className="row" style={{ gap: 12 }}>
                          <span className="chip flat" style={{ minWidth: 80, justifyContent: 'center' }}>{a.kind.toUpperCase()}</span>
                          <span style={{ flex: 1, fontWeight: 500 }}>{a.name || (a.kind === 'aza' ? 'Aza coin' : '—')}</span>
                          {a.qty && <span className="mono">{fmt(a.qty)}{a.kind === 'aza' ? ' Aza coin' : ' ×'}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div style={{ padding: 14, borderTop: '1px solid var(--line-soft)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                {cur.from.includes('WRAITH-9') && (
                  <button className="btn ghost" onClick={openTrade}>Open trade window</button>
                )}
                <button className="btn">Return</button>
                <button className="btn">Reject</button>
                <button className="btn primary" onClick={() => claim(cur.id)} disabled={cur.claimed || !cur.attach?.length}>
                  {cur.claimed ? 'Claimed' : 'Accept & claim'}
                </button>
              </div>
            </>
          ) : <div style={{ padding: 40, color: 'var(--muted)' }}>No mail.</div>}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// LIVE FEED
// ============================================================================

function FeedScreen() {
  const { FEED } = window.ECON;
  return (
    <div className="screen">
      <ScreenHead
        title="Live Feed"
        desc="Universal transaction log. Every send, list, trade, withdrawal and corporation action across this shard, in real time."
        right={<Stat label="Tx · last hour" value="1,402" delta="+8%" up />}
      />

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 80 }}>Time</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Asset</th>
              <th>Target / Value</th>
              <th style={{ width: 120 }}>Kind</th>
            </tr>
          </thead>
          <tbody>
            {FEED.map((f, i) => (
              <tr key={i}>
                <td className="mono">{f.ts}</td>
                <td><span className="mono">{f.actor}</span></td>
                <td className="muted">{f.verb}</td>
                <td style={{ fontWeight: 500 }}>{f.obj}</td>
                <td className="mono">{f.target}</td>
                <td>
                  <span className={'chip ' + ({ send:'flat', list:'flat', trade:'rust', corp:'aza', black:'toxic', logi:'flat' }[f.kind] || 'flat')}>
                    {f.kind.toUpperCase()}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// CORP TREASURY
// ============================================================================

function CorpScreen() {
  return (
    <div className="screen">
      <ScreenHead
        title="BLACK SUN — Treasury"
        desc="Corporation-wide vault. Role-based access controls who can withdraw relics, deposit resources, transfer heroes, or fund operations."
        right={<div className="row" style={{ gap: 18 }}>
          <Stat label="Treasury" value={fmtAza(2_438_120)} delta="+18k" up />
          <Stat label="Members" value="34 / 50" />
          <Stat label="War chest" value={fmtAza(412_000)} />
        </div>}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 18 }}>
        <div className="card">
          <div className="row-head"><h3>Vault — top holdings</h3><span className="more">Open full vault</span></div>
          <table className="tbl">
            <thead><tr><th></th><th>Asset</th><th>Rarity</th><th className="num">Qty</th><th>Deposited by</th><th>Permission</th></tr></thead>
            <tbody>
              <CorpRow name="Iron" rar="common" qty="142,800 kg" by="Sethiroth" perm="Quartermaster" />
              <CorpRow name="Energy Cells" rar="rare" qty="3,402 cell" by="Treasurer" perm="Officer+" />
              <CorpRow name="Ancient Reactor Core" rar="legendary" qty="1" by="Sethiroth" perm="Director only" relic />
              <CorpRow name="Pre-Collapse Ledger" rar="rare" qty="1" by="Founder" perm="Officer+" relic />
              <CorpRow name="Commander Paul" rar="legendary" qty="Lv 42" by="HR Team" perm="Director only" hero />
              <CorpRow name="Demon Essence" rar="mythic" qty="14 vial" by="Sister Tiamat" perm="Occult Council" occult />
              <CorpRow name="Contraband" rar="epic" qty="22 crate" by="WHISPER" perm="Smugglers only" illicit />
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="card" style={{ padding: 14 }}>
            <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 10 }}>Funding operations</div>
            <FundLine label="Crimson Pact War" used={412_000} cap={500_000} color="var(--blood)" />
            <FundLine label="Foundry Belt Expansion" used={186_000} cap={400_000} color="var(--rust)" />
            <FundLine label="Black Market Run" used={42_000} cap={60_000} color="var(--toxic)" />
            <FundLine label="Camp Upkeep" used={84_000} cap={120_000} color="var(--aza)" />
          </div>

          <div className="card">
            <div className="row-head"><h3>Role permissions</h3></div>
            <div className="col" style={{ padding: 14, gap: 8, fontSize: 12.5 }}>
              <PermRow role="Director"     can="Withdraw relics · Heroes · Aza coin" />
              <PermRow role="Officer"      can="Deposit · Withdraw resources · View vault" />
              <PermRow role="Quartermaster" can="Move items · Deposit resources" />
              <PermRow role="Smuggler"     can="Black market funding only" />
              <PermRow role="Recruit"      can="Claim generated resources" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CorpRow({ name, rar, qty, by, perm, relic, hero, occult, illicit }) {
  return (
    <tr className={occult ? 'flag-occult' : illicit ? 'flag-illicit' : ''}>
      <td><AssetGlyph asset={{ name, rarity: rar }} /></td>
      <td>
        <div style={{ fontWeight: 500 }}>{name}</div>
        <div className="mono muted" style={{ fontSize: 10.5 }}>{relic ? 'RELIC' : hero ? 'HERO' : 'RESOURCE'}</div>
      </td>
      <td><RarityChip rarity={rar} /></td>
      <td className="num mono">{qty}</td>
      <td className="mono muted" style={{ fontSize: 11 }}>{by}</td>
      <td><span className="chip flat">{perm}</span></td>
    </tr>
  );
}

function FundLine({ label, used, cap, color }) {
  const p = used / cap;
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 12.5 }}>{label}</span>
        <span className="mono muted" style={{ fontSize: 11 }}>{fmt(used)} / {fmt(cap)}</span>
      </div>
      <div style={{ height: 4, background: 'var(--surface-3)', borderRadius: 2 }}>
        <div style={{ width: (p * 100) + '%', height: '100%', background: color, borderRadius: 2 }} />
      </div>
    </div>
  );
}

function PermRow({ role, can }) {
  return (
    <div className="row" style={{ gap: 10, padding: '8px 0', borderBottom: '1px dashed var(--line-soft)' }}>
      <span className="chip rust" style={{ minWidth: 110, justifyContent: 'center' }}>{role}</span>
      <span className="muted" style={{ fontSize: 12 }}>{can}</span>
    </div>
  );
}

// ============================================================================
// TRADE WINDOW
// ============================================================================

function TradeScreen({ assets }) {
  const [mine, setMine] = useState([
    { ...assets.find(a => a.name === 'Ancient Reactor Core'), tradeQty: 1 },
    { kind: 'aza', name: 'Aza coin', qty: 12_000, tradeQty: 12_000 },
  ]);
  const [theirs, setTheirs] = useState([
    { name: 'Crown of the Fallen King', rarity: 'mythic', kind: 'relic', tradeQty: 1 },
  ]);
  const [meReady, setMeReady] = useState(false);
  const [theyReady, setTheyReady] = useState(false);
  const [lock, setLock] = useState(false);

  const valueMine = 34_500 + 12_000;
  const valueTheirs = 58_000;
  const delta = valueTheirs - valueMine;

  useEffect(() => {
    if (meReady && theyReady) {
      const t = setTimeout(() => setLock(true), 600);
      return () => clearTimeout(t);
    }
  }, [meReady, theyReady]);

  return (
    <div className="screen">
      <ScreenHead
        title="Secure Trade — WRAITH-9"
        desc="Drag assets into the window. Both parties must lock and confirm. Final confirmation triggers a 5-second hold to prevent last-second swaps."
        idTag={`SESSION TRD-2204-${Date.now() % 10000}`}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 88px 1fr', gap: 18, alignItems: 'stretch' }}>
        <TradeSide
          title="Your offer"
          who={window.ECON.PLAYER.handle}
          rep={window.ECON.PLAYER.rep}
          assets={mine}
          value={valueMine}
          ready={meReady}
          onToggle={() => setMeReady(r => !r)}
          locked={lock}
          mine
        />

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
          <div style={{ width: 1, flex: 1, background: 'var(--line-soft)' }} />
          <div className="disp" style={{ fontSize: 28 }}>⇄</div>
          <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em' }}>BALANCE</div>
          <div className="disp" style={{ fontSize: 18, color: delta > 0 ? 'oklch(0.78 0.15 145)' : 'var(--blood)' }}>
            {delta > 0 ? '+' : ''}{fmt(delta)}
          </div>
          <div className="mono muted" style={{ fontSize: 10 }}>Aza coin</div>
          <div style={{ width: 1, flex: 1, background: 'var(--line-soft)' }} />
        </div>

        <TradeSide
          title="Their offer"
          who="WRAITH-9"
          rep={0.92}
          assets={theirs}
          value={valueTheirs}
          ready={theyReady}
          onToggle={() => setTheyReady(r => !r)}
          locked={lock}
        />
      </div>

      <div className="card" style={{ marginTop: 18, padding: 14 }}>
        <div className="row" style={{ gap: 14 }}>
          <span className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase' }}>Audit</span>
          <span className="muted">Transaction will be logged: counterparties, asset IDs, Aza coin paid, marketplace tax (2%), and timestamp. Both parties' ownership history is updated atomically.</span>
          <div style={{ flex: 1 }} />
          <button className="btn ghost">Cancel</button>
          <button className="btn primary" disabled={!lock}>{lock ? 'Confirm trade (5s hold)' : 'Awaiting both to lock'}</button>
        </div>
      </div>
    </div>
  );
}

function TradeSide({ title, who, rep, assets, value, ready, onToggle, locked, mine }) {
  return (
    <div className="card" style={{ borderColor: ready ? 'var(--rust)' : 'var(--line-soft)' }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line-soft)' }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase' }}>{title}</div>
            <div style={{ fontSize: 16, fontWeight: 500, marginTop: 2 }}>{who} <span className="muted mono" style={{ fontSize: 11 }}>· REP {Math.round(rep * 100)}</span></div>
          </div>
          <button className="btn" data-on={ready} onClick={onToggle}
            style={{
              background: ready ? 'var(--rust)' : 'var(--surface-2)',
              color: ready ? 'var(--bg)' : 'var(--fg)',
              borderColor: 'transparent',
            }}>
            {ready ? '✓ Locked' : 'Lock offer'}
          </button>
        </div>
      </div>

      <div style={{ padding: 14, minHeight: 280, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {assets.map((a, i) => (
          <div key={i} className="row" style={{ padding: 10, border: '1px solid var(--line-soft)', borderRadius: 'var(--radius)', background: 'var(--bg-2)' }}>
            <AssetGlyph asset={a} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500 }}>{a.name}</div>
              <div className="mono muted" style={{ fontSize: 10.5 }}>{a.kind?.toUpperCase()}{a.rarity ? ' · ' + a.rarity.toUpperCase() : ''}</div>
            </div>
            <div className="mono" style={{ fontSize: 13 }}>×{fmt(a.tradeQty)}</div>
          </div>
        ))}
        {mine && !locked && (
          <div className="row" style={{ padding: 18, border: '1px dashed var(--line-soft)', borderRadius: 'var(--radius)', justifyContent: 'center', color: 'var(--muted)' }}>
            + Drag asset here
          </div>
        )}
      </div>

      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--line-soft)', display: 'flex', justifyContent: 'space-between' }}>
        <span className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase' }}>Estimated value</span>
        <span className="disp" style={{ fontSize: 16, color: 'var(--aza)' }}>{fmt(value)} Aza coin</span>
      </div>
    </div>
  );
}

// ============================================================================
// RELIC DETAIL
// ============================================================================

function RelicDetailScreen({ relicId, onBack }) {
  const { ASSETS, HISTORY } = window.ECON;
  const r = ASSETS.find(a => a.id === relicId) || ASSETS.find(a => a.kind === 'relic');
  const hist = HISTORY[r.id] || [];

  return (
    <div className="screen">
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="btn ghost sm" onClick={onBack}>← Vault</button>
        <span className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em' }}>{r.id}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 28, marginTop: 14 }}>
        <div>
          <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.16em', textTransform: 'uppercase', marginBottom: 8 }}>Relic · {r.slot} slot</div>
          <h1 className="disp" style={{ margin: 0, fontSize: 56, fontWeight: 600, lineHeight: 1.05, letterSpacing: '-0.005em' }}>{r.name}</h1>
          <div style={{ display: 'flex', gap: 10, marginTop: 24, flexWrap: 'wrap' }}>
            <RarityChip rarity={r.rarity} />
            {r.note && <span className="chip aza">{r.note}</span>}
            {r.flag && <span className="chip danger">{r.flag.toUpperCase()}</span>}
            <span className="chip flat">TRADABLE</span>
            <span className="chip flat">RENTABLE</span>
          </div>

          <p style={{ fontSize: 16, color: 'var(--fg-2)', marginTop: 24, maxWidth: 580 }}>
            {r.effect}. Equippable to {r.slot === 'camp' ? 'a controlled property' : r.slot === 'hero' ? 'a hero in your roster' : 'your corporation'}.
            Buffs apply persistently while the relic remains equipped and the holder retains ownership.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginTop: 28 }}>
            <Spec label="Equipped to" value={r.equipped || '— unequipped —'} />
            <Spec label="Original finder" value={r.foundBy || 'Unknown'} />
            <Spec label="Origin event" value={r.origin || '—'} />
            <Spec label="Insurance" value="Tier III · 60% payout" />
            <Spec label="Rentable per cycle" value="2,400 Aza coin / 24h" />
            <Spec label="Market floor" value="34,500 Aza coin" />
          </div>

          <div className="row" style={{ gap: 10, marginTop: 28 }}>
            <button className="btn primary">List on marketplace</button>
            <button className="btn">Rent out</button>
            <button className="btn">Send to player</button>
            <button className="btn ghost">Move to corp vault</button>
          </div>
        </div>

        <div className="card" style={{ alignSelf: 'start' }}>
          <div className="row-head">
            <h3>Ownership history</h3>
            <span className="more">Immutable</span>
          </div>
          <div style={{ padding: 4 }}>
            {hist.length === 0 && <div style={{ padding: 20, color: 'var(--muted)' }}>No transfers logged.</div>}
            {hist.map((h, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 12, padding: '14px 14px', borderBottom: i < hist.length - 1 ? '1px dashed var(--line-soft)' : 'none' }}>
                <div>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{h.ts}</div>
                  <div className="mono" style={{ fontSize: 10, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.08em', marginTop: 3 }}>{h.type}</div>
                </div>
                <div>
                  <div style={{ fontWeight: 500 }}>{h.who}</div>
                  {h.note && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{h.note}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Spec({ label, value }) {
  return (
    <div>
      <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 500 }}>{value}</div>
    </div>
  );
}

Object.assign(window, {
  VaultScreen, MarketplaceScreen, BlackMarketScreen,
  LogisticsScreen, MailboxScreen, FeedScreen,
  CorpScreen, TradeScreen, RelicDetailScreen,
});
