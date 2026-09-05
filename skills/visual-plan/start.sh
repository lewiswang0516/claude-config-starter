#!/bin/sh
# Start the visual-plan server as a detached daemon if it is not already running.
# Idempotent: safe to call every round. Prints the URL on success.
DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${VP_PORT:-4517}"
RUNTIME="${VP_RUNTIME:-/tmp/claude-visual-plan}"
URL="http://localhost:$PORT"
mkdir -p "$RUNTIME"

if curl -s -o /dev/null "$URL/api/health" 2>/dev/null; then
  echo "$URL (already running)"
  exit 0
fi

NODE="$(sh "$DIR/node-path.sh")"
nohup "$NODE" "$DIR/server.js" > "$RUNTIME/server.log" 2>&1 &

# Wait for the server to answer without using foreground `sleep`.
if curl -s --retry-connrefused --retry 40 --retry-delay 0 --max-time 8 -o /dev/null "$URL/api/health" 2>/dev/null; then
  echo "$URL"
else
  echo "FAILED to start (see $RUNTIME/server.log):"
  cat "$RUNTIME/server.log" 2>/dev/null
  exit 1
fi
