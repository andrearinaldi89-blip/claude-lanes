# Configuration

`.claude/metodo.json`, committed in the repository so that the clones read it too. Paths may start with `~`. Start from [`templates/metodo.json`](../templates/metodo.json).

The same file serves the desktop and the cloud (Claude Code on the web): nothing in it says which, because the plugin recognizes the cloud by itself (`CLAUDE_CODE_REMOTE=true`). In the cloud some fields do not apply and two more do; the last column says so.

| Field | What it says | In the cloud |
|---|---|---|
| `name` | the project name, as shown by `/lanes-status` and notifications | the same |
| `prefix` | the prefix of everything a job creates (bench folders, clones, Docker projects): short, lowercase, no other project's | the same, and the sessions' tags `metodo:<prefix>…` |
| `root` | the main folder | required but not used: the project is the session's checkout |
| `model` | the model of the coding sessions, which `clones.sh` writes into the clones; if unset, `claude-sonnet-5-5` | the `model` the reviewer passes to `create_session` |
| `clones` | the folder of the clones inside the main folder: a lane's clone is `<root>/<clones>/<prefix>-<id>` | required but not used: there are no clones |
| `lanes` | one entry per lane: `id`, `name`, the `branches` prefixes it owns and, if needed, a `jobPrefix` (`demo-`) put in front of the job name | the same: the branch prefixes are how a coding session, a push and a closed job are recognized |
| `bench` | the review bench folder, `~/.cache/<prefix>-review` | in the reviewer's container; it also holds `state/cloud.json`, the guard's notes on the coding sessions |
| `copyMarker` | the file that makes a bench subfolder a copy of the repository; if unset, `CLAUDE.md` | the same |
| `lock` | the end-to-end run lock, `~/.cache/<prefix>-e2e.lock` | in the reviewer's container |
| `protected.volumes` | Docker volumes that are never deleted, such as the development database | the same |
| `protected.stacks` | compose projects whose volumes are never deleted | the same |
| `protected.folders` | folders where a file already on `main` is not modified, such as migrations | the same |
| `release` | regular expressions of the commands that go to production: they start only from the main folder on `main`, with confirmation | from `main`, with confirmation |
| `jobs` | the skills that make a session the reviewer of a lane: `{ "skill": { "lane", "what" } }` | the same |
| `deliveryChecks` | the `delivery-check` items that are the project's own | the same |
| `docs.blocks`, `docs.corrections` | optional: where the block documents and the corrections log live (defaults `docs/blocks` and `docs/corrections.md`) | the same |
| `docs.handoffs` | optional, cloud only: the folder on the job's branch with the prompt and the clarifications, `<handoffs>/<lane>/<job>/` (default `docs/handoffs`) | where the reviewer writes them and the lanes mod reads the job's title |
| `repository` | optional, cloud only: the repository's URL | the `source_url` the reviewer passes to `create_session` |
