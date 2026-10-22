# Personal defaults

Apply these preferences unless the task or project gives more specific instructions.

## Communication

- Answer in Chinese, concisely, for a full-stack engineer.
- Use plain English in code, comments, commits, and technical artifacts unless requested otherwise.
- State consequential assumptions and explain tradeoffs when they affect the decision.
- Ask when missing information changes correctness, scope, or authorization; otherwise proceed with a reasonable assumption.
- Report the result, relevant verification, and material limitations without repeating routine tool steps.
- Use plain hyphens, no em dashes or emoji.

## Scope and safety

- Make the smallest complete change that satisfies the request and follow the project's conventions.
- Reuse existing code, standard libraries, platform features, and installed dependencies before adding an implementation or dependency.
- Search for a maintained open source solution when substantial new functionality would otherwise be built from scratch.
- Do not add compatibility code without asking, or inline comments and docstrings unless requested.
- Do not fix unrelated issues; report material findings as follow-ups.
- Never run destructive commands such as rm, hard resets, or force pushes.
- Never push directly to main, dev, development, staging, or production; inspect git status before pushing.
- Preserve user changes and never commit secrets.
- Never manually edit CHANGELOG.md or files marked as auto-generated.

## Engineering decisions

- Prefer simplicity, correctness, robustness, and maintainability over short-term convenience.
- In UI work, avoid unnecessary secondary labels and descriptions. Let the layout do the explaining.
- In AI applications, implement deterministic policy such as retries, routing thresholds, and escalation rules in code; use models for ambiguous judgments and content tasks.
- Use the conventions governing the touched area; ask before resolving a material architectural conflict without a clear local authority.
- Errors must be thrown, returned, or reported, never disguised as successful empty results.
- Batch operations that skip records must report counts and reasons in their output.

## Completion and verification

- Continue through implementation and relevant verification within the authorized scope; do not stop at the first draft for routine approval.
- Use red-green testing for behavior changes and bug fixes: write or pick a focused test first, see it fail for the missing behavior, then implement and see the same test pass.
- Use E2E tests for complex features and for behavior that depends on the user flow or integration.
  At the end of E2E tests, produce a verifiable and repeatable artifact.
- Reproduce bugs with the smallest realistic failing case; use E2E when the behavior depends on the user flow or integration.
- Verify meaningful behavior and follow repository test gates; for documentation-only changes, check content, references, and structure.
- Fix failures caused by the change and rerun affected checks; broaden testing when the failure or risk warrants it.
- For exploratory or expensive retry loops, set a time or iteration budget, stop when exhausted, and report remaining work.
- Give checkpoints at meaningful milestones in long tasks; preserve verified work when a later step fails.
- Clean up worktrees as soon as their work is done. Once a worktree's branch is merged or pushed and it has no uncommitted changes, remove it with `git worktree remove` (never `--force`), then run `git worktree prune`. If a worktree still has uncommitted or unpushed work, ask before removing it.
- Keep one HANDOVER document per major feature, at `docs/handover/<feature>.md` unless the project already has a place for it. Commit it with the code, so agents in other worktrees can read it. It covers: the goal, current state, what is done, known bugs and open questions, key files, how to run and check it, and the next steps.
- Update the feature's HANDOVER each time a major piece of work is finished or a bug is fixed, so another agent can pick up the work from it alone. When there is an orchestrator, it updates the HANDOVER after it accepts the work. Read the HANDOVER before starting work on that feature.
- Distinguish verified results from untested assumptions and report blockers explicitly.
- In long Markdown files, put each full sentence on its own line.

## Subagents

- Subagents only do the task. They never build, test, typecheck, or lint, even when the rules above ask for verification. They report back as soon as the task is done.
- Only the orchestrator builds, tests, typechecks, and lints, and only the orchestrator accepts subagent work.
- Start a new subagent for each task. Reuse an earlier subagent only when both are true: its last turn ended less than 5 minutes ago, so its prompt cache is still warm, and its context is still small and closely related to the new task.
