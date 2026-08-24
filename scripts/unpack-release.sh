#!/usr/bin/env bash
set -euo pipefail

EXPECTED="3e4c7b4c89101f13b1739c970ed452f836d586ab779c5f6f155e070d6d98e22d"
TMP="$(mktemp /tmp/isartech-one-rc.XXXXXX.tar.gz)"
trap 'rm -f "$TMP"' EXIT

cat release/part-*.b64 | base64 -d > "$TMP"
ACTUAL="$(sha256sum "$TMP" | awk '{print $1}')"

if [ "$ACTUAL" != "$EXPECTED" ]; then
  echo "Release integrity check failed: $ACTUAL" >&2
  exit 42
fi

tar -xzf "$TMP" -C .
echo "ISARTECH ONE RC integrity verified: $ACTUAL"
