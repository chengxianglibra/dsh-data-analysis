import { createHash } from 'node:crypto'
import { type AnalysisDocument, analysisElements } from './contracts/analysis-document.ts'
import { parseAnalysisProgram } from './contracts/analysis-program.ts'
import type { ComponentEnvelope, ComponentRequest } from './contracts/component-reference.ts'
import { datasetDisplaySchema, datasetViewSchema } from './contracts/dataset-view.ts'
import { frameDisplaySchema, frameViewSchema } from './contracts/frame-view.ts'
import { datasetContext, datasetFromDocument } from './dataset-reference.ts'
import { frameContext, frameFromDocument } from './frame-reference.ts'

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
function normalized(kind: 'frame' | 'dataset', view: unknown, display: unknown) {
  return kind === 'frame'
    ? {
        view: frameViewSchema.optional().parse(view),
        display: frameDisplaySchema.optional().parse(display),
      }
    : {
        view: datasetViewSchema.optional().parse(view),
        display: datasetDisplaySchema.optional().parse(display),
      }
}

/** Validate the component and its configuration against the immutable saved program. */
export function componentFromDocument(document: AnalysisDocument, request: ComponentRequest) {
  const component = request.component
  let target: ReturnType<typeof normalized>
  try {
    target = normalized(component.kind, component.view, component.display)
  } catch {
    throw new Error('invalid-request')
  }
  const typeName = component.kind === 'frame' ? 'AnalysisFrameView' : 'DatasetView'
  const node = analysisElements(parseAnalysisProgram(document.program)).find(
    (item) =>
      item.typeName === typeName &&
      item.props.ref === request.resourceName &&
      (component.statementId === undefined || item.statementId === component.statementId) &&
      canonical(normalized(component.kind, item.props.view, item.props.display)) ===
        canonical(target),
  )
  if (!node) throw new Error('component-unavailable')
  const { snapshot } =
    component.kind === 'frame'
      ? frameFromDocument(document, request)
      : datasetFromDocument(document, request)
  const digest = createHash('sha256')
    .update(JSON.stringify([document.program, snapshot]))
    .digest('hex')
  const envelope: ComponentEnvelope = {
    ...request,
    schema: 'dsh-data-analysis-component/v1',
    digest,
  }
  return { envelope, snapshot, view: target.view, display: target.display }
}

/** Bound the complete model payload, including the verified view and display. */
export function componentModelText(
  document: Pick<AnalysisDocument, 'title' | 'program'>,
  request: ComponentRequest,
  snapshot: ReturnType<typeof componentFromDocument>['snapshot'],
  view: unknown,
  display: unknown,
): string {
  const context = snapshot.kind === 'frame' ? frameContext(snapshot) : datasetContext(snapshot)
  const prefix =
    'Analysis UI component from a saved report snapshot (not a new query). The component configuration matches a node in the fixed saved program; equivalent instances can occur in multiple locations. Rows, columns and metadata are bounded; check truncation and coverage flags. marivoFrame, when present, is Marivo identity, not the Harness session. A persisted artifact may be resumed only if its original Runtime/project and artifact remain available; an in-memory Frame cannot be recovered across processes from this identity.\n'
  const programFits = Buffer.byteLength(JSON.stringify(document.program), 'utf8') <= 20_000
  let report = {
    title: document.title,
    program: programFits ? document.program : null,
    programTruncated: !programFits,
  }
  let preview: ReturnType<typeof datasetContext> | ReturnType<typeof frameContext> = context
  let contextTruncated = false
  const render = () =>
    `${prefix}${JSON.stringify({ recordId: request.recordId, resource: request.resourceName, component: { kind: request.component.kind, statementId: request.component.statementId, view, display }, report, ...preview, contextTruncated })}`
  let text = render()
  if (Buffer.byteLength(text, 'utf8') > 262_144 && report.program !== null) {
    report = { ...report, program: null, programTruncated: true }
    text = render()
  }
  if (Buffer.byteLength(text, 'utf8') > 262_144) {
    contextTruncated = true
    preview =
      snapshot.kind === 'frame'
        ? {
            ...frameContext(snapshot),
            columns: [],
            rows: [],
            previewColumns: 0,
            previewRows: 0,
            columnsTruncated: snapshot.data.columns.length > 0,
            previewTruncated: snapshot.data.rows.length > 0,
            metadata: { value: null, truncated: true },
            sections: { value: null, truncated: true },
            coordinates: { value: null, truncated: true },
          }
        : {
            ...datasetContext(snapshot),
            columns: [],
            rows: [],
            previewColumns: 0,
            previewRows: 0,
            columnsTruncated: snapshot.data.columns.length > 0,
            previewTruncated: snapshot.data.rows.length > 0,
          }
    text = render()
  }
  // Saved program admission bounds the configuration; retain a final guard if
  // the program contract is widened in future.
  if (Buffer.byteLength(text, 'utf8') > 262_144) throw new Error('component-too-large')
  return text
}
