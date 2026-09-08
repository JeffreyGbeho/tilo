/*
 * tilo - test harness.
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
  'gi.Graphene': { Point: class { init() {} } },
  'gi.Clutter': { AnimationMode: { EASE_OUT_QUAD: 0, EASE_IN_QUAD: 1, CUBIC_BEZIER: 35 },
                  ModifierType: { BUTTON1_MASK: 256 } },
  'gi.Meta': { WindowType: { NORMAL: 0 }, MaximizeFlags: { BOTH: 3 },
               GrabOp: { MOVING: 1, KEYBOARD_MOVING: 2 } },
  'gi.Gio': { File: { new_for_path: () => ({ query_exists: () => false }) } },
  'gi.GLib': { build_filenamev: a => a.join('/'), get_user_config_dir: () => '/tmp/x',
               get_home_dir: () => '/tmp/x', mkdir_with_parents: () => 0,
               file_set_contents: () => true },
  'gettext': { bindtextdomain() {}, dgettext: (d, s) => s, gettext: s => s }
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
                 './lib/layoutPicker', './lib/layoutTree', './lib/zoneEditor', './lib/tileGroup', './lib/savedGroups', './lib/groupSwitcher', './lib/i18n', './lib/hoverIntent', './lib/motion']) {
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

  const all = Layouts.all().flatMap(l => Layouts.resolveLayout(l, WA, inner, outer));
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

const Tree = cinnamonRequire('./lib/layoutTree');
const { leaf, branch } = Tree;

console.log('\nLayout tree');
const halves = branch('row', [leaf(), leaf()]);
ok(JSON.stringify(Tree.toFractions(halves)) === JSON.stringify([[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]]),
   'a row of two leaves is two halves');
const weighted = branch('row', [leaf(), leaf()], [2, 1]);
ok(Math.abs(Tree.toFractions(weighted)[0][2] - 2 / 3) < 1e-9, 'weights [2,1] give a two thirds split');

const split = Tree.splitAt(halves, [1], 'col');
ok(Tree.countZones(split) === 3, 'splitting a zone yields one more zone');
ok(JSON.stringify(Tree.toFractions(split)[0]) === JSON.stringify([0, 0, 0.5, 1]),
   'splitting one zone leaves the others untouched');
ok(Tree.countZones(halves) === 2, 'the original tree is not mutated');

const removed = Tree.removeAt(split, [1, 0]);
ok(Tree.countZones(removed) === 2, 'removing a zone yields one fewer');
ok(JSON.stringify(Tree.toFractions(removed)) === JSON.stringify([[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]]),
   'a branch left with one child collapses into it');
ok(Tree.countZones(Tree.removeAt(leaf(), [])) === 1, 'the last zone cannot be removed');

const resized = Tree.resizeAt(halves, [], 0, 0.2);
ok(Math.abs(Tree.toFractions(resized)[0][2] - 0.7) < 1e-9, 'dragging a border moves it by the delta');
ok(JSON.stringify(Tree.resizeAt(halves, [], 0, 0.9)) === JSON.stringify(halves),
   'a drag that would collapse a zone is refused');

ok(!Tree.isValid({ dir: 'row', children: [leaf()], weights: [1] }), 'a one child branch is invalid');
ok(!Tree.isValid({ dir: 'diag', children: [leaf(), leaf()], weights: [1, 1] }), 'an unknown direction is invalid');
ok(!Tree.isValid({ dir: 'row', children: [leaf(), leaf()], weights: [1] }), 'mismatched weights are invalid');
ok(Tree.isValid(Layouts.BUILTIN[4].tree), 'the 4x3 grid is a valid tree');

console.log('\nBoundaries between zones');
/* row [ leaf , col [ leaf , leaf ] ]  with weights [2,1] */
const mainSide = branch('row', [leaf(), branch('col', [leaf(), leaf()])], [2, 1]);
const zones = Tree.toZones(mainSide);
ok(JSON.stringify(Tree.rectAt(mainSide, [1])) === JSON.stringify([2 / 3, 0, 1 / 3, 1]),
   'rectAt reports the rectangle of a branch, not just a leaf');
ok(JSON.stringify(Tree.boundaryFor(mainSide, zones[0].path, 'right')) ===
   JSON.stringify({ path: [], index: 0 }), 'the big zone owns the root boundary on its right');
ok(Tree.boundaryFor(mainSide, zones[0].path, 'left') === null,
   'its left edge is the screen edge and cannot move');
ok(JSON.stringify(Tree.boundaryFor(mainSide, zones[1].path, 'bottom')) ===
   JSON.stringify({ path: [1], index: 0 }), 'the top right zone owns the boundary inside its column');
ok(JSON.stringify(Tree.boundaryFor(mainSide, zones[1].path, 'left')) ===
   JSON.stringify({ path: [], index: 0 }),
   'a left edge walks up past its own parent to the split that actually owns it');
ok(Tree.boundaryFor(mainSide, zones[1].path, 'top') === null, 'top of the top zone is fixed');
ok(Tree.boundaryFor(mainSide, zones[2].path, 'bottom') === null, 'bottom of the bottom zone is fixed');

console.log('\nEvery built-in layout still resolves as before');
const EXPECTED = { halves: 2, thirds: 3, 'main-side': 3, quarters: 4, 'grid-4x3': 12 };
Object.keys(EXPECTED).forEach(id => {
  ok(Layouts.layoutById(id).zones.length === EXPECTED[id], `${id} has ${EXPECTED[id]} zones`);
});
ok(JSON.stringify(Layouts.layoutById('main-side').zones[0]) === JSON.stringify([0, 0, 2 / 3, 1]),
   'main-side keeps its two thirds column');

console.log('\nTranslation');
const I18n = cinnamonRequire('./lib/i18n');
ok(typeof I18n._ === 'function', 'i18n exports a translation function');
ok(I18n._('Two halves') === 'Two halves', 'an untranslated string comes back unchanged');
ok(Layouts.layoutById('halves').name === 'Two halves', 'layout names go through it');

console.log('\nCustom layouts');
Layouts.setCustom([{ id: 'mine', name: 'Mine', tree: branch('col', [leaf(), leaf(), leaf()]) }]);
ok(Layouts.all().length === 6, 'a custom layout joins the built-ins');
ok(Layouts.layoutById('mine').zones.length === 3, 'a custom layout resolves its zones');
Layouts.setCustom([{ id: 'bad', tree: { dir: 'row', children: [leaf()], weights: [1] } }]);
ok(Layouts.all().length === 5, 'a malformed stored layout is dropped rather than loaded');
Layouts.setCustom([]);

console.log('\nPointer hit testing');
const [L, R] = Layouts.resolveLayout(Layouts.layoutById('halves'), WA, 8, 8);
ok(Layouts.zoneAt([L, R], 100, 500) === 0, 'pointer left -> zone 0');
ok(Layouts.zoneAt([L, R], 1800, 500) === 1, 'pointer right -> zone 1');
ok(Layouts.zoneAt([L, R], 960, 500) === -1, 'pointer in the gap -> no zone');
ok(Layouts.zoneAt([L, R], 100, 1070) === -1, 'pointer on the panel -> no zone');

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail ? 1 : 0);
