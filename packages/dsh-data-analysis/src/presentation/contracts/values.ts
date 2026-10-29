export class PresentationContractError extends Error {
  readonly code: string
  readonly path: string
  readonly hint: string
  readonly reason: string

  constructor(
    code: string,
    path: string,
    message: string,
    hint = 'Correct the value at this path.',
  ) {
    super(`${path || '/'}: ${message}`)
    this.name = 'PresentationContractError'
    this.reason = message
    this.code = code
    this.path = path
    this.hint = hint
  }
}
