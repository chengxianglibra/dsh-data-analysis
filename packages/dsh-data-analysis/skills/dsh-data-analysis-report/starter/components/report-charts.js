;((scope) => {
  const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
  const PALETTE = ['#2563eb', '#c2410c', '#137a4a', '#7c3aed', '#b42318', '#0e7490']
  const cleanupByContainer = new WeakMap()
  let nextId = 0

  class ReportChartError extends Error {
    constructor(code, path, message) {
      super(`${path}: ${message}`)
      this.name = 'ReportChartError'
      this.code = code
      this.path = path
    }
  }

  function fail(code, path, message) {
    throw new ReportChartError(code, path, message)
  }

  function element(value, path = '$container') {
    if (!(value instanceof Element)) fail('container-invalid', path, 'must be an Element')
    return value
  }

  function object(value, path) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      fail('options-invalid', path, 'must be an object')
    }
    return value
  }

  function nonEmptyString(value, path) {
    if (typeof value !== 'string' || value.trim() === '') {
      fail('options-invalid', path, 'must be a non-empty string')
    }
    return value
  }

  function datasetValue(value) {
    const provider = scope.ReportData
    if (
      typeof provider !== 'object' ||
      provider === null ||
      typeof provider.get !== 'function' ||
      typeof provider.list !== 'function'
    ) {
      fail('dataset-provider-missing', '$dataset', 'requires ReportData to be loaded first')
    }
    for (const id of provider.list()) {
      if (provider.get(id) === value) return value
    }
    fail('dataset-unregistered', '$dataset', 'must be a value returned by ReportData.get()')
  }

  function columnIndex(dataset, name, path) {
    nonEmptyString(name, path)
    const index = dataset.table.columns.findIndex((column) => column.name === name)
    if (index < 0) fail('column-not-found', path, `column ${name} does not exist`)
    return index
  }

  function text(tag, value, className) {
    const node = document.createElement(tag)
    if (className) node.className = className
    node.textContent = String(value)
    return node
  }

  function svgElement(tag, attributes = {}) {
    const node = document.createElementNS(SVG_NAMESPACE, tag)
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value))
    return node
  }

  function uniqueId(prefix) {
    nextId += 1
    return `${prefix}-${nextId}`
  }

  function clean(container) {
    cleanupByContainer.get(container)?.()
    cleanupByContainer.delete(container)
    container.replaceChildren()
  }

  function boundedRows(dataset, columns, maximum) {
    if (!Array.isArray(columns) || columns.length === 0) {
      fail('options-invalid', '$options.columns', 'must contain at least one column')
    }
    if (!Number.isInteger(maximum) || maximum < 1 || maximum > 1000) {
      fail('options-invalid', '$options.maxRows', 'must be an integer between 1 and 1000')
    }
    const indexes = columns.map((name, index) =>
      columnIndex(
        dataset,
        nonEmptyString(name, `$options.columns[${index}]`),
        `$options.columns[${index}]`,
      ),
    )
    return { indexes, rows: dataset.table.rows.slice(0, maximum) }
  }

  function tableFragment(dataset, options) {
    const settings = object(options, '$options')
    const caption = nonEmptyString(settings.caption, '$options.caption')
    const { indexes, rows } = boundedRows(dataset, settings.columns, settings.maxRows)
    const wrap = document.createElement('div')
    wrap.className = 'table-wrap'
    const table = document.createElement('table')
    table.className = 'data-table'
    table.append(text('caption', caption))
    const head = document.createElement('thead')
    const headRow = document.createElement('tr')
    for (const index of indexes) {
      const cell = text('th', dataset.table.columns[index].name)
      cell.scope = 'col'
      headRow.append(cell)
    }
    head.append(headRow)
    table.append(head)
    const body = document.createElement('tbody')
    for (const row of rows) {
      const tableRow = document.createElement('tr')
      for (const index of indexes) tableRow.append(text('td', row[index] ?? '—'))
      body.append(tableRow)
    }
    table.append(body)
    wrap.append(table)
    const omitted = dataset.table.rows.length - rows.length + dataset.table.omitted_rows
    if (omitted > 0)
      wrap.append(text('p', `另有 ${omitted} 行未在此表中展示。`, 'report-disclosure'))
    return wrap
  }

  function renderTable(container, dataset, options) {
    const host = element(container)
    const value = datasetValue(dataset)
    const fragment = tableFragment(value, options)
    clean(host)
    host.append(fragment)
    return host
  }

  function formatNumber(value, options = {}) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      fail('value-invalid', '$value', 'must be a finite number')
    }
    return new Intl.NumberFormat(undefined, object(options, '$options')).format(value)
  }

  function formatPercent(value, options = {}) {
    const settings = { ...object(options, '$options'), style: 'percent' }
    return formatNumber(value, settings)
  }

  function formatDate(value, options = {}) {
    const date = value instanceof Date ? value : new Date(value)
    if (!Number.isFinite(date.getTime()))
      fail('value-invalid', '$value', 'must identify a valid date')
    return new Intl.DateTimeFormat(undefined, object(options, '$options')).format(date)
  }

  function renderKpis(container, items) {
    const host = element(container)
    if (!Array.isArray(items)) fail('options-invalid', '$items', 'must be an array')
    const allowedStatuses = new Set(['neutral', 'positive', 'warning', 'critical'])
    const fragment = document.createDocumentFragment()
    items.forEach((candidate, index) => {
      const item = object(candidate, `$items[${index}]`)
      const card = document.createElement('article')
      card.className = 'kpi'
      const status = item.status ?? 'neutral'
      if (!allowedStatuses.has(status))
        fail('options-invalid', `$items[${index}].status`, 'is unsupported')
      card.dataset.status = status
      card.append(text('span', nonEmptyString(item.label, `$items[${index}].label`), 'kpi-label'))
      card.append(
        text('strong', nonEmptyString(String(item.value), `$items[${index}].value`), 'kpi-value'),
      )
      if (item.detail !== undefined) {
        card.append(
          text('span', nonEmptyString(item.detail, `$items[${index}].detail`), 'kpi-detail'),
        )
      }
      const statusLabels = {
        critical: '状态：严重',
        positive: '状态：正向',
        warning: '状态：需关注',
      }
      if (status !== 'neutral') card.append(text('span', statusLabels[status], 'kpi-status'))
      fragment.append(card)
    })
    clean(host)
    host.append(fragment)
    return host
  }

  function addDetail(list, label, value) {
    list.append(text('dt', label), text('dd', value))
  }

  function percent(value) {
    return `${formatNumber(value * 100, { maximumFractionDigits: 2 })}%`
  }

  function detailsContent(dataset) {
    const content = document.createDocumentFragment()
    content.append(text('h3', '数据与质量详情'))
    const list = document.createElement('dl')
    const source = dataset.source
    addDetail(list, '数据来源', source.kind === 'marivo_artifact' ? 'Marivo Artifact' : '计算结果')
    addDetail(list, '快照生成于', dataset.emitted_at)
    addDetail(list, '总行数', dataset.table.total_rows)
    addDetail(list, '写入行数', dataset.table.written_rows)
    addDetail(list, '省略行数', dataset.table.omitted_rows)
    if (dataset.table.omitted_rows > 0) addDetail(list, '截断状态', '图表数据已截断')
    if (source.kind === 'marivo_artifact') {
      addDetail(list, 'Artifact 生成于', source.artifact.created_at)
      const revalidation = source.revalidation
      if (revalidation.status === 'not_checked') addDetail(list, '当前状态', '当前状态未检查')
      else {
        addDetail(list, '当前状态检查', revalidation.result)
        addDetail(list, '检查于', revalidation.checked_at)
        addDetail(list, '语义状态', revalidation.semantic_status)
        addDetail(list, '依赖状态', revalidation.dependency_status)
        addDetail(list, 'Evidence 状态', revalidation.evidence_status)
        addDetail(list, '当前状态问题', revalidation.issues.length + revalidation.issues_omitted)
      }
      if (source.quality_summary === null)
        addDetail(list, 'Artifact 质量', '未提供 Artifact 质量摘要')
      else {
        const quality = source.quality_summary
        const labels = {
          coverage: ['覆盖率', percent],
          null_rate: ['空值率', percent],
          sample_size: ['样本数', String],
          sample_coverage_min: ['最小样本覆盖率', percent],
          sample_coverage_avg: ['平均样本覆盖率', percent],
          sample_coverage_partial_buckets: ['部分覆盖分桶数', String],
          zero_denominator_rows: ['零分母行数', String],
          evaluated_check_count: ['已执行检查数', String],
          failed_check_count: ['失败检查数', String],
          warning_check_count: ['警告检查数', String],
        }
        for (const [field, [label, formatter]] of Object.entries(labels)) {
          if (quality[field] !== null) addDetail(list, label, formatter(quality[field]))
        }
      }
      const issueCounts = new Map()
      for (const issue of source.issues) {
        const key = `${issue.severity} · ${issue.kind}`
        issueCounts.set(key, (issueCounts.get(key) ?? 0) + 1)
      }
      for (const [key, count] of issueCounts) addDetail(list, 'Artifact 问题', `${key}（${count}）`)
      if (source.issues_omitted > 0) addDetail(list, '省略问题数', source.issues_omitted)
    }
    content.append(list)
    return content
  }

  function needsAttention(dataset) {
    if (dataset.table.omitted_rows > 0) return true
    if (dataset.source.kind !== 'marivo_artifact') return false
    const source = dataset.source
    if (source.issues.length > 0 || source.issues_omitted > 0) return true
    if (source.revalidation.status === 'checked' && source.revalidation.result !== 'admissible')
      return true
    const quality = source.quality_summary
    return Boolean(
      quality && ((quality.failed_check_count ?? 0) > 0 || (quality.warning_check_count ?? 0) > 0),
    )
  }

  function chartTitle(container) {
    const candidate =
      container.dataset.chartTitle ||
      container.getAttribute('aria-label') ||
      container.querySelector('.chart-title')?.textContent
    return nonEmptyString(candidate, '$container.title')
  }

  function attachDataDetails(container, dataset) {
    const host = element(container)
    const value = datasetValue(dataset)
    cleanupByContainer.get(host)?.()
    const title = chartTitle(host)
    const holder = document.createElement('div')
    holder.className = 'chart-data-details'
    const trigger = document.createElement('button')
    trigger.type = 'button'
    trigger.className = 'chart-details-trigger'
    trigger.textContent = 'ⓘ'
    trigger.setAttribute('aria-label', `查看${title}的数据与质量详情`)
    trigger.setAttribute('aria-expanded', 'false')
    trigger.dataset.attention = String(needsAttention(value))
    const popover = document.createElement('section')
    const popoverId = uniqueId('chart-details')
    popover.id = popoverId
    popover.className = 'chart-details-popover'
    popover.setAttribute('aria-label', `${title}的数据与质量详情`)
    popover.append(detailsContent(value))
    const closeButton = document.createElement('button')
    closeButton.type = 'button'
    closeButton.className = 'chart-details-close'
    closeButton.textContent = '关闭'
    popover.append(closeButton)
    trigger.setAttribute('aria-controls', popoverId)
    const nativePopover =
      typeof popover.showPopover === 'function' && typeof popover.hidePopover === 'function'
    if (nativePopover) popover.setAttribute('popover', 'manual')
    else popover.hidden = true
    holder.append(trigger, popover)
    const header = host.querySelector('.chart-header')
    if (header) header.append(holder)
    else host.prepend(holder)

    let pinned = false
    let open = false
    let suppressNextFocus = false
    function show() {
      if (open) return
      open = true
      trigger.setAttribute('aria-expanded', 'true')
      if (nativePopover) popover.showPopover()
      else {
        popover.hidden = false
        popover.dataset.fallbackOpen = 'true'
      }
    }
    function hide({ focusTrigger = false } = {}) {
      if (!open) return
      open = false
      trigger.setAttribute('aria-expanded', 'false')
      if (nativePopover && popover.matches(':popover-open')) popover.hidePopover()
      else {
        popover.hidden = true
        delete popover.dataset.fallbackOpen
      }
      if (focusTrigger) {
        suppressNextFocus = true
        trigger.focus()
      }
    }
    function leave(event) {
      const next = event.relatedTarget
      if (!pinned && !(next instanceof Node && holder.contains(next))) hide()
    }
    function handleEscape(event) {
      if (event.key === 'Escape' && open) {
        pinned = false
        hide({ focusTrigger: true })
      }
    }
    function handleFocus() {
      if (suppressNextFocus) {
        suppressNextFocus = false
        return
      }
      show()
    }
    function toggle() {
      pinned = !pinned
      if (pinned) show()
      else hide()
    }
    trigger.addEventListener('pointerenter', show)
    holder.addEventListener('pointerleave', leave)
    trigger.addEventListener('focus', handleFocus)
    holder.addEventListener('focusout', leave)
    trigger.addEventListener('click', toggle)
    trigger.addEventListener('keydown', handleEscape)
    popover.addEventListener('keydown', handleEscape)
    closeButton.addEventListener('click', () => {
      pinned = false
      hide({ focusTrigger: true })
    })
    const cleanup = () => {
      hide()
      holder.remove()
    }
    cleanupByContainer.set(host, cleanup)
    return Object.freeze({ close: cleanup, popover, trigger })
  }

  function chartShell(container, titleValue, description) {
    const host = element(container)
    const titleValueChecked = nonEmptyString(titleValue, '$options.title')
    clean(host)
    host.dataset.chartTitle = titleValueChecked
    const header = document.createElement('header')
    header.className = 'chart-header'
    const heading = text('h3', titleValueChecked, 'chart-title')
    header.append(heading)
    const caption = text('figcaption', description)
    const captionId = uniqueId('chart-caption')
    caption.id = captionId
    const live = text('p', '', 'sr-only')
    live.setAttribute('aria-live', 'polite')
    const liveId = uniqueId('chart-live')
    live.id = liveId
    host.append(header)
    return { caption, captionId, host, live, liveId, title: titleValueChecked }
  }

  function fallbackDetails(dataset, fallback, describedBy) {
    const settings = object(fallback, '$options.fallback')
    const details = document.createElement('details')
    details.className = 'chart-fallback'
    const id = uniqueId('chart-fallback')
    details.id = id
    details.append(text('summary', '查看数据表'))
    details.append(tableFragment(dataset, settings))
    describedBy.push(id)
    return details
  }

  function chartSvg(shell, description, describedBy) {
    const svg = svgElement('svg', {
      class: 'chart-svg',
      role: 'group',
      viewBox: '0 0 760 380',
      'aria-describedby': describedBy.join(' '),
      'aria-labelledby': `${shell.captionId}-svg-title`,
    })
    const svgTitle = svgElement('title', { id: `${shell.captionId}-svg-title` })
    svgTitle.textContent = shell.title
    const svgDescription = svgElement('desc')
    svgDescription.textContent = description
    svg.append(svgTitle, svgDescription)
    return svg
  }

  function numericExtent(values) {
    const numeric = values.filter((value) => typeof value === 'number' && Number.isFinite(value))
    if (numeric.length === 0)
      fail('chart-data-invalid', '$dataset.table.rows', 'contains no numeric values')
    let minimum = Math.min(...numeric)
    let maximum = Math.max(...numeric)
    if (minimum === maximum) {
      const padding = Math.abs(minimum || 1) * 0.1
      minimum -= padding
      maximum += padding
    }
    return [Math.min(0, minimum), Math.max(0, maximum)]
  }

  function appendAxes(svg, minimum, maximum, xLabel, yLabel) {
    const left = 72
    const top = 28
    const width = 640
    const height = 280
    for (let index = 0; index <= 4; index += 1) {
      const y = top + (height * index) / 4
      const line = svgElement('line', {
        class: 'chart-grid-line',
        x1: left,
        x2: left + width,
        y1: y,
        y2: y,
      })
      const label = svgElement('text', { x: left - 10, y: y + 4, 'text-anchor': 'end' })
      label.textContent = formatNumber(maximum - ((maximum - minimum) * index) / 4, {
        maximumFractionDigits: 2,
      })
      svg.append(line, label)
    }
    svg.append(
      svgElement('line', {
        class: 'chart-axis-line',
        x1: left,
        x2: left,
        y1: top,
        y2: top + height,
      }),
      svgElement('line', {
        class: 'chart-axis-line',
        x1: left,
        x2: left + width,
        y1: top + height,
        y2: top + height,
      }),
    )
    const xAxisLabel = svgElement('text', { x: left + width / 2, y: 366, 'text-anchor': 'middle' })
    xAxisLabel.textContent = xLabel
    const yAxisLabel = svgElement('text', {
      transform: `translate(18 ${top + height / 2}) rotate(-90)`,
      'text-anchor': 'middle',
    })
    yAxisLabel.textContent = yLabel
    svg.append(xAxisLabel, yAxisLabel)
    return { height, left, top, width }
  }

  function appendXAxisTicks(svg, values, position, y) {
    const maximumLabels = 8
    const indexes = new Set()
    if (values.length <= maximumLabels) {
      values.forEach((_, index) => {
        indexes.add(index)
      })
    } else {
      for (let index = 0; index < maximumLabels; index += 1) {
        indexes.add(Math.round((index * (values.length - 1)) / (maximumLabels - 1)))
      }
    }
    for (const index of indexes) {
      const label = svgElement('text', {
        class: 'chart-axis-tick-label',
        x: position(values[index]),
        y,
        'text-anchor': 'middle',
      })
      label.textContent = values[index]
      svg.append(label)
    }
  }

  function renderLineChart(container, dataset, options) {
    const value = datasetValue(dataset)
    const settings = object(options, '$options')
    const xIndex = columnIndex(value, settings.x, '$options.x')
    const yIndex = columnIndex(value, settings.y, '$options.y')
    const seriesIndex =
      settings.series === undefined ? null : columnIndex(value, settings.series, '$options.series')
    const xLabel =
      settings.xLabel === undefined
        ? settings.x
        : nonEmptyString(settings.xLabel, '$options.xLabel')
    const yLabel =
      settings.yLabel === undefined
        ? settings.y
        : nonEmptyString(settings.yLabel, '$options.yLabel')
    nonEmptyString(settings.title, '$options.title')
    const fallbackSettings = object(settings.fallback, '$options.fallback')
    nonEmptyString(fallbackSettings.caption, '$options.fallback.caption')
    boundedRows(value, fallbackSettings.columns, fallbackSettings.maxRows)
    const rows = value.table.rows.filter((row) => typeof row[yIndex] === 'number')
    const [minimum, maximum] = numericExtent(rows.map((row) => row[yIndex]))
    const description = `折线图：${xLabel}与${yLabel}，按输入顺序展示。`
    const shell = chartShell(container, settings.title, description)
    const describedBy = [shell.captionId, shell.liveId]
    const fallback = fallbackDetails(value, settings.fallback, describedBy)
    const svg = chartSvg(shell, description, describedBy)
    const axis = appendAxes(svg, minimum, maximum, xLabel, yLabel)
    const xValues = [...new Set(rows.map((row) => String(row[xIndex] ?? '—')))]
    const seriesValues =
      seriesIndex === null
        ? ['数据']
        : [...new Set(rows.map((row) => String(row[seriesIndex] ?? '—')))]
    const xPosition = (label) =>
      axis.left + (axis.width * xValues.indexOf(label)) / Math.max(1, xValues.length - 1)
    appendXAxisTicks(svg, xValues, xPosition, axis.top + axis.height + 24)
    const yPosition = (numberValue) =>
      axis.top + axis.height - ((numberValue - minimum) / (maximum - minimum)) * axis.height
    seriesValues.forEach((series, seriesPosition) => {
      const color = PALETTE[seriesPosition % PALETTE.length]
      const seriesRows = rows.filter(
        (row) => seriesIndex === null || String(row[seriesIndex] ?? '—') === series,
      )
      const points = seriesRows.map(
        (row) => `${xPosition(String(row[xIndex] ?? '—'))},${yPosition(row[yIndex])}`,
      )
      svg.append(
        svgElement('polyline', {
          fill: 'none',
          points: points.join(' '),
          stroke: color,
          'stroke-width': 3,
          'stroke-dasharray':
            seriesPosition % 3 === 1 ? '8 4' : seriesPosition % 3 === 2 ? '3 3' : '',
        }),
      )
      seriesRows.forEach((row) => {
        const label = `${seriesIndex === null ? '' : `${series}，`}${row[xIndex]}：${row[yIndex]}`
        const point = svgElement('circle', {
          class: 'chart-point',
          cx: xPosition(String(row[xIndex] ?? '—')),
          cy: yPosition(row[yIndex]),
          fill: color,
          r: 5,
          role: 'img',
          tabindex: 0,
          'aria-label': label,
        })
        point.addEventListener('focus', () => {
          shell.live.textContent = label
        })
        svg.append(point)
      })
    })
    const legend = document.createElement('ul')
    legend.className = 'chart-legend'
    seriesValues.forEach((series, index) => {
      const item = document.createElement('li')
      item.style.color = PALETTE[index % PALETTE.length]
      item.append(text('span', '', 'chart-legend-key'), text('span', series))
      legend.append(item)
    })
    shell.host.append(svg, legend, shell.caption, shell.live, fallback)
    attachDataDetails(shell.host, value)
    return shell.host
  }

  function renderBarChart(container, dataset, options) {
    const value = datasetValue(dataset)
    const settings = object(options, '$options')
    const categoryIndex = columnIndex(value, settings.category, '$options.category')
    const valueIndex = columnIndex(value, settings.value, '$options.value')
    const orientation = settings.orientation ?? 'vertical'
    if (!['vertical', 'horizontal'].includes(orientation)) {
      fail('options-invalid', '$options.orientation', 'must be vertical or horizontal')
    }
    nonEmptyString(settings.title, '$options.title')
    const fallbackSettings = object(settings.fallback, '$options.fallback')
    nonEmptyString(fallbackSettings.caption, '$options.fallback.caption')
    boundedRows(value, fallbackSettings.columns, fallbackSettings.maxRows)
    const rows = value.table.rows.filter((row) => typeof row[valueIndex] === 'number')
    const [minimum, maximum] = numericExtent(rows.map((row) => row[valueIndex]))
    const description = `条形图：${settings.category}与${settings.value}，按输入顺序展示。`
    const shell = chartShell(container, settings.title, description)
    const describedBy = [shell.captionId, shell.liveId]
    const fallback = fallbackDetails(value, settings.fallback, describedBy)
    const svg = chartSvg(shell, description, describedBy)
    const left = 96
    const top = 28
    const width = 600
    const height = 290
    const scale = (numberValue) =>
      ((numberValue - minimum) / (maximum - minimum)) *
      (orientation === 'vertical' ? height : width)
    const band = (orientation === 'vertical' ? width : height) / Math.max(1, rows.length)
    const zero = scale(0)
    rows.forEach((row, index) => {
      const magnitude = scale(row[valueIndex])
      const label = `${row[categoryIndex]}：${row[valueIndex]}`
      const rectangle =
        orientation === 'vertical'
          ? svgElement('rect', {
              class: 'chart-point',
              x: left + band * index + band * 0.14,
              y: top + height - Math.max(zero, magnitude),
              width: band * 0.72,
              height: Math.abs(magnitude - zero),
              fill: PALETTE[index % PALETTE.length],
              role: 'img',
              tabindex: 0,
              'aria-label': label,
            })
          : svgElement('rect', {
              class: 'chart-point',
              x: left + Math.min(zero, magnitude),
              y: top + band * index + band * 0.14,
              width: Math.abs(magnitude - zero),
              height: band * 0.72,
              fill: PALETTE[index % PALETTE.length],
              role: 'img',
              tabindex: 0,
              'aria-label': label,
            })
      rectangle.addEventListener('focus', () => {
        shell.live.textContent = label
      })
      svg.append(rectangle)
      const categoryLabel = svgElement(
        'text',
        orientation === 'vertical'
          ? { x: left + band * index + band / 2, y: 344, 'text-anchor': 'middle' }
          : { x: left - 10, y: top + band * index + band / 2 + 4, 'text-anchor': 'end' },
      )
      categoryLabel.textContent = String(row[categoryIndex] ?? '—')
      svg.append(categoryLabel)
    })
    shell.host.append(svg, shell.caption, shell.live, fallback)
    attachDataDetails(shell.host, value)
    return shell.host
  }

  const api = Object.freeze({
    attachDataDetails,
    formatDate,
    formatNumber,
    formatPercent,
    renderBarChart,
    renderKpis,
    renderLineChart,
    renderTable,
  })
  Object.defineProperty(scope, 'ReportCharts', {
    configurable: false,
    enumerable: true,
    value: api,
    writable: false,
  })
})(globalThis)
