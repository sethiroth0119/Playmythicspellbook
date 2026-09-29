import sharp from 'sharp';
const [file,tag,x,y,w,h]=process.argv.slice(2);
await sharp(file).extract({left:+x,top:+y,width:+w,height:+h}).normalise().resize({width:+w*2,kernel:'nearest'}).png().toFile(`.gauntlet/tabletop/_crit2/${tag}_stretch.png`);
console.log('ok');
