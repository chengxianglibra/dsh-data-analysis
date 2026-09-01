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

  function shortIdentity(value) {
    return value.length <= 20 ? value : `${value.slice(0, 9)}…${value.slice(-6)}`
  }

  function positions(trace) {
    const ordered = [
      ...trace.runs.map((run) => `run:${run.run_id}`),
      ...trace.artifacts.map((artifact) => `artifact:${artifact.ref}`),
    ]
    const predecessor = new Map(ordered.map((node) => [node, []]))
    for (const edge of trace.edges) {
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

  function nodeGroup(kind, identity, title, subtitle, position, attributes, live) {
    const group = svgElement('g', {
      class:
        attributes['data-boundary'] === 'true' ? 'trace-node trace-boundary-node' : 'trace-node',
      role: 'img',
      tabindex: 0,
      transform: `translate(${position.x} ${position.y})`,
      'aria-label': `${title}，${shortIdentity(identity)}，${subtitle}`,
      ...attributes,
    })
    if (kind === 'run') group.append(svgElement('rect', { width: 170, height: 76, rx: 12 }))
    else group.append(svgElement('path', { d: 'M18 0 H152 L170 38 L152 76 H18 L0 38 Z' }))
    const heading = svgElement('text', { x: 85, y: 31, 'text-anchor': 'middle' })
    heading.textContent = title
    const detail = svgElement('text', { x: 85, y: 53, 'text-anchor': 'middle' })
    detail.textContent = shortIdentity(identity)
    group.append(heading, detail)
    group.addEventListener('focus', () => {
      live.textContent = `${title}：${shortIdentity(identity)}；${subtitle}`
    })
    return group
  }

  function fallback(trace) {
    const details = document.createElement('details')
    details.className = 'trace-fallback'
    details.append(text('summary', '查看线性步骤与边界'))
    const list = document.createElement('ol')
    for (const run of trace.runs) {
      const item = document.createElement('li')
      const identity = document.createElement('details')
      identity.append(
        text('summary', `${shortIdentity(run.run_id)} · ${run.lifecycle} · ${run.capability_id}`),
      )
      identity.append(text('p', `完整 Run ID：${run.run_id}`))
      identity.append(text('p', `输入：${run.input_artifact_refs.join('、') || '无'}`))
      if (run.lifecycle === 'succeeded')
        identity.append(text('p', `输出：${run.output_artifact_ref}`))
      identity.append(text('p', `开始：${run.started_at}`))
      if (run.lifecycle === 'succeeded') identity.append(text('p', `完成：${run.finished_at}`))
      if (run.lifecycle === 'failed')
        identity.append(text('p', `失败：${run.failed_at} · ${run.failure.error_type}`))
      if (trace.boundary_run_ids.includes(run.run_id))
        identity.append(text('p', '该 Run 位于有界链路边界。'))
      item.append(identity)
      list.append(item)
    }
    details.append(list)
    const artifactList = document.createElement('ol')
    for (const artifact of trace.artifacts) {
      const item = document.createElement('li')
      const identity = document.createElement('details')
      identity.append(text('summary', `${shortIdentity(artifact.ref)} · ${artifact.family}`))
      identity.append(text('p', `完整 Artifact ref：${artifact.ref}`))
      identity.append(text('p', `生成于：${artifact.created_at}`))
      if (trace.boundary_artifact_refs.includes(artifact.ref)) {
        identity.append(text('p', '该 Artifact 位于有界链路边界。'))
      }
      item.append(identity)
      artifactList.append(item)
    }
    details.append(artifactList)
    const table = document.createElement('table')
    table.className = 'data-table'
    table.append(text('caption', 'Run 与 Artifact 关系'))
    const header = document.createElement('tr')
    for (const label of ['关系', 'Run', 'Artifact']) {
      const cell = text('th', label)
      cell.scope = 'col'
      header.append(cell)
    }
    const head = document.createElement('thead')
    head.append(header)
    table.append(head)
    const body = document.createElement('tbody')
    for (const edge of trace.edges) {
      const row = document.createElement('tr')
      row.append(
        text('td', edge.kind),
        text('td', shortIdentity(edge.run_id)),
        text('td', shortIdentity(edge.artifact_ref)),
      )
      body.append(row)
    }
    table.append(body)
    details.append(table)
    if (trace.truncated) {
      details.append(
        text(
          'p',
          `有界链路。Artifact 边界：${trace.boundary_artifact_refs.map(shortIdentity).join('、') || '无'}；Run 边界：${trace.boundary_run_ids.map(shortIdentity).join('、') || '无'}。`,
          'trace-boundary',
        ),
      )
    }
    details.append(text('p', `读取边界：${trace.read_boundaries.join('；')}`, 'trace-boundary'))
    return details
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
    const layout = positions(value)
    const maxX = Math.max(...[...layout.values()].map((position) => position.x), 40)
    const maxY = Math.max(...[...layout.values()].map((position) => position.y), 40)
    const svg = svgElement('svg', {
      class: 'trace-svg',
      role: 'group',
      viewBox: `0 0 ${maxX + 230} ${maxY + 130}`,
      'aria-describedby': liveId,
      'aria-labelledby': `trace-title-${nextId}`,
    })
    const title = svgElement('title', { id: `trace-title-${nextId}` })
    title.textContent = value.truncated ? '有界 Marivo Session 分析链路' : 'Marivo Session 分析链路'
    const description = svgElement('desc')
    description.textContent = 'Run 与 Artifact 的有向无环关系；成功状态不表示报告结论可信。'
    const definitions = svgElement('defs')
    const marker = svgElement('marker', {
      id: `trace-arrow-${nextId}`,
      markerHeight: 8,
      markerWidth: 8,
      orient: 'auto',
      refX: 7,
      refY: 4,
      viewBox: '0 0 8 8',
    })
    marker.append(svgElement('path', { d: 'M0 0 L8 4 L0 8 Z', fill: 'currentColor' }))
    definitions.append(marker)
    svg.append(title, description, definitions)
    for (const edge of value.edges) {
      const sourceKey =
        edge.kind === 'consumes' ? `artifact:${edge.artifact_ref}` : `run:${edge.run_id}`
      const targetKey =
        edge.kind === 'consumes' ? `run:${edge.run_id}` : `artifact:${edge.artifact_ref}`
      const sourcePosition = layout.get(sourceKey)
      const targetPosition = layout.get(targetKey)
      const line = svgElement('line', {
        class: 'trace-edge',
        'data-kind': edge.kind,
        role: 'img',
        tabindex: 0,
        x1: sourcePosition.x + 170,
        x2: targetPosition.x,
        y1: sourcePosition.y + 38,
        y2: targetPosition.y + 38,
        'marker-end': `url(#trace-arrow-${nextId})`,
        'aria-label': `${edge.kind}：${shortIdentity(edge.run_id)} 与 ${shortIdentity(edge.artifact_ref)}`,
      })
      line.addEventListener('focus', () => {
        live.textContent = `${edge.kind}：Run ${shortIdentity(edge.run_id)}，Artifact ${shortIdentity(edge.artifact_ref)}`
      })
      svg.append(line)
      const label = svgElement('text', {
        x: (sourcePosition.x + 170 + targetPosition.x) / 2,
        y: (sourcePosition.y + targetPosition.y) / 2 + 30,
        'text-anchor': 'middle',
      })
      label.textContent = edge.kind
      svg.append(label)
    }
    for (const run of value.runs) {
      svg.append(
        nodeGroup(
          'run',
          run.run_id,
          `Run · ${run.lifecycle}`,
          `${run.capability_id}；${run.started_at}`,
          layout.get(`run:${run.run_id}`),
          {
            'data-lifecycle': run.lifecycle,
            'data-boundary': String(value.boundary_run_ids.includes(run.run_id)),
          },
          live,
        ),
      )
    }
    for (const artifact of value.artifacts) {
      svg.append(
        nodeGroup(
          'artifact',
          artifact.ref,
          `Artifact · ${artifact.family}`,
          `${artifact.materialization}；${artifact.created_at}`,
          layout.get(`artifact:${artifact.ref}`),
          {
            'data-boundary': String(value.boundary_artifact_refs.includes(artifact.ref)),
            'data-report-artifact': String(value.report_artifact_refs.includes(artifact.ref)),
          },
          live,
        ),
      )
    }
    container.append(svg, live, fallback(value))
    return container
  }

  const api = Object.freeze({ get, has, list, register, renderSessionGraph })
  Object.defineProperty(scope, 'ReportTrace', {
    configurable: false,
    enumerable: true,
    value: api,
    writable: false,
  })
})(globalThis)
