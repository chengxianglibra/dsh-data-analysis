import type { PresentationBlock, PresentationDocument } from '../../presentation/contracts/types.ts'
import { datasetById, selectedSources } from './model.ts'

export type SourceTab = 'overview' | 'preview' | 'code'

export function sourceTabs(hasDataset: boolean): SourceTab[] {
  return hasDataset ? ['overview', 'preview', 'code'] : ['overview', 'code']
}

export function sourceTabForKey(tabs: readonly SourceTab[], current: SourceTab, key: string) {
  if (key === 'Home') return tabs[0]
  if (key === 'End') return tabs.at(-1)
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return undefined
  const offset = key === 'ArrowRight' ? 1 : -1
  return tabs[(tabs.indexOf(current) + offset + tabs.length) % tabs.length]
}

interface CodeEntry {
  key: string
  language: 'python' | 'sql'
  text: string
  authorAssociated: boolean
}

/** Read only the selected cell binding; prepared views are separate, unselected bindings. */
export function sourceCodeFacts(document: PresentationDocument, block?: PresentationBlock) {
  const dataset = block && 'datasetId' in block ? datasetById(document, block.datasetId) : undefined
  const sources = !block
    ? document.sources
    : selectedSources(
        document,
        block.kind === 'source' ? block.sourceIds : (dataset?.sourceIds ?? []),
      )
  const entries: CodeEntry[] = (dataset?.code ?? []).map((snippet) => ({
    language: snippet.language,
    text: snippet.text,
    key: `python-${snippet.executionId}`,
    authorAssociated: true,
  }))
  const notices: string[] = []
  const executions = new Set<string>()
  for (const source of sources) {
    if (source.status === 'unavailable') {
      notices.push(`来源 ${source.id} 不可用：${source.reason}`)
      continue
    }
    for (const snippet of source.code?.snippets ?? []) {
      const key = JSON.stringify([source.ref.sessionId, snippet.runId, snippet.queryId])
      if (executions.has(key)) continue
      executions.add(key)
      entries.push({ key, language: snippet.language, text: snippet.text, authorAssociated: false })
    }
    for (const notice of source.code?.notices ?? []) {
      notices.push(`来源 ${source.id}：${notice}`)
    }
  }
  return { entries, notices: [...new Set(notices)] }
}
