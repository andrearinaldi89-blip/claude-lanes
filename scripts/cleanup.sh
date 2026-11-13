#!/usr/bin/env bash
# The close-out cleanup, when a checkpoint or a correction is closed.
#
# The reviewer runs it from the project's main folder, in the same turn as the merge and
# before the close-out notification, and it reads `.claude/metodo.json`:
#
#   ~/code/metodo/scripts/cleanup.sh            (cleans)
#   ~/code/metodo/scripts/cleanup.sh --dry-run  (says what it would do)
#
# 1. In the main folder and in the lanes' clones deletes the branches already merged
#    into main, and in the clones realigns main with the main folder's. It deletes only
#    with `git branch -d`: a branch with unmerged commits stays. `release/*` branches
#    are not touched.
# 2. For every deleted branch, the things of its job, recognized by name
#    (metodo:lanes, "names"): the job of `fix/C-12` is `C-12`, that of `dev/cp18` is
#    `cp18` (or `b2cp18`, with the block in front), that of `demo/cp3` is `demo-cp3`,
#    and numbers match also with leading zeros.
#    - The repository copies on the bench: the subfolders of `<bench>/<job>/` holding
#      the configuration's `copyMarker` file. Small files stay (verifications, probes,
#      clarifications), which the documents cite.
#    - The containers, networks, volumes and images of the Docker projects
#      `<prefix>-<job>-<use>`. Never a protected stack or volume, never `rmi -f`:
#      an image still in use stays.
# 3. If it removed anything from Docker, in the background and queued behind the lock of
#    the end-to-end runs: `docker image prune -f` in rounds, as long as untagged images
#    decrease (with the containerd store, intermediate layers become untagged only after
#    the image above them is gone), then `colima ssh -- sudo fstrim -a`, which gives back
#    to the Mac the space freed in the virtual machine's disk. Never `prune -a`, which
#    also takes other projects' images. The report goes in `<bench>/cleanup.log`.
#
# In the cloud (claude.ai/code, `CLAUDE_CODE_REMOTE=true`) the reviewer runs it from its
# own checkout: there is no main folder to match and there are no clones. The job's work
# lives on origin, so:
# - the lane branches on origin already merged into main are closed jobs. A branch whose
#   tip is on main's first-parent line has no commits of its own (just created for a job
#   that is starting, or merged fast-forward) and stays: merge the jobs with --no-ff.
# - Deleting them on origin is a push, and the push is the owner's: the script does not
#   push, it writes the one command that does it, together with main if main is ahead of
#   origin; the reviewer runs it and the guard asks the owner.
# - The local copies of those branches go, even with no commits of their own: the
#   commits were made in the coding session's container.
# - The bench and Docker are cleaned as above, in the reviewer's container.
# - The coding sessions are archived by the reviewer (metodo:handoffs, "In the cloud"):
#   a script cannot do it, so it reminds.
set -euo pipefail

HOOKS="$(cd "$(dirname "$0")/../hooks" && pwd)"

# The queue: launched by itself under the lock, without configuration.
if [ "${1:-}" = "--queued" ]; then
  echo "$(date '+%F %T') cleanup queue: the untagged images"
  before=-1
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    n=$(docker images -qf dangling=true | wc -l | tr -d ' ')
    [ "$n" -eq 0 ] && break
    # They no longer decrease: the ones left are in use, or from a build running now.
    [ "$before" -ge 0 ] && [ "$n" -ge "$before" ] && break
    echo "  $n untagged: docker image prune -f"
    docker image prune -f >/dev/null
    before=$n
  done
  if command -v colima >/dev/null; then
    echo "  colima ssh -- sudo fstrim -a"
    colima ssh -- sudo fstrim -a
  fi
  echo "$(date '+%F %T') cleanup queue finished"
  exit 0
fi

CLOUD=0
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] && CLOUD=1

DRY=${1:-}
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
MAIN=$(git rev-parse --show-toplevel 2>/dev/null || true)
CONF="$MAIN/.claude/metodo.json"
if [ -z "$MAIN" ] || [ ! -f "$CONF" ]; then
  echo "There is no .claude/metodo.json here: run the cleanup from the main folder of a project that uses the method." >&2
  exit 1
fi

# The configuration, as shell variables; paths with ~ become absolute. In a function:
# the Mac's bash 3.2 does not read a heredoc with parentheses inside a $(...).
settings() {
  python3 - "$CONF" "$HOME" "$HOOKS" <<'PY'
import json, shlex, sys
sys.path.insert(0, sys.argv[3])
from config import load
c = load(sys.argv[1])
home = sys.argv[2]
def expand(p):
    return home + p[1:] if p == "~" or p.startswith("~/") else p
def array(name, values):
    print(f"{name}=(" + " ".join(shlex.quote(v) for v in values) + ")")
protected = c["protected"]
root = expand(c["root"])
print(f"ROOT={shlex.quote(root)}")
print(f"PREFIX={shlex.quote(c['prefix'])}")
print(f"BENCH={shlex.quote(expand(c['bench']))}")
print(f"MARKER={shlex.quote(c.get('copyMarker', 'CLAUDE.md'))}")
print(f"LOCK={shlex.quote(expand(c['lock']))}")
array("CLONES", [f"{root}/{c['clones']}/{c['prefix']}-{b['id']}" for b in c["lanes"]])
branches = [(r, b.get("jobPrefix", "")) for b in c["lanes"] for r in b["branches"]]
array("BRANCHES", [r for r, _ in branches])
array("JOBS", [j for _, j in branches])
array("STACKS", protected.get("stacks", []))
array("VOLUMES", protected.get("volumes", []))
PY
}
eval "$(settings)"

# In the cloud every session has its own checkout: no main folder, no clones.
if [ $CLOUD -eq 1 ]; then
  CLONES=()
elif [ "$(cd "$MAIN" && pwd -P)" != "$(cd "$ROOT" 2>/dev/null && pwd -P)" ]; then
  echo "This is $MAIN, but the project's main folder is $ROOT: run the cleanup from there." >&2
  exit 1
fi
case "$BENCH" in
  /*/*) ;;
  *) echo "The bench folder, $BENCH, is not an absolute path under the home: the configuration is wrong." >&2; exit 1 ;;
esac

# The job of a branch, or nothing if the branch does not belong to a lane.
job_of() {
  local branch=$1 i
  for i in "${!BRANCHES[@]}"; do
    case "$branch" in "${BRANCHES[$i]}"*) echo "${JOBS[$i]}${branch#"${BRANCHES[$i]}"}"; return ;; esac
  done
}

# The expression that recognizes the job in a name: the block in front, and the numbers' zeros.
pattern_of() {
  local job=$1
  [[ $job =~ ^[A-Za-z0-9_-]+$ ]] || return 0
  echo "(b[0-9]+)?$(printf '%s' "$job" | sed -E 's/0*([0-9]+)/0*\1/g')"
}

is_protected() {
  local what=$1; shift
  local p
  for p in "$@"; do [ "$p" = "$what" ] && return 0; done
  return 1
}

DOCKER_REMOVED=0

clean_bench() {
  local pattern=$1 job copy
  for job in "$BENCH"/*/; do
    [[ $(basename "$job") =~ ^${pattern}$ ]] || continue
    for copy in "$job"*/; do
      copy=${copy%/}
      { [ -f "$copy/$MARKER" ] && [ ! -L "$copy" ]; } || continue
      echo "  bench: deleting $copy"
      [ "$DRY" = "--dry-run" ] && continue
      # At low priority: it is thousands of files, and a CI that measures times may be running.
      if command -v taskpolicy >/dev/null; then taskpolicy -b rm -rf "$copy"; else rm -rf "$copy"; fi
    done
  done
}

# One line per object: the name (or the id) and the compose project, if any.
# It belongs to the job if its project, or its name without one, is <prefix>-<job>[-<use>].
of_the_job() {
  local pattern=$1 name=$2 project=$3
  local who=${project:-$name}
  [[ $who =~ ^${PREFIX}-${pattern}(-.*|_.*)?$ ]] || return 1
  [ -z "$project" ] || ! is_protected "$project" ${STACKS[@]+"${STACKS[@]}"}
}

remove() {
  local kind=$1; shift
  echo "  docker: removing $kind $*"
  [ "$DRY" = "--dry-run" ] && return 0
  DOCKER_REMOVED=1
  case $kind in
    container) docker rm -v "$1" >/dev/null || echo "    stays: docker did not remove it" ;;
    network) docker network rm "$1" >/dev/null || echo "    stays: it is still in use" ;;
    volume) docker volume rm "$1" >/dev/null || echo "    stays: it is still in use" ;;
    image) docker rmi "$1" >/dev/null || echo "    stays: it is still in use" ;;
  esac
}

clean_docker() {
  local pattern=$1 id name project
  while IFS=$'\t' read -r id name project <&3; do
    of_the_job "$pattern" "$name" "$project" || continue
    [ "$DRY" = "--dry-run" ] || docker stop -t 10 "$id" >/dev/null 2>&1 || true
    remove container "$name"
  done 3< <(docker ps -a --format '{{.ID}}\t{{.Names}}\t{{.Label "com.docker.compose.project"}}')
  while IFS=$'\t' read -r name project <&3; do
    of_the_job "$pattern" "$name" "$project" || continue
    remove network "$name"
  done 3< <(docker network ls --format '{{.Name}}\t{{.Label "com.docker.compose.project"}}')
  while IFS=$'\t' read -r name project <&3; do
    of_the_job "$pattern" "$name" "$project" || continue
    if is_protected "$name" ${VOLUMES[@]+"${VOLUMES[@]}"}; then echo "  docker: the volume $name is protected, it stays"; continue; fi
    remove volume "$name"
  done 3< <(docker volume ls --format '{{.Name}}\t{{.Label "com.docker.compose.project"}}')
  # A compose project's images are named <project>-<service>. By name and tag:
  # an image that has another name too loses only this one.
  local tag
  while IFS=$'\t' read -r name tag id <&3; do
    of_the_job "$pattern" "$name" "" || continue
    if [ "$tag" = "<none>" ]; then remove image "$id"; else remove image "$name:$tag"; fi
  done 3< <(docker images --format '{{.Repository}}\t{{.Tag}}\t{{.ID}}' | { grep -v '^<none>' || true; })
}

CLOSED=()
# In the cloud: the lane branches closed on origin, merged into main with commits of their own.
REMOTE_CLOSED=()

closed_on_origin() {
  local branch=$1 b
  for b in ${REMOTE_CLOSED[@]+"${REMOTE_CLOSED[@]}"}; do [ "$b" = "$branch" ] && return 0; done
  return 1
}

find_closed_on_origin() {
  local first remote branch
  first=$(git -C "$MAIN" rev-list --first-parent main)
  while read -r remote <&3; do
    branch=${remote#origin/}
    case "$branch" in main | release/* | HEAD | origin) continue ;; esac
    [ -n "$(job_of "$branch")" ] || continue
    if printf '%s\n' "$first" | grep -qx "$(git -C "$MAIN" rev-parse "$remote")"; then
      echo "  origin: $branch has no commits of its own off main's line, leaving it"
      continue
    fi
    REMOTE_CLOSED+=("$branch")
  done 3< <(git -C "$MAIN" branch -r --merged main --format='%(refname:short)' | { grep '^origin/' || true; })
}

delete_merged() {
  local dir=$1 base=$2
  local current; current=$(git -C "$dir" branch --show-current)
  local dirty; dirty=$(git -C "$dir" status --short)
  local branch history
  while read -r branch <&3; do
    [ -z "$branch" ] && continue
    # A branch with no commits of its own counts as merged even when just born: it is
    # the one the reviewer creates for a job that is starting. The reflog tells.
    history=$(git -C "$dir" reflog show --format='%gs' "refs/heads/$branch" 2>/dev/null || true)
    # In the cloud the commits are on origin, made in the coding session's container.
    if ! closed_on_origin "$branch" && [ -z "$(printf '%s\n' "$history" | grep -v '^branch: Created from' || true)" ]; then
      echo "  $dir: $branch has no commits of its own, leaving it"
      continue
    fi
    if [ "$branch" = "$current" ] && [ -n "$dirty" ]; then
      echo "  $dir: $branch is the current branch and has uncommitted changes, leaving it"
      continue
    fi
    if [ "$branch" = "$current" ]; then
      echo "  $dir: $branch is the current branch, switching to main"
      [ "$DRY" = "--dry-run" ] || git -C "$dir" switch -q main
    fi
    echo "  $dir: deleting $branch"
    [ "$DRY" = "--dry-run" ] || git -C "$dir" branch -d -q "$branch"
    CLOSED+=("$branch")
  done 3< <(git -C "$dir" branch --merged "$base" --format='%(refname:short)' | { grep -v -e '^main$' -e '^release/' || true; })
}

if [ $CLOUD -eq 1 ]; then echo "The reviewer's checkout, in the cloud"; else echo "Main folder"; fi
if [ -n "$(git -C "$MAIN" status --short)" ]; then
  echo "  WARNING: $( [ $CLOUD -eq 1 ] && echo "the checkout" || echo "the main folder") has uncommitted changes"
  git -C "$MAIN" status --short | sed 's/^/    /'
fi
if [ $CLOUD -eq 1 ]; then
  git -C "$MAIN" fetch -q --prune origin || echo "  WARNING: git fetch from origin failed: the branches on origin are as last seen"
  find_closed_on_origin
fi
delete_merged "$MAIN" main

for clone in "${CLONES[@]}"; do
  [ -d "$clone/.git" ] || { echo "$clone: not there, skipping"; continue; }
  echo "$clone"
  if [ -n "$(git -C "$clone" status --short)" ]; then
    echo "  has uncommitted changes: not touching the current branch"
  fi
  git -C "$clone" fetch -q origin
  # First main, then the branches: `branch -d` looks at the clone's main, and an old one says "not merged".
  if [ "$DRY" != "--dry-run" ]; then
    if [ "$(git -C "$clone" branch --show-current)" = "main" ]; then
      git -C "$clone" merge -q --ff-only origin/main && echo "  main realigned to $(git -C "$clone" rev-parse --short main)"
    else
      git -C "$clone" branch -f main origin/main && echo "  main realigned to $(git -C "$clone" rev-parse --short main)"
    fi
  fi
  delete_merged "$clone" origin/main
done

# A branch closed on origin is a closed job even when it has no local copy.
for branch in ${REMOTE_CLOSED[@]+"${REMOTE_CLOSED[@]}"}; do CLOSED+=("$branch"); done

# The things of closed jobs, once per job even if the branch was in several folders.
shopt -s nocasematch
DOCKER=0
if command -v docker >/dev/null && docker info >/dev/null 2>&1; then DOCKER=1; fi
SEEN=" "
for branch in ${CLOSED[@]+"${CLOSED[@]}"}; do
  job=$(job_of "$branch")
  pattern=$(pattern_of "$job")
  if [ -z "$job" ] || [ -z "$pattern" ]; then echo "The branch $branch does not belong to a lane: no bench, no Docker"; continue; fi
  case "$SEEN" in *" $job "*) continue ;; esac
  SEEN="$SEEN$job "
  echo "The job $job"
  clean_bench "$pattern"
  if [ $DOCKER -eq 1 ]; then clean_docker "$pattern"; else echo "  docker does not answer: no containers, volumes and images"; fi
done
shopt -u nocasematch

if [ $DOCKER_REMOVED -eq 1 ]; then
  mkdir -p "$BENCH"
  # The same lock as the end-to-end runs: prune and fstrim wait for them to finish, and for CI.
  if command -v lockf >/dev/null; then QUEUED=(lockf -k "$LOCK"); else QUEUED=(flock "$LOCK"); fi
  nohup "${QUEUED[@]}" "$SELF" --queued >>"$BENCH/cleanup.log" 2>&1 </dev/null &
  disown
  echo "Untagged images and fstrim: queued behind the lock, the report in $BENCH/cleanup.log"
fi

if [ $CLOUD -eq 1 ]; then
  if [ ${#REMOTE_CLOSED[@]} -gt 0 ]; then
    ahead=$(git -C "$MAIN" rev-list --count origin/main..main 2>/dev/null || echo 0)
    deletions=$(printf ' :%s' "${REMOTE_CLOSED[@]}")
    echo "Closed on origin: ${REMOTE_CLOSED[*]}. Deleting them is a push, and the owner decides: run"
    if [ "$ahead" -gt 0 ]; then
      echo "  git push origin main$deletions"
    else
      echo "  git push origin$deletions"
    fi
  fi
  echo "The coding sessions of the closed jobs: after their «Close-out of…», archive them (metodo:handoffs, \"In the cloud\")."
fi

echo "Branches left:"
for d in "$MAIN" "${CLONES[@]}"; do
  if [ -d "$d/.git" ]; then echo "  $(basename "$d"): $(git -C "$d" branch --format='%(refname:short)' | tr '\n' ' ')"; fi
done

echo "Bench copies left:"
for copy in "$BENCH"/*/*/; do
  if [ -f "${copy}$MARKER" ] && [ ! -L "${copy%/}" ]; then echo "  ${copy#"$BENCH"/}"; fi
done

if [ $DOCKER -eq 1 ]; then
  echo "Project's Docker projects left:"
  docker ps -a --format '{{.Label "com.docker.compose.project"}}' | sort -u | { grep "^$PREFIX-" || true; } | sed 's/^/  /'
fi
