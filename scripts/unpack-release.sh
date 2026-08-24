#!/usr/bin/env bash
set -euo pipefail

EXPECTED="3e4c7b4c89101f13b1739c970ed452f836d586ab779c5f6f155e070d6d98e22d"
EXPECTED_CHARS="144024"
TMP="$(mktemp /tmp/isartech-one-rc.XXXXXX.tar.gz)"
trap 'rm -f "$TMP"' EXIT

python3 - "$TMP" "$EXPECTED" "$EXPECTED_CHARS" <<'PY'
import base64
import hashlib
import sys
from pathlib import Path

out_path = Path(sys.argv[1])
expected_sha = sys.argv[2]
expected_chars = int(sys.argv[3])

parts = [
    Path("release/part-00.b64"),
    Path("release-v2/part-01.b64"),
    Path("release/part-02.b64"),
    Path("release-v2/part-03-exact.b64"),
    Path("release/part-04.b64"),
    Path("release-v2/part-05.b64"),
    Path("release/part-06.b64"),
    Path("release-v2/part-07.b64"),
    Path("release/part-08.b64"),
    Path("release-v2/part-09.b64"),
    Path("release/part-10-correct.b64"),
    Path("release-v2/part-11-exact.b64"),
    Path("release/part-12.b64"),
]

missing = [str(path) for path in parts if not path.is_file()]
if missing:
    raise SystemExit("Missing release fragments: " + ", ".join(missing))

for path in parts:
    size = len(b"".join(path.read_bytes().split()))
    print(f"RC fragment {path}: {size} chars")

stream = b"".join(b"".join(path.read_bytes().split()) for path in parts)
print(f"RC stream characters: {len(stream)}")
if len(stream) != expected_chars:
    raise SystemExit(
        f"Invalid Base64 stream length: {len(stream)}; expected {expected_chars}"
    )

try:
    data = base64.b64decode(stream, validate=True)
except Exception as exc:
    raise SystemExit(f"Base64 decode failed: {exc}") from exc

actual = hashlib.sha256(data).hexdigest()
print(f"RC SHA-256: {actual}")
if actual != expected_sha:
    raise SystemExit(
        f"Release integrity check failed: {actual}; expected {expected_sha}"
    )

out_path.write_bytes(data)
print(f"ISARTECH ONE RC integrity verified: {actual}")
PY

tar -xzf "$TMP" -C .
