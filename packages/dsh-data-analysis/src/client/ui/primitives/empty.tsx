// Source: @shadcn official registry, radix-nova style. SPDX-License-Identifier: MIT.
// DOM ref boundaries use forwardRef for the Host React 18 identity.

import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'
import { cn } from '../utils.ts'

const Empty = React.forwardRef<React.ElementRef<'div'>, React.ComponentProps<'div'>>(function Empty(
  { className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      data-slot="empty"
      className={cn(
        'flex w-full min-w-0 flex-1 flex-col items-center justify-center gap-4 rounded-xl border-dashed p-6 text-center text-balance',
        className,
      )}
      {...props}
    />
  )
})

const EmptyHeader = React.forwardRef<React.ElementRef<'div'>, React.ComponentProps<'div'>>(
  function EmptyHeader({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="empty-header"
        className={cn('flex max-w-sm flex-col items-center gap-2', className)}
        {...props}
      />
    )
  },
)

const emptyMediaVariants = cva(
  'mb-2 flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        icon: "flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

const EmptyMedia = React.forwardRef<
  React.ElementRef<'div'>,
  React.ComponentProps<'div'> & VariantProps<typeof emptyMediaVariants>
>(function EmptyMedia({ className, variant = 'default', ...props }, ref) {
  return (
    <div
      ref={ref}
      data-slot="empty-icon"
      data-variant={variant}
      className={cn(emptyMediaVariants({ variant, className }))}
      {...props}
    />
  )
})

const EmptyTitle = React.forwardRef<React.ElementRef<'div'>, React.ComponentProps<'div'>>(
  function EmptyTitle({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="empty-title"
        className={cn('text-sm font-medium tracking-tight', className)}
        {...props}
      />
    )
  },
)

function EmptyDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <div
      data-slot="empty-description"
      className={cn(
        'text-sm/relaxed text-muted-foreground [&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-primary',
        className,
      )}
      {...props}
    />
  )
}

const EmptyContent = React.forwardRef<React.ElementRef<'div'>, React.ComponentProps<'div'>>(
  function EmptyContent({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="empty-content"
        className={cn(
          'flex w-full max-w-sm min-w-0 flex-col items-center gap-2.5 text-sm text-balance',
          className,
        )}
        {...props}
      />
    )
  },
)

export { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle }
