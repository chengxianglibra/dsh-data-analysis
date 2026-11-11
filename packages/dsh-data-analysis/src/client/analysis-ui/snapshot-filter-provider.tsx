import { createParser } from '@openuidev/lang-core'
import { type ReactNode, useLayoutEffect, useMemo } from 'react'
import { analysisCatalogSchema } from '../../presentation/contracts/analysis-catalog.ts'
import {
  type AnalysisResource,
  analysisElements,
} from '../../presentation/contracts/analysis-document.ts'
import { parseAnalysisProgram } from '../../presentation/contracts/analysis-program.ts'
import {
  type ResolvedSnapshotFilter,
  resolveSnapshotFilter,
  snapshotFilterSchema,
} from '../../presentation/contracts/snapshot-filter.ts'
import { useReportReading } from './reading-state.tsx'
import { SnapshotFilterStore, SnapshotFilters } from './snapshot-filter-controls.tsx'

const candidateParser = createParser(analysisCatalogSchema)

function definitionsFor(
  program: string,
  readResource: (name: string) => AnalysisResource | undefined,
  candidate: boolean,
  pendingStatementId?: string,
) {
  try {
    const definitions = new Map<string, ResolvedSnapshotFilter>()
    const root = candidate ? candidateParser.parse(program).root : parseAnalysisProgram(program)
    if (!root) return []
    for (const node of analysisElements(root)) {
      if (node.typeName !== 'SnapshotFilter') continue
      if (candidate && node.statementId === pendingStatementId) continue
      const parsed = snapshotFilterSchema.safeParse(node.props)
      if (!parsed.success || definitions.has(parsed.data.filterId)) continue
      const resource = readResource(parsed.data.ref)
      if (resource?.kind !== 'snapshot') continue
      try {
        definitions.set(parsed.data.filterId, resolveSnapshotFilter(resource.snapshot, parsed.data))
      } catch {
        /* A streaming candidate may be incomplete. */
      }
    }
    return [...definitions.values()]
  } catch {
    return []
  }
}

export function SnapshotFilterProvider({
  program,
  readResource,
  recordId,
  candidate,
  pendingStatementId,
  children,
}: {
  program: string
  readResource: (name: string) => AnalysisResource | undefined
  recordId?: string
  candidate: boolean
  pendingStatementId?: string
  children: ReactNode
}) {
  const reading = useReportReading()
  const local = useMemo(
    () =>
      new SnapshotFilterStore(definitionsFor(program, readResource, candidate, pendingStatementId)),
    [program, readResource, candidate, pendingStatementId],
  )
  // A live ReportViews reader can move between Chat and a tab without losing its Build state.
  // Candidates use a separate, disabled store and cannot change the published selection.
  const key = candidate ? undefined : recordId
  const retained = key && reading?.filters?.key === key ? reading.filters.store : undefined
  const store = retained ?? local
  useLayoutEffect(() => {
    if (key && reading && reading.filters?.key !== key) reading.filters = { key, store }
  }, [key, reading, store])
  const value = useMemo(() => ({ store, disabled: candidate }), [store, candidate])
  return <SnapshotFilters.Provider value={value}>{children}</SnapshotFilters.Provider>
}
