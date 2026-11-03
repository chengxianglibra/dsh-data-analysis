import { useInsertionEffect } from 'react'
import { COMPILED_UI_STYLES } from './styles.generated.ts'

/** Shared compiled Tailwind and semantic tokens; also used by standalone render fixtures. */
export const UI_STYLES = COMPILED_UI_STYLES

const registrations = new WeakMap<Document, { style: HTMLStyleElement; users: number }>()

/** Register once per document; the returned disposer releases this owner's reference. */
export function installUIStyles(document: Document = globalThis.document): () => void {
  let registration = registrations.get(document)
  if (!registration) {
    const style = document.createElement('style')
    style.dataset.marivoUi = 'radix-nova'
    style.textContent = UI_STYLES
    document.head.append(style)
    registration = { style, users: 0 }
    registrations.set(document, registration)
  }
  registration.users += 1
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    registration.users -= 1
    if (registration.users === 0) {
      registration.style.remove()
      registrations.delete(document)
    }
  }
}

/** Standalone roots share the exact stylesheet registered by the Host lifecycle. */
export function UIStyleSheet() {
  useInsertionEffect(() => installUIStyles(), [])
  return null
}
