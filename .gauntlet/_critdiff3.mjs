import sharp from 'sharp';
const D=process.argv[2];
const load=async f=>{const r=await sharp(f).raw().toBuffer({resolveWithObject:true});return r;};
const diff=(a,b,C)=>{let d=0;for(let i=0;i<a.length;i+=C)
  if(Math.abs(a[i]-b[i])>6||Math.abs(a[i+1]-b[i+1])>6||Math.abs(a[i+2]-b[i+2])>6)d++;return d;};
console.log('capture.mjs criterion (any channel >6), whole frame');
for(const s of ['aerial','street','district']){
  const A=await load(D+'/'+s+'-on1.png'), B=await load(D+'/'+s+'-on2.png'), O=await load(D+'/'+s+'-off.png');
  const N=A.info.width*A.info.height, C=A.info.channels;
  const ctrl=100*diff(A.data,B.data,C)/N;
  const treat=100*diff(B.data,O.data,C)/N;
  console.log(`${s.padEnd(9)} control(drift only)=${ctrl.toFixed(2)}%   treatment(layer+drift)=${treat.toFixed(2)}%   net=${(treat-ctrl).toFixed(2)}pp`);
}
