/* =====================================================================
   ABRAXAS TUTORIAL — embeddable lesson system
   =====================================================================
   Drop this ONE file into any page of your game and you get the full
   Survivor's-Handbook lesson dialog as an overlay: comic slam-in,
   media stage (YouTube / .mp4 / image), the Archivist typewriter box,
   per-step VOICE AUDIO, progress pips, and first-time auto-show.

   ------------------------------------------------------------------
   QUICK START (3 lines per page):

     <script src="abraxas-tutorial.js"></script>
     <script>
       // 1. Register the lesson for this page (once, anywhere)
       AbraxasTutorial.register('battle', {
         name: 'Combat',
         steps: [
           { title:'Fight or flee',
             text:'Strike from behind for **critical damage**.',
             videoUrl:'https://youtu.be/YOUR_VIDEO_ID',   // YouTube or .mp4
             audioUrl:'audio/combat-step1.mp3',           // voiceover file
             cap:'Combat basics' },
           { title:'Stamina',
             text:'Every swing costs **stamina**.',
             speak:true }                                  // no file? built-in
         ]                                                 // narrator reads it
       });

       // 2. Put a ✦ Tutorial button wherever you want on the page
       AbraxasTutorial.button('#hud-right', 'battle');

       // 3. Auto-open the first time the player enters this page
       AbraxasTutorial.openOnce('battle');
     </script>

   ------------------------------------------------------------------
   API
     AbraxasTutorial.register(id, lesson)      one lesson per page id
     AbraxasTutorial.register({id:lesson,...}) or many at once
     AbraxasTutorial.button(target, id, label?)  styled button; shows a
                                                pulsing dot until seen
     AbraxasTutorial.open(id, opts?)           open now  {onDone()}
     AbraxasTutorial.openOnce(id, opts?)       open only if never seen
     AbraxasTutorial.isSeen(id) / .markSeen(id) / .reset(id?) 
     AbraxasTutorial.close()
     AbraxasTutorial.config({...})             see DEFAULTS below

   STEP FIELDS
     title     small gold heading
     text      the Archivist's line; **word** renders gold
     videoUrl  YouTube (watch / youtu.be / shorts / embed / live) or
               direct .mp4 / .webm / .ogg
     imageUrl  still image when there is no video
     audioUrl  voiceover audio file, auto-plays with the step
     speak     true → if no audioUrl, the browser narrator reads `text`
     cap       caption under the media panel

   PERSISTENCE
     "Seen" flags live in memory by default (works everywhere, incl.
     sandboxed previews). For your real game, plug in your save system:

       AbraxasTutorial.config({ persistence:{
         get: id => mySave.tutorialsSeen.includes(id),
         set: id => { mySave.tutorialsSeen.push(id); saveGame(); }
       }});
   ===================================================================== */
(function(global){
'use strict';

/* ------------------------------ config ----------------------------- */
const DEFAULTS = {
  guideName : 'The Archivist',
  guideTag  : 'Guide',
  sounds    : true,     /* procedural blips / slams (WebAudio)          */
  voice     : true,     /* per-step audioUrl / speak narration          */
  typeSpeed : 1,        /* 1 = normal, 2 = twice as fast                */
  zIndex    : 99990,
  persistence : null    /* {get(id)=>bool, set(id)} — default: memory   */
};
let CFG = Object.assign({}, DEFAULTS);

/* ------------------------------ state ------------------------------ */
const LESSONS = {};                 /* id -> lesson                     */
const seenMem = new Set();          /* memory persistence fallback      */
const buttons = {};                 /* id -> [btn,...] for badge sync   */
let S = null;                       /* active session                   */

const isSeen  = id => CFG.persistence ? !!CFG.persistence.get(id) : seenMem.has(id);
/* opts.preview (Forge 👁) opens a lesson WITHOUT recording it as seen —
   previewing your own tutorial used to burn the once-per-player flag, so it
   could never auto-play for you again. */
const markSeen= id => { if(S&&S.preview) return; CFG.persistence ? CFG.persistence.set(id) : seenMem.add(id); syncBadges(id); };

/* --------------------------- styles + dom -------------------------- */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@700;900&family=Cormorant+Garamond:ital,wght@0,600;1,600&display=swap');
.abx-overlay{position:fixed;inset:0;z-index:${'${Z}'};display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:16px;padding:20px;
  background:rgba(3,4,12,.82);backdrop-filter:blur(3px);
  font-family:'Cormorant Garamond',Georgia,serif;color:#d8def2;
  opacity:0;transition:opacity .3s ease}
.abx-overlay.abx-on{opacity:1}
.abx-overlay *{margin:0;padding:0;box-sizing:border-box}
.abx-overlay button{font-family:inherit;cursor:pointer}
.abx-burst{position:absolute;inset:0;pointer-events:none;opacity:0}
.abx-burst.abx-go{animation:abxBurst .5s ease-out}
@keyframes abxBurst{0%{opacity:.9}100%{opacity:0}}
.abx-frame{position:relative;background:linear-gradient(160deg,rgba(20,26,58,.96),rgba(9,12,30,.97));
  border:1px solid rgba(201,164,74,.5);
  box-shadow:0 0 0 1px rgba(6,8,20,.9),0 18px 60px rgba(0,0,0,.7),inset 0 0 60px rgba(91,33,201,.12)}
.abx-frame i.abx-c{position:absolute;width:16px;height:16px;border:2px solid #c9a44a;pointer-events:none}
.abx-frame i.abx-c:nth-child(1){top:-2px;left:-2px;border-right:none;border-bottom:none}
.abx-frame i.abx-c:nth-child(2){top:-2px;right:-2px;border-left:none;border-bottom:none}
.abx-frame i.abx-c:nth-child(3){bottom:-2px;left:-2px;border-right:none;border-top:none}
.abx-frame i.abx-c:nth-child(4){bottom:-2px;right:-2px;border-left:none;border-top:none}
.abx-media{width:min(1040px,95vw);aspect-ratio:16/9;max-height:62vh;overflow:hidden;
  transform:rotate(-.4deg);animation:abxPanel .45s cubic-bezier(.16,1.2,.3,1)}
@keyframes abxPanel{0%{opacity:0;transform:rotate(-.4deg) translateY(-40px) skewX(-5deg)}
  100%{opacity:1;transform:rotate(-.4deg)}}
.abx-mediabox{position:absolute;inset:0;background:#08060f}
.abx-mediabox iframe,.abx-mediabox video{position:absolute;inset:0;width:100%;height:100%;border:0}
/* 🖼 The step image is shown WHOLE (contain) — cover used to crop the top and
   bottom off every non-16:9 upload. A blurred copy fills the letterbox so the
   frame still reads as one panel, and the sharp image sits on top untouched. */
.abx-mediabox img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:1}
.abx-mediabox img.abx-imgbg{object-fit:cover;z-index:0;transform:scale(1.14);
  filter:blur(20px) brightness(.4) saturate(.85)}
/* Dot screen dialled right down — at .45 it visibly muddied the artwork. */
.abx-halftone{position:absolute;inset:0;z-index:2;mix-blend-mode:soft-light;opacity:.1;pointer-events:none;
  background-image:radial-gradient(rgba(255,255,255,.5) 1px,transparent 1.4px);background-size:5px 5px}
.abx-slot{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:12px;text-align:center;padding:20px;font-style:italic;
  color:#9aa4c8;font-size:17px;line-height:1.45}
.abx-slot b{color:#ecca6f;font-style:normal}
.abx-play{width:56px;height:56px;border:2px solid #c9a44a;border-radius:50%;display:flex;
  align-items:center;justify-content:center;color:#ecca6f;font-size:18px;padding-left:5px;
  box-shadow:0 0 24px rgba(236,202,111,.4)}
.abx-cap{position:absolute;left:0;right:0;bottom:0;display:flex;align-items:center;
  justify-content:space-between;padding:9px 16px;font-family:Cinzel,serif;font-size:11px;
  letter-spacing:.24em;text-transform:uppercase;color:#ecca6f;
  background:linear-gradient(0deg,rgba(5,7,18,.94),transparent)}
.abx-cap a{pointer-events:auto;color:#ecca6f;text-decoration:none;font-size:10px;letter-spacing:.2em}
.abx-cap a:hover{text-shadow:0 0 12px rgba(236,202,111,.7)}
.abx-guide{width:min(860px,94vw);padding:20px 24px 16px;border-color:rgba(165,108,245,.55);
  box-shadow:0 0 0 1px rgba(6,8,20,.9),0 0 42px rgba(123,63,242,.35),0 24px 70px rgba(0,0,0,.7),
  inset 0 0 70px rgba(91,33,201,.14);animation:abxSlam .42s cubic-bezier(.16,1.3,.3,1)}
@keyframes abxSlam{0%{opacity:0;transform:translateY(60px) skewX(-4deg) scale(.97)}
  70%{opacity:1;transform:translateY(-5px) scale(1.01)}100%{opacity:1;transform:none}}
.abx-grid{display:grid;grid-template-columns:88px 1fr;gap:18px;align-items:start}
.abx-portrait{width:88px;height:88px;position:relative;border:2px solid #c9a44a;overflow:hidden;
  transform:rotate(-1.5deg);background:#0b0820;
  box-shadow:0 0 24px rgba(165,108,245,.7),inset 0 0 24px rgba(91,33,201,.5)}
.abx-portrait canvas{width:100%;height:100%;display:block}
.abx-row{display:flex;align-items:center;gap:12px;margin-bottom:5px;flex-wrap:wrap}
.abx-name{font-family:Cinzel,serif;font-weight:900;font-size:19px;letter-spacing:.12em;
  color:#fff;text-transform:uppercase;text-shadow:0 0 18px rgba(165,108,245,.8)}
.abx-tag{font-family:Cinzel,serif;font-size:10px;letter-spacing:.3em;padding:4px 12px 3px;
  color:#ecca6f;border:1px solid rgba(201,164,74,.7);border-radius:20px;text-transform:uppercase;
  box-shadow:0 0 12px rgba(201,164,74,.3),inset 0 0 10px rgba(201,164,74,.15)}
.abx-voice{display:none;align-items:center;gap:7px;font-family:Cinzel,serif;font-size:9.5px;
  letter-spacing:.22em;color:#a56cf5;text-transform:uppercase;border:1px solid rgba(165,108,245,.5);
  border-radius:20px;padding:4px 12px 3px;background:transparent}
.abx-voice.abx-show{display:inline-flex}
.abx-voice .abx-eq{display:inline-flex;gap:2px;align-items:flex-end;height:10px}
.abx-voice .abx-eq b{width:2.5px;background:#a56cf5;animation:abxEq .7s ease-in-out infinite}
.abx-voice .abx-eq b:nth-child(2){animation-delay:.2s}
.abx-voice .abx-eq b:nth-child(3){animation-delay:.4s}
@keyframes abxEq{0%,100%{height:3px}50%{height:10px}}
.abx-voice.abx-idle .abx-eq b{animation:none;height:3px}
.abx-voice:hover{color:#d8b6ff;box-shadow:0 0 12px rgba(165,108,245,.4)}
.abx-steptitle{font-family:Cinzel,serif;font-weight:700;font-size:13.5px;letter-spacing:.14em;
  color:#ecca6f;text-transform:uppercase;margin-bottom:6px}
/* Long lessons SCROLL instead of running off the panel (a 1500-word step used
   to overflow the frame and the screen). The cap is viewport-relative so the
   footer buttons always stay reachable. */
.abx-text{font-size:19px;font-weight:600;font-style:italic;line-height:1.5;min-height:2.9em;color:#f0ecff;
  max-height:min(48vh,420px);overflow-y:auto;overscroll-behavior:contain;padding-right:10px}
.abx-text::-webkit-scrollbar{width:8px}
.abx-text::-webkit-scrollbar-track{background:rgba(255,255,255,.04);border-radius:4px}
.abx-text::-webkit-scrollbar-thumb{background:rgba(236,202,111,.34);border-radius:4px}
.abx-text::-webkit-scrollbar-thumb:hover{background:rgba(236,202,111,.55)}
.abx-text{scrollbar-width:thin;scrollbar-color:rgba(236,202,111,.34) rgba(255,255,255,.04)}
/* Three dashes on their own line = a section rule between topics. */
.abx-sep{height:1px;margin:14px 0 12px;border:0;
  background:linear-gradient(90deg,transparent,rgba(236,202,111,.5),transparent)}
.abx-text .abx-em{color:#ecca6f;font-style:normal;text-shadow:0 0 14px rgba(236,202,111,.45)}
.abx-cursor{display:inline-block;width:14px;border-bottom:2px solid #ecca6f;
  transform:translateY(-2px);margin-left:4px;animation:abxBlink 1s steps(1) infinite}
@keyframes abxBlink{50%{opacity:0}}
.abx-footer{display:flex;align-items:center;justify-content:space-between;margin-top:12px;gap:12px;flex-wrap:wrap}
.abx-pips{display:flex;gap:8px;align-items:center}
.abx-pips span{width:8px;height:8px;transform:rotate(45deg);border:1px solid #8a7135;transition:all .25s}
.abx-pips span.abx-on{background:#ecca6f;border-color:#ecca6f;box-shadow:0 0 10px rgba(236,202,111,.8)}
.abx-steplbl{font-family:Cinzel,serif;font-size:10px;letter-spacing:.26em;color:#9aa4c8;
  text-transform:uppercase;margin-left:10px}
.abx-btns{display:flex;gap:10px}
.abx-btn{font-family:Cinzel,serif;font-weight:700;font-size:11px;letter-spacing:.22em;
  text-transform:uppercase;padding:10px 20px;transition:all .18s ease;border:none}
.abx-b-skip{background:transparent;color:#9aa4c8;border:1px solid rgba(154,164,200,.4)}
.abx-b-skip:hover{color:#d8def2;border-color:#9aa4c8}
.abx-b-gold{color:#241a05;border:1px solid #f4dd9a;
  background:linear-gradient(180deg,#f0d27c,#c9a44a 55%,#a8842f);
  box-shadow:0 0 22px rgba(236,202,111,.45),inset 0 1px 0 rgba(255,255,255,.5)}
.abx-b-gold:hover{filter:brightness(1.12);box-shadow:0 0 34px rgba(236,202,111,.7)}
.abx-b-gold:active{transform:translateY(1px)}
.abx-close{position:absolute;top:14px;right:18px;background:transparent;border:none;
  color:#9aa4c8;font-family:Cinzel,serif;font-size:12px;letter-spacing:.24em;
  text-transform:uppercase;padding:8px 12px}
.abx-close:hover{color:#ecca6f;text-shadow:0 0 12px rgba(236,202,111,.5)}
.abx-shake{animation:abxShake .38s cubic-bezier(.36,.07,.19,.97)}
@keyframes abxShake{10%,90%{transform:translate(-1px,1px)}20%,80%{transform:translate(3px,-2px)}
  30%,50%,70%{transform:translate(-5px,3px)}40%,60%{transform:translate(4px,-3px)}}
/* ---- the drop-in page button ---- */
.abx-tutbtn{position:relative;display:inline-flex;align-items:center;gap:9px;
  font-family:Cinzel,serif;font-weight:700;font-size:12px;letter-spacing:.22em;
  text-transform:uppercase;padding:10px 20px;color:#ecca6f;background:rgba(13,19,48,.85);
  border:1px solid rgba(201,164,74,.6);transition:all .18s;cursor:pointer}
.abx-tutbtn:hover{border-color:#ecca6f;box-shadow:0 0 20px rgba(236,202,111,.4);
  background:rgba(41,30,80,.9)}
.abx-tutbtn .abx-new{width:8px;height:8px;border-radius:50%;background:#a56cf5;
  box-shadow:0 0 10px #a56cf5;animation:abxBlink 1.6s ease infinite}
.abx-tutbtn.abx-seen .abx-new{display:none}
@media(max-width:640px){
  .abx-grid{grid-template-columns:60px 1fr}
  .abx-portrait{width:60px;height:60px}
  .abx-text{font-size:17px;max-height:min(42vh,320px)}
}
@media(prefers-reduced-motion:reduce){
  .abx-overlay *,.abx-overlay{animation-duration:.001s!important;transition-duration:.001s!important}
}`;

let cssInjected=false;
function injectCSS(){
  if(cssInjected) return;
  const st=document.createElement('style');
  st.textContent = CSS.replace('${Z}', CFG.zIndex);
  document.head.appendChild(st);
  cssInjected=true;
}

/* ------------------------- tiny WebAudio kit ------------------------ */
const Sfx=(()=>{ let ctx,master;
  const boot=()=>{ if(ctx||!CFG.sounds) return;
    try{ ctx=new (window.AudioContext||window.webkitAudioContext)();
      master=ctx.createGain(); master.gain.value=.8; master.connect(ctx.destination);
    }catch(e){} };
  const env=(g,a,p,r)=>{ const t=ctx.currentTime;
    g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(.0001,t);
    g.gain.exponentialRampToValueAtTime(p,t+a);
    g.gain.exponentialRampToValueAtTime(.0001,t+a+r) };
  return {
    boot,
    blip(){ if(!ctx||!CFG.sounds) return;
      const o=ctx.createOscillator(),g=ctx.createGain();
      o.type='triangle'; o.frequency.value=560+Math.random()*240;
      o.connect(g); g.connect(master); env(g,.004,.024,.05);
      o.start(); o.stop(ctx.currentTime+.09) },
    hit(p=1){ if(!ctx||!CFG.sounds) return;
      const o=ctx.createOscillator(),g=ctx.createGain();
      o.type='sine'; o.frequency.setValueAtTime(140,ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(40,ctx.currentTime+.35);
      o.connect(g); g.connect(master); env(g,.005,.4*p,.45);
      o.start(); o.stop(ctx.currentTime+.55) },
    chime(){ if(!ctx||!CFG.sounds) return;
      [261.6,329.6,392,523.25].forEach((f,i)=>{
        const o=ctx.createOscillator(),g=ctx.createGain();
        o.type='sine'; o.frequency.value=f; o.connect(g); g.connect(master);
        const t=ctx.currentTime+i*.1;
        g.gain.setValueAtTime(.0001,t); g.gain.exponentialRampToValueAtTime(.08,t+.03);
        g.gain.exponentialRampToValueAtTime(.0001,t+1.2);
        o.start(t); o.stop(t+1.3) }) }
  };
})();

/* --------------------------- voice audio ---------------------------- */
/* Plays step.audioUrl; falls back to speechSynthesis when step.speak.  */
const Voice={
  el:null, speaking:false,
  stop(){
    if(this.el){ this.el.pause(); this.el=null }
    if(this.speaking && global.speechSynthesis){ speechSynthesis.cancel(); this.speaking=false }
    S && S.voiceChip && S.voiceChip.classList.add('abx-idle');
  },
  play(step){
    this.stop();
    if(!CFG.voice || !S) return;
    const chip=S.voiceChip;
    if(step.audioUrl){
      chip.classList.add('abx-show'); chip.classList.remove('abx-idle');
      this.el=new Audio(step.audioUrl); this.el.volume=.95;
      this.el.onended=()=>chip.classList.add('abx-idle');
      this.el.onerror =()=>chip.classList.add('abx-idle');
      this.el.play().catch(()=>chip.classList.add('abx-idle'));
    } else if(step.speak && global.speechSynthesis){
      chip.classList.add('abx-show'); chip.classList.remove('abx-idle');
      const u=new SpeechSynthesisUtterance(step.text.replace(/\*\*/g,''));
      u.rate=.92; u.pitch=.8;
      u.onend=()=>{ this.speaking=false; chip.classList.add('abx-idle') };
      this.speaking=true; speechSynthesis.speak(u);
    } else {
      chip.classList.remove('abx-show');
    }
  },
  replay(){ if(S) this.play(S.lesson.steps[S.step]) }
};

/* --------------------------- media builder -------------------------- */
function ytId(url){
  if(!url||/YOUR_VIDEO_ID/i.test(url)) return null;
  const m=url.match(/(?:youtu\.be\/|[?&]v=|shorts\/|embed\/|live\/)([\w-]{11})(?=[^\w-]|$)/);
  return m?m[1]:null;
}
function renderMedia(step){
  const box=S.mediaBox, cap=S.capText, yt=S.ytLink;
  box.innerHTML=''; yt.style.display='none';
  const url=step.videoUrl||'';
  if(/\.(mp4|webm|ogg)(\?|#|$)/i.test(url)){
    box.innerHTML=`<video src="${url}" controls playsinline preload="metadata"></video>`;
  } else if(ytId(url)){
    box.innerHTML=`<iframe src="https://www.youtube-nocookie.com/embed/${ytId(url)}?rel=0&modestbranding=1"
      title="${step.title||'Tutorial video'}" loading="lazy" allowfullscreen
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe>`;
    yt.href=url; yt.style.display='inline';
  } else if(step.imageUrl){
    box.innerHTML=`<img class="abx-imgbg" src="${step.imageUrl}" alt="" aria-hidden="true">
      <img src="${step.imageUrl}" alt="${step.cap||step.title||''}">
      <div class="abx-halftone"></div>`;
  } else {
    box.innerHTML=`<div class="abx-slot"><span class="abx-play">▶</span>
      Video slot — set this step\u2019s <b>videoUrl</b> to a<br>YouTube link or .mp4 to show it here.</div>`;
  }
  cap.textContent = step.cap || step.title || '';
}

/* ------------------------- speaker portrait ------------------------- */
/* An uploaded photo (lesson.guideImage) is drawn cover-fit into the square
   frame; with none — or if it fails to load — we fall back to the built-in
   hooded Archivist that this engine has always drawn. */
function paintSpeaker(cv, src){
  if(!src){ paintArchivist(cv); return }
  const c=cv.getContext('2d'), w=cv.width, h=cv.height;
  const img=new Image();
  img.onload=()=>{
    try{
      c.clearRect(0,0,w,h);
      c.fillStyle='#0a0722'; c.fillRect(0,0,w,h);
      const s=Math.max(w/img.width, h/img.height);      // cover
      const dw=img.width*s, dh=img.height*s;
      c.drawImage(img, (w-dw)/2, (h-dh)/2, dw, dh);
    }catch(e){ paintArchivist(cv) }
  };
  img.onerror=()=>paintArchivist(cv);
  try{ img.src=src }catch(e){ paintArchivist(cv) }
}
function paintArchivist(cv){
  const c=cv.getContext('2d'), w=cv.width, h=cv.height;
  const grad=(x,y,r,st)=>{ const g=c.createRadialGradient(x,y,0,x,y,r);
    st.forEach(([o,col])=>g.addColorStop(o,col)); return g };
  c.fillStyle='#0a0722'; c.fillRect(0,0,w,h);
  c.fillStyle=grad(w*.5,h*.34,w*.75,[[0,'rgba(236,202,111,.5)'],[.5,'rgba(120,90,40,.2)'],[1,'transparent']]);
  c.fillRect(0,0,w,h);
  c.fillStyle='#0b0e1c';
  c.beginPath(); c.moveTo(w*.16,h); c.quadraticCurveTo(w*.12,h*.4,w*.5,h*.26);
  c.quadraticCurveTo(w*.88,h*.4,w*.84,h); c.closePath(); c.fill();
  c.strokeStyle='rgba(236,202,111,.6)'; c.lineWidth=2.5; c.stroke();
  c.fillStyle='#05060d';
  c.beginPath(); c.ellipse(w/2,h*.52,w*.16,h*.18,0,0,7); c.fill();
  c.fillStyle='#ecca6f';
  c.beginPath(); c.arc(w*.45,h*.5,4,0,7); c.fill();
  c.beginPath(); c.arc(w*.55,h*.5,4,0,7); c.fill();
  c.fillStyle='#d8def2';
  c.beginPath(); c.moveTo(w*.34,h*.82); c.quadraticCurveTo(w*.5,h*.74,w*.66,h*.82);
  c.lineTo(w*.66,h*.94); c.quadraticCurveTo(w*.5,h*.86,w*.34,h*.94); c.closePath(); c.fill();
  c.strokeStyle='#8a7135'; c.lineWidth=2; c.stroke();
}

/* ----------------------------- overlay ------------------------------ */
function buildOverlay(){
  injectCSS();
  const ov=document.createElement('div');
  ov.className='abx-overlay';
  ov.innerHTML=`
  <svg class="abx-burst" viewBox="0 0 100 100" preserveAspectRatio="none">
    <g stroke="rgba(236,202,111,.55)" stroke-width=".35">
      ${[0,25,50,75,100].map(x=>`<line x1="50" y1="50" x2="${x}" y2="0"/>`).join('')}
      ${[33,66,100].map(y=>`<line x1="50" y1="50" x2="100" y2="${y}"/>`).join('')}
      ${[66,33,0].map(x=>`<line x1="50" y1="50" x2="${x}" y2="100"/>`).join('')}
      ${[66,33].map(y=>`<line x1="50" y1="50" x2="0" y2="${y}"/>`).join('')}
    </g></svg>
  <button class="abx-close">Close ✕</button>
  <div class="abx-frame abx-media"><i class="abx-c"></i><i class="abx-c"></i><i class="abx-c"></i><i class="abx-c"></i>
    <div class="abx-mediabox"></div>
    <div class="abx-cap"><span class="abx-captext"></span>
      <a class="abx-yt" href="#" target="_blank" rel="noopener" style="display:none">Watch on YouTube ↗</a></div>
  </div>
  <div class="abx-frame abx-guide"><i class="abx-c"></i><i class="abx-c"></i><i class="abx-c"></i><i class="abx-c"></i>
    <div class="abx-grid">
      <div class="abx-portrait"><canvas width="256" height="256"></canvas></div>
      <div>
        <div class="abx-row">
          <span class="abx-name"></span>
          <span class="abx-tag"></span>
          <button class="abx-voice abx-idle" title="Replay narration">
            <span class="abx-eq"><b></b><b></b><b></b></span> Voice</button>
        </div>
        <div class="abx-steptitle"></div>
        <div class="abx-text"><span class="abx-tx"></span><span class="abx-cursor"></span></div>
        <div class="abx-footer">
          <div class="abx-pips"></div>
          <div class="abx-btns">
            <button class="abx-btn abx-b-skip abx-back">‹ Back</button>
            <button class="abx-btn abx-b-gold abx-next">Next ✦</button>
          </div>
        </div>
      </div>
    </div>
  </div>`;
  document.body.appendChild(ov);
  const q=s=>ov.querySelector(s);
  return { ov, burst:q('.abx-burst'), mediaBox:q('.abx-mediabox'),
    capText:q('.abx-captext'), ytLink:q('.abx-yt'),
    portrait:q('.abx-portrait canvas'), name:q('.abx-name'), tag:q('.abx-tag'),
    voiceChip:q('.abx-voice'), stepTitle:q('.abx-steptitle'),
    tx:q('.abx-tx'), cursor:q('.abx-cursor'), pips:q('.abx-pips'),
    back:q('.abx-back'), next:q('.abx-next'), close:q('.abx-close') };
}

/* ---------------------------- typewriter ---------------------------- */
function typeInto(target, raw, done){
  /* Tokens: {ch} a character · {br} a line break · {sep} a section divider.
     Long lessons were previously rendered as ONE run-on block — authored
     newlines collapsed (HTML folds whitespace) and a `---` separator line
     printed literally as "---", so the text ran off the panel. Both are real
     structure now, and .abx-text scrolls (see CSS). */
  const parts=[]; let em=false,i=0;
  while(i<raw.length){
    if(raw.startsWith('**',i)){ em=!em; i+=2; continue }
    // A line that is just dashes = a section rule (--- or longer).
    if(raw[i]==='-'&&/^-{3,}/.test(raw.slice(i))){
      const before=raw.slice(0,i), after=raw.slice(i).replace(/^-{3,}/,'');
      const atLineStart=/(^|\n)[ \t]*$/.test(before);
      const toLineEnd=/^[ \t]*(\n|$)/.test(after);
      // Also accept the inline " --- " form authors actually type.
      const spaced=/\s$/.test(before)&&/^\s/.test(after);
      if(atLineStart&&toLineEnd||spaced){
        parts.push({sep:true});
        i=raw.length-after.length;
        while(raw[i]===' '||raw[i]==='\t'||raw[i]==='\n') i++;   // eat trailing blank space
        continue;
      }
    }
    if(raw[i]==='\n'){
      let n=0; while(raw[i+n]==='\n') n++;
      parts.push({br:true,double:n>1});
      i+=n; continue;
    }
    parts.push({ch:raw[i],em}); i++;
  }
  target.innerHTML=''; S.cursor.style.display='inline-block'; S.typing=true;
  let span=null,last=null,k=0,alive=true;
  // Keep the newest line in view while long text types itself out.
  const follow=()=>{ try{ const b=target.closest('.abx-text')||target.parentElement;
    if(b&&b.scrollHeight>b.clientHeight) b.scrollTop=b.scrollHeight }catch(e){} };
  const emit=(p)=>{
    if(p.sep){ const hr=document.createElement('div'); hr.className='abx-sep'; target.appendChild(hr); span=null; last=null; return }
    if(p.br){ target.appendChild(document.createElement('br'));
      if(p.double) target.appendChild(document.createElement('br'));
      span=null; last=null; return }
    if(p.em!==last||!span){ span=document.createElement('span');
      if(p.em) span.className='abx-em'; target.appendChild(span); last=p.em }
    span.append(p.ch);
  };
  S.cancelType=()=>{ alive=false; target.innerHTML=''; span=null; last=null;
    for(const p of parts) emit(p);
    S.typing=false; S.cursor.style.display='none'; follow(); done&&done() };
  const step=()=>{
    if(!alive||!S) return;
    if(k>=parts.length){ S.typing=false; S.cursor.style.display='none'; done&&done(); return }
    const p=parts[k++];
    emit(p);
    follow();
    /* No per-character typing tick — it talked over the uploaded voice-over.
       Only the step's own audio plays now. */
    const pause=p.sep?260:p.br?(p.double?220:120)
      :('.!?…'.includes(p.ch)?240 : ','===p.ch?110 : 16+Math.random()*20);
    setTimeout(step,pause/CFG.typeSpeed);
  };
  step();
}

/* ----------------------------- session ------------------------------ */
function renderStep(){
  const l=S.lesson, s=l.steps[S.step], n=l.steps.length;
  renderMedia(s);
  Voice.play(s);
  S.name.textContent = l.guideName||CFG.guideName;
  S.tag.textContent  = l.guideTag ||CFG.guideTag;
  S.stepTitle.textContent = `${l.name} — ${s.title||''}`;
  S.pips.innerHTML = l.steps.map((_,i)=>
    `<span class="${i<=S.step?'abx-on':''}"></span>`).join('')+
    `<span class="abx-steplbl">Step ${S.step+1} / ${n}</span>`;
  S.back.style.visibility = S.step===0?'hidden':'visible';
  S.next.textContent = S.step===n-1?'Got It ✓':'Next ✦';
  typeInto(S.tx, s.text||'');
}
function slam(){
  S.ov.classList.remove('abx-shake'); void S.ov.offsetWidth;
  S.ov.classList.add('abx-shake');
  S.burst.classList.remove('abx-go'); void S.burst.offsetWidth;
  S.burst.classList.add('abx-go');
  Sfx.hit(1);
}
function next(){
  if(S.typing){ S.cancelType(); return }
  if(S.step < S.lesson.steps.length-1){ S.step++; Sfx.hit(.3); renderStep(); return }
  markSeen(S.id); Sfx.chime();
  const cb=S.onDone; close(); cb&&cb();
}
function back(){
  if(S.typing){ S.cancelType(); return }
  if(S.step>0){ S.step--; Sfx.blip(); renderStep() }
}
function onKey(e){
  if(!S) return;
  if(e.code==='Space'||e.code==='Enter'||e.code==='ArrowRight'){ e.preventDefault(); next() }
  else if(e.code==='ArrowLeft'){ e.preventDefault(); back() }
  else if(e.code==='Escape'){ e.preventDefault(); markSeen(S.id); close() }
}
function open(id, opts={}){
  const lesson=LESSONS[id];
  if(!lesson){ console.warn('[AbraxasTutorial] no lesson registered for:',id); return false }
  close();
  Sfx.boot();
  const ui=buildOverlay();
  S=Object.assign({ id, lesson, step:opts.step||0, typing:false, preview:!!opts.preview,
    cancelType:null, onDone:opts.onDone||null }, ui);
  paintSpeaker(S.portrait, lesson.guideImage);
  S.next.onclick=next; S.back.onclick=back;
  S.close.onclick=()=>{ markSeen(id); close() };
  S.voiceChip.onclick=()=>Voice.replay();
  addEventListener('keydown', onKey, true);
  requestAnimationFrame(()=>S.ov.classList.add('abx-on'));
  slam();
  renderStep();
  return true;
}
function close(){
  if(!S) return;
  Voice.stop();
  removeEventListener('keydown', onKey, true);
  const ov=S.ov; S=null;
  ov.classList.remove('abx-on');
  setTimeout(()=>ov.remove(), 320);
}

/* --------------------------- page button ---------------------------- */
function syncBadges(id){
  (buttons[id]||[]).forEach(b=>b.classList.toggle('abx-seen', isSeen(id)));
}
function button(target, id, label='Tutorial'){
  injectCSS();
  const host = typeof target==='string' ? document.querySelector(target) : target;
  if(!host){ console.warn('[AbraxasTutorial] button target not found:',target); return null }
  const b=document.createElement('button');
  b.className='abx-tutbtn'+(isSeen(id)?' abx-seen':'');
  b.innerHTML=`✦ ${label} <span class="abx-new"></span>`;
  b.onclick=()=>open(id);
  host.appendChild(b);
  (buttons[id]=buttons[id]||[]).push(b);
  return b;
}

/* ------------------------------ export ------------------------------ */
global.AbraxasTutorial={
  config(o){ Object.assign(CFG,o||{}); return this },
  register(idOrMap, lesson){
    if(typeof idOrMap==='object'){ Object.assign(LESSONS, idOrMap) }
    else LESSONS[idOrMap]=lesson;
    Object.keys(buttons).forEach(syncBadges);
    return this },
  open, close, button,
  openOnce(id, opts){ return isSeen(id) ? false : open(id, opts) },
  isSeen, markSeen,
  reset(id){ if(CFG.persistence) return console.warn('[AbraxasTutorial] reset your own save data');
    id ? seenMem.delete(id) : seenMem.clear();
    Object.keys(buttons).forEach(syncBadges) },
  lessons: LESSONS
};
})(window);
