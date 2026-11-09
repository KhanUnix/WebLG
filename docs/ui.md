# WebLG UI and Material Studio

WebLG provides a renderer, an optional layered stage, and a native HTML
component library through independent entry points.

Material Studio starts with the original demo settings from commit `853a0ab`.
Its `Original` profile restores Main, Circle,
and Pill independently; the core library defaults and the other optical presets
remain independent. `Default config` restores the selected component's original
profile, and resetting the scene restores all original profiles.

The floating panel in the Components view uses Main's optical defaults with
Corner Radius (`smoothness`) set to **3.8**. Its `Default config`
and scene reset actions restore 3.8. The free Main rectangle remains at 10.
The demo, its documentation dialog, notifications and accessible names use English.

| Parameter                     |  Main | Circle | Pill | Inspector range |
| ----------------------------- | ----: | -----: | ---: | --------------- |
| Corner Radius (`smoothness`)  |    10 |     20 |   10 | 0–20            |
| Thickness (px) (`edgeSpread`) | 15.22 |     20 |   20 | 0–200           |
| Blur (`frosted`)              |  17.4 |      3 |    3 | 0–50            |
| Border Pinch (`pinch`)        |  10.8 |      5 |    5 | 0–30            |
| Chroma (`chroma`)             |     2 |    0.7 |  0.7 | 0–2             |
| turbulence                    |     0 |      0 |    0 | 0–20            |
| liquidity                     |     0 |      0 |    0 | 0–1             |

The first five controls use their original labels and order. `Liquid Animation`
contains the original turbulence/liquidity controls. New rim and light
options live in the separate advanced section. The `Clear` preset still
has zero blur and no CSS coating; `Original` intentionally restores the older
blur and chromatic/refraction values without adding a white fill.

For the stage, explicit `borderRadius: null` selects the original shader shape
controlled by `smoothness`. An omitted radius follows the element's CSS; a
numeric radius explicitly updates that CSS radius. The demo exposes only the
original Corner Radius control; configuration export preserves its null radius.
CSS shadows and focus outlines follow the legacy shape's diagonal inset
automatically when its size or smoothness changes. CSS circular arcs approximate
the squircle; the precise visible optical contour is rendered by the GPU.

The stage enables analytic edge antialiasing by default, covering a 1.5-render-pixel
band around the signed-distance boundary. This removes the hard inside/outside
cutoff at curved edges without increasing framebuffer resolution or adding a
render pass. It works in WebGL 1 and 2 without derivative extensions. Raw WebLG
callers can opt in with `{ antialiasEdges: true }`; their default stays unchanged.
`WebLGStage.create(host, { antialiasEdges: false })` disables it for comparison.

| Import         | Purpose                                  | Runtime dependency |
| -------------- | ---------------------------------------- | ------------------ |
| `weblg/core`   | `WebLG`, raw WebGL renderer              | None               |
| `weblg/three`  | `WebLGThree`, Three.js adapter           | Three.js           |
| `weblg/stage`  | `WebLGStage`, backdrop + GPU composition | None               |
| `weblg/ui`     | `WebLGUI`, native controls               | None               |
| `weblg/ui.css` | Explicit, scoped component styles        | None               |

Use the subpath imports to avoid requiring Three.js in a framework-free app.
Styles are not injected into the host document automatically.

The UI defaults to a light appearance. Opt into its separate dark palette with
`host.dataset.wlgTheme = 'dark'`; remove the attribute or use `'light'` to return
to light. Appearance does not change the optical material. Material Studio exposes
an explicit Light/Dark selector, remembers that choice locally, and starts light
on a first visit even when the operating system prefers dark.

Clear glass has `frosted: 0` and transparent CSS surfaces in both appearances:
there is no white/dark coating over its pixels. The directional rim remains an
edge reflection. Prominent actions and the explicitly tinted material retain
their intentional colours. Reduced-transparency mode remains opaque.

The stage caches optical layers and updates framebuffer damage regions. Its
default cache budget is eight layer targets or 32 MiB, whichever is smaller,
with a minimum of two targets for safe composition. `maxCachedLayers` and
`maxCacheBytes` configure that budget at construction. Targets are released on
resize, context replacement, view changes and destruction.

`stage.setBackgroundTransform(scale, x, y)` animates a static painter bitmap on
the GPU (normalized texture offsets); call without arguments to reset it. It
does not repaint or upload the bitmap. `invalidateBackground()` still repaints
when the image or actual painter content changes.

`stage.stats` exposes `totalPasses`, actual `passes`, `cacheHits`, `shadedPixels`,
`copiedPixels`, `backgroundUploads`, and `cpuMs` (CPU submission, not GPU time).
The demo's optional device check measures idle callback cadence, moving-scene
cadence, frame intervals and CPU submission P95 on the user's own device.
It does not certify a display refresh rate or infer GPU timing from CPU timing.

Decor animation starts only through its switch. An explicit Play request works
even with reduced motion enabled; glass turbulence and automatic animations still
respect that preference. Changing the system preference to reduced motion stops
an active decor animation, and hiding the page pauses it. The inline switch
description reports whether the decor is moving or stopped. Its visible pan
uses only the cached GPU bitmap, with a short ramp and no per-frame uploads.

The raw renderer restores shared GL state by default. `preserveState: false`
is reserved for a context wholly owned by the caller; the stage uses this path
internally to avoid synchronous GL state queries between its own passes.

The demo's Exploration view contains three independently draggable glass surfaces
(disc, capsule, rectangle). Drag each surface directly within the scene, or focus
it and use Arrow keys, Shift+Arrow for precision, and Home to recenter. The optical
layers follow the moving DOM rectangles; overlapping surfaces retain their layer
order. Components switches to the functional control panel. Both views share the
same backgrounds and inspector. Reposition restores the layout without changing
materials, and all drag listeners/observers are disposed on page teardown.

## First control

Give the host an actual size and `position: relative`. The stage owns the
canvases it inserts into that host, while your application owns the controls.

```js
import { WebLGStage } from 'weblg/stage';
import { WebLGUI } from 'weblg/ui';
import 'weblg/ui.css';

const host = document.querySelector('.scene');
const stage = await WebLGStage.create(host);
const ui = new WebLGUI(stage);

const image = new Image();
image.src = '/landscape.jpg';
await image.decode();
stage.setPainter((ctx, width, height) => {
    ctx.drawImage(image, 0, 0, width, height);
});

const button = ui.button({
    label: 'Continue',
    prominent: true,
    onClick: () => continueFlow(),
});
host.append(button.element);

// Dispose the controls before disposing their stage.
// ui.destroy();
// stage.destroy();
```

## Controls

Each factory returns `{ element, surface, destroy }`. `surface.update(patch)`
changes optical parameters; `surface.element` is the element drawn as glass.
The host can style geometry in normal CSS. Text stays in native HTML.

| Factory                                              | Options and behaviour                                                                                                                                                                                                                                          |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui.button(options)`                                 | `label`, `ariaLabel`, SVG `icon`, `prominent`, `disabled`, `glass`, `onClick`. Native button semantics; `setDisabled(bool)`.                                                                                                                                   |
| `ui.switch(options)`                                 | Required `label`, `checked`, `disabled`, `onChange(bool)`. Native checkbox with switch semantics, keyboard operation, click and drag. `input`, `value`, `setValue(bool, emit=false)`.                                                                          |
| `ui.slider(options)`                                 | Required `label`, `value`, `min`, `max`, `step`, `disabled`, `onChange(number)`. Native range input, keyboard and touch support. `input`, `value`, `setValue(number, emit=false)`.                                                                             |
| `ui.segmentedControl(options)`                       | `label`, `items: [{ value, label }]`, `value`, `onChange(value)`. Radio-group semantics, one tab stop, Arrow/Home/End selection, pointer dragging. `value`, `setValue(value, emit=false)`.                                                                     |
| `ui.tabs(options)`                                   | The same options, with tab semantics and optional `panelId`. The host supplies and updates the associated panel content.                                                                                                                                       |
| `ui.menu(options)`                                   | `label`, SVG `icon`, `items: [{ label, onSelect, disabled }, 'separator']`. Collision-constrained menu inside the stage, keyboard navigation, Escape, outside-click dismissal, and focus restoration. `panel`, `open(focus=true)`, `close(restoreFocus=true)`. |
| `ui.surface(element, options)`                       | Binds any native panel, toolbar or other functional element to the stage. Returns a surface record.                                                                                                                                                            |
| `ui.draggable(element, handle, { padding, bottom })` | Bounded pointer movement, Arrow keys, Shift+Arrow fine movement, Home to recenter. Returns `{ recenter, destroy }`. Supply a focusable, labelled handle.                                                                                                       |

Use `ui.setMaterial('clear'|'satin'|'frosted'|'tinted')` for shared optical
presets. The fill remains in CSS, so the host can supply semantic colours and
readable labels independently of refraction.

## Optical additions

Both `WebLG` and `WebLGThree` accept the following lens options in addition to
the original options:

| Option         | Default | Meaning                                                                                                      |
| -------------- | ------- | ------------------------------------------------------------------------------------------------------------ |
| `borderRadius` | `null`  | Explicit CSS-pixel corner radius, including zero. Omit it to retain legacy smoothness and automatic circles. |
| `rim`          | `0`     | White edge reflection strength, from 0 to 1. Zero preserves the previous rendering.                          |
| `rimWidth`     | `1.25`  | Reflection width in CSS pixels. Packed at eighth-device-pixel precision.                                     |

`renderer.setLightAngle(degrees)` sets the directional light: 0 points right,
90 up, 180 left, 270 down. The default is 135. The back-facing reflection is
weaker than the front-facing light. The edge treatment adds no texture sample
or pass to the core renderer. Its settings use the previously unused float in
each lens's uniforms, plus one global `vec2` for light direction.

## Layers and backgrounds

`stage.register(element, { layer, ...opticalOptions })` returns
`{ id, element, config, update(patch), remove() }`. The stage reads native DOM
geometry live and uses the element's actual CSS radius. An explicit
`borderRadius` in `register` or `update` also sets that CSS radius.

A lower-numbered layer is rendered first. Each next layer samples the previous
GPU texture using cached framebuffer targets within the configured budget.
Track underlays can be
painted between layers, so a slider thumb can refract its track and a control
can refract the glass underneath it. The DOM is never screenshotted or read
back into a canvas. HTML labels remain sharp and are not themselves refracted.

The original core still supports 16 lenses per pass. The stage batches larger
layers in chunks of 16, rendering successive batches in order. Keep surfaces
few and small; layers and extra batches add work. The original nearest-SDF
selection remains within each batch; put overlapping surfaces in distinct
layers when one must appear above another.

`stage.registerUnderlay(() => [{ x, y, width, height, radius, colour }], layer)`
adds rounded primitives before that glass layer. Coordinates are stage-relative
CSS pixels, and colour is an RGBA array with values from 0 to 1. It returns an
unregister function. `stage.rect(element)` gives a matching rectangle.

Update a Canvas2D background with `setPainter(callback)` and
`invalidateBackground()`. For continuous backgrounds, let the application
request updates as needed. `invalidate()` schedules a single render; `follow(ms)`
tracks DOM transitions briefly. There is no continuous idle render loop.
The default pixel ratio is capped at 1.5 and the stage caps its backing image
at 1.4 million pixels. Pass `pixelRatio` and `maxPixels` to change these limits.

Geometry is an axis-aligned DOM bounding rectangle with a CSS corner radius
or the legacy smoothness-based shader contour. Arbitrary clip paths, per-corner elliptical radii, perspective and
rotated DOM surfaces are not modeled. Translations and uniform press scaling
are supported.

The raw renderer and Three.js adapter still accept native GPU textures directly
when no stage or UI library is wanted.

## Accessibility and failure modes

Controls use native HTML semantics and visible keyboard focus. Pointer effects
are subtle and do not replace normal activation. Scene movement has a keyboard
alternative. A vertical touch gesture remains available for page scrolling.

The stage and stylesheet respond to reduced motion, reduced transparency,
increased contrast and forced colours. Use `stage.setSolid(true)` to provide a
manual opaque mode where the browser does not expose a system preference.
`stage.setEffects(false)` is the comparison mode. System accessibility settings
continue to take precedence over decorative effects.

If WebGL or shader loading is unavailable, the stage displays its Canvas2D
background and the controls retain native interactions with CSS glass where
supported. The demo calls this “Compatibility mode”. It does not pretend the
optical shader is still active. A lost GPU context switches to that mode and a
restored context rebuilds GPU resources.

The stage's `mode`, `stats`, and `wlgrender` event support diagnostics. Its stats
count intermediate layer passes (the final copy is separate), not GPU timings.
Call `destroy()` when unmounting the view to release observers, listeners,
textures, framebuffers, programs and animation frames.

## Demo assets

The landscape photograph is bundled locally. Source:
<https://images.unsplash.com/photo-1472214103451-9374bd1c798e>.
The texture, geometric scene, mixed scene, logo and icons are authored assets.
Images selected or dropped by the visitor stay in their browser; they are not
uploaded or retained on the server.
