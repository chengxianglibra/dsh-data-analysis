import { createHash } from 'node:crypto'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { CompiledDagComponent, CompiledDagNode } from './dag.ts'
import type { ReportBlockV2 } from './document.ts'
import type { ReportArtifactColumn, ReportDagJobProjection } from './projection.ts'
import { reportTimeEpoch } from './time.ts'
import type { CompiledChartBlock, CompiledReport, CompiledTableBlock } from './visual.ts'

export const REPORT_RENDERER_VERSION = 'dsh-data-analysis-html/v9' as const

const DAG_SCRIPT = `(()=>{"use strict";const roots=[...document.querySelectorAll("[data-dag-component]")];const activate=(root,id)=>{for(const item of root.querySelectorAll("[data-dag-detail]")){const active=item.id===id;item.dataset.active=String(active);item.setAttribute("aria-hidden",String(!active))}for(const item of root.querySelectorAll("[data-dag-node]")){item.dataset.selected=String(item.getAttribute("href")==="#"+id)}};for(const root of roots){root.classList.add("dag-enhanced");const svg=root.querySelector("[data-dag-canvas]");const viewport=root.querySelector("[data-dag-viewport]");if(!svg||!viewport)continue;let scale=1,tx=0,ty=0,drag=null;const apply=()=>viewport.setAttribute("transform","translate("+tx+" "+ty+") scale("+scale+")");const reset=()=>{scale=1;tx=0;ty=0;apply()};for(const link of root.querySelectorAll("[data-dag-node]")){link.addEventListener("click",event=>{event.preventDefault();const id=link.getAttribute("href").slice(1);activate(root,id);history.replaceState(null,"","#"+encodeURIComponent(id))})}for(const button of root.querySelectorAll("[data-dag-action]")){button.addEventListener("click",()=>{const action=button.dataset.dagAction;if(action==="reset")reset();else{scale=Math.min(2.5,Math.max(.45,scale*(action==="zoom-in"?1.2:.8)));apply()}})}svg.addEventListener("wheel",event=>{event.preventDefault();scale=Math.min(2.5,Math.max(.45,scale*(event.deltaY<0?1.1:.9)));apply()},{passive:false});svg.addEventListener("pointerdown",event=>{if(event.target.closest("[data-dag-node]"))return;drag={x:event.clientX,y:event.clientY,tx,ty};svg.setPointerCapture(event.pointerId)});svg.addEventListener("pointermove",event=>{if(!drag)return;tx=drag.tx+(event.clientX-drag.x)/scale;ty=drag.ty+(event.clientY-drag.y)/scale;apply()});const stop=event=>{drag=null;if(svg.hasPointerCapture(event.pointerId))svg.releasePointerCapture(event.pointerId)};svg.addEventListener("pointerup",stop);svg.addEventListener("pointercancel",stop);const hash=decodeURIComponent(location.hash.slice(1));const initial=root.querySelector(hash?"#"+CSS.escape(hash):"[data-dag-detail]");if(initial)activate(root,initial.id)}addEventListener("hashchange",()=>{const id=decodeURIComponent(location.hash.slice(1));for(const root of roots)if(root.querySelector("#"+CSS.escape(id)))activate(root,id)})})();`

function contentSecurityPolicy(): string {
  const scriptHash = createHash('sha256').update(DAG_SCRIPT).digest('base64')
  const styleHash = createHash('sha256').update(CSS).digest('base64')
  return `default-src 'none'; style-src 'sha256-${styleHash}'; img-src data:; font-src 'none'; script-src 'sha256-${scriptHash}'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`
}

const COPY = {
  'zh-CN': {
    report: '分析报告',
    generated: '生成于',
    dataTable: '查看同源数据表',
    displayed: '显示',
    total: '总计',
    omitted: '省略',
    rows: '行',
    categories: '个类别',
    points: '个数据点',
    freshness: 'Artifact admissible 仅表示当前语义权威可接受，不等于 datasource fresh。',
    range: '范围',
    audit: '审计字段',
    contract: '公共契约',
    lineage: 'Lineage',
    inventory: '完整技术溯源',
    focused: '纵轴聚焦于数据区间',
    artifacts: '数据工件',
    actions: '分析动作',
    artifactPreview: '数据预览',
    graphEmpty: '当前 Session 没有符合条件的成功主产物分析动作或 Artifact。',
    component: '分析链路',
  },
  'en-US': {
    report: 'Analysis report',
    generated: 'Generated',
    dataTable: 'View source data table',
    displayed: 'Displayed',
    total: 'total',
    omitted: 'omitted',
    rows: 'rows',
    categories: 'categories',
    points: 'data points',
    freshness:
      'Artifact admissible means the current semantic authority is acceptable; it does not mean datasource fresh.',
    range: 'Range',
    audit: 'Audit fields',
    contract: 'Public contract',
    lineage: 'Lineage',
    inventory: 'Complete technical provenance',
    focused: 'Focused value scale',
    artifacts: 'Data artifacts',
    actions: 'Analysis actions',
    artifactPreview: 'Data preview',
    graphEmpty: 'This Session has no eligible successful main-Artifact actions or Artifacts.',
    component: 'Analysis chain',
  },
} as const

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function scalar(value: JsonValue): string {
  if (value === null) return '—'
  if (typeof value === 'number') return Object.is(value, -0) ? '0' : String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function pretty(value: JsonValue): string {
  return JSON.stringify(value, undefined, 2)
}

function numberLabel(value: number, locale: 'zh-CN' | 'en-US'): string {
  if (value === 0) return '0'
  const absolute = Math.abs(value)
  if (absolute >= 10_000) {
    return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(
      value,
    )
  }
  if (absolute < 0.001) return value.toExponential(2)
  return new Intl.NumberFormat(locale, { maximumSignificantDigits: 4 }).format(value)
}

function textBlock(text: string): string {
  const chunks = text
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
  const html: string[] = []
  for (let index = 0; index < chunks.length; ) {
    const ordered = chunks[index]?.match(/^\s*\d+[.)、]\s+([\s\S]+)$/)
    const unordered = chunks[index]?.match(/^\s*[-*•]\s+([\s\S]+)$/)
    if (ordered !== null && ordered !== undefined) {
      const items: string[] = []
      while (index < chunks.length) {
        const match = chunks[index]?.match(/^\s*\d+[.)、]\s+([\s\S]+)$/)
        if (match === null || match === undefined) break
        items.push(`<li>${escapeHtml(match[1] ?? '').replaceAll('\n', '<br>')}</li>`)
        index += 1
      }
      html.push(`<ol>${items.join('')}</ol>`)
      continue
    }
    if (unordered !== null && unordered !== undefined) {
      const items: string[] = []
      while (index < chunks.length) {
        const match = chunks[index]?.match(/^\s*[-*•]\s+([\s\S]+)$/)
        if (match === null || match === undefined) break
        items.push(`<li>${escapeHtml(match[1] ?? '').replaceAll('\n', '<br>')}</li>`)
        index += 1
      }
      html.push(`<ul>${items.join('')}</ul>`)
      continue
    }
    html.push(`<p>${escapeHtml(chunks[index] ?? '').replaceAll('\n', '<br>')}</p>`)
    index += 1
  }
  return html.join('')
}

const ZH_COLUMN_LABELS: Readonly<Record<string, string>> = Object.freeze({
  bucket_start: '日期',
  current: '本期',
  baseline: '对比期',
  delta: '变化量',
  pct_change: '变化率',
  cluster: '集群',
  query_count: '查询量',
  contribution: '贡献量',
  share_of_total_delta: '变化贡献占比',
  elapsed_time_p90: 'P90 耗时',
  value: '数值',
  date: '日期',
  time: '时间',
  category: '类别',
})

function columnLabel(name: string, locale: 'zh-CN' | 'en-US'): string {
  if (locale === 'zh-CN' && ZH_COLUMN_LABELS[name] !== undefined) return ZH_COLUMN_LABELS[name]
  return name.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}

function dateLabel(value: string, locale: 'zh-CN' | 'en-US'): string | undefined {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/)
  if (match === null) return undefined
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!Number.isSafeInteger(year) || !Number.isSafeInteger(month) || !Number.isSafeInteger(day))
    return undefined
  const date = new Date(Date.UTC(year, month - 1, day))
  const base =
    locale === 'zh-CN'
      ? `${month}月${day}日`
      : new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
          date,
        )
  if (match[4] === undefined || match[5] === undefined || (match[4] === '00' && match[5] === '00'))
    return base
  return `${base} ${match[4]}:${match[5]}`
}

function cellLabel(
  value: JsonValue,
  column: ReportArtifactColumn,
  locale: 'zh-CN' | 'en-US',
): string {
  if (value === null) return '—'
  if (typeof value === 'string') {
    if (column.role === 'time') return dateLabel(value, locale) ?? value
    return value
  }
  if (typeof value === 'number') {
    const unit = column.unit?.toLowerCase() ?? ''
    if (/percent|percentage|pct/.test(unit)) {
      const percent = Math.abs(value) <= 1 ? value * 100 : value
      return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(percent)}%`
    }
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(value)
  }
  if (typeof value === 'boolean')
    return locale === 'zh-CN' ? (value ? '是' : '否') : value ? 'Yes' : 'No'
  return JSON.stringify(value)
}

function tableHtml(
  caption: string,
  columns: readonly ReportArtifactColumn[],
  rows: readonly (readonly JsonValue[])[],
  locale: 'zh-CN' | 'en-US',
): string {
  const head = columns
    .map(
      (column) =>
        `<th scope="col">${escapeHtml(columnLabel(column.name, locale))}${column.unit === null ? '' : `<span class="column-unit">${escapeHtml(column.unit)}</span>`}</th>`,
    )
    .join('')
  const body = rows
    .map(
      (row) =>
        `<tr>${row.map((cell, index) => `<td>${escapeHtml(cellLabel(cell, columns[index]!, locale))}</td>`).join('')}</tr>`,
    )
    .join('')
  return `<div class="table-scroll"><table><caption>${escapeHtml(caption)}</caption><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
}

function artifactAnchor(report: CompiledReport, ref: string): string {
  for (const component of report.sessionDag.components) {
    const node = component.nodes.find((item) => item.artifact?.ref === ref)
    if (node !== undefined) return node.detailId
  }
  return 'report-provenance'
}

function chartContext(chart: CompiledChartBlock, report: CompiledReport): string {
  const copy = COPY[report.document.locale]
  const ys = chart.points.map((point) => point.y)
  const yRange = `${numberLabel(Math.min(...ys), report.document.locale)} – ${numberLabel(Math.max(...ys), report.document.locale)}`
  const xRange =
    chart.view === 'line'
      ? ` · ${dateLabel(String(chart.points[0]?.x ?? ''), report.document.locale) ?? scalar(chart.points[0]?.x ?? null)} – ${dateLabel(String(chart.points.at(-1)?.x ?? ''), report.document.locale) ?? scalar(chart.points.at(-1)?.x ?? null)}`
      : ''
  const unit = chart.artifact.columns.find((column) => column.name === chart.y)?.unit
  const countLabel = chart.view === 'line' ? copy.points : copy.categories
  const scale = chart.view === 'line' ? ` · ${copy.focused}` : ''
  const mechanical = `${chart.points.length} ${countLabel}${xRange} · ${copy.range}: ${yRange}${unit === undefined || unit === null ? '' : ` ${unit}`}${scale}`
  return chart.block.subtitle === undefined ? mechanical : `${chart.block.subtitle} · ${mechanical}`
}

function svgLine(chart: CompiledChartBlock, report: CompiledReport): string {
  const locale = report.document.locale
  const width = 960
  const height = 360
  const left = 72
  const right = 54
  const top = 28
  const bottom = 66
  const plotWidth = width - left - right
  const plotHeight = height - top - bottom
  const ys = chart.points.map((point) => point.y)
  const dataMin = Math.min(...ys)
  const dataMax = Math.max(...ys)
  const spread = dataMax - dataMin || Math.max(Math.abs(dataMax) * 0.1, 1)
  let yMin = dataMin - spread * 0.1
  let yMax = dataMax + spread * 0.1
  if (dataMin >= 0 && yMin < 0) yMin = 0
  if (dataMax <= 0 && yMax > 0) yMax = 0
  const rawX = chart.points.map((point) => {
    if (typeof point.x === 'number') return point.x
    return reportTimeEpoch(point.x) ?? Number.NaN
  })
  const numericX = rawX.every(Number.isFinite)
  let xMin = numericX ? Math.min(...rawX) : 0
  let xMax = numericX ? Math.max(...rawX) : Math.max(chart.points.length - 1, 1)
  if (xMin === xMax) {
    xMin -= 1
    xMax += 1
  }
  const xPosition = (index: number) =>
    left + ((((numericX ? rawX[index] : index) ?? 0) - xMin) / (xMax - xMin)) * plotWidth
  const yPosition = (value: number) => top + ((yMax - value) / (yMax - yMin)) * plotHeight
  const ticks = Array.from({ length: 5 }, (_item, index) => yMin + ((yMax - yMin) * index) / 4)
  const grid = ticks
    .map((value, index) => {
      const y = yPosition(value)
      return `<line class="grid${index === 0 ? ' grid-anchor' : ''}" x1="${left}" y1="${y.toFixed(2)}" x2="${width - right}" y2="${y.toFixed(2)}"/><text class="tick" x="${left - 10}" y="${(y + 4).toFixed(2)}" text-anchor="end">${escapeHtml(numberLabel(value, locale))}</text>`
    })
    .join('')
  const path = chart.points
    .map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'} ${xPosition(index).toFixed(2)} ${yPosition(point.y).toFixed(2)}`,
    )
    .join(' ')
  const markers = chart.points
    .map(
      (point, index) =>
        `<circle cx="${xPosition(index).toFixed(2)}" cy="${yPosition(point.y).toFixed(2)}" r="3"><title>${escapeHtml(`${dateLabel(String(point.x), locale) ?? scalar(point.x)}: ${numberLabel(point.y, locale)}`)}</title></circle>`,
    )
    .join('')
  const labelIndexes = [
    ...new Set([0, Math.floor((chart.points.length - 1) / 2), chart.points.length - 1]),
  ]
  const xLabels = labelIndexes
    .map((index) => {
      const raw = chart.points[index]?.x ?? ''
      return `<text class="tick" x="${xPosition(index).toFixed(2)}" y="${height - 32}" text-anchor="middle">${escapeHtml(dateLabel(String(raw), locale) ?? scalar(raw))}</text>`
    })
    .join('')
  const last = chart.points.at(-1)!
  const lastIndex = chart.points.length - 1
  const endpoint = `<text class="endpoint-label" x="${(xPosition(lastIndex) - 8).toFixed(2)}" y="${(yPosition(last.y) - 10).toFixed(2)}" text-anchor="end">${escapeHtml(numberLabel(last.y, locale))}</text>`
  const description =
    locale === 'zh-CN'
      ? `${columnLabel(chart.y, locale)}随${columnLabel(chart.x, locale)}变化，共 ${chart.points.length} 个数据点；纵轴聚焦于数据区间。`
      : `${columnLabel(chart.y, locale)} by ${columnLabel(chart.x, locale)} with ${chart.points.length} data points; the value axis is focused on the data range.`
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${escapeHtml(chart.block.id)}-title ${escapeHtml(chart.block.id)}-desc"><title id="${escapeHtml(chart.block.id)}-title">${escapeHtml(chart.block.title)}</title><desc id="${escapeHtml(chart.block.id)}-desc">${escapeHtml(description)}</desc>${grid}<line class="axis" x1="${left}" y1="${top}" x2="${left}" y2="${height - bottom}"/><path class="line-series" d="${path}"/>${markers}${endpoint}${xLabels}<text class="axis-label" x="18" y="${height / 2}" text-anchor="middle" transform="rotate(-90 18 ${height / 2})">${escapeHtml(columnLabel(chart.y, locale))}</text></svg>`
}

function verticalBar(chart: CompiledChartBlock, report: CompiledReport): string {
  const locale = report.document.locale
  const width = 960
  const height = 380
  const left = 72
  const right = 32
  const top = 28
  const bottom = 94
  const plotWidth = width - left - right
  const plotHeight = height - top - bottom
  const ys = chart.points.map((point) => point.y)
  let yMin = Math.min(0, ...ys)
  let yMax = Math.max(0, ...ys)
  if (yMin === yMax) {
    yMin -= 1
    yMax += 1
  }
  const yPosition = (value: number) => top + ((yMax - value) / (yMax - yMin)) * plotHeight
  const baseline = yPosition(0)
  const band = plotWidth / Math.max(chart.points.length, 1)
  const bars = chart.points
    .map((point, index) => {
      const x = left + index * band + band * 0.12
      const y = Math.min(yPosition(point.y), baseline)
      const barHeight = Math.max(Math.abs(yPosition(point.y) - baseline), 1)
      const labelY = point.y >= 0 ? y - 7 : y + barHeight + 16
      return `<g><rect class="bar-series" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(band * 0.76).toFixed(2)}" height="${barHeight.toFixed(2)}"><title>${escapeHtml(`${scalar(point.x)}: ${numberLabel(point.y, locale)}`)}</title></rect><text class="value-label" x="${(x + band * 0.38).toFixed(2)}" y="${labelY.toFixed(2)}" text-anchor="middle">${escapeHtml(numberLabel(point.y, locale))}</text><text class="tick category-label" x="${(x + band * 0.38).toFixed(2)}" y="${height - bottom + 20}" text-anchor="end" transform="rotate(-35 ${(x + band * 0.38).toFixed(2)} ${height - bottom + 20})">${escapeHtml(scalar(point.x))}</text></g>`
    })
    .join('')
  const description =
    locale === 'zh-CN'
      ? `${columnLabel(chart.y, locale)}按${columnLabel(chart.x, locale)}比较，共 ${chart.points.length} 个类别；数值轴包含零。`
      : `${columnLabel(chart.y, locale)} by ${columnLabel(chart.x, locale)} with ${chart.points.length} categories; the value axis includes zero.`
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${escapeHtml(chart.block.id)}-title ${escapeHtml(chart.block.id)}-desc"><title id="${escapeHtml(chart.block.id)}-title">${escapeHtml(chart.block.title)}</title><desc id="${escapeHtml(chart.block.id)}-desc">${escapeHtml(description)}</desc><line class="grid grid-anchor" x1="${left}" y1="${baseline.toFixed(2)}" x2="${width - right}" y2="${baseline.toFixed(2)}"/><line class="axis" x1="${left}" y1="${top}" x2="${left}" y2="${height - bottom}"/>${bars}<text class="axis-label" x="18" y="${height / 2}" text-anchor="middle" transform="rotate(-90 18 ${height / 2})">${escapeHtml(columnLabel(chart.y, locale))}</text></svg>`
}

function horizontalBar(chart: CompiledChartBlock, report: CompiledReport): string {
  const locale = report.document.locale
  const width = 960
  const height = Math.max(340, chart.points.length * 40 + 86)
  const left = 246
  const right = 82
  const top = 24
  const bottom = 54
  const plotWidth = width - left - right
  const plotHeight = height - top - bottom
  const values = chart.points.map((point) => point.y)
  let xMin = Math.min(0, ...values)
  let xMax = Math.max(0, ...values)
  if (xMin === xMax) {
    xMin -= 1
    xMax += 1
  }
  const xPosition = (value: number) => left + ((value - xMin) / (xMax - xMin)) * plotWidth
  const baseline = xPosition(0)
  const band = plotHeight / chart.points.length
  const bars = chart.points
    .map((point, index) => {
      const y = top + index * band + band * 0.16
      const x = Math.min(xPosition(point.y), baseline)
      const barWidth = Math.max(Math.abs(xPosition(point.y) - baseline), 1)
      const labelX = point.y >= 0 ? x + barWidth + 8 : x - 8
      const anchor = point.y >= 0 ? 'start' : 'end'
      return `<g><text class="tick category-label horizontal-label" x="${left - 12}" y="${(y + band * 0.44 + 4).toFixed(2)}" text-anchor="end">${escapeHtml(scalar(point.x))}</text><rect class="bar-series" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${(band * 0.68).toFixed(2)}"><title>${escapeHtml(`${scalar(point.x)}: ${numberLabel(point.y, locale)}`)}</title></rect><text class="value-label" x="${labelX.toFixed(2)}" y="${(y + band * 0.44 + 4).toFixed(2)}" text-anchor="${anchor}">${escapeHtml(numberLabel(point.y, locale))}</text></g>`
    })
    .join('')
  const description =
    locale === 'zh-CN'
      ? `${columnLabel(chart.y, locale)}按${columnLabel(chart.x, locale)}横向比较，共 ${chart.points.length} 个类别；数值轴包含零。`
      : `Horizontal comparison of ${columnLabel(chart.y, locale)} by ${columnLabel(chart.x, locale)} with ${chart.points.length} categories; the value axis includes zero.`
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${escapeHtml(chart.block.id)}-title ${escapeHtml(chart.block.id)}-desc"><title id="${escapeHtml(chart.block.id)}-title">${escapeHtml(chart.block.title)}</title><desc id="${escapeHtml(chart.block.id)}-desc">${escapeHtml(description)}</desc><line class="axis" x1="${baseline.toFixed(2)}" y1="${top}" x2="${baseline.toFixed(2)}" y2="${height - bottom}"/>${bars}<text class="axis-label" x="${left + plotWidth / 2}" y="${height - 12}" text-anchor="middle">${escapeHtml(columnLabel(chart.y, locale))}</text></svg>`
}

function svgBar(chart: CompiledChartBlock, report: CompiledReport): string {
  const longLabels = chart.points.some((point) => [...scalar(point.x)].length > 10)
  return chart.points.length > 8 || longLabels
    ? horizontalBar(chart, report)
    : verticalBar(chart, report)
}

function renderChart(chart: CompiledChartBlock, report: CompiledReport): string {
  const copy = COPY[report.document.locale]
  const svg = chart.view === 'line' ? svgLine(chart, report) : svgBar(chart, report)
  const columns = [chart.x, chart.y].map(
    (name) => chart.artifact.columns.find((column) => column.name === name)!,
  )
  const fallback = tableHtml(
    `${chart.block.title} — ${copy.dataTable}`,
    columns,
    chart.points.map((point) => [point.x, point.y]),
    report.document.locale,
  )
  return `<article class="block chart-block" id="${escapeHtml(chart.block.id)}"><h3>${escapeHtml(chart.block.title)}</h3><p class="context">${escapeHtml(chartContext(chart, report))}</p>${svg}<details class="fallback"><summary>${copy.dataTable}</summary>${fallback}</details></article>`
}

function renderTable(table: CompiledTableBlock, report: CompiledReport): string {
  const copy = COPY[report.document.locale]
  const disclosure = `<p class="truncation">${copy.displayed}: ${table.rows.length} / ${copy.total}: ${table.totalRows} / ${copy.omitted}: ${table.omittedRows} ${copy.rows}</p>`
  const columns = table.columns.map(
    (name) => table.artifact.columns.find((column) => column.name === name)!,
  )
  return `<article class="block table-block" id="${escapeHtml(table.block.id)}"><h3>${escapeHtml(table.block.title)}</h3>${disclosure}${tableHtml(table.block.title, columns, table.rows, report.document.locale)}</article>`
}

function renderBlock(block: ReportBlockV2, report: CompiledReport): string {
  if (block.kind === 'text') {
    return `<article class="block text-block" id="${escapeHtml(block.id)}">${textBlock(block.text)}</article>`
  }
  if (block.kind === 'chart') {
    const chart = report.charts.get(block.id)
    if (chart === undefined) throw new Error(`compiled chart ${block.id} is missing`)
    return renderChart(chart, report)
  }
  if (block.kind === 'table') {
    const table = report.tables.get(block.id)
    if (table === undefined) throw new Error(`compiled table ${block.id} is missing`)
    return renderTable(table, report)
  }
  throw new Error(`unsupported report block kind ${(block as { kind: string }).kind}`)
}

function issueList(issues: readonly { code: string; message: string; repair: string }[]): string {
  if (issues.length === 0) return ''
  return `<ul class="dag-issues">${issues
    .map(
      (issue) =>
        `<li><strong>${escapeHtml(issue.code)}</strong> — ${escapeHtml(issue.message)} <span>${escapeHtml(issue.repair)}</span></li>`,
    )
    .join('')}</ul>`
}

function refLinks(refs: readonly string[], report: CompiledReport): string {
  if (refs.length === 0) return '—'
  return refs
    .map((ref) => `<a href="#${artifactAnchor(report, ref)}">${escapeHtml(ref)}</a>`)
    .join('<br>')
}

function queryDetails(job: ReportDagJobProjection): string {
  const issues = issueList(job.queryIssues)
  const queries = job.queries
    .map(
      (query, index) =>
        `<details class="dag-query"><summary>SQL ${index + 1} · ${escapeHtml(query.datasource)} · ${escapeHtml(query.status)}</summary><dl><dt>query ID</dt><dd>${escapeHtml(query.queryId)}</dd><dt>datasource</dt><dd>${escapeHtml(query.datasource)}</dd><dt>dialect</dt><dd>${escapeHtml(query.dialect)}</dd><dt>digest</dt><dd>${escapeHtml(query.sqlDigest)}</dd><dt>status</dt><dd>${escapeHtml(query.status)}</dd><dt>duration</dt><dd>${query.durationMs} ms</dd><dt>rows</dt><dd>${query.rowCount}</dd><dt>started</dt><dd>${escapeHtml(query.startedAt)}</dd><dt>finished</dt><dd>${escapeHtml(query.finishedAt)}</dd><dt>output</dt><dd>${query.outputRef === null ? '—' : escapeHtml(query.outputRef)}</dd></dl><pre class="raw-sql"><code>${escapeHtml(query.sql)}</code></pre></details>`,
    )
    .join('')
  return `${issues}${queries}`
}

function jobDetail(node: CompiledDagNode, report: CompiledReport): string {
  const job = node.job!
  const reused = job.reusedArtifact ? 'true' : 'false'
  return `<article class="dag-detail" id="${node.detailId}" data-dag-detail tabindex="-1"><p class="dag-kind">Job · ${escapeHtml(job.intent)}</p><h4>${escapeHtml(job.id)}</h4><dl><dt>status</dt><dd>${escapeHtml(job.status)}</dd><dt>purpose</dt><dd>${escapeHtml(job.analysisPurpose ?? '—')}</dd><dt>started</dt><dd>${escapeHtml(job.startedAt)}</dd><dt>finished</dt><dd>${escapeHtml(job.finishedAt ?? '—')}</dd><dt>duration</dt><dd>${job.durationMs} ms</dd><dt>inputs</dt><dd>${refLinks(job.inputArtifactRefs, report)}</dd><dt>output</dt><dd><a href="#${artifactAnchor(report, job.outputArtifactRef)}">${escapeHtml(job.outputArtifactRef)}</a></dd><dt>reused</dt><dd>${reused}</dd></dl><details class="audit"><summary>params</summary><pre>${escapeHtml(pretty(job.params))}</pre></details>${queryDetails(job)}</article>`
}

function artifactDetail(node: CompiledDagNode, report: CompiledReport): string {
  const copy = COPY[report.document.locale]
  const artifact = node.artifact!
  const preview =
    artifact.status !== 'ready'
      ? ''
      : `<section class="dag-preview"><h5>${copy.artifactPreview}</h5><p class="truncation">${copy.displayed}: ${artifact.previewRows.length} / ${copy.total}: ${artifact.totalRows ?? 0} / ${copy.omitted}: ${artifact.omittedRows ?? 0} ${copy.rows}</p>${tableHtml(copy.artifactPreview, artifact.columns, artifact.previewRows, report.document.locale)}</section>`
  const audits =
    artifact.status !== 'ready'
      ? ''
      : `<details class="audit"><summary>${copy.audit}</summary><h5>${copy.contract}</h5><pre>${escapeHtml(pretty(artifact.contract!))}</pre><h5>revalidation</h5><pre>${escapeHtml(pretty(artifact.revalidation!))}</pre><h5>${copy.lineage}</h5><pre>${escapeHtml(pretty(artifact.lineage!))}</pre></details>`
  return `<article class="dag-detail" id="${node.detailId}" data-dag-detail tabindex="-1"><p class="dag-kind">Artifact · ${escapeHtml(artifact.status)}</p><h4>${escapeHtml(artifact.ref)}</h4><dl><dt>family</dt><dd>${escapeHtml(artifact.family ?? '—')}</dd><dt>shape</dt><dd>${artifact.shape === null ? '—' : `${artifact.shape[0]} × ${artifact.shape[1]}`}</dd><dt>content hash</dt><dd>${escapeHtml(artifact.contentHash ?? '—')}</dd><dt>schema</dt><dd>${escapeHtml(artifact.artifactSchemaVersion ?? '—')}</dd><dt>created</dt><dd>${escapeHtml(artifact.createdAt ?? '—')}</dd></dl>${issueList(artifact.issues)}${preview}${audits}</article>`
}

function dagNode(node: CompiledDagNode): string {
  const artifactStatus = node.artifact?.status ?? 'ready'
  const classes = `dag-node dag-node-${node.kind} dag-node-${artifactStatus}`
  return `<a id="${node.domId}" class="${classes}" href="#${node.detailId}" data-dag-node role="button" aria-label="${escapeHtml(`${node.kind}: ${node.label} ${node.subtitle}`)}"><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="9"/><text class="dag-node-label" x="${node.x + 12}" y="${node.y + 24}">${escapeHtml(node.label)}</text><text class="dag-node-subtitle" x="${node.x + 12}" y="${node.y + 44}">${escapeHtml(node.subtitle)}</text></a>`
}

function dagComponent(
  component: CompiledDagComponent,
  index: number,
  report: CompiledReport,
): string {
  const copy = COPY[report.document.locale]
  const marker = `${component.id}-arrow`
  const edges = component.edges
    .map(
      (edge) =>
        `<path class="dag-edge dag-edge-${edge.kind}" d="${edge.path}" marker-end="url(#${marker})"/>`,
    )
    .join('')
  const nodes = component.nodes.map(dagNode).join('')
  const details = component.nodes
    .map((node) => (node.kind === 'job' ? jobDetail(node, report) : artifactDetail(node, report)))
    .join('')
  const nodeIndex = component.nodes
    .map(
      (node) =>
        `<li><a href="#${node.detailId}">${escapeHtml(node.kind === 'job' ? `Job: ${node.label}` : `Artifact: ${node.label}`)}</a> <code>${escapeHtml(node.subtitle)}</code></li>`,
    )
    .join('')
  return `<section class="dag-component" id="${component.id}" data-dag-component><div class="dag-component-heading"><h3>${copy.component} ${index + 1}</h3><div class="dag-controls" aria-label="DAG zoom controls"><button type="button" data-dag-action="zoom-out" aria-label="Zoom out">−</button><button type="button" data-dag-action="zoom-in" aria-label="Zoom in">+</button><button type="button" data-dag-action="reset">Reset</button></div></div><div class="dag-workspace"><div class="dag-canvas-wrap"><svg class="dag-canvas" data-dag-canvas viewBox="0 0 ${component.width} ${component.height}" role="img" aria-label="${escapeHtml(`${copy.component} ${index + 1}`)}"><defs><marker id="${marker}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"/></marker></defs><g data-dag-viewport>${edges}${nodes}</g></svg></div><aside class="dag-detail-panel" aria-live="polite">${details}</aside></div><ol class="dag-index">${nodeIndex}</ol></section>`
}

function footer(report: CompiledReport, generatedAt: string): string {
  const copy = COPY[report.document.locale]
  const date = new Date(generatedAt)
  const visibleTime = Number.isNaN(date.getTime())
    ? generatedAt
    : new Intl.DateTimeFormat(report.document.locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
        timeZoneName: 'short',
      }).format(date)
  const count = `${report.sessionDag.jobs.length} ${copy.actions} · ${report.sessionDag.artifacts.length} ${copy.artifacts}`
  const graph =
    report.sessionDag.components.length === 0
      ? `<p class="dag-empty">${copy.graphEmpty}</p>`
      : report.sessionDag.components
          .map((component, index) => dagComponent(component, index, report))
          .join('')
  return `<footer><div class="footer-meta"><p><strong>${copy.generated}</strong> <time datetime="${escapeHtml(generatedAt)}">${escapeHtml(visibleTime)}</time></p><p class="freshness">${copy.freshness}</p></div><section class="session-provenance" id="report-provenance"><h2>${copy.inventory}</h2><p class="dag-count">${count}</p><div class="dag-legend"><span class="legend-job">Job</span><span class="legend-artifact">Artifact</span><span class="legend-produces">produces</span><span class="legend-reuses">reuses</span></div>${graph}</section></footer>`
}

const CSS = `
:root{color-scheme:light dark;--paper:#fff;--surface:#f7f8fa;--ink:#20252b;--muted:#68717a;--faint:#929aa1;--accent:#2563eb;--accent-deep:#1d4ed8;--accent-soft:#eef4ff;--line:#e3e6e8;--grid:#edf0f2;--bar:#86add8;--bar-edge:#315f8f;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
*{box-sizing:border-box}html,body{background:var(--paper)}body{margin:0;color:var(--ink);font-size:16px;line-height:1.7;text-rendering:optimizeLegibility}main{max-width:1020px;margin:0 auto;padding:72px 56px 60px}header{padding-bottom:40px;border-bottom:1px solid var(--line);margin-bottom:0}.eyebrow{margin:0 0 10px;color:var(--accent);font-size:.72rem;font-weight:750;letter-spacing:.14em;text-transform:uppercase}h1{max-width:22ch;font-size:clamp(2.35rem,5vw,3.5rem);line-height:1.08;letter-spacing:-.035em;margin:0}h2{font-size:1.48rem;line-height:1.25;letter-spacing:-.015em;margin:58px 0 22px}h3{font-size:1.12rem;line-height:1.35;margin:0 0 8px}.subtitle{max-width:72ch;margin:18px 0 0;color:var(--muted);font-size:1.05rem}.report-section{scroll-margin-top:24px}.report-summary{margin:0 0 58px;padding:0;background:transparent;border:0}.report-summary h2{margin:40px 0 14px;color:var(--accent-deep);font-size:1.08rem;letter-spacing:0}.report-summary>.text-block:first-of-type{max-width:none;margin-bottom:42px;padding:4px 0 4px 22px;border-left:3px solid var(--accent)}.block{margin:0 0 30px;break-inside:avoid}.text-block{max-width:78ch}.text-block p{margin:.65em 0}.text-block ol,.text-block ul{margin:.8em 0;padding-left:1.45em}.text-block li{margin:.55em 0;padding-left:.25em}.chart-block,.table-block{max-width:none;margin:0;padding:30px 0 38px;background:transparent;border:0;border-top:1px solid var(--line);border-radius:0}.chart-block+ .text-block,.table-block+ .text-block{margin:-10px 0 46px;padding-left:18px;border-left:2px solid color-mix(in srgb,var(--accent) 58%,var(--line))}.context,.truncation{color:var(--muted);font-size:.82rem}.context{margin:0 0 12px}.truncation{margin:-2px 0 12px}.chart{display:block;width:100%;height:auto;margin:4px 0 2px;background:transparent}.axis{stroke:var(--faint);stroke-width:1}.grid{stroke:var(--grid);stroke-width:1}.grid-anchor{stroke:var(--faint)}.tick{font-size:12px;fill:var(--muted)}.axis-label{font-size:13px;font-weight:650;fill:var(--muted)}.line-series{fill:none;stroke:var(--accent);stroke-linecap:round;stroke-linejoin:round;stroke-width:2.5}.chart circle{fill:var(--paper);stroke:var(--accent);stroke-width:2}.bar-series{fill:var(--bar);stroke:var(--bar-edge);stroke-width:1}.value-label,.endpoint-label{font-size:11px;font-weight:700;fill:var(--ink)}.endpoint-label{font-size:12px}.table-scroll{overflow-x:auto;margin-inline:-2px}table{border-collapse:separate;border-spacing:0;width:100%;font-size:.9rem;font-variant-numeric:tabular-nums}caption{text-align:left;font-weight:650;padding:0 0 10px}th,td{padding:10px 12px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line)}th{color:var(--muted);background:var(--surface);font-size:.78rem;font-weight:700;letter-spacing:.02em;white-space:nowrap}td{max-width:38rem;overflow-wrap:anywhere}.column-unit{display:block;color:var(--faint);font-size:.68rem;font-weight:500;letter-spacing:0;text-transform:none}tbody tr:last-child td{border-bottom:0}a{color:var(--accent);text-underline-offset:3px}details{margin-top:14px}summary{cursor:pointer}.fallback{padding-top:2px}.fallback>summary{color:var(--muted);font-size:.8rem;font-weight:650}.audit pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--surface);padding:10px;border-left:2px solid var(--line);font-size:.75rem}.audit{color:var(--muted)}footer{margin-top:70px;padding-top:24px;border-top:1px solid var(--line);font-size:.8rem}.footer-meta{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;color:var(--muted)}.footer-meta p{margin:0}.freshness{max-width:62ch}
.session-provenance{margin-top:30px;scroll-margin-top:18px}.session-provenance>h2{margin:30px 0 4px}.dag-count{margin:0;color:var(--muted)}.dag-legend{display:flex;flex-wrap:wrap;gap:8px 16px;margin:14px 0 24px;color:var(--muted);font-size:.76rem}.dag-legend span{display:inline-flex;align-items:center;gap:6px}.dag-legend span:before{content:"";display:inline-block;width:24px;height:10px;border:1.5px solid var(--line);border-radius:3px}.dag-legend .legend-job:before{background:var(--accent-soft);border-color:var(--accent)}.dag-legend .legend-artifact:before{background:var(--surface);border-color:var(--muted)}.dag-legend .legend-produces:before{height:0;border:0;border-top:2px solid var(--accent);border-radius:0}.dag-legend .legend-reuses:before{height:0;border:0;border-top:2px dashed var(--accent);border-radius:0}.dag-component{padding:24px 0 34px;border-top:1px solid var(--line);scroll-margin-top:18px}.dag-component-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}.dag-component-heading h3{margin:0}.dag-controls{display:flex;gap:6px}.dag-controls button{min-width:32px;padding:5px 9px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--ink);font:inherit;font-size:.75rem;cursor:pointer}.dag-controls button:focus-visible,.dag-node:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.dag-workspace{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(260px,1fr);gap:20px;margin-top:12px;align-items:start}.dag-canvas-wrap{min-width:0;overflow:hidden;border:1px solid var(--line);border-radius:10px;background:var(--surface)}.dag-canvas{display:block;width:100%;min-height:260px;max-height:560px;touch-action:none;cursor:grab}.dag-canvas:active{cursor:grabbing}.dag-edge{fill:none;stroke:var(--muted);stroke-width:1.5}.dag-edge-produces{stroke:var(--accent);stroke-width:2}.dag-edge-reuses{stroke:var(--accent);stroke-dasharray:7 5}.dag-canvas marker path{fill:var(--muted)}.dag-node rect{fill:var(--paper);stroke:var(--muted);stroke-width:1.5}.dag-node-job rect{fill:var(--accent-soft);stroke:var(--accent)}.dag-node-unavailable rect{stroke:#b45309;stroke-dasharray:5 4}.dag-node-boundary rect{fill:transparent;stroke-dasharray:3 3}.dag-node[data-selected="true"] rect{stroke-width:3}.dag-node-label{fill:var(--ink);font-size:13px;font-weight:750}.dag-node-subtitle{fill:var(--muted);font-size:10px}.dag-detail-panel{min-width:0;max-height:560px;overflow:auto;padding:16px;border:1px solid var(--line);border-radius:10px;background:var(--paper)}.dag-detail{scroll-margin-top:18px}.dag-detail+.dag-detail{padding-top:18px;margin-top:18px;border-top:1px solid var(--line)}.dag-enhanced .dag-detail{display:none}.dag-enhanced .dag-detail[data-active="true"]{display:block}.dag-detail:target{outline:2px solid var(--accent);outline-offset:5px}.dag-detail h4{margin:0 0 10px;font-size:.95rem;overflow-wrap:anywhere}.dag-detail h5{margin:18px 0 8px}.dag-kind{margin:0;color:var(--accent);font-size:.7rem;font-weight:750;text-transform:uppercase;letter-spacing:.08em}.dag-detail dl,.dag-query dl{display:grid;grid-template-columns:minmax(6rem,auto) minmax(0,1fr);gap:4px 12px}.dag-detail dt,.dag-query dt{font-weight:650}.dag-detail dd,.dag-query dd{margin:0;overflow-wrap:anywhere}.dag-detail pre{max-height:24rem;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;padding:10px;background:var(--surface);border-left:2px solid var(--line);font-size:.72rem}.dag-query{padding-top:6px}.dag-query>summary{color:var(--accent);font-weight:650}.raw-sql{color:var(--ink)}.dag-issues{padding-left:1.2rem;color:#b45309}.dag-issues span{display:block;color:var(--muted)}.dag-preview .table-scroll{max-height:22rem;overflow:auto}.dag-preview table{font-size:.72rem}.dag-preview th,.dag-preview td{padding:7px 8px}.dag-empty{padding:24px;border:1px dashed var(--line);border-radius:8px;color:var(--muted)}.dag-index{display:none}.dag-index code{color:var(--muted)}
@media(prefers-color-scheme:dark){:root{--paper:#15191c;--surface:#1c2227;--ink:#edf1f3;--muted:#a9b2b8;--faint:#7f8990;--accent:#79a7ff;--accent-deep:#a8c5ff;--accent-soft:#18243a;--line:#30363b;--grid:#2b3237;--bar:#547fae;--bar-edge:#8eb9e8}}
@media(max-width:720px){main{padding:36px 20px 40px}header{padding-bottom:30px}h1{font-size:2.25rem}.report-summary>.text-block:first-of-type{padding-left:16px}.chart-block,.table-block{padding:24px 0 32px}.chart-block+ .text-block,.table-block+ .text-block{margin-top:-6px}.footer-meta{display:grid}.horizontal-label{font-size:10px}.dag-workspace{grid-template-columns:1fr}.dag-detail-panel{max-height:none}.dag-canvas{min-height:220px}.dag-detail dl,.dag-query dl{grid-template-columns:1fr}.dag-detail dd,.dag-query dd{margin-bottom:5px}}
@media print{:root{color-scheme:light;--paper:#fff;--surface:#fff;--ink:#111;--muted:#555;--faint:#777;--line:#ddd;--grid:#e5e5e5;--accent:#1d4ed8;--accent-deep:#1d4ed8;--accent-soft:#f5f8ff;--bar:#9dbde1;--bar-edge:#345f8c}main{max-width:none;margin:0;padding:0}.block,.chart,table{break-inside:avoid}.table-scroll{overflow:visible}.fallback:not([open])>*:not(summary){display:none!important}footer{break-before:auto}a{color:inherit}.dag-controls,.dag-detail-panel{display:none!important}.dag-workspace{display:block}.dag-canvas{max-height:none;break-inside:avoid}.dag-index{display:block;font-size:8pt}.dag-component{break-inside:avoid}}
`.trim()

/** Generate one self-contained HTML document without I/O or runtime dependencies. */
export function renderReportHtml(report: CompiledReport, generatedAt: string): string {
  const copy = COPY[report.document.locale]
  const subtitle =
    report.document.subtitle === undefined
      ? ''
      : `<p class="subtitle">${escapeHtml(report.document.subtitle)}</p>`
  const sections = report.document.sections
    .map(
      (section, index) =>
        `<section class="report-section${index === 0 ? ' report-summary' : ''}" id="${escapeHtml(section.id)}"><h2>${escapeHtml(section.title)}</h2>${section.blocks.map((block) => renderBlock(block, report)).join('')}</section>`,
    )
    .join('')
  return `<!doctype html><html lang="${report.document.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy()}"><title>${escapeHtml(report.document.title)}</title><style>${CSS}</style></head><body><main><header><p class="eyebrow">${copy.report}</p><h1>${escapeHtml(report.document.title)}</h1>${subtitle}</header>${sections}${footer(report, generatedAt)}</main><script>${DAG_SCRIPT}</script></body></html>\n`
}
