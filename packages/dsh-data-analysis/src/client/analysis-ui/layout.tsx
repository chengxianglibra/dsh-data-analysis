import type { CSSProperties, ReactNode } from 'react'
import { CardContent, Card as CardPrimitive } from '../ui/primitives/card.tsx'

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
      <CardPrimitive
        className="au-card"
        data-variant={variant}
        data-direction={props.direction ?? 'column'}
        data-wrap={props.wrap ? 'true' : undefined}
      >
        <CardContent className="au-card-content" style={flexStyle({ ...props, children })}>
          {children}
        </CardContent>
      </CardPrimitive>
    </div>
  )
}

export const LAYOUT_STYLES = `
.au-surface .au-stack,.au-surface .au-card-scope,.au-surface .au-card,.au-surface [data-slot=tabs]{min-width:0;max-width:100%;width:100%}
.au-surface .au-card-scope{container:mv-card/inline-size}
.au-surface .au-card-content,.au-surface .au-stack>*{min-width:0}
.au-surface .au-card[data-variant=clear]{border:0;background:transparent;box-shadow:none;padding-block:0}
.au-surface .au-card[data-variant=clear]>.au-card-content{padding-inline:0}
.au-surface .au-card[data-variant=sunk]{background:var(--muted)}
.au-surface .au-stack[data-direction=row]>:is(.fv,.au-data,.au-card-scope,[data-slot=tabs]){flex:1 1 260px;width:auto;min-width:0}
.au-surface .au-card[data-direction=row]>.au-card-content>*{min-width:0}
.au-surface [data-slot=tabs]>[role=tablist]{max-width:100%;overflow-x:auto}
.au-surface [data-slot=tabs]>[role=tabpanel]{min-width:0}
.au-surface [data-slot=tabs]>[role=tabpanel]>div+div{margin-top:1rem}
.au-surface [data-slot=tabs]>[role=tabpanel][hidden]{display:none}
`
