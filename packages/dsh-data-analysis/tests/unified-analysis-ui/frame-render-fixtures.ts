import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import type {
  FrameClassification,
  FrameDisplay,
  FrameView,
  ResolvedFrameView,
} from '../../src/presentation/contracts/frame-view.ts'
import type {
  AnalysisSnapshot,
  FrameComparison,
  FramePeriods,
  FrameSnapshotV2,
} from '../../src/presentation/contracts/snapshot.ts'
import {
  axisGroups,
  calendarBinding,
  categoryAxis,
  comparisonOf,
  cycle,
  frame,
  labels,
  months,
  observed,
  repeat,
  statistic,
  timeAxis,
  token,
  value,
} from './frame-fixtures.ts'

export interface RenderOptions {
  view?: FrameView
  display?: FrameDisplay
  semantic?: boolean
  codeRef?: { executionId: string; sha256: string }
  readCode?: boolean
}
export interface Renderer {
  /** End to end through AnalysisDataView and the real resolveFrameView. */
  render: (snapshot: AnalysisSnapshot, options?: RenderOptions) => string
  /** FrameShell with a hand-built classification and resolved view. */
  shell: (
    snapshot: FrameSnapshotV2,
    classification: FrameClassification,
    view: ResolvedFrameView,
    display?: FrameDisplay,
  ) => string
  codeMatches: (text: string, digest: string) => boolean
  dispose: () => Promise<void>
}

/** Bundles the client components once per test file, as data-view.test.ts does. */
export async function bundleRenderer(): Promise<Renderer> {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-frame-render-'))
  const outfile = path.join(directory, 'render.mjs')
  await build({
    stdin: {
      contents: `import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnalysisDataView } from './src/client/analysis-ui/data-view.tsx';
import { AnalysisResources } from './src/client/analysis-ui/context.tsx';
import { FrameShell } from './src/client/analysis-ui/frame/view.tsx';
export { codeMatches } from './src/client/analysis-ui/frame/icons.tsx';
const provide = (options, child) => createElement(AnalysisResources.Provider, {value: {
  readResource: () => ({kind: 'snapshot', snapshot: options.snapshot,
    binding: options.codeRef ? {codeRef: options.codeRef} : {}}),
  openSemanticRef: options.semantic ? () => {} : undefined,
  readCode: options.readCode ? async () => ({text: ''}) : undefined}}, child);
export function render(snapshot, options = {}) {
  return renderToStaticMarkup(provide({...options, snapshot},
    createElement(AnalysisDataView, {kind: snapshot.kind, resourceName: 'result',
      view: options.view, display: options.display})));
}
export function shell(snapshot, classification, view, display) {
  return renderToStaticMarkup(provide({snapshot},
    createElement(FrameShell, {snapshot, classification, view, display, resourceName: 'result'})));
}`,
      resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    jsx: 'automatic',
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    logLevel: 'silent',
  })
  const module = await import(pathToFileURL(outfile).href)
  return {
    render: module.render,
    shell: module.shell,
    codeMatches: module.codeMatches,
    dispose: () => rm(directory, { recursive: true, force: true }),
  }
}

const TIMEZONE = 'Asia/Shanghai'
type CalendarItem = Extract<FramePeriods['pages'][number]['items'][number], { kind: 'calendar' }>
/** Monthly read_periods items; `actual` overrides the actual start of chosen periods. */
export function monthPeriods(count: number, actual: Record<number, string> = {}): CalendarItem[] {
  const starts = months(count + 1)
  return starts.slice(0, count).map((start, i) => ({
    kind: 'calendar',
    key: [start],
    timezone: TIMEZONE,
    start: actual[i] ?? start,
    end: starts[i + 1]!,
    label: start.slice(0, 7),
    nominalStart: start,
    nominalEnd: starts[i + 1]!,
  }))
}
export const axisPage = (items: CalendarItem[], axis = 'month') => ({
  target: { kind: 'axis' as const, axisToken: token(axis) },
  totalCount: items.length,
  hasMore: false,
  items,
})

/** Monthly revenue; `rows` picks which of `periods` have a data row (missing periods leave gaps). */
export function monthly(
  values: (number | null)[],
  options: { periods?: number; rows?: number[]; actual?: Record<number, string> } = {},
) {
  const periods = options.periods ?? values.length
  const rows = options.rows ?? values.map((_, i) => i)
  const keys = months(periods)
  return frame({
    axes: [{ ...timeAxis(periods), keys: rows.map((i) => keys[i]!) }],
    values: [{ name: 'revenue', values, context: observed() }],
    periods: [axisPage(monthPeriods(periods, options.actual))],
  })
}

/** Ordinary scalar comparison with deliberately inconsistent Δ and Δ% cells. */
export function comparedScalar(cells: {
  current: number | null
  baseline: number | null
  absolute: number | null
  relative: number | null
}) {
  const roles = ['current', 'baseline', 'absolute', 'relative'] as const
  const name = (role: (typeof roles)[number]) =>
    role === 'current' ? 'sales' : `prior.${role}.sales`
  const comparison: FrameComparison = {
    ...comparisonOf({ kind: 'ordinary' }, [
      { name: 'sales', values: roles.map((r) => [r, name(r)]) },
    ]),
    alias: 'prior',
    currentFixedAxes: [fixedRegion('west')],
    baselineFixedAxes: [fixedRegion('east')],
  }
  return frame({
    values: roles.map((r) => ({ name: name(r), values: [cells[r]] })),
    comparisons: [comparison],
  })
}
function fixedRegion(member: string): FrameComparison['currentFixedAxes'][number] {
  return {
    token: 'fixed_region',
    name: 'region',
    role: 'field',
    keys: [
      { id: 'region', slotId: 'k_fixed', dtype: { type: 'string' }, nullable: false, unit: null },
    ],
    key: [member],
    origins: [],
  }
}

/** Category comparison with presence columns; `baselinePresent` marks absent baseline rows. */
export function comparedCategories(baselinePresent: boolean[]) {
  const rows = baselinePresent.length
  const comparison: FrameComparison = {
    ...comparisonOf({ kind: 'ordinary' }, [
      {
        name: 'sales',
        values: [
          ['current', 'sales'],
          ['baseline', 'prior.baseline.sales'],
          ['absolute', 'prior.absolute.sales'],
          ['relative', 'prior.relative.sales'],
        ],
      },
    ]),
    presence: { current: 'current.present', baseline: 'prior.present', enclosing: [] },
  }
  return frame({
    axes: [categoryAxis(rows)],
    values: [
      value('sales', rows),
      value('prior.baseline.sales', rows),
      value('prior.absolute.sales', rows),
      { name: 'prior.relative.sales', values: Array(rows).fill(0.1) },
      { name: 'current.present', type: 'boolean', values: Array(rows).fill(true), presence: true },
      { name: 'prior.present', type: 'boolean', values: baselinePresent, presence: true },
    ],
    comparisons: [comparison],
  })
}

/** Two comparisons sharing one current value: the alias segmented control. */
export function twoAliases() {
  const make = (alias: string): FrameComparison => ({
    ...comparisonOf({ kind: 'ordinary' }, [
      {
        name: 'sales',
        values: [
          ['current', 'sales'],
          ['baseline', `${alias}.baseline.sales`],
        ],
      },
    ]),
    alias,
  })
  return frame({
    axes: [categoryAxis(3)],
    values: [
      value('sales', 3),
      value('lastyear.baseline.sales', 3),
      value('plan.baseline.sales', 3),
    ],
    comparisons: [make('lastyear'), make('plan')],
  })
}

/** Time × category ordinary comparison with three categories: small multiples. */
export function comparedTimeCategory() {
  const periods = 3
  const categories = 3
  const rows = periods * categories
  return frame({
    axes: [
      { ...timeAxis(periods), keys: repeat(months(periods), categories) },
      { ...categoryAxis(categories), keys: cycle(labels('r', categories), periods) },
    ],
    values: [value('sales', rows), value('prior.baseline.sales', rows)],
    comparisons: [
      comparisonOf({ kind: 'ordinary' }, [
        {
          name: 'sales',
          values: [
            ['current', 'sales'],
            ['baseline', 'prior.baseline.sales'],
          ],
        },
      ]),
    ],
  })
}

/** Calendar comparison with a comparison period page (period correspondence icon). */
export function comparedCalendarWithPeriods(periods = 3) {
  const items = monthPeriods(periods)
  const baseline = monthPeriods(periods + 12).slice(12, 12 + periods)
  return frame({
    axes: [timeAxis(periods)],
    values: [value('sales', periods), value('prior.baseline.sales', periods)],
    comparisons: [
      comparisonOf(calendarBinding(), [
        {
          name: 'sales',
          values: [
            ['current', 'sales'],
            ['baseline', 'prior.baseline.sales'],
          ],
        },
      ]),
    ],
    periods: [
      axisPage(items),
      {
        target: { kind: 'comparison', comparison: 0 },
        totalCount: periods,
        hasMore: false,
        items: items.map((current, i) => ({
          kind: 'comparison' as const,
          key: current.key,
          current,
          baseline: baseline[i]!,
          absentReason: null,
        })),
      },
    ],
  })
}

/** Category revenue with a `sum` broadcast over all rows (over by=()). */
export function categoryBroadcast() {
  return frame({
    axes: [categoryAxis(3)],
    values: [
      { name: 'revenue', values: [1100, 2200, 3300], context: observed() },
      { name: 'cap', values: [9000, 9000, 9000], context: statistic('sum', []) },
    ],
  })
}
export { comparedSinglePeriodMultiGroup } from './frame-fixtures.ts'
export { axisGroups }
