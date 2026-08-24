/* =====================================================================
   render.js  -  offline high-quality output
   ---------------------------------------------------------------------
   The recorder captures the live view, so its quality is whatever the
   GPU can manage in 1/30th of a second. This renders instead: every
   frame gets a full deep exposure, taking as long as it needs, and the
   frames are encoded with explicit timestamps so the finished video
   plays at the right speed however slow the render was.

   Contains a minimal WebM (EBML) muxer and a store-only ZIP writer so
   the whole thing stays self-contained - no libraries, no network.
   ===================================================================== */
(function (global) {
  'use strict';

  var GEN = global.FlameGenome;
  var EVO = global.FlameEvolve;

  /* ================= EBML / WebM muxer ================= */
  function u8(arr) { return new Uint8Array(arr); }

  function uintBytes(n) {
    var b = [];
    if (n === 0) return u8([0]);
    while (n > 0) { b.unshift(n & 0xff); n = Math.floor(n / 256); }
    return u8(b);
  }

  /* EBML variable-length size marker */
  function vintSize(n) {
    var len = 1, max = 127;
    while (n >= max) { len++; max = Math.pow(2, 7 * len) - 1; }
    var out = new Uint8Array(len);
    var v = n;
    for (var i = len - 1; i >= 0; i--) { out[i] = v & 0xff; v = Math.floor(v / 256); }
    out[0] |= (1 << (8 - len));
    return out;
  }

  function idBytes(id) {
    var b = [];
    var n = id;
    while (n > 0) { b.unshift(n & 0xff); n = Math.floor(n / 256); }
    return u8(b);
  }

  function concat(parts) {
    var len = 0, i;
    for (i = 0; i < parts.length; i++) len += parts[i].length;
    var out = new Uint8Array(len), off = 0;
    for (i = 0; i < parts.length; i++) { out.set(parts[i], off); off += parts[i].length; }
    return out;
  }

  function el(id, payload) {
    return concat([idBytes(id), vintSize(payload.length), payload]);
  }
  function elUint(id, value) { return el(id, uintBytes(value)); }
  function elStr(id, str) {
    var b = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) b[i] = str.charCodeAt(i) & 0xff;
    return el(id, b);
  }
  function elFloat(id, value) {
    var buf = new ArrayBuffer(8);
    new DataView(buf).setFloat64(0, value, false);
    return el(id, new Uint8Array(buf));
  }

  var ID = {
    EBML: 0x1A45DFA3, EBMLVersion: 0x4286, EBMLReadVersion: 0x42F7,
    EBMLMaxIDLength: 0x42F2, EBMLMaxSizeLength: 0x42F3,
    DocType: 0x4282, DocTypeVersion: 0x4287, DocTypeReadVersion: 0x4285,
    Segment: 0x18538067, Info: 0x1549A966, TimecodeScale: 0x2AD7B1,
    MuxingApp: 0x4D80, WritingApp: 0x5741, Duration: 0x4489,
    Tracks: 0x1654AE6B, TrackEntry: 0xAE, TrackNumber: 0xD7, TrackUID: 0x73C5,
    TrackType: 0x83, CodecID: 0x86, Video: 0xE0, PixelWidth: 0xB0, PixelHeight: 0xBA,
    DefaultDuration: 0x23E383,
    Cluster: 0x1F43B675, Timecode: 0xE7, SimpleBlock: 0xA3
  };

  /* frames: [{data:Uint8Array, timeMs:Number, key:Boolean}] */
  function muxWebM(frames, opts) {
    var w = opts.width, h = opts.height;
    var codecId = opts.codec.indexOf('vp8') === 0 ? 'V_VP8'
      : (opts.codec.indexOf('av01') === 0 ? 'V_AV1' : 'V_VP9');

    var header = el(ID.EBML, concat([
      elUint(ID.EBMLVersion, 1), elUint(ID.EBMLReadVersion, 1),
      elUint(ID.EBMLMaxIDLength, 4), elUint(ID.EBMLMaxSizeLength, 8),
      elStr(ID.DocType, 'webm'), elUint(ID.DocTypeVersion, 2), elUint(ID.DocTypeReadVersion, 2)
    ]));

    var durMs = frames.length ? (frames[frames.length - 1].timeMs + (opts.frameDurMs || 0)) : 0;
    var info = el(ID.Info, concat([
      elUint(ID.TimecodeScale, 1000000),          // 1 ms
      elStr(ID.MuxingApp, 'electric-sheep-local'),
      elStr(ID.WritingApp, 'electric-sheep-local'),
      elFloat(ID.Duration, durMs)
    ]));

    var videoEl = el(ID.Video, concat([elUint(ID.PixelWidth, w), elUint(ID.PixelHeight, h)]));
    var trackEntry = el(ID.TrackEntry, concat([
      elUint(ID.TrackNumber, 1), elUint(ID.TrackUID, 1), elUint(ID.TrackType, 1),
      elStr(ID.CodecID, codecId),
      elUint(ID.DefaultDuration, Math.round((opts.frameDurMs || 33) * 1e6)),
      videoEl
    ]));
    var tracks = el(ID.Tracks, trackEntry);

    // one cluster per keyframe (block timecodes are int16 relative to it)
    var clusters = [], cur = null, curBase = 0;
    function flushCluster() {
      if (!cur || !cur.length) return;
      clusters.push(el(ID.Cluster, concat([elUint(ID.Timecode, curBase)].concat(cur))));
      cur = null;
    }
    for (var i = 0; i < frames.length; i++) {
      var f = frames[i];
      if (!cur || f.key || (f.timeMs - curBase) > 30000) { flushCluster(); cur = []; curBase = f.timeMs; }
      var rel = f.timeMs - curBase;
      var head = new Uint8Array(4);
      head[0] = 0x81;                              // track 1, EBML vint
      head[1] = (rel >> 8) & 0xff; head[2] = rel & 0xff;
      head[3] = f.key ? 0x80 : 0x00;
      cur.push(el(ID.SimpleBlock, concat([head, f.data])));
    }
    flushCluster();

    var segBody = concat([info, tracks].concat(clusters));
    return new Blob([header, el(ID.Segment, segBody)], { type: 'video/webm' });
  }

  /* ================= store-only ZIP ================= */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(buf) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function le(n, bytes) {
    var out = new Uint8Array(bytes);
    for (var i = 0; i < bytes; i++) { out[i] = n & 0xff; n = Math.floor(n / 256); }
    return out;
  }
  function strBytes(s) {
    var b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
    return b;
  }

  function ZipWriter() { this.files = []; this.parts = []; this.offset = 0; }
  ZipWriter.prototype.add = function (name, data) {
    var nb = strBytes(name), c = crc32(data);
    var local = concat([
      le(0x04034b50, 4), le(20, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 2),
      le(c, 4), le(data.length, 4), le(data.length, 4), le(nb.length, 2), le(0, 2), nb
    ]);
    this.files.push({ name: nb, crc: c, size: data.length, offset: this.offset });
    this.parts.push(local, data);
    this.offset += local.length + data.length;
  };
  ZipWriter.prototype.blob = function () {
    var central = [], i;
    for (i = 0; i < this.files.length; i++) {
      var f = this.files[i];
      central.push(concat([
        le(0x02014b50, 4), le(20, 2), le(20, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 2),
        le(f.crc, 4), le(f.size, 4), le(f.size, 4), le(f.name.length, 2),
        le(0, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 4), le(f.offset, 4), f.name
      ]));
    }
    var cd = concat(central);
    var end = concat([
      le(0x06054b50, 4), le(0, 2), le(0, 2),
      le(this.files.length, 2), le(this.files.length, 2),
      le(cd.length, 4), le(this.offset, 4), le(0, 2)
    ]);
    return new Blob(this.parts.concat([cd, end]), { type: 'application/zip' });
  };

  /* ================= the render timeline =================
     A pure description of what should be on screen at time t, built
     entirely up front so the render is deterministic and can be sampled
     at any instant (including several times per output frame for
     motion blur).                                                       */
  function buildTimeline(entries, opts) {
    var segs = [], t = 0, phase = 0;
    var hold = Math.max(0.2, opts.holdSecs || 4);
    var trans = Math.max(0.1, opts.transSecs || 3);
    var loops = Math.max(1, opts.loopsPerSheep || 1);
    if (!entries.length) return { segments: [], duration: 0 };

    var i = 0, guard = 0;
    while (t < opts.seconds && guard++ < 10000) {
      var g = entries[i % entries.length];
      var len = opts.loopOverride ? opts.loopSecs : GEN.loopSeconds(g);
      if (len && opts.loopOverride) len = opts.loopSecs;
      var playDur = len > 0 ? len * loops : hold;
      segs.push({ kind: 'play', genome: g, start: t, dur: playDur, loopLen: len, phase0: phase });
      phase += len > 0 ? playDur / len : 0;
      t += playDur;
      if (t >= opts.seconds) break;
      var nextG = entries[(i + 1) % entries.length];
      var nlen = opts.loopOverride ? opts.loopSecs : GEN.loopSeconds(nextG);
      segs.push({
        kind: 'trans', from: g, to: nextG, start: t, dur: trans,
        loopLen: len || nlen, phase0: phase
      });
      phase += (len || nlen) > 0 ? trans / (len || nlen) : 0;
      t += trans;
      i++;
    }
    return { segments: segs, duration: Math.min(t, opts.seconds) };
  }

  function genomeAt(tl, t) {
    var segs = tl.segments;
    if (!segs.length) return null;
    var s = segs[segs.length - 1];
    for (var i = 0; i < segs.length; i++) {
      if (t < segs[i].start + segs[i].dur) { s = segs[i]; break; }
    }
    var localT = Math.max(0, t - s.start);
    var ph = s.phase0 + (s.loopLen > 0 ? localT / s.loopLen : 0);
    if (s.kind === 'play') return GEN.applyLoop(s.genome, ph);
    var u = Math.max(0, Math.min(1, localT / s.dur));
    return GEN.interpolate(GEN.applyLoop(s.from, ph), GEN.applyLoop(s.to, ph), u, { ease: true });
  }

  global.FlameRender = {
    muxWebM: muxWebM,
    ZipWriter: ZipWriter,
    buildTimeline: buildTimeline,
    genomeAt: genomeAt,
    crc32: crc32
  };
})(typeof window !== 'undefined' ? window : globalThis);
