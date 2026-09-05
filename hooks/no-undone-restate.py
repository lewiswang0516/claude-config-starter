#!/usr/bin/env python3
"""Stop hook: block a Chinese closeout that describes work not done, hands work back, or repeats earlier points.

Patterns and the reason text live in zh/no-undone-restate.json next to this file.
Honest blocker reports are allowed on purpose: the user's rules require them to be stated once.
"""

import json
import os
import re
import sys

PATTERN_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "zh", "no-undone-restate.json")

FENCED_CODE = re.compile(r"```.*?```", re.DOTALL)
INLINE_CODE = re.compile(r"`[^`\n]*`")
BLOCKQUOTE = re.compile(r"^[ \t]*>.*$", re.MULTILINE)
URL = re.compile(r"(?:https?://|www\.)\S+")
# Quoted spans: CJK double quotes (U+201C/U+201D), corner brackets (U+300C/U+300D), ASCII double quotes.
QUOTED = re.compile("\u201c[^\u201d\n]*\u201d|\u300c[^\u300d\n]*\u300d|\"[^\"\n]*\"")


def load_rules():
    with open(PATTERN_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    patterns = [(p["label"], re.compile(p["regex"])) for p in data["patterns"]]
    return patterns, data["reason"]


def last_assistant_text(transcript_path):
    text = None
    with open(transcript_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(entry, dict) or entry.get("type") != "assistant":
                continue
            content = (entry.get("message") or {}).get("content")
            if not isinstance(content, list):
                continue
            parts = [
                b.get("text", "")
                for b in content
                if isinstance(b, dict) and b.get("type") == "text"
            ]
            text = "".join(parts)
    return text


def strip_noise(text):
    text = FENCED_CODE.sub(" ", text)
    text = INLINE_CODE.sub(" ", text)
    text = BLOCKQUOTE.sub(" ", text)
    text = URL.sub(" ", text)
    text = QUOTED.sub(" ", text)
    return text


def find_hits(text, patterns):
    hits = []
    for label, pattern in patterns:
        match = pattern.search(text)
        if match:
            hits.append("{} <{}>".format(label, match.group(0)))
    return hits


def main():
    try:
        payload = json.load(sys.stdin)
        if payload.get("stop_hook_active"):
            return 0
        text = payload.get("last_assistant_message")
        if not text:
            transcript_path = payload.get("transcript_path")
            if not transcript_path:
                return 0
            text = last_assistant_text(transcript_path)
        if not text:
            return 0
        patterns, reason = load_rules()
        hits = find_hits(strip_noise(text), patterns)
        if not hits:
            return 0
        out = {
            "decision": "block",
            "reason": reason.format(hits="; ".join(hits)),
        }
        print(json.dumps(out, ensure_ascii=False))
        return 0
    except Exception as exc:
        # Never block because of our own failure.
        print("no-undone-restate: skipped ({}: {})".format(type(exc).__name__, exc), file=sys.stderr)
        return 0


if __name__ == "__main__":
    sys.exit(main())
