import sharp from 'sharp';
const boxes={TL:[10,215,130,95],BL:[0,782,180,108],RT:[1470,215,125,95],BR:[1430,790,165,100]};
const [file,tag]=process.argv.slice(2);
for(const [n,[x,y,w,h]] of Object.entries(boxes)){
  await sharp(file).extract({left:x,top:y,width:w,height:h}).resize({width:w*4,kernel:'nearest'}).png().toFile(`.gauntlet/tabletop/_crit2/${tag}_box_${n}.png`);
}
console.log('ok');
