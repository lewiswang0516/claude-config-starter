#!/bin/sh
# Resolve a usable node binary WITHOUT triggering nvm's lazy-load shell function
# (calling bare `node` can recurse in this environment). Prints an absolute path.
latest_nvm="$(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1)"
for c in "$latest_nvm" /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
  [ -n "$c" ] && [ -x "$c" ] && { echo "$c"; exit 0; }
done
echo node
