import { ChevronDown } from 'lucide-react'
import { Accordion as AccordionPrimitive } from 'radix-ui'
import { type ReactNode, useState } from 'react'
import { useReportReading } from './reading-state.tsx'

export interface DashboardAccordionItem {
  value: string
  trigger: string
  content: ReactNode
}

/** Single, collapsible sections keep their local reading state while hidden. */
export function DashboardAccordion({
  items,
  statementId,
}: {
  items: DashboardAccordionItem[]
  statementId?: string
}) {
  const reading = useReportReading()
  const [active, setActive] = useState(() =>
    statementId ? (reading?.accordions.get(statementId) ?? '') : '',
  )
  const selected = items.some((item) => item.value === active) ? active : ''
  if (!items.length) return null
  return (
    <AccordionPrimitive.Root
      className="au-accordion"
      type="single"
      collapsible
      value={selected}
      onValueChange={(value) => {
        setActive(value)
        if (statementId) reading?.accordions.set(statementId, value)
      }}
    >
      {items.map((item) => (
        <AccordionPrimitive.Item key={item.value} value={item.value} className="au-accordion-item">
          <AccordionPrimitive.Header className="au-accordion-header">
            <AccordionPrimitive.Trigger className="au-accordion-trigger">
              <span>{item.trigger}</span>
              <ChevronDown aria-hidden="true" size={16} />
            </AccordionPrimitive.Trigger>
          </AccordionPrimitive.Header>
          <AccordionPrimitive.Content
            className="au-accordion-content"
            forceMount
            hidden={selected !== item.value}
          >
            {item.content}
          </AccordionPrimitive.Content>
        </AccordionPrimitive.Item>
      ))}
    </AccordionPrimitive.Root>
  )
}

export function DashboardTextCallout({
  variant = 'neutral',
  title,
  description,
}: {
  variant?: 'neutral' | 'info' | 'warning' | 'success' | 'danger'
  title?: string
  description?: string
}) {
  if (!title && !description) return null
  return (
    <aside className="au-callout" data-variant={variant}>
      {title && <div className="au-callout-title">{title}</div>}
      {description && <div className="au-callout-description">{description}</div>}
    </aside>
  )
}

export const DASHBOARD_COMPONENT_STYLES = `
.au-surface .au-accordion{width:100%;min-width:0}
.au-surface .au-accordion-item{border-bottom:1px solid var(--border)}
.au-surface .au-accordion-header{margin:0}
.au-surface .au-accordion-trigger{display:flex;width:100%;min-width:0;min-height:44px;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;background:transparent;border:0;color:var(--foreground);font:inherit;font-weight:600;text-align:left;cursor:pointer}
.au-surface .au-accordion-trigger span{min-width:0;overflow-wrap:anywhere}
.au-surface .au-accordion-trigger:focus-visible{outline:2px solid var(--ring);outline-offset:2px}
.au-surface .au-accordion-trigger svg{flex:none;transition:transform 160ms ease}
.au-surface .au-accordion-trigger[data-state=open] svg{transform:rotate(180deg)}
.au-surface .au-accordion-content{min-width:0;padding:0 0 16px}
.au-surface .au-accordion-content[hidden]{display:none}
.au-surface .au-accordion-content>div+div{margin-top:1rem}
.au-surface .au-callout{box-sizing:border-box;width:100%;min-width:0;padding:12px 14px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--muted);color:var(--foreground)}
.au-surface .au-callout[data-variant=info]{border-inline-start:3px solid var(--mv-accent)}
.au-surface .au-callout[data-variant=success]{border-inline-start:3px solid var(--mv-success)}
.au-surface .au-callout[data-variant=warning]{border-inline-start:3px solid var(--mv-warning)}
.au-surface .au-callout[data-variant=danger]{border-inline-start:3px solid var(--destructive)}
.au-surface .au-callout-title{min-width:0;overflow-wrap:anywhere;font-weight:600}
.au-surface .au-callout-description{white-space:pre-wrap;overflow-wrap:anywhere}
.au-surface .au-callout-title+.au-callout-description{margin-top:4px}
@media (prefers-reduced-motion:reduce){.au-surface .au-accordion-trigger svg{transition:none}}
`
