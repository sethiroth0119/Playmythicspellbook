/* app.jsx — root. Routing, top-level state, action modals, tweaks panel. */

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "palette": ["#c64a2a","#c75dd4","#7fd486"],
  "density": "regular",
  "showFlags": true,
  "marketState": "stable",
  "blackMarketVisible": true,
  "tickerSpeed": 60
}/*EDITMODE-END*/;

/* 🛟 SCREEN ERROR BOUNDARY.

   Until this existed there was no boundary anywhere in the corp app, so a
   throw inside ANY screen unmounted the whole React tree — the sidebar, the
   top bar and the ticker went with it, leaving a blank page with the error
   only in the console and no way for the player to navigate out. That is not
   hypothetical: one warehouse-freight row arriving without a `cargo` array
   (bridged data, five screens now read bridged data) blanked the entire app
   in a browser, and every screen visited afterwards was empty.

   It wraps ONLY <main>, deliberately. The nav must survive the failure of the
   thing it navigates to — a player who lands on a broken screen has to be able
   to leave it. `route` is passed as a key from the parent, so changing screens
   resets the boundary and a transient failure does not stick.

   It says which screen failed and prints the message. It does NOT retry
   silently or render a plausible-looking empty state: a screen that failed to
   read its data must not be mistaken for a screen whose data is empty. */
class ScreenBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err: err }; }
  componentDidCatch(err, info) { try { console.error('[corp screen]', err, info); } catch (e) {} }
  render() {
    if (!this.state.err) return this.props.children;
    const msg = (this.state.err && this.state.err.message) || String(this.state.err);
    return (
      <div className="screen">
        <div className="card" style={{ padding: 18 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>This screen could not be drawn</div>
          <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 10 }}>
            Something in <b>{this.props.name || 'this screen'}</b> failed while rendering, so nothing on it can be
            trusted and it has been left blank rather than shown half-filled. The rest of the app still works —
            pick another screen in the sidebar. Nothing was changed and no data was lost.
          </div>
          <div className="mono muted" style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg}</div>
        </div>
      </div>
    );
  }
}

function App() {
  const [route, setRoute] = useState('vault');
  const [relicId, setRelicId] = useState(null);
  const [propertyId, setPropertyId] = useState(null);
  const [sendTarget, setSendTarget] = useState(null);   // asset object
  const [listTarget, setListTarget] = useState(null);   // asset object
  const [buyTarget, setBuyTarget] = useState(null);     // {listing, illicit}
  const [confirmStage, setConfirmStage] = useState(0);  // for trade-confirm flow
  const [toasts, setToasts] = useState([]);
  /* 📮 There is no mail STATE any more. window.ECON.MAIL was an array
     hardcoded to [] whose `unread` flags only ever moved because a button in
     the old inbox flipped them in React. The Mailbox is now a read-only feed
     of five real ledgers (econ.corpActivity) and the sidebar badge counts it
     against a localStorage mark — see the header of MailboxScreen. */
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // 💰 Top-bar balances. `aza` is the CINDER chip (legacy field name).
  // ⚠ `iron` and `essence` used to be hardcoded 14,280 / 9 — pure demo numbers
  // that shipped to players as if they were real holdings. They are now the
  // player's actual Aza Coin and Mythic Token.
  const [balances, setBalances] = useState(() => {
    const e = (window.__JB && window.__JB.econ) || null;
    return {
      aza:      e ? (e.cinders | 0) : window.ECON.PLAYER.aza,   // Cinder
      sovs:     e ? (e.aza | 0) : 0,                            // Aza Coin
      mt:       e ? (e.mt | 0) : 0,                             // Mythic Token
      wallet:   e ? (e.wallet || null) : null,
    };
  });

  // 🌉 Live bridge — when the embedding game pushes real economy data, mirror
  // the player's real Cinder balance into the app. Standalone = mock.
  useEffect(() => {
    const onJB = () => {
      const e = (window.__JB && window.__JB.econ) || null;
      if (e) setBalances(b => ({ ...b, aza: e.cinders | 0, sovs: e.aza | 0, mt: e.mt | 0, wallet: e.wallet || null }));
      // 🏢 Just founded a corporation → pop the Guild & Hiring panel so the
      // owner can start hiring right away.
      if (e && e.corpJustFounded) { setFoundOpen(false); setGuildOpen(true); }
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
    // (The old `iron` balance was a demo placeholder and no longer exists;
    // real resource movement is owned by the game side, not this local state.)
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
  const [myResOpen, setMyResOpen] = useState(false);
  const [guildOpen, setGuildOpen] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  useEffect(() => {
    const onOpen = (e) => {
      const d = e && e.detail;
      if (d === 'resources') setMyResOpen(true);
      else if (d === 'guild') setGuildOpen(true);
      else if (d === 'found') setFoundOpen(true);
      else if (d === 'vault') setVaultOpen(true);
    };
    window.addEventListener('jb:open', onOpen);
    return () => window.removeEventListener('jb:open', onOpen);
  }, []);
  const _jbE = (window.__JB && window.__JB.econ) || null;
  const jbSignedIn = !!(_jbE && _jbE.signedIn);
  const noCorp = !!(_jbE && _jbE.signedIn && !_jbE.corp);
  const foundCost = _jbE ? (_jbE.foundCost | 0) : 1000000;
  const isAdm = !!(_jbE && _jbE.isAdmin);

  const blackCount = window.ECON.BLACK_MARKET.length;

  let screen;
  if (route === 'vault')      screen = <VaultScreen openRelic={openRelic} openSend={setSendTarget} openList={setListTarget} />;
  else if (route === 'corp')      screen = <CorpScreen />;
  else if (route === 'operations')screen = <OperationsScreen econ={_jbE} />;
  else if (route === 'logistics') screen = <LogisticsScreen />;
  else if (route === 'market')    screen = <MarketplaceScreen openBuy={(l) => setBuyTarget({ listing: l })} />;
  else if (route === 'realestate')screen = <RealEstateScreen openDetail={openProperty} />;
  else if (route === 'property')  screen = <PropertyDetailScreen propertyId={propertyId} onBack={() => setRoute('realestate')} />;
  else if (route === 'black')     screen = t.blackMarketVisible
    ? <BlackMarketScreen openBuy={(l) => setBuyTarget({ listing: l, illicit: true })} />
    : <RestrictedScreen />;
  else if (route === 'feed')      screen = <FeedScreen />;
  else if (route === 'mail')      screen = <MailboxScreen />;
  else if (route === 'trade')     screen = <TradeScreen />;
  else if (route === 'relic')     screen = <RelicDetailScreen relicId={relicId} onBack={() => setRoute('vault')} />;

  return (
    <div className="app">
      <Sidebar route={route} setRoute={onSetRoute} blackCount={blackCount} />
      <Topbar route={route} balances={balances} />
      {/* key={route} so the boundary resets when the player navigates away —
          otherwise one broken screen would poison every screen after it. */}
      <main className="main"><ScreenBoundary key={route} name={route}>{screen}</ScreenBoundary></main>
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
      {myResOpen && <MyResourcesModal econ={_jbE} onClose={() => setMyResOpen(false)} />}
      {guildOpen && <CorpGuild econ={_jbE} toast={toast} onClose={() => setGuildOpen(false)}
        onFound={() => { setGuildOpen(false); setFoundOpen(true); }} />}
      {vaultOpen && <CorpVaultModal econ={_jbE} toast={toast} onClose={() => setVaultOpen(false)} />}

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

/* 💸 PAY A MEMBER — one dialog, in the game's own chrome.
   Replaces two stacked window.prompt() calls. Beyond matching the rest of the
   app, an in-app modal does three things a browser prompt cannot: show what you
   actually hold, refuse an unaffordable amount BEFORE the request is sent, and
   put the amount and the reason on one screen.

   ⚠ IT READS econ.cinders, NOT econ.cinder. The singular was written first and
     is undefined, which made `have` 0, disabled the button for everyone and
     would have replaced a broken feature with a differently broken one.
   ⚠ NO INVENTED CSS VARS. --bg-1 and --ink do not exist in this theme (it is
     --bg/--surface and --fg), and --toxic is the black-market GREEN, not an
     error colour — that is --blood. Inputs use className="input" like every
     other field in this file rather than hand-rolled inline styles. */
function PayMemberModal({ member, econ, onClose, onPay }) {
  /* 💸 WAGES COME OUT OF THE CORPORATION. Reported: "when players who own a
     corporation or a CEO pays their member in Cinder with the Pay button, take
     from the Corp Treasury and then pay the player." This modal charged the
     PAYER'S OWN WALLET and said so — the founder of Hidn Studios was being
     asked to fund wages from his 69,795 🔥 while 962,190 🔥 sat in the
     corporation he owns.
     An officer (founder / owner / CEO — econ.amOwner) now spends the treasury;
     everyone else still sends their own Cinder, which is the member-to-member
     gift this modal was originally built for. The server decides the same way
     and refuses an officer it does not recognise, so the two cannot disagree
     about whose money it is — see corp_pay_member_from_treasury (sql/107). */
  const fromTreasury = !!(econ && econ.amOwner && econ.corp);
  const have = Math.max(0, Math.floor(
    (fromTreasury ? (econ && econ.corpTreasury) : (econ && econ.cinders)) || 0));
  const [amt, setAmt] = useState('100');
  const [note, setNote] = useState('Work completed');
  const qty = Math.floor(Number(amt) || 0);
  const tooMuch = qty > have;
  const bad = !(qty > 0) || tooMuch;
  const quick = [100, 500, 1000, 5000].filter(v => v <= have);

  /* ⌨ ESCAPE CLOSES THIS SHEET ONLY. Modal registers a plain window keydown,
     and the Guild panel behind this one has its own — a single Escape would
     shut both, throwing away the panel while you are still typing an amount.
     A CAPTURE listener runs before either and stops the event dead. */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <Modal title={'Pay · ' + member.name} onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={bad} onClick={() => onPay(qty, note)}>
            {!(qty > 0) ? 'Enter an amount' : tooMuch ? 'Not enough Cinder' : 'Pay ' + fmt(qty) + ' 🔥'}
          </button>
        </>
      }>
      <div style={{ display: 'grid', gap: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between', padding: 12,
          background: 'var(--bg-2)', border: '1px solid var(--line-soft)', borderRadius: 4 }}>
          <div>
            <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase' }}>Paying</div>
            <div style={{ fontFamily: 'var(--f-display)', fontSize: 18, fontWeight: 600, lineHeight: 1.2, marginTop: 2 }}>{member.name}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase' }}>{fromTreasury ? 'Corp Treasury' : 'Your Cinder'}</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--aza)', marginTop: 2 }}>🔥 {fmt(have)}</div>
          </div>
        </div>

        <div>
          <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 6 }}>Amount</div>
          <div className="row" style={{ gap: 8 }}>
            <input className="input" type="number" min={1} max={have} value={amt}
              onChange={e => setAmt(e.target.value)} />
            <button className="btn sm" disabled={!have} onClick={() => setAmt(String(have))}>All</button>
          </div>
          {quick.length > 0 && (
            <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              {quick.map(v => (
                <button key={v} className="btn sm" onClick={() => setAmt(String(v))}>{fmt(v)}</button>
              ))}
            </div>
          )}
          {tooMuch && (
            <div className="mono" style={{ fontSize: 11, color: 'var(--blood)', marginTop: 8 }}>
              {fromTreasury ? 'The treasury holds ' : 'You only hold '}{fmt(have)} 🔥.
            </div>
          )}
          {have === 0 && (
            <div className="mono muted" style={{ fontSize: 11, marginTop: 8 }}>
              {fromTreasury
                ? 'The corporation treasury is empty — deposit Cinder before paying wages.'
                : 'You have no Cinder to pay with.'}
            </div>
          )}
        </div>

        <div>
          <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 6 }}>What is it for?</div>
          <input className="input" placeholder="e.g. Work completed" value={note}
            onChange={e => setNote(e.target.value)} />
        </div>

        <div className="mono muted" style={{ fontSize: 11, lineHeight: 1.6 }}>
          {fromTreasury ? 'The Cinder leaves the corporation treasury' : 'The Cinder moves from your wallet'}
          {' to ' + member.name + "'s wallet the moment you press Pay. "}
          There is nothing for them to claim and nothing to cancel — check the amount first.
        </div>
      </div>
    </Modal>
  );
}


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

// ──────────────────────────────────────────────────────────────────────────
// My Resources — everything the player really holds (bridged from the game).
// ──────────────────────────────────────────────────────────────────────────
function MyResourcesModal({ econ, onClose }) {
  const res = (econ && Array.isArray(econ.resources)) ? econ.resources.slice().sort((a, b) => (b.qty | 0) - (a.qty | 0)) : [];
  return (
    <Modal title="My Resources" onClose={onClose}
      footer={<button className="btn primary" onClick={onClose}>Close</button>}>
      {!econ ? (
        <div className="muted" style={{ padding: 24, textAlign: 'center' }}>Open Just Business from inside the game to see your real holdings.</div>
      ) : (
        <div>
          <div className="row" style={{ gap: 12, marginBottom: 16 }}>
            <div className="card flat" style={{ flex: 1, padding: 14, textAlign: 'center' }}>
              <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase' }}>Cinder</div>
              <div className="disp" style={{ fontSize: 24, color: 'var(--rust)' }}>{fmt(econ.cinders | 0)}</div>
            </div>
            <div className="card flat" style={{ flex: 1, padding: 14, textAlign: 'center' }}>
              <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase' }}>Aza coin</div>
              <div className="disp" style={{ fontSize: 24, color: 'var(--aza)' }}>{fmt(econ.aza | 0)}</div>
            </div>
          </div>
          <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 8 }}>
            Camp resources · {res.length} types
          </div>
          {res.length === 0 ? (
            <div className="muted" style={{ padding: 18, textAlign: 'center', fontSize: 12.5 }}>No resources yet — loot, raid and run expeditions in the game to fill your vault.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, maxHeight: '52vh', overflow: 'auto' }}>
              {res.map(r => (
                <div key={r.id} className="row" style={{ justifyContent: 'space-between', padding: '8px 12px', border: '1px solid var(--line-soft)', borderRadius: 4, background: 'var(--bg-2)' }}>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.icon || '📦'} {r.name}</span>
                  <span className="mono" style={{ color: 'var(--aza)', fontWeight: 600 }}>{fmt(r.qty | 0)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Corporation = Guild. Owners hire players (roles below). Cap 25; over-cap
// hires cost the owner Aza coin. Players apply for a role by corp tag.
// ──────────────────────────────────────────────────────────────────────────
const CORP_ROLES = [
  { id: 'CEO',               name: 'CEO',               d: 'Top executive — full treasury & strategic authority, second only to the Founder. Hire a CEO when you need someone to run the whole corporation while you are away.' },
  { id: 'Corp CEO',          name: 'Corp CEO',          d: 'Operations officer — can approve applications and help manage members on the owner’s behalf. Your day-to-day manager.' },
  { id: 'Real Estate Agent', name: 'Real Estate Agent', d: 'Lists & manages corporation property, scouts rentable territory, and negotiates land deals. Hire when expanding holdings.' },
  { id: 'Mercenary',         name: 'Mercenary',         d: 'Muscle for convoys, raids and defense — protects high-value shipments and black-market runs. Hire to move goods through danger.' },
  { id: 'Lawyer',            name: 'Lawyer',            d: 'Handles compliance & contracts; lowers audit / seizure heat and tax-evasion risk. Hire to keep the Foundation off your back.' },
  // 👔 Approving a Bank Teller ALSO writes a bank_tellers row (see corpApprove),
  // so the hire genuinely opens the Underwriting Desk for them — the role on its
  // own would be a label with no authority behind it.
  { id: 'Bank Teller',       name: 'Bank Teller',       d: 'Works your bank counter — reviews loan applications and underwrites on the owner’s behalf, up to the approval ceiling you set. Hire when you own a bank and want the desk staffed while you are away.' },
  /* 📦🔧 Two desks, not two labels. Approving either ALSO opens a real
     surface (see corpApprove + _jbDesks in index.html) — the Warehouse Worker
     gets the founder's yard and the capacity office, the Weapon Smith gets the
     bench and a delivery path from their armoury into this vault. Same rule
     the Bank Teller above established: a role with no authority behind it is a
     label, and hiring someone into one is worse than not offering it.
     ⚠ corp_set_role carries its OWN whitelist server-side and it does not know
       these strings yet — sql/047_corp_desk_roles.sql adds them. HIRING works
       without it (corp_hire copies the role straight off the application);
       only RE-ASSIGNING an existing member needs the migration. The desk
       panel below says so rather than letting the dropdown fail silently. */
  { id: 'Warehouse Worker',  name: 'Warehouse Worker',  d: 'Keeps the corporation’s yard — walks the founder’s warehouse floor, moves crates into the right bays and works the capacity market. Hire when your stores are the bottleneck.' },
  { id: 'Weapon Smith',      name: 'Weapon Smith',      d: 'Works the bench — strips donors, cleans parts and forges weapons. Anything they build can be delivered straight into the corporation vault for the guild to draw on. Hire to arm the roster.' },
  { id: 'member',            name: 'Member',            d: 'General corporation member — pools resources and shares in the corporation’s success.' },
];

/* 🔀 CORP SWITCHER — "which corporation am I acting in?"
   ═══════════════════════════════════════════════════════════════════════════
   THE BUG THIS EXISTS BECAUSE OF, written down so nobody removes it as clutter:
   a player founded TWO corporations five hours apart, both named River Meadows
   Corp, both tagged RIVE. The deployed corp_members lets one player hold two
   rows even though the schema declares user_id as its primary key. Every one of
   the 362,706 units they deposited went to one of them; the game bound them to
   the OTHER, and the Vault screen honestly reported an empty vault. It was the
   wrong vault, and there was no way to tell — index.html computed `Corp._multi`
   for exactly this case, with a comment saying a player "has no way to know
   which", and then nothing ever read it.

   ⚠ IT RENDERS ONLY WHEN THERE IS A CHOICE. One corporation, no control — which
     is almost every player, and a picker with one option is noise that makes
     the screen look broken.
   ⚠ IT SHOWS WHAT EACH ONE HOLDS. That is the whole diagnostic: two identically
     named corporations are indistinguishable until one of them says 362,706 and
     the other says empty.
   ⚠ SWITCHING IS A FULL RE-RESOLVE ON THE HOST SIDE, not a local id swap — the
     vault, roster, permissions, treasury, licences and laws are all corp-scoped.
     See the corpPick action in index.html. */
/* 🤝 CONTRIBUTE — the sanctioned way to put something into a corporation you
   JOINED rather than founded.
   ────────────────────────────────────────────────────────────────────────
   It exists because of the rule its counterpart enforces: the Bank of Ethos
   transfer now funds the corporation you FOUNDED, always, whichever one you
   happen to be acting in. That is the right rule — a control labelled "your
   corporation" moving your Cinder into somebody else's treasury, from which
   it is explicitly non-refundable, is a trap — but on its own it would leave
   a member of somebody else's corporation with no way to help fund it at all.
   This is that way, and the wording says what is actually happening.
   Only rendered when the corporation is one they joined: for your own, the
   bank control already reads correctly and a second box would be noise. */
function ContributePanel({ econ, act }) {
  const [amt, setAmt] = useState('');
  if (!econ || !econ.actingInJoined || !econ.corp) return null;
  const n = Math.floor(Number(amt) || 0);
  /* econ.cinderS — plural. The singular is undefined and would read 0,
     disabling the button for everyone; this file already carries a warning
     about exactly that mistake at PayMemberModal. */
  const wallet = Math.max(0, Math.floor(Number(econ.cinders) || 0));
  const tooMuch = n > wallet;
  const owned = econ.ownedCorp;
  return (
    <div className="card flat" style={{ padding: 14, marginBottom: 14, borderColor: 'var(--aza)' }}>
      <div className="mono" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 6, color: 'var(--aza)' }}>
        Contribute
      </div>
      <div className="mono muted" style={{ fontSize: 11, marginBottom: 10, lineHeight: 1.5 }}>
        You joined <b>{econ.corp.name}</b>{econ.corp.tag ? ' [' + econ.corp.tag + ']' : ''} — you did not found it.
        {owned
          ? ' The Bank of Ethos transfer funds your own corporation (' + (owned.name || 'yours') + '). Use this to fund this one.'
          : ' Use this to fund it.'}
      </div>
      <div className="row" style={{ gap: 6, alignItems: 'center' }}>
        <input className="input" type="number" min={1} value={amt} placeholder="Cinder"
          onChange={e => setAmt(e.target.value)}
          style={{ flex: 1, minWidth: 0, padding: '5px 7px' }} />
        <button className="btn sm primary" disabled={!(n > 0) || tooMuch}
          onClick={() => { act({ kind: 'corpContribute', cinder: n }); setAmt(''); }}>
          Contribute
        </button>
      </div>
      <div className="mono muted" style={{ fontSize: 10.5, marginTop: 6 }}>
        {tooMuch
          ? 'Your wallet holds ' + wallet.toLocaleString() + '.'
          : 'Wallet: ' + wallet.toLocaleString() + ' · goes to this corporation\u2019s treasury.'}
      </div>
      {/* Resources already have a path — the vault Deposit button writes to
          whichever corporation you are acting in, which is this one — so this
          points at it rather than building a second one that could drift. */}
      <div className="mono muted" style={{ fontSize: 10.5, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--line-soft)', lineHeight: 1.5 }}>
        For resources and cards, use <b>Deposit</b> on the Vault — it goes to the corporation you are acting in.
      </div>
    </div>
  );
}

function CorpSwitcher({ econ, act }) {
  const list = (econ && Array.isArray(econ.myCorps)) ? econ.myCorps : [];
  if (list.length < 2) return null;
  const why = (econ && econ.corpPickWhy) || '';
  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line-soft)' }}>
      <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 6 }}>
        You are in {list.length} corporations
      </div>
      <div className="mono muted" style={{ fontSize: 11, marginBottom: 8, lineHeight: 1.5 }}>
        You act in one at a time. The vault you see — and the vault a deposit
        reaches — is this one’s.
      </div>
      <div className="col" style={{ gap: 6 }}>
        {list.map((c) => (
          <button
            key={c.id}
            className="row"
            disabled={!!c.current}
            onClick={() => { if (!c.current) act({ kind: 'corpPick', corpId: c.id }); }}
            style={{
              padding: '9px 11px', borderRadius: 4, gap: 10, textAlign: 'left',
              font: 'inherit', color: 'inherit', alignItems: 'center',
              cursor: c.current ? 'default' : 'pointer',
              border: '1px solid ' + (c.current ? 'var(--rust)' : 'var(--line-soft)'),
              background: c.current ? 'var(--surface-2)' : 'transparent',
            }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 600 }}>{c.name || 'Corporation'}</span>
              {c.tag ? <span className="mono muted" style={{ fontSize: 11 }}> [{c.tag}]</span> : null}
              <span className="mono muted" style={{ fontSize: 10.5, display: 'block' }}>
                {String(c.role || 'member')}
                {' · '}
                {/* 0 is a RESULT, not a missing value — say "empty" rather than
                    printing nothing, because "nothing shown" is exactly what
                    made the duplicate corporation invisible in the first place. */}
                {(c.held | 0) > 0 ? (c.held | 0).toLocaleString() + ' units in vault' : 'vault empty'}
              </span>
            </span>
            <span className="mono" style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase',
              color: c.current ? 'var(--rust)' : 'var(--aza)', flexShrink: 0 }}>
              {c.current ? 'Acting' : 'Switch'}
            </span>
          </button>
        ))}
      </div>
      {why === 'holdings' && (
        <div className="mono muted" style={{ fontSize: 10.5, marginTop: 8, lineHeight: 1.5 }}>
          Picked automatically because it is the one holding your goods.
        </div>
      )}
    </div>
  );
}

function CorpGuild({ econ, toast, onClose, onFound }) {
  const [tag, setTag] = useState('');
  const [role, setRole] = useState('member');
  const [payTarget, setPayTarget] = useState(null);
  const corp = econ && econ.corp;
  const roster = (econ && Array.isArray(econ.roster)) ? econ.roster : [];
  const requests = (econ && Array.isArray(econ.requests)) ? econ.requests : [];
  // Accepted, but their membership row does not exist yet (see sql/016).
  const pendingHires = (econ && Array.isArray(econ.pendingHires)) ? econ.pendingHires : [];
  const amOwner = !!(econ && econ.amOwner);
  const cap = (econ && econ.memberCap) || 25;
  const count = (econ && econ.memberCount) || roster.length;
  const fee = (econ && econ.overflowFee) || 3000;
  const me = (econ && econ.handle) || '';
  const corps = (econ && Array.isArray(econ.corps)) ? econ.corps : [];
  const act = (p) => { try { window.JB_action && window.JB_action(p); } catch (e) {} };

  // ── Position powers — what each guild role unlocks ──────────────────────
  const myRole = String((corp && corp.role) || 'member');
  const isExec = amOwner || myRole === 'CEO' || myRole === 'Corp CEO';
  const isAgent = isExec || myRole === 'Real Estate Agent';
  const isLawyer = isExec || myRole === 'Lawyer';
  const agency = (econ && Array.isArray(econ.agencyListings)) ? econ.agencyListings : [];
  const legal = (econ && Array.isArray(econ.legalCases)) ? econ.legalCases : [];

  // 🏠 AGENCY DESK — Real Estate Agents sell/rent the owner's property:
  // reprice, withdraw and relist the founder's cloud listings (server-checked).
  const agencyPanel = (corp && isAgent) ? (
    <div className="card flat" style={{ padding: 12, marginBottom: 14 }}>
      <div className="mono" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--aza)', marginBottom: 6 }}>🏠 Agency Desk — the founder's listings</div>
      {agency.length === 0 ? (
        <div className="muted" style={{ fontSize: 11.5 }}>No properties listed by the founder yet. When the owner lists property on the market, agents manage it here — reprice, withdraw, relist.</div>
      ) : (
        <div className="col" style={{ gap: 6, maxHeight: '22vh', overflow: 'auto' }}>
          {agency.map(l => {
            const pj = l.prop_json || {};
            const name = pj.name || pj.title || l.prop_id || 'Property';
            const isRent = l.kind === 'rent';
            const settled = l.status === 'sold' || l.status === 'rented';
            return (
              <div key={l.id} className="row" style={{ justifyContent: 'space-between', gap: 8, padding: '7px 10px', border: '1px solid var(--line-soft)', borderRadius: 4 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 12 }}>{name} <span className="mono muted" style={{ fontSize: 10 }}>· {isRent ? 'RENT' : 'SALE'} · {l.status}</span></div>
                  <div className="mono muted" style={{ fontSize: 10.5 }}>{isRent ? ((l.rent || 0) + ' 🔥 / ' + (l.rent_days || 1) + 'd') : ((l.price || 0) + ' 🔥')}</div>
                </div>
                {!settled && (
                  <span className="row" style={{ gap: 5, flexShrink: 0 }}>
                    <button className="btn sm" onClick={() => {
                      const cur = isRent ? (l.rent || 0) : (l.price || 0);
                      const v = parseInt(window.prompt('New ' + (isRent ? 'rent' : 'price') + ' (🔥 Cinder):', String(cur)) || '', 10);
                      if (!isNaN(v) && v >= 0) act(isRent ? { kind: 'agencyUpdate', id: l.id, rent: v } : { kind: 'agencyUpdate', id: l.id, price: v });
                    }}>💰 Price</button>
                    {l.status === 'active'
                      ? <button className="btn sm" style={{ color: 'var(--toxic)' }} onClick={() => act({ kind: 'agencyUpdate', id: l.id, status: 'cancelled' })}>✕ Withdraw</button>
                      : <button className="btn sm" onClick={() => act({ kind: 'agencyUpdate', id: l.id, status: 'active' })}>↻ Relist</button>}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  ) : null;

  // ⚖️ LEGAL DOCKET — Lawyers see every court case involving a guild member
  // and when the court date is set (court system integration).
  const lawyerPanel = (corp && isLawyer) ? (
    <div className="card flat" style={{ padding: 12, marginBottom: 14 }}>
      <div className="mono" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--aza)', marginBottom: 6 }}>⚖️ Legal Docket — cases involving guild members</div>
      {legal.length === 0 ? (
        <div className="muted" style={{ fontSize: 11.5 }}>No cases on file against anyone in the guild. Keep it that way, counselor.</div>
      ) : (
        <div className="col" style={{ gap: 6, maxHeight: '22vh', overflow: 'auto' }}>
          {legal.map(c => (
            <div key={c.id} style={{ padding: '7px 10px', border: '1px solid var(--line-soft)', borderRadius: 4 }}>
              <div style={{ fontWeight: 600, fontSize: 12 }}>
                {c.defendant_name} <span className="mono muted" style={{ fontSize: 10 }}>· {c.crime_type} · sev {c.severity}</span>
                <span className={'chip ' + (c.status === 'open' ? 'rust' : 'flat')} style={{ marginLeft: 6, fontSize: 9 }}>{(c.status || '').toUpperCase()}</span>
              </div>
              <div className="mono muted" style={{ fontSize: 10.5, marginTop: 2 }}>
                {c.court_date ? ('📅 Court: ' + new Date(c.court_date).toLocaleString()) : '📅 Court date not yet set'}
                {c.judge_name ? ' · Judge ' + c.judge_name : ''}
                {c.verdict ? ' · ' + c.verdict : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  ) : null;

  /* 🧰 YOUR DESK — the door for the two hireable positions.
     ─────────────────────────────────────────────────────────────────────────
     This project's most-repeated defect is a finished feature with no way in.
     The sidebar's "My Companies" list is built from ops the viewer OWNS, so a
     hired Weapon Smith or Warehouse Worker would never see an entry for the
     surface they were hired to work — they would hold a title and nothing
     else. This panel is the door, and it sits beside the Agency Desk and the
     Legal Docket because those two solved exactly the same problem for the
     Real Estate Agent and the Lawyer.

     ⚠ NOTHING HERE IS INVENTED. Every line is a fact econ.desks got from the
       server or from the module registry — is the bench module loaded, did
       ws_state answer, does the founder actually have a yard. `null` means the
       probe has not answered YET and prints as "checking…", never as a
       failure: this app must work offline, and telling a keeper their
       migration is missing because their connection was slow is a lie. */
  const desks = (econ && econ.desks) || null;
  // Defaulted rather than null-checked at every use: an older host that has not
  // been reloaded still pushes an econ with no `desks`, and this panel must
  // simply not render in that case instead of taking the screen down with it.
  const smithDesk = (desks && desks.smith) || { staff: false, licensed: false, loaded: false, sql: null, sqlLabel: '' };
  const yardDesk = (desks && desks.warehouse) || { staff: false, owns: false, loaded: false, sql: null, sqlLabel: '', yardId: null, corpSql: null, corpSqlLabel: '' };
  const deskLine = (v, okMsg, missingMsg) => v === true ? okMsg : (v === false ? missingMsg : 'Checking with the server…');
  const deskPanel = (corp && (smithDesk.staff || yardDesk.staff)) ? (
    <div className="card flat" style={{ padding: 12, marginBottom: 14 }}>
      <div className="mono" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--aza)', marginBottom: 6 }}>
        🧰 Your desk — {String(corp.role || 'member')}
      </div>
      {smithDesk.staff && (
        <div style={{ padding: '8px 10px', border: '1px solid var(--line-soft)', borderRadius: 4, marginBottom: yardDesk.staff ? 8 : 0 }}>
          <div style={{ fontWeight: 600, fontSize: 12.5 }}>🔧 The Weapon Smith’s bench</div>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
            Strip donors, clean parts and build. Every finished weapon can be delivered
            from your armoury into {corp.name}’s vault — it leaves your hands and appears
            there under your name.
          </div>
          <div className="mono muted" style={{ fontSize: 10.5, marginTop: 4 }}>
            {smithDesk.loaded
              ? deskLine(smithDesk.sql,
                  'Bench ready · order board and minting online.',
                  'Bench ready · the order board and minting need ' + (smithDesk.sqlLabel || 'the weaponsmith migration') + ' applied. Building and delivering still work.')
              : 'The bench module has not loaded — reload the page.'}
            {smithDesk.licensed ? ' · you also hold the licence yourself.' : ''}
          </div>
          <button className="btn sm primary" style={{ marginTop: 6 }}
            disabled={!smithDesk.loaded}
            onClick={() => act({ kind: 'openWeaponSmith' })}>🔧 Open the bench</button>
        </div>
      )}
      {yardDesk.staff && (
        <div style={{ padding: '8px 10px', border: '1px solid var(--line-soft)', borderRadius: 4 }}>
          <div style={{ fontWeight: 600, fontSize: 12.5 }}>📦 The corporation’s yard</div>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
            Walk {corp.name}’s warehouse floor — vans arrive with other players’ shipments,
            and a crate at a time goes into the renter’s bay. The office below is your own:
            it is where capacity is rented in and out.
          </div>
          <div className="mono muted" style={{ fontSize: 10.5, marginTop: 4 }}>
            {yardDesk.sql === false
              ? 'Player storage is not installed on this server — ' + (yardDesk.sqlLabel || 'the warehouse migration') + ' is pending.'
              : (yardDesk.corpSql === false
                  ? 'The corporation yard lookup needs ' + (yardDesk.corpSqlLabel || 'sql/047_corp_desk_roles.sql') + ' applied. Your own office still works.'
                  : (yardDesk.corpSql === true
                      ? (yardDesk.yardId
                          ? 'Yard found — you keep it for the founder.'
                          : 'The founder has not built a warehouse yet, so there is no yard to walk.')
                      : 'Checking with the server…'))}
            {yardDesk.owns ? ' · you own a Warehouse of your own too.' : ''}
          </div>
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <button className="btn sm primary"
              disabled={yardDesk.sql === false || yardDesk.corpSql === false || (yardDesk.corpSql === true && !yardDesk.yardId)}
              onClick={() => act({ kind: 'openCorpYard' })}>📦 Walk the yard</button>
            <button className="btn sm" onClick={() => act({ kind: 'openWarehouse' })}>🏬 Your warehouse office</button>
          </div>
        </div>
      )}
    </div>
  ) : null;
  const rolesPanel = (
    <div style={{ marginTop: 4 }}>
      <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 8 }}>Roles you can hire / apply for</div>
      <div className="col" style={{ gap: 6 }}>
        {CORP_ROLES.map(r => (
          <div key={r.id} className="card flat" style={{ padding: '9px 12px' }}>
            <div style={{ fontWeight: 600, color: 'var(--aza)' }}>{r.name}</div>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{r.d}</div>
          </div>
        ))}
      </div>
    </div>
  );

  const dirPanel = (
    <div>
      <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 8 }}>
        Corporations · {corps.length} started
      </div>
      {corps.length === 0 ? (
        <div className="muted" style={{ fontSize: 12.5, padding: 12 }}>No corporations have been founded yet. Be the first.</div>
      ) : (
        <div style={{ maxHeight: '46vh', overflow: 'auto' }}>
          {corps.map(c => (
            <div key={c.id} className="card flat" style={{ padding: '9px 12px', marginBottom: 6, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{c.name} <span className="mono muted" style={{ fontSize: 11 }}>[{c.tag}]</span>{c.mine && <span className="chip flat" style={{ marginLeft: 6 }}>YOURS</span>}</div>
                <div className="mono muted" style={{ fontSize: 10.5 }}>{(c.faction || '—')} · {(c.element || '—')} · {c.members} member{c.members === 1 ? '' : 's'}</div>
              </div>
              {!corp && !c.mine && <button className="btn sm" onClick={() => setTag(c.tag)}>Apply ▸</button>}
            </div>
          ))}
        </div>
      )}
      <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>Joining a corporation will run through <b>City Hall</b> (coming soon).</div>
    </div>
  );

  return (
    <>
    <Modal title="Corporation — Guild & Hiring" onClose={onClose} wide
      footer={<button className="btn ghost" onClick={onClose}>Close</button>}>
      {!econ || !econ.signedIn ? (
        <div className="muted" style={{ padding: 24, textAlign: 'center' }}>Sign in inside the game to use corporations.</div>
      ) : !corp ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>You’re independent</div>
            <div className="muted" style={{ fontSize: 12.5, marginBottom: 14 }}>Apply to an existing corporation by its tag, or found your own.</div>
            <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 6 }}>Corporation tag</div>
            <input className="input" placeholder="e.g. BLAC" value={tag} maxLength={8} onChange={e => setTag(e.target.value.toUpperCase())} />
            <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', margin: '14px 0 6px' }}>Apply as</div>
            <select className="select" value={role} onChange={e => setRole(e.target.value)}>
              {CORP_ROLES.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <div className="row" style={{ gap: 8, marginTop: 16 }}>
              <button className="btn primary" disabled={!tag.trim()} onClick={() => { act({ kind: 'corpRequest', tag: tag.trim(), role }); onClose(); }}>Send application</button>
              <button className="btn ghost" onClick={onFound}>Found your own →</button>
            </div>
            <div style={{ marginTop: 18 }}>{rolesPanel}</div>
          </div>
          {dirPanel}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <div>
            <div className="card flat" style={{ padding: 14, marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{corp.name} <span className="mono muted" style={{ fontSize: 12 }}>[{corp.tag}]</span></div>
              <SumRow label="Your role" value={String(corp.role || 'member')} />
              <SumRow label="Members" value={count + ' / ' + cap} />
              {amOwner && <SumRow label="Over-cap hire" value={fee + ' Aza coin each'} />}
              <CorpSwitcher econ={econ} act={act} />
            </div>
            <ContributePanel econ={econ} act={act} />
            <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 6 }}>Roster</div>
            {/* 💸 TRANSFER INBOX — incoming payments to claim, outgoing ones you
                can still cancel. A payment sits here until the recipient accepts
                it, which is why corp_send_asset writes status 'sent' rather than
                moving the asset outright. Hidden entirely when there is nothing
                pending, so it costs the roster no space in the normal case. */}
            {(() => {
              const tf = (econ && Array.isArray(econ.transfers)) ? econ.transfers : [];
              const inc = tf.filter(t => t.incoming), out = tf.filter(t => t.outgoing);
              if (!inc.length && !out.length) return null;
              return (
                <div className="card flat" style={{ padding: 10, marginBottom: 12 }}>
                  <div className="mono" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--aza)', marginBottom: 6 }}>
                    💸 Transfers
                  </div>
                  <div className="col" style={{ gap: 5, maxHeight: '20vh', overflow: 'auto' }}>
                    {inc.map(t => (
                      <div key={t.id} className="row" style={{ justifyContent: 'space-between', gap: 8, padding: '6px 10px', border: '1px solid var(--line-soft)', borderRadius: 4 }}>
                        <span style={{ minWidth: 0 }}>
                          <span style={{ fontWeight: 600, fontSize: 12 }}>{t.icon} {t.qty} {t.name}</span>
                          <span className="mono muted" style={{ fontSize: 10.5 }}> · from {t.from}{t.note ? ' · ' + t.note : ''}</span>
                        </span>
                        <button className="btn sm" style={{ flexShrink: 0 }}
                          onClick={() => act({ kind: 'corpClaim', transferId: t.id })}>📥 Claim</button>
                      </div>
                    ))}
                    {out.map(t => (
                      <div key={t.id} className="row" style={{ justifyContent: 'space-between', gap: 8, padding: '6px 10px', border: '1px dashed var(--line-soft)', borderRadius: 4, opacity: .8 }}>
                        <span style={{ minWidth: 0 }}>
                          <span style={{ fontSize: 12 }}>{t.icon} {t.qty} {t.name}</span>
                          <span className="mono muted" style={{ fontSize: 10.5 }}> · to {t.to} · awaiting claim</span>
                        </span>
                        <button className="btn sm" style={{ flexShrink: 0, color: 'var(--toxic)' }}
                          onClick={() => act({ kind: 'corpCancel', transferId: t.id })}>↩ Cancel</button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
            <div className="col" style={{ gap: 4, maxHeight: '34vh', overflow: 'auto' }}>
              {roster.length === 0 && pendingHires.length === 0 && <div className="muted" style={{ fontSize: 12 }}>Just you so far.</div>}
              {roster.map(m => (
                <div key={m.userId} className="row" style={{ justifyContent: 'space-between', padding: '8px 12px', border: '1px solid var(--line-soft)', borderRadius: 4 }}>
                  <span>{m.name} <span className="mono muted" style={{ fontSize: 10.5 }}>· {m.role}</span></span>
                  {amOwner && m.role !== 'founder' && m.name !== me && (
                    <span className="row" style={{ gap: 6, flexShrink: 0 }}>
                      <select className="select" style={{ padding: '2px 6px', fontSize: 11, width: 'auto' }} value={m.role}
                        onChange={e => act({ kind: 'corpSetRole', userId: m.userId, role: e.target.value })} title="Assign position">
                        {CORP_ROLES.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                      {/* 💸 PAY THIS MEMBER. The whole reason the owner opens this
                          screen after a job is done. The server side has always
                          existed (corp_send_asset); nothing in this app ever
                          called it, which is why paying "did not work".
                          Two-step by design: this creates a PENDING transfer the
                          member claims from their inbox, so nothing lands in an
                          account without the game acknowledging it and the sender
                          can still cancel. */}
                      {/* 🪟 A MODAL, NOT window.prompt(). The browser dialog is chrome
                          from outside the game — it ignores the art direction, cannot
                          show a balance or validate as you type, and stacks TWO dialogs
                          (amount, then note) for one action. */}
                      <button className="btn sm" title={'Pay ' + m.name + ' from your Cinder'}
                        onClick={() => setPayTarget({ userId: m.userId, name: m.name })}>💸 Pay</button>
                      <button className="btn sm" onClick={() => act({ kind: 'corpKick', userId: m.userId })} style={{ color: 'var(--toxic)' }}>Remove</button>
                    </span>
                  )}
                </div>
              ))}
              {pendingHires.map(m => (
                <div key={'ph-' + m.userId} className="row" title="Hired. Their membership is created the first time they sync."
                     style={{ justifyContent: 'space-between', padding: '8px 12px', border: '1px dashed var(--line-soft)', borderRadius: 4, opacity: .72 }}>
                  <span>{m.name} <span className="mono muted" style={{ fontSize: 10.5 }}>· {m.role}</span></span>
                  <span className="mono muted" style={{ fontSize: 10, letterSpacing: '.1em' }}>JOINING…</span>
                </div>
              ))}
            </div>
            {!amOwner && (
              <button className="btn ghost" style={{ marginTop: 14 }} onClick={() => { act({ kind: 'corpLeave' }); onClose(); }}>Leave corporation</button>
            )}
            {amOwner && (
              <div style={{ marginTop: 16 }}>
                {/* 🏢 SHUT DOWN (bug-mtw1eyki): the founder's door out. Typed-name
                    confirm; the server refuses while the treasury or vault hold anything. */}
                <button className="btn ghost" style={{ marginBottom: 14, borderColor: 'var(--toxic-soft)', color: 'var(--toxic)' }}
                  title="Close this corporation for good. Members are released, licences and operations go with it. The treasury and vault must be empty first."
                  onClick={() => {
                    const nm = String((econ && econ.corp && econ.corp.name) || '').trim();
                    const t = window.prompt('Shut down ' + (nm || 'your corporation') + '?\n\nThis cannot be undone. Members are released, licences and operations go with it, and the treasury and vault must already be empty.\n\nType the corporation name to confirm:');
                    if (t == null) return;
                    if (nm && t.trim().toLowerCase() !== nm.toLowerCase()) { window.alert('The name did not match — nothing was done.'); return; }
                    act({ kind: 'corpDissolve' }); onClose();
                  }}>🏢 Shut down corporation</button>
                <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 6 }}>
                  Applications {requests.length ? '· ' + requests.length : ''}
                </div>
                {requests.length === 0 ? (
                  <div className="muted" style={{ fontSize: 12 }}>No pending applications.</div>
                ) : requests.map(rq => (
                  <div key={rq.id} className="row" style={{ justifyContent: 'space-between', padding: '8px 12px', border: '1px solid var(--rust)', borderRadius: 4, marginBottom: 6 }}>
                    <span>{rq.name} <span className="mono muted" style={{ fontSize: 10.5 }}>→ {rq.role}</span></span>
                    <span className="row" style={{ gap: 6 }}>
                      <button className="btn sm primary" onClick={() => act({ kind: 'corpApprove', requestId: rq.id })}>Hire</button>
                      <button className="btn sm" onClick={() => act({ kind: 'corpDeny', requestId: rq.id })}>Deny</button>
                    </span>
                  </div>
                ))}
                {count >= cap && <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Roster full — each new hire costs you {fee} Aza coin.</div>}
              </div>
            )}
          </div>
          <div>
            {deskPanel}
            {agencyPanel}
            {lawyerPanel}
            {rolesPanel}
          </div>
        </div>
      )}
    </Modal>

    {payTarget && <PayMemberModal member={payTarget} econ={econ}
      onClose={() => setPayTarget(null)}
      onPay={(qty, note) => { act({ kind: 'corpSend', toId: payTarget.userId, toName: payTarget.name,
        assetKind: 'resource', itemId: 'cinder', name: 'Cinder', icon: '🔥', qty: qty, note: note,
        /* 💸 Which purse. The parent re-checks this against the server, which
           refuses an officer it does not recognise — this flag chooses the RPC,
           it does not grant the right. */
        fromTreasury: !!(econ && econ.amOwner && econ.corp) });
        setPayTarget(null); }} />}
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Corporation Vault — shared store. ANY corp member can deposit their real
// cards / items / resources; depositing removes them from that player's
// collection (deck-locked card copies are protected so a 40-card deck always
// survives). Everything deposited shows here for the whole corp.
// ──────────────────────────────────────────────────────────────────────────
function CorpVaultModal({ econ, toast, onClose }) {
  const [kindTab, setKindTab] = useState('card');
  const [qty, setQty] = useState({});
  const corp = econ && econ.corp;
  const vault = (econ && Array.isArray(econ.vault)) ? econ.vault : [];
  const dep = (econ && econ.depositable) || { cards: [], items: [], resources: [] };
  const act = (p) => { try { window.JB_action && window.JB_action(p); } catch (e) {} };
  const KMETA = { card: 'Cards', item: 'Items / Relics', resource: 'Resources' };
  const list = kindTab === 'card' ? (dep.cards || []) : kindTab === 'item' ? (dep.items || []) : (dep.resources || []);

  const vaultByKind = {};
  vault.forEach(v => { (vaultByKind[v.kind] = vaultByKind[v.kind] || []).push(v); });

  return (
    <Modal title="Corporation Vault" onClose={onClose} wide
      footer={<button className="btn ghost" onClick={onClose}>Close</button>}>
      {!econ || !econ.signedIn ? (
        <div className="muted" style={{ padding: 24, textAlign: 'center' }}>Sign in inside the game to use the shared vault.</div>
      ) : !corp ? (
        <div className="muted" style={{ padding: 24, textAlign: 'center' }}>Join or found a corporation to use a shared vault. Use <b>Guild &amp; Hiring</b> from the Corp screen.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <div>
            <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 8 }}>
              {corp.name} vault · {vault.length} stacks
            </div>
            {vault.length === 0 ? (
              <div className="muted" style={{ fontSize: 12.5, padding: 16 }}>Empty. Anyone in the corporation can deposit — start filling it.</div>
            ) : (
              <div style={{ maxHeight: '56vh', overflow: 'auto' }}>
                {['card', 'item', 'resource'].filter(k => vaultByKind[k]).map(k => (
                  <div key={k} style={{ marginBottom: 12 }}>
                    <div className="mono muted" style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 4 }}>{KMETA[k]}</div>
                    {vaultByKind[k].map((v, i) => (
                      <div key={k + i} className="row" style={{ justifyContent: 'space-between', padding: '7px 11px', border: '1px solid var(--line-soft)', borderRadius: 4, marginBottom: 4, background: 'var(--bg-2)' }}>
                        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.icon || '📦'} {v.name} <span className="mono muted" style={{ fontSize: 10 }}>· {v.dep}</span></span>
                        <span className="mono" style={{ color: 'var(--aza)', fontWeight: 600 }}>{fmt(v.qty)}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 8 }}>Deposit from your collection</div>
            <div className="row" style={{ gap: 6, marginBottom: 10 }}>
              {['card', 'item', 'resource'].map(k => (
                <button key={k} className={'btn sm' + (kindTab === k ? ' primary' : '')} onClick={() => setKindTab(k)}>{KMETA[k]}</button>
              ))}
            </div>
            {list.length === 0 ? (
              <div className="muted" style={{ fontSize: 12.5, padding: 14 }}>
                {kindTab === 'card' ? 'No spare cards — every copy is locked into a 40-card deck.' : 'Nothing here to deposit.'}
              </div>
            ) : (
              <div style={{ maxHeight: '52vh', overflow: 'auto' }}>
                {list.map(it => {
                  const max = kindTab === 'card' ? (it.free | 0) : (it.qty | 0);
                  const v = Math.max(1, Math.min(max, qty[it.id] || 1));
                  return (
                    <div key={it.id} className="row" style={{ justifyContent: 'space-between', gap: 8, padding: '7px 10px', border: '1px solid var(--line-soft)', borderRadius: 4, marginBottom: 4 }}>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {it.icon || '📦'} {it.name}
                        <span className="mono muted" style={{ fontSize: 10 }}> · {max}{kindTab === 'card' && it.locked ? ' (' + it.locked + ' deck-locked)' : ''}</span>
                      </span>
                      <input className="input" type="number" min={1} max={max} value={v}
                        onChange={e => setQty(q => ({ ...q, [it.id]: Math.max(1, Math.min(max, Number(e.target.value) || 1)) }))}
                        style={{ width: 64, padding: '4px 6px' }} />
                      <button className="btn sm primary" onClick={() => { act({ kind: 'vaultDeposit', itemKind: kindTab, itemId: it.id, qty: v }); onClose(); }}>Deposit</button>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="muted" style={{ fontSize: 11, marginTop: 10 }}>Deposited assets leave your collection and become corporation property. Deck-committed cards are protected (40-card decks stay intact).</div>
          </div>
        </div>
      )}
    </Modal>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
