/* ═══════════════════════════════════════════════════════════════════════════
   ui.js — DOM for the Duel of Roses prototype.

   Thin by design: it never computes a rule. Every "can I?" is asked of
   rules.js (validMoves / summonTiles / usableMoves / targetsFor) and every
   "do it" goes through the same action functions the AI uses, so the two
   players literally cannot play by different rules.

   Interaction is a small mode machine:
     idle    → click own unit: 'unit'; click hand card: 'summon'
     summon  → click gold tile: summon; anything else: idle
     unit    → click blue tile: move; click move button: 'target'; buttons flip/stance
     target  → click red tile: use move; Esc/other: back to 'unit'
   ═══════════════════════════════════════════════════════════════════════════ */

import * as R from './rules.js';

const $ = (sel, root) => (root || document).querySelector(sel);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const ELEM_ICON = { fire: '🔥', water: '💧', earth: '🪨', wind: '🌬️', light: '✨', shadow: '🌑', nature: '🌿', storm: '⚡', ice: '❄️', metal: '⚙️', poison: '☠️', psychic: '🔮', arcane: '🪄', void: '🕳️', blood: '🩸', crystal: '💎', corruption: '🦠', spirit: '👻', lava: '🌋', sound: '🔊', gravity: '🪐' };
const elemIcons = (els) => (els || []).map((e) => ELEM_ICON[e] || e).join('');

export class DuelUI {
  constructor(root, opts) {
    this.root = root;
    this.opts = opts || {};
    this.state = null;
    this.mode = 'idle';
    this.sel = null;         // selected unit uid
    this.selCard = null;     // selected hand card id
    this.selMove = null;     // selected move id
    this.busy = false;       // AI turn animating
    this.build();
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { this.reset(); this.render(); } });
  }

  build() {
    this.root.innerHTML = `
      <header>
        <h1>⚔ Duel of Roses</h1><span class="sub">prototype · Mythic combat on a 7×7 leader board</span>
        <span class="spacer"></span>
        <label class="sub">seed <input id="seed" type="text" spellcheck="false"></label>
        <button id="new">New duel</button>
        <button id="help">How to play</button>
      </header>
      <main>
        <div class="side">
          <div class="panel status p2" id="st-p2"></div>
          <div class="panel"><h3>Terrain</h3><div class="legend" id="legend"></div></div>
          <div class="panel"><h3>Log</h3><div class="log" id="log"></div></div>
        </div>
        <div class="boardwrap">
          <div class="board" id="board"></div>
          <div class="hint" id="hint"></div>
          <div class="handwrap">
            <div class="hand" id="hand"></div>
            <div class="actions">
              <button id="end" class="primary">End turn</button>
            </div>
          </div>
        </div>
        <div class="side">
          <div class="panel status p1" id="st-p1"></div>
          <div class="panel upanel" id="upanel"><h3>Unit</h3><div class="desc">Select a unit or a card.</div></div>
        </div>
      </main>
      <footer>Numbers come straight from the live catalogs (public/src/duel/catalogs.gen.js, generated from index.html). Damage = ⌊power×ATK÷(DEF×4)⌋+2 → type chart → STAB → crit → terrain/stance.</footer>
      <div id="overlay"></div>`;
    $('#new', this.root).onclick = () => this.opts.onNew && this.opts.onNew($('#seed', this.root).value);
    $('#help', this.root).onclick = () => this.showHelp();
    $('#end', this.root).onclick = () => this.endTurn();
    const legend = $('#legend', this.root);
    for (const t of Object.values(R.TERRAINS)) {
      legend.appendChild(el('div', '', `<i style="--h:${t.hue}"></i>${t.icon} ${t.name}${t.element ? ' · ' + ELEM_ICON[t.element] : ''}`));
    }
  }

  attach(state) { this.state = state; this.reset(); $('#seed', this.root).value = String(state.seed); this.render(); }
  reset() { this.mode = 'idle'; this.sel = null; this.selCard = null; this.selMove = null; }

  /* ── actions ─────────────────────────────────────────────────────────── */
  act(res) {
    if (!res.ok) { this.hint(res.reason); return false; }
    this.animate(res.events);
    return true;
  }

  endTurn() {
    if (this.busy || this.state.gameOver) return;
    const res = R.endTurn(this.state);
    this.reset();
    this.animate(res.events);
    this.render();
    if (!this.state.gameOver && this.state.active === 'p2') this.runAi();
  }

  async runAi() {
    this.busy = true;
    this.hint("Rival's turn…");
    this.render();
    await sleep(400);
    const events = this.opts.ai(this.state, 'p2');
    // Replay the rival's events one beat at a time over the final state — a
    // prototype-grade animation that still lets you SEE what hit what.
    for (const e of events) {
      if (['hit', 'heal', 'summon', 'flip', 'move', 'death', 'tick'].includes(e.t)) { this.render(); this.animate([e]); await sleep(e.t === 'hit' ? 650 : 300); }
    }
    this.busy = false;
    this.reset();
    this.render();
    if (this.state.gameOver) this.showEnd();
  }

  /* ── rendering ───────────────────────────────────────────────────────── */
  render() {
    const s = this.state;
    if (!s) return;
    this.renderStatus('p1'); this.renderStatus('p2');
    this.renderBoard(); this.renderHand(); this.renderUnitPanel(); this.renderLog();
    $('#end', this.root).disabled = this.busy || s.gameOver || s.active !== 'p1';
    if (!this.busy) {
      if (s.gameOver) this.hint('Duel over.');
      else if (this.mode === 'summon') this.hint('Choose a gold tile beside your leader to set the card face-down.');
      else if (this.mode === 'target') this.hint('Choose a red target.');
      else if (this.mode === 'unit') this.hint('Blue tiles: move. Use the panel to flip, change stance or attack.');
      else this.hint(s.active === 'p1' ? 'Your turn. Click a card to summon, or a unit to command it.' : '');
    }
  }

  hint(msg) { $('#hint', this.root).textContent = msg || ''; }

  renderStatus(side) {
    const s = this.state, p = s.players[side], L = R.leaderOf(s, side);
    const box = $('#st-' + side, this.root);
    const pct = L ? Math.round(100 * L.currentHp / L.maxHp) : 0;
    box.innerHTML = `<div class="name">${L ? L.icon : ''} ${p.name}${s.active === side && !s.gameOver ? ' · <span style="color:var(--gold)">active</span>' : ''}</div>
      <div class="hpbar"><i style="width:${pct}%"></i></div>
      <div class="stats"><span>Leader <b>${L ? L.currentHp : 0}/${L ? L.maxHp : 0}</b></span><span>Hand <b>${p.hand.length}</b></span><span>Deck <b>${p.deck.length}</b></span><span>Grave <b>${p.graveyard.length}</b></span></div>
      <div class="energy">${Array.from({ length: R.RULES.ENERGY_MAX }, (_, i) => `<i class="${i < p.energy ? 'on' : ''}"></i>`).join('')}</div>`;
  }

  renderBoard() {
    const s = this.state;
    const board = $('#board', this.root);
    board.innerHTML = '';
    const hl = this.highlights();
    for (let y = 0; y < R.RULES.ROWS; y++) for (let x = 0; x < R.RULES.COLS; x++) {
      const t = s.board[y][x], T = R.TERRAINS[t.terrain];
      const tile = el('div', 'tile ' + t.terrain);
      tile.style.setProperty('--h', T.hue);
      tile.dataset.x = x; tile.dataset.y = y;
      tile.appendChild(el('span', 'terr', T.element ? T.icon : ''));
      tile.appendChild(el('span', 'coord', R.coord({ x, y })));
      const k = R.key(x, y);
      if (hl[k]) tile.classList.add('hl-' + hl[k]);
      const u = R.unitAt(s, x, y);
      if (u) {
        tile.appendChild(this.unitNode(u));
        if (u.uid === this.sel) tile.classList.add('hl-sel');
        tile.classList.add('clickable');
      }
      tile.onclick = () => this.clickTile(x, y);
      tile.title = T.name + (T.element ? ' — ' + T.desc : '');
      board.appendChild(tile);
    }
  }

  unitNode(u) {
    const hidden = u.facing === 'down' && u.owner === 'p2';
    const n = el('div', 'unit ' + u.owner + (u.isLeader ? ' leader' : '') + (u.facing === 'down' ? ' down' : '') + (u.owner === 'p1' && u.hasAttacked ? ' spent' : ''));
    n.innerHTML = hidden ? '🂠' : u.icon;
    if (!hidden) {
      const low = u.currentHp <= u.maxHp * .3;
      n.appendChild(el('div', 'hp', `<i class="${low ? 'low' : ''}" style="width:${Math.round(100 * u.currentHp / u.maxHp)}%"></i>`));
      if (!u.isLeader) n.appendChild(el('span', 'stance', u.facing === 'down' ? '▼' : u.stance === 'attack' ? '⚔️' : '🛡️'));
      if (u.statusEffects.length) n.appendChild(el('span', 'fx', u.statusEffects.map((e) => R.STATUS_EFFECTS[e.type] && R.STATUS_EFFECTS[e.type].icon || '').join('')));
      const te = R.terrainEffect(this.state, u);
      if (te) n.appendChild(el('span', 'terrfx', te > 0 ? '▲' : '▽'));
    }
    return n;
  }

  highlights() {
    const s = this.state, out = {};
    if (s.active !== 'p1' || this.busy) return out;
    if (this.mode === 'summon') for (const t of R.summonTiles(s, 'p1')) out[R.key(t.x, t.y)] = 'summon';
    const u = this.sel && R.unitById(s, this.sel);
    if (this.mode === 'unit' && u) for (const t of R.validMoves(s, u)) out[R.key(t.x, t.y)] = 'move';
    if (this.mode === 'target' && u && this.selMove) for (const t of R.targetsFor(s, u, R.MOVES[this.selMove])) out[R.key(t.pos.x, t.pos.y)] = 'target';
    return out;
  }

  renderHand() {
    const s = this.state, p = s.players.p1;
    const hand = $('#hand', this.root);
    hand.innerHTML = '';
    const canSummon = s.active === 'p1' && p.summonsLeft > 0 && !s.gameOver && !this.busy;
    p.hand.forEach((id, i) => {
      const c = R.cardById(id);
      const n = el('div', 'card' + (this.selCard === id && this.mode === 'summon' ? ' sel' : '') + (canSummon ? '' : ' dead'));
      n.innerHTML = `<div class="n">${c.name}</div><div class="i">${c.icon}</div>
        <div class="s">HP ${c.stats.hp} · ATK ${c.stats.atk} · DEF ${c.stats.def}</div>
        <div class="s">MAG ${c.stats.mag} · RES ${c.stats.res} · SPD ${c.stats.spd}${c.flying ? ' · ✈' : ''}</div>
        <div class="el">${elemIcons(c.elements)} ${R.learnedMoves(c).map((m) => R.MOVES[m].name).join(', ')}</div>`;
      n.title = c.desc + (c.passive && c.passive !== 'none' && R.PASSIVES[c.passive] ? '\nPassive: ' + R.PASSIVES[c.passive].name + ' — ' + R.PASSIVES[c.passive].desc : '');
      n.onclick = () => { if (!canSummon) return; this.reset(); this.mode = 'summon'; this.selCard = id; this.render(); };
      hand.appendChild(n);
    });
    if (!p.hand.length) hand.appendChild(el('div', 'hint', 'Hand empty.'));
  }

  renderUnitPanel() {
    const s = this.state, box = $('#upanel', this.root);
    const u = this.sel && R.unitById(s, this.sel);
    if (!u) {
      if (this.mode === 'summon' && this.selCard) {
        const c = R.cardById(this.selCard);
        box.innerHTML = `<h3>Summon</h3><div class="name">${c.icon} ${c.name}</div><div class="desc">${c.desc}</div>
          <div class="row"><span class="tag">${elemIcons(c.elements)} ${c.elements.join('/')}</span>${c.passive && c.passive !== 'none' ? `<span class="tag">${R.PASSIVES[c.passive] ? R.PASSIVES[c.passive].name : c.passive}</span>` : ''}</div>
          <div class="desc">Set face-down beside your leader. It cannot act until next turn.</div>`;
      } else box.innerHTML = '<h3>Unit</h3><div class="desc">Select a unit or a card.</div>';
      return;
    }
    const hidden = u.facing === 'down' && u.owner === 'p2';
    if (hidden) { box.innerHTML = '<h3>Enemy</h3><div class="name">🂠 Face-down card</div><div class="desc">Unknown until flipped. Attacking it reveals it — and it defends at half damage.</div>'; return; }
    const te = R.terrainEffect(s, u);
    const T = R.TERRAINS[s.board[u.pos.y][u.pos.x].terrain];
    const stat = (k) => { const v = R.effectiveStat(s, u, k), b = u.stats[k]; return `<span class="tag ${v > b ? 'up' : v < b ? 'dn' : ''}">${k.toUpperCase()} ${v}</span>`; };
    const mine = u.owner === 'p1' && s.active === 'p1' && !this.busy && !s.gameOver;
    const card = u.cardId ? R.cardById(u.cardId) : null;
    let html = `<h3>${u.owner === 'p1' ? 'Your unit' : 'Enemy unit'}</h3><div class="name">${u.icon} ${u.name}</div>
      <div class="desc">${card ? card.desc : 'The deck leader. Cannot attack; if it falls, the duel is lost.'}</div>
      <div class="row"><span class="tag">HP ${u.currentHp}/${u.maxHp}</span>${u.isLeader ? '' : stat('atk') + stat('def') + stat('mag') + stat('res')}<span class="tag">SPD ${R.moveRange(u)}</span></div>
      <div class="row">${u.elements.length ? `<span class="tag">${elemIcons(u.elements)} ${u.elements.join('/')}</span>` : ''}
        ${u.isLeader ? '' : `<span class="tag">${u.facing === 'down' ? '▼ face-down' : u.stance === 'attack' ? '⚔️ attack' : '🛡️ defense'}</span>`}
        ${u.flying ? '<span class="tag">✈ flying</span>' : ''}
        ${u.passive && R.PASSIVES[u.passive] ? `<span class="tag" title="${R.PASSIVES[u.passive].desc}">${R.PASSIVES[u.passive].name}</span>` : ''}
        ${u.statusEffects.map((e) => `<span class="tag dn">${R.STATUS_EFFECTS[e.type].icon} ${R.STATUS_EFFECTS[e.type].name} ${e.turnsLeft}t</span>`).join('')}</div>
      <div class="desc">On ${T.name}${te > 0 ? ' — <span class="tag up">Empowered +25%</span>' : te < 0 ? ' — <span class="tag dn">Hindered −25%</span>' : u.flying && T.element ? ' — flying, unaffected' : ''}.</div>`;
    if (mine && !u.isLeader) {
      html += '<div class="row">';
      if (u.facing === 'down') html += `<button data-a="flip" ${u.summonedTurn === s.turn ? 'disabled' : ''}>Flip face-up</button>`;
      else if (R.canAct(s, u) && !u.stanceChanged && !u.hasAttacked) html += `<button data-a="stance">${u.stance === 'attack' ? '🛡 To defense' : '⚔ To attack'}</button>`;
      html += '</div>';
      if (u.summonedTurn === s.turn) html += '<div class="desc">Summoning sickness — acts next turn.</div>';
      else if (R.isStunned(u)) html += '<div class="desc">Stunned — cannot act.</div>';
      else if (u.facing === 'up') {
        const moves = R.usableMoves(s, u);
        const all = u.moves.map((m) => R.MOVES[m]);
        html += '<div class="row" style="flex-direction:column">';
        for (const m of all) {
          const ok = moves.includes(m);
          const why = !ok ? (u.hasAttacked ? 'already acted' : m.kind === 'attack' && u.stance !== 'attack' ? 'needs attack stance' : (m.cost || 0) > s.players.p1.energy ? 'not enough energy' : 'unavailable') : '';
          html += `<button class="movebtn ${this.selMove === m.id ? 'sel' : ''}" data-a="move" data-m="${m.id}" ${ok ? '' : 'disabled'}>
            <span>${m.name} <small>${ELEM_ICON[m.element] || ''} ${m.kind === 'attack' ? 'power ' + m.power + ' · ' + m.type : m.kind}</small></span>
            <small>range ${m.range} · cost ${m.cost || 0}${m.accuracy ? ' · acc ' + m.accuracy + '%' : ''}${why ? ' · ' + why : ''} — ${m.desc}</small></button>`;
        }
        html += '</div>';
      }
      html += '<div class="preview" id="preview"></div>';
    }
    box.innerHTML = html;
    box.querySelectorAll('button[data-a]').forEach((b) => {
      b.onclick = () => {
        const a = b.dataset.a;
        if (a === 'flip') { if (this.act(R.flip(s, u.uid))) { this.mode = 'unit'; } }
        else if (a === 'stance') this.act(R.setStance(s, u.uid, u.stance === 'attack' ? 'defense' : 'attack'));
        else if (a === 'move') { this.selMove = b.dataset.m; this.mode = 'target'; }
        this.render();
      };
    });
  }

  renderLog() {
    const box = $('#log', this.root);
    box.innerHTML = this.state.log.slice(-60).map((l) => `<div class="${l.t}">${l.msg}</div>`).join('');
    box.scrollTop = box.scrollHeight;
  }

  /* ── input ───────────────────────────────────────────────────────────── */
  clickTile(x, y) {
    const s = this.state;
    if (this.busy || s.gameOver) return;
    const u = R.unitAt(s, x, y);
    if (this.mode === 'summon' && s.active === 'p1') {
      if (this.act(R.summon(s, 'p1', this.selCard, { x, y }))) { this.reset(); }
      else if (u) { this.reset(); this.select(u); }
      this.render(); return;
    }
    const selU = this.sel && R.unitById(s, this.sel);
    if (this.mode === 'target' && selU && this.selMove) {
      if (u && R.targetsFor(s, selU, R.MOVES[this.selMove]).includes(u)) {
        this.previewFor(selU, u);
        this.act(R.useMove(s, selU.uid, this.selMove, u.uid));
        this.mode = 'unit'; this.selMove = null;
        this.render();
        if (s.gameOver) this.showEnd();
        return;
      }
      this.mode = 'unit'; this.selMove = null;
      if (u) this.select(u);
      this.render(); return;
    }
    if (this.mode === 'unit' && selU && s.active === 'p1') {
      if (!u && R.validMoves(s, selU).some((t) => t.x === x && t.y === y)) { this.act(R.moveUnit(s, selU.uid, { x, y })); this.render(); return; }
    }
    if (u) this.select(u); else this.reset();
    this.render();
  }

  select(u) { this.reset(); this.sel = u.uid; this.mode = u.owner === 'p1' ? 'unit' : 'idle'; }

  previewFor(attacker, target) {
    const box = $('#preview', this.root);
    if (!box || !this.selMove) return;
    const m = R.MOVES[this.selMove];
    if (m.kind !== 'attack') { box.textContent = ''; return; }
    const r = R.resolveAttack(this.state, m, attacker, target, true);
    box.textContent = `≈ ${r.damage} to ${target.name}${r.effectiveness === 'super' ? ' · super effective' : r.effectiveness === 'resisted' ? ' · resisted' : ''}${r.stab ? ' · STAB' : ''}${r.guarded ? ' · guarded' : ''}`;
  }

  /* ── animation ───────────────────────────────────────────────────────── */
  animate(events) {
    for (const e of events) {
      const u = e.uid && R.unitById(this.state, e.uid);
      const tile = u && $(`.tile[data-x="${u.pos.x}"][data-y="${u.pos.y}"]`, this.root);
      if (!tile) continue;
      if (e.t === 'hit') this.float(tile, e.missed ? 'miss' : (e.crit ? 'CRIT ' : '') + '−' + e.damage + (e.effectiveness === 'super' ? '!' : ''), e.missed ? 'miss' : e.crit ? 'crit' : e.effectiveness === 'super' ? 'super' : '');
      else if (e.t === 'heal') this.float(tile, '+' + e.amount, 'heal');
      else if (e.t === 'tick') this.float(tile, '−' + e.dmg, '');
      else if (e.t === 'death') this.float(tile, '✖', 'crit');
      else if (e.t === 'flip') this.float(tile, 'FLIP', 'super');
      else if (e.t === 'summon') this.float(tile, 'SET', '');
      else if (e.t === 'status') this.float(tile, (R.STATUS_EFFECTS[e.status] || {}).icon || e.status, 'miss');
      if (e.t === 'hit' || e.t === 'death') { tile.classList.remove('flash'); void tile.offsetWidth; tile.classList.add('flash'); }
    }
  }

  float(tile, text, cls) {
    const f = el('div', 'float ' + cls, text);
    tile.appendChild(f);
    setTimeout(() => f.remove(), 1200);
  }

  showEnd() {
    const s = this.state;
    const win = s.winner === 'p1';
    this.overlay(`<h2>${s.winner ? (win ? 'Victory' : 'Defeat') : 'Draw'}</h2>
      <p>${s.reason === 'leader' ? (win ? 'The rival leader has fallen.' : 'Your leader has fallen.') : s.reason === 'deck-out' ? (win ? 'The rival ran out of cards.' : 'You ran out of cards.') : 'Turn limit reached.'} Turn ${s.turn}, seed ${s.seed}.</p>
      <button class="primary" id="ov-new">New duel</button> <button id="ov-close">Look at the board</button>`);
    $('#ov-new', this.root).onclick = () => { this.overlay(''); this.opts.onNew && this.opts.onNew(''); };
    $('#ov-close', this.root).onclick = () => this.overlay('');
  }

  showHelp() {
    this.overlay(`<h2>How to play</h2><div class="help">
      <p><b>Goal.</b> Destroy the rival's Deck Leader (🏴). Lose yours (👑) and you lose. Running out of cards to draw also loses.</p>
      <p><b>Summon.</b> Once per turn, click a card then a gold tile beside your leader. Cards arrive <b>face-down in defense</b> and cannot act until next turn. Summoning is free.</p>
      <p><b>Command.</b> Click a unit: blue tiles are moves (8 directions, SPD tiles). Flip it face-up, pick a stance, then a move. Attacks need <b>attack stance</b> and cost energy; defense stance halves damage taken but cannot attack.</p>
      <p><b>Terrain.</b> Each tile has an element. Standing on your own element: <b>Empowered +25%</b> to all combat stats. Standing on ground whose element beats yours: <b>Hindered −25%</b>. Flyers ignore terrain. Labyrinth walls block movement.</p>
      <p><b>Combat</b> is the live Mythic formula: ⌊power×ATK÷(DEF×4)⌋+2, ×2 super-effective / ×½ resisted from the 21-element chart, ×1.5 STAB, 6% crit ×1.5, statuses, passives.</p>
      <p><b>Hidden information.</b> A face-down enemy card is unknown until flipped — and gets flipped the moment you hit it.</p></div>
      <button class="primary" id="ov-close">Close</button>`);
    $('#ov-close', this.root).onclick = () => this.overlay('');
  }

  overlay(html) {
    const o = $('#overlay', this.root);
    o.innerHTML = html ? `<div class="overlay"><div class="box">${html}</div></div>` : '';
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
