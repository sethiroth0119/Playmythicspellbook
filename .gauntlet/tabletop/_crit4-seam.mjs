/* CRITIC round 4 — piece spec item (1): "Retire or merge the apron's near-black
   gradient so table and apron are ONE surface." Measure both sides of the seam
   on the left flank of the shipped `basics` frame. */
import sharp from 'sharp';
const f='E:/game-deploy/.gauntlet/tabletop/table-and-shadow-crit4-basics.png';
const {data,info}=await sharp(f).raw().toBuffer({resolveWithObject:true});
const {width:W,channels:C}=info;
const box=(B)=>{let R=0,G=0,Bl=0,n=0;
 for(let y=B[1];y<B[1]+B[3];y++)for(let x=B[0];x<B[0]+B[2];x++){const i=(y*W+x)*C;R+=data[i];G+=data[i+1];Bl+=data[i+2];n++;}
 R/=n;G/=n;Bl/=n;const t=v=>+v.toFixed(2);
 return {R:t(R),G:t(G),B:t(Bl),L:t(0.299*R+0.587*G+0.114*Bl),RmB:t(R-Bl)};};
console.log(JSON.stringify({
  feltOutsideApron: box([60,240,110,70]),     /* left of the kerb */
  apronInside:      box([230,260,110,70]),    /* right of the kerb, bare plate */
  apronNearBoard:   box([300,430,110,60]),
  feltBottomLeft:   box([0,800,110,60]),
},null,1));
