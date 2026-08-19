import fs from 'node:fs';
const lib=fs.readFileSync('.gauntlet/shots/probe/skinlib.js','utf8');
const tpl=fs.readFileSync('.gauntlet/shots/probe/skin.js','utf8');
// narrow sky band: [head, bandEnd, interior, floorTop, floorVal, sill]
const mk=(b1,iv,fl)=>[[0,.28],[.04,1],[b1,1],[b1+.16,iv+.05],[b1+.22,iv],[.80,iv],[.83,fl],[.90,fl],[.93,.16],[1,.16]];
const CAND=[
 {name:'M b.22 iv.13 4x',hex:0x3a4860,stops:mk(.22,.13,.50),blind:.42,blindW:.26},
 {name:'N b.26 iv.13 4x',hex:0x3a4860,stops:mk(.26,.13,.50),blind:.42,blindW:.26},
 {name:'O b.22 iv.10 5x',hex:0x41506b,stops:mk(.22,.10,.50),blind:.40,blindW:.26},
 {name:'P b.20 iv.10 6x',hex:0x475874,stops:mk(.20,.10,.50),blind:.38,blindW:.26},
 {name:'Q b.22 iv.13 3.2x',hex:0x354258,stops:mk(.22,.13,.50),blind:.42,blindW:.26},
 {name:'R b.30 iv.13 4x noblind',hex:0x3a4860,stops:mk(.30,.13,.50),blind:0,blindW:0},
];
fs.writeFileSync(process.env.SP+'/eval3.js',tpl.replace('__SKINLIB__',lib).replace('__CAND__',JSON.stringify(CAND)));
