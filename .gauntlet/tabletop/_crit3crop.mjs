import sharp from 'sharp';
const S = '.gauntlet/tabletop/_crit3/';
const src = process.argv[2], tag = process.argv[3];
const jobs = [
  ['top3',   0,   0, 1600, 300, 1],
  ['mid',    0, 180, 1600, 300, 1],
  ['bot3',   0, 560, 1600, 300, 1],
  ['leftband', 0, 190, 420, 430, 2],
  ['rightband',1180,190, 420, 430, 2],
  ['nearleft', 0, 430, 520, 220, 2],
];
for (const [n,x,y,w,h,z] of jobs){
  await sharp(src).extract({left:x,top:y,width:w,height:h}).resize({width:w*z,kernel:'nearest'}).png().toFile(S+tag+'_'+n+'.png');
}
console.log('ok');
