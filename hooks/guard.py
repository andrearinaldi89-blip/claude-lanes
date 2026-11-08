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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from config import find_config  # noqa: E402


def block(reason):
    print(reason, file=sys.stderr)
    sys.exit(2)


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
    if root and os.path.realpath(root) == os.path.realpath(main_folder) and branch == "main":
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "ask",
            "permissionDecisionReason": 'Release to production: the owner confirms it, every time (metodo:lanes, "release").',
        }}))
        return
    block(f"Blocked: a release starts only from main in the main folder ({main_folder}), and the "
          f'owner confirms it (metodo:lanes, "release"). You are in {root or cwd}, on branch {branch or "?"}. '
          "If you think it is needed, stop and say so.")


def check_push(command, cwd, cfg):
    if not any(re.search(r"(^|\s)git\s+(-C\s+\S+\s+)?push\b", p) for p in pieces(command)):
        return
    main_folder = os.path.expanduser(cfg["root"])
    root = git(cwd, "rev-parse", "--show-toplevel")
    if root and os.path.realpath(root) == os.path.realpath(main_folder):
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "ask",
            "permissionDecisionReason": 'Push to origin: the owner decides, once per closed piece of work (metodo:lanes, "push").',
        }}))
        return
    block(f"Blocked: a git push starts only from the main folder ({main_folder}), and the owner decides on it. "
          f"You are in {root or cwd}: the work of a clone is picked up by the reviewer with a fetch "
          '(metodo:lanes, "one folder per lane"). If you think it is needed, stop and say so.')


def main():
    try:
        data = json.load(sys.stdin)
    except ValueError:
        return
    tool = data.get("tool_name", "")
    tool_input = data.get("tool_input") or {}
    cwd = data.get("cwd") or os.getcwd()
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
