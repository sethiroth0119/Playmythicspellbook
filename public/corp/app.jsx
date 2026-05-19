/* app.jsx — root. Routing, top-level state, action modals, tweaks panel. */

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "palette": ["#c64a2a","#c75dd4","#7fd486"],
  "density": "regular",
  "showFlags": true,
  "marketState": "stable",
  "blackMarketVisible": true,
  "tickerSpeed": 60
}/*EDITMODE-END*/;

function App() {
  const [route, setRoute] = useState('vault');
  const [relicId, setRelicId] = useState(null);
  const [propertyId, setPropertyId] = useState(null);
  const [sendTarget, setSendTarget] = useState(null);   // asset object
  const [listTarget, setListTarget] = useState(null);   // asset object
  const [buyTarget, setBuyTarget] = useState(null);     // {listing, illicit}
  const [confirmStage, setConfirmStage] = useState(0);  // for trade-confirm flow
  const [toasts, setToasts] = useState([]);
  const [mail, setMail] = useState(window.ECON.MAIL);
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  const [balances, setBalances] = useState(() => {
    const e = (window.__JB && window.__JB.econ) || null;
    return { aza: e ? (e.cinders | 0) : window.ECON.PLAYER.aza, iron: 14_280, essence: 9 };
  });

  // 🌉 Live bridge — when the embedding game pushes real economy data, mirror
  // the player's real Cinder balance into the app. Standalone = mock.
  useEffect(() => {
    const onJB = () => {
      const e = (window.__JB && window.__JB.econ) || null;
      if (e) setBalances(b => ({ ...b, aza: e.cinders | 0 }));
    };
    window.addEventListener('jbdata', onJB);
    onJB();
    return () => window.removeEventListener('jbdata', onJB);
  }, []);

  // Apply tweak: palette
  useEffect(() => {
    const [rust, void_, toxic] = t.palette || [];
    if (rust) document.documentElement.style.setProperty('--rust', rust);
    if (void_) document.documentElement.style.setProperty('--void', void_);
    if (toxic) document.documentElement.style.setProperty('--toxic', toxic);
  }, [t.palette]);

  // Apply tweak: density
  useEffect(() => {
    const d = t.density;
    const rowPad = d === 'compact' ? '8px 14px' : d === 'comfy' ? '16px 14px' : '12px 14px';
    document.documentElement.style.setProperty('--row-pad', rowPad);
    // Patch tbl row padding live
    const id = '__density-style';
    let el = document.getElementById(id);
    if (!el) { el = document.createElement('style'); el.id = id; document.head.appendChild(el); }
    el.textContent = `.tbl tbody td { padding: ${rowPad}; }`;
  }, [t.density]);

  // Apply tweak: tickerSpeed
  useEffect(() => {
    const id = '__ticker-style';
    let el = document.getElementById(id);
    if (!el) { el = document.createElement('style'); el.id = id; document.head.appendChild(el); }
    el.textContent = `.ticker .track { animation-duration: ${t.tickerSpeed}s; }`;
  }, [t.tickerSpeed]);

  // Apply tweak: market state — adjusts ticker tone + prices visually
  const events = useMemo(() => {
    const base = window.ECON.EVENTS;
    if (t.marketState === 'breach') {
      return [{ tag:'BREACH', text:'Server-wide Anomaly Tide — relic floors +60%', tone:'anomaly' }, ...base];
    }
    if (t.marketState === 'crash') {
      return [{ tag:'CRASH', text:'Black market crash — contraband floors −44%', tone:'warning' }, ...base];
    }
    if (t.marketState === 'seizure') {
      return [{ tag:'SEIZURE', text:'Mass government seizure in Foundry Belt — Iron −12%', tone:'danger' }, ...base];
    }
    return base;
  }, [t.marketState]);

  const toast = useCallback((msg, bad) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(ts => [...ts, { id, msg, bad }]);
    setTimeout(() => setToasts(ts => ts.filter(x => x.id !== id)), 3000);
  }, []);

  const openRelic = (id) => { setRelicId(id); setRoute('relic'); };
  const openProperty = (id) => { setPropertyId(id); setRoute('property'); };
  const onSetRoute = (r) => {
    if (r !== 'relic') setRelicId(null);
    if (r !== 'property') setPropertyId(null);
    setRoute(r);
  };

  // Action handlers
  const doSend = (asset, target, qty, message) => {
    setSendTarget(null);
    toast(`Sent ${qty} ${asset.name} to ${target}.`);
    if (asset.name === 'Iron') setBalances(b => ({ ...b, iron: b.iron - qty }));
  };

  const bridged = () => !!(window.JB_isBridged && window.JB_isBridged());

  const doBuy = (l, illicit) => {
    setBuyTarget(null);
    const total = l.price * l.qty;
    if (bridged()) {
      window.JB_action({ kind: 'buy', total });
      toast(`${illicit ? 'Smuggled' : 'Purchased'} ${l.qty}× ${l.asset} for ${fmt(total)} 🔥.`);
      return;
    }
    if (illicit) {
      toast(`Smuggled ${l.qty}× ${l.asset} for ${fmt(total)} Aza coin. Convoy dispatched (high risk).`);
    } else {
      toast(`Purchased ${l.qty}× ${l.asset} for ${fmt(total)} Aza coin.`);
    }
    setBalances(b => ({ ...b, aza: b.aza - total }));
  };

  const doList = (asset, qty, price) => {
    setListTarget(null);
    if (bridged()) {
      // Corp sale → routed to the real economy: net Cinders credited, the
      // 2% Foundation Tax logged to the Reserve (Corporation bucket).
      window.JB_action({ kind: 'sell', resource: asset.name, qty, unit: price });
      toast(`Sold ${qty}× ${asset.name} for ${fmt(qty * price)} 🔥 — 2% Foundation Tax → Reserve.`);
      return;
    }
    toast(`Listed ${qty}× ${asset.name} at ${fmt(price)} Aza coin. Market tax 2%.`);
  };

  const [foundOpen, setFoundOpen] = useState(false);
  const _jbE = (window.__JB && window.__JB.econ) || null;
  const jbSignedIn = !!(_jbE && _jbE.signedIn);
  const noCorp = !!(_jbE && _jbE.signedIn && !_jbE.corp);
  const foundCost = _jbE ? (_jbE.foundCost | 0) : 1000000;
  const isAdm = !!(_jbE && _jbE.isAdmin);

  const unreadMail = mail.filter(m => m.unread).length;
  const blackCount = window.ECON.BLACK_MARKET.length;

  let screen;
  if (route === 'vault')      screen = <VaultScreen openRelic={openRelic} openSend={setSendTarget} openList={setListTarget} />;
  else if (route === 'corp')      screen = <CorpScreen />;
  else if (route === 'logistics') screen = <LogisticsScreen />;
  else if (route === 'market')    screen = <MarketplaceScreen openBuy={(l) => setBuyTarget({ listing: l })} />;
  else if (route === 'realestate')screen = <RealEstateScreen openDetail={openProperty} />;
  else if (route === 'property')  screen = <PropertyDetailScreen propertyId={propertyId} onBack={() => setRoute('realestate')} />;
  else if (route === 'black')     screen = t.blackMarketVisible
    ? <BlackMarketScreen openBuy={(l) => setBuyTarget({ listing: l, illicit: true })} />
    : <RestrictedScreen />;
  else if (route === 'feed')      screen = <FeedScreen />;
  else if (route === 'mail')      screen = <MailboxScreen mail={mail} setMail={setMail} openTrade={() => setRoute('trade')} />;
  else if (route === 'trade')     screen = <TradeScreen assets={window.ECON.ASSETS} />;
  else if (route === 'relic')     screen = <RelicDetailScreen relicId={relicId} onBack={() => setRoute('vault')} />;

  return (
    <div className="app">
      <Sidebar route={route} setRoute={onSetRoute} mailCount={unreadMail} blackCount={blackCount} />
      <Topbar route={route} balances={balances} />
      <main className="main">{screen}</main>
      <Ticker events={events} />

      <ToastHost toasts={toasts} />

      {noCorp && (
        <button onClick={() => setFoundOpen(true)} style={{
          position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 90,
          cursor: 'pointer', border: '1px solid var(--rust)', background: 'linear-gradient(180deg,#3a2410,#1c1208)',
          color: '#ffe8c8', borderRadius: 8, padding: '0.5rem 1rem', fontWeight: 700,
          fontFamily: 'var(--f-display)', letterSpacing: '.02em', boxShadow: '0 8px 24px rgba(0,0,0,.6)',
        }}>
          🏢 Found a Corporation {isAdm ? '· Admin (free)' : '· ' + fmt(foundCost) + ' Cinder'}
        </button>
      )}

      {sendTarget && <SendModal asset={sendTarget} onClose={() => setSendTarget(null)} onSend={doSend} />}
      {listTarget && <ListModal asset={listTarget} onClose={() => setListTarget(null)} onList={doList} />}
      {buyTarget && <BuyModal listing={buyTarget.listing} illicit={buyTarget.illicit} onClose={() => setBuyTarget(null)} onBuy={doBuy} />}
      {foundOpen && <FoundCorpFlow cost={foundCost} admin={isAdm} handle={(_jbE && _jbE.handle) || 'Founder'}
        onClose={() => setFoundOpen(false)}
        onFiled={(p) => {
          try { window.JB_action && window.JB_action({ kind: 'corpCreate', name: p.name, faction: p.faction, element: p.element }); } catch (e) {}
          setFoundOpen(false);
          toast('Incorporation filed with the Foundation. Processing…');
        }} />}

      <TweaksPanel>
        <TweakSection label="Palette">
          <TweakColor label="Accent set" value={t.palette}
            options={[
              ['#c64a2a','#c75dd4','#7fd486'],  // rust / void / toxic — default
              ['#d97757','#7a5ae0','#5ad1a3'],  // warm amber / electric / mint
              ['#a23a4d','#3a6bce','#d6a23a'],  // blood / cobalt / sun
              ['#5fa15a','#2a8a8a','#c89a4a'],  // forest / teal / parchment
              ['#e8d089','#888','#bbb'],        // bone monochrome
            ]}
            onChange={(v) => setTweak('palette', v)} />
        </TweakSection>

        <TweakSection label="Layout">
          <TweakRadio label="Density" value={t.density}
            options={['compact','regular','comfy']}
            onChange={(v) => setTweak('density', v)} />
        </TweakSection>

        <TweakSection label="World state">
          <TweakSelect label="Market event" value={t.marketState}
            options={[
              { value:'stable', label:'Stable' },
              { value:'breach', label:'Anomaly Breach' },
              { value:'crash',  label:'Black market crash' },
              { value:'seizure',label:'Gov. seizure' },
            ]}
            onChange={(v) => setTweak('marketState', v)} />
          <TweakToggle label="Black market visible" value={t.blackMarketVisible}
            onChange={(v) => setTweak('blackMarketVisible', v)} />
          <TweakSlider label="Ticker speed" value={t.tickerSpeed} min={15} max={120} step={5} unit="s"
            onChange={(v) => setTweak('tickerSpeed', v)} />
        </TweakSection>

        <TweakSection label="Quick demo">
          <TweakButton label="Trigger raid (toast)" onClick={() => toast('Convoy CV-014 ambushed. 220 Iron lost.', true)} />
          <TweakButton label="Bank +10k Aza coin" secondary onClick={() => { setBalances(b => ({ ...b, aza: b.aza + 10000 })); toast('Treasury credit: +10,000 Aza coin.'); }} />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

function RestrictedScreen() {
  return (
    <div className="screen">
      <ScreenHead title="Black Market" desc="Access restricted." />
      <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
        <div className="mono" style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', marginBottom: 8 }}>NO ACCESS</div>
        <div style={{ fontSize: 14 }}>This channel is hidden in your current reputation tier.</div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Action modals
// ──────────────────────────────────────────────────────────────────────────

function SendModal({ asset, onClose, onSend }) {
  const { PLAYERS } = window.ECON;
  const [q, setQ] = useState('');
  const [target, setTarget] = useState(null);
  const [qty, setQty] = useState(asset.kind === 'resource' ? Math.min(100, asset.qty) : 1);
  const [method, setMethod] = useState('direct');
  const [msg, setMsg] = useState('');

  const matches = PLAYERS.filter(p => p.handle.toLowerCase().includes(q.toLowerCase())).slice(0, 5);
  const fee = method === 'direct' ? 0 : method === 'mail' ? Math.round((asset.market || 1) * qty * 0.005) : 12;

  return (
    <Modal title={`Send · ${asset.name}`} onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!target} onClick={() => onSend(asset, target?.handle, qty, msg)}>
            {target ? `Send to ${target.handle}` : 'Pick recipient'}
          </button>
        </>
      }>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <div>
          <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 10 }}>Asset</div>
          <div className="row" style={{ padding: 12, background: 'var(--bg-2)', border: '1px solid var(--line-soft)', borderRadius: 4, gap: 12, alignItems: 'flex-start' }}>
            <AssetGlyph asset={asset} size="lg" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--f-display)', fontSize: 18, fontWeight: 600, lineHeight: 1.2 }}>{asset.name}</div>
              <div className="mono muted" style={{ fontSize: 11, marginTop: 2 }}>{asset.id}</div>
              <div style={{ marginTop: 8 }}><RarityChip rarity={asset.rarity} /></div>
            </div>
          </div>

          {asset.kind === 'resource' && (
            <div style={{ marginTop: 14 }}>
              <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 6 }}>Quantity</div>
              <div className="row" style={{ gap: 8 }}>
                <input className="input" type="number" value={qty} min={1} max={asset.qty}
                  onChange={e => setQty(Math.max(1, Math.min(asset.qty, Number(e.target.value) || 0)))} />
                <button className="btn sm" onClick={() => setQty(asset.qty)}>Max</button>
              </div>
              <div className="muted mono" style={{ fontSize: 11, marginTop: 6 }}>You hold {fmt(asset.qty)} {asset.unit || ''}</div>
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 6 }}>Delivery method</div>
            <div className="col" style={{ gap: 6 }}>
              <DeliveryOpt val="direct" cur={method} set={setMethod} title="Direct send" desc="Instant. Requires recipient online or in same Corp." />
              <DeliveryOpt val="mail" cur={method} set={setMethod} title="Mailbox" desc="Held in recipient's inbox. They must accept." />
              <DeliveryOpt val="convoy" cur={method} set={setMethod} title="Convoy" desc="Physical transit. Subject to raid risk." />
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 6 }}>Message (optional)</div>
            <input className="input" placeholder="e.g. for the next raid" value={msg} onChange={e => setMsg(e.target.value)} />
          </div>
        </div>

        <div>
          <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 10 }}>Recipient</div>
          <input className="input" placeholder="Search player handle…" value={q} onChange={e => setQ(e.target.value)} />
          <div className="col" style={{ marginTop: 10, gap: 4 }}>
            {matches.map(p => (
              <button key={p.id} onClick={() => setTarget(p)} className="row" style={{
                padding: '10px 12px',
                border: '1px solid ' + (target?.id === p.id ? 'var(--rust)' : 'var(--line-soft)'),
                background: target?.id === p.id ? 'var(--surface-2)' : 'transparent',
                borderRadius: 4, gap: 12, textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'default',
              }}>
                <div className="me-av" style={{ width: 32, height: 32, borderRadius: 16, background: 'linear-gradient(135deg, var(--rust), var(--void))', display: 'grid', placeItems: 'center', fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--bg)' }}>{p.handle.slice(0, 2)}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500 }}>{p.handle} {p.online && <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 3, background: 'oklch(0.78 0.15 145)', marginLeft: 6, transform: 'translateY(-1px)' }} />}</div>
                  <div className="mono muted" style={{ fontSize: 10.5 }}>{p.corp} · REP {Math.round(p.rep * 100)}</div>
                </div>
              </button>
            ))}
          </div>

          <div className="card flat" style={{ marginTop: 18, padding: 14 }}>
            <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 10 }}>Summary</div>
            <SumRow label="Quantity" value={`${fmt(qty)} ${asset.unit || '×'}`} />
            <SumRow label="Recipient" value={target?.handle || '—'} />
            <SumRow label="Method" value={method[0].toUpperCase() + method.slice(1)} />
            <SumRow label="Transfer fee" value={fee ? `${fmt(fee)} Aza coin` : 'Free'} />
            <SumRow label="Logged to" value="Ownership history" />
          </div>
        </div>
      </div>
    </Modal>
  );
}

function DeliveryOpt({ val, cur, set, title, desc }) {
  return (
    <button onClick={() => set(val)} className="row" style={{
      padding: '10px 12px',
      border: '1px solid ' + (cur === val ? 'var(--rust)' : 'var(--line-soft)'),
      background: cur === val ? 'var(--surface-2)' : 'transparent',
      borderRadius: 4, gap: 10, textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'default',
    }}>
      <span style={{
        width: 14, height: 14, borderRadius: 7, border: '1.5px solid ' + (cur === val ? 'var(--rust)' : 'var(--line)'),
        flexShrink: 0, display: 'grid', placeItems: 'center'
      }}>
        {cur === val && <span style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--rust)' }} />}
      </span>
      <div>
        <div style={{ fontWeight: 500 }}>{title}</div>
        <div className="muted" style={{ fontSize: 11.5 }}>{desc}</div>
      </div>
    </button>
  );
}

function SumRow({ label, value }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', padding: '6px 0', fontSize: 12.5, borderBottom: '1px dashed var(--line-soft)' }}>
      <span className="muted">{label}</span>
      <span className="mono">{value}</span>
    </div>
  );
}

// ───── List modal

function ListModal({ asset, onClose, onList }) {
  const [price, setPrice] = useState(asset.market || 100);
  const [qty, setQty] = useState(asset.kind === 'resource' ? Math.min(100, asset.qty) : 1);
  const [scope, setScope] = useState('public');
  const total = price * qty;
  const tax = Math.round(total * 0.02);
  return (
    <Modal title={`List · ${asset.name}`} onClose={onClose}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={() => onList(asset, qty, price)}>List for {fmt(total)} Aza coin</button>
      </>}>
      <div className="row" style={{ gap: 14, marginBottom: 18, alignItems: 'flex-start' }}>
        <AssetGlyph asset={asset} size="lg" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="disp" style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.15 }}>{asset.name}</div>
          <div className="mono muted" style={{ fontSize: 11, marginTop: 2 }}>{asset.id}</div>
          <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <RarityChip rarity={asset.rarity} />
            {asset.market && <span className="chip flat">Market price · {fmt(asset.market)} Aza coin</span>}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 6 }}>Unit price</div>
          <div className="row" style={{ gap: 8 }}>
            <input className="input" type="number" value={price} onChange={e => setPrice(Math.max(0, Number(e.target.value)))} />
            <span className="mono">Aza coin</span>
          </div>
        </div>

        {asset.kind === 'resource' && (
          <div>
            <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 6 }}>Quantity</div>
            <input className="input" type="number" value={qty} onChange={e => setQty(Math.max(1, Math.min(asset.qty, Number(e.target.value) || 0)))} />
          </div>
        )}

        <div>
          <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 6 }}>Visibility</div>
          <select className="select" value={scope} onChange={e => setScope(e.target.value)}>
            <option value="public">Public marketplace</option>
            <option value="corp">Corporation-only</option>
            <option value="black">Black market</option>
          </select>
        </div>
      </div>

      <div className="card flat" style={{ marginTop: 18, padding: 14 }}>
        <SumRow label="Listing total" value={`${fmt(total)} Aza coin`} />
        <SumRow label="Marketplace tax (2%)" value={`−${fmt(tax)} Aza coin`} />
        <SumRow label="Payout on sale" value={`${fmt(total - tax)} Aza coin`} />
        <SumRow label="Visibility" value={scope} />
      </div>
    </Modal>
  );
}

// ───── Buy modal

function BuyModal({ listing, illicit, onClose, onBuy }) {
  const [insured, setInsured] = useState(illicit);
  const [holding, setHolding] = useState(false);
  const [done_, setDone] = useState(false);
  const tax = illicit ? 0 : Math.round(listing.price * listing.qty * 0.02);
  const ins = insured ? Math.round(listing.price * listing.qty * 0.04) : 0;
  const total = listing.price * listing.qty + tax + ins;

  const confirm = () => {
    setHolding(true);
    setTimeout(() => { setDone(true); onBuy(listing, illicit); }, 1200);
  };

  return (
    <Modal title={(illicit ? 'Smuggle · ' : 'Purchase · ') + listing.asset} onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className={illicit ? 'btn toxic' : 'btn primary'} onClick={confirm} disabled={holding}>
            {holding ? 'Holding · 5s…' : (illicit ? `Smuggle for ${fmt(total)} Aza coin` : `Buy for ${fmt(total)} Aza coin`)}
          </button>
        </>
      }>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <div>
          <div className="row" style={{ gap: 14, marginBottom: 14, alignItems: 'flex-start' }}>
            <AssetGlyph asset={{ name: listing.asset, rarity: listing.rarity }} size="lg" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="disp" style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.15 }}>{listing.asset}</div>
              <div className="mono muted" style={{ fontSize: 11, marginTop: 2 }}>{listing.id} · seller {listing.seller}</div>
              <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <RarityChip rarity={listing.rarity} />
                <span className="chip flat">QTY · {listing.qty}</span>
                {illicit && <span className="chip toxic">RESTRICTED</span>}
                {listing.risk && <span className="row" style={{ gap: 4 }}><RiskPips level={listing.risk} /></span>}
              </div>
            </div>
          </div>

          {illicit && (
            <div className="card flat" style={{ padding: 14, marginBottom: 14, borderColor: 'var(--toxic-soft)' }}>
              <div className="mono" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--toxic)', marginBottom: 6 }}>Restricted</div>
              <div className="muted" style={{ fontSize: 12 }}>Acquiring this asset carries a raid chance. Reputation penalty applies if you're inspected. Insurance recommended.</div>
            </div>
          )}

          <div className="col" style={{ gap: 8 }}>
            <DeliveryOpt val="vault" cur="vault" set={() => {}} title="Deliver to my vault" desc="Convoy will route via secured channel." />
            <label className="row" style={{ padding: '10px 12px', border: '1px solid var(--line-soft)', borderRadius: 4, gap: 10, cursor: 'default' }}>
              <input type="checkbox" checked={insured} onChange={e => setInsured(e.target.checked)} />
              <div>
                <div style={{ fontWeight: 500 }}>Insure shipment (4% of value)</div>
                <div className="muted" style={{ fontSize: 11.5 }}>60% payout if convoy is raided.</div>
              </div>
            </label>
          </div>
        </div>

        <div>
          <div className="card flat" style={{ padding: 14 }}>
            <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 10 }}>Transaction</div>
            <SumRow label={`${listing.qty} × ${fmt(listing.price)} Aza coin`} value={`${fmt(listing.price * listing.qty)} Aza coin`} />
            <SumRow label={illicit ? 'Tax (off-ledger)' : 'Marketplace tax (2%)'} value={tax ? `+${fmt(tax)} Aza coin` : 'Avoided'} />
            <SumRow label="Insurance" value={ins ? `+${fmt(ins)} Aza coin` : '—'} />
            <SumRow label="Total" value={`${fmt(total)} Aza coin`} />

            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line-soft)' }}>
              <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 6 }}>Counterparty</div>
              <div style={{ fontWeight: 500 }}>{listing.seller}</div>
              {listing.sellerRep != null && <div className="mono muted" style={{ fontSize: 11 }}>Rep {Math.round(listing.sellerRep * 100)} · {Math.round((1 - listing.sellerRep) * 10)} flag(s)</div>}
            </div>
          </div>

          {holding && (
            <div className="card flat" style={{ padding: 14, marginTop: 14 }}>
              <div className="mono" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 6, color: 'var(--rust)' }}>FINAL HOLD</div>
              <div className="muted" style={{ fontSize: 12 }}>Confirming in 5 seconds. Cancel within this window to abort.</div>
              <div style={{ height: 3, background: 'var(--surface-3)', borderRadius: 2, marginTop: 8, overflow: 'hidden' }}>
                <div style={{ height: '100%', background: illicit ? 'var(--toxic)' : 'var(--rust)', width: '0%', animation: 'fill 1.2s linear forwards' }} />
              </div>
              <style>{`@keyframes fill { from { width: 0; } to { width: 100%; } }`}</style>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Found a Corporation — application form → SCP Foundation incorporation
// document with an e-signature. Funnels into JB_action({kind:'corpCreate'}).
// ──────────────────────────────────────────────────────────────────────────
const CORP_FACTIONS = ['Berserker', 'Eldritch', 'Plant', 'Celestial', 'Vampire', 'Construct', 'Elemental', 'Corrupted', 'Foundation', 'Independent'];
const CORP_ELEMENTS = ['Fire', 'Void', 'Nature', 'Light', 'Blood', 'Metal', 'Storm', 'Corruption', 'Arcane', 'Ice'];

function FoundCorpFlow({ cost, admin, handle, onClose, onFiled }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [faction, setFaction] = useState('');
  const [element, setElement] = useState('');
  const [sig, setSig] = useState('');
  const tag = (name.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 4) || '----');
  const step1ok = name.trim().length >= 3 && faction && element;
  const signed = sig.trim().length >= 2;
  const docNo = 'EC-' + (10000 + ((name.length * 37 + faction.length * 13 + element.length * 7) % 89999));

  const field = (label, node) => (
    <div style={{ marginBottom: 14 }}>
      <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      {node}
    </div>
  );

  return (
    <Modal title={step === 1 ? 'Found a Corporation' : 'SCP Foundation — Articles of Incorporation'} onClose={onClose}
      footer={step === 1 ? (
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!step1ok} onClick={() => setStep(2)}>
            {step1ok ? 'Review filing →' : 'Complete the form'}
          </button>
        </>
      ) : (
        <>
          <button className="btn ghost" onClick={() => setStep(1)}>← Back</button>
          <button className="btn primary" disabled={!signed} onClick={() => onFiled({ name: name.trim(), faction, element })}>
            {signed ? (admin ? 'File incorporation (admin · free)' : 'File incorporation · ' + fmt(cost) + ' Cinder') : 'Sign to file'}
          </button>
        </>
      )}>
      {step === 1 ? (
        <div>
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 16 }}>
            A corporation is your guild — a chartered economic entity. Members pool vaults, run logistics &amp; markets, and trade under one banner. Every corporation sale pays a flat <b style={{ color: 'var(--rust)' }}>2% Foundation Tax</b> into the Foundation Reserve.
          </div>
          {field('Corporation name', (
            <input className="input" placeholder="e.g. Black Sun Holdings" value={name} maxLength={40}
              onChange={e => setName(e.target.value)} />
          ))}
          {name.trim() && <div className="mono muted" style={{ fontSize: 11, marginTop: -8, marginBottom: 14 }}>Ticker tag: <b style={{ color: 'var(--aza)' }}>[{tag}]</b></div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {field('Favourite faction', (
              <select className="select" value={faction} onChange={e => setFaction(e.target.value)}>
                <option value="">— choose —</option>
                {CORP_FACTIONS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            ))}
            {field('Best element', (
              <select className="select" value={element} onChange={e => setElement(e.target.value)}>
                <option value="">— choose —</option>
                {CORP_ELEMENTS.map(el => <option key={el} value={el}>{el}</option>)}
              </select>
            ))}
          </div>
          <div className="card flat" style={{ padding: 14, marginTop: 4 }}>
            <SumRow label="Incorporation bond" value={admin ? 'Waived (admin)' : fmt(cost) + ' Cinder'} />
            <SumRow label="Standing tax on all sales" value="2% → Foundation Reserve" />
            <SumRow label="Charter type" value="Player guild / economic entity" />
          </div>
        </div>
      ) : (
        <div>
          <div style={{
            background: '#100c08', border: '1px solid var(--line-soft)', borderRadius: 4,
            padding: '22px 24px', fontFamily: 'var(--f-mono)', fontSize: 12, lineHeight: 1.7, color: '#d8cdb8',
          }}>
            <div style={{ textAlign: 'center', borderBottom: '1px solid var(--line-soft)', paddingBottom: 12, marginBottom: 14 }}>
              <div style={{ letterSpacing: '.32em', fontWeight: 700, color: '#e8d089' }}>SCP FOUNDATION</div>
              <div style={{ letterSpacing: '.18em', fontSize: 10.5, color: 'var(--muted)' }}>OFFICE OF ECONOMIC CONTAINMENT</div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--muted)', marginBottom: 12 }}>
              <span>DOC&nbsp;{docNo}</span><span>CLASSIFICATION: <b style={{ color: 'var(--rust)' }}>EUCLID-FISCAL</b></span><span>COPY 1 OF 1</span>
            </div>
            <div style={{ fontWeight: 700, color: '#e8d089', marginBottom: 8 }}>ARTICLES OF INCORPORATION &amp; FOUNDATION OVERSIGHT</div>
            <p style={{ margin: '0 0 10px' }}>
              This instrument charters <b style={{ color: '#fff' }}>{name.trim() || '████████'}</b> [{tag}] as a recognised economic entity ("the Corporation"), aligned <b>{faction || '████'}</b> / <b>{element || '████'}</b> under the supervision of the Foundation.
            </p>
            <p style={{ margin: '0 0 10px' }}>
              <b style={{ color: '#e8d089' }}>§1 Powers.</b> The Corporation may operate a shared vault, dispatch logistics convoys, list on the public &amp; corporation markets, hold real estate, and conduct sanctioned black-market commerce. Membership functions as a guild.
            </p>
            <p style={{ margin: '0 0 10px' }}>
              <b style={{ color: '#e8d089' }}>§2 Taxation.</b> A standing <b style={{ color: 'var(--rust)' }}>2% Foundation Tax</b> is levied on the gross of every Corporation sale, transfer-for-value and contract. Levied funds are removed from circulation into the <b>Foundation Reserve</b> and are non-refundable. Black-market disposals are assessed identically as a <b>Foundation Seizure Fee</b>.
            </p>
            <p style={{ margin: '0 0 10px' }}>
              <b style={{ color: '#e8d089' }}>§3 Bond.</b> An incorporation bond of <b>{admin ? '0 (waived — Foundation staff)' : fmt(cost) + ' Cinder'}</b> is due on filing and is forfeit to the Reserve. This bond exists to constrain unbounded capital accumulation per Containment Directive 12-ECON.
            </p>
            <p style={{ margin: '0 0 14px' }}>
              <b style={{ color: '#e8d089' }}>§4 Compliance.</b> The Corporation submits to audit. Falsified ledgers, tax evasion or convoy fraud void this charter and may escalate the holder's threat rating.
            </p>
            <div style={{ borderTop: '1px dashed var(--line-soft)', paddingTop: 14, marginTop: 4 }}>
              <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 6 }}>
                E-signature — sign as {handle} to bind this charter
              </div>
              <input className="input" placeholder="Type your signature…" value={sig}
                onChange={e => setSig(e.target.value)}
                style={{ fontFamily: 'Newsreader, serif', fontSize: 20, fontStyle: 'italic', letterSpacing: '.04em' }} />
              <div className="mono muted" style={{ fontSize: 10, marginTop: 8 }}>
                By signing you accept §1–§4 and authorise the {admin ? 'waived' : fmt(cost) + ' Cinder'} bond. Filed: {new Date().toISOString().slice(0, 10)}
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
