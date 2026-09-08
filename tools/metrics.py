#!/usr/bin/env python3
"""Records what can be measured about tilo's reach, once a day.

Nothing here touches a user's machine. Every number comes from a server that
already has it: GitHub's own counters and the public Cinnamon Spices catalogue.
The extension itself makes no network calls and never will.

The urgency is GitHub's: traffic views, clones and referrers are kept for
fourteen days and then destroyed. A number nobody wrote down is gone.

    python3 tools/metrics.py >> docs/metrics.csv
"""

import json
import os
import sys
import urllib.request
from datetime import date

REPO = "JeffreyGbeho/tilo"
UUID = "tilo@jeffreygbeho"
SPICES = "https://cinnamon-spices.linuxmint.com/json/extensions.json"


def fetch(url, token=None):
    request = urllib.request.Request(url, headers={"User-Agent": "tilo-metrics"})
    if token:
        request.add_header("Authorization", f"Bearer {token}")
        request.add_header("Accept", "application/vnd.github+json")
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def github(path, token):
    url = f"https://api.github.com/repos/{REPO}"
    if path:
        url += f"/{path}"
    try:
        return fetch(url, token)
    except Exception as error:
        print(f"warning: {path}: {error}", file=sys.stderr)
        return None


def main():
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    row = {"date": date.today().isoformat()}

    repo = github("", token) or {}
    row["stars"] = repo.get("stargazers_count", "")
    row["forks"] = repo.get("forks_count", "")
    row["watchers"] = repo.get("subscribers_count", "")
    row["open_issues"] = repo.get("open_issues_count", "")

    # Traffic needs push access, and is the half that expires.
    views = github("traffic/views", token) or {}
    row["views_14d"] = views.get("count", "")
    row["visitors_14d"] = views.get("uniques", "")
    clones = github("traffic/clones", token) or {}
    row["clones_14d"] = clones.get("count", "")

    # Release assets are the only public download counter we own.
    downloads = 0
    for release in github("releases", token) or []:
        for asset in release.get("assets", []):
            downloads += asset.get("download_count", 0)
    row["deb_downloads"] = downloads

    # The Spices catalogue is public and unauthenticated. Score is a like from a
    # logged-in visitor, not an install: the store publishes no download counts
    # at all. It is still the yardstick every other extension is ranked by.
    try:
        catalogue = fetch(SPICES)
        entry = catalogue.get(UUID) or next(
            (v for v in catalogue.values() if v.get("uuid") == UUID), None)
        scores = sorted((v.get("score", 0) for v in catalogue.values()), reverse=True)
        row["spices_score"] = entry.get("score", "") if entry else ""
        row["spices_rank"] = (scores.index(entry["score"]) + 1) if entry else ""
        row["spices_total"] = len(catalogue)
    except Exception as error:
        print(f"warning: spices: {error}", file=sys.stderr)
        row["spices_score"] = row["spices_rank"] = row["spices_total"] = ""

    fields = ["date", "stars", "forks", "watchers", "open_issues",
              "views_14d", "visitors_14d", "clones_14d", "deb_downloads",
              "spices_score", "spices_rank", "spices_total"]
    if os.environ.get("HEADER"):
        print(",".join(fields))
    print(",".join(str(row.get(f, "")) for f in fields))


if __name__ == "__main__":
    main()
