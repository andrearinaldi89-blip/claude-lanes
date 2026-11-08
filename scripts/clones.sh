#!/usr/bin/env bash
# Prepares the lanes' clones inside the main folder (metodo:lanes, "one folder per lane").
#
# From the project's main folder, which has `.claude/metodo.json`:
#
#   ~/code/metodo/scripts/clones.sh
#
# - Adds the clones folder to the main folder's `.gitignore`, if it is not there: the
#   line is left to commit.
# - For every lane creates the clone, `<clones>/<prefix>-<lane>`, if it is missing; one
#   that already exists, even moved by hand, is left as it is.
# - In every clone writes into `.claude/settings.local.json` the `claudeMdExcludes` with
#   the main folder's `CLAUDE.md`: Claude Code reads `CLAUDE.md` files going up the
#   folders, and a session in the clone must read only its own.
# - In the same file writes `model`: coding sessions run on Sonnet 5.5
#   (metodo:handoffs, "coding sessions run on Sonnet 5.5"), so the clone's setting does
#   it, not the reviewer at every prompt with `set_session_model`. The model is given by
#   `model` in metodo.json; without it, `claude-sonnet-5-5`.
#
# Run again, it changes nothing that is already in place.
set -euo pipefail

HOOKS="$(cd "$(dirname "$0")/../hooks" && pwd)"
MAIN=$(git rev-parse --show-toplevel 2>/dev/null || true)
CONF="$MAIN/.claude/metodo.json"
if [ -z "$MAIN" ] || [ ! -f "$CONF" ]; then
  echo "There is no .claude/metodo.json here: run this from the main folder of a project that uses the method." >&2
  exit 1
fi

# As in cleanup.sh: a function, because the Mac's bash 3.2 does not read a heredoc
# with parentheses inside a $(...).
settings() {
  python3 - "$CONF" "$HOME" "$HOOKS" <<'PY'
import json, shlex, sys
sys.path.insert(0, sys.argv[3])
from config import load
c = load(sys.argv[1])
home = sys.argv[2]
root = home + c["root"][1:] if c["root"].startswith("~/") else c["root"]
print(f"ROOT={shlex.quote(root)}")
print(f"CLONES_DIR={shlex.quote(c['clones'])}")
print(f"MODEL={shlex.quote(c.get('model', 'claude-sonnet-5-5'))}")
print("CLONES=(" + " ".join(shlex.quote(f"{root}/{c['clones']}/{c['prefix']}-{b['id']}") for b in c["lanes"]) + ")")
PY
}
eval "$(settings)"

if [ "$(cd "$MAIN" && pwd -P)" != "$(cd "$ROOT" 2>/dev/null && pwd -P)" ]; then
  echo "This is $MAIN, but the project's main folder is $ROOT: run this from there." >&2
  exit 1
fi

if git -C "$MAIN" check-ignore -q "$CLONES_DIR/x"; then
  echo "$CLONES_DIR/ is already ignored by the main folder"
else
  printf '\n# The lanes'"'"' clones (metodo:lanes, "one folder per lane")\n/%s/\n' "$CLONES_DIR" >>"$MAIN/.gitignore"
  echo "added /$CLONES_DIR/ to the main folder's .gitignore: to commit"
fi

for clone in "${CLONES[@]}"; do
  if [ -d "$clone/.git" ]; then
    echo "$clone: exists"
  else
    git clone -q "$MAIN" "$clone"
    echo "$clone: cloned"
  fi
  python3 - "$clone/.claude/settings.local.json" "$MAIN/CLAUDE.md" "$MODEL" <<'PY'
import json, os, sys
file, excluded, model = sys.argv[1], sys.argv[2], sys.argv[3]
settings = {}
if os.path.exists(file):
    with open(file) as f:
        settings = json.load(f)
changed = False
excludes = settings.setdefault("claudeMdExcludes", [])
if excluded in excludes:
    print("  claudeMdExcludes: already there")
else:
    excludes.append(excluded)
    changed = True
    print(f"  claudeMdExcludes: {excluded}")
if settings.get("model") == model:
    print(f"  model: already there ({model})")
else:
    settings["model"] = model
    changed = True
    print(f"  model: {model}")
if changed:
    os.makedirs(os.path.dirname(file), exist_ok=True)
    with open(file, "w") as f:
        json.dump(settings, f, indent=2, ensure_ascii=False)
        f.write("\n")
PY
  if ! git -C "$clone" check-ignore -q .claude/settings.local.json; then
    echo "  WARNING: .claude/settings.local.json is not ignored by the repository: it belongs in the project's .gitignore"
  fi
done
