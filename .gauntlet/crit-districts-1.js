(async () => {
  const nc = window.__nc, D = window.MythicDistricts, Z = window.MythicZoning,
        P = window.MythicProgress, L = window.MythicLandValue, G = nc.game;
  const R = {}, K = (x,z) => x+','+z;

  /* ── 0. BOOT STATE, BEFORE ANYTHING IS GRANTED ─────────────────────────── */
  R.boot = {
    progState: P ? { specs: P.state().specs, legacy: P.state().legacy, unlocked: P.state().unlocked, granted: P.state().granted } : null,
    districtVerifyAtBoot: nc.districtVerify(),
    landValueVerifyAtBoot: nc.landValueVerify() ? { ok: nc.landValueVerify().ok, problems: nc.landValueVerify().problems } : null,
  };

  /* ── 1. THE GATE, with NOTHING researched. Every door. ──────────────────── */
  const gate = {};
  const LOCK = 'c_mythic';
  gate.specUnlocked = P.specUnlocked(LOCK);
  gate.blockedBy = P.specBlockedBy(LOCK);
  // door A: arm() from the chip row
  gate.armReturned = D.arm(LOCK);
  gate.armedAfter = D.armed();
  // door B: __nc.districtSet -> _set -> onZone
  const fx = 5, fz = 5;
  Z.applyPaint(fx, fz, 'c_high', null);
  gate.zonePaintedForTest = Z.zoneAt(fx, fz);
  gate.districtSet = nc.districtSet(fx, fz, LOCK);
  gate.specAfterDistrictSet = D.specAt(fx, fz);
  // door C: applyPaint with the spec argument (the real player path)
  Z.applyPaint(fx, fz, 'c_high', LOCK);
  gate.specAfterApplyPaint = D.specAt(fx, fz);
  // door D: MythicDistricts.onZone called directly
  gate.onZoneDirect = D.onZone(fx, fz, 'c_high', LOCK);
  gate.specAfterOnZone = D.specAt(fx, fz);
  // door E: a SAVE carrying the locked spec
  window.MythicCitySave.restore({ v:1, districts: { v:1, spec: { '6,6': LOCK, '7,7':'c_retail' } } });
  gate.afterSaveRestore_specAt66 = D.specAt(6,6);
  gate.afterSaveRestore_specAt77 = D.specAt(7,7);
  gate.statsAfterSave = D.stats();
  // does afterLoad() reconcile it away? (6,6 has no zone)
  gate.afterLoad = D.afterLoad();
  gate.afterReconcile_66 = D.specAt(6,6);
  // does a locked spec loaded from a save then DEVELOP?  zone 6,6 commercial and ask
  Z.applyPaint(6,6,'c_high',undefined);
  window.MythicCitySave.restore({ v:1, districts: { v:1, spec: { '6,6': LOCK } } });
  gate.loadedOntoZonedTile = D.specAt(6,6);
  gate.wouldBuildAtLoaded = nc.districtAt(6,6);
  gate.lockedWrites = D.stats().lockedWrites;
  gate.verifyAfterLockedWrites = D.verify().problems;
  R.gate = gate;

  /* ── 2. UNKNOWN SPEC ID FROM A NEWER BUILD — kept, not dropped ──────────── */
  window.MythicCitySave.restore({ v:1, districts: { v:1, spec: { '8,8':'c_fromthefuture', '9,9':'c_retail', 'garbage':'c_retail', '10,10': 42 } } });
  const unk = { at88: D.specAt(8,8), at99: D.specAt(9,9), atGarbage: D.specAt(0,0), size: D.stats().specialised, per: D.stats().per };
  // survive a save/load round trip?
  const collected = window.MythicCitySave.collect();
  unk.collectedSlice = collected.districts;
  window.MythicCitySave.restore(collected);
  unk.after_roundtrip_88 = D.specAt(8,8);
  // reconcile must not eat the unknown id
  unk.afterLoadDropped = D.afterLoad().dropped;
  unk.after_reconcile_88 = D.specAt(8,8);
  R.unknownSpec = unk;

  /* ── 3. AN OLD SAVE (no districts slice at all) ─────────────────────────── */
  window.MythicCitySave.restore({ v:1 });
  R.oldSave = { specialised: D.stats().specialised, afterLoad: D.afterLoad(),
                progAfter: { specs: P.state().specs, legacy: P.state().legacy } };
  R.oldSave.everyZoneStillPaintable = ['c_low','c_high','i_mfg'].map(z => Z.applyPaint(11,11,z,undefined));
  Z.applyPaint(11,11,null,undefined);
  return R;
})()
