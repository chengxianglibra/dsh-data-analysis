import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { ConnectionGeneration } from '@deepseek-ai/dsh-client-connection/client'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import { analysisCandidate } from '../../src/client/analysis-ui/candidate.ts'
import { AnalysisDraftViews } from '../../src/client/analysis-ui/drafts.ts'
import { streamingAnalysisProgram } from '../../src/client/analysis-ui/streaming-program.ts'
import { draftDeliverySchema } from '../../src/presentation/receipt.ts'

const generation = {} as ConnectionGeneration
const draftId = randomUUID()
const draftRevision = randomUUID()
function candidate(args: PartialArguments, callId = 'first') {
  return analysisCandidate(
    {
      phase: 'preparing',
      args,
      callId,
      name: 'marivo_present',
      turn: 1,
      step: 1,
      time: 1,
      subCalls: [],
    },
    'session',
    'workspace',
    generation,
  )
}
function delivery(surface: 'tool' | 'tab') {
  return draftDeliverySchema.parse({
    kind: 'marivo.presentation.draft',
    dshSessionId: 'session',
    workspaceId: 'workspace',
    turn: 1,
    surface,
    draftId,
    draftRevision,
  })
}

test('both surfaces enable Native preview prefixes before arguments complete', () => {
  for (const surface of ['tool', 'tab']) {
    const args = new PartialArguments()
    args.append(
      `{"surface":"${surface}","stage":"preview","program":"root = TextContent(\\"Visible`,
    )
    const prefix = candidate(args)
    assert.equal(prefix.stage, 'preview')
    assert.equal(prefix.preview, true)
    assert.equal(prefix.complete, false)
    assert.match(prefix.program, /Visible/)
  }
})

test('the same draft inherits its surface and streams subsequent calls with verified revision metadata', () => {
  const views = new AnalysisDraftViews()
  views.preview(delivery('tab'), generation, '/workspace')
  const args = new PartialArguments()
  args.append(
    `{"draftId":"${draftId}","draftRevision":"${draftRevision}","stage":"preview","program":"root = TextContent(\\"Next`,
  )
  views.observe(candidate(args, 'next'), '/workspace')
  assert.equal(views.get('session', 1)?.candidate?.surface, 'tab')
  assert.equal(views.get('session', 1)?.candidate?.preview, true)
  assert.equal(views.get('session', 1)?.delivery?.draftRevision, draftRevision)
  views.settle('session')
  assert.equal(views.get('session', 1)?.candidate?.phase, 'cancelled')
  assert.equal(views.get('session', 1)?.delivery?.draftRevision, draftRevision)
  views.revoke('session')
  assert.equal(views.get('session', 1), undefined)
})

test('incomplete draft identifiers cannot enable streaming or replace an unrelated draft', () => {
  const args = new PartialArguments()
  args.append(`{"surface":"tool","stage":"preview","draftId":"${draftId}","draftRevision":"partial`)
  assert.equal(candidate(args).preview, false)
  const views = new AnalysisDraftViews()
  views.preview(delivery('tool'), generation, '/workspace')
  const other = candidate(
    PartialArguments.fromObject({
      surface: 'tab',
      stage: 'preview',
      draftId: randomUUID(),
      draftRevision,
      program: 'root = TextContent("foreign")',
    }),
  )
  views.observe(other, '/workspace')
  assert.equal(views.get('session', 1)?.candidate, undefined)
})

test('streaming patches preserve the base and show partial replacement text and newly reachable sections', () => {
  const base =
    'root = Stack([intro, detail]);\nintro = TextContent("Before");\ndetail = TextContent("Retained");'
  const partial = streamingAnalysisProgram(base, 'intro = TextContent("During')
  assert.match(partial, /During/)
  assert.match(partial, /Retained/)
  const next = streamingAnalysisProgram(base, 'intro = TextContent("During");\nro')
  assert.match(next, /During/)
  assert.match(next, /Retained/)
  const added = streamingAnalysisProgram(
    base,
    'root = Stack([intro, detail, extra]); extra = TextContent("New sec',
  )
  assert.match(added, /New sec/)
  assert.match(added, /Retained/)
  assert.equal(streamingAnalysisProgram(base, ''), base)
})
