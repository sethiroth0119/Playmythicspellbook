import { abRun } from './_forge-harness.mjs';
const rep = await abRun('.gauntlet/drive-scroll-keep.mjs', {
  ref: 'refs/forge-width/before', baseRef: 'refs/forge-width/after',
  allowOneSided: ['public/assets'], timeout: 1800000 });
const show = (n, s) => {
  console.log('\n===== ' + n + ' code=' + (s && s.code) + ' =====');
  console.log(String((s && s.stdout) || '').slice(-1200));
  const e = String((s && s.stderr) || '').trim(); if (e) console.log('[stderr] ' + e.slice(-400));
};
show('AFTER (refs/forge-width/after)', rep.base);
show('BEFORE (refs/forge-width/before)', rep.head);
