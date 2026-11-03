// Source: @shadcn official registry, radix-nova style. SPDX-License-Identifier: MIT.
// DOM ref boundaries use forwardRef for the Host React 18 identity.
'use client'

import { Popover as PopoverPrimitive } from 'radix-ui'
import * as React from 'react'
import { PortalContainer, useThemedPortal } from '../portal.tsx'
import { cn } from '../utils.ts'

function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  const source = React.useRef<HTMLSpanElement>(null)
  const container = useThemedPortal(source)
  return (
    <>
      <span hidden ref={source} />
      <PortalContainer.Provider value={container}>
        <PopoverPrimitive.Root data-slot="popover" {...props} />
      </PortalContainer.Provider>
    </>
  )
}

const PopoverClose = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Close>,
  React.ComponentProps<typeof PopoverPrimitive.Close>
>(function PopoverClose(props, ref) {
  return <PopoverPrimitive.Close ref={ref} data-slot="popover-close" {...props} />
})

const PopoverTrigger = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Trigger>,
  React.ComponentProps<typeof PopoverPrimitive.Trigger>
>(function PopoverTrigger({ ...props }, ref) {
  return <PopoverPrimitive.Trigger ref={ref} data-slot="popover-trigger" {...props} />
})

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentProps<typeof PopoverPrimitive.Content> & { container?: HTMLElement | null }
>(function PopoverContent(
  { className, align = 'center', sideOffset = 4, container, ...props },
  ref,
) {
  const inheritedContainer = React.useContext(PortalContainer)
  return (
    <PopoverPrimitive.Portal container={container ?? inheritedContainer}>
      <PopoverPrimitive.Content
        ref={ref}
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 flex w-72 origin-(--radix-popover-content-transform-origin) flex-col gap-2.5 rounded-lg bg-popover p-2.5 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
})

const PopoverAnchor = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Anchor>,
  React.ComponentProps<typeof PopoverPrimitive.Anchor>
>(function PopoverAnchor({ ...props }, ref) {
  return <PopoverPrimitive.Anchor ref={ref} data-slot="popover-anchor" {...props} />
})

const PopoverHeader = React.forwardRef<React.ElementRef<'div'>, React.ComponentProps<'div'>>(
  function PopoverHeader({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="popover-header"
        className={cn('flex flex-col gap-0.5 text-sm', className)}
        {...props}
      />
    )
  },
)

function PopoverTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  return <div data-slot="popover-title" className={cn('font-medium', className)} {...props} />
}

const PopoverDescription = React.forwardRef<React.ElementRef<'p'>, React.ComponentProps<'p'>>(
  function PopoverDescription({ className, ...props }, ref) {
    return (
      <p
        ref={ref}
        data-slot="popover-description"
        className={cn('text-muted-foreground', className)}
        {...props}
      />
    )
  },
)

export {
  Popover,
  PopoverAnchor,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
}
