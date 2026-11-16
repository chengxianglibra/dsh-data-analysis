import type { AnalysisResource } from '../../presentation/contracts/analysis-document.ts'
import type { AnalysisSnapshot } from '../../presentation/contracts/snapshot.ts'
import {
  isSnapshotFilterSelectionValid,
  type ResolvedSnapshotFilter,
  resolveSnapshotFilter,
  resolveSnapshotFilterBinding,
  type SelectionBinding,
  type SelectionSources,
  type SnapshotFilterValue,
  visibleSnapshotRows,
} from '../../presentation/contracts/snapshot-filter.ts'
import { useCopy } from '../i18n/context.tsx'
import type { Translator } from '../i18n/copy.ts'
import { dateFromDay, decodeSelection, encodeEnumSelection } from './selection-codec.ts'

export { validSelectionDraft } from './selection-codec.ts'

export function optionLabel(value: SnapshotFilterValue, t: Translator): string {
  if (value === null) return t('marivo.presentation.missing-value')
  if (value === '') return t('marivo.presentation.empty-string')
  return typeof value === 'string' ? JSON.stringify(value) : String(value)
}

export function prepareSelectionSources(
  sources: SelectionSources,
  readResource: (name: string) => AnalysisResource | undefined,
) {
  const definitions = new Map<string, ResolvedSnapshotFilter>()
  const errors = new Map<string, 'date-unrepresentable'>()
  const initialState: Record<string, unknown> = {}
  for (const [id, source] of Object.entries(sources)) {
    const resource = readResource(source.ref)
    if (resource?.kind !== 'snapshot') continue
    let definition: ResolvedSnapshotFilter
    try {
      definition = resolveSnapshotFilter(resource.snapshot, {
        ...source,
        filterId: id,
        label: source.label ?? id,
      })
    } catch {
      // Incomplete resource streams are expected during candidate rendering.
      continue
    }
    let selected: unknown
    if (source.mode === 'date-range') {
      try {
        selected =
          definition.defaultValues.length === 2
            ? {
                from: dateFromDay(String(definition.defaultValues[0])),
                to: dateFromDay(String(definition.defaultValues[1])),
              }
            : {}
      } catch {
        errors.set(id, 'date-unrepresentable')
        continue
      }
    } else {
      selected = encodeEnumSelection(definition.defaultValues, source.mode === 'multiple')
    }
    definitions.set(id, definition)
    initialState[`$${id}`] = selected
    if (source.mode === 'date-range') {
      const prefix = `$source_${id.length}_${id}`
      initialState[`${prefix}_default`] = selected
      initialState[`${prefix}_draft`] = selected
    }
  }
  return { definitions, errors, initialState }
}

export function resolveSelectionBindings(
  references: readonly SelectionBinding[],
  definitions: ReadonlyMap<string, ResolvedSnapshotFilter>,
  resourceName?: string,
  snapshot?: AnalysisSnapshot,
) {
  const filters = references.map((reference) => {
    const definition = definitions.get(reference.source)
    if (!definition || !snapshot) return undefined
    if (!reference.field && definition.declaration.ref !== resourceName) return undefined
    const selected = decodeSelection(definition, reference.selection)
    if (!selected || !isSnapshotFilterSelectionValid(definition, selected)) return undefined
    try {
      const binding = resolveSnapshotFilterBinding(
        snapshot,
        definition,
        reference.field ?? definition.declaration.field,
      )
      return { ...definition, ...binding, definition, selected }
    } catch {
      return undefined
    }
  })
  return {
    ready: filters.every((filter) => filter !== undefined),
    filters: filters.filter((filter) => filter !== undefined),
    summary: filters
      .filter((filter) => filter !== undefined)
      .map((filter) => ({
        id: filter.declaration.filterId,
        label: filter.declaration.label,
        selected: filter.selected,
        sourceComplete: filter.definition.sourceComplete,
      })),
    selectionKey: references.length ? JSON.stringify(references) : undefined,
    visibleRows(rowCount: number): number[] | undefined {
      if (!references.length || filters.some((filter) => !filter)) return undefined
      return visibleSnapshotRows(
        rowCount,
        filters
          .filter((filter) => filter !== undefined)
          .map((filter) => ({
            values: filter.values,
            selected: filter.selected,
            mode: filter.declaration.mode,
          })),
      )
    },
  }
}

export function SelectionSummary({
  filters,
}: {
  filters: ReturnType<typeof resolveSelectionBindings>['summary']
}) {
  const t = useCopy()
  if (!filters.length) return null
  return (
    <section className="au-filter-summary" aria-label={t('marivo.presentation.ui-filter-summary')}>
      {filters.map((filter) => (
        <p key={filter.id}>
          {filter.label}:{' '}
          {filter.selected.length
            ? filter.selected.map((value) => optionLabel(value, t)).join(', ')
            : t('marivo.presentation.ui-filter-all')}
          {!filter.sourceComplete && <> · {t('marivo.presentation.ui-filter-incomplete-source')}</>}
        </p>
      ))}
    </section>
  )
}
