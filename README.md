# Electric Shepherd — local flame engine

A self-contained fractal-flame generator in the spirit of Scott Draves' *Electric Sheep*,
running entirely on your own machine. No server, no installer, no network calls.
Every "sheep" is a plain JSON genome, so any image you like can be reproduced exactly,
bred with another, or morphed into the next one in an endless looping stream.

> **Maintenance note — keep the in-app help in step.**
> The **?** button in the toolbar (`?` or `F1`) opens a handbook that mirrors this file,
> section for section, minus *Running it*. It is hand-written in **`js/help.js`**, not
> generated from this README, so **when you edit a section here, edit the matching
> section there.** The `SECTIONS` array at the top of `js/help.js` lists the mapping,
> and `MAINTAINING.md` spells it out.

---

## Running it

Double-click **`index.html`**. That's it — it opens in Chrome, Edge or Firefox and
renders on your GPU via WebGL2.

If you prefer a local server (needed only if your browser is locked down about
`file://`), run this from the project folder:

```
python -m http.server 8080
```

then open <http://localhost:8080>.

**Requirements:** a browser with WebGL2 and `EXT_color_buffer_float`. Anything from the
last several years qualifies. A discrete GPU makes it luxurious; integrated graphics
still work — turn the quality down.

---

## What a "sheep" is

Each sheep is an iterated function system rendered with the fractal-flame algorithm:
a few affine transforms, each pushed through a weighted blend of non-linear *variations*,
sampled by the chaos game and accumulated into a floating-point histogram that is then
log-tone-mapped. The genome holds everything:

| Part | What it controls |
|---|---|
| `xforms[]` | 1–12 transforms: affine coefficients, optional post-affine, weight, opacity, colour index and colour speed |
| `xforms[].vars[]` | up to 8 variations per transform, each with a signed weight and up to 6 parameters |
| `xforms[].xaos[]` | per-transform transition weights — which transform may follow which |
| `final` | an optional final transform applied to every point before it lands |
| `palette` | preset / generated gradient, or explicit colour stops, plus rotate, hue, saturation, value, contrast |
| `camera` | centre, zoom, rotation, continuous spin |
| `render` | brightness, gamma, gamma threshold, vibrancy, highlight roll-off, density estimation, jitter, denoise, symmetry, glow, vignette, grain, contrast, saturation, hue shift, background |

**81 variations** are implemented on the GPU, from `linear` and `spherical` through
`julian`, `cpow`, `escher`, `hypertile`, `super_shape` and `crackle`.

Because the genome carries the camera and the render settings, saving a sheep saves the
picture — reopening it reproduces the same image, and the sample sequence is seeded from
the genome so even the grain repeats.

---

## The panels

**Sheep** — name, seed, camera, the recipe used for new random sheep, quality
settings, and the raw genome JSON (editable; paste one in and press Apply).

**Transforms** — pick a transform from the chips, then edit its affine matrix
(numerically or with the rotate/scale/nudge buttons), its variation stack, its colour,
and the xaos matrix that decides which transform may follow which.

**Palette** — presets, generators (hue walk, complementary, triadic, analogous, mono,
random), and a bake-to-stops mode where you edit individual colours by hand.

**Image** — the tone-mapping chain and the post-processing. Brightness and gamma are
the two you will reach for most; density estimation is what cleans up the sparse outer
regions; symmetry adds rotational copies at splat time. (This tab was called *Render*
before there was a real render tab.)

**Denoise** lives in *Sampling & filter* and is off by default. A flame is a Monte Carlo
render, so at low sample counts the grain is roughly independent per pixel — the classic
cheap fix is an edge-avoiding a-trous wavelet, which is what this is. A 5x5 B3-spline
kernel runs after tone mapping at a stride that doubles each pass, and every tap is
weighted down when it differs from the centre in brightness or in density, so noise
averages out while the thin bright filaments stay sharp. One pass is a light polish; two
cut measured noise by about 60% with the mean brightness moving 0.1%; four go further but
begin to soften genuine detail. *Denoise strength* sets how readily the filter blurs
across those differences — low keeps every filament, high smooths harder. It is a
full-screen pass or two on the GPU, so it costs very little in the live view, and it
applies to the Render tab's offline output as well.

A toggle at the top decides what happens to these when you generate a sheep. **Kept
across new sheep** (the default) carries the whole tab — including symmetry — onto
anything you generate or mutate, so a look you have dialled in survives pressing `R`, and
survives closing the browser. **Reset with each new sheep** goes back to letting every
sheep arrive with its own randomised look. Either way, a sheep *loaded from your flock*
brings the look it was saved with: that is its picture, not a preference.

**Loop** — the heart of it. A sheep is not a still image; it is a short animation that
returns to exactly where it started, so it can repeat forever without a seam. This panel
is where that animation is built. See *The loop* below.

**Evolve** — a gallery of candidates. Click thumbnails to pick parents and press
**Breed**, or turn on **Auto-evolve** and let the fitness heuristic (coverage, tonal
range, colourfulness, detail, contrast — all weightable) select on its own and drop the
winners into your flock. Alt-click or double-click any thumbnail to load it.

**Stream** — build a playlist from the flock and start it. The engine holds on each
sheep, then interpolates into the next: affine matrices are decomposed into rotation,
scale and translation so transforms *turn* into each other instead of collapsing
through zero; palettes cross-fade; cameras ease. It loops forever. To get it out as a
file, see the Render tab.

Everything about a morph is continuous, which takes some care. Transform columns are
carried as an angle plus the *offset* between them, so the shear can never sweep through
a degenerate matrix and come out mirrored — that flip used to hit roughly one transform
pair in six. Symmetry is a whole number of copies and cannot be averaged, so the two
orders are cross-faded instead: each sample joins the old ensemble or the new one, and
the mirror is a probability rather than a switch. Density estimation ramps its radius
from zero rather than snapping on. `xaos` is blended rather than dropped for the
duration. A transform one sheep does not have fades in as a silent copy of its
counterpart, so it materialises where it belongs instead of growing out of the middle of
the frame. And when the two sheep cycle at different speeds, the rate eases across the
morph rather than changing the instant it ends.

Timing is treated the same way. Frames get dropped for reasons that have nothing to do
with the animation, and advancing by the whole gap makes the picture leap; anything
animated therefore advances by at most 50ms per frame and quietly loses the rest, so a
stutter costs a little speed instead of a jump. Auditions — the offscreen candidates the
stream scores before showing you one — run while a sheep is playing, never during a
morph, and are spread over several frames each rather than done in one. Pause stops the
stream, too.

*Evolution drift* is an optional extra, **off by default**, switched with the on/off
button in its own group — the group heading reads *Evolution drift — ON* or *— off*, and
when it is on the playlist carries a banner saying so. Worth knowing before you turn it
on: **drift plays sheep that are not in your flock.** Each sheep spends a few generations
mutating into itself — a small change, settle, another small change — and only when the
drift runs out does the stream hand over to the next sheep in the playlist. Those
generations are newly grown sheep with their own names. Set **Generations** to how many
each sheep goes through, and **Drift strength** to how far each strays from its parent;
low values keep the family resemblance across the whole sequence.

By default a lineage runs as **one unbroken morph** — no pause between generations, so
the sheep appears to evolve continuously rather than stepping. **Settle** adds a pause on
each generation if you want one; at 0 the interpolation runs linearly so the speed
carries across each generation boundary, and only the arrival at a genuinely new sheep
eases in and out. **Hold** governs that arrival, not the lineage.

Within a lineage **the camera does not move.** A drift child inherits its parent's
framing exactly, and its mutations run position-locked: transforms are free to change
rotation, scale and shear, but not to slide the attractor through world space. Without
that, most of what you see is the flame translating and the auto-framing chasing it,
which looks like panning rather than evolution. Framing changes belong to the hop
between sheep, where they read as a scene change.

Each generation is chosen rather than accepted blindly: **Pick best of** renders that
many candidate children offscreen *at the inherited framing*, scores them with the same
fitness heuristic the Evolve tab uses, and keeps the best — so a child that wanders out
of shot simply loses. Candidates are judged one per frame across the preceding morph, so
a handover never hitches. If a lineage does strand itself, that one child is re-framed
rather than the whole run being abandoned.

**Source**, at the top of the Stream panel, decides where sheep come from. *Flock
playlist* plays the list below it — press **Use whole flock** to load everything you have
kept. *Endless* ignores the playlist and grows sheep on the fly instead, which is also
what happens automatically when the flock is empty, so Start stream always does
something. When Source is Endless the playlist stays visible but dimmed, with a **Play
these** button to switch back.

### Endless: choosing the next sheep

With Source on *Endless*, two extra groups appear. The first is a weighted draw over
four origins, made fresh every time the stream needs a sheep:

| Origin | Where it comes from |
|---|---|
| Brand new | a random sheep built from *New sheep recipe* in the Sheep panel |
| Mutation | a mutated child of the sheep just played — a wandering lineage |
| Cross of two kept | two sheep from your flock bred together |
| Straight from flock | one of your kept sheep, replayed unchanged |

Set any to zero to rule it out. Anything that cannot apply right now drops out of the
draw automatically — mutation before anything has played, cross with fewer than two kept
sheep — and the panel prints the mix actually in force underneath, so the weights never
lie about what will happen. **Mutation strength** sets how far a mutated pick strays;
**Avoid repeats** stops the same kept sheep appearing twice running.

The second group is quality. **Audition** renders that many candidates offscreen and
shows the best; **Good enough at** stops the audition early once a candidate scores that
well, so a high setting keeps looking and a low one accepts sooner. Scoring uses the same
judge as the Evolve tab — coverage, tonal range, colourfulness, detail and contrast,
weighted in that tab. This is what keeps empty black frames out of a stream left running
unattended. Candidates are auditioned one per frame during the preceding sheep, so
raising it does not hitch the handover.

The overlay names the origin of what you are watching — `endless (mutate)`,
`endless (cross)` — so the mix is never a black box.

At the foot of the Stream panel, **Reset to defaults** restores every setting on that tab
— source, loops, drift, the endless mix, timing, recording and export. It asks once
(the button arms, then disarms itself after a few seconds) so a stray click cannot wipe a
tuned setup. Your playlist and your flock are data, not settings, and are left alone.

**Render** — output to a file. See *Rendering out* below.

**Flock** — everything you have kept. Load, favourite, add to the stream, export, or
delete. Import `.sheep.json` / `.flock.json` files, or just drag them onto the window.

---

## Controls

| Key | Action |
|---|---|
| `Space` | play / pause |
| `R` | new random sheep |
| `M` | mutate the current sheep |
| `F` | auto-frame (resets the view offset; while streaming, resets it only) |
| `K` | keep (save to the flock) |
| `C` | clear the exposure and restart |
| `S` | start / stop the stream (also a button in the toolbar) |
| `E` | render and save a PNG |
| `V` | fullscreen viewfinder |
| `U` | hide the panels without going fullscreen |
| `H` | hide / show the overlay |
| `?` / `F1` | open the in-app handbook |
| `+` / `-` | zoom |

In the fullscreen viewfinder the canvas takes the whole screen, the cursor fades after a
couple of seconds of stillness, and every shortcut still works — so you can keep pressing
`R`, `M` and `K` while watching. `Esc`, `V`, or the corner button brings the panels back.
`U` does the same thing in a window, which is the one to use on a second monitor.

Every slider's value box can be typed into — click it, enter a number, press Enter. The
number you type is the number shown, so a zoom reading `×3.50` takes `3.5` even though
the slider itself works on a log scale. Values are clamped to the slider's range.
Double-click a slider's *label* to reset it where a default is defined.

Drag the canvas to pan, scroll to zoom, shift-drag to rotate, double-click to auto-frame.

### On a phone or tablet

A touch device gets a shell of its own. The top bar keeps every transport button — it
scrolls sideways when there are more than fit — and everything else starts hidden: no
side panel, no filmstrip, no readout. The **☰ Options** button on the right slides the
panel in as a drawer, up from the bottom in portrait and in from the side in landscape,
with the controls sized for fingers. Tap the ✕, the dimmed area, or press `Esc` on a
keyboard to put it away again.

The canvas takes the gestures the mouse takes on a desktop: **one finger** drags to pan,
**two fingers** pinch to zoom and twist to rotate, and a **double tap** auto-frames.

The layout is chosen from a coarse pointer plus a phone-or-tablet-sized viewport, so a
narrow desktop window keeps the desktop UI. Add `?mobile=1` to the URL to force the touch
shell (or `?mobile=0` to force the desktop one) if you want to look at it on a big screen.

### Moving the camera while a stream is running

A stream rewrites the genome every frame, so it owns the camera — a direct camera edit
would be overwritten before you saw it. Instead, the same gestures drive a **View**
offset that is layered on top of whatever is playing: drag to pan, scroll to zoom,
shift-drag to rotate, exactly as usual.

The offset survives sheep changes, so you can zoom into a stream and stay there while it
carries on morphing through the flock. It is shown in the on-screen overlay whenever it
is not neutral, so an unexpected framing is never a mystery, and **F** resets it. The
sliders live in the **View** group of the Sheep panel.

The offset is not part of any sheep and is never saved into one — but **Keep** bakes it
in, so what you save is what you were actually looking at.

---

## The loop

Every sheep carries a set of **motion channels**. Each one drives a single parameter
around a cycle as the loop phase runs from 0 to 1 — one transform slowly rotating, a
variation parameter swelling and receding, the palette cycling once all the way round.

The channels are built so the loop *closes*. Oscillating channels use
`a · (sin(2π(k·t + p)) − sin(2π·p))`: periodic in `t`, and exactly zero at `t = 0`, so
the sheep you saved is frame zero of its own animation. Rotating channels turn a whole
number of times, so the angle lands back where it began. Both give the same guarantee —
the last frame is bit-identical to the first, and the repeat is invisible.

That guarantee is verified, not assumed: rendering a sheep at phase 0 and at phase 1.0
produces images with a pixel difference of exactly zero.

| Channel | What it moves |
|---|---|
| Transform spin | one transform rotating a whole number of turns |
| Transform scale / shear / orbit | its shape breathing, skewing, or circling |
| Transform weight / colour / opacity | how much it contributes, and where it sits in the palette |
| Variation weight / parameter | the non-linear shape itself deforming |
| Palette cycle | colours travelling once round the gradient |
| Camera spin / zoom | the whole view turning or drifting in and out |

**Loop length** sets how long one cycle takes. **Amount** is how far a channel swings,
**cycles** how many times it swings per loop (whole numbers only — a fraction would not
close), and **offset** where in its swing it starts, so channels do not all move
together. **Generate loop** choreographs a fresh set; **Phase** scrubs by hand, which is
easiest with playback paused.

New random sheep get a loop automatically. Sheep saved before loops existed load with
none and play as stills — give one a loop with Generate loop.

In the Stream panel, **Loops per sheep** decides how many complete cycles play before
the transition to the next sheep begins. Next to it, a toggle chooses between *each
sheep's own length* — every sheep cycles at whatever it was saved with, so a slow one
stays slow — and *same length for every sheep*, which overrides them all with one value
and gives you a single pace control for the whole stream. The override never writes to
the sheep: switch back and they return to their own lengths. A sheep with no loop is
unaffected either way; it has no motion to pace, so it falls back to **Hold**.

The on-screen overlay shows the length in force while a stream runs — `20.0s` when a
sheep is using its own, `7.0s fixed` when the override is on. That is the whole rhythm of the original
project: settle on a sheep, watch it breathe a few times, move on.

## Rendering out

A **recording** captures the live view, so its quality is whatever the GPU can manage in
a thirtieth of a second. A **render** is the opposite trade: every frame gets its own
full deep exposure and takes as long as it needs, and the frames are encoded with
explicit timestamps — so a render that takes an hour still plays back at the frame rate
you asked for. That decoupling is the whole point. Both live on the Render tab; the
recorder is still there under *Live capture* for quick grabs.

Set **Source** to the current sheep, your flock playlist, or an endless stream, and give
it a **Duration**. Everything about pacing — loops per sheep, transition length, the
endless origin mix, drift — comes from the Stream tab, so what you render matches what
you were watching.

Then the two dials the recorder could never offer:

- **Samples per frame** is the quality lever. It buys exposure depth with time rather
  than frame rate, so a value that would drop the live view to a slideshow is perfectly
  reasonable here.
- **Motion blur** takes several sub-samples across each frame's shutter and integrates
  them into one exposure. This is genuine temporal sampling, not the trailing exposure
  the live view uses to fake it, and it is what stops fast motion strobing.

Output is WebM (VP9, VP8 or AV1) via the browser's own encoder, or a ZIP of lossless PNG
frames if you would rather grade or assemble them yourself. The PNG sequence is held in
memory until it is saved, so the panel shows the estimated size and warns before it gets
unreasonable.

The panel reports every stage, because a long render has several and any of them can
take minutes: the frame being rendered with elapsed time and an estimate of what is
left, then `Encoding N / M frames` as the codec drains, then muxing and writing. Encoding
is deliberately kept alongside the render rather than saved up for the end — a new frame
will not start while the encoder is more than a few frames behind, which is why you may
briefly see *waiting for the encoder*. A render can be cancelled at any point, including
mid-encode, and the view is restored exactly as it was.

If a stage does go quiet for more than about twenty-five seconds the status says so
rather than leaving you guessing. AV1 in particular is slow enough that this is normal
rather than a fault.

## The exposure

The accumulation buffer is the whole trick, and it is used one of two ways depending on
whether anything is moving. There is nothing to choose — the engine works it out.

- **Something is moving** — the sheep is playing its loop, a stream is running, or the
  camera is spinning. The buffer is faded by *trail decay* every frame, holding a rolling
  exposure. That is what makes motion smooth instead of strobing.
- **Nothing is moving** — a sheep with its loop switched off, sitting still. The buffer
  is never cleared, so the image keeps gathering samples and gets cleaner the longer you
  leave it. This is how you get a clean still: turn the loop off in the Loop tab and
  wait, or use **Export still**, which does a deep exposure regardless.

Higher trail decay means more samples per frame and a cleaner picture, but longer
ghosting through a morph. 0.90–0.95 is the useful range. It lives under *Motion* on the
Image tab and is ignored entirely when nothing is moving.

At the bottom of its range, **0 means no trail at all** — the buffer is cleared rather
than faded, so every frame stands on its own samples. Motion is perfectly crisp with no
ghosting whatsoever, at the cost of grain: with nothing carried over, a frame only has
*particles × passes* samples to work with. Raise both if you want to use it.

---

## Quality knobs

**Hold fps above** is a floor, not a limit. Auto quality keeps adding passes per frame
until the frame rate drops to roughly this number — so on a fast card you will see it
settle on high quality and still run *well above* the figure you set. It is a budget for
how much detail to buy with the headroom you have, not a speed limit.

If you want an actual limit — quieter fans, less battery — that is **Limit fps to**,
which caps how often the picture is redrawn. Loops and streams keep correct time
regardless, because the skipped interval is still counted.


*Particles* × *passes per frame* is your sample rate. Auto-quality adjusts passes to
hold the target frame rate, so raise particles if you have GPU to spare and let it
find its own level. *Supersample* is the accumulation buffer's resolution multiplier —
2× is a good default, 3× is for stills. *Resolution* scales the output itself if you
want to trade sharpness for speed.

If a flame looks like grainy static, it needs samples: pause the stream, switch to
Refine, and wait — or raise the gamma threshold to keep the noise floor black.

---

## Files

```
index.html          the app
MAINTAINING.md      keep the README and the in-app help in step
css/style.css       interface
js/variations.js    the 81 variations + GLSL code generation
js/shaders.js       GLSL for the chaos game, splatting, tone mapping, glow, denoise
js/palette.js       gradient presets and generators
js/genome.js        the sheep: schema, seeded generation, packing, interpolation
js/renderer.js      the WebGL2 engine
js/evolve.js        mutation, crossover, fitness
js/library.js       the flock: storage, import, export
js/render.js        offline rendering, WebM muxing, PNG/ZIP output
js/ui.js            control toolkit
js/help.js          the in-app handbook (mirrors this README)
js/main.js          app shell, panels, stream, export
```

Saved sheep live in browser storage for convenience, but the real format is the file:
**Export flock** writes a `.flock.json` you can back up, move between machines, or keep
in version control. Individual sheep export as `.sheep.json`.

---

## How the renderer works

1. A texture holds tens of thousands of points. One fragment pass advances every point
   through one randomly chosen transform — the chaos game, run massively in parallel.
2. Those points are then drawn as GL points into a floating-point histogram with
   additive blending, coloured by the palette lookup of their running colour index.
3. Steps 1–2 repeat several times per frame.
4. The histogram is tone-mapped: log density, adaptive density-estimation blur in sparse
   regions, gamma with a linear threshold near black, vibrancy, highlight roll-off.
5. Glow, vignette, grain and colour grading composite to the canvas.

The first ~20 iterations after a change are discarded (the "fuse") so points have
settled onto the attractor before anything is recorded.
