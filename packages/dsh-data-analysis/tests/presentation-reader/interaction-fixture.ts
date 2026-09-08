import { readFile } from 'node:fs/promises'
import {
  parsePresentationDocument,
  parsePresentationDraft,
} from '../../src/presentation/contracts/index.ts'

export const interactionExamples = new URL(
  '../../skills/dsh-data-analysis-presentation/references/examples/',
  import.meta.url,
)
export async function interactionFixture() {
  const draft = parsePresentationDraft(
    JSON.parse(await readFile(new URL('interaction.draft.json', interactionExamples), 'utf8')),
  )
  const document = parsePresentationDocument({
    schemaVersion: 2,
    workspaceId: 'interaction-test',
    reportId: 'report',
    buildId: 'interaction-test',
    generatedAt: '2026-09-08T00:00:00Z',
    title: draft.title,
    sources: [],
    diagnostics: [],
    blocks: draft.blocks,
    interaction: draft.interaction,
    datasets: await Promise.all(
      draft.datasets.map(async (dataset) => {
        if (dataset.kind !== 'computed') throw new Error('Synthetic fixture must be computed')
        return {
          id: dataset.id,
          origin: 'computed',
          sourceIds: [],
          data: JSON.parse(
            await readFile(new URL(dataset.path.split('/').at(-1)!, interactionExamples), 'utf8'),
          ),
        }
      }),
    ),
  })
  return { draft, document }
}
