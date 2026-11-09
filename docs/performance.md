# Rendering performance

Reference: WebLG commit `853a0ab8694ba24c1edb3ab4d2301548c121aeab`.

## Changes

- The frosted blur keeps the same 32 golden-spiral samples, Gaussian weights,
  radius, and per-pixel dithering. A constant rotation advances the spiral;
  its two initial trigonometric calls replace 64 calls inside each blur.
- With `chroma: 0`, a refracted edge needs one blur rather than three identical
  blurs: 32 background samples instead of 96. Zero refraction also skips
  unnecessary edge work. Mixed clear/frosted scenes have a direct sampling path.
- Scenes whose rendered lenses all have `frosted <= 0.01` automatically select
  a shader without the blur loop. This variant is compiled lazily, cached per
  renderer, and disposed with it. It adds no render pass or setting. Its first
  use can incur shader compilation; warmed measurements exclude compilation.
- The raw WebGL renderer uploads lens parameters in three contiguous batches,
  replacing 48 uploads with 16 lenses. Typed arrays and their upload views are
  allocated once, and both adapters share the parameter packing code. The
  existing per-lens uniform layout and budget are preserved. Directional rim
  lighting adds one global light-direction vec2.
- Shader source loads share pending requests and successful results by path.
  Failed loads can be retried. Timestamp query parameters no longer prevent
  normal HTTP caching. Reload the page or use a new path to reload edited
  shader source within a running application.
- DOM geometry remains live on every frame, including scrolling, CSS
  transforms and direct changes to `getLens()`. Three.js render state is
  restored even if its render call throws.

The API, lens selection/overlap behaviour, 16-lens limit, and default optical
parameters are unchanged. There are no new production dependencies.

## Validation

`npm test` covers shared loads, independent paths, and retries after failure.
`npm run test:render` compares pixels against a frozen copy of the reference
renderer and shader, without external images or CDN requests.

The 78 image comparisons passed in Chromium with SwiftShader, exercising WebGL 1
and 2, DPR 1 and 2, Three.js 0.152.2, rounded shapes, turbulence, clear/frosted
mode changes, zero dispersion, overlaps, offscreen lenses, DOM movement,
mutable configurations, sharp patterns and alpha. The largest channel
difference was **1/255**; the worst mean absolute difference was **0.0169/255**.
Additional assertions check GL state restoration, Three.js restoration after
an error, and the reduction from 48 to 3 lens-uniform upload calls.

## Measured performance

The [raw measurements](performance-benchmark.json) were collected on the VM
using Chromium's **SwiftShader software renderer**, at 640 × 400. Each result
is the median of five alternating reference/current batches of two frames.
A full `readPixels` at the end of each batch ensures work has completed;
timings include readback and driver overhead. They are not display FPS and
do not predict performance on a physical GPU.

| Scene                                | Reference (ms/frame) | Optimized (ms/frame) | Ratio |
| ------------------------------------ | -------------------: | -------------------: | ----: |
| Three blurred lenses with dispersion |               326.85 |               320.10 | 1.02× |
| Blur without dispersion              |               424.65 |               254.70 | 1.67× |
| Sixteen blurred lenses               |               766.70 |               725.80 | 1.06× |
| Clear glass, no frosted blur         |                92.00 |                73.65 | 1.25× |

The substantial measured gains are approximately **40% less time** for the
achromatic blur case and **20% less time** for clear glass. The smaller
differences in the other scenes should be treated as comparable performance
given the variation between samples. Physical GPU and Safari/Firefox timings
have not been measured.

## Reproduce

```sh
npm ci
npx playwright install chromium
npm test
npm run test:render
npm run benchmark
```

Use `WEBLG_SOFTWARE_GL=1` to request SwiftShader explicitly, and optionally
`CHROMIUM_PATH=/absolute/path/to/chrome` for an existing browser. Run
`node scripts/verify-rendering.mjs --benchmark-only` to time rendering without
repeating image comparisons, or add `--verbose` to see individual comparisons.

## Stage composition

Clear glass uses zero frosted blur and transparent CSS surfaces, including the
slider/switch faces and selection capsules. Explicit tint, prominent blue
actions, and opaque accessibility mode use intentional fills.

The stage caches each active compositing pass. Movement invalidates the old and
new bounds; changes propagate through the refraction and blur sampling footprint
of upper layers. Scissor rectangles restrict expensive glass shading, and dirty
regions are first restored from the preceding layer to erase old silhouettes.
One inexpensive full-screen copy presents the result because the default
framebuffer is not preserved. The cache has a configurable target/byte budget;
eviction reuses framebuffer allocations and fully invalidates reused contents.

One shared core renderer consumes premeasured rectangles. Its managed-context
path performs no GL state readbacks; the public raw renderer still restores
shared state by default. Pointer movement is coalesced into the optical RAF and
uses CSS transforms during the gesture. Background animation transforms its
existing GPU texture rather than repainting/uploading Canvas2D each frame.
Animation uses the browser's native RAF cadence, with no fixed frame-rate timer cap.

`npm run test:stage` compares the cached stage against a frozen copy of the
previous Studio compositor, including movement, overlaps, blur propagation,
translucent tracks, hiding/removal, resize, opaque/comparison modes, GPU backdrop
movement and bounded-cache eviction. It also runs a rotating-order benchmark
with completed GPU readback on a 360 × 540 framebuffer (240 × 360 CSS, DPR 1.5).

The representative small drag reduces shaded glass pixels from **972,000 to
7,921 per frame** (99.2%), actual optical/underlay passes from six to one, and
`getParameter` state reads from 30 to zero. Copy/presentation work remains and
is reported separately. These counts do not depend on the VM's speed.

Completed-frame timings are recorded in `performance-studio-benchmark.json`.
They use Chromium/SwiftShader on the shared VM, include readback, and are not
physical-device measurements or display FPS. A 120 Hz refresh rate requires
a frame budget of 8.33 ms and validation on physical hardware. The demo
provides a local device check for frame cadence and CPU submission time.
