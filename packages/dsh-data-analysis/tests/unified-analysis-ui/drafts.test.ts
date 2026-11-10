import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { ConnectionGeneration } from '@deepseek-ai/dsh-client-connection/client'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import { analysisCandidate } from '../../src/client/analysis-ui/candidate.ts'
import { AnalysisDraftViews } from '../../src/client/analysis-ui/drafts.ts'
import { streamingAnalysisProgram } from '../../src/client/analysis-ui/streaming-program.ts'
import { parseAnalysisProgram } from '../../src/presentation/contracts/analysis-program.ts'
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

test('legacy draft projection streams subsequent calls with verified revision metadata', () => {
  const views = new AnalysisDraftViews()
  views.preview(delivery('tab'), generation, '/workspace')
  const args = new PartialArguments()
  args.append(
    `{"draftId":"${draftId}","draftRevision":"${draftRevision}","stage":"preview","program":"root = TextContent(\\"Next`,
  )
  views.observe(candidate(args, 'next'), '/workspace')
  assert.equal(views.get('session', 1)?.candidate?.surface, 'tool')
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

test('unknown patch scope retains old resource configuration while text continues, then admits component updates and deletion', () => {
  const base =
    'root=Stack([intro, plot, other]); intro=TextContent("Before"); plot=DatasetView("data", {chart:"table"}); other=TextContent("Retained");'
  const prefix =
    'intro=TextContent("During"); plot=DatasetView("data", {chart:"metric", encoding:{values:["new"]}});'
  const pending = streamingAnalysisProgram(base, prefix, true, true)
  assert.match(pending, /During/)
  assert.match(pending, /chart:\s*"table"/)
  assert.doesNotMatch(pending, /metric/)
  const known = streamingAnalysisProgram(base, prefix, true, false)
  assert.match(known, /metric/)
  const removed = streamingAnalysisProgram(base, 'root=Stack([intro, other]); plot=null;')
  assert.doesNotMatch(removed, /DatasetView/)
  assert.match(removed, /Retained/)
})

test('resource configuration aliases and their transitive dependencies retain admitted values while independent text streams', () => {
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
  assert.equal(components[2]?.props.text, 'Live independent text')
})

test('a resource shared dependency keeps one admitted value and does not freeze unrelated layout text', () => {
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
  assert.equal(components[2]?.props.text, 'Live text')
  const admitted = parseAnalysisProgram(streamingAnalysisProgram(base, patch, true, false))
  assert.equal(
    (admitted.props.children as typeof components)[0]?.props.alt,
    'Candidate replacement',
  )
})
