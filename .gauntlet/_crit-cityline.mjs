/* CRITIC: the Camp-tab node roster city line, measured in real Chromium. */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(process.cwd(), 'public');
const THREE_DIR = path.resolve(process.cwd(), '.gauntlet/three171');
const OUT = path.resolve(process.cwd(), '.gauntlet/shots/crit-cityline');
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.glb':'model/gltf-binary','.txt':'text/plain','.webp':'image/webp' };
const PORT = 8930 + (process.pid % 60);
const VP = { width: Number(process.env.VW || 1400), height: Number(process.env.VH || 900) };

const ROWS = [
  { userId:'u-ash', camp:'Ashfall Hollow', player:'Kael', prestige:512, contrib:41, corp:'ASH', isYou:false,
    city:'Ashfen', cityHere:true, pop:1840, supplies:7, needs:3 },
  { userId:'u-me', camp:'Saltmarsh Rest', player:'You', prestige:340, contrib:62, corp:'ASH', isYou:true,
    city:'New Greyharbor of the Endless Salt M', cityHere:false, pop:12904, supplies:12, needs:9 },
  { userId:'u-bri', camp:'Briarfell Watch', player:'Mira', prestige:118, contrib:7, corp:null, isYou:false,
    city:null, cityHere:null, pop:null, supplies:null, needs:null },
  { userId:'u-lon', camp:'Longwater Ford and the Nine Mile Reach XX', player:'Ordo', prestige:60, contrib:12, corp:'ORD', isYou:false,
    city:'Thornhollow', cityHere:true, pop:412, supplies:0, needs:0 },
];
function parentHtml(){
  return '<!doctype html><meta charset="utf-8"><title>crit</title>' +
  '<style>html,body{margin:0;height:100%;background:#0d0b12}iframe{border:0;width:100vw;height:100vh}</style><script>' +
  'window.getRes=function(){return 0};window.addRes=function(){};window.spendResources=function(){return false};' +
  'window.addCinders=function(){return true};window.spendCinders=function(){return false};window.getCinders=function(){return 0};' +
  'window.cityStateLoad=async function(){return null};window.cityStateSave=function(){return false};' +
  'window.cityOwnerIdentity=function(){return {viewerId:"u-me",viewerName:"You",ownerId:"u-me",ownerName:"You",isOwner:true}};' +
  'window.cityCampRoster=async function(){return {ready:true,why:null,nodeId:"N-20",viewerId:"u-me",source:"fetch",camps:'+JSON.stringify(ROWS)+'}};' +
  '</script><iframe id="f" src="/node-city/index.html"></iframe>';
}
const server = http.createServer((req,res)=>{
  const u = new URL(req.url,'http://x'); let p = decodeURIComponent(u.pathname);
  if (p==='/__parent'){res.writeHead(200,{'Content-Type':'text/html'});return res.end(parentHtml());}
  if (p.startsWith('/__three/')){const f=path.join(THREE_DIR,p.slice(9));if(fs.existsSync(f)){res.writeHead(200,{'Content-Type':'text/javascript'});return fs.createReadStream(f).pipe(res);}res.writeHead(404);return res.end('nf');}
  if (p.endsWith('/')) p+='index.html';
  const f = path.join(ROOT,p);
  if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('nf');}
  res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});
  fs.createReadStream(f).pipe(res);
});
await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
const browser = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox','--disable-dev-shm-usage']});
const page = await browser.newPage({viewport:VP});
const logs=[]; page.on('console',m=>logs.push(m.type()+': '+m.text().slice(0,160)));
page.on('pageerror',e=>logs.push('pageerror: '+String(e).slice(0,160)));
await page.route('**/*',route=>{const u=route.request().url();
  if(u.includes('cdn.jsdelivr.net')&&u.includes('three@')){const rel=new URL(u).pathname.replace(/^\/npm\/three@[^/]+\//,'');const f=path.join(THREE_DIR,rel);
    return fs.existsSync(f)?route.fulfill({status:200,contentType:'text/javascript',body:fs.readFileSync(f)}):route.fulfill({status:404,body:'no three'});}
  if(u.includes('127.0.0.1')||u.includes('localhost'))return route.continue(); return route.abort();});
await page.goto('http://127.0.0.1:'+PORT+'/__parent',{waitUntil:'domcontentloaded',timeout:120000});
const fh = await page.waitForSelector('#f',{timeout:60000}); const frame = await fh.contentFrame();
await frame.waitForFunction('!!(window.__nc && window.__nc.campRoster)',null,{timeout:180000});
await frame.waitForFunction('!!(window.__nc && (window.__nc.rail || window.__ncRail))',null,{timeout:180000});
await frame.evaluate(()=>{if(window.__nc&&!window.__nc.rail&&window.__ncRail)window.__nc.rail=window.__ncRail;});
await page.waitForTimeout(4000);
await frame.evaluate(()=>window.__nc.rail.open('campcard'));
await frame.evaluate(()=>window.__nc.campRosterRefresh());
await page.waitForTimeout(900);

const M = await frame.evaluate(()=>{
  const cs = el=>el?getComputedStyle(el):null;
  const q=s=>document.querySelector(s), qa=s=>Array.from(document.querySelectorAll(s));
  const cr=q('#camproster');
  const crc=qa('#camproster .crcity');
  const rect=el=>{const r=el.getBoundingClientRect();return {x:+r.x.toFixed(1),y:+r.y.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1),right:+r.right.toFixed(1)};};
  let crcityRules=[], crcitywrapRules=[], crelseRules=[], badSel=[];
  for(const ss of Array.from(document.styleSheets)){
    let rules; try{rules=ss.cssRules;}catch(e){continue;}
    for(const r of Array.from(rules||[])){
      const t=r.selectorText||'';
      if(/\.crcity\b/.test(t)) crcityRules.push(t.slice(0,120)+' {'+r.style.cssText.slice(0,160)+'}');
      if(/\.crcitywrap\b/.test(t)) crcitywrapRules.push(t.slice(0,120)+' {'+r.style.cssText.slice(0,160)+'}');
      if(/\.crelse\b/.test(t)) crelseRules.push(t.slice(0,140)+' {'+r.style.cssText.slice(0,160)+'}');
      if(t && /SHRINK|flex:0 1 auto,|value rail|\*\//.test(t)) badSel.push(t.slice(0,200));
    }
  }
  const one=el=>{const s=cs(el);return {text:el.textContent.slice(0,45),rect:rect(el),
    color:s.color,fontSize:s.fontSize,flex:s.flex,minWidth:s.minWidth,
    overflow:s.overflow,textOverflow:s.textOverflow,whiteSpace:s.whiteSpace,scrollW:el.scrollWidth,clientW:el.clientWidth};};
  const wrap=q('#camproster .crcitywrap'), els=q('#camproster .crelse');
  const panel=cs(cr);
  const de=document.documentElement;
  let elseGap=null, cityInkRight=null, elseInkGap=null;
  if(els){
    const row2city=qa('#camproster .crrow')[1].querySelector('.crcity');
    const rg=document.createRange(); rg.selectNodeContents(row2city);
    cityInkRight=+rg.getBoundingClientRect().right.toFixed(1);
    elseGap=+(els.getBoundingClientRect().left - row2city.getBoundingClientRect().right).toFixed(1);
    elseInkGap=+(els.getBoundingClientRect().left - cityInkRight).toFixed(1);
  }
  const clip=(el)=>{const p=el.closest('.crline')||el.parentElement;const a=el.getBoundingClientRect(),b=p.getBoundingClientRect();
    const w=Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left));return +(w/(a.width||1)).toFixed(3);};
  const rgb=s=>{const m=/rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s);return m?[+m[1],+m[2],+m[3]]:null;};
  return {
    crcityRules, crcitywrapRules, crelseRules, badSel,
    panel:{bg:panel.backgroundColor,bgImage:panel.backgroundImage.slice(0,70),border:panel.borderTopColor,radius:panel.borderRadius},
    panelBorderRGB: rgb(panel.borderTopColor),
    head:(()=>{const h=q('#camproster .crhead');const s=cs(h);return {ff:s.fontFamily,fs:s.fontSize,color:s.color,tt:s.textTransform,ls:s.letterSpacing};})(),
    crvnFF: (()=>{const h=q('#camproster .crvn');return h?cs(h).fontFamily:null;})(),
    cities: crc.map(one),
    wrapStyle: wrap?{flex:cs(wrap).flex,display:cs(wrap).display,minWidth:cs(wrap).minWidth,rect:rect(wrap)}:null,
    elseTag: els?{rect:rect(els),radius:cs(els).borderRadius,visFrac:clip(els),fs:cs(els).fontSize,tt:cs(els).textTransform}:null,
    elseGap, cityInkRight, elseInkGap,
    me: qa('#camproster .crme').map(e=>({rect:rect(e),visFrac:clip(e),radius:cs(e).borderRadius})),
    meGap: (()=>{const m=q('#camproster .crme');if(!m)return null;const n=m.previousElementSibling;return +(m.getBoundingClientRect().left-n.getBoundingClientRect().right).toFixed(1);})(),
    line3: qa('#camproster .crrow').map(r=>{const l=r.querySelectorAll('.crline')[2];return l?l.textContent.replace(/\s+/g,' ').trim():null;}),
    popKeyX: qa('#camproster .crvpop').map(e=>+e.getBoundingClientRect().left.toFixed(1)),
    supKeyX: qa('#camproster .crvsup').map(e=>+e.getBoundingClientRect().left.toFixed(1)),
    radii: qa('#camproster, #camproster *').map(e=>({c:(e.className||'').toString().slice(0,22)||e.id,r:cs(e).borderRadius})).filter(o=>o.r&&o.r!=='0px'),
    hOverflow: de.scrollWidth - de.clientWidth,
    panelOverflow: cr.scrollWidth - cr.clientWidth,
    lineOverflow: qa('#camproster .crline').map(l=>l.scrollWidth-l.clientWidth).filter(v=>v>0),
    rosterText: cr.textContent.replace(/\s+/g,' ').slice(0,1100),
    nanCheck: /NaN|undefined|\[object/.test(cr.textContent),
    panelRect: rect(cr),
  };
});
console.log(JSON.stringify(M,null,1));
console.log('--- logs ---'); console.log(logs.slice(-10).join('\n'));
const card = await frame.$('#campcard');
if(card) await card.screenshot({path:path.join(OUT,'campcard-'+VP.width+'.png')});
const rost = await frame.$('#camproster');
if(rost) await rost.screenshot({path:path.join(OUT,'roster-'+VP.width+'.png')});
await page.screenshot({path:path.join(OUT,'full-'+VP.width+'.png')});
await browser.close(); server.close();
