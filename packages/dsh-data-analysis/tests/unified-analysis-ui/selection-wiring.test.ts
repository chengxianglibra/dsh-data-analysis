import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AnalysisViewError,
  analysisElements,
  validateAnalysisResources,
} from '../../src/presentation/contracts/analysis-document.ts'
import {
  analysisStatements,
  parseAnalysisProgram,
} from '../../src/presentation/contracts/analysis-program.ts'
import { findSelectionWiringIssue } from '../../src/presentation/contracts/selection-wiring.ts'
import type { SelectionSources } from '../../src/presentation/contracts/snapshot-filter.ts'
import { datasetSnapshot } from './dataset-fixtures.ts'

const sources: SelectionSources = {
  region: { ref: 'sales', field: { kind: 'column', name: 'region' } },
  cluster: { ref: 'sales', field: { kind: 'column', name: 'cluster' }, mode: 'multiple' },
}

function inspect(controls: string, trailing = '') {
  const source = `
$region = "a";
$cluster = {};
$other = "a";
$middle = "a";
root = Stack([${controls}, view]);
view = DatasetView("sales", {chart:"table"}, {}, [{source:"region",selection:$region}]);
${trailing}`
  return findSelectionWiringIssue(
    analysisElements(parseAnalysisProgram(analysisStatements(source))),
    sources,
  )
}

test('a picker cannot silently write a different state from its saved options source', () => {
  const issue = inspect(
    'picker',
    'picker = Select("region", @Each($source_6_region_options, "i", SelectItem(i.id,i.label)), null, null, $other);',
  )
  assert.deepEqual(issue, {
    source: 'region',
    component: 'Select',
    statementId: 'picker',
    actual: '$other',
    expected: '$region, or apply $other to $region with @Set',
  })
})

test('direct and draft bindings, and explicit action-driven state, remain usable', () => {
  assert.equal(
    inspect(
      'picker',
      'picker = Select("region", @Each($source_6_region_options, "i", SelectItem(i.id,i.label)), null, null, $region);',
    ),
    undefined,
  )
  assert.equal(
    inspect(
      'picker, apply',
      'picker = CheckBoxGroup("cluster", @Each($source_7_cluster_options, "i", CheckBoxItem(i.label,"",i.id)), null, $source_7_cluster_draft);\napply = Button("Apply", @Set($cluster, @SelectionOrCurrent($cluster, $source_7_cluster_draft, $source_7_cluster_options, "multiple", true)));',
    ),
    undefined,
  )
  assert.equal(
    inspect(
      'picker, apply',
      'picker = Select("region", @Each($source_6_region_options, "i", SelectItem(i.id,i.label)), null, null, $other);\napply = Button("Apply", @Set($region, $other));',
    ),
    undefined,
  )
  assert.equal(
    inspect(
      'picker, apply',
      'picker = Select("region", @Each($source_6_region_options, "i", SelectItem(i.id,i.label)), null, null, $other);\napply = Button("Apply", Action([@Set($middle, $other), @Set($region, $middle)]));',
    ),
    undefined,
  )
  assert.equal(inspect('apply', 'apply = Button("Clear", @Set($region, "a"));'), undefined)
})

test('a saved multi-select must apply its draft to the bound view state', () => {
  const snapshot = datasetSnapshot()
  const resources = {
    sales: {
      kind: 'snapshot' as const,
      declaration: { kind: 'dataset-snapshot' as const, snapshotRef: 'ref' },
      snapshot,
      binding: {
        workspaceId: 'workspace',
        codeRef: { executionId: 'run', sha256: 'a'.repeat(64) },
        sessionId: 'session',
        callId: 'call',
      },
    },
  }
  const declarations: SelectionSources = {
    region: { ref: 'sales', field: { kind: 'column', name: 'category' }, mode: 'multiple' },
  }
  const build = (action: boolean) =>
    analysisStatements(`$region = {};
root = Stack([picker, ${action ? 'apply,' : ''} view]);
picker = CheckBoxGroup("region", @Each($source_6_region_options, "i", CheckBoxItem(i.label, "", i.id)), null, $source_6_region_draft);
${action ? 'apply = Button("Apply", @Set($region, @SelectionOrCurrent($region, $source_6_region_draft, $source_6_region_options, "multiple", true)));' : ''}
view = DatasetView("sales", {chart:"table"}, {}, [{source:"region",selection:$region}]);`)
  assert.throws(
    () => validateAnalysisResources(build(false), resources, declarations),
    (error: unknown) =>
      error instanceof AnalysisViewError && error.code === 'analysis-filter-reference-invalid',
  )
  assert.doesNotThrow(() => validateAnalysisResources(build(true), resources, declarations))
})

test('other or nontrivial option expressions are not inferred as source wiring', () => {
  assert.equal(
    inspect('picker', 'picker = Select("manual", [SelectItem("a", "A")], null, null, $other);'),
    undefined,
  )
  assert.equal(
    inspect(
      'picker',
      'picker = Select("region", @Each($source_5_other_options, "i", SelectItem(i.id,i.label)), null, null, $other);',
    ),
    undefined,
  )
})
