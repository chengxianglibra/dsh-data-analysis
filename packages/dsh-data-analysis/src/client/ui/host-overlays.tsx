import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { type ReactNode, useEffect, useRef } from 'react'
import { OverlayProvider, type OverlayShellProps } from './overlays.tsx'
import { cn } from './utils.ts'

function HostDialogShell({ onAfterClose, ...props }: OverlayShellProps) {
  const wasOpen = useRef(props.open)
  useEffect(() => {
    if (wasOpen.current && !props.open) onAfterClose?.()
    wasOpen.current = props.open
  }, [props.open, onAfterClose])
  return (
    <Modal
      {...props}
      className={cn(props.className, 'mv-host-dialog')}
      headless
      backdropBlur={false}
    />
  )
}

/** Kept at the Host boundary so standalone Catalog and renderers stay pure. */
export function HostOverlayProvider({ children }: { children: ReactNode }) {
  return <OverlayProvider shell={HostDialogShell}>{children}</OverlayProvider>
}
