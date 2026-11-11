import type { Color, EngineInterface, Register } from 'claude-code'

import type {
  Activity,
  Annotation,
  Command,
  Configuration,
  Handoff,
  Job,
  Lane,
  Project,
  Review,
  Run,
  State,
} from '../types'

// The state of the lanes of every project that uses metodo. The project is described by
// `.claude/metodo.json`, found by walking up from the session's folder: its lanes, the clones,
// the bench and the lock. The mod reads everything itself from the clones (branch, commits,
// uncommitted files), from the main repository (pending pushes) and from the processes (each
// coding session's running commands, the end-to-end runs and their lock); the activity and the
// last message between sessions are noted by the mod itself in each lane's coding session.
// Every other session of the project also notes its activity, and the lane it reviews for the
// last thing it did: a message from or to its coding session, or a job it started, such as a
// skill listed under `jobs` in the configuration.

const PANEL = 'lanes'
const EVERY_MS = 30_000

let home = ''
// The folder the mod has oriented itself on: the app starts sessions in a spare folder
// (~/.claude/spares/…) and moves them into the project afterwards, without another session.start.
let seenCwd: string | null = null
// The latest reads, by main folder: everything is re-read every 30 s, so reloading the mod loses nothing.
const latest = new Map<string, State>()
// The session's project, if it is in its main folder or in one of its clones.
let myProject: Project | null = null
// The projects that the line, the panel and the timer follow: the session's, or those asked of /lanes-status.
let followed: Project[] = []
// The lane this is the coding session of, if it is one.
let mine: string | null = null
// Where this session notes its activity: the coding session in the lane's file, the others in the project's own.
let myFile: string | null = null
let timer: { cancel: () => void } | null = null
let queue: Promise<unknown> = Promise.resolve()
let myActivity: Activity | null = null
// The last message received was the cycle's close-out: at the end of the turn the coding session cleans itself.
let closedOut = false
// The protocol's first lines are recognised in English and in Italian, whatever language the messages are written in.
const CLOSEOUT = /^Close-?out of |^Chiusura (del|della) /
// The first line of a new job. «Lavoro nuovo» / «New work» are not a first line of the method, but
// the one a reviewer wrote when it skipped the close-out.
const PROMPT = /^(Prompt (for|del|della|dei|delle|degli)|Lavoro nuovo|New work)\b/

const expand = (path: string) => path.replace(/^~(?=\/|$)/, home)
const inside = (path: string, dir: string) => path === dir || path.startsWith(`${dir}/`)
const folder = (p: Project, id: string) => `${p.root}/${p.clones}/${p.prefix}-${id}`
const annotationFile = (p: Project, id: string) => `${p.bench}/state/${id}.json`
const reviewsDir = (p: Project) => `${p.bench}/state/reviews`
const laneName = (p: Project, id: string) => p.lanes.find(l => l.id === id)?.name ?? id
// A path in a command's text: as is, or with the spaces preceded by a backslash.
const names = (text: string, dir: string) => [`${dir}/`, `${dir.replaceAll(' ', '\\ ')}/`].some(d => text.includes(d))

// The output even when the command exits with an error: lsof exits with 1 if one of the pids is gone.
async function run($: EngineInterface, argv: string[]): Promise<string> {
  try {
    return (await $.process.run(argv)).stdout.trim()
  } catch {
    return ''
  }
}

async function readJson<T>($: EngineInterface, file: string): Promise<T | null> {
  try {
    return JSON.parse(await $.fs.read(file)) as T
  } catch {
    return null
  }
}

// A file that is not there is empty.
async function readText($: EngineInterface, file: string): Promise<string> {
  try {
    return await $.fs.read(file)
  } catch {
    return ''
  }
}

const readAnnotation = async ($: EngineInterface, file: string) => (await readJson<Annotation>($, file)) ?? {}

type Raw = Record<string, unknown>
const isRaw = (x: unknown): x is Raw => typeof x === 'object' && x !== null && !Array.isArray(x)
// Canonical English field first; the legacy Italian one is the alias.
const pick = (r: Raw, en: string, it: string): unknown => r[en] ?? r[it]
const strings = (x: unknown): string[] | undefined => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : undefined)

// Reads `.claude/metodo.json`: the canonical English fields, or the Italian aliases; if both are there, the English wins.
// Returns null when a required field is missing.
export function normalize(raw: unknown): Configuration | null {
  if (!isRaw(raw)) return null
  const name = pick(raw, 'name', 'nome')
  const prefix = pick(raw, 'prefix', 'prefisso')
  const root = pick(raw, 'root', 'cartella')
  const clones = pick(raw, 'clones', 'cloni')
  const bench = pick(raw, 'bench', 'banco')
  const lock = pick(raw, 'lock', 'lucchetto')
  const lanesRaw = pick(raw, 'lanes', 'binari')
  if (
    typeof name !== 'string' ||
    typeof prefix !== 'string' ||
    typeof root !== 'string' ||
    typeof clones !== 'string' ||
    typeof bench !== 'string' ||
    typeof lock !== 'string' ||
    !Array.isArray(lanesRaw)
  )
    return null
  const lanes = lanesRaw.flatMap(l => {
    if (!isRaw(l)) return []
    const id = l.id
    const laneName = pick(l, 'name', 'nome')
    if (typeof id !== 'string' || typeof laneName !== 'string') return []
    const jobPrefix = pick(l, 'jobPrefix', 'lavoro')
    return [
      {
        id,
        name: laneName,
        branches: strings(pick(l, 'branches', 'rami')) ?? [],
        ...(typeof jobPrefix === 'string' ? { jobPrefix } : {}),
      },
    ]
  })
  const config: Configuration = { name, prefix, root, clones, lanes, bench, lock }
  const copyMarker = pick(raw, 'copyMarker', 'copia')
  if (typeof copyMarker === 'string') config.copyMarker = copyMarker
  const protectedRaw = pick(raw, 'protected', 'protetti')
  if (isRaw(protectedRaw)) {
    config.protected = {
      volumes: strings(pick(protectedRaw, 'volumes', 'volumi')),
      stacks: strings(pick(protectedRaw, 'stacks', 'stack')),
      folders: strings(pick(protectedRaw, 'folders', 'cartelle')),
    }
  }
  const release = strings(pick(raw, 'release', 'rilascio'))
  if (release) config.release = release
  const deliveryChecks = strings(pick(raw, 'deliveryChecks', 'consegna'))
  if (deliveryChecks) config.deliveryChecks = deliveryChecks
  const jobsRaw = pick(raw, 'jobs', 'lavori')
  if (isRaw(jobsRaw)) {
    config.jobs = {}
    for (const [skill, j] of Object.entries(jobsRaw)) {
      if (!isRaw(j)) continue
      const lane = pick(j, 'lane', 'binario')
      const what = pick(j, 'what', 'cosa')
      if (typeof lane === 'string' && typeof what === 'string') config.jobs[skill] = { lane, what }
    }
  }
  if (isRaw(raw.docs)) {
    config.docs = {
      ...(typeof raw.docs.blocks === 'string' ? { blocks: raw.docs.blocks } : {}),
      ...(typeof raw.docs.corrections === 'string' ? { corrections: raw.docs.corrections } : {}),
    }
  }
  return config
}

async function readConfiguration($: EngineInterface, dir: string): Promise<Configuration | null> {
  return normalize(await readJson<unknown>($, `${dir}/.claude/metodo.json`))
}

function projectFrom(c: Configuration): Project {
  return {
    name: c.name,
    prefix: c.prefix,
    root: expand(c.root),
    clones: c.clones,
    lanes: c.lanes.map(({ id, name }) => ({ id, name })),
    bench: expand(c.bench),
    lock: expand(c.lock),
    jobs: c.jobs ?? {},
  }
}

// A folder's project: the first configuration found walking up. In a clone it is the one at its
// commit, and the main folder's applies; a copy outside the main folder does not belong to the project.
async function findProject($: EngineInterface, cwd: string): Promise<Project | null> {
  for (let d = cwd; d.length > 1; d = d.slice(0, d.lastIndexOf('/')) || '/') {
    const c = await readConfiguration($, d)
    if (c === null) continue
    const root = expand(c.root)
    const real = root === d ? c : await readConfiguration($, root)
    return real !== null && inside(cwd, root) ? projectFrom(real) : null
  }
  return null
}

// The projects seen by this mod, in every session: /lanes-status shows them even from any chat.
async function allProjects($: EngineInterface): Promise<Project[]> {
  const seen = ((await $.store.get('projects')) as string[] | undefined) ?? []
  const read = await Promise.all(seen.map(dir => readConfiguration($, dir)))
  const projects = read.flatMap(c => (c === null ? [] : [projectFrom(c)]))
  if (myProject !== null && !projects.some(p => p.root === myProject?.root)) projects.unshift(myProject)
  return projects
}

async function remember($: EngineInterface, p: Project) {
  const seen = ((await $.store.get('projects')) as string[] | undefined) ?? []
  if (!seen.includes(p.root)) await $.store.set('projects', [...seen, p.root])
}

// The projects being talked about: those the arguments name, or the session's, or all.
async function choose($: EngineInterface, asked: string): Promise<Project[]> {
  const word = asked.trim().toLowerCase()
  if (word === '' && myProject !== null) return [myProject]
  const projects = await allProjects($)
  return word === '' ? projects : projects.filter(p => p.name.toLowerCase().includes(word) || p.prefix.toLowerCase() === word)
}

// One write at a time: a message and the start of a turn arrive together.
function annotate($: EngineInterface, change: (a: Annotation, now: number) => Annotation) {
  const file = myFile
  if (file === null) return queue
  return (queue = queue
    .then(async () => {
      const now = await $.clock.now()
      const next = change(await readAnnotation($, file), now)
      await run($, ['mkdir', '-p', file.slice(0, file.lastIndexOf('/'))])
      await $.fs.write(file, JSON.stringify(next))
    })
    .catch(() => {}))
}

// The conversation's id: a /clear changes it, a session the app resumes keeps it.
async function conversationOf($: EngineInterface): Promise<string | undefined> {
  try {
    return (await $.session.id()) || undefined
  } catch {
    return undefined
  }
}

// Which project and which lane the session belongs to, and where it notes.
async function orient($: EngineInterface, cwd: string) {
  seenCwd = cwd
  myProject = await findProject($, cwd)
  mine = myProject && laneOf(myProject, cwd)
  // The id that messages between sessions carry in their «from».
  const session = (await $.env.get('CLAUDE_CODE_HOST_SESSION_ID')) ?? (await $.session.id())
  const conversation = mine === null ? undefined : await conversationOf($)
  myFile = myProject === null ? null : mine !== null ? annotationFile(myProject, mine) : `${reviewsDir(myProject)}/${session}.json`
  // A new session in the clone starts clean, and so does a new conversation in the same session:
  // a /clear from the app on a session it had closed never reaches session.end, because no process
  // is there to hear it. The same conversation, reloaded or resumed, stays as it was.
  await annotate($, a => {
    const another = a.conversation !== undefined && conversation !== undefined && a.conversation !== conversation
    const isNew = mine !== null && (a.session !== session || another)
    return { ...a, session, ...(isNew ? { dirty: false } : {}), ...(conversation !== undefined ? { conversation } : {}) }
  })
  if (myProject !== null) {
    await remember($, myProject)
    follow($, [myProject])
  }
}

// The session changed folder after it started: orient again.
async function reorient($: EngineInterface) {
  let cwd: string | null = null
  try {
    cwd = await $.session.cwd()
  } catch {
    return
  }
  if (cwd && cwd !== seenCwd) await orient($, cwd)
}

// A message from another session that reached the coding session. The one that reopens a session
// the app had closed arrives as the first prompt, without session.receive: turn.start sees it,
// and one already noted is not noted twice.
async function received($: EngineInterface, text: string) {
  const m = readMessage(text)
  closedOut = CLOSEOUT.test(m.line)
  await annotate($, (a, now) =>
    a.handoff?.direction === 'in' && a.handoff.text === m.line && a.handoff.peer === m.peer
      ? a
      : {
          ...a,
          senders: m.from ? { ...a.senders, [m.from]: m.peer } : a.senders,
          handoff: { direction: 'in', text: m.line, peer: m.peer, at: now },
        },
  )
}

function annotateActivity($: EngineInterface, activity: Activity) {
  myActivity = activity
  annotate($, (a, now) => ({ ...a, activity, activitySince: now }))
}

// Outside the clones, a message from or to a lane's coding session makes this its reviewer;
// whatever it was doing for the previous lane is over.
async function exchange($: EngineInterface, peer: string) {
  const p = myProject
  if (p === null || mine !== null || peer === '') return
  const code = await Promise.all(p.lanes.map(l => readAnnotation($, annotationFile(p, l.id))))
  const lane = p.lanes.find((_, i) => code[i]?.session === peer)?.id
  if (lane !== undefined) await annotate($, ({ what, whatSince, ...a }) => ({ ...a, lane }))
}

// The name of the lane whose coding session is `peer`, if it still has the previous conversation.
async function dirtyLane($: EngineInterface, peer: string): Promise<string | null> {
  const p = myProject
  if (p === null || mine !== null || peer === '') return null
  const code = await Promise.all(p.lanes.map(l => readAnnotation($, annotationFile(p, l.id))))
  const l = p.lanes.find((_, i) => code[i]?.session === peer && code[i]?.dirty === true)
  return l?.name ?? null
}

const refusal = (name: string) =>
  [
    `Not sent: the coding session of ${name} still has the conversation of the previous job, and the prompt of a new job only goes to a clean session.`,
    'First send the «Close-out of…» of the closed job, with notify_when_idle: at the end of the turn the session cleans itself.',
    'When notified, ask for the lanes status (mcp__metodo__status): when it no longer says «to clean» for that lane, send this prompt again.',
    'If it stays to clean, the session is waiting for the owner or stopped earlier: tell the owner, and do not send the same message.',
    'A message of the same job does not start with «Prompt for…».',
  ].join(' ')

// The first line that says what the message is («Plan for C-12»), and who sends it.
function readMessage(text: string): { from: string; peer: string; line: string } {
  const envelope = text.match(/<cross-session-message\b([^>]*)>/)
  const attribute = (name: string) => envelope?.[1]?.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? ''
  const body = envelope ? text.slice((envelope.index ?? 0) + envelope[0].length) : text
  const line =
    body
      .split('\n')
      .map(r => r.replace(/^[\s#>*-]+|[\s*]+$/g, ''))
      .find(r => r !== '' && !r.startsWith('<') && !r.startsWith('Another Claude session')) ?? ''
  return { from: attribute('from'), peer: attribute('name'), line: line.slice(0, 120) }
}

const laneOf = (p: Project, path: string) => p.lanes.find(l => inside(path, folder(p, l.id)))?.id ?? null

// Elapsed time as ps writes it: [[dd-]hh:]mm:ss.
function seconds(etime: string): number {
  const [days, rest] = etime.includes('-') ? etime.split('-') : ['0', etime]
  const [s = 0, m = 0, h = 0] = (rest ?? '').split(':').map(Number).reverse()
  return Number(days) * 86_400 + h * 3600 + m * 60 + s
}

// The command as the session wrote it, without the Bash tool's wrapper.
function commandText(line: string): string {
  const m = line.match(/ eval '([\s\S]*)' < \/dev\/null/)
  return (m?.[1] ?? line).replace(/'\\''/g, "'").trim()
}

function whatItDoes(text: string): string {
  if (/run_e2e|playwright/.test(text)) return 'end-to-end tests'
  if (/scripts\/ci\.sh/.test(text)) return 'CI'
  if (/pytest/.test(text)) return 'backend tests'
  if (/\bvitest\b|\bnpm (run )?test\b/.test(text)) return 'tests'
  if (/\b(until|while)\b[\s\S]*\bsleep\b/.test(text)) return 'a wait'
  return 'a command'
}

// The sessions' running commands (children of the session's process) and the end-to-end runs:
// whoever has the lock open holds it, a lockf that has not opened it yet is queued. A session
// running in the clone is the lane's coding session; one outside is its reviewer if its annotation
// says so, found by the id the app puts in the process environment. Commands are kept under the
// lane or under the reviewer's id.
async function readProcesses($: EngineInterface, p: Project, now: number, all: Annotation[]) {
  const processes = (await run($, ['ps', '-axww', '-o', 'pid=,ppid=,etime=,command=']))
    .split('\n')
    .flatMap(r => {
      const m = r.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/)
      return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), since: now - seconds(m[3] ?? '') * 1000, command: m[4] ?? '' }] : []
    })
  const launched = processes.filter(x => x.command.includes('/.claude/shell-snapshots/'))
  const lockf = processes.filter(
    x => x.command.startsWith('lockf ') && x.command.includes(p.lock) && !x.command.includes(' -t 0 '),
  )
  const sessions = [...new Set(launched.map(x => x.ppid))]
  const [folders, environments, open] = await Promise.all([
    sessions.length > 0 ? run($, ['lsof', '-a', '-d', 'cwd', '-Fpn', '-p', sessions.join(',')]) : '',
    sessions.length > 0 ? run($, ['ps', '-E', '-ww', '-o', 'pid=,command=', '-p', sessions.join(',')]) : '',
    run($, ['lsof', '-t', p.lock]),
  ])

  const cwd = new Map<number, string>()
  let pid = 0
  for (const r of folders.split('\n')) {
    if (r.startsWith('p')) pid = Number(r.slice(1))
    else if (r.startsWith('n')) cwd.set(pid, r.slice(1))
  }
  const where = new Map<number, { lane: string; review: string | null }>()
  for (const r of environments.split('\n')) {
    const s = Number(r.match(/^\s*(\d+)\s/)?.[1])
    const lane = laneOf(p, cwd.get(s) ?? '')
    // The last one: the environment comes after the command, which may name it too.
    const host = [...r.matchAll(/\bCLAUDE_CODE_HOST_SESSION_ID=(\S+)/g)].at(-1)?.[1]
    const reviewed = all.find(a => host !== undefined && a.session === host)?.lane
    if (lane !== null) where.set(s, { lane, review: null })
    else if (host !== undefined && reviewed !== undefined) where.set(s, { lane: reviewed, review: host })
  }

  const commands = new Map<string, Command[]>()
  for (const x of launched) {
    const at = where.get(x.ppid)
    if (at === undefined) continue
    const key = at.review ?? at.lane
    const text = commandText(x.command)
    const theirs = commands.get(key) ?? []
    const same = theirs.find(c => c.text === text)
    if (same) {
      same.count += 1
      same.since = Math.min(same.since, x.since)
    } else commands.set(key, [...theirs, { what: whatItDoes(text), text, since: x.since, count: 1 }])
  }

  // Whose a run is: CI's, the close-out cleanup queue's, or the session it descends from, or the
  // clone it names. The clones are inside the main folder: they are checked first.
  const parent = new Map(processes.map(x => [x.pid, x.ppid]))
  const descends = (from: number) => {
    for (let x = parent.get(from), steps = 0; x !== undefined && x > 1 && steps < 64; x = parent.get(x), steps++) {
      const at = where.get(x)
      if (at !== undefined) return at
    }
    return undefined
  }
  const whoRuns = (x: { pid: number; command: string }): Omit<Run, 'holds' | 'since'> => {
    if (x.command.includes('/actions-runner/')) return { who: 'the CI', lane: null, review: null }
    if (/(cleanup|pulizia)\.sh --in-(queue|coda)/.test(x.command)) return { who: 'the cleanup', lane: null, review: null }
    const at = descends(x.pid)
    if (at?.review) return { who: `the review of ${laneName(p, at.lane)}`, ...at }
    const id = at?.lane ?? p.lanes.find(l => names(x.command, folder(p, l.id)))?.id ?? null
    if (id !== null) return { who: laneName(p, id), lane: id, review: null }
    const main = names(x.command, p.root)
    return { who: main ? 'the main folder' : 'a run', lane: null, review: null }
  }

  const held = new Set(open.split('\n').filter(Boolean).map(Number))
  const runs: Run[] = lockf.map(x => ({ ...whoRuns(x), holds: held.has(x.pid), since: x.since })).sort((a, b) => a.since - b.since)
  if (held.size > 0 && !runs.some(c => c.holds)) runs.unshift({ who: 'a run', lane: null, review: null, holds: true, since: now })
  return { commands, runs }
}

// The annotations of the sessions outside the clones, which may be a lane's reviewer.
async function readReviews($: EngineInterface, p: Project): Promise<Annotation[]> {
  const text = await run($, [
    'sh',
    '-c',
    'for f in "$1"/*.json; do [ -f "$f" ] && cat "$f" && echo; done; true',
    'sh',
    reviewsDir(p),
  ])
  return text.split('\n').flatMap(r => {
    try {
      return [JSON.parse(r) as Annotation]
    } catch {
      return []
    }
  })
}

// The lane's reviewer; if there are two, the one that moved last.
function reviewOf(id: string, annotation: Annotation, all: Annotation[]): Review | null {
  const r = all
    .filter(a => a.lane === id && a.activity !== undefined)
    .sort((a, b) => (b.activitySince ?? 0) - (a.activitySince ?? 0))[0]
  if (r?.activity === undefined || r.session === undefined) return null
  return {
    session: r.session,
    name: annotation.senders?.[r.session] ?? '',
    activity: r.activity,
    activitySince: r.activitySince ?? 0,
    what: r.what ?? null,
    whatSince: r.whatSince ?? null,
    commands: [],
    run: null,
  }
}

// The branch's job, from the first line of the prompt that the reviewer wrote in the bench, in
// <bench>/<prefix>-<lane>/<job>/prompt.md: «Prompt for checkpoint 19 of block 1 — The weekly rooms view…».
// The folder name may have zero-padded numbers, cp06 for the branch dev/cp6, or not.
// Without a title on the first line, the title is that of the checkpoint's section in the document
// the prompt names, read in the clone.
async function readJob($: EngineInterface, p: Project, id: string, slug: string, dir: string): Promise<Job | null> {
  const folders = new Set([slug, slug.replace(/\d+/g, n => n.padStart(2, '0')), slug.replace(/\d+/g, n => String(Number(n)))])
  for (const name of folders) {
    const prompt = await readText($, `${p.bench}/${p.prefix}-${id}/${name}/prompt.md`)
    const first = prompt.split('\n').find(r => r.trim() !== '')
    if (first === undefined) continue
    // Titles are separated by « — », « – », « - » or «: ».
    const [what = '', ...title] = first
      .replace(/^#+\s*/, '')
      .replace(/^Prompt\s+(for|del|dello|della|dei|degli|delle)\s+/i, '')
      .split(/\s+[—–-]\s+|:\s+/)
    const checkpoint = what.trim()
    let description = title.join(' — ').trim() || null
    const number = checkpoint.match(/checkpoint (\d+)/i)?.[1]
    const document = prompt.match(/docs\/[\w./-]+\.md/)?.[0]
    if (description === null && number !== undefined && document !== undefined) {
      const section = new RegExp(`^#{2,4} Checkpoint ${Number(number)}\\s*[—–:-]\\s*(.+)$`, 'm')
      description = (await readText($, `${dir}/${document}`)).match(section)?.[1]?.trim() ?? null
    }
    return { checkpoint, description }
  }
  return null
}

async function readLane($: EngineInterface, p: Project, l: { id: string; name: string }, now: number, all: Annotation[]) {
  const dir = folder(p, l.id)
  const git = (...args: string[]) => run($, ['git', '-C', dir, ...args])
  const transcripts = `${home}/.claude/projects/${dir.replace(/[^a-zA-Z0-9]/g, '-')}`
  const [branch, ahead, changes, log, written, annotation] = await Promise.all([
    git('branch', '--show-current'),
    git('rev-list', '--count', 'main..HEAD'),
    git('status', '--porcelain'),
    git('log', '-1', '--format=%ct%x09%s'),
    run($, ['sh', '-c', 'f=$(ls -t "$1"/*.jsonl 2>/dev/null | head -1) && stat -f %m "$f"', 'sh', transcripts]),
    readAnnotation($, annotationFile(p, l.id)),
  ])
  const slug = branch === '' || branch === 'main' ? null : branch.slice(branch.indexOf('/') + 1)
  const job = slug === null ? null : await readJob($, p, l.id, slug, dir)
  const [when, ...subject] = log.split('\t')
  const writtenMs = Number(written) * 1000
  const estimated = annotation.activity === undefined && written !== ''
  return {
    id: l.id,
    name: l.name,
    branch,
    slug,
    job,
    ahead: Number(ahead) || 0,
    dirtyFiles: changes === '' ? 0 : changes.split('\n').length,
    last: slug !== null && log !== '' ? { at: Number(when) * 1000, text: subject.join('\t') } : null,
    activity: annotation.activity ?? (estimated ? (now - writtenMs < 120_000 ? 'working' : 'idle') : null),
    activitySince: annotation.activitySince ?? (estimated ? writtenMs : null),
    estimated,
    handoff: annotation.handoff ?? null,
    // Closed: the clone is back on main, or the last message received is the close-out.
    toClean:
      annotation.dirty === true &&
      (slug === null || (annotation.handoff?.direction === 'in' && CLOSEOUT.test(annotation.handoff.text))),
    review: reviewOf(l.id, annotation, all),
  }
}

async function readProject($: EngineInterface, p: Project, read: number): Promise<State> {
  const all = await readReviews($, p)
  const [lanes, push, processes] = await Promise.all([
    Promise.all(p.lanes.map(l => readLane($, p, l, read, all))),
    run($, ['git', '-C', p.root, 'rev-list', '--count', 'origin/main..main']),
    readProcesses($, p, read, all),
  ])
  const own = (r: Review): Review => ({
    ...r,
    commands: processes.commands.get(r.session) ?? [],
    run: processes.runs.find(c => c.review === r.session) ?? null,
  })
  return {
    project: p.name,
    lanes: lanes.map(l => ({
      ...l,
      commands: processes.commands.get(l.id) ?? [],
      run: processes.runs.find(c => c.lane === l.id && c.review === null) ?? null,
      review: l.review && own(l.review),
    })),
    push: Number(push) || 0,
    e2e: processes.runs,
    read,
  }
}

async function refresh($: EngineInterface, projects: Project[]) {
  const read = await $.clock.now()
  const states = await Promise.all(projects.map(p => readProject($, p, read)))
  projects.forEach((p, i) => {
    const s = states[i]
    if (s !== undefined) latest.set(p.root, s)
  })
  $.ui.invalidate('ui.render')
  if (myProject !== null && mine === null && projects.some(p => p.root === myProject?.root)) {
    await wakeUp($, myProject, read)
  }
  return states
}

// Waking the coding sessions that the app closed. When the Mac's memory runs short, Claude Desktop
// closes the session that has been idle longest («[CliGovernor] pressure evicting local_… (idle NNNs)»
// in its log), without counting background commands or a turn that has just started: the Monitor that
// was supposed to wake it dies with it, the runs finish anyway, and nobody wakes it again. Every session
// of the project outside the clones reads the log on every round; if a lane's coding session was closed
// while the work was in its hands (the last message came in, and is not a «Close-out…») and has not been
// resumed since, it sends it a message, which reopens it. A folder created with mkdir, which succeeds
// only once, makes sure only one session sends it, once per closure.
const APP_LOG = () => `${home}/Library/Logs/Claude/main.log`
const CLOSED_BY_APP = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d) \[info\] \[CliGovernor\] pressure evicting (local_[0-9a-f-]+)/
const RESUMED_BY_APP = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d \[info\] Resuming session (local_[0-9a-f-]+)/
// An older closure is not woken: the work of that time has moved on or has already been seen.
const WAKE_WITHIN_MS = 6 * 3600_000

const wakeUpText = (time: string) =>
  [
    `Wake-up from metodo: at ${time} the app closed you for lack of memory, while the work was in your hands.`,
    'The background commands and monitors you had started died with the session; the runs you started may have finished anyway.',
    'Re-read the results in their files, rerun only what is missing, and pick up where you left off.',
  ].join(' ')

async function wakeUp($: EngineInterface, p: Project, now: number) {
  const log = await run($, ['grep', '-E', 'pressure evicting local_|Resuming session local_', APP_LOG()])
  if (log === '') return
  const lines = log.split('\n').slice(-500)
  const code = await Promise.all(p.lanes.map(l => readAnnotation($, annotationFile(p, l.id))))
  for (const a of code) {
    const id = a.session
    const last = a.handoff
    if (id === undefined || last === undefined || last.direction !== 'in' || CLOSEOUT.test(last.text)) continue
    // The latest closure of that session that no resume has followed.
    let closed: { day: string; time: string } | null = null
    for (const r of lines) {
      const c = r.match(CLOSED_BY_APP)
      if (c?.[3] === id) closed = { day: c[1] ?? '', time: c[2] ?? '' }
      else if (r.match(RESUMED_BY_APP)?.[1] === id) closed = null
    }
    if (closed === null) continue
    // The log writes local time.
    const when = new Date(`${closed.day}T${closed.time}`).getTime()
    if (!(when > last.at) || now - when > WAKE_WITHIN_MS) continue
    await run($, ['mkdir', '-p', `${p.bench}/state/wakeups`])
    const mark = `${p.bench}/state/wakeups/${id}-${closed.day}T${closed.time.replaceAll(':', '')}`
    const taken = await $.process.run(['mkdir', mark]).catch(() => null)
    if (taken?.exitCode !== 0) continue // another session already sent it, or this one a round ago
    await $.session.send({ to: id, text: wakeUpText(closed.time.slice(0, 5)) })
  }
}

// Those asked for, and always the session's own, which has the line above the prompt.
const toRead = () =>
  myProject === null || followed.some(p => p.root === myProject?.root) ? followed : [myProject, ...followed]

function follow($: EngineInterface, projects: Project[]) {
  followed = projects
  if (timer !== null) return
  timer = $.clock.every(EVERY_MS, () => refresh($, toRead()))
  void refresh($, toRead())
}

// Has a running command or an end-to-end run: it is not idle, it is waiting.
type Waiting = { commands: Command[]; run: Run | null }
const isWaiting = (b: Waiting) => b.commands.length > 0 || b.run !== null
const waitingSince = (b: Waiting) => Math.min(...b.commands.map(c => c.since), b.run?.since ?? Infinity)

// Idle after an incoming message, with the job open and nothing running: it was supposed to answer, maybe it is waiting for you.
const worthALook = (b: Lane) =>
  b.activity === 'idle' && !isWaiting(b) && b.slug !== null && b.handoff?.direction === 'in'

type Signal = { symbol: string; color: Color; word: string; since: number | null; estimated: boolean }

function signal(b: Lane): Signal {
  const since = b.activitySince
  if (b.activity === 'permission') return { symbol: '!', color: 'error', word: 'waiting for a permission', since, estimated: false }
  if (b.activity === 'working') return { symbol: '●', color: 'success', word: 'working', since, estimated: b.estimated }
  if (isWaiting(b)) return { symbol: '◔', color: 'suggestion', word: 'waiting', since: waitingSince(b), estimated: false }
  if (worthALook(b)) return { symbol: '◐', color: 'warning', word: 'idle', since, estimated: b.estimated }
  if (b.activity === 'idle') return { symbol: '○', color: 'subtle', word: 'idle', since, estimated: b.estimated }
  return { symbol: '·', color: 'subtle', word: 'no session seen', since: null, estimated: false }
}

function reviewSignal(r: Review): Signal {
  const since = r.activitySince
  if (r.activity === 'permission') return { symbol: '!', color: 'error', word: 'waiting for a permission', since, estimated: false }
  if (r.activity === 'working') return { symbol: '●', color: 'success', word: 'working', since, estimated: false }
  if (isWaiting(r)) return { symbol: '◔', color: 'suggestion', word: 'waiting', since: waitingSince(r), estimated: false }
  return { symbol: '○', color: 'subtle', word: 'idle', since, estimated: false }
}

// Above the prompt, a lane whose coding session is idle shows the reviewer, if it is doing something.
function lineSignal(b: Lane): Signal {
  const g = signal(b)
  const r = b.review === null ? null : reviewSignal(b.review)
  return g.color === 'subtle' && r !== null && r.color !== 'subtle' ? r : g
}

// Who holds the job: the session that is moving, the coding session first; if both are idle,
// the one that received the last message.
type Hand = 'reviewer' | 'coder'
const isMoving = (activity: Activity | null, x: Waiting) => activity === 'working' || activity === 'permission' || isWaiting(x)

function hand(b: Lane): Hand | null {
  if (isMoving(b.activity, b)) return 'coder'
  if (b.review !== null && isMoving(b.review.activity, b.review)) return 'reviewer'
  if (b.slug === null || b.handoff === null) return null
  return b.handoff.direction === 'out' ? 'reviewer' : 'coder'
}

const handLine = (m: Hand) => (m === 'reviewer' ? 'with the reviewer' : 'with the coding session')

const jobLine = (j: Job) => (j.description === null ? j.checkpoint : `${j.checkpoint}: ${j.description}`)

function ago(ms: number, now: number): string {
  const minutes = Math.round((now - ms) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`
}

const elapsed = (ms: number, now: number) => {
  const t = ago(ms, now)
  return t === 'now' ? 'just now' : `for ${t.replace(' ago', '')}`
}

function statusLine(b: Lane, now: number): string {
  const g = signal(b)
  const when = g.since !== null ? ` ${elapsed(g.since, now)}` : ''
  return `${g.symbol} ${g.word}${when}${g.estimated ? ' (estimated)' : ''}`
}

function handoffLine(h: Handoff, now: number): string {
  const arrow = h.direction === 'in' ? '←' : '→'
  const peer = h.peer ? ` ${h.direction === 'in' ? 'from' : 'to'} ${h.peer}` : ''
  return `${arrow} «${h.text}»${peer} · ${ago(h.at, now)}`
}

function reviewLine(r: Review, now: number): string {
  const g = reviewSignal(r)
  const who = r.name ? `review (${r.name})` : 'review'
  const what = r.what !== null && r.whatSince !== null ? ` · ${r.what} · ${ago(r.whatSince, now)}` : ''
  return `${who} · ${g.symbol} ${g.word} ${elapsed(g.since ?? r.activitySince, now)}${what}`
}

// What it is waiting for: the running commands and the end-to-end run, queued behind whom.
function waitLines(b: Waiting, s: State): string[] {
  const lines = b.commands.map(c => {
    const text = c.text.length > 140 ? `${c.text.slice(0, 140)}…` : c.text
    const copies = c.count > 1 ? ` (${c.count} identical)` : ''
    return `${c.what}${copies} ${elapsed(c.since, s.read)}: ${text}`
  })
  if (b.run !== null) {
    const ahead = s.e2e.find(c => c.holds)
    lines.push(
      b.run.holds
        ? `end-to-end run in progress ${elapsed(b.run.since, s.read)}`
        : `end-to-end run queued ${elapsed(b.run.since, s.read)}${ahead ? `, behind ${ahead.who}` : ''}`,
    )
  }
  return lines
}

function branchLines(b: Lane, now: number): string[] {
  if (b.slug === null) return []
  const parts = [b.branch, b.ahead === 1 ? '1 commit ahead of main' : `${b.ahead} commits ahead of main`]
  if (b.dirtyFiles > 0) parts.push(b.dirtyFiles === 1 ? '1 uncommitted file' : `${b.dirtyFiles} uncommitted files`)
  const lines = [parts.join(' · ')]
  if (b.last !== null && b.ahead > 0) lines.push(`last commit ${ago(b.last.at, now)}: ${b.last.text}`)
  return lines
}

function e2eLine(s: State): string {
  const holder = s.e2e.find(c => c.holds)
  const queued = s.e2e.filter(c => !c.holds)
  const parts = [holder ? `E2E taken by ${holder.who} ${elapsed(holder.since, s.read)}` : 'E2E free']
  if (queued.length > 0) parts.push(`queued: ${queued.map(c => c.who).join(', ')}`)
  return parts.join(' · ')
}

// The job is closed and the close-out has not arrived, or the session did not clean itself afterwards.
const TO_CLEAN = 'to clean: the job is closed, but the coding session still has its conversation'

function needsYou(s: State): string[] {
  const lines: string[] = []
  if (s.push > 0) lines.push(`push: main is ${s.push} ahead of origin`)
  for (const b of s.lanes) {
    if (b.activity === 'permission') lines.push(`${b.name}: the coding session is waiting for a permission`)
    else if (worthALook(b) && b.handoff) lines.push(`${b.name}: idle after «${b.handoff.text}», check whether it is waiting for you`)
    if (b.review?.activity === 'permission') lines.push(`${b.name}: the reviewer is waiting for a permission`)
    if (b.toClean) lines.push(`${b.name}: ${TO_CLEAN}`)
  }
  return lines
}

function clock(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// The same state as text, for the chat: it can be read from the phone too.
function summary(s: State): string {
  const lines = [`Lanes of ${s.project} at ${clock(s.read)}`]
  for (const b of s.lanes) {
    lines.push('', `${b.name} · ${b.slug ?? 'free'} · ${statusLine(b, s.read)}`)
    if (b.job) lines.push(`  ${jobLine(b.job)}`)
    const m = hand(b)
    if (m) lines.push(`  ${handLine(m)}`)
    if (b.review) {
      lines.push(`  ${reviewLine(b.review, s.read)}`)
      for (const r of waitLines(b.review, s)) lines.push(`    ${r}`)
    }
    for (const r of waitLines(b, s)) lines.push(`  ${r}`)
    for (const r of branchLines(b, s.read)) lines.push(`  ${r}`)
    if (b.handoff) lines.push(`  ${handoffLine(b.handoff, s.read)}`)
    if (b.toClean) lines.push(`  ${TO_CLEAN}`)
  }
  const needs = needsYou(s)
  lines.push('', needs.length > 0 ? `Needs you: ${needs.join('; ')}` : 'Nothing needs you')
  lines.push(e2eLine(s))
  return lines.join('\n')
}

// The text of /lanes-status and of the tool: the projects asked for, one after the other.
async function tell($: EngineInterface, asked: string): Promise<string> {
  const projects = await choose($, asked)
  if (projects.length === 0)
    return asked.trim() === ''
      ? 'No project using metodo seen so far: the first appears when a session opens in its folder.'
      : `No project using metodo is called «${asked.trim()}».`
  follow($, projects)
  const states = await refresh($, projects)
  return states.map(summary).join('\n\n')
}

// The same text for the model: on Remote Control only its reply arrives.
// The tool's arguments sit beside `tool`, not under `input`.
async function statusTool($: EngineInterface, e: unknown) {
  const input = e as { project?: unknown; progetto?: unknown }
  const project = input.project ?? input.progetto
  await reorient($)
  return { result: await tell($, typeof project === 'string' ? project : '') }
}

async function lanesCommand($: EngineInterface, e: { args: string }) {
  await reorient($)
  const text = await tell($, e.args)
  void $.ui.open({ id: PANEL, title: 'Lanes' })
  return { text }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    home = (await $.env.get('HOME')) ?? ''
    await orient($, e.cwd)
    const description = "The state of the lanes: of the session's project, or of the one named, or of all"
    // A command named like a skill of the plugin is refused by Claude Code: never let that stop the rest of the start-up.
    for (const name of ['lanes-status', 'binari']) {
      try {
        await $.command.register({ name, description, argumentHint: '[project]' })
      } catch {
        // refused: the line, the panel and the tool still work
      }
    }
    const tool = {
      description:
        "The state of the lanes of the projects that use metodo: the same text as /lanes-status. Call it when the owner asks about the lanes, and report its text as is: from Remote Control the line above the prompt and the mod's panel are not visible, nor is the output of /lanes-status. Without `project` it reports the session's project, or all of them if the session does not belong to a project.",
      inputSchema: {
        type: 'object' as const,
        properties: { project: { type: 'string', description: 'The name or prefix of the project, for example «Acme» or «acme»' } },
      },
    }
    await $.tool.register({ name: 'status', ...tool })
    // Legacy alias.
    await $.tool.register({ name: 'stato', ...tool })
    return next(e)
  })

  // The same text for the model: on Remote Control only its reply arrives.
  on('tool.call', { tool: 'mcp__metodo__status' }, statusTool)
  on('tool.call', { tool: 'mcp__metodo__stato' }, statusTool)

  on('command.run', { command: 'lanes-status' }, lanesCommand)
  on('command.run', { command: 'binari' }, lanesCommand)

  // In every session of a project, when it works and when it stops; in the coding session, the messages too.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await reorient($)
    if (myFile !== null && e.agentId === undefined) annotateActivity($, 'working')
    if (mine !== null && e.agentId === undefined) {
      if (e.text.includes('<cross-session-message')) await received($, e.text)
      const conversation = await conversationOf($)
      // Written before the turn starts: the reviewer that sends the prompt afterwards must find it.
      await annotate($, a => ({ ...a, dirty: true, ...(conversation !== undefined ? { conversation } : {}) }))
    }
    return next(e)
  })

  // A /clear, from the mod, the owner or the app: the conversation starts empty again, and the process
  // goes on without another session.start.
  on('session.end', async ($, e, next) => {
    if (mine !== null && e.reason === 'clear') await annotate($, a => ({ ...a, dirty: false }))
    return next(e)
  })

  on('skill.prompt', async ($, e, next) => {
    const job = myProject?.jobs[e.skill]
    if (mine === null && job !== undefined) await annotate($, (a, now) => ({ ...a, lane: job.lane, what: job.what, whatSince: now }))
    return next(e)
  })

  // After the turn that received the «Close-out of…», /clear, as the owner would type it: the
  // cycle is in the repository, and the next prompt finds the session clean. Not if the turn was
  // interrupted or ends with a question: then it is waiting for you, and cleans itself later.
  on('turn.complete', ($, e, next) => {
    if (myFile !== null && e.agentId === undefined) annotateActivity($, 'idle')
    if (mine !== null && e.agentId === undefined) {
      if (closedOut && e.reason === 'answer' && !e.answer.trim().endsWith('?')) {
        closedOut = false
        $.clock.after(1000, () => void $.command.run({ command: 'clear', args: '' }))
      }
    }
    return next(e)
  })

  on('classic.Notification', ($, e, next) => {
    if (myFile !== null && e.notification_type === 'permission_prompt') annotateActivity($, 'permission')
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const outcome = await next(e)
    if (myActivity === 'permission') annotateActivity($, 'working')
    return outcome
  })

  on('session.receive', async ($, e, next) => {
    const fromASession = e.origin.kind === 'peer' || e.origin.kind === 'peer-send-message'
    if (e.agentId === undefined && fromASession) await reorient($)
    if (mine !== null && e.agentId === undefined && fromASession) await received($, e.text)
    else if (e.agentId === undefined && fromASession) await exchange($, readMessage(e.text).from)
    return next(e)
  })

  on('session.send', async ($, e, next) => {
    if (e.agentId === undefined) await reorient($)
    if (mine !== null && e.agentId === undefined) {
      const line = readMessage(e.text).line
      await annotate($, (a, now) => ({
        ...a,
        handoff: { direction: 'out', text: line, peer: a.senders?.[e.to] ?? '', at: now },
      }))
    } else if (e.agentId === undefined) {
      // The prompt of a new job does not go to a coding session that still has the conversation
      // of the previous one: it is a check, not the reviewer's memory.
      const dirty = PROMPT.test(readMessage(e.text).line) ? await dirtyLane($, e.to) : null
      if (dirty !== null) return { isDelivered: false as const, reason: refusal(dirty) }
      await exchange($, e.to)
    }
    return next(e)
  })

  // Above the prompt, only in a project's sessions, and only theirs.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = myProject && latest.get(myProject.root)
    if (!s || e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const needs = needsYou(s).length
    return (
      <Box flexDirection="row" gap={2}>
        {s.lanes.map(b => {
          const g = lineSignal(b)
          const m = hand(b)
          return (
            <Box key={b.id} flexDirection="row" gap={1}>
              <Text bold>{b.name}</Text>
              <Text dimColor={b.slug === null}>{b.slug ?? 'free'}</Text>
              <Text color={g.color}>{g.symbol}</Text>
              {m && <Text dimColor>{m === 'reviewer' ? 'rev.' : 'code'}</Text>}
            </Box>
          )
        })}
        {needs > 0 && <Text color="warning">{needs === 1 ? '1 item for you' : `${needs} items for you`}</Text>}
        <Button key="open" plain label="Details" onPress={() => void $.ui.open({ id: PANEL, title: 'Lanes' })} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const states = followed.flatMap(p => latest.get(p.root) ?? [])
    if (states.length === 0) return <Text dimColor>Reading the lanes…</Text>
    const titles = states.length > 1
    return (
      <Box flexDirection="column" gap={1}>
        {states.map(s => {
          const needs = needsYou(s)
          return (
            <Box key={s.project} flexDirection="column" gap={1}>
              {titles && <Text bold>{s.project}</Text>}
              {s.lanes.map(b => (
                <Box key={b.id} flexDirection="column">
                  <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" columnGap={2}>
                    <Text wrap="wrap">
                      <Text bold>{b.name}</Text> · {b.slug ?? 'free'}
                    </Text>
                    <Text color={signal(b).color} wrap="wrap">
                      {statusLine(b, s.read)}
                    </Text>
                  </Box>
                  <Box flexDirection="column" paddingLeft={2}>
                    {b.job && (
                      <Text wrap="wrap">
                        <Text bold>{b.job.checkpoint}</Text>
                        {b.job.description !== null && ` — ${b.job.description}`}
                      </Text>
                    )}
                    {hand(b) && (
                      <Text color="suggestion" wrap="wrap">
                        {handLine(hand(b) as Hand)}
                      </Text>
                    )}
                    {b.review && <Text wrap="wrap">{reviewLine(b.review, s.read)}</Text>}
                    {b.review && (
                      <Box flexDirection="column" paddingLeft={2}>
                        {waitLines(b.review, s).map(r => (
                          <Text wrap="wrap">{r}</Text>
                        ))}
                      </Box>
                    )}
                    {waitLines(b, s).map(r => (
                      <Text wrap="wrap">{r}</Text>
                    ))}
                    {branchLines(b, s.read).map(r => (
                      <Text dimColor wrap="wrap">
                        {r}
                      </Text>
                    ))}
                    {b.handoff && <Text wrap="wrap">{handoffLine(b.handoff, s.read)}</Text>}
                    {b.toClean && (
                      <Text color="warning" wrap="wrap">
                        {TO_CLEAN}
                      </Text>
                    )}
                  </Box>
                </Box>
              ))}
              <Box flexDirection="column">
                <Text bold color={needs.length > 0 ? 'warning' : undefined}>
                  {needs.length > 0 ? 'Needs you' : 'Nothing needs you'}
                </Text>
                <Box flexDirection="column" paddingLeft={2}>
                  {needs.map(r => (
                    <Text wrap="wrap">{r}</Text>
                  ))}
                </Box>
              </Box>
              <Text dimColor wrap="wrap">
                {e2eLine(s)} · read at {clock(s.read)}, every 30 s
              </Text>
            </Box>
          )
        })}
      </Box>
    )
  })
}
