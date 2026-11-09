// Optional, local device measurement. No persistent render loop or readbacks.
export function installPerformanceCheck(stage, host, probes, { pause } = {}) {
    const button = document.querySelector('#measure-performance');
    const output = document.querySelector('#performance-result');
    const percentile = (values, fraction) => {
        const sorted = values.slice().sort((a, b) => a - b);
        return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
    };
    const frames = async (duration, tick) => {
        const times = [];
        await new Promise((resolve) => {
            let start;
            const frame = (time) => {
                start ??= time;
                times.push(time);
                tick?.(time - start);
                if (time - start < duration && !document.hidden) requestAnimationFrame(frame);
                else resolve();
            };
            requestAnimationFrame(frame);
        });
        return times;
    };
    const rate = (times) =>
        times.length > 1 ? ((times.length - 1) * 1000) / (times.at(-1) - times[0]) : 0;
    button.addEventListener('click', async () => {
        if (button.disabled) return;
        if (stage.mode !== 'webgl') {
            output.textContent = 'Measuring glass performance requires WebGL rendering.';
            return;
        }
        button.disabled = true;
        const resume = pause?.();
        const probe = probes[0].element;
        const style = probe.getAttribute('style');
        const previousView = host.dataset.view;
        const setView = (value) => {
            host.dataset.view = value;
            document
                .querySelectorAll('.scene-views button')
                .forEach((el) =>
                    el.setAttribute('aria-pressed', String(el.dataset.view === value)),
                );
        };
        const painted = [],
            cpu = [];
        const rendered = () => {
            painted.push(performance.now());
            cpu.push(stage.stats.cpuMs);
        };
        try {
            host.scrollIntoView({ block: 'center', behavior: 'auto' });
            output.textContent = 'Measuring the browser frame rate…';
            // Calibrate independently of the optical workload, on this device.
            const calibration = await frames(650);
            setView('explore');
            const origin = stage.rect(probe);
            const range = Math.max(0, Math.min(80, (host.clientWidth - origin.width - 32) / 2));
            const centre = (host.clientWidth - origin.width) / 2;
            const top = Math.max(16, (host.clientHeight - origin.height - 100) / 2);
            probe.style.left = `${centre}px`;
            probe.style.top = `${top}px`;
            probe.style.transform = 'none';
            probe.style.willChange = 'transform';
            stage.invalidate();
            await frames(350);
            output.textContent = 'Measuring moving glass for three seconds…';
            stage.host.addEventListener('wlgrender', rendered);
            await frames(3000, (elapsed) => {
                stage.enqueue(probe, () => {
                    probe.style.transform = `translate3d(${Math.sin(elapsed * 0.004) * range}px, 0, 0)`;
                });
            });
            const intervals = painted.slice(1).map((time, index) => time - painted[index]);
            output.textContent = `Idle: ${rate(calibration).toFixed(1)} fps. Scene: ${rate(painted).toFixed(1)} fps. P95 frame interval: ${percentile(intervals, 0.95).toFixed(1)} ms. P95 JavaScript time: ${percentile(cpu, 0.95).toFixed(1)} ms. 120 Hz target: 8.3 ms per frame.`;
        } catch {
            output.textContent = 'Measurement interrupted. Keep this tab visible and try again.';
        } finally {
            stage.host.removeEventListener('wlgrender', rendered);
            stage.mutations.delete(probe);
            if (style == null) probe.removeAttribute('style');
            else probe.setAttribute('style', style);
            setView(previousView);
            resume?.();
            stage.invalidate();
            button.disabled = false;
            output.scrollIntoView({ block: 'center', behavior: 'auto' });
        }
    });
}
