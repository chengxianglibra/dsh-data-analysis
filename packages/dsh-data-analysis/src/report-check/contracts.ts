import { readFileSync } from 'node:fs'
import { Ajv2020, type AnySchema, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js'
import type { ReportCheckSeverity, ReportContractKind, ReportContractValidation } from './types.ts'

const CONTRACT_ROOT = new URL('../../report-contracts/', import.meta.url)

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(new URL(name, CONTRACT_ROOT), 'utf8'))
}

const commonSchema = readJson('common-v1.schema.json') as AnySchema
const revalidationSchema = readJson('revalidation-v1.schema.json') as AnySchema
const datasetSchema = readJson('dataset-v1.schema.json') as AnySchema
const traceSchema = readJson('session-trace-v1.schema.json') as AnySchema

function isRfc3339(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return false
  }
  return Number.isFinite(Date.parse(value))
}

const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true })
ajv.addFormat('date-time', { type: 'string', validate: isRfc3339 })
ajv.addSchema(commonSchema)
ajv.addSchema(revalidationSchema)
const validators: Record<ReportContractKind, ValidateFunction> = {
  dataset: ajv.compile(datasetSchema),
  revalidation: ajv.getSchema(
    'https://deepseek.com/dsh-data-analysis/report-contracts/revalidation-v1.schema.json',
  )!,
  trace: ajv.compile(traceSchema),
}

function renderAjvError(error: ErrorObject): string {
  const path = error.instancePath === '' ? '$' : `$${error.instancePath}`
  return `${path} ${error.message ?? 'is invalid'}`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === 'object' && item !== null && !Array.isArray(item),
      )
    : []
}

function duplicateValues(values: unknown[]): string[] {
  const strings = values.filter((value): value is string => typeof value === 'string')
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const value of strings) {
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  }
  return [...duplicates]
}

function stringSet(value: unknown): Set<string> {
  return new Set(
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [],
  )
}

function equalSets(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value))
}

function validateDatasetSemantics(value: unknown): string[] {
  const root = asRecord(value)
  const source = asRecord(root?.source)
  const table = asRecord(root?.table)
  if (root === null || source === null || table === null) return []
  const columns = arrayOfRecords(table.columns)
  const rows = Array.isArray(table.rows) ? table.rows : []
  const errors: string[] = []
  if (table.written_rows !== rows.length) errors.push('$.table.written_rows must equal rows.length')
  if (
    typeof table.total_rows === 'number' &&
    typeof table.written_rows === 'number' &&
    typeof table.omitted_rows === 'number' &&
    table.total_rows !== table.written_rows + table.omitted_rows
  ) {
    errors.push('$.table.total_rows must equal written_rows + omitted_rows')
  }
  for (const [index, row] of rows.entries()) {
    if (Array.isArray(row) && row.length !== columns.length) {
      errors.push(`$.table.rows/${index} must contain exactly ${columns.length} cells`)
    }
    if (
      Array.isArray(row) &&
      row.some((cell) => Number.isInteger(cell) && !Number.isSafeInteger(cell))
    ) {
      errors.push(`$.table.rows/${index} contains an integer outside the JavaScript safe range`)
    }
  }
  const duplicateColumns = duplicateValues(columns.map((column) => column.name))
  if (duplicateColumns.length > 0) errors.push('$.table.columns names must be unique')
  if (source.kind === 'computed') {
    if (Object.hasOwn(table, 'semantic_shape')) {
      errors.push('$.table.semantic_shape is not allowed for a computed dataset')
    }
    if (columns.some((column) => Object.hasOwn(column, 'artifact_dtype'))) {
      errors.push('$.table.columns must use computed column objects')
    }
  }
  if (source.kind === 'marivo_artifact') {
    if (!Object.hasOwn(table, 'semantic_shape')) {
      errors.push('$.table.semantic_shape is required for an Artifact dataset')
    }
    if (columns.some((column) => !Object.hasOwn(column, 'artifact_dtype'))) {
      errors.push('$.table.columns must use Artifact column objects')
    }
    const artifact = asRecord(source.artifact)
    if (artifact !== null && artifact.row_count !== table.total_rows) {
      errors.push('$.source.artifact.row_count must equal $.table.total_rows')
    }
  }
  return errors
}

function validateTraceSemantics(value: unknown): string[] {
  const root = asRecord(value)
  if (root === null) return []
  const runs = arrayOfRecords(root.runs)
  const artifacts = arrayOfRecords(root.artifacts)
  const edges = arrayOfRecords(root.edges)
  const queries = arrayOfRecords(root.queries)
  const runIds = runs.map((run) => run.run_id).filter((id): id is string => typeof id === 'string')
  const artifactRefs = artifacts
    .map((artifact) => artifact.ref)
    .filter((ref): ref is string => typeof ref === 'string')
  const runSet = new Set(runIds)
  const artifactSet = new Set(artifactRefs)
  const boundaryRuns = new Set(
    Array.isArray(root.boundary_run_ids)
      ? root.boundary_run_ids.filter((id): id is string => typeof id === 'string')
      : [],
  )
  const boundaryArtifacts = new Set(
    Array.isArray(root.boundary_artifact_refs)
      ? root.boundary_artifact_refs.filter((id): id is string => typeof id === 'string')
      : [],
  )
  const errors: string[] = []
  if (duplicateValues(runIds).length > 0) errors.push('$.runs run_id values must be unique')
  if (duplicateValues(artifactRefs).length > 0) errors.push('$.artifacts ref values must be unique')
  const queryIds = queries
    .map((query) => query.query_id)
    .filter((id): id is string => typeof id === 'string')
  if (duplicateValues(queryIds).length > 0) errors.push('$.queries query_id values must be unique')
  for (const query of queries) {
    if (typeof query.run_id !== 'string' || !runSet.has(query.run_id)) {
      errors.push('$.queries contains a dangling run_id')
    }
    if (
      query.output_artifact_ref !== null &&
      (typeof query.output_artifact_ref !== 'string' || !artifactSet.has(query.output_artifact_ref))
    ) {
      errors.push('$.queries contains a dangling output_artifact_ref')
    }
  }

  const requireRuns = (name: string, expectedLifecycle?: string): void => {
    const values = Array.isArray(root[name]) ? root[name] : []
    for (const value of values) {
      if (typeof value !== 'string' || !runSet.has(value)) {
        errors.push(`$.${name} contains an unknown Run identity`)
      }
      if (expectedLifecycle !== undefined) {
        const run = runs.find((candidate) => candidate.run_id === value)
        if (run !== undefined && run.lifecycle !== expectedLifecycle) {
          errors.push(`$.${name} contains a Run with lifecycle ${String(run.lifecycle)}`)
        }
      }
    }
  }
  const requireArtifacts = (name: string): void => {
    const values = Array.isArray(root[name]) ? root[name] : []
    for (const value of values) {
      if (typeof value !== 'string' || !artifactSet.has(value)) {
        errors.push(`$.${name} contains an unknown Artifact identity`)
      }
    }
  }
  requireRuns('root_run_ids')
  requireRuns('failed_run_ids', 'failed')
  requireRuns('incomplete_run_ids', 'incomplete')
  requireArtifacts('head_artifact_refs')
  requireArtifacts('report_artifact_refs')

  if (runs.length + artifacts.length > 200) {
    errors.push('$.runs and $.artifacts must contain at most 200 nodes in total')
  }
  if ([...boundaryRuns].some((id) => !runSet.has(id))) {
    errors.push('$.boundary_run_ids must identify local Run nodes')
  }
  if ([...boundaryArtifacts].some((id) => !artifactSet.has(id))) {
    errors.push('$.boundary_artifact_refs must identify local Artifact nodes')
  }
  if (root.truncated === false && (boundaryRuns.size > 0 || boundaryArtifacts.size > 0)) {
    errors.push('boundary identities require $.truncated=true')
  }

  const actualFailed = new Set(
    runs.filter((run) => run.lifecycle === 'failed').map((run) => String(run.run_id)),
  )
  const listedFailed = new Set(Array.isArray(root.failed_run_ids) ? root.failed_run_ids : [])
  if (
    actualFailed.size !== listedFailed.size ||
    [...actualFailed].some((id) => !listedFailed.has(id))
  ) {
    errors.push('$.failed_run_ids must exactly match failed Run nodes')
  }
  const actualIncomplete = new Set(
    runs.filter((run) => run.lifecycle === 'incomplete').map((run) => String(run.run_id)),
  )
  const listedIncomplete = new Set(
    Array.isArray(root.incomplete_run_ids) ? root.incomplete_run_ids : [],
  )
  if (
    actualIncomplete.size !== listedIncomplete.size ||
    [...actualIncomplete].some((id) => !listedIncomplete.has(id))
  ) {
    errors.push('$.incomplete_run_ids must exactly match incomplete Run nodes')
  }

  const actualRoots = new Set(
    runs
      .filter(
        (run) => Array.isArray(run.input_artifact_refs) && run.input_artifact_refs.length === 0,
      )
      .map((run) => String(run.run_id)),
  )
  if (!equalSets(actualRoots, stringSet(root.root_run_ids))) {
    errors.push('$.root_run_ids must exactly match Run nodes without inputs')
  }

  const succeededConsumers = new Set(
    runs
      .filter((run) => run.lifecycle === 'succeeded')
      .flatMap((run) =>
        Array.isArray(run.input_artifact_refs)
          ? run.input_artifact_refs.filter((ref): ref is string => typeof ref === 'string')
          : [],
      ),
  )
  const listedHeads = stringSet(root.head_artifact_refs)
  if (
    artifactRefs.some(
      (ref) => !boundaryArtifacts.has(ref) && listedHeads.has(ref) === succeededConsumers.has(ref),
    )
  ) {
    errors.push('$.head_artifact_refs must exactly match local Artifact topology')
  }

  for (const edge of edges) {
    if (typeof edge.run_id !== 'string' || !runSet.has(edge.run_id)) {
      errors.push('$.edges contains a dangling run_id')
    }
    if (typeof edge.artifact_ref !== 'string' || !artifactSet.has(edge.artifact_ref)) {
      errors.push('$.edges contains a dangling artifact_ref')
    }
    const run = runs.find((candidate) => candidate.run_id === edge.run_id)
    if (run === undefined) continue
    if (
      edge.kind === 'consumes' &&
      (!Array.isArray(run.input_artifact_refs) ||
        !run.input_artifact_refs.includes(edge.artifact_ref))
    ) {
      errors.push('$.edges consumes edge is absent from the Run input refs')
    }
    if (
      edge.kind === 'produces' &&
      (run.lifecycle !== 'succeeded' ||
        run.output_mode !== 'produced' ||
        run.output_artifact_ref !== edge.artifact_ref)
    ) {
      errors.push('$.edges produces edge disagrees with its succeeded Run')
    }
    if (
      edge.kind === 'reuses' &&
      (run.lifecycle !== 'succeeded' ||
        run.output_mode !== 'reused' ||
        run.output_artifact_ref !== edge.artifact_ref)
    ) {
      errors.push('$.edges reuses edge disagrees with its succeeded Run')
    }
  }
  const edgeKeys = edges.map(
    (edge) => `${String(edge.kind)}\u0000${String(edge.run_id)}\u0000${String(edge.artifact_ref)}`,
  )
  if (duplicateValues(edgeKeys).length > 0) errors.push('$.edges entries must be unique')

  const graphNodes = new Set([
    ...runIds.map((id) => `run\u0000${id}`),
    ...artifactRefs.map((ref) => `artifact\u0000${ref}`),
  ])
  const outgoing = new Map([...graphNodes].map((node) => [node, new Set<string>()]))
  const indegree = new Map([...graphNodes].map((node) => [node, 0]))
  for (const edge of edges) {
    if (
      typeof edge.run_id !== 'string' ||
      typeof edge.artifact_ref !== 'string' ||
      !runSet.has(edge.run_id) ||
      !artifactSet.has(edge.artifact_ref)
    ) {
      continue
    }
    const source =
      edge.kind === 'consumes' ? `artifact\u0000${edge.artifact_ref}` : `run\u0000${edge.run_id}`
    const target =
      edge.kind === 'consumes' ? `run\u0000${edge.run_id}` : `artifact\u0000${edge.artifact_ref}`
    const targets = outgoing.get(source)
    if (targets === undefined || targets.has(target)) continue
    targets.add(target)
    indegree.set(target, (indegree.get(target) ?? 0) + 1)
  }
  const ready = [...graphNodes].filter((node) => indegree.get(node) === 0)
  let visited = 0
  while (ready.length > 0) {
    const node = ready.pop()!
    visited += 1
    for (const target of outgoing.get(node) ?? []) {
      const next = (indegree.get(target) ?? 0) - 1
      indegree.set(target, next)
      if (next === 0) ready.push(target)
    }
  }
  if (visited !== graphNodes.size) {
    errors.push('$.edges must form an acyclic Run and Artifact graph')
  }
  for (const run of runs) {
    const inputs = Array.isArray(run.input_artifact_refs) ? run.input_artifact_refs : []
    for (const ref of inputs) {
      const localInput = typeof ref === 'string' && artifactSet.has(ref)
      if ((!localInput && !boundaryRuns.has(String(run.run_id))) || typeof ref !== 'string') {
        errors.push(`$.runs contains dangling input Artifact ref for ${String(run.run_id)}`)
      }
      if (
        localInput &&
        !edges.some(
          (edge) =>
            edge.kind === 'consumes' && edge.run_id === run.run_id && edge.artifact_ref === ref,
        )
      ) {
        errors.push(`$.runs is missing a consumes edge for ${String(run.run_id)}`)
      }
    }
    if (
      run.lifecycle === 'succeeded' &&
      (typeof run.output_artifact_ref !== 'string' ||
        (!artifactSet.has(run.output_artifact_ref) && !boundaryRuns.has(String(run.run_id))))
    ) {
      errors.push(`$.runs contains dangling output Artifact ref for ${String(run.run_id)}`)
    }
    if (
      run.lifecycle === 'succeeded' &&
      typeof run.output_artifact_ref === 'string' &&
      artifactSet.has(run.output_artifact_ref) &&
      !edges.some(
        (edge) =>
          edge.kind === (run.output_mode === 'reused' ? 'reuses' : 'produces') &&
          edge.run_id === run.run_id &&
          edge.artifact_ref === run.output_artifact_ref,
      )
    ) {
      errors.push(`$.runs is missing an output edge for ${String(run.run_id)}`)
    }
  }
  for (const artifact of artifacts) {
    const producer = artifact.produced_by_run
    if (
      producer !== null &&
      (typeof producer !== 'string' ||
        (!runSet.has(producer) && !boundaryArtifacts.has(String(artifact.ref))))
    ) {
      errors.push(`$.artifacts contains dangling produced_by_run for ${String(artifact.ref)}`)
    }
    if (typeof producer === 'string' && runSet.has(producer)) {
      const run = runs.find((candidate) => candidate.run_id === producer)
      if (
        run?.lifecycle !== 'succeeded' ||
        run.output_mode !== 'produced' ||
        run.output_artifact_ref !== artifact.ref
      ) {
        errors.push(`$.artifacts producer disagrees with ${String(artifact.ref)}`)
      }
    }
  }
  return errors
}

export function validateReportContract(
  kind: ReportContractKind,
  value: unknown,
): ReportContractValidation {
  const validator = validators[kind]
  const valid = validator(value)
  const schemaErrors = valid ? [] : (validator.errors ?? []).map(renderAjvError)
  const semanticErrors =
    kind === 'dataset'
      ? validateDatasetSemantics(value)
      : kind === 'trace'
        ? validateTraceSemantics(value)
        : []
  const errors = [...schemaErrors, ...semanticErrors]
  return { valid: errors.length === 0, errors, schemaErrors, semanticErrors }
}

interface RawRule {
  code: unknown
  severity: unknown
  group: unknown
}

interface RawRegistry {
  schema?: unknown
  rules?: unknown
}

const rawRegistry = readJson('checker-rules-v1.json') as RawRegistry
if (
  rawRegistry.schema !== 'dsh-data-analysis-report-check-rules/v1' ||
  !Array.isArray(rawRegistry.rules)
) {
  throw new Error('invalid report checker rule registry')
}

export interface ReportCheckRule {
  code: string
  severity: ReportCheckSeverity
  group: string
}

export const REPORT_CHECK_RULES: readonly ReportCheckRule[] = rawRegistry.rules.map(
  (candidate, index) => {
    const rule = candidate as RawRule
    if (
      typeof rule.code !== 'string' ||
      !['error', 'warning', 'info'].includes(String(rule.severity)) ||
      typeof rule.group !== 'string' ||
      rule.group === ''
    ) {
      throw new Error(`invalid report checker rule at index ${index}`)
    }
    return {
      code: rule.code,
      severity: rule.severity as ReportCheckSeverity,
      group: rule.group,
    }
  },
)

const duplicates = duplicateValues(REPORT_CHECK_RULES.map((rule) => rule.code))
if (duplicates.length > 0)
  throw new Error(`duplicate report checker rules: ${duplicates.join(', ')}`)

export const REPORT_CHECK_RULE_BY_CODE = new Map(
  REPORT_CHECK_RULES.map((rule) => [rule.code, rule] as const),
)

export function reportContractRoot(): URL {
  return new URL('.', CONTRACT_ROOT)
}
