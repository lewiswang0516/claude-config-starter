---
name: visual-plan
description: Render an implementation plan as an interactive local web page instead of a long wall of text. Use this WHENEVER you are about to present a plan — i.e. when entering plan mode, when the user asks to plan / design / lay out how to implement a feature, requirement, refactor, or change, or when the user wants to review options before coding. The page shows an architecture/flow diagram, step cards, a file-change list, before/after code diffs, rendered before/after UI mockups for any frontend change, and clickable questions; the user answers questions, types feedback, or clicks "Execute" right in the browser, and the browser sends that signal back to you.
---

# visual-plan

Turn a plan into a browser page the user can read, tick, and act on — no big text dumps in the terminal.

## When to use
- You entered plan mode, OR
- The user asked to plan / design / outline how to implement something, OR
- You want the user to choose between approaches or answer open questions before you code.

Do NOT use for tiny one-line answers, or when the user explicitly wants a text reply.

## Fixed facts
- Server dir: `~/.claude/skills/visual-plan` (call it `$VP` below).
- URL: `http://localhost:4517`. Runtime dir: `/tmp/claude-visual-plan`.
- Everything runs through **Bash + curl** — it needs NO Write/Edit tool, so it also works inside harness plan mode.

## Protocol (follow in order)

### Round 1 — present the plan
1. **Start the server (idempotent):**
   ```
   bash ~/.claude/skills/visual-plan/start.sh
   ```
   It prints the URL. Safe to run every round; it reuses a running instance.

2. **Push the plan** by POSTing JSON to `/api/plan` (server writes it to disk; the browser picks it up within ~1.5s). Use a quoted heredoc so `$` and backticks in code are NOT expanded:
   ```
   curl -s -X POST http://localhost:4517/api/plan --data-binary @- <<'PLAN'
   { ...plan JSON... }
   PLAN
   ```
   A `{"ok":true}` response means it landed. If it returns `invalid JSON`, fix and resend.

3. **Open it in the user's browser (first round only):**
   ```
   open http://localhost:4517
   ```

4. **Wait for the user** with a background long-poll, then END YOUR TURN. Run this with `run_in_background: true`:
   ```
   curl -sN http://localhost:4517/api/poll
   ```
   Tell the user briefly: "方案已在浏览器打开 (localhost:4517)，请查看、勾选问题、写反馈或点『执行方案』。" Then stop and wait — the background job re-invokes you when the user acts.

### Round 2+ — react to the user's action
When the background poll returns, it is one JSON submission:
```json
{ "action": "feedback" | "execute", "answers": { "<qid>": "value or [values]" }, "option": "<option id or null>", "feedback": "free text" }
```
- **action = "feedback"**: read `answers` + `option` + `feedback`, revise the plan, re-POST it to `/api/plan` (step 2 — do NOT reopen the browser; the page live-updates and highlights the sections you changed), then start a NEW background poll (step 4) and end the turn.
- **action = "execute"**: the user approved. Honor `option`/`answers` if present. If in plan mode, call `ExitPlanMode` with a concise summary, then start implementing. Otherwise just start implementing. No need to poll again.

## Content requirements (HARD RULES — the server rejects violations it can detect)
1. **`fileChanges` must be exhaustive.** List EVERY file you expect to touch. No "etc.", no sampling. If you are unsure about a file, list it with a note saying so.
2. **Every `add`/`modify` entry MUST carry concrete content**: a `changes` array (specific edits: which function/field/route, what changes) and/or a `diff` of the key part. An entry with only a vague `note` is rejected by the server. `delete` entries need no body.
3. **Frontend changes MUST include `uiPreviews` — never skip the visual before/after.** If any add/modify entry touches a UI file (`.tsx .jsx .vue .svelte .html .css .scss .sass .less .styl .astro`), the server REJECTS the plan unless it has a non-empty `uiPreviews`: one entry per changed component/page, each with self-contained HTML mockups showing how it looks before vs after the change. Only escape hatch: set `uiImpact` (string) explaining why nothing visible changes (e.g. pure logic refactor inside a .tsx file). Mockups must approximate the REAL current/target look (layout, colors, spacing, text) — read the actual component code first; do not invent a generic placeholder.
4. **`architecture` is REQUIRED when the plan touches ≥3 files or crosses module boundaries.** Use `sequenceDiagram` for API/request flows, `graph`/`flowchart` for structure. Keep it small: the pieces this plan touches, not the whole system.
5. **Every step SHOULD declare `files`** — the paths it touches. They render as clickable chips that jump to the file's diff.
6. **When there are ≥2 viable approaches, use `options`** (side-by-side comparison cards with pros/cons and a `recommended` flag) instead of burying the tradeoff in `summary` or a bare question.
7. Before POSTing, self-check: could the user judge this plan WITHOUT opening any source file? If not, add the missing diffs/changes. If UI changes, could the user SEE what changes without running the app? If not, add/refine `uiPreviews`.

## Plan JSON schema
Include only the sections that help, subject to the hard rules above. Omit empty ones. Unknown/misspelled fields are rejected.
```json
{
  "title": "给标题一句话",
  "summary": "2-4 句话概述要做什么、为什么。",
  "architecture": "graph LR\n  A[Client] --> B[API]\n  B --> C[(DB)]",
  "options": [
    { "id": "a", "title": "方案 A：改 runtime", "recommended": true,
      "summary": "一句话说清这个方案", "pros": ["改动小"], "cons": ["有耦合"] },
    { "id": "b", "title": "方案 B：新建模块", "pros": ["干净"], "cons": ["工作量大"] }
  ],
  "steps": [
    { "title": "第一步做什么", "detail": "怎么做 / 为什么", "files": ["src/foo.ts"] }
  ],
  "uiPreviews": [
    { "title": "登录页 · 操作区", "note": "新增 Google 登录按钮",
      "files": ["src/pages/Login.tsx"],
      "before": "<div style=\"display:flex;flex-direction:column;gap:8px;max-width:280px\"><button style=\"padding:10px;background:#059669;color:#fff;border:none;border-radius:8px\">登录</button></div>",
      "after": "<div style=\"display:flex;flex-direction:column;gap:8px;max-width:280px\"><button style=\"padding:10px;background:#059669;color:#fff;border:none;border-radius:8px\">登录</button><button style=\"padding:10px;background:#fff;color:#334155;border:1px solid #cbd5e1;border-radius:8px\">使用 Google 登录</button></div>",
      "width": 375 }
  ],
  "fileChanges": [
    { "path": "src/foo.ts", "action": "modify", "note": "一句话概括",
      "changes": ["给 fetchUser() 加 retry 参数", "新增 parseRole() 辅助函数"],
      "diff": { "before": "const a = 1", "after": "const a = 2\nconst b = 3" } },
    { "path": "src/bar.ts", "action": "add", "note": "新组件",
      "changes": ["导出 <Badge> 组件，接收 status prop"] },
    { "path": "old.ts", "action": "delete", "note": "不再需要" }
  ],
  "questions": [
    { "id": "db",    "question": "用哪个数据库？", "type": "single", "options": ["Postgres", "SQLite"] },
    { "id": "scope", "question": "包含哪些模块？",   "type": "multi",  "options": ["Auth", "Billing", "Admin"] },
    { "id": "notes", "question": "还有别的要求吗？", "type": "text" }
  ]
}
```
Notes:
- `architecture` is a **Mermaid** string (`graph`, `flowchart`, `sequenceDiagram`, …). Rendered client-side from a vendored bundle (works offline).
- `uiPreviews` render as side-by-side 改动前/改动后 panes, each mockup inside a **sandboxed iframe**: no JavaScript runs, no external resources load, and Tailwind is NOT available inside. Write self-contained HTML using inline styles or a `<style>` tag. Omit `before` for a brand-new component/page (renders as a single 新增 pane). Optional `width` (px, e.g. 375) simulates a mobile viewport; optional `files` chips jump to that file's diff.
- `uiImpact` (top-level string) is ONLY for the case "UI files change but nothing visible changes" — it waives the uiPreviews requirement and must say why.
- `fileChanges` render grouped by directory as expandable rows; `diff` renders as a colored unified diff (LCS, computed in the browser) with per-file `+N -N` counts — just give raw `before`/`after` of the relevant part, not the whole file.
- `fileChanges.action` must be `add` | `modify` | `delete`.
- Question and option `id`s must be unique and stable; answers come back keyed by them.
- A failed POST returns `{"ok":false,"error":"schema errors","details":[...]}` — fix every item in `details` and resend.

## Housekeeping
- The server is a detached daemon that persists across turns for the session.
- Stop it with: `pkill -f visual-plan/server.js`
- Logs: `/tmp/claude-visual-plan/server.log`
- Pushing a new plan clears any not-yet-delivered browser submissions (they applied to the old version).
- Concurrent sessions: port 4517 serves ONE plan. If another Claude session is already using it for a different plan, run everything with `VP_PORT=4518 VP_RUNTIME=/tmp/claude-visual-plan-2` (start.sh and all curl URLs).
