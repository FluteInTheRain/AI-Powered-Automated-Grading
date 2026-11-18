#!/usr/bin/env bash
# Refresh the shared code copied into the `grading` Worker bundle, then build
# the frontend that wrangler serves as static assets. Run from anywhere.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
SRC="$HERE/src"

# grader package at src/vendor/grader: grader reads Path(__file__).parents[2] / "prompts" == src/prompts.
rm -rf "$SRC/vendor/grader" "$SRC/prompts" "$SRC/server"
mkdir -p "$SRC/vendor" "$SRC/server"
cp -R "$ROOT/src/grader" "$SRC/vendor/grader"
cp -R "$ROOT/prompts" "$SRC/prompts"
cp "$ROOT/server/rules.py" "$SRC/server/rules.py"
: > "$SRC/server/__init__.py"
find "$SRC/vendor" "$SRC/server" -name __pycache__ -type d -prune -exec rm -rf {} +

(cd "$ROOT/frontend" && { [ -d node_modules ] || npm install; } && npm run build)
