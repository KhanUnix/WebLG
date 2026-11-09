import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadShaders } from '../src/shaders.js';

test('concurrent instances share shader requests and subsequent instances reuse the result', async (t) => {
    const urls = [];
    t.mock.method(globalThis, 'fetch', async (url) => {
        urls.push(url);
        return { ok: true, text: async () => `source:${url}` };
    });
    const first = loadShaders('/shared-shaders');
    const second = loadShaders('/shared-shaders/');
    assert.equal(first, second);
    const result = await first;
    assert.equal(await loadShaders('/shared-shaders/'), result);
    assert.deepEqual(urls, ['/shared-shaders/base.vert', '/shared-shaders/glass.frag']);
    assert.match(result.fragmentShader, /glass\.frag$/);
});

test('a failed shader load can be retried', async (t) => {
    let broken = true;
    t.mock.method(globalThis, 'fetch', async (url) => ({
        ok: !broken,
        status: 503,
        statusText: 'Unavailable',
        text: async () => url,
    }));
    await assert.rejects(loadShaders('/retry-shaders'), /HTTP 503/);
    broken = false;
    assert.equal((await loadShaders('/retry-shaders')).vertexShader, '/retry-shaders/base.vert');
});

test('different shader paths remain independent', async (t) => {
    t.mock.method(globalThis, 'fetch', async (url) => ({ ok: true, text: async () => url }));
    const [one, two] = await Promise.all([loadShaders('/one'), loadShaders('/two')]);
    assert.notEqual(one.fragmentShader, two.fragmentShader);
});
