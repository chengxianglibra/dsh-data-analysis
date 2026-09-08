import type { PresentationBlock, PresentationDocument, PresentationInteraction } from './types.ts'

export function defaultSelection(interaction: PresentationInteraction): Record<string, string> {
  return Object.fromEntries(interaction.filters.map((filter) => [filter.id, filter.allOptionId]))
}

export function selectedSlice(
  interaction: PresentationInteraction,
  selection: Record<string, string>,
) {
  const slice = interaction.slices.find((slice) =>
    interaction.filters.every(
      (filter) =>
        Object.hasOwn(selection, filter.id) && slice.selection[filter.id] === selection[filter.id],
    ),
  )
  if (!slice) throw new Error('Unknown presentation filter combination.')
  return slice
}

export function interactionRows(
  interaction: PresentationInteraction | undefined,
  selection: Record<string, string>,
  block: PresentationBlock,
): number[] | undefined {
  if (!interaction?.blockIds.includes(block.id) || !('datasetId' in block)) return undefined
  const binding = selectedSlice(interaction, selection).datasets.find(
    (entry) => entry.datasetId === block.datasetId,
  )
  if (!binding) throw new Error('Missing presentation slice binding.')
  return binding.rowIndices
}

export function filterSummary(
  interaction: PresentationInteraction,
  selection: Record<string, string>,
): string {
  return interaction.filters
    .map((filter) => {
      const option = filter.options.find((option) => option.id === selection[filter.id])
      if (!option) throw new Error('Unknown presentation filter option.')
      return `${filter.label}：${option.label}`
    })
    .join(' · ')
}

/** Preserve the authored before / interactive / after boundary during host edits. */
export function blockRegion(document: PresentationDocument, id: string): number {
  if (!document.interaction) return 0
  if (document.interaction.blockIds.includes(id)) return 1
  return document.blocks.findIndex((block) => block.id === id) <
    document.blocks.findIndex((block) => block.id === document.interaction!.blockIds[0])
    ? 0
    : 2
}

export function editedInteraction(
  document: PresentationDocument,
  blocks: PresentationBlock[],
): PresentationInteraction | undefined {
  if (!document.interaction) return undefined
  const original = document.interaction
  const targets = blocks.filter((block) => original.blockIds.includes(block.id))
  if (!targets.length) return undefined
  const datasets = new Set(
    targets.flatMap((block) =>
      'datasetId' in block
        ? [
            block.datasetId,
            ...(block.kind === 'chart'
              ? (block.preparedViews ?? []).map((view) => view.datasetId)
              : []),
          ]
        : [],
    ),
  )
  return {
    ...original,
    blockIds: targets.map((block) => block.id),
    slices: original.slices.map((slice) => ({
      ...slice,
      datasets: slice.datasets.filter((entry) => datasets.has(entry.datasetId)),
    })),
  }
}
