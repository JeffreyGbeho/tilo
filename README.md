# tilo

Modern window tiling for Cinnamon. As direct as Windows 11 Snap Layouts, with
nothing else to install.

```
sudo apt install tilo
```

## Why

Existing tiling solutions on Linux either pull in a pile of dependencies or push
you to the command line to configure them. tilo is a native Cinnamon extension:
one folder of JavaScript, **zero dependencies**, **zero extra processes**, and
all configuration in the standard Cinnamon interface.

Cinnamon's JavaScript engine is already resident in the desktop process at all
times. tilo hooks into it: it adds no runtime, no daemon, no service.

## Install

**From the repositories** *(coming)*

```
sudo apt install tilo
```

**From source**

```
git clone https://github.com/JeffreyGbeho/tilo
cd tilo
make install-user
```

Then **Settings → Extensions → Tilo** to enable it.

> tilo never enables itself and never changes any of your settings without your
> explicit consent. See [the consent contract](docs/ARCHITECTURE.md).

## Snap layouts

Drag a window toward the **middle of the top edge**. A hint drops from the top,
expands into the layout bar as you keep going, and highlights the zone under the
pointer — both on the thumbnail and full-size on the screen itself. Drop to
place.

Press **`Super+Z`** for the same picker without dragging.

Both are configurable in *Settings → Extensions → Tilo → Configure*, including
the distance from the top edge that reveals the bar, and an off switch for the
drag trigger.

## Default shortcuts

| Shortcut | Action |
|---|---|
| `Super+Ctrl+←` | Left half |
| `Super+Ctrl+→` | Right half |
| `Super+Ctrl+↑` | Top half |
| `Super+Ctrl+↓` | Bottom half |
| `Super+Ctrl+Enter` | Fill the work area |
| `Super+Ctrl+C` | Center |
| `Super+Z` | Open the layout picker |

All rebindable in *Settings → Extensions → Tilo → Configure*.

The defaults only use free combinations: `Super+arrows` belongs to Cinnamon's
native snap and tilo leaves it alone.

## What tilo does not do

- It never writes to `org.cinnamon.*` without explicit consent.
- It does not add itself to your enabled extensions.
- It leaves nothing behind: `disable()` restores the original state.

## Development

```
make dev-link     # symlink into the extension directory
make check        # JS + JSON syntax validation
make test         # test harness using Cinnamon's module resolution
make restart      # restart Cinnamon (Ctrl+Alt+Escape does the same)
```

Log: *Settings → Extensions → ⚠ tab*, or `~/.xsession-errors`.
Built-in debugger: `cinnamon-looking-glass`.

Architecture and technical constraints: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License

GPL-3.0
