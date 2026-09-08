#!/bin/sh
# Publishes public/ to the gh-pages branch.
#
# gh-pages carries its own history on purpose: it holds build output, and
# mixing generated files into the source branch makes both harder to read.
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

[ -d public ] || { echo "run make apt-repo first"; exit 1; }
[ -f public/dists/stable/InRelease ] || { echo "public/ is unsigned, refusing to publish"; exit 1; }

REMOTE=$(git remote get-url origin)
VERSION=$(dpkg-parsechangelog -S Version -l debian/changelog)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

cp -a public/. "$WORK/"
cd "$WORK"
git init -q -b gh-pages
git add -A
git -c user.name="$(git -C "$ROOT" config user.name)" \
    -c user.email="$(git -C "$ROOT" config user.email)" \
    commit -q -m "apt repository, tilo $VERSION"
git remote add origin "$REMOTE"
git push -q -f origin gh-pages
echo "published tilo $VERSION to gh-pages"
