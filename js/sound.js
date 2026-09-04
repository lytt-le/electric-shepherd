/* =====================================================================
   sound.js  -  the sheep, described for the ear
   ---------------------------------------------------------------------
   This is the audio counterpart of GEN.pack(): that turns a genome into
   buffers for the GPU, this turns one into a spec for the synthesiser in
   audiograph.js. It is deliberately pure - no Web Audio, no DOM, no
   clock, no randomness - so the same call serves the live view and an
   offline render, and so two people with the same .sheep.json hear the
   same thing.

   The one rule worth stating out loud: NOTHING HERE MAY READ PIXELS.
   The histogram statistics in renderer.stats() are tempting - coverage
   and colourfulness are right there - but reading the accumulation
   buffer back is the exact cost 81c0a5b went to trouble to remove, and
   it would make the sound impossible to render offline. Everything below
   comes from the genome and only the genome, which is what buys us
   morphing and loop closure for free: the stream already hands us
   continuous intermediate genomes, and applyLoop() is already periodic
   in phase, so the sound follows both without a line of extra work.

   A transform is a voice. What decides how much a transform contributes
   to the picture decides how much of it you hear.
   ===================================================================== */
(function (global) {
  'use strict';

  var GEN = global.FlameGenome;
  var PAL = global.FlamePalette;
  var VAR = global.FlameVariations;

  /* One voice per transform slot. The graph is built to this size once and
     never rebuilt, so a sheep with three transforms is a twelve-voice
     instrument with nine voices at silence - the same trick the morph code
     uses when it fades in a transform one sheep does not have. */
  var MAX_VOICES = GEN.MAX_XFORMS;

  /* ---------------- the timbre axes ---------------------------------
     The wrong move here is a lookup from variation to oscillator type:
     that is a switch, it clicks, and it cannot be interpolated. Instead
     every variation is projected onto five continuous axes and the
     variation weights become the mixing coefficients, so a stack of
     eight moves smoothly as its weights do.

       bright   how much high-frequency energy - inversive maps that blow
                up near the origin scatter the picture, and scatter the
                spectrum the same way
       noise    how stochastic - the 19 variations already tagged
                'random' in variations.js are the noisy ones, so that tag
                is reused rather than a second classification invented
       inhar    inharmonicity, i.e. FM index. An n-fold rotational
                symmetry is an integer frequency ratio
       reson    periodic in the plane, so ringing in the spectrum
       fold     geometric folding, i.e. waveshaper drive

     Rows are [bright, noise, inhar, reson, fold], each 0..1. Anything not
     listed falls back to its tag, so an added variation still sounds. */
  var TIMBRE = {
    linear: [0.05, 0, 0, 0, 0],
    sinusoidal: [0.15, 0, 0, 0.15, 0.35],
    spherical: [0.85, 0, 0.15, 0.25, 0.20],
    swirl: [0.45, 0, 0.10, 0.30, 0.25],
    horseshoe: [0.60, 0, 0.10, 0.15, 0.50],
    polar: [0.40, 0, 0, 0.35, 0.15],
    handkerchief: [0.50, 0, 0.15, 0.25, 0.30],
    heart: [0.55, 0, 0.20, 0.20, 0.35],
    disc: [0.70, 0, 0.10, 0.50, 0.20],
    spiral: [0.65, 0, 0.15, 0.40, 0.20],
    hyperbolic: [0.90, 0, 0.20, 0.30, 0.15],
    diamond: [0.50, 0, 0.10, 0.35, 0.25],
    ex: [0.55, 0, 0.15, 0.20, 0.30],
    julia: [0.45, 0, 0.50, 0.15, 0.10],
    bent: [0.35, 0, 0, 0.10, 0.60],
    waves: [0.40, 0, 0.05, 0.55, 0.30],
    fisheye: [0.60, 0, 0.05, 0.20, 0.55],
    popcorn: [0.55, 0.10, 0.10, 0.30, 0.45],
    exponential: [0.70, 0, 0.10, 0.20, 0.25],
    power: [0.60, 0, 0.25, 0.15, 0.20],
    cosine: [0.50, 0, 0.10, 0.30, 0.30],
    rings: [0.45, 0, 0.05, 0.70, 0.15],
    fan: [0.50, 0, 0.10, 0.45, 0.20],
    blob: [0.40, 0, 0.05, 0.50, 0.20],
    pdj: [0.45, 0, 0.10, 0.40, 0.35],
    fan2: [0.50, 0, 0.10, 0.45, 0.20],
    rings2: [0.45, 0, 0.05, 0.75, 0.15],
    eyefish: [0.75, 0, 0.05, 0.20, 0.30],
    bubble: [0.55, 0, 0.05, 0.20, 0.60],
    cylinder: [0.30, 0, 0, 0.25, 0.40],
    perspective: [0.40, 0, 0, 0.10, 0.20],
    noise: [0.50, 1.00, 0, 0, 0],
    julian: [0.50, 0.35, 0.70, 0.20, 0.10],
    juliascope: [0.55, 0.35, 0.75, 0.20, 0.10],
    blur: [0.30, 0.95, 0, 0, 0],
    gaussian_blur: [0.25, 0.90, 0, 0, 0],
    radial_blur: [0.35, 0.85, 0, 0.20, 0],
    pie: [0.60, 0.50, 0.10, 0.30, 0.10],
    ngon: [0.55, 0, 0.35, 0.35, 0.15],
    curl: [0.40, 0, 0.10, 0.20, 0.35],
    rectangles: [0.60, 0, 0.05, 0.40, 0.45],
    arch: [0.45, 0.60, 0.05, 0.30, 0.20],
    tangent: [0.85, 0, 0.15, 0.20, 0.40],
    square: [0.55, 0.90, 0, 0, 0.10],
    rays: [0.60, 0.70, 0.05, 0.25, 0.15],
    blade: [0.65, 0.70, 0.10, 0.20, 0.20],
    secant2: [0.90, 0, 0.20, 0.30, 0.25],
    twintrian: [0.70, 0.60, 0.15, 0.25, 0.30],
    cross: [0.80, 0, 0.10, 0.20, 0.30],
    disc2: [0.65, 0, 0.15, 0.40, 0.25],
    flower: [0.50, 0.55, 0.25, 0.35, 0.20],
    conic: [0.60, 0.55, 0.15, 0.25, 0.20],
    parabola: [0.45, 0.50, 0.05, 0.30, 0.30],
    bent2: [0.35, 0, 0, 0.10, 0.60],
    bipolar: [0.60, 0, 0.15, 0.35, 0.25],
    boarders: [0.50, 0.40, 0.05, 0.20, 0.50],
    butterfly: [0.50, 0, 0.10, 0.20, 0.40],
    cell: [0.55, 0, 0.05, 0.45, 0.50],
    cpow: [0.60, 0.40, 0.65, 0.20, 0.15],
    curve: [0.30, 0, 0, 0.15, 0.30],
    edisc: [0.65, 0, 0.10, 0.40, 0.20],
    elliptic: [0.70, 0, 0.10, 0.35, 0.20],
    escher: [0.55, 0, 0.20, 0.30, 0.55],
    foci: [0.60, 0, 0.10, 0.25, 0.30],
    lazysusan: [0.45, 0, 0.05, 0.30, 0.35],
    loonie: [0.60, 0, 0.05, 0.20, 0.50],
    modulus: [0.70, 0, 0.05, 0.35, 0.65],
    oscilloscope: [0.45, 0, 0.05, 0.80, 0.30],
    polar2: [0.40, 0, 0, 0.30, 0.15],
    popcorn2: [0.55, 0.10, 0.10, 0.35, 0.45],
    scry: [0.75, 0, 0.10, 0.25, 0.30],
    separation: [0.50, 0, 0.05, 0.30, 0.45],
    split: [0.60, 0, 0.05, 0.50, 0.40],
    stripes: [0.40, 0, 0.05, 0.70, 0.35],
    wedge: [0.50, 0, 0.15, 0.40, 0.25],
    whorl: [0.50, 0, 0.10, 0.35, 0.30],
    waves2: [0.40, 0, 0.05, 0.60, 0.30],
    exblur: [0.40, 0.80, 0, 0.10, 0.10],
    hypertile: [0.60, 0, 0.30, 0.30, 0.50],
    crackle: [0.60, 0.75, 0.05, 0.20, 0.30],
    super_shape: [0.55, 0.50, 0.35, 0.40, 0.30]
  };

  var BY_TAG = {
    basic: [0.30, 0, 0, 0.10, 0.10],
    affine: [0.20, 0, 0, 0, 0],
    random: [0.50, 0.80, 0.10, 0, 0.10]
  };
  var TIMBRE_DEFAULT = [0.35, 0, 0, 0.10, 0.15];

  /* Variations whose own parameter is an n-fold count: the picture's
     rotational symmetry is the FM ratio, which is why julian sounds
     metallic in a way that tracks what it draws. Value is the index into
     the variation's parameter list. */
  var RATIO_PARAM = {
    julian: 0, juliascope: 0, cpow: 2,
    oscilloscope: 1, waves2: 0, super_shape: 1
  };

  /* ---------------- harmony -----------------------------------------
     Pitch classes, as offsets from the root. Quantising matters more than
     it looks: an arbitrary genome hands out arbitrary contraction ratios,
     and unquantised they pile up into a cluster that says nothing about
     the sheep. On a scale the same numbers become intervals you can hear
     the difference between. */
  var SCALES = {
    pentatonic: [0, 3, 5, 7, 10],
    minor: [0, 2, 3, 5, 7, 8, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    major: [0, 2, 4, 5, 7, 9, 11],
    lydian: [0, 2, 4, 6, 7, 9, 11],
    wholetone: [0, 2, 4, 6, 8, 10],
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
  };
  var SCALE_NAMES = Object.keys(SCALES);

  /* The palette generators already describe hue structure, so where one was
     used it is taken at its word rather than measured: a mono palette is
     one hue and has nothing to argue about, a triadic palette is three.
     'preset' and hand-edited stops declare nothing, so those get measured
     instead - see spreadScale below. */
  var SCALE_BY_MODE = {
    'mono': 'pentatonic',          // one hue, nothing to argue about
    'analogous': 'minor',          // a cluster of neighbours
    'complementary': 'lydian',     // two poles, so let the tritone show
    'triadic': 'major',            // three, consonant
    'hue-walk': 'dorian',          // a line travelling
    'random-smooth': 'wholetone'   // no centre to speak of
  };

  /* How far the gradient travels round the wheel, as circular variance:
     0 is a single hue, 1 is hues pointing every way at once. A narrow
     palette gets a narrow, consonant scale and a wide one gets an
     ambiguous scale, which is the same statement in two media. */
  /* The cube root is not decoration. Measured over the built-in presets
     the raw variance piles up against zero - median 0.10, a quarter of
     them under 0.004 - because most gradients are a warm sweep rather
     than a trip round the wheel. Thresholds spaced evenly on the raw
     number would drop half of every flock into one scale, which is the
     failure this whole feature has to avoid: eighty sheep in a stream
     that all sound the same. The cube root opens out the crowded end so
     narrow palettes are told apart from each other rather than lumped. */
  function spreadScale(spread) {
    var x = Math.pow(clamp(spread, 0, 1), 1 / 3);
    if (x < 0.167) return 'pentatonic';
    if (x < 0.333) return 'minor';
    if (x < 0.500) return 'dorian';
    if (x < 0.667) return 'major';
    if (x < 0.833) return 'lydian';
    return 'wholetone';
  }

  /* Nearest degree of the scale, keeping the octave. */
  function quantise(semis, scale) {
    if (!scale) return semis;
    var oct = Math.floor(semis / 12), pc = semis - oct * 12;
    var best = scale[0], bd = Math.abs(scale[0] - pc);
    for (var i = 1; i < scale.length; i++) {
      var d = Math.abs(scale[i] - pc);
      if (d < bd) { bd = d; best = scale[i]; }
    }
    // the root an octave up is a candidate too, or everything near B
    // collapses down onto the leading note instead of resolving upward
    if (Math.abs(scale[0] + 12 - pc) < bd) best = scale[0] + 12;
    return oct * 12 + best;
  }

  function timbreRow(name) {
    var row = TIMBRE[name];
    if (row) return row;
    var def = VAR.byName[name];
    if (def && BY_TAG[def.tags]) return BY_TAG[def.tags];
    return TIMBRE_DEFAULT;
  }

  /* ---------------- helpers ----------------------------------------- */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function finite(v, fallback) { return isFinite(v) ? v : fallback; }

  var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  /* For the panel readout only - nothing in the mapping depends on it. */
  function noteName(hz) {
    if (!(hz > 0)) return '—';
    var n = Math.round(12 * Math.log(hz / 440) / Math.LN2) + 69;
    return NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
  }

  /* ---------------- the root note ------------------------------------
     From the palette, so two sheep sharing a palette agree with each
     other. A circular mean over the whole gradient is rotation
     invariant, which is the behaviour we want at this stage: rotating a
     palette turns the picture's colours without moving the sheep's key.
     (Per-voice hue lookup, which does respond to rotate, is what turns
     the palette cycle into a transposition later on.) */
  var lutScratch = new Float32Array(256 * 4);

  function hueAt(lut, u) {
    u = u - Math.floor(u);
    var i = Math.min(255, Math.max(0, Math.round(u * 255)));
    var hsv = PAL.rgb2hsv([lut[i * 4], lut[i * 4 + 1], lut[i * 4 + 2]]);
    // a grey stop has no hue to speak of, so fall back to the index itself
    return hsv[1] < 0.06 ? u : hsv[0];
  }

  function harmonyOf(palette, scaleOpt) {
    var lut = PAL.buildLUT(palette, lutScratch);
    var sx = 0, sy = 0, sw = 0;
    for (var i = 0; i < 256; i += 4) {
      var hsv = PAL.rgb2hsv([lut[i * 4], lut[i * 4 + 1], lut[i * 4 + 2]]);
      // weight by saturation: a grey stop has no hue worth averaging
      var w = hsv[1] * hsv[2];
      var a = hsv[0] * Math.PI * 2;
      sx += Math.cos(a) * w; sy += Math.sin(a) * w; sw += w;
    }
    var hue = 0, spread = 1;
    if (sw > 1e-6) {
      hue = Math.atan2(sy, sx) / (Math.PI * 2); hue -= Math.floor(hue);
      // circular variance: 0 when every hue agrees, 1 when they cancel out
      spread = 1 - Math.sqrt(sx * sx + sy * sy) / sw;
    }

    var name;
    if (scaleOpt && scaleOpt !== 'auto') name = scaleOpt;
    else name = SCALE_BY_MODE[palette && palette.mode] || spreadScale(spread);

    return {
      lut: lut,
      // C2 through C3 - low enough to sit under everything the voices do.
      // The mean is a circular one over the whole gradient, so it does not
      // move when the palette rotates: rotating turns the colours without
      // changing the sheep's key. What rotate does move is each voice's own
      // hue lookup below, which is the transposition.
      root: 65.406 * Math.pow(2, hue),
      spread: spread,
      scaleName: name === 'off' ? 'off' : (SCALES[name] ? name : 'pentatonic'),
      scale: name === 'off' ? null : (SCALES[name] || SCALES.pentatonic)
    };
  }

  /* ---------------- one transform, read as a voice ------------------- */
  function describeVoice(xf, i, sumW, harm) {
    var d = GEN.decomposeAffine(xf.affine);
    var lx = clamp(finite(d.lx, 1), 1e-4, 64);
    var ly = clamp(finite(d.ly, 1), 1e-4, 64);

    /* Pitch from the contraction ratio. A map that repeats the picture at
       every scale s repeats the spectrum at the same ratio, so the
       geometric mean of the two axis scales is -12*log2(s) semitones up
       from the root. Colour then spreads the voices across an octave:
       colour index is already the transform's identity dimension, and it
       is what the palette indexes, so two transforms of the same shape
       but different colour should not land on the same note. */
    var s = Math.sqrt(lx * ly);
    var hue = hueAt(harm.lut, xf.color || 0);
    var raw = clamp(-12 * Math.log(s) / Math.LN2, -12, 48) + hue * 12;
    var semis = quantise(raw, harm.scale);
    var freq = clamp(harm.root * Math.pow(2, semis / 12), 25, 9000);

    /* Anisotropy: a transform that stretches the attractor along one axis
       stretches the spectrum too. */
    var aniso = clamp(Math.abs(Math.log(lx / ly) / Math.LN2), 0, 3);

    var bright = 0, noise = 0, inhar = 0, reson = 0, fold = 0, ratio = 1;
    var tw = 0, signed = 0, best = 0;
    for (var k = 0; k < xf.vars.length; k++) {
      var sv = xf.vars[k];
      var a = Math.abs(sv.w || 0);
      if (a < 1e-6) continue;
      var row = timbreRow(sv.v);
      tw += a; signed += sv.w;
      bright += a * row[0]; noise += a * row[1]; inhar += a * row[2];
      reson += a * row[3]; fold += a * row[4];
      // the FM ratio comes from whichever variation dominates the stack
      var rp = RATIO_PARAM[sv.v];
      if (rp !== undefined && a > best) {
        best = a;
        ratio = clamp(Math.round(Math.abs((sv.p && sv.p[rp]) || 2)), 1, 9);
      }
    }
    if (tw > 1e-6) {
      bright /= tw; noise /= tw; inhar /= tw; reson /= tw; fold /= tw;
    } else {
      bright = TIMBRE_DEFAULT[0]; noise = TIMBRE_DEFAULT[1]; inhar = TIMBRE_DEFAULT[2];
      reson = TIMBRE_DEFAULT[3]; fold = TIMBRE_DEFAULT[4];
    }

    var level = sumW > 1e-9 ? (Math.max(0, xf.weight) / sumW) * clamp(xf.opacity, 0, 1) : 0;

    return {
      i: i,
      on: level > 1e-4,
      // signed weights are real: a negative stack draws the same shape
      // inside out, so it plays the same note in anti-phase
      invert: signed < 0,
      level: clamp(level, 0, 1),
      freq: freq,
      pan: clamp(Math.sin(finite(d.ax, 0)), -1, 1),
      // colour speed is how fast a point settles into its colour, so it is
      // how fast a voice settles onto its pitch
      glide: 0.01 + clamp(finite(xf.colorSpeed, 0.5), 0, 1) * 0.35,
      hue: hue,
      bright: clamp(bright, 0, 1),
      noise: clamp(noise, 0, 1),
      inhar: clamp(inhar, 0, 1),
      reson: clamp(reson + aniso * 0.25, 0, 1.6),
      fold: clamp(fold, 0, 1),
      ratio: ratio
    };
  }

  function silentVoice(i) {
    return {
      i: i, on: false, invert: false, level: 0, freq: 110, pan: 0, glide: 0.1, hue: 0,
      bright: 0.3, noise: 0, inhar: 0, reson: 0.1, fold: 0, ratio: 1
    };
  }

  /* ---------------- the sequence -------------------------------------
     The picture is drawn by a token hopping between transforms: one is
     chosen with probability proportional to its weight, and xaos[i][j]
     decides which may follow which. Run the identical hop at six notes a
     second instead of a million and every landing is a note, so the
     melody and the image are the same process at two rates rather than
     two systems that happen to sit in one app.

     It also gives xaos something to be. It is the most abstract control
     in the whole interface - a matrix of transition weights whose effect
     on a picture is diffuse - and here a sparse one is the difference
     between a wandering line and a riff you can whistle.

     What goes in the spec is the transition table; the token itself lives
     in the engine, because a pure function cannot carry a walk. The seed
     travels with it so the walk is reproducible: the same sheep plays the
     same riff, on any machine, today and next year. */
  function sequenceOf(g, xf, sumW, opts, loopSecs) {
    var n = Math.min(xf.length, MAX_VOICES);
    var mix = clamp(finite(opts.seqMix, 0.6), 0, 1);
    if (!n || mix < 0.001) return { on: false, mix: 0, steps: 1, rate: 1, seed: 0, n: 0, weights: null, xaos: null, attack: 0.01, hold: 0.1 };

    var w = [], i, j;
    for (i = 0; i < n; i++) w.push(sumW > 1e-9 ? Math.max(0, xf[i].weight || 0) / sumW : 1 / n);

    /* xaos is stored per transform as outgoing multipliers, null meaning
       all ones. Copied rather than referenced: the genome handed to us is
       a frame of an animation and will be thrown away. */
    var xa = null;
    for (i = 0; i < n; i++) {
      if (!xf[i].xaos) continue;
      xa = [];
      for (var a = 0; a < n; a++) {
        var row = [];
        for (j = 0; j < n; j++) row.push(xf[a].xaos ? Math.max(0, finite(xf[a].xaos[j], 1)) : 1);
        xa.push(row);
      }
      break;
    }

    /* Whole steps per loop, for the same reason animator cycles are whole
       numbers: a fraction would not close. With no loop to fit, the rate
       is simply the rate asked for. */
    var per = clamp(finite(opts.steps, 6), 1, 16);
    var steps, rate;
    if (loopSecs > 0) {
      steps = Math.max(1, Math.min(256, Math.round(loopSecs * per)));
      rate = steps / loopSecs;
    } else {
      steps = 16;
      rate = per;
    }

    var dur = 1 / rate;
    return {
      on: true,
      mix: mix,
      steps: steps,
      rate: rate,
      seed: (g.seed >>> 0) || 1,
      n: n,
      weights: w,
      xaos: xa,
      // density estimation smooths the sparse outer regions of a picture;
      // smoothing the front of a note is the same move in time
      attack: 0.004 + (g.render && g.render.de ? clamp(finite(g.render.deRadius, 1.6), 0, 6) * 0.012 : 0),
      // always finished before the next step lands, so a note never has to
      // be cut off - which is where clicks come from
      hold: dur * 0.9
    };
  }

  /* ---------------- the whole sheep ----------------------------------
     `opts` carries the listener's preferences - scale lock, note rate,
     how much sequence against how much drone. They are arguments rather
     than module state so this stays a pure function of its inputs, which
     is what lets an offline render call it on a schedule of t. */
  var DEFAULT_OPTS = { scale: 'auto', steps: 6, seqMix: 0.6 };

  function describe(g, opts) {
    opts = opts || DEFAULT_OPTS;
    var r = g.render || {};
    var cam = g.camera || {};
    var xf = g.xforms || [];

    var sumW = 0, i;
    for (i = 0; i < xf.length && i < MAX_VOICES; i++) sumW += Math.max(0, xf[i].weight || 0);

    var harm = harmonyOf(g.palette, opts.scale);
    var voices = [];
    for (i = 0; i < MAX_VOICES; i++) {
      voices.push(i < xf.length ? describeVoice(xf[i], i, sumW, harm) : silentVoice(i));
    }

    /* The bus. Only the parts that are genuinely a tone curve or a
       framing decision are wired at this stage; glow, symmetry and
       saturation join later as reverb, detuned copies and stereo width.
       The final transform is applied to every point before it lands, so
       it belongs here rather than in a voice - for now it only biases the
       master filter, which is enough to make a sheep with one sound
       different from a sheep without. */
    var zoom = clamp(finite(cam.zoom, 0.45), 0.02, 40);
    var cutoff = 1400 * Math.pow(zoom / 0.45, 0.55);
    if (g.final) {
      var fv = describeVoice(g.final, -1, 1, harm);
      cutoff *= 0.65 + fv.bright * 0.9;
    }
    // the vignette darkens the edges of the picture; it rolls off the top
    // of the spectrum in the same spirit
    cutoff *= 1 - clamp(finite(r.vignette, 0), 0, 1) * 0.45;

    return {
      root: harm.root,
      scale: harm.scaleName,
      spread: harm.spread,
      master: {
        // brightness is the exposure of the picture, so it is the level
        // of the mix; it is quoted around 3.2, which is unity here
        gain: clamp(finite(r.brightness, 3.2) / 3.2, 0.25, 2.2),
        cutoff: clamp(cutoff, 160, 14000),
        // grain is literally a noise floor in both media
        hiss: clamp(finite(r.grain, 0), 0, 1) * 0.06
      },
      voices: voices,
      sequence: sequenceOf(g, xf, sumW, opts, GEN.loopSeconds(g))
    };
  }

  global.FlameSound = {
    MAX_VOICES: MAX_VOICES,
    TIMBRE: TIMBRE,
    SCALES: SCALES,
    SCALE_NAMES: SCALE_NAMES,
    DEFAULT_OPTS: DEFAULT_OPTS,
    describe: describe,
    noteName: noteName
  };
})(typeof window !== 'undefined' ? window : globalThis);
