/* =====================================================================
   audiograph.js  -  the synthesiser that plays what sound.js describes
   ---------------------------------------------------------------------
   One rule holds the whole thing together: THE GRAPH IS BUILT ONCE AND
   NEVER REBUILT. Twelve voices are allocated at startup and a sheep with
   three transforms is a twelve-voice instrument with nine voices at
   silence - the same trick the morph code uses when it fades in a
   transform one sheep does not have, as a silent copy of its counterpart
   rather than something growing out of the middle of the frame.

   The reason is that audio is far less forgiving than pixels. The stream
   already crossfades anything it cannot average - symmetry is a whole
   number of copies, so the two orders are blended and the mirror is a
   probability rather than a switch - and the same discipline is what
   keeps a morph here from clicking. Nothing in apply() creates, destroys
   or reconnects a node. Every value moves by a ramp.

   Per voice:

     fm ─→ fmGain ─┐(frequency)
     sine ─→ gSine ┤                                              ┌→ drone ─┐
     saw  ─→ gSaw  ┼─→ drive ─→ shaper ─→ trim ─→ filter ─→ pan ─→┤         ├→ bus
     noise ─→ gNoise┘                                    (out) ───┴→ env ───┘

   The drone and the note envelope hang off the voice in parallel rather
   than in series. They answer to different owners - drone to apply(), env
   to the step scheduler - and in series they would fight over one
   AudioParam every time the balance moved.

   Master: bus ─→ busFilter ─→ hiss? ─→ masterGain ─→ volume ─→ gate ─→ limiter ─→ out
   ===================================================================== */
(function (global) {
  'use strict';

  var SND = global.FlameSound;

  /* One second of white noise, shared by every voice. Twelve separate
     noise sources would be twelve times the cost for no audible gain -
     each voice colours its own share through its own filter anyway. */
  function noiseBuffer(ctx) {
    var n = Math.floor(ctx.sampleRate);
    var buf = ctx.createBuffer(1, n, ctx.sampleRate);
    var d = buf.getChannelData(0);
    // deterministic: an offline render must produce the same file twice
    var s = 0x2545f491;
    for (var i = 0; i < n; i++) {
      s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      d[i] = (s / 2147483648) - 1;
    }
    return buf;
  }

  /* A soft saturator. Drive is a pre-gain and `trim` undoes the loudness
     it adds, so the fold axis changes the shape without changing the
     level - otherwise a morph towards a folding variation would read as
     a volume swell rather than a change of character. */
  function foldCurve() {
    var n = 1024, c = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(x * 2) / Math.tanh(2);
    }
    return c;
  }

  function param(p, v, t, tc) {
    if (!isFinite(v)) return;
    p.setTargetAtTime(v, t, tc);
  }

  /* ---------------- one voice ---------------------------------------- */
  function Voice(ctx, bus, noiseBuf, curve) {
    var c = this.ctx = ctx;

    this.sine = c.createOscillator(); this.sine.type = 'sine';
    this.saw = c.createOscillator(); this.saw.type = 'sawtooth';
    this.fm = c.createOscillator(); this.fm.type = 'sine';
    this.noise = c.createBufferSource();
    this.noise.buffer = noiseBuf; this.noise.loop = true;

    this.fmGain = c.createGain(); this.fmGain.gain.value = 0;
    this.gSine = c.createGain(); this.gSine.gain.value = 0;
    this.gSaw = c.createGain(); this.gSaw.gain.value = 0;
    this.gNoise = c.createGain(); this.gNoise.gain.value = 0;
    this.drive = c.createGain(); this.drive.gain.value = 1;
    this.trim = c.createGain(); this.trim.gain.value = 1;
    this.out = c.createGain(); this.out.gain.value = 0;
    this.droneG = c.createGain(); this.droneG.gain.value = 1;
    this.env = c.createGain(); this.env.gain.value = 0;

    this.shaper = c.createWaveShaper();
    this.shaper.curve = curve;
    this.shaper.oversample = '2x';

    this.filt = c.createBiquadFilter();
    this.filt.type = 'lowpass';
    this.filt.frequency.value = 800;
    this.filt.Q.value = 0.7;

    // StereoPannerNode is everywhere modern, but an older Safari would
    // throw here and take the whole feature down with it
    this.pan = c.createStereoPanner ? c.createStereoPanner() : null;

    this.fm.connect(this.fmGain);
    this.fmGain.connect(this.sine.frequency);
    this.fmGain.connect(this.saw.frequency);

    this.sine.connect(this.gSine);
    this.saw.connect(this.gSaw);
    this.noise.connect(this.gNoise);
    this.gSine.connect(this.drive);
    this.gSaw.connect(this.drive);
    this.gNoise.connect(this.drive);

    this.drive.connect(this.shaper);
    this.shaper.connect(this.trim);
    this.trim.connect(this.filt);
    if (this.pan) { this.filt.connect(this.pan); this.pan.connect(this.out); }
    else this.filt.connect(this.out);
    this.out.connect(this.droneG); this.droneG.connect(bus);
    this.out.connect(this.env); this.env.connect(bus);
  }

  Voice.prototype.start = function (when) {
    this.sine.start(when); this.saw.start(when);
    this.fm.start(when); this.noise.start(when);
  };

  /* One note. The release always finishes before the next step lands, so
     the value is already zero when setValueAtTime writes zero and there is
     nothing to cut off - which is where clicks come from. Written with
     plain linear ramps for the same reason: cancelAndHoldAtTime would do
     this more precisely and Firefox does not have it. */
  Voice.prototype.trigger = function (when, atk, hold, peak) {
    var g = this.env.gain;
    atk = Math.min(atk, hold * 0.5);
    g.setValueAtTime(0, when);
    g.linearRampToValueAtTime(peak, when + atk);
    g.linearRampToValueAtTime(0, when + hold);
  };

  Voice.prototype.set = function (v, t, gate, drone) {
    param(this.droneG.gain, drone, t, 0.06);
    /* Most sheep have three or four transforms, so most voices are silent
       most of the time. Re-sending a dozen identical values to each of them
       twenty-five times a second is pure waste next to a GPU that wants the
       whole frame. A voice that was already silent and still is only gets
       its output ramp - the nodes stay built and stay connected, so this
       costs nothing when it comes back. */
    var silent = !gate || v.level < 1e-4;
    if (silent && this.wasSilent) { param(this.out.gain, 0, t, 0.06); return; }
    this.wasSilent = silent;

    // pitch follows the transform's colour speed: how fast a point settles
    // into its colour is how fast the voice settles onto its note
    var tc = v.glide;
    param(this.sine.frequency, v.freq, t, tc);
    param(this.saw.frequency, v.freq, t, tc);
    param(this.fm.frequency, v.freq * v.ratio, t, tc);
    param(this.fmGain.gain, v.inhar * v.freq * 0.7, t, 0.05);

    // brightness crossfades sine into saw and opens the filter with it,
    // so the axis moves the whole spectrum rather than only the waveform
    var b = v.bright;
    param(this.gSine.gain, Math.cos(b * Math.PI * 0.5) * 0.55, t, 0.05);
    param(this.gSaw.gain, Math.sin(b * Math.PI * 0.5) * 0.30, t, 0.05);
    param(this.gNoise.gain, v.noise * 0.22, t, 0.05);

    var d = 1 + v.fold * 5;
    param(this.drive.gain, d, t, 0.05);
    param(this.trim.gain, 1 / (1 + v.fold * 2.6), t, 0.05);

    param(this.filt.frequency, Math.min(16000, v.freq * (2.2 + b * 12)), t, 0.05);
    param(this.filt.Q, Math.min(14, 0.7 + v.reson * 7), t, 0.05);
    if (this.pan) param(this.pan.pan, v.pan, t, 0.08);

    // a negative variation stack draws the shape inside out, so it plays
    // in anti-phase - which is only audible against the other voices,
    // exactly as it is only visible against the rest of the picture
    var lvl = gate ? v.level * (v.invert ? -1 : 1) : 0;
    param(this.out.gain, lvl, t, 0.06);
  };

  /* ---------------- the instrument ------------------------------------ */
  function FlameAudio(ctx) {
    this.ctx = ctx;
    this.started = false;
    this.active = false;
    this.volume = 1;
    this.idleTimer = null;
    this.seqNext = 0;       // audio time of the next step
    this.seqIdx = 0;        // position in the pattern
    this.seqCur = 0;        // the transform the token is sitting on
    this.rngState = 1;

    var c = ctx;
    this.bus = c.createGain(); this.bus.gain.value = 1;
    this.busFilt = c.createBiquadFilter();
    this.busFilt.type = 'lowpass';
    this.busFilt.frequency.value = 1400;
    this.busFilt.Q.value = 0.6;
    this.master = c.createGain(); this.master.gain.value = 1;
    this.vol = c.createGain(); this.vol.gain.value = 1;
    /* Turning the sound off fades this and suspends the context; it does
       not throw the context away. A browser allows only a handful of
       AudioContexts per page, so a toggle that built a new one each time
       would work six times and then stop working for the rest of the
       session. */
    this.gate = c.createGain(); this.gate.gain.value = 0;

    // a safety limiter, not the tone-mapping compressor: twelve voices can
    // stack, and nobody should be able to make this hurt
    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = -8;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.004;
    this.limiter.release.value = 0.18;

    // the grain slider's noise floor, mixed straight onto the bus
    this.hiss = c.createBufferSource();
    var buf = noiseBuffer(c);
    this.hiss.buffer = buf; this.hiss.loop = true;
    this.hissGain = c.createGain(); this.hissGain.gain.value = 0;
    this.hiss.connect(this.hissGain);
    this.hissGain.connect(this.master);

    this.bus.connect(this.busFilt);
    this.busFilt.connect(this.master);
    this.master.connect(this.vol);
    this.vol.connect(this.gate);
    this.gate.connect(this.limiter);
    this.limiter.connect(c.destination);

    var curve = foldCurve();
    this.voices = [];
    for (var i = 0; i < SND.MAX_VOICES; i++) {
      this.voices.push(new Voice(c, this.bus, buf, curve));
    }
  }

  FlameAudio.prototype.start = function () {
    if (this.started) return;
    this.started = true;
    var t = this.ctx.currentTime;
    for (var i = 0; i < this.voices.length; i++) this.voices[i].start(t);
    this.hiss.start(t);
  };

  FlameAudio.prototype.setVolume = function (v) {
    this.volume = Math.max(0, Math.min(1, v));
    param(this.vol.gain, this.volume, this.ctx.currentTime, 0.03);
  };

  /* On and off, without tearing anything down. The fade comes first and the
     context is suspended behind it, so switching off is a fade rather than
     a click and switching back on picks up where it left off. */
  FlameAudio.prototype.setActive = function (on) {
    var self = this;
    this.active = !!on;
    if (on) {
      if (this.ctx.state === 'suspended' && this.ctx.resume) this.ctx.resume();
      param(this.gate.gain, 1, this.ctx.currentTime, 0.05);
    } else {
      param(this.gate.gain, 0, this.ctx.currentTime, 0.04);
      clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(function () {
        if (!self.active && self.ctx.state === 'running' && self.ctx.suspend) self.ctx.suspend();
      }, 400);
    }
  };

  /* `gate` is the app's play state: a frozen picture makes no sound. The
     voices are gated rather than stopped, so resuming is a fade rather
     than a restart and the oscillators keep their phase. */
  FlameAudio.prototype.apply = function (spec, gate) {
    var t = this.ctx.currentTime;
    param(this.busFilt.frequency, spec.master.cutoff, t, 0.06);
    param(this.master.gain, spec.master.gain, t, 0.06);
    param(this.hissGain.gain, gate ? spec.master.hiss : 0, t, 0.1);
    var seq = spec.sequence;
    var drone = (seq && seq.on) ? 1 - seq.mix : 1;
    for (var i = 0; i < this.voices.length; i++) {
      this.voices[i].set(spec.voices[i], t, gate, drone);
    }
    if (seq) this.runSeq(seq, gate, t);
  };

  /* ---------------- the chaos game, at six notes a second --------------
     Exactly the draw the renderer's inner loop makes - a transform picked
     with probability proportional to its weight, gated by xaos - only
     slowly enough to hear. The token has to live here rather than in the
     spec because a pure function cannot carry a walk.

     Notes are scheduled on the audio clock rather than on frames. The
     frame loop deliberately clamps animation to 50ms so a hitch costs a
     little speed instead of a jump, which is right for a picture and
     wrong for a sequence: on frames, a dropped frame would be a dropped
     note. So parameters follow requestAnimationFrame and note scheduling
     follows currentTime, with enough lookahead to ride out a stutter. */
  var LOOKAHEAD = 0.14;

  FlameAudio.prototype.rnd = function () {
    var s = this.rngState >>> 0;
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    this.rngState = s;
    return s / 4294967296;
  };

  FlameAudio.prototype.pickNext = function (cur, s) {
    var n = s.n, w = s.weights, x = s.xaos, i, tot = 0;
    if (!(cur >= 0 && cur < n)) cur = 0;
    for (i = 0; i < n; i++) tot += w[i] * (x ? x[cur][i] : 1);
    // xaos can close every door out of a transform; step on rather than hang
    if (!(tot > 0)) return (cur + 1) % n;
    var r = this.rnd() * tot, acc = 0;
    for (i = 0; i < n; i++) {
      acc += w[i] * (x ? x[cur][i] : 1);
      if (r < acc) return i;
    }
    return n - 1;
  };

  FlameAudio.prototype.runSeq = function (s, gate, t) {
    if (!s.on || !gate) { this.seqNext = 0; return; }
    var dur = 1 / s.rate;
    if (!this.seqNext || this.seqNext < t - 1) {
      // first note, or back from a hidden tab: start clean rather than
      // trying to make up for the silence
      this.seqNext = t + 0.05;
      this.seqIdx = 0;
      this.seqCur = 0;
      this.rngState = s.seed;
    } else if (this.seqNext < t) {
      // a hitch: skip the notes that went past rather than firing them all
      // at once, and keep the position in the pattern
      var miss = Math.ceil((t - this.seqNext) / dur);
      this.seqNext += miss * dur;
      this.seqIdx += miss;
    }
    var guard = 0;
    while (this.seqNext < t + LOOKAHEAD && guard++ < 64) {
      // re-seeding every `steps` is what makes the riff repeat: steps is a
      // whole number per loop, so the pattern comes round with the picture
      if (this.seqIdx % s.steps === 0) this.rngState = s.seed;
      this.seqCur = this.pickNext(this.seqCur, s);
      var v = this.voices[this.seqCur];
      if (v) v.trigger(this.seqNext, s.attack, Math.min(s.hold, dur * 0.95), s.mix);
      this.seqNext += dur;
      this.seqIdx++;
    }
  };

  global.FlameAudio = FlameAudio;
})(typeof window !== 'undefined' ? window : globalThis);
