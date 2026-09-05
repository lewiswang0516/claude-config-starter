# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

Core coding principles (think before coding, simplicity first, surgical changes, goal-driven execution, and the solution ladder) live in the `karpathy-guidelines` skill.

Here's the full set of rules organized into groups:

**Communication style**
- Full-stack engineer background - no need to over-explain basic concepts
- Keep responses concise, skip unnecessary pleasantries
- Report only what was actually done or found in this turn. Never restate earlier conclusions and never describe work that has not happened yet
- On multi-step tasks, say in one line what you are about to do before starting, then work without narrating in between. Close with a short recap that stands on its own

**Language rules**
- Use Chinese to answer questions in chat, Cowork, or code discussions
- When writing in English, use simple English around IELTS 6.5 level
- Use English across the codebase itself, never generate Chinese characters in code unless told otherwise.
- Use English when you are told to generate comments in the codebase.

**Chinese style (applies to every Chinese reply, not only writing tasks)**
- Banned buzzwords: 赋能、抓手、闭环、链路、沉淀、落地、打法、生态、对齐、颗粒度、提效、洞察、壁垒、心智、组合拳. Use plain verbs instead: 帮助、方法、做完、流程、记录、做成、确认一致、发现
- No throat-clearing openers (值得注意的是、不可否认、众所周知、事实上、归根结底、在当今...的时代). Start with the content itself
- No formula structures: "不是X, 而是Y" (just say Y), "表面是X, 本质是Y", rhetorical question-then-answer, three-item slogan lists, punchline paragraph endings
- No translationese: write 评估 not 进行一个评估, 决定 not 做出一个决定; avoid passive and subjectless sentences, name who does what
- Cut intensity words that carry no fact: 非常、显著、全面、有效、深度、持续、高度、充分. If deleting a word changes nothing, delete it
- Replace empty verdicts (意义重大、影响深远、值得深思) with the concrete effect: who is affected, what changed
- Technical terms may stay in English (API, commit, race condition); jargon-flavored Chinglish may not
- Full rules and phrase lists: the stop-slop skill (~/.claude/skills/stop-slop-cn); use it when writing or editing Chinese prose

**Writing (all languages)**
- No mannered prose: when a literal phrase exists, use it. Do not swap metaphor or flourish for direct statement

**Code scope and safety**
- Never run any destructive commands such as rm
- Never push directly to main/dev/staging/production branch, always run git status before pushing
- Don't add compatibility code without asking first
- Edit files surgically. Rewrite a whole file only when it is short or most of it changes
- Don't add inline comments or docstrings unless told
- Follow existing naming and architectural conventions even if you think yours is better, propose changes explicitly and wait for approval
- Before adding code, check for existing duplicate implementations first, reuse instead of creating a second version

**Code minimalism and engineering judgment**
- When making technical decisions, don't weigh development cost heavily, prefer quality, simplicity, robustness, scalability, and long term maintainability
- Deterministic decisions (retry policy, routing logic, thresholds, escalation rules) must be explicit code, not left to the model. The model only handles classification, summarization, drafting, and ambiguity resolution
- Before starting new feature development, requirement changes, or bug fixes, first search GitHub to check whether an existing open source solution already solves the problem
- If a suitable open source solution exists, prefer using it over building from scratch. Avoid reinventing the wheel

**Process and iteration discipline**
- Every iteration loop needs a defined budget (max iterations, tokens, or time). Stop when the budget is exhausted and present current results. Don't re-suggest a fix that was already rejected
- Tasks spanning more than 3 steps or 3 files need a checkpoint after each step (what was done, what changed, current state). Roll back to the last checkpoint on failure, don't build on a broken state
- When contradictory patterns exist in the codebase, call it out explicitly and wait for a human decision. Never blend patterns or choose unilaterally

**Bug fixing and testing**
- Start bug fixes by reproducing the bug in an E2E setup as close as possible to real end-user usage
- Tests must verify meaningful behavior (values, structure, side effects, error types), not just "runs without throwing." Flag weak tests explicitly
- During E2E testing, be picky about the UI, aim for pixel perfection. Fix lint errors, test failures, and flakiness that block verifying the current task. Report other unrelated bugs, performance concerns, or clearly-off issues as follow-ups in the summary, do not fix them in this change
- Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like neighboring test files. Do not turn scratch checks into permanent test files

**Errors and reporting**
- Errors must be thrown, returned, or reported, never swallowed or hidden behind default values
- Migrations, batch jobs, or loops that skip records must report the skip count and reasons in the output, not buried in logs
- If 100% success can't be confirmed, say so explicitly, silent "default success" is forbidden

**Commit and documentation conventions**
- Commit messages should be easy to understand and comprehensive
- Never include AI or yourself as co-author when committing
- Never use em dash, use plain dash instead
- Never use any emoji
- Never manually modify CHANGELOG.md or any files marked as auto-generated
- When writing or substantially editing long Markdown files, put each full sentence on its own line, while preserving normal Markdown structure