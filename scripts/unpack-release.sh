#!/usr/bin/env bash
set -euo pipefail

EXPECTED="3e4c7b4c89101f13b1739c970ed452f836d586ab779c5f6f155e070d6d98e22d"
TMP="$(mktemp /tmp/isartech-one-rc.XXXXXX.tar.gz)"
trap 'rm -f "$TMP"' EXIT

python3 - "$TMP" "$EXPECTED" <<'PY'
import base64
import hashlib
import sys
from pathlib import Path

out_path = Path(sys.argv[1])
expected = sys.argv[2]

parts = [
    Path("release/part-00.b64"),
    Path("release/part-01.b64"),
    Path("release/part-02.b64"),
    Path("release/part-03.b64"),
    Path("release/part-04.b64"),
    Path("release/part-05.b64"),
    Path("release/part-06.b64"),
    Path("release/part-07.b64"),
    Path("release/part-08.b64"),
    Path("release/part-09.b64"),
    Path("release/part-10-correct.b64"),
    Path("release/part-11.b64"),
    Path("release/part-12.b64"),
]

missing = [str(path) for path in parts if not path.is_file()]
if missing:
    raise SystemExit("Missing release fragments: " + ", ".join(missing))

stream = b"".join(b"".join(path.read_bytes().split()) for path in parts)
print(f"RC stream characters: {len(stream)}")
if len(stream) % 4 != 0:
    raise SystemExit(f"Invalid Base64 stream length: {len(stream)}")

try:
    data = base64.b64decode(stream, validate=True)
except Exception as exc:
    raise SystemExit(f"Base64 decode failed: {exc}") from exc

actual = hashlib.sha256(data).hexdigest()
print(f"RC SHA-256: {actual}")
if actual != expected:
    raise SystemExit(f"Release integrity check failed: {actual}")

out_path.write_bytes(data)
print(f"ISARTECH ONE RC integrity verified: {actual}")
PY

tar -xzf "$TMP" -C .
