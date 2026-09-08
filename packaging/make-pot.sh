#!/bin/sh
# Builds po/tilo.pot from the JavaScript and from settings-schema.json.
#
# cinnamon-xlet-makepot does this, but needs python3-polib, which is one more
# thing to install before anyone can contribute a translation. xgettext ships
# with gettext and is already there, and the schema is plain JSON.
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

SRC="src/tilo@jeffreygbeho"
POT="$SRC/po/tilo.pot"
mkdir -p "$SRC/po"

# Strings marked with _() in the code.
xgettext --language=JavaScript --from-code=UTF-8 --keyword=_ \
         --package-name=tilo --package-version="$(dpkg-parsechangelog -S Version -l debian/changelog)" \
         --msgid-bugs-address="https://github.com/JeffreyGbeho/tilo/issues" \
         --output="$POT" \
         "$SRC/extension.js" "$SRC"/lib/*.js

# Strings the settings window shows, which live in the schema rather than in code.
python3 - "$SRC/settings-schema.json" "$POT" <<'PY'
import json, sys
schema, pot = sys.argv[1], sys.argv[2]
seen = set()
open(pot, 'a').write('\n')
with open(pot, 'a') as out:
    for key, entry in json.load(open(schema)).items():
        if not isinstance(entry, dict):
            continue
        for field in ('description', 'tooltip', 'units'):
            text = entry.get(field)
            if not text or text in seen:
                continue
            seen.add(text)
            escaped = text.replace('\\', '\\\\').replace('"', '\\"')
            out.write(f'#: settings-schema.json:{key}\nmsgid "{escaped}"\nmsgstr ""\n\n')
PY

echo "$POT ($(grep -c '^msgid "' "$POT") strings)"
