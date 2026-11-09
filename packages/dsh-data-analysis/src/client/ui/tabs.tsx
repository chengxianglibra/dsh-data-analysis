import { type ReactNode, useState } from 'react'
import { TabsContent, TabsList, Tabs as TabsRoot, TabsTrigger } from './primitives/tabs.tsx'

export interface TabItem {
  value: string
  trigger: string
  content: ReactNode
}

/** Radix manual activation preserves mounted reading state without focusing hidden content. */
export function Tabs({
  items,
  label,
  initialValue,
  onValueChange,
}: {
  items: TabItem[]
  label: string
  initialValue?: string
  onValueChange?: (value: string) => void
}) {
  const [active, setActive] = useState(initialValue)
  const selected = items.some((item) => item.value === active) ? active : items[0]?.value
  if (!items.length) return null
  return (
    <TabsRoot
      activationMode="manual"
      value={selected}
      onValueChange={(value) => {
        setActive(value)
        onValueChange?.(value)
      }}
    >
      <TabsList aria-label={label}>
        {items.map((item) => (
          <TabsTrigger
            key={item.value}
            value={item.value}
            tabIndex={selected === item.value ? 0 : -1}
          >
            {item.trigger}
          </TabsTrigger>
        ))}
      </TabsList>
      {items.map((item) => (
        <TabsContent
          key={item.value}
          value={item.value}
          forceMount
          hidden={selected !== item.value}
          tabIndex={selected === item.value ? 0 : -1}
        >
          {item.content}
        </TabsContent>
      ))}
    </TabsRoot>
  )
}
