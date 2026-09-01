;((scope) => {
  const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
  const TRACE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
  const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
  const FAMILIES = new Set([
    'MetricFrame',
    'EventFrame',
    'LifecycleFrame',
    'SubjectSet',
    'DeltaFrame',
    'AttributionFrame',
    'ForecastFrame',
    'CandidateSet',
    'AssociationResult',
    'ComponentFrame',
    'CoverageFrame',
    'HypothesisTestResult',
  ])
  const traces = new Map()
  let nextId = 0

  class ReportTraceError extends Error {
    constructor(code, path, message) {
      super(`${path}: ${message}`)
      this.name = 'ReportTraceError'
      this.code = code
      this.path = path
    }
  }

  function fail(path, message, code = 'trace-invalid') {
    throw new ReportTraceError(code, path, message)
  }

  function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  function object(value, path) {
    if (!isObject(value)) fail(path, 'must be an object')
    return value
  }

  function exactKeys(value, path, required) {
    const allowed = new Set(required)
    for (const key of required) {
      if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, 'is required')
    }
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) fail(`${path}.${key}`, 'is not allowed')
    }
  }

  function string(value, path, nullable = false) {
    if (nullable && value === null) return
    if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
      fail(path, 'must be a non-empty bounded string')
    }
  }

  function timestamp(value, path) {
    if (
      typeof value !== 'string' ||
      !TIMESTAMP.test(value) ||
      !Number.isFinite(Date.parse(value))
    ) {
      fail(path, 'must be an RFC 3339 timestamp')
    }
  }

  function integer(value, path, nullable = false) {
    if (nullable && value === null) return
    if (!Number.isSafeInteger(value) || value < 0) fail(path, 'must be a non-negative safe integer')
  }

  function number(value, path) {
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
      fail(path, 'must be null or a finite number')
    }
  }

  function identityArray(value, path, maximum = Number.MAX_SAFE_INTEGER) {
    if (!Array.isArray(value) || value.length > maximum) {
      fail(path, `must contain at most ${maximum} identities`)
    }
    const seen = new Set()
    value.forEach((item, index) => {
      string(item, `${path}[${index}]`)
      if (seen.has(item)) fail(`${path}[${index}]`, 'must be unique')
      seen.add(item)
    })
    return seen
  }

  function validateQuality(value, path) {
    if (value === null) return
    const quality = object(value, path)
    const fields = [
      'coverage',
      'null_rate',
      'sample_size',
      'sample_coverage_min',
      'sample_coverage_avg',
      'sample_coverage_partial_buckets',
      'zero_denominator_rows',
      'evaluated_check_count',
      'failed_check_count',
      'warning_check_count',
    ]
    exactKeys(quality, path, fields)
    for (const field of ['coverage', 'null_rate', 'sample_coverage_min', 'sample_coverage_avg']) {
      number(quality[field], `${path}.${field}`)
    }
    for (const field of fields.filter(
      (candidate) =>
        !['coverage', 'null_rate', 'sample_coverage_min', 'sample_coverage_avg'].includes(
          candidate,
        ),
    )) {
      integer(quality[field], `${path}.${field}`, true)
    }
  }

  function validateArtifact(value, path) {
    const artifact = object(value, path)
    exactKeys(artifact, path, [
      'ref',
      'family',
      'semantic_shape',
      'created_at',
      'produced_by_run',
      'analysis_purpose',
      'row_count',
      'materialization',
      'evidence',
      'quality',
      'issue_counts',
    ])
    string(artifact.ref, `${path}.ref`)
    if (!FAMILIES.has(artifact.family)) fail(`${path}.family`, 'is unsupported')
    string(artifact.semantic_shape, `${path}.semantic_shape`, true)
    timestamp(artifact.created_at, `${path}.created_at`)
    string(artifact.produced_by_run, `${path}.produced_by_run`, true)
    string(artifact.analysis_purpose, `${path}.analysis_purpose`, true)
    integer(artifact.row_count, `${path}.row_count`)
    if (!['materialized', 'recomputed', 'partial'].includes(artifact.materialization)) {
      fail(`${path}.materialization`, 'is unsupported')
    }
    const evidence = object(artifact.evidence, `${path}.evidence`)
    exactKeys(evidence, `${path}.evidence`, [
      'status',
      'finding_count',
      'digest_present',
      'digest_item_count',
      'omitted_item_count',
    ])
    if (!['complete', 'partial', 'unavailable'].includes(evidence.status)) {
      fail(`${path}.evidence.status`, 'is unsupported')
    }
    integer(evidence.finding_count, `${path}.evidence.finding_count`)
    if (typeof evidence.digest_present !== 'boolean') {
      fail(`${path}.evidence.digest_present`, 'must be boolean')
    }
    integer(evidence.digest_item_count, `${path}.evidence.digest_item_count`)
    integer(evidence.omitted_item_count, `${path}.evidence.omitted_item_count`)
    validateQuality(artifact.quality, `${path}.quality`)
    const issueCounts = object(artifact.issue_counts, `${path}.issue_counts`)
    exactKeys(issueCounts, `${path}.issue_counts`, ['warning', 'blocking'])
    integer(issueCounts.warning, `${path}.issue_counts.warning`)
    integer(issueCounts.blocking, `${path}.issue_counts.blocking`)
    return artifact
  }

  function validateRun(value, path) {
    const run = object(value, path)
    string(run.lifecycle, `${path}.lifecycle`)
    const common = [
      'run_id',
      'lifecycle',
      'capability_id',
      'analysis_purpose',
      'input_artifact_refs',
      'started_at',
    ]
    if (run.lifecycle === 'incomplete') exactKeys(run, path, common)
    else if (run.lifecycle === 'succeeded') {
      exactKeys(run, path, [...common, 'finished_at', 'output_artifact_ref', 'output_mode'])
    } else if (run.lifecycle === 'failed') exactKeys(run, path, [...common, 'failed_at', 'failure'])
    else fail(`${path}.lifecycle`, 'is unsupported')
    string(run.run_id, `${path}.run_id`)
    string(run.capability_id, `${path}.capability_id`)
    string(run.analysis_purpose, `${path}.analysis_purpose`, true)
    identityArray(run.input_artifact_refs, `${path}.input_artifact_refs`)
    timestamp(run.started_at, `${path}.started_at`)
    if (run.lifecycle === 'succeeded') {
      timestamp(run.finished_at, `${path}.finished_at`)
      string(run.output_artifact_ref, `${path}.output_artifact_ref`)
      if (!['produced', 'reused'].includes(run.output_mode))
        fail(`${path}.output_mode`, 'is unsupported')
    }
    if (run.lifecycle === 'failed') {
      timestamp(run.failed_at, `${path}.failed_at`)
      const failure = object(run.failure, `${path}.failure`)
      exactKeys(failure, `${path}.failure`, ['error_type', 'location'])
      string(failure.error_type, `${path}.failure.error_type`)
      string(failure.location, `${path}.failure.location`, true)
    }
    return run
  }

  function sameSet(left, right) {
    return left.size === right.size && [...left].every((value) => right.has(value))
  }

  function validateTrace(value, registrationId) {
    const trace = object(value, '$')
    exactKeys(trace, '$', [
      'schema',
      'trace_id',
      'emitted_at',
      'session_id',
      'report_artifact_refs',
      'artifacts',
      'runs',
      'edges',
      'root_run_ids',
      'head_artifact_refs',
      'failed_run_ids',
      'incomplete_run_ids',
      'boundary_artifact_refs',
      'boundary_run_ids',
      'truncated',
      'projection',
      'read_boundaries',
    ])
    if (trace.schema !== 'dsh-data-analysis-session-trace/v1') fail('$.schema', 'is unsupported')
    if (typeof trace.trace_id !== 'string' || !TRACE_ID.test(trace.trace_id))
      fail('$.trace_id', 'is invalid')
    if (trace.trace_id !== registrationId) {
      fail('$.trace_id', 'must match the registered id', 'trace-id-mismatch')
    }
    timestamp(trace.emitted_at, '$.emitted_at')
    string(trace.session_id, '$.session_id')
    const reportRefs = identityArray(trace.report_artifact_refs, '$.report_artifact_refs', 20)
    if (reportRefs.size === 0) fail('$.report_artifact_refs', 'must not be empty')
    if (!Array.isArray(trace.artifacts) || trace.artifacts.length > 200) {
      fail('$.artifacts', 'must contain at most 200 Artifacts')
    }
    if (!Array.isArray(trace.runs) || trace.runs.length > 200)
      fail('$.runs', 'must contain at most 200 Runs')
    if (trace.artifacts.length + trace.runs.length > 200)
      fail('$', 'must contain at most 200 nodes')
    const artifacts = trace.artifacts.map((artifact, index) =>
      validateArtifact(artifact, `$.artifacts[${index}]`),
    )
    const runs = trace.runs.map((run, index) => validateRun(run, `$.runs[${index}]`))
    const artifactSet = new Set(artifacts.map((artifact) => artifact.ref))
    const runSet = new Set(runs.map((run) => run.run_id))
    if (artifactSet.size !== artifacts.length) fail('$.artifacts', 'refs must be unique')
    if (runSet.size !== runs.length) fail('$.runs', 'run_ids must be unique')
    for (const ref of reportRefs)
      if (!artifactSet.has(ref)) fail('$.report_artifact_refs', 'contains a dangling ref')

    const roots = identityArray(trace.root_run_ids, '$.root_run_ids')
    const heads = identityArray(trace.head_artifact_refs, '$.head_artifact_refs')
    const failed = identityArray(trace.failed_run_ids, '$.failed_run_ids')
    const incomplete = identityArray(trace.incomplete_run_ids, '$.incomplete_run_ids')
    const boundaryArtifacts = identityArray(
      trace.boundary_artifact_refs,
      '$.boundary_artifact_refs',
    )
    const boundaryRuns = identityArray(trace.boundary_run_ids, '$.boundary_run_ids')
    for (const id of [...roots, ...failed, ...incomplete, ...boundaryRuns]) {
      if (!runSet.has(id)) fail('$', 'contains a dangling Run identity')
    }
    for (const ref of [...heads, ...boundaryArtifacts]) {
      if (!artifactSet.has(ref)) fail('$', 'contains a dangling Artifact identity')
    }
    if (typeof trace.truncated !== 'boolean') fail('$.truncated', 'must be boolean')
    if (!trace.truncated && (boundaryArtifacts.size > 0 || boundaryRuns.size > 0)) {
      fail('$', 'boundary identities require truncated=true')
    }
    const actualRoots = new Set(
      runs.filter((run) => run.input_artifact_refs.length === 0).map((run) => run.run_id),
    )
    const actualFailed = new Set(
      runs.filter((run) => run.lifecycle === 'failed').map((run) => run.run_id),
    )
    const actualIncomplete = new Set(
      runs.filter((run) => run.lifecycle === 'incomplete').map((run) => run.run_id),
    )
    if (!sameSet(roots, actualRoots)) fail('$.root_run_ids', 'must exactly match root Runs')
    if (!sameSet(failed, actualFailed)) fail('$.failed_run_ids', 'must exactly match failed Runs')
    if (!sameSet(incomplete, actualIncomplete))
      fail('$.incomplete_run_ids', 'must exactly match incomplete Runs')

    if (!Array.isArray(trace.edges) || trace.edges.length > 1000)
      fail('$.edges', 'must contain at most 1000 edges')
    const edgeKeys = new Set()
    const graphNodes = [
      ...runs.map((run) => `run:${run.run_id}`),
      ...artifacts.map((artifact) => `artifact:${artifact.ref}`),
    ]
    const outgoing = new Map(graphNodes.map((node) => [node, new Set()]))
    const indegree = new Map(graphNodes.map((node) => [node, 0]))
    trace.edges.forEach((candidate, index) => {
      const path = `$.edges[${index}]`
      const edge = object(candidate, path)
      exactKeys(edge, path, ['kind', 'run_id', 'artifact_ref'])
      if (!['consumes', 'produces', 'reuses'].includes(edge.kind))
        fail(`${path}.kind`, 'is unsupported')
      string(edge.run_id, `${path}.run_id`)
      string(edge.artifact_ref, `${path}.artifact_ref`)
      if (!runSet.has(edge.run_id) || !artifactSet.has(edge.artifact_ref))
        fail(path, 'contains a dangling identity')
      const key = `${edge.kind}\u0000${edge.run_id}\u0000${edge.artifact_ref}`
      if (edgeKeys.has(key)) fail(path, 'must be unique')
      edgeKeys.add(key)
      const run = runs.find((item) => item.run_id === edge.run_id)
      if (edge.kind === 'consumes' && !run.input_artifact_refs.includes(edge.artifact_ref)) {
        fail(path, 'disagrees with Run inputs')
      }
      if (edge.kind !== 'consumes') {
        const mode = edge.kind === 'produces' ? 'produced' : 'reused'
        if (
          run.lifecycle !== 'succeeded' ||
          run.output_mode !== mode ||
          run.output_artifact_ref !== edge.artifact_ref
        ) {
          fail(path, 'disagrees with succeeded Run output')
        }
      }
      const source =
        edge.kind === 'consumes' ? `artifact:${edge.artifact_ref}` : `run:${edge.run_id}`
      const target =
        edge.kind === 'consumes' ? `run:${edge.run_id}` : `artifact:${edge.artifact_ref}`
      if (!outgoing.get(source).has(target)) {
        outgoing.get(source).add(target)
        indegree.set(target, indegree.get(target) + 1)
      }
    })
    for (const run of runs) {
      for (const ref of run.input_artifact_refs) {
        if (!artifactSet.has(ref) && !boundaryRuns.has(run.run_id))
          fail('$.runs', 'contains a dangling input ref')
        if (artifactSet.has(ref) && !edgeKeys.has(`consumes\u0000${run.run_id}\u0000${ref}`)) {
          fail('$.runs', 'is missing a consumes edge')
        }
      }
      if (run.lifecycle === 'succeeded') {
        if (!artifactSet.has(run.output_artifact_ref) && !boundaryRuns.has(run.run_id)) {
          fail('$.runs', 'contains a dangling output ref')
        }
        const kind = run.output_mode === 'reused' ? 'reuses' : 'produces'
        if (
          artifactSet.has(run.output_artifact_ref) &&
          !edgeKeys.has(`${kind}\u0000${run.run_id}\u0000${run.output_artifact_ref}`)
        ) {
          fail('$.runs', 'is missing an output edge')
        }
      }
    }
    for (const artifact of artifacts) {
      if (
        artifact.produced_by_run !== null &&
        !runSet.has(artifact.produced_by_run) &&
        !boundaryArtifacts.has(artifact.ref)
      ) {
        fail('$.artifacts', 'contains a dangling producer')
      }
      if (artifact.produced_by_run !== null && runSet.has(artifact.produced_by_run)) {
        const producer = runs.find((run) => run.run_id === artifact.produced_by_run)
        if (
          producer.lifecycle !== 'succeeded' ||
          producer.output_mode !== 'produced' ||
          producer.output_artifact_ref !== artifact.ref
        ) {
          fail('$.artifacts', 'producer disagrees with the Artifact')
        }
      }
    }
    const ready = graphNodes.filter((node) => indegree.get(node) === 0)
    let visited = 0
    while (ready.length > 0) {
      const node = ready.shift()
      visited += 1
      for (const target of outgoing.get(node)) {
        indegree.set(target, indegree.get(target) - 1)
        if (indegree.get(target) === 0) ready.push(target)
      }
    }
    if (visited !== graphNodes.length) fail('$.edges', 'must form an acyclic graph')

    const consumers = new Set(
      runs.filter((run) => run.lifecycle === 'succeeded').flatMap((run) => run.input_artifact_refs),
    )
    const actualLocalHeads = new Set(
      artifacts
        .filter((artifact) => !boundaryArtifacts.has(artifact.ref) && !consumers.has(artifact.ref))
        .map((artifact) => artifact.ref),
    )
    const listedLocalHeads = new Set([...heads].filter((ref) => !boundaryArtifacts.has(ref)))
    if (!sameSet(listedLocalHeads, actualLocalHeads)) {
      fail('$.head_artifact_refs', 'must exactly match non-boundary graph heads')
    }

    const projection = object(trace.projection, '$.projection')
    exactKeys(projection, '$.projection', ['run_arguments', 'failure_values'])
    if (projection.run_arguments !== 'omitted' || projection.failure_values !== 'omitted') {
      fail('$.projection', 'must omit private values')
    }
    if (
      !Array.isArray(trace.read_boundaries) ||
      trace.read_boundaries.length !== 3 ||
      trace.read_boundaries[0] !== 'semantic_authority_not_checked' ||
      trace.read_boundaries[1] !== 'datasource_freshness_not_checked' ||
      trace.read_boundaries[2] !== 'report_entailment_not_checked'
    ) {
      fail('$.read_boundaries', 'must contain the closed V1 boundary sequence')
    }
    return trace
  }

  function deepFreeze(value, seen = new WeakSet()) {
    if ((!isObject(value) && !Array.isArray(value)) || seen.has(value)) return value
    seen.add(value)
    for (const child of Object.values(value)) deepFreeze(child, seen)
    return Object.freeze(value)
  }

  function validateId(id) {
    if (typeof id !== 'string' || !TRACE_ID.test(id)) fail('$id', 'is invalid', 'trace-id-invalid')
  }

  function register(id, trace) {
    validateId(id)
    if (traces.has(id)) fail('$id', 'is already registered', 'trace-id-duplicate')
    traces.set(id, deepFreeze(validateTrace(trace, id)))
  }

  function get(id) {
    validateId(id)
    const trace = traces.get(id)
    if (!trace) fail('$id', 'is not registered', 'trace-not-found')
    return trace
  }

  function has(id) {
    validateId(id)
    return traces.has(id)
  }

  function list() {
    return Object.freeze([...traces.keys()])
  }

  function svgElement(tag, attributes = {}) {
    const node = document.createElementNS(SVG_NAMESPACE, tag)
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value))
    return node
  }

  function text(tag, value, className) {
    const node = document.createElement(tag)
    if (className) node.className = className
    node.textContent = String(value)
    return node
  }

  function runLabel(run) {
    return run.analysis_purpose || run.capability_id
  }

  function artifactLabel(artifact) {
    return artifact.family
  }

  function compactLabel(value) {
    return value.length <= 18 ? value : `${value.slice(0, 17)}…`
  }

  function graphComponents(trace) {
    const ordered = [
      ...trace.runs.map((run) => `run:${run.run_id}`),
      ...trace.artifacts.map((artifact) => `artifact:${artifact.ref}`),
    ]
    const neighbors = new Map(ordered.map((node) => [node, new Set()]))
    for (const edge of trace.edges) {
      const run = `run:${edge.run_id}`
      const artifact = `artifact:${edge.artifact_ref}`
      neighbors.get(run).add(artifact)
      neighbors.get(artifact).add(run)
    }
    const seen = new Set()
    const components = []
    for (const start of ordered) {
      if (seen.has(start)) continue
      const pending = [start]
      const nodes = new Set()
      while (pending.length > 0) {
        const node = pending.shift()
        if (seen.has(node)) continue
        seen.add(node)
        nodes.add(node)
        for (const neighbor of neighbors.get(node)) if (!seen.has(neighbor)) pending.push(neighbor)
      }
      components.push({
        nodes,
        runs: trace.runs.filter((run) => nodes.has(`run:${run.run_id}`)),
        artifacts: trace.artifacts.filter((artifact) => nodes.has(`artifact:${artifact.ref}`)),
        edges: trace.edges.filter(
          (edge) => nodes.has(`run:${edge.run_id}`) && nodes.has(`artifact:${edge.artifact_ref}`),
        ),
      })
    }
    return components
  }

  function positions(component) {
    const ordered = [
      ...component.runs.map((run) => `run:${run.run_id}`),
      ...component.artifacts.map((artifact) => `artifact:${artifact.ref}`),
    ]
    const predecessor = new Map(ordered.map((node) => [node, []]))
    for (const edge of component.edges) {
      const source =
        edge.kind === 'consumes' ? `artifact:${edge.artifact_ref}` : `run:${edge.run_id}`
      const target =
        edge.kind === 'consumes' ? `run:${edge.run_id}` : `artifact:${edge.artifact_ref}`
      predecessor.get(target).push(source)
    }
    const levels = new Map()
    while (levels.size < ordered.length) {
      let progressed = false
      for (const node of ordered) {
        if (levels.has(node)) continue
        const parents = predecessor.get(node)
        if (parents.every((parent) => levels.has(parent))) {
          levels.set(
            node,
            parents.length === 0 ? 0 : Math.max(...parents.map((parent) => levels.get(parent))) + 1,
          )
          progressed = true
        }
      }
      if (!progressed) fail('$.edges', 'cannot lay out a cyclic graph')
    }
    const byLevel = new Map()
    for (const node of ordered) {
      const level = levels.get(node)
      const nodes = byLevel.get(level) ?? []
      nodes.push(node)
      byLevel.set(level, nodes)
    }
    const result = new Map()
    for (const [level, nodes] of byLevel) {
      nodes.forEach((node, index) => {
        result.set(node, { x: 40 + level * 230, y: 40 + index * 126 })
      })
    }
    return result
  }

  function nodeGroup(kind, title, subtitle, position, attributes, live, activate) {
    const group = svgElement('g', {
      class:
        attributes['data-boundary'] === 'true' ? 'trace-node trace-boundary-node' : 'trace-node',
      'data-node-kind': kind,
      role: 'button',
      tabindex: 0,
      transform: `translate(${position.x} ${position.y})`,
      'aria-label': `${kind === 'run' ? '分析动作' : 'Frame'}：${title}；${subtitle}`,
      ...attributes,
    })
    if (kind === 'run') group.append(svgElement('rect', { width: 170, height: 76, rx: 12 }))
    else group.append(svgElement('path', { d: 'M18 0 H152 L170 38 L152 76 H18 L0 38 Z' }))
    const heading = svgElement('text', { x: 85, y: 31, 'text-anchor': 'middle' })
    heading.textContent = compactLabel(title)
    const detail = svgElement('text', { x: 85, y: 53, 'text-anchor': 'middle' })
    detail.textContent = compactLabel(subtitle)
    group.append(heading, detail)
    group.addEventListener('focus', () => {
      live.textContent = `${kind === 'run' ? '分析动作' : 'Frame'}：${title}；${subtitle}`
    })
    group.addEventListener('click', activate)
    group.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') activate()
    })
    return group
  }

  function definitionList(entries, className = 'trace-detail-list') {
    const list = document.createElement('dl')
    list.className = className
    for (const [label, value] of entries) {
      list.append(text('dt', label), text('dd', value === null || value === '' ? '—' : value))
    }
    return list
  }

  function elapsed(startedAt, finishedAt) {
    if (!finishedAt) return '进行中'
    return `${Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt))} ms`
  }

  function matchingDataset(sessionId, artifactRef) {
    const registry = scope.ReportData
    if (!registry || typeof registry.list !== 'function') return null
    for (const id of registry.list()) {
      const dataset = registry.get(id)
      if (
        dataset.source.kind === 'marivo_artifact' &&
        dataset.source.artifact.session_id === sessionId &&
        dataset.source.artifact.ref === artifactRef
      ) {
        return dataset
      }
    }
    return null
  }

  function previewTable(dataset) {
    const section = document.createElement('section')
    section.className = 'trace-frame-preview'
    section.append(text('h5', '数据预览'))
    section.append(
      text(
        'p',
        `显示 ${Math.min(10, dataset.table.rows.length)} / 快照 ${dataset.table.written_rows} / 总计 ${dataset.table.total_rows} / 省略 ${dataset.table.omitted_rows} 行`,
        'trace-frame-count',
      ),
    )
    const wrap = document.createElement('div')
    wrap.className = 'table-wrap trace-frame-table-wrap'
    const table = document.createElement('table')
    table.className = 'data-table trace-frame-table'
    table.append(text('caption', 'Artifact dataset 有界预览', 'sr-only'))
    const header = document.createElement('tr')
    for (const column of dataset.table.columns) {
      const cell = text('th', column.name)
      cell.scope = 'col'
      header.append(cell)
    }
    const head = document.createElement('thead')
    head.append(header)
    const body = document.createElement('tbody')
    for (const row of dataset.table.rows.slice(0, 10)) {
      const item = document.createElement('tr')
      for (const value of row) item.append(text('td', value === null ? '—' : value))
      body.append(item)
    }
    table.append(head, body)
    wrap.append(table)
    section.append(wrap)
    return section
  }

  function runDetail(trace, run) {
    const article = document.createElement('article')
    article.className = 'trace-detail'
    article.dataset.nodeKey = `run:${run.run_id}`
    article.append(text('p', `分析动作 · ${run.lifecycle}`, 'trace-detail-kind'))
    article.append(text('h4', runLabel(run)))
    const inputFrames = run.input_artifact_refs
      .map((ref) => trace.artifacts.find((artifact) => artifact.ref === ref))
      .filter(Boolean)
      .map(artifactLabel)
    const outputFrame =
      run.lifecycle === 'succeeded'
        ? trace.artifacts.find((artifact) => artifact.ref === run.output_artifact_ref)
        : null
    const entries = [
      ['能力', run.capability_id],
      ['状态', run.lifecycle],
      ['开始', run.started_at],
      [
        run.lifecycle === 'failed' ? '失败' : '完成',
        run.lifecycle === 'succeeded'
          ? run.finished_at
          : run.lifecycle === 'failed'
            ? run.failed_at
            : null,
      ],
      [
        '耗时',
        elapsed(
          run.started_at,
          run.lifecycle === 'succeeded'
            ? run.finished_at
            : run.lifecycle === 'failed'
              ? run.failed_at
              : null,
        ),
      ],
      ['输入 Frame', inputFrames.join('、') || '无'],
    ]
    if (run.lifecycle === 'succeeded') {
      entries.push(['输出 Frame', outputFrame ? artifactLabel(outputFrame) : '链路边界外'])
      entries.push(['输出模式', run.output_mode])
    }
    if (run.lifecycle === 'failed') entries.push(['失败类型', run.failure.error_type])
    article.append(definitionList(entries))
    return article
  }

  function artifactDetail(trace, artifact) {
    const article = document.createElement('article')
    article.className = 'trace-detail'
    article.dataset.nodeKey = `artifact:${artifact.ref}`
    article.append(text('p', `Frame · ${artifact.materialization}`, 'trace-detail-kind'))
    article.append(text('h4', artifactLabel(artifact)))
    article.append(
      definitionList([
        ['Frame', artifact.family],
        ['语义形状', artifact.semantic_shape],
        ['创建', artifact.created_at],
        ['分析目的', artifact.analysis_purpose],
        ['行数', artifact.row_count],
        ['Evidence', `${artifact.evidence.status} · ${artifact.evidence.finding_count} 条 Finding`],
        [
          '质量',
          artifact.quality === null
            ? '未评估或不适用'
            : `coverage ${artifact.quality.coverage ?? '—'} · null rate ${artifact.quality.null_rate ?? '—'}`,
        ],
        [
          '问题',
          `${artifact.issue_counts.warning} warning · ${artifact.issue_counts.blocking} blocking`,
        ],
      ]),
    )
    const dataset = matchingDataset(trace.session_id, artifact.ref)
    if (dataset) article.append(previewTable(dataset))
    else article.append(text('p', '此页面未注册该 Artifact 的 dataset 预览。', 'trace-frame-count'))
    return article
  }

  function traceLegend(trace, componentCount) {
    const counts = [
      `${trace.runs.length} 个分析动作`,
      `${trace.artifacts.length} 个 Frame`,
      `${componentCount} 条链路`,
    ]
    const overview = document.createElement('header')
    overview.className = 'trace-overview'
    overview.append(text('p', counts.join(' · '), 'trace-count'))
    const legend = document.createElement('div')
    legend.className = 'trace-legend'
    for (const [label, className] of [
      ['分析动作', 'trace-legend-run'],
      ['Frame', 'trace-legend-artifact'],
    ]) {
      legend.append(text('span', label, className))
    }
    overview.append(legend)
    return overview
  }

  function readBoundaryDisclosure() {
    return text(
      'p',
      '该链路记录分析执行关系，不证明当前语义权威、数据源新鲜度或报告结论正确性。',
      'trace-boundary',
    )
  }

  function renderComponent(trace, component, componentIndex, live) {
    const section = document.createElement('section')
    section.className = 'trace-component'
    const heading = document.createElement('div')
    heading.className = 'trace-component-heading'
    heading.append(text('h3', `分析链路 ${componentIndex + 1}`))
    const controls = document.createElement('div')
    controls.className = 'trace-controls'
    controls.setAttribute('aria-label', '链路缩放')
    heading.append(controls)
    section.append(heading)

    const workspace = document.createElement('div')
    workspace.className = 'trace-workspace'
    const canvasWrap = document.createElement('div')
    canvasWrap.className = 'trace-canvas-wrap'
    const detailsPanel = document.createElement('aside')
    detailsPanel.className = 'trace-detail-panel'
    detailsPanel.setAttribute('aria-live', 'polite')
    const detailByKey = new Map()
    for (const run of component.runs) {
      const detail = runDetail(trace, run)
      detailByKey.set(`run:${run.run_id}`, detail)
      detailsPanel.append(detail)
    }
    for (const artifact of component.artifacts) {
      const detail = artifactDetail(trace, artifact)
      detailByKey.set(`artifact:${artifact.ref}`, detail)
      detailsPanel.append(detail)
    }
    const nodesByKey = new Map()
    const activate = (key) => {
      for (const [candidate, detail] of detailByKey) {
        const selected = candidate === key
        detail.hidden = !selected
        detail.dataset.active = String(selected)
        detail.setAttribute('aria-hidden', String(!selected))
      }
      for (const [candidate, node] of nodesByKey) node.dataset.selected = String(candidate === key)
    }

    const layout = positions(component)
    const maxX = Math.max(...[...layout.values()].map((position) => position.x), 40)
    const maxY = Math.max(...[...layout.values()].map((position) => position.y), 40)
    const svgId = ++nextId
    const svg = svgElement('svg', {
      class: 'trace-svg',
      role: 'group',
      viewBox: `0 0 ${maxX + 230} ${maxY + 130}`,
      'aria-labelledby': `trace-title-${svgId}`,
    })
    const title = svgElement('title', { id: `trace-title-${svgId}` })
    title.textContent = `分析链路 ${componentIndex + 1}`
    const description = svgElement('desc')
    description.textContent =
      '选择分析动作或 Frame 节点可查看审计详情；成功状态不表示报告结论可信。'
    const definitions = svgElement('defs')
    const marker = svgElement('marker', {
      id: `trace-arrow-${svgId}`,
      markerHeight: 8,
      markerWidth: 8,
      orient: 'auto',
      refX: 7,
      refY: 4,
      viewBox: '0 0 8 8',
    })
    marker.append(svgElement('path', { d: 'M0 0 L8 4 L0 8 Z', fill: 'currentColor' }))
    definitions.append(marker)
    const viewport = svgElement('g', { 'data-trace-viewport': '' })
    svg.append(title, description, definitions, viewport)
    for (const edge of component.edges) {
      const sourceKey =
        edge.kind === 'consumes' ? `artifact:${edge.artifact_ref}` : `run:${edge.run_id}`
      const targetKey =
        edge.kind === 'consumes' ? `run:${edge.run_id}` : `artifact:${edge.artifact_ref}`
      const sourcePosition = layout.get(sourceKey)
      const targetPosition = layout.get(targetKey)
      const run = component.runs.find((candidate) => candidate.run_id === edge.run_id)
      const artifact = component.artifacts.find((candidate) => candidate.ref === edge.artifact_ref)
      const sourceLabel = edge.kind === 'consumes' ? artifactLabel(artifact) : runLabel(run)
      const targetLabel = edge.kind === 'consumes' ? runLabel(run) : artifactLabel(artifact)
      const line = svgElement('line', {
        class: 'trace-edge',
        'data-kind': edge.kind,
        role: 'img',
        x1: sourcePosition.x + 170,
        x2: targetPosition.x,
        y1: sourcePosition.y + 38,
        y2: targetPosition.y + 38,
        'marker-end': `url(#trace-arrow-${svgId})`,
        'aria-label': `连接：${sourceLabel} 到 ${targetLabel}`,
      })
      viewport.append(line)
    }
    for (const run of component.runs) {
      const key = `run:${run.run_id}`
      const node = nodeGroup(
        'run',
        runLabel(run),
        run.capability_id,
        layout.get(key),
        {
          'data-lifecycle': run.lifecycle,
          'data-boundary': String(trace.boundary_run_ids.includes(run.run_id)),
        },
        live,
        () => activate(key),
      )
      nodesByKey.set(key, node)
      viewport.append(node)
    }
    for (const artifact of component.artifacts) {
      const key = `artifact:${artifact.ref}`
      const node = nodeGroup(
        'artifact',
        artifactLabel(artifact),
        `${artifact.row_count} 行`,
        layout.get(key),
        {
          'data-boundary': String(trace.boundary_artifact_refs.includes(artifact.ref)),
          'data-report-artifact': String(trace.report_artifact_refs.includes(artifact.ref)),
        },
        live,
        () => activate(key),
      )
      nodesByKey.set(key, node)
      viewport.append(node)
    }
    canvasWrap.append(svg)
    workspace.append(canvasWrap, detailsPanel)
    section.append(workspace)
    let scale = 1
    const applyScale = () => viewport.setAttribute('transform', `scale(${scale})`)
    for (const [label, action] of [
      ['−', 'out'],
      ['+', 'in'],
      ['重置', 'reset'],
    ]) {
      const button = text('button', label)
      button.type = 'button'
      button.setAttribute(
        'aria-label',
        action === 'out' ? '缩小' : action === 'in' ? '放大' : '重置缩放',
      )
      button.addEventListener('click', () => {
        scale =
          action === 'reset'
            ? 1
            : Math.min(2.5, Math.max(0.5, scale * (action === 'in' ? 1.2 : 0.8)))
        applyScale()
      })
      controls.append(button)
    }
    const reportArtifact = component.artifacts.find((artifact) =>
      trace.report_artifact_refs.includes(artifact.ref),
    )
    const initialKey = reportArtifact
      ? `artifact:${reportArtifact.ref}`
      : component.artifacts.length > 0
        ? `artifact:${component.artifacts[0].ref}`
        : `run:${component.runs[0].run_id}`
    activate(initialKey)
    return section
  }

  function renderSessionGraph(container, trace) {
    if (!(container instanceof Element))
      fail('$container', 'must be an Element', 'container-invalid')
    const value = validateTrace(trace, trace?.trace_id)
    container.replaceChildren()
    const live = text('p', '', 'sr-only')
    live.setAttribute('aria-live', 'polite')
    const liveId = `trace-live-${++nextId}`
    live.id = liveId
    if (value.truncated)
      container.append(text('p', '有界链路：以下视图包含截断边界。', 'trace-boundary'))
    const components = graphComponents(value)
    container.append(traceLegend(value, components.length))
    for (const [index, component] of components.entries()) {
      container.append(renderComponent(value, component, index, live))
    }
    container.append(live, readBoundaryDisclosure())
    return container
  }

  function tracesForRender(traceIds) {
    if (!Array.isArray(traceIds) || traceIds.length === 0 || traceIds.length > 20) {
      fail('$traceIds', 'must contain between 1 and 20 registered trace ids')
    }
    const seen = new Set()
    return traceIds.map((id, index) => {
      validateId(id)
      if (seen.has(id)) fail(`$traceIds[${index}]`, 'must be unique')
      seen.add(id)
      return [id, get(id)]
    })
  }

  function renderSessionGraphs(container, traceIds = list()) {
    if (!(container instanceof Element))
      fail('$container', 'must be an Element', 'container-invalid')
    const selected = tracesForRender(traceIds)
    const sessions = new Map()
    for (const entry of selected) {
      const sessionId = entry[1].session_id
      const session = sessions.get(sessionId) ?? []
      session.push(entry)
      sessions.set(sessionId, session)
    }
    container.replaceChildren()
    container.append(
      text(
        'p',
        `${sessions.size} 个 Session · ${selected.length} 个聚焦 Graph`,
        'trace-session-count',
      ),
    )
    let sessionIndex = 0
    for (const [sessionId, entries] of sessions) {
      sessionIndex += 1
      const section = document.createElement('section')
      section.className = 'trace-session'
      const heading = document.createElement('header')
      heading.className = 'trace-session-heading'
      heading.append(text('h2', `Session ${sessionIndex}`), text('code', sessionId))
      section.append(heading)
      for (const [traceId, trace] of entries) {
        const graph = document.createElement('section')
        graph.className = 'trace-session-graph'
        graph.append(text('h3', `聚焦 Graph · ${traceId}`))
        const host = document.createElement('div')
        host.className = 'trace-session-graph-host'
        renderSessionGraph(host, trace)
        graph.append(host)
        section.append(graph)
      }
      container.append(section)
    }
    return container
  }

  const api = Object.freeze({ get, has, list, register, renderSessionGraph, renderSessionGraphs })
  Object.defineProperty(scope, 'ReportTrace', {
    configurable: false,
    enumerable: true,
    value: api,
    writable: false,
  })
})(globalThis)
