/** Browser-safe wire contracts. These bounds do not reimplement Marivo's domain grammar. */
export const CHANNEL = '/dsh-data-analysis'
export const SOURCE = 'marivo-semantic'
export const MAX_WIRE_BYTES = 1024 * 1024
export interface SemanticRef {
  readonly schema: 'marivo.semantic_ref/v1'
  readonly kind: string
  readonly path: string
}
export interface Envelope {
  readonly schema: 'dsh-data-analysis-semantic-reference/v1'
  readonly sessionId: string
  readonly environmentFingerprint: string
  readonly ref: SemanticRef
}
export interface Candidate {
  readonly ref: SemanticRef
  readonly refKey: string
  readonly name: string
  readonly businessDefinition: string | null
}
export interface Projection {
  readonly kinds: readonly string[]
  readonly items: readonly Candidate[]
}
export interface RankedCandidate extends Candidate {
  readonly section: 'recent' | 'kind' | 'strict' | 'fuzzy'
}
export interface CandidatesResponse {
  readonly environmentFingerprint: string
  readonly items: readonly RankedCandidate[]
}
export function closed(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('invalid-request')
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== keys.length || keys.some((key) => !Object.hasOwn(record, key)))
    throw new Error('invalid-request')
  return record
}
export function boundedText(value: unknown, max: number, empty = false): string {
  if (
    typeof value !== 'string' ||
    value.length > max * 2 ||
    (!empty && value.length === 0) ||
    Array.from(value).length > max
  )
    throw new Error('invalid-request')
  return value
}
export function parseJson(value: unknown, max = 16_384): unknown {
  const text = boundedText(value, max)
  return JSON.parse(text)
}
export function parseRef(value: unknown): SemanticRef {
  const r = closed(value, ['schema', 'kind', 'path'])
  if (r.schema !== 'marivo.semantic_ref/v1') throw new Error('invalid-request')
  return Object.freeze({
    schema: r.schema,
    kind: boundedText(r.kind, 128),
    path: boundedText(r.path, 2048),
  })
}
export function refKey(ref: SemanticRef): string {
  return `${ref.kind}:${ref.path}`
}
export function parseEnvelope(value: unknown): Envelope {
  const r = closed(value, ['schema', 'sessionId', 'environmentFingerprint', 'ref'])
  if (r.schema !== 'dsh-data-analysis-semantic-reference/v1') throw new Error('invalid-request')
  return Object.freeze({
    schema: r.schema,
    sessionId: boundedText(r.sessionId, 256),
    environmentFingerprint: boundedText(r.environmentFingerprint, 256),
    ref: parseRef(r.ref),
  })
}
export function envelopeJson(envelope: Envelope): string {
  return JSON.stringify(parseEnvelope(envelope))
}
export function modelMarker(envelope: Envelope): string {
  // Keep JSON inside one marker even when a valid domain path contains markup characters.
  const json = JSON.stringify(parseRef(envelope.ref))
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
  return `<marivo-semantic-ref>${json}</marivo-semantic-ref>`
}
export function parseCandidate(value: unknown): Candidate {
  const r = closed(value, ['ref', 'refKey', 'name', 'businessDefinition'])
  const ref = parseRef(r.ref)
  if (r.refKey !== refKey(ref)) throw new Error('invalid-request')
  return Object.freeze({
    ref,
    refKey: r.refKey,
    name: boundedText(r.name, 2048),
    businessDefinition:
      r.businessDefinition === null ? null : boundedText(r.businessDefinition, 240, true),
  })
}
export function parseProjection(value: unknown): Projection {
  const r = closed(value, ['kinds', 'items'])
  if (
    !Array.isArray(r.kinds) ||
    r.kinds.length > 128 ||
    !Array.isArray(r.items) ||
    r.items.length > 100_000
  )
    throw new Error('invalid-request')
  const kinds = r.kinds.map((kind) => boundedText(kind, 128))
  if (new Set(kinds).size !== kinds.length) throw new Error('invalid-request')
  const items = r.items.map(parseCandidate)
  if (
    new Set(items.map((item) => item.refKey)).size !== items.length ||
    items.some((item) => !kinds.includes(item.ref.kind))
  )
    throw new Error('invalid-request')
  return Object.freeze({ kinds: Object.freeze(kinds), items: Object.freeze(items) })
}
export function parseCandidatesRequest(value: unknown) {
  const r = closed(value, ['version', 'sessionId', 'query', 'quoted'])
  if (r.version !== 1 || typeof r.quoted !== 'boolean') throw new Error('invalid-request')
  return {
    version: 1,
    sessionId: boundedText(r.sessionId, 256),
    query: boundedText(r.query, 128, true),
    quoted: r.quoted,
  }
}
export function parseCandidatesResponse(value: unknown): CandidatesResponse {
  const r = closed(value, ['environmentFingerprint', 'items'])
  if (!Array.isArray(r.items)) throw new Error('invalid-response')
  const items = r.items.map((raw): RankedCandidate => {
    const item = closed(raw, ['ref', 'refKey', 'name', 'businessDefinition', 'section'])
    const { section, ...candidate } = item
    if (section !== 'recent' && section !== 'kind' && section !== 'strict' && section !== 'fuzzy')
      throw new Error('invalid-response')
    return { ...parseCandidate(candidate), section }
  })
  return {
    environmentFingerprint: boundedText(r.environmentFingerprint, 256),
    items,
  }
}
