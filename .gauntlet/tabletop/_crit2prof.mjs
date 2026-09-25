import sharp from 'sharp';
const f=process.argv[2];
const {data,info}=await sharp(f).extract({left:6,top:195,width:70,height:400}).raw().toBuffer({resolveWithObject:true});
const w=info.width,h=info.height,ch=info.channels;
console.log(f);
console.log(' y     L     R-B');
for(let j=0;j<h;j+=20){let R=0,G=0,B=0,n=0;
 for(let jj=j;jj<Math.min(h,j+20);jj++)for(let i=0;i<w;i++){const o=(jj*w+i)*ch;R+=data[o];G+=data[o+1];B+=data[o+2];n++;}
 R/=n;G/=n;B/=n;
 console.log(String(195+j).padStart(4), (0.299*R+0.587*G+0.114*B).toFixed(1).padStart(6), (R-B).toFixed(1).padStart(7));}
