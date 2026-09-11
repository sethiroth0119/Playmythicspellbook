/* ════════════════════════════════════════════════════════════════════════════
   🎨 VAN LIVERY — the moderated lane, Worker side

   sql/063_van_livery.sql holds the invariants; this file is the only thing that
   can move bytes across them, because it is the only place SB_SERVICE is used.

   ── WHY THE WORKER AND NOT THE CLIENT ─────────────────────────────────────
   The client can put a file in van-livery-quarantine (private) and nothing
   else. It cannot scan, cannot approve, and cannot write the public bucket —
   there is no policy that would let it. Everything between "the player picked a
   PNG" and "other players see it" happens here, behind the service key.

   ── FAIL CLOSED, AND SAY WHY ──────────────────────────────────────────────
   Every path out of scanOne() that is not an explicit clean verdict returns
   'error' or a refusal, and van_livery_record_scan() maps all of those to
   states the public view does not select. Concretely, ALL of these leave the
   logo invisible:
       · MOD_PROVIDER unset                  · the account has no credit
       · MOD_API_KEY unset                   · the provider 5xx'd
       · the request timed out               · the JSON did not parse
       · the response had no field we know   · the score was missing
   None of them are treated as "probably fine".

   🔴 THE SELF-TEST IS NOT OPTIONAL AND IT IS NOT A PING.
   The realistic failure of an integration like this is not an outage — an
   outage is loud. It is a RESPONSE MAPPING THAT IS SILENTLY WRONG: the field
   moved, or the class is named something else on this account's plan, so
   readVerdict() finds nothing, returns 'clean' by accident, and every image
   sails through while the dashboard looks green. So /api/livery/selftest sends
   TWO assets — one benign, one the provider itself designates as positive test
   material — and demands that the adapter come back 'clean' for the first and
   NOT-'clean' for the second. A provider that cannot make us fail has not been
   verified; it has only been shown to return 200. Until that passes,
   van_livery_review() refuses to approve anything at all.

   ⚠ MOD_SELFTEST_POSITIVE_URL is deliberately NOT defaulted. There is no test
     image I can ship for this and no URL I should guess. Your provider supplies
     it as part of onboarding; until you paste theirs in, the lane stays shut.
     That is the intended behaviour, not a missing feature.
   ════════════════════════════════════════════════════════════════════════════ */

const MAX_BYTES = 2 * 1024 * 1024;
const OK_MIME = ['image/png', 'image/jpeg', 'image/webp'];
const SCAN_TIMEOUT_MS = 20000;

const CORS_RW = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization',
  'access-control-max-age': '86400',
};
const j = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS_RW },
});

const sbBase = (env) => String(env.SB_URL || '').replace(/\/+$/, '');

async function whoami(env, request) {
  const tok = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!tok || !env.SB_URL || !env.SB_ANON) return null;
  const r = await fetch(sbBase(env) + '/auth/v1/user', { headers: { apikey: env.SB_ANON, authorization: 'Bearer ' + tok } });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  return u && u.id ? { id: u.id, token: tok, email: (u.email || '').toLowerCase() } : null;
}

/* Call a SECURITY DEFINER function with the SERVICE key. Used only for the
   things a player must never be able to call themselves. */
async function rpcService(env, fn, body) {
  if (!env.SB_SERVICE) throw new Error('sb_service_missing');
  const r = await fetch(sbBase(env) + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: { apikey: env.SB_SERVICE, authorization: 'Bearer ' + env.SB_SERVICE, 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const t = await r.text();
  if (!r.ok) throw new Error('rpc ' + fn + ' ' + r.status + ' ' + t.slice(0, 200));
  try { return JSON.parse(t); } catch (e) { return null; }
}

/* …and as the CALLER, so RLS applies. Review goes through here on purpose:
   van_livery_review() checks ms_is_admin() against the caller's own JWT, so an
   approval is attributable to a person rather than to the service key. */
async function rpcAsUser(env, user, fn, body) {
  const r = await fetch(sbBase(env) + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: { apikey: env.SB_ANON, authorization: 'Bearer ' + user.token, 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(t.slice(0, 300) || ('rpc ' + r.status));
  try { return JSON.parse(t); } catch (e) { return null; }
}

async function storageGet(env, bucket, path) {
  const r = await fetch(sbBase(env) + '/storage/v1/object/' + bucket + '/' + path,
    { headers: { apikey: env.SB_SERVICE, authorization: 'Bearer ' + env.SB_SERVICE } });
  if (!r.ok) return null;
  return { bytes: await r.arrayBuffer(), mime: r.headers.get('content-type') || 'application/octet-stream' };
}

async function storagePut(env, bucket, path, bytes, mime) {
  const r = await fetch(sbBase(env) + '/storage/v1/object/' + bucket + '/' + path, {
    method: 'POST',
    headers: { apikey: env.SB_SERVICE, authorization: 'Bearer ' + env.SB_SERVICE,
               'content-type': mime, 'x-upsert': 'true' },
    body: bytes,
  });
  return r.ok;
}

/* ══════════════════════════════════════════════════════════════════════════
   THE PROVIDER ADAPTER

   Two shapes. `generic` is exact and is the one to use with any provider that
   will let you put a small normalising shim in front of it — you control both
   ends, so nothing can drift. `hive` posts the documented v2 sync shape, but
   its RESPONSE MAPPING IS A GUESS UNTIL THE SELF-TEST CONFIRMS IT, because the
   class names on a given account depend on the plan. That is exactly the case
   the self-test exists for; do not skip it because "it returned 200".
   ══════════════════════════════════════════════════════════════════════════ */
function readVerdictGeneric(o) {
  const v = String((o && o.verdict) || '').toLowerCase();
  if (v === 'csam' || v === 'reject' || v === 'clean') {
    return { verdict: v, score: Number(o.score) || 0 };
  }
  return { verdict: 'error', score: 0, why: 'unrecognised verdict field' };
}

function readVerdictHive(o, env) {
  /* Hive returns status[].response.output[].classes[] as {class, score}. */
  const csamClasses = String(env.MOD_CSAM_CLASSES || 'csam,child_sexual_abuse_material')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const rejectClasses = String(env.MOD_REJECT_CLASSES || 'general_nsfw,yes_sexual_activity,nudity,gore')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const thresh = Number(env.MOD_THRESHOLD || 0.85);

  let classes = null;
  try {
    const out = o.status[0].response.output;
    classes = [];
    for (const seg of out) for (const c of (seg.classes || [])) classes.push(c);
  } catch (e) { classes = null; }
  /* 🔴 No classes found means the shape changed. That is an ERROR, never a
     clean bill of health — this branch is the whole point of the self-test. */
  if (!classes || !classes.length) return { verdict: 'error', score: 0, why: 'no classes in response' };

  let worst = 0;
  for (const c of classes) {
    const name = String(c.class || '').toLowerCase(), s = Number(c.score) || 0;
    if (csamClasses.includes(name) && s >= thresh) return { verdict: 'csam', score: s };
    if (rejectClasses.includes(name) && s >= thresh) worst = Math.max(worst, s);
  }
  return worst > 0 ? { verdict: 'reject', score: worst } : { verdict: 'clean', score: 0 };
}

export async function scanOne(env, bytes, mime) {
  const provider = String(env.MOD_PROVIDER || '').toLowerCase();
  if (!provider) return { provider: 'none', verdict: 'error', score: 0, raw: { why: 'MOD_PROVIDER not set' } };
  if (!env.MOD_API_KEY) return { provider, verdict: 'error', score: 0, raw: { why: 'MOD_API_KEY not set' } };

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), SCAN_TIMEOUT_MS);
  try {
    let res, parsed;
    if (provider === 'generic') {
      res = await fetch(String(env.MOD_ENDPOINT || ''), {
        method: 'POST', signal: ac.signal,
        headers: { 'content-type': mime, authorization: 'Bearer ' + env.MOD_API_KEY },
        body: bytes,
      });
      if (!res.ok) return { provider, verdict: 'error', score: 0, raw: { status: res.status } };
      parsed = readVerdictGeneric(await res.json());
    } else if (provider === 'hive') {
      const fd = new FormData();
      fd.append('media', new Blob([bytes], { type: mime }), 'logo');
      res = await fetch(String(env.MOD_ENDPOINT || 'https://api.thehive.ai/api/v2/task/sync'), {
        method: 'POST', signal: ac.signal,
        headers: { authorization: 'token ' + env.MOD_API_KEY },
        body: fd,
      });
      if (!res.ok) return { provider, verdict: 'error', score: 0, raw: { status: res.status } };
      parsed = readVerdictHive(await res.json(), env);
    } else {
      return { provider, verdict: 'error', score: 0, raw: { why: 'unknown MOD_PROVIDER ' + provider } };
    }
    return { provider, verdict: parsed.verdict, score: parsed.score, raw: { why: parsed.why || null } };
  } catch (e) {
    // Abort, DNS, TLS, malformed JSON — all of it lands here and all of it is
    // 'error', which is invisible. Never optimistic.
    return { provider, verdict: 'error', score: 0, raw: { why: String((e && e.name) || e).slice(0, 80) } };
  } finally { clearTimeout(timer); }
}

/* ══════════════════════════════════════════════════════════════════════════
   ROUTES
   ══════════════════════════════════════════════════════════════════════════ */
export async function handleLivery(request, env, u) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_RW });
  const route = u.pathname.replace(/^\/api\/livery\/?/, '').replace(/\/+$/, '');

  /* ── what the wrap shop shows before anyone uploads anything ──────────── */
  if (route === 'config') {
    let verified = false, provider = null;
    try {
      const r = await fetch(sbBase(env) + '/rest/v1/van_livery_provider?select=provider,verified_at&limit=1',
        { headers: { apikey: env.SB_ANON, authorization: 'Bearer ' + env.SB_ANON } });
      const rows = r.ok ? await r.json() : [];
      verified = !!(rows[0] && rows[0].verified_at);
      provider = (rows[0] && rows[0].provider) || null;
    } catch (e) {}
    return j({
      ok: true,
      // The shop uses these three to decide what to SAY. "Custom logos are not
      // open yet" is a much better message than an upload button that fails.
      configured: !!(env.MOD_PROVIDER && env.MOD_API_KEY),
      verified, provider,
      maxBytes: MAX_BYTES, mimes: OK_MIME,
    });
  }

  /* ── the player asks for their pending upload to be scanned ───────────── */
  if (route === 'scan' && request.method === 'POST') {
    const user = await whoami(env, request);
    if (!user) return j({ ok: false, error: 'unauthorized' }, 401);
    if (!env.SB_SERVICE) return j({ ok: false, error: 'not_configured' }, 503);

    // Read the row as the USER, so RLS decides what they may act on.
    const r = await fetch(sbBase(env) + '/rest/v1/van_liveries?select=logo_status,quarantine_path,mime,bytes&owner_id=eq.' + user.id + '&limit=1',
      { headers: { apikey: env.SB_ANON, authorization: 'Bearer ' + user.token } });
    const row = ((r.ok ? await r.json() : []) || [])[0];
    if (!row) return j({ ok: false, error: 'no_livery' }, 404);
    if (row.logo_status !== 'uploaded') return j({ ok: false, error: 'not_pending', status: row.logo_status }, 409);
    if (!OK_MIME.includes(row.mime) || !(row.bytes > 0 && row.bytes <= MAX_BYTES)) {
      await rpcService(env, 'van_livery_record_scan', {
        p_owner: user.id, p_provider: 'precheck', p_verdict: 'reject', p_score: 1,
        p_raw: { why: 'type or size outside policy' } });
      return j({ ok: true, verdict: 'reject', why: 'type or size outside policy' });
    }

    const obj = await storageGet(env, 'van-livery-quarantine', row.quarantine_path);
    if (!obj) {
      await rpcService(env, 'van_livery_record_scan', {
        p_owner: user.id, p_provider: 'fetch', p_verdict: 'error', p_score: 0,
        p_raw: { why: 'quarantine object unreadable' } });
      return j({ ok: true, verdict: 'error', why: 'could not read the upload' });
    }

    const v = await scanOne(env, obj.bytes, row.mime);
    await rpcService(env, 'van_livery_record_scan', {
      p_owner: user.id, p_provider: v.provider, p_verdict: v.verdict,
      p_score: v.score, p_raw: v.raw });

    /* ⚠ The player is told the SHAPE of the outcome, never the score and never
       the class. Telling someone exactly which classifier they tripped and by
       how much is a tuning signal for anyone trying to get something past it. */
    return j({ ok: true, verdict: v.verdict === 'clean' ? 'queued' : 'held' });
  }

  /* ── the self-test that unlocks approval  🔴 see the header ───────────── */
  if (route === 'selftest' && request.method === 'POST') {
    const user = await whoami(env, request);
    if (!user) return j({ ok: false, error: 'unauthorized' }, 401);
    if (!env.SB_SERVICE) return j({ ok: false, error: 'not_configured' }, 503);

    const posUrl = String(env.MOD_SELFTEST_POSITIVE_URL || '');
    if (!posUrl) {
      return j({ ok: false, error: 'no_positive_asset',
        detail: 'Set MOD_SELFTEST_POSITIVE_URL to the test asset your provider gives you. '
              + 'Without something that MUST come back dirty, this test can only prove the '
              + 'provider is reachable — which is the failure mode it exists to catch.' }, 400);
    }

    // 1. a benign asset — a 1x1 PNG we generate here, so it depends on nothing.
    const benign = Uint8Array.from(atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    ), c => c.charCodeAt(0));
    const cleanRes = await scanOne(env, benign.buffer, 'image/png');

    // 2. the provider's own positive fixture.
    let dirtyRes = { verdict: 'error', raw: { why: 'positive asset not fetched' } };
    try {
      const pr = await fetch(posUrl);
      if (pr.ok) dirtyRes = await scanOne(env, await pr.arrayBuffer(), pr.headers.get('content-type') || 'image/jpeg');
    } catch (e) {}

    const passed = cleanRes.verdict === 'clean' && dirtyRes.verdict !== 'clean' && dirtyRes.verdict !== 'error';
    const note = 'benign→' + cleanRes.verdict + ' positive→' + dirtyRes.verdict;

    // Written as the CALLER: the provider table is admin-only under RLS, so a
    // non-admin hitting this route gets a 4xx from Postgres rather than a pass.
    try {
      await rpcAsUser(env, user, 'van_livery_set_provider', {
        p_provider: String(env.MOD_PROVIDER || ''), p_passed: passed, p_note: note });
    } catch (e) {
      return j({ ok: false, error: 'not_a_reviewer', detail: String(e.message || e).slice(0, 200) }, 403);
    }
    return j({ ok: true, passed, benign: cleanRes.verdict, positive: dirtyRes.verdict,
      detail: passed ? 'Adapter verified. Approvals are now possible.'
                     : 'NOT verified — approvals stay blocked. ' + note });
  }

  /* ── a human decides; approval is also the only thing that publishes ──── */
  if (route === 'review' && request.method === 'POST') {
    const user = await whoami(env, request);
    if (!user) return j({ ok: false, error: 'unauthorized' }, 401);
    const body = await request.json().catch(() => ({}));
    const owner = String(body.owner || ''), decision = String(body.decision || '');
    const note = String(body.note || '').slice(0, 500);
    if (!owner) return j({ ok: false, error: 'owner_required' }, 400);

    let publicPath = null;
    if (decision === 'approve') {
      if (!env.SB_SERVICE) return j({ ok: false, error: 'not_configured' }, 503);
      // Read the row with the service key — the reviewer needs the quarantine
      // path, and admins can read it under RLS anyway.
      const r = await fetch(sbBase(env) + '/rest/v1/van_liveries?select=quarantine_path,mime,logo_status&owner_id=eq.' + owner + '&limit=1',
        { headers: { apikey: env.SB_SERVICE, authorization: 'Bearer ' + env.SB_SERVICE } });
      const row = ((r.ok ? await r.json() : []) || [])[0];
      if (!row || !row.quarantine_path) return j({ ok: false, error: 'nothing_to_publish' }, 404);

      const obj = await storageGet(env, 'van-livery-quarantine', row.quarantine_path);
      if (!obj) return j({ ok: false, error: 'quarantine_unreadable' }, 502);

      /* The published name is derived, not carried over: the uploader chose the
         quarantine filename and it should not survive into a public URL. */
      const ext = row.mime === 'image/png' ? 'png' : row.mime === 'image/webp' ? 'webp' : 'jpg';
      publicPath = owner + '/livery.' + ext;
      const put = await storagePut(env, 'van-livery', publicPath, obj.bytes, row.mime);
      if (!put) return j({ ok: false, error: 'publish_failed' }, 502);
    }

    /* ⚠ THE RPC IS CALLED AS THE REVIEWER, NOT AS THE SERVICE. It re-checks
       ms_is_admin(), re-checks that the row is machine-clean, and re-checks
       that the provider self-test passed. If any of those fail the state does
       not move — and the bytes sitting in the public bucket are unreachable,
       because the public view only follows public_path for an approved row. */
    try {
      const out = await rpcAsUser(env, user, 'van_livery_review', {
        p_owner: owner, p_decision: decision, p_public_path: publicPath, p_note: note });
      return j({ ok: true, livery: out });
    } catch (e) {
      return j({ ok: false, error: 'refused', detail: String(e.message || e).slice(0, 300) }, 403);
    }
  }

  return j({ ok: false, error: 'not_found' }, 404);
}
