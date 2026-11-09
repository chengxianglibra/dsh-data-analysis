import { classifyFrame, type FrameDisplay, type ResolvedFrameView } from './frame-view.ts'
import type { FrameSnapshotV2 } from './snapshot.ts'

/** Validate author-supplied presentation references against the same saved Frame as the view. */
export function validateFrameDisplay(
  snapshot: FrameSnapshotV2,
  view: ResolvedFrameView,
  display?: FrameDisplay,
): string | undefined {
  if (!display) return undefined
  const numericValue = (name: string) =>
    snapshot.frame.fields.some((field) => field.id === name && field.role === 'value') &&
    snapshot.data.columns.some(
      (column) => column.id === name && ['float64', 'int64', 'decimal'].includes(column.type),
    )
  const formats = display.formats ?? []
  if (new Set(formats.map((item) => item.value)).size !== formats.length) return '/display/formats'
  for (const item of formats) if (!numericValue(item.value)) return '/display/formats'
  const section = snapshot.frame.sections.interpretation
  const facts = section.status === 'captured' ? section : undefined
  const labels = display.comparisonLabels ?? []
  if (new Set(labels.map((item) => item.alias)).size !== labels.length)
    return '/display/comparisonLabels'
  for (const item of labels)
    if (facts?.comparisons.filter((comparison) => comparison.alias === item.alias).length !== 1)
      return '/display/comparisonLabels'
  if (display.highlight) {
    if (view.chart !== 'bar' && view.chart !== 'interval-bar') return '/display/highlight'
    const axes = snapshot.frame.axes.filter(
      (axis) => axis.token === display.highlight!.axis || axis.name === display.highlight!.axis,
    )
    const axis = axes[0]
    if (
      !axis ||
      axes.length !== 1 ||
      axis.token !== view.axis ||
      axis.keys.length !== display.highlight.key.length
    )
      return '/display/highlight'
    const expected = JSON.stringify(display.highlight.key)
    if (
      !snapshot.data.rows.some(
        (_, row) =>
          JSON.stringify(
            axis.keys.map((key) => snapshot.frame.coordinates[key.slotId]?.values[row] ?? null),
          ) === expected,
      )
    )
      return '/display/highlight'
  }
  if (display.rowLimit !== undefined && view.chart !== 'hbar') return '/display/rowLimit'
  if (display.recordPreview) {
    if (
      view.chart !== 'table' ||
      view.layout === 'comparison' ||
      classifyFrame(snapshot).class !== 'observation'
    )
      return '/display/recordPreview'
    const { coordinates, values } = display.recordPreview
    const fields = [...coordinates, ...values]
    if (new Set(fields).size !== fields.length) return '/display/recordPreview'
    if (
      coordinates.some(
        (name) =>
          !snapshot.frame.layout.some(
            (entry) => entry.kind === 'coordinate' && entry.name === name && entry.part === 'key',
          ) || !snapshot.data.columns.some((column) => column.id === name),
      ) ||
      values.some((name) => !numericValue(name))
    )
      return '/display/recordPreview'
  }
  if (display.decompositionTotals) {
    if (view.chart !== 'decomposition') return '/display/decompositionTotals'
    const selected = facts?.decompositions[view.decomposition]
    const names = [display.decompositionTotals.current, display.decompositionTotals.baseline]
    if (!selected || names[0] === names[1]) return '/display/decompositionTotals'
    for (const name of names) {
      if (!numericValue(name)) return '/display/decompositionTotals'
      const matching = facts?.decompositions.filter(
        (item) =>
          item.target.kind === 'level' &&
          item.rowScope === selected.rowScope &&
          JSON.stringify(item.groups) === JSON.stringify(selected.groups) &&
          item.outputs.some(
            (output) =>
              output.fieldKind === 'value' && output.role === 'total' && output.name === name,
          ),
      )
      if (matching?.length !== 1) return '/display/decompositionTotals'
    }
  }
  return undefined
}
