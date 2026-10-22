# Claude Code Config Starter

A shared starting point for Claude Code: global instructions, safety hooks, and a skill library.

## What is inside

`CLAUDE.md` holds the global behaviour rules that apply to every project.
`settings.json` sets the effort level, the hook wiring, and the plugin marketplaces.
`hooks/` holds small scripts that Claude Code runs before a tool call or when a turn ends.
`skills/` holds skill folders that Claude Code can load on demand.
`output-styles/` holds `chinese-plain.md`, a style for plain, specific Chinese replies.
`extras/` holds optional files that the installer does not touch: a status line script, a task brief template, the `reply-guard` mod, and a Codex `AGENTS.md`.
`install.sh` copies everything except `extras/` into `~/.claude` and merges your existing settings instead of overwriting them.

## Prerequisites

Claude Code must be installed and you must be logged in.
Python 3 must be available on your PATH.
Node is needed by a few skills, so install it if you plan to use them.
`jq` is needed by `checkpoint-guard.sh` and the optional shell hooks; without it those hooks stay quiet and do nothing.

## Install

Clone the repository somewhere you can keep it.

```
git clone https://github.com/lewiswang0516/claude-config-starter.git
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

## Hooks

Some hooks can block a turn from ending.
`cn-slop-check.py` blocks Chinese text that uses banned buzzwords, `no-undone-restate.py` blocks a closing summary that describes work not yet done, and `checkpoint-guard.sh` blocks a fake checkpoint claim.
The point is to make the model report only what actually happened.
`guard-git.py` blocks risky git commands such as a push to a protected branch.
`check-file-content.py` blocks file writes that break the code hygiene rules in `CLAUDE.md`.
If a hook blocks you and you disagree, edit or remove that hook entry in `~/.claude/settings.json`.

These hooks are copied but not wired in `settings.json`, so they do nothing until you add them yourself:

- `prompt-reminder.sh` (UserPromptSubmit): repeats the reply rules next to every message.
- `subagent-briefing.sh` (SubagentStart): gives every subagent the same working rules.
- `subagent-no-checks.sh` (PreToolUse, Bash): stops subagents from running build, test, typecheck or lint.
- `post-edit-cn-check.sh` and `post-edit-prettier.sh` (PostToolUse, Edit|Write): flag Chinese characters in code and run prettier.

## Skills and licenses

| Skill | Source | License |
| --- | --- | --- |
| eli5, interview-helper, visual-plan | written for this repo | no license file yet |
| skill-creator, webapp-testing | [anthropics/skills](https://github.com/anthropics/skills) | Apache 2.0, see each `LICENSE.txt` |
| find-skills | [vercel-labs/skills](https://github.com/vercel-labs/skills) | MIT, see `LICENSE` |
| vercel-react-best-practices | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) | MIT, see `NOTICE.md` |
| stop-slop-cn | based on [hardikpandya/stop-slop](https://github.com/hardikpandya/stop-slop) | MIT, see `LICENSE` |

`visual-plan` ships a copy of Mermaid, which is MIT licensed; see `skills/visual-plan/vendor/mermaid.LICENSE`.

The Word, PDF, PowerPoint and Excel skills from Anthropic are not copied here, because their license does not allow redistribution.
`settings.json` enables the `document-skills` plugin from the official `anthropic-agent-skills` marketplace instead, so Claude Code installs them from Anthropic the first time you launch it.

For React and TypeScript conventions, see [react-personal-style](https://github.com/lewiswang0516/react-personal-style).

The marketplace plugins listed in `settings.json` install themselves the first time you launch Claude Code after the install, so give the first launch a moment.
