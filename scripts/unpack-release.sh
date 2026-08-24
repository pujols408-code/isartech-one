#!/usr/bin/env bash
set -euo pipefail

EXPECTED="3e4c7b4c89101f13b1739c970ed452f836d586ab779c5f6f155e070d6d98e22d"
TMP="$(mktemp /tmp/isartech-one-rc.XXXXXX.tar.gz)"
trap 'rm -f "$TMP"' EXIT

python3 - "$TMP" "$EXPECTED" <<'PY'
import base64
import glob
import hashlib
import re
import sys
from pathlib import Path

out_path = Path(sys.argv[1])
expected = sys.argv[2]
parts = sorted(glob.glob("release/part-*.b64"))
if not parts:
    raise SystemExit("No release fragments found")

allowed = re.compile(rb"[^A-Za-z0-9+/=]")

def clean(path: str) -> bytes:
    return allowed.sub(b"", Path(path).read_bytes())

def normalize(data: bytes) -> bytes:
    data = data.replace(b"=", b"")
    return data + (b"=" * ((-len(data)) % 4))

def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

candidates = []

# Strategy 1: each fragment was Base64-encoded independently.
try:
    decoded = b"".join(
        base64.b64decode(normalize(clean(path)), validate=False)
        for path in parts
    )
    candidates.append(("independent", decoded))
except Exception as exc:
    print(f"Independent fragment decoding failed: {exc}", file=sys.stderr)

# Strategy 2: fragments are pieces of one continuous Base64 stream.
try:
    stream = b"".join(clean(path) for path in parts)
    decoded = base64.b64decode(normalize(stream), validate=False)
    candidates.append(("continuous", decoded))
except Exception as exc:
    print(f"Continuous stream decoding failed: {exc}", file=sys.stderr)

for strategy, data in candidates:
    actual = digest(data)
    print(f"RC decode strategy {strategy}: {actual}")
    if actual == expected:
        out_path.write_bytes(data)
        print(f"ISARTECH ONE RC integrity verified: {actual}")
        break
else:
    raise SystemExit("Release integrity check failed for all decoding strategies")
PY

tar -xzf "$TMP" -C .
