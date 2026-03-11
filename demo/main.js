import * as THREE from 'three';
import { WebLGThree } from '../src/WebLGThree.js';
import { LENS_DEFAULTS } from '../src/shaders.js';

// ── Three.js Scene ──────────────────────────────────────────

const canvas   = document.getElementById('canvas');
const CONTEXT_ATTRS = {
    alpha: true,
    antialias: true,
    depth: true,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
};

function showFatalOverlay(title, message) {
    const existing = document.querySelector('.fatal-overlay');
    if (existing) return;
    const overlay = document.createElement('div');
    overlay.className = 'fatal-overlay';
    overlay.innerHTML = `
        <p class="fatal-overlay-title">${title}</p>
        <p class="fatal-overlay-text">${message}</p>
    `;
    document.body.appendChild(overlay);
}

function tryGetContext(name, attrs) {
    try {
        const gl = canvas.getContext(name, attrs);
        if (!gl) return null;
        if (typeof gl.isContextLost === 'function' && gl.isContextLost()) return null;
        return gl;
    } catch {
        return null;
    }
}

function createRendererWithFallback() {
    const attempts = [
        { name: 'webgl2', attrs: CONTEXT_ATTRS },
        { name: 'webgl', attrs: CONTEXT_ATTRS },
        { name: 'experimental-webgl', attrs: CONTEXT_ATTRS },
        { name: 'webgl', attrs: { ...CONTEXT_ATTRS, antialias: false } },
        { name: 'experimental-webgl', attrs: { ...CONTEXT_ATTRS, antialias: false } },
    ];

    for (const attempt of attempts) {
        const context = tryGetContext(attempt.name, attempt.attrs);
        if (!context) continue;
        try {
            const renderer = new THREE.WebGLRenderer({
                canvas,
                context,
                antialias: false,
                alpha: true,
            });
            return renderer;
        } catch (err) {
            console.warn(`WebLG demo: renderer init failed for ${attempt.name}.`, err);
        }
    }
    return null;
}

const renderer = createRendererWithFallback();
if (!renderer) {
    showFatalOverlay(
        'WebGL unavailable',
        'Could not initialize WebGL on this browser/device. Enable hardware acceleration or update GPU drivers.',
    );
} else {
    canvas.addEventListener('webglcontextlost', (event) => {
        event.preventDefault();
        showFatalOverlay(
            'WebGL context lost',
            'The GPU context was lost. Reload the page and reduce graphics settings if this keeps happening.',
        );
    });

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;

    const scene  = new THREE.Scene();
    scene.background = new THREE.Color(0x080818);

    const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 0.5, 6);

// ── Landscape background (cover: adapts to viewport) ───────────

let bgTexture = null;

function updateBackgroundCover() {
    if (!bgTexture || !bgTexture.image) return;
    const viewAspect = window.innerWidth / window.innerHeight;
    const texAspect = bgTexture.image.width / bgTexture.image.height;

    bgTexture.offset.set(0, 0);
    bgTexture.repeat.set(1, 1);

    if (texAspect > viewAspect) {
        bgTexture.offset.x = (1 - viewAspect / texAspect) / 2;
        bgTexture.repeat.x = viewAspect / texAspect;
    } else {
        bgTexture.offset.y = (1 - texAspect / viewAspect) / 2;
        bgTexture.repeat.y = texAspect / viewAspect;
    }
}

const bgLoader = new THREE.TextureLoader();
bgLoader.load(
    'https://images.unsplash.com/photo-1472214103451-9374bd1c798e?w=2560&auto=format&fit=crop',
    (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        bgTexture = tex;
        scene.background = tex;
        updateBackgroundCover();
    },
);

// ── Objects ─────────────────────────────────────────────────

const torusKnot = new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.6, 0.2, 200, 32),
    new THREE.MeshStandardMaterial({
        color: 0x6366f1,
        metalness: 0.85,
        roughness: 0.15,
    }),
);
scene.add(torusKnot);

const sphereGeo = new THREE.SphereGeometry(0.28, 32, 32);
const spheres = [];
for (let i = 0; i < 6; i++) {
    const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(i / 6, 0.8, 0.55),
        metalness: 0.6,
        roughness: 0.25,
    });
    const mesh = new THREE.Mesh(sphereGeo, mat);
    const angle = (i / 6) * Math.PI * 2;
    mesh.position.set(Math.cos(angle) * 3.2, Math.sin(angle) * 2.0, Math.sin(angle * 0.7));
    scene.add(mesh);
    spheres.push({ mesh, angle });
}

// ── Lights ──────────────────────────────────────────────────

scene.add(new THREE.AmbientLight(0xffffff, 0.25));

const light1 = new THREE.PointLight(0x818cf8, 80, 25);
light1.position.set(4, 3, 3);
scene.add(light1);

const light2 = new THREE.PointLight(0xec4899, 60, 25);
light2.position.set(-4, -2, 2);
scene.add(light2);

const light3 = new THREE.PointLight(0x22d3ee, 40, 20);
light3.position.set(0, 4, -3);
scene.add(light3);

// ── Render Target (background texture for the glass) ────────

let renderTarget = new THREE.WebGLRenderTarget(
    window.innerWidth  * renderer.getPixelRatio(),
    window.innerHeight * renderer.getPixelRatio(),
);

// ── WebLG Setup (async — shaders loaded from files) ─────────

async function init() {
    const weblg = await WebLGThree.create(renderer);
    weblg.setBackground(renderTarget.texture);

    const panelMain   = document.getElementById('panel-main');
    const panelCircle = document.getElementById('panel-circle');
    const panelPill   = document.getElementById('panel-pill');

    const lensMain   = weblg.addLens({ element: panelMain });
    const lensCircle = weblg.addLens({ element: panelCircle, smoothness: 20.0 });
    const lensPill   = weblg.addLens({ element: panelPill });

    // ── Drag ────────────────────────────────────────────────

    const panels = document.querySelectorAll('.lens-panel');
    let dragged = null, startX = 0, startY = 0;

    function applyLayout() {
        panels.forEach(el => {
            el.style.left = '';
            el.style.top = '';
            el.style.transform = '';
        });
        requestAnimationFrame(() => {
            panels.forEach(el => {
                const r = el.getBoundingClientRect();
                el.style.left = r.left + 'px';
                el.style.top = r.top + 'px';
                el.style.transform = 'none';
            });
        });
    }
    applyLayout();

    panels.forEach(el => {
        el.addEventListener('mousedown', e => {
            dragged = el;
            const r = el.getBoundingClientRect();
            startX = e.clientX - r.left;
            startY = e.clientY - r.top;
            document.body.style.userSelect = 'none';
            panels.forEach(p => (p.style.zIndex = 10));
            el.style.zIndex = 20;
        });

        el.addEventListener('touchstart', e => {
            dragged = el;
            const r = el.getBoundingClientRect();
            startX = e.touches[0].clientX - r.left;
            startY = e.touches[0].clientY - r.top;
            panels.forEach(p => (p.style.zIndex = 10));
            el.style.zIndex = 20;
        }, { passive: true });
    });

    window.addEventListener('mousemove', e => {
        if (!dragged) return;
        dragged.style.left = (e.clientX - startX) + 'px';
        dragged.style.top  = (e.clientY - startY) + 'px';
    });

    window.addEventListener('touchmove', e => {
        if (!dragged) return;
        dragged.style.left = (e.touches[0].clientX - startX) + 'px';
        dragged.style.top  = (e.touches[0].clientY - startY) + 'px';
    }, { passive: true });

    window.addEventListener('mouseup',  () => { dragged = null; document.body.style.userSelect = 'auto'; });
    window.addEventListener('touchend', () => { dragged = null; });

    // ── Tweakpane ───────────────────────────────────────────

    const lenses = { main: lensMain, circle: lensCircle, pill: lensPill };

    const PARAMS = {
        lens: 'main',
        smoothness: 10.0,
        edgeSpread: 20.0,
        frosted: 3.0,
        pinch: 5.0,
        chroma: 0.7,
        turbulence: 0.0,
        liquidity: 0.0,
    };

    function syncParamsFromLens(lensKey) {
        const lens = weblg.getLens(lenses[lensKey]);
        if (lens) {
            PARAMS.smoothness = lens.smoothness;
            PARAMS.edgeSpread = lens.edgeSpread;
            PARAMS.frosted = lens.frosted;
            PARAMS.pinch = lens.pinch;
            PARAMS.chroma = lens.chroma;
            PARAMS.turbulence = lens.turbulence;
            PARAMS.liquidity = lens.liquidity;
        }
    }

    function applyParamsToLens(lensKey) {
        weblg.updateLens(lenses[lensKey], {
            smoothness: PARAMS.smoothness,
            edgeSpread: PARAMS.edgeSpread,
            frosted: PARAMS.frosted,
            pinch: PARAMS.pinch,
            chroma: PARAMS.chroma,
            turbulence: PARAMS.turbulence,
            liquidity: PARAMS.liquidity,
        });
    }

    const settingsWrapper = document.createElement('div');
    settingsWrapper.className = 'settings-wrapper';
    document.body.appendChild(settingsWrapper);

    const settingsOverlay = document.createElement('div');
    settingsOverlay.className = 'settings-overlay settings-overlay-hidden';
    settingsOverlay.innerHTML = `
        <p class="settings-overlay-title">Note</p>
        <p class="settings-overlay-text">Not all parameter combinations produce optimal results. Adjust the sliders to suit your use case.</p>
        <button type="button" class="settings-overlay-ok">Got it</button>
    `;
    settingsWrapper.appendChild(settingsOverlay);

    let warningAlreadyDismissed = false;

    settingsOverlay.querySelector('.settings-overlay-ok').addEventListener('click', () => {
        settingsOverlay.classList.add('settings-overlay-hidden');
        warningAlreadyDismissed = true;
    });

    const pane = new Tweakpane.Pane({ title: 'Shaders Settings', expanded: false, container: settingsWrapper });

    settingsWrapper.addEventListener('click', (e) => {
        if (warningAlreadyDismissed) return;
        if (e.target.closest('.settings-overlay')) return;
        const check = () => {
            if (settingsWrapper.offsetHeight > 55) {
                settingsOverlay.classList.remove('settings-overlay-hidden');
            }
        };
        setTimeout(check, 0);
        setTimeout(check, 100);
        setTimeout(check, 250);
    });

    pane.addInput(PARAMS, 'lens', {
        options: { Main: 'main', Circle: 'circle', Pill: 'pill' },
        label: 'Lens',
    });
    pane.addInput(PARAMS, 'smoothness', { min: 0, max: 20,   label: 'Corner Radius' });
    pane.addInput(PARAMS, 'edgeSpread', { min: 0, max: 200,  label: 'Thickness (px)' });
    pane.addInput(PARAMS, 'frosted',    { min: 0, max: 50,   step: 0.1, label: 'Blur' });
    pane.addInput(PARAMS, 'pinch',      { min: 0, max: 30,   step: 0.1, label: 'Border Pinch' });
    pane.addInput(PARAMS, 'chroma',     { min: 0, max: 2,    step: 0.01, label: 'Chroma' });

    const folder = pane.addFolder({ title: 'Liquid Animation' });
    folder.addInput(PARAMS, 'turbulence', { min: 0, max: 20 });
    folder.addInput(PARAMS, 'liquidity',  { min: 0, max: 1, step: 0.01 });

    pane.addButton({ title: 'Default config' }).on('click', () => {
        Object.assign(PARAMS, { ...LENS_DEFAULTS, lens: PARAMS.lens });
        weblg.updateLens(lensMain, LENS_DEFAULTS);
        weblg.updateLens(lensCircle, LENS_DEFAULTS);
        weblg.updateLens(lensPill, LENS_DEFAULTS);
        pane.refresh();
    });

    let prevLens = PARAMS.lens;
    pane.on('change', () => {
        if (PARAMS.lens !== prevLens) {
            prevLens = PARAMS.lens;
            syncParamsFromLens(PARAMS.lens);
            pane.refresh();
        } else {
            applyParamsToLens(PARAMS.lens);
        }
    });

    // ── Resize ──────────────────────────────────────────────

    window.addEventListener('resize', () => {
        const w = window.innerWidth;
        const h = window.innerHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        renderTarget.setSize(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
        updateBackgroundCover();
        if (!dragged) applyLayout();
    });

    // ── Render Loop ─────────────────────────────────────────

    function animate(t) {
        const time = t * 0.001;

        torusKnot.rotation.x = time * 0.25;
        torusKnot.rotation.y = time * 0.4;

        spheres.forEach(({ mesh, angle }, i) => {
            const a = angle + time * 0.3;
            mesh.position.x = Math.cos(a) * 3.2;
            mesh.position.y = Math.sin(a) * 2.0;
            mesh.position.z = Math.sin(a * 0.7 + i);
        });

        renderer.setRenderTarget(renderTarget);
        renderer.clear();
        renderer.render(scene, camera);
        renderer.setRenderTarget(null);

        weblg.render(time);

        requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);
}

    init().catch((error) => {
        console.error('WebLG demo initialization failed:', error);
        showFatalOverlay(
            'Initialization failed',
            'The demo could not finish setup. Check the browser console for details.',
        );
    });
}
