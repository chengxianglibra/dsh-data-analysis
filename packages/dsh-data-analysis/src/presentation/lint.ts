import {
  PRESENTATION_BUDGETS,
  PresentationContractError,
  parsePresentationDraft,
  parseTypedDataset,
} from './contracts/index.ts'
import { readWorkspaceJson } from './projection/files.ts'

/** Static preflight only: never starts a Runtime or publishes presentation assets. */
export async function lintPresentationDraft(workspaceRoot: string, draftPath: string) {
  const diagnostics: { code: string; path: string; message: string; hint: string }[] = []
  let checkedComputedDatasets = 0
  const record = (error: unknown) => {
    if (!(error instanceof PresentationContractError)) throw error
    diagnostics.push({
      code: error.code,
      path: error.path,
      message: error.message,
      hint: error.hint,
    })
  }
  try {
    const draft = parsePresentationDraft(
      await readWorkspaceJson(
        workspaceRoot,
        draftPath,
        PRESENTATION_BUDGETS.draftBytes,
        '/draft_path',
      ),
    )
    for (const [index, dataset] of draft.datasets.entries()) {
      if (dataset.kind !== 'computed') continue
      try {
        const data = await readWorkspaceJson(
          workspaceRoot,
          dataset.path,
          PRESENTATION_BUDGETS.datasetBytes,
          `/datasets/${index}/path`,
        )
        parseTypedDataset(data, `/datasets/${index}/data`)
        checkedComputedDatasets++
      } catch (error) {
        record(error)
      }
    }
  } catch (error) {
    record(error)
  }
  return {
    ok: diagnostics.length === 0,
    scope: 'draft-structure-and-computed-data',
    checkedComputedDatasets,
    diagnostics,
    deferredChecks: [
      'artifact-availability-and-data',
      'codeRefs',
      'projected-document-and-rendering',
    ],
  }
}
