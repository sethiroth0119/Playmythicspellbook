/* §1.4 — "the whole frame sits in one narrow value band; nothing is the
   brightest thing in frame."

   p02..p98 over the whole frame is the WRONG ruler for that and I nearly
   reported it: both extremes are already owned by things this piece does not
   touch (the dark sky at the top, the brightest tile art on the board), so it
   reads 152 before and 151 after while the picture visibly restages. The
   clause is about SEPARATION, not about range. So split the frame at the
   board's own outline and report each side's median plus the gap between them.

   The board polygon is the shipped `mixed` framing at 1600x900, yaw 0 — the
   quad the vista's boardShadow note records, grown by the kerb.
   Rows below 610 are the card rail (UI) and are excluded from both sides.

   NEGATIVE CONTROL: --nc replaces the image with a flat 128 frame. Both
   medians must come back 128 and the gap 0. A non-zero gap there would mean
   the polygon test, not the picture, is producing the number. */
import fs from 'node:fs';
import zlib from 'node:zlib';
function readPNG(p){
  const buf=fs.readFileSync(p); let o=8,w=0,h=0,bd=0,ct=0,idat=[];
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
/* board incl. kerb, 1600x900 yaw 0 */
const Q=[[535,188],[1175,188],[1360,600],[352,600]];
function inQ(x,y){let s=0;for(let i=0;i<4;i++){const a=Q[i],b=Q[(i+1)%4];
  const c=(b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0]); if(c>0)s++; else if(c<0)s--;}
  return Math.abs(s)===4;}
const nc=process.argv.includes('--nc');
for(const f of process.argv.slice(2).filter(a=>a!=='--nc')){
  let img; if(nc) img={w:1600,h:900,ch:3,data:Buffer.alloc(1600*900*3,128)}; else img=readPNG(f);
  const hi=new Float64Array(256), ho=new Float64Array(256); let ni=0,no=0;
  for(let y=0;y<Math.min(img.h,610);y++)for(let x=0;x<img.w;x++){
    const i=(y*img.w+x)*img.ch; const L=Math.round(lum(img.data[i],img.data[i+1],img.data[i+2]))|0;
    if(inQ(x,y)){hi[L]++;ni++;} else {ho[L]++;no++;}}
  const med=(h,n)=>{let a=0;for(let v=0;v<256;v++){a+=h[v];if(a>=n/2)return v;}return 255;};
  const pq=(h,n,p)=>{let a=0;for(let v=0;v<256;v++){a+=h[v];if(a>=n*p)return v;}return 255;};
  const mi=med(hi,ni), mo=med(ho,no);
  console.log((nc?'(NEGATIVE CONTROL flat-128)':f));
  console.log('   board  median L '+String(mi).padStart(4)+'   p10 '+String(pq(hi,ni,.10)).padStart(4)+'   p90 '+String(pq(hi,ni,.90)).padStart(4)+'   px '+ni);
  console.log('   room   median L '+String(mo).padStart(4)+'   p10 '+String(pq(ho,no,.10)).padStart(4)+'   p90 '+String(pq(ho,no,.90)).padStart(4)+'   px '+no);
  console.log('   ►  board-over-room separation: '+(mi-mo)+' luma');
}
