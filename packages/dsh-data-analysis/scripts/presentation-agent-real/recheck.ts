/** Recheck retained real outputs after an acceptance detector changes; never reruns the model. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { bindMarivoEnvironment } from '../../src/environment/index.ts'
import { parsePresentationDocument } from '../../src/presentation/contracts/index.ts'
import { actualDeliveries } from '../presentation-s4/host.ts'
import { journeys } from './fixtures.ts'
import { assessLifecycle, type RuntimeObservation, verifyReport } from './verify.ts'

const outputRoot = path.resolve(process.argv[2]!)
const journey = journeys.find((item) => item.id === process.argv[3])
assert.ok(journey, 'Pass an evidence root and exact journey id')
const root = path.join(outputRoot, journey.id)
const workspaceRoot = path.join(root, 'workspace')
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const saved = JSON.parse(
  await readFile(path.join(root, `turn-${journey.prompts.length}-events.json`), 'utf8'),
) as { events: SessionEvent[] }
const deliveryEvent = saved.events.find(
  (event) =>
    event.type === 'tool/result' &&
    (event.data.meta as { kind?: string } | undefined)?.kind === 'marivo.presentation.delivery',
)
assert.ok(deliveryEvent?.type === 'tool/result')
const sessionId = (deliveryEvent.data.meta as { dshSessionId: string }).dshSessionId
const deliveries = actualDeliveries(saved.events, sessionId)
assert.equal(deliveries.length, 1)
const receipt = deliveries[0]!.receipt
for (const file of Object.values(receipt.files))
  assert.equal(digest(await readFile(file.path)), file.sha256)
const document = parsePresentationDocument(
  JSON.parse(await readFile(receipt.files.document.path, 'utf8')),
)
const numericalEvidence = verifyReport(document, journey.id)
const observations = (await readFile(path.join(outputRoot, 'runtime-observations.jsonl'), 'utf8'))
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line) as RuntimeObservation)
  .filter((item) => item.cwd === workspaceRoot)
const lifecycle = assessLifecycle(observations)
const legacyPids = [
  ...new Set(
    observations
      .filter((item) => item.agentCode && item.operation === '__init__')
      .map((item) => item.pid),
  ),
].filter((pid) => !observations.some((item) => item.pid === pid && item.operation === 'acquire'))
const produced = observations.filter(
  (item) =>
    item.operation === 'observe' || item.operation === 'compare' || item.operation === 'attribute',
)
const turns = await Promise.all(
  journey.prompts.map(
    async (_, index) =>
      JSON.parse(await readFile(path.join(root, `turn-${index + 1}-trace.json`), 'utf8')) as {
        prompt: string
        started: number
        finished: number
        finalText: string
        calls: { name: string; arguments: Record<string, unknown>; isError: boolean | null }[]
      },
  ),
)
const fixture = JSON.parse(await readFile(path.join(root, 'fixture.json'), 'utf8')) as {
  binding: { pythonExecutable: string }
}
const environment = await bindMarivoEnvironment({
  projectRoot: workspaceRoot,
  pythonExecutable: fixture.binding.pythonExecutable,
})
const publicRead = await environment.runChecked({
  program: await readFile(new URL('./read-artifact-contracts.py', import.meta.url), 'utf8'),
  args: [JSON.stringify(document.sources.map((source) => source.ref))],
})
assert.equal(publicRead.exitCode, 0, publicRead.stderr.toString('utf8'))
const persistedArtifacts = JSON.parse(publicRead.stdout.toString('utf8')) as {
  sessionId: string
  artifactRef: string
  createdAt: string
  contract: unknown
}[]
for (const source of document.sources)
  assert.ok(
    persistedArtifacts.some(
      (item) =>
        item.sessionId === source.ref.sessionId && item.artifactRef === source.ref.artifactRef,
    ),
    'Report source must resolve to its exact persisted Session/Artifact identity',
  )
await writeFile(
  path.join(root, 'persisted-artifact-contracts.json'),
  JSON.stringify(persistedArtifacts, null, 2),
  { mode: 0o600 },
)
const calls = turns.at(-1)!.calls
const present = calls.filter((call) => call.name === 'marivo_present' && !call.isError)
assert.equal(present.length, 1)
const draftPath = path.resolve(workspaceRoot, String(present[0]!.arguments.draft_path))
assert.ok(draftPath.startsWith(`${workspaceRoot}${path.sep}`))
const draftSha256 = digest(await readFile(draftPath))
let reuse: unknown = null
if (journey.id === 'semantic-gap-reuse') {
  const boundary = turns[1]!.started
  const initial = produced.filter((item) => item.timeMs < boundary)
  const later = observations.filter((item) => item.timeMs >= boundary)
  reuse = {
    classification: 'observation-only',
    initial,
    recovered: later.filter((item) => item.operation === 'artifact'),
    secondTurnObserveCount: later.filter((item) => item.operation === 'observe').length,
    sources: document.sources.map((source) => ({
      ...source.ref,
      persistedCreatedInFirstTurn: persistedArtifacts.some(
        (item) =>
          item.sessionId === source.ref.sessionId &&
          item.artifactRef === source.ref.artifactRef &&
          Date.parse(item.createdAt) >= turns[0]!.started &&
          Date.parse(item.createdAt) < boundary,
      ),
    })),
    boundary:
      'Reuse and repeated observation are efficiency observations, not report acceptance gates. Retained identities support review of whether new results were represented as earlier Artifacts.',
  }
}
const evidence = {
  status: 'passed-awaiting-semantic-review',
  outputRoot,
  workspaceRoot,
  binding: fixture.binding,
  bindingEvidencePath: path.join(root, 'fixture.json'),
  journeyId: journey.id,
  sessionId,
  receipt,
  draftPaths: [draftPath],
  draftSha256,
  numericalEvidence,
  persistedArtifacts,
  lifecycle,
  reuse,
  legacyObserverPids: legacyPids,
  observerLimit: legacyPids.length
    ? 'Earlier observer retained constructors rather than public factory returns. Those processes require explicit review; no acquisition events have been invented.'
    : null,
  originalRunEvidencePreserved: true,
  reviewObligations: journey.reviewObligations,
  boundary:
    'Only saved report bytes, real transcript, runtime observations and public persisted Artifact metadata/contracts were read with use_datasources=False. No model or business query replay. Numeric bindings do not certify narrative, scope labels or execution obligations.',
}
await writeFile(path.join(root, 'recheck-evidence.json'), JSON.stringify(evidence, null, 2), {
  mode: 0o600,
})
await writeFile(
  path.join(root, 'semantic-review.md'),
  [
    `# ${journey.title}：实际产物待审查`,
    '',
    ...journey.reviewObligations.map((item) => `- ${item}`),
    '',
    ...turns.flatMap((turn, index) => [`## 第 ${index + 1} 轮最终答复`, '', turn.finalText, '']),
    '## 报告正文',
    '',
    ...document.blocks.flatMap((block) => (block.kind === 'markdown' ? [block.text, ''] : [])),
  ].join('\n'),
  { mode: 0o600 },
)
process.stdout.write(
  JSON.stringify({ status: evidence.status, path: path.join(root, 'recheck-evidence.json') }) +
    '\n',
)
