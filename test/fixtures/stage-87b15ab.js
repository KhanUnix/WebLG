import { WebLG } from '../../src/WebLG.js';
import { GLASS_PRESETS, loadShaders, MAX_LENSES } from '../../src/shaders.js';

const VERTEX = `attribute vec2 position; varying vec2 vUv;
void main(){ vUv=position*0.5+0.5; gl_Position=vec4(position,0.,1.); }`;
const COPY = `precision highp float; varying vec2 vUv; uniform sampler2D source;
void main(){ gl_FragColor=texture2D(source,vUv); }`;
const SHAPE = `precision highp float; uniform vec4 rect; uniform vec4 colour; uniform float radius;
void main(){ vec2 p=abs(gl_FragCoord.xy-rect.xy-rect.zw*0.5)-rect.zw*0.5+radius;
float d=length(max(p,0.))+min(max(p.x,p.y),0.)-radius;
float a=colour.a*(1.-smoothstep(-0.65,0.65,d)); gl_FragColor=vec4(colour.rgb*a,a); }`;

function program(gl, fragment) {
    const shaders = [gl.VERTEX_SHADER, gl.FRAGMENT_SHADER].map((type, i) => {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, i ? fragment : VERTEX);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
            throw new Error(gl.getShaderInfoLog(shader));
        return shader;
    });
    const result = gl.createProgram();
    shaders.forEach((shader) => gl.attachShader(result, shader));
    gl.linkProgram(result);
    shaders.forEach((shader) => gl.deleteShader(shader));
    if (!gl.getProgramParameter(result, gl.LINK_STATUS))
        throw new Error(gl.getProgramInfoLog(result));
    return result;
}

/** A self-contained WebGL stage. Each optical layer samples the previous layer
 * on the GPU; the DOM retains text, native semantics and all event handling.
 * Canvas2D painters supply the background; no DOM screenshot is performed. */
export class WebLGStage {
    static async create(host, options = {}) {
        if (!(host instanceof HTMLElement)) throw new TypeError('WebLGStage needs a host element.');
        let shaders;
        try {
            shaders = await loadShaders(options.shadersPath);
        } catch (error) {
            options.onError?.(error);
        }
        return new WebLGStage(host, shaders, options);
    }

    constructor(host, shaders, options) {
        this.host = host;
        this.options = options;
        this.shaders = shaders;
        this.surfaces = new Map();
        this.underlays = new Set();
        this.renderers = new Map();
        this.targets = [];
        this.sequence = 0;
        this.effects = true;
        this.solid = false;
        this.lightAngle = 135;
        this.frame = 0;
        this.followUntil = 0;
        this.stats = { surfaces: 0, passes: 0, pixelRatio: 1 };
        this.events = new AbortController();
        this.canvas = document.createElement('canvas');
        this.background = document.createElement('canvas');
        for (const canvas of [this.background, this.canvas]) {
            canvas.className = 'wlg-stage-canvas';
            canvas.setAttribute('aria-hidden', 'true');
            canvas.style.cssText =
                'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
        }
        host.prepend(this.background, this.canvas);
        this.context = this.background.getContext('2d');
        this.motion = matchMedia('(prefers-reduced-motion: reduce)');
        this.transparency = matchMedia('(prefers-reduced-transparency: reduce)');
        this.contrast = matchMedia('(prefers-contrast: more)');
        this.forced = matchMedia('(forced-colors: active)');
        this.preferenceChanged = () => {
            this.applyPreferences();
            this.invalidate();
        };
        [this.motion, this.transparency, this.contrast, this.forced].forEach((query) =>
            query.addEventListener('change', this.preferenceChanged),
        );
        this.canvas.addEventListener(
            'webglcontextlost',
            (event) => {
                event.preventDefault();
                this.mode = 'fallback';
                this.applyPreferences();
                this.options.onStatus?.('fallback');
            },
            { signal: this.events.signal },
        );
        this.canvas.addEventListener(
            'webglcontextrestored',
            () => {
                this.renderers.clear();
                this.targets = [];
                try {
                    this.initGPU();
                } catch (error) {
                    this.options.onError?.(error);
                    this.mode = 'fallback';
                }
                this.applyPreferences();
                this.options.onStatus?.(this.mode);
                this.invalidate();
            },
            { signal: this.events.signal },
        );
        this.mode = 'fallback';
        if (shaders) {
            const attributes = {
                alpha: false,
                antialias: false,
                depth: false,
                stencil: false,
                powerPreference: 'high-performance',
            };
            this.gl =
                this.canvas.getContext('webgl2', attributes) ||
                this.canvas.getContext('webgl', attributes);
            if (this.gl) {
                try {
                    this.initGPU();
                } catch (error) {
                    this.options.onError?.(error);
                }
            }
        }
        this.observer = new ResizeObserver(() => this.invalidate());
        this.observer.observe(host);
        window.addEventListener('scroll', () => this.invalidate(), {
            capture: true,
            passive: true,
            signal: this.events.signal,
        });
        document.addEventListener('visibilitychange', () => this.invalidate(), {
            signal: this.events.signal,
        });
        this.applyPreferences();
        this.invalidate();
    }

    initGPU() {
        const gl = this.gl;
        this.copyProgram = program(gl, COPY);
        this.shapeProgram = program(gl, SHAPE);
        this.copyLocations = {
            position: gl.getAttribLocation(this.copyProgram, 'position'),
            source: gl.getUniformLocation(this.copyProgram, 'source'),
        };
        this.shapeLocations = Object.fromEntries(
            ['rect', 'colour', 'radius'].map((key) => [
                key,
                gl.getUniformLocation(this.shapeProgram, key),
            ]),
        );
        this.shapeLocations.position = gl.getAttribLocation(this.shapeProgram, 'position');
        this.buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        this.source = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.source);
        this.textureParameters();
        this.mode = 'webgl';
        this.uploadNeeded = true;
    }

    textureParameters() {
        const gl = this.gl;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    get reducedMotion() {
        return this.motion.matches;
    }
    get opaque() {
        return (
            this.solid || this.transparency.matches || this.contrast.matches || this.forced.matches
        );
    }

    applyPreferences() {
        this.host.dataset.wlgMode = this.mode;
        this.host.dataset.wlgOpaque = String(this.opaque);
        this.host.dataset.wlgEffects = this.effects ? 'on' : 'off';
        this.canvas.hidden = this.mode !== 'webgl';
        this.background.hidden = this.mode === 'webgl';
    }

    setPainter(painter) {
        this.painter = painter;
        this.invalidateBackground();
    }
    invalidateBackground() {
        this.backgroundDirty = true;
        this.invalidate();
    }
    setEffects(value) {
        this.effects = Boolean(value);
        this.applyPreferences();
        this.invalidate();
    }
    setSolid(value) {
        this.solid = Boolean(value);
        this.applyPreferences();
        this.invalidate();
    }
    setLightAngle(value) {
        this.lightAngle = Number(value);
        this.invalidate();
    }

    register(element, options = {}) {
        const id = `wlg-${++this.sequence}`;
        const config = { ...GLASS_PRESETS.clear, ...options };
        if (Number.isFinite(options.borderRadius))
            element.style.borderRadius = `${Math.max(0, options.borderRadius)}px`;
        const record = {
            id,
            element,
            config,
            layer: options.layer ?? 0,
            update: (patch) => {
                Object.assign(config, patch);
                if (patch.layer != null) record.layer = patch.layer;
                if (Number.isFinite(patch.borderRadius))
                    element.style.borderRadius = `${Math.max(0, patch.borderRadius)}px`;
                this.invalidate();
            },
            remove: () => {
                this.surfaces.delete(id);
                this.observer.unobserve(element);
                this.invalidate();
            },
        };
        this.surfaces.set(id, record);
        this.observer.observe(element);
        this.invalidate();
        return record;
    }

    registerUnderlay(draw, layer = 1) {
        const item = { draw, layer };
        this.underlays.add(item);
        this.invalidate();
        return () => {
            this.underlays.delete(item);
            this.invalidate();
        };
    }

    rect(element) {
        const r = element.getBoundingClientRect();
        const c = this.canvas.getBoundingClientRect();
        return { x: r.left - c.left, y: r.top - c.top, width: r.width, height: r.height };
    }

    invalidate() {
        if (this.destroyed || this.frame || document.hidden) return;
        this.frame = requestAnimationFrame((time) => {
            this.frame = 0;
            try {
                this.render(time);
            } catch (error) {
                this.mode = 'fallback';
                this.applyPreferences();
                this.options.onStatus?.(this.mode);
                this.options.onError?.(error);
            }
            if (time < this.followUntil) this.invalidate();
        });
    }

    follow(milliseconds = 220) {
        this.followUntil = Math.max(
            this.followUntil,
            performance.now() + (this.reducedMotion ? 0 : milliseconds),
        );
        this.invalidate();
    }

    resize() {
        const cssWidth = Math.max(1, this.host.clientWidth);
        const cssHeight = Math.max(1, this.host.clientHeight);
        const requested = this.options.pixelRatio ?? Math.min(devicePixelRatio || 1, 1.5);
        const ratio = Math.min(
            requested,
            Math.sqrt((this.options.maxPixels ?? 1400000) / (cssWidth * cssHeight)),
        );
        const width = Math.max(1, Math.round(cssWidth * ratio));
        const height = Math.max(1, Math.round(cssHeight * ratio));
        this.ratio = ratio;
        this.cssWidth = cssWidth;
        this.cssHeight = cssHeight;
        if (this.canvas.width === width && this.canvas.height === height) return;
        this.canvas.width = this.background.width = width;
        this.canvas.height = this.background.height = height;
        if (this.gl)
            for (const target of this.targets) {
                this.gl.deleteTexture(target.texture);
                this.gl.deleteFramebuffer(target.framebuffer);
            }
        this.targets = [];
        this.backgroundDirty = true;
    }

    target(input) {
        const gl = this.gl;
        while (this.targets.length < 2) {
            const texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            this.textureParameters();
            gl.texImage2D(
                gl.TEXTURE_2D,
                0,
                gl.RGBA,
                this.canvas.width,
                this.canvas.height,
                0,
                gl.RGBA,
                gl.UNSIGNED_BYTE,
                null,
            );
            const framebuffer = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            gl.framebufferTexture2D(
                gl.FRAMEBUFFER,
                gl.COLOR_ATTACHMENT0,
                gl.TEXTURE_2D,
                texture,
                0,
            );
            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
                throw new Error('WebLG framebuffer allocation failed.');
            this.targets.push({ texture, framebuffer });
        }
        return input === this.targets[0].texture ? this.targets[1] : this.targets[0];
    }

    triangle(location) {
        const gl = this.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
    }

    blit(texture, target = null) {
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.disable(gl.BLEND);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.disable(gl.SCISSOR_TEST);
        gl.useProgram(this.copyProgram);
        this.triangle(this.copyLocations.position);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(this.copyLocations.source, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    drawShape({ x, y, width, height, radius = 0, colour = [1, 1, 1, 1] }) {
        const gl = this.gl,
            d = this.ratio;
        if (!(width > 0 && height > 0)) return;
        const px = x * d,
            py = this.canvas.height - (y + height) * d;
        const left = Math.max(0, Math.floor(px - 1)),
            bottom = Math.max(0, Math.floor(py - 1));
        const right = Math.min(this.canvas.width, Math.ceil(px + width * d + 1)),
            top = Math.min(this.canvas.height, Math.ceil(py + height * d + 1));
        if (right <= left || top <= bottom) return;
        gl.useProgram(this.shapeProgram);
        this.triangle(this.shapeLocations.position);
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(left, bottom, right - left, top - bottom);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.uniform4f(this.shapeLocations.rect, px, py, width * d, height * d);
        gl.uniform4fv(this.shapeLocations.colour, colour);
        gl.uniform1f(this.shapeLocations.radius, Math.min(radius, width / 2, height / 2) * d);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.disable(gl.SCISSOR_TEST);
        gl.disable(gl.BLEND);
    }

    render(time = performance.now()) {
        this.resize();
        if (this.backgroundDirty) {
            const ctx = this.context;
            ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
            ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
            this.painter?.(ctx, this.cssWidth, this.cssHeight, time);
            this.backgroundDirty = false;
            this.uploadNeeded = true;
        }
        if (this.mode !== 'webgl') return;
        const gl = this.gl;
        if (this.uploadNeeded) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.source);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.background);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            this.uploadNeeded = false;
        }
        const groups = new Map();
        for (const record of this.surfaces.values()) {
            if (!record.element.isConnected || !record.element.getClientRects().length) continue;
            const style = getComputedStyle(record.element);
            if (style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
            const r = record.element.getBoundingClientRect();
            if (r.width < 1 || r.height < 1) continue;
            const layer = record.layer;
            if (!groups.has(layer)) groups.set(layer, []);
            const radiusText = style.borderTopLeftRadius;
            const base = radiusText.endsWith('%')
                ? (Math.min(record.element.offsetWidth, record.element.offsetHeight) *
                      parseFloat(radiusText)) /
                  100
                : parseFloat(radiusText) || 0;
            const scale = record.element.offsetWidth ? r.width / record.element.offsetWidth : 1;
            groups
                .get(layer)
                .push({
                    id: record.id,
                    ...record.config,
                    element: record.element,
                    borderRadius: base * scale,
                    ...(this.reducedMotion ? { liquidity: 0 } : {}),
                });
        }
        for (const item of this.underlays) if (!groups.has(item.layer)) groups.set(item.layer, []);
        let input = this.source,
            passes = 0,
            count = 0;
        for (const [layer, lenses] of [...groups].sort(([a], [b]) => a - b)) {
            const drawings = [...this.underlays]
                .filter((item) => item.layer === layer)
                .flatMap((item) => item.draw() ?? []);
            if (drawings.length) {
                const target = this.target(input);
                this.blit(input, target);
                drawings.forEach((drawing) => this.drawShape(drawing));
                input = target.texture;
                passes++;
            }
            if (!this.effects || this.opaque) continue;
            for (let from = 0; from < lenses.length; from += MAX_LENSES) {
                const key = `${layer}:${from}`;
                if (!this.renderers.has(key))
                    this.renderers.set(
                        key,
                        new WebLG(gl, this.shaders.vertexShader, this.shaders.fragmentShader, {
                            dpr: this.ratio,
                        }),
                    );
                const renderer = this.renderers.get(key);
                for (const id of [...renderer._lenses.keys()]) renderer.removeLens(id);
                lenses.slice(from, from + MAX_LENSES).forEach((lens) => renderer.addLens(lens));
                renderer.resize(this.canvas.width, this.canvas.height, this.ratio);
                renderer.setLightAngle(this.lightAngle);
                renderer.setBackground(input);
                const target = this.target(input);
                gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
                renderer.render(time / 1000);
                input = target.texture;
                passes++;
                count += Math.min(MAX_LENSES, lenses.length - from);
            }
        }
        this.blit(input);
        this.stats = {
            surfaces: count,
            passes,
            pixelRatio: this.ratio,
            width: this.canvas.width,
            height: this.canvas.height,
        };
        this.host.dispatchEvent(new CustomEvent('wlgrender', { detail: this.stats }));
    }

    destroy() {
        this.destroyed = true;
        cancelAnimationFrame(this.frame);
        this.events.abort();
        this.observer.disconnect();
        [this.motion, this.transparency, this.contrast, this.forced].forEach((query) =>
            query.removeEventListener('change', this.preferenceChanged),
        );
        this.renderers.forEach((renderer) => renderer.dispose());
        if (this.gl) {
            for (const target of this.targets) {
                this.gl.deleteFramebuffer(target.framebuffer);
                this.gl.deleteTexture(target.texture);
            }
            this.gl.deleteTexture(this.source);
            this.gl.deleteBuffer(this.buffer);
            this.gl.deleteProgram(this.copyProgram);
            this.gl.deleteProgram(this.shapeProgram);
        }
        this.canvas.remove();
        this.background.remove();
        this.surfaces.clear();
        this.underlays.clear();
    }
}
