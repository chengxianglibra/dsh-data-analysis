import { chartColumns, parseChartViewShape, validateChartView } from './charts.ts'
import {
  PRESENTATION_BUDGETS as budgets,
  type Cell,
  type ChartView,
  type DatasetColumn,
  type PresentationBlock,
  type PresentationDocument,
  type PresentationDraft,
  type PresentationReceipt,
  type TypedDataset,
} from './types.ts'
import { PresentationContractError } from './values.ts'

export * from './charts.ts'
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
function stringArray(value: unknown, path: string, max: number, min = 0): string[] {
  const result = array(value, path, max, min).map((entry, i) =>
    string(entry, pointer(path, i), 512),
  )
  unique(result, path)
  return result
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
function date(value: unknown, path: string, datetime: boolean) {
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
function sourceRef(value: unknown, path: string) {
  const ref = object(value, path)
  keys(ref, ['sessionId', 'artifactRef'], ['findingId'], path)
  string(ref.sessionId, pointer(path, 'sessionId'), 512)
  string(ref.artifactRef, pointer(path, 'artifactRef'), 512)
  if (ref.findingId !== undefined) string(ref.findingId, pointer(path, 'findingId'), 512)
}
function sourceCode(value: unknown, path: string) {
  const snapshot = object(value, path)
  keys(snapshot, ['snippets', 'notices'], [], path)
  const identities = array(snapshot.snippets, `${path}/snippets`, budgets.codeSnippets).map(
    (value, i) => {
      const location = `${path}/snippets/${i}`
      const entry = object(value, location)
      keys(
        entry,
        ['language', 'text', 'provenance', 'runId', 'queryId', 'artifactRef'],
        [],
        location,
      )
      if (entry.language !== 'sql' || entry.provenance !== 'execution')
        fail(location, 'Expected SQL captured from a persisted execution.')
      if (!string(entry.text, `${location}/text`).trim())
        fail(`${location}/text`, 'Expected nonblank source code.')
      for (const field of ['runId', 'queryId', 'artifactRef'])
        string(entry[field], `${location}/${field}`, 512)
      return JSON.stringify([entry.runId, entry.queryId])
    },
  )
  unique(identities, `${path}/snippets`)
  stringArray(snapshot.notices, `${path}/notices`, 64)
}
function pythonCode(value: unknown, path: string, generated: boolean) {
  const identities = array(value, path, budgets.codeSnippets).map((value, i) => {
    const location = `${path}/${i}`
    const entry = object(value, location)
    keys(
      entry,
      generated
        ? ['executionId', 'sha256', 'language', 'text', 'provenance']
        : ['executionId', 'sha256'],
      [],
      location,
    )
    const id = string(entry.executionId, `${location}/executionId`, 36)
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))
      fail(`${location}/executionId`, 'Expected a captured execution UUID.')
    const digest = string(entry.sha256, `${location}/sha256`, 64)
    if (!/^[0-9a-f]{64}$/.test(digest))
      fail(`${location}/sha256`, 'Expected the captured execution SHA-256 digest.')
    if (generated) {
      if (entry.language !== 'python' || entry.provenance !== 'execution')
        fail(location, 'Expected Python captured from an execution.')
      const text = string(entry.text, `${location}/text`, 131_072)
      if (!text.trim() || new TextEncoder().encode(text).length > 131_072)
        fail(`${location}/text`, 'Expected nonblank Python source of at most 128 KiB.')
    }
    return id
  })
  unique(identities, path)
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
          'Encode the original exact integer as a JSON string (for example, "42"). Do not stringify an already rounded number; use the original data or the Python write_dataset helper.',
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
      date(value, path, column.type === 'datetime')
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
function common(value: Record<string, unknown>, generated: boolean) {
  version(value, '', generated ? 3 : 2)
  string(value.title, '/title', 512)
  const sources = array(value.sources, '/sources', budgets.sources)
  const sourceIds = sources.map((value, i) => {
    const path = `/sources/${i}`
    const entry = object(value, path)
    if (!generated) keys(entry, ['id', 'ref'], [], path)
    else if (entry.status === 'available') {
      keys(entry, ['id', 'ref', 'status', 'label', 'facts'], ['code'], path)
      if (entry.code !== undefined) sourceCode(entry.code, `${path}/code`)
      string(entry.label, `${path}/label`, 512)
      array(entry.facts, `${path}/facts`, 64).forEach((value, i) => {
        const factPath = `${path}/facts/${i}`
        const fact = object(value, factPath)
        keys(fact, ['label', 'value'], [], factPath)
        string(fact.label, `${factPath}/label`, 256)
        string(fact.value, `${factPath}/value`)
      })
    } else if (entry.status === 'unavailable') {
      keys(entry, ['id', 'ref', 'status', 'reason'], [], path)
      string(entry.reason, `${path}/reason`, 1024)
    } else fail(`${path}/status`, 'Expected available or unavailable.')
    sourceRef(entry.ref, `${path}/ref`)
    return string(entry.id, `${path}/id`, 256)
  })
  unique(sourceIds, '/sources')
  function references(ids: string[], path: string, scalar = false) {
    ids.forEach((id, i) => {
      if (!sourceIds.includes(id))
        fail(scalar ? path : pointer(path, i), 'Unknown source identifier.', 'invalid_reference')
    })
  }
  const datasets = array(value.datasets, '/datasets', budgets.datasets).map((value, i) => {
    const path = `/datasets/${i}`
    const entry = object(value, path)
    string(entry.id, `${path}/id`, 256)
    if (generated) {
      keys(entry, ['id', 'origin', 'data', 'sourceIds'], ['code'], path)
      if (entry.code !== undefined) pythonCode(entry.code, `${path}/code`, true)
      if (entry.origin !== 'artifact' && entry.origin !== 'computed')
        fail(`${path}/origin`, 'Expected artifact or computed.')
      bytes(entry.data, budgets.datasetBytes, `${path}/data`)
      dataset(entry.data, `${path}/data`)
      const ids = stringArray(entry.sourceIds, `${path}/sourceIds`, budgets.sources)
      references(ids, `${path}/sourceIds`)
      if (
        entry.origin === 'artifact' &&
        (ids.length !== 1 ||
          object(sources[sourceIds.indexOf(ids[0]!)], '/sources').status !== 'available')
      ) {
        fail(
          `${path}/sourceIds`,
          'A direct Artifact dataset requires one available source.',
          'invalid_reference',
        )
      }
    } else if (entry.kind === 'artifact') {
      keys(entry, ['id', 'kind', 'sourceId', 'rowLimit'], ['columns', 'codeRefs'], path)
      references([string(entry.sourceId, `${path}/sourceId`, 256)], `${path}/sourceId`, true)
      integer(entry.rowLimit, `${path}/rowLimit`, 1, budgets.rows)
      if (entry.columns !== undefined)
        stringArray(entry.columns, `${path}/columns`, budgets.columns, 1)
    } else if (entry.kind === 'computed') {
      keys(entry, ['id', 'kind', 'path', 'sourceIds'], ['codeRefs'], path)
      const file = string(entry.path, `${path}/path`, 1024)
      if (
        file.startsWith('/') ||
        file.includes('\\') ||
        file.split('/').some((segment) => !segment || segment === '.' || segment === '..')
      ) {
        fail(
          `${path}/path`,
          'Expected a relative Workspace file path without traversal.',
          'file_boundary',
        )
      }
      references(
        stringArray(entry.sourceIds, `${path}/sourceIds`, budgets.sources),
        `${path}/sourceIds`,
      )
    } else fail(`${path}/kind`, 'Expected artifact or computed.')
    if (!generated && entry.codeRefs !== undefined)
      pythonCode(entry.codeRefs, `${path}/codeRefs`, false)
    return entry
  })
  unique(
    datasets.map((entry) => String(entry.id)),
    '/datasets',
  )
  const declaredInteraction = value.interaction as { blockIds?: unknown } | undefined
  const inRegion = (id: string) =>
    Array.isArray(declaredInteraction?.blockIds) && declaredInteraction.blockIds.includes(id)
  const blockIds = array(value.blocks, '/blocks', budgets.blocks, generated ? 0 : 1).map(
    (value, i) => {
      const path = `/blocks/${i}`
      const entry = object(value, path)
      const id = string(entry.id, `${path}/id`, 256)
      if (entry.kind === 'markdown') {
        keys(entry, ['id', 'kind', 'text'], [], path)
        string(entry.text, `${path}/text`)
        return id
      }
      if (entry.kind === 'source') {
        keys(entry, ['id', 'kind', 'sourceIds'], [], path)
        references(
          stringArray(entry.sourceIds, `${path}/sourceIds`, budgets.sources, 1),
          `${path}/sourceIds`,
        )
        return id
      }
      let selected: string[]
      if (entry.kind === 'table') {
        keys(entry, ['id', 'kind', 'datasetId'], ['columns'], path)
        selected =
          entry.columns === undefined
            ? []
            : stringArray(entry.columns, `${path}/columns`, budgets.columns, 1)
      } else if (entry.kind === 'metric') {
        keys(
          entry,
          ['id', 'kind', 'datasetId', 'columnId', 'label'],
          ['rowIndex', 'rowSelection', 'description', 'comparisons'],
          path,
        )
        if (entry.rowSelection !== undefined) {
          if (entry.rowSelection !== 'slice' || Object.hasOwn(entry, 'rowIndex'))
            fail(path, 'Use either rowIndex or rowSelection: slice.')
        } else integer(entry.rowIndex, `${path}/rowIndex`, 0, budgets.rows - 1)
        selected = [string(entry.columnId, `${path}/columnId`, 256)]
        string(entry.label, `${path}/label`, 512)
        if (entry.description !== undefined) string(entry.description, `${path}/description`, 512)
        if (entry.comparisons !== undefined) {
          const comparisonLabels: string[] = []
          array(entry.comparisons, `${path}/comparisons`, 4, 1).forEach((value, i) => {
            const at = `${path}/comparisons/${i}`
            const comparison = object(value, at)
            keys(
              comparison,
              ['label'],
              ['referenceColumnId', 'deltaColumnId', 'relativeColumnId', 'sentiment'],
              at,
            )
            comparisonLabels.push(string(comparison.label, `${at}/label`, 256))
            const bindings = ['referenceColumnId', 'deltaColumnId', 'relativeColumnId'].filter(
              (key) => comparison[key] !== undefined,
            )
            if (!bindings.length) fail(at, 'Comparison requires at least one prepared value.')
            for (const key of bindings) selected.push(string(comparison[key], `${at}/${key}`, 256))
            if (
              comparison.sentiment !== undefined &&
              (typeof comparison.sentiment !== 'string' ||
                !['higher-is-better', 'lower-is-better', 'neutral'].includes(comparison.sentiment))
            )
              fail(`${at}/sentiment`, 'Unknown comparison sentiment.')
          })
          unique(comparisonLabels, `${path}/comparisons`)
        }
      } else if (entry.kind === 'chart') {
        keys(
          entry,
          ['id', 'kind', 'datasetId', 'chart', 'x', 'y', 'numericMode'],
          ['bindings', 'options', 'preparedViews'],
          path,
        )
        const { id: _id, kind: _kind, preparedViews, ...view } = entry
        parseChartViewShape(view, path)
        selected = chartColumns(view as unknown as ChartView)
        if (preparedViews !== undefined) {
          const ids = array(preparedViews, `${path}/preparedViews`, budgets.blocks, 1).map(
            (value, i) => {
              const viewPath = `${path}/preparedViews/${i}`
              const prepared = object(value, viewPath)
              const { id, label, ...binding } = prepared
              string(id, `${viewPath}/id`, 256)
              string(label, `${viewPath}/label`, 512)
              parseChartViewShape(binding, viewPath)
              const target = datasets.find((entry) => entry.id === binding.datasetId)
              if (!target)
                fail(`${viewPath}/datasetId`, 'Unknown dataset identifier.', 'invalid_reference')
              if (generated)
                validateChartView(
                  binding as unknown as ChartView,
                  inRegion(String(entry.id))
                    ? { ...(target.data as TypedDataset), rows: [] }
                    : (target.data as TypedDataset),
                  viewPath,
                  `/datasets/${datasets.indexOf(target)}/data`,
                )
              return id as string
            },
          )
          unique(ids, `${path}/preparedViews`)
        }
      } else fail(`${path}/kind`, 'Unknown presentation block.')
      const datasetId = string(entry.datasetId, `${path}/datasetId`, 256)
      const target = datasets.find((entry) => entry.id === datasetId)
      if (!target) fail(`${path}/datasetId`, 'Unknown dataset identifier.', 'invalid_reference')
      if (generated) {
        const data = target.data as TypedDataset
        selected.forEach((columnId) => {
          if (!data.columns.some((entry) => entry.id === columnId))
            fail(path, `Unknown column ${columnId}.`, 'invalid_reference')
        })
        if (entry.kind === 'metric' && entry.comparisons !== undefined) {
          for (const id of selected) {
            if (
              !['int64', 'decimal', 'float64'].includes(
                data.columns.find((column) => column.id === id)!.type,
              )
            )
              fail(path, 'Metric comparisons require numeric columns.')
          }
        }
        if (entry.kind === 'metric' && Number(entry.rowIndex) >= data.rows.length)
          fail(`${path}/rowIndex`, 'Metric must select one existing row.', 'invalid_reference')
        if (entry.kind === 'chart') {
          validateChartView(
            entry as unknown as ChartView,
            inRegion(id) ? { ...data, rows: [] } : data,
            path,
            `/datasets/${datasets.indexOf(target)}/data`,
          )
        }
      }
      return id
    },
  )
  unique(blockIds, '/blocks')
  interaction(value, datasets, generated)
}

function interaction(
  value: Record<string, unknown>,
  datasets: Record<string, unknown>[],
  generated: boolean,
) {
  const blocks = value.blocks as PresentationBlock[]
  const dynamic = blocks.filter(
    (block) => block.kind === 'metric' && block.rowSelection === 'slice',
  )
  if (value.interaction === undefined) {
    if (dynamic.length) fail('/interaction', 'Dynamic metrics require an interaction region.')
    return
  }
  const path = '/interaction'
  const entry = object(value.interaction, path)
  keys(entry, ['title', 'blockIds', 'filters', 'slices'], [], path)
  string(entry.title, `${path}/title`, 512)
  const ids = stringArray(entry.blockIds, `${path}/blockIds`, budgets.blocks, 1)
  const targets = ids.map((id, i) => {
    const block = blocks.find((block) => block.id === id)
    if (!block || !('datasetId' in block))
      fail(
        `${path}/blockIds/${i}`,
        'Region requires existing metric, chart or table blocks.',
        'invalid_reference',
      )
    if (block.kind === 'metric' && block.rowSelection !== 'slice')
      fail(`${path}/blockIds/${i}`, 'Region metrics must select a slice row.')
    return block
  })
  unique(ids, `${path}/blockIds`)
  const positions = targets.map((block) => blocks.indexOf(block))
  if (positions.some((position, i) => position !== positions[0]! + i))
    fail(`${path}/blockIds`, 'Region blocks must be consecutive and follow document order.')
  if (dynamic.some((block) => !ids.includes(block.id)))
    fail(`${path}/blockIds`, 'Every dynamic metric must belong to the region.')
  const required = new Set(
    targets.flatMap((block) => [
      block.datasetId,
      ...(block.kind === 'chart' ? (block.preparedViews ?? []).map((view) => view.datasetId) : []),
    ]),
  )
  const filters = array(entry.filters, `${path}/filters`, budgets.columns, 1).map((item, i) => {
    const at = `${path}/filters/${i}`
    const filter = object(item, at)
    keys(filter, ['id', 'label', 'allOptionId', 'options'], [], at)
    string(filter.id, `${at}/id`, 256)
    string(filter.label, `${at}/label`, 512)
    const all = string(filter.allOptionId, `${at}/allOptionId`, 256)
    const options = array(filter.options, `${at}/options`, budgets.rows, 2).map((item, j) => {
      const optionPath = `${at}/options/${j}`
      const option = object(item, optionPath)
      keys(option, ['id', 'label'], [], optionPath)
      string(option.label, `${optionPath}/label`, 512)
      return string(option.id, `${optionPath}/id`, 256)
    })
    unique(options, `${at}/options`)
    if (!options.includes(all))
      fail(`${at}/allOptionId`, 'Unknown all option.', 'invalid_reference')
    return { id: filter.id as string, options }
  })
  unique(
    filters.map((filter) => filter.id),
    `${path}/filters`,
  )
  const slices = array(entry.slices, `${path}/slices`, budgets.draftBytes, 1)
  // Bound the product by the already byte-bounded slice list, without expanding combinations.
  let combinations = 1
  for (const filter of filters) {
    combinations *= filter.options.length
    if (combinations > slices.length)
      fail(`${path}/slices`, 'Every selectable combination requires one slice.')
  }
  if (combinations !== slices.length)
    fail(`${path}/slices`, 'Every selectable combination requires exactly one slice.')
  const seen = new Set<string>()
  slices.forEach((item, i) => {
    const at = `${path}/slices/${i}`
    const slice = object(item, at)
    keys(slice, ['selection', 'datasets'], [], at)
    const selection = object(slice.selection, `${at}/selection`)
    keys(
      selection,
      filters.map((filter) => filter.id),
      [],
      `${at}/selection`,
    )
    const combination = filters.map((filter) => {
      const selected = string(selection[filter.id], pointer(`${at}/selection`, filter.id), 256)
      if (!filter.options.includes(selected))
        fail(`${at}/selection`, 'Unknown filter option.', 'invalid_reference')
      return selected
    })
    const key = JSON.stringify(combination)
    if (seen.has(key)) fail(`${at}/selection`, 'Duplicate filter combination.')
    seen.add(key)
    const bindings = array(slice.datasets, `${at}/datasets`, budgets.datasets, 1).map((item, j) => {
      const bindingPath = `${at}/datasets/${j}`
      const binding = object(item, bindingPath)
      keys(binding, ['datasetId', 'rowIndices'], [], bindingPath)
      const id = string(binding.datasetId, `${bindingPath}/datasetId`, 256)
      if (!required.has(id))
        fail(`${bindingPath}/datasetId`, 'Unexpected slice dataset.', 'invalid_reference')
      const data = datasets.find((dataset) => dataset.id === id)?.data as TypedDataset | undefined
      const rows = array(binding.rowIndices, `${bindingPath}/rowIndices`, budgets.rows).map(
        (row, k) => integer(row, `${bindingPath}/rowIndices/${k}`, 0, budgets.rows - 1),
      )
      if (new Set(rows).size !== rows.length)
        fail(`${bindingPath}/rowIndices`, 'Duplicate row index.')
      if (generated && rows.some((row) => row >= data!.rows.length))
        fail(`${bindingPath}/rowIndices`, 'Slice references a missing row.', 'invalid_reference')
      if (
        dynamic.some((block) => 'datasetId' in block && block.datasetId === id) &&
        rows.length !== 1
      )
        fail(
          `${bindingPath}/rowIndices`,
          'Dynamic metrics require exactly one prepared row per slice.',
        )
      return id
    })
    unique(bindings, `${at}/datasets`)
    if (bindings.length !== required.size)
      fail(`${at}/datasets`, 'Slice must cover every region dataset and prepared view.')
    if (generated) {
      for (const block of targets) {
        if (block.kind !== 'chart') continue
        for (const view of [block, ...(block.preparedViews ?? [])]) {
          const target = datasets.find((dataset) => dataset.id === view.datasetId)!
          const binding = (slice.datasets as { datasetId: string; rowIndices: number[] }[]).find(
            (binding) => binding.datasetId === view.datasetId,
          )!
          validateChartView(
            view,
            target.data as TypedDataset,
            at,
            `/datasets/${datasets.indexOf(target)}/data`,
            binding.rowIndices,
          )
        }
      }
    }
  })
}

function presentationLanguage(value: Record<string, unknown>, expected: number) {
  if (value.schemaVersion !== expected)
    fail(
      '/schemaVersion',
      `Only schemaVersion ${expected} is accepted. Regenerate this report with an explicit locale.`,
      'report-version-unsupported',
    )
  if (value.locale !== 'zh-CN' && value.locale !== 'en-US')
    fail(
      '/locale',
      'Report locale must be zh-CN or en-US. Ask DSH to regenerate the report with an explicit language.',
      'report-locale-invalid',
    )
}

export function parsePresentationDraft(value: unknown): PresentationDraft {
  bytes(value, budgets.draftBytes)
  const entry = object(value, '')
  presentationLanguage(entry, 2)
  keys(
    entry,
    ['schemaVersion', 'locale', 'title', 'datasets', 'sources', 'blocks'],
    ['interaction'],
    '',
  )
  common(entry, false)
  return entry as unknown as PresentationDraft
}
export function parsePresentationDocument(value: unknown): PresentationDocument {
  bytes(value, budgets.documentBytes)
  const entry = object(value, '')
  presentationLanguage(entry, 3)
  keys(
    entry,
    [
      'schemaVersion',
      'locale',
      'workspaceId',
      'reportId',
      'buildId',
      'title',
      'generatedAt',
      'datasets',
      'sources',
      'blocks',
      'diagnostics',
    ],
    ['interaction'],
    '',
  )
  string(entry.workspaceId, '/workspaceId', 512)
  parsePresentationBuildId(entry.reportId, '/reportId')
  parsePresentationBuildId(entry.buildId, '/buildId')
  date(entry.generatedAt, '/generatedAt', true)
  array(entry.diagnostics, '/diagnostics', 128).forEach((value, i) => {
    const path = `/diagnostics/${i}`
    const diagnostic = object(value, path)
    keys(diagnostic, ['code', 'path', 'message'], [], path)
    string(diagnostic.code, `${path}/code`, 128)
    string(diagnostic.message, `${path}/message`, 1024)
    if (typeof diagnostic.path !== 'string' || !/^(?:\/(?:[^~]|~[01])*)*$/.test(diagnostic.path)) {
      fail(`${path}/path`, 'Expected a JSON pointer.')
    }
  })
  common(entry, true)
  return entry as unknown as PresentationDocument
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
  keys(files, ['document'], ['html'], '/files')
  for (const [key, asset, max] of [
    ['document', 'presentation.json', budgets.documentBytes],
    ['html', 'index.html', budgets.htmlBytes],
  ] as const) {
    if (key === 'html' && !Object.hasOwn(files, key)) continue
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
  const documentPath = String(object(files.document, '/files/document').path)
  const htmlPath = files.html ? String(object(files.html, '/files/html').path) : undefined
  if (
    htmlPath !== undefined &&
    documentPath.slice(0, -'presentation.json'.length) !== htmlPath.slice(0, -'index.html'.length)
  ) {
    fail('/files/html/path', 'Both files must belong to the same build directory.', 'file_boundary')
  }
  return entry as unknown as PresentationReceipt
}
