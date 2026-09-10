import { useEffect, useRef, useState } from 'react'
import { useActionCopy } from './../i18n/context.tsx'
import { ExportIcon, MoreIcon } from './icons.tsx'

export interface ReaderExportActions {
  downloadFullReport: () => void
  publishing?: {
    name: string
    publish: () => void
    publishView: (bytes: Uint8Array) => Promise<void>
  }
  publishingUnavailable?: boolean
  disabled?: boolean
  downloading?: boolean
  report?: {
    version: string
    refresh: () => void
    edit: () => void
    history: () => void
    historical?: boolean
    historyLoading?: boolean
    busy?: boolean
  }
}

export function ExportMenu({
  actions,
  editing,
  onExport,
}: {
  actions: ReaderExportActions
  editing: boolean
  onExport: () => void
}) {
  const t = useActionCopy()

  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const focus = useRef(0)
  useEffect(() => {
    if (!open) return
    container.current
      ?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
      [focus.current]?.focus()
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])
  const report = actions.report
  const label = report
    ? t('marivo.presentation.more-report-actions')
    : t('marivo.presentation.export-report')
  const entries = [
    ...(report
      ? [
          {
            label: t('marivo.presentation.refresh'),
            hint: '',
            run: report.refresh,
            disabled: report.busy,
          },
          {
            label: t('marivo.presentation.edit-report'),
            hint: report.historical ? t('marivo.presentation.historical-version-is-read-only') : '',
            run: report.edit,
            disabled: editing || report.busy || report.historical,
          },
          {
            label: t('marivo.presentation.history'),
            hint: '',
            run: report.history,
            disabled: editing || report.busy || report.historyLoading,
          },
        ]
      : []),
    {
      label: actions.publishing
        ? t('marivo.presentation.publish-report-html-to-value', { p0: actions.publishing.name })
        : t('marivo.presentation.download-full-report'),
      hint: actions.publishingUnavailable
        ? t('marivo.presentation.could-not-load-publishing-configuration-refresh-the-report')
        : editing && actions.publishing
          ? t('marivo.presentation.save-or-cancel-edits-first')
          : t('marivo.presentation.full-report-html-default-filters'),
      run: actions.publishing?.publish ?? actions.downloadFullReport,
      disabled:
        actions.downloading ||
        actions.publishingUnavailable ||
        (!!actions.publishing && (editing || report?.busy)),
    },
    {
      label: actions.publishing
        ? t('marivo.presentation.publish-current-view-html-to-value', {
            p0: actions.publishing.name,
          })
        : t('marivo.presentation.export-current-view'),
      hint: editing
        ? t('marivo.presentation.save-or-cancel-edits-first')
        : t('marivo.presentation.html-keep-current-filters-and-charts'),
      run: onExport,
      disabled: editing || actions.downloading || actions.publishingUnavailable,
    },
  ]
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Native menu buttons own delegated keyboard handling.
    <div
      className="pr-export-menu pr-interactive"
      ref={container}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          setOpen(false)
          trigger.current?.focus()
        } else if (event.key === 'Tab') setOpen(false)
        else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault()
          const items = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
          ]
          const active = items.indexOf(document.activeElement as HTMLButtonElement)
          focus.current =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? entries.length - 1
                : event.key === 'ArrowUp'
                  ? active <= 0
                    ? entries.length - 1
                    : active - 1
                  : (active + 1) % entries.length
          if (!open) setOpen(true)
          else items[focus.current]?.focus()
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="pr-icon-button"
        aria-label={t(label)}
        title={t(label)}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={actions.disabled}
        onClick={() => {
          focus.current = 0
          setOpen(!open)
        }}
      >
        {report ? <MoreIcon /> : <ExportIcon />}
      </button>
      {open && (
        <div className="pr-cell-menu-popup" role="menu" aria-label={t(label)}>
          {entries.map((entry, index) => (
            <button
              key={t(entry.label)}
              className={report && index === 3 ? 'pr-menu-divider' : undefined}
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-label={t(entry.label)}
              aria-disabled={entry.disabled || actions.disabled || undefined}
              onClick={() => {
                if (entry.disabled || actions.disabled) return
                setOpen(false)
                trigger.current?.focus()
                entry.run()
              }}
            >
              {t(entry.label)}
              {entry.hint && <small>{entry.hint}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
