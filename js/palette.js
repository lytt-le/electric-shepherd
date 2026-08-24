/* =====================================================================
   palette.js  -  deterministic colour palettes for sheep
   ===================================================================== */
(function (global) {
  'use strict';

  function rngFrom(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  function hex2rgb(h) {
    var n = parseInt(h.replace('#', ''), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  function rgb2hex(c) {
    function b(x) { var v = Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16); return v.length < 2 ? '0' + v : v; }
    return '#' + b(c[0]) + b(c[1]) + b(c[2]);
  }

  function hsv2rgb(h, s, v) {
    h = ((h % 1) + 1) % 1;
    var i = Math.floor(h * 6), f = h * 6 - i;
    var p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    switch (i % 6) {
      case 0: return [v, t, p];
      case 1: return [q, v, p];
      case 2: return [p, v, t];
      case 3: return [p, q, v];
      case 4: return [t, p, v];
      default: return [v, p, q];
    }
  }
  function rgb2hsv(c) {
    var r = c[0], g = c[1], b = c[2];
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    var h = 0;
    if (d > 0) {
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6; if (h < 0) h += 1;
    }
    return [h, mx === 0 ? 0 : d / mx, mx];
  }

  /* ---- curated presets (name -> list of hex stops) ---- */
  var PRESETS = {
    'ember':        ['#050208', '#3d0a1e', '#a11d33', '#f26522', '#ffd166', '#fff6e0'],
    'deep sea':     ['#01050f', '#032b44', '#046d8b', '#309292', '#8cd790', '#f2f7c4'],
    'aurora':       ['#02030a', '#123c69', '#12b886', '#8ce99a', '#e599f7', '#ffffff'],
    'magma':        ['#000004', '#2c115f', '#721f81', '#b73779', '#f1605d', '#feb078', '#fcfdbf'],
    'viridis':      ['#440154', '#414487', '#2a788e', '#22a884', '#7ad151', '#fde725'],
    'twilight':     ['#0d0221', '#2c0735', '#6a2c70', '#b83b5e', '#f08a5d', '#f9ed69'],
    'neon':         ['#03001e', '#7303c0', '#ec38bc', '#fdeff9', '#00f5d4', '#00bbf9'],
    'gold leaf':    ['#0b0700', '#3b2507', '#8a5a1d', '#d4a04a', '#f7e2a1', '#fffdf5'],
    'ice':          ['#00030d', '#062c4b', '#1b6ca8', '#57c5f7', '#b8f1ff', '#ffffff'],
    'blood orange': ['#0a0000', '#3d0000', '#8c1c13', '#bf4342', '#e7d7c1', '#f5f0e1'],
    'jade':         ['#001410', '#013220', '#0f7b5f', '#4ecca3', '#b8f2e6', '#f6fff8'],
    'ultraviolet':  ['#05010f', '#1a0b3d', '#4b1d8f', '#8a4fff', '#c9a7ff', '#f2e9ff'],
    'sunset strip': ['#0f0326', '#451952', '#a91d3a', '#f26b0f', '#fcdc94', '#fff8e7'],
    'monochrome':   ['#000000', '#2b2b2b', '#6e6e6e', '#b4b4b4', '#ffffff'],
    'sepia':        ['#0c0803', '#33230f', '#6b4b26', '#a97c50', '#d9bb92', '#f4ead6'],
    'cyberpunk':    ['#010b13', '#0b3954', '#087e8b', '#ff5a5f', '#ffdd4a', '#f5f5f5'],
    'peacock':      ['#02111b', '#0b3948', '#0f7173', '#2bc4a9', '#d8e4e8', '#f0efeb'],
    'candy':        ['#12002e', '#5b0e8b', '#e5289e', '#ff8ac6', '#ffe0ef', '#ffffff'],
    'forest floor': ['#050a03', '#1b3009', '#41601b', '#7d9a3c', '#c3c98a', '#efe9c4'],
    'plasma':       ['#0d0887', '#6a00a8', '#b12a90', '#e16462', '#fca636', '#f0f921'],
    'inferno':      ['#000004', '#420a68', '#932667', '#dd513a', '#fca50a', '#fcffa4'],
    'nebula':       ['#01000e', '#160a3a', '#4a1e8c', '#9d3bd6', '#ff7bc4', '#ffe8f6'],
    'copper':       ['#0a0403', '#331810', '#7a3b23', '#c26b3d', '#e8a87c', '#f8e3cf'],
    'arctic dusk':  ['#050914', '#152238', '#2f4b7c', '#6e93c4', '#bcd4e6', '#f2f6fb'],
    'poison':       ['#020a02', '#0d2818', '#1f7a3a', '#8fd14f', '#e4ff5c', '#fbffe4'],
    'rose quartz':  ['#12060c', '#3d1128', '#7d2a4d', '#c76b8b', '#f0b8c4', '#fff0f3'],
    'oil slick':    ['#000000', '#12263a', '#06bcc1', '#c5d8d1', '#f4d35e', '#ee964b'],
    'ash':          ['#08080a', '#1f2124', '#4a4e54', '#8e949c', '#c8ced6', '#eef1f5'],
    'volcanic':     ['#000000', '#1a0000', '#5c0a0a', '#c1272d', '#f7931e', '#fff200', '#ffffff'],
    'seafoam':      ['#03110f', '#0b2f2a', '#1f6f5c', '#5cc8a0', '#b8e6d0', '#f2fff9']
  };
  var PRESET_NAMES = Object.keys(PRESETS);

  var GEN_MODES = ['preset', 'hue-walk', 'complementary', 'triadic', 'analogous', 'mono', 'random-smooth'];

  /* Build the stop list for a palette descriptor. */
  function makeStops(pal) {
    var rnd = rngFrom(pal.seed);
    var stops = [];
    var i, n;
    switch (pal.mode) {
      case 'preset': {
        var name = pal.preset;
        if (!PRESETS[name]) name = PRESET_NAMES[Math.floor(rnd() * PRESET_NAMES.length)];
        var hs = PRESETS[name];
        for (i = 0; i < hs.length; i++) stops.push({ p: i / (hs.length - 1), c: hex2rgb(hs[i]) });
        break;
      }
      case 'hue-walk': {
        n = 4 + Math.floor(rnd() * 5);
        var h = rnd(), step = (rnd() * 0.5 - 0.25);
        for (i = 0; i < n; i++) {
          h += step / n + (rnd() - 0.5) * 0.06;
          var s = 0.45 + rnd() * 0.55;
          var vv = 0.12 + 0.88 * (i / (n - 1));
          stops.push({ p: i / (n - 1), c: hsv2rgb(h, s, vv) });
        }
        break;
      }
      case 'complementary': {
        var h0 = rnd(), h1 = h0 + 0.5;
        n = 6;
        for (i = 0; i < n; i++) {
          var t = i / (n - 1);
          var hh = t < 0.5 ? h0 : h1;
          stops.push({ p: t, c: hsv2rgb(hh + (rnd() - 0.5) * 0.05, 0.35 + 0.6 * (1 - Math.abs(t - 0.5) * 2), 0.08 + 0.92 * t) });
        }
        break;
      }
      case 'triadic': {
        var hb = rnd(); n = 7;
        for (i = 0; i < n; i++) {
          var tt = i / (n - 1);
          var hi = hb + Math.floor(tt * 3) / 3;
          stops.push({ p: tt, c: hsv2rgb(hi, 0.5 + rnd() * 0.5, 0.1 + 0.9 * tt) });
        }
        break;
      }
      case 'analogous': {
        var ha = rnd(), spread = 0.06 + rnd() * 0.14; n = 6;
        for (i = 0; i < n; i++) {
          var ta = i / (n - 1);
          stops.push({ p: ta, c: hsv2rgb(ha + (ta - 0.5) * spread * 2, 0.4 + rnd() * 0.6, 0.06 + 0.94 * ta) });
        }
        break;
      }
      case 'mono': {
        var hm = rnd(), sm = 0.2 + rnd() * 0.7; n = 5;
        for (i = 0; i < n; i++) {
          var tm = i / (n - 1);
          stops.push({ p: tm, c: hsv2rgb(hm, sm * (1 - tm * 0.6), 0.03 + 0.97 * tm) });
        }
        break;
      }
      default: { // random-smooth
        n = 3 + Math.floor(rnd() * 6);
        for (i = 0; i < n; i++) {
          stops.push({ p: i / (n - 1), c: [rnd(), rnd(), rnd()] });
        }
        // enforce a dark end so the flame has depth
        stops[0].c = [stops[0].c[0] * 0.08, stops[0].c[1] * 0.08, stops[0].c[2] * 0.08];
        break;
      }
    }
    return stops;
  }

  function defaultPalette(seed) {
    return {
      mode: 'preset',
      preset: PRESET_NAMES[Math.abs(seed | 0) % PRESET_NAMES.length],
      seed: (seed >>> 0) || 12345,
      stops: null,          // filled lazily; when present it overrides mode
      rotate: 0,            // shift along the index
      hueShift: 0,
      saturation: 1,
      value: 1,
      contrast: 1,
      reverse: false,
      smooth: true
    };
  }

  /* Resolve to a 256-entry Float32Array of RGB (length 256*4). */
  function buildLUT(pal, out) {
    out = out || new Float32Array(256 * 4);
    var stops = (pal.stops && pal.stops.length >= 2) ? pal.stops : makeStops(pal);
    var n = stops.length;
    for (var i = 0; i < 256; i++) {
      var t = i / 255;
      var u = t - (pal.rotate || 0);
      u = u - Math.floor(u);
      if (pal.reverse) u = 1 - u;
      // find segment
      var k = 0;
      while (k < n - 2 && stops[k + 1].p < u) k++;
      var p0 = stops[k].p, p1 = stops[k + 1].p;
      var f = (p1 > p0) ? (u - p0) / (p1 - p0) : 0;
      f = Math.max(0, Math.min(1, f));
      if (pal.smooth !== false) f = f * f * (3 - 2 * f);
      var c0 = stops[k].c, c1 = stops[k + 1].c;
      var c = [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
      if (pal.hueShift || pal.saturation !== 1 || pal.value !== 1) {
        var h = rgb2hsv(c);
        h[0] = (h[0] + (pal.hueShift || 0)) % 1;
        h[1] = Math.max(0, Math.min(1, h[1] * (pal.saturation === undefined ? 1 : pal.saturation)));
        h[2] = Math.max(0, Math.min(1, h[2] * (pal.value === undefined ? 1 : pal.value)));
        c = hsv2rgb(h[0], h[1], h[2]);
      }
      if (pal.contrast !== 1 && pal.contrast !== undefined) {
        c = [(c[0] - 0.5) * pal.contrast + 0.5, (c[1] - 0.5) * pal.contrast + 0.5, (c[2] - 0.5) * pal.contrast + 0.5];
      }
      out[i * 4] = Math.max(0, c[0]);
      out[i * 4 + 1] = Math.max(0, c[1]);
      out[i * 4 + 2] = Math.max(0, c[2]);
      out[i * 4 + 3] = 1;
    }
    return out;
  }

  function randomPalette(rnd) {
    var mode = GEN_MODES[Math.floor(rnd() * GEN_MODES.length)];
    if (rnd() < 0.45) mode = 'preset';
    var p = defaultPalette(Math.floor(rnd() * 1e9));
    p.mode = mode;
    p.seed = Math.floor(rnd() * 1e9) >>> 0;
    p.preset = PRESET_NAMES[Math.floor(rnd() * PRESET_NAMES.length)];
    p.stops = null;
    p.rotate = rnd() < 0.3 ? rnd() : 0;
    p.reverse = rnd() < 0.25;
    return p;
  }

  /* Freeze the generated stops into the palette so it is fully portable. */
  function bake(pal) {
    if (!pal.stops || pal.stops.length < 2) pal.stops = makeStops(pal);
    return pal;
  }

  /* Interpolate two palettes by resampling both to 256 and blending. */
  function lerpPalette(a, b, t) {
    var la = buildLUT(a), lb = buildLUT(b);
    var stops = [];
    var N = 16;
    for (var i = 0; i < N; i++) {
      var idx = Math.round(i / (N - 1) * 255);
      stops.push({
        p: i / (N - 1),
        c: [
          la[idx * 4] + (lb[idx * 4] - la[idx * 4]) * t,
          la[idx * 4 + 1] + (lb[idx * 4 + 1] - la[idx * 4 + 1]) * t,
          la[idx * 4 + 2] + (lb[idx * 4 + 2] - la[idx * 4 + 2]) * t
        ]
      });
    }
    return {
      mode: 'stops', preset: null, seed: a.seed, stops: stops,
      rotate: 0, hueShift: 0, saturation: 1, value: 1, contrast: 1,
      reverse: false, smooth: true
    };
  }

  global.FlamePalette = {
    PRESETS: PRESETS,
    PRESET_NAMES: PRESET_NAMES,
    GEN_MODES: GEN_MODES,
    hex2rgb: hex2rgb,
    rgb2hex: rgb2hex,
    hsv2rgb: hsv2rgb,
    rgb2hsv: rgb2hsv,
    makeStops: makeStops,
    defaultPalette: defaultPalette,
    randomPalette: randomPalette,
    buildLUT: buildLUT,
    bake: bake,
    lerp: lerpPalette,
    rngFrom: rngFrom
  };
})(typeof window !== 'undefined' ? window : globalThis);
