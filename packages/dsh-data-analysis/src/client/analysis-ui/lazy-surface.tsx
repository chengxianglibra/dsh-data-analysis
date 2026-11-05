import { lazy, Suspense } from 'react'
import type { AnalysisDocument } from '../../presentation/contracts/analysis-document.ts'
import { useCopy } from '../i18n/context.tsx'
import type { OpenSemanticRef } from '../presentation/source-facts.ts'
import { HostOverlayProvider } from '../ui/host-overlays.tsx'
import { Skeleton } from '../ui/primitives/skeleton.tsx'
import { UIStyleSheet } from '../ui/theme.ts'
import type { AnalysisResourceContext } from './context.tsx'
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
    <Suspense
      fallback={
        <div className="mv-ui" role="status">
          <UIStyleSheet />
          <p>{t('marivo.presentation.ui-preparing')}</p>
          <Skeleton className="h-24 w-full" />
        </div>
      }
    >
      <HostOverlayProvider>
        <CandidateSurface {...props} candidate />
      </HostOverlayProvider>
    </Suspense>
  )
}
export function SavedAnalysisSurface({
  document,
  openSemanticRef,
  readCode,
  askPoint,
  askDataset,
  askResource,
}: {
  document: AnalysisDocument
  openSemanticRef?: OpenSemanticRef
  readCode?: AnalysisResourceContext['readCode']
  askPoint?: AnalysisResourceContext['askPoint']
  askDataset?: AnalysisResourceContext['askDataset']
  askResource?: AnalysisResourceContext['askResource']
}) {
  const t = useCopy()
  return (
    <Suspense
      fallback={
        <div className="mv-ui" role="status">
          <UIStyleSheet />
          <p>{t('marivo.presentation.ui-loading')}</p>
          <Skeleton className="h-24 w-full" />
        </div>
      }
    >
      <HostOverlayProvider>
        <Surface
          document={document}
          openSemanticRef={openSemanticRef}
          readCode={readCode}
          askPoint={askPoint}
          askDataset={askDataset}
          askResource={askResource}
        />
      </HostOverlayProvider>
    </Suspense>
  )
}
