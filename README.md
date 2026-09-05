# Claude Code Config Starter

A shared starting point for Claude Code: global instructions, safety hooks, and a skill library.

## What is inside

`CLAUDE.md` holds the global behaviour rules that apply to every project.
`settings.json` sets the effort level, the hook wiring, and the plugin marketplaces.
`hooks/` holds small scripts that Claude Code runs before a tool call or when a turn ends.
`skills/` holds 13 skill folders that Claude Code can load on demand.
`install.sh` copies everything into `~/.claude` and merges your existing settings instead of overwriting them.

## Prerequisites

Claude Code must be installed and you must be logged in.
Python 3 must be available on your PATH.
Node is needed by a few skills, so install it if you plan to use them.
The `checkpoint-guard.sh` hook needs `jq`; without it the hook stays quiet and does nothing.

## Install

Clone the repository somewhere you can keep it.

```
git clone <repo-url> claude-config-starter
cd claude-config-starter
./install.sh
```

Restart Claude Code after the script finishes.

## Update

Pull the latest version and run the installer again.

```
git pull
./install.sh
```

Existing skill folders are left alone, so delete a skill folder under `~/.claude/skills` first if you want a fresh copy of it.

## Uninstall

The installer backs up `CLAUDE.md` and `settings.json` to `~/.claude/backups/starter-<timestamp>/` on every run.
Copy those two files back into `~/.claude` to return to your earlier setup.
Delete the hook scripts under `~/.claude/hooks` and the skill folders under `~/.claude/skills` that you no longer want.

## Notes

Some hooks can block a turn from ending.
`cn-slop-check.py` blocks Chinese text that uses banned buzzwords, `no-undone-restate.py` blocks a closing summary that describes work not yet done, and `checkpoint-guard.sh` blocks a fake checkpoint claim.
The point is to make the model report only what actually happened.
`guard-git.py` blocks risky git commands such as a push to a protected branch.
`check-file-content.py` blocks file writes that break the code hygiene rules in `CLAUDE.md`.
If a hook blocks you and you disagree, edit or remove that hook entry in `~/.claude/settings.json`.
The marketplace plugins listed in `settings.json` install themselves the first time you launch Claude Code after the install, so give the first launch a moment.
