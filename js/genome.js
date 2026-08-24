/* =====================================================================
   genome.js  -  the "sheep": a fully serialisable flame description
   ===================================================================== */
(function (global) {
  'use strict';

  var VAR = global.FlameVariations;
  var PAL = global.FlamePalette;
  var MAX_XFORMS = 12;
  var MAX_VARS = 8;
  var XTEX_W = 24;
  // NB: the app is called Electric Shepherd, but this string is stamped into
  // every exported .sheep.json / .flock.json and checked on load. Renaming it
  // would orphan every file anyone has already saved, so it stays as it is.
  var FORMAT = 'electric-sheep-local';
  var VERSION = 1;

  /* ---------------- seeded RNG (xorshift32, fully deterministic) ---- */
  function RNG(seed) {
    this.s = (seed >>> 0) || 0x9e3779b9;
    // scramble so nearby seeds diverge quickly
    for (var i = 0; i < 8; i++) this.next();
  }
  RNG.prototype.next = function () {
    var s = this.s;
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    this.s = s;
    return s / 4294967296;
  };
  RNG.prototype.range = function (a, b) { return a + (b - a) * this.next(); };
  RNG.prototype.int = function (n) { return Math.floor(this.next() * n) % n; };
  RNG.prototype.pick = function (arr) { return arr[this.int(arr.length)]; };
  RNG.prototype.sign = function () { return this.next() < 0.5 ? -1 : 1; };
  RNG.prototype.gauss = function () {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 0.7071;
  };

  function hashString(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }

  var SYLL_A = ['zar', 'mor', 'vel', 'ith', 'kel', 'ora', 'nyx', 'pyr', 'sol', 'tha', 'vor', 'lum', 'cae', 'dre', 'fen', 'gly'];
  var SYLL_B = ['ith', 'ara', 'ox', 'une', 'aris', 'eon', 'yss', 'ura', 'ael', 'ind', 'orn', 'ave', 'ise', 'ulm'];
  function nameFromSeed(seed) {
    var r = new RNG(seed ^ 0x5bf03635);
    var n = r.pick(SYLL_A) + r.pick(SYLL_B);
    return n.charAt(0).toUpperCase() + n.slice(1) + '-' + (seed >>> 0).toString(36).slice(-4);
  }

  /* ---------------- defaults --------------------------------------- */
  function defaultRender() {
    return {
      brightness: 3.2,
      gamma: 4.0,
      gammaThreshold: 0.02,
      vibrancy: 1.0,
      highlightPower: 0.0,
      contrast: 1.0,
      saturation: 1.0,
      hueShift: 0.0,
      glow: 0.25,
      glowRadius: 2.0,
      glowThreshold: 0.55,
      vignette: 0.25,
      grain: 0.0,
      background: [0, 0, 0],
      symmetry: 1,
      symmetryMirror: false,
      de: true,
      deRadius: 1.6,
      deAlpha: 0.45,
      denoise: 0,
      denoiseStrength: 0.5,
      jitter: 1.0
    };
  }
  function defaultCamera() {
    return { x: 0, y: 0, zoom: 0.45, rotate: 0, spin: 0 };
  }
  function identityAffine() { return [1, 0, 0, 0, 1, 0]; }

  function newXform(opts) {
    opts = opts || {};
    return {
      weight: opts.weight === undefined ? 1 : opts.weight,
      color: opts.color === undefined ? 0 : opts.color,
      colorSpeed: opts.colorSpeed === undefined ? 0.5 : opts.colorSpeed,
      opacity: opts.opacity === undefined ? 1 : opts.opacity,
      affine: opts.affine ? opts.affine.slice() : identityAffine(),
      post: opts.post ? opts.post.slice() : identityAffine(),
      usePost: !!opts.usePost,
      vars: opts.vars ? JSON.parse(JSON.stringify(opts.vars)) : [{ v: 'linear', w: 1, p: [0, 0, 0, 0, 0, 0] }],
      xaos: opts.xaos ? opts.xaos.slice() : null   // outgoing multipliers, null = all 1
    };
  }

  function newGenome(seed) {
    seed = (seed === undefined ? (Math.random() * 4294967296) >>> 0 : seed >>> 0);
    return {
      format: FORMAT,
      version: VERSION,
      id: 's' + seed.toString(36) + '-' + Date.now().toString(36),
      name: nameFromSeed(seed),
      seed: seed,
      generation: 0,
      parents: [],
      created: new Date().toISOString(),
      note: '',
      xforms: [
        newXform({ color: 0.0, affine: [0.5, 0, 0.25, 0, 0.5, 0.25] }),
        newXform({ color: 0.5, affine: [0.5, 0, -0.25, 0, 0.5, 0.25] }),
        newXform({ color: 1.0, affine: [0.5, 0, 0, 0, 0.5, -0.35] })
      ],
      final: null,
      palette: PAL.defaultPalette(seed),
      camera: defaultCamera(),
      render: defaultRender(),
      loop: defaultLoop()
    };
  }

  /* ---------------- random sheep ------------------------------------ */

  function randomAffine(rnd, tame) {
    // build from rotation / scale / shear / translate so it stays contractive
    var ang = rnd.range(0, Math.PI * 2);
    var sx = rnd.range(tame ? 0.35 : 0.15, tame ? 0.95 : 1.25);
    var sy = tame ? sx * rnd.range(0.7, 1.3) : rnd.range(0.15, 1.25);
    var shear = rnd.gauss() * (tame ? 0.15 : 0.45);
    var tx = rnd.gauss() * (tame ? 0.55 : 0.9);
    var ty = rnd.gauss() * (tame ? 0.55 : 0.9);
    var ca = Math.cos(ang), sa = Math.sin(ang);
    var a = ca * sx, d = sa * sx;
    var b = -sa * sy + ca * shear, e = ca * sy + sa * shear;
    return [a, b, tx, d, e, ty];
  }

  function randomVariationSet(rnd, maxVars) {
    var pool = VAR.tame;
    var n = 1 + (rnd.next() < 0.55 ? 0 : 1) + (rnd.next() < 0.22 ? 1 : 0);
    n = Math.min(n, maxVars || 3);
    var chosen = [];
    var used = {};
    for (var i = 0; i < n; i++) {
      var name = pool[rnd.int(pool.length)];
      if (used[name]) continue;
      used[name] = 1;
      var def = VAR.byName[name];
      var p = def ? VAR.defaults(def.id) : [0, 0, 0, 0, 0, 0];
      // jitter parameters a little so sheep differ
      if (def) {
        for (var k = 0; k < def.params.length; k++) {
          var pd = def.params[k];
          var span = (pd.max - pd.min);
          p[k] = Math.max(pd.min, Math.min(pd.max, pd.def + rnd.gauss() * span * 0.12));
        }
      }
      chosen.push({ v: name, w: 0, p: p });
    }
    // weights: one dominant, others small
    var total = 0, ws = [];
    for (var j = 0; j < chosen.length; j++) {
      var w = (j === 0) ? rnd.range(0.6, 1.15) : rnd.range(0.08, 0.5) * rnd.sign();
      ws.push(w); total += Math.abs(w);
    }
    for (var m = 0; m < chosen.length; m++) chosen[m].w = ws[m] / Math.max(total, 0.001);
    return chosen;
  }

  function randomGenome(seed, opts) {
    opts = opts || {};
    seed = (seed === undefined ? (Math.random() * 4294967296) >>> 0 : seed >>> 0);
    var rnd = new RNG(seed);
    var g = newGenome(seed);
    var tame = opts.tame !== false;
    var n = opts.numXforms || (2 + rnd.int(opts.maxXforms ? opts.maxXforms - 1 : 4));
    n = Math.max(2, Math.min(MAX_XFORMS, n));
    g.xforms = [];
    for (var i = 0; i < n; i++) {
      var xf = newXform({
        weight: rnd.range(0.25, 1.0),
        color: n === 1 ? 0 : i / (n - 1),
        colorSpeed: rnd.range(0.3, 0.9),
        opacity: rnd.next() < 0.12 ? rnd.range(0.15, 0.85) : 1,
        affine: randomAffine(rnd, tame),
        usePost: rnd.next() < 0.3,
        vars: randomVariationSet(rnd, opts.maxVars || 3)
      });
      if (xf.usePost) xf.post = randomAffine(rnd, true);
      g.xforms.push(xf);
    }
    if (rnd.next() < (opts.finalChance === undefined ? 0.35 : opts.finalChance)) {
      g.final = newXform({
        weight: 1, color: 0, colorSpeed: 0, opacity: 1,
        affine: randomAffine(rnd, true),
        vars: randomVariationSet(rnd, 2)
      });
    }
    g.palette = PAL.randomPalette(function () { return rnd.next(); });
    PAL.bake(g.palette);
    g.camera = defaultCamera();
    g.render = defaultRender();
    g.render.symmetry = rnd.next() < 0.18 ? (2 + rnd.int(5)) : 1;
    g.render.symmetryMirror = g.render.symmetry > 1 && rnd.next() < 0.4;
    g.render.gamma = rnd.range(3.0, 4.6);
    g.render.brightness = rnd.range(2.4, 4.2);
    g.render.vibrancy = rnd.range(0.6, 1.0);
    g.render.glow = rnd.range(0, 0.45);
    g.loop = randomLoop(rnd, g);
    g.name = nameFromSeed(seed);
    return g;
  }

  /* ---------------- validation / normalisation ---------------------- */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function normalize(g) {
    if (!g || typeof g !== 'object') return null;
    g.format = FORMAT; g.version = VERSION;
    if (!Array.isArray(g.xforms) || !g.xforms.length) g.xforms = [newXform()];
    if (g.xforms.length > MAX_XFORMS) g.xforms.length = MAX_XFORMS;
    var d = defaultRender(), c = defaultCamera();
    g.render = Object.assign({}, d, g.render || {});
    g.camera = Object.assign({}, c, g.camera || {});
    if (!g.palette) g.palette = PAL.defaultPalette(g.seed || 1);
    g.render.symmetry = Math.round(clamp(g.render.symmetry || 1, 1, 32));
    // transient cross-fade fields, present only on a genome mid-morph
    if (g.render.symmetryB != null) g.render.symmetryB = Math.round(clamp(g.render.symmetryB || 1, 1, 32));
    if (g.render.symmetryMix != null) g.render.symmetryMix = clamp(+g.render.symmetryMix || 0, 0, 1);
    if (g.render.symmetryMirrorMix != null) g.render.symmetryMirrorMix = clamp(+g.render.symmetryMirrorMix || 0, 0, 1);
    for (var i = 0; i < g.xforms.length; i++) {
      var x = g.xforms[i];
      x.weight = clamp(+x.weight || 0, 0, 100);
      x.color = clamp(+x.color || 0, 0, 1);
      x.colorSpeed = clamp(x.colorSpeed === undefined ? 0.5 : +x.colorSpeed, 0, 1);
      x.opacity = clamp(x.opacity === undefined ? 1 : +x.opacity, 0, 1);
      if (!Array.isArray(x.affine) || x.affine.length !== 6) x.affine = identityAffine();
      if (!Array.isArray(x.post) || x.post.length !== 6) x.post = identityAffine();
      if (!Array.isArray(x.vars) || !x.vars.length) x.vars = [{ v: 'linear', w: 1, p: [0, 0, 0, 0, 0, 0] }];
      if (x.vars.length > MAX_VARS) x.vars.length = MAX_VARS;
      for (var k = 0; k < x.vars.length; k++) {
        var vv = x.vars[k];
        if (!VAR.byName[vv.v]) vv.v = 'linear';
        vv.w = +vv.w || 0;
        if (!Array.isArray(vv.p)) vv.p = [0, 0, 0, 0, 0, 0];
        while (vv.p.length < 6) vv.p.push(0);
      }
      if (x.xaos && x.xaos.length !== g.xforms.length) {
        var nx = [];
        for (var q = 0; q < g.xforms.length; q++) nx.push(x.xaos[q] === undefined ? 1 : x.xaos[q]);
        x.xaos = nx;
      }
    }
    normalizeLoop(g);
    // make sure at least one xform has weight
    var tw = 0;
    for (var j = 0; j < g.xforms.length; j++) tw += g.xforms[j].weight;
    if (tw <= 0) g.xforms[0].weight = 1;
    return g;
  }

  function clone(g) { return normalize(JSON.parse(JSON.stringify(g))); }

  /* A genome taken from the middle of a morph carries cross-fade fields that
     describe a moment rather than a sheep. Saving one should save what is on
     screen, resolved: whichever side of the fade it had reached. */
  function settle(g) {
    if (!g || !g.render) return g;
    var r = g.render;
    if (r.symmetryMix != null) {
      if (r.symmetryB != null && r.symmetryMix >= 0.5) r.symmetry = r.symmetryB;
      delete r.symmetryB; delete r.symmetryMix;
    }
    if (r.symmetryMirrorMix != null) {
      r.symmetryMirror = r.symmetryMirrorMix >= 0.5;
      delete r.symmetryMirrorMix;
    }
    return g;
  }

  /* ---------------- packing for the GPU ----------------------------- */
  function packXformRow(x, out, base) {
    var a = x.affine, p = x.post;
    out[base + 0] = a[0]; out[base + 1] = a[1]; out[base + 2] = a[2]; out[base + 3] = a[3];
    out[base + 4] = a[4]; out[base + 5] = a[5]; out[base + 6] = x.color; out[base + 7] = x.colorSpeed;
    out[base + 8] = p[0]; out[base + 9] = p[1]; out[base + 10] = p[2]; out[base + 11] = p[3];
    out[base + 12] = p[4]; out[base + 13] = p[5]; out[base + 14] = x.opacity; out[base + 15] = x.usePost ? 1 : 0;
    var nv = Math.min(x.vars.length, MAX_VARS);
    out[base + 16] = nv; out[base + 17] = x.weight; out[base + 18] = 0; out[base + 19] = 0;
    for (var k = 0; k < nv; k++) {
      var vv = x.vars[k];
      var def = VAR.byName[vv.v];
      var id = def ? def.id : 0;
      var o = base + 20 + k * 8;
      out[o + 0] = id; out[o + 1] = vv.w; out[o + 2] = vv.p[0] || 0; out[o + 3] = vv.p[1] || 0;
      out[o + 4] = vv.p[2] || 0; out[o + 5] = vv.p[3] || 0; out[o + 6] = vv.p[4] || 0; out[o + 7] = vv.p[5] || 0;
    }
  }

  var ROW_FLOATS = XTEX_W * 4;

  function pack(g, buffers) {
    buffers = buffers || {};
    var xd = buffers.xform || new Float32Array(ROW_FLOATS * (MAX_XFORMS + 1));
    xd.fill(0);
    var n = Math.min(g.xforms.length, MAX_XFORMS);
    for (var i = 0; i < n; i++) packXformRow(g.xforms[i], xd, i * ROW_FLOATS);
    if (g.final) packXformRow(g.final, xd, MAX_XFORMS * ROW_FLOATS);

    var xa = buffers.xaos || new Float32Array(MAX_XFORMS * MAX_XFORMS);
    xa.fill(1);
    for (var row = 0; row < MAX_XFORMS; row++) {
      var sum = 0, w = [];
      for (var col = 0; col < n; col++) {
        var mult = 1;
        var src = g.xforms[Math.min(row, n - 1)];
        if (src && src.xaos && src.xaos[col] !== undefined) mult = Math.max(0, +src.xaos[col]);
        var ww = Math.max(0, g.xforms[col].weight) * mult;
        w.push(ww); sum += ww;
      }
      if (sum <= 0) { for (var z = 0; z < n; z++) { w[z] = 1; } sum = n; }
      var acc = 0;
      for (var c2 = 0; c2 < MAX_XFORMS; c2++) {
        if (c2 < n) { acc += w[c2] / sum; xa[row * MAX_XFORMS + c2] = Math.min(acc, 1); }
        else xa[row * MAX_XFORMS + c2] = 1;
      }
    }
    var lut = PAL.buildLUT(g.palette, buffers.palette);
    return { xform: xd, xaos: xa, palette: lut, numXforms: n, hasFinal: !!g.final };
  }

  /* ---------------- interpolation ----------------------------------- */
  function decomposeAffine(m) {
    var ax = Math.atan2(m[3], m[0]);
    var lx = Math.sqrt(m[0] * m[0] + m[3] * m[3]);
    var ay = Math.atan2(m[4], m[1]);
    var ly = Math.sqrt(m[1] * m[1] + m[4] * m[4]);
    return { ax: ax, lx: lx, ay: ay, ly: ly, tx: m[2], ty: m[5] };
  }
  function composeAffine(d) {
    return [
      d.lx * Math.cos(d.ax), d.ly * Math.cos(d.ay), d.tx,
      d.lx * Math.sin(d.ax), d.ly * Math.sin(d.ay), d.ty
    ];
  }
  function lerpAngle(a, b, t, spins) {
    var d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    d += (spins || 0) * Math.PI * 2;
    return a + d * t;
  }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function wrapPi(d) {
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  /* Interpolating the two columns as angle+length is what lets a transform
     TURN into another instead of collapsing through zero on the way.

     Turning each column independently, however, lets the angle BETWEEN them
     -- the shear -- sweep the long way round and pass through 0 or pi. At
     that instant the matrix is singular and it comes out the other side
     mirrored: on screen the flame flips inside out, mid-morph, for no reason
     the eye can explain. Measured on a stream of random sheep, roughly half
     of all transitions contained at least one such flip.

     So the second column is carried as its OFFSET from the first, and that
     offset takes the short way round. Handedness is then preserved whenever
     both ends agree on it, and when they genuinely disagree the flip is at
     least the shortest one available rather than an arbitrary sweep. */
  function lerpAffine(m1, m2, t, spins) {
    var d1 = decomposeAffine(m1), d2 = decomposeAffine(m2);
    // a column with no length has no meaningful angle -- atan2(0,0) is 0,
    // which would otherwise rotate the other end away from an arbitrary zero
    var ax1 = d1.lx < 1e-6 ? d2.ax : d1.ax, ax2 = d2.lx < 1e-6 ? d1.ax : d2.ax;
    var ay1 = d1.ly < 1e-6 ? d2.ay : d1.ay, ay2 = d2.ly < 1e-6 ? d1.ay : d2.ay;
    var ax = lerpAngle(ax1, ax2, t, spins);
    var sh1 = ay1 - ax1;                       // shear: column 2 relative to column 1
    var sh = sh1 + wrapPi((ay2 - ax2) - sh1) * t;
    return composeAffine({
      ax: ax,
      ay: ax + sh,
      lx: lerp(d1.lx, d2.lx, t),
      ly: lerp(d1.ly, d2.ly, t),
      tx: lerp(d1.tx, d2.tx, t),
      ty: lerp(d1.ty, d2.ty, t)
    });
  }

  /* A stand-in for a transform the other sheep does not have. It is a silent
     copy of its counterpart -- same shape, same place, but contributing
     nothing -- so that during a morph the extra transform fades in where it
     belongs. Padding with an identity (which is what this used to do) grew
     every new transform out of the middle of the frame instead. */
  function ghostOf(x) {
    if (!x) {
      var e = newXform({ weight: 0, opacity: 0 });
      e.vars = [{ v: 'linear', w: 0, p: [0, 0, 0, 0, 0, 0] }];
      return e;
    }
    var g = JSON.parse(JSON.stringify(x));
    g.weight = 0; g.opacity = 0;
    return g;
  }

  function lerpXform(x1, x2, t, spins) {
    var out = newXform();
    out.weight = lerp(x1.weight, x2.weight, t);
    out.color = lerp(x1.color, x2.color, t);
    out.colorSpeed = lerp(x1.colorSpeed, x2.colorSpeed, t);
    out.opacity = lerp(x1.opacity, x2.opacity, t);
    out.affine = lerpAffine(x1.affine, x2.affine, t, spins);
    out.usePost = (x1.usePost || x2.usePost);
    out.post = lerpAffine(x1.usePost ? x1.post : identityAffine(), x2.usePost ? x2.post : identityAffine(), t, 0);
    // union of variations
    var names = [], seen = {};
    var i;
    for (i = 0; i < x1.vars.length; i++) { if (!seen[x1.vars[i].v]) { seen[x1.vars[i].v] = 1; names.push(x1.vars[i].v); } }
    for (i = 0; i < x2.vars.length; i++) { if (!seen[x2.vars[i].v]) { seen[x2.vars[i].v] = 1; names.push(x2.vars[i].v); } }
    if (names.length > MAX_VARS) names.length = MAX_VARS;
    out.vars = [];
    for (i = 0; i < names.length; i++) {
      var nm = names[i];
      var a = null, b = null, k;
      for (k = 0; k < x1.vars.length; k++) if (x1.vars[k].v === nm) a = x1.vars[k];
      for (k = 0; k < x2.vars.length; k++) if (x2.vars[k].v === nm) b = x2.vars[k];
      var pa = a ? a.p : (b ? b.p : [0, 0, 0, 0, 0, 0]);
      var pb = b ? b.p : (a ? a.p : [0, 0, 0, 0, 0, 0]);
      var pp = [];
      for (k = 0; k < 6; k++) pp.push(lerp(pa[k] || 0, pb[k] || 0, t));
      out.vars.push({ v: nm, w: lerp(a ? a.w : 0, b ? b.w : 0, t), p: pp });
    }
    return out;
  }

  function interpolate(g1, g2, t, opts) {
    opts = opts || {};
    var spins = opts.spins || 0;
    var ease = opts.ease === false ? t : t * t * (3 - 2 * t);
    var out = clone(g1);
    out.id = 'morph';
    out.name = g1.name + ' -> ' + g2.name;
    var n = Math.max(g1.xforms.length, g2.xforms.length);
    var A = g1.xforms.slice(), B = g2.xforms.slice();
    while (A.length < n) A.push(ghostOf(B[A.length]));
    while (B.length < n) B.push(ghostOf(A[B.length]));
    out.xforms = [];
    for (var i = 0; i < n; i++) out.xforms.push(lerpXform(A[i], B[i], ease, spins));
    /* xaos decides which transform may follow which. lerpXform builds fresh
       transforms, which left every morph running with xaos wide open and the
       real matrix snapping back at each end of the transition -- a structural
       change to the attractor, visible as a jolt. Blend it instead; a missing
       entry is 1, the neutral value. */
    var anyXaos = false;
    for (i = 0; i < n; i++) if ((A[i] && A[i].xaos) || (B[i] && B[i].xaos)) { anyXaos = true; break; }
    if (anyXaos) {
      for (i = 0; i < n; i++) {
        var xa = A[i] && A[i].xaos, xb = B[i] && B[i].xaos, row = [];
        for (var q = 0; q < n; q++) {
          row.push(lerp(xa && xa[q] !== undefined ? +xa[q] : 1,
                        xb && xb[q] !== undefined ? +xb[q] : 1, ease));
        }
        out.xforms[i].xaos = row;
      }
    }
    if (g1.final || g2.final) {
      out.final = lerpXform(g1.final || newXform(), g2.final || newXform(), ease, 0);
    } else out.final = null;
    out.palette = PAL.lerp(g1.palette, g2.palette, ease);
    out.camera = {
      x: lerp(g1.camera.x, g2.camera.x, ease),
      y: lerp(g1.camera.y, g2.camera.y, ease),
      zoom: Math.exp(lerp(Math.log(Math.max(g1.camera.zoom, 1e-4)), Math.log(Math.max(g2.camera.zoom, 1e-4)), ease)),
      rotate: lerpAngle(g1.camera.rotate, g2.camera.rotate, ease, 0),
      spin: lerp(g1.camera.spin || 0, g2.camera.spin || 0, ease)
    };
    var r1 = g1.render, r2 = g2.render, ro = {};
    for (var key in r1) {
      if (typeof r1[key] === 'number' && typeof r2[key] === 'number') ro[key] = lerp(r1[key], r2[key], ease);
      else if (key === 'background') ro[key] = [lerp(r1[key][0], r2[key][0], ease), lerp(r1[key][1], r2[key][1], ease), lerp(r1[key][2], r2[key][2], ease)];
      else ro[key] = ease < 0.5 ? r1[key] : r2[key];
    }
    /* Symmetry is a whole number of rotational copies, so it cannot be
       averaged -- but it is applied stochastically at splat time, one copy
       chosen per sample, so the two ORDERS can be cross-faded: each sample
       joins the old ensemble or the new one, with the new one's share rising
       through the morph. Switching at the midpoint (which is what this did)
       gained or lost every mirrored copy of the picture in a single frame. */
    ro.symmetry = r1.symmetry;
    ro.symmetryB = r2.symmetry;
    ro.symmetryMix = ease;
    ro.symmetryMirror = ease < 0.5 ? r1.symmetryMirror : r2.symmetryMirror;
    ro.symmetryMirrorMix = lerp(r1.symmetryMirror ? 1 : 0, r2.symmetryMirror ? 1 : 0, ease);
    /* Density estimation is a flag, and turning it on mid-morph softens the
       whole image in one frame. Its radius is continuous and a radius of zero
       is a no-op, so ramp that instead and leave the flag on throughout. */
    ro.de = r1.de || r2.de;
    ro.deRadius = lerp(r1.de ? r1.deRadius : 0, r2.de ? r2.deRadius : 0, ease);
    out.render = ro;
    return normalize(out);
  }

  /* ===================================================================
     THE LOOP
     -------------------------------------------------------------------
     A sheep is not a still image, it is a short cyclic animation. The
     genome carries a list of "motion channels", each of which drives one
     parameter with a function of the loop phase t in [0,1).

     Every channel is built so that its value at t=1 equals its value at
     t=0, which is what makes the loop seamless:

       oscillating channels use  a * (sin(2pi(k*t + p)) - sin(2pi*p))
         - periodic in t with period 1/k, and exactly 0 at t=0, so the
           saved genome IS frame zero of its own loop;

       rotating channels use     k full turns over the loop
         - k is an integer, so the angle lands back where it started.

     Nothing here is random at playback time: the same genome and the
     same phase always give the same frame.                              */

  var TAU = Math.PI * 2;

  var LOOP_TARGETS = [
    { t: 'spin', label: 'Transform spin', xform: true, ramp: true },
    { t: 'scale', label: 'Transform scale', xform: true, amp: [0, 0.7], def: 0.15 },
    { t: 'shear', label: 'Transform shear', xform: true, amp: [0, 1.4], def: 0.2 },
    { t: 'orbit', label: 'Transform orbit', xform: true, amp: [0, 0.6], def: 0.08 },
    { t: 'weight', label: 'Transform weight', xform: true, amp: [0, 0.9], def: 0.25 },
    { t: 'color', label: 'Transform colour', xform: true, amp: [0, 0.5], def: 0.15 },
    { t: 'opacity', label: 'Transform opacity', xform: true, amp: [0, 1], def: 0.3 },
    { t: 'vweight', label: 'Variation weight', xform: true, slot: true, amp: [0, 0.9], def: 0.2 },
    { t: 'vparam', label: 'Variation parameter', xform: true, slot: true, param: true, amp: [0, 1.5], def: 0.3 },
    { t: 'palette', label: 'Palette cycle', ramp: true },
    { t: 'camspin', label: 'Camera spin', ramp: true },
    { t: 'camzoom', label: 'Camera zoom', amp: [0, 0.5], def: 0.08 }
  ];
  var LOOP_TARGET_BY_T = {};
  for (var lt = 0; lt < LOOP_TARGETS.length; lt++) LOOP_TARGET_BY_T[LOOP_TARGETS[lt].t] = LOOP_TARGETS[lt];

  function osc(k, p, phase) { return Math.sin(TAU * (k * phase + p)) - Math.sin(TAU * p); }
  function oscC(k, p, phase) { return Math.cos(TAU * (k * phase + p)) - Math.cos(TAU * p); }

  function rawClone(g) { return JSON.parse(JSON.stringify(g)); }

  function defaultLoop() { return { enabled: false, seconds: 12, animators: [] }; }

  function loopEnabled(g) {
    return !!(g && g.loop && g.loop.enabled && g.loop.animators && g.loop.animators.length);
  }
  function loopSeconds(g) {
    if (!loopEnabled(g)) return 0;
    return Math.max(0.5, +g.loop.seconds || 12);
  }

  /* Returns a new genome: this sheep at that point in its loop. */
  function applyLoop(g, phase) {
    var out = rawClone(g);
    if (!loopEnabled(g)) return out;
    phase = phase - Math.floor(phase);
    var A = g.loop.animators;
    for (var i = 0; i < A.length; i++) {
      var an = A[i];
      var k = Math.max(1, Math.round(an.k || 1));
      var p = an.p || 0;
      var a = an.a === undefined ? 0 : an.a;
      var o = osc(k, p, phase);
      var xf = null;
      if (an.x === -1) xf = out.final;
      else if (an.x >= 0 && an.x < out.xforms.length) xf = out.xforms[an.x];
      var d;
      switch (an.t) {
        case 'spin':
          if (!xf) break;
          d = decomposeAffine(xf.affine);
          d.ax += TAU * k * phase;
          d.ay += TAU * k * phase;
          xf.affine = composeAffine(d);
          break;
        case 'scale':
          if (!xf) break;
          d = decomposeAffine(xf.affine);
          var sc = Math.max(0.05, 1 + a * o);
          d.lx *= sc; d.ly *= sc;
          xf.affine = composeAffine(d);
          break;
        case 'shear':
          if (!xf) break;
          d = decomposeAffine(xf.affine);
          d.ay += a * o;
          xf.affine = composeAffine(d);
          break;
        case 'orbit':
          if (!xf) break;
          xf.affine[2] += a * oscC(k, p, phase);
          xf.affine[5] += a * osc(k, p, phase);
          break;
        case 'weight':
          if (xf) xf.weight = Math.max(0.001, xf.weight * (1 + a * o));
          break;
        case 'color':
          if (xf) { var cc = xf.color + a * o; xf.color = cc - Math.floor(cc); }
          break;
        case 'opacity':
          if (xf) xf.opacity = Math.max(0, Math.min(1, xf.opacity + a * o));
          break;
        case 'vweight': {
          if (!xf) break;
          var sv = xf.vars[an.s | 0];
          if (sv) sv.w += a * o;
          break;
        }
        case 'vparam': {
          if (!xf) break;
          var sv2 = xf.vars[an.s | 0];
          if (!sv2) break;
          var qi = an.q | 0;
          var val = (sv2.p[qi] || 0) + a * o;
          var def = VAR.byName[sv2.v];
          if (def && def.params[qi]) {
            var pd = def.params[qi];
            val = Math.max(pd.min, Math.min(pd.max, val));
          }
          sv2.p[qi] = val;
          break;
        }
        case 'palette':
          out.palette.rotate = (out.palette.rotate || 0) + k * phase;
          break;
        case 'camspin':
          out.camera.rotate = (out.camera.rotate || 0) + TAU * k * phase;
          break;
        case 'camzoom':
          out.camera.zoom = Math.max(0.02, out.camera.zoom * (1 + a * o));
          break;
      }
    }
    return out;
  }

  /* pick a variation slot/parameter pair that actually exists */
  function pickVarParam(xf, rnd) {
    var cand = [];
    for (var s = 0; s < xf.vars.length; s++) {
      var def = VAR.byName[xf.vars[s].v];
      if (!def) continue;
      for (var q = 0; q < def.params.length; q++) cand.push({ s: s, q: q });
    }
    if (!cand.length) return null;
    return cand[rnd.int(cand.length)];
  }

  function randomLoop(rnd, g) {
    var L = { enabled: true, seconds: Math.round(rnd.range(8, 20)), animators: [] };
    var n = g.xforms.length;
    if (!n) return L;

    // one headline motion so the loop always reads as moving
    var lead = rnd.next();
    if (lead < 0.38) L.animators.push({ t: 'spin', x: rnd.int(n), k: 1, a: 1, p: 0 });
    else if (lead < 0.60) L.animators.push({ t: 'camspin', k: 1, a: 1, p: 0 });
    else if (lead < 0.78) L.animators.push({ t: 'palette', k: 1, a: 1, p: 0 });
    else L.animators.push({ t: 'scale', x: rnd.int(n), k: 1, a: rnd.range(0.14, 0.32), p: rnd.next() });

    // extra channels, avoiding a second copy of the same target on the same
    // transform -- a loop made of three 'scale' channels just breathes
    var used = {};
    used[L.animators[0].t + ':' + (L.animators[0].x === undefined ? '-' : L.animators[0].x)] = 1;
    var extra = 2 + rnd.int(3);
    for (var i = 0; i < extra; i++) {
      var x = rnd.int(n);
      var cand = null;
      for (var attempt = 0; attempt < 6 && !cand; attempt++) {
        var pick = rnd.next();
        var c;
        if (pick < 0.24) {
          var vp = pickVarParam(g.xforms[x], rnd);
          c = vp ? { t: 'vparam', x: x, s: vp.s, q: vp.q, k: 1 + rnd.int(2), a: rnd.range(0.12, 0.45), p: rnd.next() } : null;
        }
        else if (pick < 0.40) c = { t: 'scale', x: x, k: 1 + rnd.int(2), a: rnd.range(0.08, 0.24), p: rnd.next() };
        else if (pick < 0.56) c = { t: 'shear', x: x, k: 1, a: rnd.range(0.08, 0.30), p: rnd.next() };
        else if (pick < 0.68) c = { t: 'vweight', x: x, s: 0, k: 1, a: rnd.range(0.10, 0.35), p: rnd.next() };
        else if (pick < 0.80) c = { t: 'color', x: x, k: 1, a: rnd.range(0.05, 0.25), p: rnd.next() };
        else if (pick < 0.88) c = { t: 'weight', x: x, k: 1, a: rnd.range(0.10, 0.40), p: rnd.next() };
        else if (pick < 0.95) c = { t: 'spin', x: x, k: 1, a: 1, p: 0 };
        else c = { t: 'palette', k: 1, a: 1, p: 0 };
        if (!c) { x = rnd.int(n); continue; }
        var key = c.t + ':' + (c.x === undefined ? '-' : c.x);
        if (used[key]) { x = rnd.int(n); continue; }
        used[key] = 1;
        cand = c;
      }
      if (cand) L.animators.push(cand);
    }
    return L;
  }

  function normalizeLoop(g) {
    if (!g.loop || typeof g.loop !== 'object') { g.loop = defaultLoop(); return; }
    g.loop.enabled = !!g.loop.enabled;
    g.loop.seconds = clamp(+g.loop.seconds || 12, 0.5, 600);
    if (!Array.isArray(g.loop.animators)) { g.loop.animators = []; return; }
    if (g.loop.animators.length > 24) g.loop.animators.length = 24;
    var out = [];
    for (var i = 0; i < g.loop.animators.length; i++) {
      var an = g.loop.animators[i];
      if (!an || !LOOP_TARGET_BY_T[an.t]) continue;
      var meta = LOOP_TARGET_BY_T[an.t];
      var o = { t: an.t, k: Math.max(1, Math.min(8, Math.round(+an.k || 1))) };
      if (meta.xform) o.x = Math.max(-1, Math.min(MAX_XFORMS - 1, an.x === undefined ? 0 : an.x | 0));
      if (meta.slot) o.s = Math.max(0, Math.min(MAX_VARS - 1, an.s | 0));
      if (meta.param) o.q = Math.max(0, Math.min(5, an.q | 0));
      if (meta.ramp) { o.a = 1; o.p = 0; }
      else {
        o.a = clamp(+an.a || 0, -4, 4);
        var ph = +an.p || 0;
        o.p = ph - Math.floor(ph);
      }
      out.push(o);
    }
    g.loop.animators = out;
  }

  /* ---------------- serialisation ----------------------------------- */
  function serialize(g, pretty) {
    var copy = JSON.parse(JSON.stringify(g));
    PAL.bake(copy.palette);
    return JSON.stringify(copy, null, pretty === false ? 0 : 2);
  }
  function deserialize(txt) {
    var o = JSON.parse(txt);
    if (Array.isArray(o)) return o.map(normalize);
    return normalize(o);
  }

  function fingerprint(g) {
    // animators are compared as fixed-order tuples: object key order is not
    // stable across a save/load round trip, and the library dedupes on this
    var loop = g.loop ? {
      e: !!g.loop.enabled,
      s: g.loop.seconds,
      a: (g.loop.animators || []).map(function (an) {
        return [an.t, an.x, an.s, an.q, an.k, an.a, an.p];
      })
    } : null;
    var s = JSON.stringify({ x: g.xforms, f: g.final, p: g.palette.stops || g.palette.preset, c: g.camera, sym: g.render.symmetry, l: loop });
    return hashString(s).toString(36);
  }

  global.FlameGenome = {
    MAX_XFORMS: MAX_XFORMS,
    LOOP_TARGETS: LOOP_TARGETS,
    LOOP_TARGET_BY_T: LOOP_TARGET_BY_T,
    defaultLoop: defaultLoop,
    randomLoop: randomLoop,
    applyLoop: applyLoop,
    loopEnabled: loopEnabled,
    loopSeconds: loopSeconds,
    pickVarParam: pickVarParam,
    rawClone: rawClone,
    MAX_VARS: MAX_VARS,
    XTEX_W: XTEX_W,
    ROW_FLOATS: ROW_FLOATS,
    RNG: RNG,
    hashString: hashString,
    nameFromSeed: nameFromSeed,
    newGenome: newGenome,
    newXform: newXform,
    identityAffine: identityAffine,
    randomAffine: randomAffine,
    randomVariationSet: randomVariationSet,
    randomGenome: randomGenome,
    defaultRender: defaultRender,
    defaultCamera: defaultCamera,
    normalize: normalize,
    clone: clone,
    settle: settle,
    pack: pack,
    interpolate: interpolate,
    lerpAffine: lerpAffine,
    decomposeAffine: decomposeAffine,
    composeAffine: composeAffine,
    serialize: serialize,
    deserialize: deserialize,
    fingerprint: fingerprint
  };
})(typeof window !== 'undefined' ? window : globalThis);
