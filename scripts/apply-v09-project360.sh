#!/usr/bin/env bash
set -euo pipefail

EXPECTED_B64_CHARS="12624"
EXPECTED_SHA="668e5e2abea911c3ff1dbc833b3ea5836088a642eabb9549f69ed8874885acd8"
TMP_B64="$(mktemp /tmp/isartech-v09-project360.XXXXXX.b64)"
TMP_TAR="$(mktemp /tmp/isartech-v09-project360.XXXXXX.tar.gz)"
trap 'rm -f "$TMP_B64" "$TMP_TAR"' EXIT

cat patch-v09-project360/part-*.b64 > "$TMP_B64"
ACTUAL_CHARS="$(wc -c < "$TMP_B64" | tr -d ' ')"
if [ "$ACTUAL_CHARS" != "$EXPECTED_B64_CHARS" ]; then
  echo "Invalid v0.9 Project 360 Base64 length: $ACTUAL_CHARS; expected $EXPECTED_B64_CHARS"
  exit 1
fi

python3 - "$TMP_B64" "$TMP_TAR" <<'PY'
import base64
import sys
from pathlib import Path
src = Path(sys.argv[1]).read_bytes()
try:
    data = base64.b64decode(src, validate=True)
except Exception as exc:
    raise SystemExit(f"v0.9 Project 360 Base64 decode failed: {exc}") from exc
Path(sys.argv[2]).write_bytes(data)
PY

ACTUAL_SHA="$(sha256sum "$TMP_TAR" | awk '{print $1}')"
if [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then
  echo "v0.9 Project 360 checksum mismatch: $ACTUAL_SHA; expected $EXPECTED_SHA"
  exit 1
fi

tar -xzf "$TMP_TAR" -C .

# Add Projects to the existing app navigation without coupling this patch to
# the internal navigation-array implementation of the packed base release.
python3 <<'PY'
from pathlib import Path
p = Path("src/components/layout/app-shell.tsx")
if p.exists():
    text = p.read_text()
    if 'href="/proyectos"' not in text and "href='/proyectos'" not in text and '</nav>' in text:
        link = '''<a href="/proyectos" style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderRadius:10,color:"#dce8f6",textDecoration:"none",fontWeight:650}}><span aria-hidden="true">▦</span><span>Proyectos</span></a>'''
        text = text.replace('</nav>', link + '</nav>', 1)
        p.write_text(text)
        print("Project navigation entry injected")
    else:
        print("Project navigation entry already present or nav marker unavailable")
else:
    print("App shell not found; Project 360 routes remain available directly")

pkg = Path("package.json")
if pkg.exists():
    import json
    data = json.loads(pkg.read_text())
    data["version"] = "0.9.0-rc.1"
    pkg.write_text(json.dumps(data, indent=2) + "\n")
PY

echo "ISARTECH ONE v0.9 Project 360 patch verified: $ACTUAL_SHA"
