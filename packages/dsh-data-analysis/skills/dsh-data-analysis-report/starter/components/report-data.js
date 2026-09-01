;((scope) => {
  const datasets = new Map()
  const recordViews = new Map()
  const DATASET_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
  const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
  const ARTIFACT_ROLES = new Set(['time', 'dimension', 'value', 'measure', 'unknown'])
  const ISSUE_CATEGORIES = new Set([
    'data_quality',
    'comparability',
    'evidence_availability',
    'candidate_resolution',
  ])

  class ReportDataError extends Error {
    constructor(code, path, message) {
      super(`${path}: ${message}`)
      this.name = 'ReportDataError'
      this.code = code
      this.path = path
    }
  }

  function fail(path, message, code = 'dataset-invalid') {
    throw new ReportDataError(code, path, message)
  }

  function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  function object(value, path) {
    if (!isObject(value)) fail(path, 'must be an object')
    return value
  }

  function exactKeys(value, path, required, optional = []) {
    const keys = Object.keys(value)
    const allowed = new Set([...required, ...optional])
    for (const key of required) {
      if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, 'is required')
    }
    for (const key of keys) {
      if (!allowed.has(key)) fail(`${path}.${key}`, 'is not allowed')
    }
  }

  function string(value, path, { nullable = false, maxLength = 2048 } = {}) {
    if (nullable && value === null) return
    if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
      fail(path, `must be a non-empty string of at most ${maxLength} characters`)
    }
  }

  function integer(value, path, { nullable = false, maximum = Number.MAX_SAFE_INTEGER } = {}) {
    if (nullable && value === null) return
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
      fail(path, `must be an integer between 0 and ${maximum}`)
    }
  }

  function number(value, path, { nullable = false } = {}) {
    if (nullable && value === null) return
    if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'must be a finite number')
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

  function stringArray(value, path, maximum = 100) {
    if (!Array.isArray(value) || value.length > maximum) {
      fail(path, `must be an array with at most ${maximum} items`)
    }
    value.forEach((item, index) => {
      string(item, `${path}[${index}]`)
    })
  }

  function validateRepair(value, path, nullable) {
    if (nullable && value === null) return
    const repair = object(value, path)
    exactKeys(repair, path, ['kind', 'action', 'help_target'])
    if (
      !['retry', 'inspect', 'user_choice', 'semantic_authoring', 'environment'].includes(
        repair.kind,
      )
    ) {
      fail(`${path}.kind`, 'is unsupported')
    }
    string(repair.action, `${path}.action`)
    string(repair.help_target, `${path}.help_target`)
  }

  function validateIssue(value, path, allowEvidenceRule = false) {
    const issue = object(value, path)
    string(issue.category, `${path}.category`)
    if (allowEvidenceRule && issue.category === 'evidence_rule') {
      exactKeys(issue, path, ['category', 'kind', 'severity', 'expected', 'received', 'repair'])
      string(issue.kind, `${path}.kind`)
      if (!['warning', 'blocking'].includes(issue.severity))
        fail(`${path}.severity`, 'is unsupported')
      string(issue.expected, `${path}.expected`)
      string(issue.received, `${path}.received`)
      validateRepair(issue.repair, `${path}.repair`, false)
      return
    }
    if (!ISSUE_CATEGORIES.has(issue.category)) fail(`${path}.category`, 'is unsupported')
    if (issue.category === 'data_quality') {
      exactKeys(issue, path, ['category', 'kind', 'severity', 'check_id', 'expectation', 'repair'])
      string(issue.check_id, `${path}.check_id`)
      string(issue.expectation, `${path}.expectation`)
    } else if (issue.category === 'comparability') {
      exactKeys(issue, path, [
        'category',
        'kind',
        'severity',
        'incompatible_fields',
        'approximation_details',
        'repair',
      ])
      stringArray(issue.incompatible_fields, `${path}.incompatible_fields`)
      stringArray(issue.approximation_details, `${path}.approximation_details`)
    } else if (issue.category === 'evidence_availability') {
      exactKeys(issue, path, [
        'category',
        'kind',
        'severity',
        'failed_stage',
        'findings_available',
        'stable_error_category',
        'repair',
      ])
      if (!['extract', 'digest', 'store'].includes(issue.failed_stage)) {
        fail(`${path}.failed_stage`, 'is unsupported')
      }
      if (typeof issue.findings_available !== 'boolean') {
        fail(`${path}.findings_available`, 'must be boolean')
      }
      string(issue.stable_error_category, `${path}.stable_error_category`)
    } else {
      exactKeys(issue, path, ['category', 'kind', 'severity', 'historical', 'repair'])
      if (issue.severity !== 'warning') fail(`${path}.severity`, 'must be warning')
      if (typeof issue.historical !== 'boolean') fail(`${path}.historical`, 'must be boolean')
    }
    string(issue.kind, `${path}.kind`)
    if (!['warning', 'blocking'].includes(issue.severity))
      fail(`${path}.severity`, 'is unsupported')
    validateRepair(issue.repair, `${path}.repair`, issue.category !== 'candidate_resolution')
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
      number(quality[field], `${path}.${field}`, { nullable: true })
    }
    for (const field of fields
      .slice(2)
      .filter((field) => !['sample_coverage_min', 'sample_coverage_avg'].includes(field))) {
      integer(quality[field], `${path}.${field}`, { nullable: true })
    }
  }

  function validateRevalidation(value, path) {
    const revalidation = object(value, path)
    string(revalidation.status, `${path}.status`)
    if (revalidation.status === 'not_checked') {
      exactKeys(revalidation, path, ['status'])
      return
    }
    if (revalidation.status !== 'checked') fail(`${path}.status`, 'is unsupported')
    exactKeys(revalidation, path, [
      'status',
      'result',
      'semantic_status',
      'evidence_status',
      'dependency_status',
      'checked_at',
      'issues',
      'issues_omitted',
    ])
    if (!['admissible', 'stale', 'indeterminate'].includes(revalidation.result)) {
      fail(`${path}.result`, 'is unsupported')
    }
    if (!['current', 'stale', 'indeterminate'].includes(revalidation.semantic_status)) {
      fail(`${path}.semantic_status`, 'is unsupported')
    }
    if (!['complete', 'partial', 'unavailable'].includes(revalidation.evidence_status)) {
      fail(`${path}.evidence_status`, 'is unsupported')
    }
    if (!['admissible', 'stale', 'indeterminate'].includes(revalidation.dependency_status)) {
      fail(`${path}.dependency_status`, 'is unsupported')
    }
    timestamp(revalidation.checked_at, `${path}.checked_at`)
    if (!Array.isArray(revalidation.issues) || revalidation.issues.length > 100) {
      fail(`${path}.issues`, 'must contain at most 100 issues')
    }
    revalidation.issues.forEach((issue, index) => {
      validateIssue(issue, `${path}.issues[${index}]`, true)
    })
    integer(revalidation.issues_omitted, `${path}.issues_omitted`)
  }

  function validateSource(value, path, table) {
    const source = object(value, path)
    string(source.kind, `${path}.kind`)
    if (source.kind === 'computed') {
      exactKeys(source, path, ['kind'])
      if (Object.hasOwn(table, 'semantic_shape')) {
        fail('$.table.semantic_shape', 'is not allowed for a computed dataset')
      }
      return 'computed'
    }
    if (source.kind !== 'marivo_artifact') fail(`${path}.kind`, 'is unsupported')
    exactKeys(source, path, [
      'kind',
      'artifact',
      'quality_summary',
      'issues',
      'issues_omitted',
      'lineage',
      'revalidation',
    ])
    const artifact = object(source.artifact, `${path}.artifact`)
    exactKeys(artifact, `${path}.artifact`, [
      'session_id',
      'ref',
      'kind',
      'artifact_schema_version',
      'content_hash',
      'created_at',
      'row_count',
      'evidence_status',
      'finding_count',
    ])
    for (const field of ['session_id', 'ref', 'kind', 'artifact_schema_version']) {
      string(artifact[field], `${path}.artifact.${field}`)
    }
    string(artifact.content_hash, `${path}.artifact.content_hash`, { nullable: true })
    timestamp(artifact.created_at, `${path}.artifact.created_at`)
    integer(artifact.row_count, `${path}.artifact.row_count`)
    integer(artifact.finding_count, `${path}.artifact.finding_count`)
    if (!['complete', 'partial', 'unavailable'].includes(artifact.evidence_status)) {
      fail(`${path}.artifact.evidence_status`, 'is unsupported')
    }
    validateQuality(source.quality_summary, `${path}.quality_summary`)
    if (!Array.isArray(source.issues) || source.issues.length > 100) {
      fail(`${path}.issues`, 'must contain at most 100 issues')
    }
    source.issues.forEach((issue, index) => {
      validateIssue(issue, `${path}.issues[${index}]`)
    })
    integer(source.issues_omitted, `${path}.issues_omitted`)
    const lineage = object(source.lineage, `${path}.lineage`)
    exactKeys(lineage, `${path}.lineage`, [
      'external_inputs',
      'external_inputs_omitted',
      'steps',
      'steps_omitted',
    ])
    stringArray(lineage.external_inputs, `${path}.lineage.external_inputs`)
    integer(lineage.external_inputs_omitted, `${path}.lineage.external_inputs_omitted`)
    if (!Array.isArray(lineage.steps) || lineage.steps.length > 100) {
      fail(`${path}.lineage.steps`, 'must contain at most 100 steps')
    }
    lineage.steps.forEach((candidate, index) => {
      const stepPath = `${path}.lineage.steps[${index}]`
      const step = object(candidate, stepPath)
      exactKeys(step, stepPath, [
        'intent',
        'job_ref',
        'inputs',
        'params_digest',
        'analysis_purpose',
      ])
      string(step.intent, `${stepPath}.intent`)
      string(step.job_ref, `${stepPath}.job_ref`)
      stringArray(step.inputs, `${stepPath}.inputs`)
      string(step.params_digest, `${stepPath}.params_digest`)
      string(step.analysis_purpose, `${stepPath}.analysis_purpose`, { nullable: true })
    })
    integer(lineage.steps_omitted, `${path}.lineage.steps_omitted`)
    validateRevalidation(source.revalidation, `${path}.revalidation`)
    if (!Object.hasOwn(table, 'semantic_shape')) {
      fail('$.table.semantic_shape', 'is required for an Artifact dataset')
    }
    string(table.semantic_shape, '$.table.semantic_shape', { nullable: true })
    if (artifact.row_count !== table.total_rows) {
      fail(`${path}.artifact.row_count`, 'must equal $.table.total_rows')
    }
    return 'marivo_artifact'
  }

  function validateDataset(value, registrationId) {
    const dataset = object(value, '$')
    exactKeys(dataset, '$', ['schema', 'dataset_id', 'emitted_at', 'source', 'table'])
    if (dataset.schema !== 'dsh-data-analysis-dataset/v1') fail('$.schema', 'is unsupported')
    if (typeof dataset.dataset_id !== 'string' || !DATASET_ID.test(dataset.dataset_id)) {
      fail('$.dataset_id', 'is invalid')
    }
    if (dataset.dataset_id !== registrationId) {
      fail('$.dataset_id', 'must match the registered id', 'dataset-id-mismatch')
    }
    timestamp(dataset.emitted_at, '$.emitted_at')
    const table = object(dataset.table, '$.table')
    exactKeys(
      table,
      '$.table',
      ['total_rows', 'written_rows', 'omitted_rows', 'columns', 'rows'],
      ['semantic_shape'],
    )
    integer(table.total_rows, '$.table.total_rows')
    integer(table.written_rows, '$.table.written_rows', { maximum: 100000 })
    integer(table.omitted_rows, '$.table.omitted_rows')
    if (table.total_rows !== table.written_rows + table.omitted_rows) {
      fail('$.table.total_rows', 'must equal written_rows + omitted_rows')
    }
    if (!Array.isArray(table.columns) || table.columns.length > 100) {
      fail('$.table.columns', 'must contain at most 100 columns')
    }
    const sourceKind = validateSource(dataset.source, '$.source', table)
    const names = new Set()
    table.columns.forEach((candidate, index) => {
      const columnPath = `$.table.columns[${index}]`
      const column = object(candidate, columnPath)
      const computedKeys = ['name', 'dtype', 'contains_null']
      const artifactKeys = [...computedKeys, 'artifact_dtype', 'nullable', 'role']
      exactKeys(column, columnPath, sourceKind === 'computed' ? computedKeys : artifactKeys)
      string(column.name, `${columnPath}.name`)
      string(column.dtype, `${columnPath}.dtype`)
      if (names.has(column.name)) fail(`${columnPath}.name`, 'must be unique')
      names.add(column.name)
      if (typeof column.contains_null !== 'boolean')
        fail(`${columnPath}.contains_null`, 'must be boolean')
      if (sourceKind === 'marivo_artifact') {
        string(column.artifact_dtype, `${columnPath}.artifact_dtype`)
        if (typeof column.nullable !== 'boolean') fail(`${columnPath}.nullable`, 'must be boolean')
        if (!ARTIFACT_ROLES.has(column.role)) fail(`${columnPath}.role`, 'is unsupported')
      }
    })
    if (!Array.isArray(table.rows) || table.rows.length > 100000) {
      fail('$.table.rows', 'must contain at most 100000 rows')
    }
    if (table.rows.length !== table.written_rows) {
      fail('$.table.written_rows', 'must equal rows.length')
    }
    table.rows.forEach((row, rowIndex) => {
      const rowPath = `$.table.rows[${rowIndex}]`
      if (!Array.isArray(row) || row.length !== table.columns.length) {
        fail(rowPath, `must contain exactly ${table.columns.length} cells`)
      }
      row.forEach((cell, cellIndex) => {
        if (!['string', 'number', 'boolean'].includes(typeof cell) && cell !== null) {
          fail(`${rowPath}[${cellIndex}]`, 'must be a JSON scalar')
        }
        if (typeof cell === 'number' && !Number.isFinite(cell)) {
          fail(`${rowPath}[${cellIndex}]`, 'must be finite')
        }
      })
    })
    return dataset
  }

  function deepFreeze(value, seen = new WeakSet()) {
    if (!isObject(value) && !Array.isArray(value)) return value
    if (seen.has(value)) return value
    seen.add(value)
    for (const child of Object.values(value)) deepFreeze(child, seen)
    return Object.freeze(value)
  }

  function validateId(id) {
    if (typeof id !== 'string' || !DATASET_ID.test(id)) {
      fail('$id', 'is invalid', 'dataset-id-invalid')
    }
  }

  function register(id, dataset) {
    validateId(id)
    if (datasets.has(id)) fail('$id', 'is already registered', 'dataset-id-duplicate')
    datasets.set(id, deepFreeze(validateDataset(dataset, id)))
  }

  function get(id) {
    validateId(id)
    const dataset = datasets.get(id)
    if (!dataset) fail('$id', 'is not registered', 'dataset-not-found')
    return dataset
  }

  function records(id) {
    if (recordViews.has(id)) return recordViews.get(id)
    const dataset = get(id)
    const names = dataset.table.columns.map((column) => column.name)
    const recordsForId = dataset.table.rows.map((row) => {
      const record = {}
      names.forEach((name, index) => {
        Object.defineProperty(record, name, {
          configurable: false,
          enumerable: true,
          value: row[index],
          writable: false,
        })
      })
      return Object.freeze(record)
    })
    const frozen = Object.freeze(recordsForId)
    recordViews.set(id, frozen)
    return frozen
  }

  function has(id) {
    validateId(id)
    return datasets.has(id)
  }

  function list() {
    return Object.freeze([...datasets.keys()])
  }

  const api = Object.freeze({ get, has, list, records, register })
  Object.defineProperty(scope, 'ReportData', {
    configurable: false,
    enumerable: true,
    value: api,
    writable: false,
  })
})(globalThis)
