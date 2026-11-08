---
name: review
description: The method's review rules: planning, reviewing a checkpoint by trying to break it, runs (which tests, how many times), the review bench and the block document. Load it in every session that plans or reviews.
---

# Review

In this file `<main>` is the project's main folder (`root` in `.claude/metodo.json`), `<prefix>` its prefix, `<bench>` the review bench folder, `<lock>` the end-to-end run lock.

## If you are planning or reviewing

- The decision log (if the project has one) is your source: open it before designing, and update it when a decision changes. The documents remain the source of the *what*.
- Reviewing a checkpoint **is not reading the diff: it is trying to break** what was built. What to try, checkpoint by checkpoint, is in the «How it will be verified» section of the block document. Reading a safety rule and proving it are two different things.
- **Runs: the area at every delivery, the whole suite in CI.** At every checkpoint and every correction the whole backend suite runs, and, of the end-to-end projects, the ones of the area, which the section lists in «How it will be verified»: one run per project. All of them run when the work touches a shared file, which the project lists in its «How we work». The whole suite is run by CI after the push; a release starts only from a green CI, and a red CI is attributed to the push's merges with a bisect, and becomes a correction. Chasing red runs that also fail on `main` wastes the effort that belongs to the work.
- **Every run runs once: what costs is not the number of tests, it is the repetitions.** A coding session that repeats whole chains, runs every test on two engines, and reruns a demo already red on `main`, spends hours on repetition. Four rules:
  - **One engine per surface at delivery, all of them in CI.** Where the same tests run on several browser engines, at delivery the one the user uses on that surface runs, and the project writes it in its «How we work»; CI does the others. The exception is work that concerns one engine specifically, like a defect that exists only there: then that one runs.
  - **After a correction the red project runs, not the chain.** Once a red is fixed, or a reviewer finding, the projects that were red and those of the files the correction touched run again; the whole backend only if the correction touches it. The area's chain runs once per delivery.
  - **A red already known on `main` is not rerun.** Before launching, look at the corrections log: a project that is red because of an open correction is skipped, and the report says so with its number. A new red outside the area is not repeated to understand it: it is reported as it came out, with the trace, and goes to the corrections. A test that fails at random is repeated once, and if it comes back green it goes to the corrections anyway.
  - **The reviewer does not redo the session's runs on the same commit.** If `main` has not moved since the delivery, the final lines of the report stand, and the reviewer runs its mutations and the tests the diff touches. If it had to merge `main`, it redoes the area once on the merged code.

  The price is that a red of the second engine, or of a project outside the area, shows up in CI and not at delivery: that is what the bisect and the corrections are there to catch.
- Review **at checkpoints, not when the block is finished**: correcting a foundation that has already been built on means redoing, not correcting.
- The next block's document is written when the previous one is closed, not before.
- **The block document stays light.** A project's first block starts from `templates/block.md` of the plugin; a new block inherits «How we work» from the previous one, delivery check included, and every prompt, checkpoint or correction, ends by asking for `delivery-check`. When a checkpoint closes, the reviewer moves its section to the block's closed file (`docs/blocks/README.md`).

### The review bench

The reviewer tries to break the work on its own bench, never in the clone, whose uncommitted state belongs to the coding session, and never in the development database.

- **Copies live under the home folder**, in `<bench>/<job>/`: container runtimes like Colima mount only the home folder, and a copy in `/private/tmp` arrives empty in the containers. They are made with `rsync`, excluding `.git`, `.claude`, the clones folder, the `node_modules` and the environment files, with exclusions anchored at the root (`/dist`, not `dist`); the `node_modules` with `cp -Rc`, an APFS clone, which shares blocks with the original: `du` on the copies does not measure the disk. Then `git init` and a commit, so every mutation can be restored with `git checkout`, and an empty `git status --porcelain` confirms it.
- **A mutation has landed** if the build passes and the test is red at the expected assertion. A run that goes red before the expected line is read, not retried.
- **A timing variant must be seen red on the old code**, then green on the new: always green proves nothing.
- **Heavy work runs under the lock** while CI is running: `tsc`, `npm`, `cp -Rc` of the `node_modules`. Outside the lock it can turn a timing test of CI red.
- **A script that rewrites environment files**, like CI, is launched only from a copy, never from the main folder or a clone.
- **At the end, nothing is cleaned by hand**: the copies, containers, volumes and images of the job are removed by the close-out cleanup, if they have the right names.
