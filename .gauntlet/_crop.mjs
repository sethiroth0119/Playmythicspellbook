import sharp from 'sharp';
const [f,X,Y,W,H,out] = process.argv.slice(2);
await sharp(f).extract({left:+X,top:+Y,width:+W,height:+H}).resize(+W*2,+H*2,{kernel:'nearest'}).jpeg({quality:92}).toFile(out);
console.log('ok');
