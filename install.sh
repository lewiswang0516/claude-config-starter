#!/usr/bin/env bash
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HOME/.claude"

if [ "$(id -u)" -eq 0 ]; then
  echo "Error: do not run this installer as root. Run it as your normal user." >&2
  exit 1
fi

missing=0
for bin in claude python3; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "Error: '$bin' was not found in PATH." >&2
    missing=1
  fi
done
if [ "$missing" -ne 0 ]; then
  echo "Install Claude Code and Python 3, then run this script again." >&2
  exit 1
fi

mkdir -p "$DEST/hooks" "$DEST/skills"

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$DEST/backups/starter-$STAMP"
mkdir -p "$BACKUP"
for f in CLAUDE.md settings.json; do
  if [ -f "$DEST/$f" ]; then
    cp -p "$DEST/$f" "$BACKUP/$f"
    echo "Backed up $DEST/$f"
  fi
done

copied=0

cp "$SRC/CLAUDE.md" "$DEST/CLAUDE.md"
copied=$((copied + 1))
echo "Installed CLAUDE.md"

if [ -d "$SRC/hooks" ]; then
  for item in "$SRC"/hooks/*; do
    [ -e "$item" ] || continue
    cp -R "$item" "$DEST/hooks/"
    copied=$((copied + 1))
  done
  chmod +x "$DEST"/hooks/*.py "$DEST"/hooks/*.sh 2>/dev/null || true
  echo "Installed hooks into $DEST/hooks"
fi

if [ -d "$SRC/commands" ]; then
  mkdir -p "$DEST/commands"
  for item in "$SRC"/commands/*; do
    [ -e "$item" ] || continue
    cp -R "$item" "$DEST/commands/"
    copied=$((copied + 1))
  done
fi

skills_installed=0
skills_skipped=0
if [ -d "$SRC/skills" ]; then
  for dir in "$SRC"/skills/*/; do
    [ -d "$dir" ] || continue
    name="$(basename "$dir")"
    if [ -e "$DEST/skills/$name" ]; then
      echo "  $name: skipped (exists)"
      skills_skipped=$((skills_skipped + 1))
    else
      cp -RL "$dir" "$DEST/skills/$name"
      skills_installed=$((skills_installed + 1))
    fi
  done
fi

if [ ! -f "$DEST/settings.json" ]; then
  cp "$SRC/settings.json" "$DEST/settings.json"
  echo "Installed settings.json (no existing file found)"
else
  OURS="$SRC/settings.json" THEIRS="$DEST/settings.json" python3 <<'PYEOF'
import json, os

ours_path = os.environ["OURS"]
theirs_path = os.environ["THEIRS"]

with open(ours_path, encoding="utf-8") as f:
    ours = json.load(f)
try:
    with open(theirs_path, encoding="utf-8") as f:
        theirs = json.load(f)
except (ValueError, OSError) as exc:
    raise SystemExit("Error: could not parse existing settings.json: %s" % exc)

changes = []

for key in ("model", "effortLevel"):
    if key in ours and key not in theirs:
        theirs[key] = ours[key]
        changes.append("set %s to %r" % (key, ours[key]))

for key in ("enabledPlugins", "extraKnownMarketplaces"):
    src = ours.get(key, {})
    if not src:
        continue
    dst = theirs.setdefault(key, {})
    if not isinstance(dst, dict):
        changes.append("kept existing %s (not an object, left alone)" % key)
        continue
    for name, value in src.items():
        if name not in dst:
            dst[name] = value
            changes.append("added %s entry %s" % (key, name))

our_hooks = ours.get("hooks", {})
their_hooks = theirs.setdefault("hooks", {})


def commands(group):
    out = set()
    for entry in group.get("hooks", []) or []:
        cmd = entry.get("command")
        if cmd:
            out.add(cmd)
    return out


for event, groups in our_hooks.items():
    existing = their_hooks.setdefault(event, [])
    if not isinstance(existing, list):
        changes.append("kept existing hooks.%s (not a list, left alone)" % event)
        continue
    present = set()
    for group in existing:
        if isinstance(group, dict):
            present |= commands(group)
    for group in groups:
        new_cmds = commands(group)
        if new_cmds and new_cmds <= present:
            continue
        existing.append(group)
        present |= new_cmds
        changes.append("appended hook to %s: %s" % (event, ", ".join(sorted(new_cmds))))

with open(theirs_path, "w", encoding="utf-8") as f:
    json.dump(theirs, f, indent=2, ensure_ascii=False)
    f.write("\n")

if changes:
    print("Merged settings.json:")
    for line in changes:
        print("  - " + line)
else:
    print("Merged settings.json: nothing to change, already up to date")
PYEOF
fi

echo
echo "Summary"
echo "  Files copied into $DEST: $copied"
echo "  Skills installed: $skills_installed"
echo "  Skills skipped (already present): $skills_skipped"
echo "  Backup location: $BACKUP"
echo "Done. Restart Claude Code to pick up the new settings."
