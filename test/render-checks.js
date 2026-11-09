import { WebLG } from '../src/WebLG.js';
import { WebLG as ReferenceWebLG } from './fixtures/WebLG-853a0ab.js';
import { loadShaders } from '../src/shaders.js';

function check(condition, message) {
    if (!condition) throw new Error(message);
}

function texture(gl, width, height, alpha = false, sharp = false) {
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const at = (y * width + x) * 4;
            data[at] = Math.round(127 + 100 * Math.sin(x * 0.045) * Math.cos(y * 0.025));
            data[at + 1] = Math.round(127 + 100 * Math.sin((x + y) * 0.032));
            data[at + 2] = Math.round(40 + 160 * y / height);
            if (sharp) {
                data[at] = ((x >> 2) + (y >> 2)) % 2 ? 255 : 0;
                data[at + 1] = x % 9 < 3 ? 255 : 0;
                data[at + 2] = (x + y) % 17 < 8 ? 255 : 0;
            }
            data[at + 3] = alpha ? Math.round(160 + 90 * x / width) : 255;
        }
    }
    const result = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, result);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return result;
}

async function setup(kind = 'webgl', width = 320, height = 200, dpr = 1) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.style.cssText = `position:fixed;left:0;top:0;width:${width / dpr}px;height:${height / dpr}px`;
    document.body.append(canvas);
    const gl = canvas.getContext(kind, { antialias: false, alpha: true, premultipliedAlpha: false });
    check(gl, `${kind} is required`);
    const shaders = await loadShaders();
    const referenceShader = await (await fetch('/test/fixtures/glass-853a0ab.frag')).text();
    const reference = new ReferenceWebLG(gl, shaders.vertexShader, referenceShader, { dpr });
    const current = new WebLG(gl, shaders.vertexShader, shaders.fragmentShader, { dpr });
    const background = texture(gl, width, height, true);
    reference.setBackground(background);
    current.setBackground(background);
    const pixels = () => {
        const result = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, result);
        return result;
    };
    const destroy = () => {
        reference.dispose();
        current.dispose();
        gl.deleteTexture(background);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        canvas.remove();
    };
    return { gl, reference, current, pixels, destroy, canvas, width, height, background };
}

function configure(pair, configs) {
    for (const renderer of [pair.reference, pair.current]) {
        for (const id of [...renderer._lenses.keys()]) renderer.removeLens(id);
        configs.forEach((config) => renderer.addLens(config));
    }
}

function compare(pair, label, time = 1.25) {
    pair.reference.render(time);
    const before = pair.pixels();
    pair.current.render(time);
    const after = pair.pixels();
    let sum = 0;
    let max = 0;
    let changed = 0;
    for (let i = 0; i < before.length; i++) {
        const delta = Math.abs(before[i] - after[i]);
        sum += delta;
        max = Math.max(max, delta);
        if (delta > 8) changed++;
    }
    const mean = sum / before.length;
    const fraction = changed / before.length;
    // Rotation of the original kernel changes only floating-point rounding.
    // Bound both average error and the number of visibly different channels.
    check(mean < 0.75 && fraction < 0.02, `${label}: rendering changed (mean=${mean}, >8=${fraction}, max=${max})`);
    check(pair.gl.getError() === pair.gl.NO_ERROR, `${label}: WebGL error`);
    return { label, meanDelta: +mean.toFixed(4), maxDelta: max, fractionOver8: +fraction.toFixed(5) };
}

function lens(overrides = {}) {
    return { rect: { x: 30, y: 20, width: 250, height: 150 }, ...overrides };
}

export async function verify() {
    const results = [];
    for (const kind of ['webgl', 'webgl2']) {
        for (const dpr of [1, 2]) {
            const pair = await setup(kind, 320, 200, dpr);
            try {
                const cases = [
                    ['passthrough', []],
                    ['default', [lens()]],
                    ['clear circle', [lens({ rect: { x: 25, y: 20, width: 120, height: 120 }, frosted: 0 })]],
                    ['mixed clear and frosted', [lens({ frosted: 0 }), lens({ rect: { x: 160, y: 10, width: 130, height: 90 } })]],
                    ['squircle', [lens({ smoothness: 2.5, frosted: 8 })]],
                    ['rounded pill', [lens({ smoothness: 16, rect: { x: 10, y: 60, width: 290, height: 40 } })]],
                    ['achromatic', [lens({ chroma: 0, frosted: 12, edgeSpread: 50 })]],
                    ['no refraction', [lens({ pinch: 0, frosted: 5, turbulence: 5, liquidity: 2 })]],
                    ['no edge', [lens({ edgeSpread: 0 })]],
                    ['turbulence', [lens({ turbulence: 4, liquidity: 0.6, chroma: 2 })]],
                    ['overlap', [lens(), lens({ rect: { x: 100, y: 50, width: 100, height: 100 }, chroma: 2 })]],
                    ['offscreen', [lens({ rect: { x: -50, y: -30, width: 100, height: 70 } }), lens({ rect: { x: 900, y: 800, width: 90, height: 70 } })]],
                    ['16 lenses', Array.from({ length: 16 }, (_, i) => lens({ rect: { x: (i % 4) * 78, y: Math.floor(i / 4) * 48, width: 70, height: 40 }, smoothness: i + 1, chroma: i % 3 ? 0.7 : 0 }))],
                    ['empty and narrow', [{}, lens({ rect: { x: 10, y: 10, width: 0.5 / dpr, height: 80 } })]],
                ];
                for (const [name, configs] of cases) {
                    configure(pair, configs);
                    results.push(compare(pair, `${kind} DPR ${dpr} ${name}`));
                }

                // The new rim is opt-in: it changes the edge, not the centre
                // or the background. Its front/back lighting really changes
                // when the light direction changes.
                configure(pair, [lens({ rect: { x: 60 / dpr, y: 40 / dpr, width: 200 / dpr, height: 120 / dpr }, smoothness: 0, frosted: 0, pinch: 0, chroma: 0, rim: 1, rimWidth: 2 / dpr })]);
                pair.reference.render(1);
                const unlit = pair.pixels();
                pair.current.setLightAngle(180); pair.current.render(1);
                const lit = pair.pixels();
                const at = (x, y) => (y * pair.width + x) * 4;
                const edge = at(60, 100), centre = at(160, 100), outside = at(10, 10);
                check(lit[edge] > unlit[edge] + 3, 'rim did not light the edge');
                check(Math.abs(lit[centre] - unlit[centre]) <= 1, 'rim changed the centre');
                check(lit[outside] === unlit[outside], 'rim changed the outside background');
                pair.current.setLightAngle(0); pair.current.render(1);
                check(lit[edge] > pair.pixels()[edge] + 3, 'rim ignored the light direction');

                // An explicit radius zero must permit square controls rather
                // than invoking the legacy nearly-square -> circle rule.
                configure(pair, [lens({ rect: { x: 60 / dpr, y: 40 / dpr, width: 80 / dpr, height: 80 / dpr }, smoothness: 20, borderRadius: 0, frosted: 0, pinch: 0, rim: 1, rimWidth: 3 / dpr })]);
                pair.reference.render(1); const circle = pair.pixels();
                pair.current.setLightAngle(225); pair.current.render(1);
                check(pair.pixels()[at(61, 81)] > circle[at(61, 81)] + 3, 'explicit square radius was ignored');
                pair.current.setLightAngle(135);

                configure(pair, cases.find(([name]) => name === '16 lenses')[1]);
                const scalar = pair.gl.uniform4f;
                const vector = pair.gl.uniform4fv;
                let scalarCalls = 0;
                let vectorCalls = 0;
                pair.gl.uniform4f = function (...args) { scalarCalls++; return scalar.apply(this, args); };
                pair.gl.uniform4fv = function (...args) { vectorCalls++; return vector.apply(this, args); };
                try {
                    pair.reference.render(1);
                    check(scalarCalls === 48, 'reference uniform call count changed');
                    pair.current.render(1);
                    check(scalarCalls === 48 && vectorCalls === 3, 'lens uniforms were not batched');
                } finally {
                    pair.gl.uniform4f = scalar;
                    pair.gl.uniform4fv = vector;
                }

                const sharp = texture(pair.gl, pair.width, pair.height, true, true);
                pair.reference.setBackground(sharp);
                pair.current.setBackground(sharp);
                configure(pair, [lens({ frosted: 12 }), lens({ smoothness: 15, rect: { x: 140, y: 40, width: 110, height: 90 } })]);
                results.push(compare(pair, `${kind} DPR ${dpr} sharp pattern`));
                pair.reference.setBackground(pair.background);
                pair.current.setBackground(pair.background);
                pair.gl.deleteTexture(sharp);

                // getLens() is intentionally mutable, and DOM motion must not
                // need updateLens(), ResizeObserver or a new animation frame.
                const element = document.createElement('div');
                element.style.cssText = 'position:fixed;left:10px;top:15px;width:80px;height:45px';
                document.body.append(element);
                configure(pair, [{ element }]);
                results.push(compare(pair, `${kind} DPR ${dpr} DOM`));
                element.style.transform = 'translate(41px, 17px) scale(1.15)';
                for (const renderer of [pair.reference, pair.current]) renderer.getLens([...renderer._lenses.keys()][0]).chroma = 0;
                results.push(compare(pair, `${kind} DPR ${dpr} moved DOM and edited config`));
                element.remove();

                // Test external GL state, not just pixels: compositing must not
                // break the application that shares this rendering context.
                const gl = pair.gl;
                gl.enable(gl.BLEND);
                gl.enable(gl.DEPTH_TEST);
                gl.enable(gl.CULL_FACE);
                gl.viewport(7, 9, 80, 60);
                gl.activeTexture(gl.TEXTURE3);
                const program = gl.getParameter(gl.CURRENT_PROGRAM);
                pair.current.render(2);
                check(gl.isEnabled(gl.BLEND) && gl.isEnabled(gl.DEPTH_TEST) && gl.isEnabled(gl.CULL_FACE), 'GL enable state was not restored');
                check(gl.getParameter(gl.ACTIVE_TEXTURE) === gl.TEXTURE3, 'active texture was not restored');
                check(gl.getParameter(gl.CURRENT_PROGRAM) === program, 'program was not restored');
                check(String(gl.getParameter(gl.VIEWPORT)) === '7,9,80,60', 'viewport was not restored');
                check(gl.getError() === gl.NO_ERROR, 'GL state test failed');
            } finally {
                pair.destroy();
            }
        }
    }
    results.push(...await verifyThree());
    return results;
}

export async function benchmark() {
    const pair = await setup('webgl', 640, 400);
    const gl = pair.gl;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const cases = [
        ['3 blurred lenses', [lens({ rect: { x: 60, y: 20, width: 360, height: 330 } }), lens({ rect: { x: 470, y: 10, width: 150, height: 150 } }), lens({ rect: { x: 160, y: 350, width: 400, height: 40 } })]],
        ['achromatic blur', [lens({ rect: { x: 20, y: 20, width: 600, height: 360 }, edgeSpread: 80, frosted: 10, chroma: 0 })]],
        ['16 lenses', Array.from({ length: 16 }, (_, i) => lens({ rect: { x: (i % 4) * 160 + 8, y: Math.floor(i / 4) * 100 + 8, width: 140, height: 80 } }))],
        ['clear glass', [lens({ rect: { x: 20, y: 20, width: 600, height: 360 }, frosted: 0 })]],
    ];
    const results = [];
    // WebGL finish() alone does not wait for Chromium's GPU process. A full
    // readback is required here to time completed work rather than submission.
    const readback = new Uint8Array(pair.width * pair.height * 4);
    const synchronize = () => gl.readPixels(0, 0, pair.width, pair.height, gl.RGBA, gl.UNSIGNED_BYTE, readback);
    try {
        for (const [name, configs] of cases) {
            configure(pair, configs);
            const timings = { reference: [], current: [] };
            for (const key of ['reference', 'current']) {
                for (let i = 0; i < 3; i++) pair[key].render(i);
                synchronize();
            }
            for (let round = 0; round < 5; round++) {
                for (const key of round % 2 ? ['current', 'reference'] : ['reference', 'current']) {
                    const start = performance.now();
                    for (let i = 0; i < 2; i++) pair[key].render(2 + i * 0.01);
                    synchronize();
                    timings[key].push((performance.now() - start) / 2);
                }
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
            const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
            const before = median(timings.reference);
            const after = median(timings.current);
            results.push({ name, beforeMs: +before.toFixed(3), afterMs: +after.toFixed(3), speedup: +(before / after).toFixed(2), timings });
        }
        return { renderer, width: pair.width, height: pair.height, measurement: 'Median of five alternating batches of two frames, with a full synchronous readPixels per batch. Includes readback overhead; not display FPS.', results };
    } finally {
        pair.destroy();
    }
}

async function verifyThree() {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { WebLGThree } = await import('../src/WebLGThree.js');
    const results = [];
    for (const kind of ['webgl', 'webgl2']) {
        const pair = await setup(kind);
        const renderer = new THREE.WebGLRenderer({ canvas: pair.canvas, context: pair.gl, alpha: true, antialias: false });
        renderer.setSize(pair.width, pair.height, false);
        const shaders = await loadShaders();
        const current = new WebLGThree(renderer, shaders.vertexShader, shaders.fragmentShader);
        // Upload exactly the same background to Three.js, with no colour-space
        // transform, mipmaps or premultiplication changing the reference image.
        const pixels = new Uint8Array(pair.width * pair.height * 4);
        pair.gl.bindTexture(pair.gl.TEXTURE_2D, pair.background);
        const framebuffer = pair.gl.createFramebuffer();
        pair.gl.bindFramebuffer(pair.gl.FRAMEBUFFER, framebuffer);
        pair.gl.framebufferTexture2D(pair.gl.FRAMEBUFFER, pair.gl.COLOR_ATTACHMENT0, pair.gl.TEXTURE_2D, pair.background, 0);
        pair.gl.readPixels(0, 0, pair.width, pair.height, pair.gl.RGBA, pair.gl.UNSIGNED_BYTE, pixels);
        pair.gl.bindFramebuffer(pair.gl.FRAMEBUFFER, null);
        pair.gl.deleteFramebuffer(framebuffer);
        const background = new THREE.DataTexture(pixels, pair.width, pair.height);
        background.minFilter = background.magFilter = THREE.LinearFilter;
        background.needsUpdate = true;
        current.setBackground(background);
        try {
            const originalCurrent = pair.current;
            pair.current = { _lenses: current._lenses,
                addLens: (config) => current.addLens(config),
                removeLens: (id) => current.removeLens(id),
                render: (time) => { renderer.resetState(); current.render(time); },
            };
            for (const [name, configs] of [
                ['default', [lens()]],
                ['clear glass', [lens({ frosted: 0 })]],
                ['achromatic', [lens({ chroma: 0, edgeSpread: 50 })]],
                ['16 lenses', Array.from({ length: 16 }, (_, i) => lens({ rect: { x: (i % 4) * 78, y: Math.floor(i / 4) * 48, width: 70, height: 40 }, smoothness: i + 1 }))],
                ['remove all lenses', []],
            ]) {
                configure(pair, configs);
                results.push(compare(pair, `Three.js ${kind} ${name}`));
            }
            pair.current = originalCurrent;
            // autoClear and render target are restored even if rendering fails.
            const render = renderer.render;
            const target = new THREE.WebGLRenderTarget(8, 8);
            renderer.setRenderTarget(target);
            renderer.autoClear = true;
            renderer.render = () => { throw new Error('intentional test failure'); };
            try { current.render(1); } catch (error) { check(error.message === 'intentional test failure', 'unexpected render failure'); }
            check(renderer.autoClear === true && renderer.getRenderTarget() === target, 'Three.js state was not restored after failure');
            renderer.render = render;
            renderer.setRenderTarget(null);
            target.dispose();
        } finally {
            current.dispose();
            background.dispose();
            renderer.dispose();
            pair.destroy();
        }
    }
    return results;
}
