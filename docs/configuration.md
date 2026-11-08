# Configuration

`.claude/metodo.json`, committed in the repository so that the clones read it too. Paths may start with `~`. Start from [`templates/metodo.json`](../templates/metodo.json).

| Field | What it says |
|---|---|
| `name` | the project name, as shown by `/lanes` and notifications |
| `prefix` | the prefix of everything a job creates (bench folders, clones, Docker projects): short, lowercase, no other project's |
| `root` | the main folder |
| `model` | the model of the coding sessions, which `clones.sh` writes into the clones; if unset, `claude-sonnet-5-5` |
| `clones` | the folder of the clones inside the main folder: a lane's clone is `<root>/<clones>/<prefix>-<id>` |
| `lanes` | one entry per lane: `id`, `name`, the `branches` prefixes it owns and, if needed, a `jobPrefix` (`demo-`) put in front of the job name |
| `bench` | the review bench folder, `~/.cache/<prefix>-review` |
| `copyMarker` | the file that makes a bench subfolder a copy of the repository; if unset, `CLAUDE.md` |
| `lock` | the end-to-end run lock, `~/.cache/<prefix>-e2e.lock` |
| `protected.volumes` | Docker volumes that are never deleted, such as the development database |
| `protected.stacks` | compose projects whose volumes are never deleted |
| `protected.folders` | folders where a file already on `main` is not modified, such as migrations |
| `release` | regular expressions of the commands that go to production: they start only from the main folder on `main`, with confirmation |
| `jobs` | the skills that make a session the reviewer of a lane: `{ "skill": { "lane", "what" } }` |
| `deliveryChecks` | the `delivery-check` items that are the project's own |
| `docs.blocks`, `docs.corrections` | optional: where the block documents and the corrections log live (defaults `docs/blocks` and `docs/corrections.md`) |
