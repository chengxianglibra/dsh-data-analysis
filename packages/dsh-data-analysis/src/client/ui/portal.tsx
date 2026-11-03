import { createContext, type RefObject, useContext, useLayoutEffect, useState } from 'react'

export const PortalContainer = createContext<HTMLElement | null>(null)

const roles = [
  'bg',
  'soft',
  'text',
  'muted',
  'border',
  'accent',
  'control-border',
  'focus',
  'on-accent',
  'accent-soft',
  'warning',
  'warning-soft',
  'danger',
  'danger-soft',
  'success',
  'success-soft',
]
const semantic = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'border',
  'input',
  'ring',
]

/** Copy resolved roles across a Portal boundary and follow the originating scope's theme. */
export function usePortalTheme(source: RefObject<Element>, target: HTMLElement | null) {
  useLayoutEffect(() => {
    const origin = source.current
    if (!origin || !target) return
    const document = origin.ownerDocument
    const copy = () => {
      const computed = getComputedStyle(origin)
      for (const name of [
        ...roles.map((role) => `--mv-${role}`),
        ...semantic.map((role) => `--${role}`),
        ...Array.from({ length: 8 }, (_, index) => `--chart-${index + 1}`),
      ]) {
        const value = computed.getPropertyValue(name).trim()
        if (value) target.style.setProperty(name, value)
      }
      target.style.colorScheme = computed.colorScheme
      target.dataset.mvTheme = computed.colorScheme === 'dark' ? 'dark' : 'light'
    }
    copy()
    const observer = new MutationObserver(copy)
    for (let node: Element | null = origin; node; node = node.parentElement) {
      observer.observe(node, {
        attributes: true,
        attributeFilter: [
          'class',
          'style',
          'data-theme',
          'data-ds-theme-source',
          'data-ds-dark-theme',
        ],
      })
    }
    const system = document.defaultView?.matchMedia('(prefers-color-scheme: dark)')
    system?.addEventListener('change', copy)
    return () => {
      observer.disconnect()
      system?.removeEventListener('change', copy)
    }
  }, [source, target])
}

/** Modal descendants Portal inside their owning shell; other overlays use a controlled body root. */
export function useThemedPortal(source: RefObject<Element>, enabled = true) {
  const parent = useContext(PortalContainer)
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const document = source.current?.ownerDocument
    if (!document || !enabled) {
      setContainer(null)
      return
    }
    const node = document.createElement('div')
    node.className = 'mv-ui'
    node.dataset.mvPortal = ''
    ;(parent ?? document.body).append(node)
    setContainer(node)
    return () => node.remove()
  }, [parent, source, enabled])
  usePortalTheme(source, container)
  return container
}
