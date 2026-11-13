import { type ElementNode, parseExpression, split, tokenize } from '@openuidev/lang-core'
import { z } from 'zod'
import type { AnalysisResultSummary } from '../result-summary.ts'
import { analysisCatalogId } from './analysis-catalog.ts'
import { analysisStatements, parseAnalysisProgram } from './analysis-program.ts'
import { datasetDisplayIssue, datasetDisplaySchema, resolveDatasetView } from './dataset-view.ts'
import { frameDisplayIssue } from './frame-display.ts'
import { frameDisplaySchema, frameViewSchema, resolveFrameView } from './frame-view.ts'
import { parsePresentationBuildId } from './index.ts'
import { migrateLegacySelections } from './legacy-selection-migration.ts'
import { analysisResourceDeclaration, pythonCodeRef } from './resource-declaration.ts'
import { findSelectionWiringIssue } from './selection-wiring.ts'
import { isFrameSnapshotV2, parseAnalysisSnapshot } from './snapshot.ts'
import {
  resolveSnapshotFilter,
  resolveSnapshotFilterBinding,
  selectionBindingSchema,
  selectionSourcesSchema,
  snapshotFilterFieldNames,
  snapshotFilterViewIssue,
} from './snapshot-filter.ts'
import { type ViewFilterContext, viewFilterContext } from './view-filter-context.ts'

export type { AnalysisResourceDeclaration } from './resource-declaration.ts'
export { analysisResourceDeclaration } from './resource-declaration.ts'

import type { AnalysisResourceDeclaration } from './resource-declaration.ts'
import { PRESENTATION_BUDGETS } from './types.ts'

export const ANALYSIS_UI_FORMAT = 'dsh.analysis-ui/v4'
const LEGACY_ANALYSIS_UI_FORMAT = 'dsh.analysis-ui/v3'
const id = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/)
const text = z.string().min(1).max(512)
export const analysisResourcePatch = z.strictObject({
  put: z.record(id, analysisResourceDeclaration).optional(),
  remove: z.array(id).optional(),
})
export const analysisPresentInput = z.strictObject({
  surface: z.enum(['tool', 'tab']).default('tool'),
  basedOnRecordId: z.string().min(1).max(512).optional(),
  resourcePatch: analysisResourcePatch.optional(),
  selectionSources: selectionSourcesSchema.optional(),
  labels: z
    .record(
      z.string().min(1).max(80),
      z.record(z.string().min(1).max(256), z.string().trim().min(1).max(256)),
    )
    .optional(),
  title: z.string().min(1).max(256).optional(),
  program: z.string().min(1).max(PRESENTATION_BUDGETS.text).optional(),
  locale: z.enum(['zh-CN', 'en-US']).optional(),
})
export type AnalysisPresentInput = z.infer<typeof analysisPresentInput>
const resource = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('snapshot'),
    declaration: analysisResourceDeclaration,
    snapshot: z.unknown().transform(parseAnalysisSnapshot),
    binding: z.strictObject({
      workspaceId: text,
      codeRef: pythonCodeRef.optional(),
      sessionId: text.optional(),
      callId: text.optional(),
    }),
  }),
  z.strictObject({
    kind: z.literal('image'),
    declaration: z.strictObject({
      kind: z.literal('image-file'),
      path: z.string().min(1).max(4096),
    }),
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
    dataUrl: z
      .string()
      .max(PRESENTATION_BUDGETS.datasetBytes * 2)
      .regex(/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
])
const documentFields = z.strictObject({
  workspaceId: text,
  reportId: id,
  buildId: id,
  recordId: text,
  title: z.string().min(1).max(256),
  locale: z.enum(['zh-CN', 'en-US']),
  generatedAt: z.string().datetime({ offset: true }),
  catalog: z.strictObject({
    id: z.literal(analysisCatalogId),
    build: z.string(),
  }),
  program: z.string().min(1).max(PRESENTATION_BUDGETS.text),
  resources: z.record(id, resource),
  selectionSources: selectionSourcesSchema.optional(),
})
const schema = z.strictObject({
  schemaVersion: z.literal(ANALYSIS_UI_FORMAT),
  ...documentFields.shape,
})
export type AnalysisDocument = z.infer<typeof schema>
export type AnalysisResource = z.infer<typeof resource>
export function analysisRecordId(reportId: string, buildId: string): string {
  return `marivo-ui:${parsePresentationBuildId(reportId)}:${parsePresentationBuildId(buildId)}`
}
export function parseAnalysisRecordId(value: unknown) {
  if (typeof value !== 'string') throw new Error('invalid-analysis-record-id')
  const match = /^marivo-ui:([a-zA-Z0-9_-]+):([a-zA-Z0-9_-]+)$/.exec(value)
  if (!match) throw new Error('invalid-analysis-record-id')
  return {
    reportId: parsePresentationBuildId(match[1]),
    buildId: parsePresentationBuildId(match[2]),
  }
}
export function analysisElements(root: ElementNode): ElementNode[] {
  const nodes: ElementNode[] = []
  const walk = (node: ElementNode) => {
    nodes.push(node)
    if (nodes.length > PRESENTATION_BUDGETS.blocks) throw new Error('analysis-program-budget')
    for (const value of Object.values(node.props)) {
      for (const child of Array.isArray(value) ? value : [value]) {
        if (child && typeof child === 'object' && child.type === 'element') walk(child)
      }
    }
  }
  walk(root)
  return nodes
}
/**
 * Save-time view rejection returned to the model. The message carries the code, the JSON
 * path (statement name plus `/view/...`) and a short hint because Tool errors surface as text.
 */
type ViewErrorDetails = {
  received?: string | null
  receivedKind?: 'column'
  expectedKind?: 'axis' | 'column' | 'value' | 'comparison-alias' | 'field-kind'
  candidates?: (string | null)[]
  resultMetadata?: AnalysisResultSummary
}
export class AnalysisViewError extends Error {
  readonly phase = 'report-validation'
  readonly code: string
  readonly path: string
  readonly resourceName: string
  readonly details: ViewErrorDetails
  readonly recovery: { nextAction: string; currentRef?: string; applied: false }
  constructor(
    code: string,
    path: string,
    hint: string,
    resourceName: string,
    details: ViewErrorDetails = {},
    currentRef?: string,
  ) {
    const recovery = { nextAction: hint, applied: false as const, currentRef }
    super(
      `${code} at ${path}: ${hint}\nerror=${JSON.stringify({
        code,
        phase: 'report-validation',
        path,
        resource: resourceName || undefined,
        recovery,
        ...details,
      })}`,
    )
    this.name = 'AnalysisViewError'
    this.code = code
    this.path = path
    this.resourceName = resourceName
    this.details = details
    this.recovery = recovery
  }
}
const viewHints: Record<string, string> = {
  'analysis-columns-invalid': 'table columns must be distinct column IDs of this resource.',
  'analysis-metric-requires-complete-single-row':
    'metric needs a complete single-row snapshot and an existing value name.',
  'analysis-view-invalid': 'view or display does not match the component signature.',
  'analysis-view-name-unknown': 'use a value or axis name from this snapshot.',
  'analysis-view-dtype-not-drawable': 'this chart requires a drawable numeric value.',
  'analysis-view-target-ambiguous':
    'the selected axes or values do not identify an unambiguous chart target; comparisons need a uniquely selected metric group or a compatible multi-group view.',
  'analysis-view-encoding-required':
    'provide explicit Dataset column mappings: axis/values/series or x/y/value.',
  'analysis-view-budget':
    'heatmap supports at most 100,000 cells; use fewer distinct x or y values.',
  'analysis-view-role-missing': 'this comparison or decomposition lacks the roles for this chart.',
  'analysis-view-axis-not-time': 'line/area axis must be a calendar or interval axis.',
  'analysis-view-pie-invalid-values':
    'pie needs complete, nonnegative finite values and at least one positive value.',
  'analysis-view-requires-complete-snapshot':
    'this chart requires a complete saved result; the current snapshot is partial.',
  'analysis-view-unsupported-for-snapshot':
    'Dataset supports auto/table/metric/line/area/bar/heatmap; analysis-specific views require a Frame.',
}
function viewError(
  code: string,
  node: ElementNode,
  relative: string,
  {
    expectedKind,
    candidates,
    receivedKind,
  }: Pick<ViewErrorDetails, 'expectedKind' | 'candidates' | 'receivedKind'> = {},
  hint = viewHints[code] ?? '',
): AnalysisViewError {
  const received = relative
    .split('/')
    .slice(1)
    .reduce<unknown>(
      (value, key) =>
        typeof value === 'object' && value !== null && Object.hasOwn(value, key)
          ? Reflect.get(value, key)
          : undefined,
      node.props,
    )
  return new AnalysisViewError(
    code,
    `${node.statementId ?? node.typeName}${relative}`,
    `${hint} Use the candidates and metadata to repair the indicated parameter. Reuse the fixed result. For a saved-report data refresh, preserve the existing view and repair its data input or report the blocker.`,
    String(node.props.ref),
    {
      expectedKind,
      ...(receivedKind ? { receivedKind } : {}),
      received:
        received === null || (typeof received === 'string' && received.length <= 512)
          ? received
          : undefined,
      candidates: expectedKind ? (candidates ?? []).slice(0, 8) : candidates,
    },
  )
}
export function validateAnalysisResources(
  program: string,
  resources: AnalysisDocument['resources'],
  selectionSources?: AnalysisDocument['selectionSources'],
) {
  const nodes = analysisElements(parseAnalysisProgram(program))
  // Establish resource identity before resolving filters and view shapes.
  for (const node of nodes) {
    if (node.typeName !== 'AnalysisFrameView' && node.typeName !== 'DatasetView') continue
    const source = resources[String(node.props.ref)]
    if (
      source?.kind !== 'snapshot' ||
      source.snapshot.kind !== (node.typeName === 'AnalysisFrameView' ? 'frame' : 'dataset')
    )
      throw new Error('analysis-data-resource-invalid')
  }
  const filterContexts = validateSelectionSources(program, nodes, resources, selectionSources)
  for (const node of nodes) {
    if (node.typeName === 'Image') {
      if (typeof node.props.src !== 'string' || resources[node.props.src]?.kind !== 'image')
        throw new Error('analysis-image-resource-invalid')
    }
    if (node.typeName !== 'AnalysisFrameView' && node.typeName !== 'DatasetView') continue
    const source = resources[String(node.props.ref)]
    if (
      source?.kind !== 'snapshot' ||
      source.snapshot.kind !== (node.typeName === 'AnalysisFrameView' ? 'frame' : 'dataset')
    )
      throw new Error('analysis-data-resource-invalid')
    const view = frameViewSchema.optional().safeParse(node.props.view ?? undefined)
    if (!view.success) throw viewError('analysis-view-invalid', node, '/view')
    const display = frameDisplaySchema.optional().safeParse(node.props.display ?? undefined)
    if (
      !display.success ||
      (source.snapshot.kind === 'dataset' &&
        !datasetDisplaySchema.optional().safeParse(node.props.display ?? undefined).success)
    )
      throw viewError('analysis-view-invalid', node, '/display')
    const resolved =
      source.snapshot.kind === 'dataset'
        ? resolveDatasetView(source.snapshot, view.data, filterContexts.get(node))
        : resolveFrameView(source.snapshot, view.data, filterContexts.get(node))
    if (resolved.ok) {
      if (source.snapshot.kind === 'dataset') {
        const issue = datasetDisplayIssue(source.snapshot, display.data, resolved.view)
        if (issue)
          throw viewError(
            'analysis-view-invalid',
            node,
            issue.path,
            issue,
            issue.path === '/display/seriesLayout'
              ? 'Use seriesLayout on line charts; overlay requires compatible declared units and number formats. Choose facet or auto for conflicting values.'
              : undefined,
          )
      }
      if (source.snapshot.kind === 'frame') {
        const issue = frameDisplayIssue(source.snapshot, resolved.view, display.data)
        if (issue)
          throw viewError(
            'analysis-view-invalid',
            node,
            issue.path,
            issue,
            issue.path === '/display/seriesLayout'
              ? 'Use seriesLayout on line charts; overlay requires compatible declared units and number formats. Choose facet or auto for conflicting values.'
              : issue.path === '/display/rowLimit'
                ? 'Use rowLimit only for horizontal category bars or ordinary tables; recordPreview uses its own limit.'
                : issue.expectedKind === 'comparison-alias'
                  ? 'Use a unique saved comparison alias; omit alias to address a unique anonymous comparison.'
                  : undefined,
          )
      }
      continue
    }
    // Keep the established codes for table columns and metric rows; other failures are new.
    const chart = view.data?.chart
    const code =
      chart === 'table' && resolved.code === 'view-name-unknown'
        ? 'analysis-columns-invalid'
        : chart === 'metric' &&
            (resolved.code === 'view-metric-requires-complete-single-row' ||
              resolved.code === 'view-name-unknown')
          ? 'analysis-metric-requires-complete-single-row'
          : `analysis-view-${resolved.code.replace(/^view-/, '')}`
    const path = resolved.path
    let expectedKind: ViewErrorDetails['expectedKind']
    if (path.startsWith('/view/columns')) expectedKind = 'column'
    else if (/^\/view\/encoding\/(axis|series|x|y)$/.test(path))
      expectedKind = source.snapshot.kind === 'dataset' ? 'column' : 'axis'
    else if (/^\/view\/encoding\/values?(\/\d+)?$/.test(path) || resolved.candidates?.length)
      expectedKind = source.snapshot.kind === 'dataset' || chart === 'metric' ? 'column' : 'value'
    const received = path
      .split('/')
      .slice(1)
      .reduce<unknown>(
        (value, key) =>
          value !== null && typeof value === 'object' ? Reflect.get(value, key) : undefined,
        node.props,
      )
    const columnForAxis =
      expectedKind === 'axis' &&
      code === 'analysis-view-name-unknown' &&
      source.snapshot.kind === 'frame' &&
      !source.snapshot.frame.axes.some((axis) => axis.name === received) &&
      source.snapshot.data.columns.some((column) => column.id === received)
    throw viewError(
      code,
      node,
      path,
      {
        candidates: resolved.candidates,
        expectedKind,
        ...(columnForAxis ? { receivedKind: 'column' as const } : {}),
      },
      columnForAxis
        ? 'This parameter requires a public Frame axis name, but received an exported column ID. Use viewCandidates.axis (timeAxis for line/area axis); coordinateColumns.axisName maps exported columns to public axes.'
        : undefined,
    )
  }
}

/** Resolve immutable source metadata and validate each bound view without owning state. */
export function validateSelectionSources(
  _program: string,
  nodes: ElementNode[],
  resources: AnalysisDocument['resources'],
  sources?: AnalysisDocument['selectionSources'],
): Map<ElementNode, ViewFilterContext> {
  const contexts = new Map<ElementNode, ViewFilterContext>()
  const definitions = new Map<string, ReturnType<typeof resolveSnapshotFilter>>()
  const timezones = new Map<string, string>()
  const consumed = new Set<string>()
  function failNode(node: ElementNode, code: string, path: string, hint: string): never {
    throw new AnalysisViewError(
      code,
      `${node.statementId ?? node.typeName}/${path}`,
      hint,
      String(node.props.ref ?? ''),
    )
  }
  const sourceEntries = Object.entries(sources ?? {})
  if (sourceEntries.length > PRESENTATION_BUDGETS.blocks)
    throw new AnalysisViewError(
      'analysis-filter-budget',
      'selectionSources',
      `Use at most ${PRESENTATION_BUDGETS.blocks} selection sources.`,
      '',
    )

  // Reject malformed references and unused sources before resolving any saved
  // fields. Otherwise each unused source can duplicate an entire snapshot.
  const bindingsByNode = new Map<ElementNode, z.infer<typeof selectionBindingSchema>[]>()
  for (const node of nodes) {
    if (node.typeName !== 'AnalysisFrameView' && node.typeName !== 'DatasetView') continue
    if (node.props.filters === undefined) continue
    const parsed = z.array(selectionBindingSchema).safeParse(node.props.filters)
    if (!parsed.success)
      failNode(
        node,
        'analysis-filter-reference-invalid',
        'filters',
        'Use selection source bindings.',
      )
    const bindings = parsed.data!
    if (new Set(bindings.map((binding) => binding.source)).size !== bindings.length)
      failNode(
        node,
        'analysis-filter-reference-invalid',
        'filters',
        'Use distinct selection source IDs.',
      )
    for (const [index, binding] of bindings.entries()) {
      const state = binding.selection
      if (
        !state ||
        typeof state !== 'object' ||
        !('k' in state) ||
        state.k !== 'StateRef' ||
        !('n' in state) ||
        state.n !== `$${binding.source}`
      )
        failNode(
          node,
          'analysis-filter-reference-invalid',
          `filters/${index}/selection`,
          'Bind selection to the source state variable.',
        )
      if (!sources || !Object.hasOwn(sources, binding.source))
        failNode(
          node,
          'analysis-filter-reference-invalid',
          'filters',
          'Reference an existing selection source.',
        )
      consumed.add(binding.source)
    }
    bindingsByNode.set(node, bindings)
  }
  for (const [id, source] of sourceEntries)
    if (!consumed.has(id))
      throw new AnalysisViewError(
        'analysis-filter-unused',
        `source_${id}/filterId`,
        'Bind this source to a supported view.',
        source.ref,
      )

  const wiring = findSelectionWiringIssue(nodes, sources)
  if (wiring)
    throw new AnalysisViewError(
      'analysis-filter-reference-invalid',
      `${wiring.statementId ?? wiring.component}/value`,
      `Bind this control to ${wiring.expected}.`,
      sources?.[wiring.source]?.ref ?? '',
      { received: wiring.actual },
    )

  for (const [id, source] of sourceEntries) {
    const resource = resources[source.ref]
    if (resource?.kind !== 'snapshot')
      throw new AnalysisViewError(
        'analysis-filter-resource-invalid',
        `source_${id}/ref`,
        'Use a saved snapshot resource.',
        source.ref,
      )
    const expectedKind = resource.snapshot.kind === 'dataset' ? 'column' : 'axis'
    if (source.field.kind !== expectedKind)
      throw new AnalysisViewError(
        'analysis-filter-field-invalid',
        `source_${id}/field/kind`,
        'Use the field kind supported by this snapshot.',
        source.ref,
        { received: source.field.kind, expectedKind: 'field-kind', candidates: [expectedKind] },
      )
    try {
      const definition = resolveSnapshotFilter(resource.snapshot, {
        ...source,
        filterId: id,
        label: source.label ?? id,
      })
      definitions.set(id, definition)
      if (definition.calendarTimezone) timezones.set(id, definition.calendarTimezone)
    } catch (error) {
      const code = error instanceof Error ? error.message : 'analysis-filter-invalid'
      if (code === 'analysis-filter-field-invalid')
        throw new AnalysisViewError(
          code,
          `source_${id}/field/name`,
          'Use a field of the indicated kind with an exact filterable type.',
          source.ref,
          {
            received: source.field.name,
            expectedKind,
            candidates: snapshotFilterFieldNames(resource.snapshot).slice(0, 8),
          },
        )
      throw new AnalysisViewError(
        code,
        `source_${id}/${code === 'analysis-filter-default-invalid' ? 'defaultValues' : 'field'}`,
        'Use a supported field and existing exact default values.',
        source.ref,
      )
    }
  }
  for (const [node, bindings] of bindingsByNode) {
    if (!bindings.length) continue
    const resource = resources[String(node.props.ref)]
    if (resource?.kind !== 'snapshot')
      failNode(
        node,
        'analysis-filter-resource-invalid',
        'filters',
        'Use a saved snapshot resource.',
      )
    const resolvedBindings: Parameters<typeof viewFilterContext>[0][number][] = []
    for (const [index, binding] of bindings.entries()) {
      const definition = definitions.get(binding.source)
      if (!definition)
        failNode(
          node,
          'analysis-filter-reference-invalid',
          'filters',
          'Reference an existing selection source.',
        )
      if (!binding.field && definition.declaration.ref !== node.props.ref)
        failNode(
          node,
          'analysis-filter-resource-mismatch',
          'filters',
          'Select a target field for another resource.',
        )
      try {
        const target = resolveSnapshotFilterBinding(
          resource.snapshot,
          definition,
          binding.field ?? definition.declaration.field,
        )
        if (target.calendarTimezone) {
          const previous = timezones.get(binding.source)
          if (previous && previous !== target.calendarTimezone)
            failNode(
              node,
              'analysis-filter-calendar-invalid',
              `filters/${index}`,
              'Use the same timezone on bound calendar axes.',
            )
          timezones.set(binding.source, target.calendarTimezone)
        }
        resolvedBindings.push({ definition, values: target.values })
      } catch (error) {
        if (error instanceof AnalysisViewError) throw error
        failNode(
          node,
          error instanceof Error ? error.message : 'analysis-filter-field-invalid',
          `filters/${index}`,
          'Use a compatible saved field for this filter.',
        )
      }
    }
    const parsedView = frameViewSchema.optional().safeParse(node.props.view ?? undefined)
    if (!parsedView.success) throw viewError('analysis-view-invalid', node, '/view')
    const { snapshot } = resource
    const context = viewFilterContext(resolvedBindings, snapshot.data.rows.length)
    contexts.set(node, context)
    const resolution =
      snapshot.kind === 'dataset'
        ? resolveDatasetView(snapshot, parsedView.data, context)
        : resolveFrameView(snapshot, parsedView.data, context)
    if (
      resolution.ok &&
      resolution.view.chart === 'metric' &&
      (parsedView.data?.chart !== 'metric' || !context.metricEligible)
    )
      failNode(
        node,
        'analysis-filter-view-unsupported',
        'filters',
        'Use an explicit metric with only required single filters whose combined values identify each row.',
      )
    const issue = resolution.ok ? snapshotFilterViewIssue(snapshot, resolution) : undefined
    if (issue) failNode(node, 'analysis-filter-view-unsupported', 'filters', issue)
  }
  return contexts
}
export function parseAnalysisDocument(value: unknown): AnalysisDocument {
  if (new TextEncoder().encode(JSON.stringify(value)).length > PRESENTATION_BUDGETS.documentBytes)
    throw new Error('analysis-document-budget')
  const result = schema.parse(value)
  if (
    result.recordId !== analysisRecordId(result.reportId, result.buildId) ||
    Object.keys(result.resources).length > PRESENTATION_BUDGETS.datasets
  )
    throw new Error('analysis-document-identity-invalid')
  for (const item of Object.values(result.resources))
    parseAnalysisResource(item, result.workspaceId)
  validateAnalysisResources(result.program, result.resources, result.selectionSources)
  return result
}
/** Validate one Host-admitted resource without requiring unrelated components or data. */
export function parseAnalysisResource(value: unknown, workspaceId: string): AnalysisResource {
  const item = resource.parse(value)
  if (item.kind !== 'snapshot') return item
  if (item.binding.workspaceId !== workspaceId) throw new Error('analysis-resource-owner-invalid')
  if (
    (item.declaration.kind === 'analysis-frame' || item.declaration.kind === 'dataframe') &&
    (item.declaration.codeRef?.executionId !== item.binding.codeRef?.executionId ||
      item.declaration.codeRef?.sha256 !== item.binding.codeRef?.sha256 ||
      (item.declaration.codeRef && (!item.binding.sessionId || !item.binding.callId)))
  )
    throw new Error('analysis-resource-code-binding-invalid')
  if (
    !(
      (['dataset-snapshot', 'dataframe'].includes(item.declaration.kind) &&
        item.snapshot.kind === 'dataset') ||
      (['frame-snapshot', 'analysis-frame'].includes(item.declaration.kind) &&
        isFrameSnapshotV2(item.snapshot))
    ) ||
    (!['analysis-frame', 'dataframe'].includes(item.declaration.kind) &&
      (!item.binding.codeRef || !item.binding.sessionId || !item.binding.callId))
  )
    throw new Error('analysis-resource-owner-invalid')
  if (
    item.declaration.kind === 'analysis-frame' &&
    (item.snapshot.kind !== 'frame' ||
      item.snapshot.source.sessionId !== item.declaration.ref.session_id ||
      item.snapshot.source.artifactId !== item.declaration.ref.artifact_id)
  )
    throw new Error('analysis-resource-result-identity-invalid')
  return item
}
/** Convert legacy v3 in memory without modifying its immutable saved Build. */
export function parseSavedPresentation(value: unknown): AnalysisDocument {
  if (
    !value ||
    typeof value !== 'object' ||
    !('schemaVersion' in value) ||
    ![ANALYSIS_UI_FORMAT, LEGACY_ANALYSIS_UI_FORMAT].includes(String(value.schemaVersion))
  )
    throw new Error('report-version-unsupported')
  if (value.schemaVersion === LEGACY_ANALYSIS_UI_FORMAT) {
    const legacy = z
      .strictObject({
        schemaVersion: z.literal(LEGACY_ANALYSIS_UI_FORMAT),
        ...documentFields.omit({ selectionSources: true }).shape,
      })
      .parse(value)
    let filtered = false
    for (const statement of split(tokenize(analysisStatements(legacy.program)))) {
      const expression = parseExpression(statement.tokens)
      if (expression.k === 'Comp' && expression.name === 'SnapshotFilter') filtered = true
    }
    const migration = filtered
      ? migrateLegacySelections(analysisStatements(legacy.program), legacy.locale)
      : { program: legacy.program, selectionSources: undefined }
    return parseAnalysisDocument({ ...legacy, ...migration, schemaVersion: ANALYSIS_UI_FORMAT })
  }
  return parseAnalysisDocument(value)
}

export function sameAnalysisDeclaration(
  a: AnalysisResourceDeclaration,
  b: AnalysisResourceDeclaration,
): boolean {
  if (a.kind !== b.kind) return false
  if (
    (a.kind === 'dataframe' && b.kind === 'dataframe') ||
    (a.kind === 'analysis-frame' && b.kind === 'analysis-frame')
  ) {
    if (
      a.codeRef?.executionId !== b.codeRef?.executionId ||
      a.codeRef?.sha256 !== b.codeRef?.sha256
    )
      return false
  }
  if (
    (a.kind === 'dataset-snapshot' && b.kind === 'dataset-snapshot') ||
    (a.kind === 'frame-snapshot' && b.kind === 'frame-snapshot')
  )
    return a.snapshotRef === b.snapshotRef
  if (a.kind === 'dataframe' && b.kind === 'dataframe')
    return a.ref.project_root === b.ref.project_root && a.ref.result_id === b.ref.result_id
  if (a.kind === 'analysis-frame' && b.kind === 'analysis-frame')
    return (
      a.ref.store_id === b.ref.store_id &&
      a.ref.session_id === b.ref.session_id &&
      a.ref.artifact_id === b.ref.artifact_id
    )
  return a.kind === 'image-file' && b.kind === 'image-file' && a.path === b.path
}
