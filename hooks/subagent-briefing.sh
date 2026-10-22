#!/bin/bash
# SubagentStart: give every subagent the same working rules, so a dispatch brief
# that forgets them cannot turn a quick worker into a slow one.
set -euo pipefail

jq -n '{
  hookSpecificOutput: {
    hookEventName: "SubagentStart",
    additionalContext: "Subagent rules: only do the task, as fast as possible. Never build, test, typecheck or lint; the orchestrator runs all checks after you report back (these commands are blocked for subagents). When the task has tests, commit the tests in their own commit before the implementation. Read a file before you edit or write it. Return your result as text in your final reply; never write report files. Report back as soon as the task is done."
  }
}'
