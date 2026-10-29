import { lazy, Suspense } from 'react'
import type { AnalysisDocument } from '../../presentation/contracts/analysis-document.ts'
import { useCopy } from '../i18n/context.tsx'
import type { OpenSemanticRef } from '../presentation/source-facts.ts'
import type { AnalysisRendererProps } from './surface.tsx'

// OpenUI initializes browser-only dependencies. Keep it out of non-rendering Host slot setup.
const Surface = lazy(() =>
  import('./surface.tsx').then((module) => ({ default: module.AnalysisSurface })),
)
const CandidateSurface = lazy(() =>
  import('./surface.tsx').then((module) => ({ default: module.AnalysisRenderer })),
)
export function CandidateAnalysisSurface(props: AnalysisRendererProps) {
  const t = useCopy()
  return (
    <Suspense fallback={<p role="status">{t('marivo.presentation.ui-preparing')}</p>}>
      <CandidateSurface {...props} candidate />
    </Suspense>
  )
}
export function SavedAnalysisSurface({
  document,
  openSemanticRef,
}: {
  document: AnalysisDocument
  openSemanticRef?: OpenSemanticRef
}) {
  const t = useCopy()
  return (
    <Suspense fallback={<p role="status">{t('marivo.presentation.ui-loading')}</p>}>
      <Surface document={document} openSemanticRef={openSemanticRef} />
    </Suspense>
  )
}
