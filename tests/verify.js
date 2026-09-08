/*
 * tilo — test harness.
 *
 * Mimics Cinnamon's requireModule() semantics: relative paths ALWAYS resolve
 * from the extension root, never from the requiring file. Node resolves the
 * other way, so a plain Node test passes on code Cinnamon refuses to load.
 * That difference already shipped one broken build; this file exists to stop
 * it happening twice.
 *
 *   node tests/verify.js src/tilo@jeffreygbeho
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = process.argv[2] || 'src/tilo@jeffreygbeho';
const cache = new Map();

/* Stand-ins for the imports that only exist inside Cinnamon. */
const STUBS = {
  'mainloop': { idle_add: () => 0, timeout_add: () => 0, source_remove: () => {} },
  'ui.main': { layoutManager: { addChrome() {} },
               keybindingManager: { addHotKey() {}, removeHotKey() {} } },
  'ui.settings': { ExtensionSettings: class { bind() { return true; } finalize() {} } },
  'gi.St': { Widget: class {} },
  'gi.Clutter': { AnimationMode: { EASE_OUT_QUAD: 0, EASE_IN_QUAD: 1 },
                  ModifierType: { BUTTON1_MASK: 256 } },
  'gi.Meta': { WindowType: { NORMAL: 0 }, MaximizeFlags: { BOTH: 3 },
               GrabOp: { MOVING: 1, KEYBOARD_MOVING: 2 } },
  'gi.Gio': { File: { new_for_path: () => ({ query_exists: () => false }) } },
  'gi.GLib': { build_filenamev: a => a.join('/'), get_user_config_dir: () => '/tmp/x',
               mkdir_with_parents: () => 0, file_set_contents: () => true }
};

function cinnamonRequire(request) {
  if (STUBS[request]) return STUBS[request];
  let p = request.replace(/\.\//g, '');       // exactly what Cinnamon does
  if (!p.endsWith('.js')) p += '.js';
  const abs = path.join(ROOT, p);             // ALWAYS from the root
  if (cache.has(abs)) return cache.get(abs);
  if (!fs.existsSync(abs)) throw new Error(`[requireModule] Path does not exist.\n${abs}`);
  const module = { exports: {} };
  cache.set(abs, module.exports);
  vm.runInNewContext(fs.readFileSync(abs, 'utf8'), {
    require: cinnamonRequire, module, exports: module.exports,
    __meta: {}, __dirname: ROOT, __filename: path.basename(abs),
    global: { log() {}, logError() {}, get_pointer: () => [0, 0, 0] },
    console, TextDecoder, Math, JSON, Object, Array
  });
  cache.set(abs, module.exports);
  return module.exports;
}

let fail = 0;
const ok = (c, label, detail = '') => {
  console.log(`  ${c ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
  if (!c) fail++;
};

console.log('Module loading (Cinnamon resolution rules)');
for (const m of ['./extension', './lib/logger', './lib/geometry', './lib/windowMover',
                 './lib/layouts', './lib/configGuard', './lib/dragWatcher',
                 './lib/layoutPicker']) {
  try { cinnamonRequire(m); ok(true, `loads ${m}`); }
  catch (e) { ok(false, `loads ${m}`, String(e.message).split('\n')[0]); }
}
const Ext = cinnamonRequire('./extension');
ok(['init', 'enable', 'disable'].every(f => typeof Ext[f] === 'function'),
   'extension exports init/enable/disable (required by extension.js:102)');
ok(typeof cinnamonRequire('./lib/dragWatcher').DragWatcher === 'function',
   'dragWatcher exports DragWatcher');
ok(typeof cinnamonRequire('./lib/layoutPicker').LayoutPicker === 'function',
   'layoutPicker exports LayoutPicker');

const Geometry = cinnamonRequire('./lib/geometry');
const Layouts = cinnamonRequire('./lib/layouts');
const WA = { x: 0, y: 0, width: 1920, height: 1040 };   // 1080 minus a 40px panel

for (const [inner, outer] of [[0, 0], [8, 8]]) {
  console.log(`\nGaps inner ${inner} / outer ${outer}`);
  const [L, R] = Layouts.resolveLayout(Layouts.layoutById('halves'), WA, inner, outer);
  ok(L.x === outer, 'exact left outer margin', `${L.x}px`);
  ok(R.x + R.width === WA.width - outer, 'exact right outer margin');
  ok(L.y + L.height === WA.height - outer, 'stops exactly at the panel');
  ok(R.x - (L.x + L.width) === inner, 'exact gap between windows');
  ok(L.width === R.width, 'halves are identical', `${L.width}px each`);

  const all = Layouts.LAYOUTS.flatMap(l => Layouts.resolveLayout(l, WA, inner, outer));
  ok(all.every(z => z.y >= WA.y && z.y + z.height <= WA.y + WA.height),
     `no zone escapes the work area (${all.length} zones)`);
  ok(all.every(z => z.x >= WA.x && z.x + z.width <= WA.x + WA.width),
     'no horizontal overflow');
  ok(all.every(z => z.width > 0 && z.height > 0), 'no degenerate zone');

  const grid = Layouts.resolveLayout(Layouts.layoutById('grid-4x3'), WA, inner, outer);
  const hits = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width &&
                         a.y < b.y + b.height && b.y < a.y + a.height;
  let col = 0;
  for (let i = 0; i < grid.length; i++)
    for (let j = i + 1; j < grid.length; j++) if (hits(grid[i], grid[j])) col++;
  ok(grid.length === 12 && col === 0, 'grid 4x3: 12 zones, no overlap', `${col} collisions`);
}

console.log('\nPointer hit testing');
const [L, R] = Layouts.resolveLayout(Layouts.layoutById('halves'), WA, 8, 8);
ok(Layouts.zoneAt([L, R], 100, 500) === 0, 'pointer left -> zone 0');
ok(Layouts.zoneAt([L, R], 1800, 500) === 1, 'pointer right -> zone 1');
ok(Layouts.zoneAt([L, R], 960, 500) === -1, 'pointer in the gap -> no zone');
ok(Layouts.zoneAt([L, R], 100, 1070) === -1, 'pointer on the panel -> no zone');

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail ? 1 : 0);
