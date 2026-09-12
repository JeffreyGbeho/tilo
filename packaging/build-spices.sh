#!/bin/sh
# Assembles the Cinnamon Spices submission tree.
#
# Spices expect UUID/files/UUID/ rather than UUID/files/, and the root level
# carries the files their website reads. Generating it keeps one copy of the
# source rather than a second one drifting out of date.
set -eu

UUID=tilo@jeffreygbeho
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

OUT="build/spices/$UUID"
rm -rf build/spices
mkdir -p "$OUT/files/$UUID"

cp -a "src/$UUID/." "$OUT/files/$UUID/"
cp packaging/assets/icon.png "$OUT/files/$UUID/icon.png"
cp LICENSE "$OUT/files/$UUID/LICENSE"

cp packaging/spices-README.md "$OUT/README.md"
cp packaging/spices-CHANGELOG.md "$OUT/CHANGELOG.md"
cp assets/snap-layouts.png "$OUT/screenshot.png"

cat > "$OUT/info.json" <<'JSON'
{
    "author": "JeffreyGbeho",
    "license": "GPL-3.0"
}
JSON

echo "build/spices/$UUID"
find "$OUT" -type f | sed "s|$OUT|  .|" | sort
