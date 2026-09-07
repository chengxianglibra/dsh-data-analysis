import { readFile } from 'node:fs/promises'
import { CHART_TYPES } from '../src/presentation/contracts/charts.ts'
import {
  parsePresentationDocument,
  parsePresentationDraft,
} from '../src/presentation/contracts/index.ts'

/** The shipped runnable Skill example is also the production browser gallery fixture. */
export async function chartGallery() {
  const root = new URL(
    '../skills/dsh-data-analysis-presentation/references/examples/',
    import.meta.url,
  )
  const draft = parsePresentationDraft(
    JSON.parse(await readFile(new URL('charts.draft.json', root), 'utf8')),
  )
  const document = parsePresentationDocument({
    schemaVersion: 1,
    workspaceId: 'chart-gallery-workspace',
    buildId: 'chart-gallery',
    title: draft.title,
    generatedAt: '2026-09-07T00:00:00Z',
    datasets: await Promise.all(
      draft.datasets.map(async (dataset) => {
        if (dataset.kind !== 'computed') throw new Error('Gallery must use explicit synthetic data')
        return {
          id: dataset.id,
          origin: 'computed',
          sourceIds: [],
          data: JSON.parse(await readFile(new URL(dataset.path.split('/').at(-1)!, root), 'utf8')),
        }
      }),
    ),
    sources: [],
    blocks: draft.blocks,
    diagnostics: [],
  })
  if (
    CHART_TYPES.some(
      (type) => !document.blocks.some((block) => block.kind === 'chart' && block.chart === type),
    )
  )
    throw new Error('Gallery must cover all chart types')
  return document
}
