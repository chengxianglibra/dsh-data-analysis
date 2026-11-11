import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createParser, mergeStatements } from '@openuidev/lang-core'
import {
  analysisCatalogSchema,
  analysisCatalogSpec,
} from '../../src/presentation/contracts/analysis-catalog.ts'
import { parseAnalysisProgram } from '../../src/presentation/contracts/analysis-program.ts'
import { patch, program } from './catalog-fixture.ts'

test('generated Host schema matches the installed Client library without importing React into Host', async () => {
  execFileSync(process.execPath, [
    'packages/dsh-data-analysis/scripts/generate-analysis-catalog.mjs',
    '--check',
  ])
  assert.deepEqual(Object.keys(analysisCatalogSpec.components).sort(), [
    'Accordion',
    'AccordionItem',
    'AnalysisFrameView',
    'Card',
    'DashboardGrid',
    'DashboardGridItem',
    'DatasetView',
    'Image',
    'SnapshotFilter',
    'Stack',
    'TabItem',
    'Tabs',
    'TextCallout',
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
  assert.match(
    analysisCatalogSpec.components.SnapshotFilter!.signature,
    /defaultValues\?: \(string \| boolean \| null\)\[\]/,
  )
  assert.equal(parseAnalysisProgram(program).typeName, 'Stack')
  for (const source of [
    'root = AnalysisFrameView("frame", {chart: "line"});',
    'root = AnalysisFrameView("frame", {chart: "comparison", style: "delta"}, {density: "compact", dataTable: "visible"});',
    'root = AnalysisFrameView("frame", {chart: "decomposition", style: "share"});',
  ])
    assert.equal(parseAnalysisProgram(source).typeName, 'AnalysisFrameView', source)
  for (const chart of ['line', 'area', 'bar'])
    assert.equal(
      parseAnalysisProgram(
        `root = DatasetView("data", {chart: "${chart}", encoding: {axis: "category", values: ["amount"], series: "region"}});`,
      ).typeName,
      'DatasetView',
    )
  assert.equal(
    parseAnalysisProgram(
      'root = DatasetView("data", {chart: "heatmap", encoding: {x: "x", y: "y", value: "amount"}});',
    ).typeName,
    'DatasetView',
  )
})

test('unsupported nodes and wrong parent slots cannot enter the subset', () => {
  for (const source of [
    'root = Button("unsupported");',
    'root = Card([Stack([Button("unsupported")])]);',
    'root = Stack(["not a component"]);',
    'root = Tabs([DatasetView("wrong-parent")]);',
    'root = Stack([TabItem("wrong", "wrong", [])]);',
    'root = TabItem("wrong", "wrong", []);',
    'root = DashboardGridItem([TextContent("wrong root")]);',
    'root = AccordionItem("wrong", "wrong", []);',
    'root = DashboardGrid([TextContent("wrong slot")]);',
    'root = Stack([DashboardGridItem([TextContent("wrong slot")])]);',
    'root = Accordion([TabItem("wrong", "wrong", [])]);',
    'root = DatasetView("sql", {chart: "line"});',
    'root = DatasetView("sql", {}, {density: "compact"});',
    'root = DatasetView("sql", {chart: "metric"});',
    'root = DatasetView("sql", {chart: "pie"});',
  ])
    assert.throws(() => parseAnalysisProgram(source), source)
})

test('dashboard slots accept nested components and enforce column spans', () => {
  const source =
    'root = DashboardGrid([DashboardGridItem([Accordion([AccordionItem("details", "Details", [Stack([TextContent("Saved")])])])], 2), DashboardGridItem([DatasetView("data")], 1)], 3, "s");'
  assert.equal(parseAnalysisProgram(source).typeName, 'DashboardGrid')
  assert.throws(
    () => parseAnalysisProgram('root = DashboardGrid([DashboardGridItem([], 3)], 2);'),
    /analysis-dashboard-span-exceeds-columns/,
  )
  assert.throws(() => parseAnalysisProgram('root = DashboardGrid([DashboardGridItem([], 0)]);'))
  assert.throws(() => parseAnalysisProgram('root = DashboardGrid([], 5);'))
})

test('accordion section identifiers are nonempty and unique within each group', () => {
  for (const source of [
    'root = Accordion([AccordionItem("", "Title", [])]);',
    'root = Accordion([AccordionItem("id", " ", [])]);',
    'root = Accordion([AccordionItem("same", "One", []), AccordionItem("same", "Two", [])]);',
  ])
    assert.throws(() => parseAnalysisProgram(source), source)
  assert.doesNotThrow(() =>
    parseAnalysisProgram(
      'root = Accordion([AccordionItem("same", "Outer", [Accordion([AccordionItem("same", "Inner", [])])])]);',
    ),
  )
})

test('Frame pie is available through the public catalog', () => {
  assert.equal(
    parseAnalysisProgram(
      'root = AnalysisFrameView("frame", {chart: "pie", encoding: {axis: "category", value: "amount"}});',
    ).typeName,
    'AnalysisFrameView',
  )
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

test('tab values are unique within each group, including nested groups', () => {
  const duplicate = 'Tabs([TabItem("same","First",[]),TabItem("same","Second",[])])'
  for (const root of [duplicate, `Card([${duplicate}])`])
    assert.throws(() => parseAnalysisProgram(`root = ${root};`), /analysis-tab-value-duplicate/)
  assert.doesNotThrow(() =>
    parseAnalysisProgram(
      'root = Tabs([TabItem("same","Outer",[Tabs([TabItem("same","Inner",[])])]),TabItem("other","Other",[])]);',
    ),
  )
})
