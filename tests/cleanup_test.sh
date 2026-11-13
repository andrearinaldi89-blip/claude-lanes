#!/usr/bin/env bash
# Test of the close-out cleanup, with HOME in a new folder and a fake docker.
#
#   bash tests/cleanup_test.sh
#
# Every run creates a new folder (under $TMPDIR) and does not delete it: the tests never
# run an `rm -rf` on their HOME. The fake docker answers with objects of several
# projects, and logs every call in docker.log.
set -euo pipefail
# The desktop first, whatever machine runs the tests; the cloud has its own section.
unset CLAUDE_CODE_REMOTE

CLEANUP="$(cd "$(dirname "$0")/.." && pwd)/scripts/cleanup.sh"
ROOTDIR=$(mktemp -d "${TMPDIR:-/tmp}/test-cleanup.XXXXXX")
export HOME="$ROOTDIR/casa"
FAKES="$ROOTDIR/finti"
export LOG="$ROOTDIR/docker.log"
export UNTAGGED="$ROOTDIR/senza-nome"
mkdir -p "$HOME" "$FAKES"
: >"$LOG"
echo 5 >"$UNTAGGED"
export GIT_AUTHOR_NAME=p GIT_AUTHOR_EMAIL=p@p GIT_COMMITTER_NAME=p GIT_COMMITTER_EMAIL=p@p

errors=0
ok() { echo "  ok: $1"; }
ko() { echo "  NO: $1"; errors=$((errors + 1)); }
check() { if eval "$2"; then ok "$1"; else ko "$1"; fi; }

# ---------------------------------------------------------------- the fakes
cat >"$FAKES/docker" <<'EOF'
#!/usr/bin/env bash
echo "docker $*" >>"$LOG"
case "$*" in
  info) exit 0 ;;
  "ps -a --format {{.ID}}"*)
    printf '%s\t%s\t%s\n' c1 acme-cp18-iter-api-1 acme-cp18-iter c2 acme-api-1 acme \
      c3 acme-c-12-mut-db-1 acme-c-12-mut c4 galoppino-1 galoppino c5 acme-cp18-sonda '' ;;
  "ps -a --format {{.Label"*) printf 'acme\nacme-c-12-mut\ngaloppino\n' ;;
  "network ls"*) printf '%s\t%s\n' acme-cp18-iter_default acme-cp18-iter acme_default acme bridge '' ;;
  "volume ls"*)
    printf '%s\t%s\n' acme-cp18-iter_pgdata acme-cp18-iter acme_pgdata acme-cp18-iter \
      acme_pgdata acme acme-cp180-iter_pgdata acme-cp180-iter ;;
  "images --format"*)
    printf '%s\t%s\t%s\n' acme-cp18-iter-api latest i1 acme-api latest i2 \
      mcr.microsoft.com/playwright/python v1.55.0-noble i3 acme-cp18-mut-api '<none>' i4 \
      acme-b2cp18-iter-api latest i5 acme-cp180-iter-api latest i6 '<none>' '<none>' i7 ;;
  "images -qf dangling=true") n=$(cat "$UNTAGGED"); for _ in $(seq "$n"); do echo x; done ;;
  "image prune -f") n=$(cat "$UNTAGGED"); [ "$n" -gt 3 ] && echo 3 >"$UNTAGGED" ;;
esac
exit 0
EOF
cat >"$FAKES/colima" <<'EOF'
#!/usr/bin/env bash
echo "colima $*" >>"$LOG"
EOF
cat >"$FAKES/lockf" <<'EOF'
#!/usr/bin/env bash
echo "lockf $1 $2" >>"$LOG"
shift 2
exec "$@"
EOF
chmod +x "$FAKES"/*
export PATH="$FAKES:$PATH"

# ------------------------------------------------------------- the project
P="$HOME/code/Acme Two"
mkdir -p "$P/.claude"
cat >"$P/.claude/metodo.json" <<'EOF'
{
  "name": "Acme", "prefix": "acme", "root": "~/code/Acme Two", "clones": "lanes",
  "lanes": [
    { "id": "dev", "name": "Development", "branches": ["dev/"] },
    { "id": "fixes", "name": "Fixes", "branches": ["fix/"] },
    { "id": "demo", "name": "Demo", "branches": ["demo/"], "jobPrefix": "demo-" }
  ],
  "bench": "~/.cache/acme-review", "copyMarker": "docker-compose.yml", "lock": "~/.cache/acme-e2e.lock",
  "protected": { "volumes": ["acme_pgdata"], "stacks": ["acme"] }
}
EOF
echo "lanes/" >"$P/.gitignore"
git -C "$P" init -q -b main
git -C "$P" add . && git -C "$P" commit -q -m inizio
for b in dev fixes demo; do git clone -q "$P" "$P/lanes/acme-$b"; done
# Development closed cp18: the reviewer took it from the clone and merged it into main.
S="$P/lanes/acme-dev"
git -C "$S" switch -q -c dev/cp18 && echo a >"$S/a" && git -C "$S" add a && git -C "$S" commit -q -m cp18
git -C "$P" fetch -q "$S" dev/cp18:dev/cp18 && git -C "$P" merge -q --no-edit dev/cp18
# Correction C-12 is half done; the demo has a freshly created branch, without commits.
C="$P/lanes/acme-fixes"
git -C "$C" switch -q -c fix/C-12 && echo c >"$C/c" && git -C "$C" add c && git -C "$C" commit -q -m c12
git -C "$P/lanes/acme-demo" switch -q -c demo/cp3

B="$HOME/.cache/acme-review"
for copy in cp18/base cp18/main b2cp18/base C-12/base cp180/base demo-cp3/base; do
  mkdir -p "$B/$copy" && touch "$B/$copy/docker-compose.yml"
done
mkdir -p "$B/cp18/probes" "$B/state"
echo prompt >"$B/cp18/prompt.md"
echo '{}' >"$B/state/dev.json"
ln -s "$B/C-12/base" "$B/cp18/linked"

# ------------------------------------------------------------------ the tests
echo "From outside, and from a clone: it refuses"
check "outside a project it exits with an error" "! (cd '$ROOTDIR' && '$CLEANUP' >/dev/null 2>&1)"
check "from a clone it exits with an error" "! (cd '$S' && '$CLEANUP' >/dev/null 2>&1)"

echo "--dry-run: says and does not touch"
(cd "$P" && "$CLEANUP" --dry-run) >"$ROOTDIR/dry.txt"
check "says it would delete dev/cp18" "grep -q 'deleting dev/cp18' '$ROOTDIR/dry.txt'"
check "says it would remove cp18's container" "grep -q 'removing container acme-cp18-iter-api-1' '$ROOTDIR/dry.txt'"
check "the branch is still there" "git -C '$P' rev-parse -q --verify dev/cp18 >/dev/null"
check "the copy is still there" "[ -d '$B/cp18/base' ]"
check "docker removed nothing" "! grep -qE '^docker (rm|rmi|network rm|volume rm|stop|image prune)' '$LOG'"

echo "The real cleanup"
: >"$LOG"
(cd "$P" && "$CLEANUP") >"$ROOTDIR/real.txt"
cat "$ROOTDIR/real.txt" | sed 's/^/    | /'
check "dev/cp18 deleted in the main folder and in the clone" \
  "! git -C '$P' rev-parse -q --verify dev/cp18 >/dev/null && ! git -C '$S' rev-parse -q --verify dev/cp18 >/dev/null"
check "the development clone is on main, realigned" \
  "[ \"\$(git -C '$S' branch --show-current)\" = main ] && [ \"\$(git -C '$S' rev-parse main)\" = \"\$(git -C '$P' rev-parse main)\" ]"
check "fix/C-12, not merged, stays" "git -C '$C' rev-parse -q --verify fix/C-12 >/dev/null"
check "demo/cp3, with no commits of its own, stays" "git -C '$P/lanes/acme-demo' rev-parse -q --verify demo/cp3 >/dev/null"
check "the copies of cp18 and b2cp18 are deleted" "[ ! -e '$B/cp18/base' ] && [ ! -e '$B/cp18/main' ] && [ ! -e '$B/b2cp18/base' ]"
check "small files and folders without a copy stay" "[ -f '$B/cp18/prompt.md' ] && [ -d '$B/cp18/probes' ] && [ -f '$B/state/dev.json' ]"
check "the link is not followed" "[ -L '$B/cp18/linked' ] && [ -f '$B/C-12/base/docker-compose.yml' ]"
check "the copies of other jobs stay" "[ -d '$B/C-12/base' ] && [ -d '$B/cp180/base' ] && [ -d '$B/demo-cp3/base' ]"
check "container, network, volume and images of cp18 removed" \
  "grep -q '^docker rm -v acme-cp18-iter-api-1$' '$LOG' && grep -q '^docker network rm acme-cp18-iter_default$' '$LOG' && grep -q '^docker volume rm acme-cp18-iter_pgdata$' '$LOG' && grep -q '^docker rmi acme-cp18-iter-api:latest$' '$LOG' && grep -q '^docker rmi i4$' '$LOG' && grep -q '^docker rmi acme-b2cp18-iter-api:latest$' '$LOG'"
check "the container with no compose project, named after the job, is removed" "grep -q '^docker rm -v acme-cp18-sonda$' '$LOG'"
check "nothing of the protected project, of other jobs or of other projects" \
  "! grep -E 'acme_pgdata|acme-api|acme_default|playwright|c-12|cp180|galoppino|^docker rm -v acme-api|^docker rmi i[2367]' '$LOG'"
check "says the protected volume stays" "grep -q 'the volume acme_pgdata is protected, it stays' '$ROOTDIR/real.txt'"
check "never -f on images, never prune -a" "! grep -E '^docker (rmi|image rm).* -f|prune.*(-a|--all)' '$LOG'"

echo "The queue, under the lock"
for _ in $(seq 50); do grep -q 'cleanup queue finished' "$B/cleanup.log" 2>/dev/null && break; sleep 0.1; done
check "takes the runs' lock" "grep -q '^lockf -k $HOME/.cache/acme-e2e.lock$' '$LOG'"
check "prune -f in rounds, while untagged ones decrease: two rounds" "[ \$(grep -c '^docker image prune -f$' '$LOG') -eq 2 ]"
check "then fstrim" "grep -q '^colima ssh -- sudo fstrim -a$' '$LOG'"
check "the report on the bench" "grep -q 'cleanup queue finished' '$B/cleanup.log'"

echo "Again: nothing to do"
: >"$LOG"
(cd "$P" && "$CLEANUP") >"$ROOTDIR/again.txt"
check "no queue and nothing removed" "! grep -qE '^lockf|^docker (rm|rmi|network rm|volume rm)' '$LOG'"

echo "Italian configuration (old field names) still works"
cat >"$P/.claude/metodo.json" <<'EOT'
{
  "nome": "Acme", "prefisso": "acme", "cartella": "~/code/Acme Two", "cloni": "lanes",
  "binari": [
    { "id": "dev", "nome": "Development", "rami": ["dev/"] },
    { "id": "fixes", "nome": "Fixes", "rami": ["fix/"] },
    { "id": "demo", "nome": "Demo", "rami": ["demo/"], "lavoro": "demo-" }
  ],
  "banco": "~/.cache/acme-review", "copia": "docker-compose.yml", "lucchetto": "~/.cache/acme-e2e.lock",
  "protetti": { "volumi": ["acme_pgdata"], "stack": ["acme"] }
}
EOT
(cd "$P" && "$CLEANUP" --dry-run) >"$ROOTDIR/alias.txt" 2>&1 || true
check "the Italian aliases are read: clones and branches found" "grep -q 'acme-fixes' '$ROOTDIR/alias.txt' && grep -q 'Bench copies left' '$ROOTDIR/alias.txt'"

echo "In the cloud: no main folder, the closed jobs found on origin, no push"
O="$ROOTDIR/origin.git"
R="$ROOTDIR/cloud/reviewer"
K="$ROOTDIR/cloud/coding"
git init -q --bare -b main "$O"
mkdir -p "$ROOTDIR/cloud"
git clone -q "$O" "$R" 2>/dev/null
mkdir -p "$R/.claude"
cat >"$R/.claude/metodo.json" <<'EOT'
{
  "name": "Acme", "prefix": "acme", "root": "~/code/elsewhere", "clones": "lanes",
  "lanes": [
    { "id": "dev", "name": "Development", "branches": ["dev/"] },
    { "id": "fixes", "name": "Fixes", "branches": ["fix/"] },
    { "id": "demo", "name": "Demo", "branches": ["demo/"], "jobPrefix": "demo-" }
  ],
  "bench": "~/.cache/acme-cloud", "copyMarker": "docker-compose.yml", "lock": "~/.cache/acme-e2e.lock",
  "protected": { "volumes": ["acme_pgdata"], "stacks": ["acme"] }
}
EOT
git -C "$R" add . && git -C "$R" commit -q -m start && git -C "$R" push -q origin main
# The reviewer opens the jobs' branches from main and pushes them.
for b in dev/cp18 fix/C-12 demo/cp3 feature/x; do git -C "$R" branch "$b" main && git -C "$R" push -q origin "$b"; done
# The coding sessions work in their own containers and push.
git clone -q "$O" "$K"
for b in dev/cp18 fix/C-12 feature/x; do
  git -C "$K" switch -q "$b" && echo "$b" >"$K/w-${b//\//-}" && git -C "$K" add . && git -C "$K" commit -q -m "$b" && git -C "$K" push -q origin "$b"
done
# The reviewer merges cp18 and feature/x with --no-ff, and has not pushed main yet.
git -C "$R" fetch -q origin
git -C "$R" merge -q --no-ff --no-edit origin/dev/cp18
git -C "$R" merge -q --no-ff --no-edit origin/feature/x
CB="$HOME/.cache/acme-cloud"
mkdir -p "$CB/cp18/base" "$CB/C-12/base" && touch "$CB/cp18/base/docker-compose.yml" "$CB/C-12/base/docker-compose.yml"
: >"$LOG"
check "on the desktop the reviewer's checkout is refused (not the main folder)" "! (cd '$R' && '$CLEANUP' >/dev/null 2>&1)"
(cd "$R" && CLAUDE_CODE_REMOTE=true "$CLEANUP") >"$ROOTDIR/cloud.txt" 2>&1 || ko "the cloud cleanup exits with an error"
cat "$ROOTDIR/cloud.txt" | sed 's/^/    | /'
check "it writes the push that deletes dev/cp18 together with main" "grep -qx '  git push origin main :dev/cp18' '$ROOTDIR/cloud.txt'"
check "it does not push: dev/cp18 is still on origin, main is not" \
  "git -C '$O' rev-parse -q --verify refs/heads/dev/cp18 >/dev/null && [ \"\$(git -C '$O' rev-parse main)\" != \"\$(git -C '$R' rev-parse main)\" ]"
check "the local dev/cp18, with no commits of its own here, is deleted" "! git -C '$R' rev-parse -q --verify refs/heads/dev/cp18 >/dev/null"
check "fix/C-12 (not merged), demo/cp3 (just created) and feature/x (no lane) stay" \
  "! grep -E 'git push.*(C-12|cp3|feature)' '$ROOTDIR/cloud.txt' && git -C '$R' rev-parse -q --verify refs/heads/demo/cp3 >/dev/null && git -C '$R' rev-parse -q --verify refs/heads/fix/C-12 >/dev/null"
check "says demo/cp3 has no commits of its own" "grep -q 'origin: demo/cp3 has no commits of its own' '$ROOTDIR/cloud.txt'"
check "the bench copy of cp18 goes, C-12's stays" "[ ! -e '$CB/cp18/base' ] && [ -d '$CB/C-12/base' ]"
check "cp18's Docker things removed" "grep -q '^docker rm -v acme-cp18-iter-api-1$' '$LOG'"
check "it reminds to archive the coding sessions" "grep -q 'archive them' '$ROOTDIR/cloud.txt'"
git -C "$R" push -q origin main
(cd "$R" && CLAUDE_CODE_REMOTE=true "$CLEANUP" --dry-run) >"$ROOTDIR/cloud2.txt" 2>&1
check "with main pushed, the push only deletes" "grep -qx '  git push origin :dev/cp18' '$ROOTDIR/cloud2.txt'"

echo
if [ $errors -eq 0 ]; then echo "All tests pass (folder: $ROOTDIR)"; else echo "$errors tests fail (folder: $ROOTDIR)"; exit 1; fi
