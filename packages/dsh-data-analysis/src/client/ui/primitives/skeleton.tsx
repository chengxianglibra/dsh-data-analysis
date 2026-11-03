// Source: @shadcn official registry, radix-nova style. SPDX-License-Identifier: MIT.
// DOM ref boundaries use forwardRef for the Host React 18 identity.
import * as React from 'react'
import { cn } from '../utils.ts'

const Skeleton = React.forwardRef<React.ElementRef<'div'>, React.ComponentProps<'div'>>(
  function Skeleton({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="skeleton"
        className={cn('animate-pulse rounded-md bg-muted', className)}
        {...props}
      />
    )
  },
)

export { Skeleton }
