import { type ComponentPropsWithoutRef, type ReactNode, useState } from 'react'
import type { FilterTarget } from '../../../presentation/contracts/view-filter-context.ts'
import { useCopy } from '../../i18n/context.tsx'
import type { Translator } from '../../i18n/copy.ts'
import { Button } from '../../ui/primitives/button.tsx'
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
  context,
  status,
  children,
}: {
  title?: ReactNode
  actions?: ReactNode
  context?: ReactNode
  status?: ReactNode
  children?: ReactNode
}) {
  return (
    <CardHeader className="fv-head au-result-header">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        {title && (
          <CardTitle role="heading" aria-level={3} className="fv-title">
            {title}
          </CardTitle>
        )}
        {context && <span className="text-[11px] text-muted-foreground">{context}</span>}
        {status}
      </div>
      {actions && <CardAction className="au-result-header-actions">{actions}</CardAction>}
      {children && <CardDescription>{children}</CardDescription>}
    </CardHeader>
  )
}

export function ResultStatus({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span
      role="status"
      aria-label={label}
      className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
    >
      {children}
    </span>
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
export function MetricGroup({
  items,
  paginate = false,
}: {
  items: readonly MetricItem[]
  paginate?: boolean
}) {
  const t = useCopy()
  const [page, setPage] = useState(0)
  const pageSize = 24
  const pages = Math.ceil(items.length / pageSize)
  const current = Math.min(page, Math.max(0, pages - 1))
  const shown = paginate ? items.slice(current * pageSize, (current + 1) * pageSize) : items
  return (
    <>
      <div className="fv-cards au-metric-group grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-4">
        {shown.map((item) => (
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
      {paginate && pages > 1 && (
        <div className="pr-pagination pr-interactive">
          <Button
            size="sm"
            variant="outline"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            {t('marivo.presentation.previous-page')}
          </Button>
          <span>
            {current + 1} / {pages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={current + 1 === pages}
            onClick={() => setPage(current + 1)}
          >
            {t('marivo.presentation.next-page')}
          </Button>
        </div>
      )}
    </>
  )
}

export function metricGroupLabel(t: Translator, groups: readonly FilterTarget[], row: number) {
  return groups
    .map(({ definition, values }) => {
      const value = values[row]
      const label =
        value === null
          ? t('marivo.presentation.missing-value')
          : value === ''
            ? t('marivo.presentation.empty-string')
            : String(value)
      return `${definition.declaration.label}: ${label}`
    })
    .join(' · ')
}

export function DataActions({ children }: { children: ReactNode }) {
  return <div className="fv-icons au-data-actions">{children}</div>
}
