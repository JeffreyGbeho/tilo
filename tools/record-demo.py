#!/usr/bin/env python3
"""Records a demo of the snap layout gesture, for the README and for posts.

Synthetic input rather than a real hand, so the scene is controlled and nothing
personal can end up in the frame. The motion is eased rather than linear,
because a constant-speed pointer reads as a machine and the point of the clip is
to show how the interaction feels.

    python3 tools/record-demo.py out.gif
"""

import math
import subprocess
import sys
import time

from Xlib import display, X, XK
from Xlib.ext import xtest

D = display.Display()
SCREEN_W, SCREEN_H = 1920, 1040


def ev(js):
    subprocess.run(["dbus-send", "--session", "--dest=org.Cinnamon",
                    "--print-reply=literal", "/org/Cinnamon", "org.Cinnamon.Eval",
                    "string:" + js], capture_output=True, text=True)


def move(x, y):
    xtest.fake_input(D, X.MotionNotify, x=int(x), y=int(y))
    D.sync()


def glide(x1, y1, x2, y2, seconds=1.0, fps=60):
    """Ease-in-out, so the pointer accelerates and settles like a hand does."""
    steps = max(2, int(seconds * fps))
    for i in range(1, steps + 1):
        t = i / steps
        e = 0.5 - 0.5 * math.cos(math.pi * t)
        move(x1 + (x2 - x1) * e, y1 + (y2 - y1) * e)
        time.sleep(seconds / steps)


def cinnamon(js):
    """Evaluates JS in Cinnamon and returns the result as a string."""
    out = subprocess.run(["dbus-send", "--session", "--dest=org.Cinnamon",
                          "--print-reply=literal", "/org/Cinnamon",
                          "org.Cinnamon.Eval", "string:" + js],
                         capture_output=True, text=True).stdout
    return out.strip().split("\n")[-1].strip().strip('"')


# The demo windows, wherever they currently live. Searching only the active
# workspace missed any that had already been moved.
ALL = ("(function(){var wm=global.workspace_manager,o=[];"
       "for(var i=0;i<wm.get_n_workspaces();i++){"
       "wm.get_workspace_by_index(i).list_windows().forEach(function(w){o.push(w)})}"
       "return o})()")
DEMO = (ALL + ".filter(function(w){return w.get_wm_class()=='Google-chrome'&&"
        "(w.get_title()||'').indexOf('demo-')===0})")


def scene(workspace_index):
    """Puts the two demo windows alone on an empty workspace.

    Recording the workspace the developer is working on has captured a terminal
    full of private conversation more than once. An empty workspace makes that
    impossible rather than unlikely, and assert_clean below refuses to record if
    anything else is present anyway.
    """
    ev(f"var wm=global.workspace_manager, ws=wm.get_workspace_by_index({workspace_index});"
       "var t=global.get_current_time();" + DEMO +
       ".forEach(function(w){ w.change_workspace(ws); });"
       "ws.activate(t); 'moved'")
    time.sleep(2)

    ev("var M=imports.gi.Meta,b=" + DEMO + ";"
       "b[0].activate(global.get_current_time());"
       "if(b[0].get_maximized())b[0].unmaximize(M.MaximizeFlags.BOTH);"
       "b[0].move_resize_frame(true,0,0,1920,1040); b[0].move_frame(true,0,0); b[0].raise();"
       "b[1].activate(global.get_current_time());"
       "if(b[1].get_maximized())b[1].unmaximize(M.MaximizeFlags.BOTH);"
       "b[1].move_resize_frame(true,470,300,980,600); b[1].move_frame(true,470,300);"
       "b[1].raise(); 'placed'")
    time.sleep(2)


def assert_clean():
    """Refuses to record unless the two demo windows are the only ones here."""
    listing = cinnamon(
        "global.workspace_manager.get_active_workspace().list_windows()"
        ".filter(function(w){return w.get_window_type()===imports.gi.Meta.WindowType.NORMAL"
        "&&!w.is_skip_taskbar()})"
        ".map(function(w){return (w.get_title()||'?')}).join('|')")
    titles = [t for t in listing.split("|") if t]
    unexpected = [t for t in titles if not t.startswith("demo-")]
    if unexpected or len(titles) != 2:
        ev("global.workspace_manager.get_workspace_by_index(0)"
           ".activate(global.get_current_time()); 'back'")
        sys.exit(f"refusing to record, workspace is not clean: {titles}")
    print(f"workspace clean: {titles}")


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "demo.gif"
    scene(workspace_index=1)
    assert_clean()

    alt = D.keysym_to_keycode(XK.XK_Alt_L)
    move(960, 640)
    time.sleep(0.4)

    rec = subprocess.Popen(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "x11grab", "-framerate", "30",
         "-video_size", f"{SCREEN_W}x{SCREEN_H}", "-i", ":0.0+0,0", "-t", "11",
         "/tmp/demo.mp4"])
    time.sleep(1.2)

    xtest.fake_input(D, X.KeyPress, alt); D.sync(); time.sleep(0.15)
    xtest.fake_input(D, X.ButtonPress, 1); D.sync(); time.sleep(0.5)

    glide(960, 640, 780, 430, 1.0)        # the drag starts, the tab drops in
    time.sleep(0.7)                        # let it be noticed
    glide(780, 430, 960, 34, 1.1)          # up to the tab, the picker opens
    time.sleep(1.0)
    glide(960, 34, 1013, 30, 0.5)          # onto a zone, it lights up
    time.sleep(1.4)                        # hold on the highlighted zone

    xtest.fake_input(D, X.ButtonRelease, 1); D.sync()
    xtest.fake_input(D, X.KeyRelease, alt); D.sync()
    time.sleep(2.2)                        # the window lands

    rec.wait()
    ev("global.workspace_manager.get_workspace_by_index(0).activate(global.get_current_time()); 'back'")

    # Two passes: a palette from the whole clip, then the encode, otherwise the
    # blues in the picker band badly.
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", "/tmp/demo.mp4",
                    "-vf", "fps=20,scale=1000:-1:flags=lanczos,palettegen=stats_mode=diff",
                    "/tmp/pal.png"], check=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", "/tmp/demo.mp4",
                    "-i", "/tmp/pal.png", "-lavfi",
                    "fps=20,scale=1000:-1:flags=lanczos[v];[v][1:v]paletteuse=dither=bayer:bayer_scale=3",
                    out], check=True)
    print(out)


if __name__ == "__main__":
    main()
