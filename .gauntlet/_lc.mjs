/* local contrast inside a crop: each pixel vs the mean of its 15x15 box */
import sharp from 'sharp';
const [file,X0,Y0,X1,Y1] = process.argv.slice(2);
const x0=+X0,y0=+Y0,x1=+X1,y1=+Y1;
const {data,info} = await sharp(file).raw().toBuffer({resolveWithObject:true});
const W=info.width,C=info.channels;
const val=(x,y)=>{const i=(y*W+x)*C;return Math.max(data[i],data[i+1],data[i+2])/255;};
let n=0,s=0,ss=0,lc=0,lcn=0;
const R=7;
for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const v=val(x,y);n++;s+=v;ss+=v*v;}
const mean=s/n, sd=Math.sqrt(ss/n-mean*mean);
for(let y=y0+R;y<y1-R;y++)for(let x=x0+R;x<x1-R;x++){
  let m=0;for(let j=-R;j<=R;j++)for(let i=-R;i<=R;i++)m+=val(x+i,y+j);
  m/=(2*R+1)*(2*R+1);
  lc+=Math.abs(val(x,y)-m); lcn++;
}
console.log(JSON.stringify({file,crop:[x0,y0,x1,y1],px:n,mean:+mean.toFixed(4),sd:+sd.toFixed(4),localContrast:+(lc/lcn).toFixed(5)}));
