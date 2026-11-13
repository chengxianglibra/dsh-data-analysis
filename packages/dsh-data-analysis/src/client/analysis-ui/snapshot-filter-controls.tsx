import { createContext, useContext, useEffect, useId, useState, useSyncExternalStore } from 'react'
import type { AnalysisSnapshot } from '../../presentation/contracts/snapshot.ts'
import {
  isSnapshotFilterSelectionValid,
  type ResolvedSnapshotFilter,
  resolveSnapshotFilterBinding,
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
      definitions.map((item) => [item.declaration.filterId, [...item.defaultValues]]),
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
    if (!definition || !isSnapshotFilterSelectionValid(definition, values)) return
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

type FilterReference = string | { filter: string; field: SnapshotFilter['field'] }

export function useSnapshotFilters(
  references: readonly FilterReference[],
  resourceName?: string,
  snapshot?: AnalysisSnapshot,
) {
  const store = useContext(SnapshotFilters)?.store
  const selected = useSyncExternalStore(
    (references.length && store?.subscribe) || emptySubscribe,
    (references.length && store?.getSnapshot) || getEmptySnapshot,
    getEmptySnapshot,
  )
  const filters = references.map((reference) => {
    const id = typeof reference === 'string' ? reference : reference.filter
    const definition = store?.definitions.get(id)
    if (!definition || !snapshot) return undefined
    if (typeof reference === 'string' && definition.declaration.ref !== resourceName)
      return undefined
    try {
      const binding = resolveSnapshotFilterBinding(
        snapshot,
        definition,
        typeof reference === 'string' ? definition.declaration.field : reference.field,
      )
      return { ...definition, ...binding, definition, selected: selected.get(id) ?? [] }
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
    selectionKey: references.length
      ? JSON.stringify(
          references.map((reference) => {
            const id = typeof reference === 'string' ? reference : reference.filter
            return [id, selected.get(id) ?? []]
          }),
        )
      : undefined,
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

function RangeControl({
  definition,
  selected,
  set,
}: {
  definition: ResolvedSnapshotFilter
  selected: readonly SnapshotFilterValue[]
  set: (values: readonly SnapshotFilterValue[]) => void
}) {
  const t = useCopy()
  const id = useId()
  const [start, setStart] = useState(typeof selected[0] === 'string' ? selected[0] : '')
  const [end, setEnd] = useState(typeof selected[1] === 'string' ? selected[1] : '')
  useEffect(() => {
    setStart(typeof selected[0] === 'string' ? selected[0] : '')
    setEnd(typeof selected[1] === 'string' ? selected[1] : '')
  }, [selected])
  const valid = isSnapshotFilterSelectionValid(definition, [start, end])
  const showError = Boolean(start || end) && !valid
  return (
    <div className="au-filter-options">
      <label htmlFor={`${id}-start`}>{t('marivo.presentation.ui-filter-start')}</label>
      <input
        id={`${id}-start`}
        type="date"
        aria-invalid={showError || undefined}
        aria-describedby={showError ? `${id}-error` : undefined}
        value={start}
        onChange={(event) => setStart(event.target.value)}
      />
      <label htmlFor={`${id}-end`}>{t('marivo.presentation.ui-filter-end')}</label>
      <input
        id={`${id}-end`}
        type="date"
        aria-invalid={showError || undefined}
        aria-describedby={showError ? `${id}-error` : undefined}
        value={end}
        onChange={(event) => setEnd(event.target.value)}
      />
      {showError && (
        <span id={`${id}-error`} role="status">
          {t('marivo.presentation.ui-filter-invalid-range')}
        </span>
      )}
      <Button variant="outline" size="sm" disabled={!valid} onClick={() => set([start, end])}>
        {t('marivo.presentation.ui-filter-apply')}
      </Button>
    </div>
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
  const allowAll = declaration.options?.allowAll !== false
  const set = (values: readonly SnapshotFilterValue[]) =>
    context?.store.set(declaration.filterId, values)
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
      {declaration.mode === 'date-range' ? (
        <RangeControl definition={definition} selected={selected} set={set} />
      ) : multiple ? (
        <div className="au-filter-options">
          {definition.options.map((value) => (
            <label key={JSON.stringify([value])}>
              <input
                type="checkbox"
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
                disabled={!allowAll && selected.length === 1 && selected.includes(value)}
                onChange={() =>
                  set(
                    selected.includes(value)
                      ? selected.filter((item) => item !== value)
                      : [...selected, value],
                  )
                }
              />
              <span>{filterValueLabel(value, t)}</span>
            </label>
          ))}
          {!definition.options.length && (
            <span>{t('marivo.presentation.ui-filter-no-options')}</span>
          )}
        </div>
      ) : (
        <select
          aria-label={declaration.label}
          value={
            selected.length
              ? String(definition.options.findIndex((value) => value === selected[0]))
              : ''
          }
          onChange={(event) => {
            if (event.target.value === '') set([])
            else {
              const index = Number(event.target.value)
              if (Number.isInteger(index) && index >= 0 && index < definition.options.length)
                set([definition.options[index]!])
            }
          }}
        >
          {allowAll && <option value="">{t('marivo.presentation.ui-filter-all')}</option>}
          {definition.options.map((value, index) => (
            <option key={JSON.stringify([value])} value={String(index)}>
              {filterValueLabel(value, t)}
            </option>
          ))}
        </select>
      )}
      <div className="au-filter-actions">
        <Button variant="outline" size="sm" disabled={!allowAll} onClick={() => set([])}>
          {t('marivo.presentation.ui-filter-clear')}
        </Button>
        <Button variant="outline" size="sm" onClick={() => set(definition.defaultValues)}>
          {t('marivo.presentation.ui-filter-reset')}
        </Button>
      </div>
    </fieldset>
  )
}
