import type { ComponentPropsWithoutRef, ReactNode } from 'react'

/** Reading structure only; presenters retain saved-data and operation semantics. */
export function ResultCard({ className, ...props }: ComponentPropsWithoutRef<'section'>) {
  return (
    <section {...props} className={`fv au-data au-result${className ? ` ${className}` : ''}`} />
  )
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
    <>
      <div className="fv-head au-result-header">
        <h3 className="fv-title">{title}</h3>
        {actions && <span className="au-result-header-actions">{actions}</span>}
      </div>
      {children}
    </>
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
    <div className="fv-cards au-metric-group">
      {items.map((item) => (
        <div key={item.key} data-value={item.key}>
          {item.label && <span>{item.label}</span>}
          <div className="au-metric-value">
            <strong title={item.title}>{item.value}</strong>
            {item.unit && <span>{item.unit}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

export function DataActions({ children }: { children: ReactNode }) {
  return <div className="fv-icons au-data-actions">{children}</div>
}
