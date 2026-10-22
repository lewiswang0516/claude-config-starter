#!/bin/bash
# PostToolUse(Edit|Write): auto-format edited files with prettier.
# Enforces the CLAUDE.md rule "run prettier after writing/editing" deterministically.
set -euo pipefail

f=$(jq -r '.tool_response.filePath // .tool_input.file_path // empty')
[ -n "$f" ] && [ -f "$f" ] || exit 0

case "$f" in
  *.ts | *.tsx | *.js | *.jsx | *.mjs | *.cjs | *.css | *.json | *.jsonc | *.md) ;;
  *) exit 0 ;;
esac

cd "${CLAUDE_PROJECT_DIR:-.}"
npx prettier --write --ignore-unknown "$f" >/dev/null 2>&1 || true
