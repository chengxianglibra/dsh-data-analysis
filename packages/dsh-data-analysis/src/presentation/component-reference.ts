import { createHash } from 'node:crypto'
import { type AnalysisDocument, analysisElements } from './contracts/analysis-document.ts'
import { parseAnalysisProgram } from './contracts/analysis-program.ts'
import type { ComponentEnvelope, ComponentRequest } from './contracts/component-reference.ts'
import { datasetDisplaySchema, datasetViewSchema } from './contracts/dataset-view.ts'
import { frameDisplaySchema, frameViewSchema } from './contracts/frame-view.ts'
import { componentReferenceLabel, selectionModelText } from './contracts/selection-text.ts'
import { datasetFromDocument } from './dataset-reference.ts'
import { frameFromDocument } from './frame-reference.ts'
import { savedResultContext } from './selection-context.ts'

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

/** Fixed result identity for reading data with Marivo; report organization remains in marivo_ui_read. */
export function componentModelText(
  document: Pick<AnalysisDocument, 'resources'>,
  request: ComponentRequest,
  view: unknown,
  display: unknown,
): string {
  return selectionModelText('component', componentReferenceLabel(request), {
    recordId: request.recordId,
    resource: request.resourceName,
    component: {
      kind: request.component.kind,
      statementId: request.component.statementId,
      view,
      display,
    },
    ...savedResultContext(document, request.resourceName),
  })
}
