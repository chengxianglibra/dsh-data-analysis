import type { DatasetViewResolution } from './dataset-view.ts'
import type { FrameView, FrameViewResolution } from './frame-view.ts'
import type { AnalysisSnapshot, FrameSnapshotV2 } from './snapshot.ts'
import { type FilterTarget, uniqueRowKeys } from './view-filter-context.ts'

type ResolvedFrame = Extract<FrameViewResolution, { ok: true }>

function axisKeys(snapshot: FrameSnapshotV2, tokens: readonly string[]) {
  return tokens.flatMap((token) => {
    const axis = snapshot.frame.axes.find((item) => item.token === token)
    return axis?.keys.map(({ slotId }) => snapshot.frame.coordinates[slotId]!.values) ?? []
  })
}

/** Each predicate must keep or drop a whole saved group, for any selection. */
function preservesGroups(
  keys: readonly (readonly unknown[])[],
  targets: readonly FilterTarget[],
  rowCount: number,
) {
  const groups = new Map<string, number>()
  for (let row = 0; row < rowCount; row++) {
    const key = JSON.stringify(keys.map((values) => values[row]))
    const first = groups.get(key)
    if (first === undefined) groups.set(key, row)
    else if (targets.some(({ values }) => values[first] !== values[row])) return false
  }
  return true
}

/** Shared by saved-report admission and the reader, including streamed candidates. */
export function snapshotFilterViewIssue(
  snapshot: AnalysisSnapshot,
  resolution: Extract<DatasetViewResolution, { ok: true }> | ResolvedFrame,
  configuredView: FrameView | undefined,
  targets: readonly FilterTarget[],
): string | undefined {
  if (!targets.length) return
  const { view } = resolution
  if (view.chart === 'metric' && configuredView?.chart !== 'metric')
    return 'Use an explicit metric to bind filters to a saved indicator.'
  if (snapshot.kind === 'dataset' || !('classification' in resolution)) return
  if (view.chart === 'members' || (view.chart === 'table' && !('layout' in view && view.layout)))
    return

  const facts = snapshot.frame.sections.interpretation
  if (facts.status !== 'captured')
    return 'Use a plain table or a Frame with captured interpretation.'

  const rowCount = snapshot.data.rows.length
  const preserves = (
    groups: readonly ({ kind: 'axis'; axisToken: string } | { kind: 'fixed' })[],
  ) =>
    preservesGroups(
      axisKeys(
        snapshot,
        groups.flatMap((group) => (group.kind === 'axis' ? [group.axisToken] : [])),
      ),
      targets,
      rowCount,
    )
  const independent = (name: string) => {
    const context = facts.valueContexts[name]
    return (
      context &&
      context.kind !== 'share' &&
      context.kind !== 'pair_statistic' &&
      !resolution.classification.broadcastValues.includes(name) &&
      !facts.comparisons.some(({ groups }) =>
        groups.some(({ values }) => values.some((value) => value.name === name)),
      ) &&
      !facts.decompositions.some(({ outputs }) => outputs.some((output) => output.name === name)) &&
      !facts.alignments.some(
        ({ left, right }) => left.values.includes(name) || right.values.includes(name),
      )
    )
  }
  const valueIssue =
    'Use saved values at the displayed grain, or a view that preserves their full statistical group.'
  switch (view.chart) {
    case 'table':
    case 'comparison-grid':
      return
    case 'comparison': {
      if (view.style === 'numbers' && rowCount !== 1)
        return 'Use a comparison table when multiple saved rows can match.'
      const selected = facts.comparisons[view.comparison]?.groups.find(
        ({ name }) => name === view.group,
      )
      const current = selected?.values.find(({ role }) => role === 'current')?.name
      const groups = facts.comparisons.flatMap((item, index) =>
        item.groups.filter(
          (group) =>
            (index === view.comparison && group === selected) ||
            (current &&
              group.values.some(({ role, name }) => role === 'current' && name === current)),
        ),
      )
      if (
        groups.some(({ currentContext, baselineContext }) =>
          [currentContext, baselineContext].some(
            (context) => context && context.kind !== 'observation' && !preserves(context.groups),
          ),
        )
      )
        return 'Filter complete statistical groups to preserve both saved comparison endpoints.'
      if (view.style === 'line' || view.style === 'small-multiples') {
        const tokens = snapshot.frame.axes.map(({ token }) => token)
        if (!uniqueRowKeys(axisKeys(snapshot, tokens), rowCount))
          return 'Use a comparison table or one saved row per time and comparison series.'
      }
      return
    }
    case 'alignment':
      return
    case 'decomposition': {
      const item = facts.decompositions[view.decomposition]
      if (
        !item ||
        !snapshot.coverage.complete ||
        item.rowScope !== 'complete' ||
        !preserves(item.groups)
      )
        return 'Filter by a complete saved decomposition group. To select individual contributions, use a plain table.'
      return
    }
    case 'share':
      if (
        !snapshot.coverage.complete ||
        view.values.some((name) => {
          const value = facts.valueContexts[name]
          return (
            value?.kind !== 'share' || value.rowScope !== 'complete' || !preserves(value.groups)
          )
        })
      )
        return 'Filter complete share groups together to preserve each saved denominator.'
      return
    case 'correlation':
      if (
        !snapshot.coverage.complete ||
        view.values.some((name) => {
          const value = facts.valueContexts[name]
          return (
            value?.kind !== 'pair_statistic' ||
            value.rowScope !== 'complete' ||
            resolution.classification.broadcastValues.includes(name) ||
            !preserves(value.groups)
          )
        })
      )
        return 'Select complete saved correlation groups at their original sample scope.'
      return
    case 'pie':
    case 'heatmap':
      return independent(view.value) ? undefined : valueIssue
    case 'metric':
      return view.values.every(independent) ? undefined : valueIssue
    default:
      return !view.broadcast.length && view.values.every(independent) ? undefined : valueIssue
  }
}
