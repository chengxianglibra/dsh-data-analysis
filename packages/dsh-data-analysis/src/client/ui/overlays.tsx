import { XIcon } from 'lucide-react'
import {
  type ComponentType,
  createContext,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { IconButton } from './controls.tsx'
import { PortalContainer, usePortalTheme } from './portal.tsx'
import { Dialog, DialogContent, DialogTitle } from './primitives/dialog.tsx'
import { UIStyleSheet } from './theme.ts'
import { cn } from './utils.ts'

export interface OverlayShellProps {
  title: string
  open: boolean
  onClose: () => void
  onAfterClose?: () => boolean
  className: string
  children: ReactNode
}

/** Standalone readers use the same Radix Dialog source without importing Host services. */
function StandaloneDialogShell({
  title,
  open,
  onClose,
  onAfterClose,
  className,
  children,
}: OverlayShellProps) {
  const previous = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    if (open && document.activeElement instanceof HTMLElement)
      previous.current = document.activeElement
  }, [open])
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose()
      }}
    >
      <DialogContent
        className={cn('mv-ui p-0 sm:max-w-3xl', className)}
        showCloseButton={false}
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (!onAfterClose?.()) previous.current?.focus()
        }}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  )
}

const OverlayShell = createContext<ComponentType<OverlayShellProps>>(StandaloneDialogShell)

export function OverlayProvider({
  shell,
  children,
}: {
  shell: ComponentType<OverlayShellProps>
  children: ReactNode
}) {
  return <OverlayShell.Provider value={shell}>{children}</OverlayShell.Provider>
}

/** The shared content owns a Portal container inside the shell and outside its scroll region. */
function DetailsContent({
  title,
  onClose,
  closeLabel,
  source,
  children,
}: {
  title: string
  onClose: () => void
  closeLabel: string
  source: React.RefObject<HTMLSpanElement>
  children: ReactNode
}) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  usePortalTheme(source, root)
  usePortalTheme(source, root?.parentElement?.closest<HTMLElement>('.mv-ui') ?? null)
  return (
    <div
      ref={setRoot}
      className="mv-ui rounded-xl bg-popover p-4 text-popover-foreground ring-1 ring-foreground/10"
    >
      <UIStyleSheet />
      <PortalContainer.Provider value={root}>
        <div className="flex items-start justify-between gap-4 pb-4">
          <h2 className="text-base font-medium leading-none">{title}</h2>
          <IconButton label={closeLabel} onClick={onClose} variant="ghost" size="icon-sm">
            <XIcon />
          </IconButton>
        </div>
        <div className="mv-dialog-body">{children}</div>
      </PortalContainer.Provider>
    </div>
  )
}

/** Harness owns modal lifetime in Host; this component owns localized content only. */
export function DetailsDialog({
  title,
  open,
  onClose,
  onAfterClose,
  children,
  closeLabel = title,
  className,
}: {
  title: string
  open: boolean
  onClose: () => void
  onAfterClose?: () => boolean
  children: ReactNode
  closeLabel?: string
  className?: string
}) {
  const Shell = useContext(OverlayShell)
  const source = useRef<HTMLSpanElement>(null)
  return (
    <>
      <span ref={source} hidden />
      <Shell
        open={open}
        onClose={onClose}
        onAfterClose={onAfterClose}
        title={title}
        className={cn('mv-ui', className)}
      >
        {open ? (
          <DetailsContent title={title} onClose={onClose} closeLabel={closeLabel} source={source}>
            {children}
          </DetailsContent>
        ) : null}
      </Shell>
    </>
  )
}
