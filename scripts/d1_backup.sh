#!/usr/bin/env bash
# Take a remote export of the teacher-app D1 database into backups/ (gitignored).
# Read only: `wrangler d1 export` does not change the database.
# The export holds student names and answers. Never commit it, upload it anywhere public,
# or keep it as a GitHub Actions artifact (docs/runbook.md).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
dir="$root/backups"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$dir/teacher-app-$stamp.sql"

mkdir -p "$dir"
# Refuse unless git would ignore this path.
if ! git -C "$root" check-ignore -q "$out"; then
  echo "refusing: $out is not gitignored (add backups/ to .gitignore)" >&2
  exit 1
fi

cd "$root/app-worker"
npx wrangler d1 export teacher-app --remote --output "$out"

if command -v sha256sum >/dev/null 2>&1; then
  sum="$(sha256sum "$out" | cut -d' ' -f1)"
else
  sum="$(shasum -a 256 "$out" | cut -d' ' -f1)"
fi
size="$(wc -c < "$out" | tr -d ' ')"
echo "file:   $out"
echo "size:   $size bytes"
echo "sha256: $sum"
echo "Next: python3 scripts/d1_restore_drill.py $out"
