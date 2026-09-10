import { useEffect, useId, useRef, useState } from 'react'
import { defaultSelection } from '../../presentation/contracts/interaction.ts'
import type {
  PresentationFilter,
  PresentationInteraction,
} from '../../presentation/contracts/types.ts'
import { useCopy } from './../i18n/context.tsx'

function FilterMenu({
  filter,
  value,
  onChange,
}: {
  filter: PresentationFilter
  value: string
  onChange: (value: string) => void
}) {
  const t = useCopy()

  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const container = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const id = useId()
  const selected = filter.options.find((option) => option.id === value)!
  const options = filter.options.filter((option) =>
    option.label.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  )
  const close = () => {
    setOpen(false)
    trigger.current?.focus()
  }
  useEffect(() => {
    if (!open) return
    setSearch('')
    input.current?.focus()
    const owner = container.current!.ownerDocument
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false)
    }
    owner.addEventListener('pointerdown', dismiss)
    return () => owner.removeEventListener('pointerdown', dismiss)
  }, [open])
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Delegate native input and menu button navigation.
    <div
      className="pr-filter-menu"
      ref={container}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          close()
          return
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
        if (event.target === input.current && ['Home', 'End'].includes(event.key)) return
        event.preventDefault()
        if (!open) {
          setOpen(true)
          return
        }
        const items = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
        ]
        const current = items.indexOf(
          event.currentTarget.ownerDocument.activeElement as HTMLButtonElement,
        )
        const index =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? items.length - 1
              : event.key === 'ArrowDown'
                ? (current + 1) % items.length
                : current <= 0
                  ? items.length - 1
                  : current - 1
        items[index]?.focus()
      }}
    >
      <button
        type="button"
        className="pr-filter-trigger"
        ref={trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        <span className="pr-filter-label">{t(filter.label)}</span>
        <span className="pr-filter-value">{t(selected.label)}</span>
        <span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div className="pr-filter-popup">
          <input
            ref={input}
            type="search"
            aria-label={t('marivo.presentation.search-value-options', { p0: filter.label })}
            placeholder={t('marivo.presentation.search-options')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div role="menu" aria-label={t(filter.label)} id={id} className="pr-filter-options">
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={option.id === value}
                tabIndex={-1}
                onClick={() => {
                  onChange(option.id)
                  close()
                }}
              >
                <span>{t(option.label)}</span>
                <span aria-hidden="true">{option.id === value ? '✓' : ''}</span>
              </button>
            ))}
          </div>
          {!options.length && (
            <p className="pr-muted" role="status">
              {t('marivo.presentation.no-matching-options')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export function GlobalFilterControls({
  interaction,
  selection,
  onChange,
}: {
  interaction: PresentationInteraction
  selection: Record<string, string>
  onChange: (selection: Record<string, string>) => void
}) {
  const t = useCopy()

  const isDefault = interaction.filters.every(
    (filter) => selection[filter.id] === filter.allOptionId,
  )
  return (
    <fieldset
      className="pr-filter-toolbar pr-interactive"
      aria-label={t('marivo.presentation.global-filters')}
    >
      {interaction.filters.map((filter) => (
        <FilterMenu
          key={filter.id}
          filter={filter}
          value={selection[filter.id]!}
          onChange={(value) => onChange({ ...selection, [filter.id]: value })}
        />
      ))}
      <button
        type="button"
        className="pr-filter-reset"
        disabled={isDefault}
        onClick={() => onChange(defaultSelection(interaction))}
      >
        {t('marivo.presentation.reset-filters')}
      </button>
    </fieldset>
  )
}
