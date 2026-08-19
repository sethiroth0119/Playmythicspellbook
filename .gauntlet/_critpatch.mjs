import sharp from 'sharp';
const rgb2hsv=(r,g,b)=>{r/=255;g/=255;b/=255;const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;let h=0;
 if(d){if(mx===r)h=((g-b)/d)%6;else if(mx===g)h=(b-r)/d+2;else h=(r-g)/d+4;h*=60;if(h<0)h+=360;}return[h,mx?d/mx:0,mx];};
const Y0=230,Y1=810,BS=40;
async function blocks(file){
  const {data,info}=await sharp(file).raw().toBuffer({resolveWithObject:true});
  const W=info.width,C=info.channels,out=new Map();
  for(let by=Y0;by+BS<Y1;by+=BS)for(let bx=0;bx+BS<W;bx+=BS){
    let n=0,sv=0,sh=0,tot=0,allv=0,alln=0;
    for(let y=by;y<by+BS;y+=2)for(let x=bx;x+0<bx+BS;x+=2){
      const i=(y*W+x)*C;const[h,s,v]=rgb2hsv(data[i],data[i+1],data[i+2]);tot++;allv+=v;alln++;
      if(h<40||h>125||s<0.10||v<0.28)continue;n++;sv+=v;sh+=h;}
    out.set(bx+','+by,{frac:n/tot,val:n?sv/n:0,hue:n?sh/n:0,allVal:allv/alln,n});
  }
  return out;
}
const pct=(a,p)=>{a=a.slice().sort((x,y)=>x-y);return a[Math.min(a.length-1,(a.length*p)|0)];};
const A=await blocks(process.argv[2]),B=await blocks(process.argv[3]);
for(const th of [0.9,0.7,0.5,0.0]){
  // MATCHED set: blocks passing the threshold in BOTH images
  const keys=[...A.keys()].filter(k=>A.get(k).frac>th&&B.get(k).frac>th);
  const rep=(M)=>{const vv=keys.map(k=>M.get(k).val),hh=keys.map(k=>M.get(k).hue);
    return {n:keys.length,valSpread:+(pct(vv,.9)-pct(vv,.1)).toFixed(4),hueSpread:+(pct(hh,.9)-pct(hh,.1)).toFixed(2)};};
  // and an ALL-PIXEL version that no filter can bias
  const av=keys.map(k=>A.get(k).allVal),bv=keys.map(k=>B.get(k).allVal);
  console.log(JSON.stringify({thresh:th, matchedBlocks:keys.length,
    before:rep(A), after:rep(B),
    allPixelValSpread:{before:+(pct(av,.9)-pct(av,.1)).toFixed(4),after:+(pct(bv,.9)-pct(bv,.1)).toFixed(4)}}));
}
