import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { ConnectionGeneration } from '@deepseek-ai/dsh-client-connection/client'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import { analysisCandidate } from '../../src/client/analysis-ui/candidate.ts'
import { AnalysisDraftViews } from '../../src/client/analysis-ui/drafts.ts'
import { streamingAnalysisProgram } from '../../src/client/analysis-ui/streaming-program.ts'
import {
  analysisStatements,
  parseAnalysisProgram,
} from '../../src/presentation/contracts/analysis-program.ts'
import { draftReportRef } from '../../src/presentation/contracts/report-ref.ts'
import { draftDeliverySchema } from '../../src/presentation/receipt.ts'

const generation = {} as ConnectionGeneration
const draftId = randomUUID()
const draftRevision = randomUUID()
const ref = draftReportRef({
  workspaceId: 'workspace',
  sessionId: 'session',
  turn: 1,
  draftId,
  revision: draftRevision,
})
function candidate(args: PartialArguments, callId = 'first') {
  return analysisCandidate(
    {
      phase: 'preparing',
      args,
      callId,
      name: 'marivo_report_write',
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

test('both surfaces defer prefixes until optional identities are settled', () => {
  for (const surface of ['tool', 'tab']) {
    const args = new PartialArguments()
    args.append(
      `{"surface":"${surface}","stage":"preview","program":"root = TextContent(\\"Visible`,
    )
    const prefix = candidate(args)
    assert.equal(prefix.stage, 'preview')
    assert.equal(prefix.preview, false)
    args.append('\\");"}')
    assert.equal(candidate(args).preview, true)
    assert.equal(prefix.complete, false)
    assert.match(prefix.program, /Visible/)
  }
})

test('legacy draft projection streams subsequent calls with verified revision metadata', () => {
  const views = new AnalysisDraftViews()
  views.preview(delivery('tab'), generation, '/workspace')
  const args = new PartialArguments()
  args.append(`{"ref":"${ref}","stage":"preview","program":"root = TextContent(\\"Next`)
  views.observe(candidate(args, 'next'), '/workspace')
  assert.equal(views.get('session', 1)?.candidate?.surface, 'tool')
  assert.equal(views.get('session', 1)?.candidate?.preview, false)
  args.append('\\");"}')
  views.observe(candidate(args, 'next'), '/workspace')
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
  args.append(`{"stage":"preview","ref":"mr1:d:partial`)
  assert.equal(candidate(args).preview, false)
  const views = new AnalysisDraftViews()
  views.preview(delivery('tool'), generation, '/workspace')
  const other = candidate(
    PartialArguments.fromObject({
      surface: 'tab',
      stage: 'preview',
      ref: draftReportRef({
        workspaceId: 'workspace',
        sessionId: 'session',
        turn: 1,
        draftId: randomUUID(),
        revision: draftRevision,
      }),
      program: 'root = TextContent("foreign")',
    }),
  )
  views.observe(other, '/workspace')
  assert.equal(views.get('session', 1)?.candidate, undefined)
})

test('streaming patches retain admitted definitions and forward partial syntax to OpenUI', () => {
  const base =
    'root = Stack([intro, detail]);\nintro = TextContent("Before");\ndetail = TextContent("Retained");'
  const partial = streamingAnalysisProgram(base, 'intro = TextContent("During')
  assert.doesNotMatch(partial, /During/)
  assert.match(partial, /Retained/)
  const next = streamingAnalysisProgram(base, 'intro = TextContent("During");\nro')
  assert.match(next, /During/)
  assert.match(next, /Retained/)
  const added = streamingAnalysisProgram(
    base,
    'root = Stack([intro, detail, extra]); extra = TextContent("New sec',
  )
  assert.doesNotMatch(added, /New sec/)
  assert.match(added, /Retained/)
  assert.equal(streamingAnalysisProgram(base, ''), analysisStatements(base))
})

test('unknown patch scope holds the base, then applies known component updates and deletion', () => {
  const base =
    'root=Stack([intro, plot, other]); intro=TextContent("Before"); plot=DatasetView("data", {chart:"table"}); other=TextContent("Retained");'
  const prefix =
    'intro=TextContent("During"); plot=DatasetView("data", {chart:"metric", encoding:{values:["new"]}});'
  const pending = streamingAnalysisProgram(base, prefix, true, true)
  assert.doesNotMatch(pending, /During/)
  assert.match(pending, /chart:\s*"table"/)
  assert.doesNotMatch(pending, /metric/)
  const known = streamingAnalysisProgram(base, prefix, true, false)
  assert.match(known, /metric/)
  const removed = streamingAnalysisProgram(base, 'root=Stack([intro, other]); plot=null;')
  assert.doesNotMatch(JSON.stringify(parseAnalysisProgram(removed)), /DatasetView/)
  assert.match(removed, /Retained/)
})

test('unknown patch scope retains aliases, resource configuration and text together', () => {
  const base =
    'root=Stack([picture, plot, note]); picture=Image(label, "image"); label=shared; shared="Admitted image"; plot=DatasetView(resourceName, chart, dimensions); resourceName=resourceAlias; resourceAlias="data"; chart={chart:chartKind}; chartKind="table"; dimensions={height:height}; height=300; note=TextContent("Before");'
  const patch =
    'label="Candidate replacement"; shared="Changed shared"; resourceAlias="new-data"; chartKind="metric"; height=600; note=TextContent("Live independent text");'
  const pending = parseAnalysisProgram(streamingAnalysisProgram(base, patch, true, true))
  const components = pending.props.children as {
    typeName: string
    props: Record<string, unknown>
  }[]
  assert.equal(components[0]?.props.alt, 'Admitted image')
  assert.equal(components[1]?.props.ref, 'data')
  assert.deepEqual(components[1]?.props.view, { chart: 'table' })
  assert.deepEqual(components[1]?.props.display, { height: 300 })
  assert.equal(components[2]?.props.text, 'Before')
})

test('shared dependencies update together after patch scope becomes known', () => {
  const base =
    'root=Stack([picture, sharedText, live]); picture=Image(label, "image"); label=shared; shared="Admitted image"; sharedText=TextContent(shared); live=TextContent("Before");'
  const patch = 'shared="Candidate replacement"; live=TextContent("Live text");'
  const pending = parseAnalysisProgram(streamingAnalysisProgram(base, patch, true, true))
  const components = pending.props.children as {
    typeName: string
    props: Record<string, unknown>
  }[]
  assert.equal(components[0]?.props.alt, 'Admitted image')
  assert.equal(components[1]?.props.text, 'Admitted image')
  assert.equal(components[2]?.props.text, 'Before')
  const admitted = parseAnalysisProgram(streamingAnalysisProgram(base, patch, true, false))
  assert.equal(
    (admitted.props.children as typeof components)[0]?.props.alt,
    'Candidate replacement',
  )
})
