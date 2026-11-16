import type { ResolvedSnapshotFilter, SnapshotFilterValue } from './snapshot-filter.ts'

/** Row-aligned keys that remain fixed while an admitted view is being read. */
export interface ViewFilterContext {
  requiredSingles: readonly (readonly SnapshotFilterValue[])[]
  metricEligible: boolean
  metricGroups?: readonly FilterTarget[]
}

export interface FilterTarget {
  definition: ResolvedSnapshotFilter
  values: readonly SnapshotFilterValue[]
}

export function uniqueRowKeys(columns: readonly (readonly unknown[])[], rowCount: number): boolean {
  const seen = new Set<string>()
  for (let row = 0; row < rowCount; row++) {
    const key = JSON.stringify(columns.map((column) => column[row]))
    if (seen.has(key)) return false
    seen.add(key)
  }
  return true
}

export function viewFilterContext(
  bindings: readonly FilterTarget[],
  rowCount: number,
): ViewFilterContext {
  const required = bindings.filter(
    ({ definition }) =>
      (definition.declaration.mode ?? 'single') === 'single' &&
      definition.declaration.options?.allowAll === false,
  )
  const requiredSingles = required.map(({ values }) => values)
  const grouped = bindings.some(
    ({ definition }) =>
      definition.declaration.mode === 'multiple' || definition.declaration.mode === 'date-range',
  )
  return {
    requiredSingles,
    metricEligible:
      bindings.length > 0 &&
      (grouped || required.length === bindings.length) &&
      uniqueRowKeys(
        bindings.map(({ values }) => values),
        rowCount,
      ),
    ...(grouped ? { metricGroups: bindings } : {}),
  }
}
