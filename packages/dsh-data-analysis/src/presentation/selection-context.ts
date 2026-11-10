import type { AnalysisDocument } from './contracts/analysis-document.ts'

/** Only persisted result declarations carry a complete public Marivo reference. */
export function savedResultContext(document: Pick<AnalysisDocument, 'resources'>, name: string) {
  const resource = document.resources[name]
  if (resource?.kind !== 'snapshot') throw new Error('resource-unavailable')
  const declaration = resource.declaration
  return declaration.kind === 'analysis-frame' || declaration.kind === 'dataframe'
    ? {
        resultRef: declaration.ref,
        usage:
          'Saved fixed result, not a new query. Read data through Marivo using this exact resultRef in the bound Runtime/project; verify its identity and report read failures. Use marivo_ui_read only for report organization.',
      }
    : {
        resultRef: null,
        usage:
          'Legacy captured snapshot without a complete Marivo result reference. Do not reconstruct a result reference or silently rerun analysis. marivo_ui_read reads report organization, not business rows.',
      }
}
