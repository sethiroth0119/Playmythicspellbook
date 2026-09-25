import sharp from 'sharp';
const A = 'E:/game-deploy/.gauntlet/tabletop/table-and-shadow-r4-before.png';
const B = 'E:/game-deploy/.gauntlet/tabletop/table-and-shadow-r4-after.png';
async function raw(f){ const { data, info } = await sharp(f).raw().toBuffer({ resolveWithObject:true }); return { data, info }; }
const a = await raw(A), b = await raw(B);
const { width:W, height:H, channels:C } = a.info;
const rowDark = new Array(H).fill(0), rowLite = new Array(H).fill(0);
for (let y=0;y<H;y++) for (let x=0;x<W;x++){
  const i=(y*W+x)*C;
  const la=0.299*a.data[i]+0.587*a.data[i+1]+0.114*a.data[i+2];
  const lb=0.299*b.data[i]+0.587*b.data[i+1]+0.114*b.data[i+2];
  const d=la-lb;               /* before minus after: positive = after is darker */
  if (d>6) rowDark[y]++; else if (d<-6) rowLite[y]++;
}
const rows=[];
for (let y=0;y<H;y+=25){
  let d=0,l=0; for(let k=y;k<Math.min(H,y+25);k++){d+=rowDark[k];l+=rowLite[k];}
  rows.push(y+': dark '+d+'  lite '+l);
}
console.log(rows.join('\n'));
