# WebLG — Liquid Glass Effect Library

A WebGL-based "Liquid Glass" effect (Apple-style frosted glass). Creates glass lenses with blur, refraction, chromatic aberration and liquid animation over any content.

**Two flavors:**
- `WebLGThree` — native Three.js adapter (recommended)
- `WebLG` — pure WebGL core, zero dependencies (works with any GL context)

## Project Structure

```
src/
├── shaders/
│   ├── base.vert          Vertex shader
│   └── glass.frag         Fragment shader (SDF, blur, chroma, noise)
├── shaders.js             Constants, defaults, loadShaders()
├── WebLGThree.js          Three.js adapter (RawShaderMaterial)
├── WebLG.js               Pure WebGL core
└── index.js               Re-exports
```

## Installation

### Option A: Local dependency (recommended)

From your project root:

```bash
npm install /path/to/WebLG
```

Or add to your `package.json`:

```json
{
  "dependencies": {
    "weblg": "file:./path/to/WebLG"
  }
}
```

Then import and create (no `shadersPath` needed — resolved automatically via `import.meta.url`):

```javascript
import { WebLGThree } from 'weblg';

const weblg = await WebLGThree.create(renderer);
```

If your bundler or server does not expose the shaders, pass the path explicitly:

```javascript
const weblg = await WebLGThree.create(renderer, {
  shadersPath: '/node_modules/weblg/src/shaders/',
});
```

### Option B: Git clone + copy

```bash
git clone https://github.com/your-org/WebLG.git
cp -r WebLG/src ./lib/weblg
```

Then import from your project:

```javascript
import { WebLGThree } from './lib/weblg/WebLGThree.js';

const weblg = await WebLGThree.create(renderer);
```

The default `shadersPath` is resolved relative to the library (via `import.meta.url`), so it works as long as the `shaders/` folder sits next to the JS files.

### Option C: Git submodule

```bash
git submodule add https://github.com/your-org/WebLG.git lib/WebLG
```

Then use the same import pattern as Option B, pointing to `lib/WebLG/src/`.

### Run the demo

After cloning:

```bash
cd WebLG
npm run demo
```

Then open **http://localhost:4000/demo/** in your browser.

No npm dependencies — the library is zero-dependency. Pure ES modules.

## Three.js Integration (WebLGThree)

### How It Works

1. You render your 3D scene into a `WebGLRenderTarget` (not to screen)
2. WebLG reads that texture and draws the glass effect to screen (fullscreen quad)
3. HTML/CSS content (menus, UI) is positioned **on top** of the canvas, aligned with the lens areas

```
Three.js scene → RenderTarget (texture)
                        ↓
              WebLG (glass pass) → screen
                        ↓
              DOM (HTML/CSS/JS menus) on top
```

### Minimal Working Example

```html
<canvas id="canvas"></canvas>

<!-- HTML menu positioned over the lens -->
<div id="my-menu" style="position:fixed; top:100px; left:100px; width:400px; height:300px;">
    <h1>My Menu</h1>
    <button>Click me</button>
</div>

<script type="importmap">
{ "imports": { "three": "https://esm.sh/three@0.170.0" } }
</script>

<script type="module">
import * as THREE from 'three';
import { WebLGThree } from './src/WebLGThree.js';

// 1. Three.js setup
const canvas = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100);
camera.position.z = 5;

// ... add objects, lights, etc.

// 2. RenderTarget (the texture the glass will distort)
const rt = new THREE.WebGLRenderTarget(
    innerWidth * renderer.getPixelRatio(),
    innerHeight * renderer.getPixelRatio()
);

// 3. Create WebLG (async — loads shaders from files)
const weblg = await WebLGThree.create(renderer);
weblg.setBackground(rt.texture);

// 4. Add a lens bound to a DOM element
const lensId = weblg.addLens({
    element: document.getElementById('my-menu'),
    smoothness: 10.0,
    edgeSpread: 20.0,
    frosted: 3.0,
    pinch: 5.0,
    chroma: 0.7,
});

// 5. Render loop
function animate(t) {
    const time = t * 0.001;

    // Render 3D scene into the RenderTarget
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);

    // Glass compositing pass → screen
    weblg.render(time);

    requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

// 6. Handle resize
window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    rt.setSize(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio());
});
</script>
```

## API Reference

### `WebLGThree.create(renderer, options)` → `Promise<WebLGThree>`

Async factory. Loads shaders from disk and returns a ready-to-use instance.

| Parameter | Type | Description |
|---|---|---|
| `renderer` | `THREE.WebGLRenderer` | Your Three.js renderer |
| `options.shadersPath` | `string` | Path to the folder containing `base.vert` and `glass.frag`. Default: `'./shaders/'` |

### `setBackground(texture)`

Sets the background texture (what the glass distorts/blurs).

| Parameter | Type | Description |
|---|---|---|
| `texture` | `THREE.Texture` | Typically `renderTarget.texture` |

### `addLens(config)` → `number`

Adds a lens. Returns its `id` (used for update/remove). Up to 16 lenses.

| Property | Type | Default | Description |
|---|---|---|---|
| `element` | `HTMLElement` | `null` | DOM element — the lens automatically follows its `getBoundingClientRect()` every frame |
| `rect` | `{x, y, width, height}` | `null` | Manual position in CSS pixels (x,y = top-left corner). Ignored if `element` is set |
| `smoothness` | `number` | `10.0` | Corner radius (0 = sharp, 20 = very rounded). When width ≈ height, automatically becomes a perfect circle |
| `edgeSpread` | `number` | `20.0` | Border thickness in pixels (refraction/pinch zone) |
| `frosted` | `number` | `3.0` | Blur intensity (0 = transparent, 50 = very blurry) |
| `pinch` | `number` | `5.0` | Refraction/compression strength on the border |
| `chroma` | `number` | `0.7` | Chromatic aberration (R/G/B separation on the border) |
| `turbulence` | `number` | `0.0` | Turbulent border deformation (0 = off) |
| `liquidity` | `number` | `0.0` | Liquid animation speed (requires turbulence > 0) |

### `updateLens(id, config)`

Updates parameters of an existing lens. Accepts a partial object.

```javascript
weblg.updateLens(lensId, { frosted: 8.0, chroma: 1.5 });
```

### `removeLens(id)`

Removes a lens.

### `getLens(id)` → `object | undefined`

Returns the full config of a lens.

### `render(time)`

Draws the glass pass to screen. Call every frame after your scene render.

| Parameter | Type | Description |
|---|---|---|
| `time` | `number` | Time in seconds (drives liquid animation) |

### `dispose()`

Releases GPU resources (material, geometry).

## Pure WebGL Integration (WebLG)

For projects without Three.js (Babylon.js, PlayCanvas, raw WebGL, etc.):

```javascript
import { WebLG } from './src/WebLG.js';

const canvas = document.getElementById('canvas');
const gl = canvas.getContext('webgl');

const weblg = await WebLG.create(gl, {
    dpr: Math.min(devicePixelRatio, 2),
});

weblg.setBackground(myWebGLTexture);  // raw WebGLTexture
weblg.addLens({ rect: { x: 100, y: 50, width: 400, height: 300 } });
weblg.resize(canvas.width, canvas.height, dpr);
weblg.render(timeInSeconds);
```

## Shader Internals

The fragment shader (`glass.frag`) works in screen-space:

1. **SDF loop** — For each pixel, computes the signed distance to every lens (rounded rectangles via `sdRoundRect`). Finds the closest lens.
2. **Outside all lenses** (`distance > 0`) — Passthrough: renders the background as-is.
3. **Lens center** (`distance > edgeSpread`) — Applies frosted blur (golden spiral, 32 dithered samples).
4. **Lens border** (`distance ≤ edgeSpread`) — Applies frosted blur + displacement (pinch) + chromatic aberration + optional turbulence.

The blur is uniform across the entire lens surface — the background appears as if viewed through frosted glass. The blur uses a golden-angle spiral with 32 samples and per-pixel dithering noise to avoid visible patterns.

## Technical Notes

- Lens coordinates use **CSS pixels**. DPR conversion is automatic.
- When `element` is provided, `getBoundingClientRect()` is read every `render()` call — lenses automatically follow DOM elements (drag, scroll, resize).
- The shader supports up to **16 simultaneous lenses** (uniform arrays).
- Nearly-square rectangles (`|width - height| < 5px`) automatically become **perfect circles**.
- `shadersPath` must point to a folder accessible via `fetch()` containing `base.vert` and `glass.frag`.
- GL state is saved/restored in the pure WebGL version. The Three.js adapter handles state through `renderer.autoClear` and render target management.
