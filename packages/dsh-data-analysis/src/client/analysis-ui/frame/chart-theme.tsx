import { ThemeContext, useTheme } from '@openuidev/react-ui'
import { type ReactNode, useEffect, useId, useMemo, useState } from 'react'
import { FRAME_CHART_DARK, FRAME_CHART_LIGHT } from './chart-palette.ts'

const portalVariables = [
  '--openui-background',
  '--openui-foreground',
  '--openui-border-default',
  '--openui-border-interactive',
  '--openui-border-accent-emphasis',
  '--openui-text-neutral-primary',
  '--openui-text-neutral-secondary',
  '--openui-text-label-xs',
  '--openui-text-label-xs-heavy',
  '--openui-text-label-sm',
  '--openui-text-body-default',
  '--openui-text-label-xs-letter-spacing',
  '--openui-text-label-xs-heavy-letter-spacing',
  '--openui-text-label-sm-letter-spacing',
  '--openui-text-body-default-letter-spacing',
  '--openui-font-variation-regular',
  '--openui-font-variation-medium',
  '--openui-space-3xs',
  '--openui-space-2xs',
  '--openui-space-xs',
  '--openui-space-s',
  '--openui-space-m',
  '--openui-space-l',
  '--openui-radius-2xs',
  '--openui-radius-xs',
  '--openui-radius-s',
  '--openui-radius-m',
  '--openui-radius-l',
  '--openui-sunk',
  '--openui-shadow-s',
] as const

interface Appearance {
  mode: 'light' | 'dark'
  colors: string[]
  portal: string
}

const initial: Appearance = { mode: 'light', colors: [...FRAME_CHART_LIGHT], portal: '' }

/** Read the resolved Frame tokens, which already encode Harness and OS theme precedence. */
function readAppearance(element: HTMLElement): Appearance {
  const style = getComputedStyle(element)
  const mode = style.getPropertyValue('--fv-chart-mode').trim() === 'dark' ? 'dark' : 'light'
  const fallback = mode === 'dark' ? FRAME_CHART_DARK : FRAME_CHART_LIGHT
  const colors = fallback.map((value, index) => {
    const candidate = style.getPropertyValue(`--fv-s${index + 1}`).trim()
    return candidate && CSS.supports('color', candidate) ? candidate : value
  })
  const safe = (value: string) => (/[;{}]/.test(value) ? '' : value.trim())
  const entries = portalVariables.flatMap((name) => {
    const value = safe(style.getPropertyValue(name))
    return value ? [`${name}:${value}`] : []
  })
  const bg = safe(style.getPropertyValue(mode === 'dark' ? '--pr-soft' : '--pr-bg'))
  if (bg) entries.push(`--openui-popover-background:${bg}`)
  entries.push(
    `--openui-shadow-m:${mode === 'dark' ? '0 4px 20px rgb(0 0 0 / .28)' : '0 4px 16px rgb(15 23 42 / .08)'}`,
  )
  return { mode, colors, portal: entries.join(';') }
}

/** Scope OpenUI context and its body-mounted tooltip to this chart only. */
export function FrameChartTheme({ children }: { children: (colors: string[]) => ReactNode }) {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const [appearance, setAppearance] = useState<Appearance>(initial)
  const { theme } = useTheme()
  const id = `dsh-frame-chart-portal-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  useEffect(() => {
    if (!element) return
    const update = () => {
      const next = readAppearance(element)
      setAppearance((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      )
    }
    update()
    const observer = new MutationObserver(update)
    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
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
    const system = window.matchMedia?.('(prefers-color-scheme: dark)')
    system?.addEventListener('change', update)
    return () => {
      observer.disconnect()
      system?.removeEventListener('change', update)
    }
  }, [element])
  const context = useMemo(() => {
    const c = appearance.colors
    // Match analysis-ui's default chart palette.
    const defaultChartPalette = [c[4]!, c[5]!, c[2]!, c[0]!, c[1]!, c[3]!]
    return {
      theme: { ...theme, defaultChartPalette },
      mode: appearance.mode,
      portalThemeClassName: `dsh-frame-chart-portal ${id}`,
    }
  }, [appearance, id, theme])
  return (
    <div ref={setElement} data-chart-engine="openui">
      <ThemeContext.Provider value={context}>
        {appearance.portal && <style>{`.${id}{${appearance.portal}}`}</style>}
        {children(appearance.colors)}
      </ThemeContext.Provider>
    </div>
  )
}
