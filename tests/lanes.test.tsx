import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { normalize } from '../hooks/register'

const NOW = 1_792_700_000_000
// The home folder, and the session id in the app.
const environment = (_: unknown, e: { name: string }) => ({ value: e.name === 'HOME' ? '/Users/me' : 'local_9' })
const DEV = {
  activity: 'idle',
  activitySince: NOW - 10 * 60_000,
  handoff: { direction: 'in', text: 'Prompt for checkpoint 16', peer: 'Reviewer', at: NOW - 15 * 60_000 },
}

const THREE_LANES = [
  { id: 'dev', name: 'Development', branches: ['dev/'] },
  { id: 'fixes', name: 'Fixes', branches: ['fix/'] },
  { id: 'demo', name: 'Demo', branches: ['demo/'], jobPrefix: 'demo-' },
]
// Canonical English fields.
const ACME = JSON.stringify({
  name: 'Acme',
  prefix: 'acme',
  root: '~/code/acme',
  clones: 'lanes',
  lanes: THREE_LANES,
  bench: '~/.cache/acme-review',
  lock: '~/.cache/acme-e2e.lock',
  jobs: { 'triage-reports': { lane: 'fixes', what: 'report triage' } },
})
// The same shape with the legacy Italian field names, as older projects have it.
const BETA = JSON.stringify({
  nome: 'Beta',
  prefisso: 'beta',
  cartella: '~/code/beta',
  cloni: 'binari',
  binari: THREE_LANES.map(({ id, name, branches, jobPrefix }) => ({
    id,
    nome: name,
    rami: branches,
    ...(jobPrefix ? { lavoro: jobPrefix } : {}),
  })),
  banco: '~/.cache/beta-review',
  lucchetto: '~/.cache/beta-e2e.lock',
})
const MAIN = '/Users/me/code/acme'
const CLONES = `${MAIN}/lanes`
const BENCH = '/Users/me/.cache/acme-review'

// The configuration is in the main folder and, since it is committed, in every clone and in every copy.
function configuration(path: string): string | undefined {
  if (!path.endsWith('/.claude/metodo.json')) return undefined
  if (path.startsWith(`${MAIN}/`) || path.startsWith(`${BENCH}/`)) return ACME
  if (path.startsWith('/Users/me/code/beta/')) return BETA
  return undefined
}

// Development is halfway through checkpoint 16, idle after the prompt; the other two are on main.
function git(argv: readonly string[]): string {
  const lane = argv[2]?.split('acme-')[1]
  const command = argv.slice(3).join(' ')
  if (command === 'branch --show-current') return lane === 'dev' ? 'dev/cp16' : 'main'
  if (command === 'rev-list --count main..HEAD') return lane === 'dev' ? '3' : '0'
  if (command === 'status --porcelain') return lane === 'dev' ? ' M a.ts\n?? b.ts' : ''
  if (command.startsWith('log -1')) return `${NOW / 1000 - 3600}\tBlock 1, checkpoint 16: the month view`
  if (command === 'rev-list --count origin/main..main') return argv[2] === MAIN ? '17' : '0'
  return ''
}

// The demo session (100) waits in a loop for its end-to-end run (300),
// queued behind CI (400), which holds the lock.
const PS = [
  '  100     1   01:00:00 /Applications/claude --output-format stream-json',
  "  200   100      10:00 /bin/zsh -c source /Users/me/.claude/shell-snapshots/snapshot-zsh-1.sh && eval 'until grep -q DONE /tmp/e2e.log; do sleep 15; done' < /dev/null && pwd -P >| /tmp/x",
  "  201   100      03:00 /bin/zsh -c source /Users/me/.claude/shell-snapshots/snapshot-zsh-1.sh && eval 'until grep -q DONE /tmp/e2e.log; do sleep 15; done' < /dev/null && pwd -P >| /tmp/y",
  `  300     1      13:00 lockf -k /Users/me/.cache/acme-e2e.lock bash ${CLONES}/acme-demo/scripts/run_e2e.sh --project=webkit`,
  '  400     1      14:00 lockf -k /Users/me/.cache/acme-e2e.lock bash /Users/me/actions-runner/_work/G/G/scripts/ci.sh',
].join('\n')

function processes(argv: readonly string[]): string {
  if (argv[0] === 'git') return git(argv)
  if (argv[0] === 'ps') return PS
  if (argv[0] === 'lsof' && argv.includes('-t')) return argv.includes('/Users/me/.cache/acme-e2e.lock') ? '400' : ''
  if (argv[0] === 'lsof' && argv.includes('cwd')) return `p100\nfcwd\nn${CLONES}/acme-demo`
  return ''
}

const output = (stdout: string) => ({
  value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

// What every test needs: the home, the mod's registrations and an in-memory store.
function base(on: On, store: Record<string, unknown> = {}) {
  on('env.get', environment)
  on('command.register', () => ({ value: { command: 'lanes-status' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__metodo__status' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  mock.store(on, store)
}

const BAND = {
  plugin: 'metodo',
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 100, scroll: { offset: 0, bodyRows: 3 }, view: {} },
} as const

const PANE = {
  plugin: 'metodo',
  component: 'Pane',
  requestId: 'lanes',
  props: {
    title: 'Lanes',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const lanes = (args = '', command = 'lanes-status') =>
  ({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } }) as const

test('normalize: English fields win over the Italian aliases, which still work alone', () => {
  const english = normalize(JSON.parse(ACME))
  expect(english?.name).toBe('Acme')
  expect(english?.lanes[2]).toEqual({ id: 'demo', name: 'Demo', branches: ['demo/'], jobPrefix: 'demo-' })
  expect(english?.jobs).toEqual({ 'triage-reports': { lane: 'fixes', what: 'report triage' } })

  const italian = normalize(JSON.parse(BETA))
  expect(italian?.name).toBe('Beta')
  expect(italian?.root).toBe('~/code/beta')
  expect(italian?.lanes[2]).toEqual({ id: 'demo', name: 'Demo', branches: ['demo/'], jobPrefix: 'demo-' })

  const both = normalize({ ...JSON.parse(BETA), name: 'Gamma', protetti: { volumi: ['v'] }, protected: { volumes: ['w'] }, lavori: { x: { binario: 'dev', cosa: 'c' } } })
  expect(both?.name).toBe('Gamma')
  expect(both?.prefix).toBe('beta')
  expect(both?.protected?.volumes).toEqual(['w'])
  expect(both?.jobs).toEqual({ x: { lane: 'dev', what: 'c' } })

  expect(normalize({ name: 'Incomplete' })).toBeNull()
  expect(normalize('nope')).toBeNull()
})

test('the line, the panel and /lanes-status say where each lane stands', async ($, on) => {
  base(on)
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', (_, e) => output(processes(e.argv)))
  on('fs.read', (_, e) => ({
    value:
      configuration(e.path) ??
      (e.path.endsWith('/state/dev.json')
        ? JSON.stringify(DEV)
        : e.path === `${BENCH}/acme-dev/cp16/prompt.md`
          ? 'Prompt for checkpoint 16 of block 1 — The weekly rooms view\n\nRead…'
          : ''),
  }))

  await $.session.start({ cwd: `${MAIN}/frontend`, surface: 'desktop', isInteractive: true })
  const command = await $.command.run(lanes())
  expect(command.text).toContain('Lanes of Acme at')
  expect(command.text).toContain(
    [
      'Development · cp16 · ◐ idle for 10 min',
      '  checkpoint 16 of block 1: The weekly rooms view',
      '  with the coding session',
    ].join('\n'),
  )
  expect(command.text).toContain('← «Prompt for checkpoint 16» from Reviewer · 15 min ago')
  expect(command.text).toContain('Fixes · free')
  expect(command.text).toContain('Demo · free · ◔ waiting for 13 min')
  expect(command.text).toContain('a wait (2 identical) for 10 min: until grep -q DONE /tmp/e2e.log; do sleep 15; done')
  expect(command.text).toContain('end-to-end run queued for 13 min, behind the CI')
  expect(command.text).toContain('Needs you: push: main is 17 ahead of origin; Development: idle after')
  expect(command.text).toContain('E2E taken by the CI for 14 min · queued: Demo')

  // The legacy command name gives the same text.
  expect((await $.command.run(lanes('', 'binari'))).text).toBe(command.text)

  // The same text, for the model that answers from Remote Control, under the new and the legacy tool name.
  for (const tool of ['mcp__metodo__status', 'mcp__metodo__stato']) {
    const result = await $.tool.call({ tool })
    expect('result' in result ? result.result : undefined).toBe(command.text)
  }

  for (const surface of ['terminal', 'desktop'] as const) {
    const line = await $.ui.mount({ ...BAND, surface })
    expect((await line.find({ type: 'Text', text: 'cp16' }))?.text).toBe('cp16')
    expect((await line.find({ type: 'Text', text: 'code' }))?.text).toBe('code')
    expect((await line.find({ type: 'Text', text: '◔' }))?.text).toBe('◔')
    expect((await line.find({ type: 'Text', text: /items for you/ }))?.text).toBe('2 items for you')
    await line.unmount()

    const pane = await $.ui.mount({ ...PANE, surface })
    expect(await pane.find({ type: 'Text', text: /3 commits ahead of main · 2 uncommitted files/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /checkpoint 16 of block 1 — The weekly rooms view/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: 'with the coding session' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /idle after «Prompt for checkpoint 16»/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /queued for 13 min, behind the CI/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /E2E taken by the CI/ })).toBeDefined()
    await pane.unmount()
  }
})

test('from a chat outside the projects, /lanes-status lists all of them, or the one named, and nothing above the prompt', async ($, on) => {
  base(on, { projects: [MAIN, '/Users/me/code/beta', '/Users/me/code/gone'] })
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', (_, e) => output(processes(e.argv)))
  on('fs.read', (_, e) => ({ value: configuration(e.path) ?? '' }))
  // Above the prompt, outside the projects, what the engine draws stays.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  await $.session.start({ cwd: '/Users/me/code/other', surface: 'desktop', isInteractive: true })
  const all = await $.command.run(lanes())
  expect(all.text).toContain('Lanes of Acme at')
  // Beta's configuration uses the Italian field names, and it is read all the same.
  expect(all.text).toContain('Lanes of Beta at')
  // One project's runs are not the other's.
  expect(all.text).toContain('Development · free · · no session seen\n\nFixes')
  expect(all.text?.split('E2E free')).toHaveLength(2)

  const beta = await $.tool.call({ tool: 'mcp__metodo__status', project: 'beta' })
  const text = 'result' in beta ? String(beta.result) : ''
  expect(text).toContain('Lanes of Beta at')
  expect(text).not.toContain('Acme')

  // The legacy input name still works.
  const legacy = await $.tool.call({ tool: 'mcp__metodo__stato', progetto: 'beta' })
  expect('result' in legacy ? String(legacy.result) : '').toContain('Lanes of Beta at')

  const none = await $.command.run(lanes('Nothing'))
  expect(none.text).toBe('No project using metodo is called «Nothing».')

  const line = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await line.find({ type: 'Text', text: 'engine' })).toBeDefined()
  expect(await line.find({ type: 'Text', text: 'Development' })).toBeUndefined()
  await line.unmount()
})

test('a session in the main folder adds the project to those seen; a copy outside the main folder does not', async ($, on) => {
  const store: Record<string, unknown> = {}
  on('env.get', environment)
  on('command.register', () => ({ value: { command: 'lanes-status' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__metodo__status' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('store.get', (_, e) => ({ value: store[e.key] }))
  on('store.set', (_, e) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: undefined }))
  on('process.run', () => output(''))
  on('fs.read', (_, e) => ({ value: configuration(e.path) ?? '' }))
  on('fs.write', () => ({ value: undefined }))

  await $.session.start({ cwd: `${BENCH}/C-13/base`, surface: 'desktop', isInteractive: true })
  expect(store.projects).toBeUndefined()
  await $.session.start({ cwd: `${CLONES}/acme-demo`, surface: 'desktop', isInteractive: true })
  expect(store.projects).toEqual([MAIN])
})

test('the coding session notes the message it receives, in English or in Italian', async ($, on) => {
  const written: { path: string; text: string }[] = []
  base(on)
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: undefined }))
  on('process.run', () => output(''))
  on('fs.read', (_, e) => ({ value: configuration(e.path) ?? '' }))
  on('fs.write', (_, e) => {
    written.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('session.receive', (_, e) => ({ text: e.text }))

  await $.session.start({ cwd: `${CLONES}/acme-fixes`, surface: 'desktop', isInteractive: true })
  await $.session.receive({
    origin: { kind: 'peer' },
    text: 'Another Claude session sent a message:\n<cross-session-message from="local_1" name="Reviewer">\n**Prompt for C-12**\n\nThe file is…',
  })

  // First its id, so that the reviewer recognises it in the messages.
  expect(written[0]).toEqual({
    path: `${BENCH}/state/fixes.json`,
    text: '{"session":"local_9","dirty":false}',
  })
  const last = written.at(-1)
  expect(last?.path).toBe(`${BENCH}/state/fixes.json`)
  expect(JSON.parse(last?.text ?? '{}').handoff).toEqual({
    direction: 'in',
    text: 'Prompt for C-12',
    peer: 'Reviewer',
    at: NOW,
  })

  // The Italian protocol line is noted as it comes.
  await $.session.receive({
    origin: { kind: 'peer' },
    text: '<cross-session-message from="local_1" name="Reviewer">\n**Prompt della C-13**\n\nIl file è…',
  })
  expect(JSON.parse(written.at(-1)?.text ?? '{}').handoff.text).toBe('Prompt della C-13')
})

test("a main-folder session is the reviewer of the lane of its last thing", async ($, on) => {
  const mine = `${BENCH}/state/reviews/local_9.json`
  const dev = `${BENCH}/state/dev.json`
  const file = new Map([[dev, '{"session":"local_3"}']])
  base(on)
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: undefined }))
  on('process.run', () => output(''))
  on('fs.read', (_, e) => ({ value: configuration(e.path) ?? file.get(e.path) ?? '' }))
  on('fs.write', (_, e) => {
    file.set(e.path, e.text)
    return { value: undefined }
  })
  on('skill.prompt', (_, e) => ({ text: e.text }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('session.send', () => ({ isDelivered: true }))
  on('session.receive', (_, e) => ({ text: e.text }))
  const annotated = () => JSON.parse(file.get(mine) ?? '{}')

  // `triage-reports` is the job of the fixes reviewer: the configuration says so.
  await $.session.start({ cwd: MAIN, surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: '/triage-reports', turnId: 't' })
  await $.skill.prompt({ skill: 'triage-reports', text: 'Triage…', frontmatter: {}, source: 'projectSettings' })
  expect(annotated()).toEqual({
    session: 'local_9',
    lane: 'fixes',
    what: 'report triage',
    whatSince: NOW,
    activity: 'working',
    activitySince: NOW,
  })

  // A message to a session that is not a coding session changes nothing; one to the dev session does.
  await $.session.send({ to: 'local_5', text: 'Hello', origin: { kind: 'model' } })
  expect(annotated().lane).toBe('fixes')
  await $.session.send({ to: 'local_3', text: 'Prompt for checkpoint 17', origin: { kind: 'model' } })
  expect(annotated()).toEqual({ session: 'local_9', lane: 'dev', activity: 'working', activitySince: NOW })

  // And so does one received from it.
  file.set(mine, '{"session":"local_9"}')
  await $.session.receive({
    origin: { kind: 'peer' },
    text: '<cross-session-message from="local_3" name="Development">\nDelivery of checkpoint 17',
  })
  expect(annotated()).toEqual({ session: 'local_9', lane: 'dev' })
  expect(file.get(dev)).toBe('{"session":"local_3"}')
})

// The dev reviewer (500) has finished its turn but waits for its bench (511), which
// has queued its end-to-end run (520); behind it, the close-out cleanup queue (600).
const PS_REVIEW = [
  PS,
  '  500     1   02:00:00 /Applications/claude --output-format stream-json',
  "  510   500      05:00 /bin/zsh -c source /Users/me/.claude/shell-snapshots/snapshot-zsh-1.sh && eval 'bash /Users/me/.cache/acme-review/cp16/bench.sh' < /dev/null && pwd -P >| /tmp/z",
  '  511   510      05:00 bash /Users/me/.cache/acme-review/cp16/bench.sh',
  '  520   511      04:00 lockf -k /Users/me/.cache/acme-e2e.lock bash /Users/me/.cache/acme-review/cp16/base/scripts/run_e2e.sh --project=webkit',
  '  600     1      01:00 lockf -k /Users/me/.cache/acme-e2e.lock /Users/me/code/metodo/scripts/cleanup.sh --in-queue',
].join('\n')

function processesWithReview(argv: readonly string[]): string {
  if (argv[0] === 'ps' && argv.includes('-E'))
    return '  100 /Applications/claude CLAUDE_CODE_HOST_SESSION_ID=local_d\n  500 /Applications/claude --note CLAUDE_CODE_HOST_SESSION_ID=local_7 HOME=/Users/me CLAUDE_CODE_HOST_SESSION_ID=local_1 PATH=/usr/bin'
  if (argv[0] === 'ps') return PS_REVIEW
  if (argv[0] === 'lsof' && argv.includes('cwd')) return `p100\nfcwd\nn${CLONES}/acme-demo\np500\nfcwd\nn${MAIN}`
  return processes(argv)
}

test("under each lane its reviewer, with its commands, and above the prompt it counts if the coding session is idle", async ($, on) => {
  // Development is idle and its reviewer waits for the bench; the fixes reviewer
  // triages reports; local_8 is any session of the main folder.
  const dev = { activity: 'idle', activitySince: NOW - 10 * 60_000, senders: { local_1: 'Reviewer' } }
  const reviews = [
    { session: 'local_1', activity: 'idle', activitySince: NOW - 2 * 60_000, lane: 'dev' },
    {
      session: 'local_7',
      activity: 'working',
      activitySince: NOW - 5 * 60_000,
      lane: 'fixes',
      what: 'report triage',
      whatSince: NOW - 18 * 60_000,
    },
    { session: 'local_8', activity: 'permission', activitySince: NOW },
  ]
    .map(r => JSON.stringify(r))
    .join('\n')
  base(on)
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', (_, e) =>
    output(e.argv.includes(`${BENCH}/state/reviews`) ? reviews : processesWithReview(e.argv)),
  )
  on('fs.read', (_, e) => ({
    value: configuration(e.path) ?? (e.path.endsWith('/state/dev.json') ? JSON.stringify(dev) : ''),
  }))
  on('fs.write', () => ({ value: undefined }))

  await $.session.start({ cwd: MAIN, surface: 'desktop', isInteractive: true })
  const command = await $.command.run(lanes())
  expect(command.text).toContain(
    [
      'Development · cp16 · ○ idle for 10 min',
      '  with the reviewer',
      '  review (Reviewer) · ◔ waiting for 5 min',
      '    a command for 5 min: bash /Users/me/.cache/acme-review/cp16/bench.sh',
      '    end-to-end run queued for 4 min, behind the CI',
      '',
    ].join('\n'),
  )
  expect(command.text).toContain('Demo · free · ◔ waiting for 13 min')
  expect(command.text).toContain('E2E taken by the CI for 14 min · queued: Demo, the review of Development, the cleanup')
  expect(command.text).toContain(
    'Fixes · free · · no session seen\n  with the reviewer\n  review · ● working for 5 min · report triage · 18 min ago\n',
  )
  expect(command.text).not.toContain('the reviewer is waiting for a permission')

  const line = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await line.findAll({ type: 'Text', text: '●' })).toHaveLength(1)
  expect(await line.findAll({ type: 'Text', text: '◔' })).toHaveLength(2)
  await line.unmount()

  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await pane.find({ type: 'Text', text: /review \(Reviewer\) · ◔ waiting for 5 min/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /end-to-end run queued for 4 min, behind the CI/ })).toBeDefined()
  await pane.unmount()
})

test('without a title in the prompt, the description is the section of the document it names; titles split on dash or colon; folders may be zero-padded', async ($, on) => {
  // Development on branch dev/cp6, prompt in cp06; it has delivered, and the hand passes to the reviewer.
  const dev = {
    activity: 'idle',
    activitySince: NOW - 10 * 60_000,
    handoff: { direction: 'out', text: 'Delivery of checkpoint 6', peer: 'Reviewer', at: NOW - 10 * 60_000 },
  }
  const branches: Record<string, string> = { dev: 'dev/cp6', fixes: 'fix/c-7', demo: 'demo/d-8' }
  const file = new Map([
    [`${BENCH}/state/dev.json`, JSON.stringify(dev)],
    [`${BENCH}/acme-dev/cp06/prompt.md`, '# Prompt for checkpoint 6 of the demo\n\nImplement checkpoint 6 of docs/blocks/demo.md.'],
    [`${CLONES}/acme-dev/docs/blocks/demo.md`, '# The demo\n\n## Checkpoint 16 — No\n\n### Checkpoint 6 — The studio cap\n'],
    [`${BENCH}/acme-fixes/c-7/prompt.md`, 'Prompt for C-7: Colon title'],
    [`${BENCH}/acme-demo/d-8/prompt.md`, 'Prompt del checkpoint 8 del blocco 2 - Il tetto'],
  ])
  base(on)
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: undefined }))
  on('process.run', (_, e) => {
    const lane = e.argv[2]?.split('acme-')[1] ?? ''
    return output(e.argv[0] === 'git' && e.argv.slice(3).join(' ') === 'branch --show-current' ? (branches[lane] ?? '') : '')
  })
  on('fs.read', (_, e) => ({ value: configuration(e.path) ?? file.get(e.path) ?? '' }))
  on('fs.write', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))

  await $.session.start({ cwd: MAIN, surface: 'desktop', isInteractive: true })
  const command = await $.command.run(lanes())
  expect(command.text).toContain(
    ['Development · cp6 · ○ idle for 10 min', '  checkpoint 6 of the demo: The studio cap', '  with the reviewer'].join('\n'),
  )
  expect(command.text).toContain('Fixes · c-7 ·')
  expect(command.text).toContain('  C-7: Colon title')
  expect(command.text).toContain('  checkpoint 8 del blocco 2: Il tetto')
})

// The fixes coding session, with a fake clock and the /clear calls counted.
async function codingSession($: Engine, on: On) {
  const clock = mock.clock(on, { now: NOW })
  const cleaned: string[] = []
  base(on)
  on('command.run', { command: 'clear' }, (_, e) => {
    cleaned.push(e.command)
    return { text: '' }
  })
  on('process.run', () => output(''))
  on('fs.read', (_, e) => ({ value: configuration(e.path) ?? '' }))
  on('fs.write', () => ({ value: undefined }))
  on('session.receive', (_, e) => ({ text: e.text }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  await $.session.start({ cwd: `${CLONES}/acme-fixes`, surface: 'desktop', isInteractive: true })
  const receives = (line: string) =>
    $.session.receive({ origin: { kind: 'peer' }, text: `<cross-session-message from="local_1" name="Reviewer">\n${line}` })
  const finishes = (answer: string) =>
    $.turn.complete({ reason: 'answer', answer, durationMs: 1, isAborted: false, turnId: 't' })
  return { clock, cleaned, receives, finishes }
}

test('at the close-out the coding session cleans itself, whether the line is English or Italian', async ($, on) => {
  const s = await codingSession($, on)
  await s.receives('Close-out of C-12: delivery accepted, merged to main.')
  await s.finishes('Understood, C-12 is closed.')
  await s.clock.advance(1000)
  expect(s.cleaned).toEqual(['clear'])

  await s.receives('Chiusura della C-13: consegna accettata, merge su main.')
  await s.finishes('Ricevuto, la C-13 è chiusa.')
  await s.clock.advance(1000)
  expect(s.cleaned).toEqual(['clear', 'clear'])
})

test('it does not clean itself if the turn ends with a question, nor after another prompt', async ($, on) => {
  const s = await codingSession($, on)
  await s.receives('Close-out of C-12: delivery accepted.')
  await s.finishes('Shall I clean up the branches?')
  await s.clock.advance(1000)
  expect(s.cleaned).toEqual([])

  await s.receives('Prompt for C-13: in the file …')
  await s.finishes('Here is the plan.')
  await s.clock.advance(1000)
  expect(s.cleaned).toEqual([])
})

test('the coding session is dirty from the first turn, and clean after a /clear or when it is new', async ($, on) => {
  const fixes = `${BENCH}/state/fixes.json`
  // There was another session in the clone, left dirty.
  const file = new Map([[fixes, '{"session":"local_3","dirty":true}']])
  base(on)
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: undefined }))
  on('process.run', () => output(''))
  on('fs.read', (_, e) => ({ value: configuration(e.path) ?? file.get(e.path) ?? '' }))
  on('fs.write', (_, e) => {
    file.set(e.path, e.text)
    return { value: undefined }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  const dirty = () => JSON.parse(file.get(fixes) ?? '{}').dirty

  await $.session.start({ cwd: `${CLONES}/acme-fixes`, surface: 'desktop', isInteractive: true })
  expect(dirty()).toBe(false)
  await $.turn.start({ text: 'Prompt for C-12', turnId: 't' })
  expect(dirty()).toBe(true)

  // The mod reloaded, in the same session, does not make it clean again.
  await $.session.start({ cwd: `${CLONES}/acme-fixes`, surface: 'desktop', isInteractive: true })
  expect(dirty()).toBe(true)

  // An exit is not a cleanup; a /clear is.
  await $.session.end({ reason: 'other', sessionId: 's', resume: { id: 's' } })
  expect(dirty()).toBe(true)
  await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } })
  expect(dirty()).toBe(false)
})

test('the prompt of a new job does not go to a coding session that is still dirty', async ($, on) => {
  const dev = `${BENCH}/state/dev.json`
  const file = new Map([[dev, '{"session":"local_3","dirty":true}']])
  const sent: string[] = []
  base(on)
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: undefined }))
  on('process.run', () => output(''))
  on('fs.read', (_, e) => ({ value: configuration(e.path) ?? file.get(e.path) ?? '' }))
  on('fs.write', (_, e) => {
    file.set(e.path, e.text)
    return { value: undefined }
  })
  on('session.send', (_, e) => {
    sent.push(e.text)
    return { isDelivered: true }
  })
  const send = (text: string, to = 'local_3') => $.session.send({ to, text, origin: { kind: 'model' } })

  await $.session.start({ cwd: MAIN, surface: 'desktop', isInteractive: true })

  // The next job's prompt, and the first line a reviewer used to skip the close-out; in English and in Italian.
  for (const line of [
    'Prompt for checkpoint 2 of block 4: a new job',
    '**New work: correction C-33**',
    'Prompt del checkpoint 2 del blocco 4: un lavoro nuovo',
    '**Lavoro nuovo: la correzione C-33**',
  ]) {
    const outcome = await send(line)
    expect(outcome.isDelivered).toBe(false)
    expect(outcome.reason).toContain('Development')
    expect(outcome.reason).toContain('Close-out of')
  }
  expect(sent).toEqual([])

  // Messages of the same job and the close-out go through; and so does a prompt to another session.
  await send('OK to the plan of checkpoint 1')
  await send('Close-out of checkpoint 1 of block 4')
  await send('Prompt for anything', 'local_5')
  await send('Prompt for checkpoint 2', 'local_5')
  expect(sent).toHaveLength(4)

  // Clean, the prompt goes; and so does it if the coding session's mod has not said anything yet.
  file.set(dev, '{"session":"local_3","dirty":false}')
  expect((await send('Prompt for checkpoint 2 of block 4')).isDelivered).toBe(true)
  file.set(dev, '{"session":"local_3"}')
  expect((await send('Prompt for checkpoint 3 of block 4')).isDelivered).toBe(true)
})

test('a closed lane with the session still dirty is to clean, and it is up to the owner to know', async ($, on) => {
  const state = (id: string) => `${BENCH}/state/${id}.json`
  const closeOut = { direction: 'in', text: 'Close-out of checkpoint 16', peer: 'Reviewer', at: NOW - 60_000 }
  const file = new Map([
    // Development is halfway through 16: dirty, but not closed.
    [state('dev'), JSON.stringify({ ...DEV, dirty: true })],
    // Fixes is on main and the close-out never arrived.
    [state('fixes'), JSON.stringify({ activity: 'idle', activitySince: NOW, dirty: true })],
    // The demo is on main, and clean.
    [state('demo'), JSON.stringify({ activity: 'idle', activitySince: NOW, dirty: false })],
  ])
  base(on, { projects: [MAIN] })
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: undefined }))
  on('process.run', (_, e) => output(processes(e.argv)))
  on('fs.read', (_, e) => ({ value: configuration(e.path) ?? file.get(e.path) ?? '' }))
  on('fs.write', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))

  await $.session.start({ cwd: '/Users/me/code/other', surface: 'desktop', isInteractive: true })
  const before = (await $.command.run(lanes('acme'))).text ?? ''
  expect(before.split('to clean')).toHaveLength(3)
  expect(before).toContain('Fixes: to clean')
  expect(before).not.toContain('Development: to clean')

  // Once the close-out arrives, so is development, until it cleans itself, with the branch still open.
  file.set(state('dev'), JSON.stringify({ ...DEV, handoff: closeOut, dirty: true }))
  const after = (await $.command.run(lanes('acme'))).text ?? ''
  expect(after).toContain('Development: to clean')

  // The Italian close-out line counts the same.
  file.set(state('dev'), JSON.stringify({ ...DEV, handoff: { ...closeOut, text: 'Chiusura del checkpoint 16' }, dirty: true }))
  expect((await $.command.run(lanes('acme'))).text).toContain('Development: to clean')
})

test('the coding session closed by the app while the work is in its hands wakes up, once', async ($, on) => {
  const dev = `${BENCH}/state/dev.json`
  const fixes = `${BENCH}/state/fixes.json`
  // The last message to development (local_3) came in an hour ago; fixes (local_4) has delivered.
  const came = new Date('2026-11-07T22:00:00').getTime()
  const file = new Map([
    [dev, JSON.stringify({ session: 'local_3', handoff: { direction: 'in', text: 'OK to the plan', peer: 'Rev', at: came } })],
    [fixes, JSON.stringify({ session: 'local_4', handoff: { direction: 'out', text: 'Delivery of C-9', peer: 'Rev', at: came } })],
  ])
  let log = [
    '2026-11-07 21:00:00 [info] [CliGovernor] pressure evicting local_3 (idle 90s)',
    `2026-11-07 21:30:00 [info] Resuming session local_3 in ${CLONES}/acme-dev`,
    '2026-11-07 22:57:40 [info] [CliGovernor] pressure evicting local_3 (idle 1810s)',
    '2026-11-07 22:58:00 [info] [CliGovernor] pressure evicting local_4 (idle 300s)',
  ].join('\n')
  const marks = new Set<string>()
  const sent: { to: string; text: string }[] = []
  base(on)
  on('clock.now', () => ({ value: new Date('2026-11-07T23:10:00').getTime() }))
  on('clock.every', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', (_, e) => {
    if (e.argv[0] === 'grep' && e.argv.at(-1) === '/Users/me/Library/Logs/Claude/main.log') return output(log)
    if (e.argv[0] === 'mkdir' && e.argv[1] !== '-p') {
      const fresh = !marks.has(e.argv[1] ?? '')
      marks.add(e.argv[1] ?? '')
      return { value: { exitCode: fresh ? 0 : 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    return output('')
  })
  on('fs.read', (_, e) => ({ value: configuration(e.path) ?? file.get(e.path) ?? '' }))
  on('fs.write', (_, e) => {
    file.set(e.path, e.text)
    return { value: undefined }
  })
  on('session.send', (_, e) => {
    sent.push({ to: e.to, text: e.text })
    return { isDelivered: true }
  })

  await $.session.start({ cwd: MAIN, surface: 'desktop', isInteractive: true })
  await $.command.run(lanes())
  // Development yes, once; fixes no, because the work is in the reviewer's hands.
  expect(sent).toHaveLength(1)
  expect(sent[0]?.to).toBe('local_3')
  expect(sent[0]?.text).toContain('Wake-up from metodo: at 22:57')
  expect([...marks]).toEqual([`${BENCH}/state/wakeups/local_3-2026-11-07T225740`])

  // On the next round it does not repeat.
  await $.command.run(lanes())
  expect(sent).toHaveLength(1)

  // Resumed after the closure, or closed before the last message: nothing.
  marks.clear()
  log += `\n2026-11-07 23:01:00 [info] Resuming session local_3 in ${CLONES}/acme-dev`
  await $.command.run(lanes())
  log = '2026-11-07 21:59:00 [info] [CliGovernor] pressure evicting local_3 (idle 1810s)'
  await $.command.run(lanes())
  expect(sent).toHaveLength(1)

  // After the «Close-out…» the job is no longer open, in English or in Italian.
  for (const text of ['Close-out of checkpoint 5', 'Chiusura del checkpoint 5']) {
    marks.clear()
    log = '2026-11-07 23:05:00 [info] [CliGovernor] pressure evicting local_3 (idle 1810s)'
    file.set(dev, JSON.stringify({ session: 'local_3', handoff: { direction: 'in', text, peer: 'Rev', at: came } }))
    await $.command.run(lanes())
    expect(sent).toHaveLength(1)
  }
})

// The app closes idle sessions, and the message that reopens one arrives as the first prompt of
// the new process, without session.receive.
test('the close-out that reopens the coding session arrives with the first turn, and still cleans it', async ($, on) => {
  const fixes = `${BENCH}/state/fixes.json`
  const file = new Map<string, string>()
  const clock = mock.clock(on, { now: NOW })
  const cleaned: string[] = []
  base(on)
  on('command.run', { command: 'clear' }, (_, e) => {
    cleaned.push(e.command)
    return { text: '' }
  })
  on('process.run', () => output(''))
  on('fs.read', (_, e) => ({ value: configuration(e.path) ?? file.get(e.path) ?? '' }))
  on('fs.write', (_, e) => {
    file.set(e.path, e.text)
    return { value: undefined }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.session.start({ cwd: `${CLONES}/acme-fixes`, surface: 'desktop', isInteractive: true })
  await $.turn.start({
    text: 'Another Claude session sent a message:\n<cross-session-message from="local_1" name="Reviewer">\nClose-out of C-12: merged to main.',
    turnId: 't',
  })
  expect(JSON.parse(file.get(fixes) ?? '{}').handoff).toEqual({
    direction: 'in',
    text: 'Close-out of C-12: merged to main.',
    peer: 'Reviewer',
    at: NOW,
  })
  await $.turn.complete({ reason: 'answer', answer: 'Understood.', durationMs: 1, isAborted: false, turnId: 't' })
  await clock.advance(1000)
  expect(cleaned).toEqual(['clear'])
})

// A /clear from the app on a session it had closed: no process hears session.end, and the next
// process has the same session id and another conversation.
test('a new conversation in the same coding session is clean; the same one, resumed, stays dirty', async ($, on) => {
  const fixes = `${BENCH}/state/fixes.json`
  const file = new Map([[fixes, '{"session":"local_9","dirty":true,"conversation":"c1"}']])
  let conversation = 'c1'
  base(on)
  on('session.id', () => ({ value: conversation }))
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: undefined }))
  on('process.run', () => output(''))
  on('fs.read', (_, e) => ({ value: configuration(e.path) ?? file.get(e.path) ?? '' }))
  on('fs.write', (_, e) => {
    file.set(e.path, e.text)
    return { value: undefined }
  })
  const dirty = () => JSON.parse(file.get(fixes) ?? '{}').dirty

  await $.session.start({ cwd: `${CLONES}/acme-fixes`, surface: 'desktop', isInteractive: true })
  expect(dirty()).toBe(true)
  conversation = 'c2'
  await $.session.start({ cwd: `${CLONES}/acme-fixes`, surface: 'desktop', isInteractive: true })
  expect(dirty()).toBe(false)
  expect(JSON.parse(file.get(fixes) ?? '{}').conversation).toBe('c2')
})

// The app starts sessions in a spare folder and moves them into the project afterwards.
test('a session started in a spare folder orients itself once it is in the clone', async ($, on) => {
  const fixes = `${BENCH}/state/fixes.json`
  const file = new Map<string, string>()
  let cwd = '/Users/me/.claude/spares/spare-1'
  base(on)
  on('session.cwd', () => ({ value: cwd }))
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: undefined }))
  on('process.run', () => output(''))
  on('fs.read', (_, e) => ({ value: configuration(e.path) ?? file.get(e.path) ?? '' }))
  on('fs.write', (_, e) => {
    file.set(e.path, e.text)
    return { value: undefined }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))

  await $.session.start({ cwd, surface: 'desktop', isInteractive: true })
  expect(file.size).toBe(0)
  cwd = `${CLONES}/acme-fixes`
  await $.turn.start({ text: 'Prompt for C-12', turnId: 't' })
  const a = JSON.parse(file.get(fixes) ?? '{}')
  expect(a.session).toBe('local_9')
  expect(a.dirty).toBe(true)
  expect(a.activity).toBe('working')
})
