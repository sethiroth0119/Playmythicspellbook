// candidate winMat interior skin — kept identical to what will ship
function _mkSkin(P){
  const W=16,H=32,cv=document.createElement('canvas');cv.width=W;cv.height=H;
  const g=cv.getContext('2d');
  const grd=g.createLinearGradient(0,0,0,H);
  for(const [t,v] of P.stops) grd.addColorStop(t,'rgb('+Math.round(v*255)+','+Math.round(v*255)+','+Math.round(v*255)+')');
  g.fillStyle=grd;g.fillRect(0,0,W,H);
  if(P.blind>0){ g.globalCompositeOperation='lighten';
    const b=Math.round(P.blind*255); g.fillStyle='rgb('+b+','+b+','+b+')';
    g.fillRect(0,0,Math.round(W*P.blindW),H); g.globalCompositeOperation='source-over'; }
  return cv;
}
