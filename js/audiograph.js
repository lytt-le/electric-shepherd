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

   Master: bus ─→ busFilter ─┬→ dry ────────────────┐
                             └→ send ─→ reverb ─────┤
                                                    ↓
     ─→ chorus/width ─→ autopan ─→ comp ─→ masterGain ─→ volume ─→ gate ─→ limiter ─→ out

   The reverb is four feedback combs and a pair of diffusers rather than
   a convolver, for one reason: every control has to be continuous. A
   convolver's tail lives in its impulse response, and changing the room
   size means swapping the buffer, which is exactly the kind of switch
   this file exists to avoid. Comb delay times and feedback gains are
   AudioParams and ramp like everything else.
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
      c[i] = Math.tanh(x * 1.3) / Math.tanh(1.3);
    }
    return c;
  }

  /* A feedback comb: the delay is inside the loop, which is what makes
     the cycle legal in Web Audio, and the lowpass in the loop is what
     makes each pass round darker than the last, the way a real room is. */
  function Comb(c, base, sink) {
    this.base = base;
    this.delay = c.createDelay(0.3);
    this.delay.delayTime.value = base;
    this.damp = c.createBiquadFilter();
    this.damp.type = 'lowpass';
    this.damp.frequency.value = 5000;
    this.fb = c.createGain();
    this.fb.gain.value = 0.6;
    this.delay.connect(this.damp);
    this.damp.connect(this.fb);
    this.fb.connect(this.delay);
    this.delay.connect(sink);
  }
  Comb.prototype.set = function (size, fb, damp, t) {
    param(this.delay.delayTime, this.base * (0.4 + size * 1.6), t, 0.2);
    param(this.fb.gain, fb, t, 0.2);
    param(this.damp.frequency, 1200 + (1 - damp) * 9000, t, 0.2);
  };

  /* A short delay with feedback, smearing what the combs produce into
     something without an obvious pulse. Fixed: nothing in the picture has
     an opinion about diffusion. */
  function diffuser(c, time, sink) {
    var d = c.createDelay(0.05), fb = c.createGain();
    d.delayTime.value = time; fb.gain.value = 0.5;
    d.connect(fb); fb.connect(d); d.connect(sink);
    return d;
  }

  function param(p, v, t, tc) {
    if (!isFinite(v)) return;
    p.setTargetAtTime(v, t, tc);
  }

  /* ---------------- one voice ---------------------------------------- */
  function Voice(ctx, bus, noiseBuf, curve, index) {
    var c = this.ctx = ctx;
    /* Every voice reads the same noise buffer, but from a different place in
       it. Started together they were sample-for-sample identical, so four
       noisy voices summed coherently into one hard hiss four times its
       proper size instead of four independent ones - a good part of what
       made a busy sheep grate. */
    this.noiseOffset = (index || 0) * (noiseBuf.duration || 1) / 12;

    this.sine = c.createOscillator(); this.sine.type = 'sine';
    // A triangle rather than a sawtooth. Both give the brightness axis
    // somewhere to go, but a saw carries every harmonic falling off as
    // 1/n and a triangle only the odd ones falling off as 1/n squared -
    // which is the difference between a buzz and a flute. The bright end
    // of the axis should be present, not piercing.
    this.saw = c.createOscillator(); this.saw.type = 'triangle';
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
    this.fm.start(when); this.noise.start(when, this.noiseOffset);
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
    /* Deviation scaled by the modulator's own frequency, so the index is
       constant instead of falling off as the ratio rises - a nine-fold
       julian used to get almost no FM at all, which was backwards. Much
       shallower than it was either way: inharmonic sidebands are exactly
       what reads as metallic. */
    param(this.fmGain.gain, v.inhar * v.freq * v.ratio * 0.16, t, 0.05);

    // brightness crossfades sine into saw and opens the filter with it,
    // so the axis moves the whole spectrum rather than only the waveform
    var b = v.bright;
    param(this.gSine.gain, Math.cos(b * Math.PI * 0.5) * 0.55, t, 0.05);
    param(this.gSaw.gain, Math.sin(b * Math.PI * 0.5) * 0.30, t, 0.05);
    param(this.gNoise.gain, v.noise * 0.07, t, 0.05);

    var d = 1 + v.fold * 1.6;
    param(this.drive.gain, d, t, 0.05);
    param(this.trim.gain, 1 / (1 + v.fold * 0.9), t, 0.05);

    /* The filter tracks the pitch, but nowhere near as far up as it did:
       at 14 times the fundamental a bright voice was handing over a dozen
       harmonics, and with a Q approaching 12 the peak sitting on top of
       them was the whistle. A ceiling in absolute terms as well, because a
       high voice and a high multiplier used to compound into something
       genuinely piercing. */
    param(this.filt.frequency, Math.min(7000, v.freq * (1.5 + b * 6)), t, 0.05);
    param(this.filt.Q, Math.min(3, 0.5 + v.reson * 1.5), t, 0.05);
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
    // an OfflineAudioContext is told to render and then runs to the end on
    // its own; there is nothing to suspend and no clock to read
    this.offline = !!ctx.startRendering;
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
    /* ---- reverb: send, four combs, two diffusers a side ---- */
    this.revSend = c.createGain(); this.revSend.gain.value = 0;
    this.dry = c.createGain(); this.dry.gain.value = 1;
    this.revMix = c.createGain(); this.revMix.gain.value = 1;
    var combSum = c.createGain(); combSum.gain.value = 0.25;
    // Freeverb's comb lengths, which are chosen to be mutually prime so
    // the four loops do not line up into a single ringing pitch
    var BASE = [0.0297, 0.0371, 0.0411, 0.0437];
    this.combs = [];
    for (var ci = 0; ci < BASE.length; ci++) {
      var cb = new Comb(c, BASE[ci], combSum);
      this.revSend.connect(cb.delay);
      this.combs.push(cb);
    }
    // two sides, deliberately mismatched, so the tail is not a point source
    var panL = c.createStereoPanner ? c.createStereoPanner() : c.createGain();
    var panR = c.createStereoPanner ? c.createStereoPanner() : c.createGain();
    if (panL.pan) { panL.pan.value = -0.85; panR.pan.value = 0.85; }
    var dL = diffuser(c, 0.0051, panL), dL2 = diffuser(c, 0.0126, dL);
    var dR = diffuser(c, 0.0047, panR), dR2 = diffuser(c, 0.0141, dR);
    combSum.connect(dL2); combSum.connect(dR2);
    panL.connect(this.revMix); panR.connect(this.revMix);

    /* ---- chorus / stereo width ----
       Three taps, because symmetry counts copies and the third fades in
       as that count rises rather than appearing all at once. One LFO
       drives them in opposition, which is what makes it width rather
       than a wobble. */
    this.chIn = c.createGain(); this.chIn.gain.value = 1;
    this.chDry = c.createGain(); this.chDry.gain.value = 1;
    this.chLfo = c.createOscillator(); this.chLfo.type = 'sine';
    this.chLfo.frequency.value = 0.15;
    this.chTaps = [];
    var TAPB = [0.010, 0.018, 0.025], TPAN = [-0.7, 0.7, 0.2];
    for (var ti = 0; ti < 3; ti++) {
      var dl = c.createDelay(0.08); dl.delayTime.value = TAPB[ti];
      var md = c.createGain(); md.gain.value = 0;      // LFO depth, signed
      var tg = c.createGain(); tg.gain.value = 0;      // tap level
      var tp = c.createStereoPanner ? c.createStereoPanner() : null;
      if (tp) tp.pan.value = TPAN[ti];
      this.chLfo.connect(md); md.connect(dl.delayTime);
      this.chIn.connect(dl); dl.connect(tg);
      if (tp) { tg.connect(tp); } 
      this.chTaps.push({ base: TAPB[ti], delay: dl, mod: md, gain: tg, pan: tp });
    }

    /* ---- auto-pan: the camera's own rotation ---- */
    this.autoPan = c.createStereoPanner ? c.createStereoPanner() : null;
    this.panLfo = c.createOscillator(); this.panLfo.type = 'sine';
    this.panLfo.frequency.value = 0.0001;
    this.panDepth = c.createGain(); this.panDepth.gain.value = 0;
    this.panLfo.connect(this.panDepth);
    if (this.autoPan) this.panDepth.connect(this.autoPan.pan);

    /* ---- the tone curve, as a compressor ---- */
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 3.4;
    this.comp.attack.value = 0.012;
    this.comp.release.value = 0.25;

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
    this.hissGain.connect(this.comp);

    this.bus.connect(this.busFilt);
    this.busFilt.connect(this.dry);
    this.busFilt.connect(this.revSend);
    this.dry.connect(this.chIn);
    this.revMix.connect(this.chIn);
    this.chIn.connect(this.chDry);
    var chOut = this.autoPan || this.comp;
    this.chDry.connect(chOut);
    for (var k = 0; k < this.chTaps.length; k++) {
      var tk = this.chTaps[k];
      (tk.pan || tk.gain).connect(chOut);
    }
    if (this.autoPan) this.autoPan.connect(this.comp);
    this.comp.connect(this.master);
    this.master.connect(this.vol);
    this.vol.connect(this.gate);
    this.gate.connect(this.limiter);
    this.limiter.connect(c.destination);

    var curve = foldCurve();
    this.voices = [];
    for (var i = 0; i < SND.MAX_VOICES; i++) {
      this.voices.push(new Voice(c, this.bus, buf, curve, i));
    }
  }

  FlameAudio.prototype.start = function (when) {
    if (this.started) return;
    this.started = true;
    var t = when === undefined ? this.ctx.currentTime : when;
    for (var i = 0; i < this.voices.length; i++) this.voices[i].start(t);
    this.hiss.start(t);
    this.chLfo.start(t);
    this.panLfo.start(t);
  };

  FlameAudio.prototype.setVolume = function (v, when) {
    this.volume = Math.max(0, Math.min(1, v));
    param(this.vol.gain, this.volume, when === undefined ? this.ctx.currentTime : when, 0.03);
  };

  /* A tap for the recorder, made once and left connected. It sits after
     the limiter, so what lands in the file is what came out of the
     speakers - including the volume, which is the honest reading: a
     recording made with the volume down is a quiet recording. */
  FlameAudio.prototype.recordTap = function () {
    if (!this.ctx.createMediaStreamDestination) return null;
    if (!this.tap) {
      this.tap = this.ctx.createMediaStreamDestination();
      this.limiter.connect(this.tap);
    }
    return this.tap;
  };

  /* On and off, without tearing anything down. The fade comes first and the
     context is suspended behind it, so switching off is a fade rather than
     a click and switching back on picks up where it left off. */
  FlameAudio.prototype.setActive = function (on, when) {
    var self = this;
    this.active = !!on;
    var now = when === undefined ? this.ctx.currentTime : when;
    if (on) {
      if (this.ctx.state === 'suspended' && this.ctx.resume) this.ctx.resume();
      param(this.gate.gain, 1, now, 0.05);
    } else {
      param(this.gate.gain, 0, now, 0.04);
      if (this.offline) return;      // nothing to idle: it is already a file
      clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(function () {
        if (!self.active && self.ctx.state === 'running' && self.ctx.suspend) self.ctx.suspend();
      }, 400);
    }
  };

  /* `gate` is the app's play state: a frozen picture makes no sound. The
     voices are gated rather than stopped, so resuming is a fade rather
     than a restart and the oscillators keep their phase. */
  /* `when` is the one concession the engine makes to being rendered
     offline. An OfflineAudioContext's currentTime sits at zero until it
     is told to render and then runs to the end on its own, so there is no
     clock to read: the whole performance has to be scheduled in advance.
     Passing the time in lets the offline path walk t from 0 to the end of
     the timeline and schedule every ramp and every note at its real
     moment, using this same code rather than a second copy of it. */
  FlameAudio.prototype.apply = function (spec, gate, when) {
    var t = when === undefined ? this.ctx.currentTime : when;
    var m = spec.master;
    param(this.busFilt.frequency, m.cutoff, t, 0.06);
    param(this.master.gain, m.gain, t, 0.06);
    param(this.hissGain.gain, gate ? m.hiss : 0, t, 0.1);
    this.setBus(m, t);
    var seq = spec.sequence;
    var drone = (seq && seq.on) ? 1 - seq.mix : 1;
    for (var i = 0; i < this.voices.length; i++) {
      this.voices[i].set(spec.voices[i], t, gate, drone);
    }
    if (seq) this.runSeq(seq, gate, t);
  };

  /* Everything the picture's own look decides about the bus. Slower time
     constants than the voices get: these are the character of the room
     rather than the notes in it, and a room that changes as fast as a
     note reads as a fault. */
  FlameAudio.prototype.setBus = function (m, t) {
    var i, tk;

    var rv = m.reverb;
    param(this.revSend.gain, rv.send, t, 0.15);
    // constant-power against the send, so turning glow up does not also
    // turn the whole mix up
    param(this.dry.gain, 1 - rv.send * 0.35, t, 0.15);
    // 0.88 is as far as the feedback may go: past about 0.9 the four
    // loops stop decaying and the reverb runs away
    var fb = 0.58 + rv.decay * 0.30;
    for (i = 0; i < this.combs.length; i++) this.combs[i].set(rv.size, fb, rv.damp, t);

    /* Symmetry is a count of copies. The third tap fades in across two to
       eight of them rather than appearing at three, and the taps spread
       further apart as the count rises, so a sixteen-fold sheep is
       genuinely thicker than a two-fold one without anything switching. */
    var ch = m.chorus;
    var spread = 1 + (ch.copies - 1) * 0.06;
    var lvl = [0.5, 0.5, 0.35], fade;
    for (i = 0; i < this.chTaps.length; i++) {
      tk = this.chTaps[i];
      // the third tap is the one symmetry brings in, and it arrives across
      // two to eight copies rather than appearing at three
      fade = i < 2 ? 1 : clamp01((ch.copies - 2) / 6);
      param(tk.delay.delayTime, tk.base * spread, t, 0.2);
      /* Mirror adds a reflected copy to the picture. Its counterpart here
         is a phase-inverted one, which is what makes a stereo image read
         as wide and hollow rather than centred - and because it is a sign
         on a gain, turning it on ramps through zero, so it crossfades in
         the way symmetry itself does across a morph rather than switching. */
      var phase = (i === 1 && ch.mirror) ? -1 : 1;
      param(tk.gain.gain, ch.width * lvl[i] * fade * 0.5 * phase, t, 0.12);
      // the two outer taps are modulated in opposition; that, and not the
      // delay itself, is what turns a wobble into width
      param(tk.mod.gain, (i === 1 ? -1 : 1) * ch.depth * 0.004, t, 0.12);
    }
    param(this.chDry.gain, 1 - ch.width * 0.25, t, 0.12);
    param(this.chLfo.frequency, 0.12 + ch.copies * 0.03, t, 0.2);

    // an oscillator at 0Hz is not a pan of zero, it is a pan stuck at
    // whatever phase it stopped on, so hold a floor and use depth to stop
    param(this.panLfo.frequency, Math.max(0.01, m.pan.rate), t, 0.2);
    param(this.panDepth.gain, m.pan.depth, t, 0.15);

    param(this.comp.ratio, m.comp.ratio, t, 0.2);
    param(this.comp.threshold, m.comp.threshold, t, 0.2);
  };

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

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
