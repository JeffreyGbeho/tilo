# tilo architecture

## Constraints verified on target (Mint 22.1 Xia / Cinnamon 6.4.14 / Muffin 6.4.1 / X11)

| Verified fact | Source | Consequence |
|---|---|---|
| Extensions load from `~/.local/share/cinnamon/extensions/<uuid>/` **then** from each `XDG_DATA_DIRS/cinnamon/extensions/<uuid>/` | `extension.js:619-638` | One source tree serves both Spices (per-user) and the `.deb` (system-wide) |
| `/usr/share` is in `XDG_DATA_DIRS` | env | `.deb` path is `/usr/share/cinnamon/extensions/<uuid>/` |
| The user directory takes **priority** | `extension.js:621-627` | We develop locally without uninstalling the stable release |
| `extension.js` is mandatory and imported as a JS module | `extension.js:221` | No native binary can be loaded. The core is JavaScript by construction |
| `requireModule` provides a CommonJS-style `require()` | `fileUtils.js:241-267` | `require('gi.Meta')`, `require('ui.main')`, `require('./lib/x')`, `module.exports` |
| libmozjs is already resident in the `cinnamon` process | `/proc/<pid>/maps` | A JS extension adds 0 processes and 0 runtimes |
| The folder name must equal the `uuid` | `extension.js:332` | Exactly `tilo@jeffreygbeho` |
| Relative `require()` paths resolve from the **extension root**, never from the requiring file | `fileUtils.js:213-231` - `dir` is closed over and identical for every module | Inside `lib/`, a sibling is `require('./lib/foo')`, **not** `require('./foo')`. Node resolves the other way, so a Node-based test must emulate this or it will pass on broken code |

## Guiding principle

> tilo modifies **no** configuration key belonging to anyone else without
> explicit consent, and restores everything it touched.

This is not only ethics: Debian policy forbids a package from modifying user
configuration at install time.

**Non-negotiable rules:**

1. The package **places files, full stop.** No `postinst` writes to dconf.
2. We **never** write to `org.cinnamon enabled-extensions`. Enabling is a user
   gesture, in *Settings -> Extensions*.
3. All of our settings live in **our own space** (`settings-schema.json`,
   `~/.config/tilo/`). No writes to `org.cinnamon.*` or `org.cinnamon.muffin.*`
   by default.
4. Any takeover of a foreign key (e.g. `push-tile-*`, `edge-tiling`) must go
   through `ConfigGuard`: **explicit opt-in -> backup of the previous value ->
   apply -> restore** on untick, on `disable()`, and on uninstall.
5. `disable()` must give everything back: shortcuts unregistered, actors
   destroyed, signals disconnected, timeouts cancelled. An extension that leaks
   is an extension that gives Linux tiling a bad name.

## Modules

| Module | Responsibility | Does not |
|---|---|---|
| `extension.js` | Lifecycle (`init`/`enable`/`disable`), wiring, shortcuts | No computation logic |
| `lib/geometry.js` | Work area, gap application, rectangle arithmetic | Never touches a window |
| `lib/windowMover.js` | Safe placement: CSD, unmaximize, re-assert | Does not decide *where* |
| `lib/layoutTree.js` | The layout model: a split tree, and pure operations on it | Knows nothing about pixels or actors |
| `lib/layouts.js` | Built-in and custom layouts, pixel resolution, hit testing | Draws nothing |
| `lib/zoneEditor.js` | Full screen editor for cutting a layout up | Does not decide what a layout means |
| `lib/tileGroup.js` | Which window sits in which zone, per monitor and workspace; linked resize | Does not persist anything |
| `lib/savedGroups.js` | Saving an arrangement and matching it back onto open windows | Never launches an application |
| `lib/groupSwitcher.js` | The saved arrangements overlay | Does not decide what a group is |
| `lib/configGuard.js` | Backup/restore of foreign keys, under consent | Applies nothing without opt-in |
| `lib/logger.js` | Prefixed logging, silent by default | - |
| `lib/i18n.js` | Binds the translation catalogue for both install routes | - |
| `lib/motion.js` | Fluent's cubic bezier curves and the durations, in one place | Decides nothing about what animates |
| `lib/hoverIntent.js` | Makes an action wait for the pointer to keep meaning it | Knows nothing about the picker |
| `lib/dragWatcher.js` | `grab-op-begin`/`end`, pointer polling during the grab | Draws nothing |
| `lib/layoutPicker.js` | The picker overlay, its geometry and hit testing (St + Clutter + CSS) | Does not place windows |

Flow: `dragWatcher` detects -> `layoutPicker` offers -> `layouts` resolves the zone
-> `windowMover` places.
Each module is testable in isolation; only `windowMover` has a side effect on
windows.

## The two traps handled from the skeleton on

**CSD (Client-Side Decorations).** Modern GTK apps draw their own title bar and
carry an invisible shadow border. `get_buffer_rect()` includes it,
`get_frame_rect()` does not. Using the wrong one produces a 10-20 px offset and
gaps between windows - the number one reason Linux tiling looks unfinished. tilo
uses **only** `get_frame_rect()` and `move_resize_frame()`.

**Resize increments.** A window that declares resize increments makes Muffin's
constraint engine adjust the requested size - and when it adjusts, the move half
of `move_resize_frame()` is silently dropped. The window lands at the right size
and the *old* position, which reads as "the shortcut resizes but never moves".
`windowMover.js` therefore always follows the resize with a bare `move_frame()`,
which carries no size and so cannot be adjusted away. Measured on GNOME Terminal:
`move_resize_frame` alone left it at +600+400 instead of +0+0; adding
`move_frame` put it at +0+0 exactly.

Such apps still round their own size down - GNOME Terminal to whole character
rows, about 10px. tilo places them at the zone's top-left corner and the
shortfall falls to the bottom-right. This is the app's constraint, not ours, and
`make live-test` reports it separately from real failures.

**Work area.** The panel takes 40 px at the bottom. We always go through
`workspace.get_work_area_for_monitor()`, never the screen resolution, or windows
end up under the panel.

## Roadmap

| Phase | Content | Status |
|---|---|---|
| 1 | Skeleton: clean lifecycle, CSD-safe placement, shortcuts, settings UI | **done** |
| 2 | Drag-to-top snap bar + `Super+Z` picker, ghost preview | **done** |
| 3 | Split tree model, zone editor, custom layouts | **done** |
| 4 | Linked-divider resize, saved arrangements | **done** |
| 5 | `.deb` packaging + apt repository | **done** |
| 6 | Publishing: Cinnamon Spices submitted, Debian route documented | **done** |

## Internationalisation

All user-facing strings are English in the source. Cinnamon ships a translation
system for xlets (`cinnamon-xlet-makepot` + `po/` files), so French and other
locales come back as proper translations rather than hardcoded strings. Planned
alongside phase 6.

Market evidence behind this ordering: [RESEARCH.md](RESEARCH.md).

## Why the picker polls the pointer instead of using events

While the window manager holds a pointer grab - which it does for the entire
duration of a window move - our actors receive no Clutter input events at all.
The pointer position must be read with `global.get_pointer()` on a timer, and
every rectangle hit-tested by hand. That is why `layoutPicker.js` computes its
own geometry rather than delegating to a layout manager: it has to know where
everything is without asking the toolkit.

The shortcut-summoned picker reuses the same polling path, so both surfaces run
one code path rather than two.

## Why layouts are a tree

A layout could be a list of rectangles, which is what FancyZones' canvas mode
does. Then every edit has to defend against overlaps, gaps, and zones drifting
off screen, and none of those invariants can be stated in the type.

`layoutTree.js` stores a layout as nested splits instead. A zone has no
coordinates of its own; it inherits whatever share of its parent its weight
gives it. Overlaps and holes become unrepresentable, splitting is a local edit,
and dragging a border is a single weight changing. Pixel rectangles are derived
on demand and never stored, so the two cannot fall out of step.

This is the same model KWin uses, and the part of KWin's tiling that other
projects get asked to copy.

## What the tree bought us in phase 4

Resizing tiled neighbours together looks like it needs edge detection and a
neighbour index. With a tree it needs neither.

Comparing a window's rectangle before and after a manual resize says which edges
the user moved. `boundaryFor` walks up from that zone to the split that actually
owns each edge, which is not always its own parent: a zone can be the last child
of its column and still sit against a boundary owned by a grandparent. Moving
the border is then one weight changing, and the neighbours follow because the
whole group is laid out again from the same tree.

The same record answers the other half. A saved arrangement is that tree plus,
per zone, enough to recognise the window that was in it. Restoring matches those
descriptions against the windows already open rather than launching new ones,
which is the part every other implementation skips.

## Motion, and why it is not a named easing

Clutter ships the usual named easings and none of them is the curve this
interface wants. Windows 11 publishes its own: entrances use
`cubic-bezier(0, 0, 0, 1)`, which leaves immediately and spends most of its
time settling, and exits use `cubic-bezier(1, 0, 1, 1)`, which hesitates and
then goes. `EASE_OUT_QUAD` next to either reads as soft and slightly cheap.

Clutter can do exactly those curves. Set the transition mode to `CUBIC_BEZIER`
and hand each transition its control points as `Graphene.Point` pairs after
`ease()` has created them. `motion.js` is that, and nothing else. It falls back
to the named easing if any of it fails, because motion is polish and must never
be able to stop the picker from opening.

The tab grows into the bar rather than cross-fading into it. The bar starts at
the tab's exact rectangle and eases out to full size, clipped to its own
allocation so the thumbnails are revealed by the growing edge instead of hanging
outside it. Traced on the real desktop, the width goes 166px, 337, 546, 668,
700 over 385ms: front loaded, exactly the entrance curve.

## Three reasons the overlay used to drop frames

All three were found by measuring frame intervals on the running desktop, not by
reading the code. The control, the same gesture with the extension disabled, is
a mean of 8.6ms and a worst frame of 11ms.

**Animating geometry re-lays-out every child.** Easing `width` or `height` on
the bar made Clutter re-allocate it and its sixty-odd children every frame:
mean 50.5ms, worst 131ms, eight frames over 32ms. The same animation expressed
as `scale` and `translation` is a GPU transform and touches no allocation: mean
9.8ms, worst 16ms, nothing dropped. A single actor with no children is fine
either way, which is why the ghost still moves by geometry.

**Building the actors on every drag.** The picker was rebuilt each time it was
shown. It is now built once and kept, guarded by a signature over the work area,
the gaps and the layout set, so it still rebuilds when any of those change.

**Rasterising the shadow in front of the user.** `box-shadow: 0 10px 32px` over
a 700x100 surface costs about 120ms the first time St paints it, once per
session, and it landed on the exact frame the bar first appeared. Removing the
shadow made the stall vanish, which identified it; the fix is to pay it at load
instead. Clutter does not paint a fully transparent actor, so warming up at
opacity 0 warms nothing, and opacity 1 is both painted and invisible. It has to
be held long enough for a paint to happen: 120ms was not enough during
Cinnamon's startup, 400ms was.

After all three: mean 9.1ms, worst 18ms, no dropped frames, on the first gesture
of a cold session. The extension adds 0.1MB and runs no timer at all when no
window is being dragged.

## Integer geometry

A fractional actor position is resampled and comes out soft, so every
coordinate in the overlay is an integer. Zone rectangles inside a thumbnail
round their EDGES and derive their size, never the other way round: rounding a
position and a width separately lets two neighbours disagree about where their
shared boundary is, which shows as a one pixel seam. Measured on the running
desktop, 128 coordinates, none fractional, and every gap between adjacent zones
exactly 4px.
