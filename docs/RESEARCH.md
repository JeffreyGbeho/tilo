# Market research - what people actually want

Three research streams: Windows 11 interaction mechanics, a competitive matrix
of ~40 tools, and a corpus of user complaints (546 complaint lines mined from
the GNOME extension review API across 17 tiling extensions, plus KDE Bugzilla,
GitHub reaction counts and the Linux Mint forums).

## The opportunity is unusually clean

The entire `cinnamon-spices-extensions` repository contains **one** tiling
extension: `gTile@shuairan`, whose own store comments call it *"currently
unsupported"*. `cinTile` was archived in June 2025. There is an open Cinnamon
issue - **#13853, "Add Snap Layouts similar to Windows 11 and KDE Plasma"** -
with no assignee.

Mint's maintainers have stated they will not build this: *"Muffin is not a
tiling window manager and they are not planning to support that."* An earlier
request (#10229) was auto-closed as stale after two years, the stated objection
being CSD fragmentation - the exact problem `windowMover.js` already solves.

## Ranked by evidence weight

Counts are complaint-line frequency (n=546) or GitHub reaction counts.

| # | What to build | Evidence |
|---|---|---|
| 1 | **Never damage the user's config** | The angriest reviews in the corpus. *"Pop Shell overwrites a bunch of hidden, internal GNOME shortcuts permanently... it can't be cleanly un-installed."* Fixing this is engineering discipline, not a feature - and nobody offers it |
| 2 | **Keybinding hygiene** | **116/546** - the single largest complaint bucket, ~40% larger than version breakage. Bind only free keys, detect conflicts, never silently overwrite |
| 3 | **Stable monitor identity** (EDID/serial, never index) | 40/546 multi-monitor + a bug class unsolved on *every* platform. KDE #473680 still reported 3 years after being marked fixed |
| 4 | **Linked-divider resize** - drag the gap, both windows resize | Attested from three directions as *the* reason people stay on native snap. **Cinnamon deliberately removed it** in the Mutter rebase, undocumented: *"This facility, which is a killer facility, has disappeared"* |
| 5 | **Custom zones: thirds, asymmetric splits, ultrawide** | 30/546 cite ultrawide/4K as the *reason they installed anything*. A graphical zone editor is what made Tiling Shell (853k) overtake Canonical-backed Tiling Assistant (669k) |
| 6 | **Named, savable, restorable window sets** | **The #1 unmet request in the whole ecosystem.** pop-os/shell #735 = **109 reactions**, the highest found. KDE #466019 = 31 CC'd, open since 2023. Windows 11 Snap Groups die on close and on reboot. *Nothing* on GNOME, KDE, Cinnamon, Windows or macOS does this |
| 7 | **Hotkey-invoked visual zone picker** (`Super+Z`) | The one design that satisfies both user camps at once |
| 8 | **Pre-populated exclusion list** | 33/546 name apps that won't tile. Ship day-one exclusions: Steam, Discord, GNOME Terminal, Zoom, VS Code fullscreen, Chrome/Electron popups |
| 9 | **Square corners on tiled windows** | A functional state indicator, not decoration. Windows 11 does it |
| 10 | **Touch and stylus** | 12/546, an entirely unserved input mode - and Mint ships on convertibles |

## Decisions this forces

**Gaps default to 0 / 0.** Users are explicit: *"change the default gaps to zero...
that's also the default on Windows, Mac and even Android, so it's gonna look more
familiar."* Gaps stay opt-in - and **0 must actually work**, since it currently
breaks keybindings in Tiling Shell and is unreachable in FancyZones and KDE.

**The drag modifier is `Ctrl`, never `Shift`.** In Muffin, Shift during a drag
*disables* tiling (`window.c`: `if (snap) { preview_tile_mode = META_TILE_NONE }`)
- the opposite of KWin, and hardcoded. FancyTiles chose Ctrl for this exact
reason.

**We own our window state.** `meta_window_tile()` is **not introspected**; the
only JS entry point is `push_tile()`, the same state machine as `Super+arrow`.
There is no API to define a zone or set a tile fraction. Every custom-zone tiler
on Cinnamon must use `move_resize_frame()` and track its own state - which is
what `windowMover.js` already does. Consequence to design around: our windows are
*positioned*, not *tiled*, so Muffin's own edge-tiling will fight them unless the
user opts into disabling it via `ConfigGuard`.

**Widen the drag hot zone.** Muffin's `get_tile_zone_at_pointer()` uses a 1-6
pixel band, so corners require slamming the cursor into the literal corner. A
wider, configurable threshold is a cheap, real papercut fix.

## The two camps, and the resolution

> *"There are clearly two types of users: 1. Users that need a Tiling System that
> integrates with their Drag and Drop workflow... 2. Users that predominantly use
> the keyboard, usually coming from Sway/i3/Hyprland."*

tilo serves camp 1 first - that is Mint's audience, and that is what the market
lacks. The keyboard picker (`Super+Z`) covers camp 2 without a second UI.

The mainstream position is emphatic and worth honouring: *"It's not over
complicated as it doesn't aim to replace a fully featured tiling window manager.
But that's exactly what most users need."*

## Discoverability is the unserved gap in the whole category

No zone-based tool has a discovery surface. FancyZones needs Shift-drag with no
hint. KWin needs Shift-drag and its own maintainer calls it unintuitive. Only
Windows 11 puts the picker where a user finds it by accident - and in 24H2
Microsoft shipped inline coaching messages because telemetry showed people still
didn't understand it.

The strongest onboarding datum found: a user who had repeatedly bounced off i3
adopted it immediately once Regolith shipped a **one-key keybinding cheat-sheet**
- *"I was very surprised by how quickly I adapted once the barrier of entry was
removed."* Nobody in this category ships that.

## Windows 11 mechanics worth copying exactly

- **Two-stage disclosure**: the bar appears as a compact hint, then *expands* as
  the drag continues toward it. This is what makes it read as a drop target
  rather than a menu.
- **Two nested thresholds**: an outer reveal band, then the absolute edge which
  maximizes instead.
- **Zone chosen by hovering a sub-region of a thumbnail**, with dual feedback -
  the mini-zone highlights *and* a full-size translucent ghost is drawn on the
  real target area.
- **Fluent tokens** (published, verifiable): 8px radius on the panel, 4px inside,
  durations 83 / 167 / 250ms, entrance `cubic-bezier(0,0,0,1)`, exit
  `cubic-bezier(1,0,1,1)`.

Panel dimensions and the hover delay were never published by Microsoft; those get
calibrated by eye rather than guessed.

## What Windows 11 gets wrong - our headline features

1. **Zero layout customization.** FancyZones, DisplayFusion and AquaSnap exist
   solely because of this.
2. **The Snap bar is intrusive** - it fires during ordinary window moves.
   Tutorials exist purely to disable it. Ours must be intent-gated and opt-out.
3. **Snap groups are volatile** - no naming, no persistence, dead after reboot.
4. **Ultrawide capped at three columns.**
5. **No gaps at all.**
6. **Layout set limited by screen size** - under 24 inches Windows refuses to
   offer three-column layouts. An arbitrary rule we have no reason to copy.
