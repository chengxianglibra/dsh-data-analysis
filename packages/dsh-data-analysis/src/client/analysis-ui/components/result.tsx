import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../ui/primitives/card.tsx'

/** Reading structure only; presenters retain saved-data and operation semantics. */
export function ResultCard({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <Card {...props} className={`fv au-data au-result${className ? ` ${className}` : ''}`} />
}

export function ResultHeader({
  title,
  actions,
  children,
}: {
  title?: ReactNode
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <CardHeader className="fv-head au-result-header">
      {title && (
        <CardTitle role="heading" aria-level={3} className="fv-title">
          {title}
        </CardTitle>
      )}
      {actions && <CardAction className="au-result-header-actions">{actions}</CardAction>}
      {children && <CardDescription>{children}</CardDescription>}
    </CardHeader>
  )
}

export interface MetricItem {
  key: string
  value: ReactNode
  label?: string
  unit?: string
  title?: string
}

/** Values arrive formatted by their owning presenter; no conversion or aggregation. */
export function MetricGroup({ items }: { items: readonly MetricItem[] }) {
  return (
    <div className="fv-cards au-metric-group grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-4">
      {items.map((item) => (
        <Card key={item.key} data-value={item.key}>
          <CardHeader>
            {item.label && <CardDescription>{item.label}</CardDescription>}
            <CardTitle className="au-metric-value" title={item.title}>
              <strong>{item.value}</strong>
              {item.unit && <span>{item.unit}</span>}
            </CardTitle>
          </CardHeader>
        </Card>
      ))}
    </div>
  )
}

export function DataActions({ children }: { children: ReactNode }) {
  return <div className="fv-icons au-data-actions">{children}</div>
}
