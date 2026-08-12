// ─────────────────────────────────────────────────────────────────────────────
// 🌉 A stand-in for Supabase, for four browsers at once.
//
// There is no PostgREST in this sandbox, so this serves the two things the
// WARPATH client needs to run for real:
//
//   • the static sub-app out of public/warpath/
//   • POST /rpc/:player  — the same shape as Cloud.client.rpc(fn, args)
//
// ⚠ /rpc RESOLVES FUNCTIONS THE WAY POSTGREST DOES, on purpose. PostgREST
// matches a JSON body's KEYS against the function's parameter names and will
// not call an overload whose remaining parameters have no default. Emulating
// that faithfully is the difference between a harness that tells you the client
// works and one that tells you the truth: see FAITHFUL vs `?inject_exp=1`.
//
// Each player gets one pinned PostgreSQL connection with its own session-local
// request.jwt.claim.sub, so four browsers are four identities all the way down.
// ─────────────────────────────────────────────────────────────────────────────
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Session } from './warpath-client.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const WARPATH_DIR = path.resolve(HERE, '../../public/warpath');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
               '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

/** Function signatures, read out of the live catalog — no hardcoded list. */
async function loadSignatures(obs) {
  const rows = await obs.sql(
    `select p.proname                                as fn,
            p.pronargs                               as nargs,
            p.pronargdefaults                        as ndefaults,
            array(select unnest(p.proargnames))      as argnames
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'warpath\\_%'`);
  const out = {};
  for (const r of rows) {
    const names = r.argnames || [];
    out[r.fn] = { names, required: names.slice(0, r.nargs - r.ndefaults) };
  }
  return out;
}

export async function startShim({ port = 8787, players = 4, injectExp = false } = {}) {
  const obs = new Session('shim-obs');
  await obs.open(null);
  const sigs = await loadSignatures(obs);

  const seats = [];
  for (let i = 0; i < players; i++) {
    const uid = (await obs.sql('insert into auth.users (email) values ($1) returning id',
                               [`seat${i}+${Date.now()}@browser.sim`]))[0].id;
    const s = new Session(`seat${i}`);
    await s.open(uid);
    await s.rpc('warpath_claim_free_ticket');
    seats.push({ i, uid, s, exp: null, calls: [] });
  }

  const log = [];

  /** The PostgREST call: match the body's keys against the signature. */
  async function call(seat, fn, args) {
    const sig = sigs[fn];
    if (!sig) return { status: 404, body: { code: 'PGRST202', message: `Could not find the function public.${fn} in the schema cache` } };

    let given = { ...(args || {}) };
    // The compatibility crutch. Off by default; the whole point of FAITHFUL
    // mode is that this is exactly what nothing in the shipping client does.
    if (injectExp && sig.names.includes('p_exp') && given.p_exp === undefined && seat.exp) {
      given.p_exp = seat.exp;
      seat.injected = (seat.injected || 0) + 1;
    }

    const missing = sig.required.filter(n => given[n] === undefined);
    if (missing.length) {
      const shown = Object.keys(given).sort().join(', ');
      log.push({ seat: seat.i, fn, args: given, refused: 'PGRST202', missing });
      return { status: 404, body: { code: 'PGRST202',
        message: `Could not find the function public.${fn}(${shown}) in the schema cache`,
        hint: `Perhaps you meant to call public.${fn}(${sig.names.join(', ')})` } };
    }

    const used = sig.names.filter(n => given[n] !== undefined);
    const call = used.map((n, k) => `${n} => $${k + 1}`).join(', ');
    const vals = used.map(n => given[n]);
    try {
      const rows = await seat.s.sql(`select public.${fn}(${call}) as r`, vals);
      const r = rows[0].r;
      if (fn === 'warpath_state' && r && r.in_run) seat.exp = r.me.expedition_id;
      if (fn === 'warpath_enter' && r && r.ok) seat.exp = r.expedition_id;
      log.push({ seat: seat.i, fn, ok: r && r.ok !== false });
      return { status: 200, body: r };
    } catch (e) {
      log.push({ seat: seat.i, fn, pg: e.code, message: e.message });
      return { status: 400, body: { code: e.code, message: e.message } };
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (code, type, body) => { res.writeHead(code, { 'content-type': type }); res.end(body); };

    if (req.method === 'POST' && url.pathname.startsWith('/rpc/')) {
      const seat = seats[Number(url.pathname.slice(5))];
      if (!seat) return send(404, 'application/json', '{"message":"no such seat"}');
      let raw = '';
      req.on('data', c => { raw += c; });
      req.on('end', async () => {
        let payload = {};
        try { payload = JSON.parse(raw || '{}'); } catch {}
        const r = await call(seat, payload.fn, payload.args);
        send(r.status, 'application/json', JSON.stringify(r.body));
      });
      return;
    }
    if (url.pathname === '/__log') return send(200, 'application/json', JSON.stringify(log));
    if (url.pathname === '/host.html') return send(200, 'text/html', HOST_HTML);

    const rel = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = path.join(WARPATH_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(WARPATH_DIR) || !fs.existsSync(file)) return send(404, 'text/plain', 'not found');
    send(200, MIME[path.extname(file)] || 'application/octet-stream', fs.readFileSync(file));
  });

  await new Promise(r => server.listen(port, '127.0.0.1', r));
  return {
    port, seats, log,
    url: seat => `http://127.0.0.1:${port}/host.html?seat=${seat}`,
    obs,
    async stop() { server.close(); for (const s of seats) await s.s.close(); await obs.close(); },
  };
}

/* The parent page. This is the harness's copy of what public/index.html does at
   :215588 — mount the sub-app in an iframe, answer `warpath:rpc` by forwarding
   fn+args to the database, post the result back. It deliberately does NOT add
   arguments the real parent does not add. */
const HOST_HTML = `<!doctype html><meta charset="utf-8"><title>WARPATH host</title>
<style>html,body{margin:0;height:100%;background:#07060b}iframe{border:0;width:100%;height:100%}</style>
<iframe id="f" src="/index.html"></iframe>
<script>
const seat = new URL(location.href).searchParams.get('seat') || '0';
window.__wpBridge = { sent: 0, errors: [], last: null, battles: [], results: [] };
window.__wpWin = true;   // the harness standing in for the Mythic Spellbook engine
addEventListener('message', async ev => {
  const d = ev.data;
  if (!d) return;
  if (d.type === 'warpath:rpc') {
    window.__wpBridge.sent++;
    let result = null, error = null;
    try {
      const r = await fetch('/rpc/' + seat, { method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fn: d.fn, args: d.args || {} }) });
      const body = await r.json();
      if (!r.ok) {
        // Same translation the shipping parent does at public/index.html:215536.
        const m = String(body.message || '');
        error = /does not exist|PGRST202|PGRST205|42883|schema cache/i.test(m)
          ? 'The Warpath is not installed on this server yet (run the warpath migration).'
          : (m || 'Warpath call failed');
        window.__wpBridge.errors.push({ fn: d.fn, args: d.args, message: m });
      } else { result = body; }
    } catch (e) { error = String(e.message || e); window.__wpBridge.errors.push({ fn: d.fn, message: String(e) }); }
    window.__wpBridge.last = { fn: d.fn, error: error };
    document.getElementById('f').contentWindow.postMessage(
      { type: 'warpath:rpc:result', id: d.id, result, error }, location.origin);
    return;
  }
  /* ⭐ The battle bridge, from the parent's side. The sub-app hands the battle
     off with postMessage 'warpath:battle' (warpath-app.js:1179) and waits for
     'warpath:battleResult'; in the real game the Mythic Spellbook engine plays
     it. Here the harness answers, which is what makes the round trip real
     rather than the sub-app calling warpath_battle_report on itself. */
  if (d.type === 'warpath:battle') {
    window.__wpBridge.battles.push(d.battle);
    const won = !!window.__wpWin;
    const res = { type: 'warpath:battleResult', battle_id: d.battle.battle_id, won,
                  loser_is_me: !won,
                  winner_expedition_id: won ? d.battle.expedition_id : d.battle.opponent_expedition_id };
    window.__wpBridge.results.push(res);
    setTimeout(() => document.getElementById('f').contentWindow.postMessage(res, location.origin), 150);
    return;
  }
  if (d.type === 'warpath:cardmeta:req') {
    document.getElementById('f').contentWindow.postMessage(
      { type: 'warpath:cardmeta', meta: {} }, location.origin);
  }
});
</script>`;
