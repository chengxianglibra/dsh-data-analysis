import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

const activeTooltips = new WeakMap<Document, () => void>()

/** Native top-layer drawing preserves DOM ancestry, including modal focus and theme scopes. */
export function Tooltip({ id, text, children }: { id: string; text: string; children: ReactNode }) {
  const anchor = useRef<HTMLSpanElement>(null)
  const popup = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const hovered = useRef(false)
  const focused = useRef(false)
  const dismissed = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const clearTimer = () => clearTimeout(timer.current)
  const dismiss = useCallback(() => {
    clearTimeout(timer.current)
    dismissed.current = true
    setOpen(false)
  }, [])
  const leave = () => {
    clearTimer()
    if (hovered.current || focused.current) return
    dismissed.current = false
    // Allow crossing the small gap between the trigger and popup.
    timer.current = setTimeout(() => setOpen(false), 150)
  }
  useEffect(() => () => clearTimeout(timer.current), [])
  useLayoutEffect(() => {
    const trigger = anchor.current
    const tip = popup.current
    if (!trigger || !tip) return
    tip.setAttribute('popover', 'manual')
    if (!open) return
    const document = trigger.ownerDocument
    const view = document.defaultView
    if (!view) return
    activeTooltips.get(document)?.()
    activeTooltips.set(document, dismiss)
    tip.showPopover()
    const position = () => {
      const rect = trigger.getBoundingClientRect()
      const size = tip.getBoundingClientRect()
      const width = document.documentElement.clientWidth
      const height = document.documentElement.clientHeight
      const above = rect.top - size.height - 4
      tip.style.left = `${Math.max(8, Math.min(rect.left + (rect.width - size.width) / 2, width - size.width - 8))}px`
      tip.style.top = `${Math.max(8, Math.min(above >= 8 ? above : rect.bottom + 4, height - size.height - 8))}px`
    }
    position()
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        event.isComposing ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey
      )
        return
      event.preventDefault()
      event.stopPropagation()
      dismiss()
    }
    const scroll = (event: Event) => {
      if (event.target !== tip) position()
    }
    const observer = new ResizeObserver(position)
    const visibility = new IntersectionObserver((entries) => {
      if (entries.some((entry) => !entry.isIntersecting)) dismiss()
    })
    observer.observe(trigger)
    observer.observe(tip)
    visibility.observe(trigger)
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('scroll', scroll, true)
    view.addEventListener('resize', position)
    view.addEventListener('blur', dismiss)
    return () => {
      observer.disconnect()
      visibility.disconnect()
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('scroll', scroll, true)
      view.removeEventListener('resize', position)
      view.removeEventListener('blur', dismiss)
      if (activeTooltips.get(document) === dismiss) activeTooltips.delete(document)
      if (tip.matches(':popover-open')) tip.hidePopover()
    }
  }, [dismiss, open])
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Observes the native button and popup without adding another interactive focus target.
    <span
      ref={anchor}
      className="mv-icon-control"
      onPointerEnter={(event) => {
        if (event.pointerType === 'touch') return
        hovered.current = true
        clearTimer()
        if (!dismissed.current) timer.current = setTimeout(() => setOpen(true), 250)
      }}
      onPointerLeave={() => {
        hovered.current = false
        leave()
      }}
      onFocus={() => {
        focused.current = true
        clearTimer()
        dismissed.current = false
        setOpen(true)
      }}
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        )
          return
        focused.current = false
        if (!hovered.current) {
          clearTimer()
          dismissed.current = false
          setOpen(false)
        }
      }}
    >
      {children}
      <span ref={popup} role="tooltip" id={id} className="mv-tooltip">
        {text}
      </span>
    </span>
  )
}
