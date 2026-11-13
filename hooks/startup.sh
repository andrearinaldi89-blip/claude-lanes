#!/usr/bin/env bash
# Orientation of the coding session, at opening (METHOD.md, "writing code").
#
# SessionStart hook of the plugin. It acts only in a lane's coding session: a clone (a
# folder under `<root>/<clones>/` of `.claude/metodo.json`) or, in the cloud, a session
# whose checkout is on a lane's branch; elsewhere it prints nothing. What it
# prints enters the session's context: branch and commit, whether the tree is dirty,
# how far the branch is ahead of or behind origin/main, and the last closed "Done".
# These are the things a session should look at before writing code, and that from
# memory it does not.
set -uo pipefail

HOOKS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CWD=$(pwd -P)
CONF=""
d="$CWD"
while [ "$d" != "/" ]; do
  if [ -f "$d/.claude/metodo.json" ]; then CONF="$d/.claude/metodo.json"; break; fi
  d=$(dirname "$d")
done
[ -n "$CONF" ] || exit 0

BRANCH=$(git branch --show-current 2>/dev/null || echo '?')

# Prints whether this is a coding session (yes/no) and the block documents folder, tab-separated.
settings() {
  python3 - "$CONF" "$CWD" "$HOOKS" "$BRANCH" <<'PY'
import sys
sys.path.insert(0, sys.argv[3])
from config import load, doc_paths, is_coding_session
c = load(sys.argv[1])
print(("yes" if is_coding_session(sys.argv[2], c, sys.argv[4]) else "no") + "\t" + doc_paths(sys.argv[2], c)[0])
PY
}
IFS=$'\t' read -r CODING BLOCKS < <(settings)
[ "$CODING" = "yes" ] || exit 0
COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo '?')
DIRTY=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
git fetch -q origin main 2>/dev/null || true
read -r BEHIND AHEAD < <(git rev-list --left-right --count origin/main...HEAD 2>/dev/null || echo '? ?')

if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  echo "Coding session orientation, in the cloud (the method's startup hook):"
else
  echo "Clone orientation (the method's startup hook):"
fi
echo "- folder: $CWD"
echo "- branch: $BRANCH @ $COMMIT, $AHEAD commits ahead and $BEHIND behind origin/main"
if [ "$DIRTY" != "0" ]; then
  echo "- WARNING: the tree has $DIRTY modified or untracked files. Before working, find out whose they are: if they are not the prompt's, stop and tell the reviewer."
else
  echo "- clean tree"
fi
if [ "$BRANCH" = "main" ]; then
  echo "- WARNING: you are on main. Work happens on the prompt's branch, which the reviewer creates: without a prompt, do not write code."
fi
LAST=$(grep -lE '^\*\*(Done|Fatto):\*\*' "$BLOCKS"/*.md 2>/dev/null | tail -1)
if [ -n "$LAST" ]; then
  echo "- last block document with a \"Done\": $LAST (read the last closed one before starting)"
fi
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  echo "- in the cloud: push this branch before every «Plan for…» that names files and before every «Delivery of…» (git push -u origin $BRANCH): the reviewer reads it from origin, and a container reclaimed for inactivity loses what is not pushed. Answer the reviewer with send_message to the session id its prompt gives."
  echo "The prompt gives the branch: if it does not match this one, stop and say so."
else
  echo "The prompt gives folder and branch: if they do not match these, stop and say so."
fi
