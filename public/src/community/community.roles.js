/* ═══════════════════════════════════════════════════════════════════════════
   community.roles.js — permission checks, in one place.

   ⚠ THESE ARE UI HINTS, NOT SECURITY. The real boundary is the RLS in
   sql/001..003 and the SECURITY DEFINER RPCs. Everything here exists so the UI
   does not offer a button that the server will refuse — nothing more. If you
   ever find yourself relying on one of these to keep something safe, the check
   belongs in a policy instead.

   The ladder mirrors the schema exactly:
     owner   → communities.owner_id. Not a role. Cannot be demoted by anyone.
     leader  → may approve, promote to officer, edit the community
     officer → may approve members and corps
     member  → may contribute and read
   ═══════════════════════════════════════════════════════════════════════════ */

import { bridge } from './community.bridge.js';

export const ROLE_ORDER = ['member', 'officer', 'leader'];
export const ROLE_LABEL = { member: 'Member', officer: 'Officer', leader: 'Leader' };

export function myUserId() { return bridge().userId(); }

export function isOwner(community) {
  const uid = myUserId();
  return !!(uid && community && community.owner_id === uid);
}

export function myMembership(members) {
  const uid = myUserId();
  if (!uid || !Array.isArray(members)) return null;
  return members.find((m) => m && m.user_id === uid) || null;
}

export function myRole(community, members) {
  if (isOwner(community)) return 'owner';
  const m = myMembership(members);
  return (m && m.status === 'active') ? (m.role || 'member') : null;
}

export function isActiveMember(community, members) {
  if (isOwner(community)) return true;
  const m = myMembership(members);
  return !!(m && m.status === 'active');
}

export function isLeadership(community, members) {
  if (isOwner(community)) return true;
  const r = myRole(community, members);
  return r === 'officer' || r === 'leader';
}

// Only the owner mints another leader — community_set_member() enforces the
// same rule server-side, so a compromised officer cannot escalate a community.
export function canSetRole(community, members, targetRole) {
  if (!isLeadership(community, members)) return false;
  if (targetRole === 'leader') return isOwner(community);
  return true;
}

// The owner's row is untouchable by anyone but the owner.
export function canManageMember(community, members, targetUserId) {
  if (!isLeadership(community, members)) return false;
  if (community && targetUserId === community.owner_id) return isOwner(community);
  return true;
}

export function canEditCommunity(community, members) { return isLeadership(community, members); }
export function canApproveCorps(community, members)  { return isLeadership(community, members); }
export function canViewAudit(community, members)     { return isLeadership(community, members); }

// Affiliating is the CORP side of the handshake, not the community side: only
// a founder can sign their corp in, and only if it is not already affiliated.
export function canAffiliateMyCorp(corpRows) {
  const b = bridge();
  if (!b.amCorpFounder()) return false;
  const corp = b.myCorp();
  if (!corp || !corp.id) return false;
  const existing = (corpRows || []).find((r) => r && r.corp_id === corp.id);
  return !existing || existing.status === 'rejected' || existing.status === 'left';
}
