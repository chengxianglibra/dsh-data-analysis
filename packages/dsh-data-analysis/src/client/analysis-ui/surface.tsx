import { Renderer } from '@openuidev/react-lang'
import { useMemo } from 'react'
import type {
  AnalysisDocument,
  AnalysisResource,
} from '../../presentation/contracts/analysis-document.ts'
import { ReportCopyProvider } from '../i18n/context.tsx'
import type { OpenSemanticRef } from '../presentation/source-facts.ts'
import { PRESENTATION_STYLES } from '../presentation/styles.ts'
import { type AnalysisResourceContext, AnalysisResources } from './context.tsx'
import { OPENUI_CHART_STYLES } from './frame/openui-chart-styles.ts'
import { FRAME_STYLES } from './frame/styles.ts'
import { analysisLibrary } from './library.tsx'

const lightFallback =
  '--au-bg:#fff;--au-soft:#f4f7f7;--au-text:#1d3036;--au-muted:#5b7076;--au-border:#dce5e5;--au-accent:#087c71;--au-warning:#805b20'
const darkFallback =
  '--au-bg:#1c1c1f;--au-soft:#262629;--au-text:#ededed;--au-muted:#aaa;--au-border:#39393e;--au-accent:#91b7f3;--au-warning:#e3bb70'
const styles = `
.pr-reader.au-surface{--openui-space-xs:4px;--openui-space-s:8px;--openui-space-m:16px;--openui-space-l:24px;--openui-space-xl:32px;--openui-space-2xl:40px;--pr-bg:var(--dsw-alias-bg-base,var(--au-bg,#fff));--pr-soft:var(--dsw-alias-bg-module-platform,var(--au-soft,#f4f7f7));--pr-text:var(--dsw-alias-label-primary,var(--au-text,#1d3036));--pr-muted:var(--dsw-alias-label-secondary,var(--au-muted,#5b7076));--pr-border:var(--dsw-alias-border-l2,var(--au-border,#dce5e5));--pr-accent:var(--dsw-alias-state-business-primary,var(--au-accent,#087c71));--pr-warning:var(--dsw-alias-state-warn-label,var(--au-warning,#805b20));color:var(--pr-text);background:var(--pr-bg);font:14px/1.6 system-ui;min-width:0;max-width:100%;padding:16px;border-radius:12px;box-sizing:border-box}
@media(prefers-color-scheme:dark){:root:where(:not([data-ds-theme-source])):where(:not([data-theme=light])) .au-surface{${darkFallback};color-scheme:dark}}
.dark .au-surface,[data-theme=dark] .au-surface{${darkFallback};color-scheme:dark}
.light .au-surface,[data-theme=light] .au-surface{${lightFallback};color-scheme:light}
:root[data-ds-theme-source] body:not([data-ds-dark-theme]) .au-surface{${lightFallback};color-scheme:light}
body[data-ds-dark-theme] .au-surface{${darkFallback};color-scheme:dark}
.au-surface *{box-sizing:border-box;min-width:0}.au-surface h1{font-size:22px;line-height:1.35;margin:0 0 20px;overflow-wrap:anywhere}.au-surface p{overflow-wrap:anywhere}.au-data{border:1px solid var(--pr-border);border-radius:10px;padding:12px;background:var(--pr-bg);width:100%}.au-data-heading{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}.au-data-heading strong{overflow-wrap:anywhere}.au-surface button{font:inherit;border:1px solid var(--pr-border);border-radius:6px;background:var(--pr-bg);color:inherit;padding:4px 10px;cursor:pointer}.au-surface button:disabled{opacity:.5;cursor:default}.au-columns,.au-source{margin-top:12px;font-size:12px;color:var(--pr-muted)}.au-columns>div{display:flex;flex-wrap:wrap;gap:8px 16px;padding:8px 0}.au-columns label{display:flex;align-items:center;gap:4px}.au-source summary,.au-columns summary{cursor:pointer}.au-source pre{overflow:auto;max-height:240px;font-size:11px}.au-source dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px}.au-source dd{margin:0;overflow-wrap:anywhere}.au-metric{display:grid;gap:4px;padding:20px 0}.au-metric strong{font:600 clamp(20px,4vw,32px)/1.3 ui-monospace,monospace;overflow-wrap:anywhere}.au-image{max-width:100%;height:auto;object-fit:contain;border-radius:8px}.au-tabs>[role=tablist]{display:flex;gap:8px;overflow:auto;margin-bottom:16px}.au-tabs [aria-selected=true]{border-color:var(--pr-accent);color:var(--pr-accent)}.au-tabs>[role=tabpanel]>div+div{margin-top:16px}.au-text p:first-child{margin-top:0}.au-text[data-size=small]{font-size:12px}.au-text[data-size=large]{font-size:18px}.au-text[data-size=small-heavy]{font-size:12px;font-weight:600}.au-text[data-size=large-heavy]{font-size:18px;font-weight:600}.au-surface .openui-card{max-width:100%;width:100%;padding:16px;border:1px solid var(--pr-border);border-radius:10px;background:var(--pr-bg)}.au-surface .openui-card-sunk{background:var(--pr-soft)}.au-surface .openui-card-clear{padding:0;border:0;background:transparent}.au-surface table{font-size:12px}.au-surface .pr-table-scroll{max-width:100%;overflow:auto}.au-surface .pr-table{min-width:0}.au-text pre{overflow:auto}.au-surface .pr-numeric{font-variant-numeric:tabular-nums}
.au-stack[data-direction="row"]>:is(.fv,.au-data,.openui-card){flex:1 1 260px;width:auto;min-width:0}
@media(max-width:520px){.au-surface{padding:10px}.au-data{padding:10px}.au-surface h1{font-size:18px}}
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
      <AnalysisResources.Provider value={resources}>
        <article
          className="pr-reader au-surface"
          data-analysis-record={recordId}
          ref={(node) => {
            node?.toggleAttribute('inert', candidate)
          }}
        >
          <style>{PRESENTATION_STYLES}</style>
          <style>{styles}</style>
          <style>{FRAME_STYLES}</style>
          <style>{OPENUI_CHART_STYLES}</style>
          <h1>{title}</h1>
          <Renderer
            library={analysisLibrary}
            response={program}
            isStreaming={isStreaming}
            publishObservability={false}
          />
        </article>
      </AnalysisResources.Provider>
    </ReportCopyProvider>
  )
}
