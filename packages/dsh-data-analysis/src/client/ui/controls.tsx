import { type ComponentProps, forwardRef, useId } from 'react'
import { Button } from './primitives/button.tsx'
import { Tooltip } from './tooltip.tsx'

export { Button } from './primitives/button.tsx'
export type ButtonProps = ComponentProps<typeof Button>
export type IconButtonProps = ButtonProps & { label: string; tip?: string; unavailable?: boolean }

/** An unavailable action stays focusable so its explanation remains accessible. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, tip, unavailable = false, onClick, ...props },
  ref,
) {
  const id = `mv-tip-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const description = tip ?? label
  return (
    <Tooltip id={id} text={description}>
      <Button
        ref={ref}
        variant="outline"
        size="icon"
        {...props}
        aria-label={label}
        aria-describedby={
          [props['aria-describedby'], description !== label ? id : undefined]
            .filter(Boolean)
            .join(' ') || undefined
        }
        aria-disabled={unavailable || props['aria-disabled'] || undefined}
        onClick={(event) => {
          if (unavailable) {
            event.preventDefault()
            return
          }
          onClick?.(event)
        }}
      />
    </Tooltip>
  )
})
