// Demo optical profiles, independent of library defaults.
import { LENS_DEFAULTS } from '../src/shaders.js';

export const ORIGINAL_MAIN_DEFAULTS = Object.freeze({
    ...LENS_DEFAULTS,
    smoothness: 10,
    edgeSpread: 15.22,
    frosted: 17.4,
    pinch: 10.8,
    chroma: 2,
    turbulence: 0,
    liquidity: 0,
    borderRadius: null,
    rim: 0,
});
export const COMPONENT_PANEL_DEFAULTS = Object.freeze({
    ...ORIGINAL_MAIN_DEFAULTS,
    smoothness: 3.8,
});
export const ORIGINAL_CIRCLE_DEFAULTS = Object.freeze({ ...LENS_DEFAULTS, smoothness: 20 });
export const ORIGINAL_PILL_DEFAULTS = Object.freeze({ ...LENS_DEFAULTS });

export const ORIGINAL_FIELDS = Object.freeze([
    { key: 'smoothness', label: 'Corner Radius', min: 0, max: 20, step: 0.1, unit: '' },
    { key: 'edgeSpread', label: 'Thickness (px)', min: 0, max: 200, step: 0.01, unit: 'px' },
    { key: 'frosted', label: 'Blur', min: 0, max: 50, step: 0.1, unit: '' },
    { key: 'pinch', label: 'Border Pinch', min: 0, max: 30, step: 0.1, unit: '' },
    { key: 'chroma', label: 'Chroma', min: 0, max: 2, step: 0.01, unit: '' },
    {
        key: 'turbulence',
        label: 'turbulence',
        min: 0,
        max: 20,
        step: 0.1,
        unit: '',
        section: 'liquid',
    },
    {
        key: 'liquidity',
        label: 'liquidity',
        min: 0,
        max: 1,
        step: 0.01,
        unit: '',
        section: 'liquid',
    },
]);
