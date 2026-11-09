export const MAX_LENSES = 16;

export const LENS_DEFAULTS = {
    smoothness: 10.0,
    edgeSpread: 20.0,
    frosted: 3.0,
    pinch: 5.0,
    chroma: 0.7,
    turbulence: 0.0,
    liquidity: 0.0,
    borderRadius: null,
    rim: 0.0,
    rimWidth: 1.25,
};

const shaderLoads = new Map();

/**
 * Default shaders path when used as npm package (import.meta.url relative).
 * Falls back to './shaders/' when not in a module context.
 */
export function getDefaultShadersPath() {
    try {
        return new URL('./shaders/', import.meta.url).href;
    } catch {
        return './shaders/';
    }
}

/**
 * Fetch vertex + fragment shaders from a base path.
 * @param {string} basePath  Directory containing base.vert and glass.frag
 * @returns {Promise<{vertexShader: string, fragmentShader: string}>}
 */
export function loadShaders(basePath = getDefaultShadersPath()) {
    const base = basePath.endsWith('/') ? basePath : basePath + '/';
    if (shaderLoads.has(base)) return shaderLoads.get(base);
    const fetchText = async (url) => {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`WebLG failed to load shader: ${url} (HTTP ${response.status} ${response.statusText})`);
        }
        return response.text();
    };
    const pending = Promise.all([
        fetchText(base + 'base.vert'),
        fetchText(base + 'glass.frag'),
    ]).then(([vertexShader, fragmentShader]) => ({ vertexShader, fragmentShader })).catch((error) => {
        // A temporary network failure must not poison subsequent attempts.
        shaderLoads.delete(base);
        throw error;
    });
    shaderLoads.set(base, pending);
    return pending;
}

// Optical presets: UI colour and accessibility remain the host's responsibility.
export const GLASS_PRESETS = Object.freeze({
    clear: Object.freeze({ frosted: 0, pinch: 1.2, edgeSpread: 12, chroma: 0.12, rim: 0.58, rimWidth: 1.25 }),
    satin: Object.freeze({ frosted: 3, pinch: 1.6, edgeSpread: 15, chroma: 0.18, rim: 0.62, rimWidth: 1.25 }),
    frosted: Object.freeze({ frosted: 7, pinch: 1.3, edgeSpread: 18, chroma: 0.12, rim: 0.5, rimWidth: 1.25 }),
    tinted: Object.freeze({ frosted: 2, pinch: 1.5, edgeSpread: 14, chroma: 0.2, rim: 0.6, rimWidth: 1.25 }),
});
