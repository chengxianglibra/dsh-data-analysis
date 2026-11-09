import type { AnalysisDocument } from './contracts/analysis-document.ts'
import type { AnalysisSnapshot, FrameSnapshot } from './contracts/snapshot.ts'

type ResultConfigurationSummary = {
  kind: AnalysisSnapshot['kind']
  columns: Array<Pick<AnalysisSnapshot['data']['columns'][number], 'id' | 'type'>>
  coverage: AnalysisSnapshot['coverage']
  values?: string[]
  axes?: Array<Pick<FrameSnapshot['frame']['axes'][number], 'token' | 'name' | 'role'>>
}
type AnalysisResultSummary =
  | { status: 'captured'; resources: Record<string, ResultConfigurationSummary> }
  | { status: 'unavailable'; reason: 'budget' }

/** Configuration facts from admitted snapshots only; never reads results or source data. */
export function analysisResultSummary(
  resources: AnalysisDocument['resources'],
): AnalysisResultSummary {
  const summaries: Record<string, ResultConfigurationSummary> = {}
  for (const [name, resource] of Object.entries(resources)) {
    if (resource.kind !== 'snapshot') continue
    const snapshot = resource.snapshot
    summaries[name] = {
      kind: snapshot.kind,
      columns: snapshot.data.columns.map(({ id, type }) => ({ id, type })),
      coverage: snapshot.coverage,
      ...(snapshot.kind === 'frame'
        ? {
            values: snapshot.frame.fields
              .filter((field) => field.role === 'value')
              .map((field) => field.id),
            axes: snapshot.frame.axes.map(({ token, name, role }) => ({ token, name, role })),
          }
        : {}),
    }
  }
  // A large directory is disclosed explicitly as unavailable rather than silently truncated.
  return Buffer.byteLength(JSON.stringify(summaries)) <= 16 * 1024
    ? { status: 'captured', resources: summaries }
    : { status: 'unavailable', reason: 'budget' }
}
