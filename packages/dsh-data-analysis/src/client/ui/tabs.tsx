import { type ReactNode, useId, useRef, useState } from 'react'

export interface TabItem {
  value: string
  trigger: string
  content: ReactNode
}

const itemId = (value: string) =>
  Array.from(value, (character) => character.codePointAt(0)?.toString(16)).join('-') || 'empty'

/** Manual activation keeps keyboard exploration separate from changing the reading panel. */
export function Tabs({ items }: { items: TabItem[] }) {
  const [active, setActive] = useState<string>()
  const [focused, setFocused] = useState<string>()
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const prefix = `mv-tabs-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const selected = items.some((item) => item.value === active) ? active : items[0]?.value
  const focusValue = items.some((item) => item.value === focused) ? focused : selected
  if (!items.length) return null
  return (
    <div className="au-tabs">
      <div role="tablist">
        {items.map((item, index) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            id={`${prefix}-tab-${itemId(item.value)}`}
            aria-controls={`${prefix}-panel-${itemId(item.value)}`}
            aria-selected={selected === item.value}
            tabIndex={focusValue === item.value ? 0 : -1}
            ref={(node) => {
              if (node) buttons.current.set(item.value, node)
              else buttons.current.delete(item.value)
            }}
            onFocus={() => setFocused(item.value)}
            onClick={() => {
              setActive(item.value)
              setFocused(item.value)
            }}
            onKeyDown={(event) => {
              let next: number | undefined
              if (event.key === 'ArrowRight') next = (index + 1) % items.length
              if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length
              if (event.key === 'Home') next = 0
              if (event.key === 'End') next = items.length - 1
              if (next !== undefined) {
                event.preventDefault()
                const value = items[next]?.value
                if (value !== undefined) buttons.current.get(value)?.focus()
              }
              // Native button Enter/Space click behavior performs activation.
            }}
          >
            {item.trigger}
          </button>
        ))}
      </div>
      {items.map((item) => (
        <div
          key={item.value}
          role="tabpanel"
          id={`${prefix}-panel-${itemId(item.value)}`}
          aria-labelledby={`${prefix}-tab-${itemId(item.value)}`}
          hidden={selected !== item.value}
        >
          {item.content}
        </div>
      ))}
    </div>
  )
}
