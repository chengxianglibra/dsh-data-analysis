/** Record key columns kept in view; offsets come from `--fv-k<i>` set by useFrozenColumns. */
export const MAX_FROZEN = 8
const frozen = Array.from(
  { length: MAX_FROZEN },
  (_, i) =>
    `.fv-frozen[data-frozen="${i + 1}"] :is(th,td):nth-child(-n+${i + 1}){position:sticky;background:var(--background);z-index:1}.fv-frozen :is(th,td):nth-child(${i + 1}){left:var(--fv-k${i},0)}`,
).join('\n')

export const FRAME_STYLES = `
.au-result{container:mv-result / inline-size}
.fv{width:100%;min-width:0}
.fv-head button{white-space:nowrap}
.fv-chart{margin:0;min-width:0}
.fv-plot{max-width:100%;overflow-x:auto}
.fv-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.fv-plot-scrolled svg.recharts-surface .fv-row-label{visibility:hidden}
.fv-scroll-hint::before{content:'↔'}
.fv-multiples{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,640px),1fr));gap:24px}
.fv-parent{display:grid;gap:12px;min-width:0}
.fv-parents{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,640px),1fr));gap:24px}
.fv-comparison-table{max-width:100%;overflow:auto}
.fv-comparison-table [data-slot=table-container]{overflow:visible}
.fv-comparison-table table{width:max-content;min-width:100%}
.fv-comparison-table tbody th[scope=row]{white-space:nowrap;overflow-wrap:normal;max-width:none}
.fv-comparison-table thead th{white-space:nowrap}
.fv-comparison-table td.pr-numeric{white-space:nowrap}
.fv-comparison-details{display:grid;gap:24px}
:is(.fv,.fv-dialog) .pr-table table{width:max-content;min-width:100%}
:is(.fv,.fv-dialog) .pr-table thead th{white-space:nowrap;overflow-wrap:normal;max-width:none}
.fv-table-bar{display:flex;justify-content:flex-end}
.fv-comparison-toolbar{justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
.fv-comparison-toolbar button{margin-left:auto}
${frozen}
.fv-icons{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.fv-icon{position:relative;display:inline-flex}
.fv-icon svg{flex:none}
.fv-code{white-space:pre;overflow:auto;max-height:50vh;user-select:text}
.fv-dev dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px}
.fv-dev dd{margin:0;overflow-wrap:anywhere}
.fv-origins{padding-left:18px;display:grid;gap:4px}
:is(.fv,.fv-dialog) .pr-cell-select{display:inline;text-align:inherit;font:inherit;font-variant-numeric:inherit}
`
