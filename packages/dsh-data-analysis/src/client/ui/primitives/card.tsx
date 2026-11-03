// Source: @shadcn official registry, radix-nova style. SPDX-License-Identifier: MIT.
// DOM ref boundaries use forwardRef for the Host React 18 identity.
import * as React from 'react'
import { cn } from '../utils.ts'

const Card = React.forwardRef<
  React.ElementRef<'div'>,
  React.ComponentProps<'div'> & { size?: 'default' | 'sm' }
>(function Card({ className, size = 'default', ...props }, ref) {
  return (
    <div
      ref={ref}
      data-slot="card"
      data-size={size}
      className={cn(
        'group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-xl bg-card py-(--card-spacing) text-sm text-card-foreground ring-1 ring-foreground/10 [--card-spacing:--spacing(4)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl',
        className,
      )}
      {...props}
    />
  )
})

const CardHeader = React.forwardRef<React.ElementRef<'div'>, React.ComponentProps<'div'>>(
  function CardHeader({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="card-header"
        className={cn(
          'group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-xl px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)',
          className,
        )}
        {...props}
      />
    )
  },
)

const CardTitle = React.forwardRef<React.ElementRef<'div'>, React.ComponentProps<'div'>>(
  function CardTitle({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="card-title"
        className={cn(
          'text-base leading-snug font-medium group-data-[size=sm]/card:text-sm',
          className,
        )}
        {...props}
      />
    )
  },
)

const CardDescription = React.forwardRef<React.ElementRef<'div'>, React.ComponentProps<'div'>>(
  function CardDescription({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="card-description"
        className={cn('text-sm text-muted-foreground', className)}
        {...props}
      />
    )
  },
)

const CardAction = React.forwardRef<React.ElementRef<'div'>, React.ComponentProps<'div'>>(
  function CardAction({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="card-action"
        className={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)}
        {...props}
      />
    )
  },
)

const CardContent = React.forwardRef<React.ElementRef<'div'>, React.ComponentProps<'div'>>(
  function CardContent({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="card-content"
        className={cn('px-(--card-spacing)', className)}
        {...props}
      />
    )
  },
)

const CardFooter = React.forwardRef<React.ElementRef<'div'>, React.ComponentProps<'div'>>(
  function CardFooter({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="card-footer"
        className={cn(
          'flex items-center rounded-b-xl border-t bg-muted/50 p-(--card-spacing)',
          className,
        )}
        {...props}
      />
    )
  },
)

export { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle }
