import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createParser, mergeStatements } from '@openuidev/lang-core'
import { patch, program } from '../../scripts/unified-analysis-ui/fixture.ts'
import {
  analysisCatalogSchema,
  analysisCatalogSpec,
} from '../../src/presentation/contracts/analysis-catalog.ts'
import { parseAnalysisProgram } from '../../src/presentation/contracts/analysis-program.ts'

test('generated Host schema matches the installed Client library without importing React into Host', async () => {
  execFileSync(process.execPath, [
    'packages/dsh-data-analysis/scripts/generate-analysis-catalog.mjs',
    '--check',
  ])
  assert.deepEqual(Object.keys(analysisCatalogSpec.components).sort(), [
    'AnalysisFrameView',
    'Card',
    'DatasetView',
    'Image',
    'Stack',
    'TabItem',
    'Tabs',
    'TextContent',
  ])
  const generated = await readFile(
    new URL('../../src/presentation/contracts/analysis-catalog.ts', import.meta.url),
    'utf8',
  )
  assert.doesNotMatch(generated, /from ['"](?:react|@openuidev\/react)/)
  for (const name of ['AnalysisFrameView', 'DatasetView']) {
    assert.equal(parseAnalysisProgram(`root = ${name}("resource");`).typeName, name)
    assert.match(analysisCatalogSpec.components[name]!.signature, /ref: string, view\?/)
  }
  assert.equal(parseAnalysisProgram(program).typeName, 'Stack')
})

test('unsupported nodes and wrong parent slots cannot enter the subset', () => {
  for (const source of [
    'root = Button("unsupported");',
    'root = Card([Stack([Button("unsupported")])]);',
    'root = Stack(["not a component"]);',
    'root = Tabs([DatasetView("wrong-parent")]);',
    'root = Stack([TabItem("wrong", "wrong", [])]);',
    'root = TabItem("wrong", "wrong", []);',
    'root = AnalysisFrameView("frame", {chart: "line"});',
    'root = DatasetView("sql", {chart: "metric"});',
  ])
    assert.throws(() => parseAnalysisProgram(source), source)
})

test('official statement merge adds, replaces and removes in one patch', () => {
  const merged = mergeStatements(program, patch)
  const root = parseAnalysisProgram(merged)
  assert.match(merged, /P0 updated/)
  assert.match(merged, /P0 added/)
  assert.doesNotMatch(merged, /tabs\s*=/)
  assert.ok(Array.isArray(root.props.children))
  assert.equal(root.props.children.length, 3)
  const parser = createParser(analysisCatalogSchema)
  assert.equal(parser.parse(merged).meta.errors.length, 0)
})
