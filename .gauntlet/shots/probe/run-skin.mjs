import fs from 'node:fs';
const lib = fs.readFileSync('.gauntlet/shots/probe/skinlib.js','utf8');
const tpl = fs.readFileSync('.gauntlet/shots/probe/skin.js','utf8');
const S = [[0,.30],[.05,1],[.30,1],[.45,.20],[.50,.10],[.80,.10],[.84,.55],[.90,.55],[.93,.18],[1,.18]];
const S2= [[0,.30],[.05,1],[.30,1],[.45,.16],[.50,.05],[.80,.05],[.84,.60],[.90,.60],[.93,.14],[1,.14]];
const S3= [[0,.35],[.05,1],[.30,1],[.45,.30],[.50,.22],[.80,.22],[.84,.55],[.90,.55],[.93,.20],[1,.20]];
const CAND = [
 {name:'A base 0x333f54', hex:0x333f54, stops:S,  blind:.42, blindW:.26},
 {name:'B dim  0x2b3545', hex:0x2b3545, stops:S,  blind:.42, blindW:.26},
 {name:'C brt  0x3d4c62', hex:0x3d4c62, stops:S,  blind:.42, blindW:.26},
 {name:'D noblind',       hex:0x333f54, stops:S,  blind:0,   blindW:0},
 {name:'E contrast',      hex:0x36435a, stops:S2, blind:.45, blindW:.26},
 {name:'F gentle',        hex:0x2a3444, stops:S3, blind:.40, blindW:.26},
];
fs.writeFileSync('/tmp/claude-0/-home-user-Playmythicspellbook/40854a97-ff53-55db-aa08-6d67184d4a8e/scratchpad/eval.js',
  tpl.replace('__SKINLIB__', lib).replace('__CAND__', JSON.stringify(CAND)));
