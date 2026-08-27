#!/usr/bin/env bash
set -euo pipefail

EXPECTED_B64_CHARS="26784"
EXPECTED_SHA="bf5a6d4e170db93f1486682a692f893c6cd89e3cb18ed8aca36dbb1e7a3cc2a9"
TMP_B64="$(mktemp /tmp/isartech-crm360.XXXXXX.b64)"
TMP_TAR="$(mktemp /tmp/isartech-crm360.XXXXXX.tar.gz)"
trap 'rm -f "$TMP_B64" "$TMP_TAR"' EXIT

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

ACTUAL_SHA="$(sha256sum "$TMP_TAR" | awk '{print $1}')"
if [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then
  echo "CRM360 patch checksum mismatch: $ACTUAL_SHA; expected $EXPECTED_SHA"
  exit 1
fi

tar -xzf "$TMP_TAR" -C .
echo "ISARTECH ONE Client 360 + connected CRM patch verified: $ACTUAL_SHA"
