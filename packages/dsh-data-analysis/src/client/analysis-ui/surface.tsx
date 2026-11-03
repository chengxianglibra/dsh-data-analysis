import { Renderer } from '@openuidev/react-lang'
import { useMemo } from 'react'
import type {
  AnalysisDocument,
  AnalysisResource,
} from '../../presentation/contracts/analysis-document.ts'
import { ReportCopyProvider } from '../i18n/context.tsx'
import type { OpenSemanticRef } from '../presentation/source-facts.ts'
import { PRESENTATION_STYLES } from '../presentation/styles.ts'
import { UI_STYLES } from '../ui/theme.ts'
import { type AnalysisResourceContext, AnalysisResources } from './context.tsx'
import { FRAME_STYLES } from './frame/styles.ts'
import { LAYOUT_STYLES } from './layout.tsx'
import { analysisLibrary } from './library.tsx'

const styles = `
.pr-reader.au-surface{--pr-bg:var(--mv-bg);--pr-soft:var(--mv-soft);--pr-text:var(--mv-text);--pr-muted:var(--mv-muted);--pr-border:var(--mv-border);--pr-accent:var(--mv-accent);--pr-warning:var(--mv-warning);container:mv-surface/inline-size;color:var(--mv-text);background:var(--mv-bg);font:14px/22px system-ui,sans-serif;letter-spacing:normal;min-width:0;max-width:100%;padding:0;border-radius:12px;box-sizing:border-box}
.au-surface-content{min-width:0;padding:16px}.au-surface *{min-width:0}.au-surface h1{font:600 22px/30px system-ui,sans-serif;letter-spacing:normal;margin:0 0 20px;overflow-wrap:anywhere}.au-surface p{overflow-wrap:anywhere}.au-data{border:1px solid var(--pr-border);border-radius:10px;padding:12px;background:var(--pr-bg);width:100%}.au-data-heading{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}.au-data-heading strong{overflow-wrap:anywhere}.au-columns,.au-source{margin-top:12px;font-size:12px;color:var(--pr-muted)}.au-columns>div{display:flex;flex-wrap:wrap;gap:8px 16px;padding:8px 0}.au-columns label{display:flex;align-items:center;gap:4px}.au-source summary,.au-columns summary{cursor:pointer}.au-source pre{overflow:auto;max-height:240px;font-size:12px}.au-source dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px}.au-source dd{margin:0;overflow-wrap:anywhere}.au-metric{display:grid;gap:4px;padding:0}.au-metric strong{font:600 clamp(20px,4cqi,32px)/1.25 ui-monospace,monospace;overflow-wrap:anywhere}.au-image{max-width:100%;height:auto;object-fit:contain;border-radius:8px}.au-text p:first-child{margin-top:0}.au-text[data-size=small]{font-size:12px;line-height:18px}.au-text[data-size=large]{font-size:18px;line-height:26px}.au-text[data-size=small-heavy]{font-size:12px;line-height:18px;font-weight:600}.au-text[data-size=large-heavy]{font-size:18px;line-height:26px;font-weight:600}.au-surface table{font-size:12px}.au-surface .pr-table-scroll{max-width:100%;overflow:auto}.au-surface .pr-table{min-width:0}.au-text pre{overflow:auto}.au-surface .pr-numeric{font-variant-numeric:tabular-nums}
@container mv-surface (width < 480px){.au-surface-content{padding:10px}.au-data{padding:10px}.au-surface-content>h1{font-size:18px;line-height:26px}}
`
/** Shared static renderer. Adapters supply saved resources; components never perform Host IO. */
export function AnalysisSurface({
  document,
  readResource,
  openSemanticRef,
  readCode,
  askPoint,
}: {
  document: AnalysisDocument
  readResource?: (name: string) => AnalysisResource | undefined
  openSemanticRef?: OpenSemanticRef
  readCode?: AnalysisResourceContext['readCode']
  askPoint?: AnalysisResourceContext['askPoint']
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
  candidate?: boolean
  openSemanticRef?: OpenSemanticRef
  /** Saved Host source reader; candidate previews never read code. */
  readCode?: AnalysisResourceContext['readCode']
  askPoint?: AnalysisResourceContext['askPoint']
}
export function AnalysisRenderer({
  program,
  title,
  locale,
  resources: saved,
  recordId,
  readResource,
  isStreaming = false,
  candidate = false,
  openSemanticRef,
  readCode,
  askPoint,
}: AnalysisRendererProps) {
  const resources = useMemo(
    () => ({
      readResource: readResource ?? ((name: string) => saved[name]),
      candidate,
      openSemanticRef: candidate ? undefined : openSemanticRef,
      readCode: candidate ? undefined : readCode,
      askPoint: candidate ? undefined : askPoint,
    }),
    [saved, readResource, candidate, openSemanticRef, readCode, askPoint],
  )
  return (
    <ReportCopyProvider locale={locale}>
      <AnalysisResources.Provider value={resources} key={recordId}>
        <article
          className="mv-ui pr-reader au-surface"
          lang={locale}
          data-analysis-record={recordId}
          ref={(node) => {
            node?.toggleAttribute('inert', candidate)
          }}
        >
          <style>{PRESENTATION_STYLES}</style>
          <style>{UI_STYLES}</style>
          <style>{styles}</style>
          <style>{LAYOUT_STYLES}</style>
          <style>{FRAME_STYLES}</style>
          <div className="au-surface-content">
            <h1>{title}</h1>
            <Renderer
              library={analysisLibrary}
              response={program}
              isStreaming={isStreaming}
              publishObservability={false}
            />
          </div>
        </article>
      </AnalysisResources.Provider>
    </ReportCopyProvider>
  )
}
