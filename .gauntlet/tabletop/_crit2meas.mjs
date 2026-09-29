import sharp from 'sharp';
const boxes = {
  TL:   [10, 215, 130, 95],
  BL:   [0, 782, 180, 108],
  RT:   [1470, 215, 125, 95],
  BR:   [1430, 790, 165, 100],
  MIDL: [0, 470, 60, 120],
};
async function stats(file){
  const out={};
  for (const [n,[x,y,w,h]] of Object.entries(boxes)){
    const {data} = await sharp(file).extract({left:x,top:y,width:w,height:h}).raw().toBuffer({resolveWithObject:true});
    const L=[]; let R=0,G=0,B=0;
    for(let i=0;i<w*h;i++){const r=data[i*3],g=data[i*3+1],b=data[i*3+2];L.push(0.299*r+0.587*g+0.114*b);R+=r;G+=g;B+=b;}
    const n0=w*h, mL=L.reduce((a,b)=>a+b,0)/n0;
    const pixSd=Math.sqrt(L.reduce((a,b)=>a+(b-mL)**2,0)/n0);
    // 8x8 block means
    const bm=[];
    for(let by=0;by+8<=h;by+=8)for(let bx=0;bx+8<=w;bx+=8){let s=0;for(let j=0;j<8;j++)for(let i=0;i<8;i++)s+=L[(by+j)*w+bx+i];bm.push(s/64);}
    const mb=bm.reduce((a,b)=>a+b,0)/bm.length;
    const blockSd=Math.sqrt(bm.reduce((a,b)=>a+(b-mb)**2,0)/bm.length);
    const sorted=[...bm].sort((a,b)=>a-b);
    const span=sorted[sorted.length-1]-sorted[0];
    const rm=R/n0,gm=G/n0,bmn=B/n0;
    const mx=Math.max(rm,gm,bmn),mn=Math.min(rm,gm,bmn);
    out[n]={L:+mL.toFixed(1),pixSd:+pixSd.toFixed(2),blockSd:+blockSd.toFixed(2),blockSpan:+span.toFixed(1),RmB:+(rm-bmn).toFixed(1),chroma:+(mx-mn).toFixed(1)};
  }
  return out;
}
for(const f of process.argv.slice(2)){
  console.log(f); console.table(await stats(f));
}
