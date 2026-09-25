/* CRITIC pass 2: which rules survived, palette channel test, ink layout. */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(process.cwd(), 'public');
const THREE_DIR = path.resolve(process.cwd(), '.gauntlet/three171');
const OUT = path.resolve(process.cwd(), '.gauntlet/shots/crit-cityline');
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.glb':'model/gltf-binary','.txt':'text/plain','.webp':'image/webp' };
const PORT = 9040 + (process.pid % 60);
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
  if (p.endsWith('/')) p+='index.html';
  const f = path.join(ROOT,p);
  if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('nf');}
  res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});
  fs.createReadStream(f).pipe(res);
});
await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
const browser = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox','--disable-dev-shm-usage']});
const page = await browser.newPage({viewport:VP});
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
  const q=s=>document.querySelector(s), qa=s=>Array.from(document.querySelectorAll(s));
  const cs=e=>getComputedStyle(e);
  const rgb=s=>{const m=/rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s);return m?[+m[1],+m[2],+m[3]]:null;};
  // Which #camproster rules exist at all, in order
  const sel=[];
  for(const ss of Array.from(document.styleSheets)){let r;try{r=ss.cssRules;}catch(e){continue;}
    for(const x of Array.from(r||[])) if(x.selectorText && /camproster/.test(x.selectorText)) sel.push(x.selectorText);}
  const rowH = qa('#camproster .crrow').map(r=>+r.getBoundingClientRect().height.toFixed(1));
  const lineH = qa('#camproster .crrow').map(r=>Array.from(r.querySelectorAll('.crline')).map(l=>+l.getBoundingClientRect().height.toFixed(1)));
  const fs3 = qa('#camproster .crrow').map(r=>{
    const l=r.querySelectorAll('.crline')[2]; if(!l) return null;
    const c=l.querySelector('.crcity'), n=l.querySelector('.crnil'), m=l.querySelector('.crmark');
    return {city:c?{fs:cs(c).fontSize,color:cs(c).color,ws:cs(c).whiteSpace,to:cs(c).textOverflow,ov:cs(c).overflow,h:+c.getBoundingClientRect().height.toFixed(1)}:null,
            nil:n?{fs:cs(n).fontSize,color:cs(n).color,fst:cs(n).fontStyle}:null,
            mark:m?{color:cs(m).color,mr:cs(m).marginRight}:null};});
  const campName = qa('#camproster .crn').map(e=>({fs:cs(e).fontSize,color:cs(e).color,ws:cs(e).whiteSpace,to:cs(e).textOverflow,w:+e.getBoundingClientRect().width.toFixed(1)}));
  // chrome palette test
  const chrome=[];
  const push=(name,el,prop)=>{const v=cs(el)[prop];const c=rgb(v);if(c) chrome.push({name,prop,v,c,fail:(c[2]-c[0])>8});};
  const targets=[['#camproster',q('#camproster')],['#campcard',q('#campcard')],['body',document.body],['html',document.documentElement],['#rail',q('#rail')||document.body]];
  for(const [n,e] of targets){ if(!e) continue; push(n,e,'backgroundColor'); push(n,e,'borderTopColor'); }
  return {selCount:sel.length, hasCrcity: sel.some(s=>/\.crcity\b/.test(s)), hasCrnil: sel.some(s=>/\.crnil\b/.test(s)), hasCrmark: sel.some(s=>/\.crmark\b/.test(s)),
    selAround: sel.slice(sel.findIndex(s=>/crsub/.test(s))-1, sel.findIndex(s=>/crsub/.test(s))+6),
    rowH, lineH, fs3, campName, chrome,
    docOverflow: document.documentElement.scrollWidth-document.documentElement.clientWidth};
});
console.log(JSON.stringify(M,null,1));
const rost = await frame.$('#camproster');
if(rost) await rost.screenshot({path:path.join(OUT,'roster2-'+VP.width+'.png')});
const card = await frame.$('#campcard');
if(card) await card.screenshot({path:path.join(OUT,'card2-'+VP.width+'.png')});
await browser.close(); server.close();
