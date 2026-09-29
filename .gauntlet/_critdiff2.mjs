import sharp from 'sharp';
const D='/tmp/claude-0/-home-user-Playmythicspellbook/40854a97-ff53-55db-aa08-6d67184d4a8e/scratchpad/ab/';
console.log("Using capture.mjs's OWN criterion: any channel |d|>6, whole frame.");
for(const s of ['aerial','street','district']){
  const a=await sharp(D+s+'-on.png').raw().toBuffer({resolveWithObject:true});
  const b=await sharp(D+s+'-off.png').raw().toBuffer({resolveWithObject:true});
  const W=a.info.width,H=a.info.height,C=a.info.channels; let d=0;
  for(let i=0;i<a.data.length;i+=C)
    if(Math.abs(a.data[i]-b.data[i])>6||Math.abs(a.data[i+1]-b.data[i+1])>6||Math.abs(a.data[i+2]-b.data[i+2])>6)d++;
  console.log(s, '=>', (100*d/(W*H)).toFixed(1)+'%');
}
