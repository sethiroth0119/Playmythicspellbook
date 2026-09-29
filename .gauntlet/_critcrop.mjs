import sharp from 'sharp';
const [,,src,x,y,w,h,out,scale]=process.argv;
await sharp(src).extract({left:+x,top:+y,width:+w,height:+h})
  .resize({width:+w*(+scale||4), kernel:'nearest'}).png().toFile(out);
console.log('wrote',out);
