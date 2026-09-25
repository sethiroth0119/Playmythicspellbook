/* 🎯 NODE CAMPAIGNS, WIRED IN (v121v76).

   Asked for: "Add this to the game every function — I already added the SQL."
   Verified against the live database before wiring: 3 tables, 2 RPCs, 7 policy
   rows and the elpaso_relief seed on N-42 are all present.

   THE ONE THING THE HANDOFF GOT WRONG, and it would have cost a shipped
   feature: it says the City Node drawer's `tw-act-attack` button — "⚔ Attack
   PRN" — becomes "🎯 Do Campaign". On the branch it came from that was true.
   In THIS tree that id is "🤝 Do business with this city" (window.MythicCityTrade)
   and the raid has moved to `tw-act-raid`. Renaming it as instructed would have
   deleted City Trade to make room for campaigns. So Do Campaign is its own
   button, and this suite pins that all three survive together.

   Run: node _campaigns_smoke.mjs */
import { readFileSync, existsSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');

/* ── the module landed ── */
{
  const files = ['index.js', 'campaigns.data.js', 'campaigns.api.js', 'campaigns.bridge.js'];
  const missing = files.filter((f) => !existsSync('./public/src/campaigns/' + f));
  ok(missing.length === 0, 'all four module files are present', missing.join(', '));
  ok(existsSync('./sql/125_node_campaigns.sql'), 'the migration is filed');
  ok(!existsSync('./sql/038_node_campaigns.sql'), 'and NOT as a fourth 038, which already collides three ways');
  const idx = readFileSync('./public/src/campaigns/index.js', 'utf8');
  ok(/window\.MythicNodeCampaigns/.test(idx), 'it registers window.MythicNodeCampaigns');
  ok(/MythicBridge/.test(readFileSync('./public/src/campaigns/campaigns.bridge.js', 'utf8')),
    'and reads the legacy app only through the bridge');
}

/* ── THE THREE BUTTONS COEXIST ── */
{
  ok(/id="tw-act-campaign"/.test(SRC), 'Do Campaign has a button');
  ok((SRC.match(/id="tw-act-campaign"/g) || []).length === 2, 'in both drawer layouts', String((SRC.match(/id="tw-act-campaign"/g) || []).length));
  ok(/Do business with this city/.test(SRC), 'City Trade\'s button SURVIVED — the handoff would have renamed it away');
  ok(/id="tw-act-raid"/.test(SRC), 'and so did the raid');
  ok(!/⚔ Attack PRN<\/button>` : ''}\s*\n\s*<button class="btn-primary" id="tw-act-attack"/.test(SRC),
    'nothing was rewired onto tw-act-attack, which is City Trade\'s id in this tree');
  {
    /* Its handler must be its own, and must not have displaced the trade one. */
    const i = SRC.indexOf("act('tw-act-campaign'");
    ok(i > 0, 'it has its own handler');
    const seg = SRC.slice(i, i + 420);
    ok(/NC\.open\(nid\)/.test(seg), 'which opens the picker');
    ok(/_twAttackFlow\(nid\)/.test(seg), 'and falls back to the raid if the module 404s rather than doing nothing');
    ok(/MythicCityTrade/.test(SRC), 'the trade handler is still there');
  }
}

/* ── the bridge ── */
{
  const i = SRC.indexOf('    nodeCampaigns: {');
  ok(i > 0, 'the bridge carries a nodeCampaigns block');
  const seg = SRC.slice(i, SRC.indexOf('\n    },', i));
  for (const fn of ['node:', 'selectedNode:', 'onNodeScreen:', 'canAttack:', 'attack:', 'getRes:',
                    'spendRes:', 'refundRes:', 'adoptCinder:', 'missions:', 'missionRun:',
                    'missionStart:', 'missionResume:', 'goMissions:']) {
    ok(seg.indexOf(fn) > 0, 'bridge exposes ' + fn.replace(':', '()'));
  }
  ok(/_refundRes\(id, n\)/.test(seg), 'refunds go through the UNCAPPED undo, never addRes');
  ok(/_gemsTaxExempt/.test(seg) && /walletSeqProgress/.test(seg),
    'the Cinder adoption is tax-exempt and moves the wallet seq — the give RPC already charged server-side');
  ok(!/spendGems|addGems/.test(seg), 'and there is no local Cinder spend, because the server does it');
}
/* every symbol the bridge reaches for must exist here */
{
  const need = ['_twForge', '_twState', '_twPlayerCorp', '_twAttackFlow', 'function getRes',
                'function spendResources', '_refundRes', '_gemsTaxExempt', 'getAllCampaigns', 'rlcStartRun'];
  const gone = need.filter((n) => SRC.indexOf(n) < 0);
  ok(gone.length === 0, 'every symbol the bridge depends on is still in index.html', gone.join(', '));
}

/* ── the tab and the module tag ── */
ok(/const _ncTabHtml = \(\(\) => \{ try \{ const NC = window\.MythicNodeCampaigns;/.test(SRC),
  'the Campaigns tab asks the module for its half');
{
  const i = SRC.indexOf('const _ncTabHtml');
  const seg = SRC.slice(i, i + 700);
  ok(/BATTLE HISTORY/.test(seg), 'and battle history is still under it, not replaced');
  ok(/catch \(e\) \{ return ''; \}/.test(seg), 'a module that throws costs the tab nothing');
}
ok(/<script type="module" src="src\/campaigns\/index\.js\?v=v121v76nc1"><\/script>/.test(SRC),
  'the module tag is present with a bumped ?v=');
ok((SRC.match(/resources\/chain\.js/g) || []).length >= 1 && (SRC.match(/<script type="module" src="src\/resources\/chain\.js/g) || []).length === 1,
  'chain.js was NOT added a second time — it is already loaded in this tree');
ok(/window\.BUILD_VERSION = 'v121v(7[6-9]|[8-9]\d|\d{3,})'/.test(SRC), 'build v121v76 or later');
console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
