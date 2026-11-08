# Maintaining the plugin

## The method is changed only here

A method copied file by file into several projects diverges within days, the same way duplicated facts in project documents end up contradicting each other. That is why **a project keeps no copy of the method**: it keeps its configuration, its own rules, and the line that imports `METHOD.md`. An improvement found in a project is brought here, and holds for all.

To change the method:

1. Change it here, and test the pieces touched:
   ```bash
   claude plugin test .
   ```
   ```bash
   python3 -m unittest discover -s tests -p '*_test.py'
   ```
   ```bash
   bash tests/cleanup_test.sh
   ```
2. Raise the version in `.claude-plugin/plugin.json` and commit.
3. Update the installed plugin; sessions already open pick up the new mod on the first turn after the update:
   ```bash
   claude plugin marketplace update metodo && claude plugin update metodo@metodo
   ```
4. Pushing is the owner's call.

A plugin installed from a local folder is read in place, without copying: a change takes effect from the first session opened afterwards, or after `/reload-plugins`, even without a new version. So change it only by committing, and let the version say which method is running.

## What is where

| | |
|---|---|
| `METHOD.md` | the core of the method, imported by every `CLAUDE.md`: what every session needs |
| `skills/` | the rules of a phase, loaded only by whoever enters it: `review`, `lanes`, `handoffs`, `design` |
| `hooks/register.tsx` | the lanes mod: the line above the prompt, `/lanes`, the panel and the `mcp__metodo__status` tool; the coding session's `/clear` at the «Close-out…», the refusal of a new job's prompt toward a still-dirty session, and the wake-up of a coding session the app closed for memory |
| `hooks/guard.py` | the guard: the rules that do not depend on anyone's memory (`METHOD.md`, «If you are writing code»), including `git push` only from the main folder |
| `hooks/delivery.py` | the delivery gate (Stop hook): a «Delivery of…» from a clone does not go out without `delivery-check` and without the «Done» |
| `hooks/startup.sh` | the coding session's orientation (SessionStart hook): branch, commit, tree, distance from `origin/main` |
| `agents/delivery-check.md` | the sub-agent that rereads the delivery before the review |
| `scripts/cleanup.sh` | the close-out cleanup: branches, bench, Docker, `fstrim` |
| `scripts/clones.sh` | prepares the lanes' clones inside the main folder |
| `templates/` | the starting configuration, the decision log page, the `DESIGN.md` skeleton and the block document |
| `tests/` | the tests of the three pieces |

The plugin is installed once at user level: the mod and the guard run in every session, and act only where they find `.claude/metodo.json`.

## Notes for a project that uses the plugin

- If a project has its own hook in `.claude/settings.json`, it must not repeat the plugin's guard.
- If a Docker build starts from the repository root, the clones folder also goes in `.dockerignore`.
- The first time a session meets the `@…/METHOD.md` import, in the main folder and in every clone, Claude Code asks to approve it, and it has to be approved. If refused it does not ask again, and `METHOD.md` stays out: in `~/.claude.json` the folder has `hasClaudeMdExternalIncludesApproved` set to `false`.
