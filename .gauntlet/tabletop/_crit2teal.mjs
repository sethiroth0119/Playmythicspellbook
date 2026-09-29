import sharp from 'sharp';
const boxes={tealBand:[0,742,120,45], warmLow:[0,820,120,60]};
for(const f of ['.gauntlet/tabletop/_ab-on-day.png','.gauntlet/tabletop/_ab-off-day.png','.gauntlet/tabletop/table-and-shadow-crit2.png','.gauntlet/tabletop/ts-r2-before.png']){
  const line=[];
  for(const [n,[x,y,w,h]] of Object.entries(boxes)){
    const {data,info}=await sharp(f).extract({left:x,top:y,width:w,height:h}).raw().toBuffer({resolveWithObject:true});
    const ch=info.channels; let R=0,G=0,B=0;const N=w*h;
    for(let i=0;i<N;i++){R+=data[i*ch];G+=data[i*ch+1];B+=data[i*ch+2];}
    R/=N;G/=N;B/=N;
    line.push(`${n} L=${(0.299*R+0.587*G+0.114*B).toFixed(1)} R-B=${(R-B).toFixed(1)} chroma=${(Math.max(R,G,B)-Math.min(R,G,B)).toFixed(1)}`);
  }
  console.log(f.split('/').pop().padEnd(32), line.join(' | '));
}
