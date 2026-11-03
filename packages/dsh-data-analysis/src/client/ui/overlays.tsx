import {
  type ComponentType,
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useLayoutEffect,
  useRef,
} from 'react'
import { IconButton } from './controls.tsx'
import { UI_STYLES } from './theme.ts'

export interface OverlayShellProps {
  title: string
  open: boolean
  onClose: () => void
  className: string
  children: ReactNode
}

/** Standalone rendering has no Host service dependencies. */
function NativeDialogShell({ title, open, onClose, className, children }: OverlayShellProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    const node = dialog.current
    if (!node) return
    if (open && !node.open) node.showModal()
    if (!open && node.open) node.close()
  }, [open])
  return (
    <dialog
      ref={dialog}
      className={className}
      aria-label={title}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      {children}
    </dialog>
  )
}

const OverlayShell = createContext<ComponentType<OverlayShellProps>>(NativeDialogShell)

/** The Host adapter supplies only the shell, without changing reading content. */
export function OverlayProvider({
  shell,
  children,
}: {
  shell: ComponentType<OverlayShellProps>
  children: ReactNode
}) {
  return <OverlayShell.Provider value={shell}>{children}</OverlayShell.Provider>
}

const portalRoles = [
  'bg',
  'soft',
  'text',
  'muted',
  'border',
  'accent',
  'control-border',
  'focus',
  'on-accent',
  'accent-soft',
  'warning',
  'warning-soft',
  'danger',
  'danger-soft',
  'success',
  'success-soft',
]

function DialogContent({
  title,
  onClose,
  children,
  closeLabel,
  source,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  closeLabel: string
  source: RefObject<HTMLSpanElement>
}) {
  const content = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!source.current || !content.current) return
    const origin = source.current
    const target = content.current
    const copyTheme = () => {
      const computed = getComputedStyle(origin)
      for (const role of portalRoles) {
        const name = `--mv-${role}`
        const value = computed.getPropertyValue(name).trim()
        if (value) target.style.setProperty(name, value)
      }
      // Domain colors are defined by the reading scope and remain independent of UI accent.
      for (let series = 1; series <= 8; series += 1) {
        const name = `--fv-s${series}`
        const value = computed.getPropertyValue(name).trim()
        if (value) target.style.setProperty(name, value)
      }
      target.style.colorScheme = computed.colorScheme
    }
    copyTheme()
    const observer = new MutationObserver(copyTheme)
    for (let node: HTMLElement | null = origin.parentElement; node; node = node.parentElement) {
      observer.observe(node, {
        attributes: true,
        attributeFilter: [
          'class',
          'data-theme',
          'data-ds-theme-source',
          'data-ds-dark-theme',
          'style',
        ],
      })
    }
    const system = matchMedia('(prefers-color-scheme: dark)')
    system.addEventListener('change', copyTheme)
    return () => {
      observer.disconnect()
      system.removeEventListener('change', copyTheme)
    }
  }, [source])
  return (
    <div ref={content} className="mv-ui mv-dialog-content">
      <style>{UI_STYLES}</style>
      <header className="mv-dialog-header">
        <h3>{title}</h3>
        <IconButton label={closeLabel} onClick={onClose} variant="ghost">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="m4 4 8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </IconButton>
      </header>
      <div className="mv-dialog-body">{children}</div>
    </div>
  )
}

/** Host owns modal lifetime and keyboard coordination; callers own localized copy. */
export function DetailsDialog({
  title,
  open,
  onClose,
  children,
  closeLabel = title,
  className = '',
}: {
  title: string
  open: boolean
  onClose: () => void
  children: ReactNode
  closeLabel?: string
  className?: string
}) {
  const Shell = useContext(OverlayShell)
  const source = useRef<HTMLSpanElement>(null)
  return (
    <>
      <span ref={source} hidden />
      <Shell open={open} onClose={onClose} title={title} className={`mv-ui mv-dialog ${className}`}>
        {open ? (
          <DialogContent title={title} onClose={onClose} closeLabel={closeLabel} source={source}>
            {children}
          </DialogContent>
        ) : null}
      </Shell>
    </>
  )
}
