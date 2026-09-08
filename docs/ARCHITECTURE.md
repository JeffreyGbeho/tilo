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
| Relative `require()` paths resolve from the **extension root**, never from the requiring file | `fileUtils.js:213-231` — `dir` is closed over and identical for every module | Inside `lib/`, a sibling is `require('./lib/foo')`, **not** `require('./foo')`. Node resolves the other way, so a Node-based test must emulate this or it will pass on broken code |

## Guiding principle

> tilo modifies **no** configuration key belonging to anyone else without
> explicit consent, and restores everything it touched.

This is not only ethics: Debian policy forbids a package from modifying user
configuration at install time.

**Non-negotiable rules:**

1. The package **places files, full stop.** No `postinst` writes to dconf.
2. We **never** write to `org.cinnamon enabled-extensions`. Enabling is a user
   gesture, in *Settings → Extensions*.
3. All of our settings live in **our own space** (`settings-schema.json`,
   `~/.config/tilo/`). No writes to `org.cinnamon.*` or `org.cinnamon.muffin.*`
   by default.
4. Any takeover of a foreign key (e.g. `push-tile-*`, `edge-tiling`) must go
   through `ConfigGuard`: **explicit opt-in → backup of the previous value →
   apply → restore** on untick, on `disable()`, and on uninstall.
5. `disable()` must give everything back: shortcuts unregistered, actors
   destroyed, signals disconnected, timeouts cancelled. An extension that leaks
   is an extension that gives Linux tiling a bad name.

## Modules

| Module | Responsibility | Does not |
|---|---|---|
| `extension.js` | Lifecycle (`init`/`enable`/`disable`), wiring, shortcuts | No computation logic |
| `lib/geometry.js` | Work area, gap application, rectangle arithmetic | Never touches a window |
| `lib/windowMover.js` | Safe placement: CSD, unmaximize, re-assert | Does not decide *where* |
| `lib/layouts.js` | Fractional layout definitions, pixel resolution, hit testing | Draws nothing |
| `lib/configGuard.js` | Backup/restore of foreign keys, under consent | Applies nothing without opt-in |
| `lib/logger.js` | Prefixed logging, silent by default | — |
| `lib/dragWatcher.js` | `grab-op-begin`/`end`, pointer polling during the grab | Draws nothing |
| `lib/layoutPicker.js` | The picker overlay, its geometry and hit testing (St + Clutter + CSS) | Does not place windows |

Flow: `dragWatcher` detects → `layoutPicker` offers → `layouts` resolves the zone
→ `windowMover` places.
Each module is testable in isolation; only `windowMover` has a side effect on
windows.

## The two traps handled from the skeleton on

**CSD (Client-Side Decorations).** Modern GTK apps draw their own title bar and
carry an invisible shadow border. `get_buffer_rect()` includes it,
`get_frame_rect()` does not. Using the wrong one produces a 10-20 px offset and
gaps between windows — the number one reason Linux tiling looks unfinished. tilo
uses **only** `get_frame_rect()` and `move_resize_frame()`.

**Resize increments.** A window that declares resize increments makes Muffin's
constraint engine adjust the requested size — and when it adjusts, the move half
of `move_resize_frame()` is silently dropped. The window lands at the right size
and the *old* position, which reads as "the shortcut resizes but never moves".
`windowMover.js` therefore always follows the resize with a bare `move_frame()`,
which carries no size and so cannot be adjusted away. Measured on GNOME Terminal:
`move_resize_frame` alone left it at +600+400 instead of +0+0; adding
`move_frame` put it at +0+0 exactly.

Such apps still round their own size down — GNOME Terminal to whole character
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
| 3 | Design polish, custom user-drawn zones | next |
| 4 | Linked-divider resize; named savable window sets (the #1 unmet request in the ecosystem) | planned |
| 5 | `.deb` packaging + apt repository | planned |
| 6 | Publishing: Cinnamon Spices, then the Debian pipeline | planned |

## Internationalisation

All user-facing strings are English in the source. Cinnamon ships a translation
system for xlets (`cinnamon-xlet-makepot` + `po/` files), so French and other
locales come back as proper translations rather than hardcoded strings. Planned
alongside phase 6.

Market evidence behind this ordering: [RESEARCH.md](RESEARCH.md).

## Why the picker polls the pointer instead of using events

While the window manager holds a pointer grab — which it does for the entire
duration of a window move — our actors receive no Clutter input events at all.
The pointer position must be read with `global.get_pointer()` on a timer, and
every rectangle hit-tested by hand. That is why `layoutPicker.js` computes its
own geometry rather than delegating to a layout manager: it has to know where
everything is without asking the toolkit.

The shortcut-summoned picker reuses the same polling path, so both surfaces run
one code path rather than two.
