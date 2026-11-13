import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { analysisCatalogSpec } from '../../src/presentation/contracts/analysis-catalog.ts'
import {
  AnalysisProgramError,
  parseAnalysisProgram,
} from '../../src/presentation/contracts/analysis-program.ts'
import { program } from './catalog-fixture.ts'

test('generated Host schema matches the installed Client library without importing React into Host', async () => {
  execFileSync(process.execPath, [
    'packages/dsh-data-analysis/scripts/generate-analysis-catalog.mjs',
    '--check',
  ])
  assert.deepEqual(Object.keys(analysisCatalogSpec.components).sort(), [
    'Accordion',
    'AccordionItem',
    'AnalysisFrameView',
    'Button',
    'Card',
    'CheckBoxGroup',
    'CheckBoxItem',
    'DashboardGrid',
    'DashboardGridItem',
    'DatasetView',
    'DatePicker',
    'FormControl',
    'Image',
    'Label',
    'Select',
    'SelectItem',
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
  assert.equal(
    parseAnalysisProgram('root = Select("region", [SelectItem("a", "All")]);').typeName,
    'Select',
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
    'root = SelectItem("a", "wrong root");',
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

test('component failures locate named and inline parameters without unrelated union branches', () => {
  for (const [source, path] of [
    ['root = Stack([DashboardGrid([],2,"bad")]);', 'root/children/0/gap'],
    ['root = Stack([TextContent(2)]);', 'root/children/0/text'],
    ['root = Stack([missing,DashboardGrid([],2,"bad")]);', 'root/children/1/gap'],
  ])
    assert.throws(
      () => parseAnalysisProgram(source!),
      (error: unknown) => {
        assert(error instanceof AnalysisProgramError)
        assert.equal(error.details.path, path)
        return true
      },
    )
  assert.throws(
    () => parseAnalysisProgram('root = Stack([TextContent(2),TextContent(3)]);'),
    (error: unknown) => {
      assert(error instanceof AnalysisProgramError)
      assert.equal(error.details.path, undefined)
      return true
    },
  )
  for (const [source, path, statement] of [
    ['root = Stack([kpiGrid]);\nkpiGrid = DashboardGrid([], 6);', 'kpiGrid/columns', 'kpiGrid'],
    ['root = Stack([DashboardGrid([], 6)]);', 'root/children/0/columns', 'root'],
    [
      'root = Accordion([AccordionItem("x", "X", [DashboardGrid([], 6)])]);',
      'root/items/0/content/0/columns',
      'root',
    ],
  ]) {
    assert.throws(
      () => parseAnalysisProgram(source!),
      (error: unknown) => {
        assert(error instanceof AnalysisProgramError)
        assert.deepEqual(error.details, {
          component: 'DashboardGrid',
          statement,
          path,
          received: 6,
          allowed: [1, 2, 3, 4],
        })
        return true
      },
    )
  }
  assert.throws(
    () =>
      parseAnalysisProgram(
        'root = DatasetView("data", {chart:"bar",encoding:{axis:6,values:["value"]}});',
      ),
    (error: unknown) => {
      assert(error instanceof AnalysisProgramError)
      assert.equal(error.details.path, 'root/view/encoding/axis')
      assert.equal(error.details.received, 6)
      return true
    },
  )
  assert.throws(
    () => parseAnalysisProgram('root = DatasetView("data", {chart:"unknown"});'),
    (error: unknown) => {
      assert(error instanceof AnalysisProgramError)
      assert.equal(error.details.path, 'root/view/chart')
      assert.deepEqual(error.details.allowed, [
        'auto',
        'table',
        'metric',
        'line',
        'area',
        'bar',
        'heatmap',
      ])
      return true
    },
  )
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
