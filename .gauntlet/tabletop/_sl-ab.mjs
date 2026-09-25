/* staged-lighting A/B, to the piece's own judgedBy.
   Takes BEFORE and AFTER, same seed, same camera, and reports per site:
   mean luma, mean (R-B) chroma bias, and the delta.

   🔴 WHY THE DELTA IS THE REAL GATE FOR (a), and the absolute number is not.
   judgedBy asks that "board centre and outer columns [land] within ~8 luma of
   each other — no elevation-step-sized gradient laid across the field". Taken
   as an ABSOLUTE reading of one render that is unmeasurable: the field is made
   of randomised realm tiles, and a purple shadow plate next to a pale street
   plate differs by 40 luma before any light touches it (measured: 47.6 spread
   across five field sites on the BEFORE frame, which no lighting change made).
   The question the clause is actually asking is the one its own hazard note
   states — did this edit lay a gradient across the board — and that is
   answered by comparing the SAME site to ITSELF across the pair. The scar it
   guards is "-25 luma on the outer tile columns"; the test is therefore that
   no field site moves, and that no field site moves MORE than the centre.

   NEGATIVE CONTROL: --nc grades the before-frame against ITSELF. Every delta
   must be exactly 0 and the verdict must be "no separation gained" — if that
   run reports a pass, the meter is not reading the second image.
*/
import fs from 'node:fs';
import zlib from 'node:zlib';
function readPNG(p){
  const buf=fs.readFileSync(p); let o=8,w=0,h=0,bd=0,ct=0,idat=[];
  while(o<buf.length){const len=buf.readUInt32BE(o),type=buf.toString('ascii',o+4,o+8);
    const data=buf.subarray(o+8,o+8+len);
    if(type==='IHDR'){w=data.readUInt32BE(0);h=data.readUInt32BE(4);bd=data[8];ct=data[9];}
    else if(type==='IDAT')idat.push(data); else if(type==='IEND')break; o+=12+len;}
  if(bd!==8) throw new Error('bit depth '+bd);
  const ch=ct===6?4:ct===2?3:ct===0?1:2;
  const raw=zlib.inflateSync(Buffer.concat(idat));
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
function box(img,cx,cy,s){const hf=s>>1;let L=0,R=0,B=0,n=0;
  for(let y=cy-hf;y<cy+hf;y++){if(y<0||y>=img.h)continue;
    for(let x=cx-hf;x<cx+hf;x++){if(x<0||x>=img.w)continue;
      const i=(y*img.w+x)*img.ch;L+=lum(img.data[i],img.data[i+1],img.data[i+2]);R+=img.data[i];B+=img.data[i+2];n++;}}
  return {L:L/n, RB:(R-B)/n};
}
/* 64x64 sites in 1600x900 screen space. FIELD sites sit on tiles; OUT sites
   sit clear of the kerb on all four sides. The board's own quad at yaw 0 is
   about (549,198) (1156,198) (1341,616) (358,616). */
const FIELD={centre:[860,400],outerLeft:[545,465],outerRight:[1195,455],outerFar:[860,240],outerNear:[860,545],
             outerNearLeftTile:[500,540],outerNearRightTile:[1265,545]};
const OUT  ={outLeft:[210,400],outRight:[1460,400],outFar:[860,120],outNearLeft:[250,570],
             outFarLeft:[300,230],outFarRight:[1430,230],outMidRight:[1520,500]};
const nc=process.argv.includes('--nc');
const fa=process.argv[2], fb=nc?process.argv[2]:process.argv[3];
const A=readPNG(fa), B=readPNG(fb);
const rows=[];
for(const [grp,set] of [['field',FIELD],['outside',OUT]])
  for(const k in set){const a=box(A,set[k][0],set[k][1],64), b=box(B,set[k][0],set[k][1],64);
    rows.push({grp,site:k,beforeL:+a.L.toFixed(1),afterL:+b.L.toFixed(1),dL:+(b.L-a.L).toFixed(1),
               beforeRB:+a.RB.toFixed(1),afterRB:+b.RB.toFixed(1),dRB:+(b.RB-a.RB).toFixed(1)});}
const F=rows.filter(r=>r.grp==='field'), O=rows.filter(r=>r.grp==='outside');
const centre=F.find(r=>r.site==='centre');
const worstFieldMove=Math.max(...F.map(r=>Math.abs(r.dL)));
const worstOutDrop=Math.min(...O.map(r=>centre.afterL-r.afterL));
const gainedSep=Math.min(...O.map(r=>(centre.afterL-r.afterL)-(centre.beforeL-r.beforeL)));
const w=(v,n)=>String(v).padStart(n);
console.log('before='+fa+'\nafter ='+fb+(nc?'   (NEGATIVE CONTROL: same file twice)':''));
console.log('site                 L_before  L_after     dL   RB_before RB_after   dRB');
for(const r of rows) console.log(r.site.padEnd(20)+w(r.beforeL,9)+w(r.afterL,9)+w(r.dL,7)+w(r.beforeRB,12)+w(r.afterRB,9)+w(r.dRB,6));
console.log('\n(a) NO GRADIENT LAID ACROSS THE FIELD');
console.log('    worst |dL| at any field site ....... '+worstFieldMove.toFixed(1)+'   (the scar it guards is 25)');
console.log('    verdict ......................... '+(worstFieldMove<=3?'PASS':'FAIL'));
console.log('(b) EVERY OUTSIDE SITE >=30 LUMA BELOW BOARD CENTRE');
console.log('    worst outside drop, AFTER ....... '+worstOutDrop.toFixed(1));
console.log('    least separation GAINED ......... '+gainedSep.toFixed(1)+'   (must be > 0, or nothing fell off)');
console.log('    verdict ......................... '+(worstOutDrop>=30&&gainedSep>0?'PASS':'FAIL'));
