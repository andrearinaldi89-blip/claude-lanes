# Block N — Name

<!-- The method's block document template (metodo:review). A project's first block starts from here; later blocks inherit «How we work» from the previous one. Italic parts and UPPERCASE names are replaced: CLONE is the lane's clone folder, <main>/<clones>/<prefix>-<lane>, and BENCH the prompts folder, <bench>/<prefix>-<lane>, both from .claude/metodo.json. -->

**What the block delivers and why it exists:** [`../../ROADMAP.md`](../../ROADMAP.md) §Block N.
**What to build:** the paragraphs of the authoritative documents, linked, not copied.
**Here:** the breakdown into checkpoints, the order, where to stop and how each one will be verified.

**Status:** *(updated only by the reviewer, at close-out)*

---

## How we work

From the second block on: «The «How we work» of the previous block applies, line by line, delivery check included. In addition, for this block: …». For the first one, these lines, each of which cost a round of review somewhere, with the project's own in their place:

- **The lane is development**: work in the clone `CLONE`, on branch `development/cpNN`, which the reviewer creates from the latest `main`. Never in the main folder. The merge to `main` is done by the reviewer, after the «Verification».
- **A plan first**, then the code: for every item what changes, the test, and the mutation with which it will be seen red. All the checkpoint's items go in the plan, one by one. A redone plan replaces the previous one, and keeps its right parts too.
- **Every test is seen red** by breaking the thing it watches, and the mutation breaks **only** that. The report gives the line of the assertion that went red: a red that comes from another line proves nothing.
- **A wait that a mutation can block has its own timeout.** Without one, the test waits until its own timeout, and the red arrives without a line.
- **Mutations do not enter the suite.** They are applied one at a time to a throwaway copy, and the real test is watched. A script that runs them calls «red» only a failure at the expected line, and checks that the same test is green without the mutation.
- **Never mutate the working tree.** Mutations are made on a copy: a mutation in the tree ends up in the next run and in the commit.
- **Runs**: *which commands, and where they run: the end-to-end stack, never the development environment, one run at a time with the project's lock; or, with no stack, the test commands.* At every delivery the whole backend suite and the area's end-to-end projects, the ones the section lists, one run each; all of them, if the work touches a shared file: *which they are, in the project*. One engine per surface: *which one runs at delivery, and which only in CI*. Every run once: after a correction the red project reruns, not the chain, and a red already known on `main` is skipped and named. The whole suite is run by CI after the push (`METHOD.md`, «Runs»). The report gives their final lines.
- *The project's lines: real data that a test never touches, the compose project of the end-to-end stack, what the project's documents ask of every job.*
- **Preparation requests for a test look at their answer.** One that fails silently takes the case away from the test without changing its color.
- **The report says what happened**: the real output of the commands, and the «Done» as written. A summary from memory is not a report.
- **A test does not build its own evidence.** It looks at what the application wrote, not at what the test wrote.
- **Teardown** that reads the ids before the assertions and does not swallow errors.
- **No test parameter lowered**: how many parallel requests, how many rounds, which thresholds.
- **At least one concurrent test for every shared resource**, with the real server and connections already open.
- **Tests create their own data** and choose it by name: a test that lives on another's data cannot be run alone.
- **Before delivering, a clean-context check.** After the last run and the «Done», the session launches the method's `delivery-check` sub-agent (`metodo:delivery-check`) with the section, the starting commit and the folder. Gaps are fixed before the report, and its answer, as it came out, goes in the report.
- **The rules that do not rely on memory** are enforced by the method's guard, with what `.claude/metodo.json` protects. If it blocks a command you need, stop and say so: do not work around it.
- **Every run of a mutation goes in the report**, not the last: a mutation that stayed green even once is a sign the defect is missed, and is written with the why.
- If code and document diverge, **the document in the same commit**. The «Done» is written under the checkpoint's section, and the verification sections are not touched.

For every checkpoint that touches the interface, in a project that has `docs/DESIGN.md`, in addition:

- **The interface follows [`../DESIGN.md`](../DESIGN.md).** A component that exists is used, not remade; a color, radius or size that is not a token is not written; a new text follows the glossary. If something is needed that `DESIGN.md` does not have, it is added there in the same commit, not in the page.
- **Two screenshots in the report**, phone (375 px) and computer (1280 px), of every page touched, taken from the test stack, with invented data and never of real people.
- **Keyboard and finger are tested**: no target under 44 px, no text under 12 px, and new dialogs pass the keyboard test (Tab stays inside, Escape closes, focus returns to where it started).
- **One page at a time, and every page is delivered green.** The `data-testid`s that exist do not change.
- **No new behavior hidden in a rewrite.** If today's rule is a defect, it is corrected because `DESIGN.md` asks for it and written in the «Done»; if it is a choice, it is done as `DESIGN.md` says and not otherwise.

---

## The prompt

One per checkpoint. The reviewer writes it in a file in `BENCH/` and sends it to the session open in the clone, with its own id in place of `REVIEWER_ID` (`metodo:handoffs`, «Handoffs between sessions»). The first line of the message is «Prompt for…».

```text
Prompt for checkpoint N of block N.
Work in the clone CLONE, on branch development/cpNN, from commit ABCDEF.
First get your bearings: confirm branch and commit, that the tree is clean,
and read the «Done» of the last closed checkpoint. If anything does not match,
stop and tell the reviewer.
Implement checkpoint N of docs/blocks/N-name.md.
Read that document and the sections it points to. Do not go beyond the checkpoint.
Before writing code, present a plan: for every item what changes,
the test, and the mutation with which you will see it red.
Send the plan, the questions and the report to the reviewer, the session
REVIEWER_ID that is sending you this prompt, with SendMessage, as
«Handoffs between sessions» of the method says, and then stop: the answer
arrives as a message.
No plan mode: until the ok, you only read.
If a spec is ambiguous, incomplete or wrong, stop and report it
to the reviewer instead of deciding it yourself.
Before the report, launch the delivery-check sub-agent
and fix what it finds.
```

---

## The checkpoints

| # | What | Status |
|---|---|---|

### Checkpoint 1 — Title

**To do:** in order.

**Does not do:**

**Stops when:**

**How it will be verified:** what the reviewer will try to break, and with which mutation every test is seen red; the area's end-to-end projects, which run whole at delivery, once, on the delivery engine. If it touches the interface: two screenshots in the report, phone (375 px) and computer, of every page touched; no target under 44 px and no text under 12 px; new dialogs pass the keyboard test (Tab stays inside, Escape closes, focus returns); at review, the pages on a real phone.

**Done:** <!-- TO FILL --> *(written by the coding session: the real outputs, every run, every mutation)*

**Verification:** *(written by the reviewer)*

---

## Block close-out

The criteria are in [`../../ROADMAP.md`](../../ROADMAP.md) §Block N. Before opening the next block: documents aligned with what exists, contradicted decisions carried back into the decision log (or to the owner, where there is no log), this block's test notes sorted, and the next block's document written then.
