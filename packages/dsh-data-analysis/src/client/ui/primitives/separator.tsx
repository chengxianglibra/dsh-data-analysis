// Source: @shadcn official registry, radix-nova style. SPDX-License-Identifier: MIT.
// DOM ref boundaries use forwardRef for the Host React 18 identity.
'use client'

import { Separator as SeparatorPrimitive } from 'radix-ui'
import * as React from 'react'
import { cn } from '../utils.ts'

const Separator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentProps<typeof SeparatorPrimitive.Root>
>(function Separator({ className, orientation = 'horizontal', decorative = true, ...props }, ref) {
  return (
    <SeparatorPrimitive.Root
      ref={ref}
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        'shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch',
        className,
      )}
      {...props}
    />
  )
})

export { Separator }
