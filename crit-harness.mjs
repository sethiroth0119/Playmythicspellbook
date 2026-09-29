/* Theme-pass critic harness (Windows). Serves public/ and drives a page. */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('D:/game-deploy', 'public');
const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript',
  '.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg',
  '.svg':'image/svg+xml','.glb':'model/gltf-binary','.txt':'text/plain','.webp':'image/webp',
  '.ttf':'font/ttf','.woff':'font/woff','.woff2':'font/woff2' };
const PORT = 8790;

export async function serve() {
  const server = http.createServer((req,res)=>{
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
  return { server, base:`http://127.0.0.1:${PORT}` };
}

export async function launch(W=1600,H=900) {
  const browser = await chromium.launch({
    args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader',
          '--ignore-gpu-blocklist','--no-sandbox','--disable-dev-shm-usage','--no-proxy-server'],
  });
  const page = await browser.newPage({ viewport:{width:W,height:H}, deviceScaleFactor:1 });
  const logs = [];
  page.on('console', m => logs.push(m.type()[0]+':'+m.text().slice(0,300)));
  page.on('pageerror', e => logs.push('E:'+String(e).slice(0,300)));
  return { browser, page, logs };
}

/* The measurable battery from DESIGN-BAR.md §1-§5. Runs in-page. */
export const BATTERY = `(() => {
  const px = s => parseFloat(s)||0;
  const rgb = s => { const m=/rgba?\\(([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)(?:[,\\s/]+([\\d.]+))?/.exec(s||''); return m?{r:+m[1],g:+m[2],b:+m[3],a:m[4]===undefined?1:+m[4]}:null; };
  const vis = el => { const r=el.getBoundingClientRect(); const cs=getComputedStyle(el);
    return r.width>0 && r.height>0 && cs.display!=='none' && cs.visibility!=='hidden' && px(cs.opacity)>0.02
      && r.bottom>0 && r.right>0 && r.top<innerHeight && r.left<innerWidth; };
  const desc = el => { const id=el.id?'#'+el.id:''; const cl=el.className&&typeof el.className==='string'?'.'+el.className.trim().split(/\\s+/).slice(0,3).join('.'):''; return el.tagName.toLowerCase()+id+cl; };

  const all = [...document.querySelectorAll('*')].filter(e=>!['SCRIPT','STYLE','LINK','META','TITLE','CANVAS'].includes(e.tagName));
  const shown = all.filter(vis);

  /* --- §1 chrome channel test: b - r > 8 fails --- */
  const chrome = [];
  for (const el of shown) {
    const cs = getComputedStyle(el);
    for (const [prop,val] of [['background-color',cs.backgroundColor],['border-top-color',cs.borderTopColor],
      ['border-bottom-color',cs.borderBottomColor],['border-left-color',cs.borderLeftColor],['border-right-color',cs.borderRightColor],['color',cs.color]]) {
      const c = rgb(val); if (!c || c.a < 0.06) continue;
      if (prop.startsWith('border') && px(cs[prop.replace('-color','-width').replace(/-(\\w)/g,(m,p)=>p.toUpperCase())])===0) continue;
      if (c.b - c.r > 8) chrome.push({ el:desc(el), prop, val, delta:+(c.b-c.r).toFixed(0), a:c.a });
    }
  }
  /* --- token values as declared on :root --- */
  const rootCS = getComputedStyle(document.documentElement);
  const tokens = {};
  for (const sh of [...document.styleSheets]) { let rules; try{rules=sh.cssRules}catch(e){continue}
    for (const r of rules||[]) { if (r.style && r.selectorText===':root') for (const p of r.style) if (p.startsWith('--')) tokens[p]=rootCS.getPropertyValue(p).trim(); } }
  const tokenFails = Object.entries(tokens).map(([k,v])=>{ const c=rgb(v)|| (function(h){ const m=/^#([0-9a-f]{6})$/i.exec(h); if(!m)return null; const n=parseInt(m[1],16); return {r:n>>16&255,g:n>>8&255,b:n&255,a:1}; })(v); return c?{k,v,delta:+(c.b-c.r).toFixed(0)}:{k,v,delta:null}; }).filter(x=>x.delta!==null && x.delta>8);

  /* --- §3 radius --- */
  const radii = [];
  for (const el of shown) {
    const cs = getComputedStyle(el);
    const vals = ['borderTopLeftRadius','borderTopRightRadius','borderBottomLeftRadius','borderBottomRightRadius'].map(k=>px(cs[k]));
    const mx = Math.max(...vals); if (mx<=6) continue;
    const r = el.getBoundingClientRect();
    const pill = mx>=Math.min(r.width,r.height)/2-0.6;   // fully rounded end
    radii.push({ el:desc(el), max:+mx.toFixed(1), w:+r.width.toFixed(0), h:+r.height.toFixed(0), pill, area:+(r.width*r.height).toFixed(0) });
  }
  /* radius declarations in source CSS (visible or not) */
  const declRadii = [];
  for (const sh of [...document.styleSheets]) { let rules; try{rules=sh.cssRules}catch(e){continue}
    const walk = rs => { for (const r of rs||[]) { if (r.cssRules) { walk(r.cssRules); continue; }
      if (!r.style) continue; const v=r.style.getPropertyValue('border-radius'); if(!v) continue;
      const nums=(v.match(/[\\d.]+px/g)||[]).map(parseFloat); const mx=nums.length?Math.max(...nums):(/50%|999/.test(v)?999:0);
      declRadii.push({sel:r.selectorText,v,max:mx}); } };
    walk(rules); }

  /* --- §2 headings --- */
  const isSerif = f => /cinzel|crimson|newsreader|georgia|serif/i.test(f) && !/sans-serif/i.test(f.split(',').pop().trim()) || /serif\\s*$/i.test(f.trim());
  const headSel = 'h1,h2,h3,h4,h5,h6,.display,[class*="title"],[class*="Title"],[class*="head"],[class*="hdr"]';
  const heads = [...document.querySelectorAll(headSel)].filter(vis).map(el=>({el:desc(el),ff:getComputedStyle(el).fontFamily,
    serif:/serif/i.test(getComputedStyle(el).fontFamily) && !/^\\s*(system-ui|inter|roboto(?!\\s*mono)|arial|helvetica|ui-sans)/i.test(getComputedStyle(el).fontFamily)}));

  /* --- prose font family (§2 body) --- */
  const bodyFF = getComputedStyle(document.body).fontFamily;
  const proseFails = shown.filter(el=>el.children.length===0 && (el.textContent||'').trim().length>25)
    .map(el=>({el:desc(el),ff:getComputedStyle(el).fontFamily,txt:(el.textContent||'').trim().slice(0,50)}))
    .filter(x=>/(^|,)\\s*['"]?(Inter|Roboto(?! Mono)|system-ui|-apple-system|Segoe UI|Arial|Helvetica)['"]?/i.test(x.ff.split(',')[0]));

  /* --- §5 horizontal overflow --- */
  const ovf = { docScrollW: document.documentElement.scrollWidth, innerW: innerWidth,
    bodyScrollW: document.body.scrollWidth,
    offenders: shown.filter(el=>{const r=el.getBoundingClientRect(); return r.right>innerWidth+1.5 && r.width>4;}).slice(0,12).map(el=>({el:desc(el),right:+el.getBoundingClientRect().right.toFixed(0)})) };

  return { tokens, tokenFails, chrome:chrome.slice(0,60), chromeCount:chrome.length,
    radii:radii.sort((a,b)=>b.area-a.area).slice(0,40), radiiCount:radii.length,
    declRadii:declRadii.filter(d=>d.max>6), heads, bodyFF, proseFails:proseFails.slice(0,12), ovf,
    shownCount:shown.length };
})()`;
