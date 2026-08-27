import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { ReportBlockV1 } from './document.ts'
import type { ReportFindingProjection } from './projection.ts'
import type { CompiledChartBlock, CompiledReport, CompiledTableBlock } from './visual.ts'
import { reportTimeEpoch } from './time.ts'

export const REPORT_RENDERER_VERSION = 'dsh-data-analysis-html/v1' as const

const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; script-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"

const COPY = {
  'zh-CN': {
    generated: '生成时间', source: '来源与有效性', artifact: 'Artifact', finding: 'Finding',
    quality: '质量状态', committed: '提交时间', type: '类型', epistemic: '认识类型',
    dataTable: '查看同源数据表', displayed: '显示', total: '总计', omitted: '省略', rows: '行',
    freshness: 'Artifact admissible 仅表示当前语义权威和 Evidence 完整性可接受，不等于 datasource fresh。',
    noQuality: '未标注', value: '值', derivation: '派生规则', subject: '主题', chart: '图表',
    range: '范围', unit: '单位',
  },
  'en-US': {
    generated: 'Generated at', source: 'Sources and validity', artifact: 'Artifact', finding: 'Finding',
    quality: 'Quality', committed: 'Committed at', type: 'Type', epistemic: 'Epistemic kind',
    dataTable: 'View source data table', displayed: 'Displayed', total: 'total', omitted: 'omitted', rows: 'rows',
    freshness: 'Artifact admissible means current semantic authority and Evidence integrity are acceptable; it does not mean datasource fresh.',
    noQuality: 'not labeled', value: 'Value', derivation: 'Derivation', subject: 'Subject', chart: 'Chart',
    range: 'Range', unit: 'Unit',
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

function numberLabel(value: number): string {
  if (value === 0) return '0'
  const absolute = Math.abs(value)
  if (absolute >= 1_000_000 || absolute < 0.001) return value.toExponential(3)
  return Number(value.toPrecision(6)).toString()
}

function textBlock(text: string): string {
  return text.split(/\r?\n/).map(line => `<p>${escapeHtml(line)}</p>`).join('')
}

function tableHtml(
  caption: string,
  columns: readonly string[],
  rows: readonly (readonly JsonValue[])[],
): string {
  const head = columns.map(column => `<th scope="col">${escapeHtml(column)}</th>`).join('')
  const body = rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(scalar(cell))}</td>`).join('')}</tr>`).join('')
  return `<div class="table-scroll"><table><caption>${escapeHtml(caption)}</caption><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
}

function sourceDetails(
  artifactRef: string | undefined,
  findingIds: readonly string[] | undefined,
  report: CompiledReport,
): string {
  const copy = COPY[report.document.locale]
  const artifact = artifactRef === undefined
    ? undefined
    : report.projection.artifacts.find(item => item.ref === artifactRef)
  const findings = (findingIds ?? []).map(id => report.projection.findings.find(item => item.findingId === id)).filter(
    (item): item is ReportFindingProjection => item !== undefined,
  )
  if (artifact === undefined && findings.length === 0) return ''
  const artifactHtml = artifact === undefined ? '' : `<div class="source-card"><h4>${copy.artifact}</h4><dl><dt>ref</dt><dd>${escapeHtml(artifact.ref)}</dd><dt>content hash</dt><dd>${escapeHtml(artifact.contentHash)}</dd><dt>family</dt><dd>${escapeHtml(artifact.family)}</dd><dt>shape</dt><dd>${artifact.shape[0]} × ${artifact.shape[1]}</dd><dt>created</dt><dd>${escapeHtml(artifact.createdAt)}</dd><dt>revalidation</dt><dd>admissible</dd></dl></div>`
  const findingHtml = findings.map(finding => `<div class="source-card"><h4>${copy.finding} ${escapeHtml(finding.findingId)}</h4><dl><dt>${copy.type}</dt><dd>${escapeHtml(finding.findingType)}</dd><dt>${copy.epistemic}</dt><dd>${escapeHtml(finding.epistemicKind)}</dd><dt>${copy.quality}</dt><dd>${escapeHtml(finding.qualityStatus ?? copy.noQuality)}</dd><dt>${copy.committed}</dt><dd>${escapeHtml(finding.committedAt)}</dd><dt>${copy.artifact}</dt><dd>${escapeHtml(finding.artifactId)}</dd></dl><h5>${copy.value}</h5><pre>${escapeHtml(pretty(finding.value))}</pre><h5>${copy.subject}</h5><pre>${escapeHtml(pretty(finding.subject))}</pre><h5>${copy.derivation}</h5><pre>${escapeHtml(pretty(finding.derivation))}</pre></div>`).join('')
  return `<details class="sources"><summary>${copy.source}</summary>${artifactHtml}${findingHtml}</details>`
}

function chartContext(chart: CompiledChartBlock, report: CompiledReport): string {
  const copy = COPY[report.document.locale]
  const ys = chart.points.map(point => point.y)
  const yRange = `${numberLabel(Math.min(...ys))} – ${numberLabel(Math.max(...ys))}`
  const xRange = chart.view === 'line'
    ? ` · ${chart.x}: ${scalar(chart.points[0]?.x ?? null)} – ${scalar(chart.points.at(-1)?.x ?? null)}`
    : ''
  const unit = chart.artifact.columns.find(column => column.name === chart.y)?.unit
  const mechanical = `${chart.artifact.ref} · ${chart.points.length} ${copy.rows} · ${chart.x} → ${chart.y}${xRange} · ${copy.range} ${chart.y}: ${yRange}${unit === undefined || unit === null ? '' : ` · ${copy.unit}: ${unit}`}`
  return chart.block.subtitle === undefined ? mechanical : `${chart.block.subtitle} · ${mechanical}`
}

function svgLine(chart: CompiledChartBlock): string {
  const width = 960
  const height = 360
  const left = 76
  const right = 28
  const top = 28
  const bottom = 66
  const plotWidth = width - left - right
  const plotHeight = height - top - bottom
  const ys = chart.points.map(point => point.y)
  let yMin = Math.min(0, ...ys)
  let yMax = Math.max(0, ...ys)
  if (yMin === yMax) { yMin -= 1; yMax += 1 }
  const rawX = chart.points.map(point => {
    if (typeof point.x === 'number') return point.x
    return reportTimeEpoch(point.x) ?? Number.NaN
  })
  const numericX = rawX.every(Number.isFinite)
  let xMin = numericX ? Math.min(...rawX) : 0
  let xMax = numericX ? Math.max(...rawX) : Math.max(chart.points.length - 1, 1)
  if (xMin === xMax) { xMin -= 1; xMax += 1 }
  const xPosition = (index: number) => left + (((numericX ? rawX[index] : index) ?? 0) - xMin) / (xMax - xMin) * plotWidth
  const yPosition = (value: number) => top + (yMax - value) / (yMax - yMin) * plotHeight
  const ticks = Array.from({ length: 5 }, (_item, index) => yMin + (yMax - yMin) * index / 4)
  const grid = ticks.map(value => {
    const y = yPosition(value)
    return `<line class="grid" x1="${left}" y1="${y.toFixed(2)}" x2="${width - right}" y2="${y.toFixed(2)}"/><text class="tick" x="${left - 10}" y="${(y + 4).toFixed(2)}" text-anchor="end">${escapeHtml(numberLabel(value))}</text>`
  }).join('')
  const path = chart.points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${xPosition(index).toFixed(2)} ${yPosition(point.y).toFixed(2)}`).join(' ')
  const markers = chart.points.map((point, index) => `<circle cx="${xPosition(index).toFixed(2)}" cy="${yPosition(point.y).toFixed(2)}" r="4"><title>${escapeHtml(`${scalar(point.x)}: ${numberLabel(point.y)}`)}</title></circle>`).join('')
  const labelIndexes = [...new Set([0, Math.floor((chart.points.length - 1) / 2), chart.points.length - 1])]
  const xLabels = labelIndexes.map(index => `<text class="tick" x="${xPosition(index).toFixed(2)}" y="${height - 32}" text-anchor="middle">${escapeHtml(scalar(chart.points[index]?.x ?? ''))}</text>`).join('')
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${escapeHtml(chart.block.id)}-title ${escapeHtml(chart.block.id)}-desc"><title id="${escapeHtml(chart.block.id)}-title">${escapeHtml(chart.block.title)}</title><desc id="${escapeHtml(chart.block.id)}-desc">Line chart of ${escapeHtml(chart.y)} by ${escapeHtml(chart.x)} with ${chart.points.length} points.</desc>${grid}<line class="axis" x1="${left}" y1="${top}" x2="${left}" y2="${height - bottom}"/><line class="axis" x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}"/><path class="line-series" d="${path}"/>${markers}${xLabels}<text class="axis-label" x="${width / 2}" y="${height - 6}" text-anchor="middle">${escapeHtml(chart.x)}</text><text class="axis-label" x="18" y="${height / 2}" text-anchor="middle" transform="rotate(-90 18 ${height / 2})">${escapeHtml(chart.y)}</text></svg>`
}

function svgBar(chart: CompiledChartBlock): string {
  const width = 960
  const height = 380
  const left = 76
  const right = 28
  const top = 28
  const bottom = 94
  const plotWidth = width - left - right
  const plotHeight = height - top - bottom
  const ys = chart.points.map(point => point.y)
  let yMin = Math.min(0, ...ys)
  let yMax = Math.max(0, ...ys)
  if (yMin === yMax) { yMin -= 1; yMax += 1 }
  const yPosition = (value: number) => top + (yMax - value) / (yMax - yMin) * plotHeight
  const baseline = yPosition(0)
  const band = plotWidth / Math.max(chart.points.length, 1)
  const bars = chart.points.map((point, index) => {
    const x = left + index * band + band * 0.12
    const y = Math.min(yPosition(point.y), baseline)
    const barHeight = Math.max(Math.abs(yPosition(point.y) - baseline), 1)
    const labelY = point.y >= 0 ? y - 7 : y + barHeight + 16
    return `<g><rect class="bar-series" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(band * 0.76).toFixed(2)}" height="${barHeight.toFixed(2)}"><title>${escapeHtml(`${scalar(point.x)}: ${numberLabel(point.y)}`)}</title></rect><text class="value-label" x="${(x + band * 0.38).toFixed(2)}" y="${labelY.toFixed(2)}" text-anchor="middle">${escapeHtml(numberLabel(point.y))}</text><text class="tick category-label" x="${(x + band * 0.38).toFixed(2)}" y="${height - bottom + 20}" text-anchor="end" transform="rotate(-35 ${(x + band * 0.38).toFixed(2)} ${height - bottom + 20})">${escapeHtml(scalar(point.x))}</text></g>`
  }).join('')
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${escapeHtml(chart.block.id)}-title ${escapeHtml(chart.block.id)}-desc"><title id="${escapeHtml(chart.block.id)}-title">${escapeHtml(chart.block.title)}</title><desc id="${escapeHtml(chart.block.id)}-desc">Bar chart of ${escapeHtml(chart.y)} by ${escapeHtml(chart.x)} with ${chart.points.length} categories; the value axis includes zero.</desc><line class="grid" x1="${left}" y1="${baseline.toFixed(2)}" x2="${width - right}" y2="${baseline.toFixed(2)}"/><line class="axis" x1="${left}" y1="${top}" x2="${left}" y2="${height - bottom}"/>${bars}<text class="axis-label" x="18" y="${height / 2}" text-anchor="middle" transform="rotate(-90 18 ${height / 2})">${escapeHtml(chart.y)}</text></svg>`
}

function renderChart(chart: CompiledChartBlock, report: CompiledReport): string {
  const copy = COPY[report.document.locale]
  const svg = chart.view === 'line' ? svgLine(chart) : svgBar(chart)
  const fallback = tableHtml(
    `${chart.block.title} — ${copy.dataTable}`,
    [chart.x, chart.y],
    chart.points.map(point => [point.x, point.y]),
  )
  return `<article class="block chart-block" id="${escapeHtml(chart.block.id)}"><h3>${escapeHtml(chart.block.title)}</h3><p class="context">${escapeHtml(chartContext(chart, report))}</p>${svg}<details class="fallback"><summary>${copy.dataTable}</summary>${fallback}</details>${sourceDetails(chart.artifact.ref, chart.block.finding_ids, report)}</article>`
}

function renderTable(table: CompiledTableBlock, report: CompiledReport): string {
  const copy = COPY[report.document.locale]
  const disclosure = `<p class="truncation">${copy.displayed}: ${table.rows.length} / ${copy.total}: ${table.totalRows} / ${copy.omitted}: ${table.omittedRows} ${copy.rows}</p>`
  return `<article class="block table-block" id="${escapeHtml(table.block.id)}"><h3>${escapeHtml(table.block.title)}</h3>${disclosure}${tableHtml(table.block.title, table.columns, table.rows)}${sourceDetails(table.artifact.ref, table.block.finding_ids, report)}</article>`
}

function renderBlock(block: ReportBlockV1, report: CompiledReport): string {
  if (block.kind === 'text') {
    return `<article class="block text-block" id="${escapeHtml(block.id)}">${textBlock(block.text)}${sourceDetails(undefined, block.finding_ids, report)}</article>`
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
  return `<article class="block evidence-block" id="${escapeHtml(block.id)}"><h3>${escapeHtml(block.title)}</h3>${sourceDetails(undefined, block.finding_ids, report)}</article>`
}

function footer(report: CompiledReport, generatedAt: string): string {
  const copy = COPY[report.document.locale]
  const artifacts = report.projection.artifacts.map(artifact => `<li><span>${escapeHtml(artifact.ref)}</span><code>${escapeHtml(artifact.contentHash)}</code></li>`).join('')
  const findings = report.projection.findings.map(finding => `<li><span>${escapeHtml(finding.findingId)}</span><time>${escapeHtml(finding.committedAt)}</time></li>`).join('')
  return `<footer><h2>${copy.source}</h2><p><strong>${copy.generated}:</strong> <time>${escapeHtml(generatedAt)}</time></p><p class="freshness">${copy.freshness}</p><div class="footer-grid"><section><h3>Artifacts</h3><ul>${artifacts}</ul></section><section><h3>Findings</h3><ul>${findings}</ul></section></div></footer>`
}

const CSS = `
:root{color-scheme:light;--ink:#17212b;--muted:#5c6975;--accent:#0969a8;--line:#c9d4dc;--paper:#fff;--wash:#f3f7fa;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--wash);color:var(--ink);line-height:1.55}main{max-width:1120px;margin:0 auto;background:var(--paper);padding:52px 64px;box-shadow:0 2px 24px #14202b1a}header{border-bottom:3px solid var(--accent);padding-bottom:24px;margin-bottom:42px}h1{font-size:2.25rem;line-height:1.16;margin:0}h2{font-size:1.55rem;margin:44px 0 18px}h3{font-size:1.15rem;margin:0 0 8px}.subtitle,.context,.truncation{color:var(--muted)}.block{margin:0 0 28px;break-inside:avoid}.text-block p{margin:.4em 0;white-space:pre-wrap}.chart{display:block;width:100%;height:auto;margin:14px 0;background:#fff}.axis{stroke:#52606b;stroke-width:1.5}.grid{stroke:#dbe3e8;stroke-width:1}.tick{font-size:12px;fill:#53616d}.axis-label{font-size:14px;font-weight:600;fill:#263442}.line-series{fill:none;stroke:var(--accent);stroke-width:3}.line-series+circle,.chart circle{fill:#fff;stroke:var(--accent);stroke-width:3}.bar-series{fill:#8dc4e8;stroke:#154c70;stroke-width:1.5}.value-label{font-size:11px;font-weight:600;fill:#263442}.table-scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:.9rem}caption{text-align:left;font-weight:600;padding:0 0 8px}th,td{border:1px solid var(--line);padding:7px 9px;text-align:left;vertical-align:top}th{background:#eaf1f5}td{max-width:38rem;overflow-wrap:anywhere}details{border:1px solid var(--line);border-radius:6px;padding:10px 13px;margin-top:14px}summary{cursor:pointer;font-weight:600}.source-card{border-top:1px solid var(--line);padding-top:12px;margin-top:12px}.source-card dl{display:grid;grid-template-columns:minmax(7rem,auto) 1fr;gap:4px 14px}.source-card dt{font-weight:600}.source-card dd{margin:0;overflow-wrap:anywhere}.source-card pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--wash);padding:10px;border-radius:4px;font-size:.78rem}footer{border-top:3px solid var(--accent);margin-top:52px;padding-top:22px;font-size:.88rem}.freshness{font-weight:600}.footer-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}.footer-grid ul{padding-left:20px}.footer-grid li{margin-bottom:7px}.footer-grid code,.footer-grid time{display:block;overflow-wrap:anywhere;color:var(--muted)}
@media(max-width:720px){main{padding:28px 20px}h1{font-size:1.8rem}.footer-grid{grid-template-columns:1fr}.category-label{font-size:10px}.source-card dl{grid-template-columns:1fr}.source-card dd{margin-bottom:6px}}
@media print{body{background:#fff}main{max-width:none;padding:0;box-shadow:none}.block,.chart,table{break-inside:avoid}details{border:0;padding:0}details>summary{font-weight:700}details:not([open])>*:not(summary){display:block}.table-scroll{overflow:visible}footer{break-before:auto}a{color:inherit}}
`.trim()

/** Generate one self-contained HTML document without I/O or runtime dependencies. */
export function renderReportHtml(report: CompiledReport, generatedAt: string): string {
  const subtitle = report.document.subtitle === undefined ? '' : `<p class="subtitle">${escapeHtml(report.document.subtitle)}</p>`
  const sections = report.document.sections.map(section => `<section id="${escapeHtml(section.id)}"><h2>${escapeHtml(section.title)}</h2>${section.blocks.map(block => renderBlock(block, report)).join('')}</section>`).join('')
  return `<!doctype html><html lang="${report.document.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${CSP}"><title>${escapeHtml(report.document.title)}</title><style>${CSS}</style></head><body><main><header><h1>${escapeHtml(report.document.title)}</h1>${subtitle}</header>${sections}${footer(report, generatedAt)}</main></body></html>\n`
}
