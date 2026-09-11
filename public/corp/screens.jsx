/* screens.jsx — Vault, Corp Treasury, Logistics, Marketplace, Black Market,
   Feed, Mailbox, Trade window, Relic detail. */

// ============================================================================
// ASSET KIND TABS — the Marketplace / Black Market filter row.
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

// ============================================================================
// VAULT — the CORPORATION vault (public.corp_vault), two-way
// ============================================================================
/* 🔴 WHAT THIS SCREEN USED TO BE. It read window.ECON.ASSETS, which data.js
   declares as a permanently EMPTY array ("Just Business has NO mock economy
   data"). So the Vault was a headerless table with an Est. Net Worth of 0, a
   HOLDER tag that rendered the empty PLAYER.id as "HOLDER  ", and a "Send asset"
   button wired to nothing. It now renders econ.vault — the real corp_vault rows
   the bridge has been carrying all along.

   ⚠ ONE ROW PER STORED ROW, deliberately NOT aggregated by item. corp_vault is
   keyed (corp_id, depositor_id, kind, item_id), and "show the player who put it
   in the vault" is the actual request; folding two depositors of the same item
   into one line would make the screen impossible to diff against
   select depositor_name,kind,item_id,name,qty from corp_vault where corp_id=…

   ⚠ WITHDRAWAL IS POOLED even though the display is per-deposit: the RPC drains
   oldest-deposit-first across every depositor, because a member should be able
   to take what the CORPORATION holds rather than beg row by row. The withdraw
   dialog therefore shows the pooled figure and says where it comes from — the
   one number on this screen that is not a single row, and it is labelled.

   Every qty passes through Number(x) || 0 exactly once, on the way in. A null or
   an empty string out of postgres (qty is numeric, so PostgREST may hand back a
   string) can then never reach a total as NaN. */

const VAULT_KINDS = ['card', 'item', 'resource'];
const VAULT_KIND_LABEL = { card: 'Cards', item: 'Items / Relics', resource: 'Resources' };
const VAULT_TABS = [{ id: 'all', label: 'All' }].concat(VAULT_KINDS.map(k => ({ id: k, label: VAULT_KIND_LABEL[k] })));
// Pool key. The separator cannot occur in a kind or an item id, so ('card','abc')
// and ('carda','bc') can never collide into one pool.
const vaultPoolKey = (kind, id) => kind + '::' + id;
/* 🔢 COUNTS, NOT PRICES. The shared fmt() renders 0 as "0.00" (it is built for
   money), so an empty vault read "0.00 units in 0.00 stacks". Everything on this
   screen is a count of things: whole numbers print whole, and a fractional qty —
   possible in principle, corp_vault.qty is `numeric` — still prints rather than
   being rounded away silently. */
const vaultNum = (n) => {
  const v = Number(n);
  if (!isFinite(v)) return '0';
  return Number.isInteger(v) ? v.toLocaleString('en-US')
                             : v.toLocaleString('en-US', { maximumFractionDigits: 2 });
};

function VaultNotice({ title, body }) {
  return (
    <div className="card" style={{ padding: 28, textAlign: 'center' }}>
      <div className="disp" style={{ fontSize: 17, marginBottom: 8 }}>{title}</div>
      <div className="muted" style={{ fontSize: 12.5, maxWidth: 560, margin: '0 auto', lineHeight: 1.55 }}>{body}</div>
    </div>
  );
}

// The stack tile: real card art when the game could resolve it, the stored icon
// otherwise. No invented placeholder art — an emoji that is honestly an emoji
// beats a generic card back pretending to be this card.
function VaultArt({ row }) {
  if (row.art) {
    return (
      <div style={{ width: 40, height: 56, borderRadius: 4, overflow: 'hidden', border: '1px solid var(--line-soft)', background: 'var(--bg-2)' }}>
        <img src={row.art} alt="" loading="lazy"
             style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
             onError={e => { e.target.style.display = 'none'; }} />
      </div>
    );
  }
  return (
    <div style={{ width: 40, height: 56, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: '1px solid var(--line-soft)', background: 'var(--bg-2)', fontSize: 20 }}>
      {row.icon || (row.kind === 'card' ? '🃏' : row.kind === 'resource' ? '📦' : '🎒')}
    </div>
  );
}

// One modal, two verbs. The amount picker, the pool figure and the
// oldest-deposits-first rule are identical for a withdrawal and a drop — only
// the destination differs — so `drop` re-skins this rather than forking it.
// Everything that differs is spelled out to the player rather than left to the
// title, because one of the two verbs cannot be undone.
function VaultWithdrawModal({ row, pool, onClose, onConfirm, mode }) {
  const drop = mode === 'drop';
  const max = Math.max(0, Math.floor(Number(pool) || 0));
  const [raw, setRaw] = useState(1);
  const n = Math.max(1, Math.min(max || 1, Math.floor(Number(raw) || 1)));
  return (
    <Modal title={(drop ? '🗑 Drop ' : 'Withdraw ') + row.name} onClose={onClose}
      footer={
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className={drop ? 'btn' : 'btn primary'} disabled={max <= 0}
                  style={drop ? { color: '#ff6b8a', borderColor: '#ff6b8a' } : undefined}
                  onClick={() => { onConfirm(n); onClose(); }}>
            {drop ? 'Drop ' : 'Withdraw '}{vaultNum(n)}
          </button>
        </div>
      }>
      <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
        <VaultArt row={row} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{row.name}</div>
          <div className="mono muted" style={{ fontSize: 10.5 }}>{row.id} · {row.kind}</div>
        </div>
      </div>
      <div style={{ marginTop: 14 }}>
        <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 6 }}>
          Amount · the corporation holds {vaultNum(max)}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input className="input" type="number" min={1} max={max} value={raw}
                 onChange={e => setRaw(e.target.value)} style={{ width: 120 }} />
          <button className="btn sm" onClick={() => setRaw(max)}>All {vaultNum(max)}</button>
        </div>
      </div>
      {drop ? (
        <div style={{ fontSize: 11.5, marginTop: 14, lineHeight: 1.55, color: '#ff9a5a' }}>
          <b>This destroys it.</b> It does not go to your collection, and nobody in
          the corporation can get it back. The vault is stored per depositor, so the
          amount is taken from the whole corporation pool for this item, oldest
          deposits first — not only from the stack you clicked — and it is written to
          the corporation ledger with your name on it.
          <div className="muted" style={{ marginTop: 6 }}>Use Withdraw instead if you want to keep it.</div>
        </div>
      ) : (
      <div className="muted" style={{ fontSize: 11.5, marginTop: 14, lineHeight: 1.55 }}>
        The vault is stored per depositor, so a withdrawal is filled from the whole
        corporation pool for this item, oldest deposits first — not only from the
        stack you clicked. It arrives in your own collection and is written to the
        corporation ledger with your name on it.
      </div>
      )}
    </Modal>
  );
}

function VaultScreen() {
  // The bridge is the ONLY source this screen reads, so it re-renders on the
  // same event the rest of the app does. Without this a deposit or a withdrawal
  // updates the game and leaves this table showing the pre-action numbers.
  const [, bump] = useState(0);
  useEffect(() => {
    const h = () => bump(n => n + 1);
    window.addEventListener('jbdata', h);
    return () => window.removeEventListener('jbdata', h);
  }, []);

  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('qty');
  const [wd, setWd] = useState(null);
  // Which verb the shared withdraw modal is open for. Held apart from `wd` so
  // the row it points at stays a plain vault row for VaultArt and the rest.
  const [wdMode, setWdMode] = useState('withdraw');

  const econ = (window.__JB && window.__JB.econ) || null;
  const corp = (econ && econ.corp) || null;
  const rpcState = (econ && econ.vaultRpc) || 'unknown';
  // 'unknown' still allows the attempt — the RPC itself reports the truth, and
  // disabling a working feature because one probe timed out is the worse error.
  const canWithdraw = rpcState !== 'missing';

  const rows = useMemo(() => {
    const src = (econ && Array.isArray(econ.vault)) ? econ.vault : [];
    return src.map((v, i) => ({
      key: (v && v.rowId) || ((v && v.depId) + ':' + (v && v.kind) + ':' + (v && v.id) + ':' + i),
      dep: (v && v.dep) || 'Member',
      kind: (v && VAULT_KINDS.indexOf(v.kind) >= 0) ? v.kind : 'item',
      id: (v && v.id) || '',
      name: (v && v.name) || (v && v.id) || 'Unknown',
      icon: (v && v.icon) || '',
      art: (v && v.art) || '',
      qty: Math.max(0, Number(v && v.qty) || 0),
    })).filter(v => v.id && v.qty > 0);
  }, [econ]);

  // Pooled quantity per (kind, item) — what a withdrawal can actually draw.
  const pool = useMemo(() => {
    const p = {};
    rows.forEach(v => { const k = vaultPoolKey(v.kind, v.id); p[k] = (p[k] || 0) + v.qty; });
    return p;
  }, [rows]);

  const counts = useMemo(() => {
    const c = { all: rows.length };
    VAULT_KINDS.forEach(k => { c[k] = 0; });
    rows.forEach(v => { c[v.kind] = (c[v.kind] || 0) + 1; });
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let xs = rows.filter(v =>
      (tab === 'all' || v.kind === tab) &&
      (needle === '' || (v.name + ' ' + v.id + ' ' + v.dep).toLowerCase().includes(needle))
    );
    if (sort === 'qty')  xs = [...xs].sort((a, b) => b.qty - a.qty);
    if (sort === 'name') xs = [...xs].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'dep')  xs = [...xs].sort((a, b) => a.dep.localeCompare(b.dep) || b.qty - a.qty);
    return xs;
  }, [rows, tab, q, sort]);

  const totalStacks = rows.length;
  const totalUnits  = rows.reduce((s, v) => s + v.qty, 0);
  const viewUnits   = filtered.reduce((s, v) => s + v.qty, 0);

  const act = (p) => { try { window.JB_action && window.JB_action(p); } catch (e) {} };
  const openDeposit = () => { try { window.dispatchEvent(new CustomEvent('jb:open', { detail: 'vault' })); } catch (e) {} };

  /* The states where there is no vault to show. Each one says WHICH it is:
     "not connected", "not signed in", "no corporation", "could not read" and
     "empty" are five different facts, and this screen has shipped all of them
     as the same blank table. */
  let blocked = null;
  if (!econ) {
    blocked = <VaultNotice title="Not connected to the game"
      body="This screen shows your corporation's real shared vault. Open Just Business from inside Mythic Spellbook — standalone there is no account, no corporation and nothing to show." />;
  } else if (!econ.signedIn) {
    blocked = <VaultNotice title="Sign in to see the vault"
      body="The corporation vault lives in your cloud account. Sign in inside the game and this fills in." />;
  } else if (!corp) {
    blocked = <VaultNotice title="You are not in a corporation"
      body="A vault belongs to a corporation, not to a player. Found one or join one from Guild & Hiring on the Corp screen, and everything the members deposit shows up here." />;
  } else if (econ.vaultUnknown && totalStacks === 0) {
    blocked = <VaultNotice title="Could not read the vault"
      body="The last read of corp_vault failed, so this is NOT an empty vault and nothing has been lost. It retries on the next update." />;
  }

  return (
    <div className="screen">
      <ScreenHead
        title="Corporation Vault"
        desc="The shared store of your corporation. Anyone in the corporation can put assets in and anyone can take them out; every stack shows who deposited it, and every movement is written to the corporation ledger."
        idTag={corp ? (corp.name + (corp.tag ? ' · ' + corp.tag : '') + ' · ' + ((econ && econ.handle) || 'Member')) : ((econ && econ.handle) || 'Not signed in')}
        right={
          <div style={{ textAlign: 'right' }}>
            <div className="mono muted" style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase' }}>Vault holdings</div>
            <div className="disp" style={{ fontSize: 26, color: 'var(--aza)' }}>
              {vaultNum(totalUnits)} <span style={{ fontSize: 12, color: 'var(--muted)' }}>units in {vaultNum(totalStacks)} stacks</span>
            </div>
          </div>
        }
      />

      {blocked || (
        <React.Fragment>
          <div className="tabs">
            {VAULT_TABS.map(t => (
              <button key={t.id} data-active={tab === t.id ? '1' : '0'} onClick={() => setTab(t.id)}>
                {t.label}<span className="count">{counts[t.id] || 0}</span>
              </button>
            ))}
          </div>

          <div className="toolbar">
            <input className="input search" placeholder="Search name, id or depositor…" value={q} onChange={e => setQ(e.target.value)} />
            <select className="select" value={sort} onChange={e => setSort(e.target.value)}>
              <option value="qty">Sort: Quantity</option>
              <option value="name">Sort: Name</option>
              <option value="dep">Sort: Depositor</option>
            </select>
            <div className="spacer" />
            <button className="btn primary" onClick={openDeposit}>Deposit to vault</button>
          </div>

          {econ.vaultUnknown && (
            <div className="card" style={{ padding: '10px 14px', marginBottom: 10, borderColor: 'var(--rust)' }}>
              <span className="chip rust">STALE</span>{' '}
              <span className="muted" style={{ fontSize: 12 }}>The last read of corp_vault failed — this is the list from before it failed, not a fresh one.</span>
            </div>
          )}

          {!canWithdraw && (
            <div className="card" style={{ padding: '10px 14px', marginBottom: 10, borderColor: 'var(--rust)' }}>
              <span className="chip rust">WITHDRAW OFF</span>{' '}
              <span className="muted" style={{ fontSize: 12 }}>
                Taking assets out needs the server function. Apply <b className="mono">sql/045_corp_vault_rpcs.sql</b> in
                the Supabase SQL editor. Depositing still works, and every row below is real.
              </span>
            </div>
          )}

          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid var(--line-soft)' }}>
              <span className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.1em', textTransform: 'uppercase' }}>
                Showing {vaultNum(filtered.length)} of {vaultNum(totalStacks)} stacks
              </span>
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--aza)' }}>{vaultNum(viewUnits)} units in view</span>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 60 }}></th>
                  <th>Asset</th>
                  <th>Kind</th>
                  <th>Deposited by</th>
                  <th className="num">Qty</th>
                  <th className="num" style={{ width: 130 }}>Corp pool</th>
                  <th style={{ width: 130 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(v => {
                  const held = pool[vaultPoolKey(v.kind, v.id)] || 0;
                  return (
                    <tr key={v.key}>
                      <td><VaultArt row={v} /></td>
                      <td>
                        <div style={{ fontWeight: 500 }}>{v.name}</div>
                        <div className="mono muted" style={{ fontSize: 10.5 }}>{v.id}</div>
                      </td>
                      <td className="mono muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>{v.kind}</td>
                      <td>{v.dep}</td>
                      <td className="num mono" style={{ color: 'var(--aza)', fontWeight: 600 }}>{vaultNum(v.qty)}</td>
                      <td className="num mono muted">{held === v.qty ? '—' : vaultNum(held)}</td>
                      <td>
                        <div className="row" style={{ justifyContent: 'flex-end' }}>
                          <button className="btn sm primary" disabled={!canWithdraw}
                                  title={canWithdraw ? 'Take this out of the corporation vault' : 'Apply sql/045_corp_vault_rpcs.sql to enable withdrawals'}
                                  onClick={() => { setWdMode('withdraw'); setWd(v); }}>Withdraw</button>
                          {/* 🗑 Gated on the SAME permission as withdrawing, because it
                              draws on the same pool — a member who may not take
                              corporation property out must not be able to destroy it
                              instead. Placed after Withdraw and in red so it is never
                              the button a thumb lands on by accident. */}
                          <button className="btn sm" disabled={!canWithdraw}
                                  style={{ color: '#ff6b8a', borderColor: '#ff6b8a', marginLeft: 6 }}
                                  title={canWithdraw ? 'Destroy this to free vault room — nothing is returned' : 'Apply sql/045_corp_vault_rpcs.sql to enable this'}
                                  onClick={() => { setWdMode('drop'); setWd(v); }}>Drop</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="muted" style={{ padding: 22, textAlign: 'center', fontSize: 12.5 }}>
                {totalStacks === 0
                  ? 'The vault is empty. Anyone in the corporation can deposit cards, items or resources — use Deposit to vault.'
                  : 'No stack matches this filter.'}
              </div>
            )}
          </div>
        </React.Fragment>
      )}

      {wd && (
        <VaultWithdrawModal row={wd} pool={pool[vaultPoolKey(wd.kind, wd.id)] || 0} mode={wdMode}
          onClose={() => setWd(null)}
          onConfirm={(n) => act({ kind: wdMode === 'drop' ? 'vaultDrop' : 'vaultWithdraw',
                                  itemKind: wd.kind, itemId: wd.id, qty: n })} />
      )}
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

/* 📄 REFINERY CONTRACTS YOU HAVE ACCEPTED.
   ═══════════════════════════════════════════════════════════════════════════
   The Cracking Yard's contract board is where work is TAKEN ON. This is where
   a player checks what they already owe: what it pays in Cinder, how much fuel
   is still outstanding, what the fuel has to test at, and how long is left
   before the penalty lands.

   🔴 READ-ONLY. There is deliberately no Accept or Abandon here. Both live in
      the yard behind its own confirmation, and a second route into the
      contract ledger would be a second place for it to go wrong. This panel
      answers a question; it does not take an action.
   ⚠ The countdown is recomputed on the parent's 30s tick (see the note in
     LogisticsScreen) rather than stored, so it cannot sit still and then jump.
   ⚠ Absent list and empty list are DIFFERENT sentences: a player who has never
     opened the yard is told where to find it, not that they have no work. */
function RefineryContracts() {
  const econ = (window.__JB && window.__JB.econ) || null;
  const rows = (econ && Array.isArray(econ.refineryContracts)) ? econ.refineryContracts : null;

  if (!rows) return null;                 // refinery module not loaded at all

  const left = (ms) => {
    if (!ms || ms <= 0) return 'overdue';
    const m = Math.round(ms / 60000);
    if (m < 60) return m + 'm left';
    return Math.floor(m / 60) + 'h ' + (m % 60) + 'm left';
  };
  const totalPay = rows.reduce((s, c) => s + (c.value | 0), 0);
  const atRisk = rows.reduce((s, c) => s + (c.penalty | 0), 0);

  return (
    <div className="card">
      <div className="row-head">
        <h3>🛢 Refinery contracts</h3>
        <span className="muted mono" style={{ fontSize: 11 }}>
          {rows.length ? (rows.length + ' accepted · ' + fmt(totalPay) + ' 🔥 on completion · ' + fmt(atRisk) + ' 🔥 at risk') : 'none accepted'}
        </span>
      </div>

      {!rows.length ? (
        <div className="muted" style={{ padding: '14px 12px', fontSize: 12 }}>
          No contracts accepted. Take work from the board in the Cracking Yard&apos;s
          office terminal — Black River Petroleum → Refinery Complex, or the
          Oil Production Chain panel at your fuel station.
        </div>
      ) : (
        <div style={{ padding: '4px 0 2px' }}>
          {rows.map((c) => (
            <div key={c.id} style={{ padding: '10px 12px', borderTop: '1px solid var(--line, #23262c)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14 }}>{c.fleetIco}</span>
                <b>{c.gradeName}</b>
                <span className="mono" style={{ fontSize: 11 }}>{fmt(c.litres)} L</span>
                {c.rush ? <span className="mono" style={{ fontSize: 10, color: '#ff8b6a' }}>RUSH</span> : null}
                {c.own ? <span className="mono" style={{ fontSize: 10, color: '#7bc043' }}>YOUR STATION</span> : null}
                <span style={{ flex: 1 }} />
                <b style={{ color: '#e8a13a' }}>{fmt(c.value)} 🔥</b>
              </div>
              <div className="muted mono" style={{ fontSize: 11, marginTop: 3 }}>
                {c.station}{c.place ? ' · ' + c.place : ''}{c.km ? ' · ' + c.km + ' km' : ''}{c.fleet ? ' · ' + c.fleet : ''}
              </div>
              {/* What they have to DO to be paid. */}
              {c.spec && c.spec.octaneMin != null ? (
                <div className="muted mono" style={{ fontSize: 11, marginTop: 3 }}>
                  Deliver {fmt(c.remaining)} L more — must test Octane ≥ {c.spec.octaneMin} ·
                  Sulfur ≤ {c.spec.sulfurMax} ppm · Purity ≥ {c.spec.purityMin}%
                  {c.spec.rvpMax != null ? ' · Stability ≤ ' + c.spec.rvpMax + ' psi' : ''}
                </div>
              ) : (
                <div className="muted mono" style={{ fontSize: 11, marginTop: 3 }}>Deliver {fmt(c.remaining)} L more.</div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 120px', height: 5, background: 'rgba(255,255,255,.08)', borderRadius: 3, overflow: 'hidden', minWidth: 90 }}>
                  <i style={{ display: 'block', height: '100%', width: c.pct + '%', background: c.pct >= 100 ? '#7bc043' : '#e8a13a' }} />
                </div>
                <span className="mono" style={{ fontSize: 11 }}>{c.pct}%</span>
                <span className="mono" style={{ fontSize: 11, color: c.overdue ? '#ff6b7a' : (c.msLeft < 6 * 60000 ? '#ffc46b' : 'inherit') }}>
                  {left(c.msLeft)}
                </span>
                <span className="mono muted" style={{ fontSize: 11 }}>miss it: −{fmt(c.penalty)} 🔥</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LogisticsScreen() {
  // 📡 Re-render when the parent pushes fresh economy data. The guild-freight
  // read is asynchronous (two Supabase sources), so without this subscription
  // the screen would render once — before the first fetch landed — and sit on
  // "loading" for the rest of the session. Same pattern FeedScreen uses.
  const [, setTick] = useState(0);
  useEffect(() => {
    const h = () => setTick(t => t + 1);
    window.addEventListener('jbdata', h);
    return () => window.removeEventListener('jbdata', h);
  }, []);

  /* ⏱ EVERY RELATIVE LABEL ON THIS SCREEN IS COMPUTED AT RENDER TIME.
     whenLabel() and the convoy ETA both read Date.now(), and nothing else
     re-renders this component: the jbdata subscription above only fires when
     the PARENT refetches. So a player who opened Logistics and left it open
     watched a countdown stand perfectly still and then jump by ten minutes —
     a stale number that looks exactly like a live one, which is the defect
     this pass exists to end. 30s is the coarsest tick that keeps a minutes
     field honest. It costs one setState: no query, no postMessage, and it
     does NOT invent freshness the data does not have — the ROWS still change
     only when the parent's freight poll lands. */
  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(iv);
  }, []);

  const econ = (window.__JB && window.__JB.econ) || null;

  // 🚚 LIVE CONVOYS. window.ECON.CONVOYS is a mock array that ships EMPTY, which
  // is why this table has always been blank standalone. The parent game derives
  // real convoys from the player's owned producing nodes and posts them on
  // __JB.econ.convoys — the same model that drives the war-map trucks.
  const _live = (econ && Array.isArray(econ.convoys)) ? econ.convoys : null;
  const CONVOYS = (_live && _live.length) ? _live : window.ECON.CONVOYS;
  const moving = CONVOYS.filter(c => c.status === 'in-transit').length;
  const arrived = CONVOYS.filter(c => c.status === 'arrived').length;

  /* 📏 THE HEADLINE USED TO BE A CURRENCY FIGURE MADE OF UNIT COUNTS.
     It summed resource QUANTITIES scraped out of each convoy's cargo string,
     then rendered the total through fmtAza() — so "1,200 food + 300 metal"
     was announced to the player as "1,500 Aza coin", a number that is not a
     price, was never a price, and disagreed with every market screen in the
     app. Worse, an empty list fell back to a hardcoded five-figure
     constant, so a player with nothing at all on the road was shown a
     balance — the exact fabricated-number defect this pass exists to end.
     It is now a UNIT COUNT, labelled as units, summed from the numeric
     qtyUnits the bridge ships alongside the display string, and it is exactly
     the sum of the Cargo column below it. Mixing resources in one unit total
     is a deliberate, stated choice: it answers "how much is on the road",
     which is the question the table is already sorted by. It does not pretend
     to be worth anything, because nothing here knows what it is worth.
     No rows → no headline. An absent number beats an invented one. */
  const cargoUnits = CONVOYS.reduce((s, c) => s + convoyUnits(c), 0);

  const ship = (econ && econ.corpShipments) || null;
  const corp = econ && econ.corp;
  const isAdmin = !!(econ && econ.isAdmin);

  return (
    <div className="screen">
      <ScreenHead
        title="Logistics"
        desc="What your camp is hauling, and what the rest of the guild has on the road — standing city trade agreements and freight inbound to warehouse bays."
        right={CONVOYS.length ? <Stat label="Convoy cargo" value={fmt(cargoUnits) + ' units'} /> : null}
      />

      <RefineryContracts />

      <div className="card">
        <div className="row-head">
          <h3>Active convoys</h3>
          <span className="muted mono" style={{ fontSize: 11 }}>{moving} moving · {arrived} arrived</span>
        </div>
        {!CONVOYS.length ? (
          <div className="muted" style={{ padding: '14px 12px', fontSize: 12 }}>
            No convoys on the road. Claim a node that produces a resource and its
            output starts hauling to camp automatically.
          </div>
        ) : null}
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 110 }}>Convoy</th>
              <th>Route</th>
              <th>Cargo</th>
              <th>Rig</th>
              <th>Escort</th>
              <th>Risk</th>
              <th style={{ width: 260 }}>Progress</th>
              <th>ETA</th>
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
                <td>
                  {c.cargo}
                  {/* What the rig added over hand-hauling. Shown on the cargo
                      itself so a purchase reads as more freight, not a badge. */}
                  {c.rigBonus ? (
                    <div className="mono" style={{ fontSize: 10, color: 'var(--toxic, #7fd8a0)' }}>{c.rigBonus} rig</div>
                  ) : null}
                </td>
                <td className="mono" style={{ fontSize: 11, color: c.rigOwned ? 'var(--text)' : 'var(--muted)' }}>
                  {c.rig ? ((c.rigIcon ? c.rigIcon + ' ' : '') + c.rig) : '—'}
                </td>
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
              </tr>
            ))}
          </tbody>
        </table>
        {/* ✂ "Dispatch new", "Track" and "Recall" used to live here as three
            controls that did nothing at all. Convoys are DERIVED — one per
            owned producing node, computed from the clock with no stored state
            (see _jbConvoys in index.html) — so there is nothing to dispatch,
            nothing to track separately and nothing to recall. A button that
            implies a capability the system does not have is the same defect as
            a fabricated row, so they are gone rather than disabled. The real
            recall that DOES exist belongs to warehouse loads and lives in the
            warehouse yard, next to the crates it would give back. */}
      </div>

      <GuildCityTrade ship={ship} econ={econ} corp={corp} isAdmin={isAdmin} />
      <GuildWarehouseFreight ship={ship} econ={econ} corp={corp} isAdmin={isAdmin} />
    </div>
  );
}

/* Units on one convoy, WITHOUT scraping prose.
   The old headline did `parseInt(String(c.cargo).replace(/[^0-9]/g, ''))`,
   which turns "1,200 food" into 1200 by luck and "12 x4 Cells" into 124 by the
   same rule. The bridge now ships the number itself as qtyUnits; the string
   parse survives only as the standalone-mock path, and it anchors to the
   LEADING number so a digit in a resource name cannot join the quantity. */
function convoyUnits(c) {
  if (c && typeof c.qtyUnits === 'number' && isFinite(c.qtyUnits)) return c.qtyUnits;
  const m = String((c && c.cargo) || '').match(/^\s*([\d,]+(?:\.\d+)?)/);
  const n = m ? Number(m[1].replace(/,/g, '')) : 0;
  return isFinite(n) ? n : 0;
}

/* "in 4h 12m" / "3h ago" / "—". Returns the em dash for anything that is not a
   finite timestamp, which is how a null due time (the cycle rule could not be
   read) reaches the screen instead of "NaN" or "Invalid Date". */
function whenLabel(ms) {
  if (!ms || !isFinite(ms)) return '—';
  const d = ms - Date.now();
  const mins = Math.round(Math.abs(d) / 60000);
  const s = mins >= 1440
    ? Math.floor(mins / 1440) + 'd ' + Math.floor((mins % 1440) / 60) + 'h'
    : mins >= 60 ? Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm'
    : mins + 'm';
  return d >= 0 ? 'in ' + s : s + ' ago';
}

/* WHY A PANEL IS SILENT — one function, seven answers, and never a default.
   Seven different silences reach these two panels and they are NOT the same
   sentence: "you are signed out", "you have no guild", "we have not asked
   yet", "the tables are not installed", "the query failed", and "your guild
   genuinely has nothing on the road" send a player to six different places.
   Collapsing them into one empty state is how a missing migration gets
   mistaken for a quiet week. Returns null when there is nothing to say and the
   rows should render.

   🪤 THIS IS A REASON, NOT AN ELEMENT, AND THAT IS THE POINT. The first cut of
      this was a <FreightNotice/> component and `const notice = <FreightNotice…/>`
      — which is truthy the moment it is written, whether or not the component
      returns null. So `{!notice ? <table/> : null}` rendered ZERO rows while
      the card header, counting the same lanes, said "2 lanes". A panel whose
      header contradicts its own body is precisely the defect this round exists
      to remove, and BOTH parse gates were green on it; it took driving the
      screen in a browser to see. A reason string cannot make that mistake. */
function freightSilence(ship, econ, corp, source, rowCount) {
  if (!econ) return 'nobridge';
  if (!econ.signedIn) return 'signedout';
  if (!corp) return 'nocorp';
  if (!ship || !ship.ready) return 'loading';
  if (source.missing) return 'missing';
  if (source.error) return 'error';
  if (!rowCount) return 'empty';
  return null;
}

/* The sentence for each reason. The migration filename is shown to ADMINS
   only — the same split _whOpen() settled on in index.html, for the same
   reason: it is the one person who can act on it, and it is noise (or worse,
   alarming) to everyone else. */
function FreightNotice({ why, isAdmin, migration, error, doorway }) {
  const box = (body) => (
    <div className="muted" style={{ padding: '14px 12px', fontSize: 12, lineHeight: 1.6 }}>{body}</div>
  );
  if (why === 'nobridge')  return box(<>Open <b>Just Business</b> from inside the game to see your guild’s freight — standalone there is no economy to read.</>);
  if (why === 'signedout') return box(<>Sign in to read your guild’s shipments. Everything below comes from the shared database.</>);
  if (why === 'nocorp')    return box(<>Guild freight belongs to a corporation, and you are not in one yet. Found or join one in <b>Guild &amp; Hiring</b>.</>);
  if (why === 'loading')   return box(<>Reading the guild’s freight…</>);
  if (why === 'missing')   return box(isAdmin
    ? <><b>ADMIN:</b> the tables this panel reads are not installed on this database. Apply <span className="mono">{migration}</span> in the Supabase SQL editor. Until then this panel has nothing to read; the convoy table above is computed locally and is unaffected.</>
    : <>This part of the shipping network is not switched on yet. The convoy table above still works.</>);
  if (why === 'error')     return box(<>Could not read this right now — {String(error)}. Nothing is lost; it will reappear on the next refresh.</>);
  if (why === 'empty')     return box(doorway);
  return null;
}

/* The "you are only seeing your own" admission. Shown whenever the read fell
   back to owner-scoped RLS, because "the guild has one deal" and "you have one
   deal and cannot see anyone else's" are different facts and a player is
   entitled to know which they are looking at. */
function ScopeNote({ scope, isAdmin, noun }) {
  if (scope === 'corp') return null;
  return (
    <div className="muted" style={{ padding: '8px 12px', fontSize: 11.5, borderBottom: '1px dashed var(--line-soft)' }}>
      Showing <b>your own</b> {noun} only — guild-wide visibility needs
      {isAdmin ? <> <span className="mono">sql/049_corp_logistics_visibility.sql</span></> : <> a database change that has not been applied yet</>}.
    </div>
  );
}

/* 🤝 STANDING CITY TRADE — the only "shipment going to another city" the game
   actually records (sql/038-039). One row per LEG, because a leg is what a
   player means by a shipment: an origin city, a destination city, a resource,
   a quantity, and when the next one is due.
   Every figure here is read straight off the row that produced it —
   gives_units / wants_units for the quantity, cycle_hours + starts_at for the
   due time (through the module that also settles it, so the two cannot drift),
   and the newest city_trade_shipments row for what the last cycle really
   moved. Nothing is derived from a display string. */
function GuildCityTrade({ ship, econ, corp, isAdmin }) {
  const src = (ship && ship.city) || { ok: false, missing: false, error: null, lanes: [] };
  const lanes = Array.isArray(src.lanes) ? src.lanes : [];
  const live = lanes.filter(l => l.status === 'active');
  const perCycle = live.reduce((s, l) => s + (Number(l.units) || 0), 0);
  const why = freightSilence(ship, econ, corp, src, lanes.length);
  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="row-head">
        <h3>City trade agreements</h3>
        {/* The header counts the SAME array the body renders. When those two
            ever disagree the panel is lying, so they read one variable. */}
        <span className="muted mono" style={{ fontSize: 11 }}>
          {lanes.length} lane{lanes.length === 1 ? '' : 's'}
          {live.length ? ' · ' + fmt(perCycle) + ' units per cycle live' : ''}
        </span>
      </div>
      <FreightNotice
        why={why} isAdmin={isAdmin} error={src.error}
        migration="sql/038_city_economy_trade.sql + sql/039_city_trade_agreements.sql"
        doorway={<>No standing city trade agreements in this guild yet. A member opens one from the war map: select another player’s city and choose <b>🤝 Do business with this city</b>. Deals settle on their own every cycle once both sides accept.</>}
      />
      {!why ? <ScopeNote scope={ship && ship.scope} isAdmin={isAdmin} noun="agreements" /> : null}
      {!why ? (
        <table className="tbl">
          <thead>
            <tr>
              <th>Route</th>
              <th>Shipper</th>
              <th>Cargo per cycle</th>
              <th>Cycle</th>
              <th>Status</th>
              <th>Next due</th>
              <th>Last cycle</th>
            </tr>
          </thead>
          <tbody>
            {lanes.map(l => (
              <tr key={l.id}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 500 }}>{l.fromCity}</span>
                    <span className="muted mono">→</span>
                    <span style={{ fontWeight: 500 }}>{l.toCity}</span>
                  </div>
                </td>
                <td style={{ fontSize: 12 }}>
                  {l.fromName}{l.mine ? <span className="chip flat" style={{ marginLeft: 6 }}>you</span> : null}
                </td>
                <td className="mono">{fmt(l.units)} {l.resource}</td>
                <td className="mono muted" style={{ fontSize: 11 }}>
                  {l.cycleHours ? 'every ' + l.cycleHours + 'h' : '—'}
                  {l.cyclesTotal ? <div>{l.cyclesUnknown ? 'cycles unread' : l.cyclesSettled + ' / ' + l.cyclesTotal + ' settled'}</div> : null}
                </td>
                <td><span className={'chip ' + (l.status === 'active' ? 'aza' : l.status === 'pending' ? 'flat' : 'danger')}>{l.status}</span></td>
                <td className="mono" style={{ fontSize: 11.5 }}>
                  {l.status === 'active' ? whenLabel(l.nextDueAt) : '—'}
                </td>
                <td className="mono" style={{ fontSize: 11 }}>
                  {/* Three states, not two. "nothing yet" is a CLAIM — that no
                      cycle has fired — and it must not be made when the read that
                      would prove it came back capped. See cyclesUnknown. */}
                  {l.cyclesUnknown ? <span className="muted">cycles unread</span> : l.lastOutcome
                    ? <>
                        {fmt(l.lastSent)} shipped
                        <div className="muted">{l.lastOutcome === 'settled' ? 'in full' : l.lastOutcome.replace('_', ' ')} · {whenLabel(l.lastSettledAt)}</div>
                      </>
                    : <span className="muted">nothing yet</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

/* 📦 FREIGHT INBOUND TO A WAREHOUSE BAY — wh_shipments, read through
   wh_corp_shipments() when sql/049 is applied and wh_my_shipments() when it is
   not. Both return the same field names, so this table does not care which one
   answered; it only says which, through ScopeNote. */
function GuildWarehouseFreight({ ship, econ, corp, isAdmin }) {
  const src = (ship && ship.warehouse) || { ok: false, missing: false, error: null, scope: 'self', rows: [] };
  const rows = Array.isArray(src.rows) ? src.rows : [];
  const units = rows.reduce((s, r) => s + (Number(r.units) || 0), 0);
  const why = freightSilence(ship, econ, corp, src, rows.length);
  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="row-head">
        <h3>Inbound to warehouse bays</h3>
        <span className="muted mono" style={{ fontSize: 11 }}>
          {rows.length} load{rows.length === 1 ? '' : 's'}{rows.length ? ' · ' + fmt(units) + ' units' : ''}
        </span>
      </div>
      <FreightNotice
        why={why} isAdmin={isAdmin} error={src.error}
        migration="supabase/migrations/20260812000000_warehouse_storage.sql"
        doorway={<>Nothing inbound to a warehouse bay. Rent a bay in another player’s warehouse and send a load to it — deliveries take up to 72 hours depending on the level of the node they leave from.</>}
      />
      {!why ? <ScopeNote scope={src.scope} isAdmin={isAdmin} noun="loads" /> : null}
      {!why ? (
        <table className="tbl">
          <thead>
            <tr>
              <th>Route</th>
              <th>Sender</th>
              <th>Cargo</th>
              <th>Weight</th>
              <th>Status</th>
              <th>Arrives</th>
              <th>Unloaded</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 500 }}>{r.originLabel}</span>
                    <span className="muted mono">→</span>
                    <span style={{ fontWeight: 500 }}>{r.ownerName}{r.bayNo != null ? ' · bay ' + r.bayNo : ''}</span>
                  </div>
                  {r.freeCity ? <div className="muted mono" style={{ fontSize: 10 }}>free city · 72h run</div> : null}
                </td>
                <td style={{ fontSize: 12 }}>
                  {r.senderName}{r.mine ? <span className="chip flat" style={{ marginLeft: 6 }}>you</span> : null}
                </td>
                <td className="mono" style={{ fontSize: 11.5 }}>
                  {/* ⚠ NOT `r.cargo.length`. This is bridged data, and there is
                      no error boundary between this cell and the whole app —
                      one row whose `cargo` is absent threw here and blanked the
                      ENTIRE corp app, sidebar included, with no way back.
                      Reproduced in a browser before this guard was added. */}
                  {(Array.isArray(r.cargo) ? r.cargo : []).length
                    ? r.cargo.slice(0, 3).map(p => fmt(p && p.qty) + ' ' + (p && p.id)).join(' · ') + (r.cargo.length > 3 ? ' +' + (r.cargo.length - 3) + ' more' : '')
                    : '—'}
                  <div className="muted">{fmt(r.units)} units</div>
                </td>
                <td className="num mono">{fmt(r.weightKg)} kg</td>
                <td><span className={'chip ' + (r.status === 'arrived' ? 'aza' : 'flat')}>{r.status}</span></td>
                <td className="mono" style={{ fontSize: 11.5 }}>{whenLabel(r.etaAt)}</td>
                <td className="mono" style={{ fontSize: 11.5 }}>{r.cratesStored} / {r.cratesTotal} crates</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

// ============================================================================
// MAILBOX
// ============================================================================

/* 📮 The Mailbox is the corporation's ACTIVITY FEED.

   What it was: `window.ECON.MAIL`, an array hardcoded to `[]` in data.js,
   rendered behind "Claim all", "Mark all read", "Return", "Reject" and
   "Accept & claim". None of those had anything behind them — claim() flipped
   two booleans on a React object and the other four were inert — and the
   detail pane printed a fixed paragraph about attachment expiry onto every
   message regardless of its content. There was also a branch keyed on the
   sender's name containing a hardcoded demo callsign, which opened the
   trade window. All of it is gone.

   What it is: a read-only merge of five ledgers the corporation already
   writes — corp_vault_log, corp_treasury, corp_transfers, corp_requests and
   corp_operations — assembled by _jbActivityFetch() in the parent game and
   bridged in as econ.corpActivity. Every row on screen IS a row in one of
   those tables. There are no controls because a ledger is not an inbox: the
   actions that produce these entries are taken on the screens that own them.

   Degradation is per source, in the bridge: a missing table contributes zero
   rows and the other four still render. All five missing renders ONE honest
   empty state. Nothing here fabricates a placeholder row to fill the space. */

// Presentation only — which chip a source wears. The label is what the source
// IS, not a judgement about the entry (that comes from the entry's own sign).
const ACT_SRC = {
  vault:     { label: 'Vault',    cls: 'flat' },
  treasury:  { label: 'Treasury', cls: 'aza'  },
  transfer:  { label: 'Transfer', cls: 'flat' },
  request:   { label: 'Hiring',   cls: 'void' },
  operation: { label: 'Business', cls: 'rust' },
};
const ACT_FILTERS = [
  { id: 'all',       label: 'All' },
  { id: 'vault',     label: 'Vault' },
  { id: 'treasury',  label: 'Treasury' },
  { id: 'transfer',  label: 'Transfers' },
  { id: 'request',   label: 'Hiring' },
  { id: 'operation', label: 'Business' },
];

// Relative time from a real ISO string. Returns '—' when the timestamp is
// missing or unparseable — the screen this replaced rendered `{m.ts} ago`,
// which printed "undefined ago" for any row without one.
function actAgo(iso) {
  const t = Date.parse(iso || '');
  if (!isFinite(t)) return '—';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60); if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24); if (d < 30) return d + 'd ago';
  return new Date(t).toLocaleDateString();
}
// Absolute time for the row's tooltip, so "2h ago" is always checkable
// against the actual row in the database.
function actWhen(iso) {
  const t = Date.parse(iso || '');
  return isFinite(t) ? new Date(t).toLocaleString() : 'no timestamp on this row';
}
/* The one numeric value an entry carries, or null when it carries none.
   `amount` is Cinder from corp_treasury; `qty` is units of the named item.
   Number()/isFinite guard the display end of the same NaN path the bridge
   guards at the read end: a row with a null qty prints nothing, never "NaN".

   🔢 `money` decides the FORMATTER, and the two are not interchangeable:
     · Cinder → fmtC(), the integer money formatter the Corp Treasury headline
       and the sidebar chip already use. It must be the same one, because the
       Mailbox's Treasury lines are the individual terms of that headline's
       sum(amount) — formatted differently they would visibly fail to add up.
     · quantities → vaultNum(), the count formatter above. The shared fmt() is
       built for prices and renders 0 as "0.00", so a deposit of three cards
       read "+3.00" and a zero-quantity row read "0.00" — a decimal place on a
       count of objects, which is the same class of wrong number as a NaN. */
function actValue(a) {
  if (!a) return null;
  const amt = Number(a.amount);
  if (a.amount != null && isFinite(amt)) return { n: amt, unit: a.unit || 'Cinder', money: true };
  const q = Number(a.qty);
  if (a.qty != null && isFinite(q)) return { n: q, unit: a.unit || '', money: false };
  return null;
}

function ActivityRow({ a, isNew }) {
  const src = ACT_SRC[a.src] || { label: String(a.src || '—'), cls: 'flat' };
  const v = actValue(a);
  const dir = (a.dir | 0);
  const tone = dir > 0 ? 'var(--toxic)' : dir < 0 ? 'var(--rust)' : 'var(--fg-2)';
  // Only a signed value gets a sign. An unsigned quantity (a transfer between
  // two members moves nothing in or out of the corporation) is printed bare.
  const num = v ? ((dir > 0 && v.n > 0 ? '+' : '') + (v.money ? fmtC(v.n) : vaultNum(v.n)) + (v.unit ? ' ' + v.unit : '')) : '';
  return (
    <div className="row" style={{
      gap: 12, alignItems: 'flex-start', padding: '11px 14px',
      borderBottom: '1px solid var(--line-soft)',
      background: isNew ? 'rgba(198,74,42,0.05)' : 'transparent',
    }}>
      <span className="mono muted" title={actWhen(a.at)}
            style={{ fontSize: 10.5, width: 64, flexShrink: 0, paddingTop: 2 }}>{actAgo(a.at)}</span>
      <span className={'chip ' + src.cls} style={{ flexShrink: 0 }}>{src.label}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13 }}>
          {a.actor ? <b>{a.actor}</b> : null}
          {a.actor ? ' ' : ''}
          <span style={{ color: 'var(--fg-2)' }}>{a.verb}</span>
          {/* The object is whatever the source row actually names — an item,
              a treasury note, a role. Absent on rows that name nothing, and
              nothing is printed in its place. */}
          {a.object ? <span> · {a.icon ? a.icon + ' ' : ''}<b>{a.object}</b></span> : null}
        </div>
        {a.note ? <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{a.note}</div> : null}
      </div>
      {num ? <span className="mono" style={{ fontSize: 12.5, color: tone, flexShrink: 0 }}>{num}</span> : null}
      {!num && a.status ? <span className="chip flat" style={{ flexShrink: 0 }}>{a.status}</span> : null}
    </div>
  );
}

function MailboxScreen() {
  const [, setTick] = useState(0);
  const [filter, setFilter] = useState('all');
  // The "new" divider is pinned to the mark as it stood when the screen was
  // OPENED. Reading it live would make the divider jump to the top the instant
  // the mark is written below, which is one frame later — the player would
  // never see which entries were new.
  const baseline = useRef(null);
  if (baseline.current === null) baseline.current = mailSeenGet();

  useEffect(() => {
    const h = () => setTick(t => t + 1);
    window.addEventListener('jbdata', h);
    // Ask the parent for a fresh pass on open, so a deposit made a moment ago
    // on another screen is already here.
    try { window.JB_action && window.JB_action({ kind: 'activityRefresh' }); } catch (e) {}
    return () => window.removeEventListener('jbdata', h);
  }, []);

  const econ = (window.__JB && window.__JB.econ) || null;
  const all = jbActivity();
  const loaded = !!(econ && econ.corpActivityLoaded);
  const hasCorp = !!(econ && econ.corp);
  const newest = all.length ? all[0].at : '';

  // Opening the Mailbox marks the feed seen up to its newest entry — that is
  // what the sidebar badge counts against. Runs whenever the newest entry
  // changes, so entries arriving while the screen is open clear too.
  useEffect(() => { if (newest) mailSeenSet(newest); }, [newest]);

  const shown = filter === 'all' ? all : all.filter(a => a && a.src === filter);
  const newCount = mailNewCount(all, baseline.current);
  const refresh = () => { try { window.JB_action && window.JB_action({ kind: 'activityRefresh' }); } catch (e) {} };

  const head = (
    <ScreenHead
      title="Mailbox"
      desc="Everything that moved this corporation — vault deposits and withdrawals, every Treasury ledger line, member transfers, hiring, and businesses founded. Read-only: each row is a row in one of those ledgers."
      right={<button className="btn" onClick={refresh}>Refresh</button>}
    />
  );

  // Three distinct honest states, because they are three different facts and
  // the player's next move differs for each. The old screen had one.
  if (!hasCorp) {
    return (
      <div className="screen">
        {head}
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
          <div className="mono" style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', marginBottom: 8 }}>No corporation</div>
          <div style={{ fontSize: 14 }}>This feed follows a corporation's ledgers. Found or join one and its activity appears here.</div>
        </div>
      </div>
    );
  }
  if (!loaded && !all.length) {
    return (
      <div className="screen">
        {head}
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
          <div className="mono" style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase' }}>Loading activity…</div>
        </div>
      </div>
    );
  }
  if (!all.length) {
    return (
      <div className="screen">
        {head}
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
          <div className="mono" style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', marginBottom: 8 }}>Nothing yet</div>
          <div style={{ fontSize: 14 }}>
            No vault movements, Treasury lines, transfers, hires or businesses to report for {(econ.corp && econ.corp.name) || 'this corporation'}.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      {head}

      <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {ACT_FILTERS.map(f => {
          const n = f.id === 'all' ? all.length : all.filter(a => a && a.src === f.id).length;
          return (
            <button key={f.id} className={'btn' + (filter === f.id ? ' primary' : ' ghost')}
                    onClick={() => setFilter(f.id)} style={{ fontSize: 12 }}>
              {/* `muted` on the ACTIVE (gold) chip renders the count almost
                  invisible against it — a number nobody can read is a number
                  that is not shown. Inherit the button's own colour instead. */}
              {f.label} <span className={'mono' + (filter === f.id ? '' : ' muted')}
                              style={{ marginLeft: 6, opacity: filter === f.id ? 0.85 : 1 }}>{n}</span>
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <span className="mono muted" style={{ fontSize: 11, alignSelf: 'center' }}>
          {newCount > 0 ? newCount + ' new since your last visit' : 'up to date'}
        </span>
      </div>

      <div className="card" style={{ overflow: 'auto', maxHeight: 'calc(100vh - 300px)' }}>
        {shown.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            Nothing from this source yet.
          </div>
        ) : shown.map((a, i) => {
          const isNew = !!(a.at && (!baseline.current || a.at > baseline.current));
          const prevNew = i > 0 ? !!(shown[i - 1].at && (!baseline.current || shown[i - 1].at > baseline.current)) : true;
          return (
            <React.Fragment key={a.id || (a.src + ':' + i)}>
              {/* Divider drawn once, where new stops and already-seen begins. */}
              {!isNew && prevNew && i > 0 && (
                <div className="mono muted" style={{
                  fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase',
                  padding: '8px 14px', background: 'var(--surface-2)',
                  borderBottom: '1px solid var(--line-soft)',
                }}>Earlier</div>
              )}
              <ActivityRow a={a} isNew={isNew} />
            </React.Fragment>
          );
        })}
      </div>

      <div className="muted" style={{ fontSize: 11, marginTop: 12, textAlign: 'center' }}>
        Sources: corp_vault_log · corp_treasury · corp_transfers · corp_requests · corp_operations.
        A source that is unavailable is simply absent — nothing here is filled in for it.
      </div>
    </div>
  );
}

// ============================================================================
// LIVE FEED
// ============================================================================

// The Live Feed is the GUILD WIRE — a realtime chat every member of the
// corporation shares, mixed with system lines (hires, position changes,
// agency actions). Backed by the guild_chat table via the parent bridge;
// sending posts jb:action{chatSend}, new rows arrive on the 'jbdata' event.
function FeedScreen() {
  const [, setTick] = useState(0);
  const [msg, setMsg] = useState('');
  const endRef = useRef(null);
  useEffect(() => {
    const h = () => setTick(t => t + 1);
    window.addEventListener('jbdata', h);
    return () => window.removeEventListener('jbdata', h);
  }, []);
  const econ = (window.__JB && window.__JB.econ) || null;
  const corp = econ && econ.corp;
  const chat = (econ && Array.isArray(econ.guildChat)) ? econ.guildChat : [];
  const me = (econ && econ.handle) || '';
  useEffect(() => {
    try { endRef.current && endRef.current.scrollIntoView({ block: 'end' }); } catch (e) {}
  }, [chat.length]);
  const send = () => {
    const b = msg.trim();
    if (!b) return;
    try { window.JB_action && window.JB_action({ kind: 'chatSend', body: b.slice(0, 400) }); } catch (e) {}
    setMsg('');
  };
  // 📻 THE WIRE MOVED. It now lives inside the Community hub, alongside
  // standings, announcements, votes, objectives, contributions and rewards —
  // one social screen instead of a chat box with half the page empty and a
  // separate civic window elsewhere. This screen is the signpost.
  const openHub = () => { try { window.JB_action && window.JB_action({ kind: 'openCommunity' }); } catch (e) {} };
  return (
    <div className="screen">
      <ScreenHead title="Guild Wire" desc="The wire now lives in the Community hub, with the rest of the civic layer." />
      <div className="card" style={{ padding: 30, maxWidth: 720 }}>
        <div style={{ fontSize: 30 }}>📻</div>
        <div style={{ margin: '10px 0 6px', fontWeight: 700, fontSize: 16 }}>The Wire is part of Communities now</div>
        <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.65 }}>
          {corp
            ? <>Your corporation’s live chat sits in the <b>Wire</b> tab of the Community hub, next to standings,
              announcements, votes, objectives, contributions and rewards — so the whole social and civic layer
              is one screen instead of two.</>
            : <>The wire belongs to a corporation, and you are not in one yet. Found or join one in <b>Guild &amp; Hiring</b>;
              the rest of the Community hub works either way.</>}
        </div>
        <button className="btn" style={{ marginTop: 16 }} onClick={openHub}>Open the Community hub</button>
      </div>
    </div>
  );
}
// Retained below: the original standalone wire. Kept rather than deleted so the
// message shapes and the send path stay visible next to their replacement.
function LegacyFeedScreen() {
  const [, setTick] = useState(0);
  const [msg, setMsg] = useState('');
  const endRef = useRef(null);
  const econ = (window.__JB && window.__JB.econ) || null;
  const corp = econ && econ.corp;
  const chat = (econ && Array.isArray(econ.guildChat)) ? econ.guildChat : [];
  const me = (econ && econ.handle) || '';
  const send = () => {
    const b = msg.trim();
    if (!b) return;
    try { window.JB_action && window.JB_action({ kind: 'chatSend', body: b.slice(0, 400) }); } catch (e) {}
    setMsg('');
  };
  if (!corp) {
    return (
      <div className="screen">
        <ScreenHead title="Guild Wire" desc="Live chat + action feed for your corporation — members only." />
        <div className="card" style={{ padding: 30, textAlign: 'center' }}>
          <div style={{ fontSize: 30 }}>👥</div>
          <div style={{ margin: '8px 0 4px', fontWeight: 700 }}>Guild members only</div>
          <div className="muted" style={{ fontSize: 12.5 }}>Join or found a corporation in <b>Guild &amp; Hiring</b> to enter the wire.</div>
        </div>
      </div>
    );
  }
  return (
    <div className="screen">
      <ScreenHead
        title="Guild Wire"
        desc={'Live chat + every corporation action for ' + (corp.name || 'your guild') + ' — all members see this, in real time.'}
        right={<Stat label="On the wire" value={String(chat.length)} />}
      />
      <div className="card" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 250px)', minHeight: 340, maxWidth: 900 }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {chat.length === 0 && <div className="muted" style={{ fontSize: 12.5, textAlign: 'center', padding: 24 }}>Quiet on the wire. Say something to the guild.</div>}
          {chat.map((m, i) => m.kind === 'sys' ? (
            <div key={m.id || 'i' + i} className="mono muted" style={{ fontSize: 10.5, textAlign: 'center', padding: '2px 0', letterSpacing: '.04em' }}>— {m.body} —</div>
          ) : (
            <div key={m.id || 'i' + i} style={{ alignSelf: m.user_name === me ? 'flex-end' : 'flex-start', maxWidth: '72%' }}>
              <div className="mono muted" style={{ fontSize: 10, marginBottom: 2, textAlign: m.user_name === me ? 'right' : 'left' }}>
                {m.user_name || '?'}{m.created_at ? ' · ' + new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
              </div>
              <div style={{ padding: '7px 11px', borderRadius: 9, fontSize: 12.5, border: '1px solid var(--line-soft)', background: m.user_name === me ? 'rgba(212,168,60,.14)' : 'var(--surface-2)' }}>{m.body}</div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
        <div style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid var(--line-soft)' }}>
          <input className="input" style={{ flex: 1 }} placeholder="Message your guild…" value={msg} maxLength={400}
            onChange={e => setMsg(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send(); }} />
          <button className="btn primary" disabled={!msg.trim()} onClick={send}>Send</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// CORP TREASURY
// ============================================================================

// ============================================================================
// 🏙 MEMBER CITIES — who is in the corp, what their city produces, what it needs
// ============================================================================
// Every value on this panel comes from econ.memberCities, which index.html
// builds from ONE `.in('owner_id', …)` read of city_profiles (sql/038) keyed on
// the corp roster. Nothing here is derived, invented, or defaulted.
//
// 🔴 EXACTLY ONE ROW PER corp_members ROW. The bridge builds the list from the
//    ROSTER and joins cities onto it, so a member with no published city (or
//    one RLS declines to return) still occupies a line and says so. Rendering
//    the QUERY RESULT instead would silently shorten the roster and disagree
//    with the "Members" stat at the top of this same screen — the kind of
//    quiet mismatch that makes every other number on the page suspect.
//
// 🔴 NO INVENTED NUMBERS. population / sells / buys print an em dash when the
//    column is null: fmt(null) is '—', never NaN and never 0. A 0 population
//    sitting next to real cities reads as a real, dead city, which is worse
//    than admitting the figure is not there.
//
// 🔴 RESOURCE IDS ARE PRINTED RAW. The corp app has no copy of the 258-id chain
//    resource table (it lives in /src/resources/chain.js, outside this iframe),
//    so prettifying 'ironOre' into a display name here would mean inventing a
//    naming rule and applying it to data it may not fit. The raw id is what the
//    row actually says, and it is what makes the coverage summary below
//    checkable by hand against the rows above it.
//
// ⚠ SPECIALIZATIONS ARE NOT FOLDED INTO THE COVERAGE SET. A specialization
//   ('energy') is an earned tag, not a resource id, and counting it as produced
//   supply would make "nobody here produces X" wrong. It is shown, separately
//   labelled, and excluded from the maths.
// 🔴 NOT fmt(). shell.jsx's fmt() drops the fraction on anything >= 1000
// (maximumFractionDigits: 0), which is right for a Cinder balance and WRONG
// here: a city selling 4500.13 lumber would print "4,500" — a number that
// disagrees with its own source row, on a panel whose whole claim is that it
// prints what city_profiles says. cityTradePublish rounds to 2dp on the way
// in, so 2dp out is the stored value exactly. null stays an em dash.
const fmtUnits = (n) => (n == null || !isFinite(Number(n)))
  ? '—'
  : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

function MemberCitiesPanel() {
  // The panel re-reads the bridge on every jb:data push. App already re-renders
  // on that event, but this screen must not depend on a parent's state churn to
  // stay honest — a stale roster here is a wrong number, not a cosmetic lag.
  const [, bump] = useState(0);
  useEffect(() => {
    const on = () => bump(n => n + 1);
    window.addEventListener('jbdata', on);
    return () => window.removeEventListener('jbdata', on);
  }, []);

  const econ  = (window.__JB && window.__JB.econ) || null;
  const rows  = (econ && Array.isArray(econ.memberCities)) ? econ.memberCities : [];
  const state = (econ && econ.memberCitiesState) || 'unknown';

  // Coverage is computed ONLY from the rows rendered above it, so a reader can
  // check it by eye. produces/needs map resource id -> member names.
  const cover = useMemo(() => {
    const produces = {}, needs = {};
    const put = (bag, id, who) => {
      const l = bag[id] = bag[id] || [];
      if (l.indexOf(who) < 0) l.push(who);      // one member, counted once
    };
    rows.forEach(m => {
      const who = m && m.name ? m.name : 'Member';
      (m && Array.isArray(m.cities) ? m.cities : []).forEach(c => {
        (Array.isArray(c.sells) ? c.sells : []).forEach(s => { if (s && s.id) put(produces, s.id, who); });
        (Array.isArray(c.buys)  ? c.buys  : []).forEach(b => { if (b && b.id) put(needs, b.id, who); });
      });
    });
    const covered = Object.keys(produces).sort();
    // A gap is a resource SOME member's city buys that NO member's city sells.
    const gaps = Object.keys(needs).filter(id => !produces[id]).sort();
    return { produces, needs, covered, gaps };
  }, [rows]);

  /* TWO different counts, and they were the same variable — which printed a
     wrong number. `withCity` is how many MEMBERS have published a city; it is
     the right number for the head ("4 members · 2 with a published city").
     `cityCount` is how many CITIES are drawn in the table. The summary below
     reads "Between all N cities above" and was using withCity, so a roster
     where one member holds three cities and another holds one listed FOUR
     cities and then said "Between all 2 cities above". */
  const withCity   = rows.filter(m => m && Array.isArray(m.cities) && m.cities.length > 0).length;
  const cityCount  = rows.reduce((n, m) => n + ((m && Array.isArray(m.cities)) ? m.cities.length : 0), 0);

  // ── The honest degraded states. Each is one line; the screen around it is
  //    untouched, which is the whole point of keeping this in its own card.
  let notice = null;
  if (!econ)                    notice = 'City data is unavailable — this screen is not connected to the game.';
  else if (!econ.corp)          notice = 'Join or found a corporation to see its members and their cities.';
  else if (state === 'unavailable') notice = 'City data is not available — city_profiles (sql/038) could not be read. Nothing else on this screen is affected.';
  else if (state !== 'ok')      notice = 'City data has not loaded yet.';

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="row-head">
        <h3>Member cities — what this corporation covers</h3>
        <span className="more mono" style={{ cursor: 'default' }}>
          {notice ? '—' : (rows.length + (rows.length === 1 ? ' member · ' : ' members · ') + withCity + ' with a published city')}
        </span>
      </div>

      {notice ? (
        <div className="muted" style={{ padding: 14, fontSize: 12.5 }}>{notice}</div>
      ) : rows.length === 0 ? (
        <div className="muted" style={{ padding: 14, fontSize: 12.5 }}>This corporation has no members on its roster.</div>
      ) : (
        <React.Fragment>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Member</th><th>City</th><th className="num">Population</th><th>Produces</th><th>Needs</th>
              </tr></thead>
              <tbody>
                {/* ONE <tr> PER CITY, with the member cell carrying rowSpan.
                    This used to be one <tr> per member with a stack() helper
                    that repeated a <div> per city INSIDE each <td>. Four cells
                    stacking independently means the browser gives each stack
                    its own heights, so city N's population, exports and needs
                    did not sit on city N's line — measured drift up to 210px
                    on a real roster, i.e. every number attached to the wrong
                    city. Letting the table's own row-height algorithm do it is
                    the fix; padding or fixed heights only re-drift at another
                    viewport width.
                    ⚠ The head above still counts MEMBERS (rows.length), not
                    <tr>s — that number has to keep agreeing with the Members
                    stat on the same screen. */}
                {rows.map((m, i) => {
                  const cities = (m && Array.isArray(m.cities)) ? m.cities : [];
                  const key    = (m && m.userId) || ('m' + i);
                  const nameCell = (
                    <td rowSpan={Math.max(1, cities.length)}>
                      <div style={{ fontWeight: 500 }}>{(m && m.name) || 'Member'}</div>
                      <div className="mono muted" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.08em' }}>{(m && m.role) || 'member'}</div>
                    </td>
                  );
                  if (cities.length === 0) {
                    {/* 🤝 bug-mtqasoy6: a member with no node of their own who works in
                        another member's corporation city is named as such. */}
                    const shared = (m && Array.isArray(m.shared)) ? m.shared : [];
                    return (
                      <tr key={key}>
                        {nameCell}
                        <td style={{ minWidth: 150 }}>
                          <span className="muted" style={{ fontSize: 12 }}>{shared.length ? 'no city of their own' : 'no city founded'}</span>
                          {shared.length ? (
                            <div className="mono muted" style={{ fontSize: 10.5, marginTop: 3 }}>
                              works in {shared.slice(0, 3).map((s) => (s.name || 'unnamed city') + ' (' + s.ownerName + ')').join(', ')}{shared.length > 3 ? ' +' + (shared.length - 3) : ''}
                            </div>
                          ) : null}
                        </td>
                        <td className="num mono"><span className="muted" style={{ fontSize: 12 }}>—</span></td>
                        <td style={{ minWidth: 240 }}><span className="muted" style={{ fontSize: 12 }}>—</span></td>
                        <td style={{ minWidth: 220 }}><span className="muted" style={{ fontSize: 12 }}>—</span></td>
                      </tr>
                    );
                  }
                  return cities.map((c, j) => (
                    <tr key={key + ':' + (c && c.nodeId ? c.nodeId : j)}>
                      {j === 0 ? nameCell : null}
                      <td style={{ minWidth: 150 }}>
                        <div style={{ fontSize: 12.5 }}>{(c && c.name) || 'unnamed city'}</div>
                        <div className="mono muted" style={{ fontSize: 10 }}>{(c && c.nodeId) || 'no node'}</div>
                      </td>
                      <td className="num mono">{fmtUnits(c && c.pop)}</td>
                      <td style={{ minWidth: 240 }}>
                        {(c && Array.isArray(c.sells) && c.sells.length)
                          ? <div className="row" style={{ flexWrap: 'wrap' }}>{c.sells.map((s, k) => <ResUnit key={k} id={s.id} units={s.units} />)}</div>
                          : <span className="muted" style={{ fontSize: 12 }}>nothing published for export</span>}
                        {(c && Array.isArray(c.specs) && c.specs.length) ? (
                          <div className="mono muted" style={{ fontSize: 10.5, marginTop: 4 }}>
                            SPECIALIZED: {c.specs.join(', ')}
                          </div>
                        ) : null}
                      </td>
                      <td style={{ minWidth: 220 }}>
                        {(c && Array.isArray(c.buys) && c.buys.length)
                          ? <div className="row" style={{ flexWrap: 'wrap' }}>{c.buys.map((b, k) => <ResUnit key={k} id={b.id} units={b.units} />)}</div>
                          : <span className="muted" style={{ fontSize: 12 }}>no shortfalls published</span>}
                      </td>
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>

          <div style={{ padding: 14, borderTop: '1px solid var(--line-soft)' }}>
            <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 8 }}>
              Between all {cityCount === 1 ? '1 city' : cityCount + ' cities'} above
            </div>
            {cityCount === 0 ? (
              <div className="muted" style={{ fontSize: 12.5 }}>
                No member has published a city yet, so there is nothing to summarise.
              </div>
            ) : (
              <div className="col" style={{ gap: 10 }}>
                <div>
                  <div style={{ fontSize: 12.5, marginBottom: 6 }}>
                    Covered by this corporation — {cover.covered.length === 1 ? '1 resource' : cover.covered.length + ' resources'}
                  </div>
                  {cover.covered.length
                    ? <div className="row" style={{ flexWrap: 'wrap' }}>
                        {cover.covered.map(id => (
                          <span key={id} className="chip flat" style={{ marginRight: 6, marginBottom: 6, textTransform: 'none' }}
                                title={'produced by ' + cover.produces[id].join(', ')}>
                            <span className="mono">{id}</span>
                            <span className="mono muted" style={{ marginLeft: 6 }}>{cover.produces[id].length}×</span>
                          </span>
                        ))}
                      </div>
                    : <div className="muted" style={{ fontSize: 12.5 }}>Nothing — no city here has published anything for export.</div>}
                </div>
                <div>
                  <div style={{ fontSize: 12.5, marginBottom: 6 }}>
                    Needed by a member, produced by nobody here — {cover.gaps.length === 1 ? '1 resource' : cover.gaps.length + ' resources'}
                  </div>
                  {cover.gaps.length
                    ? <div className="row" style={{ flexWrap: 'wrap' }}>
                        {cover.gaps.map(id => (
                          <span key={id} className="chip rust" style={{ marginRight: 6, marginBottom: 6, textTransform: 'none' }}
                                title={'needed by ' + cover.needs[id].join(', ')}>
                            <span className="mono">{id}</span>
                            <span className="mono muted" style={{ marginLeft: 6 }}>{cover.needs[id].join(', ')}</span>
                          </span>
                        ))}
                      </div>
                    : <div className="muted" style={{ fontSize: 12.5 }}>None — every shortfall published by a member is covered by another member.</div>}
                </div>
              </div>
            )}
          </div>
        </React.Fragment>
      )}
    </div>
  );
}

// One resource id and its published figure. `units == null` is a real state —
// the column was null or unparseable — and prints an em dash rather than 0.
// 🔴 textTransform: 'none' — styles.css uppercases every .chip, which turned
//    'crudeOil' into 'CRUDEOIL' and 'ironOre' into 'IRONORE'. Those are not the
//    ids in city_profiles; a reader checking this panel against the row (or the
//    summary against these chips) would be comparing against a string the app
//    made up. The global rule is left alone — other screens want it.
function ResUnit({ id, units }) {
  return (
    <span className="chip flat" style={{ marginRight: 6, marginBottom: 6, textTransform: 'none' }}>
      <span className="mono">{id}</span>
      <span className="mono muted" style={{ marginLeft: 6 }}>{fmtUnits(units)}</span>
    </span>
  );
}

// ============================================================================
// CORP TREASURY
// ============================================================================

/* 🔴 EVERY NUMBER ON THIS SCREEN USED TO BE INVENTED. It shipped a fixed
   seven-figure headline with a fixed "+18k" delta, seven vault rows credited
   to people who do not exist, four funding-operation progress bars, and a
   five-role permission matrix for roles this game has never had. Demo content
   that LOOKS real is worse than an empty state, and this project has already
   had to rip exactly this out of two other panels.

   Every figure below now traces to a real source:
     · balance  → econ.corpTreasury     — sum(amount) over corp_treasury
     · history  → econ.corpTreasuryLog  — the corp_treasury rows themselves
     · 24h move → econ.corpTreasury24h  — summed over the SAME row set
     · roster   → econ.roster           — corp_members
     · roles    → CORP_ROLES (app.jsx)  — the roles that can actually be hired
     · vault    → econ.vault            — corp_vault
   corpTreasury is the same field the Operations header prints and the same
   field its "Fund from Treasury" button gates on, so the three cannot drift.

   ⛔ THE FUNDING BARS ARE DELETED, NOT RE-POINTED. There is no funding-operation
   table to point them at. Four honest absences beat four fake progress bars.
   ⛔ THE PERMISSION MATRIX IS DELETED TOO. Withdrawal permissions are enforced
   nowhere — corp_vault's RLS lets any member read and only the depositor delete
   — so a table promising "Director only" would have been a UI claim with
   nothing behind it. The real roster and the real hireable roles replace it. */

// The treasury is CINDER (🔥), not Aza coin. The old header printed a fixed
// seven-figure Aza total: wrong figure AND wrong currency.
const CINDER = ' 🔥';

// fmtC (integer money, NaN-proof) lives in shell.jsx beside fmt — the sidebar
// prints the same balance and both must format it identically.

function corpAgo(iso) {
  const t = iso ? Date.parse(iso) : NaN;
  if (!isFinite(t)) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

/* Role blurbs come from app.jsx's CORP_ROLES — the SAME list Guild & Hiring
   hires from, so the roles named here are roles that can genuinely be held.
   It is a top-level `const` in a sibling classic script (a global lexical
   binding, readable from here), but `typeof` on it would THROW if this ever ran
   before app.jsx evaluated. Hence the try. */
function corpRoleDesc(role) {
  try {
    const list = CORP_ROLES;
    if (!Array.isArray(list)) return '';
    const r = list.find(x => x && String(x.id).toLowerCase() === String(role).toLowerCase());
    return r ? r.d : '';
  } catch (e) { return ''; }
}

function CorpEmpty({ title, body, children }) {
  return (
    <div className="screen">
      <ScreenHead title="Corp Treasury" desc="Your corporation's shared Cinder balance, held as an append-only ledger: the balance is the sum of every movement and no line is ever edited in place." />
      <div className="card" style={{ padding: 28, maxWidth: 640, textAlign: 'center' }}>
        <div style={{ fontSize: 30, marginBottom: 10 }}>🏦</div>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>{title}</div>
        <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6 }}>{body}</div>
        {children}
      </div>
    </div>
  );
}

function CorpScreen() {
  const E = (window.__JB && window.__JB.econ) || null;
  const openGuild = () => { try { window.dispatchEvent(new CustomEvent('jb:open', { detail: 'guild' })); } catch (e) {} };
  /* 🚪 The door out to the Vault screen. "Open full vault" was a dead
     <span className="more"> — this codebase's most-repeated defect is a
     finished feature with no way in. Route state lives in app.jsx, so the
     sidebar (which already holds setRoute) listens for this event; see the
     jb:route handler in shell.jsx. */
  const goVault = () => { try { window.dispatchEvent(new CustomEvent('jb:route', { detail: 'vault' })); } catch (e) {} };

  // ── Gate 1: no bridge. public/corp/index.html can be opened on its own, and
  // then there is no player, no corporation and no ledger behind it.
  if (!E) {
    return <CorpEmpty
      title="Open this from inside the game"
      body="The treasury reads your corporation's real Cinder ledger from the game session that embeds this app. This window has no session attached, so there is nothing to show — and it will not invent a balance." />;
  }

  if (!E.signedIn) {
    return <CorpEmpty
      title="Sign in to read the treasury"
      body="The ledger lives in the cloud. Sign in inside the game and the balance, its full history and your roster appear here." />;
  }

  const corp = E.corp || null;
  if (!corp) {
    // "We have not asked the server yet" is NOT "you have no corporation".
    const checking = !E.corpChecked;
    return <CorpEmpty
      title={checking ? 'Checking your corporation…' : 'You are not in a corporation'}
      body={checking
        ? 'Looking up your membership — this only takes a moment.'
        : 'A treasury belongs to a corporation. Found one or join one and this screen fills with its real balance and every movement in and out of it.'}>
      {!checking && <button className="btn primary" style={{ marginTop: 14 }} onClick={openGuild}>👥 Guild &amp; Hiring</button>}
    </CorpEmpty>;
  }

  /* numC, not `| 0`: see shell.jsx. `| 0` is a 32-bit cast and this number
     is required to equal sum(amount) to the unit, at any size. */
  const bal = numC(E.corpTreasury);
  const d24 = numC(E.corpTreasury24h);
  /* `false` means the read FAILED. `undefined` means an older parent that never
     sent the flag — treat that as fine, not as a failure, so an out-of-date
     bridge does not paint a scary banner over a perfectly good balance. */
  const unread = E.corpTreasuryKnown === false;
  const log = Array.isArray(E.corpTreasuryLog) ? E.corpTreasuryLog : [];
  const roster = Array.isArray(E.roster) ? E.roster : [];
  const pending = Array.isArray(E.pendingHires) ? E.pendingHires : [];
  const vault = Array.isArray(E.vault) ? E.vault : [];
  const cap = (E.memberCap | 0) || 25;
  const count = (E.memberCount | 0) || roster.length;

  /* Vault summary from the real corp_vault rows, grouped. Deliberately a
     SUMMARY: the Vault screen owns the per-item table, and shipping a second
     copy of it here is how two views of one table drift apart.
     ⚠ AND IT DID DRIFT, exactly as the line above warned. corp_vault keeps a
     row after its stack is drawn to zero (and PostgREST can hand back a null
     numeric), so VaultScreen counts HOLDINGS — `.filter(v => v.qty > 0)` — and
     this card counted ROWS. Six seeded rows, one of them qty null: the Vault
     screen said "5 stacks", this card said "Stacks held 6", off the same
     `econ.vault`. The two must share the filter, not just the array. */
  const vHold = vault.filter(v => v && numC(v.qty) > 0);
  const vKinds = {};
  const vDeps = {};
  vHold.forEach(v => {
    const k = String(v.kind || 'item');
    vKinds[k] = (vKinds[k] || 0) + numC(v.qty);
    const d = v.dep || 'Member';
    vDeps[d] = (vDeps[d] || 0) + numC(v.qty);
  });
  const vKindList = Object.keys(vKinds).sort((a, b) => vKinds[b] - vKinds[a]);
  const vDepList = Object.keys(vDeps).sort((a, b) => vDeps[b] - vDeps[a]).slice(0, 6);

  return (
    <div className="screen">
      <ScreenHead
        title={(corp.name || 'Corporation') + ' — Treasury'}
        desc="Shared Cinder, held as an append-only ledger: the balance is the sum of every movement and no line is ever edited or removed. Member deposits, node construction, operation startups and wages all land here."
        idTag={corp.tag ? ('TAG ' + String(corp.tag).toUpperCase()) : null}
        right={<div className="row" style={{ gap: 18 }}>
          <Stat label="Treasury" value={unread ? '—' : (fmtC(bal) + CINDER)}
            delta={(unread || d24 === 0) ? null : ((d24 > 0 ? '+' : '−') + fmtC(Math.abs(d24)) + ' / 24h')} up={d24 > 0} />
          <Stat label="Members" value={count + ' / ' + cap} />
          <button className="btn primary" onClick={openGuild} style={{ alignSelf: 'center' }}>👥 Guild &amp; Hiring</button>
        </div>}
      />

      {unread && (
        <div className="card" style={{ padding: '10px 14px', marginBottom: 14, borderColor: 'var(--rust)', fontSize: 12.5 }}>
          <b style={{ color: 'var(--rust)' }}>Ledger not read.</b>{' '}
          <span className="muted">corp_treasury could not be reached — offline, or the table is not set up yet. The balance is left blank rather than shown as 0 on purpose: an unread ledger is not an empty one.</span>
        </div>
      )}

      {/* 🏙 THE REAL ROSTER, AND WHAT EACH MEMBER'S CITY ACTUALLY MAKES.
          Full width and above the ledger because it is the one thing on this
          screen a guild reads to decide who builds what. Its row count is the
          same `roster` this screen's "Members & roles" card lists and the same
          count the "Members" stat prints — one source, three views. */}
      <MemberCitiesPanel />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 18 }}>
        <div className="card">
          <div className="row-head">
            <h3>Ledger — every movement</h3>
            <span className="mono muted" style={{ marginLeft: 'auto', fontSize: 10.5, letterSpacing: '.08em' }}>
              {unread ? '' : (log.length ? ('LAST ' + log.length) : 'APPEND-ONLY')}
            </span>
          </div>
          {unread ? (
            <div className="muted" style={{ padding: 24, textAlign: 'center', fontSize: 12.5 }}>Could not read the ledger.</div>
          ) : log.length === 0 ? (
            <div style={{ padding: 26, textAlign: 'center' }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>No movements yet</div>
              <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
                Nothing has been deposited into or spent from this treasury, so the balance is {fmtC(0)}{CINDER}. Member deposits, node construction, operation startups and wages all appear here as lines the moment they happen.
              </div>
            </div>
          ) : (
            <table className="tbl">
              <thead><tr><th className="num">Amount</th><th>Kind</th><th>Note</th><th>Who</th><th>When</th></tr></thead>
              <tbody>
                {log.map((r, i) => {
                  const amt = numC(r.amount);
                  return (
                    <tr key={r.id || ('l' + i)}>
                      <td className="num mono" style={{ color: amt < 0 ? 'var(--blood)' : 'var(--aza)', fontWeight: 600 }}>
                        {(amt > 0 ? '+' : amt < 0 ? '−' : '') + fmtC(Math.abs(amt))}{CINDER}
                      </td>
                      <td><span className="chip flat" style={{ fontSize: 10.5 }}>{String(r.kind || 'entry').replace(/_/g, ' ')}</span></td>
                      <td style={{ fontSize: 12.5 }}>{r.note ? r.note : <span className="muted">—</span>}</td>
                      <td className="mono muted" style={{ fontSize: 11 }}>{r.who || 'Member'}</td>
                      <td className="mono muted" style={{ fontSize: 11 }} title={r.at || ''}>{corpAgo(r.at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="card">
            <div className="row-head">
              <h3>Corp vault</h3>
              <button className="btn" style={{ marginLeft: 'auto', fontSize: 11, padding: '4px 9px' }} onClick={goVault}>Open full vault</button>
            </div>
            <div className="col" style={{ padding: 14, gap: 8, fontSize: 12.5 }}>
              {vHold.length === 0 ? (
                <div className="muted">Nothing in the corp vault yet. Members deposit resources, relics and cards into it from their own Vault.</div>
              ) : (
                <React.Fragment>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="muted">Stacks held</span><span className="mono">{fmtC(vHold.length)}</span>
                  </div>
                  {vKindList.map(k => (
                    <div key={k} className="row" style={{ justifyContent: 'space-between' }}>
                      <span className="muted" style={{ textTransform: 'capitalize' }}>{k}</span>
                      <span className="mono">{fmtC(vKinds[k])}</span>
                    </div>
                  ))}
                  <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', marginTop: 6 }}>Deposited by</div>
                  {vDepList.map(d => (
                    <div key={d} className="row" style={{ justifyContent: 'space-between' }}>
                      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d}</span>
                      <span className="mono muted">{fmtC(vDeps[d])}</span>
                    </div>
                  ))}
                </React.Fragment>
              )}
            </div>
          </div>

          <div className="card">
            <div className="row-head">
              <h3>Members &amp; roles</h3>
              <span className="mono muted" style={{ marginLeft: 'auto', fontSize: 10.5 }}>{count} / {cap}</span>
            </div>
            <div className="col" style={{ padding: 14, gap: 8, fontSize: 12.5 }}>
              {roster.length === 0 && pending.length === 0 && (
                <div className="muted">Roster not loaded yet — it arrives with the next bridge update.</div>
              )}
              {roster.map((m, i) => (
                <div key={m.userId || ('r' + i)} className="row" style={{ gap: 10, padding: '6px 0', borderBottom: '1px dashed var(--line-soft)' }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name || 'Member'}</span>
                  <span className="chip flat" style={{ fontSize: 10.5 }} title={corpRoleDesc(m.role) || ''}>{String(m.role || 'member')}</span>
                </div>
              ))}
              {pending.map((m, i) => (
                <div key={'p' + (m.userId || i)} className="row" style={{ gap: 10, padding: '6px 0', borderBottom: '1px dashed var(--line-soft)', opacity: .72 }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name || 'Member'}</span>
                  <span className="chip flat" style={{ fontSize: 10.5 }} title="Hired — their membership row appears when they next log in">{String(m.role || 'member')} · hired</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// TRADE WINDOW — guild trade with a real counterparty and a real escrow
// ============================================================================
/* WHAT WAS HERE, AND WHY NONE OF IT SURVIVED
   The shipped screen was fabricated end to end: a hardcoded counterparty, a
   "session" id built out of Date.now(), two hardcoded offer values and a
   hardcoded positive balance between them — all three drawn BETWEEN TWO LISTS
   THAT WERE ALWAYS EMPTY — a dashed drop target with no drag-and-drop
   behind it, and a Confirm button with no onClick. A number that disagrees
   with its own source is worse than no number, and this project has already
   had to rip that kind of content out of two other panels.

   ⚠ corp_transfers CANNOT BACK A TRADE — stated plainly here because it looks
   like it can. corp_send_asset INSERTs a row and debits nobody;
   corp_claim_transfer flips a status and credits nobody. index.html's corpSend
   handler says so itself ("do not add a client-side balance change beside
   these calls"), so a transfer today is a NOTE THAT SOMETHING WAS PROMISED and
   moves nothing. A swap needs escrow. That is sql/048_corp_trade_offers.sql,
   which is PENDING — the user applies it by hand in the Supabase SQL editor.
   Until it is applied this screen still shows the real roster and the real
   goods, and refuses to send, naming the file.

   WHAT IS REAL HERE
     · the counterparty list is econ.roster — the corporation's actual members
     · the give side is econ.depositable — the player's actual cards (with art),
       items and resources, minus deck-locked copies — plus their actual Cinder
     · every total is arithmetic over the two lists on screen. An empty offer
       shows 0, because 0 is what it is worth.

   WHAT IS DELIBERATELY MISSING, AND WHY
     · REAL ESTATE and VEHICLES. A deed is a server-side realty_listings /
       ownedHouses row and a vehicle is a real-money purchase mirrored in
       garage_purchases; neither can be escrowed by sql/048 without an
       ownership-transfer path that does not exist. So there is no control for
       them at all, rather than a control that pretends.
     · CARDS and ITEMS on the ASK side. This client cannot enumerate what
       another player holds — there is no server-side inventory to query — so
       the ask side is Cinder plus the real resource catalogue (SALVAGE_RES),
       and goods-for-goods is done with a counter-offer. Inventing a picker of
       "their" cards would be the same defect this rewrite removed. */

// Whole units, always. shell.jsx's fmt() renders 0 as "0.00", and a balance of
// "0.00 Cinder" reads like a rounding artefact rather than the honest zero it
// is. Cinder and unit counts are integers everywhere in the game.
/* 🔢 THE LINE CAP IS NOT COSMETIC. sql/048's _ct_norm raises "at most 20 lines
   per side", so this is the server's number restated, not a UI preference.
   It has to be enforced HERE because the alternative was silent: _jbTradeClean
   in index.html used to .slice(0, 20), so a 25-line offer was debited and sent
   as 20 and the five missing lines were never mentioned to anyone — the totals
   on this screen would have described goods that never entered the escrow.
   Both ends are now loud: the composer will not build the 21st line, and the
   bridge refuses an oversized list instead of trimming it. */
const TRADE_MAX_LINES = 20;

const tradeInt = (n) => {
  const v = Number(n);
  if (!isFinite(v)) return '0';
  return Math.round(v).toLocaleString('en-US');
};

// Card art comes from the bridge (econ.cardArt), which is a BOUNDED map — see
// _jbCardArtMap in index.html. A missing entry means "no art was available",
// so we fall back to the monogram tile rather than drawing someone else's art.
function TradeGlyph({ line, art }) {
  const src = (line && line.kind === 'card' && art) ? art[line.id] : null;
  if (src) {
    return (
      <img src={src} alt="" loading="lazy"
        style={{ width: 34, height: 44, objectFit: 'cover', borderRadius: 3,
                 border: '1px solid var(--line-soft)', background: 'var(--surface-3)', flex: '0 0 auto' }} />
    );
  }
  if (line && line.icon) {
    return <span style={{ fontSize: 20, width: 34, textAlign: 'center', flex: '0 0 auto' }}>{line.icon}</span>;
  }
  return <AssetGlyph asset={{ name: (line && line.name) || '?' }} />;
}

// One line of an offer. `short` marks a line the holder can no longer cover —
// shown rather than hidden, because silently dropping it would make the total
// above disagree with what would actually move.
function TradeLine({ line, art, onRemove, short }) {
  return (
    <div className="row" style={{
      gap: 10, padding: 8, borderRadius: 'var(--radius)', background: 'var(--bg-2)',
      border: '1px solid ' + (short ? 'var(--blood, #a23a4d)' : 'var(--line-soft)'),
    }}>
      <TradeGlyph line={line} art={art} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{line.name}</div>
        <div className="mono muted" style={{ fontSize: 10.5 }}>
          {String(line.kind || '').toUpperCase()}{short ? ' · NOT HELD' : ''}
        </div>
      </div>
      <div className="mono" style={{ fontSize: 13 }}>×{tradeInt(line.qty)}</div>
      {onRemove && <button className="btn sm" onClick={onRemove} title="Remove from the offer">✕</button>}
    </div>
  );
}

function TradeScreen() {
  // The bridge re-posts the whole econ snapshot on every corp refresh. Listen
  // directly instead of relying on a parent re-render: this screen has to be
  // correct about balances, and a stale render here is a wrong number.
  const [, setTick] = useState(0);
  useEffect(() => {
    const on = () => setTick(t => t + 1);
    window.addEventListener('jbdata', on);
    return () => window.removeEventListener('jbdata', on);
  }, []);

  const econ      = (window.__JB && window.__JB.econ) || null;
  const signedIn  = !!(econ && econ.signedIn);
  const corp      = (econ && econ.corp) || null;
  const myUid     = (econ && econ.myUid) || null;
  const dep       = (econ && econ.depositable) || { cards: [], items: [], resources: [] };
  const catalog   = (econ && econ.resourceCatalog) || [];
  const art       = (econ && econ.cardArt) || {};
  const myCinder  = Math.max(0, (econ && econ.cinders) | 0);
  const offers    = (econ && Array.isArray(econ.tradeOffers)) ? econ.tradeOffers : [];
  const ready     = !!(econ && econ.tradeReady);
  const errKind   = (econ && econ.tradeErr) || '';
  const roster    = ((econ && econ.roster) || []).filter(m => m && m.userId && m.userId !== myUid);

  const [partner,    setPartner]    = useState('');
  const [give,       setGive]       = useState([]);
  const [giveCinder, setGiveCinder] = useState(0);
  const [want,       setWant]       = useState([]);
  const [wantCinder, setWantCinder] = useState(0);
  const [note,       setNote]       = useState('');
  const [tab,        setTab]        = useState('resource');
  const [armed,      setArmed]      = useState(false);
  const [askId,      setAskId]      = useState('');
  const [askQty,     setAskQty]     = useState(1);
  /* What the re-clamp below changed behind the player's back, so it can be
     SAID rather than just done — see the note on that effect. */
  const [adjusted,   setAdjusted]   = useState([]);

  // How many of an asset the player can actually put up. Cards count only the
  // copies free of a 40-card deck — the same rule the vault deposit uses, and
  // the same rule index.html re-checks before it debits anything.
  const heldOf = (kind, id) => {
    const src = kind === 'card' ? (dep.cards || []) : kind === 'item' ? (dep.items || []) : (dep.resources || []);
    const row = src.find(x => x && x.id === id);
    if (!row) return 0;
    return kind === 'card' ? (row.free | 0) : (row.qty | 0);
  };
  const inOffer = (kind, id) => {
    const r = give.find(x => x.kind === kind && x.id === id);
    return r ? (r.qty | 0) : 0;
  };

  /* Re-clamp on every bridge push. If the player spends or deposits something
     in another screen while an offer is half-composed, the offer must stop
     claiming it immediately — otherwise the totals on screen describe goods
     that are gone, and the send would be refused at the last moment. */
  const depKey = JSON.stringify([
    (dep.cards || []).map(c => [c.id, c.free | 0]),
    (dep.items || []).map(c => [c.id, c.qty | 0]),
    (dep.resources || []).map(c => [c.id, c.qty | 0]),
  ]);
  useEffect(() => {
    /* ⚠ COMPUTED EAGERLY, NOT INSIDE A setState UPDATER. The first version of
       this collected its notes inside `setGive(g => …)`, which React does not
       run until the next render — so `notes` was still empty on the line that
       read it and the notice could never appear, while the clamp itself worked
       perfectly. A silent-by-accident version of the exact bug this code was
       added to fix, and it passed every parse gate. `give` is in scope and is
       current as of this render, so read it directly. */
    const notes = [];
    let changed = false;
    const out = [];
    give.forEach(l => {
      const cap = heldOf(l.kind, l.id);
      if (cap <= 0) { changed = true; notes.push(l.name + ' — removed, you no longer hold any'); return; }
      if ((l.qty | 0) > cap) {
        changed = true;
        notes.push(l.name + ' — reduced from ' + tradeInt(l.qty) + ' to ' + tradeInt(cap));
        out.push(Object.assign({}, l, { qty: cap }));
      } else out.push(l);
    });
    if (changed) setGive(out);
    const cv = Math.min(Math.max(0, giveCinder | 0), myCinder);
    if (cv !== (giveCinder | 0)) {
      notes.push('Cinder — reduced from ' + tradeInt(giveCinder) + ' to ' + tradeInt(cv));
      setGiveCinder(cv);
    }
    /* ⚠ The clamp itself is NOT the change here; it was always right. What was
       wrong is that it happened in silence: a player who composed 10 Iron in
       this tab and spent 7 in another came back to a line reading 3 with no
       explanation, and "the number changed while I was not looking" is the
       same class of defect as a number that was never real. The offer still
       only ever claims goods that are actually held — the send is what must
       not fail at the last moment — but now the screen says what it did. */
    if (notes.length) setAdjusted(notes);
  }, [depKey, myCinder]);

  // The counterparty must be a real, current member. If they leave the corp
  // mid-compose the selection clears rather than sending into a void.
  useEffect(() => {
    if (partner && !roster.some(m => m.userId === partner)) setPartner('');
  }, [roster.map(m => m.userId).join(','), partner]);

  const addGive = (kind, row, n) => {
    const held = kind === 'card' ? (row.free | 0) : (row.qty | 0);
    const room = Math.max(0, held - inOffer(kind, row.id));
    const q = Math.max(0, Math.min(room, Math.floor(Number(n) || 0)));
    if (q <= 0) return;
    setGive(g => {
      const i = g.findIndex(x => x.kind === kind && x.id === row.id);
      // Topping up a line already on the offer is always allowed; only a NEW
      // line can push past the server's per-side limit.
      if (i < 0 && g.length >= TRADE_MAX_LINES) return g;
      if (i < 0) return g.concat([{ kind, id: row.id, name: row.name || row.id, icon: row.icon || '', qty: q }]);
      const c = g.slice();
      c[i] = Object.assign({}, c[i], { qty: (c[i].qty | 0) + q });
      return c;
    });
  };
  const dropGive = (kind, id) => setGive(g => g.filter(x => !(x.kind === kind && x.id === id)));
  // A side is "full" only for assets not already on it — see TRADE_MAX_LINES.
  const giveFull = (kind, id) => give.length >= TRADE_MAX_LINES && !give.some(x => x.kind === kind && x.id === id);
  const addWant = () => {
    const row = catalog.find(r => r && r.id === askId);
    if (!row) return;
    const q = Math.max(1, Math.min(1000000000, Math.floor(Number(askQty) || 0)));
    setWant(w => {
      const i = w.findIndex(x => x.id === row.id);
      if (i < 0 && w.length >= TRADE_MAX_LINES) return w;
      if (i < 0) return w.concat([{ kind: 'resource', id: row.id, name: row.name || row.id, icon: row.icon || '', qty: q }]);
      const c = w.slice();
      c[i] = Object.assign({}, c[i], { qty: Math.min(1000000000, (c[i].qty | 0) + q) });
      return c;
    });
  };
  const dropWant = (id) => setWant(w => w.filter(x => x.id !== id));

  // ── Totals. Arithmetic over the two lists above, nothing else. ────────────
  const giveUnits   = give.reduce((s, x) => s + (x.qty | 0), 0);
  const wantUnits   = want.reduce((s, x) => s + (x.qty | 0), 0);
  const gc          = Math.max(0, giveCinder | 0);
  const wc          = Math.max(0, wantCinder | 0);
  const cinderDelta = wc - gc;              // what I net in Cinder. 0 - 0 = 0.
  const unitDelta   = wantUnits - giveUnits;

  const overdrawn = give.some(l => (l.qty | 0) > heldOf(l.kind, l.id)) || gc > myCinder;
  const emptyBoth = give.length === 0 && want.length === 0 && gc === 0 && wc === 0;
  const canSend   = signedIn && !!corp && ready && !!partner && !emptyBoth && !overdrawn;

  const act = (p) => { try { window.JB_action && window.JB_action(p); } catch (e) {} };
  const send = () => {
    const to = roster.find(m => m.userId === partner);
    act({
      kind: 'tradePropose', toId: partner, toName: to ? to.name : '',
      give, giveCinder: gc, want, wantCinder: wc, note: note.slice(0, 240),
    });
    setGive([]); setWant([]); setGiveCinder(0); setWantCinder(0); setNote(''); setArmed(false); setAdjusted([]);
  };

  // ── Gates. Honest states, never a composer that cannot do anything. ───────
  if (!econ || !signedIn) {
    return (
      <div className="screen">
        <ScreenHead title="Guild Trade" desc="Swap goods and Cinder with the other members of your corporation, through a server-held escrow." />
        <div className="card" style={{ padding: 28, textAlign: 'center' }}>
          <div className="muted">Sign in inside the game to trade with your corporation.</div>
        </div>
      </div>
    );
  }
  if (!corp) {
    return (
      <div className="screen">
        <ScreenHead title="Guild Trade" desc="Swap goods and Cinder with the other members of your corporation, through a server-held escrow." />
        <div className="card" style={{ padding: 28, textAlign: 'center' }}>
          <div className="muted" style={{ marginBottom: 12 }}>Trading is between members of the same corporation. You are not in one yet.</div>
          <button className="btn primary" onClick={() => { try { window.dispatchEvent(new CustomEvent('jb:open', { detail: 'guild' })); } catch (e) {} }}>
            Open Guild &amp; Hiring
          </button>
        </div>
      </div>
    );
  }

  const depList = tab === 'card' ? (dep.cards || []) : tab === 'item' ? (dep.items || []) : (dep.resources || []);
  const KIND_LABEL = { resource: 'Resources', card: 'Cards', item: 'Items / Equipment' };

  return (
    <div className="screen">
      <ScreenHead
        title={'Guild Trade — ' + corp.name}
        desc="Both sides are held by the server. Your goods leave your stash when you send the offer and come back in full if it is declined or cancelled. Nothing is minted: the total of every asset across the two accounts is the same before and after."
        idTag={corp.tag ? String(corp.tag).toUpperCase() : null}
      />

      {!ready && (
        <div className="card" style={{ padding: 14, marginBottom: 16, borderColor: 'var(--rust)' }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {/* Three distinct states, never collapsed into one: the migration
                is absent, the read failed, or the read has not happened yet.
                Calling the third one a failure is how a boot flicker becomes a
                bug report. */}
            {errKind === 'missing' ? 'Escrow is not installed on the server yet'
              : errKind ? 'Guild trades could not be read'
              : 'Reading this corporation’s trades…'}
          </div>
          <div className="muted" style={{ fontSize: 12.5 }}>
            {errKind === 'missing' ? (
              <span>
                Everything below is real — your corporation's roster, your own goods, your Cinder. Offers cannot be
                sent until <b className="mono">sql/048_corp_trade_offers.sql</b> is applied in the Supabase SQL editor.
                It is written and pending; there is no client-side substitute, because a swap without escrow moves nothing.
              </span>
            ) : errKind ? (
              <span>{errKind} — offers are hidden rather than drawn as an empty list. An empty inbox and a failed read look identical on screen, and this app has shipped that mistake before.</span>
            ) : (
              <span>Waiting on the corporation lookup. Offers appear here once it answers.</span>
            )}
          </div>
        </div>
      )}

      {adjusted.length > 0 && (
        <div className="card" style={{ padding: 12, marginBottom: 16, borderColor: 'var(--rust)' }}>
          <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 13 }}>Your stash changed — the offer was trimmed to match</div>
              {adjusted.map((t, i) => (
                <div key={i} className="mono muted" style={{ fontSize: 11.5 }}>{t}</div>
              ))}
            </div>
            <button className="btn sm ghost" onClick={() => setAdjusted([])}>Dismiss</button>
          </div>
        </div>
      )}

      {/* ── COMPOSER ─────────────────────────────────────────────────────── */}
      <div className="card" style={{ padding: 14, marginBottom: 16 }}>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <span className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase' }}>Trade with</span>
          {roster.length === 0 ? (
            <span className="muted" style={{ fontSize: 12.5 }}>
              You are the only member of {corp.name}. Hire someone from Guild &amp; Hiring and they will appear here.
            </span>
          ) : (
            <select className="input" value={partner} onChange={e => setPartner(e.target.value)} style={{ minWidth: 220 }}>
              <option value="">Pick a member…</option>
              {roster.map(m => (
                <option key={m.userId} value={m.userId}>{m.name} — {String(m.role || 'member').toUpperCase()}</option>
              ))}
            </select>
          )}
          <div style={{ flex: 1 }} />
          <input className="input" value={note} onChange={e => setNote(e.target.value.slice(0, 240))}
            placeholder="Note (optional) — what the deal is for" style={{ minWidth: 240, flex: '1 1 240px' }} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 1fr', gap: 18, alignItems: 'stretch' }}>

        {/* ── MY SIDE ──────────────────────────────────────────────────── */}
        <div className="card">
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line-soft)' }}>
            <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase' }}>You give</div>
            <div style={{ fontSize: 16, fontWeight: 500, marginTop: 2 }}>{(econ.handle || 'You')}</div>
          </div>

          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="row" style={{ gap: 8 }}>
              <span style={{ fontSize: 18 }}>🔥</span>
              <span style={{ flex: 1 }}>Cinder <span className="mono muted" style={{ fontSize: 10.5 }}>· you hold {tradeInt(myCinder)}</span></span>
              <input className="input" type="number" min={0} max={myCinder} value={gc}
                onChange={e => setGiveCinder(Math.max(0, Math.min(myCinder, Math.floor(Number(e.target.value) || 0))))}
                style={{ width: 110, padding: '4px 6px' }} />
            </div>
            {give.length === 0 ? (
              <div className="muted" style={{ fontSize: 12.5, padding: '14px 4px' }}>
                No goods added. Pick from your stash below — only what you actually hold can be added.
              </div>
            ) : give.map(l => (
              <TradeLine key={l.kind + l.id} line={l} art={art}
                short={(l.qty | 0) > heldOf(l.kind, l.id)}
                onRemove={() => dropGive(l.kind, l.id)} />
            ))}
          </div>

          <div style={{ padding: '10px 14px', borderTop: '1px solid var(--line-soft)' }}>
            <div className="row" style={{ gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
              {['resource', 'card', 'item'].map(k => (
                <button key={k} className={'btn sm' + (tab === k ? ' primary' : '')} onClick={() => setTab(k)}>{KIND_LABEL[k]}</button>
              ))}
            </div>
            {depList.length === 0 ? (
              <div className="muted" style={{ fontSize: 12 }}>
                {tab === 'card' ? 'No spare cards — every copy is locked into a 40-card deck.' : 'Nothing of this kind in your stash.'}
              </div>
            ) : (
              <div style={{ maxHeight: 200, overflow: 'auto' }}>
                {depList.map(it => {
                  const held = tab === 'card' ? (it.free | 0) : (it.qty | 0);
                  const room = Math.max(0, held - inOffer(tab, it.id));
                  return (
                    <div key={it.id} className="row" style={{ gap: 8, padding: '5px 0' }}>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5 }}>
                        {it.icon || '📦'} {it.name}
                        <span className="mono muted" style={{ fontSize: 10 }}> · {tradeInt(room)} free</span>
                      </span>
                      <button className="btn sm" disabled={room <= 0 || giveFull(tab, it.id)} onClick={() => addGive(tab, it, 1)}>+1</button>
                      <button className="btn sm" disabled={room <= 0 || giveFull(tab, it.id)} onClick={() => addGive(tab, it, room)}>All</button>
                    </div>
                  );
                })}
              </div>
            )}
            {/* ON SCREEN, not only in the header comment. A player who owns a
                property or a car WILL look for it here, and an unexplained
                absence reads as a bug or as a tab that has not loaded. Saying
                what is missing and why is the honest version of omitting it —
                the alternative is a fourth tab that cannot actually escrow, and
                a control that pretends is the exact defect this rewrite
                removed. */}
            <div className="muted" style={{ fontSize: 11, marginTop: 10, lineHeight: 1.4, borderTop: '1px dashed var(--line-soft)', paddingTop: 8 }}>
              Property and vehicles are not tradeable here. A deed is a server-side listing and a car is a real-money
              purchase; neither has an ownership-transfer path that <b className="mono">sql/048</b> could escrow, so
              there is no control for them rather than one that could not deliver. Sell the deed and trade the Cinder.
            </div>
          </div>

          <div style={{ padding: '10px 14px', borderTop: '1px solid var(--line-soft)', display: 'flex', justifyContent: 'space-between' }}>
            <span className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase' }}>Your side</span>
            <span className="mono" style={{ fontSize: 13 }}>
              🔥 {tradeInt(gc)} · {tradeInt(give.length)}/{TRADE_MAX_LINES} lines · {tradeInt(giveUnits)} units
            </span>
          </div>
        </div>

        {/* ── BALANCE. Arithmetic of the two lists, and nothing else. ───── */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <div style={{ width: 1, flex: 1, background: 'var(--line-soft)' }} />
          <div className="disp" style={{ fontSize: 28 }}>⇄</div>
          <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em' }}>BALANCE</div>
          <div className="disp" style={{ fontSize: 18, textAlign: 'center',
            color: cinderDelta > 0 ? 'oklch(0.78 0.15 145)' : cinderDelta < 0 ? 'var(--blood, #a23a4d)' : 'var(--muted)' }}>
            {cinderDelta > 0 ? '+' : ''}{tradeInt(cinderDelta)}
          </div>
          <div className="mono muted" style={{ fontSize: 10 }}>🔥 Cinder to you</div>
          <div className="mono muted" style={{ fontSize: 10, textAlign: 'center' }}>
            {unitDelta > 0 ? '+' : ''}{tradeInt(unitDelta)} units
          </div>
          {/* No goods valuation is claimed. There is no price for a card or a
              resource anywhere in this game that both players could agree on,
              and inventing one is how the old fixed balance got here. */}
          <div className="muted" style={{ fontSize: 9.5, textAlign: 'center', lineHeight: 1.35 }}>
            Cinder is exact. Goods are counted, not priced — no market valuation exists for them.
          </div>
          <div style={{ width: 1, flex: 1, background: 'var(--line-soft)' }} />
        </div>

        {/* ── THEIR SIDE (what I am asking for) ─────────────────────────── */}
        <div className="card">
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line-soft)' }}>
            <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase' }}>You ask for</div>
            <div style={{ fontSize: 16, fontWeight: 500, marginTop: 2 }}>
              {partner ? (roster.find(m => m.userId === partner) || {}).name : <span className="muted">Nobody selected</span>}
            </div>
          </div>

          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="row" style={{ gap: 8 }}>
              <span style={{ fontSize: 18 }}>🔥</span>
              <span style={{ flex: 1 }}>Cinder</span>
              <input className="input" type="number" min={0} value={wc}
                onChange={e => setWantCinder(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                style={{ width: 110, padding: '4px 6px' }} />
            </div>
            {want.length === 0 ? (
              <div className="muted" style={{ fontSize: 12.5, padding: '14px 4px' }}>
                Nothing asked for yet.
              </div>
            ) : want.map(l => (
              <TradeLine key={l.id} line={l} art={art} onRemove={() => dropWant(l.id)} />
            ))}
          </div>

          <div style={{ padding: '10px 14px', borderTop: '1px solid var(--line-soft)' }}>
            <div className="row" style={{ gap: 6 }}>
              <select className="input" value={askId} onChange={e => setAskId(e.target.value)} style={{ flex: 1, minWidth: 0 }}>
                <option value="">Ask for a resource…</option>
                {catalog.map(r => <option key={r.id} value={r.id}>{r.icon || ''} {r.name}</option>)}
              </select>
              <input className="input" type="number" min={1} value={askQty}
                onChange={e => setAskQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                style={{ width: 84, padding: '4px 6px' }} />
              <button className="btn sm"
                disabled={!askId || (want.length >= TRADE_MAX_LINES && !want.some(x => x.id === askId))}
                onClick={addWant}>Add</button>
            </div>
            {/* Said out loud rather than hidden — see the header note. */}
            <div className="muted" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.4 }}>
              Cinder and resources only. Nothing here can list another player's cards, items, property or vehicles —
              their stash is not readable from this client, and a picker of goods they may not hold would be a guess
              dressed as data. For those, ask in the note and settle it with a counter-offer.
            </div>
          </div>

          <div style={{ padding: '10px 14px', borderTop: '1px solid var(--line-soft)', display: 'flex', justifyContent: 'space-between' }}>
            <span className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase' }}>Their side</span>
            <span className="mono" style={{ fontSize: 13 }}>
              🔥 {tradeInt(wc)} · {tradeInt(want.length)}/{TRADE_MAX_LINES} lines · {tradeInt(wantUnits)} units
            </span>
          </div>
        </div>
      </div>

      {/* ── SEND ─────────────────────────────────────────────────────────── */}
      <div className="card" style={{ marginTop: 18, padding: 14 }}>
        <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
          <span className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase' }}>Escrow</span>
          <span className="muted" style={{ fontSize: 12.5, flex: 1, minWidth: 220 }}>
            Sending moves your side out of your stash and into the corporation's escrow, and writes the trade to the
            corporation ledger. Decline or cancel returns all of it.
          </span>
          <button className="btn ghost" disabled={emptyBoth && !partner}
            onClick={() => { setGive([]); setWant([]); setGiveCinder(0); setWantCinder(0); setNote(''); setArmed(false); setAdjusted([]); }}>
            Clear
          </button>
          {!armed ? (
            <button className="btn primary" disabled={!canSend} onClick={() => setArmed(true)}>
              {!ready ? (errKind === 'missing' ? 'Needs sql/048' : errKind ? 'Trades unavailable' : 'Checking…')
                : !partner ? 'Pick a member' : emptyBoth ? 'Add something to trade' : overdrawn ? 'You no longer hold that' : 'Send offer'}
            </button>
          ) : (
            <button className="btn primary" onClick={send}>Confirm — send to {(roster.find(m => m.userId === partner) || {}).name}</button>
          )}
          {armed && <button className="btn ghost" onClick={() => setArmed(false)}>Back</button>}
        </div>
      </div>

      <TradeOffers offers={offers} myUid={myUid} art={art} heldOf={heldOf} myCinder={myCinder} act={act} ready={ready} />
    </div>
  );
}

// ── Live offers: incoming, outgoing, and anything still owed to the player ──
// Everything here is a row of corp_trade_offers. There is no demo row and no
// placeholder: an empty list means the corporation has never traded.
function TradeOffers({ offers, myUid, art, heldOf, myCinder, act, ready }) {
  if (!ready) return null;
  const open     = offers.filter(o => o.status === 'open');
  const owed     = offers.filter(o => (o.claimable || []).length > 0);
  const settled  = offers.filter(o => o.status !== 'open').slice(0, 12);

  const shortOn = (list) => (list || []).filter(l => heldOf(l.kind, l.id) < (l.qty | 0));

  const Side = ({ label, lines, cinder }) => (
    <div style={{ flex: 1, minWidth: 180 }}>
      <div className="mono muted" style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      {cinder > 0 && <div className="mono" style={{ fontSize: 12.5, marginBottom: 4 }}>🔥 {tradeInt(cinder)} Cinder</div>}
      {lines.length === 0 && cinder <= 0
        ? <div className="muted" style={{ fontSize: 11.5 }}>Nothing</div>
        : lines.map(l => <div key={l.kind + l.id} style={{ marginBottom: 4 }}><TradeLine line={l} art={art} /></div>)}
    </div>
  );

  return (
    <div style={{ marginTop: 22 }}>
      <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 8 }}>
        Offers {offers.length ? '· ' + offers.length : ''}
      </div>

      {offers.length === 0 && (
        <div className="card" style={{ padding: 20 }}>
          <div className="muted" style={{ fontSize: 12.5 }}>No trades yet in this corporation.</div>
        </div>
      )}

      {owed.length > 0 && (
        <div className="card" style={{ padding: 14, marginBottom: 12, borderColor: 'var(--rust)' }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Waiting for you to collect</div>
          <div className="muted" style={{ fontSize: 11.5, marginBottom: 10 }}>
            Delivery is a separate one-shot step so a closed tab cannot lose the goods. Collecting twice is impossible —
            the server flips the flag inside the same statement that hands them over.
          </div>
          {owed.map(o => (
            <div key={'owed' + o.id} className="row" style={{ gap: 10, padding: '8px 0', borderTop: '1px dashed var(--line-soft)', flexWrap: 'wrap' }}>
              <span style={{ flex: 1, minWidth: 160, fontSize: 12.5 }}>
                {o.status === 'accepted' ? 'Trade with ' : 'Returned from '}
                <b>{o.mine ? o.to : o.from}</b>
                <span className="mono muted" style={{ fontSize: 10.5 }}> · {(o.claimable || []).length} {(o.claimable || []).length === 1 ? 'line' : 'lines'}</span>
              </span>
              <button className="btn sm primary" onClick={() => act({ kind: 'tradeClaim', offerId: o.id })}>Collect</button>
            </div>
          ))}
        </div>
      )}

      {open.map(o => {
        const iOwe   = o.incoming ? shortOn(o.want) : [];
        const cantPay = o.incoming && (iOwe.length > 0 || o.wantCinder > myCinder);
        return (
          <div key={o.id} className="card" style={{ padding: 14, marginBottom: 12 }}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
              <span style={{ fontWeight: 500 }}>
                {o.incoming ? <>Offer from <b>{o.from}</b></> : <>Your offer to <b>{o.to}</b></>}
              </span>
              <span className="mono muted" style={{ fontSize: 10.5 }}>
                {o.at ? new Date(o.at).toLocaleString() : ''}
              </span>
            </div>
            {o.note && <div className="muted" style={{ fontSize: 12, marginBottom: 10, fontStyle: 'italic' }}>“{o.note}”</div>}
            <div className="row" style={{ gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <Side label={o.incoming ? 'They give' : 'You give (in escrow)'} lines={o.give} cinder={o.giveCinder} />
              <Side label={o.incoming ? 'They want from you' : 'You asked for'} lines={o.want} cinder={o.wantCinder} />
            </div>
            {o.incoming && cantPay && (
              <div className="muted" style={{ fontSize: 11.5, marginTop: 8, color: 'var(--blood, #a23a4d)' }}>
                You cannot cover this: {iOwe.map(l => l.name + ' ×' + tradeInt(l.qty)).join(', ')}
                {o.wantCinder > myCinder ? (iOwe.length ? ', and ' : '') + tradeInt(o.wantCinder - myCinder) + ' more Cinder' : ''}.
              </div>
            )}
            <div className="row" style={{ gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
              {o.incoming ? (
                <>
                  <button className="btn" onClick={() => act({ kind: 'tradeDecline', offerId: o.id })}>Decline</button>
                  <button className="btn primary" disabled={cantPay} onClick={() => act({ kind: 'tradeAccept', offerId: o.id })}>
                    {cantPay ? 'Cannot cover it' : 'Accept trade'}
                  </button>
                </>
              ) : (
                <button className="btn" onClick={() => act({ kind: 'tradeCancel', offerId: o.id })}>Cancel — take my escrow back</button>
              )}
            </div>
          </div>
        );
      })}

      {settled.length > 0 && (
        <div className="card" style={{ padding: 14 }}>
          <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 8 }}>Settled</div>
          {settled.map(o => (
            <div key={'s' + o.id} className="row" style={{ justifyContent: 'space-between', padding: '6px 0', borderTop: '1px dashed var(--line-soft)' }}>
              <span style={{ fontSize: 12.5 }}>{o.from} ⇄ {o.to}</span>
              <span className="mono muted" style={{ fontSize: 10.5 }}>
                {String(o.status).toUpperCase()} · {o.settledAt ? new Date(o.settledAt).toLocaleDateString() : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
// ============================================================================
// RELIC DETAIL
// ============================================================================

function RelicDetailScreen({ relicId, onBack }) {
  const { ASSETS, HISTORY } = window.ECON;
  const r = ASSETS.find(a => a.id === relicId) || ASSETS.find(a => a.kind === 'relic');
  if (!r) {
    return (
      <div className="screen">
        <ScreenHead title="Relic" desc="Relic detail." right={<button className="btn ghost" onClick={onBack}>← Back</button>} />
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>No relic to display.</div>
      </div>
    );
  }
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
            {/* The TRADABLE / RENTABLE chips that were here were asserted of
                every relic unconditionally, and neither is true: there is no
                rental system, and the guild trade below can only escrow cards,
                items, resources and Cinder. A capability chip that names a
                feature the app does not have is the same defect as a fabricated
                price — see the header of the Trade Window. */}
          </div>

          <p style={{ fontSize: 16, color: 'var(--fg-2)', marginTop: 24, maxWidth: 580 }}>
            {r.effect}. Equippable to {r.slot === 'camp' ? 'a controlled property' : r.slot === 'hero' ? 'a hero in your roster' : 'your corporation'}.
            Buffs apply persistently while the relic remains equipped and the holder retains ownership.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginTop: 28 }}>
            {/* Only the three fields the relic row actually carries. Three more
                Specs were here — an insurance tier and payout percentage, a
                per-cycle rental price in Aza, and a "market floor" — all three
                hardcoded, sitting under a panel headed "Immutable". They are
                the same fabricated-number defect the Trade Window above was
                rebuilt to remove, and the floor figure was literally one of the
                values that screen's fake balance was built from. Removed rather
                than re-sourced: there is no relic market, no rental system and
                no insurance anywhere in the game to read a real number from.
                ⚠ The old digits are deliberately NOT quoted in this comment —
                they are what a reviewer greps public/corp/ for, and a hit
                inside an explanation is indistinguishable from a live one. */}
            <Spec label="Equipped to" value={r.equipped || '— unequipped —'} />
            <Spec label="Original finder" value={r.foundBy || 'Unknown'} />
            <Spec label="Origin event" value={r.origin || '—'} />
          </div>

          {/* The four buttons that were here — List on marketplace / Rent out /
              Send to player / Move to corp vault — had no onClick at all, the
              same dead Confirm the Trade Window shipped. Three of the four name
              systems that do not exist; the fourth (corp vault) does exist and
              is reached from the Vault screen, which owns that flow and its
              server call. A control that does nothing is worse than no control:
              it reads as a broken feature rather than an absent one. */}
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

// ============================================================================
// OPERATIONS — corporate industry registry. ONLY corporations can own / fund
// operations (funding lands in a later update). Styled as a dark-warm web
// portal (browser chrome + search + sponsored row + tile grid).
//
// 🔴 THIS ARRAY USED TO CARRY A SECOND COPY OF THE ECONOMY, AND IT LIED.
//    Every row had `name`, `produces` and a `startup` string — "350,000 Cinder
//    · 6k Metal" on the Construction Co., "400,000 Cinder · 4k Metal" on
//    mining — and each one sat under a note saying "display copy only, keep
//    it in step by eye". Nobody did. Measured on this branch: OPS_ECON prices
//    the Construction Co. at 0 (a product decision — see OPS_FREE_LICENCE in
//    index.html) and this array still said 350,000; trashcrusher yields
//    recycledMetal / plastic / glass and its `produces` said 'Recycled Metal',
//    'Plastic', 'Glass' only because somebody typed them twice; construction's
//    said 'Concrete', 'Steel' — two resources the operation has never
//    produced (it yields metal). The card only fell back to the string while
//    the econ payload was in flight, so the wrong number showed for a
//    moment and then flickered to the right one, which is worse than either.
//    Nothing in the array below is a price, a product or a name any more:
//    those come from econ.opEcon (the live _opEcon() row, overrides and free
//    licences applied) and econ.opLabels (OP_LABELS) through opView() below,
//    and before the payload lands the card shows a neutral placeholder rather
//    than a number that might be wrong.
//    `maint` went with them — it was rendered nowhere, and where it could be
//    checked it was mostly wrong: mining's "Fuel 200/d · Supplies 150/d"
//    against an OPS_ECON row with no inputs at all, construction's "Supplies
//    220/d" against fuel 0.5/wkr-hr (only genelab, restaurant and transport
//    agreed with the table).
//
// ⚠ WHAT IS STILL HARDCODED HERE, AND WHY. `id` is the join key to OPS_ECON;
//   `cat`, `icon`, `focus`, `risk`, `illicit` and `tip` are copy the economy
//   table does not carry. So the catalog is STILL a hand-kept list of ids: a
//   type added to OPS_ECON in index.html is invisible until it is listed here
//   too (the bug that shipped five times — _opscheck.mjs is the gate for it,
//   and it reads the `id:` of every row, so keep that shape).
// ============================================================================
const OPERATIONS = [
  { id: 'mining',       cat: 'Industry',  icon: '⛏',  focus: 'Metal & raw extraction',     risk: 'Low' },
  { id: 'oil',          cat: 'Energy',    icon: '🛢', focus: 'Fuel production',            risk: 'Medium' },
  { id: 'construction', cat: 'Industry',  icon: '🏗', focus: 'Build materials',            risk: 'Low' },
  { id: 'medical',      cat: 'Medical',   icon: '⚕️', focus: 'Medicine & supplies',        risk: 'Low' },
  { id: 'agri',         cat: 'Medical',   icon: '🌾', focus: 'Food & biomass',             risk: 'Low' },
  { id: 'research',     cat: 'Research',  icon: '🔬', focus: 'Data, relics, mutations',    risk: 'High' },
  { id: 'smuggling',    cat: 'Illicit',   icon: '🕶', focus: 'Contraband logistics',       risk: 'SCP RAID', illicit: true },
  { id: 'salvage',      cat: 'Logistics', icon: '♻',  focus: 'Reclaim & components',       risk: 'Low' },
  /* ♻️ THE TRASH CRUSHER — AND I SHIPPED THE EXACT BUG THE NOTES BELOW WARN
     ABOUT. The warehouse note says it plainly: "this catalog is hardcoded here,
     so a type added to OPS_ECON in index.html is invisible until it is listed in
     this array too." The transport note counts the casualties — Warehouse,
     Weapon Smith, Restaurant, Transport. v121u3 added the Trash Crusher to
     OPS_ECON, OP_LABELS, OP_BP, OP_ECO_MAP and COMPANY_PAGES, ran the economy
     gauntlet green, verified five files at the edge — and never touched this
     one. So the operation was priced, labelled, wired to the haulage board and
     IMPOSSIBLE TO BUY, which is precisely what those two comments predict.
     Reported as "not showing up recycling business or Trash Crusher in
     operation where it should be". Fifth to hit it, and the first to actually
     reach players.
     ⚠ Sits beside Salvage on purpose. They run the same `recycler` industry and
       a player choosing between them is choosing a PRODUCT: Salvage yields
       metal, this yields the plastic and glass recyclate nothing else makes —
       and the card's product chips now read that straight off OPS_ECON.yields,
       so the two lists cannot drift apart. */
  { id: 'trashcrusher', cat: 'Logistics', icon: '♻️', focus: 'Bale the district’s waste',     risk: 'Low', tip: 'The only producer of Recycled Plastic and Recycled Glass. Its bales are bulky and low-value, so the plant pays when somebody else moves them — post a scrap run on the Haulage Board and let a Transportation Company haul it.' },
  { id: 'gas',          cat: 'Energy',    icon: '⛽', focus: 'Fuel retail & distribution', risk: 'Low' },
  { id: 'cars',         cat: 'Logistics', icon: '🚗', focus: 'Vehicles & spare parts',     risk: 'Low' },
  { id: 'fishing',      cat: 'Medical',   icon: '🎣', focus: 'Seafood & provisions',       risk: 'Low' },
  /* 🥫 THE FISH CANNERY (WOODS_FISHING_HANDOFF): the op that eats the catch — 2
     fresh fish an hour per worker become 2.8 food, a better ratio than the Cold
     Storage bench. Added here as well as in OPS_ECON so it can be bought. */
  { id: 'cannery',      cat: 'Medical',   icon: '🥫', tip: 'Gutting lines and brine tanks. Eats the fleet\'s Fresh Fish — 2 per worker-hour — and packs 2.8 food from it, a better ratio than the Cold Storage bench. Fish come from the Fishing Company, the live trip and fleet expeditions.', focus: 'Rations from the catch', risk: 'Low' },
  { id: 'cardshop',     cat: 'Retail',    icon: '🃏', focus: 'Open your own card storefront', risk: 'Low' },
  { id: 'dojo',         cat: 'Retail',    icon: '🥋', focus: 'Train & resell moves to players', risk: 'Low' },
  /* 🍔 THE RESTAURANT. Owning it puts the Mythic Kitchen in My Companies
     (COMPANY_PAGES in shell.jsx) — the same sidebar hook Woods Fishing and
     the Weapon Smith use. Its feedstock is FOOD, which is what the player's
     own Agricultural Op. and city produce, so the two businesses feed each
     other rather than sitting side by side. */
  { id: 'restaurant',   cat: 'Retail',    icon: '🍔', tip: 'Owning a Restaurant multiplies your FOOD production 20x across every operation that yields it, and puts the Mythic Kitchen in My Companies. Every order you serve clean pays Cinder AND returns food to your stash. Feedstock: 1.0 food per worker-hour.', focus: 'Serve the ruin · run the Mythic Kitchen', risk: 'Low' },
  /* 🚛 THE TRANSPORTATION COMPANY. Added HERE and not only in OPS_ECON,
     because the branch this was ported from touches index.html and never this
     file — which would have shipped a charter that is priced, labelled and
     impossible to buy. Fourth operation to hit that: Warehouse, Weapon Smith,
     Restaurant, and this one caught before it shipped rather than after.
     ⚠ Trucks are NOT bought with this licence. The charter buys the right to
       haul; rigs come from Prince Portfolios or the player vehicle market. */
  /* 🌾 THE FEED OPERATION — priced two ways (OPS_ECON.feed: 1,500,000 🔥 or 55 ◈).
     Added HERE as well as in OPS_ECON, for the reason the Transportation Company
     row below records: a charter that is priced and labelled but not in this
     catalogue cannot be bought. */
  { id: 'feed',         cat: 'Agriculture', icon: '🌾', tip: 'Mill rations and water into Animal Feed at industrial scale. Every pen on the Homestead Farm eats it, the Truck Yard\'s bulk-feed rigs haul it, and the farm itself opens from this row in My Companies. Founded for 1,500,000 Cinder — or 55 Aza.', focus: 'Feed the farms', risk: 'Low' },
  { id: 'transport',    cat: 'Logistics', icon: '🚛', tip: 'Haul freight between cities for a fee. The charter is the licence to operate — TRUCKS are bought separately from Prince Portfolios or the player vehicle market. Burns 1.4 fuel per worker-hour, so a haulier depends on another player running a Fuel Rig.', focus: 'Move freight for other companies', risk: 'Medium' },
  // 🏦 The only operation with an ALTERNATE price: the Cinder figure the card
  // prints comes from OPS_ECON like every other row, OR a $200 stake in
  // Mythic Token (2,000 MT at $0.10). The stake is locked, not spent — see
  // BANK_CHARTER_MT in index.html; this card does not price the stake.
  { id: 'bank',         cat: 'Finance',   icon: '🏦', focus: 'Lend to players, hold deposits', risk: 'Medium' },
  // 📦 The storage business. Its product is CAPACITY, not output — every
  // worker you staff raises your resource ceiling, which is the answer to
  // STASH FULL. This catalog is hardcoded here, so a type added to OPS_ECON in
  // index.html is invisible until it is listed in this array too.
  { id: 'warehouse',    cat: 'Logistics', icon: '📦', focus: 'Raise your resource storage ceiling', risk: 'Low' },
  /* 🚌🚆 PUBLIC TRANSPORT. Owning one of these unlocks the city builder's
     transit layer: the Bus Company lets you put up stops and draw bus routes,
     the Rail Operator lets you lay track, raise stations and run trains. The
     price a player is charged comes from OPS_ECON via _opEcon() in
     index.html, which is also what the card's own buy button reads. See the
     warehouse note above: this catalog is hardcoded, so a type added to
     OPS_ECON is invisible until it is listed here too. */
  /* 🔧 THE WEAPON SMITH. Owning it unlocks the crafting bench (the sidebar
     entry appears under My Companies via COMPANY_PAGES) and staffing it is the
     only industrial source of weaponParts. It was missing from this array
     entirely, so it existed in OPS_ECON and was unbuyable — exactly the failure
     the warehouse note above warns about. */
  /* 🧬 THE GENETICS LAB — SIXTH VICTIM OF THE HARDCODED-CATALOG BUG, and the
     oldest. It has been priced in OPS_ECON (550,000, dna 2.0/wkr-hr) with a
     label in OP_LABELS and a whole cloning panel keyed off it, and it has never
     had a card here, so it could not be bought. 111 operations are owned across
     20 types and NOT ONE is a genelab — nobody bought it because nobody could.
     That is not a cosmetic gap. index.html's clone-cost note is explicit:
     "The Genetics Lab operation (OPS_ECON.genelab) is the counterpart: it is the
     licence that unlocks this panel AND the industrial DNA source that makes
     these numbers reachable. Change one, change the other, or cloning silently
     dies." Clone prices were raised sixty-fold against a DNA source that could
     not be purchased, so cloning had silently died exactly as predicted.
     Found by _opscheck.mjs on its first run — which is the argument for the
     gate: five of these were found by players or by luck, this one by a check. */
  { id: 'genelab',      cat: 'Research',  icon: '🧬', focus: 'Industrial DNA & cloning',   risk: 'Medium', tip: 'The licence for the cloning bench AND the only industrial source of DNA. Clone costs run 180–3,600 DNA, which a trickle cannot cover — this is what makes them reachable.' },
  { id: 'weaponsmith',  cat: 'Industry',  icon: '🔧', focus: 'Build guns and blades at your own bench', risk: 'Low' },
  { id: 'bus',          cat: 'Logistics', icon: '🚌', focus: 'Move your citizens without cars',      risk: 'Low' },
  { id: 'rail',         cat: 'Logistics', icon: '🚆', focus: 'Track, stations and rolling stock',    risk: 'Medium' },
];

/* 🏷 A resource id the way a player reads it. The econ payload carries names
   only for resources the player HOLDS (econ.resources is _jbResourceList(),
   qty > 0), so a yield the player has never stocked — recycledMetal on a
   fresh account — has no name on the wire. Splitting the camelCase id is a
   derivation, not a second table: `recycledMetal` → "Recycled Metal",
   `memoryShards` → "Memory Shards", and an id of three letters or fewer is an
   initialism (`dna` → "DNA"). It is deliberately NOT a map of ids to names —
   that would be the same drift this file just got rid of. */
function opResLabel(rid, econ) {
  try {
    const held = (econ && Array.isArray(econ.resources)) ? econ.resources.find(r => r && r.id === rid) : null;
    if (held && held.name) return String(held.name);
  } catch (e) {}
  const s = String(rid || '');
  if (s.length <= 3) return s.toUpperCase();
  return s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
}

/* 🧾 THE CARD'S FACE, DERIVED. Everything a card prints that is a fact about
   the economy — its name, what it yields, what it costs — comes from the
   payload, and the same function feeds the search box and the Random button so
   a player can search by the name the card actually shows.
     name      OP_LABELS via econ.opLabels; before the payload lands it is the
               raw id, the same degraded answer every other OP_LABELS consumer
               in index.html gives (the shop once sold a company called
               'trashcrusher' for exactly this reason). Never a name typed here.
     produces  the keys of the live row's `yields`, labelled — so it EQUALS the
               econ table by construction. An op that yields no resource (bank,
               dojo, restaurant — Cinder over the counter) gets no chips, and
               the Output row below the chips already prints its Cinder rate.
     startup   0 is a FREE licence (OPS_FREE_LICENCE — the Construction Co.),
               and it must READ as free: "0 🔥" beside a Fund button looks like a
               broken price. Anything else is the live figure, and the moment
               before the payload lands is a dash, not a guess. */
function opView(o, econ) {
  const E = econ || {};
  const oe = (E.opEcon || {})[o.id] || null;
  const name = ((E.opLabels || {})[o.id]) || o.id;
  const produces = (oe && oe.yields && typeof oe.yields === 'object')
    ? Object.keys(oe.yields).map(rid => opResLabel(rid, E)) : [];
  const startup = oe ? (oe.startup | 0) : null;
  /* ◈ Two prices when the op has two — "The Feed Operation should cost 55 aza coin
     or 1.5 million cinder": the line says both, on the card and in the header. */
  const aza = oe ? (oe.azaStartup | 0) : 0;
  const startupText = startup == null ? '—' : startup === 0 ? 'FREE' : (startup.toLocaleString() + ' 🔥' + (aza > 0 ? ' · or ' + aza + ' ◈ Aza' : ''));
  return { oe, name, produces, startup, startupText };
}
const OP_CATS = ['All', 'Industry', 'Energy', 'Medical', 'Research', 'Logistics', 'Retail', 'Finance', 'Illicit'];

function OperationsScreen({ econ }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('All');
  const corp = econ && econ.corp;
  const hasCorp = !!corp;
  // ⏳ "We have not asked the server yet" is NOT "you have no corporation".
  // The parent sets econ.corpChecked once corpEnsure() has actually completed a
  // lookup; until then a real owner would be shown a RESTRICTED banner telling
  // them individuals cannot own industry, which is both wrong and alarming.
  // This only softens the MESSAGE — the buy button stays disabled either way.
  const checking = !!(econ && econ.signedIn && !corp && !econ.corpChecked);
  /* 🔴 This printed a hardcoded seven-figure Aza total — a figure nothing
     produced, in a currency the treasury does not even hold. It is now the
     SAME econ.corpTreasury the Corp Treasury screen headlines and the SAME
     field the 'Fund from Treasury' button below gates spending on, so the
     three move together by construction. corpTreasuryKnown === false means
     the read failed; `undefined` (an older parent) is treated as fine. */
  const treasury = !corp ? (checking ? 'CHECKING…' : 'NO CORPORATION')
    : (econ && econ.corpTreasuryKnown === false) ? 'TREASURY UNREAD'
    : (fmtC(numC(econ && econ.corpTreasury)) + ' 🔥');
  const ql = q.trim().toLowerCase();
  /* The search matches the name and the product chips the card actually
     shows — both derived from the payload by opView() — so "glass" finds the
     Trash Crusher because OPS_ECON says it yields glass, not because a list
     here said so. */
  const rows = OPERATIONS.filter(o => {
    if (cat !== 'All' && o.cat !== cat) return false;
    if (!ql) return true;
    const v = opView(o, econ);
    return v.name.toLowerCase().includes(ql) || o.focus.toLowerCase().includes(ql) || v.produces.join(' ').toLowerCase().includes(ql);
  });
  const sponsored = OPERATIONS.slice(0, 3);

  const navBtn = (t) => (
    <span style={{ width: 26, height: 26, display: 'grid', placeItems: 'center', borderRadius: 4, border: '1px solid var(--line-soft)', color: 'var(--muted)', fontSize: 12 }}>{t}</span>
  );

  return (
    <div className="screen">
      {/* Browser chrome */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 14 }}>
        <div className="row" style={{ gap: 8, padding: '10px 12px', background: 'var(--bg-2)', borderBottom: '1px solid var(--line-soft)' }}>
          {navBtn('◂')}{navBtn('▸')}{navBtn('⟳')}{navBtn('⌂')}
          <div className="row" style={{ flex: 1, gap: 8, padding: '6px 12px', background: 'var(--bg)', border: '1px solid var(--line-soft)', borderRadius: 4, fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--muted)' }}>
            <span style={{ color: 'var(--toxic)' }}>⛓</span> operations.scp/registry
          </div>
          <span className="mono" style={{ fontSize: 12, color: hasCorp ? 'var(--aza)' : 'var(--toxic)' }}>$ {treasury}</span>
        </div>

        {/* Brand + search */}
        <div style={{ padding: '20px 22px', background: 'linear-gradient(180deg, color-mix(in srgb, var(--rust) 14%, var(--bg-2)), var(--bg-2))', borderBottom: '1px solid var(--line-soft)' }}>
          <div className="row" style={{ alignItems: 'baseline', gap: 10, marginBottom: 14 }}>
            <span className="disp" style={{ fontSize: 26, fontWeight: 700, color: 'var(--rust)' }}>OperaFind</span>
            <span className="muted" style={{ fontSize: 12 }}>· the corporate industry registry</span>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <input className="input" placeholder="Search operations, output, focus…" value={q} onChange={e => setQ(e.target.value)} style={{ flex: 1, fontSize: 14, padding: '10px 14px' }} />
            <button className="btn primary" onClick={() => setQ('')}>{q ? 'Clear' : 'Search'}</button>
            <button className="btn" onClick={() => { const r = OPERATIONS[Math.floor(Math.random() * OPERATIONS.length)]; setQ(opView(r, econ).name); }}>Random</button>
          </div>
          <div className="row" style={{ gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
            {OP_CATS.map(c => (
              <button key={c} className={'chip' + (cat === c ? '' : ' flat')} onClick={() => setCat(c)}
                style={{ cursor: 'pointer', border: '1px solid ' + (cat === c ? 'var(--rust)' : 'var(--line-soft)'), color: cat === c ? 'var(--rust)' : 'var(--muted)' }}>
                {c}
              </button>
            ))}
          </div>
        </div>
      </div>

      {checking && (
        <div className="card flat" style={{ padding: 14, marginBottom: 14 }}>
          <div className="mono" style={{ fontSize: 10.5, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 4 }}>Checking</div>
          <div style={{ fontSize: 13 }}>Looking up your corporation registration…</div>
        </div>
      )}
      {!hasCorp && !checking && (
        <div className="card flat" style={{ padding: 14, marginBottom: 14, borderColor: 'var(--toxic-soft)' }}>
          <div className="mono" style={{ fontSize: 10.5, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--toxic)', marginBottom: 4 }}>Restricted</div>
          <div style={{ fontSize: 13 }}>Only <b>corporations</b> can own, fund and operate industry — individuals cannot. Found or join one via <b>Guild &amp; Hiring</b>, then operations unlock here.</div>
        </div>
      )}

      {/* Sponsored row */}
      <div className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.14em', textTransform: 'uppercase', margin: '4px 2px 8px' }}>Featured operations</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 18 }}>
        {sponsored.map(o => {
          const photo = (window.JB_art && window.JB_art('op', o.id)) || '';
          const adm = !!(window.JB_isAdmin && window.JB_isAdmin());
          const name = opView(o, econ).name;
          return (
            <div key={o.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ position: 'relative', height: 132, borderBottom: '1px solid var(--line-soft)', background: photo ? 'transparent' : 'linear-gradient(135deg, color-mix(in srgb, var(--rust) 30%, var(--bg-3)), var(--bg-3))', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
                {photo
                  ? <img src={photo} alt={name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <div style={{ fontSize: 34 }}>{o.icon}</div>}
                <div className="disp" style={{ position: 'relative', fontWeight: 700, fontSize: 16, color: '#fff', textShadow: '0 2px 8px rgba(0,0,0,.85)', alignSelf: 'flex-end', padding: '0 0 10px' }}>{name}</div>
                {adm && (
                  <button className="btn sm" onClick={() => window.JB_uploadArt('op', o.id)}
                    style={{ position: 'absolute', top: 8, right: 8, zIndex: 2 }}>📷 {photo ? 'Replace' : 'Add photo'}</button>
                )}
              </div>
              <div style={{ padding: '10px 14px' }}>
                <div className="mono muted" style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase' }}>Sponsored · {o.cat}</div>
                {/* 🛈 title=, the same hover this file already uses 31 times. Falls
                    back to focus so an op without a tip is unchanged. */}
                <div className="muted" title={o.tip || o.focus} style={{ fontSize: 12, marginTop: 4 }}>{o.focus}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Operation grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 12 }}>
        {rows.map(o => {
          const photo = (window.JB_art && window.JB_art('op', o.id)) || '';
          const adm = !!(window.JB_isAdmin && window.JB_isAdmin());
          const E = econ || {};
          // Name, product chips and the startup line — see opView(). `oe` is
          // the live _opEcon() row the bridge sent, null until the payload lands.
          const view = opView(o, E);
          const oe = view.oe;
          const owned = (E.operations || []).find(x => x.op_type === o.id) || null;
          const isOwner = !!E.amOwner;
          // The number every Fund/Found button below gates on. Same numC as
          // the headline and the header readout, so all three agree exactly.
          const treasury = numC(E.corpTreasury);
          const poolFree = Math.max(0, (E.laborPool | 0) - (E.operations || []).reduce((s, x) => s + (x.workers | 0), 0));
          const fmtH = (ms) => { ms = ms || 0; if (ms <= 0) return 'ready'; const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000); return h > 0 ? h + 'h ' + m + 'm' : m + 'm'; };
          const act = (p) => { try { window.JB_action && window.JB_action(p); } catch (e) {} };
          return (
          <div key={o.id} className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column' }}>
            <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
              <div style={{ width: 46, height: 46, borderRadius: 6, display: 'grid', placeItems: 'center', fontSize: 24, background: 'var(--bg-3)', border: '1px solid var(--line-soft)', overflow: 'hidden' }}>
                {photo ? <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : o.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="disp" style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.15 }}>{view.name}</div>
                <div className="mono muted" style={{ fontSize: 11, marginTop: 2 }}>{o.cat} · risk: <span style={{ color: o.illicit ? 'var(--toxic)' : 'var(--muted)' }}>{o.risk}</span></div>
              </div>
              {adm && <button className="btn sm" onClick={() => window.JB_uploadArt('op', o.id)}>📷</button>}
            </div>
            <div className="muted" title={o.tip || o.focus} style={{ fontSize: 12.5, margin: '10px 0', minHeight: 18 }}>{o.focus}</div>
            {/* Product chips are OPS_ECON.yields, labelled — nothing else. An op
                with no resource yield has no chips, and before the payload
                lands there are none either: an empty row, not a guess. */}
            {view.produces.length > 0 && (
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                {view.produces.map(p => <span key={p} className="chip flat" style={{ fontSize: 10.5 }}>{p}</span>)}
              </div>
            )}
            {/* 🧹 The stat block sits at the bottom of a flex column so neighbouring
                cards line up; rows share one dashed rule and one padding. */}
            <div className="card flat" style={{ padding: 10, fontSize: 11.5, marginTop: 'auto' }}>
              {!owned && (
                <div className="row" style={{ justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px dashed var(--line-soft)' }}>
                  <span className="muted">Startup (Treasury)</span>
                  <span className="mono" title={oe ? '' : 'Price arrives with the economy payload'}
                    style={{ color: view.startup === 0 ? 'var(--aza)' : undefined }}>{view.startupText}</span>
                </div>
              )}
              {/* ⚠ These read straight off the bridged OPS_ECON row. A row that
                  is missing one of these numbers used to throw inside render and
                  React unmounted the WHOLE app — a blank Just Business, not a
                  missing line. `| 0` costs nothing and cannot crash. */}
              {oe && (
                <div className="row" style={{ justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px dashed var(--line-soft)' }}>
                  <span className="muted">Wages</span>
                  <span className="mono">{(oe.salaryPerWorkerHr | 0).toLocaleString()} 🔥 / worker·hr</span>
                </div>
              )}
              {oe && (
                <div className="row" style={{ justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px dashed var(--line-soft)' }}>
                  <span className="muted">Output</span>
                  <span className="mono">{(oe.ratePerWorkerHr | 0).toLocaleString()} 🔥 / worker·hr</span>
                </div>
              )}
              {oe && oe.yields && (
                <div className="row" style={{ justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px dashed var(--line-soft)' }}>
                  <span className="muted">Resource yield</span>
                  <span className="mono" style={{ color: 'var(--toxic)' }}>{Object.keys(oe.yields).map(k => oe.yields[k] + ' ' + k).join(' · ')} / wkr·hr</span>
                </div>
              )}
              {/* 🏭 SUPPLY CHAIN. Secondary industry consumes resources and throttles
                  when short. Without these rows a player sees reduced output and no
                  cause — which is worse than not having the mechanic at all. */}
              {oe && oe.inputs && (
                <div className="row" style={{ justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px dashed var(--line-soft)' }}>
                  <span className="muted">Consumes</span>
                  <span className="mono" style={{ color: 'var(--warn, #e0a86a)' }}>{Object.keys(oe.inputs).map(k => oe.inputs[k] + ' ' + k).join(' · ')} / wkr·hr</span>
                </div>
              )}
              {owned && (
                <React.Fragment>
                  {typeof owned.supplyPct === 'number' && owned.supplyPct < 100 ? (
                    <div className="row" style={{ justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px dashed var(--line-soft)' }}>
                      <span className="muted">⚠ Supply</span>
                      <span className="mono" style={{ color: owned.supplyPct === 0 ? '#e24842' : '#e0a86a' }}>
                        {owned.supplyPct === 0
                          ? 'STALLED — out of ' + (owned.shortOf || 'inputs')
                          : 'running at ' + owned.supplyPct + '% — short of ' + (owned.shortOf || 'inputs')}
                      </span>
                    </div>
                  ) : null}
                  {/* 🏙 SITED IN A CITY. The other half of the ownership gate: the
                      build menu tells a city player that operations exist, and this
                      tells an operations player that the city exists. An unsited op
                      is unchanged in every number above — siting only ever adds. */}
                  <div className="row" style={{ justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px dashed var(--line-soft)' }}>
                    <span className="muted">🏙 City plot</span>
                    <span className="mono" style={{ color: owned.sited ? 'var(--aza)' : 'var(--muted, #8a8272)' }}>
                      {owned.sited
                        ? (owned.siteEffPct > 0 ? 'SITED — +' + owned.siteEffPct + '% output' : 'SITED')
                        : 'not sited — place it in your city for a plot bonus'}
                    </span>
                  </div>
                  <div className="row" style={{ justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px dashed var(--line-soft)' }}>
                    <span className="muted">Net accrued</span>
                    <span className="mono" style={{ color: 'var(--aza)' }}>+{(owned.net | 0).toLocaleString()} 🔥</span>
                  </div>
                  {owned.yieldStr ? (
                    <div className="row" style={{ justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px dashed var(--line-soft)' }}>
                      <span className="muted">Resources accrued</span>
                      <span className="mono" style={{ color: 'var(--toxic)' }}>{owned.yieldStr}</span>
                    </div>
                  ) : null}
                  {owned.inputStr ? (
                    <div className="row" style={{ justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px dashed var(--line-soft)' }}>
                      <span className="muted">Will consume</span>
                      <span className="mono" style={{ color: '#e0a86a' }}>{owned.inputStr}</span>
                    </div>
                  ) : null}
                  <div className="row" style={{ justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px dashed var(--line-soft)' }}>
                    <span className="muted">Settles in</span>
                    <span className="mono">{fmtH(owned.cdLeftMs)}</span>
                  </div>
                </React.Fragment>
              )}
            </div>

            {!hasCorp && (
              <button className="btn" disabled style={{ width: '100%', marginTop: 10, opacity: 0.7, cursor: 'default' }}>{checking ? 'Checking your corporation…' : 'Corporation required'}</button>
            )}
            {hasCorp && !owned && (() => {
              /* `treasury` above carried a comment claiming every Fund button
                 gated on it, and was then never referenced — so the button was
                 live at any balance and the only refusal was a toast from the
                 parent AFTER the click. The real server-side gate is
                 `_jbNum(Corp.treasury) < e.startup` in index.html; this reads
                 the same bridged field through the same numC as the headline,
                 so the button and the refusal cannot disagree.
                 `oe` null means the op economy has not bridged yet — unknown,
                 not unaffordable, so the button stays live. */
              const startup   = oe ? (oe.startup | 0) : null;
              const tooPoor   = isOwner && startup != null && treasury < startup;
              const label = !isOwner ? 'Founder/CEO funds this'
                : tooPoor ? ('🏦 Treasury short · ' + fmtC(treasury) + ' of ' + fmtC(startup) + ' 🔥')
                // view.startupText so a free licence reads FREE here too, not "0 🔥".
                : ('🏦 Fund from Treasury · ' + (startup != null ? view.startupText : '? 🔥'));
              const off = !isOwner || tooPoor;
              return (
                <button className="btn primary" disabled={off}
                  title={!isOwner ? 'Founder/CEO only' : tooPoor ? ('Treasury holds ' + fmtC(treasury) + ' 🔥 — this operation costs ' + fmtC(startup) + ' 🔥') : ''}
                  style={{ width: '100%', marginTop: 10, opacity: off ? 0.6 : 1, cursor: off ? 'default' : 'pointer' }}
                  onClick={() => { if (!off) act({ kind: 'opFound', op: o.id }); }}>
                  {label}
                </button>
              );
            })()}
            {hasCorp && !owned && isOwner && oe && (oe.azaStartup | 0) > 0 && (
              /* ◈ The alternate price. Only an operation carrying azaStartup shows
                 it; index.html's opFound branch charges the Aza. */
              <button className="btn" style={{ width: '100%', marginTop: 6 }}
                title={'Found it with Aza instead of Cinder — ' + (oe.azaStartup | 0) + ' ◈'}
                onClick={() => act({ kind: 'opFound', op: o.id, pay: 'aza' })}>
                {'◈ Found for ' + (oe.azaStartup | 0) + ' Aza'}
              </button>
            )}
            {owned && (() => {
              /* 👷 STAFFING, AND WHO IS ALLOWED TO DO IT.
                 🔴 THIS BLOCK WAS GATED ON `hasCorp` AND DISABLED ON `!isOwner`
                    AND ON AN EMPTY CORP LABOUR POOL — three conditions that do
                    NOT apply to a personally-funded operation, and opAssign has
                    always known it: `isLocalOp` there skips the founder gate and
                    skips the pool. The panel could not tell the two apart because
                    the payload never said which was which. So a player who funded
                    their own Construction Co. saw no staffing controls at all,
                    their city sat at 3 / 3 build gangs, and the handler that would
                    have allowed the hire was refusing nothing.
                 ⚠ THESE CONDITIONS MIRROR opAssign AND opCollect EXACTLY. If
                   either handler gains a rule this must gain it too: a panel that
                   offers what the handler refuses is a dead button, and a panel
                   that hides what the handler allows is this bug again. */
              const local = !!owned.localOnly;
              const maxW = (oe ? (oe.maxWorkers | 0) : 0) || (owned.maxWorkers | 0);
              const cur = owned.workers | 0;
              const mayStaff = local || (hasCorp && isOwner);
              /* A local op draws on nobody's roster, so the pool cannot cap it. */
              const headroom = local
                ? Math.max(0, maxW - cur)
                : Math.min(Math.max(0, maxW - cur), Math.max(0, poolFree));
              const setTo = (n) => act({ kind: 'opAssign', opId: owned.id, workers: Math.max(0, Math.min(maxW, n)) });
              const mayCollect = (local || isOwner) && (owned.cdLeftMs | 0) <= 0 && (owned.net | 0) > 0;
              return (
              <div style={{ marginTop: 10 }}>
                <div className="row" style={{ gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
                  <span className="mono muted" style={{ fontSize: 11 }}>👷 Workers</span>
                  <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                    <button className="btn sm" disabled={!mayStaff || cur <= 0}
                      onClick={() => setTo(cur - 1)}>−</button>
                    <span className="mono" style={{ minWidth: 56, textAlign: 'center' }}>{cur}{maxW ? ' / ' + maxW : ''}</span>
                    <button className="btn sm" disabled={!mayStaff || headroom <= 0}
                      onClick={() => setTo(cur + 1)}>+</button>
                    {/* 🔢 BULK HIRE. Construction tops out at 25, and one click per
                        worker is twenty-five clicks to reach a ceiling the game
                        advertises — that is not a decision, it is a chore, and it
                        makes the ceiling read as unreachable. opAssign already
                        takes an ABSOLUTE target, so neither of these needs a new
                        handler or a new rule. */}
                    <button className="btn sm" disabled={!mayStaff || headroom <= 0}
                      title="Hire five"
                      onClick={() => setTo(cur + Math.min(5, headroom))}>+5</button>
                    <button className="btn sm" disabled={!mayStaff || headroom <= 0}
                      title={'Staff it to ' + (cur + headroom)}
                      onClick={() => setTo(cur + headroom)}>Max</button>
                  </div>
                </div>
                <div className="mono muted" style={{ fontSize: 10.5, marginTop: 4 }}>
                  {local
                    ? 'personally funded · staffed from your own pocket, no corp roster needed'
                    : ('labour pool free: ' + poolFree)}
                  {' · ≈' + (cur * (oe ? oe.salaryPerWorkerHr : 0)).toLocaleString() + ' 🔥/hr wages'}
                </div>
                {/* 🏗 WHAT THIS NUMBER DOES SOMEWHERE ELSE. A Construction Co.'s
                    workers are what raise the city's build-gang limit — two the
                    city gives free, one for the Company, one per worker. The
                    player who hits "every build gang is out" is standing in the
                    CITY; the control that fixes it is HERE, and neither screen
                    said so. */}
                {owned.op_type === 'construction' && (
                  <div className="mono muted" style={{ fontSize: 10.5, marginTop: 4, opacity: 0.9 }}>
                    🏗 Build gangs in your city: <b>{Math.min(25, 2 + 1 + cur)}</b> — up to 25 with a fully staffed Company.
                    <br />Each worker here is one more building your city can put up at the same time.
                  </div>
                )}
                {/* 👷 PLAYER STAFF & WAGES (v121v49, sql/117). NPC workers above
                    are the sink; these rows are MEMBER PLAYERS on this operation
                    at a wage both sides agreed to. Officers offer, members apply,
                    either side counters, the other side accepts. Payroll is paid
                    from the treasury into the worker's wallet.
                    ⚠ Plain elements with uncontrolled inputs, on purpose: the
                    payload repaints this card every few seconds, and a component
                    defined inside this closure would remount and wipe a number
                    the player is still typing. Values are read at click time. */}
                {!local && hasCorp && (() => {
                  const me = E.myId || '';
                  const staff = (E.staff || []).filter(s => s && s.op_id === owned.id && s.status !== 'ended');
                  const mine = staff.find(s => s.user_id === me) || null;
                  const rosterAll = Array.isArray(E.roster) ? E.roster : [];
                  const onRows = staff.map(s => s.user_id);
                  const hireable = rosterAll.filter(m => m.userId && m.userId !== me && onRows.indexOf(m.userId) < 0);
                  const agreed = staff.filter(s => s.status === 'agreed');
                  const perHr = agreed.reduce((t, s) => t + (s.wage_hr | 0), 0);
                  const wageOf = (s) => s.status === 'agreed' ? (s.wage_hr | 0) : s.status === 'offered' ? (s.offered_hr | 0) : (s.asked_hr | 0);
                  const word = (s) => s.status === 'agreed' ? 'on payroll' : s.status === 'offered' ? 'offer pending' : 'asking';
                  const val = (id) => { try { const el = document.getElementById(id); return Math.floor(Number(el && el.value) || 0); } catch (e) { return 0; } };
                  const sel = (id) => { try { const el = document.getElementById(id); return el ? el.value : ''; } catch (e) { return ''; } };
                  const base = String(oe ? (oe.salaryPerWorkerHr | 0) || 100 : 100);
                  const inp = (id, dv, title) => <input className="input" id={id} type="number" min="1" max="100000" defaultValue={dv} title={title || 'Cinder per hour'} style={{ width: 84, padding: '3px 6px', fontSize: 11.5 }} />;
                  return (
                    <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--line-soft)' }}>
                      <div className="row" style={{ gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
                        <span className="mono muted" style={{ fontSize: 11 }}>🧑‍💼 Player staff</span>
                        <span className="mono muted" style={{ fontSize: 10.5 }}>{agreed.length} on payroll · ≈{perHr.toLocaleString()} 🔥/hr from the treasury</span>
                      </div>
                      {E.staffRpc === 'missing' && <div className="mono muted" style={{ fontSize: 10.5, marginTop: 4 }}>Staff wages are not installed on this server yet (sql/117).</div>}
                      {staff.map(s => {
                        const isMe = s.user_id === me;
                        const canAccept = isMe ? (s.status === 'offered') : (isOwner && s.status === 'countered');
                        const canTalk = isMe || isOwner;
                        const wid = 'st-w-' + s.id;
                        return (
                          <div key={s.id} className="row" style={{ gap: 6, alignItems: 'center', padding: '5px 0', borderBottom: '1px dashed var(--line-soft)', flexWrap: 'wrap' }}>
                            <span style={{ flex: 1, minWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{isMe ? 'You' : (s.user_name || 'Member')}</span>
                            <span className="chip flat" style={{ fontSize: 10.5 }} title={s.status === 'agreed' ? ('paid ' + (s.paid_total | 0).toLocaleString() + ' 🔥 so far') : (s.status === 'offered' ? 'the officer\'s number — the worker accepts or counters' : 'the worker\'s number — an officer accepts or counters')}>
                              {wageOf(s).toLocaleString()} 🔥/hr · {word(s)}
                            </span>
                            {canTalk && s.status !== 'agreed' && inp(wid, String(wageOf(s) || base), 'Your number per hour')}
                            {canAccept && <button className="btn sm primary" onClick={() => act({ kind: 'staffAccept', id: s.id })}>Accept {wageOf(s).toLocaleString()}</button>}
                            {canTalk && s.status !== 'agreed' && <button className="btn sm" onClick={() => act({ kind: 'staffCounter', id: s.id, wage: val(wid) })}>Counter</button>}
                            {canTalk && <button className="btn sm" title={s.status === 'agreed' ? 'End the job — owed wages are paid first' : 'Withdraw'} onClick={() => act({ kind: 'staffEnd', id: s.id })}>{s.status === 'agreed' ? 'End' : '✕'}</button>}
                          </div>
                        );
                      })}
                      {isOwner && (hireable.length
                        ? <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
                            <select className="input" id={'st-who-' + owned.id} defaultValue={hireable[0].userId} style={{ flex: 1, minWidth: 120, padding: '3px 6px', fontSize: 11.5 }}>
                              {hireable.map(x => <option key={x.userId} value={x.userId}>{x.name || 'Member'}</option>)}
                            </select>
                            {inp('st-offer-' + owned.id, base, 'Wage per hour')}
                            <button className="btn sm primary" onClick={() => { const id = sel('st-who-' + owned.id); const m = hireable.find(x => x.userId === id) || hireable[0]; act({ kind: 'staffOffer', opId: owned.id, userId: m ? m.userId : '', userName: m ? m.name : '', wage: val('st-offer-' + owned.id) }); }}>Offer 🔥/hr</button>
                          </div>
                        : <div className="mono muted" style={{ fontSize: 10.5, marginTop: 6 }}>Every member is already on this operation, or you have no members yet.</div>)}
                      {!mine && !isOwner && (
                        <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
                          <span className="mono muted" style={{ fontSize: 10.5, flex: 1 }}>Work here yourself — ask for a wage:</span>
                          {inp('st-apply-' + owned.id, base, 'Cinder per hour you are asking')}
                          <button className="btn sm" onClick={() => act({ kind: 'staffApply', opId: owned.id, wage: val('st-apply-' + owned.id) })}>Apply</button>
                        </div>
                      )}
                      <div className="mono muted" style={{ fontSize: 10, marginTop: 4, opacity: .85 }}>
                        Players on payroll count as workers for production. Wages accrue by the hour (36 h cap), are paid from the treasury on every collect, and land in the worker's wallet as “Wages from {E.corp && E.corp.name ? E.corp.name : 'the corporation'}”.
                      </div>
                    </div>
                  );
                })()}
                <button className="btn primary" disabled={!mayCollect}
                  style={{ width: '100%', marginTop: 8, opacity: mayCollect ? 1 : 0.6 }}
                  onClick={() => { if (mayCollect) act({ kind: 'opCollect', opId: owned.id }); }}>
                  {(owned.cdLeftMs | 0) > 0 ? ('⏳ ' + fmtH(owned.cdLeftMs)) : ((owned.net | 0) > 0 ? ('⚙️ Collect +' + (owned.net | 0).toLocaleString() + ' 🔥 → Treasury') : 'Hire workers to produce')}
                </button>
              </div>
              );
            })()}
          </div>
          );
        })}
        {rows.length === 0 && <div className="muted" style={{ padding: 24, gridColumn: '1/-1', textAlign: 'center' }}>No operations match that search.</div>}
      </div>

      <div className="muted" style={{ fontSize: 11, marginTop: 16, textAlign: 'center' }}>
        Operations are live: the founder funds them from the corp Treasury, hires workers (paid wages from the Treasury), and they <b>produce Cinder over time</b> back into it. Territory &amp; reputation come next.
      </div>
    </div>
  );
}

Object.assign(window, {
  VaultScreen, MarketplaceScreen, BlackMarketScreen,
  LogisticsScreen, MailboxScreen, FeedScreen,
  CorpScreen, OperationsScreen, TradeScreen, RelicDetailScreen,
});
