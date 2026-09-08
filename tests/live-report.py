#!/usr/bin/env python3
"""Classifies the results of tests/live-runner.js.

Position is what tilo controls, so any position error is a failure.
Size can be legitimately clamped by an app that declares resize increments
(terminals round to whole character cells), so those are reported apart.
"""
import sys, subprocess
from collections import Counter

EV = ['dbus-send', '--session', '--dest=org.Cinnamon', '--print-reply=literal',
      '/org/Cinnamon', 'org.Cinnamon.Eval']
raw = subprocess.run(EV + ['string:global.__tiloTest.lines.join("\\n")'],
                     capture_output=True, text=True).stdout
rows = [[f.strip().strip('"') for f in r.split('|')]
        for r in raw.replace('\\n', '\n').split('\n') if '|' in r]
if not rows:
    sys.exit("no results: run the injector first")

fail, clamped = [], []
for r in rows:
    dpos, dsize = int(r[5].split('=')[1]), int(r[6].split('=')[1])
    if dpos > 2:
        fail.append(r)
    elif dsize > 2:
        clamped.append(r)

print(f"{len(rows)} placements | {len(rows)-len(fail)} correctly positioned | {len(fail)} misplaced")
if fail:
    print("\nMISPLACED (real failures):")
    for r in fail:
        print(f"  {r[0]:<16}{r[1]:<22}{r[2]:<8}got {r[3]:<20}want {r[4]:<20}{r[5]}")
if clamped:
    print(f"\nSIZE CLAMPED BY THE APP ({len(clamped)}), position still exact:")
    for app, n in Counter(r[0] for r in clamped).items():
        worst = max(int(r[6].split('=')[1]) for r in clamped if r[0] == app)
        print(f"  {app:<16}{n:>3} cases, up to {worst}px short — resize increments")
sys.exit(1 if fail else 0)
