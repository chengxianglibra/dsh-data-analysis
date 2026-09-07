import type { Cell, DatasetColumn } from './types.ts'

export class PresentationContractError extends Error {
  readonly code: string
  readonly path: string
  readonly hint: string

  constructor(
    code: string,
    path: string,
    message: string,
    hint = 'Correct the value at this path.',
  ) {
    super(`${path || '/'}: ${message}`)
    this.name = 'PresentationContractError'
    this.code = code
    this.path = path
    this.hint = hint
  }
}

export function chartNumber(
  value: Cell,
  column: DatasetColumn,
  mode: 'exact' | 'approximate',
  path = '',
): number | null {
  if (value === null) return null
  if (!['float64', 'int64', 'decimal'].includes(column.type))
    throw new PresentationContractError('invalid_value', path, 'Chart series must be numeric.')
  if (
    mode === 'exact' &&
    (column.type === 'decimal' || (column.type === 'int64' && !Number.isSafeInteger(Number(value))))
  ) {
    throw new PresentationContractError(
      'numeric_precision',
      path,
      'Exact chart encoding cannot represent this value.',
      'Set numericMode to approximate explicitly, or show the exact value in a table.',
    )
  }
  const number = Number(value)
  if (!Number.isFinite(number))
    throw new PresentationContractError(
      'numeric_precision',
      path,
      'Chart encoding must remain finite.',
    )
  return number
}
