import type { CSSProperties, ReactNode } from 'react'

export interface LayoutProps {
  direction?: 'row' | 'column'
  gap?: 'none' | 'xs' | 's' | 'm' | 'l' | 'xl' | '2xl'
  align?: 'start' | 'center' | 'end' | 'stretch' | 'baseline'
  justify?: 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly'
  wrap?: boolean
  children: ReactNode
}
const gaps = { none: 0, xs: 4, s: 8, m: 16, l: 24, xl: 32, '2xl': 40 }
const alignment = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
  baseline: 'baseline',
} as const
const justification = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
  around: 'space-around',
  evenly: 'space-evenly',
} as const

function flexStyle({
  direction = 'column',
  gap = 'm',
  align,
  justify = 'start',
  wrap,
}: LayoutProps): CSSProperties {
  return {
    display: 'flex',
    flexDirection: direction,
    gap: gaps[gap],
    alignItems: alignment[align ?? (direction === 'row' ? 'start' : 'stretch')],
    justifyContent: justification[wrap && justify === 'between' ? 'start' : justify],
    flexWrap: wrap ? 'wrap' : undefined,
  }
}
export function Stack({ children, ...props }: LayoutProps) {
  return (
    <div
      className="au-stack"
      data-direction={props.direction ?? 'column'}
      data-wrap={props.wrap ? 'true' : undefined}
      style={flexStyle({ ...props, children })}
    >
      {children}
    </div>
  )
}
export function Card({
  children,
  variant = 'card',
  ...props
}: LayoutProps & { variant?: 'card' | 'sunk' | 'clear' }) {
  return (
    <div className="au-card-scope">
      <div
        className={`au-card openui-card openui-card-${variant}`}
        data-variant={variant}
        data-direction={props.direction ?? 'column'}
        data-wrap={props.wrap ? 'true' : undefined}
        style={flexStyle({ ...props, children })}
      >
        {children}
      </div>
    </div>
  )
}

export const LAYOUT_STYLES = `
.au-surface .au-stack,.au-surface .au-card-scope,.au-surface .au-card,.au-surface .au-tabs{min-width:0;max-width:100%;width:100%}.au-surface .au-card-scope{container:mv-card/inline-size}.au-surface .au-card{padding:16px;border:1px solid var(--mv-border);border-radius:10px;background:var(--mv-bg)}.au-surface .au-card[data-variant=sunk]{background:var(--mv-soft)}.au-surface .au-card[data-variant=clear]{padding:0;border:0;background:transparent}.au-surface .au-stack[data-direction=row]>:is(.fv,.au-data,.au-card-scope,.au-tabs){flex:1 1 260px;width:auto;min-width:0}.au-surface .au-card[data-direction=row]>*{min-width:0}.au-tabs>[role=tablist]{display:flex;gap:8px;overflow-x:auto;max-width:100%;padding:2px;margin-bottom:16px}.au-tabs>[role=tablist]>[role=tab]{flex:none;min-height:32px;padding:4px 10px;border:1px solid transparent;border-bottom:2px solid transparent;border-radius:6px 6px 0 0;background:transparent;color:var(--mv-muted);font:14px/22px system-ui,sans-serif;cursor:pointer}.au-tabs>[role=tablist]>[aria-selected=true]{color:var(--mv-accent);border-bottom-color:var(--mv-accent);font-weight:600}.au-tabs>[role=tablist]>[role=tab]:hover{background:var(--mv-soft)}.au-tabs>[role=tabpanel]{min-width:0}.au-tabs>[role=tabpanel]>div+div{margin-top:16px}.au-tabs>[role=tabpanel][hidden]{display:none}
@container mv-card (width < 480px){.au-card:not([data-variant=clear]){padding:12px}}
@container mv-surface (width < 480px){.au-surface-content>h1{font-size:18px;line-height:26px}}
`
