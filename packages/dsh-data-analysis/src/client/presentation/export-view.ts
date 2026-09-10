import { PRESENTATION_BUDGETS } from '../../presentation/contracts/index.ts'
import { filterSummary, interactionRows } from '../../presentation/contracts/interaction.ts'
import type { PresentationDocument } from '../../presentation/contracts/types.ts'
import { type ChartExploration, exploredChartBlock } from './chart-view.ts'
import {
  cellText,
  columnIndex,
  columnLabel,
  datasetById,
  snapshotDate,
  sortedRowIndices,
} from './model.ts'
import { semanticKindLabel, sourceOverviewFacts } from './source-facts.ts'
import { PRESENTATION_STYLES } from './styles.ts'

export interface TableSort {
  columnId: string
  direction: 'ascending' | 'descending'
}

export interface CurrentViewState {
  selection: Record<string, string>
  explorations: Record<string, ChartExploration>
  tableSorts: Record<string, TableSort | undefined>
}

/** Resolve only existing rows. Sorting never changes values or precomputed chart semantics. */
export function currentViewBlocks(document: PresentationDocument, state: CurrentViewState) {
  return document.blocks.map((saved) => {
    const block =
      saved.kind === 'chart'
        ? exploredChartBlock(
            saved,
            Object.hasOwn(state.explorations, saved.id) ? state.explorations[saved.id] : undefined,
          )
        : saved
    if (!('datasetId' in block)) return { block }
    const dataset = datasetById(document, block.datasetId)
    const selected = interactionRows(document.interaction, state.selection, block)
    const selection = selected ? new Set(selected) : undefined
    const sort =
      block.kind === 'table' && Object.hasOwn(state.tableSorts, block.id)
        ? state.tableSorts[block.id]
        : undefined
    const rowIndices = sort
      ? sortedRowIndices(dataset.data, sort).filter((index) => !selection || selection.has(index))
      : [...(selected ?? dataset.data.rows.map((_, index) => index))]
    return { block, dataset, rowIndices, sort }
  })
}

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

/** Freeze rendered SVGs synchronously; no query, saved-document rewrite or hidden dataset payload. */
export function exportCurrentView(
  root: HTMLElement,
  document: PresentationDocument,
  state: CurrentViewState,
  exportedAt = new Date().toISOString(),
) {
  const owner = root.ownerDocument
  const article = root.cloneNode(true) as HTMLElement
  const appendText = (parent: Element, tag: string, text: string, className?: string) => {
    const element = owner.createElement(tag)
    element.textContent = text
    if (className) element.className = className
    parent.append(element)
    return element
  }
  // Preserve series keys as text, including the explicit hidden-series indication.
  for (const legend of article.querySelectorAll('.pr-legend')) {
    legend.classList.remove('pr-interactive')
    for (const button of legend.querySelectorAll('button')) {
      const label = owner.createElement('span')
      label.className = 'pr-export-series'
      label.append(...button.childNodes)
      if (button.getAttribute('aria-pressed') === 'false') {
        label.classList.add('pr-export-series-hidden')
        label.append('（已隐藏）')
      }
      button.replaceWith(label)
    }
  }
  article
    .querySelectorAll(
      '.pr-interactive,dialog,.pr-dialog,.pr-tooltip,.pr-special-tooltip,.recharts-tooltip-wrapper,.recharts-tooltip-cursor,.recharts-active-dot',
    )
    .forEach((element) => {
      element.remove()
    })
  const resolved = currentViewBlocks(document, state)
  const sections = new Map(
    [...article.querySelectorAll<HTMLElement>('[data-block-id]')].map((section) => [
      section.dataset.blockId,
      section,
    ]),
  )
  for (const { block, dataset, rowIndices, sort } of resolved) {
    const section = sections.get(block.id)
    if (!section) throw new Error('当前视图尚未完整显示，请稍后重试。')
    if (block.kind === 'table' && dataset && rowIndices) {
      const table = section.querySelector('table')
      if (!table) throw new Error('当前表格尚未完整显示，请稍后重试。')
      const columns = (block.columns ?? dataset.data.columns.map((column) => column.id)).map((id) =>
        columnIndex(dataset.data, id),
      )
      const body = owner.createElement('tbody')
      for (const index of rowIndices) {
        const row = owner.createElement('tr')
        row.dataset.rowIndex = String(index)
        for (const position of columns) {
          const column = dataset.data.columns[position]!
          const value = dataset.data.rows[index]![position]!
          const cell = appendText(row, 'td', cellText(value, column))
          cell.dataset.columnId = column.id
          if (['float64', 'int64', 'decimal'].includes(column.type)) cell.className = 'pr-numeric'
          if (value === null) {
            cell.dataset.cellNull = 'true'
            cell.setAttribute('aria-label', '缺失值')
          }
          if (value === '') cell.setAttribute('aria-label', '空字符串')
        }
        body.append(row)
      }
      table.querySelector('tbody')?.replaceWith(body)
      for (const th of table.querySelectorAll('th')) {
        const column = dataset.data.columns[columnIndex(dataset.data, th.dataset.columnId!)]!
        th.textContent = columnLabel(column)
      }
      appendText(
        section,
        'p',
        `当前筛选结果：${rowIndices.length} 行（包含全部分页）${sort ? ` · 按 ${columnLabel(dataset.data.columns[columnIndex(dataset.data, sort.columnId)]!)} ${sort.direction === 'ascending' ? '升序' : '降序'}` : ''}`,
        'pr-muted',
      )
    }
    if (block.kind === 'chart') {
      // Recharts needs measured containers; never silently omit an unfinished unit panel.
      for (const container of section.querySelectorAll('.recharts-responsive-container')) {
        const svg = container.querySelector('svg.recharts-surface')
        if (!svg) throw new Error('图表仍在排版，请稍后重试导出。')
        const frame = owner.createElement('div')
        frame.className = 'pr-export-chart'
        frame.append(svg)
        container.replaceWith(frame)
      }
    }
    // Only a compact, saved source overview; execution code and arbitrary raw source payloads stay out.
    // Source cells already contain the same compact list in their cloned body.
    const sourceIds = block.kind === 'source' ? [] : (dataset?.sourceIds ?? [])
    if (sourceIds.length) {
      const details = owner.createElement('details')
      details.className = 'pr-source-summary'
      appendText(details, 'summary', '数据来源')
      for (const id of sourceIds) {
        const source = document.sources.find((entry) => entry.id === id)!
        const facts = sourceOverviewFacts(source)
        const card = owner.createElement('section')
        card.dataset.sourceId = id
        appendText(
          card,
          'h3',
          source.status === 'available' && source.label.trim()
            ? source.label
            : source.ref.artifactRef,
        )
        if (source.status === 'unavailable') appendText(card, 'p', source.reason, 'pr-notice')
        if (facts.createdAt)
          appendText(
            card,
            'p',
            `来源创建时间：${Number.isNaN(Date.parse(facts.createdAt)) ? facts.createdAt : snapshotDate(facts.createdAt)}`,
            'pr-muted',
          )
        for (const group of facts.semanticGroups)
          appendText(card, 'p', `${semanticKindLabel(group.kind)}：${group.paths.join('、')}`)
        for (const issue of facts.issues)
          appendText(
            card,
            'p',
            `${issue.kind}${issue.severity ? ` · ${issue.severity}` : ''}`,
            'pr-notice',
          )
        for (const notice of facts.notices) appendText(card, 'p', notice, 'pr-notice')
        if (!card.childNodes.length)
          appendText(card, 'p', '沿用来源 Build 的已保存数据。', 'pr-muted')
        details.append(card)
      }
      section.append(details)
    }
  }
  for (const empty of article.querySelectorAll('.pr-empty')) {
    if (empty.textContent === '所有系列已隐藏，请选择要显示的系列。')
      empty.textContent = '导出时所有系列均已隐藏。'
  }
  if (!document.blocks.length) {
    const empty = article.querySelector('.pr-empty')
    if (empty) empty.textContent = '此视图没有展示内容。'
  }
  const metadata = owner.createElement('div')
  metadata.className = 'pr-export-metadata pr-muted'
  appendText(metadata, 'p', '当前视图 · 已固定筛选与展示配置')
  appendText(
    metadata,
    'p',
    document.interaction ? filterSummary(document.interaction, state.selection) : '筛选条件：无',
  )
  appendText(metadata, 'p', `来源 Build：${document.buildId}`)
  const time = appendText(metadata, 'p', '导出时间：')
  const timestamp = appendText(time, 'time', snapshotDate(exportedAt))
  timestamp.setAttribute('datetime', exportedAt)
  article.querySelector('.pr-header')!.append(metadata)
  const interactionHelp = article.querySelector('.pr-interaction-header > .pr-muted')
  if (interactionHelp)
    interactionHelp.textContent = '以下指标、图表与表格已固定为导出时的筛选结果。'
  // DOM comes exclusively from the typed reader, still strip all active/host-only surfaces.
  article
    .querySelectorAll(
      'script,style,iframe,object,embed,link,meta,form,input,select,textarea,foreignObject,image',
    )
    .forEach((element) => {
      element.remove()
    })
  for (const button of article.querySelectorAll('button')) button.replaceWith(...button.childNodes)
  for (const element of [article, ...article.querySelectorAll('*')]) {
    for (const attribute of [...element.attributes]) {
      if (
        /^on/i.test(attribute.name) ||
        ['tabindex', 'contenteditable', 'autofocus', 'src', 'srcset'].includes(attribute.name)
      )
        element.removeAttribute(attribute.name)
      if (
        ['href', 'xlink:href'].includes(attribute.name) &&
        !/^(https?:|mailto:|#)/i.test(attribute.value)
      )
        element.removeAttribute(attribute.name)
    }
  }
  article.setAttribute('data-export-view', 'true')
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escapeHtml(document.title)} · 当前视图</title><style>${PRESENTATION_STYLES}
body{margin:0}.pr-export-chart{max-width:100%;overflow:auto;height:100%}.pr-export-chart svg{display:block;flex-shrink:0}.pr-export-series{display:inline-flex;align-items:center;gap:7px;font-size:12px;padding:4px 0}.pr-export-series-hidden{opacity:.5;text-decoration:line-through}.pr-export-metadata{overflow-wrap:anywhere}.pr-reader[data-export-view] .pr-block-table{padding-top:0}
</style></head><body>${article.outerHTML}</body></html>`
  const bytes = new TextEncoder().encode(html)
  if (bytes.length > PRESENTATION_BUDGETS.htmlBytes)
    throw new Error('当前视图超过 HTML 导出大小限制，请缩小筛选范围后重试。')
  const safeId = (value: string) => value.replace(/[^\p{L}\p{N}._-]/gu, '_').slice(0, 80)
  return {
    bytes,
    filename: `marivo-${safeId(document.reportId)}-${safeId(document.buildId)}-view-${safeId(exportedAt)}.html`,
  }
}
