#!/usr/bin/env bash
# Refresh the one grader module the `grading-sandbox` Worker needs. Only
# sandbox.py is copied, so this Worker carries no LLM or prompt code.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
DEST="$HERE/src/vendor/grader"

rm -rf "$DEST"
mkdir -p "$DEST"
cp "$ROOT/src/grader/sandbox.py" "$DEST/sandbox.py"
: > "$DEST/__init__.py"
