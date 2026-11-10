import assert from 'node:assert/strict'
import test from 'node:test'
import type { ConnectionGeneration } from '@deepseek-ai/dsh-client-connection/client'
import type { PreparingToolCall } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import {
  AnalysisCandidates,
  analysisCandidate,
  candidateResources,
} from '../../src/client/analysis-ui/candidate.ts'
import { pendingAnalysisStatement } from '../../src/client/analysis-ui/streaming-program.ts'
import type { AnalysisResource } from '../../src/presentation/contracts/analysis-document.ts'
import {
  analysisStatements,
  mergeAnalysisProgram,
  parseAnalysisProgram,
} from '../../src/presentation/contracts/analysis-program.ts'

const generation = {} as ConnectionGeneration
function call(args: PartialArguments, callId = 'call'): PreparingToolCall {
  return {
    phase: 'preparing',
    args,
    callId,
    name: 'marivo_present',
    turn: 1,
    step: 1,
    time: 1,
    subCalls: [],
  }
}

test('resource patch previews retain only unchanged admitted resources', () => {
  const image = (path: string): AnalysisResource => ({
    kind: 'image',
    declaration: { kind: 'image-file', path },
    mimeType: 'image/png',
    dataUrl: 'data:image/png;base64,AA==',
    sha256: 'a'.repeat(64),
  })
  const old = image('old.png')
  const kept = image('kept.png')
  const document = { resources: { old, kept } }
  const project = (args: PartialArguments) =>
    candidateResources(document, analysisCandidate(call(args), 's', 'w', generation))
  assert.deepEqual(project(PartialArguments.fromObject({})), { old, kept })
  const latePatch = new PartialArguments()
  latePatch.append('{"surface":"tool","program":"root = Image(\\"New scope\\", \\"old\\");"')
  assert.deepEqual(project(latePatch), { old, kept })
  latePatch.append(',"resourcePatch":{"put":{"old":{"kind":"image-file","path":"new.png"}}}}')
  assert.deepEqual(project(latePatch), { kept })
  const textOnly = new PartialArguments()
  textOnly.append('{"surface":"tool","program":"root = TextContent(\\"Updated\\");"')
  assert.deepEqual(project(textOnly), { old, kept })
  textOnly.append('}')
  assert.deepEqual(project(textOnly), { old, kept })
  const prefix = new PartialArguments()
  prefix.append('{"resourcePatch":{"put":{"old":{"kind":"image-file","path":"new')
  assert.deepEqual(project(prefix), { old, kept })
  assert.deepEqual(
    project(
      PartialArguments.fromObject({
        resourcePatch: { put: { old: image('new.png').declaration } },
      }),
    ),
    { kept },
  )
  assert.deepEqual(
    project(PartialArguments.fromObject({ resourcePatch: { put: { old: old.declaration } } })),
    { old, kept },
  )
  assert.deepEqual(project(PartialArguments.fromObject({ resourcePatch: { remove: ['old'] } })), {
    kept,
  })
  for (const resourcePatch of [
    { put: { old: old.declaration }, remove: ['old'] },
    { remove: ['old', 'old'] },
    { remove: ['missing'] },
    { put: { old: { kind: 'image-file' } } },
  ])
    assert.deepEqual(project(PartialArguments.fromObject({ resourcePatch })), {})
  assert.deepEqual(
    project(PartialArguments.fromObject({ resources: {}, resourcePatch: { put: {} } })),
    { old, kept },
  )
})

test('raw prefixes preserve incomplete statement ownership after candidate auto-closing', () => {
  assert.equal(
    pendingAnalysisStatement(
      'root = Stack([ready, plot]);\nplot = DatasetView("data", {chart:"bar", encoding:{axis:"cat',
    ),
    'plot',
  )
  assert.equal(pendingAnalysisStatement('root = DatasetView("data", {chart:"table"})'), undefined)
  assert.equal(
    pendingAnalysisStatement(
      'root = DatasetView("data", {chart:"table"});\nnote=TextContent("open',
    ),
    'note',
  )
})

test('draft identifiers without an explicit stage never project a save action', () => {
  const candidate = analysisCandidate(
    call(PartialArguments.fromObject({ draftId: 'draft', draftRevision: 'revision' })),
    's',
    'w',
    generation,
  )
  assert.equal(candidate.stage, undefined)
})
test('Native prefixes stream in Chat without model-controlled placement', () => {
  const args = new PartialArguments()
  args.append('{"surface":"to')
  assert.equal(analysisCandidate(call(args), 's', 'w', generation).surface, 'tool')
  args.append('ol","program":"root = TextContent(\\"Native')
  const prefix = analysisCandidate(call(args), 's', 'w', generation)
  assert.equal(prefix.preview, true)
  assert.equal(prefix.complete, false)
  assert.match(prefix.program, /Native/)
  args.append(' prefix\\");"}')
  assert.equal(analysisCandidate(call(args), 's', 'w', generation).complete, true)
  const late = PartialArguments.fromText(
    '{"program":"root = TextContent(\\"Late\\");","surface":"tab"}',
  )
  assert.equal(analysisCandidate(call(late), 's', 'w', generation).preview, true)
  const base = new PartialArguments()
  base.append('{"surface":"tool","basedOnRecordId":"marivo-ui:a:')
  assert.equal(analysisCandidate(call(base), 's', 'w', generation).basedOnRecordId, undefined)
})
test('call projection isolates Session, Workspace, connection and PTC child ownership and revokes candidates', () => {
  const store = new AnalysisCandidates(),
    args = PartialArguments.fromObject({ surface: 'tab', program: 'root = TextContent("PTC");' })
  const child = { ...call(args, 'child'), phase: 'start' as const, argsRaw: '{}' }
  const parent = { ...call(PartialArguments.EMPTY, 'parent'), name: 'run_code', subCalls: [child] }
  store.observe([parent], 's', 'w', generation, () => {})
  assert.equal(store.get('s', 1, 'parent'), undefined)
  assert.equal(store.get('s', 1, 'child')?.program, 'root = TextContent("PTC");')
  store.observe([child], 'other', 'other-workspace', generation, () => {})
  store.settle('s')
  assert.equal(store.get('s', 1, 'child')?.phase, 'cancelled')
  assert.equal(store.get('other', 1, 'child')?.phase, 'start')
  store.revoke('s')
  assert.equal(store.get('s', 1, 'child'), undefined)
})
test('complete statement admission rejects silently ignored input and merges semicolon boundaries safely', () => {
  for (const patch of [
    'garbage',
    'note = TextContent("broken',
    'note = TextContent("ok") garbage',
    'garbage\nnote = TextContent("ok");',
  ])
    assert.throws(() => analysisStatements(patch), patch)
  const base = 'note = TextContent("Before"); root = Stack([note]);'
  const merged = mergeAnalysisProgram(base, 'note = TextContent("After");')
  assert.equal(parseAnalysisProgram(merged).typeName, 'Stack')
  assert.match(merged, /After/)
  assert.throws(() => parseAnalysisProgram(mergeAnalysisProgram(base, 'note = null;')))
})

test('reused call IDs keep cancelled, live and settled candidates in their owning Turn', () => {
  const store = new AnalysisCandidates()
  const args = PartialArguments.fromObject({
    surface: 'tab',
    program: 'root = TextContent("page")',
  })
  const first = call(args, 'reused')
  store.observe([first], 's', 'w', generation, () => {})
  store.settle('s')
  const second = { ...first, turn: 2 }
  store.observe([first, second], 's', 'w', generation, () => {})
  assert.equal(store.get('s', 1, 'reused')?.phase, 'cancelled')
  assert.equal(store.get('s', 2, 'reused')?.phase, 'preparing')
  // Settled ToolResultNode has no turn; the public Chat location owns it.
  const failed = {
    kind: 'tool-result' as const,
    seq: 10,
    time: 1,
    callId: 'reused',
    name: 'marivo_present',
    args,
    call: null,
    callTime: null,
    content: [],
    isError: true,
    subCalls: [],
  }
  store.observe([failed], 's', 'w', generation, () => {}, 2)
  assert.equal(store.get('s', 1, 'reused')?.phase, 'cancelled')
  assert.equal(store.get('s', 2, 'reused')?.phase, 'failed')
})

test('a late unfinished base ID blocks standalone patch preview until its identity is complete', () => {
  const args = new PartialArguments()
  args.append(
    '{"surface":"tool","program":"root = TextContent(\\"patch\\");","basedOnRecordId":"marivo-ui:a:',
  )
  const partial = analysisCandidate(call(args), 's', 'w', generation)
  assert.equal(partial.complete, true)
  assert.equal(partial.basedOnRecordId, undefined)
  assert.equal(partial.preview, false)
  args.append('b"}')
  const complete = analysisCandidate(call(args), 's', 'w', generation)
  assert.equal(complete.basedOnRecordId, 'marivo-ui:a:b')
  assert.equal(complete.preview, true)
})

test('patch admission rejects edits discarded by merger GC and preserves referenced additions', () => {
  const base = 'root = TextContent("Before")'
  for (const patch of [
    'bad = TotallyMissing("bad")',
    'bad = TextContent(42)',
    'bad = TextContent("unreachable")',
    'root = TextContent("one"); root = TextContent("two")',
  ])
    assert.throws(() => mergeAnalysisProgram(base, patch))
  const added = mergeAnalysisProgram(base, 'root = Stack([note]); note = TextContent("Added")')
  assert.equal(parseAnalysisProgram(added).typeName, 'Stack')
  const removed = mergeAnalysisProgram(added, 'root = TextContent("Replaced"); note = null')
  assert.equal(parseAnalysisProgram(removed).typeName, 'TextContent')
})
