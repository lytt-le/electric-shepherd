/* =====================================================================
   renderer.js  -  WebGL2 fractal-flame renderer (GPU chaos game)
   ---------------------------------------------------------------------
   Pipeline per frame:
     1. (animate mode) fade the accumulation buffer by `decay`
     2. N x [ iterate pass -> splat pass ]   (additive float accumulation)
     3. tonemap  -> toned texture
     4. optional glow (prefilter + separable blur)
     5. composite -> canvas
   ===================================================================== */
(function (global) {
  'use strict';

  var S = global.FlameShaders;
  var GEN = global.FlameGenome;
  var VAR = global.FlameVariations;

  function compile(gl, type, src, label) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(sh);
      var lines = src.split('\n');
      var m = /ERROR:\s*\d+:(\d+)/.exec(log || '');
      var ctx = '';
      if (m) {
        var ln = parseInt(m[1], 10);
        for (var i = Math.max(0, ln - 3); i < Math.min(lines.length, ln + 2); i++) ctx += (i + 1) + ': ' + lines[i] + '\n';
      }
      throw new Error('Shader compile failed (' + label + '):\n' + log + '\n' + ctx);
    }
    return sh;
  }

  function Program(gl, vsSrc, fsSrc, label) {
    this.gl = gl;
    var vs = compile(gl, gl.VERTEX_SHADER, vsSrc, label + '.vs');
    var fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc, label + '.fs');
    var p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link failed (' + label + '): ' + gl.getProgramInfoLog(p));
    gl.deleteShader(vs); gl.deleteShader(fs);
    this.p = p;
    this.loc = {};
  }
  Program.prototype.use = function () { this.gl.useProgram(this.p); return this; };
  Program.prototype.u = function (name) {
    if (!(name in this.loc)) this.loc[name] = this.gl.getUniformLocation(this.p, name);
    return this.loc[name];
  };
  Program.prototype.set1i = function (n, v) { this.gl.uniform1i(this.u(n), v); return this; };
  Program.prototype.set1ui = function (n, v) { this.gl.uniform1ui(this.u(n), v >>> 0); return this; };
  Program.prototype.set1f = function (n, v) { this.gl.uniform1f(this.u(n), v); return this; };
  Program.prototype.set2f = function (n, a, b) { this.gl.uniform2f(this.u(n), a, b); return this; };
  Program.prototype.set2i = function (n, a, b) { this.gl.uniform2i(this.u(n), a, b); return this; };
  Program.prototype.set3f = function (n, a, b, c) { this.gl.uniform3f(this.u(n), a, b, c); return this; };

  function makeTex(gl, w, h, internalFormat, format, type, filter) {
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
    // A 32-bit float internal format is only filterable with OES_texture_float_linear,
    // which Apple GPUs do not expose. Asking for LINEAR without it leaves the texture
    // incomplete, and an incomplete texture samples as opaque black without raising an
    // error - so the flame renders perfectly and invisibly. Downgrade instead.
    if (filter === gl.LINEAR
        && (internalFormat === gl.RGBA32F || internalFormat === gl.RG32F || internalFormat === gl.R32F)
        && !gl.getExtension('OES_texture_float_linear')) filter = gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter || gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter || gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function makeFBO(gl, tex) {
    var f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    var st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Framebuffer incomplete: 0x' + st.toString(16));
    return f;
  }

  /* =================================================================== */
  function FlameRenderer(canvas, opts) {
    opts = opts || {};
    this.canvas = canvas;
    this.error = null;
    var gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: !!opts.preserveDrawingBuffer,
      powerPreference: 'high-performance'
    });
    if (!gl) { this.error = 'WebGL2 is not available in this browser.'; this.ok = false; return; }
    this.gl = gl;
    this.extColorFloat = gl.getExtension('EXT_color_buffer_float');
    this.extFloatBlend = gl.getExtension('EXT_float_blend');
    this.extLinearFloat = gl.getExtension('OES_texture_float_linear');
    if (!this.extColorFloat) {
      this.error = 'This GPU/browser lacks EXT_color_buffer_float, which the flame accumulator needs.';
      this.ok = false; return;
    }
    this.accumFormat = this.extFloatBlend ? gl.RGBA32F : gl.RGBA16F;
    this.accumType = this.extFloatBlend ? gl.FLOAT : gl.HALF_FLOAT;

    var varGLSL = VAR.buildGLSL();
    try {
      this.progIter = new Program(gl, S.VS_QUAD, S.FS_ITERATE(varGLSL), 'iterate');
      this.progSplat = new Program(gl, S.VS_ACCUM(varGLSL), S.FS_ACCUM, 'splat');
      this.progTone = new Program(gl, S.VS_QUAD, S.FS_TONEMAP, 'tonemap');
      this.progBlur = new Program(gl, S.VS_QUAD, S.FS_BLUR, 'blur');
      this.progComp = new Program(gl, S.VS_QUAD, S.FS_COMPOSITE, 'composite');
      this.progBlit = new Program(gl, S.VS_QUAD, S.FS_BLIT, 'blit');
      this.progFade = new Program(gl, S.VS_QUAD, S.FS_FADE, 'fade');
      this.progDenoise = new Program(gl, S.VS_QUAD, S.FS_DENOISE, 'denoise');
    } catch (e) { this.error = e.message; this.ok = false; return; }

    this.vao = gl.createVertexArray();

    // genome data textures
    this.texXform = makeTex(gl, GEN.XTEX_W, GEN.MAX_XFORMS + 1, gl.RGBA32F, gl.RGBA, gl.FLOAT);
    this.texXaos = makeTex(gl, GEN.MAX_XFORMS, GEN.MAX_XFORMS, gl.R32F, gl.RED, gl.FLOAT);
    // 16F, not 32F: the palette is the one data texture that is filtered, and RGBA16F
    // is filterable in core WebGL2 everywhere. It takes the same Float32Array upload
    // unchanged, and 256 colour stops have precision to spare.
    this.texPalette = makeTex(gl, 256, 1, gl.RGBA16F, gl.RGBA, gl.FLOAT, gl.LINEAR);

    this.pointsW = 0; this.pointsH = 0;
    this.width = 0; this.height = 0; this.ss = 1;
    this.sampleCount = 0;
    this.fuseLeft = 0;
    this.frameSeed = 1;
    this.genome = null;
    this.packed = null;
    this.mode = 'refine';        // 'refine' | 'animate'
    this.decay = 0.92;
    this.spinAngle = 0;
    this.ok = true;

    this.setPointCount(opts.points || 256);
    this.setSize(opts.width || canvas.width || 640, opts.height || canvas.height || 360, opts.ss || 2);
  }

  FlameRenderer.prototype.destroy = function () {
    var gl = this.gl; if (!gl) return;
    var lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
  };

  /* ---- point (particle) buffers ------------------------------------ */
  FlameRenderer.prototype.setPointCount = function (side) {
    var gl = this.gl;
    side = Math.max(32, Math.min(2048, side | 0));
    if (side === this.pointsW) return;
    if (this.stateTex) { gl.deleteTexture(this.stateTex[0]); gl.deleteTexture(this.stateTex[1]); gl.deleteFramebuffer(this.stateFBO[0]); gl.deleteFramebuffer(this.stateFBO[1]); }
    this.pointsW = side; this.pointsH = side;
    this.stateTex = [makeTex(gl, side, side, gl.RGBA32F, gl.RGBA, gl.FLOAT), makeTex(gl, side, side, gl.RGBA32F, gl.RGBA, gl.FLOAT)];
    this.stateFBO = [makeFBO(gl, this.stateTex[0]), makeFBO(gl, this.stateTex[1])];
    this.stateIdx = 0;
    this.resetPoints();
  };

  FlameRenderer.prototype.resetPoints = function (seed) {
    var gl = this.gl;
    var n = this.pointsW * this.pointsH;
    var buf = new Float32Array(n * 4);
    var r = new GEN.RNG(seed === undefined ? ((Math.random() * 4294967296) >>> 0) : seed);
    for (var i = 0; i < n; i++) {
      buf[i * 4] = r.range(-1, 1);
      buf[i * 4 + 1] = r.range(-1, 1);
      buf[i * 4 + 2] = r.next();
      buf[i * 4 + 3] = 0;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.stateTex[0]);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.pointsW, this.pointsH, gl.RGBA, gl.FLOAT, buf);
    this.stateIdx = 0;
    this.fuseLeft = 30;
  };

  /* ---- output buffers ---------------------------------------------- */
  FlameRenderer.prototype.setSize = function (w, h, ss) {
    var gl = this.gl;
    w = Math.max(16, w | 0); h = Math.max(16, h | 0);
    ss = Math.max(1, Math.min(4, ss | 0 || 1));
    // guard against absurd accumulation buffers
    while (w * ss * h * ss > 20e6 && ss > 1) ss--;
    if (w === this.width && h === this.height && ss === this.ss) return false;
    this.width = w; this.height = h; this.ss = ss;
    var aw = w * ss, ah = h * ss;
    this.accumW = aw; this.accumH = ah;
    var self = this;
    ['accumTex', 'tonedTex', 'tonedTexB', 'glowTexA', 'glowTexB'].forEach(function (k) { if (self[k]) gl.deleteTexture(self[k]); });
    ['accumFBO', 'tonedFBO', 'tonedFBOB', 'glowFBOA', 'glowFBOB'].forEach(function (k) { if (self[k]) gl.deleteFramebuffer(self[k]); });
    this.accumTex = makeTex(gl, aw, ah, this.accumFormat, gl.RGBA, this.accumType);
    this.accumFBO = makeFBO(gl, this.accumTex);
    this.tonedTex = makeTex(gl, w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
    this.tonedFBO = makeFBO(gl, this.tonedTex);
    // ping-pong partner for the a-trous denoise passes
    this.tonedTexB = makeTex(gl, w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
    this.tonedFBOB = makeFBO(gl, this.tonedTexB);
    this.glowW = Math.max(4, w >> 2); this.glowH = Math.max(4, h >> 2);
    this.glowTexA = makeTex(gl, this.glowW, this.glowH, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
    this.glowFBOA = makeFBO(gl, this.glowTexA);
    this.glowTexB = makeTex(gl, this.glowW, this.glowH, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
    this.glowFBOB = makeFBO(gl, this.glowTexB);
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.clearAccum();
    return true;
  };

  FlameRenderer.prototype.clearAccum = function () {
    var gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.accumFBO);
    gl.viewport(0, 0, this.accumW, this.accumH);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.sampleCount = 0;
  };

  /* ---- genome ------------------------------------------------------- */
  FlameRenderer.prototype.setGenome = function (g, keepAccum) {
    var gl = this.gl;
    this.genome = g;
    this.packed = GEN.pack(g, this.packed || {});
    gl.bindTexture(gl.TEXTURE_2D, this.texXform);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GEN.XTEX_W, GEN.MAX_XFORMS + 1, gl.RGBA, gl.FLOAT, this.packed.xform);
    gl.bindTexture(gl.TEXTURE_2D, this.texXaos);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GEN.MAX_XFORMS, GEN.MAX_XFORMS, gl.RED, gl.FLOAT, this.packed.xaos);
    gl.bindTexture(gl.TEXTURE_2D, this.texPalette);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.FLOAT, this.packed.palette);
    if (!keepAccum) {
      this.clearAccum();
      this.fuseLeft = Math.max(this.fuseLeft, 20);
      // deterministic: the same genome always replays the same sample sequence
      this.frameSeed = ((g.seed >>> 0) || 1);
    }
  };

  /* ---- one iterate + splat pass ------------------------------------ */
  FlameRenderer.prototype.iterateOnce = function (splat) {
    var gl = this.gl;
    var src = this.stateIdx, dst = 1 - this.stateIdx;
    this.frameSeed = (this.frameSeed * 1664525 + 1013904223) >>> 0;

    // --- iterate
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.stateFBO[dst]);
    gl.viewport(0, 0, this.pointsW, this.pointsH);
    gl.disable(gl.BLEND);
    var pi = this.progIter.use();
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.stateTex[src]);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texXform);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.texXaos);
    pi.set1i('uState', 0).set1i('uXform', 1).set1i('uXaos', 2);
    pi.set1i('uNumXforms', this.packed.numXforms);
    pi.set1ui('uSeed', this.frameSeed);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.stateIdx = dst;

    if (!splat) return;

    // --- splat
    var g = this.genome;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.accumFBO);
    gl.viewport(0, 0, this.accumW, this.accumH);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE);
    var ps = this.progSplat.use();
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.stateTex[this.stateIdx]);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texXform);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.texPalette);
    ps.set1i('uState', 0).set1i('uXform', 1).set1i('uPalette', 3);
    ps.set1i('uPointsW', this.pointsW);
    var minDim = Math.min(this.accumW, this.accumH);
    var z = g.camera.zoom;
    ps.set2f('uCenter', g.camera.x, g.camera.y);
    ps.set2f('uScale', z * minDim / this.accumW, z * minDim / this.accumH);
    ps.set1f('uRot', -(g.camera.rotate + this.spinAngle));
    var symA = Math.max(1, g.render.symmetry | 0);
    var symB = g.render.symmetryB == null ? symA : Math.max(1, g.render.symmetryB | 0);
    var symMix = g.render.symmetryMix == null ? 0 : Math.max(0, Math.min(1, g.render.symmetryMix));
    ps.set1i('uSym', symA);
    ps.set1i('uSymB', symB);
    ps.set1f('uSymMix', symB === symA ? 0 : symMix);
    // mirror is a probability, so a morph can fade it in rather than flipping
    ps.set1f('uMirror', g.render.symmetryMirrorMix == null
      ? (g.render.symmetryMirror ? 1 : 0)
      : Math.max(0, Math.min(1, g.render.symmetryMirrorMix)));
    ps.set1i('uHasFinal', this.packed.hasFinal ? 1 : 0);
    ps.set1f('uJitter', (g.render.jitter || 0) * 2.0 / this.accumH);
    ps.set1ui('uSeed', this.frameSeed ^ 0x9e3779b9);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.POINTS, 0, this.pointsW * this.pointsH);
    gl.disable(gl.BLEND);
    this.sampleCount += this.pointsW * this.pointsH;
  };

  /* Multiply the whole accumulation buffer by `decay`.

     This MUST NOT sample the accumulation texture: it is the current render
     target, and binding it to a sampler at the same time forms a framebuffer
     feedback loop, which Chrome rejects outright (INVALID_OPERATION) and
     silently skips the draw -- the buffer then never fades and every previous
     sheep stays burned into the exposure.

     No sampling is needed anyway. blendFunc(ZERO, CONSTANT_COLOR) computes
     result = 0*src + C*dst, so the fragment colour is irrelevant; the fade
     shader writes a constant and touches no textures. */
  FlameRenderer.prototype.fadeAccum = function (decay) {
    if (decay >= 0.9999) return;
    var gl = this.gl;
    if (decay <= 0.0001) { this.clearAccum(); return; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.accumFBO);
    gl.viewport(0, 0, this.accumW, this.accumH);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendColor(decay, decay, decay, decay);
    gl.blendFunc(gl.ZERO, gl.CONSTANT_COLOR);
    this.progFade.use();
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    this.sampleCount *= decay;
  };

  /* ---- run a batch of passes --------------------------------------- */
  FlameRenderer.prototype.step = function (passes) {
    if (!this.genome) return;
    passes = Math.max(1, passes | 0);
    if (this.mode === 'animate') this.fadeAccum(this.decay);
    for (var i = 0; i < passes; i++) {
      var fusing = this.fuseLeft > 0;
      this.iterateOnce(!fusing);
      if (fusing) this.fuseLeft--;
    }
  };

  /* ---- present ------------------------------------------------------ */
  FlameRenderer.prototype.present = function (targetFBO) {
    var gl = this.gl;
    var g = this.genome;
    if (!g) return;
    var r = g.render;

    // 1. tonemap -> toned
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.tonedFBO);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.BLEND);
    var pt = this.progTone.use();
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.accumTex);
    pt.set1i('uAccum', 0);
    pt.set2i('uOutSize', this.width, this.height);
    pt.set1i('uSS', this.ss);
    var samples = Math.max(this.sampleCount, 1);
    pt.set1f('uDensityScale', (this.width * this.height) / samples);
    pt.set1f('uBrightness', r.brightness);
    pt.set1f('uInvGamma', 1.0 / Math.max(0.2, r.gamma));
    pt.set1f('uGammaThreshold', Math.max(0, r.gammaThreshold));
    pt.set1f('uVibrancy', Math.max(0, Math.min(1, r.vibrancy)));
    pt.set1f('uHighlight', Math.max(0, r.highlightPower));
    pt.set1i('uDE', r.de ? 1 : 0);
    pt.set1f('uDERadius', Math.max(0, r.deRadius));
    pt.set1f('uDEAlpha', Math.max(0.01, r.deAlpha));
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 2. denoise (edge-avoiding a-trous wavelet)
    // A flame is a Monte Carlo render, so the noise is per-pixel and roughly
    // independent; a few widening-stride passes average it out while the
    // luminance/density edge weights keep the thin filaments intact.
    var src = this.tonedTex;
    var dnPasses = Math.max(0, Math.min(4, Math.round(r.denoise || 0)));
    if (dnPasses > 0) {
      var str = Math.max(0, Math.min(1, r.denoiseStrength == null ? 0.5 : r.denoiseStrength));
      var sigL = 0.03 + (0.30 - 0.03) * str;
      var sigA = 0.05 + (0.50 - 0.05) * str;
      var pdn = this.progDenoise.use();
      pdn.set1i('uTex', 0);
      pdn.set2i('uSize', this.width, this.height);
      pdn.set1f('uSigmaL', sigL);
      pdn.set1f('uSigmaA', sigA);
      gl.viewport(0, 0, this.width, this.height);
      gl.bindVertexArray(this.vao);
      var dst = this.tonedTexB, dstFBO = this.tonedFBOB, srcFBO = this.tonedFBO;
      for (var i = 0; i < dnPasses; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, dstFBO);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
        pdn.set1i('uStride', 1 << i);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        var ts = src; src = dst; dst = ts;
        var tf = srcFBO; srcFBO = dstFBO; dstFBO = tf;
      }
    }

    // 3. glow
    var glowOn = r.glow > 0.0005;
    if (glowOn) {
      var pbl = this.progBlur.use();
      gl.viewport(0, 0, this.glowW, this.glowH);
      // prefilter + horizontal
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.glowFBOA);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
      pbl.set1i('uTex', 0).set1i('uPrefilter', 1).set1f('uThreshold', r.glowThreshold);
      pbl.set2f('uDir', (r.glowRadius || 1) / this.glowW, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // vertical
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.glowFBOB);
      gl.bindTexture(gl.TEXTURE_2D, this.glowTexA);
      pbl.set1i('uPrefilter', 0);
      pbl.set2f('uDir', 0, (r.glowRadius || 1) / this.glowH);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // second horizontal for a softer falloff
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.glowFBOA);
      gl.bindTexture(gl.TEXTURE_2D, this.glowTexB);
      pbl.set2f('uDir', (r.glowRadius || 1) * 2 / this.glowW, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // 4. composite
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFBO || null);
    gl.viewport(0, 0, this.width, this.height);
    var pc = this.progComp.use();
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, glowOn ? this.glowTexA : src);
    pc.set1i('uTex', 0).set1i('uGlow', 1);
    pc.set1f('uGlowAmount', glowOn ? r.glow : 0);
    pc.set1f('uSaturation', r.saturation);
    pc.set1f('uHueShift', r.hueShift);
    pc.set1f('uContrast', r.contrast);
    pc.set1f('uVignette', r.vignette);
    pc.set1f('uGrain', r.grain || 0);
    pc.set1f('uTime', (Date.now() % 100000) / 1000);
    pc.set3f('uBackground', r.background[0], r.background[1], r.background[2]);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  /* ---- readback helpers -------------------------------------------- */
  FlameRenderer.prototype.readPixels = function () {
    var gl = this.gl;
    var buf = new Uint8Array(this.width * this.height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return buf;
  };

  FlameRenderer.prototype.toCanvas = function (flip) {
    var buf = this.readPixels();
    var w = this.width, h = this.height;
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d');
    var img = ctx.createImageData(w, h);
    if (flip === false) img.data.set(buf);
    else {
      for (var y = 0; y < h; y++) {
        var srcOff = (h - 1 - y) * w * 4;
        img.data.set(buf.subarray(srcOff, srcOff + w * 4), y * w * 4);
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  };

  /* Read the accumulation buffer at reduced resolution (density only). */
  function halfToFloat(h) {
    var s = (h & 0x8000) >> 15, e = (h & 0x7C00) >> 10, f = h & 0x03FF;
    if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
    if (e === 0x1F) return f ? NaN : ((s ? -1 : 1) * Infinity);
    return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
  }

  FlameRenderer.prototype.readAccum = function () {
    var gl = this.gl;
    var w = this.accumW, h = this.accumH;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.accumFBO);
    var buf;
    try {
      if (this.accumType === gl.FLOAT) {
        buf = new Float32Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, buf);
      } else {
        var raw = new Uint16Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.HALF_FLOAT, raw);
        buf = new Float32Array(w * h * 4);
        for (var i = 0; i < raw.length; i++) buf[i] = halfToFloat(raw[i]);
      }
    } catch (e) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); return null; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { data: buf, w: w, h: h };
  };

  /* ---- auto framing -------------------------------------------------
     Renders wide, finds the density bounding box, and sets camera so the
     flame fills the frame.                                              */
  FlameRenderer.prototype.autoFit = function (genome, opts) {
    opts = opts || {};
    var g = genome || this.genome;
    if (!g) return;
    var savedCam = JSON.parse(JSON.stringify(g.camera));
    g.camera.x = 0; g.camera.y = 0; g.camera.rotate = savedCam.rotate; g.camera.zoom = opts.wide || 0.12;
    this.setGenome(g);
    this.resetPoints(g.seed || 1);
    this.mode = 'refine';
    this.step((opts.passes || 30) + 32);
    var acc = this.readAccum();
    if (!acc) { g.camera = savedCam; this.setGenome(g); return; }
    var w = acc.w, h = acc.h, d = acc.data;
    // total density and 99th-percentile bounding box
    var total = 0, i;
    for (i = 0; i < w * h; i++) total += d[i * 4 + 3];
    if (total <= 0) { g.camera = savedCam; this.setGenome(g); return; }
    var colSum = new Float32Array(w), rowSum = new Float32Array(h);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var v = d[(y * w + x) * 4 + 3];
        colSum[x] += v; rowSum[y] += v;
      }
    }
    var cut = total * (opts.trim === undefined ? 0.004 : opts.trim);
    function bounds(arr, n) {
      var acc2 = 0, lo = 0, hi = n - 1, k;
      for (k = 0; k < n; k++) { acc2 += arr[k]; if (acc2 > cut) { lo = k; break; } }
      acc2 = 0;
      for (k = n - 1; k >= 0; k--) { acc2 += arr[k]; if (acc2 > cut) { hi = k; break; } }
      return [lo, hi];
    }
    var bx = bounds(colSum, w), by = bounds(rowSum, h);
    var minDim = Math.min(w, h);
    var zw = g.camera.zoom;
    // pixel -> world
    function px2wx(px) { return ((px + 0.5) / w * 2 - 1) * w / minDim / zw; }
    function px2wy(py) { return ((py + 0.5) / h * 2 - 1) * h / minDim / zw; }
    var x0 = px2wx(bx[0]), x1 = px2wx(bx[1]);
    var y0 = px2wy(by[0]), y1 = px2wy(by[1]);
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    var ex = Math.max(Math.abs(x1 - x0) / 2, 1e-4);
    var ey = Math.max(Math.abs(y1 - y0) / 2, 1e-4);
    // undo the view rotation to get world-space centre
    var rot = -(savedCam.rotate || 0);
    var ca = Math.cos(-rot), sa = Math.sin(-rot);
    var wx = cx * ca - cy * sa, wy = cx * sa + cy * ca;
    var margin = opts.margin === undefined ? 1.12 : opts.margin;
    var zoom = 1 / (Math.max(ex * (this.accumW / minDim), ey * (this.accumH / minDim)) * margin);
    g.camera.x = savedCam.x + wx;
    g.camera.y = savedCam.y + wy;
    g.camera.zoom = Math.max(0.02, Math.min(60, zoom));
    g.camera.rotate = savedCam.rotate;
    g.camera.spin = savedCam.spin;
    this.setGenome(g);
    this.resetPoints(g.seed || 1);
    return g;
  };

  /* ---- image statistics used by the fitness function ---------------- */
  FlameRenderer.prototype.measure = function () {
    var px = this.readPixels();
    var n = this.width * this.height;
    var hist = new Float32Array(64);
    var lit = 0, sumR = 0, sumG = 0, sumB = 0, sumL = 0, sumL2 = 0;
    var rg = 0, yb = 0, rg2 = 0, yb2 = 0;
    for (var i = 0; i < n; i++) {
      var r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
      var l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (l > 8) lit++;
      hist[Math.min(63, l >> 2)]++;
      sumR += r; sumG += g; sumB += b; sumL += l; sumL2 += l * l;
      var a1 = r - g, b1 = 0.5 * (r + g) - b;
      rg += a1; rg2 += a1 * a1; yb += b1; yb2 += b1 * b1;
    }
    var entropy = 0;
    for (var k = 0; k < 64; k++) { var p = hist[k] / n; if (p > 0) entropy -= p * Math.log(p); }
    var meanL = sumL / n;
    var stdL = Math.sqrt(Math.max(0, sumL2 / n - meanL * meanL));
    var sRg = Math.sqrt(Math.max(0, rg2 / n - (rg / n) * (rg / n)));
    var sYb = Math.sqrt(Math.max(0, yb2 / n - (yb / n) * (yb / n)));
    var colorfulness = Math.sqrt(sRg * sRg + sYb * sYb) + 0.3 * Math.sqrt((rg / n) * (rg / n) + (yb / n) * (yb / n));
    // edge energy on a coarse grid
    var edge = 0, steps = 0;
    var stride = Math.max(1, Math.floor(this.width / 128));
    for (var y = stride; y < this.height - stride; y += stride) {
      for (var x = stride; x < this.width - stride; x += stride) {
        var o = (y * this.width + x) * 4;
        var o2 = (y * this.width + x + stride) * 4;
        var o3 = ((y + stride) * this.width + x) * 4;
        edge += Math.abs(px[o] - px[o2]) + Math.abs(px[o] - px[o3]);
        steps++;
      }
    }
    return {
      coverage: lit / n,
      entropy: entropy / Math.log(64),
      meanLuma: meanL / 255,
      stdLuma: stdL / 255,
      colorfulness: colorfulness / 255,
      edge: steps ? edge / (steps * 255 * 2) : 0
    };
  };

  global.FlameRenderer = FlameRenderer;
})(typeof window !== 'undefined' ? window : globalThis);
