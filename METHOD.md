# The method

This file belongs to the `metodo` plugin, and every project that uses it imports it from its `CLAUDE.md`. It applies to all projects the same way: **the method is changed only in the plugin**, never in a project (see the plugin README). The project's own `CLAUDE.md` keeps what is the project's: what it is, its constraints, its stack, its documents, its sources, and where it does things differently from here. The project's names, folders and guard rules live in `.claude/metodo.json`.

This file holds only what **every** session needs. The rules of a phase live in the plugin's skills, which are loaded when that phase starts, not before:

| Phase | Skill | When to load it |
|---|---|---|
| planning, reviewing a checkpoint, runs, the bench | `metodo:review` | before designing or reviewing a delivery |
| opening, closing, cleaning up a job; clones, merges, release, push, names | `metodo:lanes` | before creating a branch, merging, or doing the close-out cleanup |
| messages between reviewer and coding session, close-outs, notifications; in the cloud, opening and archiving coding sessions | `metodo:handoffs` | before sending or answering a message between sessions |
| `docs/DESIGN.md`, accessibility thresholds, UI review | `metodo:design` | for a checkpoint that touches the interface, or a UI review |

A coding session loads none of these: what it needs is below and in «How we work» in the block document.

---

## The decision log

The decision log is **optional**. If the project keeps one, it has one entry per decision, and its address is in the project's `CLAUDE.md`. It can be an artifact (the page in `templates/decision-log.html`, read and written with `ArtifactData`) or, with no artifact at all, a plain file, `docs/decisions.md`. The README explains both.

With the artifact: collection `points` holds one entry per decision (`status`, `decision`); collection `comments` holds the discussion (`pointIds`, `author`, `text`). A new entry is written only in the database, with `set` on `points` and an id made of the area letter plus a number (`A1`, `B3`): `title`, `ctx` (the issue), `rec` (the recommendation) and `refs` (the sources) as plain text, `flag: true` if it is structural. The page writes `status` (`open`, `discussion`, `closed`), `decision` (the minutes) and `updatedAt`. A comment is `comments/<id>` with `pointIds`, `author` (`you` or `claude`), `text` and `createdAt` in milliseconds. Writes to a document that already exists carry `if_version`. The areas belong to the project and are listed in its `CLAUDE.md`.

> **Rule:** the log is the source of the **why**, the documents are the source of the **what**. Do not duplicate reasons in the documents: the same thing written in several places drifts apart.

Update the log when a decision changes.

---

## Reviewing sessions and coding sessions

The work is split across different sessions. **The handoff is the repository, not the chat:** if something is not in a document, for the coding session it does not exist.

**If you are writing code:**

- **First, get your bearings**: `git branch --show-current` and `git status --short` in the clone, and the «Done» of the last closed checkpoint. The branch is the one in the prompt and the tree is clean; if not, stop and tell the reviewer. The plugin's startup hook prints these when the session opens.
- Read the **documents**, not the decision log. The log matters when a decision has to be *changed*; the documents say what to build. Opening it to implement is wasted time.
- **One checkpoint at a time** from the block document, in `docs/blocks/`. The block's «Does not do» section in `ROADMAP.md` binds as much as the rest.
- A block is finished when its **acceptance tests** are green, not when the code runs.
- **Never modify an already-applied file in a protected folder**, such as a migration: add a new one. The folders are in `protected.folders` of `metodo.json`. The method's guard blocks it, together with a `docker compose` that deletes volumes without naming its project, protected volumes, `prune -a`, a release from outside the main folder, and a `git push` from a clone: if it blocks you, stop and say so, do not work around it.
- **Before delivering, the `delivery-check` sub-agent** of the method (`metodo:delivery-check`) rereads the work against its section: how, in «How we work» of the block document. A report that starts with «Delivery of…» without that check and without the «Done» written is stopped by the plugin's delivery hook.
- If code and document diverge, the document is updated **in the same commit**.
- If you run into something that contradicts a **decision** — not a detail: a decision — **stop and write it down**, do not decide it yourself. It has to be discussed where the why lives.

**Not to be done in a coding session:** changing a decision, writing in the decision log, changing the data schema beyond what the documents say, implementing the observations in `docs/blocks/test-notes.md`, which are sorted at the end of the block.

**If you are planning or reviewing:** load `metodo:review` before starting, `metodo:lanes` when you open or close a job, and `metodo:handoffs` before writing to the coding session. In two lines: the decision log is your source; reviewing means trying to break things, at each checkpoint and not when the block is finished; every run runs once; the merge to `main` and the close-out are done by the reviewer, and the owner stays where they are needed (the go-ahead, every decision, the push, the release).

---

## When you compact

After a compaction, the rule the session remembers is the last one it saw, not the method's: that is how prompts get sent without a «Close-out…». In the summary, always keep at the top: the lane and the open job (branch, starting commit, folder), where the cycle stands (prompt, plan, ok, delivery, close-out) and what is awaited, the ids of the reviewing session and the coding session (in the cloud, the `session_…` id of the job's coding session and whether it is archived), the files touched and the run commands with their final lines. After compacting, before sending a message between sessions, reload `metodo:handoffs`.

---

## Design

The interface has its own document, `docs/DESIGN.md`, which owns *how it looks and how it behaves*: tokens, components, glossary. The rules, the accessibility thresholds and the UI review are in `metodo:design`. For a coding session, «How we work» in the block is enough: a component that exists is used, a value that is not a token is not written, what is missing is added to `DESIGN.md` in the same commit.
