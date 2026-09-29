import sharp from 'sharp';
const D='/tmp/claude-0/-home-user-Playmythicspellbook/40854a97-ff53-55db-aa08-6d67184d4a8e/scratchpad/ab/';
for(const s of ['aerial','street','district']){
  const a=await sharp(D+s+'-on.png').raw().toBuffer({resolveWithObject:true});
  const b=await sharp(D+s+'-off.png').raw().toBuffer({resolveWithObject:true});
  const W=a.info.width,H=a.info.height,C=a.info.channels;
  let ch=0,big=0,tot=0, chL=0, totL=0;
  // exclude the right-hand UI panel (x>1265) and HUD bands (y<115, y>840)
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const i=(y*W+x)*C;
    const inUI = (x>1265&&y>370&&y<845)||(y<115)||(y>845);
    const d=Math.abs(a.data[i]-b.data[i])+Math.abs(a.data[i+1]-b.data[i+1])+Math.abs(a.data[i+2]-b.data[i+2]);
    if(!inUI){tot++; if(d>12)ch++; if(d>60)big++;}
    totL++; if(d>12)chL++;
  }
  console.log(JSON.stringify({shot:s, scenePx:tot,
    changedPct:+(100*ch/tot).toFixed(2), stronglyChangedPct:+(100*big/tot).toFixed(2),
    wholeFramePct:+(100*chL/totL).toFixed(2)}));
}
