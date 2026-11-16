import { useStateField } from '@openuidev/react-lang'
import { XIcon } from 'lucide-react'
import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  isSnapshotFilterSelectionValid,
  type ResolvedSnapshotFilter,
  type SnapshotFilterValue,
} from '../../presentation/contracts/snapshot-filter.ts'
import { useCopy } from '../i18n/context.tsx'
import { Button } from '../ui/primitives/button.tsx'
import { Input } from '../ui/primitives/input.tsx'
import { useAnalysisResources } from './context.tsx'
import { decodeSelection, encodeEnumSelection, optionId } from './selection-codec.ts'
import { optionLabel } from './selection-data.tsx'

const previewLimit = 24
const pageSize = 100
const normalizeSearch = (value: string) => value.trim().normalize('NFKC').toLowerCase()

export function AnalysisFilterChips({ source, value }: { source: string; value: unknown }) {
  const definition = useAnalysisResources().selectionDefinitions?.get(source)
  const field = useStateField(source, value)
  if (!definition || definition.declaration.mode === 'date-range' || !field.isReactive) return null
  return (
    <FilterOptions
      key={source}
      definition={definition}
      value={field.value}
      apply={field.setValue}
    />
  )
}

function FilterOptions({
  definition,
  value,
  apply,
}: {
  definition: ResolvedSnapshotFilter
  value: unknown
  apply: (value: ReturnType<typeof encodeEnumSelection>) => void
}) {
  const t = useCopy()
  const candidatesId = useId()
  const root = useRef<HTMLFieldSetElement>(null)
  const rail = useRef<HTMLDivElement>(null)
  const more = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const moving = useRef<{ id: string; origin: DOMRect }>()
  const animations = useRef<Animation[]>([])
  const [expanded, setExpanded] = useState(false)
  const [overflow, setOverflow] = useState(false)
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(pageSize)
  const { declaration, options, defaultValues } = definition
  const multiple = declaration.mode === 'multiple'
  const allowAll = declaration.options?.allowAll !== false
  const selected = useMemo(() => decodeSelection(definition, value), [definition, value])
  const valid = selected !== undefined && isSnapshotFilterSelectionValid(definition, selected)
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const items = useMemo(
    () =>
      options.map((item) => {
        const label = optionLabel(item, t)
        return { value: item, id: optionId(item), label, searchLabel: normalizeSearch(label) }
      }),
    [options, t],
  )
  const chosen = items.filter((item) => selectedSet.has(item.value))
  const available = items.filter((item) => !selectedSet.has(item.value))
  const normalizedQuery = normalizeSearch(query)
  const matches = normalizedQuery
    ? available.filter((item) => item.searchLabel.includes(normalizedQuery))
    : available
  const atDefault =
    valid &&
    selectedSet.size === defaultValues.length &&
    defaultValues.every((item) => selectedSet.has(item))
  const canClear = allowAll && (!valid || selectedSet.size > 0)
  const visible = matches.slice(0, expanded ? limit : previewLimit)

  // Keep wrapped options measurable while taking clipped buttons out of tab order.
  useLayoutEffect(() => {
    const element = rail.current
    if (!element) return
    if (expanded) {
      for (const item of element.querySelectorAll('button')) item.style.visibility = ''
      return
    }
    const measure = () => {
      const bottom = element.getBoundingClientRect().bottom
      let hidden = false
      const buttons = element.querySelectorAll('button')
      for (let index = 0; index < visible.length; index++) {
        const item = buttons[index]
        if (!item) continue
        const clipped = item.getBoundingClientRect().bottom > bottom + 0.5
        item.style.visibility = clipped ? 'hidden' : ''
        hidden ||= clipped
      }
      setOverflow(hidden)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [expanded, visible])

  useLayoutEffect(() => {
    const move = moving.current
    moving.current = undefined
    if (!move || !root.current) return
    const target = root.current.querySelector<HTMLButtonElement>(
      `[data-option="${CSS.escape(move.id)}"]`,
    )
    if (!target || getComputedStyle(target).visibility === 'hidden') {
      const fallback = more.current ?? search.current
      if (fallback) fallback.focus()
      else root.current.focus()
      return
    }
    target.focus()
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const background = target.querySelector<HTMLElement>('.au-filter-chip-background')
    const destination = target.getBoundingClientRect()
    // Stretch the background briefly toward its origin. Keep foreground text,
    // focus and the hit target stationary while the selected state takes effect.
    const x = Math.max(-32, Math.min(32, move.origin.left - destination.left))
    const y = Math.max(-16, Math.min(16, move.origin.top - destination.top))
    const bridge = target.querySelector<HTMLElement>('.au-filter-chip-bridge')
    if (!background || !bridge) return
    const motion = { duration: 220, easing: 'cubic-bezier(.2,.75,.25,1)' }
    const stretch = background.animate(
      [
        { transform: `translate(${x}px, ${y}px) scale(.82)`, opacity: 0.45 },
        {
          transform: `translate(${x * 0.16}px, ${y * 0.16}px) scale(1.12, .9)`,
          opacity: 1,
          offset: 0.65,
        },
        { transform: 'none', opacity: 0 },
      ],
      motion,
    )
    const turn = `translateY(-50%) rotate(${Math.atan2(y, x)}rad)`
    const join = bridge.animate(
      [
        { transform: `${turn} scaleX(${Math.hypot(x, y) / 32})`, opacity: 0.85 },
        { transform: `${turn} scaleX(.4)`, opacity: 0.7, offset: 0.45 },
        { transform: `${turn} scaleX(0)`, opacity: 0 },
      ],
      motion,
    )
    animations.current = [stretch, join]
  })

  function toggle(item: SnapshotFilterValue, id: string, button: HTMLButtonElement) {
    const current = valid ? (selected ?? []) : []
    const isSelected = current.includes(item)
    if (isSelected && !allowAll && current.length === 1) return
    const next = isSelected
      ? current.filter((entry) => entry !== item)
      : multiple
        ? [...current, item]
        : [item]
    for (const animation of animations.current) animation.cancel()
    moving.current = { id, origin: button.getBoundingClientRect() }
    apply(encodeEnumSelection(next, multiple))
  }

  function renderChip(item: (typeof items)[number], pressed: boolean) {
    const removable = pressed && (allowAll || selectedSet.size > 1)
    return (
      <Button
        key={item.id}
        variant={pressed ? 'secondary' : 'outline'}
        size="sm"
        className="au-filter-chip relative isolate min-w-0 max-w-full"
        data-option={item.id}
        title={item.label}
        aria-pressed={pressed}
        aria-disabled={pressed && !removable}
        onClick={(event) => toggle(item.value, item.id, event.currentTarget)}
      >
        <span className="au-filter-chip-bridge" aria-hidden="true" />
        <span className="au-filter-chip-background" aria-hidden="true" />
        <span className="truncate">{item.label}</span>
        {removable && <XIcon data-icon="inline-end" aria-hidden="true" />}
      </Button>
    )
  }

  useLayoutEffect(() => {
    if (expanded) search.current?.focus()
  }, [expanded])

  function toggleExpanded() {
    if (expanded) {
      setQuery('')
      setLimit(pageSize)
    }
    setExpanded(!expanded)
  }

  return (
    <fieldset ref={root} tabIndex={-1} className="au-filter-chips">
      <legend className="sr-only">{declaration.label}</legend>
      <div className="au-filter-chips-header">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-sm font-medium wrap-anywhere">
          <span aria-hidden="true">{declaration.label}</span>
          <span className="text-xs font-normal text-muted-foreground">
            {t(
              multiple
                ? 'marivo.presentation.filter-multiple'
                : 'marivo.presentation.filter-single',
            )}
            {!allowAll && <> · {t('marivo.presentation.filter-required')}</>}
          </span>
        </div>
        <div className="au-filter-chips-actions">
          {allowAll && (
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground aria-disabled:pointer-events-none aria-disabled:opacity-50"
              aria-disabled={!canClear}
              onClick={() => {
                if (canClear) apply(encodeEnumSelection([], multiple))
              }}
            >
              {t('marivo.presentation.filter-clear')}
            </Button>
          )}
          {defaultValues.length > 0 && (
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground aria-disabled:pointer-events-none aria-disabled:opacity-50"
              aria-disabled={atDefault}
              onClick={() => {
                if (!atDefault) apply(encodeEnumSelection(defaultValues, multiple))
              }}
            >
              {t('marivo.presentation.filter-restore')}
            </Button>
          )}
        </div>
      </div>
      <div className="au-filter-chips-body">
        <div className="au-filter-tray rounded-lg border bg-background">
          <span
            className="px-1.5 text-xs leading-7 whitespace-nowrap text-muted-foreground"
            role="status"
          >
            {valid
              ? chosen.length
                ? t('marivo.presentation.filter-selected', { p0: chosen.length })
                : t('marivo.presentation.ui-filter-all')
              : t('marivo.presentation.filter-unavailable')}
          </span>
          {chosen.map((item) => renderChip(item, true))}
        </div>
        <div className="au-filter-candidates" id={candidatesId}>
          {expanded && (
            <Input
              ref={search}
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setLimit(pageSize)
              }}
              aria-label={t('marivo.presentation.filter-search')}
              placeholder={t('marivo.presentation.filter-search')}
            />
          )}
          <div ref={rail} className="au-filter-rail" data-expanded={expanded}>
            {visible.map((item) => renderChip(item, false))}
            {expanded && !matches.length && (
              <span className="text-xs text-muted-foreground" role="status">
                {t('marivo.presentation.filter-no-options')}
              </span>
            )}
          </div>
          <div className="au-filter-chips-actions">
            {(expanded || overflow || available.length > previewLimit) && (
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground"
                ref={more}
                aria-controls={candidatesId}
                aria-expanded={expanded}
                onClick={toggleExpanded}
              >
                {t(
                  expanded ? 'marivo.presentation.filter-less' : 'marivo.presentation.filter-more',
                )}
              </Button>
            )}
            {expanded && matches.length > limit && (
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground"
                onClick={() => setLimit(limit + pageSize)}
              >
                {t('marivo.presentation.filter-load-more')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </fieldset>
  )
}

export const FILTER_CHIPS_STYLES = `
.au-filter-chips{margin:0;padding:0;min-width:0;width:100%;max-width:100%}
.au-filter-chips-header,.au-filter-chips-actions{display:flex;align-items:center;gap:.25rem;flex-wrap:wrap;min-width:0}
.au-filter-chips-header{justify-content:space-between}
.au-filter-chips-body{margin-top:.25rem;display:flex;align-items:flex-start;gap:.375rem .5rem;flex-wrap:wrap;min-width:0}
.au-filter-tray{display:flex;align-items:center;flex-wrap:wrap;gap:.375rem;padding:.25rem;min-width:0;max-width:100%;max-height:8rem;overflow:auto}
.au-filter-candidates{display:grid;gap:.25rem;min-width:min(100%,12rem);max-width:100%;flex:1}
.au-filter-rail{display:flex;align-content:flex-start;align-items:flex-start;flex-wrap:wrap;gap:.375rem;padding:.25rem;max-height:4.375rem;overflow:clip}
.au-filter-rail:empty,.au-filter-chips-actions:empty{display:none}
.au-filter-rail[data-expanded=true]{max-height:12rem;overflow:auto}
.au-filter-chip-background,.au-filter-chip-bridge{position:absolute;z-index:-1;opacity:0;background:var(--secondary);pointer-events:none}
.au-filter-chip-background{inset:0;border-radius:inherit}
.au-filter-chip-bridge{left:50%;top:50%;width:2rem;height:.625rem;transform-origin:left center;border-radius:999px}
.au-filter-chip[aria-disabled=true]{cursor:default}
`
