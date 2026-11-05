import type { AnalysisDocument } from './contracts/analysis-document.ts'
import { createFramePointResolver } from './contracts/frame-point-resolver.ts'
import {
  type PointEnvelope,
  type PointRequest,
  parsePointEnvelope,
} from './contracts/point-reference.ts'
import { isFrameSnapshotV2 } from './contracts/snapshot.ts'

/** Derive the entire selection from a validated immutable document, never client-supplied values. */
export function pointFromDocument(
  document: AnalysisDocument,
  request: PointRequest,
): PointEnvelope {
  const resource = document.resources[request.resourceName]
  if (
    document.workspaceId !== request.workspaceId ||
    document.recordId !== request.recordId ||
    resource?.kind !== 'snapshot' ||
    !isFrameSnapshotV2(resource.snapshot)
  )
    throw new Error('point-unavailable')
  const snapshot = resource.snapshot
  const { row, column, value, role, matched, related, section } = createFramePointResolver(
    snapshot,
  )(request.row, request.field)
  const axes = snapshot.frame.axes.map((axis) => ({
    token: axis.token,
    name: axis.name,
    role: axis.role,
    variant: JSON.stringify(axis.variant),
    keys: axis.keys.map((key) => ({
      id: key.id,
      slotId: key.slotId,
      dtype: key.dtype,
      value: snapshot.frame.coordinates[key.slotId]!.values[request.row]!,
    })),
  }))
  const coordinates = snapshot.frame.layout
    .flatMap((entry, i) => (entry.kind === 'coordinate' ? [{ ...entry, value: row[i]! }] : []))
    .map(({ kind: _kind, ...entry }) => entry)
  const presence = snapshot.frame.fields.flatMap((field, i) =>
    field.role === 'presence' ? [{ name: field.id, value: row[i]! }] : [],
  )
  const savedPeriods = snapshot.frame.sections.periods
  const periods =
    typeof savedPeriods === 'object' && savedPeriods.status === 'captured'
      ? {
          status: 'captured',
          pages: savedPeriods.pages.map((page) => {
            const binding =
              page.target.kind === 'comparison' &&
              typeof section === 'object' &&
              section.status === 'captured'
                ? section.comparisons[page.target.comparison]?.binding
                : undefined
            const axisToken =
              page.target.kind === 'axis'
                ? page.target.axisToken
                : binding && binding.kind !== 'ordinary'
                  ? binding.axisToken
                  : undefined
            const axis = axes.find((item) => item.token === axisToken)
            const key = axis?.keys.map((item) => item.value)
            return {
              target: page.target,
              totalCount: page.totalCount,
              hasMore: page.hasMore,
              items: key
                ? page.items.filter((item) => JSON.stringify(item.key) === JSON.stringify(key))
                : [],
            }
          }),
        }
      : savedPeriods
  return parsePointEnvelope({
    ...request,
    schema: 'dsh-data-analysis-frame-point/v1',
    point: {
      column,
      value,
      role,
      description: snapshot.frame.description ?? null,
      axes,
      coordinates,
      presence,
      related,
      coverageComplete: snapshot.coverage.complete,
      interpretation: matched.length ? JSON.stringify(matched) : null,
      periods: JSON.stringify(periods),
    },
  })
}
