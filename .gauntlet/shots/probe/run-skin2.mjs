import fs from 'node:fs';
const lib=fs.readFileSync('.gauntlet/shots/probe/skinlib.js','utf8');
const tpl=fs.readFileSync('.gauntlet/shots/probe/skin.js','utf8');
const mk=(iv,sky,flo,head,sill)=>[[0,head],[.05,sky],[.30,sky],[.45,iv+.06],[.50,iv],[.80,iv],[.84,flo],[.90,flo],[.93,sill],[1,sill]];
const CAND=[
 {name:'G 3a4860 iv.14',hex:0x3a4860,stops:mk(.14,1,.55,.30,.18),blind:.42,blindW:.26},
 {name:'H 41506b iv.12',hex:0x41506b,stops:mk(.12,1,.55,.30,.18),blind:.42,blindW:.26},
 {name:'I 3a4860 iv.20',hex:0x3a4860,stops:mk(.20,1,.55,.30,.18),blind:.45,blindW:.26},
 {name:'J 364358 iv.18',hex:0x364358,stops:mk(.18,1,.55,.30,.18),blind:.45,blindW:.26},
 {name:'K 41506b iv.18',hex:0x41506b,stops:mk(.18,1,.60,.32,.20),blind:.48,blindW:.26},
 {name:'L 465673 iv.16',hex:0x465673,stops:mk(.16,1,.58,.30,.18),blind:.45,blindW:.26},
];
fs.writeFileSync(process.env.SP+'/eval2.js',tpl.replace('__SKINLIB__',lib).replace('__CAND__',JSON.stringify(CAND)));
