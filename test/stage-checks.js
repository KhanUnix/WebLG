import { WebLGStage } from '../src/stage.js';
import { WebLGStage as PreviousStage } from './fixtures/stage-87b15ab.js';

const check = (value, message) => {
    if (!value) throw new Error(message);
};

async function scene(
    Stage,
    dpr = 1,
    width = 240,
    height = 180,
    frosted = 0,
    antialiasEdges = false,
) {
    const host = document.createElement('div');
    host.style.cssText = `position:fixed;left:-2000px;top:0;width:${width}px;height:${height}px`;
    document.body.append(host);
    const stage = await Stage.create(host, { pixelRatio: dpr, antialiasEdges });
    let phase = 0;
    stage.setPainter((ctx, w, h) => {
        ctx.fillStyle = '#192f49';
        ctx.fillRect(0, 0, w, h);
        for (let x = 0; x < w; x += 9) {
            ctx.fillStyle = (x / 9 + phase) % 2 ? '#e6b789' : '#397eb4';
            ctx.fillRect(x, 0, 4, h);
        }
        ctx.fillStyle = '#e74744';
        ctx.fillRect(w * 0.4, h * 0.5, w * 0.4, 5);
    });
    const surfaces = [
        { x: 10, y: height - 38, width: width - 20, height: 30, layer: 0, borderRadius: 15 },
        { x: 13, y: height - 35, width: 50, height: 24, layer: 1, borderRadius: 12 },
        { x: 18, y: 22, width: 58, height: 58, layer: 2, borderRadius: 29 },
        { x: width - 105, y: 20, width: 86, height: 42, layer: 3, borderRadius: 21 },
        { x: width * 0.45, y: height * 0.45, width: 68, height: 56, layer: 4, borderRadius: 17 },
    ].map((options) => {
        const element = document.createElement('div');
        element.style.cssText = `position:absolute;left:${options.x}px;top:${options.y}px;width:${options.width}px;height:${options.height}px`;
        host.append(element);
        const surface = stage.register(element, { ...options, frosted });
        return { element, surface };
    });
    let track = 0;
    stage.registerUnderlay(
        () => [
            { x: 30 + track, y: 45, width: 90, height: 4, radius: 2, colour: [0.1, 0.5, 0.9, 0.5] },
        ],
        1,
    );
    const pixels = () => {
        const gl = stage.gl,
            result = new Uint8Array(stage.canvas.width * stage.canvas.height * 4);
        gl.readPixels(
            0,
            0,
            stage.canvas.width,
            stage.canvas.height,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            result,
        );
        check(gl.getError() === 0, 'stage WebGL error');
        return result;
    };
    return {
        stage,
        host,
        surfaces,
        pixels,
        background: () => {
            phase++;
            stage.invalidateBackground();
        },
        track: (value) => {
            track = value;
        },
        destroy: () => {
            stage.destroy();
            host.remove();
        },
    };
}

export async function verify() {
    const comparisons = [];
    for (const dpr of [1, 2]) {
        const previous = await scene(PreviousStage, dpr);
        const current = await scene(WebLGStage, dpr);
        const both = (fn) => {
            fn(previous);
            fn(current);
        };
        const compare = (label) => {
            previous.stage.render(1500);
            const a = previous.pixels();
            current.stage.render(1500);
            const b = current.pixels();
            let maximum = 0,
                sum = 0;
            for (let i = 0; i < a.length; i++) {
                const d = Math.abs(a[i] - b[i]);
                maximum = Math.max(maximum, d);
                sum += d;
            }
            check(
                maximum <= 2 && sum / a.length < 0.1,
                `${label}: cached composition differs (${maximum}, ${sum / a.length})`,
            );
            comparisons.push({ label, dpr, maximum, stats: current.stage.stats });
        };
        try {
            compare('initial');
            compare('unchanged');
            check(
                current.stage.stats.passes === 0 && current.stage.stats.cacheHits === 6,
                'static layers were recalculated',
            );
            both((s) => {
                s.surfaces[2].element.style.left = '30px';
            });
            compare('small drag');
            check(
                current.stage.stats.backgroundUploads === 0,
                'static background was uploaded during dragging',
            );
            check(
                current.stage.stats.shadedPixels <
                    current.stage.canvas.width * current.stage.canvas.height,
                'glass shading still covers the whole scene',
            );
            both((s) => {
                s.surfaces[2].element.style.left = '137px';
                s.surfaces[2].element.style.top = '23px';
            });
            compare('overlapping shapes');
            both((s) => s.surfaces[3].surface.update({ frosted: 4, chroma: 0.8, pinch: 3 }));
            compare('blurred neighbour samples parent');
            both((s) => {
                s.surfaces[2].element.style.left = '158px';
            });
            compare('moving parent inside blurred neighbour');
            both((s) => s.track(17));
            compare('translucent underlay change');
            both((s) => (s.surfaces[2].element.style.display = 'none'));
            compare('hide shape');
            both((s) => (s.surfaces[2].element.style.display = 'block'));
            compare('show shape');
            both((s) => s.surfaces[4].surface.update({ borderRadius: 0, rim: 0.9 }));
            compare('radius and rim');
            both((s) => s.stage.setLightAngle(15));
            compare('light direction');
            both((s) => s.stage.setEffects(false));
            compare('comparison off');
            both((s) => s.stage.setEffects(true));
            compare('comparison on');
            both((s) => s.stage.setSolid(true));
            compare('opaque');
            both((s) => s.stage.setSolid(false));
            compare('transparent');
            both((s) => s.background());
            compare('new background');
            both((s) => {
                s.host.style.width = '260px';
            });
            compare('resize');
            both((s) => s.surfaces[3].surface.remove());
            compare('remove middle layer');
            current.stage.setBackgroundTransform(1.03, 0.005, -0.002);
            current.stage.render(1600);
            const cached = current.pixels();
            check(
                current.stage.stats.backgroundUploads === 0,
                'background animation reuploaded the bitmap',
            );
            current.stage.options.cache = false;
            current.stage.render(1600);
            check(
                current.pixels().every((value, i) => value === cached[i]),
                'cached GPU background differs from full rendering',
            );
            current.stage.options.cache = true;
            current.stage.setBackgroundTransform();
            compare('stop GPU background animation');
            current.stage.options.maxCachedLayers = 2;
            both((s) => {
                s.host.style.width = '270px';
            });
            compare('bounded cache');
            check(current.stage.targets.length <= 2, 'framebuffer cache exceeded its limit');
            both((s) => {
                s.surfaces[2].element.style.left = '40px';
            });
            compare('cache eviction and moving glass');
            // Corner Radius controls shader smoothness independently of CSS radius.
            // Verify packing and cached/full pixel parity.
            current.surfaces[4].surface.update({ smoothness: 2, borderRadius: null, frosted: 0 });
            current.stage.render(2000);
            const legacy = current.pixels();
            check(
                current.stage.renderers.get('shared')._lensUniforms.params0[0] === 2,
                'CSS radius overrode original smoothness',
            );
            current.stage.options.cache = false;
            current.stage.render(2000);
            check(
                current.pixels().every((value, index) => value === legacy[index]),
                'legacy shape cache differs from full composition',
            );
            current.stage.options.cache = true;
            current.surfaces[4].surface.update({ smoothness: 16 });
            current.stage.render(2000);
            const rounder = current.pixels();
            check(
                rounder.some((value, index) => value !== legacy[index]),
                'original smoothness had no visual effect',
            );
        } finally {
            previous.destroy();
            current.destroy();
        }
    }
    const aa = await scene(WebLGStage, 1.5, 240, 180, 0, true);
    try {
        aa.stage.render(2000);
        aa.pixels();
        for (const x of [34.25, 70.75, 145.5]) {
            aa.surfaces[2].element.style.left = `${x}px`;
            aa.stage.options.cache = true;
            aa.stage.render(2000);
            const cached = aa.pixels();
            aa.stage.options.cache = false;
            aa.stage.render(2000);
            check(
                aa.pixels().every((value, index) => value === cached[index]),
                'moving antialiased edges left cached trails',
            );
        }
    } finally {
        aa.destroy();
    }
    return {
        comparisons: comparisons.length,
        maximumDelta: Math.max(...comparisons.map((c) => c.maximum)),
    };
}

export async function benchmark() {
    const scenes = [];
    try {
        for (const [name, Stage, frosted] of [
            ['previous-demo', PreviousStage, 0.6],
            ['previous-pipeline-clear', PreviousStage, 0],
            ['cached-clear', WebLGStage, 0],
        ]) {
            const s = await scene(Stage, 1.5, 240, 360, frosted);
            s.name = name;
            s.times = [];
            s.samples = [];
            s.parameters = 0;
            scenes.push(s);
            s.stage.render(0);
            s.pixels();
            const get = s.stage.gl.getParameter.bind(s.stage.gl);
            s.stage.gl.getParameter = (...args) => {
                s.parameters++;
                return get(...args);
            };
        }
        // Rotate order between rounds so cold starts and concurrent host load
        // cannot systematically favour the newest renderer.
        for (let round = 0; round < 3; round++)
            for (let j = 0; j < scenes.length; j++) {
                const s = scenes[(j + round) % scenes.length];
                for (let frame = 0; frame < 2; frame++) {
                    const i = round * 2 + frame;
                    s.surfaces[2].element.style.left = `${24 + i * 4}px`;
                    const started = performance.now();
                    s.stage.render(1000 + i * 8.333);
                    s.pixels(); // Measurement only, never in the production render loop.
                    s.times.push(performance.now() - started);
                    s.samples.push(s.stage.stats);
                }
            }
        return scenes.map((s) => {
            s.times.sort((a, b) => a - b);
            return {
                name: s.name,
                width: s.stage.canvas.width,
                height: s.stage.canvas.height,
                medianCompletedMs: (s.times[2] + s.times[3]) / 2,
                synchronousStateReads: s.parameters / 6,
                averageGlassPixels:
                    s.samples.reduce(
                        (n, stats) => n + (stats.shadedPixels ?? 5 * stats.width * stats.height),
                        0,
                    ) / 6,
                averagePasses: s.samples.reduce((n, stats) => n + stats.passes, 0) / 6,
            };
        });
    } finally {
        scenes.forEach((s) => s.destroy());
    }
}
