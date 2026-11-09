import { Renderer } from '@openuidev/react-lang'
import { useMemo } from 'react'
import type {
  AnalysisDocument,
  AnalysisResource,
} from '../../presentation/contracts/analysis-document.ts'
import { ReportCopyProvider } from '../i18n/context.tsx'
import type { OpenSemanticRef } from '../presentation/source-facts.ts'
import { PRESENTATION_STYLES } from '../presentation/styles.ts'
import { UIStyleSheet } from '../ui/theme.ts'
import { type AnalysisResourceContext, AnalysisResources } from './context.tsx'
import { FRAME_STYLES } from './frame/styles.ts'
import { LAYOUT_STYLES } from './layout.tsx'
import { analysisLibrary } from './library.tsx'
import { pendingAnalysisStatement, readableAnalysisPrefix } from './streaming-program.ts'

const styles = `
.pr-reader.au-surface{container:mv-surface/inline-size;min-width:0;max-width:100%;padding:0}
.au-surface-content{min-width:0;display:flex;flex-direction:column;gap:1.5rem;padding:1rem}
.au-surface-title{font-size:1.5rem;line-height:1.2;font-weight:600;letter-spacing:-.025em;margin:0;overflow-wrap:anywhere}
.au-surface p{overflow-wrap:anywhere}
.au-data{width:100%;min-width:0}
.au-source{min-width:0;display:grid;gap:.75rem}.au-source section{display:grid;gap:.5rem}.au-source ul{margin:0;padding-left:1.25rem}.au-source-trigger{align-self:flex-start}
.au-source-code{position:relative;min-width:0}.au-source-code pre{height:min(20rem,45vh);max-height:none;margin:0;padding-right:3rem;overflow:auto}.au-source-copy{position:absolute;top:.25rem;right:.25rem}
.au-source dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:.5rem 1rem}
.au-source dd{margin:0;overflow-wrap:anywhere}
.au-metric{display:grid;gap:1rem}
.au-metric-value{display:flex;align-items:baseline;gap:.5rem;flex-wrap:wrap;font-variant-numeric:tabular-nums}
.au-metric-value strong{font-size:1.5rem;line-height:1.2;overflow-wrap:anywhere}
.au-metric-value>span{color:var(--muted-foreground);font-size:.875rem}
.au-image{max-width:100%;height:auto;object-fit:contain;border-radius:var(--radius-lg)}
.au-text p:first-child{margin-top:0}
.au-text[data-size=small],.au-text[data-size=small-heavy]{font-size:.875rem}
.au-text[data-size=large],.au-text[data-size=large-heavy]{font-size:1.125rem}
.au-text[data-size=small-heavy],.au-text[data-size=large-heavy]{font-weight:600}
.au-text pre{overflow:auto}
.au-surface .pr-table-scroll{max-width:100%;overflow:auto}
.au-result-content{display:flex;flex-direction:column;gap:1rem;min-width:0}
`
/** Shared static renderer. Adapters supply saved resources; components never perform Host IO. */
export function AnalysisSurface({
  document,
  readResource,
  openSemanticRef,
  readCode,
  askPoint,
  askDataset,
  askResource,
  offline,
}: {
  document: AnalysisDocument
  readResource?: (name: string) => AnalysisResource | undefined
  openSemanticRef?: OpenSemanticRef
  readCode?: AnalysisResourceContext['readCode']
  askPoint?: AnalysisResourceContext['askPoint']
  askDataset?: AnalysisResourceContext['askDataset']
  askResource?: AnalysisResourceContext['askResource']
  offline?: boolean
}) {
  return (
    <AnalysisRenderer
      program={document.program}
      title={document.title}
      locale={document.locale}
      resources={document.resources}
      recordId={document.recordId}
      readResource={readResource}
      openSemanticRef={openSemanticRef}
      readCode={readCode}
      askPoint={askPoint}
      askDataset={askDataset}
      askResource={askResource}
      offline={offline}
    />
  )
}
export interface AnalysisRendererProps {
  program: string
  title: string
  locale: AnalysisDocument['locale']
  resources: AnalysisDocument['resources']
  recordId?: string
  readResource?: (name: string) => AnalysisResource | undefined
  isStreaming?: boolean
  candidateProgram?: string
  candidate?: boolean
  offline?: boolean
  openSemanticRef?: OpenSemanticRef
  /** Saved Host source reader; candidate previews never read code. */
  readCode?: AnalysisResourceContext['readCode']
  askPoint?: AnalysisResourceContext['askPoint']
  askDataset?: AnalysisResourceContext['askDataset']
  askResource?: AnalysisResourceContext['askResource']
}
export function AnalysisRenderer({
  program,
  title,
  locale,
  resources: saved,
  recordId,
  readResource,
  isStreaming = false,
  candidateProgram,
  candidate = false,
  offline = false,
  openSemanticRef,
  readCode,
  askPoint,
  askDataset,
  askResource,
}: AnalysisRendererProps) {
  const resources = useMemo(
    () => ({
      readResource: readResource ?? ((name: string) => saved[name]),
      candidate,
      isStreaming,
      pendingStatementId:
        candidate && isStreaming
          ? pendingAnalysisStatement(candidateProgram ?? program)
          : undefined,
      offline,
      openSemanticRef: candidate ? undefined : openSemanticRef,
      readCode: candidate ? undefined : readCode,
      askPoint: candidate ? undefined : askPoint,
      askDataset: candidate ? undefined : askDataset,
      askResource: candidate ? undefined : askResource,
    }),
    [
      saved,
      readResource,
      candidate,
      isStreaming,
      candidateProgram,
      program,
      offline,
      openSemanticRef,
      readCode,
      askPoint,
      askDataset,
      askResource,
    ],
  )
  return (
    <ReportCopyProvider locale={locale}>
      <AnalysisResources.Provider value={resources} key={recordId}>
        <article
          className="mv-ui pr-reader au-surface bg-background"
          lang={locale}
          data-analysis-record={recordId}
        >
          <style>{PRESENTATION_STYLES}</style>
          <UIStyleSheet />
          <style>{styles}</style>
          <style>{LAYOUT_STYLES}</style>
          <style>{FRAME_STYLES}</style>
          <div className="au-surface-content">
            <h1 className="au-surface-title">{title}</h1>
            <Renderer
              library={analysisLibrary}
              response={candidate && isStreaming ? readableAnalysisPrefix(program) : program}
              isStreaming={isStreaming}
              publishObservability={false}
            />
          </div>
        </article>
      </AnalysisResources.Provider>
    </ReportCopyProvider>
  )
}
