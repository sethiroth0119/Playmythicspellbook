import sharp from 'sharp';
const f=process.argv[2], x=+process.argv[3], w=+process.argv[4];
const {data,info}=await sharp(f).extract({left:x,top:600,width:w,height:300}).raw().toBuffer({resolveWithObject:true});
const W=info.width,H=info.height,ch=info.channels;
console.log(f,'x',x,'w',w);
for(let j=0;j<H;j+=15){let R=0,G=0,B=0,n=0;
 for(let jj=j;jj<Math.min(H,j+15);jj++)for(let i=0;i<W;i++){const o=(jj*W+i)*ch;R+=data[o];G+=data[o+1];B+=data[o+2];n++;}
 R/=n;G/=n;B/=n;
 console.log(String(600+j).padStart(4),(0.299*R+0.587*G+0.114*B).toFixed(1).padStart(6),(R-B).toFixed(1).padStart(7));}
