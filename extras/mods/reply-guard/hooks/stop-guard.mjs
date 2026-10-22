import { spawn } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_JEV_RELATIVE_PATH,
  JEV_QUESTIONS,
  JEV_TIMEOUT_MS,
  LOG_RELATIVE_PATH,
  MIN_JEV_CHARS,
  blockReason,
  compileDisclaimerCue,
  disclaimerSentences,
  findingLabel,
  jevFindings,
  jevState,
  languageCheck,
  parseJevResult,
  pickLastUserMessage,
  transcriptMessages,
  visibleLength,
} from "./rules.mjs";

function errorText(err) {
  return String(err && err.message ? err.message : err).slice(0, 160);
}

function loadDisclaimerCue() {
  const path =
    process.env.REPLY_GUARD_CUES ||
    fileURLToPath(new URL("./disclaimer-cues.json", import.meta.url));
  return compileDisclaimerCue(JSON.parse(readFileSync(path, "utf8")));
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function askJev(cmd, state) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    let child;
    try {
      child = spawn(cmd, [JSON.stringify(state), JSON.stringify(JEV_QUESTIONS)], {
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      settle({ status: "error", detail: errorText(err) });
      return;
    }
    timer = setTimeout(() => {
      let detail = "no answer after " + JEV_TIMEOUT_MS + " ms";
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (err) {
        detail += ", kill failed: " + errorText(err);
      }
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      settle({ status: "timeout", detail });
    }, JEV_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (err) => settle({ status: "error", detail: errorText(err) }));
    child.on("close", (code) => {
      const result = parseJevResult({ exitCode: code ?? -1, stdout });
      if (result.status === "error" && stderr.trim() !== "")
        result.detail += ", " + stderr.trim().slice(0, 120);
      settle(result);
    });
  });
}

async function decide(record, notes, home) {
  let input;
  try {
    input = JSON.parse(await readStdin());
    if (!input || typeof input !== "object") throw new Error("not a JSON object");
  } catch (err) {
    record.reason = "bad stdin";
    notes.push(
      "could not read the Stop hook input on stdin (" +
        errorText(err) +
        "), reply passed",
    );
    return {};
  }
  record.session_id = input.session_id ?? null;
  record.agent_type = input.agent_type ?? null;
  if (input.stop_hook_active === true) {
    record.reason = "stop_hook_active";
    return {};
  }

  const reply =
    typeof input.last_assistant_message === "string"
      ? input.last_assistant_message
      : "";
  record.reply_length = reply.length;

  let lastUser = "";
  try {
    const { messages, badLines } = transcriptMessages(
      readFileSync(input.transcript_path, "utf8"),
    );
    lastUser = pickLastUserMessage(messages);
    if (badLines > 0)
      notes.push(badLines + " transcript line(s) were not valid JSON and were skipped");
    if (lastUser === "")
      notes.push("no user message found in the transcript, language check skipped");
  } catch (err) {
    notes.push(
      "could not read the transcript (" + errorText(err) + "), language check skipped",
    );
  }

  const findings = [];
  const lang = languageCheck({ role: "main", reply, lastUser });
  record.cjk_share = lang.share;
  if (lang.ran) record.checks.push("language");
  if (lang.block) findings.push({ check: "language", score: lang.share });

  try {
    const sentences = disclaimerSentences(reply, loadDisclaimerCue());
    record.checks.push("disclaimer");
    record.disclaimer_count = sentences.length;
    if (sentences.length > 0)
      findings.push({ check: "unasked_disclaimer", sentences });
  } catch (err) {
    notes.push(
      "disclaimer check skipped (" + errorText(err) + "), reply passed that check",
    );
  }

  if (visibleLength(reply) < MIN_JEV_CHARS) {
    record.jev_status = "skipped_short_reply";
  } else {
    record.checks.push("jev");
    const cmd =
      process.env.REPLY_GUARD_JEV_CMD ||
      (home ? home + DEFAULT_JEV_RELATIVE_PATH : "");
    const jev = cmd
      ? await askJev(cmd, jevState({ reply, lastUser, role: "main" }))
      : { status: "error", detail: "HOME is not set, so jev.sh cannot be found" };
    record.jev_status = jev.status;
    if (jev.status === "ok") {
      record.jev = jev.answers;
      findings.push(...jevFindings(jev.answers));
    } else {
      notes.push(
        "Jev check skipped (" + jev.status + ": " + jev.detail + "), reply passed that check",
      );
    }
  }

  if (findings.length === 0) {
    record.reason = "no check fired";
    return {};
  }
  const labels = findings.map(findingLabel).join(", ");
  record.decision = "block";
  record.reason = labels;
  notes.push("sent back, " + labels);
  return {
    decision: "block",
    reason: blockReason(findings, { role: "main", viaHandback: false }),
  };
}

function appendLog(home, record, notes) {
  if (!home) {
    notes.push("decision log not written, HOME is not set");
    return;
  }
  try {
    appendFileSync(home + LOG_RELATIVE_PATH, JSON.stringify(record) + "\n");
  } catch (err) {
    notes.push("decision log write failed, " + errorText(err));
  }
}

async function main() {
  const home = process.env.HOME || "";
  const notes = [];
  const record = {
    time: new Date().toISOString(),
    session_id: null,
    event: "Stop",
    agent_id: null,
    agent_type: null,
    role: "main",
    checks: [],
    jev: null,
    jev_status: null,
    cjk_share: null,
    disclaimer_count: null,
    reply_length: 0,
    decision: "pass",
    reason: "",
    source: "stop-command",
  };
  let output;
  try {
    output = await decide(record, notes, home);
  } catch (err) {
    record.decision = "pass";
    record.reason = "error: " + errorText(err);
    notes.push("guard skipped (" + errorText(err) + "), reply passed");
    output = {};
  }
  appendLog(home, record, notes);
  if (notes.length > 0)
    output.systemMessage = notes.map((n) => "reply-guard: " + n).join("\n");
  const text = Object.keys(output).length > 0 ? JSON.stringify(output) : "";
  process.stdout.write(text, () => process.exit(0));
}

main();
