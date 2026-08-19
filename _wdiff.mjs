import sharp from 'sharp';
const D=process.argv[2];
const load=async f=>{const r=await sharp(D+'/'+f).raw().toBuffer({resolveWithObject:true});return r;};
const cmp=(a,b)=>{const W=a.info.width,H=a.info.height,C=a.info.channels;let ch=0,tot=0;
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*C;
  const inUI=(x>1265&&y>370&&y<845)||(y<115)||(y>845); if(inUI)continue;
  const d=Math.abs(a.data[i]-b.data[i])+Math.abs(a.data[i+1]-b.data[i+1])+Math.abs(a.data[i+2]-b.data[i+2]);
  tot++; if(d>12)ch++;}
 return 100*ch/tot;};
const rows=[];
for(const s of ['aerial','street','district']){
  const on=await load(s+'-on.png'), on2=await load(s+'-on2.png'), off=await load(s+'-off.png');
  const floor=cmp(on,on2), net=cmp(on,off);
  rows.push({shot:s, driftFloor:+floor.toFixed(2), onVsOff:+net.toFixed(2), netContribution:+(net-floor).toFixed(2)});
}
console.table(rows);
