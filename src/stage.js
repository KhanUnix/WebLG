import { WebLG } from './WebLG.js';
import { GLASS_PRESETS, loadShaders, MAX_LENSES } from './shaders.js';

// Damage rectangles use framebuffer pixels, with a bottom-left origin.
const union = (a, b) =>
    !a
        ? b
        : !b
          ? a
          : [
                Math.min(a[0], b[0]),
                Math.min(a[1], b[1]),
                Math.max(a[2], b[2]),
                Math.max(a[3], b[3]),
            ];
const intersect = (a, b) => {
    if (!a || !b) return null;
    const result = [
        Math.max(a[0], b[0]),
        Math.max(a[1], b[1]),
        Math.min(a[2], b[2]),
        Math.min(a[3], b[3]),
    ];
    return result[2] > result[0] && result[3] > result[1] ? result : null;
};
const expand = (r, amount) =>
    r && [
        Math.floor(r[0] - amount),
        Math.floor(r[1] - amount),
        Math.ceil(r[2] + amount),
        Math.ceil(r[3] + amount),
    ];
const area = (r) => (r ? (r[2] - r[0]) * (r[3] - r[1]) : 0);

const VERTEX = `attribute vec2 position; varying vec2 vUv;
void main(){ vUv=position*0.5+0.5; gl_Position=vec4(position,0.,1.); }`;
const COPY = `precision highp float; varying vec2 vUv; uniform sampler2D source; uniform vec3 sourceTransform;
void main(){ gl_FragColor=texture2D(source,vUv*sourceTransform.x+sourceTransform.yz); }`;
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
        this.layerCache = new Map();
        this.mutations = new Map();
        this.sequence = 0;
        this.effects = true;
        this.solid = false;
        this.lightAngle = 135;
        this.backgroundTransform = [1, 0, 0];
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
                this.layerCache.clear();
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
        this.observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                for (const record of this.surfaces.values()) {
                    if (entry.target === this.host || record.element === entry.target)
                        this.syncLegacyCorners(record);
                }
            }
            this.invalidate();
        });
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
            transform: gl.getUniformLocation(this.copyProgram, 'sourceTransform'),
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
    setBackgroundTransform(scale = 1, x = 0, y = 0) {
        const inverse = 1 / Math.max(1, scale);
        this.backgroundTransform = [inverse, (1 - inverse) / 2 + x, (1 - inverse) / 2 + y];
        // The compatible path animates its existing bitmap through the compositor.
        this.background.style.transform =
            scale === 1 && x === 0 && y === 0
                ? ''
                : `scale(${scale}) translate(${-x * 100}%, ${y * 100}%)`;
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
                if (patch.smoothness !== undefined || patch.borderRadius === null)
                    this.syncLegacyCorners(record);
                this.invalidate();
            },
            remove: () => {
                this.surfaces.delete(id);
                this.observer.unobserve(element);
                this.invalidate();
            },
        };
        this.surfaces.set(id, record);
        this.syncLegacyCorners(record);
        this.observer.observe(element);
        this.invalidate();
        return record;
    }

    syncLegacyCorners(record) {
        if (record.config.borderRadius !== null) return;
        const { element, config } = record;
        const width = element.offsetWidth,
            height = element.offsetHeight;
        if (!width || !height) return;
        const smoothness = config.smoothness ?? 10;
        const dpr = this.ratio ?? this.options.pixelRatio ?? Math.min(devicePixelRatio || 1, 1.5);
        let radius;
        if (Math.abs(width - height) * dpr < 5) radius = Math.min(width, height) / 2;
        else {
            const corner = Math.min(
                smoothness * smoothness * Math.min(width, height) * 0.01,
                width / 2,
                height / 2,
            );
            const t = Math.max(0, Math.min(1, (smoothness - 8) / 12));
            const blend = t * t * (3 - 2 * t);
            const diagonalNorm = Math.pow(2, 0.25) * (1 - blend) + Math.SQRT2 * blend;
            // Match the shader's diagonal inset for CSS shadows/focus outlines.
            // CSS circular corners approximate the legacy squircle silhouette;
            // the exact optical contour remains the antialiased GPU SDF.
            radius = (corner * (1 - 1 / diagonalNorm)) / (1 - Math.SQRT1_2);
        }
        const value = `${radius.toFixed(3)}px`;
        if (element.style.borderRadius !== value) element.style.borderRadius = value;
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

    // Coalesce pointer updates with the optical draw in the same animation frame.
    enqueue(key, mutation) {
        this.mutations.set(key, mutation);
        this.invalidate();
    }

    invalidate() {
        if (this.destroyed || this.frame || document.hidden) return;
        this.frame = requestAnimationFrame((time) => {
            this.frame = 0;
            try {
                for (const mutation of this.mutations.values()) mutation();
                this.mutations.clear();
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
        this.layerCache.clear();
        this.backgroundDirty = true;
    }

    target(key, input) {
        if (this.layerCache.has(key)) return this.layerCache.get(key);
        // Bound resident framebuffer memory for applications with many layers.
        // Reusing a target invalidates its contents and forces a complete copy.
        const limit = Math.max(
            2,
            Math.min(
                this.options.maxCachedLayers ?? 8,
                Math.floor(
                    (this.options.maxCacheBytes ?? 32 * 1024 * 1024) /
                        (this.canvas.width * this.canvas.height * 4),
                ),
            ),
        );
        if (this.targets.length >= limit) {
            const index = this.targets.findIndex((target) => target.texture !== input);
            const target = this.targets.splice(index, 1)[0];
            this.layerCache.delete(target.key);
            Object.assign(target, { key, signature: null, input: null, bounds: null });
            this.targets.push(target);
            this.layerCache.set(key, target);
            return target;
        }
        const gl = this.gl;
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
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
            throw new Error('WebLG framebuffer allocation failed.');
        const target = { key, texture, framebuffer, signature: null, input: null, bounds: null };
        this.targets.push(target);
        this.layerCache.set(key, target);
        return target;
    }

    clip(region) {
        const gl = this.gl;
        if (region) {
            gl.enable(gl.SCISSOR_TEST);
            gl.scissor(region[0], region[1], region[2] - region[0], region[3] - region[1]);
        } else gl.disable(gl.SCISSOR_TEST);
    }

    bounds(rect, padding = 1) {
        const d = this.ratio;
        return intersect(
            [
                Math.floor(rect.x * d - padding),
                Math.floor(this.canvas.height - (rect.y + rect.height) * d - padding),
                Math.ceil((rect.x + rect.width) * d + padding),
                Math.ceil(this.canvas.height - rect.y * d + padding),
            ],
            [0, 0, this.canvas.width, this.canvas.height],
        );
    }

    triangle(location) {
        const gl = this.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
    }

    blit(texture, target = null, region = null, transform = [1, 0, 0]) {
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.disable(gl.BLEND);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        this.clip(region);
        gl.useProgram(this.copyProgram);
        this.triangle(this.copyLocations.position);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(this.copyLocations.source, 0);
        gl.uniform3fv(this.copyLocations.transform, transform);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    drawShape({ x, y, width, height, radius = 0, colour = [1, 1, 1, 1] }, damage) {
        const gl = this.gl,
            d = this.ratio;
        if (!(width > 0 && height > 0)) return;
        const px = x * d,
            py = this.canvas.height - (y + height) * d;
        const left = Math.max(0, Math.floor(px - 1)),
            bottom = Math.max(0, Math.floor(py - 1));
        const right = Math.min(this.canvas.width, Math.ceil(px + width * d + 1)),
            top = Math.min(this.canvas.height, Math.ceil(py + height * d + 1));
        const region = intersect([left, bottom, right, top], damage);
        if (!region) return;
        gl.useProgram(this.shapeProgram);
        this.triangle(this.shapeLocations.position);
        this.clip(region);
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
        const started = performance.now();
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
        const full = [0, 0, this.canvas.width, this.canvas.height];
        let damage = this.uploadNeeded || this.options.cache === false ? full : null;
        let uploads = 0;
        if (this.uploadNeeded) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.source);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.background);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            this.uploadNeeded = false;
            uploads++;
        }
        let input = this.source,
            backgroundCopies = 0;
        const transform = this.backgroundTransform;
        const transformed = transform[0] !== 1 || transform[1] !== 0 || transform[2] !== 0;
        if (transformed) {
            const target = this.target('background', input);
            const signature = transform.join(',');
            if (damage || target.signature !== signature) {
                this.blit(input, target, null, transform);
                target.signature = signature;
                damage = full;
                backgroundCopies = area(full);
            }
            input = target.texture;
        }
        const canvasRect = this.canvas.getBoundingClientRect();
        const groups = new Map();
        for (const record of this.surfaces.values()) {
            const element = record.element;
            if (!element.isConnected || !element.getClientRects().length) continue;
            const style = getComputedStyle(element);
            if (style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
            const r = element.getBoundingClientRect();
            if (r.width < 1 || r.height < 1) continue;
            if (!groups.has(record.layer)) groups.set(record.layer, []);
            const radiusText = style.borderTopLeftRadius;
            const base = radiusText.endsWith('%')
                ? (Math.min(element.offsetWidth, element.offsetHeight) * parseFloat(radiusText)) /
                  100
                : parseFloat(radiusText) || 0;
            const scale = element.offsetWidth ? r.width / element.offsetWidth : 1;
            // Resolve DOM geometry once; the core receives plain rectangles and
            // never forces a second layout query for each optical layer.
            groups.get(record.layer).push({
                ...record.config,
                id: record.id,
                element: undefined,
                label: undefined,
                layer: undefined,
                rect: {
                    x: r.left - canvasRect.left,
                    y: r.top - canvasRect.top,
                    width: r.width,
                    height: r.height,
                },
                // Explicit null opts back into WebLG's original smoothness
                // shape; undefined keeps native controls aligned with CSS.
                borderRadius: record.config.borderRadius === null ? null : base * scale,
                ...(this.reducedMotion ? { liquidity: 0 } : {}),
            });
        }
        for (const item of this.underlays) if (!groups.has(item.layer)) groups.set(item.layer, []);
        const commands = [];
        let count = 0;
        for (const [layer, lenses] of [...groups].sort(([a], [b]) => a - b)) {
            const drawings = [...this.underlays]
                .filter((item) => item.layer === layer)
                .flatMap((item) => item.draw() ?? []);
            if (drawings.length) commands.push({ key: `shape:${layer}`, drawings });
            if (!this.effects || this.opaque) continue;
            for (let from = 0; from < lenses.length; from += MAX_LENSES) {
                const batch = lenses.slice(from, from + MAX_LENSES);
                commands.push({ key: `glass:${layer}:${from}`, lenses: batch });
                count += batch.length;
            }
        }
        let passes = 0,
            cacheHits = 0,
            shadedPixels = 0,
            copiedPixels = backgroundCopies;
        for (const command of commands) {
            const { lenses, drawings } = command;
            const bounds = (lenses ?? drawings).reduce(
                (box, item) => union(box, this.bounds(item.rect ?? item)),
                null,
            );
            // Only time-dependent optics invalidate a static layer each frame.
            const animated = lenses?.some((lens) => lens.turbulence > 0 && lens.liquidity > 0);
            const signature = JSON.stringify([
                lenses ?? drawings,
                lenses ? this.lightAngle : null,
                animated ? time : null,
            ]);
            const target = this.target(command.key, input);
            let nextDamage;
            if (target.input !== input || this.options.cache === false) nextDamage = full;
            else {
                nextDamage = damage;
                if (lenses && damage) {
                    // Refraction/blur can pull changed pixels into a neighbour.
                    // Propagate that footprint, including chromatic displacement.
                    const reach =
                        Math.max(
                            ...lenses.map(
                                (lens) =>
                                    Math.abs(lens.edgeSpread * lens.pinch) *
                                        (1 + Math.abs(lens.chroma) * 0.1) +
                                    Math.max(0, lens.frosted) * 5,
                            ),
                        ) + 2;
                    nextDamage = union(nextDamage, intersect(expand(damage, reach), bounds));
                }
                if (target.signature !== signature)
                    nextDamage = union(nextDamage, union(target.bounds, bounds));
                nextDamage = intersect(nextDamage, full);
            }
            if (nextDamage) {
                this.blit(input, target, nextDamage);
                copiedPixels += area(nextDamage);
                if (drawings) {
                    drawings.forEach((drawing) => this.drawShape(drawing, nextDamage));
                    passes++;
                } else {
                    const region = intersect(nextDamage, bounds);
                    if (region) {
                        // The stage owns its context: one shared renderer and no
                        // synchronous GL state readbacks between its own passes.
                        if (!this.renderers.has('shared'))
                            this.renderers.set(
                                'shared',
                                new WebLG(
                                    gl,
                                    this.shaders.vertexShader,
                                    this.shaders.fragmentShader,
                                    {
                                        dpr: this.ratio,
                                        preserveState: false,
                                        antialiasEdges: this.options.antialiasEdges !== false,
                                    },
                                ),
                            );
                        const renderer = this.renderers.get('shared');
                        renderer._lenses.clear();
                        lenses.forEach((lens) => renderer.addLens(lens));
                        renderer.resize(this.canvas.width, this.canvas.height, this.ratio);
                        renderer.setLightAngle(this.lightAngle);
                        renderer.setBackground(input);
                        this.clip(region);
                        renderer.render(time / 1000, null);
                        shadedPixels += area(region);
                        passes++;
                    }
                }
                target.signature = signature;
                target.input = input;
                target.bounds = bounds;
            } else cacheHits++;
            input = target.texture;
            damage = nextDamage;
        }
        // The default framebuffer is not preserved; present one cheap copy.
        this.blit(input);
        copiedPixels += area(full);
        const used = new Set(commands.map((command) => command.key));
        if (transformed) used.add('background');
        this.targets = this.targets.filter((target) => {
            if (used.has(target.key)) return true;
            gl.deleteFramebuffer(target.framebuffer);
            gl.deleteTexture(target.texture);
            this.layerCache.delete(target.key);
            return false;
        });
        this.stats = {
            surfaces: count,
            passes,
            cacheHits,
            totalPasses: commands.length,
            shadedPixels,
            copiedPixels,
            backgroundUploads: uploads,
            pixelRatio: this.ratio,
            width: this.canvas.width,
            height: this.canvas.height,
            cpuMs: performance.now() - started,
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
        this.layerCache.clear();
        this.mutations.clear();
        this.surfaces.clear();
        this.underlays.clear();
    }
}
