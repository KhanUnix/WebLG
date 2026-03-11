import {
    Vector2, Vector4,
    RawShaderMaterial, BufferGeometry, BufferAttribute,
    Mesh, Scene, Camera,
} from 'three';
import { LENS_DEFAULTS, MAX_LENSES, loadShaders, getDefaultShadersPath } from './shaders.js';

const _size = new Vector2();

/**
 * Three.js adapter for the Liquid Glass effect.
 * Uses RawShaderMaterial internally — no raw GL calls needed.
 *
 * Usage:
 *   const weblg = await WebLGThree.create(renderer, { shadersPath: '../src/shaders/' });
 */
export class WebLGThree {
    /**
     * Async factory — loads shaders then returns a ready-to-use instance.
     * @param {THREE.WebGLRenderer} renderer
     * @param {object} [options]
     * @param {string} [options.shadersPath]  Path to the shaders/ folder
     */
    static async create(renderer, options = {}) {
        const shadersPath = options.shadersPath ?? getDefaultShadersPath();
        const { vertexShader, fragmentShader } = await loadShaders(shadersPath);
        return new WebLGThree(renderer, vertexShader, fragmentShader);
    }

    constructor(renderer, vertexShader, fragmentShader) {
        this._renderer = renderer;
        this._lenses = new Map();
        this._nextId = 0;

        this._material = new RawShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms: {
                tMap:         { value: null },
                uResolution:  { value: new Vector2() },
                uTime:        { value: 0 },
                uLensCount:   { value: 0 },
                uLensRects:   { value: Array.from({ length: MAX_LENSES }, () => new Vector4()) },
                uLensParams0: { value: Array.from({ length: MAX_LENSES }, () => new Vector4(10, 20, 3, 5)) },
                uLensParams1: { value: Array.from({ length: MAX_LENSES }, () => new Vector4(0.7, 0, 0, 0)) },
            },
            depthTest: false,
            depthWrite: false,
        });

        const geo = new BufferGeometry();
        geo.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 3, -1, -1, 3]), 2));
        geo.setAttribute('uv',       new BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));

        this._mesh = new Mesh(geo, this._material);
        this._mesh.frustumCulled = false;

        this._scene = new Scene();
        this._scene.add(this._mesh);
        this._camera = new Camera();
    }

    // ── Public API ──────────────────────────────────────────

    setBackground(texture) {
        this._material.uniforms.tMap.value = texture;
    }

    addLens(config = {}) {
        const hasCustomId = config.id !== undefined;
        const id = hasCustomId ? config.id : this._allocateLensId();
        if (this._lenses.has(id)) {
            throw new Error(`WebLGThree lens id "${id}" already exists.`);
        }
        if (hasCustomId && Number.isInteger(id) && id >= this._nextId) {
            this._nextId = id + 1;
        }
        this._lenses.set(id, { ...LENS_DEFAULTS, ...config, id });
        return id;
    }

    updateLens(id, config) {
        const lens = this._lenses.get(id);
        if (lens) Object.assign(lens, config);
    }

    removeLens(id) {
        this._lenses.delete(id);
    }

    getLens(id) {
        return this._lenses.get(id);
    }

    get lensCount() {
        return this._lenses.size;
    }

    render(time = 0) {
        const renderer = this._renderer;
        const canvas = renderer.domElement;
        const canvasRect = canvas && typeof canvas.getBoundingClientRect === 'function'
            ? canvas.getBoundingClientRect()
            : null;
        renderer.getSize(_size);
        const dpr  = renderer.getPixelRatio();
        const cssW = canvasRect ? canvasRect.width : _size.x;
        const cssH = canvasRect ? canvasRect.height : _size.y;
        const pixW = cssW * dpr;
        const pixH = cssH * dpr;

        const u = this._material.uniforms;
        u.uResolution.value.set(pixW, pixH);
        u.uTime.value = time;

        let idx = 0;
        for (const [, lens] of this._lenses) {
            if (idx >= MAX_LENSES) break;

            let x, y, w, h;
            if (lens.element) {
                const r = lens.element.getBoundingClientRect();
                const left = canvasRect ? canvasRect.left : 0;
                const bottom = canvasRect ? canvasRect.bottom : cssH;
                x = (r.left - left) * dpr;
                y = (bottom - r.bottom) * dpr;
                w = r.width  * dpr;
                h = r.height * dpr;
            } else if (lens.rect) {
                x = lens.rect.x      * dpr;
                y = (cssH - lens.rect.y - lens.rect.height) * dpr;
                w = lens.rect.width   * dpr;
                h = lens.rect.height  * dpr;
            } else {
                x = y = w = h = 0;
            }

            u.uLensRects.value[idx].set(x, y, w, h);
            u.uLensParams0.value[idx].set(
                lens.smoothness, lens.edgeSpread, lens.frosted, lens.pinch);
            u.uLensParams1.value[idx].set(
                lens.chroma, lens.turbulence, lens.liquidity, 0);
            idx++;
        }
        u.uLensCount.value = idx;

        const prevRT        = renderer.getRenderTarget();
        const prevAutoClear = renderer.autoClear;
        renderer.autoClear  = false;
        renderer.setRenderTarget(null);
        renderer.render(this._scene, this._camera);
        renderer.setRenderTarget(prevRT);
        renderer.autoClear = prevAutoClear;
    }

    dispose() {
        this._material.dispose();
        this._mesh.geometry.dispose();
        this._lenses.clear();
    }

    // ── Internal ────────────────────────────────────────────

    _allocateLensId() {
        let id = this._nextId;
        while (this._lenses.has(id)) id++;
        this._nextId = id + 1;
        return id;
    }
}
