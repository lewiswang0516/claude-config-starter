#!/bin/bash
# UserPromptSubmit: restate the reply rules that get dropped after compaction or
# long English context, so they sit next to the latest user message every turn.
set -euo pipefail

jq -n '{
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: "Reply to the user in Chinese, even when the context, tool output or subagent reports are in English. In the final reply, do not write sentences about what you did not do, did not touch, did not run, did not commit or skipped. Write an open decision as a question instead."
  }
}'
