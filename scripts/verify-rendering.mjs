import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = http.createServer(async (req, res) => {
    try {
        const pathname = new URL(req.url, 'http://localhost').pathname;
        if (pathname === '/') {
            res.setHeader('Content-Type', 'text/html');
            return res.end('<!doctype html><html><head><meta charset="utf-8"><title>WebLG rendering checks</title><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js"}}</script></head><body></body></html>');
        }
        const filename = path.resolve(root, '.' + pathname);
        if (!filename.startsWith(root)) throw new Error('outside root');
        const payload = await readFile(filename);
        res.setHeader('Content-Type', filename.endsWith('.js') ? 'text/javascript' : 'text/plain');
        res.end(payload);
    } catch {
        res.writeHead(404).end();
    }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
    const args = ['--no-sandbox'];
    if (process.env.WEBLG_SOFTWARE_GL === '1') args.push('--enable-unsafe-swiftshader', '--use-angle=swiftshader');
    browser = await chromium.launch({
        headless: true,
        args,
        ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    });
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    if (process.argv.includes('--stage-only')) {
        const stage = await page.evaluate(async () => (await import('/test/stage-checks.js')).verify());
        const edgeAntialias = await page.evaluate(async () => (await import('/test/edge-aa-checks.js')).verify());
        const benchmark = await page.evaluate(async () => (await import('/test/stage-checks.js')).benchmark());
        console.log(JSON.stringify({ stage, edgeAntialias, benchmark }, null, 2));
    } else if (!process.argv.includes('--benchmark-only')) {
        const checks = await page.evaluate(async () => (await import('/test/render-checks.js')).verify());
        console.log(JSON.stringify({
            comparisons: checks.length,
            maximumChannelDelta: Math.max(...checks.map((check) => check.maxDelta)),
            maximumMeanDelta: Math.max(...checks.map((check) => check.meanDelta)),
            ...(process.argv.includes('--verbose') ? { checks } : {}),
        }, null, 2));
    }
    if (process.argv.some((argument) => argument.startsWith('--benchmark'))) {
        const benchmark = await page.evaluate(async () => (await import('/test/render-checks.js')).benchmark());
        console.log(JSON.stringify({ benchmark }, null, 2));
    }
    assert.equal(errors.length, 0, errors.join('\n'));
} finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
}
