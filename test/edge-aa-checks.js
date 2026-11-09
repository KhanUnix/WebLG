import { WebLG } from '../src/WebLG.js';
import { loadShaders } from '../src/shaders.js';

const check = (value, message) => {
    if (!value) throw new Error(message);
};

export async function verify() {
    const shaders = await loadShaders();
    const results = [];
    for (const kind of ['webgl', 'webgl2'])
        for (const dpr of [1, 2]) {
            const canvas = document.createElement('canvas');
            const width = 80,
                height = 70;
            canvas.width = width * dpr;
            canvas.height = height * dpr;
            canvas.style.cssText = `width:${width}px;height:${height}px`;
            document.body.append(canvas);
            const gl = canvas.getContext(kind, { antialias: false, premultipliedAlpha: false });
            check(gl, `${kind} unavailable`);
            const texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texImage2D(
                gl.TEXTURE_2D,
                0,
                gl.RGBA,
                1,
                1,
                0,
                gl.RGBA,
                gl.UNSIGNED_BYTE,
                new Uint8Array([0, 0, 0, 255]),
            );
            const rect = { x: 12.25, y: 10.25, width: 50, height: 46 };
            const read = (aa) => {
                const renderer = new WebLG(gl, shaders.vertexShader, shaders.fragmentShader, {
                    dpr,
                    antialiasEdges: aa,
                });
                renderer.setBackground(texture);
                renderer.addLens({
                    rect,
                    borderRadius: 16,
                    frosted: 0,
                    pinch: 0,
                    chroma: 0,
                    rim: 1,
                    rimWidth: 2,
                });
                renderer.render();
                const pixels = new Uint8Array(canvas.width * canvas.height * 4);
                gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
                renderer.dispose();
                return pixels;
            };
            try {
                const hard = read(false),
                    soft = read(true);
                let outsideCoverage = 0,
                    changed = 0;
                for (let y = 0; y < canvas.height; y++)
                    for (let x = 0; x < canvas.width; x++) {
                        // Geometric rounded-box distance, independent of renderer internals.
                        const px = (x + 0.5) / dpr - rect.x - rect.width / 2;
                        const py = height - (y + 0.5) / dpr - rect.y - rect.height / 2;
                        const qx = Math.abs(px) - rect.width / 2 + 16,
                            qy = Math.abs(py) - rect.height / 2 + 16;
                        const distance =
                            (Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
                                Math.min(Math.max(qx, qy), 0) -
                                16) *
                            dpr;
                        const at = (y * canvas.width + x) * 4;
                        for (let channel = 0; channel < 3; channel++) {
                            const delta = Math.abs(hard[at + channel] - soft[at + channel]);
                            if (Math.abs(distance) > 1)
                                check(delta <= 1, 'AA changed pixels away from the contour');
                            if (delta > 1) changed++;
                        }
                        if (distance > 0 && soft[at] > 0 && hard[at] === 0) outsideCoverage++;
                    }
                check(
                    changed > 10 && outsideCoverage > 2,
                    'no subpixel coverage along rounded edges',
                );
                check(gl.getError() === 0, 'edge AA WebGL error');
                results.push({ kind, dpr, changedChannels: changed, outsideCoverage });
            } finally {
                gl.deleteTexture(texture);
                gl.getExtension('WEBGL_lose_context')?.loseContext();
                canvas.remove();
            }
        }
    return results;
}
