import { WebLGStage } from '../src/stage.js';
import { WebLGUI } from '../src/ui.js';
import { GLASS_PRESETS } from '../src/shaders.js';
import { installPerformanceCheck } from './performance.js';
import {
    ORIGINAL_MAIN_DEFAULTS,
    COMPONENT_PANEL_DEFAULTS,
    ORIGINAL_CIRCLE_DEFAULTS,
    ORIGINAL_PILL_DEFAULTS,
    ORIGINAL_FIELDS,
} from './original-settings.js';

const $ = (selector) => document.querySelector(selector);
const host = $('#scene');
const copySelectedButton = $('#copy-selected-parameters');
const state = {
    background: 'photo',
    material: 'original',
    animate: false,
    intensity: 50,
    time: 0,
    customImage: false,
    view: 'explore',
};
const labels = {
    photo: 'Natural light',
    texture: 'Contrast & detail',
    shapes: 'Shapes & colour',
    mixed: 'Lines in the landscape',
};
let selected,
    ui,
    animationFrame = 0,
    decorElapsed = 0,
    toastTimer,
    imageURL;
const image = new Image();
image.decoding = 'async';
image.src = 'assets/landscape.jpg';
const stage = await WebLGStage.create(host, {
    onError: (error) => {
        console.warn('WebLG compatible rendering:', error.message);
    },
    onStatus: () => status(),
});
ui = new WebLGUI(stage, { onSelect: (record) => select(record) });
const defaultRadii = new Map();
const originalDefaults = new Map();
const themeChoice = $('#theme-choice');
function appearance(value) {
    const theme = value === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    host.dataset.wlgTheme = theme;
    themeChoice.value = theme;
    $('meta[name="theme-color"]').content = theme === 'dark' ? '#151517' : '#f5f5f7';
    try {
        localStorage.setItem('weblg-appearance', theme);
    } catch {}
    stage.invalidate();
}
appearance(document.documentElement.dataset.theme);
themeChoice.addEventListener('change', () => appearance(themeChoice.value));
const presetNames = {
    original: 'Original',
    clear: 'Clear',
    satin: 'Satin',
    frosted: 'Frosted',
    tinted: 'Tinted',
};

function icon(name) {
    const paths = {
        move: '<path d="M12 3v18M3 12h18m-12-6 3-3 3 3m-9 9-3-3 3-3m9 9-3 3-3-3m9-9 3 3-3 3"/>',
        more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
        copy: '<rect x="8" y="8" width="12" height="13" rx="3"/><path d="M15 8V6a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h2"/>',
        recenter:
            '<rect x="6" y="6" width="12" height="12" rx="3"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>',
    };
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.55');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    // Only fixed, authored SVG paths are inserted here; never user input.
    svg.innerHTML = paths[name];
    return svg;
}

const panel = $('#glass-console');
const panelSurface = ui.surface(panel, {
    layer: 0,
    label: 'Floating panel',
    ...COMPONENT_PANEL_DEFAULTS,
});
const dragButton = ui.button({
    icon: icon('move'),
    ariaLabel: 'Move the panel with the arrow keys',
    glass: false,
});
dragButton.element.classList.add('drag-handle');
dragButton.element.title = 'Move the panel · Arrow keys';
$('#console-tools').append(dragButton.element);
const draggable = ui.draggable(panel, dragButton.element, { bottom: 100 });
const probes = [
    { name: 'Disc', className: 'probe-circle', radius: 999, x: 0.2, y: 0.3 },
    { name: 'Capsule', className: 'probe-pill', radius: 39, x: 0.7, y: 0.24 },
    {
        name: 'Rectangle',
        className: 'probe-square',
        radius: 28,
        x: 0.53,
        y: 0.66,
    },
].map((definition, index) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = `glass-probe ${definition.className}`;
    element.setAttribute('aria-label', `Move: ${definition.name}`);
    element.setAttribute('aria-describedby', 'drag-help');
    element.title = `${definition.name} · Drag or use the arrow keys`;
    element.append(icon('move'));
    element.style.left = `${definition.x * 100}%`;
    element.style.top = `${definition.y * 100}%`;
    element.style.transform = 'translate(-50%, -50%)';
    host.append(element);
    const surface = ui.surface(element, {
        label: `Free ${definition.name.toLowerCase()}`,
        layer: index + 2,
        borderRadius: definition.radius,
    });
    const drag = ui.draggable(element, element, { padding: 16, bottom: 100 });
    return { element, surface, drag, definition };
});
function resetPositions() {
    const currentView = host.dataset.view;
    host.dataset.view = 'components';
    draggable.recenter();
    host.dataset.view = 'explore';
    for (const { element, definition } of probes) {
        const x = definition.x * host.clientWidth - element.offsetWidth / 2;
        const y = definition.y * host.clientHeight - element.offsetHeight / 2;
        element.style.transform = 'none';
        element.style.left = `${Math.max(16, Math.min(host.clientWidth - element.offsetWidth - 16, x))}px`;
        element.style.top = `${Math.max(16, Math.min(host.clientHeight - element.offsetHeight - 100, y))}px`;
    }
    host.dataset.view = currentView;
    stage.invalidate();
}
function view(name) {
    if (!['explore', 'components'].includes(name)) return;
    state.view = name;
    host.dataset.view = name;
    document
        .querySelectorAll('.scene-views button')
        .forEach((button) =>
            button.setAttribute('aria-pressed', String(button.dataset.view === name)),
        );
    $('#drag-help').textContent =
        name === 'explore'
            ? 'Drag the three glass shapes across the background. Keyboard: arrow keys to move, Shift for precision, Home to center.'
            : 'Drag the panel by its handle. All controls work with a mouse, touch or keyboard.';
    select(name === 'explore' ? probes[2].surface : panelSurface);
    stage.invalidate();
}
document
    .querySelectorAll('.scene-views button')
    .forEach((button) => button.addEventListener('click', () => view(button.dataset.view)));
$('#reset-positions').addEventListener('click', resetPositions);
const materialControl = ui.segmentedControl({
    label: 'Scene material',
    items: [
        { value: 'original', label: 'Original' },
        { value: 'clear', label: 'Clear' },
        { value: 'satin', label: 'Satin' },
        { value: 'frosted', label: 'Frosted' },
    ],
    value: state.material,
    onChange: (name) => material(name, true),
    layer: 1,
});
$('#material-control').append(materialControl.element);
materialControl.surface.label = 'Material selector';
const slider = ui.slider({
    label: 'Refraction strength',
    value: 50,
    min: 0,
    max: 100,
    onChange: (value) => {
        state.intensity = value;
        $('#intensity-output').value = `${value}%`;
        ui.surfaces.forEach((record) =>
            record.update({
                pinch:
                    (materialSettings(record, record.material ?? state.material).pinch * value) /
                    50,
            }),
        );
        syncInspector();
    },
});
$('#slider-slot').append(slider.element);
$('#intensity-label').htmlFor = slider.input.id;
slider.surface.label = 'Slider thumb';
$('#animation-label').textContent = 'Animate background';
const animationSwitch = ui.switch({
    label: 'Animate background',
    onChange: (value) => {
        // This switch is an explicit request to play the background, including
        // when the system preference prevents automatic/decorative animations.
        if (value) decorElapsed = 0;
        state.animate = value;
        scheduleAnimation();
    },
});
$('#switch-slot').append(animationSwitch.element);
animationSwitch.input.id = 'scene-animation';
animationSwitch.input.setAttribute('aria-describedby', 'animation-status');
$('#animation-label').htmlFor = animationSwitch.input.id;
animationSwitch.surface.label = 'Switch';
const copyButton = ui.button({
    label: 'Copy style',
    prominent: true,
    icon: icon('copy'),
    onClick: () => copyStyle(),
    layer: 1,
});
copyButton.surface.label = 'Primary button';
const recenterButton = ui.button({
    label: 'Center',
    onClick: () => {
        draggable.recenter();
        toast('Panel centered.');
    },
    layer: 1,
});
recenterButton.surface.label = 'Secondary button';
$('#console-actions').append(copyButton.element, recenterButton.element);
const tabs = ui.tabs({
    label: 'Scene background',
    panelId: 'scene-content',
    items: [
        { value: 'photo', label: 'Landscape' },
        { value: 'texture', label: 'Texture' },
        { value: 'shapes', label: 'Shapes' },
        { value: 'mixed', label: 'Mixed' },
    ],
    value: 'photo',
    onChange: background,
    layer: 1,
});
$('#scene-tabs').append(tabs.element);
const tabsSurface = ui.surface($('#scene-tabs'), {
    label: 'Tab bar',
    layer: 0,
});
tabs.surface.label = 'Tab selection';
const menu = ui.menu({
    label: 'Scene actions',
    icon: icon('more'),
    items: [
        { label: 'Copy configuration', onSelect: () => copyStyle() },
        { label: 'View component code', onSelect: () => showDocs() },
        'separator',
        { label: 'Center the panel', onSelect: () => draggable.recenter() },
        { label: 'Reset scene', onSelect: resetScene },
    ],
});
$('#console-tools').append(menu.element);
menu.surface.layer = 5;
probes[0].surface.label = 'Circle · Disc';
probes[1].surface.label = 'Pill · Capsule';
probes[2].surface.label = 'Main · Rectangle';
for (const record of ui.surfaces.values()) {
    defaultRadii.set(record.id, record.element.style.borderRadius);
    const defaults =
        record === panelSurface
            ? COMPONENT_PANEL_DEFAULTS
            : record === probes[2].surface
              ? ORIGINAL_MAIN_DEFAULTS
              : record === probes[0].surface
                ? ORIGINAL_CIRCLE_DEFAULTS
                : ORIGINAL_PILL_DEFAULTS;
    originalDefaults.set(record.id, defaults);
    restoreOriginal(record);
}
function materialSettings(record, name) {
    return name === 'original' ? originalDefaults.get(record.id) : GLASS_PRESETS[name];
}
function restoreOriginal(record) {
    record.element.style.borderRadius = defaultRadii.get(record.id) ?? '';
    record.update(originalDefaults.get(record.id));
    record.material = 'original';
    record.element.dataset.wlgMaterial = 'original';
}

const selector = $('#component-select');
selector.replaceChildren();
for (const record of [
    probes[2].surface,
    probes[0].surface,
    probes[1].surface,
    ...[...ui.surfaces.values()].filter(
        (record) => !probes.some((probe) => probe.surface === record),
    ),
]) {
    const option = document.createElement('option');
    option.value = record.id;
    option.textContent = record.label;
    selector.append(option);
}
selector.addEventListener('change', () => {
    const record = ui.surfaces.get(selector.value);
    if (probes.some((probe) => probe.surface === record)) view('explore');
    else if (record !== tabsSurface && record !== tabs.surface) view('components');
    if (record === menu.surface && menu.panel.hidden) menu.open(false);
    select(record);
});

const definitions = [
    ...ORIGINAL_FIELDS,
    { key: 'rim', label: 'Edge highlight', min: 0, max: 1, step: 0.01, unit: '', advanced: true },
    {
        key: 'rimWidth',
        label: 'Highlight width',
        min: 0.5,
        max: 3,
        step: 0.125,
        unit: 'px',
        advanced: true,
    },
    {
        key: 'lightAngle',
        label: 'Light direction',
        min: 0,
        max: 360,
        step: 15,
        unit: '°',
        advanced: true,
    },
];
const fields = new Map();
for (const definition of definitions) {
    const container = document.createElement('div');
    container.className = 'setting';
    const row = document.createElement('div');
    row.className = 'setting-label';
    const label = document.createElement('label');
    label.htmlFor = `setting-${definition.key}`;
    label.textContent = definition.label;
    const group = document.createElement('span');
    group.className = 'setting-value';
    const number = document.createElement('input');
    number.type = 'number';
    number.setAttribute('aria-label', `Value: ${definition.label.toLowerCase()}`);
    const range = document.createElement('input');
    range.type = 'range';
    range.id = `setting-${definition.key}`;
    for (const input of [number, range]) {
        input.min = definition.min;
        input.max = definition.max;
        input.step = definition.step;
    }
    const unit = document.createElement('span');
    unit.textContent = definition.unit;
    group.append(number, unit);
    row.append(label, group);
    container.append(row, range);
    $(
        definition.section === 'liquid'
            ? '#liquid-settings'
            : definition.advanced
              ? '#advanced-settings'
              : '#optical-settings',
    ).append(container);
    const apply = (value) => {
        if (!selected || !Number.isFinite(value)) return;
        value = Math.max(definition.min, Math.min(definition.max, value));
        if (definition.key === 'lightAngle') stage.setLightAngle(value);
        else {
            selected.update({
                [definition.key]: value,
                ...(definition.key === 'smoothness' ? { borderRadius: null } : {}),
            });
            selected.material = null;
        }
        range.value = value;
        number.value = value;
        uncheckCustom();
        scheduleAnimation();
    };
    range.addEventListener('input', () => apply(range.valueAsNumber));
    number.addEventListener('input', () => {
        if (number.value !== '') apply(number.valueAsNumber);
    });
    number.addEventListener('change', syncInspector);
    fields.set(definition.key, { number, range });
}

function select(record) {
    if (!record) return;
    stage.syncLegacyCorners(record);
    selected = record;
    ui.select(record);
    if (selector?.options.length > 1) selector.value = record.id;
    if (fields?.size) syncInspector();
}
function uncheckCustom() {
    document.querySelectorAll('input[name=material]').forEach((input) => {
        input.checked = input.value === selected?.material;
    });
}
function syncInspector() {
    copySelectedButton.disabled = !selected || !ui.surfaces.has(selected.id);
    if (copySelectedButton.disabled) return;
    copySelectedButton.title = `Copy parameters for ${selected.label}`;
    for (const [key, controls] of fields) {
        let value = key === 'lightAngle' ? stage.lightAngle : (selected.config[key] ?? 0);
        controls.range.value = value;
        controls.number.value = Number(value.toFixed(3));
    }
    uncheckCustom();
}
function material(name, all = false) {
    if (name !== 'original' && !GLASS_PRESETS[name]) return;
    if (all) {
        state.material = name;
        state.intensity = 50;
        if (name !== 'original') ui.setMaterial(name);
        host.dataset.wlgMaterial = name;
        ui.surfaces.forEach((record) => {
            record.update(materialSettings(record, name));
            record.material = name;
            record.element.dataset.wlgMaterial = name;
        });
        slider.setValue(50);
        $('#intensity-output').value = '50%';
        if (name !== 'tinted') materialControl.setValue(name);
    } else if (selected) {
        selected.material = name;
        selected.update(materialSettings(selected, name));
        selected.element.dataset.wlgMaterial = name;
    }
    syncInspector();
}
document
    .querySelectorAll('input[name=material]')
    .forEach((input) => input.addEventListener('change', () => material(input.value)));
function background(name) {
    if (!labels[name]) return;
    state.background = name;
    host.dataset.background = name;
    tabs.setValue(name);
    $('#scene-caption').textContent =
        state.customImage && ['photo', 'mixed'].includes(name)
            ? 'Your image, your material'
            : labels[name];
    const descriptions = {
        photo: 'A landscape photograph behind the glass controls.',
        texture: 'Fine grid lines, typography and high-contrast marks reveal refraction.',
        shapes: 'Blue and terracotta volumes, circles and contrasting bands behind the controls.',
        mixed: 'Lines and a coloured volume overlay the photograph.',
    };
    $('#scene-description').textContent =
        `${descriptions[name]} Move the glass shapes or panel with a mouse, touch or the arrow keys.`;
    document
        .querySelectorAll('.background-option')
        .forEach((button) =>
            button.setAttribute('aria-pressed', String(button.dataset.background === name)),
        );
    stage.invalidateBackground();
}
document
    .querySelectorAll('.background-option')
    .forEach((button) =>
        button.addEventListener('click', () => background(button.dataset.background)),
    );
$('#reset').addEventListener('click', () => {
    if (!selected) return;
    restoreOriginal(selected);
    syncInspector();
    scheduleAnimation();
    toast('Default config restored.');
});
function resetScene() {
    material('original', true);
    background('photo');
    state.animate = false;
    animationSwitch.setValue(false);
    scheduleAnimation();
    ui.surfaces.forEach((record) => {
        record.element.style.borderRadius = defaultRadii.get(record.id) ?? '';
        restoreOriginal(record);
    });
    stage.setLightAngle(135);
    stage.setEffects(true);
    $('#compare').setAttribute('aria-pressed', 'false');
    $('#comparison-badge').hidden = true;
    resetPositions();
    view(state.view);
    toast('The scene has been reset.');
}
function compare(value) {
    stage.setEffects(!value);
    $('#compare').setAttribute('aria-pressed', String(value));
    $('#comparison-badge').hidden = !value;
    status();
}
$('#compare').addEventListener('click', () => compare(stage.effects));
let spaceComparison = null;
document.addEventListener('keydown', (event) => {
    if (
        event.code !== 'Space' ||
        event.repeat ||
        $('#documentation').open ||
        event.target.closest('input,textarea,select,button,a,[contenteditable=true]')
    )
        return;
    event.preventDefault();
    spaceComparison = stage.effects;
    compare(true);
});
function endComparison() {
    if (spaceComparison != null) {
        compare(!spaceComparison);
        spaceComparison = null;
    }
}
document.addEventListener('keyup', (event) => {
    if (event.code === 'Space') endComparison();
});
window.addEventListener('blur', endComparison);
$('#solid-mode').addEventListener('change', (event) => {
    stage.setSolid(event.target.checked);
    status();
});
function status() {
    const text = stage?.opaque
        ? 'Reduced transparency'
        : stage?.mode === 'fallback'
          ? 'Compatibility mode'
          : stage?.effects === false
            ? 'Comparing without glass'
            : 'Live rendering';
    if ($('#render-status').textContent !== text) $('#render-status').textContent = text;
}
function toast(message) {
    $('#toast-message').textContent = message;
    $('#toast').hidden = false;
}
$('#toast-close').addEventListener('click', () => {
    $('#toast').hidden = true;
});
function configuration() {
    const { label, layer, ...config } = selected?.config ?? {};
    return {
        component: selected?.label ?? 'Panel',
        layer: selected?.layer ?? 0,
        material: config,
        lightAngle: stage.lightAngle,
    };
}
copySelectedButton.addEventListener('click', async () => {
    if (!selected || !ui.surfaces.has(selected.id)) return;
    const { lightAngle, ...material } = Object.fromEntries(
        definitions.map(({ key }) => [key, Number(fields.get(key).number.value)]),
    );
    const text = JSON.stringify({ component: selected.label, material, lightAngle }, null, 2);
    try {
        await navigator.clipboard.writeText(text);
        toast('Selected parameters copied.');
    } catch {
        showDocs(text);
        toast('Select the parameters to copy them.');
    }
});
async function copyStyle() {
    const text = JSON.stringify(
        {
            material: state.material,
            lightAngle: stage.lightAngle,
            components: [...ui.surfaces.values()].map((record) => ({
                component: record.label,
                layer: record.layer,
                ...record.config,
            })),
        },
        null,
        2,
    );
    try {
        await navigator.clipboard.writeText(text);
        toast('Configuration copied.');
    } catch {
        showDocs(text);
        toast('Select the code to copy it.');
    }
}
function showDocs(override) {
    const config = configuration();
    $('#code-preview').textContent =
        typeof override === 'string'
            ? override
            : `import { WebLGStage } from 'weblg/stage';\nimport { WebLGUI } from 'weblg/ui';\nimport 'weblg/ui.css';\n\nconst host = document.querySelector('.scene');\nconst stage = await WebLGStage.create(host);\nconst ui = new WebLGUI(stage);\n\nconst image = new Image();\nimage.src = '/my-landscape.jpg';\nawait image.decode();\nstage.setPainter((ctx, w, h) => {\n  ctx.drawImage(image, 0, 0, w, h);\n});\n\nconst button = ui.button({\n  label: 'Continue',\n  onClick: () => console.log('Continue'),\n});\nhost.append(button.element);\n\n// Selected component settings: ${config.component}\nbutton.surface.update(${JSON.stringify(config.material, null, 2)});\n\n// Cleanup:\n// ui.destroy(); stage.destroy();`;
    if (!$('#documentation').open) $('#documentation').showModal();
}
$('#open-docs').addEventListener('click', () => showDocs());
$('#show-code').addEventListener('click', () => showDocs());
$('#copy-code').addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText($('#code-preview').textContent);
        toast('Code copied.');
    } catch {
        toast('Select the code to copy it.');
    }
});
$('#documentation').addEventListener('click', (event) => {
    if (event.target === $('#documentation')) {
        const r = event.target.getBoundingClientRect();
        if (
            event.clientX < r.left ||
            event.clientX > r.right ||
            event.clientY < r.top ||
            event.clientY > r.bottom
        )
            event.target.close();
    }
});

function animationStatus() {
    $('#animation-status').textContent = state.animate
        ? 'Background is moving.'
        : stage.reducedMotion
          ? 'Stopped according to your preferences.'
          : 'Background motion.';
}
function scheduleAnimation() {
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    animationStatus();
    const animatedGlass =
        !stage.reducedMotion &&
        [...ui.surfaces.values()].some(
            ({ config }) => config.turbulence > 0 && config.liquidity > 0,
        );
    if (document.hidden || (!state.animate && !animatedGlass)) {
        stage.setBackgroundTransform();
        stage.invalidate();
        return;
    }
    let previousTime;
    const tick = (time) => {
        state.time = time * 0.001;
        if (state.animate) {
            if (previousTime !== undefined) decorElapsed += (time - previousTime) * 0.001;
            // A visible pan under the stationary glass, ramped in smoothly.
            // The offsets stay inside the zoom margin; no blank edges appear.
            const ramp = Math.min(1, decorElapsed / 0.35);
            const ease = ramp * ramp * (3 - 2 * ramp);
            stage.setBackgroundTransform(
                1 + 0.1 * ease,
                Math.sin(decorElapsed * 0.9) * 0.035 * ease,
                Math.sin(decorElapsed * 0.65) * 0.025 * ease,
            );
        } else stage.invalidate();
        previousTime = time;
        animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);
}
stage.motion.addEventListener('change', () => {
    if (stage.reducedMotion) {
        state.animate = false;
        animationSwitch.setValue(false);
    }
    scheduleAnimation();
});
document.addEventListener('visibilitychange', scheduleAnimation);
for (const query of [stage.transparency, stage.contrast, stage.forced])
    query.addEventListener('change', () => {
        $('#solid-mode').checked = stage.opaque;
        $('#solid-mode').disabled =
            stage.transparency.matches || stage.contrast.matches || stage.forced.matches;
        status();
    });

async function useImage(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
        toast('Choose an image file.');
        return;
    }
    const nextURL = URL.createObjectURL(file),
        next = new Image();
    next.src = nextURL;
    try {
        await next.decode();
        if (imageURL) URL.revokeObjectURL(imageURL);
        imageURL = nextURL;
        image.src = nextURL;
        await image.decode();
        state.customImage = true;
        background('photo');
        toast('Your image is ready. It stays in this browser.');
    } catch {
        URL.revokeObjectURL(nextURL);
        toast('This image could not be opened. Try a JPEG, PNG or WebP file.');
    }
}
$('#image-upload').addEventListener('change', (event) => useImage(event.target.files?.[0]));
host.addEventListener('dragover', (event) => {
    event.preventDefault();
    host.dataset.drop = '';
});
host.addEventListener('dragleave', () => {
    delete host.dataset.drop;
});
host.addEventListener('drop', (event) => {
    event.preventDefault();
    delete host.dataset.drop;
    useImage(event.dataTransfer.files?.[0]);
});

function cover(ctx, width, height, phase) {
    if (!image.complete || !image.naturalWidth) {
        const g = ctx.createLinearGradient(0, 0, width, height);
        g.addColorStop(0, '#b4c8ce');
        g.addColorStop(1, '#7d987c');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, width, height);
        return;
    }
    const zoom = 1;
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight) * zoom;
    const w = image.naturalWidth * scale,
        h = image.naturalHeight * scale;
    ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
}
function sphere(ctx, x, y, radius, colours) {
    const gradient = ctx.createRadialGradient(x - radius * 0.38, y - radius * 0.4, 0, x, y, radius);
    gradient.addColorStop(0, colours[0]);
    gradient.addColorStop(0.55, colours[1]);
    gradient.addColorStop(1, colours[2]);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
}
function shapes(ctx, w, h, phase, mixed = false) {
    const drift = state.animate ? Math.sin(phase * 0.35) : 0;
    const size = Math.min(w, h);
    ctx.save();
    if (mixed) ctx.globalAlpha = 0.74;
    sphere(ctx, w * 0.77 + drift * 15, h * 0.32, size * 0.18, ['#d7e5ed', '#799ebf', '#315979']);
    ctx.lineWidth = size * 0.065;
    ctx.strokeStyle = '#c27750';
    ctx.beginPath();
    ctx.ellipse(w * 0.24, h * 0.64 + drift * 12, size * 0.17, size * 0.13, -0.45, 0, Math.PI * 2);
    ctx.stroke();
    if (!mixed) {
        ctx.save();
        ctx.translate(w * 0.64, h * 0.72);
        ctx.rotate(-0.2 + drift * 0.03);
        ctx.fillStyle = '#c5cbbf';
        ctx.fillRect(-size * 0.24, -size * 0.07, size * 0.48, size * 0.14);
        ctx.strokeStyle = '#5a6356';
        ctx.lineWidth = 1.3;
        for (let x = -size * 0.23; x < size * 0.23; x += 7) {
            ctx.beginPath();
            ctx.moveTo(x, -size * 0.07);
            ctx.lineTo(x, size * 0.07);
            ctx.stroke();
        }
        ctx.restore();
    }
    ctx.restore();
}
function paint(ctx, width, height) {
    const phase = 0;
    if (['photo', 'mixed'].includes(state.background)) cover(ctx, width, height, phase);
    else if (state.background === 'texture') {
        ctx.fillStyle = '#e8ecec';
        ctx.fillRect(0, 0, width, height);
        for (let x = 0; x < width; x += 18) {
            ctx.strokeStyle = x % 90 === 0 ? '#7f929f' : '#bdc9ce';
            ctx.lineWidth = x % 90 === 0 ? 0.9 : 0.5;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }
        for (let y = 0; y < height; y += 18) {
            ctx.strokeStyle = y % 90 === 0 ? '#7f929f' : '#bdc9ce';
            ctx.lineWidth = y % 90 === 0 ? 0.9 : 0.5;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }
        ctx.fillStyle = '#395362';
        ctx.font = `500 ${Math.min(width * 0.24, 190)}px Georgia,serif`;
        ctx.fillText('Aa', width * 0.08, height * 0.43);
        ctx.font = '500 11px ui-monospace,monospace';
        for (let y = 72; y < height; y += 90) {
            ctx.fillText(`${String(y).padStart(3, '0')} — CONTRAST / LIGHT`, width * 0.56, y);
        }
        ctx.save();
        ctx.translate(width * 0.26, height * 0.71);
        ctx.rotate(-0.25);
        ctx.strokeStyle = '#547487';
        ctx.lineWidth = 2;
        for (let i = 0; i < 22; i++) {
            ctx.beginPath();
            ctx.moveTo(i * 9, -55);
            ctx.lineTo(i * 9, 85);
            ctx.stroke();
        }
        ctx.restore();
    } else {
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, '#e5e2dc');
        gradient.addColorStop(1, '#d8dce0');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
        shapes(ctx, width, height, phase);
    }
    if (state.background === 'mixed') {
        shapes(ctx, width, height, phase, true);
        ctx.save();
        ctx.strokeStyle = 'rgb(255 255 255 / .48)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 15; i++) {
            ctx.beginPath();
            ctx.ellipse(width * 0.4, height * 0.45, 70 + i * 20, 90 + i * 12, -0.4, 0.25, 3.5);
            ctx.stroke();
        }
        ctx.restore();
    }
    const shade = ctx.createLinearGradient(0, 0, 0, height * 0.22);
    shade.addColorStop(0, 'rgb(20 30 40 / .18)');
    shade.addColorStop(1, 'rgb(20 30 40 / 0)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, width, height * 0.22);
}
stage.setPainter(paint);
animationStatus();
view(state.view);
resetPositions();
status();
$('#solid-mode').checked = stage.opaque;
$('#solid-mode').disabled =
    stage.transparency.matches || stage.contrast.matches || stage.forced.matches;
try {
    await image.decode();
} catch {
    toast('The landscape is unavailable. You can still use the graphic backgrounds.');
}
stage.invalidateBackground();
host.addEventListener('wlgrender', () => {
    host.dataset.ready = 'true';
    status();
});
if (stage.mode === 'fallback') host.dataset.ready = 'true';
installPerformanceCheck(stage, host, probes, {
    pause: () => {
        cancelAnimationFrame(animationFrame);
        animationFrame = 0;
        stage.setBackgroundTransform();
        return scheduleAnimation;
    },
});
window.__WEBLG_STUDIO__ = {
    stage,
    ui,
    state,
    get selected() {
        return selected;
    },
    select,
    resetScene,
    background,
    material,
    slider,
    animationSwitch,
    tabs,
    menu,
    draggable,
    probes,
    view,
    appearance,
    resetPositions,
};
window.addEventListener('pagehide', (event) => {
    if (event.persisted || stage.destroyed) return;
    cancelAnimationFrame(animationFrame);
    clearTimeout(toastTimer);
    draggable.destroy();
    probes.forEach(({ drag }) => drag.destroy());
    ui.destroy();
    stage.destroy();
    if (imageURL) URL.revokeObjectURL(imageURL);
});
