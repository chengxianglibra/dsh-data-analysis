import type { ElementNode } from '@openuidev/lang-core'
import { z } from 'zod'
import { analysisCatalogBuild, analysisCatalogId } from './analysis-catalog.ts'
import { parseAnalysisProgram } from './analysis-program.ts'
import { datasetDisplaySchema, resolveDatasetView } from './dataset-view.ts'
import { validateFrameDisplay } from './frame-display.ts'
import { frameResultReference } from './frame-result-reference.ts'
import { frameDisplaySchema, frameViewSchema, resolveFrameView } from './frame-view.ts'
import { parsePresentationBuildId } from './index.ts'
import { dataframeResultReference } from './result-reference.ts'
import { isFrameSnapshotV2, parseAnalysisSnapshot } from './snapshot.ts'
import { PRESENTATION_BUDGETS } from './types.ts'

export const ANALYSIS_UI_FORMAT = 'dsh.analysis-ui/v1'
const id = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/)
const text = z.string().min(1).max(512)
const pythonCodeRef = z.strictObject({
  executionId: z.string().uuid(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
})
export const analysisResourceDeclaration = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('analysis-frame'),
    ref: frameResultReference,
    codeRef: pythonCodeRef.optional(),
  }),
  z.strictObject({
    kind: z.literal('dataframe'),
    ref: dataframeResultReference,
    codeRef: pythonCodeRef.optional(),
  }),
  z.strictObject({ kind: z.literal('dataset-snapshot'), snapshotRef: z.string().max(512) }),
  z.strictObject({ kind: z.literal('frame-snapshot'), snapshotRef: z.string().max(512) }),
  z.strictObject({ kind: z.literal('image-file'), path: z.string().min(1).max(4096) }),
])
export const analysisPresentInput = z.strictObject({
  surface: z.enum(['tool', 'tab']).default('tool'),
  basedOnRecordId: z.string().min(1).max(512).optional(),
  resources: z.record(id, analysisResourceDeclaration).optional(),
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
export type AnalysisResourceDeclaration = z.infer<typeof analysisResourceDeclaration>
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
const schema = z.strictObject({
  schemaVersion: z.literal(ANALYSIS_UI_FORMAT),
  workspaceId: text,
  reportId: id,
  buildId: id,
  recordId: text,
  title: z.string().min(1).max(256),
  locale: z.enum(['zh-CN', 'en-US']),
  generatedAt: z.string().datetime({ offset: true }),
  catalog: z.strictObject({
    id: z.literal(analysisCatalogId),
    build: z.string().refine((build) => build === analysisCatalogBuild),
  }),
  program: z.string().min(1).max(PRESENTATION_BUDGETS.text),
  resources: z.record(id, resource),
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
export class AnalysisViewError extends Error {
  readonly code: string
  readonly path: string
  constructor(code: string, path: string, hint: string) {
    super(`${code} at ${path}: ${hint}`)
    this.name = 'AnalysisViewError'
    this.code = code
    this.path = path
  }
}
const viewHints: Record<string, string> = {
  'analysis-columns-invalid': 'table columns must be distinct column names of this resource.',
  'analysis-metric-requires-complete-single-row':
    'metric needs a complete single-row snapshot and an existing value name.',
  'analysis-view-invalid': 'view or display does not match the component signature.',
  'analysis-view-name-unknown': 'use a value or axis name from this snapshot.',
  'analysis-view-dtype-not-drawable': 'choose a numeric value or use chart "table".',
  'analysis-view-target-ambiguous':
    'choose axes that uniquely identify each row or use chart "table"; for comparisons, add encoding.value to show one metric, or omit encoding to render every comparison group as one table.',
  'analysis-view-encoding-required':
    'provide explicit Dataset column mappings: axis/values/series or x/y/value.',
  'analysis-view-budget':
    'use at most 8 series and 100,000 heatmap cells; prepare a smaller result in Python.',
  'analysis-view-role-missing': 'this comparison or decomposition lacks the roles for this chart.',
  'analysis-view-axis-not-time': 'line/area axis must be a calendar or interval axis.',
  'analysis-view-pie-invalid-values':
    'pie needs complete, nonnegative finite values and at least one positive value.',
  'analysis-view-requires-complete-snapshot':
    'this chart reads as the whole population; use chart "table" or "auto" for partial data.',
  'analysis-view-unsupported-for-snapshot':
    'Dataset supports auto/table/metric/line/area/bar/heatmap; analysis-specific views require a Frame.',
}
function viewError(
  code: string,
  statement: string,
  path: string,
  candidates?: string[],
): AnalysisViewError {
  const relative = path.startsWith('/view') || path.startsWith('/display') ? path : `/view${path}`
  const hint = viewHints[code] ?? ''
  // A candidate list extends the sentence, so a trailing hint period would read as `. ;`.
  const suffix = candidates?.length
    ? `${hint.endsWith('.') ? hint.slice(0, -1) : hint}; candidates: ${candidates.join(', ')}`
    : hint
  return new AnalysisViewError(code, `${statement}${relative}`, suffix)
}
export function validateAnalysisResources(
  program: string,
  resources: AnalysisDocument['resources'],
) {
  for (const node of analysisElements(parseAnalysisProgram(program))) {
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
    const statement = node.statementId ?? node.typeName
    const view = frameViewSchema.optional().safeParse(node.props.view ?? undefined)
    if (!view.success) throw viewError('analysis-view-invalid', statement, '/view')
    const display = frameDisplaySchema.optional().safeParse(node.props.display ?? undefined)
    if (
      !display.success ||
      (source.snapshot.kind === 'dataset' &&
        !datasetDisplaySchema.optional().safeParse(node.props.display ?? undefined).success)
    )
      throw viewError('analysis-view-invalid', statement, '/display')
    const columns = view.data?.chart === 'table' ? view.data.columns : undefined
    if (columns && new Set(columns).size !== columns.length)
      throw viewError('analysis-columns-invalid', statement, '/view/columns')
    const resolved =
      source.snapshot.kind === 'dataset'
        ? resolveDatasetView(source.snapshot, view.data)
        : resolveFrameView(source.snapshot, view.data)
    if (resolved.ok) {
      if (source.snapshot.kind === 'frame') {
        const error = validateFrameDisplay(source.snapshot, resolved.view, display.data)
        if (error) throw viewError('analysis-view-invalid', statement, error)
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
    throw viewError(code, statement, resolved.path, resolved.candidates)
  }
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
  for (const item of Object.values(result.resources)) {
    if (item.kind !== 'snapshot') continue
    if (item.binding.workspaceId !== result.workspaceId)
      throw new Error('analysis-resource-owner-invalid')
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
  }
  validateAnalysisResources(result.program, result.resources)
  return result
}
/** Saved Builds use only the analysis UI format; earlier report documents are unsupported. */
export function parseSavedPresentation(value: unknown): AnalysisDocument {
  if (
    !value ||
    typeof value !== 'object' ||
    !('schemaVersion' in value) ||
    value.schemaVersion !== ANALYSIS_UI_FORMAT
  )
    throw new Error('report-version-unsupported')
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
