import {
    Vector2,
    RawShaderMaterial, BufferGeometry, BufferAttribute,
    Mesh, Scene, Camera,
} from 'three';
import { LENS_DEFAULTS, MAX_LENSES, loadShaders, getDefaultShadersPath } from './shaders.js';
import { createLensUniforms, writeLensUniforms } from './lens-uniforms.js';

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
        this._lensUniforms = createLensUniforms();
        this._clearMaterial = null;

        this._material = new RawShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms: {
                tMap:         { value: null },
                uResolution:  { value: new Vector2() },
                uTime:        { value: 0 },
                uLightDirection: { value: new Vector2(-Math.SQRT1_2, Math.SQRT1_2) },
                uLensCount:   { value: 0 },
                uLensRects:   { value: this._lensUniforms.rects },
                uLensParams0: { value: this._lensUniforms.params0 },
                uLensParams1: { value: this._lensUniforms.params1 },
            },
            depthTest: false,
            depthWrite: false,
        });

        const geo = new BufferGeometry();
        // Three.js computes geometry bounds as 3D positions, even though this
        // fullscreen shader only consumes x/y. Supply z=0 to keep them finite.
        geo.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
        geo.setAttribute('uv',       new BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));

        this._mesh = new Mesh(geo, this._material);
        this._mesh.frustumCulled = false;

        this._scene = new Scene();
        this._scene.add(this._mesh);
        this._camera = new Camera();
    }

    // ── Public API ──────────────────────────────────────────

    setLightAngle(degrees = 135) {
        const angle = degrees * Math.PI / 180;
        this._material.uniforms.uLightDirection.value.set(Math.cos(angle), Math.sin(angle));
    }

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
        if (!canvasRect) renderer.getSize(_size);
        const dpr  = renderer.getPixelRatio();
        const cssW = canvasRect ? canvasRect.width : _size.x;
        const cssH = canvasRect ? canvasRect.height : _size.y;
        const pixW = cssW * dpr;
        const pixH = cssH * dpr;

        const u = this._material.uniforms;
        u.uResolution.value.set(pixW, pixH);
        u.uTime.value = time;

        let idx = 0;
        let clearOnly = true;
        for (const lens of this._lenses.values()) {
            if (idx >= MAX_LENSES) break;
            writeLensUniforms(this._lensUniforms, idx, lens, dpr, cssH, canvasRect);
            if (!(lens.frosted <= 0.01)) clearOnly = false;
            idx++;
        }
        u.uLensCount.value = idx;
        if (idx > 0 && clearOnly) {
            if (!this._clearMaterial) {
                this._clearMaterial = this._material.clone();
                this._clearMaterial.uniforms = this._material.uniforms;
                this._clearMaterial.defines = { ...this._material.defines, WEBLG_CLEAR_ONLY: 1 };
            }
            this._mesh.material = this._clearMaterial;
        } else {
            this._mesh.material = this._material;
        }

        const prevRT        = renderer.getRenderTarget();
        const prevAutoClear = renderer.autoClear;
        renderer.autoClear  = false;
        renderer.setRenderTarget(null);
        try {
            renderer.render(this._scene, this._camera);
        } finally {
            renderer.setRenderTarget(prevRT);
            renderer.autoClear = prevAutoClear;
        }
    }

    dispose() {
        this._material.dispose();
        this._clearMaterial?.dispose();
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
