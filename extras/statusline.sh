#!/bin/bash
# Claude Code status line: model | 5h | 7d | Fable 7d | ctx | git | cost
# Usage limits come from the Anthropic OAuth usage endpoint, cached for 60s.

input=$(cat)
CACHE="$HOME/.claude/.usage-cache.json"
TTL=60

model=$(echo "$input" | jq -r '.model.display_name // "?"')
ctx=$(echo "$input" | jq -r '
  if .context_window.used_percentage != null then (.context_window.used_percentage|floor)
  elif (.context_window.context_window_size // 0) > 0 then
    (((.context_window.current_usage.input_tokens // 0)
      + (.context_window.current_usage.cache_creation_input_tokens // 0)
      + (.context_window.current_usage.cache_read_input_tokens // 0)) * 100
      / .context_window.context_window_size | floor)
  else empty end')
cost=$(echo "$input" | jq -r '.cost.total_cost_usd // empty')
dir=$(echo "$input" | jq -r '.workspace.current_dir // empty')
branch=""
[ -n "$dir" ] && branch=$(git -C "$dir" rev-parse --abbrev-ref HEAD 2>/dev/null)

refresh_usage() {
  local tok body
  tok=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null \
    | jq -r '.claudeAiOauth.accessToken // empty')
  [ -z "$tok" ] && return 1
  body=$(curl -s -m 4 https://api.anthropic.com/api/oauth/usage \
    -H "Authorization: Bearer $tok" -H "anthropic-beta: oauth-2025-04-20") || return 1
  echo "$body" | jq -e '.limits' >/dev/null 2>&1 || return 1
  printf '%s' "$body" | tee "$CACHE.tmp" >/dev/null && mv "$CACHE.tmp" "$CACHE"
}

now=$(date +%s)
if [ ! -f "$CACHE" ] || [ $((now - $(stat -f %m "$CACHE"))) -ge $TTL ]; then
  refresh_usage
fi

fmt_reset() {
  # ISO UTC -> local "HH:MM" if today, else "M/D HH:MM"
  local iso="$1" epoch
  epoch=$(date -j -u -f "%Y-%m-%dT%H:%M:%S" "${iso%%.*}" +%s 2>/dev/null) || { echo "?"; return; }
  if [ "$(date -r "$epoch" +%Y%m%d)" = "$(date +%Y%m%d)" ]; then
    date -r "$epoch" +%H:%M
  else
    date -r "$epoch" "+%-m/%-d %H:%M"
  fi
}

usage=""
if [ -f "$CACHE" ]; then
  while IFS=$'\t' read -r kind pct reset scope; do
    [ -z "$kind" ] && continue
    left=$((100 - pct))
    r=$(fmt_reset "$reset")
    case "$kind" in
      session)       usage+=" | 5h ${left}% left (resets $r)";;
      weekly_all)    usage+=" | 7d ${left}% left (resets $r)";;
      weekly_scoped) usage+=" | ${scope:-scoped} 7d ${left}% left";;
    esac
  done < <(jq -r '.limits[]? | [.kind, (.percent // 0), (.resets_at // ""), (.scope.model.display_name // "")] | @tsv' "$CACHE")
fi

line="$model$usage"
[ -n "$ctx" ] && line+=" | ctx ${ctx}%"
[ -n "$branch" ] && line+=" | $branch"
[ -n "$cost" ] && line+=" | \$$(printf '%.2f' "$cost")"
printf '%s' "$line"
