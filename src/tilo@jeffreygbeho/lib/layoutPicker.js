/*
 * tilo - the layout picker overlay.
 *
 * Two surfaces and one object. A tab hangs from the top edge for the whole of a
 * drag; move onto it and it grows into the full bar. It grows rather than
 * cross-fades, because the tab and the bar are meant to read as the same thing
 * at two sizes, and a cross-fade reads as two different things swapping places.
 *
 * Geometry is computed by hand rather than delegated to a layout manager,
 * because hit testing must work while the window manager holds a pointer grab
 * (no Clutter events reach us then). Knowing every rectangle up front is what
 * makes that possible, and it is also what lets every coordinate be an integer:
 * a fractional actor position is resampled and comes out soft.
 *
 * This module decides which zone is under the pointer. It never moves a window.
 */

const St = require('gi.St');
const Main = require('ui.main');
const Layouts = require('./lib/layouts');
const Geometry = require('./lib/geometry');
const Motion = require('./lib/motion');
const Logger = require('./lib/logger');

/* The bar. Thumbnail proportions are a mini screen, roughly 16:10. */
const THUMB_W = 128;
const THUMB_H = 80;
const THUMB_GAP = 10;
const BAR_PAD = 10;
const MINI_INSET = 2;

/*
 * The tab. This is the discovery surface: every zone tool in this category
 * hides behind a gesture nobody is told about, so a few miniature layouts hang
 * from the top edge the moment a window is picked up. It says what is on offer
 * without a word of text and costs nothing to ignore.
 */
const TEASER_THUMB_W = 46;
const TEASER_THUMB_H = 28;
const TEASER_GAP = 6;
const TEASER_PAD = 8;
const TEASER_COUNT = 3;
const TEASER_MINI_INSET = 1;

/* Hit areas, deliberately larger than what is drawn. Someone who has moved a
   window towards the tab has already said what they want. */
const TEASER_HIT_MARGIN = 26;
const BAR_HIT_MARGIN = 32;

/* The hovered zone lifts slightly. Enough to feel, not enough to notice. */
const HOVER_SCALE = 1.09;
const STAGGER_MS = 22;

/*
 * Rectangles for the zones inside one thumbnail, in integer pixels.
 *
 * Rounds the EDGES and derives the size, never the other way round. Rounding a
 * position and a width separately lets two neighbours disagree about where
 * their shared boundary is, which shows up as a one pixel seam or overlap. The
 * same rule governs real window placement in geometry.js.
 */
function miniRects(zones, width, height, inset) {
    return zones.map(([fx, fy, fw, fh]) => {
        const x0 = Math.round(fx * width);
        const x1 = Math.round((fx + fw) * width);
        const y0 = Math.round(fy * height);
        const y1 = Math.round((fy + fh) * height);
        return {
            x: x0 + inset,
            y: y0 + inset,
            width: Math.max(1, x1 - x0 - 2 * inset),
            height: Math.max(1, y1 - y0 - 2 * inset)
        };
    });
}

class LayoutPicker {
    /* getGaps: () => ({ inner, outer }) */
    constructor(getGaps) {
        this._getGaps = getGaps;
        this._state = 'hidden';        /* hidden | teaser | expanded */
        this._hovered = null;
        this._layouts = [];
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
        /* Clipped so the thumbnails are revealed by the bar growing over them
           rather than hanging outside it while it is still small. */
        this._bar.set_clip_to_allocation(true);
        Main.layoutManager.addChrome(this._bar, { affectsInputRegion: false });

        this._teaser = new St.Widget({ style_class: 'tilo-teaser', reactive: false });
        this._teaser.hide();
        Main.layoutManager.addChrome(this._teaser, { affectsInputRegion: false });

        this._thumbs = [];
        this._minis = [];
    }

    destroy() {
        this._clearThumbs();
        if (this._bar) { this._bar.destroy(); this._bar = null; }
        if (this._teaser) { this._teaser.destroy(); this._teaser = null; }
        if (this._ghost) { this._ghost.destroy(); this._ghost = null; }
    }

    get visible() { return this._state !== 'hidden'; }
    get expanded() { return this._state === 'expanded'; }
    get teasing() { return this._state === 'teaser'; }

    hoveredZone() {
        if (!this._hovered) return null;
        return this._realZones[this._hovered.layout][this._hovered.zone];
    }

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
        this._barW = count * THUMB_W + (count - 1) * THUMB_GAP + 2 * BAR_PAD;
        this._barH = THUMB_H + 2 * BAR_PAD;
        this._barX = Math.round(workArea.x + (workArea.width - this._barW) / 2);
        this._barY = workArea.y + 8;

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

            const minis = [];
            const stageRects = [];
            miniRects(layout.zones, THUMB_W, THUMB_H, MINI_INSET).forEach(r => {
                const mini = new St.Widget({ style_class: 'tilo-mini', reactive: false });
                mini.set_position(r.x, r.y);
                mini.set_size(r.width, r.height);
                mini.set_pivot_point(0.5, 0.5);
                thumb.add_child(mini);
                minis.push(mini);

                stageRects.push({ x: this._barX + tx + r.x, y: this._barY + ty + r.y,
                                  width: r.width, height: r.height });
            });
            this._minis.push(minis);
            this._miniRects.push(stageRects);

            this._realZones.push(Layouts.resolveLayout(layout, workArea, inner, outer));
        });

        this._bar.set_size(this._barW, this._barH);
    }

    _buildTeaser(workArea) {
        this._teaser.destroy_all_children();

        const layouts = Layouts.all().slice(0, TEASER_COUNT);
        this._teaserW = layouts.length * TEASER_THUMB_W +
                        (layouts.length - 1) * TEASER_GAP + 2 * TEASER_PAD;
        this._teaserH = TEASER_THUMB_H + 2 * TEASER_PAD;
        this._teaserX = Math.round(workArea.x + (workArea.width - this._teaserW) / 2);
        this._teaserY = workArea.y;

        layouts.forEach((layout, i) => {
            const thumb = new St.Widget({ style_class: 'tilo-teaser-thumb' });
            thumb.set_position(TEASER_PAD + i * (TEASER_THUMB_W + TEASER_GAP), TEASER_PAD);
            thumb.set_size(TEASER_THUMB_W, TEASER_THUMB_H);
            this._teaser.add_child(thumb);

            miniRects(layout.zones, TEASER_THUMB_W, TEASER_THUMB_H,
                      TEASER_MINI_INSET).forEach(r => {
                const mini = new St.Widget({ style_class: 'tilo-teaser-mini' });
                mini.set_position(r.x, r.y);
                mini.set_size(r.width, r.height);
                thumb.add_child(mini);
            });
        });

        this._teaser.set_size(this._teaserW, this._teaserH);
    }

    /* --------------------------------------------------------------- states */

    showTeaser(workArea) {
        if (this._state !== 'hidden') return;
        this._build(workArea);
        this._buildTeaser(workArea);
        this._state = 'teaser';

        this._teaser.remove_all_transitions();
        this._teaser.set_position(this._teaserX, this._teaserY - this._teaserH);
        this._teaser.opacity = 0;
        this._teaser.show();
        Motion.arrive(this._teaser, {
            y: this._teaserY, opacity: 255, duration: Motion.MS.normal
        });
    }

    /*
     * The tab grows into the bar. Starting the bar at the tab's exact rectangle
     * and easing it out to full size is what makes them read as one object;
     * the thumbnails then fade in behind the growing edge, staggered, so the
     * reveal has a direction instead of appearing all at once.
     */
    expand() {
        if (this._state !== 'teaser') return;
        this._state = 'expanded';

        this._teaser.remove_all_transitions();
        Motion.leave(this._teaser, {
            opacity: 0, duration: Motion.MS.quick,
            onComplete: () => { if (this._teaser) this._teaser.hide(); }
        });

        this._bar.remove_all_transitions();
        this._bar.set_position(this._teaserX, this._teaserY);
        this._bar.set_size(this._teaserW, this._teaserH);
        this._bar.opacity = 0;
        this._bar.show();

        this._thumbs.forEach(thumb => {
            thumb.remove_all_transitions();
            thumb.opacity = 0;
        });

        Motion.arrive(this._bar, {
            x: this._barX, y: this._barY,
            width: this._barW, height: this._barH,
            opacity: 255, duration: Motion.MS.morph
        });

        this._thumbs.forEach((thumb, i) => {
            Motion.arrive(thumb, {
                opacity: 255, duration: Motion.MS.normal, delay: 40 + i * STAGGER_MS
            });
        });
    }

    /* Shrinks back into the tab. The drag is still going, so the offer stays. */
    collapse() {
        if (this._state !== 'expanded') return;
        this._state = 'teaser';
        this._setHovered(null);
        this._hideGhost();

        this._bar.remove_all_transitions();
        Motion.leave(this._bar, {
            x: this._teaserX, y: this._teaserY,
            width: this._teaserW, height: this._teaserH,
            opacity: 0, duration: Motion.MS.quick,
            onComplete: () => { if (this._bar) this._bar.hide(); }
        });

        this._teaser.remove_all_transitions();
        this._teaser.set_position(this._teaserX, this._teaserY);
        this._teaser.show();
        Motion.arrive(this._teaser, { opacity: 255, duration: Motion.MS.normal });
    }

    /* Summoned by shortcut: straight to the bar, with no tab to grow from. */
    showExpanded(workArea) {
        if (this._state === 'expanded') return;
        if (this._state === 'hidden') this._build(workArea);
        this._state = 'expanded';

        this._bar.remove_all_transitions();
        this._bar.set_position(this._barX, this._barY - 10);
        this._bar.set_size(this._barW, this._barH);
        this._bar.opacity = 0;
        this._bar.show();
        this._thumbs.forEach(t => { t.remove_all_transitions(); t.opacity = 0; });

        Motion.arrive(this._bar, {
            y: this._barY, opacity: 255, duration: Motion.MS.normal
        });
        this._thumbs.forEach((thumb, i) => {
            Motion.arrive(thumb, {
                opacity: 255, duration: Motion.MS.normal, delay: 30 + i * STAGGER_MS
            });
        });
    }

    hide() {
        if (this._state === 'hidden') return;
        this._state = 'hidden';
        this._setHovered(null);
        this._hideGhost();

        this._teaser.remove_all_transitions();
        Motion.leave(this._teaser, {
            opacity: 0, duration: Motion.MS.quick,
            onComplete: () => { if (this._teaser) this._teaser.hide(); }
        });

        this._bar.remove_all_transitions();
        Motion.leave(this._bar, {
            opacity: 0, duration: Motion.MS.quick,
            onComplete: () => { if (this._bar) this._bar.hide(); }
        });
    }

    /* ------------------------------------------------------------- pointing */

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

    /* Is the pointer on the tab, or close enough underneath it to count? */
    overTeaser(x, y) {
        if (this._state !== 'teaser') return false;
        return Geometry.contains({
            x: this._teaserX - TEASER_HIT_MARGIN,
            y: this._teaserY,
            width: this._teaserW + 2 * TEASER_HIT_MARGIN,
            height: this._teaserH + TEASER_HIT_MARGIN
        }, x, y);
    }

    /* Is the pointer on the open bar, or close enough to still count? */
    nearBar(x, y) {
        if (this._state !== 'expanded') return false;
        return Geometry.contains({
            x: this._barX - BAR_HIT_MARGIN,
            y: this._barY - BAR_HIT_MARGIN,
            width: this._barW + 2 * BAR_HIT_MARGIN,
            height: this._barH + 2 * BAR_HIT_MARGIN
        }, x, y);
    }

    containsPointer(x, y) {
        return this._state === 'expanded' ? this.nearBar(x, y) : this.overTeaser(x, y);
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
            Motion.move(prev, { scale_x: 1, scale_y: 1, duration: Motion.MS.hover });
            this._thumbs[this._hovered.layout].remove_style_class_name('tilo-thumb-active');
        }

        this._hovered = next;

        if (next) {
            const mini = this._minis[next.layout][next.zone];
            mini.remove_all_transitions();
            mini.add_style_class_name('tilo-mini-active');
            Motion.move(mini, {
                scale_x: HOVER_SCALE, scale_y: HOVER_SCALE, duration: Motion.MS.hover
            });
            this._thumbs[next.layout].add_style_class_name('tilo-thumb-active');
            this._showGhost(this._realZones[next.layout][next.zone]);
        } else {
            this._hideGhost();
        }
    }

    /*
     * The second layer of feedback: a translucent rectangle over the real screen
     * area the window will occupy. Hovering a thumbnail a few millimetres wide
     * is not enough to judge a placement.
     */
    _showGhost(rect) {
        this._ghost.remove_all_transitions();
        if (!this._ghost.visible) {
            this._ghost.set_position(rect.x, rect.y);
            this._ghost.set_size(rect.width, rect.height);
            this._ghost.opacity = 0;
            this._ghost.show();
            Motion.arrive(this._ghost, { opacity: 255, duration: Motion.MS.hover });
            return;
        }
        /* Already up: it travels rather than reappears. */
        Motion.move(this._ghost, {
            x: rect.x, y: rect.y, width: rect.width, height: rect.height,
            opacity: 255, duration: Motion.MS.ghost
        });
    }

    _hideGhost() {
        if (!this._ghost || !this._ghost.visible) return;
        this._ghost.remove_all_transitions();
        Motion.leave(this._ghost, {
            opacity: 0, duration: Motion.MS.hover,
            onComplete: () => { if (this._ghost) this._ghost.hide(); }
        });
    }
}

module.exports = { LayoutPicker };
