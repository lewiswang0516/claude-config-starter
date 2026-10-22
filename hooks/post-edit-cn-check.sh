#!/bin/bash
# PostToolUse(Edit|Write): flag Chinese/CJK characters in code files.
# Project rule: English only across the codebase (comments included).
set -euo pipefail

f=$(jq -r '.tool_response.filePath // .tool_input.file_path // empty')
[ -n "$f" ] && [ -f "$f" ] || exit 0

case "$f" in
  *.ts | *.tsx | *.js | *.jsx | *.mjs | *.cjs | *.css) ;;
  *) exit 0 ;;
esac

hits=$(node -e '
const fs = require("fs");
const lines = fs.readFileSync(process.argv[1], "utf8").split("\n");
lines.forEach((l, i) => {
  if (/[一-鿿　-〿]/.test(l)) console.log(`  ${i + 1}: ${l.trim().slice(0, 80)}`);
});
' "$f" | head -5)

[ -n "$hits" ] || exit 0

echo "Chinese characters found in code file $f (CLAUDE.md rule: English only in the codebase — rewrite these lines in English):" >&2
echo "$hits" >&2
exit 2
