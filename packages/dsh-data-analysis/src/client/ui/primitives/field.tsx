// Source: @shadcn official registry, radix-nova style. SPDX-License-Identifier: MIT.
// DOM ref boundaries use forwardRef for the Host React 18 identity.

import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'
import { useMemo } from 'react'
import { cn } from '../utils.ts'

import { Label } from './label.tsx'
import { Separator } from './separator.tsx'

const FieldSet = React.forwardRef<React.ElementRef<'fieldset'>, React.ComponentProps<'fieldset'>>(
  function FieldSet({ className, ...props }, ref) {
    return (
      <fieldset
        ref={ref}
        data-slot="field-set"
        className={cn(
          'flex flex-col gap-4 has-[>[data-slot=checkbox-group]]:gap-3 has-[>[data-slot=radio-group]]:gap-3',
          className,
        )}
        {...props}
      />
    )
  },
)

const FieldLegend = React.forwardRef<
  React.ElementRef<'legend'>,
  React.ComponentProps<'legend'> & { variant?: 'legend' | 'label' }
>(function FieldLegend({ className, variant = 'legend', ...props }, ref) {
  return (
    <legend
      ref={ref}
      data-slot="field-legend"
      data-variant={variant}
      className={cn(
        'mb-1.5 font-medium data-[variant=label]:text-sm data-[variant=legend]:text-base',
        className,
      )}
      {...props}
    />
  )
})

const FieldGroup = React.forwardRef<React.ElementRef<'div'>, React.ComponentProps<'div'>>(
  function FieldGroup({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="field-group"
        className={cn(
          'group/field-group @container/field-group flex w-full flex-col gap-5 data-[slot=checkbox-group]:gap-3 *:data-[slot=field-group]:gap-4',
          className,
        )}
        {...props}
      />
    )
  },
)

const fieldVariants = cva('group/field flex w-full gap-2 data-[invalid=true]:text-destructive', {
  variants: {
    orientation: {
      vertical: 'flex-col *:w-full [&>.sr-only]:w-auto',
      horizontal:
        'flex-row items-center has-[>[data-slot=field-content]]:items-start *:data-[slot=field-label]:flex-auto has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px',
      responsive:
        'flex-col *:w-full @md/field-group:flex-row @md/field-group:items-center @md/field-group:*:w-auto @md/field-group:has-[>[data-slot=field-content]]:items-start @md/field-group:*:data-[slot=field-label]:flex-auto [&>.sr-only]:w-auto @md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px',
    },
  },
  defaultVariants: {
    orientation: 'vertical',
  },
})

const Field = React.forwardRef<
  React.ElementRef<'div'>,
  React.ComponentProps<'div'> & VariantProps<typeof fieldVariants>
>(function Field({ className, orientation = 'vertical', ...props }, ref) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: Field composes controls; FieldSet supplies native fieldset grouping when needed.
    <div
      ref={ref}
      role="group"
      data-slot="field"
      data-orientation={orientation}
      className={cn(fieldVariants({ orientation }), className)}
      {...props}
    />
  )
})

const FieldContent = React.forwardRef<React.ElementRef<'div'>, React.ComponentProps<'div'>>(
  function FieldContent({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="field-content"
        className={cn('group/field-content flex flex-1 flex-col gap-0.5 leading-snug', className)}
        {...props}
      />
    )
  },
)

const FieldLabel = React.forwardRef<
  React.ElementRef<typeof Label>,
  React.ComponentProps<typeof Label>
>(function FieldLabel({ className, ...props }, ref) {
  return (
    <Label
      ref={ref}
      data-slot="field-label"
      className={cn(
        'group/field-label peer/field-label flex w-fit gap-2 leading-snug group-data-[disabled=true]/field:opacity-50 has-data-checked:border-primary/30 has-data-checked:bg-primary/5 has-[>[data-slot=field]]:rounded-lg has-[>[data-slot=field]]:border has-[>[data-slot=field]]:not-has-[:disabled,[data-disabled]]:hover:bg-muted/50 has-[>[data-slot=field]]:has-[:focus-visible]:border-ring has-[>[data-slot=field]]:has-[:focus-visible]:ring-3 has-[>[data-slot=field]]:has-[:focus-visible]:ring-ring/50 *:data-[slot=field]:p-2.5 dark:has-data-checked:border-primary/20 dark:has-data-checked:bg-primary/10',
        'has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col',
        className,
      )}
      {...props}
    />
  )
})

const FieldTitle = React.forwardRef<React.ElementRef<'div'>, React.ComponentProps<'div'>>(
  function FieldTitle({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="field-label"
        className={cn(
          'flex w-fit items-center gap-2 text-sm font-medium group-data-[disabled=true]/field:opacity-50',
          className,
        )}
        {...props}
      />
    )
  },
)

const FieldDescription = React.forwardRef<React.ElementRef<'p'>, React.ComponentProps<'p'>>(
  function FieldDescription({ className, ...props }, ref) {
    return (
      <p
        ref={ref}
        data-slot="field-description"
        className={cn(
          'text-left text-sm leading-normal font-normal text-muted-foreground group-has-data-horizontal/field:text-balance [[data-variant=legend]+&]:-mt-1.5',
          'last:mt-0 nth-last-2:-mt-1',
          '[&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-primary',
          className,
        )}
        {...props}
      />
    )
  },
)

const FieldSeparator = React.forwardRef<
  React.ElementRef<'div'>,
  React.ComponentProps<'div'> & {
    children?: React.ReactNode
  }
>(function FieldSeparator({ children, className, ...props }, ref) {
  return (
    <div
      ref={ref}
      data-slot="field-separator"
      data-content={!!children}
      className={cn(
        'relative -my-2 h-5 text-sm group-data-[variant=outline]/field-group:-mb-2',
        className,
      )}
      {...props}
    >
      <Separator className="absolute inset-0 top-1/2" />
      {children && (
        <span
          className="relative mx-auto block w-fit bg-background px-2 text-muted-foreground"
          data-slot="field-separator-content"
        >
          {children}
        </span>
      )}
    </div>
  )
})

const FieldError = React.forwardRef<
  React.ElementRef<'div'>,
  React.ComponentProps<'div'> & {
    errors?: Array<{ message?: string } | undefined>
  }
>(function FieldError({ className, children, errors, ...props }, ref) {
  const content = useMemo(() => {
    if (children) {
      return children
    }

    if (!errors?.length) {
      return null
    }

    const uniqueErrors = [...new Map(errors.map((error) => [error?.message, error])).values()]

    if (uniqueErrors?.length === 1) {
      return uniqueErrors[0]?.message
    }

    return (
      <ul className="ml-4 flex list-disc flex-col gap-1">
        {uniqueErrors.map(
          (error) => error?.message && <li key={error.message}>{error.message}</li>,
        )}
      </ul>
    )
  }, [children, errors])

  if (!content) {
    return null
  }

  return (
    <div
      ref={ref}
      role="alert"
      data-slot="field-error"
      className={cn('text-sm font-normal text-destructive', className)}
      {...props}
    >
      {content}
    </div>
  )
})

export {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
}
