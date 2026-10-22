#!/bin/bash
# PreToolUse(Bash): subagents never build, test, typecheck or lint. Only the
# orchestrator runs checks. A tool call from a subagent carries agent_id in the
# hook input; the main session does not, so it is never blocked here.
set -euo pipefail

hook_input=$(cat)
agent_id=$(printf '%s' "$hook_input" | jq -r '.agent_id // empty')
[ -n "$agent_id" ] || exit 0

cmd=$(printf '%s' "$hook_input" | jq -r '.tool_input.command // empty')
[ -n "$cmd" ] || exit 0

# Quoted spans are data (commit messages, echo text), not invocations.
cmd=$(printf '%s' "$cmd" | sed -E "s/'[^']*'//g; s/\"[^\"]*\"//g")

runner='(npx|bunx|yarn|pnpm|npm|bun)[[:space:]]+(run[[:space:]]+|exec[[:space:]]+)?'
checks='(vitest|jest|playwright|tsc|eslint|test(:[^[:space:]]*)?|typecheck|lint(:[^[:space:]]*)?|build(:[^[:space:]]*)?|check-types|turbo)'
others='(pytest|python3?[[:space:]]+-m[[:space:]]+(pytest|unittest)|/python[0-9.]*[[:space:]]+-m[[:space:]]+(pytest|unittest)|make[[:space:]]+(test|build|lint|check)|cargo[[:space:]]+(test|build|clippy|check)|go[[:space:]]+(test|build|vet)|mvn|gradlew?|javac|tsc|fallow[[:space:]]+audit)'

if printf '%s' "$cmd" | grep -Eq "(^|[;&|(\`[:space:]])(${runner}${checks}|${others})([[:space:]]|$|;|&|\|)"; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Subagents never build, test, typecheck or lint. Skip this check and report back; the orchestrator runs all checks."
    }
  }'
fi
exit 0
