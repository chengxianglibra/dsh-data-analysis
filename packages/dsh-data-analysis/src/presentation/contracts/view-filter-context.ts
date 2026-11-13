import type { ResolvedSnapshotFilter, SnapshotFilterValue } from './snapshot-filter.ts'

/** Row-aligned keys that remain fixed while an admitted view is being read. */
export interface ViewFilterContext {
  requiredSingles: readonly (readonly SnapshotFilterValue[])[]
  metricEligible: boolean
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
  bindings: readonly {
    definition: ResolvedSnapshotFilter
    values: readonly SnapshotFilterValue[]
  }[],
  rowCount: number,
): ViewFilterContext {
  const required = bindings.filter(
    ({ definition }) =>
      (definition.declaration.mode ?? 'single') === 'single' &&
      definition.declaration.options?.allowAll === false,
  )
  const requiredSingles = required.map(({ values }) => values)
  return {
    requiredSingles,
    metricEligible:
      bindings.length > 0 &&
      required.length === bindings.length &&
      uniqueRowKeys(requiredSingles, rowCount),
  }
}
