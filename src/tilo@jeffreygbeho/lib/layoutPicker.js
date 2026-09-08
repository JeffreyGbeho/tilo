/*
 * tilo - the layout picker overlay.
 *
 * Two surfaces, one widget, mirroring Windows 11:
 *   - a compact hint that drops from the top edge while a window is dragged,
 *     expanding into the full bar as the drag continues toward it;
 *   - the same bar summoned by a shortcut.
 *
 * Geometry is computed by hand rather than delegated to a layout manager,
 * because hit testing must work while the window manager holds a pointer grab
 * (no Clutter events reach us then). Knowing every rectangle up front is what
 * makes that possible.
 *
 * This module decides which zone is under the pointer. It never moves a window.
 */

const St = require('gi.St');
const Clutter = require('gi.Clutter');
const Main = require('ui.main');
const Layouts = require('./lib/layouts');
const Geometry = require('./lib/geometry');
const Logger = require('./lib/logger');

/* Thumbnail proportions. A mini screen, roughly 16:10. */
const THUMB_W = 128;
const THUMB_H = 80;
const THUMB_GAP = 10;
const BAR_PAD = 10;
const MINI_GAP = 3;

/* The collapsed hint: a small handle, like a drawer pull. */
const HINT_W = 96;
const HINT_H = 8;

/* Fluent's published durations. Entrance is deliberately slower than exit. */
const SHOW_MS = 250;
const HIDE_MS = 167;
const HOVER_MS = 83;

class LayoutPicker {
    /* getGaps: () => ({ inner, outer }) */
    constructor(getGaps) {
        this._getGaps = getGaps;
        this._state = 'hidden';        /* hidden | hint | expanded */
        this._hovered = null;          /* { layout, zone } */
        this._thumbRects = [];         /* stage coords, per layout */
        this._miniRects = [];          /* stage coords, per layout per zone */
        this._realZones = [];          /* screen coords, per layout per zone */
        this._workArea = null;

        /* The ghost goes in first so the bar always sits above it: the preview
           covers a whole half of the screen and would otherwise wash over the
           picker itself. */
        this._ghost = new St.Widget({ style_class: 'tilo-ghost', reactive: false });
        this._ghost.hide();
        Main.layoutManager.addChrome(this._ghost, { affectsInputRegion: false });

        this._bar = new St.Widget({ style_class: 'tilo-bar', reactive: false });
        this._bar.hide();
        Main.layoutManager.addChrome(this._bar, { affectsInputRegion: false });

        this._thumbs = [];
        this._minis = [];
    }

    destroy() {
        this._clearThumbs();
        if (this._bar) { this._bar.destroy(); this._bar = null; }
        if (this._ghost) { this._ghost.destroy(); this._ghost = null; }
    }

    get visible() { return this._state !== 'hidden'; }
    get expanded() { return this._state === 'expanded'; }

    /* Below this line the pointer has clearly left the bar. */
    get bottomEdge() { return (this._barY || 0) + (this._barH || 0) + 60; }

    /* The zone under the pointer, in real screen coordinates, or null. */
    hoveredZone() {
        if (!this._hovered) return null;
        return this._realZones[this._hovered.layout][this._hovered.zone];
    }

    /* The same thing plus which layout it belongs to, so the caller can record
       the window as part of that arrangement. */
    hoveredSelection() {
        if (!this._hovered) return null;
        return {
            layout: this._layouts[this._hovered.layout],
            zoneIndex: this._hovered.zone,
            rect: this._realZones[this._hovered.layout][this._hovered.zone]
        };
    }

    /* ---------------------------------------------------------------- build */

    _clearThumbs() {
        this._thumbs.forEach(t => t.destroy());
        this._thumbs = [];
        this._minis = [];
    }

    _build(workArea) {
        this._clearThumbs();
        this._workArea = workArea;

        const { inner, outer } = this._getGaps();
        const layouts = Layouts.all();
        this._layouts = layouts;
        const count = layouts.length;
        const barW = count * THUMB_W + (count - 1) * THUMB_GAP + 2 * BAR_PAD;
        const barH = THUMB_H + 2 * BAR_PAD;

        this._barW = barW;
        this._barH = barH;
        this._barX = Math.round(workArea.x + (workArea.width - barW) / 2);
        this._barY = workArea.y + 8;

        this._thumbRects = [];
        this._miniRects = [];
        this._realZones = [];

        layouts.forEach((layout, i) => {
            const tx = BAR_PAD + i * (THUMB_W + THUMB_GAP);
            const ty = BAR_PAD;

            const thumb = new St.Widget({ style_class: 'tilo-thumb', reactive: false });
            thumb.set_position(tx, ty);
            thumb.set_size(THUMB_W, THUMB_H);
            this._bar.add_child(thumb);
            this._thumbs.push(thumb);

            /* Stage coordinates, for hit testing against the polled pointer. */
            this._thumbRects.push({ x: this._barX + tx, y: this._barY + ty,
                                    width: THUMB_W, height: THUMB_H });

            const minis = [];
            const miniRects = [];
            layout.zones.forEach(([fx, fy, fw, fh]) => {
                const mx = Math.round(fx * THUMB_W) + MINI_GAP / 2;
                const my = Math.round(fy * THUMB_H) + MINI_GAP / 2;
                const mw = Math.round(fw * THUMB_W) - MINI_GAP;
                const mh = Math.round(fh * THUMB_H) - MINI_GAP;

                const mini = new St.Widget({ style_class: 'tilo-mini', reactive: false });
                mini.set_position(mx, my);
                mini.set_size(Math.max(1, mw), Math.max(1, mh));
                thumb.add_child(mini);
                minis.push(mini);

                miniRects.push({ x: this._barX + tx + mx, y: this._barY + ty + my,
                                 width: mw, height: mh });
            });
            this._minis.push(minis);
            this._miniRects.push(miniRects);

            /* The real screen rectangles this thumbnail stands for. */
            this._realZones.push(Layouts.resolveLayout(layout, workArea, inner, outer));
        });

        this._bar.set_size(barW, barH);
    }

    /* ---------------------------------------------------------------- states */

    showHint(workArea) {
        if (this._state !== 'hidden') return;
        this._build(workArea);

        this._state = 'hint';
        this._bar.remove_all_transitions();
        this._bar.set_position(Math.round(this._workArea.x +
                                          (this._workArea.width - HINT_W) / 2),
                               this._workArea.y);
        this._bar.set_size(HINT_W, HINT_H);
        this._bar.opacity = 0;
        this._bar.add_style_class_name('tilo-bar-hint');
        this._thumbs.forEach(t => t.hide());
        this._bar.show();
        this._bar.ease({ opacity: 255, duration: SHOW_MS,
                         mode: Clutter.AnimationMode.EASE_OUT_QUAD });
    }

    expand() {
        if (this._state !== 'hint') return;
        this._state = 'expanded';
        this._bar.remove_style_class_name('tilo-bar-hint');
        this._thumbs.forEach(t => t.show());
        this._bar.remove_all_transitions();
        this._bar.ease({
            x: this._barX, y: this._barY,
            width: this._barW, height: this._barH,
            opacity: 255, duration: SHOW_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD
        });
    }

    /* Summoned by shortcut: straight to the expanded state, no hint stage. */
    showExpanded(workArea) {
        if (this._state === 'expanded') return;
        if (this._state === 'hidden') this._build(workArea);

        this._state = 'expanded';
        this._bar.remove_all_transitions();
        this._bar.remove_style_class_name('tilo-bar-hint');
        this._thumbs.forEach(t => t.show());
        this._bar.set_position(this._barX, this._barY - 12);
        this._bar.set_size(this._barW, this._barH);
        this._bar.opacity = 0;
        this._bar.show();
        this._bar.ease({ y: this._barY, opacity: 255, duration: SHOW_MS,
                         mode: Clutter.AnimationMode.EASE_OUT_QUAD });
    }

    hide() {
        if (this._state === 'hidden') return;
        this._state = 'hidden';
        this._setHovered(null);
        this._hideGhost();

        this._bar.remove_all_transitions();
        this._bar.ease({
            opacity: 0, duration: HIDE_MS,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => { if (this._bar) this._bar.hide(); }
        });
    }

    /* ------------------------------------------------------------- pointing */

    /*
     * Feed the polled pointer position. Returns true when it rests on a zone.
     */
    updatePointer(x, y) {
        if (this._state !== 'expanded') return false;

        for (let i = 0; i < this._miniRects.length; i++) {
            for (let j = 0; j < this._miniRects[i].length; j++) {
                if (Geometry.contains(this._miniRects[i][j], x, y)) {
                    this._setHovered({ layout: i, zone: j });
                    return true;
                }
            }
        }
        this._setHovered(null);
        return false;
    }

    /* Is the pointer inside the bar's own rectangle? */
    containsPointer(x, y) {
        if (this._state === 'hidden') return false;
        const r = this._state === 'expanded'
            ? { x: this._barX, y: this._barY, width: this._barW, height: this._barH }
            : { x: this._barX, y: this._barY, width: this._barW, height: THUMB_H };
        return Geometry.contains(r, x, y);
    }

    _setHovered(next) {
        const same = this._hovered && next &&
                     this._hovered.layout === next.layout &&
                     this._hovered.zone === next.zone;
        if (same) return;

        if (this._hovered) {
            const prev = this._minis[this._hovered.layout][this._hovered.zone];
            prev.remove_all_transitions();
            prev.remove_style_class_name('tilo-mini-active');
            this._thumbs[this._hovered.layout].remove_style_class_name('tilo-thumb-active');
        }

        this._hovered = next;

        if (next) {
            const mini = this._minis[next.layout][next.zone];
            mini.add_style_class_name('tilo-mini-active');
            this._thumbs[next.layout].add_style_class_name('tilo-thumb-active');
            this._showGhost(this._realZones[next.layout][next.zone]);
        } else {
            this._hideGhost();
        }
    }

    /*
     * The second layer of feedback: a translucent rectangle drawn over the real
     * screen area the window will occupy. Hovering a 3 mm thumbnail is not
     * enough to judge a placement.
     */
    _showGhost(rect) {
        this._ghost.remove_all_transitions();
        if (!this._ghost.visible) {
            this._ghost.set_position(rect.x, rect.y);
            this._ghost.set_size(rect.width, rect.height);
            this._ghost.opacity = 0;
            this._ghost.show();
        }
        this._ghost.ease({
            x: rect.x, y: rect.y, width: rect.width, height: rect.height,
            opacity: 255, duration: HOVER_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD
        });
    }

    _hideGhost() {
        if (!this._ghost || !this._ghost.visible) return;
        this._ghost.remove_all_transitions();
        this._ghost.ease({
            opacity: 0, duration: HOVER_MS,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => { if (this._ghost) this._ghost.hide(); }
        });
    }
}

module.exports = { LayoutPicker };
