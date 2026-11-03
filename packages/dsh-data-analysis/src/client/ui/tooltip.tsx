import { type ReactElement, useRef, useState } from 'react'
import { useThemedPortal } from './portal.tsx'
import {
  TooltipContent,
  TooltipProvider,
  Tooltip as TooltipRoot,
  TooltipTrigger,
} from './primitives/tooltip.tsx'

/** Radix owns positioning, hover persistence, dismissal, and trigger accessibility. */
export function Tooltip({
  id,
  text,
  children,
}: {
  id: string
  text: string
  children: ReactElement<{ 'aria-describedby'?: string }>
}) {
  const source = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const container = useThemedPortal(source, open)
  return (
    <TooltipProvider delayDuration={250} skipDelayDuration={0}>
      <TooltipRoot open={open} onOpenChange={setOpen}>
        <span ref={source} className="inline-flex shrink-0 align-middle">
          <TooltipTrigger asChild aria-describedby={children.props['aria-describedby']}>
            {children}
          </TooltipTrigger>
          <span id={id} hidden>
            {text}
          </span>
        </span>
        {open && container ? (
          <TooltipContent
            container={container}
            sideOffset={4}
            collisionPadding={8}
            className="whitespace-pre-line"
          >
            {text}
          </TooltipContent>
        ) : null}
      </TooltipRoot>
    </TooltipProvider>
  )
}
