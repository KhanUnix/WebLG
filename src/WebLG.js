import { LENS_DEFAULTS, MAX_LENSES, loadShaders, getDefaultShadersPath } from './shaders.js';
import { createLensUniforms, writeLensUniforms } from './lens-uniforms.js';

/**
 * Pure WebGL Liquid Glass renderer.
 * Works with any WebGLRenderingContext — no framework dependency.
 *
 * Usage:
 *   const weblg = await WebLG.create(gl, { shadersPath: './src/shaders/' });
 */
export class WebLG {
    /**
     * Async factory — loads shaders then returns a ready-to-use instance.
     */
    static async create(gl, options = {}) {
        const shadersPath = options.shadersPath ?? getDefaultShadersPath();
        const { vertexShader, fragmentShader } = await loadShaders(shadersPath);
        return new WebLG(gl, vertexShader, fragmentShader, options);
    }

    constructor(gl, vertexShader, fragmentShader, options = {}) {
        if (options.antialiasEdges) {
            fragmentShader = fragmentShader.replace(/^(\s*#version[^\n]*\n)?/, '$1#define WEBLG_EDGE_AA 1\n');
        }
        this.gl = gl;
        this._preserveState = options.preserveState !== false;
        this._lenses = new Map();
        this._nextId = 0;
        this._width = gl.canvas.width;
        this._height = gl.canvas.height;
        this._dpr = options.dpr ?? (typeof window !== 'undefined' ? Math.min(window.devicePixelRatio, 2) : 1);
        this._bgTexture = null;
        this.setLightAngle(options.lightAngle ?? 135);
        this._vertexShader = vertexShader;
        this._fragmentShader = fragmentShader;
        this._variants = new Map();
        this._lensUniforms = createLensUniforms();
        this._lensViews = Array.from({ length: MAX_LENSES + 1 }, (_, count) => ({
            rects: this._lensUniforms.rects.subarray(0, count * 4),
            params0: this._lensUniforms.params0.subarray(0, count * 4),
            params1: this._lensUniforms.params1.subarray(0, count * 4),
        }));

        this._compileProgram(vertexShader, fragmentShader);
        this._rememberVariant(false);
        this._createGeometry();
    }

    // ── Shader compilation ──────────────────────────────────

    _createShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const log = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error(`WebLG shader error:\n${log}`);
        }
        return shader;
    }

    _compileProgram(vertSrc, fragSrc) {
        const gl = this.gl;
        const vs = this._createShader(gl.VERTEX_SHADER, vertSrc);
        const fs = this._createShader(gl.FRAGMENT_SHADER, fragSrc);

        this._program = gl.createProgram();
        gl.attachShader(this._program, vs);
        gl.attachShader(this._program, fs);
        gl.linkProgram(this._program);

        if (!gl.getProgramParameter(this._program, gl.LINK_STATUS)) {
            throw new Error('WebLG link error:\n' + gl.getProgramInfoLog(this._program));
        }

        gl.deleteShader(vs);
        gl.deleteShader(fs);

        const loc = (name) => gl.getUniformLocation(this._program, name);
        this._u = {
            tMap:        loc('tMap'),
            uResolution: loc('uResolution'),
            uTime:       loc('uTime'),
            light:       loc('uLightDirection'),
            uLensCount:  loc('uLensCount'),
            rects:   loc('uLensRects[0]'),
            params0: loc('uLensParams0[0]'),
            params1: loc('uLensParams1[0]'),
        };

        this._aPos = gl.getAttribLocation(this._program, 'position');
        this._aUv  = gl.getAttribLocation(this._program, 'uv');
    }

    // ── Fullscreen triangle ─────────────────────────────────

    _createGeometry() {
        const gl = this.gl;

        this._posBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this._posBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

        this._uvBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this._uvBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 2, 0, 0, 2]), gl.STATIC_DRAW);
    }

    // ── Public API ──────────────────────────────────────────

    setLightAngle(degrees = 135) {
        const angle = degrees * Math.PI / 180;
        this._lightX = Math.cos(angle);
        this._lightY = Math.sin(angle);
    }

    setBackground(webglTexture) {
        this._bgTexture = webglTexture;
    }

    addLens(config = {}) {
        const hasCustomId = config.id !== undefined;
        const id = hasCustomId ? config.id : this._allocateLensId();
        if (this._lenses.has(id)) {
            throw new Error(`WebLG lens id "${id}" already exists.`);
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

    resize(pixelWidth, pixelHeight, dpr) {
        this._width = pixelWidth;
        this._height = pixelHeight;
        if (dpr !== undefined) this._dpr = dpr;
    }

    render(time = 0, canvasRect = this._getCanvasRect()) {
        if (!this._bgTexture) return;

        const gl  = this.gl;
        const dpr = this._dpr;
        const cssH = canvasRect ? canvasRect.height : (this._height / dpr);

        let idx = 0;
        let clearOnly = true;
        for (const lens of this._lenses.values()) {
            if (idx >= MAX_LENSES) break;
            writeLensUniforms(this._lensUniforms, idx, lens, dpr, cssH, canvasRect);
            if (!(lens.frosted <= 0.01)) clearOnly = false;
            idx++;
        }
        this._selectVariant(idx > 0 && clearOnly);

        const prev = this._preserveState ? {
            program:   gl.getParameter(gl.CURRENT_PROGRAM),
            blend:     gl.isEnabled(gl.BLEND),
            depthTest: gl.isEnabled(gl.DEPTH_TEST),
            cullFace:  gl.isEnabled(gl.CULL_FACE),
            viewport:  gl.getParameter(gl.VIEWPORT),
            arrayBuffer: gl.getParameter(gl.ARRAY_BUFFER_BINDING),
            activeTexture: gl.getParameter(gl.ACTIVE_TEXTURE),
            tex0Binding2D: this._getTextureBinding(gl.TEXTURE0),
        } : null;
        const prevActiveBinding2D = prev && prev.activeTexture !== gl.TEXTURE0
            ? this._getTextureBinding(prev.activeTexture)
            : prev?.tex0Binding2D;
        const prevPosAttrib = prev ? this._captureVertexAttribState(this._aPos) : null;
        const prevUvAttrib = prev ? this._captureVertexAttribState(this._aUv) : null;

        gl.useProgram(this._program);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.disable(gl.BLEND);
        gl.viewport(0, 0, this._width, this._height);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._bgTexture);
        gl.uniform1i(this._u.tMap, 0);

        gl.uniform2f(this._u.uResolution, this._width, this._height);
        gl.uniform1f(this._u.uTime, time);
        gl.uniform2f(this._u.light, this._lightX, this._lightY);

        if (idx > 0) {
            const view = this._lensViews[idx];
            gl.uniform4fv(this._u.rects, view.rects);
            gl.uniform4fv(this._u.params0, view.params0);
            gl.uniform4fv(this._u.params1, view.params1);
        }
        gl.uniform1i(this._u.uLensCount, idx);

        gl.bindBuffer(gl.ARRAY_BUFFER, this._posBuf);
        gl.enableVertexAttribArray(this._aPos);
        gl.vertexAttribPointer(this._aPos, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this._uvBuf);
        gl.enableVertexAttribArray(this._aUv);
        gl.vertexAttribPointer(this._aUv, 2, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.TRIANGLES, 0, 3);

        if (!prev) return;
        this._restoreVertexAttribState(prevUvAttrib);
        this._restoreVertexAttribState(prevPosAttrib);
        gl.bindBuffer(gl.ARRAY_BUFFER, prev.arrayBuffer);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, prev.tex0Binding2D);
        if (prev.activeTexture !== gl.TEXTURE0) {
            gl.activeTexture(prev.activeTexture);
            gl.bindTexture(gl.TEXTURE_2D, prevActiveBinding2D);
        } else {
            gl.activeTexture(prev.activeTexture);
        }
        gl.viewport(prev.viewport[0], prev.viewport[1], prev.viewport[2], prev.viewport[3]);
        gl.useProgram(prev.program);
        if (prev.blend)     gl.enable(gl.BLEND);     else gl.disable(gl.BLEND);
        if (prev.depthTest) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
        if (prev.cullFace)  gl.enable(gl.CULL_FACE);  else gl.disable(gl.CULL_FACE);
    }

    dispose() {
        const gl = this.gl;
        for (const variant of this._variants.values()) gl.deleteProgram(variant.program);
        this._variants.clear();
        if (this._posBuf)  gl.deleteBuffer(this._posBuf);
        if (this._uvBuf)   gl.deleteBuffer(this._uvBuf);
        this._lenses.clear();
    }

    // ── Internal ────────────────────────────────────────────

    _rememberVariant(clearOnly) {
        this._variants.set(clearOnly, {
            program: this._program, uniforms: this._u,
            position: this._aPos, uv: this._aUv,
        });
    }

    _selectVariant(clearOnly) {
        if (!this._variants.has(clearOnly)) {
            // Compile lazily once. No extra sampler/uniform budget, rendering
            // pass or API setting is needed for an entirely clear scene.
            const source = this._fragmentShader.replace(/^(\s*#version[^\n]*\n)?/, '$1#define WEBLG_CLEAR_ONLY 1\n');
            this._compileProgram(this._vertexShader, source);
            this._rememberVariant(clearOnly);
        }
        const variant = this._variants.get(clearOnly);
        this._program = variant.program;
        this._u = variant.uniforms;
        this._aPos = variant.position;
        this._aUv = variant.uv;
    }

    _allocateLensId() {
        let id = this._nextId;
        while (this._lenses.has(id)) id++;
        this._nextId = id + 1;
        return id;
    }

    _getCanvasRect() {
        const canvas = this.gl && this.gl.canvas;
        if (canvas && typeof canvas.getBoundingClientRect === 'function') {
            return canvas.getBoundingClientRect();
        }
        return null;
    }

    _getTextureBinding(textureUnit) {
        const gl = this.gl;
        const prevActive = gl.getParameter(gl.ACTIVE_TEXTURE);
        gl.activeTexture(textureUnit);
        const binding = gl.getParameter(gl.TEXTURE_BINDING_2D);
        gl.activeTexture(prevActive);
        return binding;
    }

    _captureVertexAttribState(index) {
        if (index < 0) return null;
        const gl = this.gl;
        return {
            index,
            enabled: gl.getVertexAttrib(index, gl.VERTEX_ATTRIB_ARRAY_ENABLED),
            size: gl.getVertexAttrib(index, gl.VERTEX_ATTRIB_ARRAY_SIZE),
            type: gl.getVertexAttrib(index, gl.VERTEX_ATTRIB_ARRAY_TYPE),
            normalized: gl.getVertexAttrib(index, gl.VERTEX_ATTRIB_ARRAY_NORMALIZED),
            stride: gl.getVertexAttrib(index, gl.VERTEX_ATTRIB_ARRAY_STRIDE),
            buffer: gl.getVertexAttrib(index, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING),
            pointer: gl.getVertexAttribOffset(index, gl.VERTEX_ATTRIB_ARRAY_POINTER),
        };
    }

    _restoreVertexAttribState(state) {
        if (!state) return;
        const gl = this.gl;
        if (state.buffer) {
            gl.bindBuffer(gl.ARRAY_BUFFER, state.buffer);
            gl.vertexAttribPointer(
                state.index,
                state.size,
                state.type,
                state.normalized,
                state.stride,
                state.pointer,
            );
        }
        if (state.enabled) gl.enableVertexAttribArray(state.index);
        else gl.disableVertexAttribArray(state.index);
    }

}
