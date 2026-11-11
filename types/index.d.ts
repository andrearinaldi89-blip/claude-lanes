// A project's configuration: `.claude/metodo.json`, in the main folder and, since it is
// committed, in every clone. The README says what each field means.
// The file is read through `normalize`, which also accepts the legacy Italian field names.
export type Configuration = {
  name: string
  prefix: string
  root: string
  clones: string
  lanes: { id: string; name: string; branches: string[]; jobPrefix?: string }[]
  bench: string
  copyMarker?: string
  lock: string
  protected?: { volumes?: string[]; stacks?: string[]; folders?: string[] }
  release?: string[]
  jobs?: Record<string, { lane: string; what: string }>
  deliveryChecks?: string[]
  docs?: { blocks?: string; corrections?: string }
}

// The project as the mod uses it: paths already absolute.
export type Project = {
  name: string
  prefix: string
  root: string
  clones: string
  lanes: { id: string; name: string }[]
  bench: string
  lock: string
  jobs: Record<string, { lane: string; what: string }>
}

export type Activity = 'working' | 'idle' | 'permission'

// The last message between sessions seen by the lane's coding session.
export type Handoff = {
  direction: 'in' | 'out'
  text: string
  peer: string
  at: number
}

// What a session notes about itself: the coding session in <bench>/state/<lane>.json,
// every other session of the project, which may be a lane's reviewer, in state/reviews/<id>.json.
export type Annotation = {
  activity?: Activity
  activitySince?: number
  handoff?: Handoff
  senders?: Record<string, string>
  // The session id, the one carried by messages between sessions.
  session?: string
  // Of the coding session: the conversation already has a turn and has not been cleaned since.
  // Absent until the mod has seen it: then nobody knows, and nothing is blocked.
  dirty?: boolean
  // Of the coding session: the conversation's id, which a /clear changes.
  conversation?: string
  // Of the reviewer: the lane of its last thing, a message or a job, and the job.
  lane?: string
  what?: string
  whatSince?: number
}

// The lane's reviewer as the mod shows it, with its running commands and its end-to-end run.
export type Review = {
  session: string
  name: string
  activity: Activity
  activitySince: number
  what: string | null
  whatSince: number | null
  commands: Command[]
  run: Run | null
}

// A command started by the coding session and still running, in the foreground or background;
// several copies of the same command are a single row, from the oldest.
export type Command = { what: string; text: string; since: number; count: number }

// An end-to-end run: who holds the lock and who is queued; of the lane's reviewer, if it has the id.
export type Run = { who: string; lane: string | null; review: string | null; holds: boolean; since: number }

// The job open on the lane, as the first line of its prompt in the bench says:
// «checkpoint 19 of block 1», «C-21», and the title, if there is one.
export type Job = { checkpoint: string; description: string | null }

export type Lane = {
  id: string
  name: string
  branch: string
  slug: string | null
  job: Job | null
  ahead: number
  dirtyFiles: number
  last: { at: number; text: string } | null
  activity: Activity | null
  activitySince: number | null
  // Activity inferred from the transcript, because the session does not annotate.
  estimated: boolean
  handoff: Handoff | null
  // The job is closed, with the clone back on main or the close-out arrived, but the session still has its conversation.
  toClean: boolean
  review: Review | null
  commands: Command[]
  run: Run | null
}

export type State = {
  project: string
  lanes: Lane[]
  push: number
  e2e: Run[]
  read: number
}
