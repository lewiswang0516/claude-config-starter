export const MIN_CJK_SHARE = 0.3;
export const MIN_LANGUAGE_LETTERS = 40;
export const MIN_USER_LATIN_LETTERS = 20;
export const MIN_JEV_CHARS = 80;
export const JEV_BLOCK_CONFIDENCE = 0.85;
export const MAX_BLOCKS_PER_TURN = 2;
export const JEV_TIMEOUT_MS = 8000;
export const LOG_WRITE_TIMEOUT_MS = 5000;
export const USER_MESSAGE_MAX_CHARS = 2000;
export const LOG_RELATIVE_PATH = "/.claude/jev/reply-guard.log";
export const DEFAULT_JEV_RELATIVE_PATH = "/.claude/jev/jev.sh";
export const MAX_QUOTED_SENTENCES = 8;
export const QUOTED_SENTENCE_MAX_CHARS = 200;

const HAN = /\p{Script=Han}/gu;
const LATIN = /\p{Script=Latin}/gu;
const NOT_HUMAN_PROMPT =
  /^\s*(<(task-notification|system-reminder|command-name|command-message|local-command|bash-input|bash-stdout)|\[Request interrupted by user)/;
const REMINDER_BLOCK = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
const FENCED_CODE = /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g;
const QUOTED_SPAN =
  /\u300c[^\u300d]*\u300d|\u201c[^\u201d]*\u201d|"[^"\n]*"|`[^`\n]*`/g;
const SENTENCE_BREAK = /(?<=[\u3002\uff01\uff1f\uff1b])|(?<=[.!?;])\s+|\n+/;

export const JEV_QUESTIONS = {
  pushes_back: {
    type: "choice",
    instructions:
      "Does the reply hand the reader a task the agent could do itself with its own tools (run a command, restart a service, copy files, edit config), instead of a genuine decision, approval, or a step only a human can do (UI click, login, outward-facing action)?",
    criteria: {
      yes: "pushes at least one doable task back to the reader",
      no: "only asks for real decisions or human-only steps, or asks nothing",
    },
  },
};

const FIX_TEXT = {
  language:
    "The user writes in Chinese. Rewrite the whole reply in Chinese. Keep English only inside code, commands, file paths and quoted output.",
  unasked_disclaimer:
    "Delete each quoted sentence. Each one says what you did not do, did not touch, did not run, skipped or left unchanged. The user does not want these lines in a final reply, and that includes checks that did not run and items waiting on the user. Do not rephrase them into another not-done statement: remove them and keep the rest of the reply.",
  pushes_back:
    "The reply hands the reader a task you can do with your own tools, such as running a command, restarting a service, copying files or editing config. Do that task now and report the result. Keep genuine decisions, approvals and human-only steps (UI clicks, logins, outward-facing actions) as questions.",
};

export function stripForLanguage(text) {
  return String(text)
    .replace(/```[\s\S]*?(?:```|$)/g, " ")
    .replace(/~~~[\s\S]*?(?:~~~|$)/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, " ")
    .replace(/[!-~]*\/[!-~]*/g, ' ')
    .replace(
      /\b[\w-]+(?:\.[\w-]+)*\.(?:ts|tsx|js|jsx|mjs|cjs|json|jsonc|md|py|sh|css|html|yml|yaml|toml|sql|txt|log|lock)\b/gi,
      " ",
    );
}

export function cjkShare(text) {
  const cjk = (String(text).match(HAN) || []).length;
  const latin = (String(text).match(LATIN) || []).length;
  const total = cjk + latin;
  return { share: total === 0 ? null : cjk / total, cjk, latin, total };
}

export function hasCjk(text) {
  return (String(text).match(HAN) || []).length > 0;
}

export function visibleLength(text) {
  return Array.from(String(text).replace(/\s+/g, "")).length;
}

export function pickLastUserMessage(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m || m.role !== "user") continue;
    const text = typeof m.text === "string" ? m.text.trim() : "";
    if (text === "" || NOT_HUMAN_PROMPT.test(text)) continue;
    return text.slice(0, USER_MESSAGE_MAX_CHARS);
  }
  return "";
}

export function transcriptMessages(jsonl) {
  const messages = [];
  let badLines = 0;
  for (const line of String(jsonl).split("\n")) {
    if (line.trim() === "") continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      badLines += 1;
      continue;
    }
    if (!entry || (entry.type !== "user" && entry.type !== "assistant"))
      continue;
    if (entry.isMeta === true || entry.isSidechain === true) continue;
    const origin = entry.origin && entry.origin.kind;
    if (entry.type === "user" && origin && origin !== "human") continue;
    const content = entry.message && entry.message.content;
    const parts =
      typeof content === "string"
        ? [content]
        : Array.isArray(content)
          ? content
              .filter((b) => b && b.type === "text" && typeof b.text === "string")
              .map((b) => b.text)
          : [];
    const text = parts
      .map((t) => t.replace(REMINDER_BLOCK, "").trim())
      .filter((t) => t !== "")
      .join("\n");
    messages.push({ role: entry.type, text });
  }
  return { messages, badLines };
}

export function languageCheck({ role, reply, lastUser }) {
  if (role !== "main")
    return { ran: false, skip: "not_main_agent", share: null, block: false };
  if (String(lastUser).trim() === "")
    return { ran: false, skip: "no_user_message", share: null, block: false };
  if (!hasCjk(lastUser) && cjkShare(lastUser).latin >= MIN_USER_LATIN_LETTERS)
    return { ran: false, skip: "user_wrote_english", share: null, block: false };
  const counts = cjkShare(stripForLanguage(reply));
  if (counts.total < MIN_LANGUAGE_LETTERS) {
    return {
      ran: false,
      skip: "too_few_letters",
      share: counts.share,
      block: false,
    };
  }
  return {
    ran: true,
    skip: null,
    share: counts.share,
    block: counts.share < MIN_CJK_SHARE,
  };
}

export function compileDisclaimerCue(cues) {
  const patterns = cues && cues.patterns;
  if (
    !Array.isArray(patterns) ||
    patterns.length === 0 ||
    patterns.some((p) => typeof p !== "string" || p === "")
  )
    throw new Error("disclaimer cues need a non-empty patterns array of strings");
  return new RegExp(patterns.join("|"), "iu");
}

export function disclaimerSentences(reply, cue) {
  return String(reply)
    .replace(FENCED_CODE, "\n")
    .split(SENTENCE_BREAK)
    .map((s) => s.trim())
    .filter((s) => s !== "" && cue.test(s.replace(QUOTED_SPAN, " ")));
}

function clip(sentence) {
  return sentence.length > QUOTED_SENTENCE_MAX_CHARS
    ? sentence.slice(0, QUOTED_SENTENCE_MAX_CHARS) + "..."
    : sentence;
}

function disclaimerLine(sentences) {
  const n = sentences.length;
  const quoted = sentences
    .slice(0, MAX_QUOTED_SENTENCES)
    .map((s) => "  > " + clip(s));
  if (n > MAX_QUOTED_SENTENCES)
    quoted.push("  > (" + (n - MAX_QUOTED_SENTENCES) + " more)");
  return (
    "- unasked_disclaimer (" +
    n +
    (n === 1 ? " sentence" : " sentences") +
    "): " +
    FIX_TEXT.unasked_disclaimer +
    "\n" +
    quoted.join("\n")
  );
}

export function jevState({ reply, lastUser, role }) {
  return { assistant_final_reply: reply, last_user_message: lastUser, role };
}

export function parseJevResult({ exitCode, stdout }) {
  if (exitCode === 3) return { status: "disabled", detail: "jev.sh exit 3" };
  if (exitCode !== 0)
    return { status: "error", detail: "jev.sh exit " + exitCode };
  let body;
  try {
    body = JSON.parse(stdout);
  } catch (err) {
    return {
      status: "bad_json",
      detail: String(err && err.message ? err.message : err).slice(0, 120),
    };
  }
  const answers = {};
  for (const id of Object.keys(JEV_QUESTIONS)) {
    const a = body && body.answers && body.answers[id];
    if (
      !a ||
      typeof a.choice !== "string" ||
      typeof a.confidence !== "number"
    ) {
      return { status: "bad_json", detail: "no usable answer for " + id };
    }
    answers[id] = { choice: a.choice, confidence: a.confidence };
  }
  return { status: "ok", answers };
}

export function jevFindings(answers) {
  const found = [];
  for (const id of Object.keys(JEV_QUESTIONS)) {
    const a = answers[id];
    if (a && a.choice === "yes" && a.confidence >= JEV_BLOCK_CONFIDENCE)
      found.push({ check: id, score: a.confidence });
  }
  return found;
}

export function findingLabel(finding) {
  if (finding.check === "unasked_disclaimer")
    return finding.check + " x" + finding.sentences.length;
  return finding.check + " " + finding.score.toFixed(2);
}

export function blockReason(findings, { role, viaHandback }) {
  const what = role === "main" ? "final reply" : "report";
  const lines = findings.map((f) => {
    if (f.check === "unasked_disclaimer") return disclaimerLine(f.sentences);
    const score =
      f.check === "language"
        ? "CJK share " +
          f.score.toFixed(2) +
          ", below " +
          MIN_CJK_SHARE.toFixed(2)
        : "Jev yes " + f.score.toFixed(2);
    return "- " + f.check + " (" + score + "): " + FIX_TEXT[f.check];
  });
  const resend = viaHandback
    ? "Then call SubagentHandback again with the rewritten report."
    : "Then send the rewritten " + what + " as your answer.";
  return (
    "reply-guard sent this " +
    what +
    " back for a rewrite. Checks that fired:\n" +
    lines.join("\n") +
    "\n" +
    resend
  );
}
