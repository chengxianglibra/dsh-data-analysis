import type { ElementNode } from '@openuidev/lang-core'
import type { SelectionSources } from './snapshot-filter.ts'

export interface SelectionWiringIssue {
  source: string
  component: 'Select' | 'CheckBoxGroup'
  statementId?: string
  actual: string
  expected: string
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stateName(value: unknown): string | undefined {
  return record(value) && value.k === 'StateRef' && typeof value.n === 'string'
    ? value.n
    : undefined
}

/** Visit parser-owned expression objects, including nested action arguments. */
function visit(value: unknown, callback: (value: Record<string, unknown>) => void): void {
  const pending: unknown[] = [value]
  const seen = new WeakSet<object>()
  while (pending.length) {
    const item = pending.pop()
    if (!item || typeof item !== 'object' || seen.has(item)) continue
    seen.add(item)
    if (Array.isArray(item)) pending.push(...item)
    else {
      if (!record(item)) continue
      callback(item)
      pending.push(...Object.values(item))
    }
  }
}

/**
 * Find only definite direct mistakes where an official picker consumes a
 * known source's reserved options but writes another state variable. A button
 * can intentionally apply that other variable, so follow explicit @Set chains.
 */
export function findSelectionWiringIssue(
  nodes: readonly ElementNode[],
  sources: SelectionSources | undefined,
): SelectionWiringIssue | undefined {
  const options = new Map(
    Object.keys(sources ?? {}).map((id) => [`$source_${id.length}_${id}_options`, id]),
  )
  if (!options.size) return undefined

  const writes = new Map<string, Set<string>>()
  for (const node of nodes) {
    visit(node.props.action, (action) => {
      if (action.k !== 'Comp' || action.name !== 'Set' || !Array.isArray(action.args)) return
      const target = stateName(action.args[0])
      if (!target) return
      visit(action.args[1], (expression) => {
        const source = stateName(expression)
        if (!source) return
        const targets = writes.get(source) ?? new Set<string>()
        targets.add(target)
        writes.set(source, targets)
      })
    })
  }
  function canWrite(from: string, target: string): boolean {
    const pending = [from]
    const seen = new Set<string>()
    while (pending.length) {
      const state = pending.pop()!
      if (state === target) return true
      if (seen.has(state)) continue
      seen.add(state)
      for (const next of writes.get(state) ?? []) pending.push(next)
    }
    return false
  }

  for (const node of nodes) {
    if (node.typeName !== 'Select' && node.typeName !== 'CheckBoxGroup') continue
    const items = node.props.items
    if (!record(items) || items.k !== 'Comp' || items.name !== 'Each' || !Array.isArray(items.args))
      continue
    const id = options.get(stateName(items.args[0]) ?? '')
    if (!id) continue
    const actual = stateName(node.props.value)
    // Nontrivial bindings can have application-specific actions and cannot be
    // proven incorrect from the input expression alone.
    if (!actual) continue
    const target = `$${id}`
    const draft = `$source_${id.length}_${id}_draft`
    if (canWrite(actual, target)) continue
    return {
      source: id,
      component: node.typeName,
      ...(node.statementId ? { statementId: node.statementId } : {}),
      actual,
      expected:
        node.typeName === 'CheckBoxGroup'
          ? `${target}, or apply ${draft} to ${target} with @Set`
          : `${target}, or apply ${actual} to ${target} with @Set`,
    }
  }
  return undefined
}
