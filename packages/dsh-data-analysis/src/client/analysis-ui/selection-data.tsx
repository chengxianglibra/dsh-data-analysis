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
import { dateFromDay, decodeSelection, optionId } from './selection-codec.ts'

export { validSelectionDraft } from './selection-codec.ts'

function optionLabel(value: SnapshotFilterValue, locale: 'zh-CN' | 'en-US'): string {
  if (value === null) return locale === 'zh-CN' ? '空值' : 'Missing value'
  if (value === '') return locale === 'zh-CN' ? '空字符串' : 'Empty string'
  return typeof value === 'string' ? JSON.stringify(value) : String(value)
}

export function prepareSelectionSources(
  sources: SelectionSources,
  readResource: (name: string) => AnalysisResource | undefined,
  locale: 'zh-CN' | 'en-US',
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
    const items = definition.options.map((value) => ({
      id: optionId(value),
      label: optionLabel(value, locale),
    }))
    if (
      source.mode !== 'multiple' &&
      source.mode !== 'date-range' &&
      source.options?.allowAll !== false
    )
      items.unshift({ id: 'a', label: locale === 'zh-CN' ? '全部' : 'All' })
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
    } else if (source.mode === 'multiple') {
      selected = Object.fromEntries(
        definition.defaultValues.map((value) => [optionId(value), true]),
      )
    } else {
      selected = definition.defaultValues.length ? optionId(definition.defaultValues[0]!) : 'a'
    }
    definitions.set(id, definition)
    const prefix = `$source_${id.length}_${id}`
    initialState[`${prefix}_options`] = items
    initialState[`${prefix}_default`] = selected
    initialState[`$${id}`] = selected
    if (source.mode === 'date-range' || source.mode === 'multiple')
      initialState[`${prefix}_draft`] = selected
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
            ? filter.selected
                .map((value) =>
                  value === null
                    ? t('marivo.presentation.missing-value')
                    : value === ''
                      ? t('marivo.presentation.empty-string')
                      : typeof value === 'string'
                        ? JSON.stringify(value)
                        : String(value),
                )
                .join(', ')
            : t('marivo.presentation.ui-filter-all')}
        </p>
      ))}
    </section>
  )
}
