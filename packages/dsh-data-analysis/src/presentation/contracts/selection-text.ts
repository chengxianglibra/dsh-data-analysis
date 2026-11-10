import { z } from 'zod'
import type { ComponentEnvelope } from './component-reference.ts'
import type { DatasetEnvelope } from './dataset-reference.ts'
import type { PointEnvelope } from './point-reference.ts'

export const SELECTION_TEXT_START = '<marivo-selection>'
export const SELECTION_TEXT_END = '</marivo-selection>'
export const SELECTION_TEXT_MAX_BYTES = 262_144
const selection = z.strictObject({
  schema: z.literal('dsh-data-analysis-selection/v1'),
  kind: z.enum(['component', 'frame-point', 'dataset-point', 'dataset']),
  label: z.string().min(1).max(160),
  // Domain payloads are validated by their existing producers. The display codec
  // validates the common identity and treats other domain fields as inert JSON.
  context: z.looseObject({
    recordId: z.string().min(1).max(512),
    resource: z.string().min(1).max(512),
  }),
})
export type SelectionText = z.infer<typeof selection>
const cleanLabel = (value: string) => value.replace(/[\r\n\t]/g, ' ').slice(0, 160)
export const componentReferenceLabel = (envelope: Pick<ComponentEnvelope, 'resourceName'>) =>
  cleanLabel(envelope.resourceName)
export function pointReferenceLabel(envelope: Pick<PointEnvelope, 'point'>): string {
  const coordinates = envelope.point.axes.flatMap((axis) =>
    axis.keys.map((key) => (key.value === null ? '∅' : String(key.value))),
  )
  return cleanLabel([envelope.point.column.label, ...coordinates].join(' · '))
}
export const datasetReferenceLabel = (envelope: DatasetEnvelope) =>
  cleanLabel(
    envelope.schema === 'dsh-data-analysis-dataset-point/v1'
      ? `${envelope.resourceName} · ${envelope.field} · ${envelope.row + 1}`
      : envelope.resourceName,
  )

/** Keep marker boundaries unambiguous even when saved labels or cells contain markup. */
export function selectionModelText(
  kind: SelectionText['kind'],
  label: string,
  context: SelectionText['context'],
): string {
  const value = selection.parse({ schema: 'dsh-data-analysis-selection/v1', kind, label, context })
  const json = JSON.stringify(value).replace(
    /[<>&]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
  const text = `${SELECTION_TEXT_START}${json}${SELECTION_TEXT_END}`
  if (new TextEncoder().encode(text).byteLength > SELECTION_TEXT_MAX_BYTES)
    throw new Error('selection-too-large')
  return text
}

/** Malformed or unsupported forms remain visible as ordinary text. */
export function parseSelectionText(text: string): SelectionText | undefined {
  if (
    !text.startsWith(SELECTION_TEXT_START) ||
    !text.endsWith(SELECTION_TEXT_END) ||
    new TextEncoder().encode(text).byteLength > SELECTION_TEXT_MAX_BYTES
  )
    return undefined
  try {
    const result = selection.safeParse(
      JSON.parse(text.slice(SELECTION_TEXT_START.length, -SELECTION_TEXT_END.length)),
    )
    return result.success ? result.data : undefined
  } catch {
    return undefined
  }
}
