# Publishing

Three channels, with very different reach and very different lead times.

| Channel | What the user types | Lead time | Status |
|---|---|---|---|
| Cinnamon Spices | one click in Settings, Extensions | days | PR open |
| Own apt repository | add the repo once, then `apt install tilo` | immediate | live |
| Debian archive | `sudo apt install tilo`, nothing to add | 6 to 24 months | not started |

## Cutting a release

```sh
# 1. bump both versions, they must match
$EDITOR src/tilo@jeffreygbeho/metadata.json      # "version"
dch -v X.Y.Z-1                                   # or edit debian/changelog

# 2. everything must be green before anything is published
make test
make live-test

# 3. publish
make publish            # builds, signs and pushes the apt repository
make spices             # builds the Spices tree for a PR

git tag -a vX.Y.Z -m "tilo X.Y.Z" && git push --tags
```

`make publish` refuses an unsigned repository rather than putting up something
apt will reject.

## Cinnamon Spices

The extension lives at `linuxmint/cinnamon-spices-extensions`, one directory per
extension, laid out as `UUID/files/UUID/` rather than `UUID/files/`. `make
spices` builds that tree from the source so there is never a second copy to keep
in step.

Their review checks two things: that the change touches only your own
directories, and that the code is not hostile. Updates from the author are
merged on that basis; changes from anyone else wait for the author.

This is the channel that reaches the most people. It is built into the
Extensions panel, it installs in one click, and it updates itself.

## The apt repository

`make publish` regenerates and signs `public/` and pushes it to the `gh-pages`
branch, served at https://jeffreygbeho.github.io/tilo/.

Signing uses the key whose id is in `TILO_GPG_KEY`, or the first secret key
otherwise. The key is dedicated to signing this archive and has nothing to do
with signing commits. Its revocation certificate is under
`~/.gnupg/openpgp-revocs.d/`.

## Debian, and through it Ubuntu and Mint

This is the only route where `sudo apt install tilo` works with nothing added
first, because Mint imports from Ubuntu and Ubuntu syncs from Debian. It is slow
and it needs a person, not a script.

The package is an easy case: `Architecture: all`, no compilation, one dependency.
`debian/` is already written and `dpkg-source -b` produces a valid `3.0 (quilt)`
source package.

1. **File an ITP.** A wnpp bug saying you intend to package it.
   `reportbug wnpp`, or email `submit@bugs.debian.org` with a
   `Package: wnpp` / `Severity: wishlist` pseudo-header and a subject of
   `ITP: tilo -- Windows 11 style snap layouts for the Cinnamon desktop`.
   Put the bug number in `debian/changelog` as `Closes: #NNNNNN`.

2. **Build the source package and check it.**
   ```sh
   sudo apt install debhelper devscripts lintian
   dpkg-buildpackage -S -sa
   lintian --pedantic ../tilo_*.dsc
   ```
   Lintian findings are what a sponsor looks at first, so leave none.

3. **Upload to mentors.debian.net.** Needs an account and a GPG key to sign the
   `.changes`. Use a key carrying your own name, not the archive signing key.

4. **File an RFS.** Another wnpp bug, `RFS: tilo/X.Y.Z-1`, pointing at the
   mentors page. Then wait for a Debian Developer to pick it up. This is the
   step with no deadline; a package nobody sponsors sits indefinitely.

5. **NEW queue.** Once sponsored, ftp-master reviews every new source package by
   hand, mostly for licensing. Weeks to months.

6. **It flows downstream on its own.** Unstable to testing after the usual
   delay, Ubuntu picks new Debian packages up during its merge window, and Mint
   imports from Ubuntu at the start of its cycle.

Realistically a package accepted today reaches a Mint release a year or more
later, and only for new installs. That is why the Spices channel matters more in
practice, and why the apt repository exists in the meantime.

**Naming.** Debian conventionally prefixes desktop extensions, as in
`gnome-shell-extension-*`. A sponsor may ask for `cinnamon-tilo`. The binary
package already declares `Provides: cinnamon-tilo`, so both names resolve either
way and the decision costs nothing.
