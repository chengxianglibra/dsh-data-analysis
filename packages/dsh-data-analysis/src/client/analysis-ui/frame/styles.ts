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
.fv:is([data-resource-kind=frame],[data-resource-kind=dataset]){--card-spacing:18px;--chart-1:var(--dsw-alias-state-success-label,light-dark(#147761,#65ceb0));--chart-2:var(--dsw-alias-state-warn-label,light-dark(#c59421,#e7bf5a));--fv-negative:var(--dsw-alias-state-error-label,light-dark(#a94d3e,#ef9988))}
.fv:is([data-resource-kind=frame],[data-resource-kind=dataset]) .fv-title{font-size:15px;line-height:1.35}
.fv:is([data-resource-kind=frame],[data-resource-kind=dataset]) .fv-head [data-slot=card-description]{font-size:12px;line-height:1.5}
.fv-head button{white-space:nowrap}
.fv-header-actions{display:flex;align-items:flex-start;gap:8px}
.fv:is([data-resource-kind=frame],[data-resource-kind=dataset]) .au-metric-group{display:block}
.fv:is([data-resource-kind=frame],[data-resource-kind=dataset]) .au-metric-group>[data-slot=card]{background:transparent;box-shadow:none;padding:0;gap:0}
.fv:is([data-resource-kind=frame],[data-resource-kind=dataset]) .au-metric-group>[data-slot=card]>[data-slot=card-header]{padding:0}
.fv:is([data-resource-kind=frame],[data-resource-kind=dataset]) .au-metric-value strong{font-size:22px;line-height:1.25;letter-spacing:-.03em}
.fv:is([data-resource-kind=frame],[data-resource-kind=dataset]) .au-metric-group:has(>[data-slot=card]:nth-child(2)){display:grid}
.fv-chart{margin:0;min-width:0}
.fv-members-preview{display:flex;flex-wrap:wrap;gap:5px}
.fv-members-key{padding:4px 7px;border-radius:4px;background:var(--muted);font-size:12px;line-height:1.4;overflow-wrap:anywhere}
.fv-members-more{margin:8px 0 0;color:var(--muted-foreground);font-size:12px}
.fv-records-scroll{max-width:100%;overflow:auto}
.fv-records-preview table{width:max-content;min-width:100%}
.fv-records-preview :is(th,td){font-size:12px}
.fv-records-preview .pr-numeric{text-align:right}
.fv-records-more{margin:8px 0 0;color:var(--muted-foreground);font-size:12px}
.fv-alignment-controls,.fv-hbar-controls{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px;padding:0;border:0}
.fv-alignment-facets{display:grid;gap:16px}
.fv-alignment-facets>p{margin:0;color:var(--muted-foreground);font-size:12px}
.fv-pie-layout{display:flex;flex-wrap:wrap;align-items:center;gap:20px}
.fv-pie-svg{display:block;flex:0 1 300px;width:100%;max-width:300px;height:auto;min-width:0}
.fv-pie-legend{display:grid;gap:12px;flex:0 1 340px;min-width:min(180px,100%);max-width:100%;padding:0;list-style:none}
.fv-share-composition{display:grid;gap:14px;margin:0;min-width:0}
.fv-share-stack{display:block;width:100%;height:16px;overflow:hidden;border-radius:8px}
.fv-share-list{display:grid;gap:0;margin:0;padding:0;list-style:none}
.fv-share-row{display:grid;grid-template-columns:9px minmax(0,1fr) minmax(120px,280px);gap:10px;align-items:center;padding:7px 0;border-bottom:1px solid var(--border);font-size:12px}
.fv-share-row:last-child{border-bottom:0}
.fv-share-header{color:var(--muted-foreground)}
.fv-share-swatch{width:9px;height:9px;border-radius:2px}
.fv-share-values{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 12px;text-align:right}
.fv-share-values:has(>span:only-child){grid-template-columns:minmax(0,1fr)}
.fv-share-values>span{min-width:0;overflow-wrap:anywhere}
@container mv-result (max-width:480px){.fv-share-row{grid-template-columns:9px minmax(0,1fr)}.fv-share-values{grid-column:2}}
.fv-plot{max-width:100%;overflow-x:auto}
.fv-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.fv-plot-scrolled svg.recharts-surface .fv-row-label{visibility:hidden}
.fv-scroll-hint::before{content:'↔'}
.fv-multiples{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,640px),1fr));gap:24px}
.fv-parent{display:grid;gap:12px;min-width:0}
.fv-parents{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,640px),1fr));gap:24px}
.fv-comparison-table{max-width:100%;overflow:auto}
.fv-comparison-table [data-slot=table-container]{overflow:visible}
.fv-comparison-table table{width:max-content;min-width:100%}
.fv-comparison-table tbody th[scope=row]{white-space:nowrap;overflow-wrap:normal;max-width:none}
.fv-comparison-table thead th{white-space:nowrap}
.fv-comparison-table td.pr-numeric{white-space:nowrap}
.fv-comparison-details{display:grid;gap:24px}
.fv-comparison-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}
.fv-comparison-grid[data-count="1"]{grid-template-columns:minmax(0,1fr)}
.fv-comparison-grid[data-count="2"]{grid-template-columns:repeat(2,minmax(0,1fr))}
.fv-comparison-grid[data-count="3"]{grid-template-columns:repeat(3,minmax(0,1fr))}
.fv-comparison-grid[data-count="4"]{grid-template-columns:repeat(4,minmax(0,1fr))}
.fv-comparison-grid-item{container-type:inline-size;min-width:0;padding:12px;background:var(--muted);border-radius:8px}
.fv-comparison-grid-item>h4{margin:0 0 3px;font-size:12px;font-weight:500;line-height:1.4;color:var(--muted-foreground);overflow-wrap:anywhere}
.fv-kpi-values{display:grid;gap:5px;min-width:0;margin:0}
.fv-kpi-values dt{font-size:12px;color:var(--muted-foreground)}
.fv-kpi-values dd{margin:0;font-variant-numeric:tabular-nums}
.fv-kpi-current dd{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 7px;min-width:0}
.fv-kpi-value{font-size:clamp(20px,2vw,22px);font-weight:600;line-height:1.25;letter-spacing:-.02em;white-space:nowrap;max-width:100%;overflow-x:auto}
.fv-kpi-unit{font-size:12px;font-weight:400;color:var(--muted-foreground);white-space:nowrap}
.fv-kpi-changes{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px}
.fv-kpi-relative{display:flex;align-items:baseline;gap:6px;justify-self:start;font-size:12px;font-weight:600}
.fv-kpi-reference{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px;font-size:12px;line-height:1.5}
.fv-kpi-reference dd{white-space:nowrap;max-width:100%;overflow-x:auto}
.fv-comparison-grid .fv-kpi-values{gap:4px}
.fv-comparison-grid .fv-kpi-value{font-size:clamp(14px,10cqi,18px);line-height:1.3;white-space:normal;overflow-wrap:anywhere;overflow:visible}
.fv-comparison-grid .fv-kpi-reference{gap:2px 5px;font-size:11px;color:var(--muted-foreground)}
.fv-comparison-grid .fv-kpi-reference dt{font-size:11px}
.fv-comparison-grid .fv-kpi-reference dd{white-space:normal;overflow-wrap:anywhere;overflow:visible}
.fv-comparison-grid .fv-kpi-changes{gap:0 4px;margin-top:4px;font-size:12px;font-weight:500;overflow-wrap:anywhere}
.fv-comparison-grid .fv-kpi-changes [data-sign=negative]{color:var(--fv-negative)}
.fv-comparison-grid .fv-kpi-changes [data-sign=positive]{color:var(--chart-1)}
@container mv-result (min-width:701px) and (max-width:900px){.fv-comparison-grid:not([data-count="1"]):not([data-count="2"]){grid-template-columns:repeat(3,minmax(0,1fr))}}
@container mv-result (max-width:700px){.fv-comparison-grid:not([data-count="1"]){grid-template-columns:repeat(2,minmax(0,1fr))}}
@container mv-result (max-width:350px){.fv-comparison-grid{grid-template-columns:minmax(0,1fr)!important}}
.fv-compare-controls{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px;padding:0;border:0}
.fv-delta-scroll{max-width:100%;overflow-x:auto}
.fv-delta-table{border-collapse:collapse;width:100%;min-width:740px;font-size:12px;font-variant-numeric:tabular-nums}
.fv-delta-table :is(th,td){padding:10px 8px;border-bottom:1px solid var(--border);vertical-align:middle;text-align:right;white-space:nowrap}
.fv-delta-table thead th{color:var(--muted-foreground);font-weight:500}
.fv-delta-table :is(th,td):first-child{position:sticky;left:0;z-index:1;text-align:left;background:var(--background);white-space:normal;min-width:140px;max-width:240px;overflow-wrap:anywhere}
.fv-delta-table :is(th,td):nth-child(4){text-align:left;min-width:180px;width:35%}
.fv-delta-axis-label{position:relative;display:block;height:1.5em}
.fv-delta-axis-label>span{position:absolute;top:0}
.fv-delta-axis-label>span:first-child{left:0}
.fv-delta-axis-label>span:last-child{right:0}
.fv-delta-plot{position:relative;height:26px}
.fv-delta-zero{position:absolute;left:50%;top:0;bottom:0;border-left:1px solid var(--border)}
.fv-delta-bar{position:absolute;top:7px;height:12px;background:var(--fv-negative);border-radius:2px}
.fv-delta-positive{background:var(--chart-1)}
.fv-decomposition-details{max-width:100%;overflow-x:auto}
.fv-decomposition-table{border-collapse:collapse;width:100%;min-width:740px;font-size:12px;font-variant-numeric:tabular-nums}
.fv-decomposition-table :is(th,td){padding:9px 8px;border-bottom:1px solid var(--border);text-align:right;white-space:nowrap;vertical-align:middle}
.fv-decomposition-table thead th{color:var(--muted-foreground);font-weight:500}
.fv-decomposition-table [data-contribution-sign=negative]{color:var(--fv-negative)}
.fv-decomposition-table [data-contribution-sign=positive]{color:var(--chart-1)}
.fv-decomposition-table [data-contribution-sign] button{color:inherit}
.fv-decomposition-table :is(th,td):first-child{position:sticky;left:0;z-index:1;text-align:left;background:var(--background);white-space:normal;min-width:140px;overflow-wrap:anywhere}
.fv-decomposition-contribution{display:flex;align-items:center;gap:10px;justify-content:flex-end}
.fv-decomposition-track{position:relative;flex:1;min-width:100px;height:12px}
.fv-decomposition-value{display:inline-block;white-space:nowrap}
.fv-decomposition-zero{position:absolute;top:0;bottom:0;border-left:1px solid var(--border)}
.fv-decomposition-note{margin:8px 0 0;color:var(--muted-foreground);font-size:12px;line-height:1.5}
.fv-decomposition-field-label{display:none}
.fv-decomposition-negative,.fv-decomposition-positive{position:absolute;top:2px;height:8px;border-radius:2px}
.fv-decomposition-negative{background:var(--fv-negative)}
.fv-decomposition-positive{background:var(--chart-1)}
@container mv-result (max-width:650px){
  .fv-decomposition-table{display:block;min-width:0}
  .fv-decomposition-table thead{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
  .fv-decomposition-table tbody{display:grid;gap:0}
  .fv-decomposition-table tbody tr{display:grid;grid-template-columns:repeat(2,minmax(min-content,1fr));gap:8px 12px;padding:12px 0;border-bottom:1px solid var(--border)}
  .fv-decomposition-table tbody :is(th,td){min-width:0;padding:0;border:0;text-align:left;white-space:normal;overflow-wrap:anywhere}
  .fv-decomposition-table tbody th:first-child{position:static;grid-column:1/-1;max-width:none}
  .fv-decomposition-table tbody td:nth-child(4){grid-column:1/-1}
  .fv-decomposition-table .pr-cell-select{max-width:none;white-space:nowrap}
  .fv-decomposition-field-label{display:block;margin-bottom:3px;color:var(--muted-foreground);font-size:11px}
  .fv-decomposition-contribution{justify-content:space-between}
}
@media(max-width:360px){.fv-comparison-grid-item{padding:12px}}
:is(.fv,.fv-dialog) .pr-table table{width:max-content;min-width:100%}
:is(.fv,.fv-dialog) .pr-table thead th{white-space:nowrap;overflow-wrap:normal;max-width:none}
.fv-table-bar{display:flex;justify-content:flex-end}
.fv-comparison-toolbar{justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
.fv-comparison-toolbar button{margin-left:auto}
${frozen}
.fv-icons{display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:flex-start}
.fv:is([data-resource-kind=frame],[data-resource-kind=dataset]) .fv-icons{margin-top:12px}
.fv-icon{position:relative;display:inline-flex}
.fv-icon svg{flex:none}
@media(max-width:480px){.fv:is([data-resource-kind=frame],[data-resource-kind=dataset]){--card-spacing:18px}}
.fv-code{white-space:pre;overflow:auto;max-height:50vh;user-select:text}
.fv-dev dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px}
.fv-dev dd{margin:0;overflow-wrap:anywhere}
.fv-origins{padding-left:18px;display:grid;gap:4px}
:is(.fv,.fv-dialog) .pr-cell-select{display:inline;text-align:inherit;font:inherit;font-variant-numeric:inherit}
`
