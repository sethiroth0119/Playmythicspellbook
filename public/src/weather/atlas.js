/* ══════════════════════════════════════════════════════════════════════════
   🌦 WEATHER ATLAS — the board's weather VFX, one 2D canvas, 24 looks.
   Owner, 2026-09-18: "update the weather vfx and add the new ones", handing
   over Weather-Atlas-24-Transparent-VFX (24 transparent six-second loops, one
   per weatherType the game has after the v178 expansion).

   WHY THE RENDERER AND NOT THE LOOPS: the pack ships each look twice — as an
   animated WebP (3–11 MB each, ~170 MB for the set) and as the 10 KB
   procedural renderer that drew them. The renderer IS the source of the
   WebPs (build-weather.cjs just screenshots it), so running it live is the
   same picture at every size, for 10 KB instead of making a player pull
   10 MB the first time a Hurricane lands. The drawing code below is the
   pack's own, byte-for-byte where it could be; the changes are all at the
   edges and each is marked:
     · it draws into a canvas it is GIVEN (the pack grabbed the first <canvas>
       in the document — on the battle screen that is somebody else's);
     · cover-fit instead of stretch — the board is not 16:9, and a stretched
       blizzard reads as a smear;
     · DENSITY: every particle count is scaled by Q. The pack draws up to 1,100
       gradient particles a frame (Sandstorm) which is fine on a desktop and
       is not on a phone. Q starts at 1 (0.55 on a touch screen) and steps down
       if frames get slow; it never steps back up in the same mount, so it
       cannot oscillate;
     · 30 fps cap and no drawing while the tab is hidden;
     · no RAF-only loop: the Browser pane and background tabs throttle RAF, so
       the tick is a setTimeout — a slow frame never stalls the next one.
   ══════════════════════════════════════════════════════════════════════════ */

const NAMES = ['Blizzard','Hurricane','Gale','Miasma','Aurora','Gravity Well','Void Tide','Resonance','Spirit Veil','Verdant Bloom','Mana Surge','Iron Rain','Monsoon Flood','Prismatic Storm','Oil Fire Storm','Blood Moon','Mistveil','Eclipse','Mind Realm','Parallel World','Sandstorm','Lightning Storm','Rainstorm','Sunny Day'];
/* weatherType (WEATHER_CARDS) → atlas index. psychic / magic are the
   defensive aliases _WX_TYPE_DEFAULT already carries. */
const TYPE_INDEX = {
  blizzard: 0, hurricane: 1, gale: 2, miasma: 3, aurora: 4, gravityWell: 5, voidTide: 6,
  resonance: 7, spiritVeil: 8, verdantBloom: 9, manaSurge: 10, ironRain: 11, monsoonFlood: 12,
  prismaticStorm: 13, oilstorm: 14, bloodmoon: 15, mist: 16, eclipse: 17, mindRealm: 18,
  parallelWorld: 19, sand: 20, lightningStorm: 21, rain: 22, sun: 23,
  psychic: 18, magic: 19,
};

function makeRenderer(canvas) {
  const g = canvas.getContext('2d'), TAU = Math.PI * 2;
  const st = { Q: 1 };
  const N = (n) => Math.max(1, Math.round(n * st.Q));   // DENSITY — see header
  const r = n => { let v = Math.sin(n * 127.1 + 31.7) * 43758.5453; return v - Math.floor(v); }, mod = n => ((n % 1) + 1) % 1;
  const palettes = ['#e4f3ff','#8dabb9','#bad2ce','#96bb43','#65f7b9','#9581ee','#5b47b8','#91dbef','#c3e9d8','#89b95e','#68a8ff','#b2bdca','#8fbbc5','#caadff','#ef651c','#b63e3b','#bccbd0','#d3b994','#b685d9','#7ad1d2','#c8a475','#cadbff','#a9c6d9','#ffdfa0'];
  const textures = new Map();
  function texture(color){if(textures.has(color))return textures.get(color);let c=document.createElement('canvas');c.width=c.height=128;let x=c.getContext('2d'),im=x.createImageData(128,128),rgb=color.match(/\w\w/g).map(v=>parseInt(v,16));for(let j=0;j<128;j++)for(let i=0;i<128;i++){let dx=(i-64)/64,dy=(j-64)/64,d=Math.sqrt(dx*dx+dy*dy),n=0;for(let k=1;k<=5;k++)n+=(Math.sin(i*.035*k*k+Math.sin(j*.044*k)*2+k)*Math.cos(j*.041*k*k+k)+1)/(k*3);let a=Math.pow(Math.max(0,1-d*d),2.8)*Math.min(1,n)*.65,idx=(j*128+i)*4;im.data[idx]=rgb[0];im.data[idx+1]=rgb[1];im.data[idx+2]=rgb[2];im.data[idx+3]=a*255}x.putImageData(im,0,0);textures.set(color,c);return c}
  function puff(x,y,s,c,a=1,stretch=1,rot=0){g.save();g.translate(x,y);g.rotate(rot);g.globalAlpha=a;g.drawImage(texture(c),-s,-s*stretch,s*2,s*2*stretch);g.restore()}
  function line(pts,c,w,a){g.globalAlpha=a;g.strokeStyle=c;g.lineWidth=w;g.beginPath();pts.forEach((p,i)=>i?g.lineTo(...p):g.moveTo(...p));g.stroke();g.globalAlpha=1}
  function glow(x,y,s,c,a){g.save();g.globalAlpha=a;let q=g.createRadialGradient(x,y,0,x,y,s);q.addColorStop(0,c);q.addColorStop(.22,c+'88');q.addColorStop(1,c+'00');g.fillStyle=q;g.fillRect(x-s,y-s,s*2,s*2);g.restore()}
  function cloud(t,c,count=65,strength=.3,base=220){count=N(count);for(let i=0;i<count;i++){let u=mod(t/6+r(i)),x=u*1240-120,y=base+Math.sin(TAU*u+r(i+5)*6)*45+(r(i+1)-.5)*190;puff(x,y,65+r(i+2)*100,c,strength,.3+r(i+3)*.35,Math.sin(TAU*u)*.2)}}
  function rain(t,c,count,dx,snow=false,metal=false){count=N(count);for(let i=0;i<count;i++){let z=.25+r(i+20)*.75,u=mod(t/6*(1+Math.floor(z*4))+r(i)),y=u*760-100,x=mod(r(i+100)+u*dx/1000)*1200-100,a=Math.sin(Math.PI*u)*(.25+z*.6);if(snow){glow(x,y,1+z*3,c,a);if(z>.8)puff(x,y,5,c,a*.5)}else{line([[x,y],[x+dx*.03*z,y-22*z]],c,metal?1+z*2:.4+z,a);if(metal)line([[x,y],[x+3,y-9]],'#fff5d8',.6,a)}}}
  function vortex(t,c,flat=false,dark=false){const n=N(360);for(let i=0;i<n;i++){let rad=25+r(i)*350,phase=TAU*(t/6*(1+Math.floor(r(i+7)*3))+r(i+1)),x=500+Math.cos(phase)*rad,y=285+Math.sin(phase)*rad*(flat?.29:.7);puff(x,y,12+rad*.13,c,.17,flat?.4:.7,phase);if(i%4===0)line([[x,y],[x-Math.sin(phase)*10,y+Math.cos(phase)*5]],'#d3d7ff',.7,.45)}if(dark){glow(500,285,85,c,.5);g.fillStyle='#060812';g.beginPath();g.ellipse(500,285,49,flat?19:49,0,0,TAU);g.fill()}}
  function ribbons(t,c,kind){for(let j=0;j<70;j++){let pts=[];for(let x=0;x<=1000;x+=10){let y=200+Math.sin(x*.005+t/6*TAU+j*.018)*65+Math.sin(x*.013-t/6*TAU)*22+j*2;pts.push([x,y])}line(pts,c,.8,Math.sin(j/70*Math.PI)*.07)}if(kind)cloud(t,c,40,.12,300)}
  function sparks(t,c,n=100,rise=true){n=N(n);for(let i=0;i<n;i++){let u=mod(t/6+r(i)),x=r(i+60)*1000+Math.sin(u*TAU+i)*25,y=rise?560-u*600:u*600-20;glow(x,y,1+r(i+3)*3,c,Math.sin(u*Math.PI)*.8)}}
  function bolt(t,c,seed=0){let d=mod(t/6+seed*.19),a=Math.exp(-Math.pow((d-.3)*65,2))+.6*Math.exp(-Math.pow((d-.35)*100,2));if(a<.002)return;let p=[],x=230+r(seed+44)*550;for(let k=0;k<22;k++)p.push([x+(r(k+seed*44)-.5)*65,k*22]);line(p,c,12,a*.09);line(p,c,4,a*.35);line(p,'#f5f8ff',1.2,a);for(let k=4;k<18;k+=5){let q=[p[k]];for(let j=1;j<7;j++)q.push([p[k][0]+j*12+(r(j+k)-.5)*20,p[k][1]+j*13]);line(q,c,1,a*.6)}glow(x,460,90,c,a*.25)}
  function stormLightning(t){
    cloud(t,'#455468',65,.37,75);cloud(t,'#788b9e',40,.22,130);
    for(let s=0;s<1;s++){
      // One strike per weather loop, followed by over five seconds of quiet rain.
      let age=mod((t-1.8)/6)*6;
      let a=age<.65?(1-Math.exp(-age*130))*Math.exp(-age*8):0;
      if(a<.004)continue;
      let x=180+r(s+45)*650,end=x+(r(s+91)-.5)*230,top=42+r(s+50)*35,bottom=440+r(s+81)*90;
      glow(x,95,260,'#a3bdff',a*.48);glow(end,440,190,'#91baff',a*.22);
      for(let k=0;k<18;k++){let xx=x+(r(k+s*99)-.5)*410,yy=60+r(k+90)*130;puff(xx,yy,45+r(k+37)*70,'#d0dfff',a*.55,.45)}
      g.save();g.lineCap='round';g.lineJoin='round';
      function branch(x0,y0,x1,y1,seed,width,depth){let pts=[[x0,y0]],n=24;for(let j=1;j<=n;j++){let u=j/n;pts.push([x0+(x1-x0)*u+(r(seed+j*3)-.5)*(depth?66:32)*Math.sin(Math.PI*u)+Math.sin(u*19+seed)*9,y0+(y1-y0)*u])}
        line(pts,'#657dff',width*17,a*.045);line(pts,'#8bafff',width*7,a*.13);line(pts,'#b2d6ff',width*2.7,a*.55);line(pts,'#f4fbff',width,a*.95);
        if(depth)for(let k=5;k<22;k+=4){let p=pts[k],side=r(seed+k)>.5?1:-1;branch(p[0],p[1],p[0]+side*(45+r(seed+k+4)*130),p[1]+45+r(seed+k+8)*110,seed+k*21,width*.38,depth-1)}}
      branch(x,top,end,bottom,120+s*193,1.9,2);glow(end,bottom,42,'#c1e1ff',a*.6);g.restore();
    }rain(t,'#bdd1e2',380,110);
  }
  function orb(t,c,eclipse=false){let x=680,y=155,R=75;glow(x,y,R*1.8,c,.5);g.save();g.beginPath();g.arc(x,y,R,0,TAU);g.clip();let grad=g.createRadialGradient(x-25,y-30,4,x,y,R);grad.addColorStop(0,eclipse?'#100f18':'#e18c70');grad.addColorStop(1,eclipse?'#03050a':'#491820');g.fillStyle=grad;g.fillRect(x-R,y-R,R*2,R*2);if(!eclipse)for(let i=0;i<70;i++)puff(x+(r(i)-.5)*150,y+(r(i+90)-.5)*150,5+r(i+10)*20,'#5b2828',.55);g.restore();if(eclipse){g.strokeStyle='#ffe8bd';g.lineWidth=1.5;g.beginPath();g.arc(x,y,R,0,TAU);g.stroke()}cloud(t,c,32,.15,260)}
  function render(index, time) {
    let t = mod(time / 6) * 6, c = palettes[index];
    /* COVER-FIT — see header. The pack's space is 1000 × 562.5. */
    const s = Math.max(canvas.width / 1000, canvas.height / 562.5);
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height);
    g.setTransform(s, 0, 0, s, (canvas.width - 1000 * s) / 2, (canvas.height - 562.5 * s) / 2);
    g.globalCompositeOperation = 'source-over';
    switch(index){
      case 0:cloud(t,c,80,.22);rain(t,c,850,550,true);break;
      case 1:vortex(t,c,true);cloud(t,'#647a86',60,.23,130);rain(t,'#aec6ce',500,600);break;
      case 2:{cloud(t,c,85,.18,280);const n=N(110);for(let i=0;i<n;i++){let u=mod(t/6*3+r(i)),x=u*1200-100,y=r(i+1)*540;line([[x,y],[x-30,y+5]],c,.7,Math.sin(u*Math.PI)*.25)}break;}
      case 3:cloud(t,'#52664a',80,.45,365);cloud(t,c,60,.4,310);sparks(t,'#c2db74',90);break;
      case 4:ribbons(t,c);ribbons(t+2,'#8c8fe1');sparks(t,'#cbe9ff',80);break;
      case 5:vortex(t,c,false,true);sparks(t,c,120);break;
      case 6:for(let i=0;i<5;i++)cloud(t+i*.5,i%2?c:'#292442',45,.35,340+i*34+Math.sin(t/6*TAU+i)*15);break;
      case 7:for(let i=0;i<8;i++){let u=mod(t/6+i/8);g.save();g.translate(500,281);g.scale(1,.65);g.beginPath();g.arc(0,0,u*610,0,TAU);g.strokeStyle=c;g.lineWidth=1+Math.sin(u*Math.PI)*3;g.globalAlpha=Math.sin(u*Math.PI)*.35;g.stroke();g.restore()}cloud(t,c,20,.08);break;
      case 8:ribbons(t,c,true);for(let i=0;i<18;i++){let a=t/6*TAU+r(i)*TAU;puff(r(i+2)*1000,280+Math.sin(a)*120,25,c,.3,2.8,Math.sin(a)*.4)}break;
      case 9:{cloud(t,c,40,.17,460);sparks(t,'#e3d8a0',130);const n=N(100);for(let i=0;i<n;i++){let u=mod(t/6+r(i)),x=r(i+10)*1000+Math.sin(u*TAU)*65,y=560-u*560;g.save();g.translate(x,y);g.rotate(u*TAU+i);g.globalAlpha=Math.sin(u*Math.PI)*.8;g.fillStyle=i%4?'#739956':'#e5b9ce';g.beginPath();g.ellipse(0,0,2+r(i)*4,1.5,0,0,TAU);g.fill();g.restore()}break;}
      case 10:cloud(t,c,40,.16,430);sparks(t,c,240);for(let i=0;i<12;i++){let u=mod(t/6+r(i));glow(r(i+3)*1000,560-u*550,25,c,Math.sin(u*Math.PI)*.22)}break;
      case 11:rain(t,c,330,-220,false,true);cloud(t,'#777e82',40,.2,460);sparks(t,'#f3b96d',70);break;
      case 12:rain(t,c,850,100);for(let j=0;j<35;j++){let pts=[];for(let x=0;x<=1000;x+=8)pts.push([x,420+j*4+Math.sin(x*.023+t/6*TAU*2+j*.7)*(3+j*.18)]);line(pts,j%3?'#769ca8':'#d0e4e8',1.2,.22)}cloud(t,c,45,.2,450);break;
      case 13:rain(t,c,450,220);for(let i=0;i<7;i++){let cc=['#fc8d91','#f5b36e','#f2df93','#96d5ad','#82cddd','#9498e9','#d99fe3'][i];ribbons(t+i*.35,cc);bolt(t,cc,i)}break;
      case 14:{cloud(t,'#282830',100,.7,210);const n=N(160);for(let i=0;i<n;i++){let u=mod(t/6*2+r(i)),x=r(i+10)*1100-50+Math.sin(u*TAU+i)*35,y=550-u*350;puff(x,y,20+u*50,i%3?'#c45321':'#ffb557',Math.sin(u*Math.PI)*.55,1.3-u*.5)}sparks(t,'#ffc078',220);break;}
      case 15:orb(t,c);sparks(t,'#ad6e63',75);break;
      case 16:cloud(t,c,160,.33,350);cloud(t,'#9badb3',75,.2,200);break;
      case 17:orb(t,c,true);sparks(t,'#d5c6a4',70);break;
      case 18:ribbons(t,c,true);for(let i=0;i<45;i++){let x=r(i)*1000,y=r(i+1)*560;glow(x,y,3,c,.4+.25*Math.sin(t/6*TAU+i));if(i%3)line([[x,y],[r(i-1)*1000,r(i)*560]],c,.5,.05+.04*Math.sin(t/6*TAU+i))}break;
      case 19:vortex(t,c,false);ribbons(t,'#ca94c5');for(let i=0;i<13;i++){let a=t/6*TAU+i/13*TAU,x=500+Math.cos(a)*220,y=280+Math.sin(a)*180;line([[x-12,y-30],[x+9,y],[x-7,y+32]],'#d3f4f0',1,.5)}break;
      case 20:cloud(t,c,150,.5,270);rain(t,'#dbc49c',1100,850,true);break;
      case 21:stormLightning(t);break;
      case 22:{rain(t,c,950,80);cloud(t,c,45,.12,465);const n=N(80);for(let i=0;i<n;i++){let u=mod(t/6*4+r(i));g.globalAlpha=(1-u)*.2;g.strokeStyle=c;g.lineWidth=.7;g.beginPath();g.ellipse(r(i+3)*1000,420+r(i+4)*135,2+u*17,1+u*4,0,0,TAU);g.stroke()}g.globalAlpha=1;break;}
      case 23:glow(800,65,140,c,.65);for(let i=0;i<12;i++){let a=.8+i*.11+Math.sin(t/6*TAU)*.025;let grad=g.createLinearGradient(800,45,800-Math.cos(a)*700,45+Math.sin(a)*700);grad.addColorStop(0,'#ffe4ad22');grad.addColorStop(1,'#ffe4ad00');g.fillStyle=grad;g.beginPath();g.moveTo(800,45);g.lineTo(800-Math.cos(a)*850,45+Math.sin(a)*850);g.lineTo(800-Math.cos(a+.025)*850,45+Math.sin(a+.025)*850);g.fill()}sparks(t,'#ffeac2',100);break;
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }
  return { render, st };
}

/* ── the one live overlay ─────────────────────────────────────────────────── */
const A = { on: false, host: null, canvas: null, R: null, index: -1, type: null, timer: 0, t0: 0, slow: 0, ro: null };
const FRAME_MS = 33;   // 30 fps cap

function sizeCanvas() {
  if (!A.canvas || !A.host) return;
  const dpr = Math.min(window.devicePixelRatio || 1, A.R && A.R.st.Q < 1 ? 1 : 1.5);
  const w = Math.max(1, Math.round(A.host.clientWidth * dpr)), h = Math.max(1, Math.round(A.host.clientHeight * dpr));
  if (A.canvas.width !== w || A.canvas.height !== h) { A.canvas.width = w; A.canvas.height = h; }
}
function frame() {
  A.timer = 0;
  if (!A.on) return;
  if (!document.hidden && A.canvas && A.canvas.isConnected) {
    const t0 = performance.now();
    try { A.R.render(A.index, (t0 - A.t0) / 1000); } catch (e) { try { console.warn('[weather atlas]', e); } catch (_) {} }
    /* adaptive density: three slow frames in a row → one step lighter, floor 0.35 */
    const dt = performance.now() - t0;
    A.slow = dt > 20 ? A.slow + 1 : 0;
    if (A.slow >= 3 && A.R.st.Q > 0.35) { A.R.st.Q = Math.max(0.35, A.R.st.Q * 0.7); A.slow = 0; sizeCanvas(); }
  }
  A.timer = setTimeout(frame, FRAME_MS);
}
/* opts.look — a look chosen in the Forge ('ATLAS:<type>'), which may differ
   from the weather actually on the field; absent, the weather's own look. */
function mount(host, weatherType, opts) {
  const look = (opts && opts.look) || weatherType;
  const index = TYPE_INDEX[look];
  if (index == null || !host) { unmount(); return false; }
  if (A.on && A.host === host && A.canvas && A.canvas.isConnected) {
    if (A.index !== index) { A.index = index; A.type = weatherType; }
    if (opts && opts.opacity != null) A.canvas.style.opacity = String(opts.opacity);
    return true;
  }
  unmount();
  const c = document.createElement('canvas');
  c.className = 'wxatlas-canvas';
  c.setAttribute('aria-hidden', 'true');
  c.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:14;display:block;opacity:' + ((opts && opts.opacity != null) ? opts.opacity : 0.9);
  try { if (getComputedStyle(host).position === 'static') host.style.position = 'relative'; } catch (e) {}
  host.appendChild(c);
  A.host = host; A.canvas = c; A.R = makeRenderer(c); A.index = index; A.type = weatherType; A.on = true; A.t0 = performance.now(); A.slow = 0;
  try { if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) A.R.st.Q = 0.55; } catch (e) {}
  sizeCanvas();
  try { A.ro = new ResizeObserver(sizeCanvas); A.ro.observe(host); } catch (e) {}
  frame();
  return true;
}
function unmount() {
  if (A.timer) { clearTimeout(A.timer); A.timer = 0; }
  try { if (A.ro) A.ro.disconnect(); } catch (e) {}
  try { if (A.canvas && A.canvas.parentNode) A.canvas.parentNode.removeChild(A.canvas); } catch (e) {}
  A.on = false; A.host = null; A.canvas = null; A.R = null; A.index = -1; A.type = null; A.ro = null;
}

window.MythicWeatherAtlas = {
  names: NAMES.slice(),
  types: Object.keys(TYPE_INDEX),
  has: (weatherType) => TYPE_INDEX[weatherType] != null,
  /* the 24 looks by the weatherType that owns each (aliases excluded) */
  looks: () => Object.keys(TYPE_INDEX).filter(k => k !== 'psychic' && k !== 'magic').map(k => ({ key: k, name: NAMES[TYPE_INDEX[k]] })),
  mount, unmount,
  get active() { return A.on ? A.type : null; },
  /* for probes and stills: draw one frame of a look into any canvas */
  drawInto(canvas, weatherType, seconds) { const i = TYPE_INDEX[weatherType]; if (i == null) return false; makeRenderer(canvas).render(i, seconds || 0); return true; },
};
