import { parseRef, type SemanticRef } from '../../semantic-reference/contracts.ts'

export type OpenSemanticRef = (ref: SemanticRef) => void

export function sourceSemanticRef(kind: string, path: string): SemanticRef | undefined {
  try {
    return parseRef({ schema: 'marivo.semantic_ref/v1', kind, path })
  } catch {
    return undefined
  }
}
