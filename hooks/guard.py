#!/usr/bin/env python3
"""The method's rules that must not depend on anyone's memory.

PreToolUse hook of the plugin (hooks/hooks.json). It acts only in a project that uses
the method, where going up from the folder there is `.claude/metodo.json`, and takes
from there what to protect. It reads the call from stdin; to block it, it exits with 2
and writes the reason on stderr, which reaches the session.

1. A file already on main in a protected folder (`protected.folders`, typically the
   database migrations) is not modified. On main means applied in production or about
   to be; a new one that exists only on the lane's branch can be edited.
2. A `docker compose` that deletes volumes must name its project, and the project must
   not be a protected stack (`protected.stacks`): without a name, `down -v` run from the
   repository folder deletes the development database.
3. A protected volume (`protected.volumes`) is not deleted, `prune -a` is not run (it
   also takes other projects' images, and with `--volumes` the development database of
   a stopped stack), and an image is not removed with `-f`.
4. A release command (`release`, regular expressions) starts only from the main folder,
   on main, and the owner confirms it: there it asks for confirmation even from a session
   that would not ask, elsewhere it blocks. A command is recognized also after `npx`,
   `sudo`, `bash` or environment variables.
5. A `git push` starts only from the main folder: a lane's clone has the main folder as
   its origin, and its work is picked up by the reviewer with a fetch
   (metodo:lanes, "push"). From a clone it is blocked; from the main folder it asks for
   confirmation, because the owner decides on the push.

In the cloud (claude.ai/code, `CLAUDE_CODE_REMOTE=true`) every session has its own
container and there is no main folder: rules 4 and 5 read the branch instead. A release
starts only from `main`, with confirmation. A coding session pushes its job's branch
(a lane's `branches` prefix), because that is how the reviewer picks the work up; a push
to `main`, or a forced one, asks for confirmation; any other push is blocked.

6. In the cloud, the coding sessions are messaged with `send_message` and archived with
   `archive_session` (metodo:handoffs, "In the cloud"). Every job has a new session: a
   «Prompt for…» to a session that has already received one is blocked. A session is
   archived only after its «Close-out of…», and the owner confirms every archive. What
   was sent to whom the guard notes, after each delivered message (PostToolUse), in
   `<bench>/state/cloud.json`, in the reviewer's own container; with that file missing
   nobody knows, and the archive only asks.

Changes through Bash to protected files are caught only for the most common commands
(rm, mv, sed -i, perl -i, truncate, tee, redirection): this is not a complete barrier.
That is why `clones.sh` also writes `deny` rules on the protected folders into the
permissions of every clone: those apply to Edit and Write before this hook even runs.
"""
import json
import os
import re
import shlex
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from config import find_config, in_cloud, lane_of_branch  # noqa: E402


def block(reason):
    print(reason, file=sys.stderr)
    sys.exit(2)


def ask(reason):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "ask",
        "permissionDecisionReason": reason,
    }}))


def git(cwd, *args):
    r = subprocess.run(["git", "-C", cwd, *args], capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else None


def on_main(root, rel):
    # The main folder has main; a lane's clone has origin/main, which is the main
    # folder's main. Either is enough.
    for ref in ("main", "origin/main"):
        r = subprocess.run(["git", "-C", root, "cat-file", "-e", f"{ref}:{rel}"], capture_output=True)
        if r.returncode == 0:
            return ref
    return None


def check_file(path, cwd):
    if not path:
        return
    absolute = os.path.normpath(os.path.join(cwd, path))
    folder = os.path.dirname(absolute)
    while not os.path.isdir(folder):
        folder = os.path.dirname(folder)
    found = find_config(folder)
    if not found:
        return
    # The path is measured from the root of the file's repository: a clone at a commit
    # from before the method has no configuration of its own, and the one found going up
    # belongs to the main folder.
    root = git(folder, "rev-parse", "--show-toplevel") or found[0]
    cfg = found[1]
    rel = os.path.relpath(os.path.realpath(absolute), os.path.realpath(root))
    if not any(rel.startswith(c) for c in cfg["protected"].get("folders", [])):
        return
    ref = on_main(root, rel)
    if ref:
        block(f"Blocked: {rel} is already on {ref}, so it is applied or about to be. "
              "A file in a protected folder that is already applied is not modified: add a new one "
              '(METHOD.md, "writing code"). If you think it has to change, stop and say so.')


def pieces(command):
    return re.split(r"&&|\|\||;|\||\n", command)


def words_of(piece):
    try:
        return shlex.split(piece)
    except ValueError:
        return piece.split()


def check_protected(command, cwd, cfg):
    # Protected folders touched by the shell, in the common cases. Reading them (cat,
    # grep, git show) stays free: only writing counts.
    for folder in cfg["protected"].get("folders", []):
        file = r"[\w./-]*" + re.escape(folder) + r"[\w.-]+"
        for piece in pieces(command):
            if folder not in piece:
                continue
            for target in re.findall(r">>?\s*(" + file + ")", piece):
                check_file(target, cwd)
            if re.search(r"(^|\s)(rm|mv|truncate|tee)\s|\bsed\s+(-[a-zA-Z]*i|--in-place)|\bperl\s+-[a-zA-Z]*i", piece):
                for target in re.findall(file, piece):
                    check_file(target, cwd)


def compose_project(words, command):
    for i, p in enumerate(words):
        if p in ("-p", "--project-name") and i + 1 < len(words):
            return words[i + 1]
        if p.startswith("--project-name="):
            return p.split("=", 1)[1]
    m = re.search(r"\bCOMPOSE_PROJECT_NAME=([\w.-]+)", command)
    return m.group(1) if m else None


def check_docker(command, cfg):
    protected = cfg["protected"]
    stacks = protected.get("stacks", [])
    volumes = protected.get("volumes", [])
    for piece in pieces(command):
        if not re.search(r"\bdocker\b", piece):
            continue
        words = words_of(piece)
        everything = any(p in ("-a", "--all") for p in words)
        with_volumes = any(p in ("-v", "--volumes") or re.fullmatch(r"-[a-zA-Z]*v[a-zA-Z]*", p) for p in words)
        if re.search(r"\bdocker[\s-]+compose\b", piece):
            if ("down" in words or "rm" in words) and with_volumes:
                project = compose_project(words, command)
                if project is None or project in stacks:
                    block("Blocked: this docker compose deletes volumes "
                          + ("and does not name its project. Run from the repository folder, without a project, "
                             "it deletes the development database." if project is None else
                             f"of the protected stack {project}.")
                          + " Name the job's project, `-p <prefix>-<job>-<use>` "
                          '(metodo:lanes, "names"), or use the project\'s test script.')
            continue
        if "prune" in words and (everything or ("system" in words and with_volumes)):
            block("Blocked: a prune with -a, or with volumes, also takes the images and volumes of other "
                  "projects, and with the stack stopped the development database. The things of a closed job "
                  "are removed by the method's close-out cleanup; untagged images, `docker image prune -f`.")
        if "volume" in words and ("rm" in words or "remove" in words):
            for v in volumes:
                if v in words:
                    block(f"Blocked: the volume {v} is protected by the project configuration "
                          "(.claude/metodo.json, protected.volumes). A session does not delete it.")
        if ("rmi" in words or ("image" in words and ("rm" in words or "remove" in words))) and any(
                p in ("-f", "--force") for p in words):
            block("Blocked: an image is removed without -f. If a container still uses it, it stays: "
                  "first remove the container, or leave the image.")


def is_release(piece, release):
    # Only the command that runs, not a grep or a cat that names one.
    p = re.sub(r"^[\s(]*(\w+=\S*\s+)*((npx|sudo|exec|time|(ba|z)?sh)\s+)*", "", piece)
    return any(re.match(r, p) for r in release)


def check_release(command, cwd, cfg):
    release = cfg.get("release", [])
    if not release or not any(is_release(p, release) for p in pieces(command)):
        return
    main_folder = os.path.expanduser(cfg["root"])
    root = git(cwd, "rev-parse", "--show-toplevel")
    branch = git(cwd, "branch", "--show-current")
    # In the cloud there is no main folder: every session has its own checkout.
    if branch == "main" and (in_cloud() or (root and os.path.realpath(root) == os.path.realpath(main_folder))):
        ask('Release to production: the owner confirms it, every time (metodo:lanes, "release").')
        return
    if in_cloud():
        block(f'Blocked: in the cloud a release starts only from main, and the owner confirms it (metodo:lanes, "release"). '
              f"You are on branch {branch or '?'}. If you think it is needed, stop and say so.")
    block(f"Blocked: a release starts only from main in the main folder ({main_folder}), and the "
          f'owner confirms it (metodo:lanes, "release"). You are in {root or cwd}, on branch {branch or "?"}. '
          "If you think it is needed, stop and say so.")


PUSH = re.compile(r"(^|\s)git\s+(-C\s+\S+\s+)?push\b")


def check_cloud_push(command, cwd, cfg):
    """In the cloud: the job's branch goes out freely, main and a forced push ask, the rest is blocked."""
    current = git(cwd, "branch", "--show-current") or ""
    for piece in pieces(command):
        if not PUSH.search(piece):
            continue
        words = words_of(piece)
        after = words[[i for i, w in enumerate(words) if w == "push"][0] + 1:]
        if any(w in ("-f", "--force", "--mirror", "--all", "--delete", "-d") or w.startswith("--force") for w in after):
            ask('Forced push, or of more than one branch: the owner decides (metodo:lanes, "push").')
            return
        # What it pushes: the refspecs after the remote, or the current branch.
        refs = [w for w in after if not w.startswith("-")][1:] or [current]
        # `:branch` deletes it on origin: like --delete, the owner decides.
        if any(r.lstrip("+").startswith(":") for r in refs):
            ask('Push that deletes branches on origin: the owner decides (metodo:lanes, "push").')
            return
        targets = [r.lstrip("+").split(":")[-1].removeprefix("refs/heads/") for r in refs]
        targets = [current if t == "HEAD" else t for t in targets]
        if "main" in targets:
            ask('Push to main: the owner decides, once per closed piece of work (metodo:lanes, "push").')
            return
        if not all(lane_of_branch(t, cfg) is not None for t in targets):
            block(f"Blocked: in the cloud a session pushes only its job's branch, one of the lanes' "
                  f"(`branches` in .claude/metodo.json), and main with the owner's ok. This push goes to "
                  f"{', '.join(targets)}. If you think it is needed, stop and say so.")


def check_push(command, cwd, cfg):
    if not any(PUSH.search(p) for p in pieces(command)):
        return
    if in_cloud():
        check_cloud_push(command, cwd, cfg)
        return
    main_folder = os.path.expanduser(cfg["root"])
    root = git(cwd, "rev-parse", "--show-toplevel")
    if root and os.path.realpath(root) == os.path.realpath(main_folder):
        ask('Push to origin: the owner decides, once per closed piece of work (metodo:lanes, "push").')
        return
    block(f"Blocked: a git push starts only from the main folder ({main_folder}), and the owner decides on it. "
          f"You are in {root or cwd}: the work of a clone is picked up by the reviewer with a fetch "
          '(metodo:lanes, "one folder per lane"). If you think it is needed, stop and say so.')


# The protocol's first lines, in English and in Italian (the same as the lanes mod's).
CLOSEOUT = re.compile(r"^Close-?out of |^Chiusura (del|della) ")
PROMPT = re.compile(r"^(Prompt (for|del|della|dei|delle|degli)|Lavoro nuovo|New work)\b")
SEND = "mcp__claude-code-remote__send_message"
ARCHIVE = "mcp__claude-code-remote__archive_session"


def first_line(text):
    for r in (text or "").splitlines():
        r = re.sub(r"^[\s#>*-]+|[\s*]+$", "", r)
        if r and not r.startswith("<"):
            return r[:120]
    return ""


def cloud_state_file(cfg):
    return os.path.join(os.path.expanduser(cfg["bench"]), "state", "cloud.json")


def read_cloud_state(cfg):
    try:
        with open(cloud_state_file(cfg)) as f:
            state = json.load(f)
        return state if isinstance(state, dict) else {}
    except (OSError, ValueError):
        return {}


def check_send(tool_input, cfg):
    target = tool_input.get("session_id", "")
    line = first_line(tool_input.get("message", ""))
    if not target or not PROMPT.match(line):
        return
    seen = read_cloud_state(cfg).get(target) or {}
    if seen.get("prompt"):
        block(f"Not sent: in the cloud every job has a new coding session, and {target} has already received "
              f"«{seen['prompt']}». Close that job with its «Close-out of…» and archive the session, then open a new "
              "one with create_session on the job's branch and send it this prompt (metodo:handoffs, \"In the cloud\"). "
              "A message of the same job does not start with «Prompt for…».")


def note_sent(tool_input, cfg):
    """After a delivered message: what went to that session, for the next prompt and for the archive."""
    target = tool_input.get("session_id", "")
    if not target:
        return
    line = first_line(tool_input.get("message", ""))
    state = read_cloud_state(cfg)
    seen = state.get(target) or {}
    seen.update({"last": line, "at": int(time.time())})
    if PROMPT.match(line) and not seen.get("prompt"):
        seen["prompt"] = line
    state[target] = seen
    file = cloud_state_file(cfg)
    try:
        os.makedirs(os.path.dirname(file), exist_ok=True)
        with open(file, "w") as f:
            json.dump(state, f)
    except OSError:
        pass


def check_archive(tool_input, cfg):
    target = tool_input.get("session_id", "")
    seen = read_cloud_state(cfg).get(target)
    if seen is None:
        ask(f"Archive {target}: the guard has not seen the messages to this session (another reviewer, or a "
            "container started afresh), so it cannot tell whether its «Close-out of…» went out. The owner confirms.")
        return
    if not CLOSEOUT.match(seen.get("last", "")):
        block(f"Blocked: a coding session is archived only after its «Close-out of…», and the last message to "
              f"{target} was «{seen.get('last', '')}». First the «Verification», the merge and the cleanup, then the "
              "«Close-out of…»; when the session has answered it and its branch is on origin, archive it "
              '(metodo:handoffs, "In the cloud").')
    ask(f"Archive the coding session {target} of «{seen.get('prompt') or '?'}»: the close-out has gone out. "
        "Archiving releases its container, and the owner confirms it.")


def main():
    try:
        data = json.load(sys.stdin)
    except ValueError:
        return
    tool = data.get("tool_name", "")
    tool_input = data.get("tool_input") or {}
    cwd = data.get("cwd") or os.getcwd()
    if tool in (SEND, ARCHIVE):
        found = find_config(cwd)
        if not found:
            return
        if data.get("hook_event_name") == "PostToolUse":
            if tool == SEND:
                note_sent(tool_input, found[1])
        elif tool == SEND:
            check_send(tool_input, found[1])
        else:
            check_archive(tool_input, found[1])
        return
    if tool in ("Edit", "Write", "MultiEdit", "NotebookEdit"):
        check_file(tool_input.get("file_path") or tool_input.get("notebook_path"), cwd)
    elif tool == "Bash":
        found = find_config(cwd)
        if not found:
            return
        command = tool_input.get("command", "")
        _, cfg = found
        check_protected(command, cwd, cfg)
        check_docker(command, cfg)
        check_release(command, cwd, cfg)
        check_push(command, cwd, cfg)


if __name__ == "__main__":
    main()
