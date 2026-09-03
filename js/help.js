/* =====================================================================
   Electric Shepherd — in-app help
   ---------------------------------------------------------------------
   MAINTENANCE NOTE
   This file is the on-screen twin of README.md. The two are written by
   hand and are NOT generated from each other, so they drift unless
   someone keeps them together.

   >>> WHEN YOU EDIT README.md, EDIT THE MATCHING SECTION HERE. <<<
   (MAINTAINING.md says the same thing from the other direction.)

   The mapping is one-to-one apart from two deliberate differences:
     * README's "Running it" section is omitted — you are already running
       it if you can read this.
     * The intro is rewritten as an "Overview" pane.

   Section ids below correspond to README headings:
     overview  -> the opening paragraph
     sheep     -> "What a 'sheep' is"
     panels    -> "The panels"
     endless   -> "Endless: choosing the next sheep"
     controls  -> "Controls" + "Moving the camera while a stream is running"
     loop      -> "The loop"
     output    -> "Rendering out"
     exposure  -> "The exposure"
     quality   -> "Quality knobs"
     files     -> "Files"
     engine    -> "How the renderer works"
   ===================================================================== */
(function (global) {
  'use strict';

  var SECTIONS = [
    {
      id: 'overview', title: 'Overview', kicker: 'What this is',
      html: [
        '<p class="lead">A self-contained fractal-flame generator in the spirit of Scott Draves\'',
        '<em>Electric Sheep</em>, running entirely on your own machine. No server, no installer,',
        'no network calls.</p>',
        '<p>Every <b>sheep</b> is a plain JSON genome, so any image you like can be reproduced',
        'exactly, bred with another, or morphed into the next one in an endless looping stream.</p>',
        '<div class="hcards">',
        '  <div class="hcard"><h4>Reproducible</h4><p>The genome carries the camera and the render',
        '  settings, and the sample sequence is seeded from the genome — so even the grain repeats.</p></div>',
        '  <div class="hcard"><h4>Animated</h4><p>A sheep is not a still. It is a short animation',
        '  that returns to exactly where it started, so it repeats forever without a seam.</p></div>',
        '  <div class="hcard"><h4>Endless</h4><p>Breed a flock, then let the stream hold on each',
        '  sheep, watch it breathe, and morph into the next — indefinitely.</p></div>',
        '</div>',
        '<p class="hnote">Everything here is also in <code>README.md</code> beside the app, minus the',
        '<em>Running it</em> section — which you have plainly managed without.</p>'
      ].join('\n')
    },
    {
      id: 'sheep', title: 'What a sheep is', kicker: 'The genome',
      html: [
        '<p>Each sheep is an iterated function system rendered with the fractal-flame algorithm:',
        'a few affine transforms, each pushed through a weighted blend of non-linear <em>variations</em>,',
        'sampled by the chaos game and accumulated into a floating-point histogram that is then',
        'log-tone-mapped. The genome holds everything:</p>',
        '<table class="htable">',
        '<thead><tr><th>Part</th><th>What it controls</th></tr></thead><tbody>',
        '<tr><td><code>xforms[]</code></td><td>1–12 transforms: affine coefficients, optional post-affine, weight, opacity, colour index and colour speed</td></tr>',
        '<tr><td><code>xforms[].vars[]</code></td><td>up to 8 variations per transform, each with a signed weight and up to 6 parameters</td></tr>',
        '<tr><td><code>xforms[].xaos[]</code></td><td>per-transform transition weights — which transform may follow which</td></tr>',
        '<tr><td><code>final</code></td><td>an optional final transform applied to every point before it lands</td></tr>',
        '<tr><td><code>palette</code></td><td>preset / generated gradient, or explicit colour stops, plus rotate, hue, saturation, value, contrast</td></tr>',
        '<tr><td><code>camera</code></td><td>centre, zoom, rotation, continuous spin</td></tr>',
        '<tr><td><code>render</code></td><td>brightness, gamma, gamma threshold, vibrancy, highlight roll-off, density estimation, jitter, denoise, symmetry, glow, vignette, grain, contrast, saturation, hue shift, background</td></tr>',
        '</tbody></table>',
        '<p><b>81 variations</b> are implemented on the GPU, from <code>linear</code> and <code>spherical</code>',
        'through <code>julian</code>, <code>cpow</code>, <code>escher</code>, <code>hypertile</code>,',
        '<code>super_shape</code> and <code>crackle</code>.</p>',
        '<p class="hnote">Because the genome carries the camera and the render settings, saving a sheep',
        'saves the picture — reopening it reproduces the same image.</p>'
      ].join('\n')
    },
    {
      id: 'panels', title: 'The panels', kicker: 'Tab by tab',
      html: [
        '<dl class="hdl">',
        '<dt>Sheep</dt><dd>Name, seed, camera, the recipe used for new random sheep, quality settings,',
        'and the raw genome JSON (editable; paste one in and press Apply).</dd>',
        '<dt>Transforms</dt><dd>Pick a transform from the chips, then edit its affine matrix (numerically',
        'or with the rotate/scale/nudge buttons), its variation stack, its colour, and the xaos matrix',
        'that decides which transform may follow which.</dd>',
        '<dt>Palette</dt><dd>Presets, generators (hue walk, complementary, triadic, analogous, mono,',
        'random), and a bake-to-stops mode where you edit individual colours by hand.</dd>',
        '<dt>Image</dt><dd>The tone-mapping chain and the post-processing. Brightness and gamma are the',
        'two you will reach for most; density estimation is what cleans up the sparse outer regions;',
        'symmetry adds rotational copies at splat time.</dd>',
        '<dt>Loop</dt><dd>The heart of it — where each sheep\'s seamless animation is built.',
        'See <a href="#" data-goto="loop">The loop</a>.</dd>',
        '<dt>Evolve</dt><dd>A gallery of candidates. Click thumbnails to pick parents and press',
        '<b>Breed</b>, or turn on <b>Auto-evolve</b> and let the fitness heuristic (coverage, tonal range,',
        'colourfulness, detail, contrast — all weightable) select on its own and drop the winners into',
        'your flock. Alt-click or double-click any thumbnail to load it.</dd>',
        '<dt>Stream</dt><dd>Build a playlist from the flock and start it. The engine holds on each sheep,',
        'then interpolates into the next: affine matrices are decomposed into rotation, scale and',
        'translation so transforms <em>turn</em> into each other instead of collapsing through zero;',
        'palettes cross-fade; cameras ease. It loops forever.</dd>',
        '<dt>Render</dt><dd>Output to a file. See <a href="#" data-goto="output">Rendering out</a>.</dd>',
        '<dt>Flock</dt><dd>Everything you have kept. Load, favourite, add to the stream, export, or delete.',
        'Import <code>.sheep.json</code> / <code>.flock.json</code> files, or just drag them onto the window.</dd>',
        '</dl>',

        '<h3>Denoise</h3>',
        '<p>Lives in <em>Sampling &amp; filter</em> on the Image tab and is off by default. A flame is a',
        'Monte Carlo render, so at low sample counts the grain is roughly independent per pixel — the',
        'classic cheap fix is an edge-avoiding à-trous wavelet, which is what this is. A 5×5 B3-spline',
        'kernel runs after tone mapping at a stride that doubles each pass, and every tap is weighted',
        'down when it differs from the centre in brightness or in density, so noise averages out while',
        'the thin bright filaments stay sharp.</p>',
        '<ul>',
        '<li><b>1 pass</b> — a light polish.</li>',
        '<li><b>2 passes</b> — about 60% less measured noise, with mean brightness moving 0.1%.</li>',
        '<li><b>4 passes</b> — goes further, but begins to soften genuine detail.</li>',
        '</ul>',
        '<p><em>Denoise strength</em> sets how readily the filter blurs across those differences — low',
        'keeps every filament, high smooths harder. It costs a full-screen pass or two on the GPU, and',
        'applies to the Render tab\'s offline output as well.</p>',

        '<h3>Keeping a look</h3>',
        '<p>A toggle at the top of the Image tab decides what happens when you generate a sheep.',
        '<b>Kept across new sheep</b> (the default) carries the whole tab — including symmetry — onto',
        'anything you generate or mutate, so a look you have dialled in survives pressing <kbd>R</kbd>,',
        'and survives closing the browser. <b>Reset with each new sheep</b> goes back to letting every',
        'sheep arrive with its own randomised look. Either way, a sheep <em>loaded from your flock</em>',
        'brings the look it was saved with: that is its picture, not a preference.</p>',

        '<h3>Evolution drift</h3>',
        '<p>An optional extra on the Stream tab, <b>off by default</b>, switched with the on/off button in',
        'its own group — the heading reads <em>Evolution drift — ON</em> or <em>— off</em>, and when it is',
        'on the playlist carries a banner saying so. Worth knowing before you turn it on:',
        '<b>drift plays sheep that are not in your flock.</b> Each sheep spends a few generations mutating',
        'into itself — a small change, settle, another small change — and only when the drift runs out',
        'does the stream hand over to the next sheep in the playlist.</p>',
        '<p>By default a lineage runs as <b>one unbroken morph</b> — no pause between generations.',
        '<b>Settle</b> adds a pause on each generation if you want one; <b>Hold</b> governs the arrival at a',
        'genuinely new sheep, not the lineage.</p>',
        '<p>Within a lineage <b>the camera does not move.</b> A drift child inherits its parent\'s framing',
        'exactly, and its mutations run position-locked: transforms may change rotation, scale and shear,',
        'but not slide the attractor through world space. Without that, most of what you see is the flame',
        'translating and the auto-framing chasing it — panning, not evolution.</p>',
        '<p>Each generation is chosen rather than accepted blindly: <b>Pick best of</b> renders that many',
        'candidate children offscreen <em>at the inherited framing</em>, scores them with the same fitness',
        'heuristic the Evolve tab uses, and keeps the best. Candidates are judged one per frame across the',
        'preceding morph, so a handover never hitches.</p>',

        '<h3>Transitions</h3>',
        '<p>Everything about a morph is continuous, which takes some care. Transform columns are',
        'carried as an angle plus the <em>offset</em> between them, so the shear can never sweep through',
        'a degenerate matrix and come out mirrored — that flip used to hit roughly one transform pair in',
        'six. Symmetry is a whole number of copies and cannot be averaged, so the two orders are',
        'cross-faded instead: each sample joins the old ensemble or the new one, and the mirror is a',
        'probability rather than a switch. Density estimation ramps its radius from zero rather than',
        'snapping on, <code>xaos</code> is blended rather than dropped, and a transform one sheep does',
        'not have fades in as a silent copy of its counterpart, so it materialises where it belongs',
        'instead of growing out of the middle of the frame. When the two sheep cycle at different',
        'speeds, the rate eases across the morph rather than changing the instant it ends.</p>',
        '<p>Timing is treated the same way. Frames get dropped for reasons that have nothing to do with',
        'the animation, and advancing by the whole gap makes the picture leap — so anything animated',
        'advances by at most 50ms per frame and quietly loses the rest: a stutter costs a little speed',
        'instead of a jump. Auditions run while a sheep is playing, never during a morph, and are spread',
        'over several frames each. Pause stops the stream, too.</p>',
        '<h3>Source</h3>',
        '<p>At the top of the Stream panel, <b>Source</b> decides where sheep come from.',
        '<em>Flock playlist</em> plays the list below it — press <b>Use whole flock</b> to load everything',
        'you have kept. <em>Endless</em> ignores the playlist and grows sheep on the fly instead, which is',
        'also what happens automatically when the flock is empty, so Start stream always does something.</p>',
        '<p>At the foot of the panel, <b>Reset to defaults</b> restores every setting on that tab. It asks',
        'once (the button arms, then disarms itself after a few seconds) so a stray click cannot wipe a',
        'tuned setup. Your playlist and your flock are data, not settings, and are left alone.</p>'
      ].join('\n')
    },
    {
      id: 'endless', title: 'Endless streams', kicker: 'Choosing the next sheep',
      html: [
        '<p>With Source on <em>Endless</em>, two extra groups appear. The first is a weighted draw over',
        'four origins, made fresh every time the stream needs a sheep:</p>',
        '<table class="htable">',
        '<thead><tr><th>Origin</th><th>Where it comes from</th></tr></thead><tbody>',
        '<tr><td>Brand new</td><td>a random sheep built from <em>New sheep recipe</em> in the Sheep panel</td></tr>',
        '<tr><td>Mutation</td><td>a mutated child of the sheep just played — a wandering lineage</td></tr>',
        '<tr><td>Cross of two kept</td><td>two sheep from your flock bred together</td></tr>',
        '<tr><td>Straight from flock</td><td>one of your kept sheep, replayed unchanged</td></tr>',
        '</tbody></table>',
        '<p>Set any to zero to rule it out. Anything that cannot apply right now drops out of the draw',
        'automatically — mutation before anything has played, cross with fewer than two kept sheep — and',
        'the panel prints the mix actually in force underneath, so the weights never lie about what will',
        'happen. <b>Mutation strength</b> sets how far a mutated pick strays; <b>Avoid repeats</b> stops the',
        'same kept sheep appearing twice running.</p>',
        '<p>The second group is quality. <b>Audition</b> renders that many candidates offscreen and shows',
        'the best; <b>Good enough at</b> stops the audition early once a candidate scores that well, so a',
        'high setting keeps looking and a low one accepts sooner. Scoring uses the same judge as the',
        'Evolve tab. This is what keeps empty black frames out of a stream left running unattended.',
        'Candidates are auditioned one per frame during the preceding sheep, so raising it does not hitch',
        'the handover.</p>',
        '<p class="hnote">The overlay names the origin of what you are watching —',
        '<code>endless (mutate)</code>, <code>endless (cross)</code> — so the mix is never a black box.</p>'
      ].join('\n')
    },
    {
      id: 'controls', title: 'Controls', kicker: 'Keys, mouse, camera',
      html: [
        '<table class="htable keys">',
        '<thead><tr><th>Key</th><th>Action</th></tr></thead><tbody>',
        '<tr><td><kbd>Space</kbd></td><td>play / pause</td></tr>',
        '<tr><td><kbd>R</kbd></td><td>new random sheep</td></tr>',
        '<tr><td><kbd>M</kbd></td><td>mutate the current sheep</td></tr>',
        '<tr><td><kbd>←</kbd></td><td>previous sheep — walks back through the ones already seen; while streaming it morphs across as usual (also a button in the toolbar)</td></tr>',
        '<tr><td><kbd>→</kbd></td><td>next sheep — while streaming it morphs across as usual; with the stream off it is a new random sheep (also a button in the toolbar)</td></tr>',
        '<tr><td><kbd>F</kbd></td><td>auto-frame (resets the view offset; while streaming, resets it only)</td></tr>',
        '<tr><td><kbd>K</kbd></td><td>keep (save to the flock)</td></tr>',
        '<tr><td><kbd>C</kbd></td><td>clear the exposure and restart</td></tr>',
        '<tr><td><kbd>S</kbd></td><td>start / stop the stream (also a button in the toolbar)</td></tr>',
        '<tr><td><kbd>E</kbd></td><td>render and save a PNG</td></tr>',
        '<tr><td><kbd>V</kbd></td><td>fullscreen viewfinder</td></tr>',
        '<tr><td><kbd>U</kbd></td><td>hide the panels without going fullscreen</td></tr>',
        '<tr><td><kbd>H</kbd></td><td>show / hide the sheep details overlay (off by default; also a button in the toolbar)</td></tr>',
        '<tr><td><kbd>?</kbd> / <kbd>F1</kbd></td><td>this help</td></tr>',
        '<tr><td><kbd>+</kbd> / <kbd>−</kbd></td><td>zoom</td></tr>',
        '</tbody></table>',
        '<p>In the fullscreen viewfinder the canvas takes the whole screen, the cursor fades after a couple',
        'of seconds of stillness, and every shortcut still works — so you can keep pressing <kbd>R</kbd>,',
        '<kbd>M</kbd> and <kbd>K</kbd> while watching. <kbd>Esc</kbd>, <kbd>V</kbd>, or the corner button',
        'brings the panels back. <kbd>U</kbd> does the same thing in a window, which is the one to use on a',
        'second monitor.</p>',
        '<p>Every slider\'s value box can be typed into — click it, enter a number, press Enter. The number',
        'you type is the number shown, so a zoom reading <code>×3.50</code> takes <code>3.5</code> even',
        'though the slider itself works on a log scale. Values are clamped to the slider\'s range.',
        'Double-click a slider\'s <em>label</em> to reset it where a default is defined.</p>',
        '<p><b>Drag</b> the canvas to pan, <b>scroll</b> to zoom, <b>shift-drag</b> to rotate,',
        '<b>double-click</b> to auto-frame.</p>',
        '<p>The toolbar is icons rather than words, so it fits a phone as readily as a desktop. Hover any',
        'of them for its name and shortcut; the order is previous, play/pause, next, random, mutate,',
        'fit, keep, stream, clear, the quality preset, the details overlay, fullscreen and the handbook.</p>',
        '<p>Above it sits a menu bar — <b>File</b>, <b>View</b>, <b>Panels</b>, <b>Stream</b>, <b>Help</b> —',
        'and at the foot of the screen a taskbar with a <b>Start</b> menu. Neither can do anything the',
        'toolbar and the keyboard cannot: every entry fires the same button or the same shortcut, so there',
        'is one implementation of each command and three ways to reach it. <b>Panels</b> jumps straight to a',
        'tab of the side panel, which is the one thing the toolbar has no button for. The status bar along',
        'the bottom of the window repeats whatever the app last said, next to the frame rate and sample',
        'readout.</p>',
        '<h3>On a phone or tablet</h3>',
        '<p>A touch device gets a shell of its own. The toolbar keeps every transport button — it scrolls',
        'sideways when there are more than fit — and everything else starts hidden: no menu bar, no taskbar,',
        'no status bar, no side panel, no filmstrip, no readout.',
        'The <b>☰ Options</b> button on the right slides the panel in as a drawer, up',
        'from the bottom in portrait and in from the side in landscape, with the controls sized for fingers.',
        'Tap the <b>✕</b>, the dimmed area, or press <kbd>Esc</kbd> on a keyboard to put it away again.</p>',
        '<p>The canvas takes the gestures the mouse takes on a desktop: <b>one finger</b> drags to pan,',
        '<b>two fingers</b> pinch to zoom and twist to rotate, and a <b>double tap</b> auto-frames.</p>',
        '<p class="hnote">The layout is chosen from a coarse pointer plus a phone-or-tablet-sized viewport,',
        'so a narrow desktop window keeps the desktop UI. Add <code>?mobile=1</code> to the URL to force the',
        'touch shell, or <code>?mobile=0</code> to force the desktop one.</p>',
        '<h3>Moving the camera while a stream is running</h3>',
        '<p>A stream rewrites the genome every frame, so it owns the camera — a direct camera edit would be',
        'overwritten before you saw it. Instead, the same gestures drive a <b>View</b> offset that is',
        'layered on top of whatever is playing.</p>',
        '<p>The offset survives sheep changes, so you can zoom into a stream and stay there while it carries',
        'on morphing through the flock. It is shown in the on-screen overlay whenever it is not neutral, and',
        '<kbd>F</kbd> resets it. The sliders live in the <b>View</b> group of the Sheep panel.</p>',
        '<p class="hnote">The offset is not part of any sheep and is never saved into one — but <b>Keep</b>',
        'bakes it in, so what you save is what you were actually looking at.</p>'
      ].join('\n')
    },
    {
      id: 'loop', title: 'The loop', kicker: 'Why it never seams',
      html: [
        '<p>Every sheep carries a set of <b>motion channels</b>. Each one drives a single parameter around a',
        'cycle as the loop phase runs from 0 to 1 — one transform slowly rotating, a variation parameter',
        'swelling and receding, the palette cycling once all the way round.</p>',
        '<p>The channels are built so the loop <em>closes</em>. Oscillating channels use',
        '<code>a · (sin(2π(k·t + p)) − sin(2π·p))</code>: periodic in <code>t</code>, and exactly zero at',
        '<code>t = 0</code>, so the sheep you saved is frame zero of its own animation. Rotating channels turn',
        'a whole number of times, so the angle lands back where it began.</p>',
        '<p class="hnote">That guarantee is verified, not assumed: rendering a sheep at phase 0 and at phase',
        '1.0 produces images with a pixel difference of exactly zero.</p>',
        '<table class="htable">',
        '<thead><tr><th>Channel</th><th>What it moves</th></tr></thead><tbody>',
        '<tr><td>Transform spin</td><td>one transform rotating a whole number of turns</td></tr>',
        '<tr><td>Transform scale / shear / orbit</td><td>its shape breathing, skewing, or circling</td></tr>',
        '<tr><td>Transform weight / colour / opacity</td><td>how much it contributes, and where it sits in the palette</td></tr>',
        '<tr><td>Variation weight / parameter</td><td>the non-linear shape itself deforming</td></tr>',
        '<tr><td>Palette cycle</td><td>colours travelling once round the gradient</td></tr>',
        '<tr><td>Camera spin / zoom</td><td>the whole view turning or drifting in and out</td></tr>',
        '</tbody></table>',
        '<p><b>Loop length</b> sets how long one cycle takes. <b>Amount</b> is how far a channel swings,',
        '<b>cycles</b> how many times it swings per loop (whole numbers only — a fraction would not close),',
        'and <b>offset</b> where in its swing it starts, so channels do not all move together.',
        '<b>Generate loop</b> choreographs a fresh set; <b>Phase</b> scrubs by hand, which is easiest with',
        'playback paused.</p>',
        '<p>New random sheep get a loop automatically. Sheep saved before loops existed load with none and',
        'play as stills — give one a loop with Generate loop.</p>',
        '<h3>Pacing a stream</h3>',
        '<p>In the Stream panel, <b>Loops per sheep</b> decides how many complete cycles play before the',
        'transition to the next sheep begins. Next to it, a toggle chooses between <em>each sheep\'s own',
        'length</em> — every sheep cycles at whatever it was saved with, so a slow one stays slow — and',
        '<em>same length for every sheep</em>, which overrides them all with one value and gives you a single',
        'pace control for the whole stream. The override never writes to the sheep: switch back and they',
        'return to their own lengths.</p>',
        '<p>The overlay shows the length in force while a stream runs — <code>20.0s</code> when a sheep is',
        'using its own, <code>7.0s fixed</code> when the override is on. That is the whole rhythm of the',
        'original project: settle on a sheep, watch it breathe a few times, move on.</p>'
      ].join('\n')
    },
    {
      id: 'output', title: 'Rendering out', kicker: 'Files, not screenshots',
      html: [
        '<p>A <b>recording</b> captures the live view, so its quality is whatever the GPU can manage in a',
        'thirtieth of a second. A <b>render</b> is the opposite trade: every frame gets its own full deep',
        'exposure and takes as long as it needs, and the frames are encoded with explicit timestamps — so a',
        'render that takes an hour still plays back at the frame rate you asked for. That decoupling is the',
        'whole point. Both live on the Render tab; the recorder is under <em>Live capture</em> for quick grabs.</p>',
        '<p>Set <b>Source</b> to the current sheep, your flock playlist, or an endless stream, and give it a',
        '<b>Duration</b>. Everything about pacing — loops per sheep, transition length, the endless origin mix,',
        'drift — comes from the Stream tab, so what you render matches what you were watching.</p>',
        '<p>Then the two dials the recorder could never offer:</p>',
        '<ul>',
        '<li><b>Samples per frame</b> is the quality lever. It buys exposure depth with time rather than frame',
        'rate, so a value that would drop the live view to a slideshow is perfectly reasonable here.</li>',
        '<li><b>Motion blur</b> takes several sub-samples across each frame\'s shutter and integrates them into',
        'one exposure. This is genuine temporal sampling, not the trailing exposure the live view uses to fake',
        'it, and it is what stops fast motion strobing.</li>',
        '</ul>',
        '<p>Output is WebM (VP9, VP8 or AV1) via the browser\'s own encoder, or a ZIP of lossless PNG frames if',
        'you would rather grade or assemble them yourself. The PNG sequence is held in memory until it is saved,',
        'so the panel shows the estimated size and warns before it gets unreasonable.</p>',
        '<p>The panel reports every stage, because a long render has several and any of them can take minutes:',
        'the frame being rendered with elapsed time and an estimate of what is left, then',
        '<code>Encoding N / M frames</code> as the codec drains, then muxing and writing. Encoding is',
        'deliberately kept alongside the render rather than saved up for the end — a new frame will not start',
        'while the encoder is more than a few frames behind, which is why you may briefly see',
        '<em>waiting for the encoder</em>. A render can be cancelled at any point, including mid-encode, and the',
        'view is restored exactly as it was.</p>',
        '<p class="hnote">If a stage goes quiet for more than about twenty-five seconds the status says so',
        'rather than leaving you guessing. AV1 in particular is slow enough that this is normal rather than a',
        'fault.</p>'
      ].join('\n')
    },
    {
      id: 'exposure', title: 'The exposure', kicker: 'The accumulation buffer',
      html: [
        '<p>The accumulation buffer is the whole trick, and it is used one of two ways depending on whether',
        'anything is moving. There is nothing to choose — the engine works it out.</p>',
        '<dl class="hdl">',
        '<dt>Something is moving</dt><dd>The sheep is playing its loop, a stream is running, or the camera is',
        'spinning. The buffer is faded by <em>trail decay</em> every frame, holding a rolling exposure. That is',
        'what makes motion smooth instead of strobing.</dd>',
        '<dt>Nothing is moving</dt><dd>A sheep with its loop switched off, sitting still. The buffer is never',
        'cleared, so the image keeps gathering samples and gets cleaner the longer you leave it. This is how you',
        'get a clean still: turn the loop off in the Loop tab and wait, or use <b>Export still</b>, which does a',
        'deep exposure regardless.</dd>',
        '</dl>',
        '<p>Higher trail decay means more samples per frame and a cleaner picture, but longer ghosting through a',
        'morph. 0.90–0.95 is the useful range. It lives under <em>Motion</em> on the Image tab and is ignored',
        'entirely when nothing is moving.</p>',
        '<p>At the bottom of its range, <b>0 means no trail at all</b> — the buffer is cleared rather than faded,',
        'so every frame stands on its own samples. Motion is perfectly crisp with no ghosting whatsoever, at the',
        'cost of grain: with nothing carried over, a frame only has <em>particles × passes</em> samples to work',
        'with. Raise both if you want to use it.</p>'
      ].join('\n')
    },
    {
      id: 'quality', title: 'Quality knobs', kicker: 'Frame rate and samples',
      html: [
        '<p><b>Hold fps above</b> is a floor, not a limit. Auto quality keeps adding passes per frame until the',
        'frame rate drops to roughly this number — so on a fast card you will see it settle on high quality and',
        'still run <em>well above</em> the figure you set. It is a budget for how much detail to buy with the',
        'headroom you have, not a speed limit.</p>',
        '<p>If you want an actual limit — quieter fans, less battery — that is <b>Limit fps to</b>, which caps how',
        'often the picture is redrawn. Loops and streams keep correct time regardless, because the skipped',
        'interval is still counted.</p>',
        '<p><em>Particles</em> × <em>passes per frame</em> is your sample rate. Auto-quality adjusts passes to hold',
        'the target frame rate, so raise particles if you have GPU to spare and let it find its own level.',
        '<em>Supersample</em> is the accumulation buffer\'s resolution multiplier — 2× is a good default, 3× is for',
        'stills. <em>Resolution</em> scales the output itself if you want to trade sharpness for speed.</p>',
        '<p class="hnote">If a flame looks like grainy static, it needs samples: pause the stream and wait — or',
        'raise the gamma threshold to keep the noise floor black, or turn on <em>Denoise</em> on the Image tab.</p>'
      ].join('\n')
    },
    {
      id: 'files', title: 'Files', kicker: 'What lives where',
      html: [
        '<pre class="hpre">index.html          the app',
        'css/style.css       interface',
        'js/variations.js    the 81 variations + GLSL code generation',
        'js/shaders.js       GLSL for the chaos game, splatting, tone mapping, glow, denoise',
        'js/palette.js       gradient presets and generators',
        'js/genome.js        the sheep: schema, seeded generation, packing, interpolation',
        'js/renderer.js      the WebGL2 engine',
        'js/evolve.js        mutation, crossover, fitness',
        'js/library.js       the flock: storage, import, export',
        'js/render.js        offline rendering, WebM muxing, PNG/ZIP output',
        'js/ui.js            control toolkit',
        'js/help.js          this help screen',
        'js/main.js          app shell, panels, stream, export</pre>',
        '<p>Saved sheep live in browser storage for convenience, but the real format is the file:',
        '<b>Export flock</b> writes a <code>.flock.json</code> you can back up, move between machines, or keep in',
        'version control. Individual sheep export as <code>.sheep.json</code>.</p>'
      ].join('\n')
    },
    {
      id: 'engine', title: 'How the renderer works', kicker: 'Under the hood',
      html: [
        '<ol class="hsteps">',
        '<li>A texture holds tens of thousands of points. One fragment pass advances every point through one',
        'randomly chosen transform — the chaos game, run massively in parallel.</li>',
        '<li>Those points are then drawn as GL points into a floating-point histogram with additive blending,',
        'coloured by the palette lookup of their running colour index.</li>',
        '<li>Steps 1–2 repeat several times per frame.</li>',
        '<li>The histogram is tone-mapped: log density, adaptive density-estimation blur in sparse regions, gamma',
        'with a linear threshold near black, vibrancy, highlight roll-off.</li>',
        '<li>An optional edge-avoiding wavelet denoise runs on the tone-mapped image.</li>',
        '<li>Glow, vignette, grain and colour grading composite to the canvas.</li>',
        '</ol>',
        '<p class="hnote">The first ~20 iterations after a change are discarded (the "fuse") so points have settled',
        'onto the attractor before anything is recorded.</p>'
      ].join('\n')
    }
  ];

  var root = null, navEl = null, bodyEl = null, current = null, searchEl = null;

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'html') n.innerHTML = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }

  function build() {
    if (root) return;
    root = el('div', { class: 'helpwrap', id: 'helpwrap', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Help' });
    var card = el('div', { class: 'helpcard' });

    var head = el('div', { class: 'helphead' });
    head.appendChild(el('div', {
      class: 'helptitle',
      html: '<span class="mark">◈</span> Electric Shepherd <span class="sub">handbook</span>'
    }));
    searchEl = el('input', { type: 'text', class: 'helpsearch', placeholder: 'Filter sections…', 'aria-label': 'Filter sections' });
    head.appendChild(searchEl);
    var close = el('button', { class: 'helpclose', title: 'Esc' , text: '✕' });
    close.onclick = hide;
    head.appendChild(close);
    card.appendChild(head);

    var cols = el('div', { class: 'helpcols' });
    navEl = el('nav', { class: 'helpnav' });
    bodyEl = el('div', { class: 'helpbody' });
    cols.appendChild(navEl); cols.appendChild(bodyEl);
    card.appendChild(cols);

    SECTIONS.forEach(function (s) {
      var b = el('button', { class: 'helpnavbtn', 'data-id': s.id });
      b.appendChild(el('span', { class: 'hn-title', text: s.title }));
      b.appendChild(el('span', { class: 'hn-kick', text: s.kicker }));
      b.onclick = function () { show(s.id); };
      navEl.appendChild(b);

      var pane = el('article', { class: 'helppane', 'data-id': s.id });
      pane.appendChild(el('h2', { text: s.title }));
      pane.appendChild(el('div', { html: s.html }));
      bodyEl.appendChild(pane);
    });

    // cross-links between panes
    bodyEl.addEventListener('click', function (e) {
      var a = e.target.closest('a[data-goto]');
      if (!a) return;
      e.preventDefault();
      show(a.getAttribute('data-goto'));
    });

    searchEl.addEventListener('input', function () {
      var q = searchEl.value.trim().toLowerCase();
      var firstHit = null;
      SECTIONS.forEach(function (s) {
        var hay = (s.title + ' ' + s.kicker + ' ' + s.html).toLowerCase();
        var hit = !q || hay.indexOf(q) >= 0;
        navEl.querySelector('[data-id="' + s.id + '"]').classList.toggle('hidden', !hit);
        if (hit && !firstHit) firstHit = s.id;
      });
      if (q && firstHit && firstHit !== current) show(firstHit, true);
    });

    root.addEventListener('mousedown', function (e) { if (e.target === root) hide(); });
    root.appendChild(card);
    document.body.appendChild(root);
    show(SECTIONS[0].id, true);
  }

  function show(id, quiet) {
    current = id;
    Array.prototype.forEach.call(navEl.children, function (b) {
      b.classList.toggle('active', b.getAttribute('data-id') === id);
    });
    Array.prototype.forEach.call(bodyEl.children, function (p) {
      p.classList.toggle('active', p.getAttribute('data-id') === id);
    });
    bodyEl.scrollTop = 0;
    if (!quiet && searchEl) searchEl.blur();
  }

  function isOpen() { return !!root && root.classList.contains('open'); }

  function open(id) {
    build();
    if (id) show(id, true);
    root.classList.add('open');
    document.body.classList.add('helping');
  }
  function hide() {
    if (!root) return;
    root.classList.remove('open');
    document.body.classList.remove('helping');
  }
  function toggle(id) { isOpen() ? hide() : open(id); }

  global.FlameHelp = {
    open: open, close: hide, toggle: toggle, isOpen: isOpen,
    show: function (id) { open(id); },
    sections: SECTIONS
  };
})(typeof window !== 'undefined' ? window : globalThis);
