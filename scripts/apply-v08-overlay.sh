#!/usr/bin/env bash
set -euo pipefail

EXPECTED_B64_CHARS="74336"
EXPECTED_OVERLAY_SHA="ed2a27fdd829bf0f16c3b88fc93d1e795f1ce1bc785b458224ae8c6e74f3b740"
TMP_B64="$(mktemp /tmp/isartech-v08-overlay.XXXXXX.b64)"
TMP_TAR="$(mktemp /tmp/isartech-v08-overlay.XXXXXX.tar.gz)"
trap 'rm -f "$TMP_B64" "$TMP_TAR"' EXIT

cat overlay-v08/part-*.b64 > "$TMP_B64"
ACTUAL_CHARS="$(wc -c < "$TMP_B64" | tr -d ' ')"
if [ "$ACTUAL_CHARS" != "$EXPECTED_B64_CHARS" ]; then
  echo "Invalid v0.8 overlay Base64 length: $ACTUAL_CHARS; expected $EXPECTED_B64_CHARS"
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
    raise SystemExit(f"v0.8 overlay Base64 decode failed: {exc}") from exc
Path(sys.argv[2]).write_bytes(data)
PY

ACTUAL_SHA="$(sha256sum "$TMP_TAR" | awk '{print $1}')"
if [ "$ACTUAL_SHA" != "$EXPECTED_OVERLAY_SHA" ]; then
  echo "v0.8 overlay checksum mismatch: $ACTUAL_SHA; expected $EXPECTED_OVERLAY_SHA"
  exit 1
fi

tar -xzf "$TMP_TAR" -C .

# Next.js/Node TypeScript must not type-check Supabase Edge Functions.
# Those functions run on Deno and intentionally use Deno/npm: specifiers.
python3 <<'PY'
import json
from pathlib import Path

path = Path("tsconfig.json")
data = json.loads(path.read_text())
exclude = data.setdefault("exclude", [])
rule = "supabase/functions/**"
if rule not in exclude:
    exclude.append(rule)
path.write_text(json.dumps(data, indent=2) + "\n")
print("Next.js TypeScript exclusion applied: supabase/functions/**")
PY

echo "ISARTECH ONE v0.8 overlay verified: $ACTUAL_SHA"
