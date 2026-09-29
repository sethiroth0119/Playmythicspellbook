import sharp from 'sharp';
const S = '.gauntlet/tabletop/_crit2/';
const src = process.argv[2];
const tag = process.argv[3];
const jobs = [
  ['bot3', 0, 600, 1600, 300, 1],
  ['top3', 0, 0, 1600, 300, 1],
  ['bl',   0, 600, 420, 300, 2],
  ['br', 1180, 600, 420, 300, 2],
  ['leftband', 0, 180, 400, 420, 2],
  ['rightband', 1200, 180, 400, 420, 2],
];
for (const [n,x,y,w,h,z] of jobs){
  await sharp(src).extract({left:x,top:y,width:w,height:h}).resize({width:w*z,kernel:'nearest'}).png().toFile(S+tag+'_'+n+'.png');
}
console.log('ok');
