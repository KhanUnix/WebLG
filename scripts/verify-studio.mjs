import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const types = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.jpg': 'image/jpeg',
};
const server = http.createServer(async (req, res) => {
    try {
        const pathname = new URL(req.url, 'http://localhost').pathname;
        if (pathname === '/') {
            res.writeHead(302, { Location: '/demo/' }).end();
            return;
        }
        let filename = path.resolve(root, '.' + pathname);
        if (!filename.startsWith(root)) throw Error('outside root');
        if ((await stat(filename)).isDirectory()) filename = path.join(filename, 'index.html');
        res.setHeader('Content-Type', types[path.extname(filename)] ?? 'text/plain');
        res.end(await readFile(filename));
    } catch {
        res.writeHead(404).end();
    }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
    const args = ['--no-sandbox'];
    if (process.env.WEBLG_SOFTWARE_GL === '1')
        args.push('--enable-unsafe-swiftshader', '--use-angle=swiftshader');
    browser = await chromium.launch({
        headless: true,
        args,
        ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    });
    const page = await browser.newPage({
        viewport:
            process.env.WEBLG_VIEWPORT === 'mobile'
                ? { width: 390, height: 844 }
                : { width: 1440, height: 1050 },
        colorScheme: process.env.WEBLG_COLOR_SCHEME ?? 'light',
        permissions: ['clipboard-read', 'clipboard-write'],
    });
    const errors = [],
        network = [],
        consoleErrors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('requestfailed', (request) =>
        network.push(`${request.url()}: ${request.failure()?.errorText}`),
    );
    page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/demo/`);
    await page.waitForSelector('#scene[data-ready=true]', { timeout: 60000 });
    const first = await page.evaluate(() => ({
        mode: window.__WEBLG_STUDIO__.stage.mode,
        stats: window.__WEBLG_STUDIO__.stage.stats,
        title: document.title,
        ready: document.querySelector('#scene').dataset.ready,
        skin: [...document.querySelectorAll('.console-actions button')].map((element) => {
            const css = getComputedStyle(element);
            return {
                label: element.textContent,
                background: css.backgroundColor,
                colour: css.color,
                fill: css.getPropertyValue('--wlg-fill'),
            };
        }),
    }));
    console.log(JSON.stringify({ first, errors, network, consoleErrors }, null, 2));
    await page.screenshot({
        path: process.env.WEBLG_SCREENSHOT ?? '/tmp/weblg-studio-desktop.jpg',
        type: 'jpeg',
        quality: 78,
        fullPage: true,
    });
    assert.equal(errors.length, 0, errors.join('\n'));
    assert.equal(network.length, 0, network.join('\n'));
    assert.equal(consoleErrors.length, 0, consoleErrors.join('\n'));
    assert.equal(first.mode, 'webgl');
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    assert.equal(
        await page.locator('#setting-borderRadius').count(),
        0,
        'duplicate CSS radius control remains',
    );
    const pageCopy = await page.evaluate(() =>
        [
            document.body.textContent,
            ...[...document.querySelectorAll('[aria-label],[title]')].flatMap((el) => [
                el.getAttribute('aria-label') ?? '',
                el.getAttribute('title') ?? '',
            ]),
        ].join('\n'),
    );
    assert.equal(/[À-ÖØ-öø-ÿ]/.test(pageCopy), false, 'non-English UI copy remains');
    assert.equal(
        await page
            .locator('.wlg-surface[data-wlg-material=clear]:not(.wlg-button-prominent)')
            .evaluateAll((elements) =>
                elements.every(
                    (element) => getComputedStyle(element).backgroundColor === 'rgba(0, 0, 0, 0)',
                ),
            ),
        true,
        'clear glass has a coloured CSS coating',
    );
    assert.ok(first.stats.totalPasses >= 3, 'layered composition did not run');

    // Reference optical profiles for Main, Circle and Pill (853a0ab).
    const mainDefaults = {
        smoothness: 10,
        edgeSpread: 15.22,
        frosted: 17.4,
        pinch: 10.8,
        chroma: 2,
        turbulence: 0,
        liquidity: 0,
    };
    const circleDefaults = {
        smoothness: 20,
        edgeSpread: 20,
        frosted: 3,
        pinch: 5,
        chroma: 0.7,
        turbulence: 0,
        liquidity: 0,
    };
    const pillDefaults = { ...circleDefaults, smoothness: 10 };
    const originalFields = [
        ['smoothness', 'Corner Radius', 20],
        ['edgeSpread', 'Thickness (px)', 200],
        ['frosted', 'Blur', 50],
        ['pinch', 'Border Pinch', 30],
        ['chroma', 'Chroma', 2],
        ['turbulence', 'turbulence', 20],
        ['liquidity', 'liquidity', 1],
    ];
    const assertDefaults = async (defaults) => {
        for (const [key, label, max] of originalFields) {
            assert.equal(await page.locator(`label[for=setting-${key}]`).textContent(), label);
            assert.equal(await page.locator(`#setting-${key}`).getAttribute('max'), String(max));
            assert.equal(Number(await page.locator(`#setting-${key}`).inputValue()), defaults[key]);
        }
        assert.equal(
            await page.evaluate(() => window.__WEBLG_STUDIO__.selected.config.borderRadius),
            null,
        );
    };
    assert.equal(await page.locator('input[name=material][value=original]').isChecked(), true);
    await assertDefaults(mainDefaults);

    if (process.argv.includes('--smoke')) process.exitCode = 0;
    else {
        await page.locator('input[aria-label="Value: corner radius"]').fill('2');
        await page.waitForFunction(
            () =>
                window.__WEBLG_STUDIO__.stage.renderers.get('shared')._lensUniforms.params0[0] ===
                2,
        );
        await page.getByRole('button', { name: 'Default config', exact: true }).click();
        await assertDefaults(mainDefaults);
        const lensIDs = await page.evaluate(() =>
            window.__WEBLG_STUDIO__.probes.map((probe) => probe.surface.id),
        );
        await page.locator('#component-select').selectOption(lensIDs[0]);
        await assertDefaults(circleDefaults);
        await page.locator('#component-select').selectOption(lensIDs[1]);
        await assertDefaults(pillDefaults);
        await page.locator('#component-select').selectOption(lensIDs[2]);
        await assertDefaults(mainDefaults);
        // An OS dark preference must not silently replace the chosen light theme.
        await page.emulateMedia({ colorScheme: 'dark' });
        assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
        assert.equal(
            await page.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor),
            'rgb(245, 245, 247)',
        );
        await page.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption('dark');
        assert.equal(
            await page.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor),
            'rgb(21, 21, 23)',
        );
        await page.reload();
        await page.waitForSelector('#scene[data-ready=true]');
        assert.equal(
            await page.locator('html').getAttribute('data-theme'),
            'dark',
            'appearance is persisted',
        );
        await page.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption('light');
        const circle = page.getByRole('button', {
            name: 'Move: Disc',
            exact: true,
        });
        const capsule = page.getByRole('button', {
            name: 'Move: Capsule',
            exact: true,
        });
        const rectBefore = await circle.boundingBox();
        const otherBefore = await capsule.boundingBox();
        const opticalFrame = () =>
            page.evaluate(
                () =>
                    new Promise((resolve) => {
                        const { stage } = window.__WEBLG_STUDIO__;
                        stage.host.addEventListener(
                            'wlgrender',
                            () => resolve(stage.canvas.toDataURL()),
                            { once: true },
                        );
                        stage.invalidate();
                    }),
            );
        const canvasBefore = await opticalFrame();
        await page.mouse.move(
            rectBefore.x + rectBefore.width / 2,
            rectBefore.y + rectBefore.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(
            rectBefore.x + rectBefore.width / 2 + 95,
            rectBefore.y + rectBefore.height / 2 + 70,
            { steps: 12 },
        );
        await page.mouse.up();
        await page.waitForTimeout(100);
        const rectAfter = await circle.boundingBox();
        assert.ok(
            rectAfter.x > rectBefore.x + 80 && rectAfter.y > rectBefore.y + 60,
            'direct dragging failed',
        );
        assert.deepEqual(
            await capsule.boundingBox(),
            otherBefore,
            'independent dragging moved another element',
        );
        assert.ok(
            (await opticalFrame()) !== canvasBefore,
            'optical canvas did not follow the element',
        );
        await capsule.focus();
        await page.keyboard.press('ArrowLeft');
        assert.ok(
            (await capsule.boundingBox()).x < otherBefore.x,
            'free element keyboard dragging failed',
        );
        await page.mouse.move(
            rectAfter.x + rectAfter.width / 2,
            rectAfter.y + rectAfter.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(-200, -200, { steps: 8 });
        await page.mouse.up();
        const bounds = await page.locator('#scene').boundingBox();
        const bounded = await circle.boundingBox();
        assert.ok(
            bounded.x >= bounds.x + 15 && bounded.y >= bounds.y + 15,
            'drag escaped its zone',
        );
        await page.getByRole('button', { name: 'Reset positions', exact: true }).click();
        await page.getByRole('button', { name: 'Components', exact: true }).click();
        await assertDefaults({ ...mainDefaults, smoothness: 3.8 });
        const cssCorner = () =>
            page
                .locator('#glass-console')
                .evaluate((element) => parseFloat(getComputedStyle(element).borderTopLeftRadius));
        const initialCorner = await cssCorner();
        await page.locator('input[aria-label="Value: corner radius"]').fill('7.2');
        assert.ok((await cssCorner()) > initialCorner, 'HTML contour did not follow Corner Radius');
        await page.getByRole('button', { name: 'Default config', exact: true }).click();
        await assertDefaults({ ...mainDefaults, smoothness: 3.8 });
        assert.ok(
            Math.abs((await cssCorner()) - initialCorner) < 0.01,
            'default HTML contour was not restored',
        );
        await page.getByRole('button', { name: /Before \/ after/ }).click();
        assert.equal(await page.locator('#compare').getAttribute('aria-pressed'), 'true');
        await page.getByRole('button', { name: /Before \/ after/ }).click();
        await page.locator('.background-option[data-background=texture]').click();
        assert.equal(await page.locator('#scene').getAttribute('data-background'), 'texture');
        await page.getByRole('tab', { name: 'Shapes', exact: true }).click();
        await page.keyboard.press('ArrowRight');
        assert.equal(await page.locator('#scene').getAttribute('data-background'), 'mixed');
        await page.locator('input[name=material][value=satin]').check();
        assert.equal(await page.locator('input[name=material][value=satin]').isChecked(), true);
        await page.getByText('Advanced optics', { exact: true }).click();
        await page.locator('input[aria-label="Value: edge highlight"]').fill('0.8');
        assert.equal(
            await page.locator('input[aria-label="Value: edge highlight"]').inputValue(),
            '0.8',
        );
        await page.locator('#solid-mode').check();
        assert.equal(await page.locator('#scene').getAttribute('data-wlg-opaque'), 'true');
        await page.locator('#solid-mode').uncheck();

        await page.getByRole('button', { name: 'Scene actions', exact: true }).click();
        await page.keyboard.press('End');
        assert.match(await page.evaluate(() => document.activeElement.textContent), /Reset scene/);
        await page.keyboard.press('Escape');
        assert.equal(await page.getByRole('menu').count(), 0);
        assert.equal(
            await page
                .getByRole('button', { name: 'Scene actions', exact: true })
                .evaluate((element) => element === document.activeElement),
            true,
        );
        await page.getByRole('button', { name: 'Copy style', exact: true }).click();
        const copied = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
        assert.ok(copied.material && copied.components?.length >= 8);
        await page.getByRole('button', { name: 'Documentation', exact: false }).click();
        assert.equal(await page.locator('#documentation').evaluate((dialog) => dialog.open), true);
        await page.keyboard.press('Escape');

        const handle = page.getByRole('button', {
            name: 'Move the panel with the arrow keys',
            exact: true,
        });
        await handle.focus();
        const before = await page.locator('#glass-console').boundingBox();
        await page.keyboard.press('ArrowLeft');
        const after = await page.locator('#glass-console').boundingBox();
        assert.ok(after.x < before.x, 'keyboard dragging failed');

        const range = page.getByRole('slider', {
            name: 'Refraction strength',
            exact: true,
        });
        await range.focus();
        await page.keyboard.press('ArrowRight');
        assert.equal(await range.inputValue(), '51');
        assert.equal(await page.locator('#intensity-output').textContent(), '51%');

        await page.emulateMedia({ reducedMotion: 'reduce' });
        assert.equal(
            await page.getByRole('switch', { name: 'Animate background', exact: true }).isChecked(),
            false,
        );
        await page.getByRole('switch', { name: 'Animate background', exact: true }).click();
        assert.equal(
            await page.getByRole('switch', { name: 'Animate background', exact: true }).isChecked(),
            true,
        );
        assert.equal(
            await page.locator('#animation-status').textContent(),
            'Background is moving.',
        );
        await page.waitForFunction(
            () => window.__WEBLG_STUDIO__.stage.backgroundTransform[0] < 0.93,
        );
        const movingPixels = await opticalFrame();
        const moving = await page.evaluate(() => window.__WEBLG_STUDIO__.stage.backgroundTransform);
        await page.waitForFunction(
            (previous) => {
                const next = window.__WEBLG_STUDIO__.stage.backgroundTransform;
                return (
                    Math.max(Math.abs(next[1] - previous[1]), Math.abs(next[2] - previous[2])) >
                    0.006
                );
            },
            moving,
            { timeout: 10000, polling: 100 },
        );
        assert.ok((await opticalFrame()) !== movingPixels, 'animated decor pixels stayed frozen');
        assert.equal(
            await page.evaluate(() => window.__WEBLG_STUDIO__.stage.stats.backgroundUploads),
            0,
            'animation uploaded the background bitmap',
        );
        await page.getByRole('switch', { name: 'Animate background', exact: true }).click();
        assert.equal(await page.evaluate(() => window.__WEBLG_STUDIO__.state.animate), false);
        assert.deepEqual(
            await page.evaluate(() => window.__WEBLG_STUDIO__.stage.backgroundTransform),
            [1, 0, 0],
        );
        await page.emulateMedia({
            reducedMotion: 'no-preference',
            colorScheme: 'dark',
        });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption('dark');
        await page.evaluate(() => window.__WEBLG_STUDIO__.draggable.recenter());
        await page.waitForTimeout(350);
        const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
        );
        assert.equal(overflow, false, 'mobile horizontal overflow');
        await page.screenshot({
            path: '/tmp/weblg-studio-mobile.jpg',
            type: 'jpeg',
            quality: 78,
            fullPage: true,
        });
        await page.setViewportSize({ width: 320, height: 780 });
        assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            false,
            '320px horizontal overflow',
        );
        await page.evaluate(() => {
            document.documentElement.style.fontSize = '200%';
        });
        await page.waitForTimeout(350);
        assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            false,
            'large text horizontal overflow',
        );
        const layout = await page.evaluate(() => {
            const panel = document.querySelector('#glass-console').getBoundingClientRect();
            const scene = document.querySelector('#scene').getBoundingClientRect();
            return {
                inside:
                    panel.left >= scene.left &&
                    panel.right <= scene.right &&
                    panel.top >= scene.top &&
                    panel.bottom <= scene.bottom,
            };
        });
        assert.equal(layout.inside, true, 'large text panel is clipped');
        await page.evaluate(() => {
            document.documentElement.style.fontSize = '';
        });
        await page.emulateMedia({ contrast: 'more' });
        await page.waitForFunction(
            () => document.querySelector('#scene').dataset.wlgOpaque === 'true',
        );
        assert.equal(await page.locator('#solid-mode').isDisabled(), true);
        await page.locator('#compare').click();
        assert.notEqual(
            await page
                .locator('#glass-console')
                .evaluate((element) => getComputedStyle(element).backgroundColor),
            'rgba(0, 0, 0, 0)',
            'comparison bypassed accessibility opacity',
        );

        await page.emulateMedia({ contrast: 'no-preference' });

        // A later optical layer must actually read the earlier glass output.
        const layers = await page.evaluate(async () => {
            const { WebLGStage } = await import('/src/stage.js');
            const element = document.createElement('div');
            element.style.cssText = 'position:fixed;left:0;top:0;width:240px;height:160px';
            document.body.append(element);
            const stage = await WebLGStage.create(element, { pixelRatio: 1 });
            stage.setPainter((ctx) => {
                for (let x = 0; x < 240; x += 8) {
                    ctx.fillStyle = x % 16 ? '#203050' : '#edb0b8';
                    ctx.fillRect(x, 0, 8, 160);
                }
            });
            const make = (style) => {
                const node = document.createElement('div');
                node.style.cssText = style;
                element.append(node);
                return node;
            };
            const parent = stage.register(
                make(
                    'position:absolute;left:20px;top:20px;width:200px;height:120px;border-radius:18px',
                ),
                { layer: 0, frosted: 0, pinch: 0, rim: 0 },
            );
            stage.register(
                make(
                    'position:absolute;left:80px;top:60px;width:80px;height:50px;border-radius:14px',
                ),
                { layer: 1, frosted: 0, pinch: 0, rim: 0 },
            );
            const pixel = () => {
                stage.render();
                const data = new Uint8Array(4);
                stage.gl.readPixels(120, 75, 1, 1, stage.gl.RGBA, stage.gl.UNSIGNED_BYTE, data);
                return [...data];
            };
            const before = pixel();
            parent.update({ frosted: 5 });
            const after = pixel();
            const result = {
                before,
                after,
                passes: stage.stats.passes,
                error: stage.gl.getError(),
            };
            stage.destroy();
            element.remove();
            return result;
        });
        assert.equal(layers.passes, 2);
        assert.equal(layers.error, 0);
        assert.ok(
            Math.abs(layers.before[0] - layers.after[0]) > 10,
            'child glass did not sample the parent glass',
        );

        const fallback = await browser.newPage({
            viewport: { width: 390, height: 844 },
            hasTouch: true,
            isMobile: true,
        });
        fallback.on('pageerror', (error) => errors.push(error.message));
        await fallback.addInitScript(() => {
            const get = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
                return /^webgl/.test(kind) ? null : get.call(this, kind, ...args);
            };
        });
        await fallback.goto(`http://127.0.0.1:${server.address().port}/demo/`);
        await fallback.waitForSelector('#scene[data-ready=true]');
        await fallback.getByRole('button', { name: 'Components', exact: true }).click();
        assert.equal(await fallback.evaluate(() => window.__WEBLG_STUDIO__.stage.mode), 'fallback');
        await fallback.getByRole('tab', { name: 'Texture', exact: true }).click();
        assert.equal(await fallback.locator('#scene').getAttribute('data-background'), 'texture');
        await fallback.getByRole('switch', { name: 'Animate background', exact: true }).tap();
        assert.equal(
            await fallback
                .getByRole('switch', { name: 'Animate background', exact: true })
                .isChecked(),
            true,
        );
        const touchRange = await fallback
            .getByRole('slider', { name: 'Refraction strength', exact: true })
            .boundingBox();
        await fallback.touchscreen.tap(
            touchRange.x + touchRange.width * 0.8,
            touchRange.y + touchRange.height / 2,
        );
        assert.ok(
            Number(
                await fallback
                    .getByRole('slider', { name: 'Refraction strength', exact: true })
                    .inputValue(),
            ) > 60,
        );
        await fallback.close();
        console.log(
            JSON.stringify({
                interactions: 'passed',
                errors,
                consoleErrors,
                network,
            }),
        );
        assert.equal(errors.length, 0, errors.join('\n'));
        assert.equal(consoleErrors.length, 0, consoleErrors.join('\n'));
    }
} finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
}
