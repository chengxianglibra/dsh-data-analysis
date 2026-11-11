import { createContext, useContext, useId, useSyncExternalStore } from 'react'
import {
  type ResolvedSnapshotFilter,
  type SnapshotFilter,
  type SnapshotFilterValue,
  visibleSnapshotRows,
} from '../../presentation/contracts/snapshot-filter.ts'
import { useCopy } from '../i18n/context.tsx'
import { Button } from '../ui/controls.tsx'

/** State belongs to one reader and one saved Build, never to the process or a resource. */
export class SnapshotFilterStore {
  readonly definitions: ReadonlyMap<string, ResolvedSnapshotFilter>
  #selected: ReadonlyMap<string, readonly SnapshotFilterValue[]>
  #listeners = new Set<() => void>()
  constructor(definitions: readonly ResolvedSnapshotFilter[]) {
    this.definitions = new Map(definitions.map((item) => [item.declaration.filterId, item]))
    this.#selected = new Map(
      definitions.map((item) => [
        item.declaration.filterId,
        [...(item.declaration.defaultValues ?? [])],
      ]),
    )
  }
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }
  getSnapshot = () => this.#selected
  set(id: string, values: readonly SnapshotFilterValue[]) {
    const definition = this.definitions.get(id)
    if (
      !definition ||
      (definition.declaration.mode !== 'multiple' && values.length > 1) ||
      new Set(values).size !== values.length ||
      values.some((value) => !definition.options.includes(value))
    )
      return
    this.#selected = new Map(this.#selected).set(id, [...values])
    for (const listener of this.#listeners) listener()
  }
}

export const SnapshotFilters = createContext<
  { store: SnapshotFilterStore; disabled: boolean } | undefined
>(undefined)
const emptySubscribe = () => () => {}
const emptySnapshot = new Map<string, readonly SnapshotFilterValue[]>()
const getEmptySnapshot = () => emptySnapshot

export function useSnapshotFilters(ids: readonly string[], resourceName?: string) {
  const store = useContext(SnapshotFilters)?.store
  const selected = useSyncExternalStore(
    (ids.length && store?.subscribe) || emptySubscribe,
    (ids.length && store?.getSnapshot) || getEmptySnapshot,
    getEmptySnapshot,
  )
  const filters = ids.map((id) => {
    const definition = store?.definitions.get(id)
    return definition && (resourceName === undefined || definition.declaration.ref === resourceName)
      ? { ...definition, selected: selected.get(id) ?? [] }
      : undefined
  })
  return {
    ready: filters.every((filter) => filter !== undefined),
    summary: filters
      .filter((filter) => filter !== undefined)
      .map((filter) => ({
        id: filter.declaration.filterId,
        label: filter.declaration.label,
        selected: filter.selected,
      })),
    selectionKey: ids.length
      ? JSON.stringify(ids.map((id) => [id, selected.get(id) ?? []]))
      : undefined,
    visibleRows(rowCount: number): number[] | undefined {
      if (!ids.length || filters.some((filter) => !filter)) return undefined
      return visibleSnapshotRows(
        rowCount,
        filters.filter((filter) => filter !== undefined),
      )
    },
  }
}

function filterValueLabel(value: SnapshotFilterValue, t: ReturnType<typeof useCopy>): string {
  if (value === null) return t('marivo.presentation.missing-value')
  if (value === '') return t('marivo.presentation.empty-string')
  if (typeof value === 'string') return JSON.stringify(value)
  return String(value)
}

export function SnapshotFilterSummary({
  filters,
}: {
  filters: ReturnType<typeof useSnapshotFilters>['summary']
}) {
  const t = useCopy()
  if (!filters.length) return null
  return (
    <section className="au-filter-summary" aria-label={t('marivo.presentation.ui-filter-summary')}>
      {filters.map((filter) => (
        <p key={filter.id}>
          {filter.label}:{' '}
          {filter.selected.length
            ? filter.selected.map((value) => filterValueLabel(value, t)).join(', ')
            : t('marivo.presentation.ui-filter-all')}
        </p>
      ))}
    </section>
  )
}

export function SnapshotFilterControl({ declaration }: { declaration: SnapshotFilter }) {
  const context = useContext(SnapshotFilters)
  const selectedMap = useSyncExternalStore(
    context?.store.subscribe ?? emptySubscribe,
    context?.store.getSnapshot ?? getEmptySnapshot,
    getEmptySnapshot,
  )
  const t = useCopy()
  const controlId = useId()
  const definition = context?.store.definitions.get(declaration.filterId)
  const selected = selectedMap.get(declaration.filterId) ?? []
  if (!definition) return <div role="status">{t('marivo.presentation.ui-resource-pending')}</div>
  const multiple = declaration.mode === 'multiple'
  return (
    <fieldset
      className="au-filter"
      disabled={context?.disabled}
      data-snapshot-filter={declaration.filterId}
    >
      <legend>{declaration.label}</legend>
      <div className="au-filter-resource">
        {t('marivo.presentation.ui-filter-resource', { p0: declaration.ref })}
      </div>
      <div className="au-filter-options">
        {definition.options.map((value) => (
          <label key={JSON.stringify([value])}>
            <input
              type={multiple ? 'checkbox' : 'radio'}
              name={controlId}
              aria-label={
                typeof value === 'string' &&
                value &&
                ![
                  'true',
                  'false',
                  t('marivo.presentation.missing-value'),
                  t('marivo.presentation.empty-string'),
                ].includes(value)
                  ? value
                  : filterValueLabel(value, t)
              }
              checked={selected.includes(value)}
              onChange={() => {
                const next = multiple
                  ? selected.includes(value)
                    ? selected.filter((item) => item !== value)
                    : [...selected, value]
                  : [value]
                context?.store.set(declaration.filterId, next)
              }}
            />
            <span>{filterValueLabel(value, t)}</span>
          </label>
        ))}
        {!definition.options.length && <span>{t('marivo.presentation.ui-filter-no-options')}</span>}
      </div>
      <div className="au-filter-actions">
        <Button
          variant="outline"
          size="sm"
          onClick={() => context?.store.set(declaration.filterId, [])}
        >
          {t('marivo.presentation.ui-filter-clear')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => context?.store.set(declaration.filterId, declaration.defaultValues ?? [])}
        >
          {t('marivo.presentation.ui-filter-reset')}
        </Button>
      </div>
    </fieldset>
  )
}
