#!/bin/sh
# Generates a signed apt repository under public/, ready to publish on GitHub
# Pages.
#
# Everything here is plain apt-ftparchive and gpg. There is no reprepro or aptly
# to install, and the output is static files, which is all an apt client needs.
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

ORIGIN="tilo"
SUITE="stable"
KEYRING="tilo-archive-keyring.gpg"

DEB=$(sh packaging/build-deb.sh)
VERSION=$(dpkg-parsechangelog -S Version -l debian/changelog)

rm -rf public
mkdir -p public/pool/main/t/tilo public/dists/$SUITE/main/binary-all
cp "$DEB" public/pool/main/t/tilo/

apt-ftparchive -c packaging/apt-ftparchive.conf generate packaging/apt-ftparchive.conf
apt-ftparchive -c packaging/apt-ftparchive.conf \
    -o "APT::FTPArchive::Release::Origin=$ORIGIN" \
    -o "APT::FTPArchive::Release::Label=$ORIGIN" \
    -o "APT::FTPArchive::Release::Suite=$SUITE" \
    -o "APT::FTPArchive::Release::Codename=$SUITE" \
    -o "APT::FTPArchive::Release::Architectures=all" \
    -o "APT::FTPArchive::Release::Components=main" \
    release "public/dists/$SUITE" > "public/dists/$SUITE/Release"

# Signing. An unsigned repository makes every apt run warn, and recent apt
# refuses it outright, so this is not optional in practice.
KEY=${TILO_GPG_KEY:-}
if [ -z "$KEY" ]; then
    KEY=$(gpg --list-secret-keys --with-colons 2>/dev/null \
          | awk -F: '/^sec:/ {print $5; exit}')
fi

if [ -n "$KEY" ]; then
    rm -f "public/dists/$SUITE/InRelease" "public/dists/$SUITE/Release.gpg"
    gpg --default-key "$KEY" --batch --yes --clearsign \
        -o "public/dists/$SUITE/InRelease" "public/dists/$SUITE/Release"
    gpg --default-key "$KEY" --batch --yes -abs \
        -o "public/dists/$SUITE/Release.gpg" "public/dists/$SUITE/Release"
    gpg --export "$KEY" > "public/$KEYRING"
    echo "signed with $KEY"
else
    echo "WARNING: no GPG key, the repository is unsigned and apt will reject it"
    echo "         set TILO_GPG_KEY or create a key, then run this again"
fi

# GitHub Pages runs Jekyll by default, which would skip files starting with an
# underscore and rewrite others. This turns it off.
touch public/.nojekyll

cat > public/index.html <<HTML
<!doctype html>
<meta charset="utf-8">
<title>tilo apt repository</title>
<style>
body{font:15px/1.6 system-ui,sans-serif;max-width:44rem;margin:4rem auto;padding:0 1.5rem}
pre{background:#f4f4f5;padding:1rem;border-radius:6px;overflow-x:auto}
</style>
<h1>tilo</h1>
<p>Windows 11 style snap layouts for the Cinnamon desktop.
<a href="https://github.com/JeffreyGbeho/tilo">Source and documentation</a>.</p>
<h2>Install</h2>
<pre>curl -fsSL https://jeffreygbeho.github.io/tilo/$KEYRING \\
  | sudo tee /usr/share/keyrings/$KEYRING > /dev/null

echo "deb [signed-by=/usr/share/keyrings/$KEYRING] \\
  https://jeffreygbeho.github.io/tilo $SUITE main" \\
  | sudo tee /etc/apt/sources.list.d/tilo.list

sudo apt update
sudo apt install tilo</pre>
<p>Then enable it from Settings, Extensions. Current version: $VERSION.</p>
HTML

echo "public/ ready ($VERSION)"
