import {
  DEFAULT_JEV_RELATIVE_PATH,
  JEV_QUESTIONS,
  JEV_TIMEOUT_MS,
  LOG_RELATIVE_PATH,
  LOG_WRITE_TIMEOUT_MS,
  MAX_BLOCKS_PER_TURN,
  MIN_JEV_CHARS,
  blockReason,
  findingLabel,
  jevFindings,
  jevState,
  languageCheck,
  parseJevResult,
  pickLastUserMessage,
  visibleLength,
} from "./rules.mjs";

const blockCounts = new Map();

async function readMessages($, agentId) {
  return agentId ? $.session.messages({ agentId }) : $.session.messages();
}

async function askJev($, home, state) {
  const override = await $.env.get("REPLY_GUARD_JEV_CMD");
  const cmd = override || (home ? home + DEFAULT_JEV_RELATIVE_PATH : "");
  if (!cmd)
    return {
      status: "error",
      detail: "HOME is not set, so jev.sh cannot be found",
    };
  try {
    const out = await $.process.run(
      [cmd, JSON.stringify(state), JSON.stringify(JEV_QUESTIONS)],
      {
        timeoutMs: JEV_TIMEOUT_MS,
      },
    );
    return parseJevResult(out);
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    return {
      status: /time/i.test(message) ? "timeout" : "error",
      detail: message.slice(0, 160),
    };
  }
}

async function appendLog($, home, record) {
  if (!home) {
    $.ui.log("reply-guard: decision log not written, HOME is not set");
    return;
  }
  try {
    const out = await $.process.run(
      ["/bin/sh", "-c", 'cat >> "$1"', "reply-guard", home + LOG_RELATIVE_PATH],
      {
        stdin: JSON.stringify(record) + "\n",
        timeoutMs: LOG_WRITE_TIMEOUT_MS,
      },
    );
    if (out.exitCode !== 0)
      $.ui.log("reply-guard: decision log write failed, exit " + out.exitCode);
  } catch (err) {
    $.ui.log(
      "reply-guard: decision log write failed, " +
        String(err && err.message ? err.message : err),
    );
  }
}

async function guard($, ctx) {
  const home = await $.env.get("HOME");
  const record = {
    time: new Date().toISOString(),
    session_id: ctx.sessionId,
    event: ctx.event,
    agent_id: ctx.agentId || null,
    agent_type: ctx.agentType ?? null,
    role: ctx.role,
    checks: [],
    jev: null,
    jev_status: null,
    cjk_share: null,
    reply_length: 0,
    decision: "pass",
    reason: "",
  };
  const finish = async (block) => {
    await appendLog($, home, record);
    return { block };
  };

  const countKey = [
    ctx.sessionId,
    ctx.agentId || "main",
    ctx.turnKey || "",
  ].join("|");
  const blocksSoFar = blockCounts.get(countKey) || 0;
  if (blocksSoFar >= MAX_BLOCKS_PER_TURN) {
    record.reason = "block cap reached (" + MAX_BLOCKS_PER_TURN + ")";
    $.ui.log(
      "reply-guard: block cap of " +
        MAX_BLOCKS_PER_TURN +
        " reached for this turn, reply passed",
    );
    return finish(undefined);
  }

  let messages = null;
  try {
    messages = await readMessages($, ctx.agentId);
  } catch (err) {
    $.ui.log(
      "reply-guard: could not read the conversation, " +
        String(err && err.message ? err.message : err),
    );
  }
  const reply = ctx.reply;
  const lastUser = messages ? pickLastUserMessage(messages) : "";
  record.reply_length = reply.length;

  const findings = [];
  const lang = languageCheck({ role: ctx.role, reply, lastUser });
  record.cjk_share = lang.share;
  if (lang.ran) record.checks.push("language");
  if (lang.block) findings.push({ check: "language", score: lang.share });

  if (visibleLength(reply) < MIN_JEV_CHARS) {
    record.jev_status = "skipped_short_reply";
  } else {
    record.checks.push("jev");
    const jev = await askJev(
      $,
      home,
      jevState({ reply, lastUser, role: ctx.role }),
    );
    record.jev_status = jev.status;
    if (jev.status === "ok") {
      record.jev = jev.answers;
      findings.push(...jevFindings(jev.answers));
    } else {
      $.ui.log(
        "reply-guard: Jev check skipped (" +
          jev.status +
          ": " +
          jev.detail +
          "), reply passed that check",
      );
    }
  }

  if (findings.length === 0) {
    record.reason = "no check fired";
    return finish(undefined);
  }
  blockCounts.set(countKey, blocksSoFar + 1);
  const labels = findings.map(findingLabel).join(", ");
  record.decision = "block";
  record.reason = labels;
  $.ui.log("reply-guard: sent back, " + labels);
  return finish(
    blockReason(findings, {
      role: ctx.role,
      viaHandback: ctx.viaHandback === true,
    }),
  );
}

function failOpen($, e, next) {
  $.ui.log(
    "reply-guard: guard skipped (" +
      next.error.kind +
      ": " +
      next.error.message +
      "), reply passed",
  );
  return next(e);
}

export function register(on) {
  on("tool.call", { tool: "SubagentHandback" }, async ($, e, next) => {
    const verdict = await guard($, {
      event: "tool.call:SubagentHandback",
      role: "subagent",
      sessionId: await $.session.id(),
      agentId: e.agentId,
      agentType: undefined,
      turnKey: "handback",
      reply: typeof e.message === "string" ? e.message : "",
      viaHandback: true,
    });
    return verdict.block ? { deny: verdict.block } : next(e);
  }).catch(failOpen);
}
