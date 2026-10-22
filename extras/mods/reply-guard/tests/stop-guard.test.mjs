import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  JEV_QUESTIONS,
  compileDisclaimerCue,
  disclaimerSentences,
  languageCheck,
  pickLastUserMessage,
  transcriptMessages,
} from "../hooks/rules.mjs";

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "hooks",
  "stop-guard.mjs",
);
const HERE = dirname(fileURLToPath(import.meta.url));
const CASES = JSON.parse(
  readFileSync(join(HERE, "disclaimer-cases.json"), "utf8"),
);
const CUE = compileDisclaimerCue(
  JSON.parse(
    readFileSync(join(HERE, "..", "hooks", "disclaimer-cues.json"), "utf8"),
  ),
);

const ZH_USER = "帮我看一下这个 PR 的测试为什么挂了，修好它";
const EN_USER = "Please check why the PR tests fail and fix them";
const EN_REPLY =
  "All tests pass now. I fixed the flaky timeout in the export spec and pushed the change to the branch. The preview deploy is green and the PR is ready for review.";
const ZH_REPLY_WITH_CODE =
  "测试已经全部通过。问题出在 `exportZip` 的超时设置，`EXPORT_TIMEOUT_MS` 原来是 `5000`，改成 `15000` 之后 `export.spec.ts` 稳定通过。改动在 `packages/storage/src/export.ts`，已经推到分支，预览环境也是绿的，可以开始评审了。";

const human = (content) => ({
  type: "user",
  origin: { kind: "human" },
  message: { role: "user", content },
});
const toolResult = () => ({
  type: "user",
  toolUseResult: { stdout: "ok" },
  message: {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }],
  },
});
const assistant = (text) => ({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "text", text }] },
});

const answers = (ud, pb) =>
  "cat <<'EOF'\n" +
  JSON.stringify({
    model: "jev-test",
    answers: {
      unasked_disclaimer: { type: "choice", choice: ud[0], confidence: ud[1] },
      pushes_back: { type: "choice", choice: pb[0], confidence: pb[1] },
    },
  }) +
  "\nEOF\n";
const NO_NO = answers(["no", 0.98], ["no", 0.97]);

function run({
  user,
  reply,
  input = {},
  raw,
  transcript,
  jev = NO_NO,
  env = {},
}) {
  const home = mkdtempSync(join(tmpdir(), "stop-guard-"));
  mkdirSync(join(home, ".claude", "jev"), { recursive: true });
  const transcriptPath = join(home, "transcript.jsonl");
  const entries = transcript ?? [
    human(user),
    assistant("working"),
    toolResult(),
  ];
  writeFileSync(
    transcriptPath,
    entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
  const statePath = join(home, "jev-state.json");
  const jevPath = join(home, "jev.sh");
  writeFileSync(
    jevPath,
    "#!/bin/sh\nprintf '%s' \"$1\" > '" + statePath + "'\n" + jev,
    { mode: 0o755 },
  );
  const stdin =
    raw ??
    JSON.stringify({
      session_id: "sess-test",
      transcript_path: transcriptPath,
      cwd: home,
      hook_event_name: "Stop",
      stop_hook_active: false,
      last_assistant_message: reply,
      ...input,
    });
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT], {
      env: {
        ...process.env,
        HOME: home,
        REPLY_GUARD_JEV_CMD: jevPath,
        ...env,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => {
      const logPath = join(home, ".claude", "jev", "reply-guard.log");
      const logLines = existsSync(logPath)
        ? readFileSync(logPath, "utf8")
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((l) => JSON.parse(l))
        : [];
      resolve({
        code,
        stdout,
        stderr,
        out: stdout.trim() === "" ? null : JSON.parse(stdout),
        logLines,
        jevState: existsSync(statePath)
          ? JSON.parse(readFileSync(statePath, "utf8"))
          : null,
        elapsed: Date.now() - started,
      });
    });
    child.stdin.end(stdin);
  });
}

test("English reply after the user typed `retry` is blocked for language", async () => {
  const r = await run({ user: "retry", reply: EN_REPLY });
  assert.equal(r.code, 0);
  assert.equal(r.out.decision, "block");
  assert.match(r.out.reason, /language/);
  assert.match(r.out.reason, /Chinese/);
  assert.equal(r.logLines.length, 1);
  const line = r.logLines[0];
  assert.equal(line.decision, "block");
  assert.equal(line.source, "stop-command");
  assert.equal(line.role, "main");
  assert.equal(line.session_id, "sess-test");
  assert.equal(line.reply_length, EN_REPLY.length);
  assert.ok(line.checks.includes("language"));
  assert.ok(!JSON.stringify(line).includes("flaky timeout"));
});

test("English reply after a 25+ letter English user message passes", async () => {
  const r = await run({ user: EN_USER, reply: EN_REPLY });
  assert.equal(r.code, 0);
  assert.equal(r.out?.decision, undefined);
  assert.equal(r.logLines[0].decision, "pass");
  assert.ok(!r.logLines[0].checks.includes("language"));
  assert.equal(r.jevState.last_user_message, EN_USER);
  assert.equal(r.jevState.role, "main");
});

test("Chinese reply with many backticked identifiers passes", async () => {
  const r = await run({ user: ZH_USER, reply: ZH_REPLY_WITH_CODE });
  assert.equal(r.code, 0);
  assert.equal(r.out?.decision, undefined);
  assert.equal(r.logLines[0].decision, "pass");
  assert.equal(r.logLines[0].cjk_share, 1);
});

test("stop_hook_active passes without calling Jev", async () => {
  const r = await run({
    user: ZH_USER,
    reply: EN_REPLY,
    input: { stop_hook_active: true },
    jev: answers(["yes", 0.99], ["yes", 0.99]),
  });
  assert.equal(r.code, 0);
  assert.equal(r.out?.decision, undefined);
  assert.equal(r.jevState, null);
  assert.equal(r.logLines[0].decision, "pass");
  assert.match(r.logLines[0].reason, /stop_hook_active/);
});

test("Jev yes at 0.9 blocks and names the check and confidence", async () => {
  const r = await run({
    user: EN_USER,
    reply: EN_REPLY,
    jev: answers(["no", 0.97], ["yes", 0.9]),
  });
  assert.equal(r.out.decision, "block");
  assert.match(r.out.reason, /pushes_back \(Jev yes 0\.90\)/);
  assert.equal(r.logLines[0].reason, "pushes_back 0.90");
  assert.deepEqual(r.logLines[0].jev.pushes_back, {
    choice: "yes",
    confidence: 0.9,
  });
});

test("Jev is asked only about pushing work back", () => {
  assert.deepEqual(Object.keys(JEV_QUESTIONS), ["pushes_back"]);
});

test("a Jev yes on unasked_disclaimer no longer blocks", async () => {
  const r = await run({
    user: ZH_USER,
    reply: ZH_REPLY_WITH_CODE,
    jev: answers(["yes", 0.99], ["no", 0.97]),
  });
  assert.equal(r.out?.decision, undefined);
  assert.equal(r.logLines[0].decision, "pass");
  assert.equal(r.logLines[0].jev.unasked_disclaimer, undefined);
});

test("a reply that says it left something untouched is blocked and quotes the sentence", async () => {
  const c = CASES.untouched;
  const r = await run({ user: ZH_USER, reply: c.reply });
  assert.equal(r.out.decision, "block");
  assert.match(r.out.reason, /unasked_disclaimer \(1 sentence\)/);
  assert.ok(r.out.reason.includes("> " + c.flagged[0]));
  assert.ok(!r.out.reason.includes(c.kept));
  const line = r.logLines[0];
  assert.equal(line.decision, "block");
  assert.equal(line.reason, "unasked_disclaimer x1");
  assert.equal(line.disclaimer_count, 1);
  assert.ok(line.checks.includes("disclaimer"));
  assert.ok(!JSON.stringify(line).includes(c.flagged[0]));
});

test("checks not run and items waiting on the user are blocked too", async () => {
  const c = CASES.notRunAndWaiting;
  const r = await run({ user: ZH_USER, reply: c.reply });
  assert.equal(r.out.decision, "block");
  assert.match(r.out.reason, /unasked_disclaimer \(2 sentences\)/);
  for (const s of c.flagged) assert.ok(r.out.reason.includes("> " + s), s);
  assert.equal(r.logLines[0].disclaimer_count, 2);
});

test("a short reply is still checked for disclaimers", async () => {
  const r = await run({ user: ZH_USER, reply: CASES.short.reply });
  assert.equal(r.out.decision, "block");
  assert.equal(r.logLines[0].jev_status, "skipped_short_reply");
  assert.equal(r.logLines[0].disclaimer_count, 1);
});

test("cue words inside quotes or code do not count", async () => {
  const r = await run({ user: ZH_USER, reply: CASES.quotedCues.reply });
  assert.equal(r.out?.decision, undefined);
  assert.equal(r.logLines[0].disclaimer_count, 0);
});

test("a failed run, test counts and value ranges are not disclaimers", async () => {
  const r = await run({ user: ZH_USER, reply: CASES.notDisclaimers.reply });
  assert.equal(r.out?.decision, undefined);
  assert.equal(r.logLines[0].disclaimer_count, 0);
});

test("a missing cue file passes with a visible message", async () => {
  const r = await run({
    user: ZH_USER,
    reply: CASES.untouched.reply,
    env: { REPLY_GUARD_CUES: "/nonexistent/cues.json" },
  });
  assert.equal(r.out.decision, undefined);
  assert.match(r.out.systemMessage, /disclaimer check skipped/);
  assert.equal(r.logLines[0].disclaimer_count, null);
});

test("disclaimerSentences catches every sentence Lewis labeled on 2026-10-05", () => {
  for (const s of CASES.labeled)
    assert.deepEqual(disclaimerSentences(s, CUE), [s], s);
});

test("disclaimerSentences catches the English forms", () => {
  for (const s of CASES.english)
    assert.deepEqual(disclaimerSentences(s, CUE), [s], s);
});

test("Jev yes at 0.6 passes", async () => {
  const r = await run({
    user: EN_USER,
    reply: EN_REPLY,
    jev: answers(["yes", 0.6], ["yes", 0.6]),
  });
  assert.equal(r.out?.decision, undefined);
  assert.equal(r.logLines[0].decision, "pass");
  assert.equal(r.logLines[0].jev_status, "ok");
});

test("Jev disabled (exit 3) passes with a visible message", async () => {
  const r = await run({
    user: EN_USER,
    reply: EN_REPLY,
    jev: 'echo \'{"jev":"disabled"}\'\nexit 3\n',
  });
  assert.equal(r.code, 0);
  assert.equal(r.out.decision, undefined);
  assert.match(r.out.systemMessage, /reply-guard/);
  assert.match(r.out.systemMessage, /disabled/);
  assert.equal(r.logLines[0].jev_status, "disabled");
  assert.equal(r.logLines[0].decision, "pass");
});

test("Jev that hangs past the timeout passes with a visible message", async () => {
  const r = await run({
    user: EN_USER,
    reply: EN_REPLY,
    jev: "sleep 60\necho late\n",
  });
  assert.equal(r.code, 0);
  assert.equal(r.out.decision, undefined);
  assert.match(r.out.systemMessage, /timeout/);
  assert.equal(r.logLines[0].jev_status, "timeout");
  assert.ok(r.elapsed < 11000, "took " + r.elapsed + " ms");
});

test("malformed stdin passes with a visible message", async () => {
  const r = await run({ raw: "{not json" });
  assert.equal(r.code, 0);
  assert.equal(r.out.decision, undefined);
  assert.match(r.out.systemMessage, /reply-guard/);
  assert.match(r.out.systemMessage, /stdin/);
  assert.equal(r.logLines[0].decision, "pass");
  assert.equal(r.logLines[0].source, "stop-command");
});

test("an unreadable transcript skips the language check with a visible message", async () => {
  const r = await run({
    user: "retry",
    reply: EN_REPLY,
    input: { transcript_path: "/nonexistent/transcript.jsonl" },
  });
  assert.equal(r.code, 0);
  assert.equal(r.out.decision, undefined);
  assert.match(r.out.systemMessage, /transcript/);
  assert.equal(r.logLines[0].decision, "pass");
  assert.ok(!r.logLines[0].checks.includes("language"));
});

test("the last real user message skips tool results, notifications, meta and reminders", async () => {
  const r = await run({
    reply: EN_REPLY,
    transcript: [
      human(EN_USER),
      assistant("ok"),
      human("重试"),
      assistant("working"),
      toolResult(),
      {
        type: "user",
        origin: { kind: "task-notification" },
        message: {
          role: "user",
          content:
            "<task-notification>\n<task-id>a1</task-id>\nThe agent finished with a long English summary of the work it did</task-notification>",
        },
      },
      {
        type: "user",
        isMeta: true,
        message: {
          role: "user",
          content:
            "Caveat: the messages below were generated by local commands",
        },
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [{ type: "text", text: "[Request interrupted by user]" }],
        },
      },
      human([
        {
          type: "text",
          text: "<system-reminder>\nThe conversation continues in the desktop app with a lot of English guidance text\n</system-reminder>",
        },
      ]),
    ],
  });
  assert.equal(r.out.decision, "block");
  assert.match(r.out.reason, /language/);
  assert.equal(r.jevState.last_user_message, "重试");
});

test("a reminder block before real text keeps the real text", () => {
  const jsonl = [
    human([
      { type: "text", text: "<system-reminder>\nguidance\n</system-reminder>" },
      { type: "text", text: "继续" },
    ]),
  ]
    .map((e) => JSON.stringify(e))
    .join("\n");
  assert.equal(pickLastUserMessage(transcriptMessages(jsonl).messages), "继续");
});

test("the user message sent to Jev is cut to 2000 characters", async () => {
  const long = "Please look at this. ".repeat(200);
  const r = await run({ user: long, reply: EN_REPLY });
  assert.equal(r.jevState.last_user_message.length, 2000);
});

test("language check runs for short English and skips long English or no user text", () => {
  const check = (lastUser) =>
    languageCheck({ role: "main", reply: EN_REPLY, lastUser });
  assert.equal(check("retry").block, true);
  assert.equal(check("1").block, true);
  assert.equal(check("push and open PR").block, true);
  assert.equal(check(EN_USER).skip, "user_wrote_english");
  assert.equal(check("").skip, "no_user_message");
  assert.equal(check(ZH_USER).block, true);
});
