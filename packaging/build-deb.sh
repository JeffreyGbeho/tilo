#!/bin/sh
# Builds the binary package with dpkg-deb alone.
#
# The debian/ directory is the real source packaging, and is what a sponsor or a
# PPA builds from. It needs debhelper, which is not installed everywhere. This
# script produces the same binary package using only dpkg, so anyone who cloned
# the repository can build and install it without pulling in a toolchain first.
set -eu

UUID=tilo@jeffreygbeho
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

VERSION=$(dpkg-parsechangelog -S Version -l debian/changelog)
STAGE="dist/tilo_${VERSION}_all"
DEB="dist/tilo_${VERSION}_all.deb"

rm -rf "$STAGE" "$DEB"
mkdir -p "$STAGE/DEBIAN" \
         "$STAGE/usr/share/cinnamon/extensions/$UUID" \
         "$STAGE/usr/share/doc/tilo"

# The extension itself.
make install DESTDIR="$STAGE" >/dev/null

# Documentation Debian expects in every package.
cp debian/copyright "$STAGE/usr/share/doc/tilo/copyright"
cp debian/README.Debian "$STAGE/usr/share/doc/tilo/README.Debian"
gzip -9n -c debian/changelog > "$STAGE/usr/share/doc/tilo/changelog.Debian.gz"

# The binary control file, derived from debian/control so the two cannot drift.
python3 - "$STAGE" "$VERSION" <<'PY'
import sys, os, subprocess
stage, version = sys.argv[1], sys.argv[2]
stanzas = open('debian/control').read().split('\n\n')
source = dict(l.split(': ', 1) for l in stanzas[0].strip().split('\n') if ': ' in l)
binary = stanzas[1].rstrip('\n')

lines = []
for line in binary.split('\n'):
    if line.startswith('Depends:'):
        line = line.replace('${misc:Depends}, ', '')
    lines.append(line)

size = subprocess.run(['du', '-sk', '--exclude=DEBIAN', stage],
                      capture_output=True, text=True).stdout.split()[0]

head = lines[0]                       # Package: tilo
rest = '\n'.join(lines[1:])
control = (f"{head}\n"
           f"Version: {version}\n"
           f"Section: {source['Section']}\n"
           f"Priority: {source['Priority']}\n"
           f"Maintainer: {source['Maintainer']}\n"
           f"Homepage: {source['Homepage']}\n"
           f"Installed-Size: {size}\n"
           f"{rest}\n")
open(os.path.join(stage, 'DEBIAN', 'control'), 'w').write(control)
PY

# md5sums, which apt uses to detect locally modified files.
( cd "$STAGE" && find usr -type f -exec md5sum {} + | sed 's| usr/| usr/|' > DEBIAN/md5sums )

find "$STAGE" -type d -exec chmod 755 {} +
find "$STAGE" -type f -exec chmod 644 {} +
chmod 644 "$STAGE/DEBIAN/control" "$STAGE/DEBIAN/md5sums"

dpkg-deb --root-owner-group --build "$STAGE" "$DEB" >/dev/null
echo "$DEB"
