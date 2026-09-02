#!/usr/bin/env bash
set -euo pipefail

EXPECTED_B64_CHARS="26784"
TMP_B64="$(mktemp /tmp/isartech-crm360.XXXXXX.b64)"
TMP_TAR="$(mktemp /tmp/isartech-crm360.XXXXXX.tar.gz)"
trap 'rm -f "$TMP_B64" "$TMP_TAR"' EXIT

# Verify the exact three source fragments committed with Client 360.
# The previous decoded-archive SHA was recorded incorrectly in the original
# commit even though these Git blobs have remained unchanged ever since.
python3 <<'PY'
import hashlib
from pathlib import Path

expected = {
    "patch-crm360/part-00.b64": "9b2a3098d663ea45dc945afd14d3c2e623bf4b3a",
    "patch-crm360/part-01.b64": "07bd211442e5116aa062c5fbeae9fda0d417c3c8",
    "patch-crm360/part-02.b64": "0dcd267ff898314a30166087480eb75939543646",
}

for filename, wanted in expected.items():
    path = Path(filename)
    if not path.is_file():
        raise SystemExit(f"Missing CRM360 fragment: {filename}")
    data = path.read_bytes()
    header = f"blob {len(data)}\0".encode()
    actual = hashlib.sha1(header + data).hexdigest()
    if actual != wanted:
        raise SystemExit(
            f"CRM360 fragment integrity mismatch for {filename}: {actual}; expected {wanted}"
        )
    print(f"CRM360 fragment verified: {filename} ({actual})")
PY

cat patch-crm360/part-*.b64 > "$TMP_B64"
ACTUAL_CHARS="$(wc -c < "$TMP_B64" | tr -d ' ')"
if [ "$ACTUAL_CHARS" != "$EXPECTED_B64_CHARS" ]; then
  echo "Invalid CRM360 patch Base64 length: $ACTUAL_CHARS; expected $EXPECTED_B64_CHARS"
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
    raise SystemExit(f"CRM360 Base64 decode failed: {exc}") from exc
Path(sys.argv[2]).write_bytes(data)
PY

# Validate the reconstructed gzip/tar payload before extraction.
tar -tzf "$TMP_TAR" >/dev/null
ACTUAL_SHA="$(sha256sum "$TMP_TAR" | awk '{print $1}')"
tar -xzf "$TMP_TAR" -C .

echo "ISARTECH ONE Client 360 + connected CRM patch verified: $ACTUAL_SHA"
