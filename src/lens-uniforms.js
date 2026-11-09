import { MAX_LENSES } from './shaders.js';

export function createLensUniforms() {
    return {
        rects: new Float32Array(MAX_LENSES * 4),
        params0: new Float32Array(MAX_LENSES * 4),
        params1: new Float32Array(MAX_LENSES * 4),
    };
}

// Keep DOM measurements live: CSS transforms, scrolling and direct edits to
// getLens() must keep working without an explicit invalidation call.
export function writeLensUniforms(data, index, lens, dpr, cssHeight, canvasRect) {
    const offset = index * 4;
    const rects = data.rects;
    if (lens.element) {
        const rect = lens.element.getBoundingClientRect();
        rects[offset] = (rect.left - (canvasRect ? canvasRect.left : 0)) * dpr;
        rects[offset + 1] = ((canvasRect ? canvasRect.bottom : cssHeight) - rect.bottom) * dpr;
        rects[offset + 2] = rect.width * dpr;
        rects[offset + 3] = rect.height * dpr;
    } else if (lens.rect) {
        const rect = lens.rect;
        rects[offset] = rect.x * dpr;
        rects[offset + 1] = (cssHeight - rect.y - rect.height) * dpr;
        rects[offset + 2] = rect.width * dpr;
        rects[offset + 3] = rect.height * dpr;
    } else {
        rects.fill(0, offset, offset + 4);
    }

    const p0 = data.params0;
    // Negative smoothness encodes an explicit CSS corner radius. Legacy
    // smoothness and its auto-circle rule remain unchanged when omitted.
    p0[offset] = Number.isFinite(lens.borderRadius) ? -(Math.max(0, lens.borderRadius) * dpr + 1) : lens.smoothness;
    p0[offset + 1] = lens.edgeSpread;
    p0[offset + 2] = lens.frosted;
    p0[offset + 3] = lens.pinch;
    const p1 = data.params1;
    p1[offset] = lens.chroma;
    p1[offset + 1] = lens.turbulence;
    p1[offset + 2] = lens.liquidity;
    // Pack the optional white rim in the previously unused float: 8 bits of
    // intensity and an eighth-device-pixel width. No additional lens uniforms.
    const width = Math.min(31.875, Math.max(0, (lens.rimWidth ?? 1.25) * dpr));
    p1[offset + 3] = (lens.rim ?? 0) > 0
        ? Math.round(width * 8) * 256 + Math.round(Math.min(1, lens.rim) * 255) : 0;
}
