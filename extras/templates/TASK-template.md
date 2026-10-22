# Task: <one-line title>

Repo: `<repo>`, package `<package>` unless a path says otherwise.
Work on a new branch off `<base branch>`.
Do not commit this file or TASKS.md.
Follow the repo rules in `CLAUDE.md` and `AGENTS.md`.
Read `<HANDOVER path for this feature>` first, if it exists.

## Keep going rule

When a step doesn't need my input, keep going.
Stop and ask only when you can't continue without me, or before anything destructive or outward-facing (push, PR, Slack, Linear, deploy).
Keep a checklist in `TASKS.md` and tick each item when it is done.

## No checks rule

Do not build, test, typecheck, or lint.
The orchestrator runs these checks after you report back.
Report back as soon as the task is done.
Write the report as text in your final reply. Do not write report files.
When the task has tests, commit the tests first in their own commit, then the implementation, so the orchestrator can run red on the test commit and green on HEAD.

---

## Fix 1: <title>

### What happened

<observed behaviour, with session IDs, trace IDs, file paths>

### Where

- <files and functions to start from>

### Required behaviour

- <each rule as a checkable statement>

### Tests

- <test file and cases; assert on values and state, not only "does not throw">

---

## Review round <n> (only for a fix round after a review)

- Worktree path, branch, and the commit list so far: <paths, branch, shas>
- Last reviewed SHA: <sha>. The reviewer looked only at `git diff <last-reviewed-sha>..HEAD`; fixes may touch any code that has the same broken invariant.
- Reviewer findings, verbatim, each tagged Important / Nit / Pre-existing:
  - <tag> <finding text>
- Already fixed or answered in earlier rounds (do not redo): <finding, sha or reply>
- Broken invariant, one line per finding: <invariant>. Fix every instance of that class, not only the quoted line.
- Pre-existing findings are not fixed here. List them as follow-ups.

---

## Done when

- [ ] <each required behaviour above is covered by a test written for it>
- [ ] The final reply lists every changed file with one line on why, the test commit SHA, and anything not confirmed
- [ ] Pre-existing findings are listed as follow-ups, not fixed
- [ ] Any prompt, tool description or inline prompt string change is listed under a "Prompt changed" heading in the final reply
