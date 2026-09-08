import { useEffect, useRef, useState } from 'react'

/** Measure the containing block, retaining its last usable width while it is hidden. */
export function useElementWidth(minimum: number, initial: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [measured, setMeasured] = useState(initial)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    let active = true
    const update = (value: number) => {
      if (!active || !Number.isFinite(value) || value <= 0) return
      const next = Math.max(1, Math.floor(value))
      setMeasured((previous) => (previous === next ? previous : next))
    }
    update(element.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) update(entry.contentRect.width)
    })
    observer.observe(element)
    return () => {
      active = false
      observer.disconnect()
    }
  }, [])

  return { ref, width: Math.max(minimum, measured) }
}
