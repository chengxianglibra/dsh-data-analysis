import { PRESENTATION_BUDGETS, parsePresentationDocument } from './index.ts'
import { blockRegion, editedInteraction } from './interaction.ts'
import type { PresentationBlock, PresentationDocument } from './types.ts'

export interface PresentationEdits {
  title: string
  blocks: PresentationBlock[]
}

export function presentationEdits(document: PresentationDocument): PresentationEdits {
  return structuredClone({ title: document.title, blocks: document.blocks })
}

/** Only presentation fields are accepted. Saved data, sources and captured code stay server-owned. */
export function applyPresentationEdits(
  base: PresentationDocument,
  value: unknown,
): PresentationDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid-report-edits')
  const edits = value as PresentationEdits
  if (
    Object.keys(edits).sort().join(',') !== 'blocks,title' ||
    !Array.isArray(edits.blocks) ||
    new TextEncoder().encode(JSON.stringify(edits)).length > PRESENTATION_BUDGETS.documentBytes
  )
    throw new Error('invalid-report-edits')
  const regions = edits.blocks.map((block) => blockRegion(base, block.id))
  if (regions.some((region, i) => i > 0 && region < regions[i - 1]!))
    throw new Error('invalid-report-edits: cannot move across interaction boundaries')
  const candidate = { ...structuredClone(base), ...structuredClone(edits) }
  const interaction = editedInteraction(base, edits.blocks)
  if (interaction) candidate.interaction = interaction
  else delete candidate.interaction
  const next = parsePresentationDocument(candidate)
  for (const block of next.blocks) {
    const original = base.blocks.find((entry) => entry.id === block.id)
    if (!original || original.kind !== block.kind) throw new Error('invalid-report-edits')
    const fixed = (entry: PresentationBlock) => {
      switch (entry.kind) {
        case 'markdown':
          return { id: entry.id, kind: entry.kind }
        case 'metric': {
          const { label: _, ...identity } = entry
          return identity
        }
        case 'table': {
          const { columns: _, ...identity } = entry
          return identity
        }
        case 'chart':
          return { id: entry.id, kind: entry.kind, preparedViews: entry.preparedViews }
        case 'source':
          return entry
      }
    }
    if (JSON.stringify(fixed(block)) !== JSON.stringify(fixed(original)))
      throw new Error('invalid-report-edits')
    if (
      block.kind === 'chart' &&
      original.kind === 'chart' &&
      ![
        original.datasetId,
        ...(original.preparedViews ?? []).map((view) => view.datasetId),
      ].includes(block.datasetId)
    )
      throw new Error('invalid-report-edits')
  }
  return next
}
