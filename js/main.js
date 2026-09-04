/* =====================================================================
   main.js  -  application shell: render loop, panels, evolution, stream
   ===================================================================== */
(function () {
  'use strict';

  var GEN = window.FlameGenome, VAR = window.FlameVariations, PAL = window.FlamePalette;
  var EVO = window.FlameEvolve, LIB = window.FlameLibrary, U = window.UI;
  var SND = window.FlameSound;

  var DEFAULT_SETTINGS = {
    points: 256, passes: 14, ss: 2, resScale: 1, autoQuality: true,
    decay: 0.93, targetFps: 50, fpsCap: 0, showOverlay: false,
    genNumXforms: 0, genMaxVars: 3, genTame: true, genFinalChance: 0.35,
    keepImage: true, imageLook: null,
    popSize: 9, mutStrength: 0.35, mutRate: 0.65, freshRate: 0.15,
    fitCoverage: 1.6, fitEntropy: 1.3, fitColour: 1.0, fitDetail: 1.5, fitContrast: 0.8,
    streamHold: 6, streamTrans: 5, streamShuffle: false,
    loopsPerSheep: 3, driftMigrated: false, overlayMigrated: false,
    streamLoopOverride: false, streamLoopSecs: 12,
    endlessFresh: 1.0, endlessMutate: 0.5, endlessCross: 0.25, endlessFlock: 0.25,
    endlessMutateStrength: 0.45, endlessTries: 3, endlessMinScore: 0.42,
    endlessAvoidRepeat: true,
    streamSource: 'flock', streamDriftOn: false, streamDrift: 3, streamDriftStrength: 0.22, streamDriftTries: 3,
    streamDriftHold: 0,
    soundOn: false, soundVolume: 0.6, soundSeqMix: 0.6, soundSteps: 6, soundScale: 'auto',
    exportScale: 2, exportPasses: 900, exportSize: 'view', exportW: 1920, exportH: 1080,
    recordFps: 30, recordMbps: 12,
    renderSource: 'flock', renderSeconds: 20, renderW: 1920, renderH: 1080,
    renderFps: 30, renderPasses: 400, renderSS: 2, renderShutter: 4,
    renderFormat: 'vp09.00.10.08', renderMbps: 24
  };

  // No settings saved yet means nobody has ever picked a quality level here -
  // worth a one-time benchmark. Once anything is saved (including the
  // benchmark's own result) this stays false forever after.
  var FIRST_LOAD = !LIB.hasSettings();

  var app = {
    genome: null,
    renderer: null,
    thumb: null,
    library: new LIB.Library(),
    settings: LIB.loadSettings(DEFAULT_SETTINGS),
    playing: true,
    selectedXform: 0,
    panels: {},
    pop: null,
    popSelected: {},
    autoEvolve: false,
    stream: {
      active: false, list: [], idx: 0, t: 0, applied: false,
      current: null, next: null, driftLeft: 0, legKind: 'hop', arrivedKind: 'hop',
      mode: 'play', phase: 0, loopsLeft: 1, lastOrigin: ''
    },
    loopPhase: 0,
    // the trail of sheep already seen, so the left arrow has somewhere to go
    history: [],
    // a viewing adjustment layered on top of whatever is playing. The stream
    // rewrites the genome every frame, so a camera edit there would be wiped
    // instantly; this rides on top instead and survives sheep changes.
    view: { panX: 0, panY: 0, zoom: 1, rot: 0 },
    // the synthesiser, built on first use - an AudioContext may only be
    // created from a user gesture, so this stays null until asked for
    audio: null,
    recorder: null,
    recChunks: [],
    busy: null,
    fpsAvg: 60
  };
  window.app = app;

  /* ---------------- helpers ---------------------------------------- */
  function $(id) { return document.getElementById(id); }
  var msgTimer = null;
  function toast(txt) {
    var m = $('msg');
    m.textContent = txt; m.classList.add('show');
    clearTimeout(msgTimer);
    msgTimer = setTimeout(function () { m.classList.remove('show'); }, 1800);
  }
  function saveSettings() { LIB.saveSettings(app.settings); }

  /* ---------------- mobile shell ---------------------------------------
     Phones and tablets get a different shell around the same engine. The
     top bar keeps every transport control it has on desktop, in one
     scrollable row; everything else - the side panel, the filmstrip, the
     readout - stays hidden until the Options button slides the panel in as
     a drawer. Every rule for it hangs off body.mobile in css/style.css, so
     the desktop layout is untouched.

     Decided here rather than by a bare CSS media query on purpose: a
     narrow desktop window should keep the desktop UI, so the test is a
     coarse pointer *and* a phone-or-tablet-sized viewport. ?mobile=1 or
     ?mobile=0 forces either shell, which is how you check the mobile
     layout on a desktop browser. */
  var MOBILE_MQ = '(pointer: coarse) and (max-width: 1024px), (pointer: coarse) and (max-height: 640px)';
  function detectMobile() {
    var f = /[?&]mobile=([01])/.exec(location.search);
    if (f) return f[1] === '1';
    try { return window.matchMedia(MOBILE_MQ).matches; } catch (e) { return false; }
  }
  function isMobile() { return document.body.classList.contains('mobile'); }
  document.body.classList.toggle('mobile', detectMobile());

  /* Re-tested on rotation: a tablet can be a phone-shaped viewport in
     landscape and a desktop-shaped one in portrait. */
  function syncMobileClass() {
    var on = detectMobile();
    if (on === isMobile()) return;
    document.body.classList.toggle('mobile', on);
    if (!on) setDrawer(false);
    if (app.renderer) resize();
  }

  /* the options drawer - mobile only; on desktop the panel is always open */
  function drawerOpen() { return document.body.classList.contains('drawer-open'); }
  function setDrawer(open) {
    document.body.classList.toggle('drawer-open', !!open);
    var b = $('btnMenu');
    if (b) b.classList.toggle('on', !!open);
  }
  function toggleDrawer() { setDrawer(!drawerOpen()); }

  /* The sheep details overlay starts hidden and is toggled from the top bar
     (or H, or the Sheep pane's checkbox). All three go through here so the
     button, the checkbox and the canvas can never disagree. */
  function setOverlay(on) {
    app.settings.showOverlay = !!on;
    saveSettings();
    refreshOverlay();
    syncOverlayBtn();
    if (app.panels.sheep) app.panels.sheep.refresh();   // the checkbox lives in the Sheep pane
  }
  function toggleOverlay() { setOverlay(!app.settings.showOverlay); }
  function syncOverlayBtn() {
    var b = $('btnOverlay');
    if (!b) return;
    var on = !!app.settings.showOverlay;
    b.classList.toggle('on', on);
    b.setAttribute('aria-label', on ? 'Hide sheep details' : 'Show sheep details');
  }

  /* ---------------- sound ------------------------------------------------
     A sheep is a set of transforms, and sound.js reads each one as a voice.
     Everything the synthesiser needs comes out of the genome, so the sound
     morphs when the stream morphs and closes when the loop closes without
     anything here having to know about either.

     Off by default, and the AudioContext is built on the toggle itself
     because that is the user gesture the autoplay policy wants. All three
     ways in - the toolbar button, A, and View > Sound - come through here,
     so the button and the checkbox can never disagree. */
  function ensureAudio() {
    if (app.audio) return app.audio;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || !window.FlameAudio) return null;
    try { app.audio = new window.FlameAudio(new AC()); }
    catch (e) { app.audio = null; return null; }
    app.audio.start();
    app.audio.setVolume(app.settings.soundVolume);
    return app.audio;
  }

  /* A saved preference cannot start a context on its own, so a returning
     visitor with sound on gets it back at their next click or keypress
     rather than having to find the button again. */
  function armAudioResume() {
    function go() {
      if (app.audio && app.audio.ctx.state === 'suspended') app.audio.ctx.resume();
      window.removeEventListener('pointerdown', go, true);
      window.removeEventListener('keydown', go, true);
    }
    window.addEventListener('pointerdown', go, true);
    window.addEventListener('keydown', go, true);
  }

  function setSound(on) {
    on = !!on;
    if (on && !ensureAudio()) { toast('This browser has no Web Audio'); on = false; }
    if (app.audio) app.audio.setActive(on);
    app.settings.soundOn = on;
    saveSettings();
    syncSoundBtn();
    if (app.panels.sound) app.panels.sound.refresh();   // the checkbox lives in the Sound pane
  }
  function toggleSound() { setSound(!app.settings.soundOn); }

  /* Volume has two controls - the toolbar trackbar and the Sheep pane's
     slider - and, like every other command in this app, one implementation
     behind them. Each calls this and this puts the other one right. */
  var volCtl = null;          // the Sound pane's slider, while that pane exists
  function setSoundVolume(v) {
    app.settings.soundVolume = Math.max(0, Math.min(1, v));
    saveSettings();
    if (app.audio) app.audio.setVolume(app.settings.soundVolume);
    syncVolume();
  }
  function syncVolume() {
    var s = $('volSlider');
    // never fight the control being dragged: writing .value mid-drag on
    // Firefox snaps the thumb back under the pointer
    if (s && document.activeElement !== s) s.value = app.settings.soundVolume;
    if (volCtl) { try { volCtl.update(); } catch (e) { volCtl = null; } }
  }

  /* The listener's preferences, kept out of the genome on purpose: a
     sheep's sound is entirely determined by the fields it already has, so
     nothing new goes into the file format and every sheep ever saved
     gained a soundtrack the day this landed. */
  function soundOpts() {
    return {
      scale: app.settings.soundScale,
      steps: app.settings.soundSteps,
      seqMix: app.settings.soundSeqMix
    };
  }
  function syncSoundBtn() {
    var b = $('btnSound');
    if (!b) return;
    var on = !!app.settings.soundOn;
    b.classList.toggle('on', on);
    b.setAttribute('aria-label', on ? 'Turn the sound off' : 'Turn the sound on');
  }

  /* What the current sheep maps to, voice by voice. The same value the
     details overlay gives for the picture: without it there is no way to
     tell a mapping that is wrong from a sheep that is quiet. */
  function soundReadout() {
    if (!app.genome) return '';
    var spec = SND.describe(app.genome, soundOpts());
    var q = spec.sequence;
    var out = '<span>key</span><b>' + SND.noteName(spec.root) + ' ' + spec.scale + '</b>';
    if (q.on) {
      out += '<span>pattern</span><b>' + q.steps + ' steps at ' + q.rate.toFixed(1) + '/s' +
        (q.xaos ? ' · xaos' : '') + '</b>';
    }
    var n = 0;
    for (var i = 0; i < spec.voices.length; i++) {
      var v = spec.voices[i];
      if (!v.on) continue;
      n++;
      out += '<span>voice ' + (i + 1) + '</span><b>' + SND.noteName(v.freq) +
        ' · ' + Math.round(v.level * 100) + '%' +
        (v.noise > 0.4 ? ' · noisy' : (v.bright > 0.6 ? ' · bright' : '')) + '</b>';
    }
    if (!n) out += '<span>voices</span><b>—</b>';
    return out;
  }

  /* Control rate, not frame rate. The synthesiser wants a new description
     often enough to sound continuous and no more often than that, and
     describe() is cheap but not free. */
  var SOUND_HZ = 25;
  var soundAccum = 0;
  function tickSound(dt) {
    if (!app.audio || !app.settings.soundOn) return;
    soundAccum += dt;
    if (soundAccum < 1 / SOUND_HZ) return;
    soundAccum = 0;
    // whatever the renderer is drawing this instant, view offset and all -
    // one source of truth covering the still view, a loop and a morph alike
    var g = (app.renderer && app.renderer.genome) || app.genome;
    if (!g) return;
    app.audio.apply(SND.describe(g, soundOpts()), app.playing && !app.busy);
  }

  /* The transport row is longer than a phone is wide, so it scrolls. Mark
     which ends still have buttons past them and let the CSS fade that edge -
     without it there is nothing on screen to say the row goes on. */
  function syncTransportScroll() {
    var t = document.querySelector('.transport');
    if (!t) return;
    var slack = t.scrollWidth - t.clientWidth;
    t.classList.toggle('more-l', slack > 2 && t.scrollLeft > 2);
    t.classList.toggle('more-r', slack > 2 && t.scrollLeft < slack - 2);
  }

  function viewActive() {
    var v = app.view;
    return !!(v.panX || v.panY || v.rot || v.zoom !== 1);
  }
  function resetView(quiet) {
    app.view = { panX: 0, panY: 0, zoom: 1, rot: 0 };
    if (!quiet) toast('View reset');
    pushView();
    if (app.panels.sheep) app.panels.sheep.refresh();
    refreshOverlay();
  }

  /* Fold the view offset into a genome's camera. Pan is stored in screen
     pixels so it feels the same whatever zoom the current sheep sits at. */
  function applyViewOffset(g) {
    var v = app.view, r = app.renderer;
    if (!viewActive() || !r) return g;
    var cam = g.camera;
    cam.zoom = Math.max(0.02, Math.min(200, cam.zoom * v.zoom));
    cam.rotate = (cam.rotate || 0) + v.rot;
    var minDim = Math.min(r.width, r.height) / (window.devicePixelRatio || 1);
    var k = 2 / (minDim * cam.zoom) / app.settings.resScale;
    var a = -(cam.rotate), ca = Math.cos(a), sa = Math.sin(a);
    var wx = -v.panX * k, wy = v.panY * k;
    cam.x += wx * ca - wy * sa;
    cam.y += wx * sa + wy * ca;
    return g;
  }
  /* what the renderer should actually draw, given the offset */
  function viewApplied(g) {
    return viewActive() ? applyViewOffset(GEN.rawClone(g)) : g;
  }
  /* re-push the current frame after the offset changes (still images) */
  function pushView() {
    if (!app.renderer || !app.genome) return;
    if (app.stream.active) return;                 // the loop re-pushes anyway
    if (GEN.loopEnabled(app.genome)) return;
    app.renderer.setGenome(viewApplied(app.genome), true);
    app.renderer.clearAccum();
  }

  function touch(needClear) {
    if (!app.renderer || !app.genome) return;
    app.renderer.setGenome(viewApplied(app.genome), !needClear);
    if (needClear) app.renderer.clearAccum();
    refreshOverlay();
  }

  function setGenome(g, opts) {
    opts = opts || {};
    // every non-stream sheep change funnels through here, so this one line
    // covers random, mutate, the flock, evolve, drag-and-drop and pasted JSON
    if (opts.history !== false) pushHistory(app.genome);
    app.genome = GEN.normalize(g);
    app.selectedXform = Math.min(app.selectedXform, app.genome.xforms.length - 1);
    app.renderer.setGenome(app.genome);
    app.renderer.resetPoints(app.genome.seed || 1);
    app.renderer.clearAccum();
    app.renderer.spinAngle = 0;
    if (opts.fit) app.renderer.autoFit(app.genome);
    rebuildPanels();
    refreshOverlay();
  }

  /* ---------------- render loop -------------------------------------- */
  var lastTs = 0, capAccum = 0;
  function frame(ts) {
    requestAnimationFrame(frame);
    var dt = lastTs ? Math.min(0.25, (ts - lastTs) / 1000) : 0.016;
    lastTs = ts;
    // before the busy check: a render pauses playback, and the toolbar has to
    // say so rather than sitting on a stale label for the whole render
    syncTransport();
    if (app.busy) { app.busy(dt); tickSound(dt); return; }
    if (!app.renderer || !app.renderer.ok || !app.genome) return;

    // Optional hard limit. Time still accumulates while frames are skipped, so
    // loops and streams run at the right speed regardless of the cap.
    capAccum += dt;
    var cap = app.settings.fpsCap | 0;
    if (cap > 0 && capAccum < (1 / cap) * 0.98) return;
    // dt is the whole accumulated interval, so the simulation sees exactly the
    // time that really passed. Carrying a remainder would double-count it.
    dt = capAccum;
    capAccum = 0;

    /* A hitch must not be paid back as a jump. Frames get dropped for reasons
       that have nothing to do with the animation -- a GC pause, a shader
       compile, the compositor, the tab coming back to the foreground -- and
       advancing the stream by the whole gap makes the picture leap forward,
       which is exactly what a morph must never do. So anything animated
       advances by at most one step's worth of time and quietly loses the rest.
       The fps cap is a deliberate setting rather than a hitch, so the ceiling
       opens up to match it. */
    var cappedStep = cap > 0 ? Math.max(MAX_ANIM_STEP, 1.4 / cap) : MAX_ANIM_STEP;
    var adt = Math.min(dt, cappedStep);
    // Pause has to stop the stream too. It used to keep morphing while the
    // exposure stood still, so the picture on screen was of a moment the
    // stream had already left, and resuming looked like a jump forward.
    if (app.stream.active && app.playing) stepStream(adt);

    var spin = app.genome.camera.spin || 0;
    var loopOn = !app.stream.active && GEN.loopEnabled(app.genome);
    // Nothing to choose: a moving picture needs a rolling exposure, a still
    // one wants to keep accumulating. Anything animated forces the former.
    var animate = app.stream.active || loopOn || Math.abs(spin) > 1e-6;
    app.renderer.mode = animate ? 'animate' : 'refine';
    // Trail decay is quoted per 60fps frame, so scale it by the real frame time.
    // Without this a slow machine holds the previous sheep on screen for seconds.
    var d = app.settings.decay;
    if (app.stream.active) d = Math.min(d, 0.97);
    // 0 is meaningful: the renderer clears rather than fades, giving each frame
    // a completely fresh exposure with no trail at all.
    d = Math.max(0, Math.min(0.9999, d));
    // scaled by the same clamped step: a single long frame should not wipe the
    // rolling exposure, which reads as a flash on top of the jump
    app.renderer.decay = d <= 0 ? 0 : Math.pow(d, Math.max(adt, 1 / 240) * 60);

    if (app.playing) {
      if (Math.abs(spin) > 1e-6) app.renderer.spinAngle += spin * adt;
      if (loopOn) {
        // a sheep is a loop: advance its phase and render that frame of it.
        // app.genome stays the base genome so the panels keep editing frame zero.
        app.loopPhase += adt / GEN.loopSeconds(app.genome);
        app.loopPhase -= Math.floor(app.loopPhase);
        app.renderer.setGenome(viewApplied(GEN.applyLoop(app.genome, app.loopPhase)), true);
        if (app.panels.loop && app.panels.loop.scrub) app.panels.loop.scrub(app.loopPhase);
      }
      app.renderer.step(app.settings.passes);
      app.renderer.present();
    } else {
      app.renderer.present();
    }
    var fps = 1 / Math.max(dt, 1e-4);
    app.fpsAvg += (fps - app.fpsAvg) * 0.06;
    if (app.playing) adaptQuality(dt);
    tickOverlay(dt);
    tickSound(dt);
    updateReadout(dt);
  }

  var adaptCooldown = 0;
  var MAX_PASSES = 512;
  /* The largest slice of time any animation may advance in one frame. Smooth
     motion matters more than keeping wall-clock: 50ms is a fifth of the old
     0.25s dt ceiling, so a stutter costs a little speed instead of a jump. */
  var MAX_ANIM_STEP = 0.05;

  /* Auto quality raises detail until the frame rate falls to the floor.

     This used to time `step()` + `present()` with performance.now() and treat
     that as the cost of a frame. It isn't: WebGL draw calls return as soon as
     the command is queued, so that measured command submission, not GPU work.
     On any real GPU it read as a couple of milliseconds however hard the card
     was working, so quality only ever ratcheted upwards. Judging by the actual
     frame interval is the only honest signal available without timer queries. */
  function adaptQuality(dt) {
    if (!app.settings.autoQuality) return;
    adaptCooldown -= dt;
    if (adaptCooldown > 0) return;
    if (dt >= 0.24) return;                       // a stall, not a measurement
    var floorMs = 1000 / Math.max(5, app.settings.targetFps);
    var actualMs = 1000 / Math.max(1, app.fpsAvg);
    var p = app.settings.passes;
    if (actualMs > floorMs * 1.10 && p > 1) {
      // must actually go down: round(3 * 0.85) is 3, which would stall here
      app.settings.passes = Math.max(1, Math.min(p - 1, Math.round(p * 0.85)));
      adaptCooldown = 0.6;
    } else if (actualMs < floorMs * 0.80 && p < MAX_PASSES) {
      // proportional, so a fast card reaches a useful setting in seconds
      app.settings.passes = Math.min(MAX_PASSES, p + Math.max(1, Math.round(p * 0.12)));
      adaptCooldown = 0.35;
    }
  }

  /* ---------------- quality presets ---------------------------------- */
  var QUALITY_PRESETS = {
    light:   { label: 'Light',   points:  96, passes:  5, ss: 1, resScale: 0.5,  targetFps: 30, fpsCap: 30, de: false, denoise: 0 },
    medium:  { label: 'Medium',  points: 224, passes: 10, ss: 1, resScale: 0.85, targetFps: 45, fpsCap: 60, de: true,  denoise: 0 },
    high:    { label: 'High',    points: 384, passes: 20, ss: 2, resScale: 1.0,  targetFps: 60, fpsCap: 0,  de: true,  denoise: 1 },
    extreme: { label: 'Extreme', points: 640, passes: 40, ss: 3, resScale: 1.25, targetFps: 60, fpsCap: 0,  de: true,  denoise: 2 }
  };
  function applyQualityPreset(key) {
    var q = QUALITY_PRESETS[key];
    if (!q) return;
    app.settings.points = q.points;
    app.settings.passes = q.passes;
    app.settings.ss = q.ss;
    app.settings.resScale = q.resScale;
    app.settings.autoQuality = true;
    app.settings.targetFps = q.targetFps;
    app.settings.fpsCap = q.fpsCap;
    saveSettings();
    if (app.renderer) {
      app.renderer.setPointCount(q.points);
      app.renderer.clearAccum();
    }
    if (app.genome && app.genome.render) {
      app.genome.render.de = q.de;
      app.genome.render.denoise = q.denoise;
      markLook();
    }
    resize();
    refreshAll();
    toast(q.label + ' quality preset applied');
  }

  /* ---------------- first-load quality calibration ---------------------
     Rather than guess from GPU renderer strings or core counts - both easy
     to misread, and unavailable on some browsers - this reuses the same
     auto-quality loop adaptQuality() already runs during normal playback:
     point it at a fixed, neutral baseline for a few seconds behind a
     loading screen and see how many passes/frame the hardware actually
     sustains, then apply whichever preset that's closest to. Runs once
     ever - the moment it saves settings, hasSettings() is true and every
     future load skips straight past this. */
  var BENCH_MS = 3500;
  function hideLoadScreen(instant) {
    var el = $('loadScreen');
    if (!el) return;
    if (instant) { el.style.display = 'none'; return; }
    el.classList.add('hide');
    setTimeout(function () { el.style.display = 'none'; }, 420);
  }
  function runFirstLoadBenchmark() {
    app.settings.points = 256;
    app.settings.ss = 1;
    app.settings.resScale = 1;
    app.settings.passes = 16;
    app.settings.autoQuality = true;
    app.settings.targetFps = 60;
    app.settings.fpsCap = 0;
    app.renderer.setPointCount(256);
    resize();

    var fill = $('loadBarFill');
    var t0 = performance.now();
    (function tick() {
      var u = Math.min(1, (performance.now() - t0) / BENCH_MS);
      if (fill) fill.style.width = (u * 100) + '%';
      if (u < 1) requestAnimationFrame(tick);
    })();

    setTimeout(function () {
      var p = app.settings.passes;
      var tier = p <= 8 ? 'light' : p <= 16 ? 'medium' : p <= 30 ? 'high' : 'extreme';
      applyQualityPreset(tier);
      hideLoadScreen();
    }, BENCH_MS);
  }

  var lastTransport = '';
  function syncTransport() {
    var key = (app.playing ? '1' : '0') + (app.stream.active ? '1' : '0');
    if (key === lastTransport) return;
    lastTransport = key;
    var p = $('btnPlay');
    if (p) {
      // the buttons carry glyphs, not words: the state shows in which icon is
      // drawn and in the .on highlight, and the label moves to the tooltip
      p.classList.toggle('paused', !app.playing);
      p.setAttribute('aria-label', app.playing ? 'Pause' : 'Play');
    }
    var b = $('btnStream');
    if (b) {
      b.classList.toggle('on', app.stream.active);
      b.setAttribute('aria-label', app.stream.active ? 'Stop the stream' : 'Start the stream');
    }
    syncTransportScroll();
  }

  /* Throttled for the same reason as the overlay below: this reparses a string
     into the DOM, and nobody reads an fps counter sixty times a second. */
  var readoutClock = 0;
  function updateReadout(dt) {
    var r = app.renderer;
    if (!r) return;
    // called with a dt from the frame loop it throttles; called bare it refreshes now
    if (dt !== undefined) {
      readoutClock += dt;
      if (readoutClock < 0.2) return;
      readoutClock = 0;
    }
    var spp = r.sampleCount / Math.max(1, r.width * r.height);
    $('readout').innerHTML =
      '<b>' + app.fpsAvg.toFixed(0) + '</b> fps &nbsp; ' +
      '<b>' + spp.toFixed(0) + '</b> spp &nbsp; ' +
      r.width + '×' + r.height + '·' + r.ss + 'x &nbsp; ' +
      (r.pointsW * r.pointsH / 1000).toFixed(0) + 'k pts × <b>' + app.settings.passes + '</b>';
  }

  /* The stream rewrites the genome every frame; rebuilding the overlay that
     often is pointless, so mark it dirty and let the loop flush it ~5x/s. */
  var overlayDirty = false, overlayClock = 0;
  function markOverlay() { overlayDirty = true; }
  function tickOverlay(dt) {
    if (!overlayDirty) return;
    overlayClock += dt;
    if (overlayClock < 0.2) return;
    overlayClock = 0; overlayDirty = false;
    refreshOverlay();
  }

  function refreshOverlay() {
    var o = $('overlay');
    if (!app.settings.showOverlay || !app.genome) { o.innerHTML = ''; return; }
    var g = app.genome;
    var vars = {};
    g.xforms.forEach(function (x) { x.vars.forEach(function (v) { if (v.w) vars[v.v] = 1; }); });
    var s = app.stream;
    var streamLine = '';
    if (s.active) {
      var per = Math.max(1, app.settings.loopsPerSheep | 0);
      var onLoop = Math.max(1, Math.min(per, per - s.loopsLeft + 1));
      var total = driftGenerations();
      var lenTxt = '';
      if (s.mode !== 'trans' && s.current) {
        var L = loopLenOf(s.current);
        if (L) lenTxt = ' · ' + L.toFixed(1) + 's' + (app.settings.streamLoopOverride ? ' fixed' : '');
      }
      streamLine = '<div class="strm">stream · ' +
        (s.mode === 'trans' ? 'transition' : 'loop ' + onLoop + '/' + per + ' · ' + Math.round(s.phase * 100) + '%' + lenTxt) +
        (total ? ' · drift ' + Math.max(0, Math.min(total, total - s.driftLeft)) + '/' + total : '') +
        (streamIsEndless() ? ' · endless' + (s.lastOrigin ? ' (' + s.lastOrigin + ')' : '')
                           : ' · flock ' + (s.idx + 1) + '/' + s.list.length) +
        '</div>';
    }
    var viewLine = '';
    if (viewActive()) {
      var bits = [];
      if (app.view.zoom !== 1) bits.push('\u00d7' + app.view.zoom.toFixed(2));
      if (app.view.rot) bits.push((app.view.rot * 180 / Math.PI).toFixed(0) + '\u00b0');
      if (app.view.panX || app.view.panY) bits.push('panned');
      viewLine = '<div class="vw">view ' + bits.join(' \u00b7 ') + ' \u2014 press F to reset</div>';
    }
    if (!s.active && GEN.loopEnabled(app.genome)) {
      streamLine = '<div class="strm">loop ' + Math.round((app.loopPhase || 0) * 100) + '% · ' +
        GEN.loopSeconds(app.genome).toFixed(1) + 's · ' + app.genome.loop.animators.length + ' channels</div>';
    }
    o.innerHTML = '<div class="title">' + escapeHtml(g.name) + '</div>' +
      '<div>gen ' + (g.generation || 0) + ' · seed ' + g.seed + ' · ' + g.xforms.length + ' xforms' + (g.final ? ' + final' : '') +
      (g.render.symmetry > 1 ? ' · sym ' + g.render.symmetry : '') + '</div>' +
      '<div>' + escapeHtml(Object.keys(vars).slice(0, 6).join(' · ')) + '</div>' + streamLine + viewLine;
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  /* ---------------- sizing ------------------------------------------- */
  function resize() {
    var wrap = $('canvaswrap');
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    var ss = app.settings.ss;
    var w = Math.max(64, Math.floor(wrap.clientWidth * dpr * app.settings.resScale));
    var h = Math.max(64, Math.floor(wrap.clientHeight * dpr * app.settings.resScale));
    // the accumulation buffer is w*ss x h*ss floats - keep it inside a sane budget
    var maxOut = 14e6 / (ss * ss);
    var scale = Math.sqrt(maxOut / Math.max(1, w * h));
    if (scale < 1) { w = Math.floor(w * scale); h = Math.floor(h * scale); }
    app.renderer.setSize(w, h, ss);
    updateExportEstimate();   // "Match view" is quoted in window pixels
  }

  /* ---------------- thumbnails --------------------------------------- */
  function makeThumb(genome, opts, done) {
    opts = opts || {};
    var t = app.thumb;
    if (!t || !t.ok) { done(null); return; }
    var g = genome;
    t.setGenome(g);
    if (opts.fit !== false) t.autoFit(g, { passes: 26 });
    t.mode = 'refine';
    t.clearAccum();
    t.resetPoints(g.seed || 1);
    var passes = opts.passes || 22;
    for (var i = 0; i < passes; i++) t.step(8);
    t.present();
    var stats = opts.measure ? t.measure() : null;
    var url = null;
    try { url = t.toCanvas().toDataURL('image/jpeg', 0.72); } catch (e) { url = null; }
    done(url, stats);
  }

  /* run a queue of thumbnail jobs without freezing the UI */
  function thumbQueue(jobs, onEach, onDone) {
    var i = 0;
    function next() {
      if (i >= jobs.length) { if (onDone) onDone(); return; }
      var job = jobs[i++];
      makeThumb(job.genome, job.opts, function (url, stats) {
        onEach(job, url, stats);
        setTimeout(next, 0);
      });
    }
    setTimeout(next, 0);
  }

  /* =================================================================== */
  /*  PANELS                                                             */
  /* =================================================================== */
  function rebuildPanels() {
    buildSheepPane();
    buildTransformsPane();
    buildPalettePane();
    buildRenderPane();
    buildLoopPane();
    buildSoundPane();
    buildStreamPane();
    buildOutputPane();
    renderLibrary();
  }
  function refreshAll() {
    for (var k in app.panels) if (app.panels[k]) app.panels[k].refresh();
    refreshOverlay();
  }

  /* ---------- Sheep --------------------------------------------------- */
  function buildSheepPane() {
    var root = document.querySelector('[data-pane=sheep]');
    var p = new U.Panel(root); app.panels.sheep = p; p.clear();
    var g = app.genome;

    var gi = U.group(root, 'Identity');
    U.text(p, gi, { label: 'Name', get: function () { return app.genome.name; }, set: function (v) { app.genome.name = v; refreshOverlay(); } });
    U.number(p, gi, {
      label: 'Seed', step: 1,
      get: function () { return app.genome.seed; },
      set: function (v) { app.genome.seed = v >>> 0; }
    });
    U.buttons(gi, [
      { label: 'Regrow from seed', title: 'Rebuild this sheep deterministically from its seed', onclick: function () { setGenome(applyLook(GEN.randomGenome(app.genome.seed, genOpts())), { fit: true }); toast('Regrown from seed ' + app.genome.seed); } },
      { label: 'Duplicate', onclick: function () { var c = GEN.clone(app.genome); c.seed = (Math.random() * 4294967296) >>> 0; c.id = 's' + c.seed.toString(36); c.name = app.genome.name + ' copy'; setGenome(c); } }
    ]);
    var info = U.el('div', { class: 'kv' });
    info.innerHTML = '<span>generation</span><b>' + (g.generation || 0) + '</b>' +
      '<span>parents</span><b>' + ((g.parents && g.parents.length) ? g.parents.join(', ') : '—') + '</b>' +
      '<span>fingerprint</span><b>' + GEN.fingerprint(g) + '</b>' +
      '<span>note</span><b>' + escapeHtml(g.note || '—') + '</b>';
    gi.appendChild(info);

    var gc = U.group(root, 'Camera');
    U.slider(p, gc, { label: 'Centre X', min: -4, max: 4, step: 0.001, reset: 0, get: function () { return app.genome.camera.x; }, set: function (v) { app.genome.camera.x = v; touch(true); } });
    U.slider(p, gc, { label: 'Centre Y', min: -4, max: 4, step: 0.001, reset: 0, get: function () { return app.genome.camera.y; }, set: function (v) { app.genome.camera.y = v; touch(true); } });
    U.slider(p, gc, {
      label: 'Zoom', min: Math.log(0.02), max: Math.log(40), step: 0.001,
      fmt: function (v) { return Math.exp(v).toFixed(2) + '×'; },
      toDisplay: Math.exp, fromDisplay: Math.log,
      get: function () { return Math.log(Math.max(0.02, app.genome.camera.zoom)); },
      set: function (v) { app.genome.camera.zoom = Math.exp(v); touch(true); }
    });
    U.slider(p, gc, {
      label: 'Rotate', min: -180, max: 180, step: 0.5, reset: 0,
      fmt: function (v) { return v.toFixed(0) + '°'; },
      get: function () { return app.genome.camera.rotate * 180 / Math.PI; },
      set: function (v) { app.genome.camera.rotate = v * Math.PI / 180; touch(true); }
    });
    U.slider(p, gc, {
      label: 'Spin', min: -60, max: 60, step: 0.5, reset: 0,
      fmt: function (v) { return v.toFixed(0) + '°/s'; },
      title: 'Continuous rotation. Any non-zero value switches the exposure to rolling mode.',
      get: function () { return (app.genome.camera.spin || 0) * 180 / Math.PI; },
      set: function (v) { app.genome.camera.spin = v * Math.PI / 180; }
    });
    U.buttons(gc, [
      { label: 'Auto-fit', class: 'primary', onclick: doFit },
      { label: 'Centre', onclick: function () { app.genome.camera.x = 0; app.genome.camera.y = 0; touch(true); refreshAll(); } },
      { label: 'Reset', onclick: function () { app.genome.camera = GEN.defaultCamera(); touch(true); refreshAll(); } }
    ]);
    U.hint(gc, 'Drag the canvas to pan, wheel to zoom, shift-drag to rotate. While a stream is running these edit the View below instead, since the stream owns the camera.');

    var gv = U.group(root, 'View  (rides on top of what is playing)', { key: 'view' });
    U.hint(gv, 'A viewing adjustment layered over whatever is on screen. It survives sheep changes, so you can zoom into a stream and stay there. It is not part of any sheep — but Keep saves what you are actually looking at.');
    U.slider(p, gv, {
      label: 'Pan X', min: -1500, max: 1500, step: 1, reset: 0,
      fmt: function (v) { return v.toFixed(0) + 'px'; },
      get: function () { return app.view.panX; },
      set: function (v) { app.view.panX = v; pushView(); refreshOverlay(); }
    });
    U.slider(p, gv, {
      label: 'Pan Y', min: -1500, max: 1500, step: 1, reset: 0,
      fmt: function (v) { return v.toFixed(0) + 'px'; },
      get: function () { return app.view.panY; },
      set: function (v) { app.view.panY = v; pushView(); refreshOverlay(); }
    });
    U.slider(p, gv, {
      label: 'Zoom', min: Math.log(0.05), max: Math.log(20), step: 0.001, reset: 0,
      fmt: function (v) { return '×' + Math.exp(v).toFixed(2); },
      toDisplay: Math.exp, fromDisplay: Math.log,
      get: function () { return Math.log(Math.max(0.05, app.view.zoom)); },
      set: function (v) { app.view.zoom = Math.exp(v); pushView(); refreshOverlay(); }
    });
    U.slider(p, gv, {
      label: 'Rotate', min: -180, max: 180, step: 0.5, reset: 0,
      fmt: function (v) { return v.toFixed(0) + '°'; },
      get: function () { return app.view.rot * 180 / Math.PI; },
      set: function (v) { app.view.rot = v * Math.PI / 180; pushView(); refreshOverlay(); }
    });
    U.buttons(gv, [
      { label: 'Reset view', class: 'primary', title: 'F', onclick: function () { resetView(); } }
    ]);

    var gg = U.group(root, 'New sheep recipe', { collapsed: true });
    U.slider(p, gg, {
      label: 'Transforms', min: 0, max: 12, step: 1,
      fmt: function (v) { return v ? v.toFixed(0) : 'random'; },
      get: function () { return app.settings.genNumXforms; },
      set: function (v) { app.settings.genNumXforms = v | 0; saveSettings(); }
    });
    U.slider(p, gg, {
      label: 'Max variations', min: 1, max: 6, step: 1,
      get: function () { return app.settings.genMaxVars; },
      set: function (v) { app.settings.genMaxVars = v | 0; saveSettings(); }
    });
    U.slider(p, gg, {
      label: 'Final xform', min: 0, max: 1, step: 0.05,
      title: 'Probability that a new sheep gets a final transform',
      get: function () { return app.settings.genFinalChance; },
      set: function (v) { app.settings.genFinalChance = v; saveSettings(); }
    });
    U.check(p, gg, {
      label: 'Tame affines', note: 'contractive, better behaved',
      get: function () { return app.settings.genTame; },
      set: function (v) { app.settings.genTame = v; saveSettings(); }
    });
    U.buttons(gg, [{ label: 'New random sheep', class: 'primary', onclick: doRandom }]);

    var gq = U.group(root, 'Quality', { collapsed: true });
    U.slider(p, gq, {
      label: 'Particles', min: 64, max: 1024, step: 32,
      fmt: function (v) { return (v * v / 1000).toFixed(0) + 'k'; },
      get: function () { return app.settings.points; },
      set: function (v) { app.settings.points = v | 0; app.renderer.setPointCount(v | 0); app.renderer.clearAccum(); saveSettings(); }
    });
    U.slider(p, gq, {
      label: 'Passes / frame', min: 1, max: 512, step: 1,
      get: function () { return app.settings.passes; },
      set: function (v) { app.settings.passes = v | 0; saveSettings(); }
    });
    U.slider(p, gq, {
      label: 'Supersample', min: 1, max: 3, step: 1,
      fmt: function (v) { return v + '×'; },
      get: function () { return app.settings.ss; },
      set: function (v) { app.settings.ss = v | 0; saveSettings(); resize(); }
    });
    U.slider(p, gq, {
      label: 'Resolution', min: 0.35, max: 1.5, step: 0.05,
      fmt: function (v) { return Math.round(v * 100) + '%'; },
      get: function () { return app.settings.resScale; },
      set: function (v) { app.settings.resScale = v; saveSettings(); resize(); }
    });
    U.check(p, gq, {
      label: 'Auto quality', note: 'hold target fps',
      get: function () { return app.settings.autoQuality; },
      set: function (v) { app.settings.autoQuality = v; saveSettings(); }
    });
    U.slider(p, gq, {
      label: 'Hold fps above', min: 5, max: 120, step: 1,
      title: 'A floor, not a limit. Auto quality keeps adding passes until the frame rate drops to about here — so a fast GPU settles on high quality and still runs well above this number.',
      get: function () { return app.settings.targetFps; },
      set: function (v) { app.settings.targetFps = v; saveSettings(); }
    });
    U.slider(p, gq, {
      label: 'Limit fps to', min: 0, max: 144, step: 1,
      fmt: function (v) { return v > 0 ? v.toFixed(0) : 'unlimited'; },
      title: 'A hard cap on how often the picture is redrawn. Use it to keep the GPU quiet — loops and streams still run at the correct speed.',
      get: function () { return app.settings.fpsCap; },
      set: function (v) { app.settings.fpsCap = v | 0; saveSettings(); }
    });
    U.hint(gq, 'These pull in opposite directions on purpose: "hold above" buys quality with the headroom you have, "limit to" gives that headroom back. Auto quality settles where the two meet.');
    U.check(p, gq, {
      label: 'Show overlay',
      get: function () { return app.settings.showOverlay; },
      set: function (v) { setOverlay(v); }
    });

    var gj = U.group(root, 'Genome JSON', { collapsed: true });
    var ta = U.el('textarea', { class: 'json' });
    ta.value = GEN.serialize(app.genome);
    gj.appendChild(ta);
    U.buttons(gj, [
      { label: 'Apply', onclick: function () { try { setGenome(GEN.deserialize(ta.value)); toast('Genome applied'); } catch (e) { toast('Invalid JSON: ' + e.message); } } },
      { label: 'Refresh', onclick: function () { ta.value = GEN.serialize(app.genome); } },
      { label: 'Copy', onclick: function () { ta.select(); try { document.execCommand('copy'); toast('Copied'); } catch (e) { } } },
      { label: 'Save .sheep.json', onclick: function () { LIB.exportGenome(app.genome); } }
    ]);
  }

  /* The Image tab edits genome.render, which a freshly generated sheep would
     otherwise overwrite with its own randomised look. When "keep" is on we
     carry the current one across instead, and remember it between sessions. */
  function currentLook() {
    return app.genome ? JSON.parse(JSON.stringify(app.genome.render)) : null;
  }
  function applyLook(g) {
    if (!app.settings.keepImage || !g) return g;
    var look = app.settings.imageLook || currentLook();
    if (look) g.render = JSON.parse(JSON.stringify(look));
    return g;
  }
  var lookSaveTimer = null;
  function markLook() {
    if (!app.settings.keepImage) return;
    clearTimeout(lookSaveTimer);
    lookSaveTimer = setTimeout(function () {
      app.settings.imageLook = currentLook();
      saveSettings();
    }, 400);                                   // debounced: sliders fire constantly
  }

  function genOpts() {
    return {
      numXforms: app.settings.genNumXforms || 0,
      maxVars: app.settings.genMaxVars,
      tame: app.settings.genTame,
      finalChance: app.settings.genFinalChance
    };
  }

  /* ---------- Transforms ---------------------------------------------- */
  function buildTransformsPane() {
    var root = document.querySelector('[data-pane=transforms]');
    var p = new U.Panel(root); app.panels.transforms = p; p.clear();
    var g = app.genome;

    var chips = U.el('div', { class: 'xlist' });
    root.appendChild(chips);
    var lut = PAL.buildLUT(g.palette);
    function chipColor(c) {
      var i = Math.max(0, Math.min(255, Math.round(c * 255)));
      return PAL.rgb2hex([lut[i * 4], lut[i * 4 + 1], lut[i * 4 + 2]]);
    }
    g.xforms.forEach(function (x, i) {
      var c = U.el('div', { class: 'xchip' + (app.selectedXform === i ? ' active' : ''), onclick: function () { app.selectedXform = i; buildTransformsPane(); } },
        [U.el('span', { class: 'swatch', style: 'background:' + chipColor(x.color) }), 'X' + (i + 1)]);
      chips.appendChild(c);
    });
    chips.appendChild(U.el('div', {
      class: 'xchip' + (app.selectedXform === -1 ? ' active' : ''),
      onclick: function () {
        if (!app.genome.final) { app.genome.final = GEN.newXform({ colorSpeed: 0 }); touch(true); }
        app.selectedXform = -1; buildTransformsPane();
      }
    }, [g.final ? 'Final' : '+ Final']));

    U.buttons(root, [
      { label: '+ Transform', onclick: function () { if (g.xforms.length >= GEN.MAX_XFORMS) return toast('12 transforms max'); g.xforms.push(GEN.newXform({ weight: 0.5, color: Math.random(), affine: GEN.randomAffine(new GEN.RNG((Math.random() * 1e9) | 0), true) })); g.xforms.forEach(function (x) { x.xaos = null; }); app.selectedXform = g.xforms.length - 1; touch(true); buildTransformsPane(); } },
      { label: 'Duplicate', onclick: function () { var i = app.selectedXform; if (i < 0) return; var c = JSON.parse(JSON.stringify(g.xforms[i])); c.xaos = null; g.xforms.splice(i + 1, 0, c); g.xforms.forEach(function (x) { x.xaos = null; }); touch(true); buildTransformsPane(); } },
      { label: 'Delete', class: 'danger', onclick: function () { var i = app.selectedXform; if (i === -1) { g.final = null; app.selectedXform = 0; } else { if (g.xforms.length <= 1) return toast('Need at least one transform'); g.xforms.splice(i, 1); g.xforms.forEach(function (x) { x.xaos = null; }); app.selectedXform = Math.max(0, i - 1); } touch(true); buildTransformsPane(); } },
      { label: 'Randomise', onclick: function () { var x = cur(); if (!x) return; var r = new GEN.RNG((Math.random() * 4294967296) >>> 0); x.affine = GEN.randomAffine(r, app.settings.genTame); x.vars = GEN.randomVariationSet(r, app.settings.genMaxVars); touch(true); buildTransformsPane(); } }
    ]);

    function cur() { return app.selectedXform === -1 ? g.final : g.xforms[app.selectedXform]; }
    var x = cur();
    if (!x) return;
    var isFinal = app.selectedXform === -1;

    var gb = U.group(root, isFinal ? 'Final transform' : 'Transform ' + (app.selectedXform + 1), { key: 'xf-basics' });
    if (!isFinal) {
      U.slider(p, gb, { label: 'Weight', min: 0, max: 4, step: 0.005, get: function () { return cur().weight; }, set: function (v) { cur().weight = v; touch(true); } });
    }
    U.slider(p, gb, {
      label: 'Colour', min: 0, max: 1, step: 0.002,
      get: function () { return cur().color; },
      set: function (v) {
        cur().color = v; touch(true);
        // repaint just this chip's swatch; rebuilding here would kill the drag
        var sw = chips.children[app.selectedXform];
        if (sw && sw.firstChild && sw.firstChild.style) sw.firstChild.style.background = chipColor(v);
      }
    });
    U.slider(p, gb, { label: 'Colour speed', min: 0, max: 1, step: 0.005, get: function () { return cur().colorSpeed; }, set: function (v) { cur().colorSpeed = v; touch(true); } });
    U.slider(p, gb, { label: 'Opacity', min: 0, max: 1, step: 0.005, get: function () { return cur().opacity; }, set: function (v) { cur().opacity = v; touch(true); } });

    // affine editors
    function affineEditor(parent, key, title) {
      var body = U.group(parent, title, { key: 'aff-' + key });
      var labels = ['a', 'b', 'c', 'd', 'e', 'f'];
      var grid = U.el('div', { class: 'affine-grid' });
      var inputs = [];
      for (var i = 0; i < 6; i++) {
        (function (i) {
          var inp = U.el('input', { type: 'number', step: '0.001' });
          inp.addEventListener('change', function () {
            var v = parseFloat(inp.value); if (isNaN(v)) return;
            cur()[key][i] = v; touch(true);
          });
          inputs.push(inp);
          grid.appendChild(inp);
        })(i);
      }
      var lg = U.el('div', { class: 'affine-grid' });
      labels.forEach(function (l) { lg.appendChild(U.el('div', { class: 'matlabel', text: l })); });
      body.appendChild(lg); body.appendChild(grid);
      p.add({ update: function () { var m = cur()[key]; for (var i = 0; i < 6; i++) if (document.activeElement !== inputs[i]) inputs[i].value = (+m[i]).toFixed(4); } });
      function transform(fn) { cur()[key] = fn(cur()[key].slice()); touch(true); p.refresh(); }
      function rot(deg) {
        return function (m) {
          var a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
          return [m[0] * c + m[1] * s, -m[0] * s + m[1] * c, m[2], m[3] * c + m[4] * s, -m[3] * s + m[4] * c, m[5]];
        };
      }
      function scl(k) { return function (m) { return [m[0] * k, m[1] * k, m[2], m[3] * k, m[4] * k, m[5]]; }; }
      function mov(dx, dy) { return function (m) { m[2] += dx; m[5] += dy; return m; }; }
      U.buttons(body, [
        { label: '↺15°', onclick: function () { transform(rot(15)); } },
        { label: '↻15°', onclick: function () { transform(rot(-15)); } },
        { label: '−10%', onclick: function () { transform(scl(0.9)); } },
        { label: '+10%', onclick: function () { transform(scl(1.1)); } },
        { label: '←', onclick: function () { transform(mov(-0.05, 0)); } },
        { label: '→', onclick: function () { transform(mov(0.05, 0)); } },
        { label: '↑', onclick: function () { transform(mov(0, 0.05)); } },
        { label: '↓', onclick: function () { transform(mov(0, -0.05)); } },
        { label: 'Identity', onclick: function () { transform(function () { return GEN.identityAffine(); }); } },
        { label: 'Random', onclick: function () { transform(function () { return GEN.randomAffine(new GEN.RNG((Math.random() * 4294967296) >>> 0), true); }); } }
      ], 'tight');
      return body;
    }
    affineEditor(root, 'affine', 'Affine  (x′ = a·x + b·y + c,  y′ = d·x + e·y + f)');
    var pb = U.group(root, 'Post affine', { key: 'postaff', collapsed: true });
    U.check(p, pb, { label: 'Enabled', get: function () { return !!cur().usePost; }, set: function (v) { cur().usePost = v; touch(true); } });
    (function () {
      var labels = ['a', 'b', 'c', 'd', 'e', 'f'];
      var lg = U.el('div', { class: 'affine-grid' });
      labels.forEach(function (l) { lg.appendChild(U.el('div', { class: 'matlabel', text: l })); });
      var grid = U.el('div', { class: 'affine-grid' });
      var inputs = [];
      for (var i = 0; i < 6; i++) {
        (function (i) {
          var inp = U.el('input', { type: 'number', step: '0.001' });
          inp.addEventListener('change', function () { var v = parseFloat(inp.value); if (isNaN(v)) return; cur().post[i] = v; touch(true); });
          inputs.push(inp); grid.appendChild(inp);
        })(i);
      }
      pb.appendChild(lg); pb.appendChild(grid);
      p.add({ update: function () { var m = cur().post; for (var i = 0; i < 6; i++) if (document.activeElement !== inputs[i]) inputs[i].value = (+m[i]).toFixed(4); } });
    })();

    // variations
    var gv = U.group(root, 'Variations', { key: 'vars' });
    var names = VAR.list.map(function (v) { return v.name; }).sort();
    x.vars.forEach(function (entry, vi) {
      var box = U.el('div', { class: 'varrow' });
      var sel = U.el('select');
      names.forEach(function (n) { sel.appendChild(U.el('option', { value: n, text: n })); });
      sel.value = entry.v;
      sel.addEventListener('change', function () {
        var d = VAR.byName[sel.value];
        cur().vars[vi] = { v: sel.value, w: cur().vars[vi].w, p: VAR.defaults(d.id) };
        touch(true); buildTransformsPane();
      });
      var del = U.el('button', { text: '×', class: 'danger', onclick: function () { cur().vars.splice(vi, 1); if (!cur().vars.length) cur().vars.push({ v: 'linear', w: 1, p: [0, 0, 0, 0, 0, 0] }); touch(true); buildTransformsPane(); } });
      box.appendChild(U.el('div', { class: 'vhead' }, [sel, del]));
      var sub = new U.Panel(box);
      U.slider(sub, box, {
        label: 'weight', min: -2, max: 2, step: 0.005,
        get: function () { return cur().vars[vi].w; },
        set: function (v) { cur().vars[vi].w = v; touch(true); }
      });
      var def = VAR.byName[entry.v];
      if (def) def.params.forEach(function (pd, pi) {
        U.slider(sub, box, {
          label: pd.name, min: pd.min, max: pd.max, step: (pd.max - pd.min) / 400,
          reset: pd.def,
          get: function () { return cur().vars[vi].p[pi] || 0; },
          set: function (v) { cur().vars[vi].p[pi] = v; touch(true); }
        });
      });
      sub.controls.forEach(function (c) { p.add(c); });
      gv.appendChild(box);
    });
    U.buttons(gv, [
      { label: '+ Variation', onclick: function () { if (cur().vars.length >= GEN.MAX_VARS) return toast('8 variations max'); cur().vars.push({ v: 'linear', w: 0.25, p: [0, 0, 0, 0, 0, 0] }); touch(true); buildTransformsPane(); } },
      { label: 'Normalise', title: 'Scale weights so they sum to 1', onclick: function () { var s = 0; cur().vars.forEach(function (v) { s += Math.abs(v.w); }); if (s > 0) cur().vars.forEach(function (v) { v.w /= s; }); touch(true); buildTransformsPane(); } },
      { label: 'Randomise set', onclick: function () { cur().vars = GEN.randomVariationSet(new GEN.RNG((Math.random() * 4294967296) >>> 0), app.settings.genMaxVars); touch(true); buildTransformsPane(); } }
    ]);

    // xaos
    var gx = U.group(root, 'Xaos  (transition weights)', { key: 'xaos', collapsed: true });
    U.hint(gx, 'Row = current transform, column = next. 1 is neutral, 0 forbids the jump.');
    var n = g.xforms.length;
    var grid = U.el('div', { class: 'xaos-grid', style: 'grid-template-columns:28px repeat(' + n + ',1fr)' });
    grid.appendChild(U.el('div', { class: 'xaos-head', text: '' }));
    for (var c2 = 0; c2 < n; c2++) grid.appendChild(U.el('div', { class: 'xaos-head', text: 'X' + (c2 + 1) }));
    for (var rI = 0; rI < n; rI++) {
      grid.appendChild(U.el('div', { class: 'xaos-head', text: 'X' + (rI + 1) }));
      for (var cI = 0; cI < n; cI++) {
        (function (rI, cI) {
          var inp = U.el('input', { type: 'number', step: '0.1', min: '0' });
          inp.value = (g.xforms[rI].xaos && g.xforms[rI].xaos[cI] !== undefined) ? g.xforms[rI].xaos[cI] : 1;
          inp.addEventListener('change', function () {
            var v = Math.max(0, parseFloat(inp.value) || 0);
            var xs = app.genome.xforms;
            for (var q = 0; q < xs.length; q++) {
              if (!xs[q].xaos || xs[q].xaos.length !== xs.length) { xs[q].xaos = []; for (var k = 0; k < xs.length; k++) xs[q].xaos.push(1); }
            }
            xs[rI].xaos[cI] = v; touch(true);
          });
          grid.appendChild(inp);
        })(rI, cI);
      }
    }
    gx.appendChild(grid);
    U.buttons(gx, [{ label: 'Reset xaos', onclick: function () { g.xforms.forEach(function (x) { x.xaos = null; }); touch(true); buildTransformsPane(); } }]);
  }

  /* ---------- Palette -------------------------------------------------- */
  function buildPalettePane() {
    var root = document.querySelector('[data-pane=palette]');
    var p = new U.Panel(root); app.panels.palette = p; p.clear();

    var bar = U.el('canvas', { class: 'palbar', width: 512, height: 26 });
    root.appendChild(bar);
    function drawBar() {
      var ctx = bar.getContext('2d');
      var lut = PAL.buildLUT(app.genome.palette);
      var img = ctx.createImageData(512, 26);
      for (var x = 0; x < 512; x++) {
        var i = Math.floor(x / 512 * 255);
        for (var y = 0; y < 26; y++) {
          var o = (y * 512 + x) * 4;
          img.data[o] = lut[i * 4] * 255; img.data[o + 1] = lut[i * 4 + 1] * 255;
          img.data[o + 2] = lut[i * 4 + 2] * 255; img.data[o + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    }
    p.add({ update: drawBar });
    drawBar();

    function palTouch() { touch(true); drawBar(); }

    var gs = U.group(root, 'Source');
    U.select(p, gs, {
      label: 'Mode', options: PAL.GEN_MODES.concat(['stops']),
      get: function () { return app.genome.palette.mode; },
      set: function (v) { app.genome.palette.mode = v; if (v !== 'stops') app.genome.palette.stops = null; palTouch(); buildPalettePane(); }
    });
    U.select(p, gs, {
      label: 'Preset', options: PAL.PRESET_NAMES,
      get: function () { return app.genome.palette.preset || PAL.PRESET_NAMES[0]; },
      set: function (v) { app.genome.palette.preset = v; app.genome.palette.mode = 'preset'; app.genome.palette.stops = null; palTouch(); buildPalettePane(); }
    });
    U.number(p, gs, {
      label: 'Seed', step: 1,
      get: function () { return app.genome.palette.seed; },
      set: function (v) { app.genome.palette.seed = v >>> 0; app.genome.palette.stops = null; palTouch(); buildPalettePane(); }
    });
    U.buttons(gs, [
      { label: 'Random palette', class: 'primary', onclick: function () { app.genome.palette = PAL.randomPalette(Math.random); PAL.bake(app.genome.palette); palTouch(); buildPalettePane(); } },
      { label: 'Bake to stops', title: 'Freeze the generated gradient into editable colour stops', onclick: function () { PAL.bake(app.genome.palette); app.genome.palette.mode = 'stops'; palTouch(); buildPalettePane(); } },
      { label: 'Reverse', onclick: function () { app.genome.palette.reverse = !app.genome.palette.reverse; palTouch(); } }
    ]);

    var ga = U.group(root, 'Adjust');
    U.slider(p, ga, { label: 'Rotate', min: -1, max: 1, step: 0.002, reset: 0, get: function () { return app.genome.palette.rotate || 0; }, set: function (v) { app.genome.palette.rotate = v; palTouch(); } });
    U.slider(p, ga, { label: 'Hue shift', min: -0.5, max: 0.5, step: 0.002, reset: 0, get: function () { return app.genome.palette.hueShift || 0; }, set: function (v) { app.genome.palette.hueShift = v; palTouch(); } });
    U.slider(p, ga, { label: 'Saturation', min: 0, max: 2, step: 0.01, reset: 1, get: function () { return app.genome.palette.saturation === undefined ? 1 : app.genome.palette.saturation; }, set: function (v) { app.genome.palette.saturation = v; palTouch(); } });
    U.slider(p, ga, { label: 'Value', min: 0, max: 2, step: 0.01, reset: 1, get: function () { return app.genome.palette.value === undefined ? 1 : app.genome.palette.value; }, set: function (v) { app.genome.palette.value = v; palTouch(); } });
    U.slider(p, ga, { label: 'Contrast', min: 0.2, max: 2.5, step: 0.01, reset: 1, get: function () { return app.genome.palette.contrast === undefined ? 1 : app.genome.palette.contrast; }, set: function (v) { app.genome.palette.contrast = v; palTouch(); } });
    U.check(p, ga, { label: 'Smooth', get: function () { return app.genome.palette.smooth !== false; }, set: function (v) { app.genome.palette.smooth = v; palTouch(); } });

    var gt = U.group(root, 'Colour stops', { collapsed: app.genome.palette.mode !== 'stops' });
    var stopsBox = U.el('div', { class: 'stops' });
    gt.appendChild(stopsBox);
    function drawStops() {
      stopsBox.innerHTML = '';
      var pal = app.genome.palette;
      if (!pal.stops) { stopsBox.appendChild(U.el('div', { class: 'hint', text: 'Bake to stops to edit individual colours.' })); return; }
      pal.stops.forEach(function (s, i) {
        var inp = U.el('input', { type: 'color', value: PAL.rgb2hex(s.c) });
        inp.addEventListener('input', function () { s.c = PAL.hex2rgb(inp.value); palTouch(); });
        var del = U.el('button', { text: '×', onclick: function () { if (pal.stops.length <= 2) return; pal.stops.splice(i, 1); reflow(pal); palTouch(); drawStops(); } });
        stopsBox.appendChild(U.el('div', { class: 'stop' }, [inp, del]));
      });
      var add = U.el('button', { text: '+', onclick: function () { pal.stops.push({ p: 1, c: [1, 1, 1] }); reflow(pal); palTouch(); drawStops(); } });
      stopsBox.appendChild(U.el('div', { class: 'stop' }, [add]));
    }
    function reflow(pal) { pal.stops.forEach(function (s, i) { s.p = i / Math.max(1, pal.stops.length - 1); }); }
    drawStops();
    p.add({ update: drawStops });
  }

  /* ---------- Render --------------------------------------------------- */
  function buildRenderPane() {
    var root = document.querySelector('[data-pane=render]');
    var p = new U.Panel(root); app.panels.render = p; p.clear();
    function R() { return app.genome.render; }
    function s(parent, label, key, min, max, step, reset, title, needClear) {
      U.slider(p, parent, {
        label: label, min: min, max: max, step: step, reset: reset, title: title,
        get: function () { return R()[key]; },
        set: function (v) { R()[key] = v; if (needClear) touch(true); markLook(); }
      });
    }
    var keep = !!app.settings.keepImage;
    root.appendChild(U.el('div', { class: 'btnrow' }, [
      U.el('button', {
        text: keep ? '\u25cf  Kept across new sheep' : '\u25cb  Reset with each new sheep',
        class: 'toggle' + (keep ? ' on' : ''),
        title: 'When on, everything on this tab carries over to sheep you generate, instead of being replaced by their own randomised look',
        onclick: function () {
          app.settings.keepImage = !app.settings.keepImage;
          app.settings.imageLook = app.settings.keepImage ? currentLook() : null;
          saveSettings(); buildRenderPane();
          toast(app.settings.keepImage
            ? 'Image settings will carry across new sheep'
            : 'New sheep will bring their own image settings');
        }
      })
    ]));
    U.hint(root, keep
      ? 'Everything on this tab — including symmetry — carries over to sheep you generate, and to mutations. Sheep loaded from your flock still bring their own saved look.'
      : 'Each new sheep arrives with its own randomised look, replacing what is set here.');

    var gt = U.group(root, 'Tone mapping');
    s(gt, 'Brightness', 'brightness', 0.2, 14, 0.01, 3.2, 'Overall exposure of the log-density map');
    s(gt, 'Gamma', 'gamma', 1.0, 8, 0.01, 4.0, 'Higher gamma lifts the faint structure');
    s(gt, 'Gamma thresh.', 'gammaThreshold', 0, 0.2, 0.001, 0.02, 'Linear ramp near black — keeps noise out of the shadows');
    s(gt, 'Vibrancy', 'vibrancy', 0, 1, 0.005, 1.0, 'Blend between per-channel and luminance gamma');
    s(gt, 'Highlight roll', 'highlightPower', 0, 2, 0.01, 0, 'Soften blown-out cores');

    var gd = U.group(root, 'Sampling & filter');
    U.check(p, gd, {
      label: 'Density estimation', note: 'smooths sparse regions',
      get: function () { return R().de; }, set: function (v) { R().de = v; markLook(); }
    });
    s(gd, 'DE radius', 'deRadius', 0, 5, 0.05, 1.6);
    s(gd, 'DE falloff', 'deAlpha', 0.05, 1.5, 0.01, 0.45);
    s(gd, 'Jitter', 'jitter', 0, 3, 0.05, 1.0, 'Sub-pixel scatter — the anti-aliasing filter', true);
    s(gd, 'Denoise', 'denoise', 0, 4, 1, 0,
      'Edge-avoiding wavelet passes applied after tone mapping — 0 is off. Each pass widens the filter, so 2 already covers a lot of ground.');
    s(gd, 'Denoise strength', 'denoiseStrength', 0, 1, 0.01, 0.5,
      'How readily the filter blurs across a difference in brightness or density. Low keeps every filament; high smooths harder and can soften fine detail.');
    U.slider(p, gd, {
      label: 'Symmetry', min: 1, max: 16, step: 1,
      title: 'Rotational symmetry applied at splat time',
      get: function () { return R().symmetry; },
      set: function (v) { R().symmetry = v | 0; touch(true); markLook(); }
    });
    U.check(p, gd, {
      label: 'Mirror', note: 'add reflection',
      get: function () { return R().symmetryMirror; }, set: function (v) { R().symmetryMirror = v; touch(true); markLook(); }
    });

    var gp = U.group(root, 'Post processing');
    s(gp, 'Glow', 'glow', 0, 1.5, 0.005, 0.25);
    s(gp, 'Glow radius', 'glowRadius', 0.2, 8, 0.05, 2.0);
    s(gp, 'Glow threshold', 'glowThreshold', 0, 1.5, 0.005, 0.55);
    s(gp, 'Vignette', 'vignette', 0, 1.5, 0.005, 0.25);
    s(gp, 'Grain', 'grain', 0, 0.2, 0.002, 0);
    s(gp, 'Contrast', 'contrast', 0.2, 2.5, 0.005, 1);
    s(gp, 'Saturation', 'saturation', 0, 2.5, 0.005, 1);
    s(gp, 'Hue shift', 'hueShift', -0.5, 0.5, 0.002, 0);
    U.color(p, gp, {
      label: 'Background',
      get: function () { return PAL.rgb2hex(R().background); },
      set: function (v) { R().background = PAL.hex2rgb(v); markLook(); }
    });

    var gm = U.group(root, 'Motion');
    U.slider(p, gm, {
      label: 'Trail decay', min: 0, max: 0.995, step: 0.001,
      fmt: function (v) { return v <= 0 ? 'none' : v.toFixed(3); },
      title: 'How much of the previous exposure survives each frame while something is moving. 0 keeps no trail at all — every frame is a fresh exposure, so motion is crisp but grainier.',
      get: function () { return app.settings.decay; },
      set: function (v) { app.settings.decay = v; saveSettings(); }
    });
    U.hint(gm, 'Applies whenever anything is moving — a sheep playing its loop, a stream, or camera spin. A still sheep ignores it and keeps accumulating instead, getting cleaner the longer you leave it. At 0 nothing carries over between frames: no ghosting, but each frame stands on its own samples alone, so raise the particle count or passes to compensate.');
    U.buttons(gm, [{ label: 'Reset all render settings', onclick: function () { app.genome.render = GEN.defaultRender(); app.settings.imageLook = null; saveSettings(); touch(true); refreshAll(); buildRenderPane(); } }]);
  }

  /* ---------- Loop ------------------------------------------------------- */
  function buildLoopPane() {
    var root = document.querySelector('[data-pane=loop]');
    if (!root) return;
    var p = new U.Panel(root); app.panels.loop = p; p.clear();
    var g = app.genome;
    if (!g.loop) g.loop = GEN.defaultLoop();

    U.hint(root, 'A sheep is not a still — it is a short animation that comes back to exactly where it started, so it can repeat forever without a seam. Each channel below drives one parameter around a cycle.');

    var gm = U.group(root, 'Loop');
    U.check(p, gm, {
      label: 'Animated', note: 'play this sheep as a loop',
      get: function () { return !!app.genome.loop.enabled; },
      set: function (v) { app.genome.loop.enabled = v; app.loopPhase = 0; touch(true); refreshOverlay(); }
    });
    U.slider(p, gm, {
      label: 'Loop length', min: 1, max: 90, step: 0.5,
      fmt: function (v) { return v.toFixed(1) + 's'; },
      title: 'How long one cycle of this sheep takes.',
      get: function () { return app.genome.loop.seconds; },
      set: function (v) { app.genome.loop.seconds = v; }
    });
    if (app.settings.streamLoopOverride) {
      U.hint(gm, 'The stream is currently overriding this: every sheep runs at ' +
        (+app.settings.streamLoopSecs).toFixed(1) + 's. Change that in the Stream panel, under Loops.');
    } else if (app.stream.active) {
      U.hint(gm, 'While the stream runs it uses each sheep\u2019s own saved length. To set one pace for the whole stream, turn on the override in the Stream panel under Loops.');
    }

    // scrub through the loop by hand (most useful while paused)
    var scrubIn = U.el('input', { type: 'range', min: 0, max: 1, step: 0.002 });
    var scrubVal = U.el('span', { class: 'val', text: '0%' });
    scrubIn.addEventListener('input', function () {
      app.loopPhase = parseFloat(scrubIn.value);
      scrubVal.textContent = Math.round(app.loopPhase * 100) + '%';
      app.renderer.setGenome(GEN.applyLoop(app.genome, app.loopPhase), true);
      app.renderer.clearAccum();
    });
    U.row(gm, 'Phase', [scrubIn, scrubVal], 'Scrub the loop. Pause playback first to hold a frame.');
    p.scrub = function (ph) {
      if (document.activeElement === scrubIn) return;
      scrubIn.value = ph; scrubVal.textContent = Math.round(ph * 100) + '%';
    };

    U.buttons(gm, [
      { label: 'Generate loop', class: 'primary', title: 'Choreograph a fresh set of channels for this sheep', onclick: function () { app.genome.loop = GEN.randomLoop(new GEN.RNG((Math.random() * 4294967296) >>> 0), app.genome); GEN.normalize(app.genome); app.loopPhase = 0; touch(true); buildLoopPane(); refreshOverlay(); toast('New loop: ' + app.genome.loop.animators.length + ' channels'); } },
      { label: 'Clear', onclick: function () { app.genome.loop = GEN.defaultLoop(); app.loopPhase = 0; touch(true); buildLoopPane(); refreshOverlay(); } }
    ]);

    var gc = U.group(root, 'Motion channels');
    var n = g.xforms.length;
    var targets = GEN.LOOP_TARGETS.map(function (t) { return { value: t.t, label: t.label }; });

    g.loop.animators.forEach(function (an, ai) {
      var meta = GEN.LOOP_TARGET_BY_T[an.t] || {};
      var box = U.el('div', { class: 'varrow' });
      var sel = U.el('select');
      targets.forEach(function (t) { sel.appendChild(U.el('option', { value: t.value, text: t.label })); });
      sel.value = an.t;
      sel.addEventListener('change', function () {
        var m2 = GEN.LOOP_TARGET_BY_T[sel.value] || {};
        var fresh = { t: sel.value, k: 1 };
        if (m2.xform) fresh.x = 0;
        if (m2.slot) fresh.s = 0;
        if (m2.param) fresh.q = 0;
        if (m2.ramp) { fresh.a = 1; fresh.p = 0; } else { fresh.a = m2.def || 0.2; fresh.p = 0; }
        app.genome.loop.animators[ai] = fresh;
        touch(true); buildLoopPane();
      });
      var del = U.el('button', { text: '×', class: 'danger', onclick: function () { app.genome.loop.animators.splice(ai, 1); touch(true); buildLoopPane(); refreshOverlay(); } });
      box.appendChild(U.el('div', { class: 'vhead' }, [sel, del]));
      var sub = new U.Panel(box);

      if (meta.xform) {
        var opts = [];
        for (var i = 0; i < n; i++) opts.push({ value: String(i), label: 'Transform ' + (i + 1) });
        if (app.genome.final) opts.push({ value: '-1', label: 'Final transform' });
        U.select(sub, box, {
          label: 'on', options: opts,
          get: function () { return String(app.genome.loop.animators[ai].x); },
          set: function (v) { app.genome.loop.animators[ai].x = parseInt(v, 10); touch(true); buildLoopPane(); }
        });
      }
      if (meta.slot) {
        var xi = an.x === -1 ? null : g.xforms[an.x];
        var xf = an.x === -1 ? g.final : xi;
        var sopts = [];
        if (xf) xf.vars.forEach(function (v, si) { sopts.push({ value: String(si), label: (si + 1) + '. ' + v.v }); });
        if (!sopts.length) sopts.push({ value: '0', label: '—' });
        U.select(sub, box, {
          label: 'variation', options: sopts,
          get: function () { return String(app.genome.loop.animators[ai].s || 0); },
          set: function (v) { app.genome.loop.animators[ai].s = parseInt(v, 10); touch(true); buildLoopPane(); }
        });
        if (meta.param) {
          var xf2 = an.x === -1 ? g.final : g.xforms[an.x];
          var sv = xf2 && xf2.vars[an.s || 0];
          var def = sv && VAR.byName[sv.v];
          var popts = [];
          if (def) def.params.forEach(function (pd, qi) { popts.push({ value: String(qi), label: pd.name }); });
          if (!popts.length) popts.push({ value: '0', label: 'no parameters' });
          U.select(sub, box, {
            label: 'parameter', options: popts,
            get: function () { return String(app.genome.loop.animators[ai].q || 0); },
            set: function (v) { app.genome.loop.animators[ai].q = parseInt(v, 10); touch(true); }
          });
        }
      }

      if (meta.ramp) {
        U.slider(sub, box, {
          label: 'turns', min: 1, max: 4, step: 1,
          title: 'Whole turns per loop. It must be a whole number or the loop would not close.',
          get: function () { return app.genome.loop.animators[ai].k; },
          set: function (v) { app.genome.loop.animators[ai].k = v | 0; touch(true); }
        });
      } else {
        var amp = meta.amp || [0, 1];
        U.slider(sub, box, {
          label: 'amount', min: -amp[1], max: amp[1], step: (amp[1] * 2) / 400,
          get: function () { return app.genome.loop.animators[ai].a; },
          set: function (v) { app.genome.loop.animators[ai].a = v; touch(true); }
        });
        U.slider(sub, box, {
          label: 'cycles', min: 1, max: 6, step: 1,
          title: 'How many times this channel swings back and forth per loop. Whole numbers only.',
          get: function () { return app.genome.loop.animators[ai].k; },
          set: function (v) { app.genome.loop.animators[ai].k = v | 0; touch(true); }
        });
        U.slider(sub, box, {
          label: 'offset', min: 0, max: 1, step: 0.005,
          title: 'Where in its cycle this channel starts, so channels do not all move together.',
          get: function () { return app.genome.loop.animators[ai].p; },
          set: function (v) { app.genome.loop.animators[ai].p = v; touch(true); }
        });
      }
      sub.controls.forEach(function (c) { p.add(c); });
      gc.appendChild(box);
    });

    if (!g.loop.animators.length) U.hint(gc, 'No channels yet — press Generate loop, or add one.');
    U.buttons(gc, [
      { label: '+ Channel', onclick: function () { app.genome.loop.animators.push({ t: 'spin', x: 0, k: 1, a: 1, p: 0 }); app.genome.loop.enabled = true; GEN.normalize(app.genome); touch(true); buildLoopPane(); refreshOverlay(); } }
    ]);
  }

  /* ---------- Evolve ---------------------------------------------------- */
  function buildEvolvePane() {
    var root = document.querySelector('[data-pane=evolve]');
    var p = new U.Panel(root); app.panels.evolve = p; p.clear();

    U.hint(root, 'Click thumbnails to choose parents, then Breed. Or let auto-evolution score each generation on its own.');
    var gal = U.el('div', { class: 'gallery', id: 'popgal' });
    root.appendChild(gal);

    U.buttons(root, [
      { label: 'New population', onclick: function () { seedPopulation(); } },
      { label: 'Breed selected', class: 'primary', onclick: function () { breedSelected(); } },
      { label: 'Next generation', onclick: function () { nextGeneration(); } },
      {
        label: app.autoEvolve ? 'Stop auto-evolve' : 'Auto-evolve', class: app.autoEvolve ? 'on' : '',
        onclick: function () { app.autoEvolve = !app.autoEvolve; buildEvolvePane(); if (app.autoEvolve) autoEvolveTick(); }
      }
    ]);
    U.buttons(root, [
      { label: 'Load selected', onclick: function () { var ids = Object.keys(app.popSelected).filter(function (k) { return app.popSelected[k]; }); if (!ids.length) return toast('Nothing selected'); var m = app.pop.members[ids[0] | 0]; if (m) setGenome(GEN.clone(m.genome)); } },
      { label: 'Keep selected', onclick: function () { var any = 0; Object.keys(app.popSelected).forEach(function (k) { if (!app.popSelected[k]) return; var m = app.pop.members[k | 0]; if (m) { app.library.add(m.genome, m.thumb); any++; } }); renderLibrary(); toast(any + ' kept'); } },
      { label: 'Seed from current', onclick: function () { seedPopulationFrom(app.genome); } }
    ]);

    var gset = U.group(root, 'Breeding settings', { collapsed: true });
    U.slider(p, gset, { label: 'Population', min: 3, max: 18, step: 1, get: function () { return app.settings.popSize; }, set: function (v) { app.settings.popSize = v | 0; saveSettings(); } });
    U.slider(p, gset, { label: 'Mutation strength', min: 0.05, max: 1.2, step: 0.01, get: function () { return app.settings.mutStrength; }, set: function (v) { app.settings.mutStrength = v; saveSettings(); } });
    U.slider(p, gset, { label: 'Mutation rate', min: 0, max: 1, step: 0.01, title: 'Share of offspring from mutation vs crossover', get: function () { return app.settings.mutRate; }, set: function (v) { app.settings.mutRate = v; saveSettings(); } });
    U.slider(p, gset, { label: 'Fresh blood', min: 0, max: 0.6, step: 0.01, title: 'Share of each generation that is brand new', get: function () { return app.settings.freshRate; }, set: function (v) { app.settings.freshRate = v; saveSettings(); } });

    var gfit = U.group(root, 'Fitness weights', { collapsed: true });
    U.hint(gfit, 'What the automatic judge rewards when nobody is watching.');
    [['fitCoverage', 'Coverage'], ['fitEntropy', 'Tonal range'], ['fitColour', 'Colourfulness'], ['fitDetail', 'Detail'], ['fitContrast', 'Contrast']].forEach(function (kv) {
      U.slider(p, gfit, { label: kv[1], min: 0, max: 3, step: 0.05, get: function () { return app.settings[kv[0]]; }, set: function (v) { app.settings[kv[0]] = v; saveSettings(); } });
    });

    renderPopulation();
  }

  function fitWeights() {
    return {
      coverage: app.settings.fitCoverage, entropy: app.settings.fitEntropy,
      colour: app.settings.fitColour, detail: app.settings.fitDetail, contrast: app.settings.fitContrast
    };
  }

  function renderPopulation() {
    var gal = document.getElementById('popgal');
    if (!gal || !app.pop) return;
    gal.innerHTML = '';
    app.pop.members.forEach(function (m, i) {
      var cell = U.el('div', { class: 'cell' + (app.popSelected[i] ? ' sel' : ''), title: m.genome.name });
      if (m.thumb) cell.appendChild(U.el('img', { src: m.thumb }));
      else cell.appendChild(U.el('div', { class: 'ph', text: '…' }));
      cell.appendChild(U.el('div', { class: 'score', text: m.genome.name + ' · ' + (m.score ? m.score.toFixed(2) : '–') }));
      if (app.popSelected[i]) cell.appendChild(U.el('div', { class: 'pin', text: '★' }));
      cell.addEventListener('click', function (e) {
        if (e.altKey) { setGenome(GEN.clone(m.genome)); return; }
        app.popSelected[i] = !app.popSelected[i];
        renderPopulation();
      });
      cell.addEventListener('dblclick', function () { setGenome(GEN.clone(m.genome)); });
      gal.appendChild(cell);
    });
  }

  function scorePopulation(onDone) {
    var jobs = app.pop.members.map(function (m) { return { genome: m.genome, opts: { measure: true, passes: 20 }, m: m }; });
    thumbQueue(jobs, function (job, url, stats) {
      job.m.thumb = url;
      job.m.score = EVO.fitness(stats, fitWeights());
      job.m.stats = stats;
      renderPopulation();
    }, function () { if (onDone) onDone(); });
  }

  function seedPopulation() {
    app.pop = new EVO.Population({
      size: app.settings.popSize, mutationStrength: app.settings.mutStrength,
      mutationRate: app.settings.mutRate, freshRate: app.settings.freshRate
    });
    app.pop.seedRandom();
    app.popSelected = {};
    renderPopulation();
    scorePopulation();
  }
  function seedPopulationFrom(g) {
    if (!app.pop) app.pop = new EVO.Population({ size: app.settings.popSize });
    app.pop.size = app.settings.popSize;
    app.pop.members = [{ genome: GEN.clone(g), score: 0, thumb: null }];
    while (app.pop.members.length < app.pop.size) {
      app.pop.members.push({ genome: EVO.mutate(g, { strength: app.settings.mutStrength }), score: 0, thumb: null });
    }
    app.popSelected = {};
    renderPopulation();
    scorePopulation();
  }
  function nextGeneration(parents) {
    if (!app.pop) { seedPopulation(); return; }
    app.pop.size = app.settings.popSize;
    app.pop.mutationStrength = app.settings.mutStrength;
    app.pop.mutationRate = app.settings.mutRate;
    app.pop.freshRate = app.settings.freshRate;
    app.pop.advance(parents);
    app.popSelected = {};
    renderPopulation();
    scorePopulation();
  }
  function breedSelected() {
    if (!app.pop) return;
    var parents = Object.keys(app.popSelected)
      .filter(function (k) { return app.popSelected[k]; })
      .map(function (k) { return app.pop.members[k | 0]; })
      .filter(Boolean).map(function (m) { return m.genome; });
    if (!parents.length) return toast('Select one or more thumbnails first');
    nextGeneration(parents);
  }
  function autoEvolveTick() {
    if (!app.autoEvolve) return;
    if (!app.pop) seedPopulation();
    scorePopulation(function () {
      if (!app.autoEvolve) return;
      var best = app.pop.sorted()[0];
      if (best && best.score > 0.62) app.library.add(best.genome, best.thumb), renderLibrary();
      nextGenerationQuiet();
      setTimeout(autoEvolveTick, 300);
    });
  }
  function nextGenerationQuiet() {
    app.pop.mutationStrength = app.settings.mutStrength;
    app.pop.mutationRate = app.settings.mutRate;
    app.pop.freshRate = app.settings.freshRate;
    app.pop.size = app.settings.popSize;
    app.pop.advance();
    app.popSelected = {};
    renderPopulation();
  }

  /* ---------- Stream ---------------------------------------------------- */
  function buildStreamPane() {
    var root = document.querySelector('[data-pane=stream]');
    var p = new U.Panel(root); app.panels.stream = p; p.clear();

    U.hint(root, 'Settles on a sheep, plays its animation loop a few times, then morphs into the next one — and around forever.');

    // Source is a primary control: it decides whether the playlist below is
    // used at all, so it lives in plain sight rather than inside a group.
    U.select(p, root, {
      label: 'Source',
      options: [{ value: 'flock', label: 'Flock playlist' }, { value: 'endless', label: 'Endless — new sheep' }],
      title: 'Flock plays the playlist below. Endless ignores it and grows a brand new sheep every time.',
      get: function () { return app.settings.streamSource; },
      set: function (v) { app.settings.streamSource = v; saveSettings(); buildStreamPane(); }
    });

    var listEl = U.el('ul', { class: 'playlist', id: 'playlist' });
    root.appendChild(listEl);

    U.buttons(root, [
      { label: app.stream.active ? 'Stop stream' : 'Start stream', class: app.stream.active ? 'on' : 'primary', onclick: toggleStream },
      {
        label: 'Use whole flock',
        title: 'Load every kept sheep into the playlist and play from it',
        onclick: function () {
          if (!app.library.items.length) { toast('The flock is empty — press K to keep the current sheep'); return; }
          app.stream.list = app.library.items.map(function (i) { return i.id; });
          app.stream.idx = 0; app.stream.t = 0;
          // do what the button says: switch to the flock, don't be overridden
          app.settings.streamSource = 'flock'; saveSettings();
          buildStreamPane();
          toast('Playlist: ' + app.stream.list.length + ' sheep');
        }
      },
      {
        label: '+ Add current',
        onclick: function () {
          var it = app.library.add(app.genome, null);
          if (app.stream.list.indexOf(it.id) < 0) app.stream.list.push(it.id);
          app.settings.streamSource = 'flock'; saveSettings();
          renderLibrary(); buildStreamPane();
        }
      },
      { label: 'Clear list', onclick: function () { app.stream.list = []; buildStreamPane(); } }
    ]);

    var gl = U.group(root, 'Loops');
    U.hint(gl, 'Each sheep is a short animation that returns exactly to where it began. The stream plays that loop through this many times before moving on.');
    U.slider(p, gl, {
      label: 'Loops per sheep', min: 1, max: 20, step: 1,
      get: function () { return app.settings.loopsPerSheep; },
      set: function (v) { app.settings.loopsPerSheep = v | 0; saveSettings(); }
    });
    var lenOn = !!app.settings.streamLoopOverride;
    gl.appendChild(U.el('div', { class: 'btnrow' }, [
      U.el('button', {
        text: lenOn ? '\u25cf  Same length for every sheep' : '\u25cb  Each sheep\u2019s own length',
        class: 'toggle' + (lenOn ? ' on' : ''),
        title: 'Override every sheep\u2019s stored loop length with one value, so the whole stream runs at a pace you choose',
        onclick: function () {
          app.settings.streamLoopOverride = !app.settings.streamLoopOverride;
          saveSettings(); buildStreamPane(); refreshOverlay();
        }
      })
    ]));
    if (lenOn) {
      U.slider(p, gl, {
        label: 'Loop length', min: 1, max: 90, step: 0.5,
        fmt: function (v) { return v.toFixed(1) + 's'; },
        title: 'Every sheep in the stream cycles at this rate, whatever length it was saved with.',
        get: function () { return app.settings.streamLoopSecs; },
        set: function (v) { app.settings.streamLoopSecs = v; saveSettings(); refreshOverlay(); }
      });
      U.hint(gl, 'Every sheep cycles at this rate. Their own saved lengths are left untouched — switch back and they return to them.');
    } else {
      U.hint(gl, 'Each sheep cycles at the length saved in its own genome (set per sheep in the Loop tab). Sheep with no loop fall back to the Hold time below.');
    }

    if (streamIsEndless()) {
      var ge = U.group(root, 'Endless — choosing the next sheep', { key: 'endless' });
      U.hint(ge, 'Every time the stream needs a new sheep it draws one of these four origins, weighted. Set any to zero to rule it out.');
      var n = app.library.items.length;
      U.slider(p, ge, {
        label: 'Brand new', min: 0, max: 2, step: 0.05,
        title: 'A fresh random sheep, built from the recipe in the Sheep panel',
        get: function () { return app.settings.endlessFresh; },
        set: function (v) { app.settings.endlessFresh = v; saveSettings(); updateEndlessMix(); }
      });
      U.slider(p, ge, {
        label: 'Mutation', min: 0, max: 2, step: 0.05,
        title: 'A mutated child of the sheep just played — a wandering lineage',
        get: function () { return app.settings.endlessMutate; },
        set: function (v) { app.settings.endlessMutate = v; saveSettings(); updateEndlessMix(); }
      });
      U.slider(p, ge, {
        label: 'Cross of two kept', min: 0, max: 2, step: 0.05,
        title: n >= 2 ? 'Breed two sheep from your flock together' : 'Needs at least two kept sheep',
        get: function () { return app.settings.endlessCross; },
        set: function (v) { app.settings.endlessCross = v; saveSettings(); updateEndlessMix(); }
      });
      U.slider(p, ge, {
        label: 'Straight from flock', min: 0, max: 2, step: 0.05,
        title: n >= 1 ? 'Replay one of your kept sheep, unchanged' : 'Needs at least one kept sheep',
        get: function () { return app.settings.endlessFlock; },
        set: function (v) { app.settings.endlessFlock = v; saveSettings(); updateEndlessMix(); }
      });
      ge.appendChild(U.el('div', { class: 'hint', id: 'endlessMix' }));
      updateEndlessMix();
      U.slider(p, ge, {
        label: 'Mutation strength', min: 0.05, max: 1.5, step: 0.01,
        title: 'How far a mutated pick strays from the sheep it came from',
        get: function () { return app.settings.endlessMutateStrength; },
        set: function (v) { app.settings.endlessMutateStrength = v; saveSettings(); }
      });
      U.check(p, ge, {
        label: 'Avoid repeats', note: 'never twice in a row',
        get: function () { return app.settings.endlessAvoidRepeat; },
        set: function (v) { app.settings.endlessAvoidRepeat = v; saveSettings(); }
      });

      var gq = U.group(root, 'Endless — quality', { key: 'endlessq' });
      U.slider(p, gq, {
        label: 'Audition', min: 1, max: 8, step: 1,
        fmt: function (v) { return 'best of ' + v.toFixed(0); },
        title: 'Candidates rendered and scored offscreen each time; the best one is shown. Higher is choosier but costs a moment at each handover.',
        get: function () { return app.settings.endlessTries; },
        set: function (v) { app.settings.endlessTries = v | 0; saveSettings(); }
      });
      U.slider(p, gq, {
        label: 'Good enough at', min: 0, max: 0.9, step: 0.01,
        title: 'Stop auditioning as soon as a candidate scores this well. Lower accepts sooner; higher keeps looking and uses more of the audition budget.',
        get: function () { return app.settings.endlessMinScore; },
        set: function (v) { app.settings.endlessMinScore = v; saveSettings(); }
      });
      U.hint(gq, 'Scored by the same judge the Evolve tab uses — coverage, tonal range, colourfulness, detail and contrast, weighted in that tab. It is what keeps empty black frames out of an unattended stream.');
      U.hint(ge, 'The shape of a brand-new sheep — how many transforms, how many variations, how wild — comes from "New sheep recipe" in the Sheep panel.');
    }

    var driftOn = !!app.settings.streamDriftOn;
    // never collapsed: the toggle has to be visible for its state to be readable
    var gd = U.group(root, driftOn ? 'Evolution drift — ON' : 'Evolution drift — off',
      { key: 'drift', collapsed: false });
    gd.appendChild(U.el('div', { class: 'btnrow' }, [
      U.el('button', {
        text: driftOn ? '\u25cf  Drift is ON' : '\u25cb  Drift is off',
        class: 'toggle' + (driftOn ? ' on' : ''),
        title: 'When on, the stream plays mutated generations of each sheep as well as the sheep in your flock',
        onclick: function () {
          app.settings.streamDriftOn = !app.settings.streamDriftOn;
          saveSettings(); buildStreamPane(); refreshOverlay();
          toast(app.settings.streamDriftOn
            ? 'Drift ON — mutated generations will play between your flock'
            : 'Drift off — the stream plays only your flock');
        }
      })
    ]));
    U.hint(gd, driftOn
      ? 'Each sheep mutates a little, settles, mutates again, and only then hands over to the next. Those generations are new sheep, not ones from your flock.'
      : 'Off: the stream plays your flock and nothing else. Turn on to have each sheep evolve through a few generations of its own before moving on.');
    if (!driftOn) return buildStreamTail(p, root);
    U.slider(p, gd, {
      label: 'Generations', min: 1, max: 12, step: 1,
      title: 'How many self-mutations each sheep goes through before the stream moves on.',
      get: function () { return Math.max(1, app.settings.streamDrift | 0); },
      set: function (v) { app.settings.streamDrift = v | 0; saveSettings(); }
    });
    U.slider(p, gd, {
      label: 'Drift strength', min: 0.03, max: 1, step: 0.01,
      title: 'How far each generation moves from its parent. Low values keep the family resemblance.',
      get: function () { return app.settings.streamDriftStrength; },
      set: function (v) { app.settings.streamDriftStrength = v; saveSettings(); }
    });
    U.slider(p, gd, {
      label: 'Pick best of', min: 1, max: 6, step: 1,
      title: 'Candidate children judged offscreen each generation; the best-scoring one is used. Higher is choosier but costs a moment at each handover.',
      get: function () { return app.settings.streamDriftTries; },
      set: function (v) { app.settings.streamDriftTries = v | 0; saveSettings(); }
    });
    U.slider(p, gd, {
      label: 'Settle', min: 0, max: 10, step: 0.25,
      title: 'Pause on each generation before evolving on. 0 runs the whole lineage as one unbroken morph.',
      fmt: function (v) { return v ? v.toFixed(2) + 's' : 'continuous'; },
      get: function () { return app.settings.streamDriftHold; },
      set: function (v) { app.settings.streamDriftHold = v; saveSettings(); }
    });

    return buildStreamTail(p, root);
  }

  function buildStreamTail(p, root) {
    var gs = U.group(root, 'Timing');
    U.hint(gs, 'Hold applies when the stream arrives at a new sheep.');
    U.slider(p, gs, { label: 'Hold', min: 0, max: 30, step: 0.5, fmt: function (v) { return v.toFixed(1) + 's'; }, get: function () { return app.settings.streamHold; }, set: function (v) { app.settings.streamHold = v; saveSettings(); } });
    U.slider(p, gs, { label: 'Transition', min: 0.5, max: 30, step: 0.5, fmt: function (v) { return v.toFixed(1) + 's'; }, get: function () { return app.settings.streamTrans; }, set: function (v) { app.settings.streamTrans = v; saveSettings(); } });
    U.check(p, gs, { label: 'Shuffle', get: function () { return app.settings.streamShuffle; }, set: function (v) { app.settings.streamShuffle = v; saveSettings(); } });

    U.hint(gs, 'Recording and rendering to a file have moved to the Render tab.');

    U.buttons(root, [{
      label: 'Reset to defaults',
      class: 'danger',
      title: 'Restore every setting on this tab',
      onclick: function (ev) {
        var btn = ev.currentTarget;
        if (btn.getAttribute('data-armed') === '1') { resetStreamSettings(); return; }
        // two-step, so one stray click cannot wipe a tuned setup
        btn.setAttribute('data-armed', '1');
        btn.textContent = 'Sure? Click again';
        btn.classList.add('on');
        setTimeout(function () {
          if (!btn.parentNode) return;
          btn.setAttribute('data-armed', '0');
          btn.textContent = 'Reset to defaults';
          btn.classList.remove('on');
        }, 3000);
      }
    }]);
    U.hint(root, 'Restores everything on this tab — source, loops, drift, the endless mix and timing. Your playlist and your flock are left alone.');

    renderPlaylist();
  }

  /* The playlist is a list of DOM nodes with thumbnails in it, and rebuilding
     it costs several milliseconds. It used to be rebuilt on the very frame a
     sheep arrived -- the one frame that must not stutter. Defer it, and skip
     it entirely when the Stream tab is not the one being looked at. */
  var playlistTimer = null;
  function schedulePlaylist() {
    if (playlistTimer) return;
    playlistTimer = setTimeout(function () {
      playlistTimer = null;
      var pane = document.querySelector('[data-pane=stream]');
      if (pane && pane.classList.contains('active')) renderPlaylist();
    }, 150);
  }

  function renderPlaylist() {
    var el = document.getElementById('playlist');
    if (!el) return;
    el.innerHTML = '';
    pruneStreamList();
    var ignored = app.settings.streamSource === 'endless';
    if (!app.stream.list.length) {
      el.appendChild(U.el('li', {}, [U.el('span', {
        class: 'nm',
        text: app.library.items.length
          ? 'Playlist empty — press "Use whole flock" to load your ' + app.library.items.length + ' kept sheep.'
          : 'Playlist empty — keep some sheep (K) or leave Source on Endless.'
      })]));
      return;
    }
    if (driftGenerations() > 0 && !ignored) {
      el.appendChild(U.el('li', { class: 'note' }, [
        U.el('span', { class: 'nm', text: 'Evolution drift is ON: ' + driftGenerations() +
          ' mutated generations play between these, so you will see sheep that are not in your flock.' }),
        U.el('button', {
          text: 'Turn off', onclick: function () {
            app.settings.streamDriftOn = false; saveSettings(); buildStreamPane();
          }
        })
      ]));
    }
    if (ignored) {
      // never silently swallow the flock: show it, and say why it is inactive
      el.appendChild(U.el('li', { class: 'note' }, [
        U.el('span', { class: 'nm', text: 'Source is Endless, so these ' + app.stream.list.length + ' are not being played.' }),
        U.el('button', {
          text: 'Play these', onclick: function () {
            app.settings.streamSource = 'flock'; saveSettings(); buildStreamPane();
          }
        })
      ]));
    }
    app.stream.list.forEach(function (id, i) {
      var it = app.library.get(id);
      if (!it) return;
      var li = U.el('li', { class: ((app.stream.active && !ignored && i === app.stream.idx) ? 'playing ' : '') + (ignored ? 'muted' : '') });
      if (it.thumb) li.appendChild(U.el('img', { src: it.thumb }));
      li.appendChild(U.el('span', { class: 'nm', text: (i + 1) + '. ' + it.name }));
      li.appendChild(U.el('button', { text: '↑', onclick: function () { if (i > 0) { var t = app.stream.list[i - 1]; app.stream.list[i - 1] = app.stream.list[i]; app.stream.list[i] = t; renderPlaylist(); } } }));
      li.appendChild(U.el('button', { text: '↓', onclick: function () { if (i < app.stream.list.length - 1) { var t = app.stream.list[i + 1]; app.stream.list[i + 1] = app.stream.list[i]; app.stream.list[i] = t; renderPlaylist(); } } }));
      li.appendChild(U.el('button', { text: '×', onclick: function () { app.stream.list.splice(i, 1); renderPlaylist(); } }));
      el.appendChild(li);
    });
  }

  function toggleStream() {
    if (app.stream.active) {
      app.stream.active = false;
      // whatever frame we stopped on may be mid-morph: hand the panels a plain
      // sheep rather than one carrying cross-fade fields
      app.genome = GEN.settle(app.genome);
      rebuildPanels();
      toast('Stream stopped');
      return;
    }
    if (!app.stream.list.length) app.stream.list = app.library.items.map(function (i) { return i.id; });
    var s = app.stream;
    s.active = true;
    s.idx = 0; s.t = 0; s.applied = false;
    s.current = null; s.next = null; s.legKind = 'hop'; s.arrivedKind = 'hop';
    s.driftLeft = driftGenerations();
    s.mode = 'play'; s.phase = 0; s.loopsLeft = Math.max(1, app.settings.loopsPerSheep | 0);
    breeder = null;
    buildStreamPane();
    toast(streamIsEndless()
      ? 'Endless stream — drifting from the current sheep'
      : 'Streaming ' + s.list.length + ' sheep');
  }

  /* Drift is a mode, not a number: the toggle decides whether it runs at all,
     and `streamDrift` only says how many generations when it does. */
  function driftGenerations() {
    return app.settings.streamDriftOn ? Math.max(1, app.settings.streamDrift | 0) : 0;
  }

  /* Everything the Stream tab owns. The playlist and the flock are data, not
     settings, and are deliberately not in this list. */
  var STREAM_SETTING_KEYS = [
    'streamSource', 'streamHold', 'streamTrans', 'streamShuffle',
    'loopsPerSheep', 'streamLoopOverride', 'streamLoopSecs',
    'streamDriftOn', 'streamDrift', 'streamDriftStrength', 'streamDriftTries', 'streamDriftHold',
    'endlessFresh', 'endlessMutate', 'endlessCross', 'endlessFlock',
    'endlessMutateStrength', 'endlessTries', 'endlessMinScore', 'endlessAvoidRepeat'
  ];

  function resetStreamSettings() {
    for (var i = 0; i < STREAM_SETTING_KEYS.length; i++) {
      var k = STREAM_SETTING_KEYS[i];
      app.settings[k] = DEFAULT_SETTINGS[k];
    }
    saveSettings();
    buildStreamPane();
    refreshOverlay();
    toast('Stream settings restored to defaults');
  }

  function streamIsEndless() {
    return app.settings.streamSource === 'endless' || !app.stream.list.length;
  }

  /* Drop playlist entries whose sheep no longer exist. Without this a deleted
     sheep leaves a dead id behind, the lookup fails, and the stream quietly
     substitutes a freshly generated sheep that was never in the flock. */
  function pruneStreamList() {
    var before = app.stream.list.length;
    app.stream.list = app.stream.list.filter(function (id) { return !!app.library.get(id); });
    var dropped = before - app.stream.list.length;
    if (dropped && app.stream.idx >= app.stream.list.length) app.stream.idx = 0;
    return dropped;
  }

  function streamGenomeAt(i) {
    pruneStreamList();
    if (!app.stream.list.length) return null;
    var it = app.library.get(app.stream.list[i % app.stream.list.length]);
    return it ? GEN.clone(it.genome) : null;
  }

  /* ---- drift breeding ------------------------------------------------
     A sheep's own slow evolution. Two rules keep it from looking like the
     camera wandering off:

       * the child inherits its parent's camera verbatim, so the view never
         moves within a lineage -- only the shape does;
       * the mutation runs position-locked, so transforms change rotation,
         scale and shear but never slide the attractor through world space.

     Candidates are judged at that inherited framing, so a child that wanders
     out of shot simply scores badly and loses. Work is done one candidate per
     frame, which keeps a generation handover from hitching the morph.        */
  var breeder = null;

  /* Audition candidates offscreen, one per frame, and keep the best.
     `make` produces a candidate, `frame` says whether it keeps the framing it
     was given or gets auto-framed, and `pass` is the score at which we stop
     looking. Spreading the work across frames is what stops a handover from
     hitching the morph. */
  function startBreeding(opts) {
    breeder = {
      kind: opts.kind,
      make: opts.make,
      frame: opts.frame || 'inherit',
      tries: Math.max(1, Math.min(8, opts.tries | 0)),
      pass: opts.pass === undefined ? 0.45 : opts.pass,
      i: 0, best: null, bestScore: -1, bestCoverage: 1, bestOrigin: '', done: false
    };
  }

  function startDriftBreeding(parent) {
    startBreeding({
      kind: 'drift', frame: 'inherit',
      tries: app.settings.streamDriftTries | 0,
      make: function () {
        var c = EVO.mutate(parent, {
          strength: app.settings.streamDriftStrength,
          mix: EVO.DRIFT_MIX,
          lockPosition: true
        });
        c.camera = JSON.parse(JSON.stringify(parent.camera));
        c.note = 'drift from ' + parent.name;
        return { genome: c, origin: 'drift' };
      }
    });
  }

  function startEndlessBreeding() {
    startBreeding({
      kind: 'endless', frame: 'fit',
      tries: app.settings.endlessTries | 0,
      pass: app.settings.endlessMinScore,
      make: makeEndlessCandidate
    });
  }

  /* One candidate costs an auto-frame (which reads the whole accumulation
     buffer back off the GPU), a deep exposure and a measurement -- tens of
     milliseconds even on a fast card. Doing all of that in one call dropped a
     frame every time, and a dropped frame during a morph is the jump the eye
     notices. So a candidate is built across several frames instead:

       fit   - make it, and auto-frame it if this batch re-frames
       accum - a few passes of exposure per call
       score - measure it and keep it if it beats the incumbent

     ACCUM_TOTAL passes are spread ACCUM_SLICE at a time. */
  var ACCUM_TOTAL = 12, ACCUM_SLICE = 3;

  function stepBreeder() {
    var b = breeder;
    if (!b || b.done) return;
    var w = b.work;
    if (!w) {
      var made = b.make();
      if (!made || !made.genome) { b.i++; if (b.i >= b.tries) b.done = true; return; }
      b.work = w = { c: made.genome, origin: made.origin || '', reframe: made.reframe !== false, k: 0, stage: 'fit' };
      return;                                   // making it was this frame's work
    }
    if (w.stage === 'fit') {
      if (b.frame === 'fit' && w.reframe && app.thumb && app.thumb.ok) {
        try { app.thumb.autoFit(w.c, { passes: 20 }); } catch (e) { }
      }
      if (app.thumb && app.thumb.ok) {
        try {
          app.thumb.setGenome(w.c);
          app.thumb.mode = 'refine';
          app.thumb.clearAccum();
          app.thumb.resetPoints(w.c.seed || 1);
        } catch (e) { }
      }
      w.stage = 'accum';
      return;
    }
    if (w.stage === 'accum') {
      if (app.thumb && app.thumb.ok) {
        try { for (var k = 0; k < ACCUM_SLICE; k++) app.thumb.step(8); } catch (e) { }
      }
      w.k += ACCUM_SLICE;
      if (w.k >= ACCUM_TOTAL) w.stage = 'score';
      return;
    }
    // score
    var score = 1, cov = 1;
    if (app.thumb && app.thumb.ok) {
      try {
        app.thumb.present();
        var st = app.thumb.measure();
        cov = st.coverage;
        score = EVO.fitness(st, fitWeights());
      } catch (e) { score = 0.5; }
    }
    b.i++;
    if (score > b.bestScore) { b.bestScore = score; b.best = w.c; b.bestCoverage = cov; b.bestOrigin = w.origin; }
    b.work = null;
    if (score >= b.pass || b.i >= b.tries) b.done = true;
  }

  /* Only for the fallback below: run one candidate to completion right now. */
  function runOneCandidate() {
    var guard = 3 + Math.ceil(ACCUM_TOTAL / ACCUM_SLICE);
    var start = breeder ? breeder.i : 0;
    while (breeder && !breeder.done && breeder.i === start && guard-- > 0) stepBreeder();
  }

  /* Take the winner. `kind` guards against consuming a batch bred for the
     other purpose. */
  function finishBreeding(kind) {
    if (!breeder || (kind && breeder.kind !== kind)) return null;
    /* This runs on the frame a morph begins. Grinding through the rest of the
       audition here (it used to allow ten candidates) is a freeze of a second
       or more, and the stream resumes visibly further on than it stopped. Take
       the best found so far instead; the audition had the whole preceding
       sheep to run in, and only if it has produced nothing at all do we pay
       for a single candidate. */
    if (!breeder.best) runOneCandidate();
    var c = breeder.best;
    var stranded = breeder.bestCoverage < 0.02;
    var wasDrift = breeder.kind === 'drift';
    app.stream.lastOrigin = breeder.bestOrigin;
    breeder = null;
    if (!c) return null;
    // only re-frame a drift child if the lineage has genuinely left the frame
    if (wasDrift && stranded && app.thumb && app.thumb.ok) {
      try { app.thumb.autoFit(c, { passes: 20 }); } catch (e) { }
    }
    return c;
  }

  /* ---- endless mode: where does the next sheep come from? --------------
     Four origins, weighted. Any that cannot apply right now (no flock, only
     one sheep in it, nothing playing yet) drops out of the draw. */
  function endlessOriginWeights() {
    var n = app.library.items.length;
    return {
      fresh: Math.max(0, app.settings.endlessFresh),
      mutate: app.stream.current ? Math.max(0, app.settings.endlessMutate) : 0,
      cross: n >= 2 ? Math.max(0, app.settings.endlessCross) : 0,
      flock: n >= 1 ? Math.max(0, app.settings.endlessFlock) : 0
    };
  }

  function updateEndlessMix() {
    var el = document.getElementById('endlessMix');
    if (!el) return;
    var w = endlessOriginWeights();
    var tot = w.fresh + w.mutate + w.cross + w.flock;
    var pct = function (x) { return tot > 0 ? Math.round(x / tot * 100) + '%' : '—'; };
    el.textContent = tot > 0
      ? ('In force now: new ' + pct(w.fresh) + ' · mutation ' + pct(w.mutate) +
         ' · cross ' + pct(w.cross) + ' · flock ' + pct(w.flock) +
         (app.library.items.length < 2 ? '  (flock options need kept sheep, so they are excluded)' : ''))
      : 'All four are zero, so it falls back to brand new sheep.';
  }

  function pickEndlessOrigin() {
    var w = endlessOriginWeights();
    var total = w.fresh + w.mutate + w.cross + w.flock;
    if (total <= 0) return 'fresh';
    var u = Math.random() * total;
    if ((u -= w.fresh) <= 0) return 'fresh';
    if ((u -= w.mutate) <= 0) return 'mutate';
    if ((u -= w.cross) <= 0) return 'cross';
    return 'flock';
  }

  function randomFlockGenome(avoidName) {
    var items = app.library.items;
    if (!items.length) return null;
    var pool = items;
    if (avoidName && items.length > 1) {
      pool = items.filter(function (i) { return i.genome.name !== avoidName; });
      if (!pool.length) pool = items;
    }
    return GEN.clone(pool[Math.floor(Math.random() * pool.length)].genome);
  }

  function makeEndlessCandidate() {
    var origin = pickEndlessOrigin();
    var s = app.stream;
    var avoid = app.settings.endlessAvoidRepeat && s.current ? s.current.name : null;
    var g = null, reframe = true;
    switch (origin) {
      case 'mutate':
        g = EVO.mutate(s.current, { strength: app.settings.endlessMutateStrength });
        g.note = 'endless: mutation of ' + s.current.name;
        break;
      case 'cross': {
        var a = randomFlockGenome(null), b2 = randomFlockGenome(a ? a.name : null);
        if (a && b2) { g = EVO.cross(a, b2); g.note = 'endless: ' + a.name + ' x ' + b2.name; }
        break;
      }
      case 'flock':
        g = randomFlockGenome(avoid);
        // a kept sheep already has its own framing; do not re-frame it
        reframe = false;
        if (g) g.note = 'endless: from the flock';
        break;
    }
    if (!g) {
      origin = 'fresh';
      g = GEN.randomGenome((Math.random() * 4294967296) >>> 0, genOpts());
      g.note = 'endless: new';
    }
    return { genome: g, origin: origin, reframe: reframe };
  }

  function freshSheep() {
    var g = applyLook(GEN.randomGenome((Math.random() * 4294967296) >>> 0, genOpts()));
    if (app.thumb && app.thumb.ok) { try { app.thumb.autoFit(g, { passes: 20 }); } catch (e) { } }
    return g;
  }

  /* Choose what this leg of the stream morphs into. */
  function streamAdvance() {
    var s = app.stream;
    pushHistory(s.current, s.idx);   // s.idx still belongs to the outgoing sheep
    if (s.driftLeft > 0) {
      s.next = finishBreeding('drift');
      if (!s.next) { startDriftBreeding(s.current); s.next = finishBreeding('drift'); }
      s.legKind = 'drift';
      s.driftLeft--;
    } else {
      if (streamIsEndless()) {
        s.next = finishBreeding('endless');
        if (!s.next) { startEndlessBreeding(); s.next = finishBreeding('endless'); }
      } else {
        s.idx = (s.idx + 1) % s.list.length;
        if (app.settings.streamShuffle && s.idx === 0) shuffleList(s.list);
        s.next = streamGenomeAt(s.idx);
      }
      s.legKind = 'hop';
      s.driftLeft = driftGenerations();
      renderPlaylist();
    }
    if (!s.next && !streamIsEndless() && app.stream.list.length) s.next = streamGenomeAt(0);
    if (!s.next) {
      // genuinely nothing left to play: say so rather than silently inventing one
      if (!streamIsEndless()) toast('Playlist is empty — growing a new sheep');
      s.next = freshSheep();
    }
    // The audition for the sheep AFTER this one used to start here -- that is,
    // on the frame the morph begins, so its first heavy frames landed inside
    // the morph. It starts on arrival instead (see queueNextAudition), where a
    // dropped frame costs nothing visible.
  }

  /* Begin auditioning whatever comes after the sheep now playing. Called on
     arrival, so the whole play leg is available to spread the work over. */
  function queueNextAudition() {
    if (breeder) return;
    var s = app.stream;
    if (!s.current) return;
    if (s.driftLeft > 0) startDriftBreeding(s.current);
    else if (streamIsEndless()) startEndlessBreeding();
  }

  /* The stream has two states.

       play   - sit on this sheep and run its loop. Each time the phase wraps
                past 1 the sheep has completed one full cycle, and it has
                returned exactly to where it started, so the repeat is
                seamless. After `loopsPerSheep` cycles, move on.
       trans  - morph into the next sheep. Both ends keep animating through
                their own loops while the crossfade runs.

     A sheep with no loop falls back to sitting still for `Hold` seconds. */
  /* How long one cycle of this sheep takes while the stream is playing it.
     A sheep with no motion channels stays at 0 and falls back to Hold — an
     override cannot give it a loop it does not have. */
  function loopLenOf(g) {
    var own = GEN.loopSeconds(g);
    if (!own) return 0;
    return app.settings.streamLoopOverride ? Math.max(0.5, app.settings.streamLoopSecs) : own;
  }

  function stepStream(dt) {
    var s = app.stream;
    if (!s.current) {
      if (streamIsEndless()) s.current = GEN.clone(app.genome);
      else { pruneStreamList(); s.current = streamGenomeAt(s.idx); }
      if (!s.current) s.current = GEN.clone(app.genome);
      s.next = null; s.t = 0; s.applied = false;
      s.arrivedKind = 'hop';
      s.mode = 'play';
      s.phase = app.loopPhase || 0;
      s.loopsLeft = Math.max(1, app.settings.loopsPerSheep | 0);
      s.driftLeft = driftGenerations();
      breeder = null;
      if (s.driftLeft > 0) startDriftBreeding(s.current);
      else if (streamIsEndless()) startEndlessBreeding();
    }
    /* Audition work happens while a sheep is playing, never while one is
       morphing into the next: the morph is the part the eye is watching
       closely, and a frame spent scoring a candidate is a frame the morph
       does not move. The exception is having nothing queued at all. */
    if (s.mode !== 'trans' || !s.next) stepBreeder();
    var trans = Math.max(0.2, app.settings.streamTrans);

    if (s.mode === 'play') {
      var ls = loopLenOf(s.current);
      if (ls > 0) {
        s.phase += dt / ls;
        while (s.phase >= 1) { s.phase -= 1; s.loopsLeft -= 1; }
      } else {
        // loopless sheep: just hold on the still image
        s.t += dt;
        if (s.t >= Math.max(0.2, app.settings.streamHold)) s.loopsLeft = 0;
      }
      app.genome = GEN.applyLoop(s.current, s.phase);
      app.renderer.setGenome(viewApplied(app.genome), true);
      if (!s.applied) { s.applied = true; schedulePlaylist(); }
      markOverlay();
      if (s.loopsLeft <= 0) {
        if (!s.next) streamAdvance();
        s.mode = 'trans';
        s.t = 0;
      }
      return;
    }

    // --- transition
    if (!s.next) streamAdvance();
    s.t += dt;
    var u = s.t / trans;
    /* Both ends keep cycling through the morph. If they cycle at different
       rates, holding the outgoing sheep's rate until the last frame and then
       switching leaves the motion changing speed the instant the morph ends.
       Ease the rate across instead, so the new sheep's pace is already in
       force by the time it is the only thing on screen. */
    var la = loopLenOf(s.current), lb = loopLenOf(s.next);
    var ue = Math.max(0, Math.min(1, u));
    ue = ue * ue * (3 - 2 * ue);
    var lsc = (la > 0 && lb > 0) ? (la + (lb - la) * ue) : (la || lb);
    if (lsc > 0) { s.phase += dt / lsc; s.phase -= Math.floor(s.phase); }
    if (u >= 1) {
      s.current = s.next;
      s.arrivedKind = s.legKind;
      s.next = null; s.t = 0; s.applied = false;
      s.mode = 'play';
      s.loopsLeft = Math.max(1, app.settings.loopsPerSheep | 0);
      queueNextAudition();
      return;
    }
    var smooth = (s.legKind !== 'drift') || app.settings.streamDriftHold > 0;
    app.genome = GEN.interpolate(
      GEN.applyLoop(s.current, s.phase),
      GEN.applyLoop(s.next, s.phase),
      u, { ease: smooth });
    app.renderer.setGenome(viewApplied(app.genome), true);
    markOverlay();
  }

  function shuffleList(arr) {
    for (var i = arr.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
  }

  /* ---------- recording -------------------------------------------------- */
  function toggleRecording() {
    if (app.recorder) {
      app.recorder.stop();
      return;
    }
    if (!window.MediaRecorder || !$('glcanvas').captureStream) { toast('This browser cannot record the canvas'); return; }
    var stream = $('glcanvas').captureStream(app.settings.recordFps);
    var opts = { videoBitsPerSecond: app.settings.recordMbps * 1e6 };
    var types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    for (var i = 0; i < types.length; i++) { if (MediaRecorder.isTypeSupported(types[i])) { opts.mimeType = types[i]; break; } }
    var rec;
    try { rec = new MediaRecorder(stream, opts); } catch (e) { toast('Recorder failed: ' + e.message); return; }
    app.recChunks = [];
    rec.ondataavailable = function (e) { if (e.data && e.data.size) app.recChunks.push(e.data); };
    rec.onstop = function () {
      var blob = new Blob(app.recChunks, { type: 'video/webm' });
      LIB.downloadBlob(blob, 'electric-shepherd-' + Date.now().toString(36) + '.webm');
      app.recorder = null; app.recChunks = [];
      buildOutputPane(); toast('Video saved');
    };
    rec.start(1000);
    app.recorder = rec;
    buildOutputPane();
    toast('Recording…');
  }

  /* ---------- PNG export -------------------------------------------------- */

  /* The pixel size a still is saved at. 'view' keeps the shape of the window
     and multiplies it; any other size is honoured exactly as asked for.

     Nothing is ever stretched to fit that shape. The splat shader scales the
     world by min(width, height) on both axes, so the sheep keeps its
     proportions and it is the frame around it that changes: the shorter edge
     always shows the same slice of the flame, and the longer edge reveals
     more of it. Asking for a wider frame than the window therefore shows more
     to the sides rather than a fatter sheep. */
  function exportPixels() {
    var st = app.settings, r = app.renderer;
    var w, h;
    if (st.exportSize === 'view') {
      var s = Math.max(1, st.exportScale | 0);
      w = Math.round((r ? r.width : 1920) * s);
      h = Math.round((r ? r.height : 1080) * s);
    } else {
      w = st.exportW | 0; h = st.exportH | 0;
    }
    w = Math.max(16, Math.min(7680, w));
    h = Math.max(16, Math.min(4320, h));
    return { w: w, h: h, ss: (w * h > 4e6) ? 1 : 2 };
  }

  function exportPNG() {
    if (app.busy || renderJob) { toast('Busy — a render is running'); return; }
    var r = app.renderer;
    var oldW = r.width, oldH = r.height, oldSS = r.ss;
    var sz = exportPixels();
    var w = sz.w, h = sz.h, ss = sz.ss;
    r.setSize(w, h, ss);
    r.setGenome(app.genome);
    r.resetPoints(app.genome.seed || 1);
    r.clearAccum();
    r.mode = 'refine';
    var done = 0, total = app.settings.exportPasses;
    var chunk = 12;
    toast('Rendering ' + w + '×' + h + '…');
    app.busy = function () {
      var t0 = performance.now();
      while (done < total && performance.now() - t0 < 28) { r.step(chunk); done += chunk; }
      r.present();
      $('readout').innerHTML = '<b>export</b> ' + Math.min(100, Math.round(done / total * 100)) + '%';
      if (done >= total) {
        app.busy = null;
        var canvas = r.toCanvas();
        canvas.toBlob(function (blob) {
          LIB.downloadBlob(blob, LIB.sanitise(app.genome.name) + '-' + w + 'x' + h + '.png');
          toast('PNG saved');
        }, 'image/png');
        r.setSize(oldW, oldH, oldSS);
        r.setGenome(app.genome);
        r.resetPoints(app.genome.seed || 1);
        r.clearAccum();
      }
    };
  }

  /* ==================================================================
     OFFLINE RENDER
     ------------------------------------------------------------------
     Not a recorder. Every output frame gets its own deep exposure and
     takes as long as it needs; frames are encoded with explicit
     timestamps, so a render that takes an hour still plays back at the
     frame rate you asked for. Motion blur is real: each frame
     integrates several sub-samples across the shutter interval rather
     than freezing one instant.
     ================================================================== */
  var renderJob = null;

  function renderTotals() {
    var st = app.settings;
    var frames = Math.max(1, Math.round(st.renderSeconds * st.renderFps));
    return {
      frames: frames,
      passes: frames * Math.max(1, st.renderPasses | 0),
      megapixels: (st.renderW * st.renderH) / 1e6
    };
  }

  function renderStatus(txt) {
    var el = document.getElementById('renderStatus');
    if (el) el.textContent = txt;
  }
  function renderBar(frac) {
    var el = document.getElementById('renderBar');
    if (el) el.style.width = Math.max(0, Math.min(100, frac * 100)) + '%';
  }

  function cancelRender(msg) {
    if (!renderJob) return;
    var j = renderJob;
    j.cancelled = true;
    renderJob = null;
    app.busy = null;
    try { if (j.encoder && j.encoder.state !== 'closed') j.encoder.close(); } catch (e) { }
    if (j.savedSize) {
      app.renderer.setSize(j.savedSize[0], j.savedSize[1], j.savedSize[2]);
      app.renderer.setGenome(app.genome);
      app.renderer.clearAccum();
    }
    buildOutputPane();
    toast(msg || 'Render cancelled');
  }

  function startRender() {
    if (renderJob || app.busy) return;
    var st = app.settings;
    var wantVideo = st.renderFormat !== 'png';
    if (wantVideo && typeof VideoEncoder === 'undefined') {
      toast('This browser has no VideoEncoder — use PNG frames instead');
      return;
    }

    // --- gather the cast
    var entries = [];
    if (st.renderSource === 'sheep') {
      entries = [GEN.clone(app.genome)];
    } else if (st.renderSource === 'flock') {
      pruneStreamList();
      var ids = app.stream.list.length ? app.stream.list : app.library.items.map(function (i) { return i.id; });
      for (var i = 0; i < ids.length; i++) {
        var it = app.library.get(ids[i]);
        if (it) entries.push(GEN.clone(it.genome));
      }
      if (!entries.length) { toast('Flock is empty — keep some sheep, or render the current one'); return; }
      if (app.settings.streamShuffle) shuffleList(entries);
    }
    // 'endless' fills its cast during the casting phase

    var w = Math.max(16, (st.renderW | 0) & ~1);      // even dimensions for the codec
    var h = Math.max(16, (st.renderH | 0) & ~1);
    var totals = renderTotals();

    renderJob = {
      phase: st.renderSource === 'endless' ? 'casting' : 'timeline',
      entries: entries,
      wantVideo: wantVideo,
      w: w, h: h,
      fps: st.renderFps,
      totalFrames: totals.frames,
      passesPerFrame: Math.max(1, st.renderPasses | 0),
      subs: Math.max(1, Math.min(24, st.renderShutter | 0)),
      frame: 0, passIdx: 0, curSub: -1,
      chunks: [], zip: null, pngPending: 0,
      encoder: null,
      started: performance.now(),
      savedSize: [app.renderer.width, app.renderer.height, app.renderer.ss],
      castTarget: 0, cancel: false
    };

    if (st.renderSource === 'endless') {
      // roughly how many distinct sheep the duration needs
      var perSheep = (st.streamLoopOverride ? st.streamLoopSecs : 12) * Math.max(1, st.loopsPerSheep | 0)
        + Math.max(0.1, st.streamTrans);
      renderJob.castTarget = Math.max(1, Math.ceil(st.renderSeconds / Math.max(1, perSheep)) + 1);
    }

    app.playing = false;
    app.renderer.setSize(w, h, Math.max(1, Math.min(3, st.renderSS | 0)));
    buildOutputPane();
    app.busy = renderStep;
    toast('Rendering ' + totals.frames + ' frames at ' + w + '×' + h);
  }

  function renderSetupEncoder(j) {
    if (!j.wantVideo) { j.zip = new window.FlameRender.ZipWriter(); return; }
    j.encoder = new VideoEncoder({
      output: function (chunk) {
        var d = new Uint8Array(chunk.byteLength);
        chunk.copyTo(d);
        j.chunks.push({ data: d, timeMs: Math.round(chunk.timestamp / 1000), key: chunk.type === 'key' });
      },
      error: function (e) { cancelRender('Encoder failed: ' + e.message); }
    });
    j.encoder.configure({
      codec: app.settings.renderFormat,
      width: j.w, height: j.h,
      bitrate: Math.max(1, app.settings.renderMbps) * 1e6,
      framerate: j.fps,
      latencyMode: 'quality'
    });
  }

  /* one slice of work per animation frame, so the UI keeps breathing */
  function renderStep() {
    var j = renderJob;
    if (!j) return;
    var t0 = performance.now();
    var R = window.FlameRender;

    // ---- casting: grow the endless cast, auditioning as we go
    if (j.phase === 'casting') {
      while (j.entries.length < j.castTarget && performance.now() - t0 < 40) {
        startEndlessBreeding();
        var g = finishBreeding('endless') || freshSheep();
        j.entries.push(g);
      }
      renderStatus('Choosing sheep… ' + j.entries.length + ' / ' + j.castTarget);
      renderBar(j.entries.length / j.castTarget * 0.15);
      if (j.entries.length >= j.castTarget) j.phase = 'timeline';
      return;
    }

    // ---- build the timeline once
    if (j.phase === 'timeline') {
      if (driftGenerations() > 0 && j.entries.length) {
        var withDrift = [];
        for (var i = 0; i < j.entries.length; i++) {
          withDrift.push(j.entries[i]);
          var parent = j.entries[i];
          for (var d = 0; d < driftGenerations(); d++) {
            var c = EVO.mutate(parent, {
              strength: app.settings.streamDriftStrength,
              mix: EVO.DRIFT_MIX, lockPosition: true
            });
            c.camera = JSON.parse(JSON.stringify(parent.camera));
            withDrift.push(c);
            parent = c;
          }
        }
        j.entries = withDrift;
      }
      j.timeline = R.buildTimeline(j.entries, {
        seconds: app.settings.renderSeconds,
        loopsPerSheep: app.settings.loopsPerSheep,
        transSecs: app.settings.streamTrans,
        holdSecs: app.settings.streamHold,
        loopOverride: app.settings.streamLoopOverride,
        loopSecs: app.settings.streamLoopSecs
      });
      if (!j.timeline.segments.length) { cancelRender('Nothing to render'); return; }
      try { renderSetupEncoder(j); } catch (e) { cancelRender('Could not start encoder: ' + e.message); return; }
      j.phase = 'render';
      return;
    }

    if (j.phase !== 'render') return;

    var r = app.renderer;
    var total = j.passesPerFrame;
    var perSub = Math.max(1, Math.floor(total / j.subs));
    var shutter = 1 / j.fps;

    // Don't start a new frame while the encoder is behind. Keeping the queue
    // shallow means most encoding happens *during* the render instead of
    // piling into one silent block at the end.
    if (j.passIdx === 0 && j.encoder && j.encoder.encodeQueueSize >= 8) {
      renderStatus('Frame ' + (j.frame + 1) + ' / ' + j.totalFrames +
        '  ·  waiting for the encoder (' + j.encoder.encodeQueueSize + ' frames queued)');
      return;
    }

    while (performance.now() - t0 < 34) {
      if (j.passIdx === 0) {
        // new frame: fresh exposure, nothing carried over
        r.mode = 'refine';
        r.clearAccum();
        r.resetPoints((j.frame * 2654435761) >>> 0);
        j.curSub = -1;
      }
      var sub = Math.min(j.subs - 1, Math.floor(j.passIdx / perSub));
      if (sub !== j.curSub) {
        j.curSub = sub;
        var t = j.frame / j.fps + (j.subs > 1 ? (sub / j.subs) * shutter : 0);
        var g = R.genomeAt(j.timeline, t);
        if (g) r.setGenome(viewApplied(g), true);
      }
      r.step(4);
      j.passIdx += 4;

      if (j.passIdx >= total) {
        r.present();
        emitFrame(j);
        j.passIdx = 0;
        j.frame++;
        if (j.frame >= j.totalFrames) { j.phase = 'finishing'; finishRender(j); return; }
        break;                                   // one frame per slice keeps it responsive
      }
    }

    var done = (j.frame + j.passIdx / total) / j.totalFrames;
    var elapsed = (performance.now() - j.started) / 1000;
    var eta = done > 0.002 ? (elapsed / done - elapsed) : 0;
    var q = j.encoder ? j.encoder.encodeQueueSize : 0;
    renderStatus('Frame ' + (j.frame + 1) + ' / ' + j.totalFrames +
      '  ·  ' + Math.round(done * 100) + '%  ·  ' + fmtDuration(elapsed) + ' elapsed' +
      (eta > 0 ? ', ~' + fmtDuration(eta) + ' left' : '') +
      (q > 0 ? '  ·  encoding ' + j.chunks.length + '/' + j.totalFrames : ''));
    renderBar(0.15 + done * 0.8);
  }

  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }

  function fmtDuration(sec) {
    sec = Math.max(0, Math.round(sec));
    if (sec < 60) return sec + 's';
    var m = Math.floor(sec / 60), ss = sec % 60;
    if (m < 60) return m + 'm ' + ss + 's';
    return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
  }

  function emitFrame(j) {
    if (j.wantVideo) {
      var vf = new VideoFrame(app.renderer.canvas, {
        timestamp: Math.round(j.frame * 1e6 / j.fps),
        duration: Math.round(1e6 / j.fps)
      });
      try { j.encoder.encode(vf, { keyFrame: j.frame % Math.max(1, j.fps) === 0 }); }
      finally { vf.close(); }
    } else {
      var url = app.renderer.toCanvas().toDataURL('image/png');
      var bin = atob(url.split(',')[1]);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var name = 'frame_' + String(j.frame).padStart(5, '0') + '.png';
      j.zip.add(name, bytes);
    }
  }

  function finishRender(j) {
    app.busy = null;
    j.phase = 'encoding';
    renderBar(0.9);
    var R = window.FlameRender;
    var name = LIB.sanitise(app.settings.renderSource === 'sheep' ? app.genome.name : 'electric-shepherd')
      + '-' + j.w + 'x' + j.h + '-' + j.fps + 'fps';

    function done(blob, ext) {
      LIB.downloadBlob(blob, name + ext);
      var secs = (performance.now() - j.started) / 1000;
      renderJob = null;
      app.renderer.setSize(j.savedSize[0], j.savedSize[1], j.savedSize[2]);
      app.renderer.setGenome(app.genome);
      app.renderer.clearAccum();
      app.playing = true;
      buildOutputPane();
      renderStatus('Done — ' + j.totalFrames + ' frames in ' + fmtDuration(secs) +
        ' (' + fmtBytes(blob.size) + ')');
      renderBar(1);
      toast('Render finished: ' + fmtDuration(secs));
    }

    function writeFile(blob, ext) {
      // muxing a long render blocks for a moment; let the status paint first
      renderStatus('Writing file…');
      renderBar(0.99);
      setTimeout(function () { done(blob, ext); }, 60);
    }

    if (j.wantVideo) {
      // The encoder drains asynchronously and can take a while on its own.
      // Poll it so the wait is legible instead of looking like a hang.
      j.encStart = performance.now();
      j.lastCount = j.chunks.length;
      j.lastCountAt = performance.now();
      var poll = setInterval(function () {
        if (!renderJob || j.cancelled) { clearInterval(poll); return; }
        var got = j.chunks.length, want = j.totalFrames;
        if (got !== j.lastCount) { j.lastCount = got; j.lastCountAt = performance.now(); }
        var frac = want ? Math.min(1, got / want) : 0;
        var elapsed = (performance.now() - j.encStart) / 1000;
        var eta = frac > 0.02 ? (elapsed / frac - elapsed) : 0;
        var stalled = (performance.now() - j.lastCountAt) / 1000;
        renderStatus('Encoding ' + got + ' / ' + want + ' frames  ·  ' + Math.round(frac * 100) + '%' +
          (eta > 1 ? '  ·  ~' + fmtDuration(eta) + ' left' : '') +
          (stalled > 25 ? '  —  no frame for ' + Math.round(stalled) + 's, the codec may just be slow' : ''));
        renderBar(0.9 + frac * 0.09);
      }, 250);

      j.encoder.flush().then(function () {
        clearInterval(poll);
        if (j.cancelled) return;
        try { j.encoder.close(); } catch (e) { }
        renderStatus('Encoding complete — muxing ' + j.chunks.length + ' frames…');
        setTimeout(function () {
          if (j.cancelled) return;
          var blob = R.muxWebM(j.chunks, {
            width: j.w, height: j.h,
            codec: app.settings.renderFormat,
            frameDurMs: 1000 / j.fps
          });
          writeFile(blob, '.webm');
        }, 60);
      }).catch(function (e) {
        clearInterval(poll);
        if (!j.cancelled) cancelRender('Encoding failed: ' + e.message);
      });
    } else {
      writeFile(j.zip.blob(), '-frames.zip');
    }
  }

  /* The estimate readout is refreshed in place. Rebuilding the pane from a
     slider's input event would replace the very element being dragged, which
     is why these sliders used to respond only to clicks. */
  function updateRenderEstimate() {
    var est = document.getElementById('renderEst');
    if (!est) return;
    var st = app.settings;
    var t = renderTotals();
    var pngMB = t.frames * t.megapixels * 1.6;
    est.innerHTML =
      '<span>frames</span><b>' + t.frames + '</b>' +
      '<span>per frame</span><b>' + st.renderPasses + ' passes × ' +
      Math.min(st.renderShutter, st.renderPasses) + ' sub-steps</b>' +
      '<span>total passes</span><b>' + (t.passes / 1000).toFixed(0) + 'k</b>' +
      '<span>resolution</span><b>' + st.renderW + '×' + st.renderH + ' · ' + st.renderSS + '× SS</b>' +
      (st.renderFormat === 'png'
        ? '<span>size (approx)</span><b>~' + pngMB.toFixed(0) + ' MB in memory</b>'
        : '<span>size (approx)</span><b>~' + (st.renderSeconds * st.renderMbps / 8).toFixed(0) + ' MB</b>');
    var note = document.getElementById('renderEstNote');
    if (note) {
      note.textContent = (st.renderFormat === 'png' && pngMB > 1500)
        ? ('That PNG sequence would need roughly ' + pngMB.toFixed(0) +
           ' MB of memory before it can be saved. Shorten the render, drop the resolution, or use WebM.')
        : ('Rough guide: a frame here costs about ' +
           (st.renderPasses / Math.max(1, app.settings.passes)).toFixed(0) +
           '× one live frame at your current quality, before the resolution change.');
      note.style.color = (st.renderFormat === 'png' && pngMB > 1500) ? 'var(--bad)' : '';
    }
  }

  /* ---------- Render tab ---------------------------------------------------- */
  var RES_PRESETS = [
    { value: '1280x720', label: '1280 × 720' },
    { value: '1920x1080', label: '1920 × 1080' },
    { value: '2560x1440', label: '2560 × 1440' },
    { value: '3840x2160', label: '3840 × 2160  (4K)' }
  ];
  /* A still is not a video frame, so it gets shapes a codec would never want.
     They are worth having precisely because the frame is not stretched to
     fit: a square or a portrait crop reframes the sheep rather than
     squashing it. */
  var STILL_PRESETS = RES_PRESETS.concat([
    { value: '2048x2048', label: '2048 × 2048  (square)' },
    { value: '4096x4096', label: '4096 × 4096  (square)' },
    { value: '2160x3840', label: '2160 × 3840  (portrait)' }
  ]);

  function buildOutputPane() {
    var root = document.querySelector('[data-pane=output]');
    if (!root) return;
    var p = new U.Panel(root); app.panels.output = p; p.clear();
    var busyNow = !!renderJob;

    U.hint(root, 'A render is not a recording. Every frame gets a full deep exposure and takes as long as it needs; the result is encoded with proper timestamps, so an hour-long render still plays at the frame rate you asked for.');

    // ---- progress
    var bar = U.el('div', { class: 'progwrap' }, [U.el('div', { class: 'progbar', id: 'renderBar' })]);
    root.appendChild(bar);
    root.appendChild(U.el('div', { class: 'hint', id: 'renderStatus', text: busyNow ? 'Starting…' : 'Idle' }));

    U.buttons(root, [
      busyNow
        ? { label: 'Cancel render', class: 'danger', onclick: function () { cancelRender(); } }
        : { label: 'Start render', class: 'primary', onclick: startRender }
    ]);

    var gs = U.group(root, 'What to render');
    U.select(p, gs, {
      label: 'Source',
      options: [
        { value: 'sheep', label: 'Current sheep only' },
        { value: 'flock', label: 'Flock playlist' },
        { value: 'endless', label: 'Endless stream' }
      ],
      title: 'Uses your Stream settings for loops per sheep, transitions and the endless mix.',
      get: function () { return app.settings.renderSource; },
      set: function (v) { app.settings.renderSource = v; saveSettings(); buildOutputPane(); }
    });
    U.slider(p, gs, {
      label: 'Duration', min: 1, max: 3600, step: 1,
      fmt: function (v) { return fmtDuration(v); },
      get: function () { return app.settings.renderSeconds; },
      set: function (v) { app.settings.renderSeconds = v | 0; saveSettings(); updateRenderEstimate(); }
    });
    U.hint(gs, 'Loops per sheep, transition length and the endless origin mix all come from the Stream tab, so what you render matches what you were watching.');

    var gf = U.group(root, 'Format');
    U.select(p, gf, {
      label: 'Resolution', options: RES_PRESETS.concat([{ value: 'custom', label: 'Custom' }]),
      get: function () {
        var k = app.settings.renderW + 'x' + app.settings.renderH;
        for (var i = 0; i < RES_PRESETS.length; i++) if (RES_PRESETS[i].value === k) return k;
        return 'custom';
      },
      set: function (v) {
        if (v === 'custom') return;
        var parts = v.split('x');
        app.settings.renderW = +parts[0]; app.settings.renderH = +parts[1];
        saveSettings(); buildOutputPane();
      }
    });
    U.number(p, gf, { label: 'Width', step: 2, get: function () { return app.settings.renderW; }, set: function (v) { app.settings.renderW = Math.max(16, v | 0); saveSettings(); p.refresh(); updateRenderEstimate(); } });
    U.number(p, gf, { label: 'Height', step: 2, get: function () { return app.settings.renderH; }, set: function (v) { app.settings.renderH = Math.max(16, v | 0); saveSettings(); p.refresh(); updateRenderEstimate(); } });
    U.select(p, gf, {
      label: 'Frame rate', options: [{ value: '24', label: '24' }, { value: '25', label: '25' }, { value: '30', label: '30' }, { value: '50', label: '50' }, { value: '60', label: '60' }],
      get: function () { return String(app.settings.renderFps); },
      set: function (v) { app.settings.renderFps = +v; saveSettings(); updateRenderEstimate(); }
    });
    var codecs = [];
    if (typeof VideoEncoder !== 'undefined') {
      codecs.push({ value: 'vp09.00.10.08', label: 'WebM · VP9' });
      codecs.push({ value: 'vp8', label: 'WebM · VP8' });
      codecs.push({ value: 'av01.0.04M.08', label: 'WebM · AV1 (slow)' });
    }
    codecs.push({ value: 'png', label: 'PNG frames (.zip)' });
    U.select(p, gf, {
      label: 'Output', options: codecs,
      title: 'PNG frames are lossless and ideal for editing, but the whole sequence is held in memory.',
      get: function () { return app.settings.renderFormat; },
      set: function (v) { app.settings.renderFormat = v; saveSettings(); buildOutputPane(); }
    });
    if (app.settings.renderFormat !== 'png') {
      U.slider(p, gf, {
        label: 'Bitrate', min: 2, max: 120, step: 1,
        fmt: function (v) { return v + ' Mb/s'; },
        get: function () { return app.settings.renderMbps; },
        set: function (v) { app.settings.renderMbps = v | 0; saveSettings(); updateRenderEstimate(); }
      });
    }

    var gq = U.group(root, 'Quality');
    U.slider(p, gq, {
      label: 'Samples / frame', min: 20, max: 40000, step: 20,
      title: 'Passes accumulated into every single frame. This is the dial the live recorder could never turn up — it costs time, not framerate.',
      get: function () { return app.settings.renderPasses; },
      set: function (v) { app.settings.renderPasses = v | 0; saveSettings(); updateRenderEstimate(); }
    });
    U.slider(p, gq, {
      label: 'Supersample', min: 1, max: 3, step: 1,
      fmt: function (v) { return v + '×'; },
      get: function () { return app.settings.renderSS; },
      set: function (v) { app.settings.renderSS = v | 0; saveSettings(); updateRenderEstimate(); }
    });
    U.slider(p, gq, {
      label: 'Motion blur', min: 1, max: 24, step: 1,
      fmt: function (v) { return v > 1 ? v + ' steps' : 'off'; },
      title: 'Sub-samples taken across each frame\u2019s shutter and integrated together. This is what stops fast motion strobing — the live view fakes it with a trailing exposure.',
      get: function () { return app.settings.renderShutter; },
      set: function (v) { app.settings.renderShutter = v | 0; saveSettings(); updateRenderEstimate(); }
    });

    gq.appendChild(U.el('div', { class: 'kv', id: 'renderEst' }));
    gq.appendChild(U.el('div', { class: 'hint', id: 'renderEstNote' }));
    updateRenderEstimate();

    var gl = U.group(root, 'Live capture', { collapsed: true });
    U.hint(gl, 'The old real-time path, kept for quick grabs. It records exactly what the screen shows, so its quality is whatever the GPU manages in real time.');
    U.slider(p, gl, { label: 'Frame rate', min: 12, max: 60, step: 1, get: function () { return app.settings.recordFps; }, set: function (v) { app.settings.recordFps = v | 0; saveSettings(); } });
    U.slider(p, gl, { label: 'Bitrate', min: 2, max: 40, step: 1, fmt: function (v) { return v + ' Mb/s'; }, get: function () { return app.settings.recordMbps; }, set: function (v) { app.settings.recordMbps = v | 0; saveSettings(); } });
    U.buttons(gl, [
      { label: app.recorder ? 'Stop & save' : 'Start recording', class: app.recorder ? 'on' : '', onclick: toggleRecording }
    ]);

    var ge = U.group(root, 'Export still');
    U.select(p, ge, {
      label: 'Resolution',
      options: [{ value: 'view', label: 'Match view' }].concat(STILL_PRESETS, [{ value: 'custom', label: 'Custom' }]),
      title: 'A frame shaped differently to the window shows more or less of the sheep around the shorter edge — the image is never stretched to fit.',
      get: function () {
        var st = app.settings;
        if (st.exportSize === 'view') return 'view';
        var k = st.exportW + 'x' + st.exportH;
        for (var i = 0; i < STILL_PRESETS.length; i++) if (STILL_PRESETS[i].value === k) return k;
        return 'custom';
      },
      set: function (v) {
        var st = app.settings;
        if (v === 'view') st.exportSize = 'view';
        else {
          st.exportSize = 'custom';
          if (v !== 'custom') { var parts = v.split('x'); st.exportW = +parts[0]; st.exportH = +parts[1]; }
        }
        saveSettings(); buildOutputPane();
      }
    });
    if (app.settings.exportSize === 'view') {
      U.slider(p, ge, {
        label: 'Scale', min: 1, max: 4, step: 1, fmt: function (v) { return v + '×'; },
        get: function () { return app.settings.exportScale; },
        set: function (v) { app.settings.exportScale = v | 0; saveSettings(); updateExportEstimate(); }
      });
    } else {
      U.number(p, ge, {
        label: 'Width', step: 2, min: 16, max: 7680,
        get: function () { return app.settings.exportW; },
        set: function (v) { app.settings.exportW = Math.max(16, Math.min(7680, v | 0)); saveSettings(); p.refresh(); updateExportEstimate(); }
      });
      U.number(p, ge, {
        label: 'Height', step: 2, min: 16, max: 4320,
        get: function () { return app.settings.exportH; },
        set: function (v) { app.settings.exportH = Math.max(16, Math.min(4320, v | 0)); saveSettings(); p.refresh(); updateExportEstimate(); }
      });
    }
    U.slider(p, ge, {
      label: 'Quality passes', min: 100, max: 40000, step: 50,
      title: 'Passes accumulated into the still. Deeper exposures clean up the grain in the faint parts; the view is frozen until it finishes.',
      get: function () { return app.settings.exportPasses; },
      set: function (v) { app.settings.exportPasses = v | 0; saveSettings(); updateExportEstimate(); }
    });
    ge.appendChild(U.el('div', { class: 'kv', id: 'exportEst' }));
    updateExportEstimate();
    U.buttons(ge, [{ label: 'Render & save PNG', class: 'primary', onclick: exportPNG }]);
    U.hint(ge, 'One frame of the sheep as it stands, at a deep exposure. The view pauses while it works.');
  }

  /* Refreshed in place for the same reason as the render estimate: rebuilding
     the pane from a slider's input event would replace the element being
     dragged. */
  function updateExportEstimate() {
    var est = document.getElementById('exportEst');
    if (!est) return;
    var sz = exportPixels();
    est.innerHTML =
      '<span>output</span><b>' + sz.w + '×' + sz.h + ' · ' + sz.ss + '× SS</b>' +
      '<span>exposure</span><b>' + app.settings.exportPasses + ' passes</b>';
  }

  /* ---------- Library ------------------------------------------------------ */
  function renderLibrary() {
    var root = document.querySelector('[data-pane=library]');
    if (!root) return;
    root.innerHTML = '';
    U.buttons(root, [
      { label: 'Keep current', class: 'primary', onclick: doKeep },
      { label: 'Import…', onclick: function () { $('fileImport').click(); } },
      { label: 'Export flock', onclick: function () { app.library.exportAll(); } },
      { label: 'Clear flock', class: 'danger', onclick: function () { if (confirm('Remove every saved sheep?')) { app.library.clear(); renderLibrary(); renderFilmstrip(); } } }
    ]);
    var note = app.library.persistent
      ? app.library.items.length + ' sheep saved in this browser. Export to .flock.json for a real backup.'
      : 'Browser storage is unavailable, so the flock lives only in this session — export it before closing.';
    U.hint(root, note);

    var grid = U.el('div', { class: 'libgrid' });
    root.appendChild(grid);
    if (!app.library.items.length) { U.hint(grid, 'Nothing kept yet. Press K, or Keep, to add the current sheep.'); return; }
    app.library.items.slice().reverse().forEach(function (it) {
      var cell = U.el('div', { class: 'libcell' });
      var open = function () { setGenome(GEN.clone(it.genome)); toast('Loaded ' + it.name); };
      if (it.thumb) cell.appendChild(U.el('img', { class: 'thumb', src: it.thumb, onclick: open }));
      else cell.appendChild(U.el('div', { class: 'noimg', text: 'no preview', onclick: open }));
      cell.appendChild(U.el('div', { class: 'meta' }, [
        U.el('div', { class: 'nm' + (it.fav ? ' fav' : ''), text: (it.fav ? '★ ' : '') + it.name }),
        U.el('div', { class: 'sub', text: 'gen ' + (it.genome.generation || 0) + ' · ' + it.genome.xforms.length + 'x · ' + (it.created || '').slice(0, 10) })
      ]));
      cell.appendChild(U.el('div', { class: 'acts' }, [
        U.el('button', { text: 'Load', onclick: open }),
        U.el('button', { text: '★', title: 'favourite', onclick: function () { app.library.toggleFav(it.id); renderLibrary(); } }),
        U.el('button', { text: '▶', title: 'add to stream', onclick: function () { if (app.stream.list.indexOf(it.id) < 0) app.stream.list.push(it.id); buildStreamPane(); toast('Added to stream'); } }),
        U.el('button', { text: '⤓', title: 'export .sheep.json', onclick: function () { LIB.exportGenome(it.genome); } }),
        U.el('button', { text: '🖼', title: 'regenerate preview', onclick: function () { makeThumb(it.genome, { fit: false }, function (url) { it.thumb = url; app.library.save(); renderLibrary(); renderFilmstrip(); }); } }),
        U.el('button', { text: '×', class: 'danger', title: 'delete', onclick: function () { app.library.remove(it.id); pruneStreamList(); renderLibrary(); renderFilmstrip(); renderPlaylist(); } })
      ]));
      grid.appendChild(cell);
    });
    renderFilmstrip();
  }

  function renderFilmstrip() {
    var fs = $('filmstrip');
    fs.innerHTML = '';
    app.library.items.slice(-40).reverse().forEach(function (it) {
      if (!it.thumb) return;
      var d = U.el('div', { class: 'fs-item' + (app.genome && app.genome.id === it.genome.id ? ' active' : '') },
        [U.el('img', { src: it.thumb, title: it.name, onclick: function () { setGenome(GEN.clone(it.genome)); } })]);
      fs.appendChild(d);
    });
  }

  /* ---------- actions ------------------------------------------------------ */
  function doRandom() {
    var seed = (Math.random() * 4294967296) >>> 0;
    setGenome(applyLook(GEN.randomGenome(seed, genOpts())), { fit: true });
    toast('New sheep: ' + app.genome.name);
  }

  /* ---------------- the trail behind ------------------------------------
     The stream only ever walks forward, and in endless mode the next sheep
     is grown rather than picked off a list, so there is nothing to rewind to
     unless we keep the trail ourselves. Every sheep that actually reaches
     the screen is pushed here on the way out, as a settled clone - settled
     because a genome caught mid-morph carries cross-fade fields describing a
     moment rather than a sheep, and a clone because the live one keeps being
     edited underneath us.

     Each entry remembers the playlist position it was playing at, so walking
     back into the flock leaves the stream pointing where it actually is
     rather than where it had got to. */
  var HISTORY_MAX = 40;
  function pushHistory(g, idx) {
    if (!g) return;
    var h = app.history;
    if (h.length && h[h.length - 1].g.id === g.id) return;
    h.push({ g: GEN.settle(GEN.rawClone(g)), idx: (idx === undefined ? -1 : idx) });
    if (h.length > HISTORY_MAX) h.shift();
  }

  /* Left arrow: "the one before".

     Going back pops rather than pushes, so holding the key walks the trail
     backwards instead of toggling between the last two sheep. Forward is
     always something new - the way "previous track" behaves on a shuffled
     playlist, where there is a past to revisit but no fixed future.

     While the stream runs this is the same manoeuvre the right arrow makes,
     with the target chosen rather than bred: hand stepStream the sheep to
     morph into and it takes the usual transition path to it. */
  function doSkipPrev() {
    var h = app.history;
    if (!h.length) { toast('No earlier sheep'); return; }
    var s = app.stream;
    if (s.active) {
      if (!s.current || s.mode === 'trans') return;
      var e = h.pop();
      s.next = e.g;
      s.legKind = 'hop';
      if (e.idx >= 0) s.idx = e.idx;
      s.driftLeft = driftGenerations();   // drift restarts from the sheep we land on
      s.loopsLeft = 0;
      renderPlaylist();
      toast('Back to ' + e.g.name);
      return;
    }
    setGenome(h.pop().g, { fit: false, history: false });
    toast('Back to ' + app.genome.name);
  }

  /* Right arrow: "next sheep, now".

     While the stream is running the morph is the whole point, so this must
     not snap. It retires the current sheep's remaining loops and leaves the
     rest to stepStream, which begins the transition on the next frame down
     exactly the path it would have taken had the loops run out on their own -
     same easing, same drift or hop leg, same rate cross-fade.

     A press during a transition is ignored: the stream is already on its way
     to the next sheep, and re-entering would jump the morph.

     With the stream off there is no outgoing sheep to morph away from, so it
     is simply a new random one. */
  function doSkipNext() {
    if (!app.stream.active) { doRandom(); return; }
    var s = app.stream;
    if (!s.current || s.mode === 'trans') return;
    s.loopsLeft = 0;
    toast('Next sheep');
  }
  function doMutate() {
    var mix = app.settings.keepImage ? Object.assign({}, EVO.DEFAULT_MIX, { render: 0 }) : null;
    setGenome(EVO.mutate(app.genome, { strength: app.settings.mutStrength, mix: mix || undefined }), { fit: true });
    toast('Mutated → ' + app.genome.name);
  }
  function doFit() {
    if (app.stream.active) { resetView(true); toast('View reset'); return; }
    resetView(true);
    app.renderer.autoFit(app.genome);
    refreshAll();
    toast('Framed');
  }
  function doKeep() {
    var keep = viewActive() ? applyViewOffset(GEN.rawClone(app.genome)) : app.genome;
    // a genome caught mid-morph carries cross-fade fields describing a moment
    // rather than a sheep; resolve them to whichever side the fade had reached
    keep = GEN.settle(GEN.rawClone(keep));
    makeThumb(keep, { fit: false }, function (url) {
      var it = app.library.add(keep, url);
      renderLibrary();
      toast('Kept ' + it.name);
    });
  }

  /* ---------- viewfinder: cinema + fullscreen ------------------------------- */
  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }
  function setCinema(on) {
    document.body.classList.toggle('cinema', on);
    if (on) setDrawer(false);        // nothing should sit over the viewfinder
    var b = $('btnFull');
    if (b) b.classList.toggle('on', on);
    pokeCursor();
    // the panel and bars disappear, so the canvas gets a new size; the
    // ResizeObserver on #canvaswrap picks that up on the next layout pass
  }
  function toggleCinema() { setCinema(!document.body.classList.contains('cinema')); }

  function toggleFullscreen() {
    var root = document.querySelector('.app');
    if (isFullscreen()) {
      var exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) exit.call(document);
      return;
    }
    var req = root.requestFullscreen || root.webkitRequestFullscreen;
    if (!req) { toggleCinema(); return; }               // no API: hide the UI instead
    var r = req.call(root);
    if (r && r.catch) r.catch(function () { toggleCinema(); });
  }

  var idleTimer = null;
  function pokeCursor() {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    if (document.body.classList.contains('cinema')) {
      idleTimer = setTimeout(function () { document.body.classList.add('idle'); }, 2500);
    }
  }

  function bindViewfinder() {
    document.addEventListener('fullscreenchange', function () { setCinema(isFullscreen()); });
    document.addEventListener('webkitfullscreenchange', function () { setCinema(isFullscreen()); });
    window.addEventListener('mousemove', pokeCursor);
    window.addEventListener('touchstart', pokeCursor, { passive: true });
    $('btnFull').onclick = toggleFullscreen;
    var bh = $('btnHelp');
    if (bh) bh.onclick = function () { if (window.FlameHelp) window.FlameHelp.toggle(); };
    var bm = $('btnMenu');
    if (bm) bm.onclick = toggleDrawer;
    var bcd = $('btnCloseDrawer');
    if (bcd) bcd.onclick = function () { setDrawer(false); };
    var scr = $('drawerScrim');
    if (scr) scr.onclick = function () { setDrawer(false); };
    try {
      var mq = window.matchMedia(MOBILE_MQ);
      if (mq.addEventListener) mq.addEventListener('change', syncMobileClass);
      else if (mq.addListener) mq.addListener(syncMobileClass);
    } catch (e) { /* no matchMedia: the class set at load stands */ }
    window.addEventListener('orientationchange', function () { setTimeout(syncMobileClass, 60); });

    var trans = document.querySelector('.transport');
    if (trans) trans.addEventListener('scroll', syncTransportScroll, { passive: true });
    window.addEventListener('resize', syncTransportScroll);
    syncTransportScroll();
    $('btnExitCinema').onclick = function () {
      if (isFullscreen()) toggleFullscreen(); else setCinema(false);
    };
  }

  /* While the stream is running it rewrites the genome every frame, so the
     camera belongs to it; the user's adjustments go to the view offset. */
  function streamOwnsCamera() { return app.stream.active; }

  /* ---------- camera nudges, shared by pointer and touch -------------------- */
  function camPan(dx, dy) {
    if (!app.genome || !app.renderer) return;
    if (streamOwnsCamera()) {
      app.view.panX += dx; app.view.panY += dy;
      if (app.panels.sheep) app.panels.sheep.refresh();
      refreshOverlay();
      return;
    }
    var cam = app.genome.camera;
    var minDim = Math.min(app.renderer.width, app.renderer.height) / (window.devicePixelRatio || 1);
    var k = 2 / (minDim * cam.zoom) / app.settings.resScale;
    var a = -(cam.rotate), ca = Math.cos(a), sa = Math.sin(a);
    var wx = (-dx * k), wy = (dy * k);
    cam.x += wx * ca - wy * sa;
    cam.y += wx * sa + wy * ca;
    touch(true);
    if (app.panels.sheep) app.panels.sheep.refresh();
  }
  function camRotate(d) {
    if (!app.genome) return;
    if (streamOwnsCamera()) {
      app.view.rot += d;
      if (app.panels.sheep) app.panels.sheep.refresh();
      refreshOverlay();
      return;
    }
    app.genome.camera.rotate += d;
    touch(true);
    if (app.panels.sheep) app.panels.sheep.refresh();
  }
  function camZoom(f) {
    if (!app.genome) return;
    if (streamOwnsCamera()) {
      app.view.zoom = Math.max(0.05, Math.min(20, app.view.zoom * f));
      if (app.panels.sheep) app.panels.sheep.refresh();
      refreshOverlay();
      return;
    }
    app.genome.camera.zoom = Math.max(0.02, Math.min(60, app.genome.camera.zoom * f));
    touch(true);
    if (app.panels.sheep) app.panels.sheep.refresh();
  }

  /* ---------- canvas interaction -------------------------------------------- */
  function bindCanvas() {
    var c = $('glcanvas');
    var dragging = false, mode = 'pan', lx = 0, ly = 0;
    c.addEventListener('mousedown', function (e) {
      dragging = true; mode = e.shiftKey ? 'rotate' : 'pan';
      lx = e.clientX; ly = e.clientY; e.preventDefault();
    });
    window.addEventListener('mouseup', function () { dragging = false; });
    window.addEventListener('mousemove', function (e) {
      if (!dragging || !app.genome) return;
      var dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      if (mode === 'rotate') camRotate(dx * 0.005);
      else camPan(dx, dy);
    });
    c.addEventListener('wheel', function (e) {
      if (!app.genome) return;
      e.preventDefault();
      camZoom(Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    c.addEventListener('dblclick', function () { doFit(); });
    bindTouch(c);
  }

  /* Touch equivalents of the three gestures above: one finger drags the
     camera, two pinch to zoom and twist to rotate, and a double tap skips
     to the next sheep on the right half of the canvas or the previous one
     on the left half. Every handler calls preventDefault so the browser
     never turns a drag into a page scroll, a pinch into a page zoom, or a
     tap into a synthetic mouse drag that would then be handled twice. */
  function bindTouch(c) {
    var mode = 0;                 // 0 idle, 1 one finger, 2 two fingers
    var px = 0, py = 0, pd = 0, pa = 0, travel = 0, lastTap = 0;

    function midX(t) { return (t[0].clientX + t[1].clientX) / 2; }
    function midY(t) { return (t[0].clientY + t[1].clientY) / 2; }
    function spread(t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }
    function twist(t) { return Math.atan2(t[1].clientY - t[0].clientY, t[1].clientX - t[0].clientX); }

    c.addEventListener('touchstart', function (e) {
      e.preventDefault();
      pokeCursor();               // in cinema mode this brings the Exit button back
      var t = e.touches;
      if (t.length === 1) { mode = 1; px = t[0].clientX; py = t[0].clientY; travel = 0; }
      else { mode = 2; px = midX(t); py = midY(t); pd = spread(t); pa = twist(t); }
    }, { passive: false });

    c.addEventListener('touchmove', function (e) {
      e.preventDefault();
      if (!app.genome) return;
      var t = e.touches;
      if (mode === 1 && t.length === 1) {
        var dx = t[0].clientX - px, dy = t[0].clientY - py;
        px = t[0].clientX; py = t[0].clientY;
        travel += Math.abs(dx) + Math.abs(dy);
        camPan(dx, dy);
      } else if (mode === 2 && t.length > 1) {
        var mx = midX(t), my = midY(t), d = spread(t), a = twist(t);
        if (pd > 4 && d > 4) camZoom(d / pd);
        var da = a - pa;
        if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI;
        if (Math.abs(da) > 0.01) camRotate(da);
        camPan(mx - px, my - py);
        px = mx; py = my; pd = d; pa = a;
      }
    }, { passive: false });

    function end(e) {
      var t = e.touches;
      if (t.length === 0) {
        if (mode === 1 && travel < 14) {          // a tap that went nowhere
          var now = Date.now();
          if (now - lastTap < 320) {
            // which half of the canvas the second tap landed on decides
            // the direction; fall back to the last known finger position
            // if the browser gave us no changed touch to measure
            var ct = e.changedTouches && e.changedTouches[0];
            var x = ct ? ct.clientX : px;
            var r = c.getBoundingClientRect();
            if (x - r.left < r.width / 2) doSkipPrev(); else doSkipNext();
            lastTap = 0;
          } else lastTap = now;
        }
        mode = 0;
      } else if (t.length === 1) {
        // one of two fingers lifted: keep panning with the other, but this
        // is no longer a candidate tap
        mode = 1; px = t[0].clientX; py = t[0].clientY; travel = 1e9;
      }
    }
    c.addEventListener('touchend', end);
    c.addEventListener('touchcancel', end);
  }

  function bindKeys() {
    window.addEventListener('keydown', function (e) {
      var t = e.target.tagName;
      if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
      var H = window.FlameHelp;
      // the handbook is modal: while it is open the only keys that do
      // anything are the ones that close it or move around inside it
      if (e.key === 'F1' || e.key === '?') { e.preventDefault(); if (H) H.toggle(); return; }
      if (H && H.isOpen()) {
        if (e.key === 'Escape') { e.preventDefault(); H.close(); }
        return;
      }
      if (e.key === 'Escape' && drawerOpen()) { e.preventDefault(); setDrawer(false); return; }
      switch (e.key.toLowerCase()) {
        case ' ': e.preventDefault(); togglePlay(); break;
        case 'r': doRandom(); break;
        case 'm': doMutate(); break;
        case 'f': doFit(); break;
        case 'k': doKeep(); break;
        case 'c': app.renderer.clearAccum(); break;
        case 'e': exportPNG(); break;
        case 's': toggleStream(); break;
        case 'arrowleft': e.preventDefault(); doSkipPrev(); break;
        case 'arrowright': e.preventDefault(); doSkipNext(); break;
        case 'v': e.preventDefault(); toggleFullscreen(); break;
        case 'u': toggleCinema(); break;
        case 'h': toggleOverlay(); break;
        case 'a': toggleSound(); break;
        case '+': case '=':
          if (streamOwnsCamera()) { app.view.zoom = Math.min(20, app.view.zoom * 1.1); if (app.panels.sheep) app.panels.sheep.refresh(); }
          else { app.genome.camera.zoom *= 1.1; touch(true); }
          break;
        case '-':
          if (streamOwnsCamera()) { app.view.zoom = Math.max(0.05, app.view.zoom / 1.1); if (app.panels.sheep) app.panels.sheep.refresh(); }
          else { app.genome.camera.zoom /= 1.1; touch(true); }
          break;
      }
    });
  }
  function togglePlay() {
    app.playing = !app.playing;
    syncTransport();
  }

  function buildSoundPane() {
    var root = document.querySelector('[data-pane=sound]');
    var p = new U.Panel(root); app.panels.sound = p; p.clear();

    var gp = U.group(root, 'Play');
    U.check(p, gp, {
      label: 'Play the sheep', title: 'A — every transform becomes a voice',
      get: function () { return app.settings.soundOn; },
      set: function (v) { setSound(v); }
    });
    volCtl = U.slider(p, gp, {
      label: 'Volume', min: 0, max: 1, step: 0.01, reset: 0.6,
      fmt: function (v) { return Math.round(v * 100) + '%'; },
      get: function () { return app.settings.soundVolume; },
      set: setSoundVolume
    });

    var gm = U.group(root, 'Voices');
    U.slider(p, gm, {
      label: 'Drone / notes', min: 0, max: 1, step: 0.01, reset: 0.6,
      title: 'All the way left is a held chord; all the way right is only the sequence',
      fmt: function (v) { return v <= 0.001 ? 'drone' : (v >= 0.999 ? 'notes' : Math.round(v * 100) + '% notes'); },
      get: function () { return app.settings.soundSeqMix; },
      set: function (v) { app.settings.soundSeqMix = v; saveSettings(); }
    });
    U.slider(p, gm, {
      label: 'Notes / second', min: 1, max: 16, step: 1, reset: 6,
      title: 'The chaos game runs at this rate; a whole number of steps is fitted to the loop',
      get: function () { return app.settings.soundSteps; },
      set: function (v) { app.settings.soundSteps = v | 0; saveSettings(); refreshSoundInfo(); }
    });
    U.select(p, gm, {
      label: 'Scale',
      options: [{ value: 'auto', label: 'From the palette' }, { value: 'off', label: 'Off — no quantising' }]
        .concat(SND.SCALE_NAMES.map(function (n) { return { value: n, label: n }; })),
      get: function () { return app.settings.soundScale; },
      set: function (v) { app.settings.soundScale = v; saveSettings(); refreshSoundInfo(); }
    });
    U.hint(gm, 'The sequence is the chaos game slowed down: the same draw the renderer ' +
      'makes a million times a second, at a rate you can hear. Which transform may follow ' +
      'which is the xaos matrix in the Transforms panel, so a sparse one is a riff.');

    var gr = U.group(root, 'This sheep');
    var sinfo = U.el('div', { class: 'kv' });
    gr.appendChild(sinfo);
    p.add({ el: sinfo, update: function () { sinfo.innerHTML = soundReadout(); } });
    U.hint(gr, 'Nothing on this tab is saved into the sheep — every sheep already carries ' +
      'everything the sound needs, so a flock saved before any of this existed plays too.');
  }
  function refreshSoundInfo() { if (app.panels.sound) app.panels.sound.refresh(); }

  /* ---------- tabs --------------------------------------------------------- */
  function bindTabs() {
    var tabs = $('tabs');
    tabs.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-tab]');
      if (!b) return;
      Array.prototype.forEach.call(tabs.children, function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      var name = b.getAttribute('data-tab');
      Array.prototype.forEach.call(document.querySelectorAll('.pane'), function (p) {
        p.classList.toggle('active', p.getAttribute('data-pane') === name);
      });
      if (name === 'evolve') { buildEvolvePane(); if (!app.pop) seedPopulation(); }
      if (name === 'library') renderLibrary();
      if (name === 'loop') buildLoopPane();
      if (name === 'sound') buildSoundPane();
      if (name === 'stream') buildStreamPane();
      if (name === 'output') buildOutputPane();
    });
  }

  /* ---------------- boot ---------------------------------------------------- */
  function boot() {
    if (!FIRST_LOAD) hideLoadScreen(true);   // returning visitor: no delay

    var canvas = $('glcanvas');
    // The constructor reports most trouble through .ok/.error, but framebuffer
    // completeness is checked by a throw. Uncaught, that escapes boot() and leaves a
    // blank page with no explanation - exactly the failure the notice exists to avoid.
    try {
      app.renderer = new window.FlameRenderer(canvas, { points: app.settings.points, ss: app.settings.ss, width: 800, height: 500 });
    } catch (e) {
      app.renderer = { ok: false, error: (e && e.message) || String(e) };
    }
    if (!app.renderer.ok) {
      hideLoadScreen(true);
      $('canvaswrap').appendChild(U.el('div', { class: 'fatal', text: app.renderer.error || 'Renderer failed to start.' }));
      return;
    }
    // The thumbnail renderer is a convenience and every call site already checks it,
    // so it is allowed to fail without taking the app down.
    try {
      app.thumb = new window.FlameRenderer($('thumbcanvas'), { points: 128, ss: 1, width: 256, height: 160 });
    } catch (e) { app.thumb = null; }

    // One-time correction. An earlier build shipped `streamDrift` defaulted to
    // 3, so it was written into saved settings for people who never chose it,
    // and a flock stream then played mutated generations that were not in the
    // flock. Drift now defaults off; clear that inherited value once. Anyone
    // who actually wants drift can switch it back on in the Stream panel.
    if (!app.settings.driftMigrated) {
      app.settings.streamDriftOn = false;
      if (!(app.settings.streamDrift > 0)) app.settings.streamDrift = 3;
      app.settings.driftMigrated = true;
      saveSettings();
    }

    // Same shape as the streamDrift correction above. The details overlay
    // used to default to on, so `true` is sitting in the saved settings of
    // everyone who has ever run this, and a new default alone would never
    // reach them. Clear it once; H or the top-bar button brings it back.
    if (!app.settings.overlayMigrated) {
      app.settings.showOverlay = false;
      app.settings.overlayMigrated = true;
      saveSettings();
    }

    app.genome = GEN.randomGenome((Math.random() * 4294967296) >>> 0, genOpts());
    if (app.settings.keepImage && app.settings.imageLook) {
      app.genome.render = Object.assign(GEN.defaultRender(), app.settings.imageLook);
    }
    app.renderer.setGenome(app.genome);
    resize();
    app.renderer.autoFit(app.genome);

    rebuildPanels();
    bindTabs(); bindKeys(); bindCanvas(); bindViewfinder();

    $('btnPlay').onclick = togglePlay;
    $('btnPrev').onclick = doSkipPrev;
    $('btnSkip').onclick = doSkipNext;
    $('btnRandom').onclick = doRandom;
    $('btnMutate').onclick = doMutate;
    $('btnFit').onclick = doFit;
    $('btnKeep').onclick = doKeep;
    $('btnStream').onclick = toggleStream;
    $('btnOverlay').onclick = toggleOverlay;
    $('btnSound').onclick = toggleSound;
    $('volSlider').addEventListener('input', function () { setSoundVolume(parseFloat(this.value)); });
    $('btnClearAcc').onclick = function () { app.renderer.clearAccum(); app.renderer.resetPoints(app.genome.seed || 1); };
    $('qualityPreset').onchange = function () {
      var v = this.value; this.value = '';
      if (v) applyQualityPreset(v);
    };

    $('fileImport').addEventListener('change', function () {
      LIB.readFiles(this.files, function (files) {
        var n = 0;
        files.forEach(function (f) { try { n += app.library.importText(f.text).length; } catch (e) { toast('Bad file: ' + f.name); } });
        renderLibrary(); toast('Imported ' + n + ' sheep');
      });
      this.value = '';
    });

    var ro = new ResizeObserver(function () { resize(); });
    ro.observe($('canvaswrap'));

    // drag & drop genome files onto the canvas
    document.addEventListener('dragover', function (e) { e.preventDefault(); });
    document.addEventListener('drop', function (e) {
      e.preventDefault();
      if (!e.dataTransfer || !e.dataTransfer.files.length) return;
      LIB.readFiles(e.dataTransfer.files, function (files) {
        try {
          var g = GEN.deserialize(files[0].text);
          if (Array.isArray(g)) { files.forEach(function (f) { app.library.importText(f.text); }); renderLibrary(); toast('Imported flock'); }
          else { setGenome(g); toast('Loaded ' + g.name); }
        } catch (err) { toast('Could not read that file'); }
      });
    });

    requestAnimationFrame(frame);
    syncOverlayBtn();
    // sound was on last time: build the context now and let the first click
    // or keypress un-suspend it, since a page load is not a user gesture
    if (app.settings.soundOn && ensureAudio()) { app.audio.setActive(true); armAudioResume(); }
    else app.settings.soundOn = false;
    syncSoundBtn();
    syncVolume();
    toast('Ready — press R for a new sheep');

    if (FIRST_LOAD) runFirstLoadBenchmark();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
