import {
  PRESENTATION_BUDGETS as budgets,
  type Cell,
  type DatasetColumn,
  type PresentationReceipt,
  type TypedDataset,
} from './types.ts'
import { PresentationContractError } from './values.ts'

export * from './types.ts'
export * from './values.ts'

function fail(path: string, message: string, code = 'invalid_value'): never {
  throw new PresentationContractError(code, path, message)
}
function pointer(path: string, key: string | number): string {
  return `${path}/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`
}
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'Expected an object.')
  return value as Record<string, unknown>
}
function keys(
  value: Record<string, unknown>,
  required: string[],
  optional: string[],
  path: string,
) {
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail(pointer(path, key), 'Required field is missing.')
  }
  for (const key of Object.keys(value)) {
    if (!required.includes(key) && !optional.includes(key)) {
      fail(pointer(path, key), 'Unknown field.', 'unknown_field')
    }
  }
}
function string(value: unknown, path: string, max: number = budgets.text): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > max ||
    value.includes('\0') ||
    /[\uD800-\uDFFF]/u.test(value)
  ) {
    fail(path, `Expected a nonempty string of at most ${max} characters.`)
  }
  return value
}
function integer(value: unknown, path: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    fail(path, `Expected a safe integer between ${min} and ${max}.`)
  }
  return value
}
function array(value: unknown, path: string, max: number, min = 0): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    fail(path, `Expected an array with ${min} to ${max} items.`, 'budget')
  }
  return value
}
function unique(values: string[], path: string) {
  if (new Set(values).size !== values.length) fail(path, 'Duplicate identifiers.', 'duplicate_id')
}
function bytes(value: unknown, max: number, path = '') {
  let json: string | undefined
  try {
    json = JSON.stringify(value)
  } catch {
    fail(path, 'Expected serializable JSON.')
  }
  if (json === undefined || new TextEncoder().encode(json).length > max) {
    fail(path, `JSON exceeds the ${max} byte budget.`, 'budget')
  }
}
function version(value: Record<string, unknown>, path: string, expected = 1) {
  if (value.schemaVersion !== expected)
    fail(pointer(path, 'schemaVersion'), `Only schemaVersion ${expected} is accepted.`)
}
export function parsePresentationBuildId(value: unknown, path = '/buildId'): string {
  const result = string(value, path, 80)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(result)) fail(path, 'Expected a safe build identifier.')
  return result
}
export function validatePresentationDate(value: unknown, path: string, datetime: boolean) {
  const text = string(value, path, 64)
  const expression = datetime
    ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/
    : /^\d{4}-\d{2}-\d{2}$/
  if (!expression.test(text) || !Number.isFinite(Date.parse(text)))
    fail(path, 'Invalid ISO date/time.')
  if (text.slice(0, 4) === '0000') fail(path, 'Calendar year must be between 0001 and 9999.')
  if (datetime) {
    if (
      Number(text.slice(11, 13)) > 23 ||
      Number(text.slice(14, 16)) > 59 ||
      Number(text.slice(17, 19)) > 59
    ) {
      fail(path, 'Invalid clock time.')
    }
    const offset = /[+-](\d{2}):(\d{2})$/.exec(text)
    if (offset && (Number(offset[1]) > 23 || Number(offset[2]) > 59))
      fail(path, 'Invalid timezone offset.')
  }
  // Date.parse normalizes impossible calendar dates such as February 30.
  const day = text.slice(0, 10)
  if (new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) {
    fail(path, 'Invalid calendar date.')
  }
}
function column(value: unknown, path: string): DatasetColumn {
  const entry = object(value, path)
  keys(entry, ['id', 'label', 'type', 'nullable'], ['unit'], path)
  string(entry.id, pointer(path, 'id'), 256)
  string(entry.label, pointer(path, 'label'), 256)
  if (
    typeof entry.type !== 'string' ||
    !['string', 'boolean', 'float64', 'int64', 'decimal', 'date', 'datetime'].includes(entry.type)
  ) {
    fail(pointer(path, 'type'), 'Unknown presentation column type.')
  }
  if (typeof entry.nullable !== 'boolean') fail(pointer(path, 'nullable'), 'Expected a boolean.')
  if (entry.unit !== undefined) string(entry.unit, pointer(path, 'unit'), 128)
  return entry as unknown as DatasetColumn
}
function cell(value: unknown, column: DatasetColumn, path: string) {
  try {
    validateCell(value, column, path)
  } catch (error) {
    if (!(error instanceof PresentationContractError)) throw error
    throw new PresentationContractError(
      error.code,
      error.path,
      `column ${column.id} type=${column.type}: ${error.reason}`,
      error.hint,
    )
  }
}
function validateCell(value: unknown, column: DatasetColumn, path: string) {
  if (value === null) {
    if (!column.nullable) fail(path, 'Column does not allow null.')
    return
  }
  switch (column.type) {
    case 'boolean':
      if (typeof value !== 'boolean') fail(path, 'Expected a boolean.')
      break
    case 'float64':
      if (typeof value !== 'number' || !Number.isFinite(value))
        fail(path, 'Expected a finite number.')
      if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
        fail(path, 'An unsafe integer must use an int64 or decimal string.', 'numeric_precision')
      }
      break
    case 'int64': {
      if (typeof value !== 'string') {
        throw new PresentationContractError(
          'invalid_value',
          path,
          'Expected an exact integer string for signed int64; JSON numbers are not accepted. Write 42 as "42".',
          'Encode the original exact integer as a JSON string (for example, "42"). Do not stringify an already rounded number; persist the original exact DataFrame with Marivo persist_dataframe.',
        )
      }
      const text = string(value, path, 21)
      if (!/^-?(?:0|[1-9]\d*)$/.test(text)) fail(path, 'Expected an exact integer string.')
      const number = BigInt(text)
      if (number < -9_223_372_036_854_775_808n || number > 9_223_372_036_854_775_807n) {
        fail(path, 'Integer is outside signed int64; use decimal for larger integers.')
      }
      break
    }
    case 'decimal': {
      const text = string(value, path, 256)
      if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text)) {
        fail(path, 'Expected an exact finite decimal string.')
      }
      break
    }
    case 'date':
    case 'datetime':
      validatePresentationDate(value, path, column.type === 'datetime')
      break
    case 'string':
      if (
        typeof value !== 'string' ||
        value.length > budgets.text ||
        value.includes('\0') ||
        /[\uD800-\uDFFF]/u.test(value)
      ) {
        fail(path, 'Expected a bounded string.')
      }
      break
  }
}
function dataset(value: unknown, path: string): TypedDataset {
  const entry = object(value, path)
  keys(entry, ['schemaVersion', 'columns', 'rows', 'rowCount', 'limit', 'truncated'], [], path)
  version(entry, path)
  const columns = array(entry.columns, pointer(path, 'columns'), budgets.columns, 1).map(
    (value, i) => column(value, pointer(pointer(path, 'columns'), i)),
  )
  unique(
    columns.map((value) => value.id),
    pointer(path, 'columns'),
  )
  const rows = array(entry.rows, pointer(path, 'rows'), budgets.rows)
  if (rows.length * columns.length > budgets.cells)
    fail(pointer(path, 'rows'), 'Cell budget exceeded.', 'budget')
  const total = integer(entry.rowCount, pointer(path, 'rowCount'))
  const limit = integer(entry.limit, pointer(path, 'limit'), 1, budgets.rows)
  if (rows.length !== Math.min(total, limit))
    fail(pointer(path, 'rows'), 'Row count must equal min(rowCount, limit).')
  if (entry.truncated !== total > rows.length)
    fail(pointer(path, 'truncated'), 'Truncation must agree with rowCount and written rows.')
  rows.forEach((value, i) => {
    const rowPath = pointer(pointer(path, 'rows'), i)
    array(value, rowPath, columns.length, columns.length).forEach((value, j) => {
      cell(value, columns[j]!, pointer(rowPath, j))
    })
  })
  return entry as unknown as TypedDataset
}
export function parseTypedDataset(value: unknown, path = ''): TypedDataset {
  bytes(value, budgets.datasetBytes, path)
  return dataset(value, path)
}

/** Tables retain the original decimal/int64 spelling, including trailing decimal zeroes. */
export function formatCell(value: Cell, _column: DatasetColumn): string {
  return value === null ? '—' : String(value)
}

export function parsePresentationReceipt(value: unknown): PresentationReceipt {
  bytes(value, 16 * 1024)
  const entry = object(value, '')
  keys(
    entry,
    ['schemaVersion', 'kind', 'workspaceId', 'reportId', 'buildId', 'title', 'summary', 'files'],
    [],
    '',
  )
  version(entry, '', 2)
  if (entry.kind !== 'marivo.presentation') fail('/kind', 'Expected marivo.presentation receipt.')
  string(entry.workspaceId, '/workspaceId', 512)
  const reportId = parsePresentationBuildId(entry.reportId, '/reportId')
  const id = parsePresentationBuildId(entry.buildId, '/buildId')
  string(entry.title, '/title', 512)
  string(entry.summary, '/summary', 2048)
  const files = object(entry.files, '/files')
  keys(files, ['document'], [], '/files')
  for (const [key, asset, max] of [
    ['document', 'presentation.json', budgets.documentBytes],
  ] as const) {
    const path = `/files/${key}`
    const file = object(files[key], path)
    keys(file, ['asset', 'path', 'sha256', 'bytes'], [], path)
    if (file.asset !== asset) fail(`${path}/asset`, 'Unexpected fixed asset name.')
    const filePath = string(file.path, `${path}/path`, 4096)
    if (
      !filePath.startsWith('/') ||
      filePath.includes('\\') ||
      filePath
        .split('/')
        .slice(1)
        .some((segment) => !segment || segment === '.' || segment === '..') ||
      !filePath.endsWith(`/.dsh-data-analysis/presentations/${reportId}/builds/${id}/${asset}`)
    ) {
      fail(`${path}/path`, 'Asset path must identify this build in its Workspace.', 'file_boundary')
    }
    if (typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256))
      fail(`${path}/sha256`, 'Expected a lowercase SHA-256 digest.')
    integer(file.bytes, `${path}/bytes`, 1, max)
  }
  return entry as unknown as PresentationReceipt
}
