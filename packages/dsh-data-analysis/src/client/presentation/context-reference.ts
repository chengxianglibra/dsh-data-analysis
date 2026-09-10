/** Cell locators and unsaved display state; saved report content is read on demand. */
import { presentationAssetRelativePath } from '../../presentation/contracts/asset-path.ts'
import { defaultSelection, selectedSlice } from '../../presentation/contracts/interaction.ts'
import type { PresentationBlock, PresentationDocument } from '../../presentation/contracts/types.ts'
import { type ChartExploration, savedChartView } from './chart-view.ts'
import type { TableSort } from './export-view.ts'

export const PRESENTATION_CONTEXT_BYTES = 12 * 1024

export interface PresentationContext {
  label: string
  context: string
}

/** Display only; the context retains the exact Cell ID, even for duplicate labels. */
export function presentationCellLabel(block: PresentationBlock): string {
  return ('label' in block && shortLabel(block.label)) || shortLabel(block.id)
}

export function wrapPresentationContext(context: string, separator = ''): string {
  const text = `${separator}【报告上下文】\n${context}\n【报告上下文结束】`
  if (new TextEncoder().encode(text).length > PRESENTATION_CONTEXT_BYTES)
    throw new Error('marivo.presentation.report-reference-exceeds-12-kib-and-cannot-preserve-full')
  return text
}

function shortLabel(text: string): string {
  const points = Array.from(text.replace(/\s+/gu, ' ').trim())
  return points.length > 80 ? `${points.slice(0, 79).join('')}…` : points.join('')
}

/** Compare JSON objects independently of key insertion order; array order is meaningful. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`
  return JSON.stringify(value)
}

export function followUpContext(
  document: PresentationDocument,
  block: PresentationBlock,
  exploration?: ChartExploration,
  selection?: Record<string, string>,
  tableSort?: TableSort,
): string {
  const lines = [
    `Report title: ${shortLabel(document.title)}`,
    `Workspace: ${JSON.stringify(document.workspaceId)}`,
    `Report ID: ${document.reportId}`,
    `Build ID: ${document.buildId}`,
    `Cell: ${JSON.stringify(block.id)}`,
    `Block kind: ${block.kind}`,
    ...('label' in block ? [`Cell label: ${shortLabel(block.label)}`] : []),
    `Report file (relative to this Workspace): ${presentationAssetRelativePath(document.reportId, document.buildId, 'presentation.json')}`,
    '读取此固定 Build 的报告文件，按 blocks[].id 定位 Cell；数据、正文、绑定和来源均从该文件读取。',
  ]
  const interaction = document.interaction
  if (interaction?.blockIds.includes(block.id) && 'datasetId' in block) {
    const chosen = selection ?? defaultSelection(interaction)
    selectedSlice(interaction, chosen)
    const filters = interaction.filters.map((filter) => {
      const option = filter.options.find((entry) => entry.id === chosen[filter.id])
      if (!option) throw new Error('Unknown presentation filter option.')
      return {
        filterId: filter.id,
        optionId: option.id,
        label: `${shortLabel(filter.label)}：${shortLabel(option.label)}`,
      }
    })
    lines.push(
      `Filters: ${JSON.stringify(filters)}`,
      '筛选数据按此 Build 的 interaction.slices 查找，不重新计算。',
    )
  }
  if (block.kind === 'chart' && exploration) {
    const prepared = exploration.preparedViewId
      ? block.preparedViews?.find((view) => view.id === exploration.preparedViewId)
      : undefined
    if (exploration.preparedViewId && !prepared) throw new Error('Unknown prepared chart view.')
    const base = prepared ? savedChartView({ ...prepared, kind: 'chart' }) : savedChartView(block)
    const changed = canonical(base) !== canonical(exploration.view)
    if (prepared || changed || exploration.hidden.length) {
      lines.push('Chart state: unsaved page-local display; saved report is unchanged.')
      if (prepared) lines.push(`Prepared view: ${JSON.stringify(prepared.id)}`)
      if (changed) lines.push(`Current chart view override: ${JSON.stringify(exploration.view)}`)
      if (exploration.hidden.length)
        lines.push(`Hidden series: ${JSON.stringify(exploration.hidden)}`)
    }
  }
  if (block.kind === 'table') {
    lines.push('Table scope: all filtered rows, not only the visible page.')
    if (tableSort) lines.push(`Table sort: ${JSON.stringify(tableSort)}`)
  }
  const context = lines.join('\n')
  // Reserve the maximum Host append separator, including for offline copies.
  wrapPresentationContext(context, '\n\n')
  return context
}
