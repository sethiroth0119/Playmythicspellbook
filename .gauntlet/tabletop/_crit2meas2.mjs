import sharp from 'sharp';
const boxes={TL:[10,215,130,95],BL:[0,782,180,108],RT:[1470,215,125,95],BR:[1430,790,165,100]};
function med(a){const s=[...a].sort((x,y)=>x-y);return s[s.length>>1];}
async function run(file){
  const out={};
  for(const [n,[x,y,w,h]] of Object.entries(boxes)){
    const {data}=await sharp(file).extract({left:x,top:y,width:w,height:h}).raw().toBuffer({resolveWithObject:true});
    const L=new Float64Array(w*h);
    for(let i=0;i<w*h;i++)L[i]=0.299*data[i*3]+0.587*data[i*3+1]+0.114*data[i*3+2];
    // 5px median to kill rain streaks
    const M=new Float64Array(w*h);
    for(let j=0;j<h;j++)for(let i=0;i<w;i++){const v=[];for(let dj=-2;dj<=2;dj++)for(let di=-2;di<=2;di++){const jj=Math.min(h-1,Math.max(0,j+dj)),ii=Math.min(w-1,Math.max(0,i+di));v.push(L[jj*w+ii]);}M[j*w+i]=med(v);}
    // 8x8 block means of median image
    const bw=Math.floor(w/8),bh=Math.floor(h/8),bm=[];
    for(let by=0;by<bh;by++)for(let bx=0;bx<bw;bx++){let s=0;for(let j=0;j<8;j++)for(let i=0;i<8;i++)s+=M[(by*8+j)*w+bx*8+i];bm.push(s/64);}
    const mb=bm.reduce((a,b)=>a+b,0)/bm.length;
    const rawSd=Math.sqrt(bm.reduce((a,b)=>a+(b-mb)**2,0)/bm.length);
    // least-squares plane fit over block grid -> detrended residual
    let Sx=0,Sy=0,Sxx=0,Syy=0,Sxy=0,Sz=0,Sxz=0,Syz=0,N=bm.length;
    for(let k=0;k<N;k++){const bx=k%bw,by=(k/bw)|0,z=bm[k];Sx+=bx;Sy+=by;Sxx+=bx*bx;Syy+=by*by;Sxy+=bx*by;Sz+=z;Sxz+=bx*z;Syz+=by*z;}
    const A=[[Sxx,Sxy,Sx],[Sxy,Syy,Sy],[Sx,Sy,N]],B=[Sxz,Syz,Sz];
    // gaussian elim
    for(let c=0;c<3;c++){let p=c;for(let r=c+1;r<3;r++)if(Math.abs(A[r][c])>Math.abs(A[p][c]))p=r;[A[c],A[p]]=[A[p],A[c]];[B[c],B[p]]=[B[p],B[c]];for(let r=0;r<3;r++){if(r===c)continue;const f=A[r][c]/A[c][c];for(let cc=c;cc<3;cc++)A[r][cc]-=f*A[c][cc];B[r]-=f*B[c];}}
    const a=B[0]/A[0][0],b=B[1]/A[1][1],c0=B[2]/A[2][2];
    let ss=0,mnr=1e9,mxr=-1e9;
    for(let k=0;k<N;k++){const bx=k%bw,by=(k/bw)|0;const r=bm[k]-(a*bx+b*by+c0);ss+=r*r;if(r<mnr)mnr=r;if(r>mxr)mxr=r;}
    const detSd=Math.sqrt(ss/N);
    // fine grain: mean |M - 3px box blur of M|
    let gsum=0;
    for(let j=0;j<h;j++)for(let i=0;i<w;i++){let s=0,c2=0;for(let dj=-1;dj<=1;dj++)for(let di=-1;di<=1;di++){const jj=j+dj,ii=i+di;if(jj<0||ii<0||jj>=h||ii>=w)continue;s+=M[jj*w+ii];c2++;}gsum+=Math.abs(M[j*w+i]-s/c2);}
    out[n]={blockSd:+rawSd.toFixed(2),detrendSd:+detSd.toFixed(2),detrendSpan:+(mxr-mnr).toFixed(1),fineGrain:+(gsum/(w*h)).toFixed(2)};
  }
  return out;
}
for(const f of process.argv.slice(2)){console.log(f);console.table(await run(f));}
