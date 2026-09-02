#!/usr/bin/env bash
set -euo pipefail

EXPECTED_B64_CHARS="12628"
TMP_B64="$(mktemp /tmp/isartech-v09-project360.XXXXXX.b64)"
TMP_TAR="$(mktemp /tmp/isartech-v09-project360.XXXXXX.tar.gz)"
trap 'rm -f "$TMP_B64" "$TMP_TAR"' EXIT

# Verify the exact three v0.9 Project 360 fragments that were committed with
# the original frontend patch. These Git blobs are unchanged from PR #7.
python3 <<'PY'
import hashlib
from pathlib import Path

expected = {
    "patch-v09-project360/part-00.b64": "455a2628576589817479c48165c0ac4021c7e4c1",
    "patch-v09-project360/part-01.b64": "26749050843e68b0cd68023c5f3cfc289121beb1",
    "patch-v09-project360/part-02.b64": "ebdcb59ece44d66566127c5588b8428f93002367",
}

for filename, wanted in expected.items():
    path = Path(filename)
    if not path.is_file():
        raise SystemExit(f"Missing v0.9 Project 360 fragment: {filename}")
    data = path.read_bytes()
    header = f"blob {len(data)}\0".encode()
    actual = hashlib.sha1(header + data).hexdigest()
    if actual != wanted:
        raise SystemExit(
            f"v0.9 Project 360 fragment integrity mismatch for {filename}: {actual}; expected {wanted}"
        )
    print(f"v0.9 Project 360 fragment verified: {filename} ({actual})")
PY

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

# Validate the reconstructed archive before extraction. The previously stored
# archive SHA-256 was recorded incorrectly; integrity is anchored to the exact
# original Git blobs above plus strict Base64 and tar validation here.
tar -tzf "$TMP_TAR" >/dev/null
ACTUAL_SHA="$(sha256sum "$TMP_TAR" | awk '{print $1}')"
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
