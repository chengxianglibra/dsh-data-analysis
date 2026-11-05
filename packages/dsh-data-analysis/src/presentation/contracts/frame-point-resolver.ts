import { classifyFrame } from './frame-view.ts'
import type { FrameSnapshotV2 } from './snapshot.ts'

/** Share the saved-point admission rules between rendering and authoritative serialization. */
export function createFramePointResolver(snapshot: FrameSnapshotV2) {
  const broadcastValues = classifyFrame(snapshot).broadcastValues
  return (rowIndex: number, field: string) =>
    framePointFacts(snapshot, rowIndex, field, broadcastValues)
}

function framePointFacts(
  snapshot: FrameSnapshotV2,
  rowIndex: number,
  field: string,
  broadcastValues: readonly string[],
) {
  if (broadcastValues.includes(field)) throw new Error('point-unavailable')
  const row = snapshot.data.rows[rowIndex]
  const index = snapshot.data.columns.findIndex((column) => column.id === field)
  if (!row || index < 0 || snapshot.frame.fields[index]?.role !== 'value')
    throw new Error('point-unavailable')
  const column = snapshot.data.columns[index]!
  const value = row[index]
  if (value == null) throw new Error('point-unavailable')
  const isPresent = (name: string) => {
    const i = snapshot.data.columns.findIndex((item) => item.id === name)
    return i >= 0 && snapshot.frame.fields[i]?.role === 'presence' && row[i] === true
  }
  const section = snapshot.frame.sections.interpretation
  let role = 'value'
  let semanticBindings = 0
  const matched: unknown[] = []
  const related: {
    column: (typeof snapshot.data.columns)[number]
    value: string | number | boolean
    role: 'pair_count'
  }[] = []
  if (typeof section === 'object' && section.status === 'captured') {
    const context = section.valueContexts[field]
    if (context) matched.push({ valueContext: context })
    if (context?.kind === 'pair_statistic' && context.statistic !== 'pair_count') {
      const { statistic: _statistic, ...scope } = context
      const candidates = Object.entries(section.valueContexts).filter(([, other]) => {
        if (other?.kind !== 'pair_statistic' || other.statistic !== 'pair_count') return false
        const { statistic: _count, ...otherScope } = other
        return JSON.stringify(scope) === JSON.stringify(otherScope)
      })
      // A coefficient without exactly one same-scope count cannot be interpreted safely.
      if (candidates.length !== 1) throw new Error('point-unavailable')
      const name = candidates[0]![0]
      const countIndex = snapshot.data.columns.findIndex((item) => item.id === name)
      const countValue = row[countIndex]
      if (
        countIndex < 0 ||
        snapshot.frame.fields[countIndex]?.role !== 'value' ||
        !(
          (typeof countValue === 'string' && /^\d+$/.test(countValue)) ||
          (typeof countValue === 'number' && Number.isSafeInteger(countValue) && countValue >= 0)
        )
      )
        throw new Error('point-unavailable')
      related.push({
        column: snapshot.data.columns[countIndex]!,
        value: countValue,
        role: 'pair_count',
      })
    }
    for (const comparison of section.comparisons) {
      for (const group of comparison.groups) {
        for (const item of group.values.filter((entry) => entry.name === field)) {
          if (++semanticBindings > 1) throw new Error('point-unavailable')
          role = item.role
          const presence = comparison.presence
          if (presence) {
            const required = [
              ...presence.enclosing,
              ...(item.role !== 'baseline' ? [presence.current] : []),
              ...(item.role !== 'current' ? [presence.baseline] : []),
            ]
            if (required.some((name) => !isPresent(name))) throw new Error('point-unavailable')
          }
          matched.push({ comparison, group: group.name })
        }
      }
    }
    for (const alignment of section.alignments) {
      for (const side of ['left', 'right'] as const) {
        const item = alignment[side]
        if (!item.values.includes(field)) continue
        if (++semanticBindings > 1) throw new Error('point-unavailable')
        if (item.presence.some((name) => !isPresent(name))) throw new Error('point-unavailable')
        role = side
        matched.push({ alignment, side })
      }
    }
    for (const decomposition of section.decompositions) {
      for (const output of decomposition.outputs.filter((item) => item.name === field)) {
        if (++semanticBindings > 1 || output.fieldKind !== 'value')
          throw new Error('point-unavailable')
        // A total is a parent/group fact, not the first detail row under it.
        if (output.role === 'total' || output.role === 'observed_total')
          throw new Error('point-unavailable')
        // Do not assign a row scope to numerator/denominator/count detail fields until
        // their association with the saved presence metadata is explicitly resolved.
        if (
          ![
            'value',
            'current',
            'baseline',
            'absolute',
            'contribution',
            'share',
            'effect_within',
            'effect_mix',
            'effect_entry_exit',
            'effect_additive',
          ].includes(output.role)
        )
          throw new Error('point-unavailable')
        const required =
          output.role === 'value'
            ? ['value_present']
            : output.role === 'current'
              ? ['current_present']
              : output.role === 'baseline'
                ? ['baseline_present']
                : output.role === 'absolute'
                  ? ['current_present', 'baseline_present']
                  : []
        for (const presenceRole of required) {
          const bindings = decomposition.outputs.filter(
            (item) => item.fieldKind === 'presence' && item.role === presenceRole,
          )
          if (bindings.length !== 1 || !isPresent(bindings[0]!.name))
            throw new Error('point-unavailable')
        }
        role = output.role
        matched.push({ decomposition })
      }
    }
  }
  return { row, index, column, value, role, matched, related, section }
}
