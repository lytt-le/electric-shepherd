/* =====================================================================
   shaders.js  -  GLSL ES 3.00 sources for the flame renderer
   ===================================================================== */
(function (global) {
  'use strict';

  var MAX_XFORMS = 12;
  var MAX_VARS = 8;
  var XTEX_W = 24;   // texels per xform row

  var COMMON = [
    '#version 300 es',
    'precision highp float;',
    'precision highp int;',
    'precision highp sampler2D;',
    'const float PI = 3.141592653589793;',
    'const float EPS = 1e-9;',
    'const int MAXX = ' + MAX_XFORMS + ';',
    'const int MAXV = ' + MAX_VARS + ';',
    'uint rngState = 1u;',
    'uint hashU(uint x){ x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }',
    'float rnd(){ rngState = hashU(rngState); return float(rngState & 0x00ffffffu) / 16777216.0; }',
    'float hash21(vec2 p){ uint h = hashU(uint(int(p.x)*374761393 + int(p.y)*668265263 + 1013904223)); return float(h & 0x00ffffffu)/16777216.0; }',
    ''
  ].join('\n');

  // ---- shared xform sampling helpers -------------------------------
  var XFORM_LIB = [
    'uniform sampler2D uXform;',
    'vec4 xf(int row, int col){ return texelFetch(uXform, ivec2(col, row), 0); }',
    '',
    '// applies xform `row` to point p, returns new point; updates color c',
    'vec2 applyXform(int row, vec2 p, inout float c){',
    '  vec4 t0 = xf(row,0);            // a b c d',
    '  vec4 t1 = xf(row,1);            // e f colorIndex colorSpeed',
    '  vec4 t2 = xf(row,2);            // pa pb pc pd',
    '  vec4 t3 = xf(row,3);            // pe pf opacity usePost',
    '  vec4 t4 = xf(row,4);            // nvars weight - -',
    '  vec2 q = vec2(t0.x*p.x + t0.y*p.y + t0.z, t0.w*p.x + t1.x*p.y + t1.y);',
    '  vec2 acc = vec2(0.0);',
    '  int nv = int(t4.x);',
    '  for(int k=0;k<MAXV;k++){',
    '    if(k>=nv) break;',
    '    vec4 va = xf(row, 5 + k*2);',
    '    vec4 vb = xf(row, 6 + k*2);',
    '    acc += applyVariation(int(va.x), q, va.y, vec4(t0.x,t0.y,t0.z,t0.w), vec2(t1.x,t1.y), va.z, va.w, vb.x, vb.y, vb.z, vb.w);',
    '  }',
    '  if(t3.w > 0.5) acc = vec2(t2.x*acc.x + t2.y*acc.y + t2.z, t2.w*acc.x + t3.x*acc.y + t3.y);',
    '  c = t1.w * t1.z + (1.0 - t1.w) * c;',
    '  return acc;',
    '}',
    ''
  ].join('\n');

  // ---- fullscreen triangle vertex shader ---------------------------
  var VS_QUAD = [
    '#version 300 es',
    'out vec2 vUV;',
    'void main(){',
    '  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);',
    '  vUV = p;',
    '  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);',
    '}'
  ].join('\n');

  // ---- iteration (chaos game) --------------------------------------
  function FS_ITERATE(varGLSL) {
    return [
      COMMON,
      varGLSL,
      XFORM_LIB,
      'uniform sampler2D uState;',
      'uniform sampler2D uXaos;',
      'uniform int uNumXforms;',
      'uniform uint uSeed;',
      'out vec4 outState;',
      'void main(){',
      '  ivec2 ip = ivec2(gl_FragCoord.xy);',
      '  vec4 st = texelFetch(uState, ip, 0);',
      '  rngState = hashU(uint(ip.x)*1973u + uint(ip.y)*9277u + uSeed*26699u + 1u);',
      '  int last = int(clamp(st.w, 0.0, float(MAXX-1)));',
      '  float u = rnd();',
      '  int sel = 0;',
      '  for(int i=0;i<MAXX;i++){',
      '    if(i>=uNumXforms) break;',
      '    sel = i;',
      '    if(u <= texelFetch(uXaos, ivec2(i, last), 0).r) break;',
      '  }',
      '  float c = st.z;',
      '  vec2 p = applyXform(sel, st.xy, c);',
      '  if(any(isnan(p)) || any(isinf(p)) || dot(p,p) > 1e14){',
      '    p = vec2(rnd()*2.0-1.0, rnd()*2.0-1.0);',
      '    c = rnd(); sel = 0;',
      '  }',
      '  c = clamp(c, 0.0, 1.0);',
      '  outState = vec4(p, c, float(sel));',
      '}'
    ].join('\n');
  }

  // ---- accumulation (splat points) ---------------------------------
  function VS_ACCUM(varGLSL) {
    return [
      COMMON,
      varGLSL,
      XFORM_LIB,
      'uniform sampler2D uState;',
      'uniform sampler2D uPalette;',
      'uniform int uPointsW;',
      'uniform vec2 uCenter;',
      'uniform vec2 uScale;',
      'uniform float uRot;',
      'uniform int uSym;',
      'uniform int uSymB;',      // symmetry order being faded IN (morphs only)
      'uniform float uSymMix;',  // 0 = all uSym, 1 = all uSymB
      'uniform float uMirror;',  // probability weight of the mirror copy, 0..1
      'uniform int uHasFinal;',
      'uniform float uJitter;',
      'uniform uint uSeed;',
      'out vec4 vColor;',
      'void main(){',
      '  int vid = gl_VertexID;',
      '  ivec2 ip = ivec2(vid % uPointsW, vid / uPointsW);',
      '  vec4 st = texelFetch(uState, ip, 0);',
      '  rngState = hashU(uint(vid)*2654435761u + uSeed*40503u + 7u);',
      '  vec2 p = st.xy;',
      '  float c = st.z;',
      '  int sel = int(clamp(st.w, 0.0, float(MAXX-1)));',
      '  float op = xf(sel,3).z;',
      '  if(uHasFinal == 1) p = applyXform(MAXX, p, c);',
      // Symmetry copies are chosen per sample, so two different orders can be
      // cross-faded simply by letting each sample pick which ensemble it joins.
      // That is what lets a morph gain or lose symmetry gradually instead of
      // the whole picture changing between one frame and the next.
      // The rnd() calls are guarded so a sheep that is not mid-morph consumes
      // exactly the sample sequence it always did: the grain still repeats.
      '  if(uSym > 1 || uSymB > 1){',
      '    int S = uSym;',
      '    if(uSymMix > 0.0 && rnd() < uSymMix) S = uSymB;',
      '    if(S > 1){',
      '      float k = floor(rnd() * float(S));',
      '      float a = k * 2.0 * PI / float(S);',
      '      float sa = sin(a), ca = cos(a);',
      '      p = vec2(p.x*ca - p.y*sa, p.x*sa + p.y*ca);',
      '    }',
      '  }',
      '  if(uMirror > 0.0 && rnd() < uMirror * 0.5) p.x = -p.x;',
      '  p -= uCenter;',
      '  float cr = cos(uRot), sr = sin(uRot);',
      '  p = vec2(p.x*cr - p.y*sr, p.x*sr + p.y*cr);',
      '  vec2 ndc = p * uScale;',
      '  ndc += (vec2(rnd(), rnd()) - 0.5) * uJitter;',
      '  bool bad = any(isnan(ndc)) || any(isinf(ndc)) || op <= 0.0;',
      '  gl_Position = bad ? vec4(2.0, 2.0, 0.0, 1.0) : vec4(ndc, 0.0, 1.0);',
      '  gl_PointSize = 1.0;',
      '  vec3 col = texture(uPalette, vec2(clamp(c, 0.0, 1.0), 0.5)).rgb;',
      '  vColor = vec4(col, op);',
      '}'
    ].join('\n');
  }

  var FS_ACCUM = [
    '#version 300 es',
    'precision highp float;',
    'in vec4 vColor;',
    'out vec4 outColor;',
    'void main(){ outColor = vec4(vColor.rgb * vColor.a, vColor.a); }'
  ].join('\n');

  // ---- tonemap -----------------------------------------------------
  var FS_TONEMAP = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUV;',
    'uniform sampler2D uAccum;',
    'uniform ivec2 uOutSize;',
    'uniform int uSS;',
    'uniform float uDensityScale;',
    'uniform float uBrightness;',
    'uniform float uInvGamma;',
    'uniform float uGammaThreshold;',
    'uniform float uVibrancy;',
    'uniform float uHighlight;',
    'uniform int uDE;',
    'uniform float uDERadius;',
    'uniform float uDEAlpha;',
    'out vec4 outColor;',
    '',
    'vec4 blockSum(ivec2 base){',
    '  vec4 s = vec4(0.0);',
    '  for(int y=0;y<4;y++){ if(y>=uSS) break;',
    '    for(int x=0;x<4;x++){ if(x>=uSS) break;',
    '      s += texelFetch(uAccum, base + ivec2(x,y), 0); } }',
    '  return s;',
    '}',
    '',
    'float calcAlpha(float d, float ig, float lin){',
    '  if(d <= 0.0) return 0.0;',
    '  if(lin > 0.0 && d < lin){',
    '    float f = d / lin;',
    '    return (1.0-f) * d * (pow(lin, ig)/lin) + f * pow(d, ig);',
    '  }',
    '  return pow(d, ig);',
    '}',
    '',
    'void main(){',
    '  ivec2 px = ivec2(vUV * vec2(uOutSize));',
    '  px = clamp(px, ivec2(0), uOutSize - 1);',
    '  ivec2 base = px * uSS;',
    '  vec4 a = blockSum(base);',
    '  if(uDE == 1){',
    '    float dn0 = a.a * uDensityScale;',
    '    float rad = uDERadius / pow(max(dn0, 1e-4), uDEAlpha);',
    '    rad = clamp(rad, 0.0, uDERadius);',
    '    if(rad > 0.35){',
    '      float R = rad * float(uSS);',
    '      vec4 acc = a * 2.0;',
    '      float wsum = 2.0;',
    '      for(int i=0;i<8;i++){',
    '        float ang = float(i) * (PI2 / 8.0);',
    '        ivec2 off = ivec2(round(vec2(cos(ang), sin(ang)) * R));',
    '        ivec2 b2 = clamp(base + off, ivec2(0), (uOutSize*uSS) - uSS);',
    '        acc += blockSum(b2);',
    '        wsum += 1.0;',
    '      }',
    '      a = acc / wsum;',
    '    }',
    '  }',
    '  float dn = a.a * uDensityScale;',
    '  if(dn <= 0.0){ outColor = vec4(0.0); return; }',
    '  float ls = uBrightness * log(1.0 + dn) / dn;',
    '  vec3 col = a.rgb * uDensityScale * ls;',
    '  float t = dn * ls;',
    '  float alpha = calcAlpha(t, uInvGamma, uGammaThreshold);',
    '  float ratio = (t > 0.0) ? alpha / t : 0.0;',
    '  vec3 vib = uVibrancy * ratio * col;',
    '  vec3 nonvib = (1.0 - uVibrancy) * pow(max(col, vec3(0.0)), vec3(uInvGamma));',
    '  vec3 outc = vib + nonvib;',
    '  if(uHighlight > 0.0){',
    '    float mx = max(outc.r, max(outc.g, outc.b));',
    '    if(mx > 1.0){',
    '      float f = 1.0 / mx;',
    '      float k = pow(f, uHighlight);',
    '      outc = outc * k;',
    '    }',
    '  }',
    '  outColor = vec4(max(outc, vec3(0.0)), clamp(alpha, 0.0, 1.0));',
    '}'
  ].join('\n').replace('in vec2 vUV;', 'in vec2 vUV;\nconst float PI2 = 6.283185307179586;');

  // ---- separable blur (for glow) -----------------------------------
  var FS_BLUR = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUV;',
    'uniform sampler2D uTex;',
    'uniform vec2 uDir;',
    'uniform float uThreshold;',
    'uniform int uPrefilter;',
    'out vec4 outColor;',
    'void main(){',
    '  vec3 s = vec3(0.0);',
    '  float w[5];',
    '  w[0]=0.227027; w[1]=0.1945946; w[2]=0.1216216; w[3]=0.054054; w[4]=0.016216;',
    '  vec3 c0 = texture(uTex, vUV).rgb;',
    '  if(uPrefilter == 1) c0 = max(c0 - uThreshold, vec3(0.0));',
    '  s = c0 * w[0];',
    '  for(int i=1;i<5;i++){',
    '    vec3 ca = texture(uTex, vUV + uDir*float(i)).rgb;',
    '    vec3 cb = texture(uTex, vUV - uDir*float(i)).rgb;',
    '    if(uPrefilter == 1){ ca = max(ca - uThreshold, vec3(0.0)); cb = max(cb - uThreshold, vec3(0.0)); }',
    '    s += (ca + cb) * w[i];',
    '  }',
    '  outColor = vec4(s, 1.0);',
    '}'
  ].join('\n');

  // ---- final composite ---------------------------------------------
  var FS_COMPOSITE = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUV;',
    'uniform sampler2D uTex;',
    'uniform sampler2D uGlow;',
    'uniform float uGlowAmount;',
    'uniform float uSaturation;',
    'uniform float uHueShift;',
    'uniform float uContrast;',
    'uniform float uVignette;',
    'uniform vec3 uBackground;',
    'uniform float uGrain;',
    'uniform float uTime;',
    'out vec4 outColor;',
    'vec3 rgb2hsv(vec3 c){',
    '  vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);',
    '  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));',
    '  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));',
    '  float d = q.x - min(q.w, q.y);',
    '  float e = 1.0e-10;',
    '  return vec3(abs(q.z + (q.w - q.y) / (6.0*d + e)), d / (q.x + e), q.x);',
    '}',
    'vec3 hsv2rgb(vec3 c){',
    '  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);',
    '  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);',
    '  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);',
    '}',
    'void main(){',
    '  vec4 t = texture(uTex, vUV);',
    '  vec3 col = t.rgb;',
    '  if(uGlowAmount > 0.0) col += texture(uGlow, vUV).rgb * uGlowAmount;',
    '  if(abs(uHueShift) > 0.0001 || abs(uSaturation - 1.0) > 0.0001){',
    '    vec3 h = rgb2hsv(clamp(col, 0.0, 4.0));',
    '    h.x = fract(h.x + uHueShift);',
    '    h.y = clamp(h.y * uSaturation, 0.0, 1.0);',
    '    col = hsv2rgb(h);',
    '  }',
    '  col = (col - 0.5) * uContrast + 0.5;',
    '  col = max(col, vec3(0.0));',
    '  float a = clamp(t.a, 0.0, 1.0);',
    '  col = col + uBackground * (1.0 - a);',
    '  if(uVignette > 0.0){',
    '    vec2 d = vUV - 0.5;',
    '    float vg = 1.0 - uVignette * dot(d,d) * 2.4;',
    '    col *= clamp(vg, 0.0, 1.0);',
    '  }',
    '  if(uGrain > 0.0){',
    '    float n = fract(sin(dot(vUV*vec2(1234.5678, 8765.4321) + uTime, vec2(12.9898,78.233))) * 43758.5453);',
    '    col += (n - 0.5) * uGrain;',
    '  }',
    '  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);',
    '}'
  ].join('\n');

  // ---- denoise ------------------------------------------------------
  // Edge-avoiding a-trous wavelet: the standard cheap denoiser for Monte
  // Carlo renders, which is exactly what a flame is. A 5x5 B3-spline kernel
  // is applied at a widening stride, and each tap is weighted down when it
  // differs from the centre in luminance or density -- so noise averages out
  // while the thin bright filaments that make a flame survive.
  var FS_DENOISE = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUV;',
    'uniform sampler2D uTex;',
    'uniform ivec2 uSize;',
    'uniform int uStride;',
    'uniform float uSigmaL;',
    'uniform float uSigmaA;',
    'out vec4 outColor;',
    'float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }',
    // kernel weights as a function: avoids dynamic array indexing entirely
    'float kw(int i){ return (i == 0 || i == 4) ? 0.0625 : ((i == 1 || i == 3) ? 0.25 : 0.375); }',
    'void main(){',
    '  ivec2 px = clamp(ivec2(vUV * vec2(uSize)), ivec2(0), uSize - 1);',
    '  vec4 c0 = texelFetch(uTex, px, 0);',
    '  float l0 = luma(c0.rgb);',
    '  float sl = max(uSigmaL, 1e-4), sa = max(uSigmaA, 1e-4);',
    '  vec3 sum = vec3(0.0);',
    '  float asum = 0.0, wsum = 0.0;',
    '  for(int dy = -2; dy <= 2; dy++){',
    '    for(int dx = -2; dx <= 2; dx++){',
    '      ivec2 q = clamp(px + ivec2(dx, dy) * uStride, ivec2(0), uSize - 1);',
    '      vec4 c = texelFetch(uTex, q, 0);',
    '      float w = kw(dx + 2) * kw(dy + 2);',
    '      float dl = luma(c.rgb) - l0;',
    '      float da = c.a - c0.a;',
    '      w *= exp(-(dl * dl) / (sl * sl) - (da * da) / (sa * sa));',
    '      sum += c.rgb * w; asum += c.a * w; wsum += w;',
    '    }',
    '  }',
    '  outColor = (wsum > 1e-6) ? vec4(sum / wsum, asum / wsum) : c0;',
    '}'
  ].join('\n');

  // ---- accumulation fade -------------------------------------------
  // Samples nothing on purpose: it is drawn into the accumulation buffer
  // itself, and blendFunc(ZERO, CONSTANT_COLOR) ignores the source colour.
  // vUV is declared (and unused) purely so the varying interface matches
  // VS_QUAD exactly, the same shape as every other pass here.
  var FS_FADE = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUV;',
    'out vec4 outColor;',
    'void main(){ outColor = vec4(0.0); }'
  ].join('\n');

  // ---- simple textured blit ----------------------------------------
  var FS_BLIT = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUV;',
    'uniform sampler2D uTex;',
    'out vec4 outColor;',
    'void main(){ outColor = texture(uTex, vUV); }'
  ].join('\n');

  global.FlameShaders = {
    MAX_XFORMS: MAX_XFORMS,
    MAX_VARS: MAX_VARS,
    XTEX_W: XTEX_W,
    VS_QUAD: VS_QUAD,
    FS_ITERATE: FS_ITERATE,
    VS_ACCUM: VS_ACCUM,
    FS_ACCUM: FS_ACCUM,
    FS_TONEMAP: FS_TONEMAP,
    FS_BLUR: FS_BLUR,
    FS_COMPOSITE: FS_COMPOSITE,
    FS_DENOISE: FS_DENOISE,
    FS_FADE: FS_FADE,
    FS_BLIT: FS_BLIT
  };
})(typeof window !== 'undefined' ? window : globalThis);
