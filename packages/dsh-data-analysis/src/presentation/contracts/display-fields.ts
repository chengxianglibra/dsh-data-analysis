import { z } from 'zod'
import type { DatasetColumn } from './types.ts'

/** Presentation fields shared by Frame and Dataset, without analysis semantics. */
export const commonDisplayFields = {
  height: z.number().int().positive().max(1200).optional(),
  title: z.string().trim().min(1).max(512).optional(),
  subtitle: z.string().trim().min(1).max(1024).optional(),
  time: z
    .strictObject({
      tickFormat: z.enum(['auto', 'date', 'date-time', 'time']).optional(),
      showTimezone: z.boolean().optional(),
    })
    .optional(),
  seriesLayout: z.enum(['auto', 'overlay', 'facet']).optional(),
  formats: z
    .array(
      z.strictObject({
        value: z.string().min(1).max(512),
        format: z.enum(['percent', 'number', 'currency']),
        decimals: z.number().int().min(0).max(6).optional(),
      }),
    )
    .max(64)
    .optional(),
}

/** Explicit overlay asserts comparability, but cannot override known conflicts. */
export function seriesLayoutIssue(
  columns: DatasetColumn[],
  view: { chart: string; values?: string[]; broadcast?: string[] },
  display?: {
    seriesLayout?: 'auto' | 'overlay' | 'facet'
    formats?: { value: string; format: string; decimals?: number }[]
  },
): string | undefined {
  if (!display?.seriesLayout || display.seriesLayout === 'auto') return undefined
  if (view.chart !== 'line') return '/display/seriesLayout'
  if (display.seriesLayout !== 'overlay') return undefined
  const names = [...(view.values ?? []), ...(view.broadcast ?? [])]
  const units = new Set(
    names.map((name) => columns.find((column) => column.id === name)?.unit).filter(Boolean),
  )
  const formats = new Set(
    names.map((name) => {
      const format = display.formats?.find((item) => item.value === name)
      return format ? JSON.stringify([format.format, format.decimals ?? 2]) : ''
    }),
  )
  return units.size > 1 || formats.size > 1 ? '/display/seriesLayout' : undefined
}
