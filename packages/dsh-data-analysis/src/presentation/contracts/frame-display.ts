import {
  classifyFrame,
  comparisonLabelAlias,
  type FrameDisplay,
  type ResolvedFrameView,
} from './frame-view.ts'
import type { FrameSnapshotV2 } from './snapshot.ts'
import { availableNames, numericViewType } from './view-fields.ts'

type DisplayIssue = {
  path: string
  expectedKind?: 'axis' | 'column' | 'value' | 'comparison-alias'
  candidates?: (string | null)[]
}

export function validateFrameDisplay(
  snapshot: FrameSnapshotV2,
  view: ResolvedFrameView,
  display?: FrameDisplay,
): string | undefined {
  // Readers need only the display option to mark as invalid.
  return frameDisplayIssue(snapshot, view, display)?.path.split('/').slice(0, 3).join('/')
}

/** Validate author-supplied presentation references against the same saved Frame as the view. */
export function frameDisplayIssue(
  snapshot: FrameSnapshotV2,
  view: ResolvedFrameView,
  display?: FrameDisplay,
): DisplayIssue | undefined {
  if (!display) return undefined
  const numericValue = (name: string) =>
    snapshot.frame.fields.some((field) => field.id === name && field.role === 'value') &&
    snapshot.data.columns.some((column) => column.id === name && numericViewType(column.type))
  const numericNames = () => snapshot.data.columns.map(({ id }) => id).filter(numericValue)
  const formats = (display.formats ?? []).map(({ value }) => value)
  for (const [i, name] of formats.entries())
    if (!numericValue(name) || formats.indexOf(name) !== i)
      return {
        path: `/display/formats/${i}/value`,
        expectedKind: 'value',
        candidates: availableNames(numericNames(), formats, i),
      }
  const section = snapshot.frame.sections.interpretation
  const facts = section.status === 'captured' ? section : undefined
  const labels = (display.comparisonLabels ?? []).map(comparisonLabelAlias)
  const aliases = facts?.comparisons.map(({ alias }) => alias) ?? []
  for (const [i, alias] of labels.entries())
    if (
      aliases.indexOf(alias) < 0 ||
      aliases.indexOf(alias) !== aliases.lastIndexOf(alias) ||
      labels.indexOf(alias) !== i
    )
      return {
        path: `/display/comparisonLabels/${i}/alias`,
        expectedKind: 'comparison-alias',
        candidates: aliases.filter(
          (name, j) =>
            name !== null &&
            aliases.indexOf(name) === j &&
            aliases.lastIndexOf(name) === j &&
            !labels.some((used, k) => k !== i && used === name),
        ),
      }
  if (display.highlight) {
    if (view.chart !== 'bar' && view.chart !== 'interval-bar') return { path: '/display/highlight' }
    const axes = snapshot.frame.axes
    const matching = (name: string) =>
      axes.filter((axis) => axis.token === name || axis.name === name)
    const matches = matching(display.highlight.axis)
    const axis = matches[0]
    if (!axis || matches.length !== 1 || axis.token !== view.axis) {
      const chosen = axes.find(({ token }) => token === view.axis)
      return {
        path: '/display/highlight/axis',
        expectedKind: 'axis',
        candidates: chosen
          ? [...new Set([chosen.name, chosen.token])].filter((name) => matching(name).length === 1)
          : [],
      }
    }
    const expected = JSON.stringify(display.highlight.key)
    if (
      axis.keys.length !== display.highlight.key.length ||
      !snapshot.data.rows.some(
        (_, row) =>
          JSON.stringify(
            axis.keys.map((key) => snapshot.frame.coordinates[key.slotId]?.values[row] ?? null),
          ) === expected,
      )
    )
      return { path: '/display/highlight/key' }
  }
  if (
    display.rowLimit !== undefined &&
    view.chart !== 'hbar' &&
    (view.chart !== 'table' || view.layout === 'comparison' || display.recordPreview)
  )
    return { path: '/display/rowLimit' }
  if (display.recordPreview) {
    if (
      view.chart !== 'table' ||
      view.layout === 'comparison' ||
      classifyFrame(snapshot).class !== 'observation'
    )
      return { path: '/display/recordPreview' }
    const { coordinates, values } = display.recordPreview
    const fields = [...coordinates, ...values]
    const coordinateNames = snapshot.frame.layout.flatMap((entry) =>
      entry.kind === 'coordinate' &&
      entry.part === 'key' &&
      snapshot.data.columns.some((column) => column.id === entry.name)
        ? [entry.name]
        : [],
    )
    for (const [i, name] of coordinates.entries())
      if (!coordinateNames.includes(name) || fields.indexOf(name) !== i)
        return {
          path: `/display/recordPreview/coordinates/${i}`,
          expectedKind: 'column',
          candidates: availableNames(coordinateNames, fields, i),
        }
    for (const [i, name] of values.entries())
      if (!numericValue(name) || fields.indexOf(name) !== i + coordinates.length)
        return {
          path: `/display/recordPreview/values/${i}`,
          expectedKind: 'value',
          candidates: availableNames(numericNames(), fields, i + coordinates.length),
        }
  }
  if (display.decompositionTotals) {
    if (view.chart !== 'decomposition') return { path: '/display/decompositionTotals' }
    const selected = facts?.decompositions[view.decomposition]
    if (!selected) return { path: '/display/decompositionTotals' }
    const matching = (name: string) =>
      facts?.decompositions.filter(
        (item) =>
          item.target.kind === 'level' &&
          item.rowScope === selected.rowScope &&
          JSON.stringify(item.groups) === JSON.stringify(selected.groups) &&
          item.outputs.some(
            (output) =>
              output.fieldKind === 'value' && output.role === 'total' && output.name === name,
          ),
      ).length === 1
    const totals = display.decompositionTotals
    for (const key of ['current', 'baseline'] as const) {
      const other = totals[key === 'current' ? 'baseline' : 'current']
      const name = totals[key]
      if (name === other || !numericValue(name) || !matching(name))
        return {
          path: `/display/decompositionTotals/${key}`,
          expectedKind: 'value',
          candidates: numericNames().filter((item) => item !== other && matching(item)),
        }
    }
  }
  return undefined
}
