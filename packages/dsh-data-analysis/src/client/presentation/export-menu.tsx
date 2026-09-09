import { useEffect, useRef, useState } from 'react'
import { ExportIcon } from './icons.tsx'

export interface ReaderExportActions {
  downloadFullReport: () => void
  disabled?: boolean
  downloading?: boolean
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
  const entries = [
    {
      label: '下载完整报告',
      hint: '已保存的 HTML · 默认筛选',
      run: actions.downloadFullReport,
      disabled: actions.downloading,
    },
    {
      label: '导出当前视图',
      hint: editing ? '请先保存或取消编辑' : 'HTML · 保留当前筛选和图形',
      run: onExport,
      disabled: editing,
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
                ? 1
                : event.key === 'ArrowUp'
                  ? active <= 0
                    ? 1
                    : 0
                  : (active + 1) % 2
          if (!open) setOpen(true)
          else items[focus.current]?.focus()
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="pr-icon-button"
        aria-label="导出报告"
        title="导出报告"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={actions.disabled}
        onClick={() => {
          focus.current = 0
          setOpen(!open)
        }}
      >
        <ExportIcon />
      </button>
      {open && (
        <div className="pr-cell-menu-popup" role="menu" aria-label="导出报告">
          {entries.map((entry) => (
            <button
              key={entry.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-label={entry.label}
              aria-disabled={entry.disabled || actions.disabled || undefined}
              onClick={() => {
                if (entry.disabled || actions.disabled) return
                setOpen(false)
                trigger.current?.focus()
                entry.run()
              }}
            >
              {entry.label}
              <small>{entry.hint}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
