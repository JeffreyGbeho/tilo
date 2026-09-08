/*
 * tilo - modern window tiling for Cinnamon.
 * https://github.com/JeffreyGbeho/tilo
 *
 * See docs/ARCHITECTURE.md for the constraints this design answers.
 */

const Main = require('ui.main');
const Settings = require('ui.settings');
const Clutter = require('gi.Clutter');
const Mainloop = require('mainloop');

const Logger = require('./lib/logger');
const Geometry = require('./lib/geometry');
const WindowMover = require('./lib/windowMover');
const Layouts = require('./lib/layouts');
const ConfigGuard = require('./lib/configGuard');
const { DragWatcher } = require('./lib/dragWatcher');
const { LayoutPicker } = require('./lib/layoutPicker');
const { ZoneEditor } = require('./lib/zoneEditor');
const Tree = require('./lib/layoutTree');

const UUID = 'tilo@jeffreygbeho';

/* Only the middle of the top edge reveals the bar, so dragging a window into a
   top corner still means "corner", as it does everywhere else. */
const CENTER_BAND = 0.3;

/* Poll interval while the picker is summoned by shortcut rather than by drag. */
const KEY_POLL_MS = 16;

const BINDINGS = [
    { setting: 'kb-left',   position: 'left'   },
    { setting: 'kb-right',  position: 'right'  },
    { setting: 'kb-top',    position: 'top'    },
    { setting: 'kb-bottom', position: 'bottom' },
    { setting: 'kb-fill',   position: 'fill'   },
    { setting: 'kb-center', position: 'center' }
];

class Tilo {
    constructor(meta) {
        this._meta = meta;
        this._settings = null;
        this._registered = [];
        this._picker = null;
        this._editor = null;
        this._drag = null;
        this._keyPollId = 0;
        this._keyMode = false;
        this._enabled = false;
    }

    enable() {
        if (this._enabled) return;

        this._settings = new Settings.ExtensionSettings(this, UUID);
        ['inner-gap', 'outer-gap', 'debug', 'drag-to-top', 'reveal-threshold']
            .forEach(key => this._settings.bind(key, this._propertyFor(key),
                                                () => this._onSettingsChanged()));
        this._settings.bind('custom-layouts', 'customLayouts',
                            () => Layouts.setCustom(this.customLayouts));
        Layouts.setCustom(this.customLayouts);
        BINDINGS.concat([{ setting: 'kb-picker' }, { setting: 'kb-editor' }]).forEach(({ setting }) => {
            this._settings.bind(setting, this._propertyFor(setting),
                                () => this._rebindHotkeys());
        });

        Logger.setDebug(this.debugEnabled);

        this._picker = new LayoutPicker(() => ({
            inner: this.innerGap, outer: this.outerGap
        }));

        this._editor = new ZoneEditor({
            onSave: tree => this._saveLayout(tree),
            onCancel: () => Logger.debug('editor cancelled')
        });

        this._drag = new DragWatcher({
            onDragMove: (w, x, y) => this._onDragMove(w, x, y),
            onDragEnd: (w, x, y) => this._onDragEnd(w, x, y)
        });
        this._drag.enable();

        this._rebindHotkeys();

        this._enabled = true;
        Logger.info(`enabled (v${this._meta.version || '?'})`);
    }

    /*
     * disable() must give everything back. An extension that leaks on disable is
     * exactly what gives window tiling on Linux a bad name.
     */
    disable() {
        this._stopKeyMode();
        this._unbindHotkeys();

        if (this._editor) { this._editor.close(); this._editor = null; }
        if (this._drag) { this._drag.disable(); this._drag = null; }
        if (this._picker) { this._picker.destroy(); this._picker = null; }
        WindowMover.reset();

        /* Safety net: if a foreign key override was active, hand the user their
           original state back before we leave. */
        ConfigGuard.restoreAll();

        if (this._settings) {
            this._settings.finalize();
            this._settings = null;
        }

        this._enabled = false;
        Logger.info('disabled, state restored');
    }

    _propertyFor(key) {
        /* 'kb-left' -> 'kbLeft', 'drag-to-top' -> 'dragToTop' */
        return key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    }

    _onSettingsChanged() {
        Logger.setDebug(this.debugEnabled);
    }

    /* ------------------------------------------------------------- shortcuts */

    _rebindHotkeys() {
        this._unbindHotkeys();

        BINDINGS.forEach(({ setting, position }) => {
            this._register(`tilo-${position}`, this[this._propertyFor(setting)],
                           () => this._snapTo(position));
        });
        this._register('tilo-picker', this.kbPicker, () => this._toggleKeyMode());
        this._register('tilo-editor', this.kbEditor, () => this._toggleEditor());
    }

    _register(name, combination, callback) {
        if (!combination) return; /* the user cleared this shortcut */
        try {
            Main.keybindingManager.addHotKey(name, combination, callback);
            this._registered.push(name);
        } catch (e) {
            Logger.error(`Could not register ${combination}`, e);
        }
    }

    _unbindHotkeys() {
        this._registered.forEach(name => {
            try { Main.keybindingManager.removeHotKey(name); }
            catch (e) { Logger.error(`Could not remove ${name}`, e); }
        });
        this._registered = [];
    }

    _snapTo(position) {
        const window = WindowMover.focusedTileableWindow();
        if (!window) return;

        const fraction = Layouts.QUICK[position];
        if (!fraction) return;

        const workArea = Geometry.workAreaFor(window);
        WindowMover.place(window,
            Geometry.resolveZone(fraction, workArea, this.innerGap, this.outerGap));
    }

    /* ------------------------------------------------------ drag to the top */

    _onDragMove(window, x, y) {
        if (!this.dragToTop || !WindowMover.isTileable(window)) return;

        const workArea = Geometry.workAreaFor(window);
        const depth = y - workArea.y;
        const expandBand = this.revealThreshold;
        const hintBand = expandBand * 2;

        if (this._picker.expanded) {
            this._picker.updatePointer(x, y);
            if (!this._picker.containsPointer(x, y) && y > this._picker.bottomEdge) {
                this._picker.hide();
            }
            return;
        }

        if (this._picker.visible) {
            if (depth <= expandBand) this._picker.expand();
            else if (depth > hintBand) this._picker.hide();
            return;
        }

        const centerLeft = workArea.x + workArea.width * CENTER_BAND;
        const centerRight = workArea.x + workArea.width * (1 - CENTER_BAND);
        if (depth <= hintBand && x >= centerLeft && x <= centerRight) {
            this._picker.showHint(workArea);
        }
    }

    _onDragEnd(window, x, y) {
        const zone = this._picker ? this._picker.hoveredZone() : null;
        if (this._picker) this._picker.hide();
        if (zone) WindowMover.place(window, zone);
    }

    /* --------------------------------------------------------- zone editor */

    _toggleEditor() {
        if (!this._editor) return;
        if (this._editor.open) { this._editor.close(); return; }

        this._stopKeyMode();
        /* Start from one zone covering the screen, and let the user cut it up.
           A blank canvas needs no explanation; a preset would need undo. */
        this._editor.show(this._currentWorkArea(), Tree.leaf());
    }

    _saveLayout(tree) {
        if (Tree.countZones(tree) < 2) {
            Logger.debug('layout with a single zone discarded');
            return;
        }

        const existing = Layouts.getCustom();
        const layout = {
            id: `custom-${Date.now()}`,
            name: `Custom ${existing.length + 1}`,
            tree
        };
        const next = existing.concat([layout]);

        Layouts.setCustom(next);
        this._settings.setValue('custom-layouts', next);
        Logger.info(`saved "${layout.name}" with ${Tree.countZones(tree)} zones`);
    }

    /* Bound to the button in the settings window. */
    clearCustomLayouts() {
        Layouts.setCustom([]);
        this._settings.setValue('custom-layouts', []);
        Logger.info('custom layouts cleared');
    }

    _currentWorkArea() {
        const window = global.display.get_focus_window();
        if (window) return Geometry.workAreaFor(window);
        const monitor = global.display.get_current_monitor();
        const workspace = global.workspace_manager.get_active_workspace();
        const area = workspace.get_work_area_for_monitor(monitor);
        return { x: area.x, y: area.y, width: area.width, height: area.height };
    }

    /* -------------------------------------------------- picker by shortcut */

    _toggleKeyMode() {
        if (this._keyMode) { this._stopKeyMode(); return; }

        const window = WindowMover.focusedTileableWindow();
        if (!window) return;

        this._keyWindow = window;
        this._picker.showExpanded(Geometry.workAreaFor(window));
        this._keyMode = true;

        /*
         * The same polling path as the drag case: the picker never takes input
         * focus, so one code path serves both surfaces.
         */
        this._keyPollId = Mainloop.timeout_add(KEY_POLL_MS, () => {
            if (!this._keyMode) return false;
            const [x, y, mods] = global.get_pointer();
            this._picker.updatePointer(x, y);
            if (mods & Clutter.ModifierType.BUTTON1_MASK) {
                const zone = this._picker.hoveredZone();
                const window = this._keyWindow;
                this._stopKeyMode();
                if (zone && window) WindowMover.place(window, zone);
                return false;
            }
            return true;
        });
    }

    _stopKeyMode() {
        this._keyMode = false;
        this._keyWindow = null;
        if (this._keyPollId) {
            Mainloop.source_remove(this._keyPollId);
            this._keyPollId = 0;
        }
        if (this._picker) this._picker.hide();
    }
}

let tilo = null;

function init(meta) { tilo = new Tilo(meta); }
function enable() { tilo.enable(); }
function disable() { tilo.disable(); tilo = null; }

module.exports = { init, enable, disable };
