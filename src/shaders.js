export const MAX_LENSES = 16;

export const LENS_DEFAULTS = {
    smoothness: 10.0,
    edgeSpread: 20.0,
    frosted: 3.0,
    pinch: 5.0,
    chroma: 0.7,
    turbulence: 0.0,
    liquidity: 0.0,
};

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
export async function loadShaders(basePath = getDefaultShadersPath()) {
    const base = basePath.endsWith('/') ? basePath : basePath + '/';
    const bust = '?t=' + Date.now();
    const fetchText = async (url) => {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`WebLG failed to load shader: ${url} (HTTP ${response.status} ${response.statusText})`);
        }
        return response.text();
    };
    const [vertexShader, fragmentShader] = await Promise.all([
        fetchText(base + 'base.vert' + bust),
        fetchText(base + 'glass.frag' + bust),
    ]);
    return { vertexShader, fragmentShader };
}
