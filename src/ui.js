import { GLASS_PRESETS } from './shaders.js';

let sequence = 0;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const el = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
};

/** Native, framework-independent controls. Import ui.css explicitly. Each
 * surface belongs to a WebLGStage; destroying a control unregisters its GPU work. */
export class WebLGUI {
    constructor(stage, options = {}) {
        this.stage = stage;
        this.options = options;
        this.controls = new Set();
        this.surfaces = new Map();
        this.material = 'clear';
        stage.host.classList.add('wlg-root');
    }

    surface(element, options = {}) {
        element.classList.add('wlg-surface');
        const record = this.stage.register(element, {
            ...GLASS_PRESETS[this.material],
            ...options,
        });
        record.label = options.label ?? 'Surface';
        record.material = this.material;
        element.dataset.wlgMaterial = this.material;
        element.dataset.wlgSurface = record.id;
        element.dataset.wlgOwner = record.id;
        this.surfaces.set(record.id, record);
        const choose = (event) => {
            const owner = event.target.closest('[data-wlg-owner]');
            if (owner?.dataset.wlgOwner === record.id) this.options.onSelect?.(record);
        };
        const events = new AbortController();
        element.addEventListener('pointerdown', choose, { signal: events.signal });
        element.addEventListener('focusin', choose, { signal: events.signal });
        const remove = record.remove;
        record.remove = () => {
            events.abort();
            this.surfaces.delete(record.id);
            remove();
        };
        return record;
    }

    setMaterial(name) {
        if (!GLASS_PRESETS[name]) throw new RangeError(`Unknown WebLG material: ${name}`);
        this.material = name;
        this.stage.host.dataset.wlgMaterial = name;
        this.surfaces.forEach((record) => {
            record.material = name;
            record.element.dataset.wlgMaterial = name;
            record.update(GLASS_PRESETS[name]);
        });
    }

    select(record) {
        this.surfaces.forEach((surface) =>
            surface.element.toggleAttribute('data-wlg-selected', surface === record),
        );
    }

    lifecycle(element, surface, events, cleanup = () => {}) {
        const control = {
            element,
            surface,
            destroy: () => {
                events.abort();
                cleanup();
                surface?.remove();
                element.remove();
                this.controls.delete(control);
            },
        };
        this.controls.add(control);
        return control;
    }

    press(element, signal) {
        const down = (event) => {
            if (
                element.disabled ||
                (event.pointerId != null && (!event.isPrimary || event.button !== 0))
            )
                return;
            element.dataset.pressed = '';
            if (event.clientX != null) {
                const rect = element.getBoundingClientRect();
                element.style.setProperty(
                    '--wlg-x',
                    `${clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100)}%`,
                );
                element.style.setProperty(
                    '--wlg-y',
                    `${clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100)}%`,
                );
            }
            this.stage.follow(300);
        };
        const up = () => {
            delete element.dataset.pressed;
            this.stage.follow(300);
        };
        element.addEventListener('pointerdown', down, { signal });
        element.addEventListener(
            'keydown',
            (event) => {
                if ([' ', 'Enter'].includes(event.key)) down(event);
            },
            { signal },
        );
        element.addEventListener('keyup', up, { signal });
        element.addEventListener('blur', up, { signal });
        window.addEventListener('pointerup', up, { signal });
        window.addEventListener('pointercancel', up, { signal });
        window.addEventListener('blur', up, { signal });
    }

    button({
        label,
        icon,
        ariaLabel,
        onClick,
        disabled = false,
        prominent = false,
        layer = 1,
        glass = true,
    } = {}) {
        if (!label && !ariaLabel)
            throw new TypeError('A button needs a visible or accessible label.');
        const element = el(
            'button',
            `wlg-button${prominent ? ' wlg-button-prominent' : ''}${!label ? ' wlg-icon-button' : ''}`,
        );
        element.type = 'button';
        element.disabled = disabled;
        if (ariaLabel) element.setAttribute('aria-label', ariaLabel);
        if (icon) {
            const span = el('span', 'wlg-icon');
            span.setAttribute('aria-hidden', 'true');
            span.append(icon.cloneNode(true));
            element.append(span);
        }
        if (label) element.append(el('span', '', label));
        const surface = glass ? this.surface(element, { layer, label: ariaLabel ?? label }) : null;
        const events = new AbortController();
        this.press(element, events.signal);
        if (onClick) element.addEventListener('click', onClick, { signal: events.signal });
        const result = this.lifecycle(element, surface, events);
        result.setDisabled = (value) => {
            element.disabled = Boolean(value);
            this.stage.invalidate();
        };
        return result;
    }

    switch({ label, checked = false, disabled = false, onChange, layer = 1 } = {}) {
        if (!label) throw new TypeError('A switch needs an accessible label.');
        const root = el('span', 'wlg-switch');
        const track = el('span', 'wlg-switch-track');
        const thumb = el('span', 'wlg-switch-thumb');
        thumb.setAttribute('aria-hidden', 'true');
        thumb.append(el('span', 'wlg-thumb-face'));
        const input = el('input');
        input.type = 'checkbox';
        input.setAttribute('role', 'switch');
        input.setAttribute('aria-label', label);
        input.checked = checked;
        input.disabled = disabled;
        root.append(track, thumb, input);
        const surface = this.surface(thumb, { layer, label });
        root.dataset.wlgOwner = surface.id;
        const events = new AbortController(),
            signal = events.signal;
        let current = checked,
            gesture = null,
            ignoreClick = false,
            progress = checked ? 1 : 0;
        const paint = () => {
            root.style.setProperty('--wlg-progress', progress);
            root.dataset.checked = String(current);
            root.dataset.disabled = String(input.disabled);
            this.stage.follow(210);
        };
        const change = (value, emit = false) => {
            current = Boolean(value);
            input.checked = current;
            progress = current ? 1 : 0;
            paint();
            if (emit) onChange?.(current);
        };
        input.addEventListener('change', () => change(input.checked, true), { signal });
        input.addEventListener('focus', () => this.options.onSelect?.(surface), { signal });
        input.addEventListener(
            'click',
            (event) => {
                if (ignoreClick) {
                    event.preventDefault();
                    ignoreClick = false;
                    queueMicrotask(() => {
                        input.checked = current;
                    });
                }
            },
            { signal },
        );
        input.addEventListener(
            'pointerdown',
            (event) => {
                if (!event.isPrimary || event.button !== 0 || input.disabled) return;
                gesture = {
                    id: event.pointerId,
                    x: event.clientX,
                    from: current ? 1 : 0,
                    moved: false,
                };
                input.setPointerCapture(event.pointerId);
                root.dataset.interacting = '';
                paint();
            },
            { signal },
        );
        input.addEventListener(
            'pointermove',
            (event) => {
                if (gesture?.id !== event.pointerId) return;
                const dx = event.clientX - gesture.x;
                if (Math.abs(dx) > 4) gesture.moved = true;
                if (gesture.moved) {
                    progress = clamp(gesture.from + dx / 28, 0, 1);
                    paint();
                }
            },
            { signal },
        );
        const finish = (event) => {
            if (!gesture || (event.pointerId != null && gesture.id !== event.pointerId)) return;
            const old = gesture;
            gesture = null;
            delete root.dataset.interacting;
            if (input.hasPointerCapture(old.id)) input.releasePointerCapture(old.id);
            if (old.moved && event.type === 'pointerup') {
                ignoreClick = true;
                change(progress > 0.5, true);
            } else {
                progress = current ? 1 : 0;
                paint();
            }
        };
        ['pointerup', 'pointercancel', 'lostpointercapture', 'blur'].forEach((type) =>
            input.addEventListener(type, finish, { signal }),
        );
        const removeUnderlay = this.stage.registerUnderlay(() => {
            if (!root.isConnected || !root.getClientRects().length) return [];
            const rect = this.stage.rect(track);
            return [
                {
                    ...rect,
                    radius: 100,
                    colour: current
                        ? [0.05, 0.41, 0.85, input.disabled ? 0.35 : 1]
                        : [0.4, 0.43, 0.49, input.disabled ? 0.2 : 0.38],
                },
            ];
        }, layer);
        const result = this.lifecycle(root, surface, events, removeUnderlay);
        result.input = input;
        result.setValue = change;
        Object.defineProperty(result, 'value', { get: () => current });
        paint();
        return result;
    }

    slider({
        label,
        value = 50,
        min = 0,
        max = 100,
        step = 1,
        disabled = false,
        onChange,
        layer = 1,
    } = {}) {
        if (!label) throw new TypeError('A slider needs an accessible label.');
        const root = el('span', 'wlg-slider');
        const track = el('span', 'wlg-slider-track');
        track.append(el('span', 'wlg-slider-fill'));
        const thumb = el('span', 'wlg-slider-thumb');
        thumb.setAttribute('aria-hidden', 'true');
        thumb.append(el('span', 'wlg-thumb-face'));
        const input = el('input');
        input.type = 'range';
        input.min = min;
        input.max = max;
        input.step = step;
        input.value = value;
        input.disabled = disabled;
        input.setAttribute('aria-label', label);
        input.id = `wlg-slider-${++sequence}`;
        root.append(track, thumb, input);
        const surface = this.surface(thumb, { layer, label });
        root.dataset.wlgOwner = surface.id;
        const events = new AbortController(),
            signal = events.signal;
        let progress;
        const sync = (emit = false) => {
            progress = max > min ? clamp((input.valueAsNumber - min) / (max - min), 0, 1) : 0;
            root.style.setProperty('--wlg-progress', progress);
            root.dataset.disabled = String(input.disabled);
            this.stage.invalidate();
            if (emit) onChange?.(input.valueAsNumber);
        };
        input.addEventListener('input', () => sync(true), { signal });
        input.addEventListener('focus', () => this.options.onSelect?.(surface), { signal });
        input.addEventListener(
            'pointerdown',
            () => {
                if (!input.disabled) {
                    root.dataset.interacting = '';
                    this.stage.follow(200);
                }
            },
            { signal },
        );
        const release = () => {
            delete root.dataset.interacting;
            this.stage.follow(200);
        };
        ['pointerup', 'pointercancel', 'blur', 'lostpointercapture'].forEach((type) =>
            input.addEventListener(type, release, { signal }),
        );
        window.addEventListener('pointerup', release, { signal });
        const removeUnderlay = this.stage.registerUnderlay(() => {
            if (!root.isConnected || !root.getClientRects().length) return [];
            const rect = this.stage.rect(track);
            return [
                { ...rect, radius: 2, colour: [0.3, 0.34, 0.4, disabled ? 0.16 : 0.3] },
                {
                    ...rect,
                    width: rect.width * progress,
                    radius: 2,
                    colour: [0.05, 0.41, 0.85, disabled ? 0.35 : 1],
                },
            ];
        }, layer);
        const result = this.lifecycle(root, surface, events, removeUnderlay);
        result.input = input;
        result.setValue = (next, emit = false) => {
            input.value = next;
            sync(emit);
        };
        Object.defineProperty(result, 'value', { get: () => input.valueAsNumber });
        sync();
        return result;
    }

    segmentedControl({
        label,
        items,
        value = items?.[0]?.value,
        onChange,
        layer = 1,
        tabs = false,
        panelId,
    } = {}) {
        if (!label || !items?.length)
            throw new TypeError('A choice control needs a label and items.');
        const root = el('div', `wlg-segmented${tabs ? ' wlg-tab-bar' : ''}`);
        root.setAttribute('role', tabs ? 'tablist' : 'radiogroup');
        root.setAttribute('aria-label', label);
        const indicator = el('span', 'wlg-segment-indicator');
        indicator.setAttribute('aria-hidden', 'true');
        root.append(indicator);
        const surface = this.surface(indicator, { layer, label });
        root.dataset.wlgOwner = surface.id;
        const events = new AbortController(),
            signal = events.signal;
        let selected = items.findIndex((item) => item.value === value);
        if (selected < 0) selected = 0;
        let gesture = null,
            dragged = false;
        const buttons = items.map((item, index) => {
            const button = el('button', 'wlg-segment', item.label);
            button.type = 'button';
            button.id = `wlg-choice-${++sequence}`;
            button.setAttribute('role', tabs ? 'tab' : 'radio');
            if (tabs && panelId) button.setAttribute('aria-controls', panelId);
            button.addEventListener(
                'click',
                () => {
                    if (!dragged) choose(index, true);
                },
                { signal },
            );
            button.addEventListener('focus', () => this.options.onSelect?.(surface), { signal });
            root.append(button);
            return button;
        });
        const paint = () => {
            root.style.setProperty('--wlg-count', items.length);
            root.style.setProperty('--wlg-index', selected);
            buttons.forEach((button, index) => {
                button.tabIndex = index === selected ? 0 : -1;
                button.setAttribute(
                    tabs ? 'aria-selected' : 'aria-checked',
                    String(index === selected),
                );
            });
            if (tabs && panelId)
                document
                    .getElementById(panelId)
                    ?.setAttribute('aria-labelledby', buttons[selected].id);
            this.stage.follow(250);
        };
        const choose = (index, emit = false) => {
            if (index < 0 || index >= items.length) return;
            selected = index;
            paint();
            if (emit) onChange?.(items[index].value);
        };
        root.addEventListener(
            'keydown',
            (event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const direction = getComputedStyle(root).direction === 'rtl' ? -1 : 1;
                const next =
                    event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? items.length - 1
                          : (selected +
                                (event.key === 'ArrowRight' ? direction : -direction) +
                                items.length) %
                            items.length;
                choose(next, true);
                buttons[selected].focus();
            },
            { signal },
        );
        root.addEventListener(
            'pointerdown',
            (event) => {
                if (!event.isPrimary || event.button !== 0) return;
                dragged = false;
                gesture = { id: event.pointerId, x: event.clientX };
                root.dataset.interacting = '';
                this.stage.follow(200);
            },
            { signal },
        );
        root.addEventListener(
            'pointermove',
            (event) => {
                if (gesture?.id !== event.pointerId || Math.abs(event.clientX - gesture.x) < 5)
                    return;
                dragged = true;
                root.setPointerCapture(event.pointerId);
                const rect = root.getBoundingClientRect();
                let at = clamp(
                    Math.floor(((event.clientX - rect.left) / rect.width) * items.length),
                    0,
                    items.length - 1,
                );
                if (getComputedStyle(root).direction === 'rtl') at = items.length - 1 - at;
                if (at !== selected) choose(at, true);
            },
            { signal },
        );
        const end = (event) => {
            if (gesture?.id !== event.pointerId) return;
            const id = gesture.id;
            gesture = null;
            delete root.dataset.interacting;
            if (root.hasPointerCapture(id)) root.releasePointerCapture(id);
            this.stage.follow(220);
            setTimeout(() => {
                dragged = false;
            }, 0);
        };
        window.addEventListener('pointerup', end, { signal });
        root.addEventListener('pointercancel', end, { signal });
        const result = this.lifecycle(root, surface, events);
        result.setValue = (next, emit = false) =>
            choose(
                items.findIndex((item) => item.value === next),
                emit,
            );
        Object.defineProperty(result, 'value', { get: () => items[selected].value });
        paint();
        return result;
    }

    tabs(options) {
        return this.segmentedControl({ ...options, tabs: true });
    }

    menu({ label, icon, items, layer = 2 } = {}) {
        const trigger = this.button({ ariaLabel: label, icon, glass: false });
        const panel = el('div', 'wlg-menu-panel');
        panel.hidden = true;
        panel.id = `wlg-menu-${++sequence}`;
        panel.setAttribute('role', 'menu');
        panel.setAttribute('aria-label', label);
        panel.tabIndex = -1;
        trigger.element.setAttribute('aria-haspopup', 'menu');
        trigger.element.setAttribute('aria-expanded', 'false');
        trigger.element.setAttribute('aria-controls', panel.id);
        this.stage.host.append(panel);
        const surface = this.surface(panel, { layer, label: 'Menu', ...GLASS_PRESETS.satin });
        const events = new AbortController(),
            signal = events.signal;
        const rows = [];
        const position = () => {
            if (panel.hidden) return;
            const anchor = this.stage.rect(trigger.element),
                padding = 12;
            const left = clamp(
                anchor.x + anchor.width - panel.offsetWidth,
                padding,
                Math.max(padding, this.stage.host.clientWidth - panel.offsetWidth - padding),
            );
            let top = anchor.y + anchor.height + 8;
            if (top + panel.offsetHeight > this.stage.host.clientHeight - padding)
                top = Math.max(padding, anchor.y - panel.offsetHeight - 8);
            panel.style.left = `${left}px`;
            panel.style.top = `${top}px`;
            this.stage.invalidate();
        };
        const close = (restore = true) => {
            panel.hidden = true;
            trigger.element.setAttribute('aria-expanded', 'false');
            this.stage.invalidate();
            if (restore) trigger.element.focus();
        };
        const open = (focus = true) => {
            panel.hidden = false;
            trigger.element.setAttribute('aria-expanded', 'true');
            position();
            if (focus) (rows.find((row) => !row.disabled) ?? panel).focus();
            this.stage.follow(180);
        };
        for (const item of items) {
            if (item === 'separator') {
                const separator = el('div', 'wlg-menu-separator');
                separator.setAttribute('role', 'separator');
                panel.append(separator);
                continue;
            }
            const button = el('button', 'wlg-menu-item', item.label);
            button.type = 'button';
            button.setAttribute('role', 'menuitem');
            button.disabled = Boolean(item.disabled);
            button.addEventListener(
                'click',
                () => {
                    close();
                    item.onSelect?.();
                },
                { signal },
            );
            panel.append(button);
            rows.push(button);
        }
        trigger.element.addEventListener('click', () => (panel.hidden ? open() : close()), {
            signal,
        });
        trigger.element.addEventListener(
            'keydown',
            (event) => {
                if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
                    event.preventDefault();
                    open();
                    if (event.key === 'ArrowUp')
                        [...rows]
                            .reverse()
                            .find((row) => !row.disabled)
                            ?.focus();
                }
            },
            { signal },
        );
        panel.addEventListener(
            'keydown',
            (event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    close();
                } else if (event.key === 'Tab') close();
                else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                    event.preventDefault();
                    const available = rows.filter((row) => !row.disabled),
                        at = available.indexOf(document.activeElement);
                    const next =
                        event.key === 'Home'
                            ? 0
                            : event.key === 'End'
                              ? available.length - 1
                              : (at + (event.key === 'ArrowDown' ? 1 : -1) + available.length) %
                                available.length;
                    available[next]?.focus();
                }
            },
            { signal },
        );
        document.addEventListener(
            'pointerdown',
            (event) => {
                if (
                    !panel.hidden &&
                    !panel.contains(event.target) &&
                    !trigger.element.contains(event.target)
                )
                    close(false);
            },
            { capture: true, signal },
        );
        window.addEventListener('resize', position, { signal });
        window.addEventListener('scroll', position, { capture: true, passive: true, signal });
        const result = this.lifecycle(trigger.element, surface, events, () => {
            trigger.destroy();
            panel.remove();
        });
        result.panel = panel;
        result.open = open;
        result.close = close;
        return result;
    }

    draggable(element, handle, { padding = 16, bottom = padding } = {}) {
        const events = new AbortController(),
            signal = events.signal;
        let gesture;
        const move = (x, y) => {
            element.style.transform = 'none';
            element.style.left = `${clamp(x, padding, Math.max(padding, this.stage.host.clientWidth - element.offsetWidth - padding))}px`;
            element.style.top = `${clamp(y, padding, Math.max(padding, this.stage.host.clientHeight - element.offsetHeight - bottom))}px`;
            this.stage.invalidate();
        };
        const recenter = () =>
            move(
                (this.stage.host.clientWidth - element.offsetWidth) / 2,
                (this.stage.host.clientHeight - element.offsetHeight) / 2 - 22,
            );
        handle.addEventListener(
            'pointerdown',
            (event) => {
                if (!event.isPrimary || event.button !== 0) return;
                handle.focus({ preventScroll: true });
                const rect = this.stage.rect(element);
                move(rect.x, rect.y);
                gesture = {
                    id: event.pointerId,
                    x: event.clientX,
                    y: event.clientY,
                    left: rect.x,
                    top: rect.y,
                    maxX: Math.max(
                        padding,
                        this.stage.host.clientWidth - element.offsetWidth - padding,
                    ),
                    maxY: Math.max(
                        padding,
                        this.stage.host.clientHeight - element.offsetHeight - bottom,
                    ),
                    targetX: rect.x,
                    targetY: rect.y,
                };
                element.style.willChange = 'transform';
                handle.setPointerCapture(event.pointerId);
                element.dataset.dragging = '';
                event.preventDefault();
            },
            { signal },
        );
        handle.addEventListener(
            'pointermove',
            (event) => {
                if (gesture?.id !== event.pointerId) return;
                const current = gesture;
                current.targetX = clamp(
                    current.left + event.clientX - current.x,
                    padding,
                    current.maxX,
                );
                current.targetY = clamp(
                    current.top + event.clientY - current.y,
                    padding,
                    current.maxY,
                );
                this.stage.enqueue(element, () => {
                    element.style.transform = `translate3d(${current.targetX - current.left}px, ${current.targetY - current.top}px, 0)`;
                });
            },
            { signal },
        );
        const end = () => {
            if (!gesture) return;
            const current = gesture;
            this.stage.enqueue(element, () => {
                move(current.targetX, current.targetY);
                element.style.willChange = '';
            });
            gesture = null;
            delete element.dataset.dragging;
        };
        ['pointerup', 'pointercancel', 'lostpointercapture', 'blur'].forEach((type) =>
            handle.addEventListener(type, end, { signal }),
        );
        handle.addEventListener(
            'keydown',
            (event) => {
                if (event.key === 'Home') {
                    event.preventDefault();
                    recenter();
                }
                if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key))
                    return;
                event.preventDefault();
                const rect = this.stage.rect(element),
                    amount = event.shiftKey ? 1 : 12;
                move(
                    rect.x +
                        (event.key === 'ArrowRight'
                            ? amount
                            : event.key === 'ArrowLeft'
                              ? -amount
                              : 0),
                    rect.y +
                        (event.key === 'ArrowDown'
                            ? amount
                            : event.key === 'ArrowUp'
                              ? -amount
                              : 0),
                );
            },
            { signal },
        );
        window.addEventListener(
            'resize',
            () => {
                if (!element.getClientRects().length) return;
                const rect = this.stage.rect(element);
                move(rect.x, rect.y);
            },
            { signal },
        );
        const observer = new ResizeObserver(() => {
            if (element.isConnected && element.getClientRects().length) {
                const rect = this.stage.rect(element);
                move(rect.x, rect.y);
            }
        });
        observer.observe(this.stage.host);
        observer.observe(element);
        return {
            recenter,
            destroy: () => {
                events.abort();
                observer.disconnect();
                this.stage.mutations.delete(element);
                element.style.willChange = '';
            },
        };
    }

    destroy() {
        [...this.controls].forEach((control) => control.destroy());
        [...this.surfaces.values()].forEach((surface) => surface.remove());
    }
}
