/*
 * tilo - ConfigGuard: the consent contract.
 *
 * tilo never modifies a configuration key belonging to anyone else without an
 * explicit gesture from the user, and always restores the original state.
 *
 * The only allowed path to touching a foreign key
 * (e.g. org.cinnamon.desktop.keybindings.wm push-tile-left, org.cinnamon.muffin
 * edge-tiling) is:
 *
 *     explicit opt-in  ->  backup  ->  apply  ->  restore
 *
 * Restore is triggered by: the user unticking the option, the extension being
 * disabled, or uninstallation. Nothing is ever left behind.
 *
 * No override is active in phase 1 - this module exists up front so that phase 2
 * has no excuse to bypass the rule.
 */

const Gio = require('gi.Gio');
const GLib = require('gi.GLib');
const Logger = require('./lib/logger');

/* Resolved lazily, never at import time: a throw during module load would take
   the whole extension down with it. */
let _backupDir = null;
let _backupFile = null;

function _paths() {
    if (_backupDir === null) {
        _backupDir = GLib.build_filenamev([GLib.get_user_config_dir(), 'tilo']);
        _backupFile = GLib.build_filenamev([_backupDir, 'overrides.json']);
    }
    return { dir: _backupDir, file: _backupFile };
}

function _readBackups() {
    try {
        const file = Gio.File.new_for_path(_paths().file);
        if (!file.query_exists(null)) return {};
        const [ok, bytes] = file.load_contents(null);
        if (!ok) return {};
        return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
        Logger.error('Could not read backups', e);
        return {};
    }
}

function _writeBackups(backups) {
    try {
        const { dir, file } = _paths();
        GLib.mkdir_with_parents(dir, 0o755);
        GLib.file_set_contents(file, JSON.stringify(backups, null, 2));
        return true;
    } catch (e) {
        Logger.error('Could not write backups', e);
        return false;
    }
}

function _key(schemaId, key) {
    return `${schemaId}::${key}`;
}

/*
 * Takes over a foreign key after recording its original value.
 * Call ONLY from a path where the user has explicitly consented.
 */
function override(schemaId, key, newValue) {
    const backups = _readBackups();
    const id = _key(schemaId, key);

    try {
        const settings = new Gio.Settings({ schema_id: schemaId });

        /* Never overwrite an existing backup: the first value we saw is the
           user's legitimate value. */
        if (backups[id] === undefined) {
            backups[id] = settings.get_value(key).print(true);
            if (!_writeBackups(backups)) {
                Logger.error(`Could not back up ${id} - override cancelled`);
                return false;
            }
            Logger.info(`Recorded original value for ${id}`);
        }

        settings.set_value(key, GLib.Variant.parse(null, newValue, null, null));
        Logger.info(`Key overridden: ${id}`);
        return true;
    } catch (e) {
        Logger.error(`Override of ${id} failed`, e);
        return false;
    }
}

/* Restores a single key to its original state. */
function restore(schemaId, key) {
    const backups = _readBackups();
    const id = _key(schemaId, key);
    if (backups[id] === undefined) return true; /* never touched */

    try {
        const settings = new Gio.Settings({ schema_id: schemaId });
        settings.set_value(key, GLib.Variant.parse(null, backups[id], null, null));
        delete backups[id];
        _writeBackups(backups);
        Logger.info(`Key restored: ${id}`);
        return true;
    } catch (e) {
        Logger.error(`Restore of ${id} failed`, e);
        return false;
    }
}

/* Safety net: called on every disable(). Never leaves anything behind. */
function restoreAll() {
    const backups = _readBackups();
    const ids = Object.keys(backups);
    if (ids.length === 0) return;

    Logger.info(`Restoring ${ids.length} overridden key(s)`);
    ids.forEach(id => {
        const [schemaId, key] = id.split('::');
        restore(schemaId, key);
    });
}

function hasOverrides() {
    return Object.keys(_readBackups()).length > 0;
}

module.exports = { override, restore, restoreAll, hasOverrides };
