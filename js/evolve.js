/* =====================================================================
   evolve.js  -  mutation, crossover and the fitness heuristic
   ===================================================================== */
(function (global) {
  'use strict';

  var GEN = global.FlameGenome;
  var VAR = global.FlameVariations;
  var PAL = global.FlamePalette;

  var MUTATIONS = [
    'all-variations', 'one-variation', 'add-variation', 'remove-variation',
    'variation-params', 'affine', 'post-affine', 'weights', 'colour',
    'palette', 'add-xform', 'remove-xform', 'symmetry', 'final-xform',
    'xaos', 'render', 'loop'
  ];

  function pickWeighted(rnd, table) {
    var total = 0, k;
    for (k in table) total += table[k];
    var u = rnd.next() * total;
    for (k in table) { u -= table[k]; if (u <= 0) return k; }
    return k;
  }

  var DEFAULT_MIX = {
    'all-variations': 1.0, 'one-variation': 2.4, 'add-variation': 1.2,
    'remove-variation': 0.7, 'variation-params': 2.0, 'affine': 2.6,
    'post-affine': 1.0, 'weights': 1.2, 'colour': 1.2, 'palette': 1.3,
    'add-xform': 0.7, 'remove-xform': 0.5, 'symmetry': 0.4,
    'final-xform': 0.6, 'xaos': 0.5, 'render': 0.8, 'loop': 1.0
  };

  /* Mutations that touch the translation part of an affine slide the whole
     attractor through world space, which reads as the camera panning rather
     than the sheep evolving. `lockPos` leaves rotation, scale and shear free
     but pins the translation, so the shape changes in place. */
  function jitterAffine(rnd, m, amt, lockPos) {
    var d = GEN.decomposeAffine(m);
    d.ax += rnd.gauss() * amt * 0.9;
    d.ay += rnd.gauss() * amt * 0.9;
    d.lx *= Math.exp(rnd.gauss() * amt * 0.5);
    d.ly *= Math.exp(rnd.gauss() * amt * 0.5);
    if (!lockPos) {
      d.tx += rnd.gauss() * amt * 0.6;
      d.ty += rnd.gauss() * amt * 0.6;
    }
    d.lx = Math.max(0.02, Math.min(4, d.lx));
    d.ly = Math.max(0.02, Math.min(4, d.ly));
    return GEN.composeAffine(d);
  }

  /* A fresh affine that keeps an existing one's translation. */
  function reshapeAffine(rnd, m, lockPos) {
    var na = GEN.randomAffine(rnd, true);
    if (lockPos) { na[2] = m[2]; na[5] = m[5]; }
    return na;
  }

  function meanTranslation(xforms) {
    var tx = 0, ty = 0;
    for (var i = 0; i < xforms.length; i++) { tx += xforms[i].affine[2]; ty += xforms[i].affine[5]; }
    return xforms.length ? [tx / xforms.length, ty / xforms.length] : [0, 0];
  }

  /* Mutation mix tuned for a drifting lineage: favours reshaping what is
     already there over structural jumps that relocate the whole flame. */
  var DRIFT_MIX = {
    'all-variations': 0.2, 'one-variation': 1.3, 'add-variation': 0.8,
    'remove-variation': 0.4, 'variation-params': 3.0, 'affine': 2.4,
    'post-affine': 1.0, 'weights': 1.4, 'colour': 1.6, 'palette': 0.7,
    'add-xform': 0.25, 'remove-xform': 0.15, 'symmetry': 0.12,
    'final-xform': 0.35, 'xaos': 0.5, 'render': 0.6, 'loop': 1.2
  };

  function randomVarEntry(rnd) {
    var name = VAR.tame[rnd.int(VAR.tame.length)];
    var def = VAR.byName[name];
    var p = VAR.defaults(def.id);
    for (var k = 0; k < def.params.length; k++) {
      var pd = def.params[k];
      p[k] = Math.max(pd.min, Math.min(pd.max, pd.def + rnd.gauss() * (pd.max - pd.min) * 0.15));
    }
    return { v: name, w: rnd.range(0.15, 0.8) * (rnd.next() < 0.2 ? -1 : 1), p: p };
  }

  /* Apply one mutation of the given kind. Returns the kind applied. */
  function applyMutation(g, kind, rnd, strength, lockPos) {
    var amt = strength === undefined ? 0.35 : strength;
    var xs = g.xforms;
    var x = xs[rnd.int(xs.length)];
    var i, k;
    switch (kind) {
      case 'all-variations':
        for (i = 0; i < xs.length; i++) xs[i].vars = GEN.randomVariationSet(rnd, 3);
        break;
      case 'one-variation':
        x.vars = GEN.randomVariationSet(rnd, 1 + rnd.int(3));
        break;
      case 'add-variation':
        if (x.vars.length < GEN.MAX_VARS) x.vars.push(randomVarEntry(rnd));
        break;
      case 'remove-variation':
        if (x.vars.length > 1) x.vars.splice(rnd.int(x.vars.length), 1);
        break;
      case 'variation-params':
        for (i = 0; i < x.vars.length; i++) {
          var def = VAR.byName[x.vars[i].v];
          if (!def) continue;
          x.vars[i].w += rnd.gauss() * amt * 0.4;
          for (k = 0; k < def.params.length; k++) {
            var pd = def.params[k];
            x.vars[i].p[k] = Math.max(pd.min, Math.min(pd.max, (x.vars[i].p[k] || 0) + rnd.gauss() * (pd.max - pd.min) * amt * 0.25));
          }
        }
        break;
      case 'affine':
        if (rnd.next() < 0.35) x.affine = reshapeAffine(rnd, x.affine, lockPos);
        else x.affine = jitterAffine(rnd, x.affine, amt, lockPos);
        break;
      case 'post-affine':
        if (!x.usePost && rnd.next() < 0.5) {
          x.usePost = true;
          x.post = lockPos ? jitterAffine(rnd, GEN.identityAffine(), amt, true) : GEN.randomAffine(rnd, true);
        }
        else if (x.usePost && rnd.next() < 0.2) { x.usePost = false; }
        else x.post = jitterAffine(rnd, x.post, amt * 0.7, lockPos);
        break;
      case 'weights':
        for (i = 0; i < xs.length; i++) xs[i].weight = Math.max(0.02, xs[i].weight * Math.exp(rnd.gauss() * amt));
        break;
      case 'colour':
        for (i = 0; i < xs.length; i++) {
          if (rnd.next() < 0.6) xs[i].color = Math.max(0, Math.min(1, xs[i].color + rnd.gauss() * amt * 0.5));
          if (rnd.next() < 0.3) xs[i].colorSpeed = Math.max(0, Math.min(1, xs[i].colorSpeed + rnd.gauss() * amt * 0.3));
          if (rnd.next() < 0.12) xs[i].opacity = Math.max(0, Math.min(1, xs[i].opacity + rnd.gauss() * amt * 0.4));
        }
        break;
      case 'palette':
        if (rnd.next() < 0.6) {
          g.palette = PAL.randomPalette(function () { return rnd.next(); });
          PAL.bake(g.palette);
        } else {
          g.palette.rotate = (g.palette.rotate || 0) + rnd.gauss() * 0.2;
          g.palette.hueShift = ((g.palette.hueShift || 0) + rnd.gauss() * 0.15) % 1;
          g.palette.saturation = Math.max(0, Math.min(2, (g.palette.saturation === undefined ? 1 : g.palette.saturation) + rnd.gauss() * 0.2));
        }
        break;
      case 'add-xform':
        if (xs.length < GEN.MAX_XFORMS) {
          var na = GEN.randomAffine(rnd, true);
          if (lockPos) { var mt = meanTranslation(xs); na[2] = mt[0]; na[5] = mt[1]; }
          xs.push(GEN.newXform({
            weight: rnd.range(0.2, 0.9),
            color: rnd.next(),
            colorSpeed: rnd.range(0.3, 0.9),
            affine: na,
            vars: GEN.randomVariationSet(rnd, 2)
          }));
          for (i = 0; i < xs.length; i++) xs[i].xaos = null;
        }
        break;
      case 'remove-xform':
        if (xs.length > 2) { xs.splice(rnd.int(xs.length), 1); for (i = 0; i < xs.length; i++) xs[i].xaos = null; }
        break;
      case 'symmetry':
        g.render.symmetry = rnd.next() < 0.45 ? 1 : (2 + rnd.int(7));
        g.render.symmetryMirror = g.render.symmetry > 1 && rnd.next() < 0.45;
        break;
      case 'final-xform':
        if (!g.final && rnd.next() < 0.6) {
          g.final = GEN.newXform({ weight: 1, colorSpeed: 0, affine: GEN.randomAffine(rnd, true), vars: GEN.randomVariationSet(rnd, 2) });
        } else if (g.final && rnd.next() < 0.25) g.final = null;
        else if (g.final) g.final.affine = jitterAffine(rnd, g.final.affine, amt, lockPos);
        break;
      case 'xaos': {
        var n = xs.length;
        for (i = 0; i < n; i++) {
          if (!xs[i].xaos || xs[i].xaos.length !== n) { xs[i].xaos = []; for (k = 0; k < n; k++) xs[i].xaos.push(1); }
        }
        var a = rnd.int(n), b = rnd.int(n);
        xs[a].xaos[b] = rnd.next() < 0.3 ? 0 : Math.max(0, rnd.range(0, 2.2));
        break;
      }
      case 'loop': {
        var L = g.loop;
        if (!L || !L.animators) { g.loop = GEN.randomLoop(rnd, g); break; }
        var r = rnd.next();
        if (r < 0.18 || !L.animators.length) {
          g.loop = GEN.randomLoop(rnd, g);                 // whole new choreography
        } else if (r < 0.32 && L.animators.length > 1) {
          L.animators.splice(rnd.int(L.animators.length), 1);
        } else if (r < 0.50) {
          var fresh = GEN.randomLoop(rnd, g);
          if (fresh.animators.length) L.animators.push(fresh.animators[rnd.int(fresh.animators.length)]);
        } else if (r < 0.66) {
          L.seconds = Math.max(2, Math.min(120, L.seconds * Math.exp(rnd.gauss() * amt * 0.5)));
        } else {
          var an = L.animators[rnd.int(L.animators.length)];
          var meta = GEN.LOOP_TARGET_BY_T[an.t];
          if (meta && meta.ramp) {
            an.k = Math.max(1, Math.min(4, an.k + (rnd.next() < 0.5 ? -1 : 1)));
          } else {
            an.a = (an.a || 0) * Math.exp(rnd.gauss() * amt * 0.6);
            if (meta && meta.amp) an.a = Math.max(meta.amp[0], Math.min(meta.amp[1], an.a));
            var np = (an.p || 0) + rnd.gauss() * amt * 0.3;
            an.p = np - Math.floor(np);
            if (rnd.next() < 0.25) an.k = Math.max(1, Math.min(4, Math.round(an.k + rnd.sign())));
          }
        }
        break;
      }
      case 'render':
        g.render.gamma = Math.max(1.2, Math.min(8, g.render.gamma + rnd.gauss() * amt));
        g.render.brightness = Math.max(0.6, Math.min(12, g.render.brightness * Math.exp(rnd.gauss() * amt * 0.4)));
        g.render.vibrancy = Math.max(0, Math.min(1, g.render.vibrancy + rnd.gauss() * amt * 0.3));
        if (rnd.next() < 0.3) g.render.glow = Math.max(0, Math.min(1.5, g.render.glow + rnd.gauss() * 0.2));
        break;
    }
    return kind;
  }

  function mutate(genome, opts) {
    opts = opts || {};
    var g = GEN.clone(genome);
    var seed = opts.seed === undefined ? ((Math.random() * 4294967296) >>> 0) : opts.seed >>> 0;
    var rnd = new GEN.RNG(seed);
    var count = opts.count || (1 + (rnd.next() < 0.35 ? 1 : 0));
    var kinds = [];
    for (var i = 0; i < count; i++) {
      var kind = opts.kind || pickWeighted(rnd, opts.mix || DEFAULT_MIX);
      applyMutation(g, kind, rnd, opts.strength, !!opts.lockPosition);
      kinds.push(kind);
    }
    g.seed = seed;
    g.id = 's' + seed.toString(36) + '-' + Date.now().toString(36);
    g.generation = (genome.generation || 0) + 1;
    g.parents = [genome.id];
    g.name = GEN.nameFromSeed(seed);
    g.note = 'mutation: ' + kinds.join(', ');
    g.created = new Date().toISOString();
    return GEN.normalize(g);
  }

  var CROSS_MODES = ['alternate', 'union', 'interpolate'];

  function cross(a, b, opts) {
    opts = opts || {};
    var seed = opts.seed === undefined ? ((Math.random() * 4294967296) >>> 0) : opts.seed >>> 0;
    var rnd = new GEN.RNG(seed);
    var mode = opts.mode || CROSS_MODES[rnd.int(CROSS_MODES.length)];
    var g;
    if (mode === 'interpolate') {
      // a crossed sheep is a sheep, not a moment inside a morph: resolve the
      // cross-fade fields interpolate() leaves behind
      g = GEN.settle(GEN.interpolate(a, b, opts.t === undefined ? rnd.range(0.25, 0.75) : opts.t, { ease: false }));
    } else if (mode === 'union') {
      g = GEN.clone(a);
      var take = GEN.clone(b).xforms;
      for (var i = 0; i < take.length && g.xforms.length < GEN.MAX_XFORMS; i++) {
        if (rnd.next() < 0.6) g.xforms.push(take[i]);
      }
      for (var q = 0; q < g.xforms.length; q++) g.xforms[q].xaos = null;
      g.palette = rnd.next() < 0.5 ? GEN.clone(a).palette : GEN.clone(b).palette;
      g.final = rnd.next() < 0.5 ? (a.final ? GEN.clone(a).final : null) : (b.final ? GEN.clone(b).final : null);
    } else { // alternate
      g = GEN.clone(a);
      var n = Math.max(a.xforms.length, b.xforms.length);
      var A = GEN.clone(a), B = GEN.clone(b);
      g.xforms = [];
      for (var k = 0; k < n; k++) {
        var src = (k % 2 === 0) ? A : B;
        var xf = src.xforms[k % src.xforms.length];
        g.xforms.push(JSON.parse(JSON.stringify(xf)));
      }
      for (var z = 0; z < g.xforms.length; z++) g.xforms[z].xaos = null;
      g.palette = rnd.next() < 0.5 ? A.palette : B.palette;
      g.render.symmetry = rnd.next() < 0.5 ? a.render.symmetry : b.render.symmetry;
      g.final = rnd.next() < 0.5 ? A.final : B.final;
    }
    g.seed = seed;
    g.id = 's' + seed.toString(36) + '-' + Date.now().toString(36);
    g.generation = Math.max(a.generation || 0, b.generation || 0) + 1;
    g.parents = [a.id, b.id];
    g.name = GEN.nameFromSeed(seed);
    g.note = 'cross (' + mode + '): ' + a.name + ' x ' + b.name;
    g.created = new Date().toISOString();
    return GEN.normalize(g);
  }

  /* ---------------- fitness ----------------------------------------- */
  function bell(x, mu, sigma) { var d = (x - mu) / sigma; return Math.exp(-0.5 * d * d); }

  function fitness(stats, weights) {
    var w = Object.assign({
      coverage: 1.6, entropy: 1.3, colour: 1.0, detail: 1.5, contrast: 0.8
    }, weights || {});
    if (!stats) return 0;
    if (stats.coverage < 0.015) return 0.001;          // empty
    if (stats.coverage > 0.96) return 0.01;            // washed out
    if (stats.meanLuma > 0.75) return 0.02;            // blown out
    var sCov = bell(stats.coverage, 0.30, 0.24);
    var sEnt = Math.min(1, stats.entropy / 0.62);
    var sCol = Math.min(1, stats.colorfulness / 0.22);
    var sDet = Math.min(1, stats.edge / 0.075);
    var sCon = Math.min(1, stats.stdLuma / 0.24);
    var total = w.coverage + w.entropy + w.colour + w.detail + w.contrast;
    return (w.coverage * sCov + w.entropy * sEnt + w.colour * sCol + w.detail * sDet + w.contrast * sCon) / total;
  }

  /* ---------------- population --------------------------------------- */
  function Population(opts) {
    opts = opts || {};
    this.size = opts.size || 9;
    this.members = [];      // {genome, score, thumb}
    this.generation = 0;
    this.eliteFraction = opts.eliteFraction || 0.34;
    this.mutationStrength = opts.mutationStrength || 0.35;
    this.mutationRate = opts.mutationRate === undefined ? 0.65 : opts.mutationRate;
    this.freshRate = opts.freshRate === undefined ? 0.15 : opts.freshRate;
  }
  Population.prototype.seedRandom = function (seedBase) {
    this.members = [];
    for (var i = 0; i < this.size; i++) {
      var s = ((seedBase === undefined ? (Math.random() * 4294967296) : (seedBase + i * 7919)) >>> 0);
      this.members.push({ genome: GEN.randomGenome(s), score: 0, thumb: null });
    }
    this.generation = 0;
  };
  Population.prototype.sorted = function () {
    return this.members.slice().sort(function (a, b) { return b.score - a.score; });
  };
  /* Build the next generation from the current scores (or explicit parents). */
  Population.prototype.advance = function (explicitParents) {
    var rnd = new GEN.RNG((Math.random() * 4294967296) >>> 0);
    var pool = explicitParents && explicitParents.length
      ? explicitParents.slice()
      : this.sorted().slice(0, Math.max(2, Math.round(this.size * this.eliteFraction))).map(function (m) { return m.genome; });
    if (!pool.length) { this.seedRandom(); return; }
    var next = [];
    // keep the best parent unchanged
    next.push({ genome: GEN.clone(pool[0]), score: 0, thumb: null });
    while (next.length < this.size) {
      var u = rnd.next();
      var g;
      if (u < this.freshRate || pool.length === 0) {
        g = GEN.randomGenome((rnd.next() * 4294967296) >>> 0);
      } else if (pool.length > 1 && u < this.freshRate + (1 - this.mutationRate)) {
        var a = pool[rnd.int(pool.length)], b = pool[rnd.int(pool.length)];
        if (a === b) b = pool[(pool.indexOf(a) + 1) % pool.length];
        g = cross(a, b, { seed: (rnd.next() * 4294967296) >>> 0 });
        if (rnd.next() < 0.5) g = mutate(g, { strength: this.mutationStrength * 0.7 });
      } else {
        g = mutate(pool[rnd.int(pool.length)], { strength: this.mutationStrength });
      }
      next.push({ genome: g, score: 0, thumb: null });
    }
    this.members = next;
    this.generation++;
  };

  global.FlameEvolve = {
    MUTATIONS: MUTATIONS,
    CROSS_MODES: CROSS_MODES,
    DEFAULT_MIX: DEFAULT_MIX,
    DRIFT_MIX: DRIFT_MIX,
    mutate: mutate,
    cross: cross,
    fitness: fitness,
    Population: Population
  };
})(typeof window !== 'undefined' ? window : globalThis);
