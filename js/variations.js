/* =====================================================================
   variations.js  -  flam3 / Apophysis variation library
   ---------------------------------------------------------------------
   Each entry supplies a GLSL snippet that assigns the vec2 `v`.
   Symbols available inside a snippet:
      p       vec2   point after the affine transform
      r       float  length(p)
      r2      float  dot(p,p)
      theta   float  atan(p.x, p.y)      (flam3 convention)
      phi     float  atan(p.y, p.x)
      vw      float  weight of this variation
      A B C D E F    affine coefficients (x' = A x + B y + C, y' = D x + E y + F)
      P0..P5  float  variation parameters
      rnd()   float  uniform [0,1)
      PI, EPS
   The snippet must produce the FULL contribution (weight included).
   ===================================================================== */
(function (global) {
  'use strict';

  var V = [];
  function v(name, params, glsl, tags) {
    V.push({ id: V.length, name: name, params: params || [], glsl: glsl, tags: tags || '' });
  }
  // param helper
  function P(name, def, min, max) { return { name: name, def: def, min: min, max: max }; }

  /* ---- 0 .. 20 : the classic set ---- */
  v('linear', [], 'v = vw * p;', 'basic');
  v('sinusoidal', [], 'v = vw * sin(p);', 'basic');
  v('spherical', [], 'v = (vw / (r2 + EPS)) * p;', 'basic');
  v('swirl', [], 'float s=sin(r2), c=cos(r2); v = vw * vec2(s*p.x - c*p.y, c*p.x + s*p.y);', 'basic');
  v('horseshoe', [], 'float ir = vw/(r+EPS); v = ir * vec2((p.x-p.y)*(p.x+p.y), 2.0*p.x*p.y);', 'basic');
  v('polar', [], 'v = vw * vec2(theta/PI, r - 1.0);', 'basic');
  v('handkerchief', [], 'v = vw * r * vec2(sin(theta+r), cos(theta-r));', 'basic');
  v('heart', [], 'v = vw * r * vec2(sin(theta*r), -cos(theta*r));', 'basic');
  v('disc', [], 'float a = theta/PI; v = vw * a * vec2(sin(PI*r), cos(PI*r));', 'basic');
  v('spiral', [], 'float ir=vw/(r+EPS); v = ir * vec2(cos(theta)+sin(r), sin(theta)-cos(r));', 'basic');
  v('hyperbolic', [], 'v = vw * vec2(sin(theta)/(r+EPS), cos(theta)*r);', 'basic');
  v('diamond', [], 'v = vw * vec2(sin(theta)*cos(r), cos(theta)*sin(r));', 'basic');
  v('ex', [], 'float n0=sin(theta+r), n1=cos(theta-r); float m0=n0*n0*n0*r, m1=n1*n1*n1*r; v = vw*vec2(m0+m1, m0-m1);', 'basic');
  v('julia', [], 'float a = theta*0.5 + (rnd()<0.5 ? 0.0 : PI); float sr=sqrt(r); v = vw*sr*vec2(cos(a), sin(a));', 'basic');
  v('bent', [], 'vec2 q=p; if(q.x<0.0) q.x*=2.0; if(q.y<0.0) q.y*=0.5; v = vw*q;', 'basic');
  v('waves', [], 'float dx=C*C+EPS, dy=F*F+EPS; v = vw*vec2(p.x + B*sin(p.y/dx), p.y + E*sin(p.x/dy));', 'affine');
  v('fisheye', [], 'float ir = vw*2.0/(r+1.0); v = ir*vec2(p.y, p.x);', 'basic');
  v('popcorn', [], 'v = vw*vec2(p.x + C*sin(tan(3.0*p.y)), p.y + F*sin(tan(3.0*p.x)));', 'affine');
  v('exponential', [], 'float dx=exp(p.x-1.0), dy=PI*p.y; v = vw*dx*vec2(cos(dy), sin(dy));', 'basic');
  v('power', [], 'float st=sin(theta), ct=cos(theta); float pw=pow(max(r,EPS), st); v = vw*pw*vec2(ct, st);', 'basic');
  v('cosine', [], 'v = vw*vec2(cos(PI*p.x)*cosh(p.y), -sin(PI*p.x)*sinh(p.y));', 'basic');

  /* ---- 21 .. 48 : parameterised classics ---- */
  v('rings', [], 'float dx=C*C+EPS; float rr = mod(r+dx, 2.0*dx) - dx + r*(1.0-dx); v = vw*rr*vec2(cos(theta), sin(theta));', 'affine');
  v('fan', [], 'float dx=PI*(C*C+EPS); float dy=F; float dx2=0.5*dx; float a = (mod(theta+dy, dx) > dx2) ? theta-dx2 : theta+dx2; v = vw*r*vec2(cos(a), sin(a));', 'affine');
  v('blob', [P('low', 0.2, -2, 2), P('high', 1.2, -2, 2), P('waves', 4, -10, 10)],
    'float rr = r*(P0 + (P1-P0)*0.5*(sin(P2*theta)+1.0)); v = vw*rr*vec2(sin(theta), cos(theta));');
  v('pdj', [P('a', 1.5, -4, 4), P('b', -2.0, -4, 4), P('c', 1.0, -4, 4), P('d', -1.5, -4, 4)],
    'v = vw*vec2(sin(P0*p.y) - cos(P1*p.x), sin(P2*p.x) - cos(P3*p.y));');
  v('fan2', [P('x', 0.5, -2, 2), P('y', 1.2, -2, 2)],
    'float dx=PI*(P0*P0+EPS), dx2=0.5*dx; float t = theta + P1 - dx*floor((theta+P1)/dx); float a = (t>dx2) ? theta-dx2 : theta+dx2; v = vw*r*vec2(sin(a), cos(a));');
  v('rings2', [P('val', 0.6, -2, 2)],
    'float dx=P0*P0+EPS; float rr = r - 2.0*dx*floor((r+dx)/(2.0*dx)) + r*(1.0-dx); v = vw*rr*vec2(sin(theta), cos(theta));');
  v('eyefish', [], 'v = (vw*2.0/(r+1.0))*p;', 'basic');
  v('bubble', [], 'v = (vw*4.0/(r2+4.0))*p;', 'basic');
  v('cylinder', [], 'v = vw*vec2(sin(p.x), p.y);', 'basic');
  v('perspective', [P('angle', 0.62, 0, 1), P('dist', 1.5, -5, 5)],
    'float ang=P0*PI*0.5; float vs=sin(ang), vfc=P1*cos(ang); float den=P1 - p.y*vs; float t = vw/((abs(den)<EPS?EPS:den)); v = t*vec2(P1*p.x, vfc*p.y);');
  v('noise', [], 'float rr=rnd(); float a=rnd()*2.0*PI; v = vw*rr*vec2(cos(a)*p.x, sin(a)*p.y);', 'random');
  v('julian', [P('power', 2, -10, 10), P('dist', 1, -4, 4)],
    'float pw = (abs(P0)<0.5)?1.0:P0; float t = floor(abs(pw)*rnd()); float a=(phi + 2.0*PI*t)/pw; float rr = pow(max(r,EPS), P1/pw); v = vw*rr*vec2(cos(a), sin(a));', 'random');
  v('juliascope', [P('power', 3, -10, 10), P('dist', 1, -4, 4)],
    'float pw = (abs(P0)<0.5)?1.0:P0; float t = floor(abs(pw)*rnd()); float a; if(mod(t,2.0)<0.5) a=(2.0*PI*t + phi)/pw; else a=(2.0*PI*t - phi)/pw; float rr=pow(max(r,EPS), P1/pw); v = vw*rr*vec2(cos(a), sin(a));', 'random');
  v('blur', [], 'float rr=vw*rnd(); float a=rnd()*2.0*PI; v = rr*vec2(cos(a), sin(a));', 'random');
  v('gaussian_blur', [], 'float rr=vw*(rnd()+rnd()+rnd()+rnd()-2.0); float a=rnd()*2.0*PI; v = rr*vec2(cos(a), sin(a));', 'random');
  v('radial_blur', [P('angle', 0.5, -1, 1)],
    'float ang=P0*PI*0.5; float spin=vw*sin(ang), zm=vw*cos(ang); float rg=(rnd()+rnd()+rnd()+rnd()-2.0); float a=phi+spin*rg; float rz=zm*rg-1.0; v = vec2(r*cos(a)+rz*p.x, r*sin(a)+rz*p.y);', 'random');
  v('pie', [P('slices', 6, 1, 32), P('rotation', 0, -PIC(), PIC()), P('thickness', 0.5, 0, 1)],
    'float sl=max(P0,1.0); float t=floor(rnd()*sl+0.5); float a=P1 + 2.0*PI*(t + rnd()*P2)/sl; float rr=vw*rnd(); v = rr*vec2(cos(a), sin(a));', 'random');
  v('ngon', [P('power', 3, -5, 5), P('sides', 5, 1, 16), P('corners', 2, -5, 5), P('circle', 1, -5, 5)],
    'float sides=max(P1,1.0); float rf=2.0*PI/sides; float rfac=pow(max(r,EPS), P0)+EPS; float th=phi; float b=th - rf*floor(th/rf); if(b>rf*0.5) b-=rf; float amp=(P2*(1.0/(cos(b)+EPS) - 1.0) + P3)/rfac; v = vw*amp*p;');
  v('curl', [P('c1', 0.2, -3, 3), P('c2', 0.1, -3, 3)],
    'float re=1.0+P0*p.x+P1*(p.x*p.x-p.y*p.y); float im=P0*p.y+2.0*P1*p.x*p.y; float dd=vw/(re*re+im*im+EPS); v = dd*vec2(p.x*re+p.y*im, p.y*re-p.x*im);');
  v('rectangles', [P('x', 0.6, -3, 3), P('y', 0.6, -3, 3)],
    'float x = (abs(P0)<EPS)? p.x : (2.0*floor(p.x/P0)+1.0)*P0 - p.x; float y = (abs(P1)<EPS)? p.y : (2.0*floor(p.y/P1)+1.0)*P1 - p.y; v = vw*vec2(x,y);');
  v('arch', [], 'float a=rnd()*vw*PI; float sa=sin(a), ca=cos(a); v = vw*vec2(sa, sa*sa/(abs(ca)<EPS?EPS:ca));', 'random');
  v('tangent', [], 'float cy=cos(p.y); v = vw*vec2(sin(p.x)/(abs(cy)<EPS?EPS:cy), tan(p.y));', 'basic');
  v('square', [], 'v = vw*vec2(rnd()-0.5, rnd()-0.5);', 'random');
  v('rays', [], 'float a=vw*rnd()*PI; float rr=vw/(r2+EPS); float tr=tan(a)*rr; v = tr*vec2(cos(p.x), sin(p.y));', 'random');
  v('blade', [], 'float rr=rnd()*vw*r; float sb=sin(rr), cb=cos(rr); v = vw*p.x*vec2(cb+sb, cb-sb);', 'random');
  v('secant2', [], 'float cr=cos(vw*r); float ic=1.0/((abs(cr)<EPS?EPS:cr)); float yy=(cr<0.0)?(ic+1.0):(ic-1.0); v = vec2(vw*p.x, vw*yy);');
  v('twintrian', [], 'float rr=rnd()*vw*r; float sb=sin(rr), cb=cos(rr); float l2=sb*sb; float dd=(l2<1e-20)?-30.0:(log(l2)*0.43429448 + cb); v = vw*p.x*vec2(dd, dd - sb*PI);', 'random');
  v('cross', [], 'float ss=p.x*p.x-p.y*p.y; float dd=vw*sqrt(1.0/(ss*ss+EPS)); v = dd*p;', 'basic');

  /* ---- 49+ : extended set ---- */
  v('disc2', [P('rot', 0.3, -3, 3), P('twist', 0.5, -3, 3)],
    'float rotp=P0*PI; float add=P1; float sa=sin(add), ca=cos(add)-1.0; float t=rotp*(p.x+p.y); float sr=sin(t), cr=cos(t); float rr=vw*theta/PI; v = vec2((sr*ca + cr*sa)*rr, (cr*ca - sr*sa)*rr);');
  v('flower', [P('petals', 6, -12, 12), P('holes', 0.3, -2, 2)],
    'float rr=(rnd()-P1)*cos(P0*phi); float dd=vw*rr/(r+EPS); v = dd*p;', 'random');
  v('conic', [P('holes', 0.3, -2, 2), P('eccentricity', 1.0, -3, 3)],
    'float ct=p.x/(r+EPS); float dd=vw*(rnd()-P0)*P1/(1.0+P1*ct+EPS)/(r+EPS); v = dd*p;', 'random');
  v('parabola', [P('height', 0.5, -3, 3), P('width', 0.5, -3, 3)],
    'float sr=sin(r), cr=cos(r); v = vec2(P0*vw*sr*sr*rnd(), P1*vw*cr*rnd());', 'random');
  v('bent2', [P('x', 1.3, -3, 3), P('y', 0.6, -3, 3)],
    'vec2 q=p; if(q.x<0.0) q.x*=P0; if(q.y<0.0) q.y*=P1; v = vw*q;');
  v('bipolar', [P('shift', 0.0, -2, 2)],
    'float x2=2.0*p.x; float ps=-PI*0.5*P0; float yy=0.5*atan(2.0*p.y, r2-1.0)+ps; if(yy>PI*0.5) yy-=PI; else if(yy<-PI*0.5) yy+=PI; float f2=r2+1.0; float g=f2-x2; if(g<EPS) v=vec2(0.0); else v = vw*vec2(0.25*2.0/PI*log((f2+x2)/g), 2.0/PI*yy);');
  v('boarders', [],
    'float rx=floor(p.x+0.5), ry=floor(p.y+0.5); float ox=p.x-rx, oy=p.y-ry; if(rnd()>=0.75){ v=vw*vec2(rx+ox*0.5, ry+oy*0.5); } else { if(abs(ox)>=abs(oy)){ float s=sign(ox); if(s==0.0) s=1.0; v=vw*vec2(rx+0.5*ox+0.25*s, ry+0.5*oy+0.25*oy/(abs(ox)<EPS?EPS*s:ox)); } else { float s=sign(oy); if(s==0.0) s=1.0; v=vw*vec2(rx+0.5*ox+0.25*ox/(abs(oy)<EPS?EPS*s:oy), ry+0.5*oy+0.25*s); } }', 'random');
  v('butterfly', [],
    'float wx=vw*1.30294003; float y2=p.y*2.0; float ss=sqrt(abs(p.x*p.y)/(EPS+p.x*p.x+y2*y2)); v = wx*ss*vec2(p.x, y2);');
  v('cell', [P('size', 0.6, 0.05, 4)],
    'float sz=(abs(P0)<EPS)?1.0:P0; float ix=floor(p.x/sz), iy=floor(p.y/sz); float dx=p.x-ix*sz, dy=p.y-iy*sz; if(iy>=0.0){ if(ix>=0.0){iy*=2.0; ix*=2.0;} else {iy*=2.0; ix=-(2.0*ix+1.0);} } else { if(ix>=0.0){iy=-(2.0*iy+1.0); ix*=2.0;} else {iy=-(2.0*iy+1.0); ix=-(2.0*ix+1.0);} } v = vw*vec2(dx+ix*sz, -(dy+iy*sz));');
  v('cpow', [P('r', 1.0, -3, 3), P('i', 0.1, -3, 3), P('power', 2.0, -6, 6)],
    'float pw=(abs(P2)<EPS)?1.0:P2; float lnr=0.5*log(r2+EPS); float va=2.0*PI/pw; float vc=P0/pw, vd=P1/pw; float ang=vc*phi + vd*lnr + va*floor(pw*rnd()); float m=vw*exp(vc*lnr - vd*phi); v = m*vec2(cos(ang), sin(ang));', 'random');
  v('curve', [P('xamp', 0.5, -3, 3), P('yamp', 0.5, -3, 3), P('xlen', 1.0, 0.05, 4), P('ylen', 1.0, 0.05, 4)],
    'float px=max(P2*P2,1e-6), py=max(P3*P3,1e-6); v = vw*vec2(p.x + P0*exp(-p.y*p.y/px), p.y + P1*exp(-p.x*p.x/py));');
  v('edisc', [],
    'float t=r2+1.0, x2=2.0*p.x; float a1=sqrt(max(t+x2,0.0)), b1=sqrt(max(t-x2,0.0)); float xmax=max((a1+b1)*0.5, 1.0); float lg=log(xmax+sqrt(max(xmax*xmax-1.0,0.0))); float ac=-acos(clamp(p.x/xmax,-1.0,1.0)); float w=vw/11.57034632; float snv=sin(lg), csv=cos(lg); if(p.y>0.0) snv=-snv; v = w*vec2(cosh(ac)*csv, sinh(ac)*snv);');
  v('elliptic', [],
    'float t=r2+1.0, x2=2.0*p.x; float xmax=0.5*(sqrt(max(t+x2,0.0))+sqrt(max(t-x2,0.0))); float a=p.x/max(xmax,EPS); float b=1.0-a*a; float ssx=xmax-1.0; float w=vw/(PI*0.5); b=(b<0.0)?0.0:sqrt(b); ssx=(ssx<0.0)?0.0:sqrt(ssx); float yy=w*log(xmax+ssx); v = vec2(w*atan(a,b), (p.y>0.0)?yy:-yy);');
  v('escher', [P('beta', 0.3, -PIC(), PIC())],
    'float lnr=0.5*log(r2+EPS); float c2=0.5*(1.0+cos(P0)), d2=0.5*sin(P0); float m=vw*exp(c2*lnr - d2*phi); float n=c2*phi + d2*lnr; v = m*vec2(cos(n), sin(n));');
  v('foci', [],
    'float ex=exp(clamp(p.x,-20.0,20.0)); float tmp=0.5*(ex+1.0/ex) - cos(p.y); tmp=vw/max(tmp,EPS); v = vec2(0.5*(ex-1.0/ex)*tmp, sin(p.y)*tmp);');
  v('lazysusan', [P('spin', 0.6, -PIC(), PIC()), P('twist', 0.3, -3, 3), P('space', 0.4, -3, 3), P('x', 0.0, -2, 2), P('y', 0.0, -2, 2)],
    'float x=p.x-P3, y=p.y+P4; float rr=sqrt(x*x+y*y); if(rr<vw){ float a=atan(y,x)+P0+P1*(vw-rr); float rw=vw*rr; v=vec2(rw*cos(a)+P3, rw*sin(a)-P4); } else { float rw=vw*(1.0+P2/(rr+EPS)); v=vec2(rw*x+P3, rw*y-P4); }');
  v('loonie', [],
    'float w2=vw*vw; if(r2<w2 && r2>EPS){ float ff=sqrt(w2/r2-1.0); v=ff*vw*p; } else v=vw*p;');
  v('modulus', [P('x', 0.6, 0.05, 3), P('y', 0.6, 0.05, 3)],
    'float xr=2.0*P0, yr=2.0*P1; float x,y; if(p.x>P0) x=-P0+mod(p.x+P0,xr); else if(p.x<-P0) x=P0-mod(P0-p.x,xr); else x=p.x; if(p.y>P1) y=-P1+mod(p.y+P1,yr); else if(p.y<-P1) y=P1-mod(P1-p.y,yr); else y=p.y; v = vw*vec2(x,y);');
  v('oscilloscope', [P('separation', 0.6, -3, 3), P('frequency', 3.0, -20, 20), P('amplitude', 1.0, -3, 3), P('damping', 0.0, 0, 4)],
    'float t; if(P3==0.0) t=P2*cos(P1*p.x)+P0; else t=P2*exp(-abs(p.x)*P3)*cos(P1*p.x)+P0; v = (abs(p.y)<=t) ? vw*vec2(p.x,-p.y) : vw*p;');
  v('polar2', [], 'float pv=vw/PI; v = vec2(pv*theta, pv*0.5*log(r2+EPS));');
  v('popcorn2', [P('x', 0.1, -2, 2), P('y', 0.1, -2, 2), P('c', 3.0, -6, 6)],
    'v = vw*vec2(p.x + P0*sin(tan(p.y*P2)), p.y + P1*sin(tan(p.x*P2)));');
  v('scry', [], 'float t=r2; float dd=1.0/(r*(t + 1.0/(vw+EPS)) + EPS); v = dd*p;');
  v('separation', [P('x', 0.5, -3, 3), P('xinside', 0.2, -3, 3), P('y', 0.5, -3, 3), P('yinside', 0.2, -3, 3)],
    'float sx=P0*P0, sy=P2*P2; float x = (p.x>0.0)? vw*(sqrt(p.x*p.x+sx)-p.x*P1) : -vw*(sqrt(p.x*p.x+sx)+p.x*P1); float y = (p.y>0.0)? vw*(sqrt(p.y*p.y+sy)-p.y*P3) : -vw*(sqrt(p.y*p.y+sy)+p.y*P3); v = vec2(x,y);');
  v('split', [P('xsize', 0.5, -3, 3), P('ysize', 0.5, -3, 3)],
    'float x = (cos(p.y*P1*PI)>=0.0)? vw*p.x : -vw*p.x; float y = (cos(p.x*P0*PI)>=0.0)? vw*p.y : -vw*p.y; v = vec2(x,y);');
  v('stripes', [P('space', 0.4, 0, 1), P('warp', 0.5, -3, 3)],
    'float rx=floor(p.x+0.5); float ox=p.x-rx; v = vw*vec2(ox*(1.0-P0)+rx, p.y + ox*ox*P1);');
  v('wedge', [P('angle', 0.6, -PIC(), PIC()), P('hole', 0.0, -2, 2), P('count', 3, 1, 16), P('swirl', 0.2, -3, 3)],
    'float cnt=max(P2,1.0); float a=phi + P3*r; float c=floor((cnt*a + PI)/(2.0*PI)); float cf=1.0 - P0*cnt/(2.0*PI); a = a*cf + c*P0; float rr=vw*(r+P1); v = rr*vec2(cos(a), sin(a));');
  v('whorl', [P('inside', 0.4, -3, 3), P('outside', 0.6, -3, 3)],
    'float dn = vw - r; float a = phi + ((r<vw)?P0:P1)/((abs(dn)<EPS)?EPS:dn); v = vw*r*vec2(cos(a), sin(a));');
  v('waves2', [P('freqx', 2.0, -8, 8), P('freqy', 2.0, -8, 8), P('scalex', 0.3, -3, 3), P('scaley', 0.3, -3, 3)],
    'v = vw*vec2(p.x + P2*sin(p.y*P0), p.y + P3*sin(p.x*P1));');
  v('exblur', [P('radius', 0.15, 0, 1)],
    'float rr=P0*(rnd()+rnd()+rnd()+rnd()-2.0)*0.5; float a=rnd()*2.0*PI; v = vw*(p + rr*vec2(cos(a), sin(a)));', 'random');
  v('hypertile', [P('p', 3, 3, 12), P('q', 7, 3, 12), P('n', 0, 0, 8)],
    'float pp=max(P0,3.0), qq=max(P1,3.0); float cph=cos(PI/pp), cqh=cos(PI/qq); float den=max(1.0 - cph*cph - cqh*cqh, 1e-6); float rr=sqrt(max((cph*cph + cqh*cqh - 1.0)/den + 1e-9, 0.0)); float a=2.0*PI*P2/pp; float re=rr*cos(a), im=rr*sin(a); float dx=1.0 + re*p.x - im*p.y; float dy=re*p.y + im*p.x; float dd=vw/max(dx*dx+dy*dy, EPS); v = dd*vec2((p.x+re)*dx + (p.y+im)*dy, (p.y+im)*dx - (p.x+re)*dy);');
  v('crackle', [P('scale', 1.0, 0.1, 4), P('jitter', 0.5, 0, 2)],
    'vec2 cellp = floor(p*P0); float best=1e9; vec2 bo=vec2(0.0); for(int j=-1;j<=1;j++){ for(int i=-1;i<=1;i++){ vec2 g=cellp+vec2(float(i),float(j)); vec2 o=vec2(hash21(g), hash21(g+17.3)); vec2 pt=(g+0.5+ (o-0.5)*P1)/P0; float d=distance(p,pt); if(d<best){best=d; bo=pt;} } } v = vw*(bo + (p-bo)*0.35);');
  v('super_shape', [P('rnd', 0.2, 0, 1), P('m', 5, 0, 12), P('n1', 1.0, -6, 6), P('n2', 1.0, -6, 6), P('n3', 1.0, -6, 6), P('holes', 0.0, -2, 2)],
    'float pm4=P1/4.0, pneg=-1.0/max(P2,1e-3); float th=pm4*theta + PI*0.25; float t1=pow(abs(cos(th)), P3); float t2=pow(abs(sin(th)), P4); float rr=pow(max(t1+t2,1e-6), pneg); float rmix=(P0*rnd() + (1.0-P0)*r) - P5; float dd=vw*rmix*rr/(r+EPS); v = dd*p;', 'random');

  /* -------------------------------------------------------------- */
  function PIC() { return Math.PI; }

  var MAX_PARAMS = 6;

  /* Generate the GLSL dispatch function for all variations.

     r, theta and phi are hoisted into invocation-scope globals rather than
     recomputed per call. Every variation of a transform acts on the SAME
     affine-mapped point -- that is the flame algorithm, and applyXform passes
     the same `q` on every iteration of its loop -- so computing them once per
     transform instead of once per variation removes two atan() and a sqrt()
     for each variation after the first. A transform with three variations was
     doing six atan() where two will do, on the hottest path in the engine.

     The contract: varPrepare(p) must be called before applyVariation with the
     same p. applyXform is the only caller and does exactly that. The locals
     below keep all 81 snippets working verbatim and cost nothing -- the
     compiler renames them. */
  function buildGLSL() {
    var s = '';
    s += 'float vR2, vR, vTheta, vPhi;\n';
    s += 'void varPrepare(vec2 p){\n';
    s += '  vR2 = dot(p,p);\n';
    s += '  vR = sqrt(vR2);\n';
    s += '  vTheta = atan(p.x, p.y);\n';
    s += '  vPhi = atan(p.y, p.x);\n';
    s += '}\n';
    s += 'vec2 applyVariation(int vid, vec2 p, float vw, vec4 aff1, vec2 aff2, float P0, float P1, float P2, float P3, float P4, float P5){\n';
    s += '  vec2 v = vec2(0.0);\n';
    s += '  float A=aff1.x, B=aff1.y, C=aff1.z, D=aff1.w, E=aff2.x, F=aff2.y;\n';
    s += '  float r2 = vR2;\n';
    s += '  float r = vR;\n';
    s += '  float theta = vTheta;\n';
    s += '  float phi = vPhi;\n';
    s += '  switch(vid){\n';
    for (var i = 0; i < V.length; i++) {
      s += '  case ' + i + ': { ' + V[i].glsl + ' break; } // ' + V[i].name + '\n';
    }
    s += '  default: { v = vw*p; break; }\n';
    s += '  }\n';
    s += '  return v;\n';
    s += '}\n';
    return s;
  }

  var byName = {};
  for (var i = 0; i < V.length; i++) byName[V[i].name] = V[i];

  global.FlameVariations = {
    list: V,
    byName: byName,
    count: V.length,
    MAX_PARAMS: MAX_PARAMS,
    buildGLSL: buildGLSL,
    defaults: function (id) {
      var out = [0, 0, 0, 0, 0, 0];
      var vv = V[id];
      if (!vv) return out;
      for (var k = 0; k < vv.params.length && k < MAX_PARAMS; k++) out[k] = vv.params[k].def;
      return out;
    },
    // variations that behave well as the sole/dominant variation of an xform
    tame: ['linear', 'sinusoidal', 'spherical', 'swirl', 'horseshoe', 'polar', 'handkerchief',
      'heart', 'disc', 'spiral', 'hyperbolic', 'diamond', 'ex', 'julia', 'bent', 'waves',
      'fisheye', 'popcorn', 'exponential', 'power', 'cosine', 'rings', 'fan', 'blob', 'pdj',
      'fan2', 'rings2', 'eyefish', 'bubble', 'cylinder', 'noise', 'julian', 'juliascope',
      'ngon', 'curl', 'rectangles', 'arch', 'tangent', 'square', 'rays', 'blade', 'secant2',
      'cross', 'disc2', 'flower', 'conic', 'parabola', 'bent2', 'bipolar', 'butterfly',
      'cell', 'cpow', 'curve', 'edisc', 'elliptic', 'escher', 'foci', 'loonie', 'modulus',
      'oscilloscope', 'polar2', 'popcorn2', 'scry', 'separation', 'split', 'stripes',
      'wedge', 'whorl', 'waves2', 'hypertile', 'super_shape']
  };
})(typeof window !== 'undefined' ? window : globalThis);
