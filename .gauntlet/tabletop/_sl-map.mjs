/* A coarse luma map of the frame, so the picture is judged rather than guessed.
   20 columns x 12 rows of mean luma over the top 610 rows (the card rail is UI).
   Printed as a grid of 3-digit numbers with the board's own quad marked. */
import fs from 'node:fs';
import zlib from 'node:zlib';
function readPNG(p){
  const buf = fs.readFileSync(p); let o=8,w=0,h=0,bd=0,ct=0,idat=[];
  while(o<buf.length){const len=buf.readUInt32BE(o),type=buf.toString('ascii',o+4,o+8);
    const data=buf.subarray(o+8,o+8+len);
    if(type==='IHDR'){w=data.readUInt32BE(0);h=data.readUInt32BE(4);bd=data[8];ct=data[9];}
    else if(type==='IDAT')idat.push(data); else if(type==='IEND')break; o+=12+len;}
  const ch=ct===6?4:ct===2?3:1; const raw=zlib.inflateSync(Buffer.concat(idat));
  const stride=w*ch,out=Buffer.alloc(h*stride); let pos=0;
  for(let y=0;y<h;y++){const f=raw[pos++];const line=raw.subarray(pos,pos+stride);pos+=stride;
    const cur=out.subarray(y*stride,y*stride+stride);const prev=y?out.subarray((y-1)*stride,y*stride):null;
    for(let i=0;i<stride;i++){const a=i>=ch?cur[i-ch]:0;const b=prev?prev[i]:0;const c=(prev&&i>=ch)?prev[i-ch]:0;
      let v=line[i]; if(f===1)v+=a;else if(f===2)v+=b;else if(f===3)v+=(a+b)>>1;
      else if(f===4){const pa=Math.abs(b-c),pb=Math.abs(a-c),pc=Math.abs(a+b-2*c);v+=(pa<=pb&&pa<=pc)?a:(pb<=pc)?b:c;}
      cur[i]=v&255;}}
  return {w,h,ch,data:out};
}
const lum=(r,g,b)=>0.2126*r+0.7152*g+0.0722*b;
const files = process.argv.slice(2);
const grids = files.map(f=>{
  const img=readPNG(f); const COLS=20, ROWS=12, HMAX=610;
  const g=[];
  for(let r=0;r<ROWS;r++){const row=[];
    for(let c=0;c<COLS;c++){
      const x0=Math.round(c*img.w/COLS),x1=Math.round((c+1)*img.w/COLS);
      const y0=Math.round(r*HMAX/ROWS),y1=Math.round((r+1)*HMAX/ROWS);
      let s=0,n=0;
      for(let y=y0;y<y1;y+=2)for(let x=x0;x<x1;x+=2){const i=(y*img.w+x)*img.ch;s+=lum(img.data[i],img.data[i+1],img.data[i+2]);n++;}
      row.push(s/n);}
    g.push(row);}
  return {f,g};
});
for(const {f,g} of grids){
  console.log('== '+f);
  g.forEach((row,r)=>console.log(String(Math.round(r*610/12)).padStart(3)+' | '+row.map(v=>String(Math.round(v)).padStart(4)).join('')));
}
if(grids.length===2){
  console.log('== DELTA (after - before)');
  grids[0].g.forEach((row,r)=>console.log(String(Math.round(r*610/12)).padStart(3)+' | '+
    row.map((v,c)=>{const d=grids[1].g[r][c]-v;return (d>0?'+':'')+String(Math.round(d));}).map(s=>s.padStart(4)).join('')));
}
