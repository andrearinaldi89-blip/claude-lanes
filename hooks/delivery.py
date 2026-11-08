#!/usr/bin/env python3
"""The delivery gate: a rule of "How to work" that does not depend on memory.

Stop hook of the plugin (hooks/hooks.json). It acts only in a lane's clone (a folder
under `<root>/<clones>/` of `.claude/metodo.json`), and only when the session's last
message is a delivery: it starts with "Delivery of" (the Italian "Consegna del" and
"Consegna della" are also recognized). Then it checks two things, and if one is missing
it does not let the turn end (exit 2, the reason on stderr reaches the session):

1. after the last file change the `delivery-check` sub-agent has run
   (METHOD.md, "writing code"): the transcript has a Task/Agent call whose
   `subagent_type` names it (also the old name `controllo-consegna`), after the last
   Edit/Write/MultiEdit;
2. the "Done" is written: `<blocks>/*.md` or the corrections file changed with respect to
   `origin/main`, and the added lines are not just the template placeholder.

Everything else (runs, mutations, real outputs) is left to `delivery-check` and to the
reviewer: here only the one who delivers without having called them is stopped.
"""
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from config import doc_paths, find_config  # noqa: E402

PLACEHOLDERS = ("TO FILL", "lo scrive la sessione di codice")
SUBAGENTS = ("delivery-check", "controllo-consegna")
DELIVERY = re.compile(r"\s*\**\s*(Delivery of|Consegna dell?a?)\b")


def in_a_clone(cwd, cfg):
    main_folder = os.path.realpath(os.path.expanduser(cfg.get("root", "")))
    clones = os.path.join(main_folder, cfg.get("clones", ""))
    real = os.path.realpath(cwd)
    return cfg.get("clones") and real.startswith(clones + os.sep)


def git(cwd, *args):
    r = subprocess.run(["git", "-C", cwd, *args], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None


def events(transcript):
    """The transcript events that matter, in order: ('text', str) and ('tool', name, input)."""
    out = []
    try:
        with open(transcript) as f:
            lines = f.readlines()
    except OSError:
        return out
    for line in lines:
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if e.get("type") != "assistant":
            continue
        content = (e.get("message") or {}).get("content") or []
        if isinstance(content, str):
            out.append(("text", content))
            continue
        for block in content:
            if block.get("type") == "text" and block.get("text", "").strip():
                out.append(("text", block["text"]))
            elif block.get("type") == "tool_use":
                out.append(("tool", block.get("name", ""), block.get("input") or {}))
    return out


def is_delivery(text):
    return DELIVERY.match(text or "") is not None


def check_after_last_change(ev):
    last_change = -1
    last_check = -1
    for i, e in enumerate(ev):
        if e[0] != "tool":
            continue
        name, tool_input = e[1], e[2]
        if name in ("Edit", "Write", "MultiEdit", "NotebookEdit"):
            last_change = i
        elif name in ("Task", "Agent") and any(s in str(tool_input.get("subagent_type", "")) for s in SUBAGENTS):
            last_check = i
    return last_check > last_change


def done_written(cwd, cfg):
    base = None
    for ref in ("origin/main", "main"):
        if git(cwd, "rev-parse", "--verify", "-q", ref) is not None:
            base = ref
            break
    if base is None:
        return True  # without a main to compare with, no judgment
    paths = list(doc_paths(cwd, cfg))
    diff = git(cwd, "diff", base, "--", *paths) or ""
    added = [r[1:] for r in diff.splitlines() if r.startswith("+") and not r.startswith("+++")]
    # A document not yet tracked (a block just opened) counts in full.
    new = (git(cwd, "ls-files", "--others", "--exclude-standard", "--", *paths) or "").split()
    for f in new:
        try:
            with open(os.path.join(cwd, f)) as text:
                added.extend(text.read().splitlines())
        except OSError:
            pass
    substance = [r for r in added if r.strip() and not any(p in r for p in PLACEHOLDERS)]
    return len(substance) > 0


def main():
    try:
        data = json.load(sys.stdin)
    except ValueError:
        return
    cwd = data.get("cwd") or os.getcwd()
    found = find_config(cwd)
    if not found or not in_a_clone(cwd, found[1]):
        return
    cfg = found[1]
    ev = events(data.get("transcript_path", ""))
    texts = [e[1] for e in ev if e[0] == "text"]
    if not texts or not is_delivery(texts[-1]):
        return
    missing = []
    if not check_after_last_change(ev):
        missing.append("the `delivery-check` sub-agent (metodo:delivery-check) has not run after the last "
                       "file change: launch it with the section, the starting commit and the folder, fix "
                       "what it finds and put its answer in the report")
    if not done_written(cwd, cfg):
        blocks, corrections = doc_paths(cwd, cfg)
        missing.append(f'the "Done" is not written under the block\'s section ({blocks}/) or the correction\'s '
                       f"({corrections}): the real output of every run and every mutation")
    if missing:
        print('The delivery does not go out (the method\'s delivery hook, METHOD.md "writing code"):\n- '
              + "\n- ".join(missing) + "\nThen send the report again.", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
