/* ═══════════════════════════════════════════════════════════════════════════
   community.realtime.js — live wire, typing indicators, and notifications.

   Three separate concerns that share one Supabase channel budget:

   1. POSTGRES CHANGES — new wire messages, announcements, votes and payouts
      arrive without a reload. RLS applies to realtime exactly as it does to a
      SELECT, so subscribing cannot widen what a player can see.

   2. TYPING — a BROADCAST channel, not a table. Typing is worthless three
      seconds later, so writing it to Postgres would be pure cost: rows nobody
      reads, RLS to maintain, and a cleanup job. Broadcast is ephemeral by
      design and never touches disk.

   3. NOTIFICATIONS — the browser Notification API, fired from the events
      above, always naming the community so an alert is actionable from the
      lock screen.
      ⚠ SCOPE, stated honestly: this notifies while the page is OPEN (or the
      service worker is alive). Delivery to a CLOSED app needs Web Push with a
      VAPID keypair and a server to send from — that is a separate build, not
      something this file can fake.
   ═══════════════════════════════════════════════════════════════════════════ */

import { bridge } from './community.bridge.js';

const chans = new Map();          // key -> channel, so re-subscribing is cheap
let typingTimer = null;
const typingSeen = new Map();     // name -> last seen ms

/* ── notifications ───────────────────────────────────────────────────────── */

export function notifyState() {
  try {
    if (typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission;      // 'granted' | 'denied' | 'default'
  } catch (e) { return 'unsupported'; }
}

export async function askNotifyPermission() {
  try {
    if (typeof Notification === 'undefined') return 'unsupported';
    if (Notification.permission !== 'default') return Notification.permission;
    return await Notification.requestPermission();
  } catch (e) { return 'denied'; }
}

/* Fire a notification. `community` is not decoration — an alert that says
   "New announcement" tells a player in four communities nothing at all, so the
   community name leads the title.
   Prefers the service worker: a plain `new Notification()` is ignored on
   Android entirely, and dies with the tab everywhere else. */
export async function notify(community, title, body, tag) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
    const head = community ? `${community} · ${title}` : title;
    const opts = {
      body: String(body || '').slice(0, 180),
      // Same tag replaces rather than stacks — ten chat lines should not be ten
      // notifications the player has to dismiss one at a time.
      tag: tag || ('community-' + (community || 'x')),
      renotify: false,
      icon: '/assets/artwork/gameicons/Bank%20of%20Ethos.png',
      badge: '/assets/artwork/gameicons/Bank%20of%20Ethos.png',
    };
    if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      const reg = await navigator.serviceWorker.ready;
      if (reg && reg.showNotification) { await reg.showNotification(head, opts); return true; }
    }
    new Notification(head, opts);
    return true;
  } catch (e) { return false; }
}

/* ── channels ────────────────────────────────────────────────────────────── */

function client() {
  try { const b = bridge(); return (b && b.cloud && b.cloud.client) || null; } catch (e) { return null; }
}

export function unsubscribeAll() {
  const c = client();
  for (const [, ch] of chans) { try { c && c.removeChannel(ch); } catch (e) {} }
  chans.clear();
  typingSeen.clear();
}

/* The corporation's wire: new messages + who is typing.
   onMessage(row) fires per inserted row; onTyping(names[]) fires whenever the
   set of people currently typing changes. */
export function subscribeWire(corpId, onMessage, onTyping) {
  const c = client();
  if (!c || !corpId) return null;
  const key = 'wire:' + corpId;
  if (chans.has(key)) return chans.get(key);

  const ch = c.channel(key, { config: { broadcast: { self: false } } });

  ch.on('postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'guild_chat', filter: 'corp_id=eq.' + corpId },
    (payload) => { try { onMessage && onMessage(payload.new); } catch (e) {} });

  ch.on('broadcast', { event: 'typing' }, (m) => {
    try {
      const name = m && m.payload && m.payload.name;
      if (!name) return;
      typingSeen.set(name, Date.now());
      pumpTyping(onTyping);
    } catch (e) {}
  });

  ch.subscribe();
  chans.set(key, ch);
  return ch;
}

/* A name is "typing" for 4s after its last keystroke event. The timer is what
   makes the indicator disappear when someone stops typing without sending —
   without it the row sticks forever, which is the classic broken version. */
function pumpTyping(onTyping) {
  const emit = () => {
    const now = Date.now();
    for (const [n, at] of [...typingSeen]) if (now - at > 4000) typingSeen.delete(n);
    try { onTyping && onTyping([...typingSeen.keys()]); } catch (e) {}
    if (!typingSeen.size && typingTimer) { clearInterval(typingTimer); typingTimer = null; }
  };
  emit();
  if (!typingTimer) typingTimer = setInterval(emit, 1200);
}

// Throttled so a fast typist sends a few events a second, not one per keypress.
let lastTypingSent = 0;
export function sendTyping(corpId, name) {
  try {
    const ch = chans.get('wire:' + corpId);
    if (!ch || !name) return;
    const now = Date.now();
    if (now - lastTypingSent < 1500) return;
    lastTypingSent = now;
    ch.send({ type: 'broadcast', event: 'typing', payload: { name: String(name).slice(0, 40) } });
  } catch (e) {}
}

/* Everything that should reach a player about a community they are in.
   onEvent({kind, row}) — 'announcement' | 'vote' | 'reward' | 'member'. */
export function subscribeCommunity(communityId, communityName, onEvent, opts) {
  const c = client();
  if (!c || !communityId) return null;
  const key = 'community:' + communityId;
  if (chans.has(key)) return chans.get(key);
  const uid = (opts && opts.userId) || null;
  const ch = c.channel(key);

  const on = (table, kind, event) => ch.on('postgres_changes',
    { event: event || 'INSERT', schema: 'public', table, filter: 'community_id=eq.' + communityId },
    (p) => {
      const row = p.new || p.old || {};
      try { onEvent && onEvent({ kind, row }); } catch (e) {}
      // ⚠ Only notify for things the player did not just do themselves.
      //   Being pinged for your own announcement is noise, and it is the
      //   fastest way to get notifications switched off entirely.
      if (kind === 'announcement' && row.author_id !== uid) {
        notify(communityName, 'New announcement', row.body || '', 'ann-' + communityId);
      } else if (kind === 'vote' && row.created_by !== uid) {
        notify(communityName, 'A vote is open', row.title || 'Cast your ballot.', 'vote-' + communityId);
      } else if (kind === 'reward' && row.user_id === uid) {
        notify(communityName, 'You have a payout', '🔥 ' + Math.floor(row.amount || 0).toLocaleString() + ' waiting to claim.', 'reward-' + communityId);
      }
    });

  on('community_announcements', 'announcement');
  on('community_votes', 'vote');
  on('community_rewards', 'reward');
  on('community_members', 'member');
  ch.subscribe();
  chans.set(key, ch);
  return ch;
}
