import { LENS_DEFAULTS, MAX_LENSES, loadShaders, getDefaultShadersPath } from './shaders.js';

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
        this.gl = gl;
        this._lenses = new Map();
        this._nextId = 0;
        this._width = gl.canvas.width;
        this._height = gl.canvas.height;
        this._dpr = options.dpr ?? (typeof window !== 'undefined' ? Math.min(window.devicePixelRatio, 2) : 1);
        this._bgTexture = null;

        this._compileProgram(vertexShader, fragmentShader);
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
            uLensCount:  loc('uLensCount'),
            rects:   Array.from({ length: MAX_LENSES }, (_, i) => loc(`uLensRects[${i}]`)),
            params0: Array.from({ length: MAX_LENSES }, (_, i) => loc(`uLensParams0[${i}]`)),
            params1: Array.from({ length: MAX_LENSES }, (_, i) => loc(`uLensParams1[${i}]`)),
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

    render(time = 0) {
        if (!this._bgTexture) return;

        const gl  = this.gl;
        const dpr = this._dpr;
        const canvasRect = this._getCanvasRect();
        const cssH = canvasRect ? canvasRect.height : (this._height / dpr);

        const prev = {
            program:   gl.getParameter(gl.CURRENT_PROGRAM),
            blend:     gl.isEnabled(gl.BLEND),
            depthTest: gl.isEnabled(gl.DEPTH_TEST),
            cullFace:  gl.isEnabled(gl.CULL_FACE),
            viewport:  gl.getParameter(gl.VIEWPORT),
            arrayBuffer: gl.getParameter(gl.ARRAY_BUFFER_BINDING),
            activeTexture: gl.getParameter(gl.ACTIVE_TEXTURE),
            tex0Binding2D: this._getTextureBinding(gl.TEXTURE0),
        };
        const prevActiveBinding2D = prev.activeTexture !== gl.TEXTURE0
            ? this._getTextureBinding(prev.activeTexture)
            : prev.tex0Binding2D;
        const prevPosAttrib = this._captureVertexAttribState(this._aPos);
        const prevUvAttrib = this._captureVertexAttribState(this._aUv);

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

        let idx = 0;
        for (const [, lens] of this._lenses) {
            if (idx >= MAX_LENSES) break;
            const [x, y, w, h] = this._lensRect(lens, dpr, cssH, canvasRect);
            gl.uniform4f(this._u.rects[idx], x, y, w, h);
            gl.uniform4f(this._u.params0[idx], lens.smoothness, lens.edgeSpread, lens.frosted, lens.pinch);
            gl.uniform4f(this._u.params1[idx], lens.chroma, lens.turbulence, lens.liquidity, 0);
            idx++;
        }
        gl.uniform1i(this._u.uLensCount, idx);

        gl.bindBuffer(gl.ARRAY_BUFFER, this._posBuf);
        gl.enableVertexAttribArray(this._aPos);
        gl.vertexAttribPointer(this._aPos, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this._uvBuf);
        gl.enableVertexAttribArray(this._aUv);
        gl.vertexAttribPointer(this._aUv, 2, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.TRIANGLES, 0, 3);

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
        if (this._program) gl.deleteProgram(this._program);
        if (this._posBuf)  gl.deleteBuffer(this._posBuf);
        if (this._uvBuf)   gl.deleteBuffer(this._uvBuf);
        this._lenses.clear();
    }

    // ── Internal ────────────────────────────────────────────

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

    _lensRect(lens, dpr, cssH, canvasRect) {
        if (lens.element) {
            const r = lens.element.getBoundingClientRect();
            const left = canvasRect ? canvasRect.left : 0;
            const bottom = canvasRect ? canvasRect.bottom : cssH;
            return [(r.left - left) * dpr, (bottom - r.bottom) * dpr, r.width * dpr, r.height * dpr];
        }
        if (lens.rect) {
            const { x, y, width, height } = lens.rect;
            return [x * dpr, (cssH - y - height) * dpr, width * dpr, height * dpr];
        }
        return [0, 0, 0, 0];
    }
}
