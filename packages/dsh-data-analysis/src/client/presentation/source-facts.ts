import type { SourceSnapshot } from '../../presentation/contracts/types.ts'

interface SemanticGroup {
  kind: string
  paths: string[]
}

/** Read only the fields already projected into the saved source snapshot. */
export function sourceOverviewFacts(source: SourceSnapshot) {
  const semanticGroups: SemanticGroup[] = []
  const issues: { kind: string; severity?: string }[] = []
  const notices: string[] = []
  let createdAt: string | undefined
  if (source.status === 'available') {
    for (const fact of source.facts) {
      if (fact.label === '创建时间' && fact.value.trim()) createdAt = fact.value
      if (fact.label === '选择的 Finding unavailable' && fact.value.trim()) notices.push(fact.value)
      if (fact.label !== '公开语义引用' && fact.label !== 'Issues') continue
      let entries: unknown
      try {
        entries = JSON.parse(fact.value)
      } catch {
        continue
      }
      if (!Array.isArray(entries)) continue
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
        if (fact.label === '公开语义引用') {
          if (typeof entry.path !== 'string' || !entry.path.trim()) continue
          const kind = typeof entry.kind === 'string' ? entry.kind : ''
          let group = semanticGroups.find((candidate) => candidate.kind === kind)
          if (!group) {
            group = { kind, paths: [] }
            semanticGroups.push(group)
          }
          if (!group.paths.includes(entry.path)) group.paths.push(entry.path)
        } else if (typeof entry.kind === 'string' && entry.kind.trim()) {
          const severity = typeof entry.severity === 'string' ? entry.severity : undefined
          if (!issues.some((issue) => issue.kind === entry.kind && issue.severity === severity))
            issues.push({ kind: entry.kind, severity })
        }
      }
    }
  }
  return { createdAt, semanticGroups, issues, notices }
}

export function semanticKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    metric: '指标',
    dimension: '维度',
    time_dimension: '时间维度',
  }
  return Object.hasOwn(labels, kind) ? labels[kind]! : kind || '语义对象'
}
