;(function installMarivoArtifact(scope) {
  class MarivoArtifactError extends Error {
    constructor(code, message) {
      super(`${code}: ${message}`)
      this.name = 'MarivoArtifactError'
      this.code = code
    }
  }

  function fail(code, message) {
    throw new MarivoArtifactError(code, message)
  }

  function text(tag, value, className) {
    const element = document.createElement(tag)
    if (className) element.className = className
    element.textContent = String(value)
    return element
  }

  function notice(message, level) {
    const item = text('li', message, 'marivo-artifact-notice')
    item.dataset.level = level
    return item
  }

  function artifactDataset(datasetId) {
    const registry = scope.ReportData
    if (!registry || typeof registry.get !== 'function') {
      fail('report-data-unavailable', 'ReportData must be loaded before MarivoArtifact')
    }
    const dataset = registry.get(datasetId)
    if (dataset.source.kind !== 'marivo_artifact') {
      fail('artifact-dataset-required', 'dataset must be a Marivo Artifact snapshot')
    }
    return dataset
  }

  function summary(dataset) {
    const parts = [dataset.source.artifact.kind]
    if (dataset.table.semantic_shape !== null) parts.push(dataset.table.semantic_shape)
    parts.push(`${dataset.table.total_rows} 行`)
    parts.push(`结果生成于 ${dataset.source.artifact.created_at}`)
    return parts.join(' · ')
  }

  function notices(dataset) {
    const source = dataset.source
    const result = []
    if (dataset.table.omitted_rows > 0) {
      result.push(
        notice(
          `展示数据已截断：显示 ${dataset.table.written_rows} 行，共 ${dataset.table.total_rows} 行。`,
          'warning',
        ),
      )
    }
    if (source.artifact.evidence_status === 'partial') {
      result.push(notice('分析依据不完整。', 'warning'))
    } else if (source.artifact.evidence_status === 'unavailable') {
      result.push(notice('分析依据不可用。', 'blocking'))
    }
    if (source.revalidation.status === 'checked') {
      if (source.revalidation.result === 'stale') {
        result.push(notice('当前有效性复核结果为 stale。', 'warning'))
      } else if (source.revalidation.result === 'indeterminate') {
        result.push(notice('当前有效性复核结果无法确定。', 'warning'))
      }
    }
    const quality = source.quality_summary
    if (quality !== null) {
      if (quality.failed_check_count > 0) {
        result.push(notice(`存在 ${quality.failed_check_count} 项未通过的质量检查。`, 'blocking'))
      }
      if (quality.warning_check_count > 0) {
        result.push(notice(`存在 ${quality.warning_check_count} 项质量警告。`, 'warning'))
      }
    }
    const blocking = source.issues.filter((issue) => issue.severity === 'blocking').length
    const warnings = source.issues.filter((issue) => issue.severity === 'warning').length
    if (blocking > 0) result.push(notice(`存在 ${blocking} 个阻断问题。`, 'blocking'))
    if (warnings > 0) result.push(notice(`存在 ${warnings} 个警告问题。`, 'warning'))
    if (source.issues_omitted > 0) {
      result.push(notice(`另有 ${source.issues_omitted} 个问题未在快照中展开。`, 'warning'))
    }
    return result
  }

  function render(container, datasetId) {
    if (!(container instanceof Element)) fail('container-invalid', 'container must be an Element')
    const dataset = artifactDataset(datasetId)
    const article = document.createElement('article')
    article.className = 'marivo-artifact'
    article.append(text('p', summary(dataset), 'marivo-artifact-summary'))
    const material = notices(dataset)
    if (material.length > 0) {
      const list = document.createElement('ul')
      list.className = 'marivo-artifact-notices'
      list.append(...material)
      article.append(list)
    }
    container.replaceChildren(article)
    return container
  }

  const api = Object.freeze({ render })
  Object.defineProperty(scope, 'MarivoArtifact', {
    configurable: false,
    enumerable: true,
    value: api,
    writable: false,
  })
})(globalThis)
