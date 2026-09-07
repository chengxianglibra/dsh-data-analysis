import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  PresentationContractError,
  parsePresentationDocument,
  parsePresentationDraft,
} from '../../src/presentation/contracts/index.ts'

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'))
const codeRef = {
  executionId: '12345678-1234-4567-89ab-123456789abc',
  sha256: 'a'.repeat(64),
}
const python = {
  ...codeRef,
  language: 'python',
  provenance: 'execution',
  text: 'query = "SELECT \'literal-value\'"\nprint("</script>📊")\n',
}
const sql = {
  language: 'sql',
  provenance: 'execution',
  runId: 'run-produced',
  queryId: 'query-executed',
  artifactRef: 'art-input',
  text: "SELECT 'literal-value', '</script>📊'\n-- original comment\n",
}

function invalid(run: () => unknown, location: string) {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof PresentationContractError)
    assert.equal(error.path, location)
    return true
  })
}

test('drafts link captured Python by exact receipt, never accept authored execution text', () => {
  for (const name of ['artifact', 'computed']) {
    const draft = fixture(`${name}.draft`)
    draft.datasets[0].codeRefs = [codeRef]
    assert.deepEqual(parsePresentationDraft(draft).datasets[0]!.codeRefs, [codeRef])
    draft.datasets[0].codeRefs[0] = python
    invalid(() => parsePresentationDraft(draft), '/datasets/0/codeRefs/0/language')
    delete draft.datasets[0].codeRefs
    draft.datasets[0].code = [python]
    invalid(() => parsePresentationDraft(draft), '/datasets/0/code')
  }
})

test('execution references reject paths, malformed digests, duplicates and over-budget lists', () => {
  for (const [refs, location] of [
    [[{ ...codeRef, executionId: '../outside' }], '/datasets/0/codeRefs/0/executionId'],
    [[{ ...codeRef, sha256: 'invalid' }], '/datasets/0/codeRefs/0/sha256'],
    [[codeRef, codeRef], '/datasets/0/codeRefs'],
    [Array.from({ length: 33 }, () => codeRef), '/datasets/0/codeRefs'],
  ] as const) {
    const draft = fixture('computed.draft')
    draft.datasets[0].codeRefs = refs
    invalid(() => parsePresentationDraft(draft), location)
  }
})

test('saved Python and SQL retain exact source text with separate execution identities', () => {
  const document = fixture('artifact.document')
  document.datasets[0].code = [python]
  document.sources[0].code = { snippets: [sql], notices: [] }
  const parsed = parsePresentationDocument(JSON.parse(JSON.stringify(document)))
  assert.deepEqual(parsed.datasets[0]!.code, [python])
  const source = parsed.sources[0]!
  assert.equal(source.status, 'available')
  assert.deepEqual(source.code, { snippets: [sql], notices: [] })
  document.sources[0].code.snippets.push({ ...sql, queryId: 'query-second' })
  assert.doesNotThrow(() => parsePresentationDocument(document))
  document.sources[0].code.snippets.push(sql)
  invalid(() => parsePresentationDocument(document), '/sources/0/code/snippets')
})

test('saved execution code validates provenance, nonblank content and UTF-8 Python budget', () => {
  for (const [change, location] of [
    [{ provenance: 'author' }, '/datasets/0/code/0'],
    [{ text: ' \n ' }, '/datasets/0/code/0/text'],
    [{ text: '中'.repeat(43_691) }, '/datasets/0/code/0/text'],
  ] as const) {
    const document = fixture('artifact.document')
    document.datasets[0].code = [{ ...python, ...change }]
    invalid(() => parsePresentationDocument(document), location)
  }
  const document = fixture('artifact.document')
  document.sources[0].code = { snippets: [{ ...sql, text: 'x'.repeat(32_769) }], notices: [] }
  invalid(() => parsePresentationDocument(document), '/sources/0/code/snippets/0/text')
})

test('missing SQL can be recorded without turning a readable Artifact into unavailable', () => {
  const document = fixture('artifact.document')
  document.sources[0].code = { snippets: [], notices: ['该来源没有已保存的 SQL 查询。'] }
  assert.equal(parsePresentationDocument(document).sources[0]!.status, 'available')
  document.sources[0].code.notices.push('该来源没有已保存的 SQL 查询。')
  invalid(() => parsePresentationDocument(document), '/sources/0/code/notices')
})
