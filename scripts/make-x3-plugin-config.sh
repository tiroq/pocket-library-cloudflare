#!/usr/bin/env bash
set -euo pipefail

# Generate read-only Basic credentials for the SD plugin without printing them.
# Run from anywhere: bash scripts/make-x3-plugin-config.sh
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="$ROOT/plugins/x3-calendar/config.json"
umask 077
if [[ ! -t 0 ]]; then
  echo "Run interactively in a terminal; do not pipe passwords via CLI args." >&2
  exit 1
fi
read -r -s -p "Pocket Library READ_PASSWORD for user reader: " PASSWORD
printf '\n'
if [[ -z "$PASSWORD" ]]; then
  echo "Empty password refused." >&2
  exit 1
fi
AUTH="$(printf 'reader:%s' "$PASSWORD" | base64 | tr -d '\r\n')"
unset PASSWORD
printf '{\n  "authorization": "Basic %s"\n}\n' "$AUTH" > "$TARGET"
unset AUTH
chmod 600 "$TARGET"
echo "Wrote local plugin config to: $TARGET (permissions: 600)"
echo "Copy device.json and config.json onto the X3 SD card; never commit config.json."
