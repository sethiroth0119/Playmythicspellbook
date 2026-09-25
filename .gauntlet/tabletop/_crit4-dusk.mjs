/* CRITIC round 4 — judgedBy: the board shadow "must lengthen when --eval flips
   timeOfDay to 'dusk' and shorten at 'day'". Length, not pixel count: measure
   how far the darkened region reaches BELOW the apron's near edge in each arm.  */
import sharp from 'sharp';
const OUT='E:/game-deploy/.gauntlet/tabletop/';
const raw=async f=>await sharp(OUT+f).raw().toBuffer({resolveWithObject:true});
const L=(d,i)=>0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
async function arm(on,off){
  const A=await raw(on),B=await raw(off);
  const {width:W,height:H,channels:C}=A.info;
  const rowN=new Array(H).fill(0);
  let n=0;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*C;
    if(L(B.data,i)-L(A.data,i)>6){rowN[y]++;n++;}}
  /* the band that is unambiguously shadow: rows below 660, where the A/A floor
     measured 37-281 px against 14k. */
  const lo=rowN.slice(660).reduce((s,v)=>s+v,0);
  let first=-1,last=-1;
  for(let y=660;y<H;y++){ if(rowN[y]>150){ if(first<0)first=y; last=y; } }
  return {totalPx:n, belowY660:lo, firstRow:first, lastRow:last, reachRows:last-first};
}
console.log(JSON.stringify({day:await arm('_crit4-on-day.png','_crit4-off-day.png'),
  dusk:await arm('_crit4-on-dusk.png','_crit4-off-dusk.png')},null,1));
