import sharp from 'sharp';
const a=await sharp('.gauntlet/tabletop/_ab-on-day.png').raw().toBuffer({resolveWithObject:true});
const b=await sharp('.gauntlet/tabletop/_ab-off-day.png').raw().toBuffer({resolveWithObject:true});
const {width:w,height:h,channels:ch}=a.info;
const out=Buffer.alloc(w*h*3);
// coarse grid report
const gx=8,gy=6, cw=Math.floor(w/gx), chh=Math.floor(h/gy); const grid=[];
for(let r=0;r<gy;r++){const row=[];for(let c=0;c<gx;c++){let s=0,n=0;
 for(let j=r*chh;j<(r+1)*chh;j++)for(let i=c*cw;i<(c+1)*cw;i++){const o=(j*w+i)*ch;
  s+=(0.299*b.data[o]+0.587*b.data[o+1]+0.114*b.data[o+2])-(0.299*a.data[o]+0.587*a.data[o+1]+0.114*a.data[o+2]);n++;}
 row.push((s/n).toFixed(1));}grid.push(row.join('  '));}
console.log('mean darkening (shadow on vs off), 8x6 grid:');grid.forEach(r=>console.log(' ',r));
for(let k=0;k<w*h;k++){const o=k*ch;
 const d=(0.299*b.data[o]+0.587*b.data[o+1]+0.114*b.data[o+2])-(0.299*a.data[o]+0.587*a.data[o+1]+0.114*a.data[o+2]);
 const v=Math.max(0,Math.min(255,d*8)); out[k*3]=v;out[k*3+1]=v;out[k*3+2]=v;}
await sharp(out,{raw:{width:w,height:h,channels:3}}).png().toFile('.gauntlet/tabletop/_crit2/shadow_heat.png');
