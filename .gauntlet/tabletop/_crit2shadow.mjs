import sharp from 'sharp';
const A='.gauntlet/tabletop/_ab-on-day.png', B='.gauntlet/tabletop/_ab-off-day.png';
const a=await sharp(A).raw().toBuffer({resolveWithObject:true});
const b=await sharp(B).raw().toBuffer({resolveWithObject:true});
const {width:w,height:h,channels:ch}=a.info;
console.log('size',w,h,ch);
// board interior sample boxes (playable tiles) from the mixed render
const boxes={ fieldFar:[700,250,200,60], fieldMid:[620,380,340,120], fieldNear:[600,520,380,80],
              tableL:[0,230,140,120], tableR:[1460,230,130,120], tableBL:[0,780,180,110] };
for(const [n,[x,y,bw,bh]] of Object.entries(boxes)){
  let sum=0,cnt=0,mx=0;
  for(let j=y;j<y+bh;j++)for(let i=x;i<x+bw;i++){
    const o=(j*w+i)*ch;
    const la=0.299*a.data[o]+0.587*a.data[o+1]+0.114*a.data[o+2];
    const lb=0.299*b.data[o]+0.587*b.data[o+1]+0.114*b.data[o+2];
    const d=lb-la; sum+=d; cnt++; if(d>mx)mx=d;
  }
  console.log(n.padEnd(10), 'meanDarkening', (sum/cnt).toFixed(2), 'max', mx.toFixed(1));
}
