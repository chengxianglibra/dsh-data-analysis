import { useCallback, useEffect, useRef } from 'react'

/** Defer focus until modal teardown; a later user interaction cancels the request. */
export function useFocusAfterAsk() {
  const pending = useRef<{ focus: () => void; cancel: () => void }>()
  const clear = useCallback(() => {
    const request = pending.current
    if (!request) return
    document.removeEventListener('pointerdown', request.cancel, true)
    document.removeEventListener('keydown', request.cancel, true)
    pending.current = undefined
  }, [])
  useEffect(() => clear, [clear])
  return {
    prepare(focus: undefined | (() => void), active: boolean) {
      clear()
      if (typeof focus !== 'function' || !active) return
      const cancel = () => clear()
      pending.current = { focus, cancel }
      document.addEventListener('pointerdown', cancel, true)
      document.addEventListener('keydown', cancel, true)
    },
    finish() {
      const request = pending.current
      clear()
      if (!request) return false
      request.focus()
      return true
    },
  }
}
