import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
const [SRC,OUT,x,y,w,h,sc] = process.argv.slice(2);
const br = await chromium.launch();
const pg = await br.newPage({viewport:{width:40,height:40}});
const d = await pg.evaluate(async ([s,x,y,w,h,sc])=>{
  const i=new Image(); i.src='data:image/png;base64,'+s; await i.decode();
  const c=document.createElement('canvas'); c.width=w*sc; c.height=h*sc;
  const g=c.getContext('2d'); g.imageSmoothingEnabled=false;
  g.drawImage(i,x,y,w,h,0,0,w*sc,h*sc); return c.toDataURL('image/png');
},[readFileSync(SRC).toString('base64'),+x,+y,+w,+h,+(sc||1)]);
writeFileSync(OUT, Buffer.from(d.split(',')[1],'base64'));
await br.close();
