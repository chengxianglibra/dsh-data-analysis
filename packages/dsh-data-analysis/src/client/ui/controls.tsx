import { type ButtonHTMLAttributes, useId } from 'react'
import { Tooltip } from './tooltip.tsx'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'neutral' | 'primary' | 'ghost'
}

export function Button({
  variant = 'neutral',
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button {...props} type={type} className={`mv-button ${className}`} data-variant={variant} />
  )
}

export type IconButtonProps = ButtonProps & {
  label: string
  tip?: string
  unavailable?: boolean
}

/** Unavailable metadata stays focusable so its reason can be read. */
export function IconButton({
  label,
  tip,
  unavailable = false,
  className = '',
  onClick,
  ...props
}: IconButtonProps) {
  const id = `mv-tip-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const description = tip ?? label
  return (
    <Tooltip id={id} text={description}>
      <Button
        {...props}
        className={`mv-icon-button ${className}`}
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
}
