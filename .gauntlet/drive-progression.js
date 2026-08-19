/* ══════════════════════════════════════════════════════════════════════════
   🌳 THE PROGRESSION GATE — driven in the real browser, not read off a diff.

   Run:
     node .gauntlet/shot.mjs .gauntlet/shots/p-drive.png --scene --wait 30000 \
       --eval "$(cat .gauntlet/drive-progression.js)"

   Six claims, and the one that matters most is round 3.

   1. THE ZONE GATE REFUSES AND ALLOWS THE RIGHT THINGS.
   2. UNLOCKING SPENDS, AND THE SPEND SURVIVES A SAVE ROUND TRIP.
   3. 🔴 A LEGACY SAVE IS NOT RETRO-LOCKED. The save is written, its
      progression slice is DELETED (which is byte-identical to a save written
      before this feature shipped), and the city is reloaded from it. Every
      zone on the map must come back unlocked and free.
   4. THE LICENCE GATE READS THE LIVE MANIFEST, not a copy.
   5. A FIGURE WITH NO MODEL BEHIND IT READS UNAVAILABLE, with the real reason.
   6. THE GATE FAILS OPEN when this module is broken underneath it.

   ⚠ Logs are truncated at 400 chars by the harness, so every line is short.
   ══════════════════════════════════════════════════════════════════════════ */
(async () => {
  const out = (k, v) => console.log('PG ' + k + ' ' + JSON.stringify(v));
  const P = window.MythicProgress, Z = window.MythicZoning, B = window.MythicCityBridge;
  if (!P) return out('FATAL', 'no MythicProgress');
  if (!Z) return out('FATAL', 'no MythicZoning');

  /* ── 1. the gate ───────────────────────────────────────────────────────── */
  const openZone = 'r_low', shutZone = 'r_high';
  const a = Z.applyRect(2, 2, 6, 6, openZone);
  const b = Z.applyRect(8, 2, 10, 4, shutZone);
  out('1.gate', { open: a, shut: b, openOk: P.zoneUnlocked(openZone), shutOk: P.zoneUnlocked(shutZone) });
  out('1.blame', P.zoneBlockedBy(shutZone));

  /* ── 2. unlock + round trip ────────────────────────────────────────────── */
  const before = P.points();
  const u = P.unlock('res_row');
  out('2.unlock', { before, after: P.points(), ok: u.ok, reason: u.reason || null });

  /* ── 4. the licence gate, read off the live manifest ───────────────────── */
  const rep = P.report();
  const sci = rep.nodes.find((n) => n.id === 'sci_lab');
  out('4.licence', { state: sci.state, key: sci.licence.key, label: sci.licence.label,
                     price: sci.licence.price, held: sci.licence.held });

  /* ── 3. the legacy save ────────────────────────────────────────────────── */
  /* Grant a node that opens a gated zone, paint that zone, then delete the
     whole progression slice from the save. That is exactly what a save written
     before this feature looks like — a city with r_high on the map and nothing
     that says the player was ever allowed to put it there. */
  P._grant('res_high');
  const painted = Z.applyRect(8, 2, 10, 4, shutZone);
  const zonesBefore = Object.keys((window.__nc.game.zones) || {}).length;
  out('3.setup', { painted, zonesBefore, high: P.zoneUnlocked(shutZone) });

  const raw = window.__nc.serialize();
  const obj = JSON.parse(raw);
  const hadSlice = !!(obj.ext && obj.ext.progress);
  if (obj.ext) delete obj.ext.progress;
  const legacyJson = JSON.stringify(obj);

  B.loadCity = async () => legacyJson;
  await window.__nc.loadState();
  try { Z.afterLoad(); } catch (e) {}
  const ad = P.afterLoad();

  const st = P.state();
  const zonesAfter = Object.keys((window.__nc.game.zones) || {}).length;
  out('3.legacy', { hadSlice, adopted: ad.adopted, legacy: st.legacy, zonesAfter });
  out('3.zones', st.zones);
  out('3.granted', st.granted);
  /* The claim in one line: the city came back able to paint the zone it is
     already made of, and it paid nothing for the privilege. */
  const repaint = Z.applyPaint(9, 3, shutZone);
  out('3.verdict', { highUnlocked: P.zoneUnlocked(shutZone), spent: st.spent,
                     repaintRefused: !!(repaint && repaint.locked) });

  /* ── 5. a figure with no model behind it ───────────────────────────────── */
  /* The rule this panel is built under cannot be checked by reading the code,
     because the failure it guards against is a plausible number. So blind a
     host reader and prove the row goes UNAVAILABLE with the real reason rather
     than to zero. `_blind` is a driver seam and is documented as one. */
  P._blind('cinderRate');
  const na = P.report().milestones.filter((m) => !m.progress.ok);
  out('5.unavailable', { rows: na.length, why: na.length ? na[0].progress.why : null,
                         anyInventedZero: na.some((m) => m.progress.text != null) });

  /* ── 6. the gate fails OPEN ────────────────────────────────────────────── */
  /* Break the state layer underneath the wrapper and paint a locked zone. A
     gate that refuses on an internal error is indistinguishable from one that
     refuses on purpose, and the player cannot tell or fix it. */
  const realHas = P.zoneUnlocked;
  let threw = false;
  try {
    P.tree.NODES.push(null);                    // makes unlockedZones() throw
    const r = Z.applyPaint(12, 12, 'o_high');
    threw = !(r && r.locked);
  } catch (e) { threw = false; }
  P.tree.NODES.pop();
  out('6.failsOpen', { paintedThroughBrokenGate: threw });
})();
