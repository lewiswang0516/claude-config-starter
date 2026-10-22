import { expect, mock, test } from "claude-code/testing";
import { cjkShare, stripForLanguage } from "../hooks/rules.mjs";

const FAKE_JEV = "/fake/jev.sh";
const ZH_USER = "帮我看一下这个 PR 的测试为什么挂了，修好它";
const EN_USER = "Please check why the PR tests fail and fix them";
const EN_REPLY =
  "All tests pass now. I fixed the flaky timeout in the export spec and pushed the change to the branch. The preview deploy is green and the PR is ready for review.";

type JevPlan =
  | {
      kind: "answers";
      unasked_disclaimer: [string, number];
      pushes_back: [string, number];
    }
  | { kind: "disabled" }
  | { kind: "timeout" };

const NO_NO: JevPlan = {
  kind: "answers",
  unasked_disclaimer: ["no", 0.98],
  pushes_back: ["no", 0.97],
};

function setup(
  on: any,
  opts: { user: string; jev?: JevPlan; agentUser?: string },
) {
  const seen = {
    uiLogs: [] as string[],
    logLines: [] as any[],
    jevCalls: [] as any[],
  };
  mock.env(on, { HOME: "/home/tester", REPLY_GUARD_JEV_CMD: FAKE_JEV });
  on("session.messages", ($: any, e: any) => ({
    value: [
      {
        role: "user",
        text: e && e.agentId ? (opts.agentUser ?? opts.user) : opts.user,
        toolUses: [],
      },
      { role: "assistant", text: "working", toolUses: [] },
      {
        role: "user",
        text: "",
        toolUses: [],
        toolResults: [{ tool_use_id: "t1", text: "ok", isError: false }],
      },
    ],
  }));
  on("session.id", () => ({ value: "sess-test" }));
  on("ui.log", ($: any, e: any) => {
    seen.uiLogs.push(e.text);
    return { value: undefined };
  });
  on("process.run", ($: any, e: any) => {
    const argv = e.argv as string[];
    if (argv[0] === "/bin/sh") {
      seen.logLines.push(JSON.parse(String(e.init.stdin).trim()));
      return { value: { exitCode: 0, stdout: "", stderr: "" } };
    }
    if (argv[0] !== FAKE_JEV)
      return { deny: "test refused a real command: " + argv[0] };
    seen.jevCalls.push({
      state: JSON.parse(argv[1]),
      questions: JSON.parse(argv[2]),
      init: e.init,
    });
    const plan = opts.jev ?? NO_NO;
    if (plan.kind === "disabled")
      return {
        value: { exitCode: 3, stdout: '{"jev":"disabled"}', stderr: "" },
      };
    if (plan.kind === "timeout")
      return { deny: "process timed out after 6000 ms" };
    const answer = (pair: [string, number]) => ({
      type: "choice",
      choice: pair[0],
      confidence: pair[1],
    });
    const body = {
      model: "jev-test",
      answers: {
        unasked_disclaimer: answer(plan.unasked_disclaimer),
        pushes_back: answer(plan.pushes_back),
      },
    };
    return { value: { exitCode: 0, stdout: JSON.stringify(body), stderr: "" } };
  });
  on("classic.Stop", () => ({}));
  on("classic.SubagentStop", () => ({}));
  on("tool.call", () => ({ result: "delivered" }));
  return seen;
}

const handback = ($: any, reply: string) =>
  $.tool.call({ tool: "SubagentHandback", message: reply } as any);

const stop = (reply: string) => ({
  session_id: "sess-test",
  prompt_id: "prompt-1",
  stop_hook_active: false,
  last_assistant_message: reply,
});

test("strip keeps prose and drops code, URLs and paths", async () => {
  const stripped = stripForLanguage(
    "看 `foo()` 和 https://x.dev/a 以及 /Users/a/b.ts\n```js\nconst a = 1\n```\n完成",
  );
  expect(stripped).not.toContain("foo");
  expect(stripped).not.toContain("https");
  expect(stripped).not.toContain("/Users");
  expect(stripped).not.toContain("const");
  expect(stripped).toContain("完成");
});

test("cjk share counts CJK against latin letters", async () => {
  const r = cjkShare("中文 ab");
  expect(r.cjk).toBe(2);
  expect(r.latin).toBe(2);
  expect(r.share).toBe(0.5);
});

test("classic Stop and SubagentStop are left to the Stop command hook", async ($, on) => {
  const seen = setup(on, {
    user: ZH_USER,
    jev: {
      kind: "answers",
      unasked_disclaimer: ["yes", 0.99],
      pushes_back: ["yes", 0.99],
    },
  });
  const main = await $.classic.Stop(stop(EN_REPLY));
  const sub = await $.classic.SubagentStop({
    ...stop(EN_REPLY),
    agent_id: "agent-1",
    agent_type: "general-purpose",
  });
  expect(main.block).toBeUndefined();
  expect(sub.block).toBeUndefined();
  expect(seen.logLines.length).toBe(0);
  expect(seen.jevCalls.length).toBe(0);
});

test("an English report from a Chinese session gets no language deny", async ($, on) => {
  const seen = setup(on, { user: ZH_USER, agentUser: ZH_USER });
  const result: any = await handback($, EN_REPLY);
  expect(result.result).toBe("delivered");
  expect(seen.logLines[0].role).toBe("subagent");
  expect(seen.logLines[0].checks).not.toContain("language");
  expect(seen.jevCalls[0].state.role).toBe("subagent");
});

test("Jev yes at 0.9 denies and names the check and confidence", async ($, on) => {
  const seen = setup(on, {
    user: EN_USER,
    jev: {
      kind: "answers",
      unasked_disclaimer: ["no", 0.97],
      pushes_back: ["yes", 0.9],
    },
  });
  const result: any = await handback($, EN_REPLY);
  expect(result.deny).toMatch(/pushes_back \(Jev yes 0\.90\)/);
  expect(seen.uiLogs).toContain("reply-guard: sent back, pushes_back 0.90");
  expect(seen.jevCalls[0].init.timeoutMs).toBeDefined();
  expect(seen.jevCalls[0].state.last_user_message).toBe(EN_USER);
});

test("Jev yes at 0.6 lets the report through", async ($, on) => {
  const seen = setup(on, {
    user: EN_USER,
    jev: {
      kind: "answers",
      unasked_disclaimer: ["yes", 0.6],
      pushes_back: ["yes", 0.6],
    },
  });
  const result: any = await handback($, EN_REPLY);
  expect(result.result).toBe("delivered");
  expect(seen.logLines[0].jev.pushes_back).toEqual({
    choice: "yes",
    confidence: 0.6,
  });
});

test("a subagent report is not checked for disclaimers", async ($, on) => {
  const seen = setup(on, {
    user: EN_USER,
    jev: {
      kind: "answers",
      unasked_disclaimer: ["yes", 0.99],
      pushes_back: ["no", 0.97],
    },
  });
  const result: any = await handback(
    $,
    EN_REPLY + " I left the signup page untouched.",
  );
  expect(result.result).toBe("delivered");
  expect(seen.logLines[0].checks).not.toContain("disclaimer");
  expect(Object.keys(seen.jevCalls[0].questions)).toEqual(["pushes_back"]);
});

test("Jev disabled (exit 3) lets the report through with a ui.log line", async ($, on) => {
  const seen = setup(on, { user: EN_USER, jev: { kind: "disabled" } });
  const result: any = await handback($, EN_REPLY);
  expect(result.result).toBe("delivered");
  expect(seen.uiLogs.some((l) => /skipped/.test(l) && /disabled/.test(l))).toBe(
    true,
  );
});

test("Jev timeout lets the report through with a ui.log line", async ($, on) => {
  const seen = setup(on, { user: EN_USER, jev: { kind: "timeout" } });
  const result: any = await handback($, EN_REPLY);
  expect(result.result).toBe("delivered");
  expect(seen.uiLogs.some((l) => /skipped/.test(l) && /timeout/.test(l))).toBe(
    true,
  );
});

test("the third deny for one subagent goes through with a log line", async ($, on) => {
  const seen = setup(on, {
    user: EN_USER,
    jev: {
      kind: "answers",
      unasked_disclaimer: ["no", 0.9],
      pushes_back: ["yes", 0.95],
    },
  });
  const first: any = await handback($, EN_REPLY);
  const second: any = await handback($, EN_REPLY);
  const third: any = await handback($, EN_REPLY);
  expect(first.deny).toMatch(/pushes_back/);
  expect(second.deny).toMatch(/pushes_back/);
  expect(third.result).toBe("delivered");
  expect(seen.uiLogs.some((l) => /cap/.test(l))).toBe(true);
});

test("the decision log carries the length, never the report text", async ($, on) => {
  const seen = setup(on, { user: EN_USER });
  await handback($, EN_REPLY);
  const line = seen.logLines[0];
  expect(line.reply_length).toBe(EN_REPLY.length);
  expect(JSON.stringify(line)).not.toContain("flaky timeout");
  expect(line.session_id).toBe("sess-test");
  expect(line.event).toBe("tool.call:SubagentHandback");
});

test("a short report skips Jev", async ($, on) => {
  const seen = setup(on, { user: EN_USER });
  const result: any = await handback($, "Done.");
  expect(result.result).toBe("delivered");
  expect(seen.jevCalls.length).toBe(0);
});

test("a SubagentHandback report that pushes work back is denied", async ($, on) => {
  const seen = setup(on, {
    user: EN_USER,
    jev: {
      kind: "answers",
      unasked_disclaimer: ["no", 0.9],
      pushes_back: ["yes", 0.92],
    },
  });
  const result: any = await handback($, EN_REPLY);
  expect(result.deny).toMatch(/pushes_back \(Jev yes 0\.92\)/);
  expect(result.deny).toMatch(/SubagentHandback again/);
  expect(seen.logLines[0].event).toBe("tool.call:SubagentHandback");
});

test("a clean SubagentHandback report goes through", async ($, on) => {
  setup(on, { user: EN_USER });
  const result: any = await handback($, EN_REPLY);
  expect(result.result).toBe("delivered");
});
