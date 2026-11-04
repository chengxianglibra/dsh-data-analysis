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
.fv[data-resource-kind=frame]{--card-spacing:24px}
.fv-head button{white-space:nowrap}
.fv-header-actions{display:flex;align-items:flex-start;gap:8px}
.fv-chart-tag{display:inline-flex;align-items:center;min-height:22px;padding:2px 7px;border-radius:4px;background:var(--muted);color:var(--muted-foreground);font-size:10px;line-height:1.4;white-space:nowrap}
.fv[data-resource-kind=frame] .au-metric-group{display:block}
.fv[data-resource-kind=frame] .au-metric-group>[data-slot=card]{background:transparent;box-shadow:none;padding:0;gap:0}
.fv[data-resource-kind=frame] .au-metric-group>[data-slot=card]>[data-slot=card-header]{padding:0}
.fv[data-resource-kind=frame] .au-metric-value{font-size:clamp(28px,3vw,36px);line-height:1.3;letter-spacing:-.025em}
.fv[data-resource-kind=frame] .au-metric-group:has(>[data-slot=card]:nth-child(2)){display:grid}
.fv-chart{margin:0;min-width:0}
.fv-pie-layout{display:flex;flex-wrap:wrap;align-items:center;gap:20px}
.fv-pie-svg{display:block;flex:0 1 300px;width:100%;max-width:300px;height:auto;min-width:0}
.fv-pie-legend{display:grid;gap:12px;flex:0 1 340px;min-width:min(180px,100%);max-width:100%;padding:0;list-style:none}
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
.fv-comparison-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,250px),1fr));border:1px solid var(--border);border-radius:8px;overflow:hidden}
.fv-comparison-grid-item{min-width:0;padding:16px 18px;box-shadow:1px 0 var(--border),0 1px var(--border)}
.fv-comparison-grid-item>h4{margin:0 0 12px;font-size:13px;font-weight:500;line-height:1.4;color:var(--muted-foreground);overflow-wrap:anywhere}
.fv-kpi-values{display:grid;gap:5px;min-width:0;margin:0}
.fv-kpi-values dt{font-size:12px;color:var(--muted-foreground)}
.fv-kpi-values dd{margin:0;font-variant-numeric:tabular-nums}
.fv-kpi-current dd{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 7px;min-width:0}
.fv-kpi-value{font-size:clamp(20px,2.4vw,27px);font-weight:600;line-height:1.25;letter-spacing:-.02em;white-space:nowrap;max-width:100%;overflow-x:auto}
.fv-kpi-unit{font-size:12px;font-weight:400;color:var(--muted-foreground);white-space:nowrap}
.fv-kpi-relative{display:flex;align-items:baseline;gap:6px;justify-self:start;padding:3px 7px;margin:3px 0 5px;border-radius:4px;background:var(--muted);font-size:13px;font-weight:600}
.fv-kpi-reference{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px;font-size:12px;line-height:1.5}
.fv-kpi-reference dd{white-space:nowrap;max-width:100%;overflow-x:auto}
@container mv-result (min-width:700px){.fv-comparison-grid[data-count="5"],.fv-comparison-grid[data-count="7"]{grid-template-columns:repeat(6,minmax(0,1fr))}.fv-comparison-grid[data-count="5"]>.fv-comparison-grid-item,.fv-comparison-grid[data-count="7"]>.fv-comparison-grid-item{grid-column:span 2}.fv-comparison-grid[data-count="5"]>.fv-comparison-grid-item:nth-child(n+4),.fv-comparison-grid[data-count="7"]>.fv-comparison-grid-item:nth-child(n+4){grid-column:span 3}}
@container mv-result (min-width:1040px){.fv-comparison-grid[data-count="7"]{grid-template-columns:repeat(12,minmax(0,1fr))}.fv-comparison-grid[data-count="7"]>.fv-comparison-grid-item{grid-column:span 3}.fv-comparison-grid[data-count="7"]>.fv-comparison-grid-item:nth-child(n+5){grid-column:span 4}}
@container mv-result (min-width:1350px){.fv-comparison-grid[data-count="5"]{grid-template-columns:repeat(5,minmax(0,1fr))}.fv-comparison-grid[data-count="5"]>.fv-comparison-grid-item,.fv-comparison-grid[data-count="5"]>.fv-comparison-grid-item:nth-child(n+4){grid-column:auto}}
@container mv-result (min-width:1750px){.fv-comparison-grid[data-count="7"]{grid-template-columns:repeat(7,minmax(0,1fr))}.fv-comparison-grid[data-count="7"]>.fv-comparison-grid-item,.fv-comparison-grid[data-count="7"]>.fv-comparison-grid-item:nth-child(n+4),.fv-comparison-grid[data-count="7"]>.fv-comparison-grid-item:nth-child(n+5){grid-column:auto}}
.fv-compare-controls{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px;padding:0;border:0}
.fv-delta-scroll{max-width:100%;overflow-x:auto}
.fv-delta-table{border-collapse:collapse;width:100%;min-width:740px;font-size:12px;font-variant-numeric:tabular-nums}
.fv-delta-table :is(th,td){padding:10px 8px;border-bottom:1px solid var(--border);vertical-align:middle;text-align:right;white-space:nowrap}
.fv-delta-table thead th{color:var(--muted-foreground);font-weight:500}
.fv-delta-table :is(th,td):first-child{position:sticky;left:0;z-index:1;text-align:left;background:var(--background);white-space:normal;min-width:140px;max-width:240px;overflow-wrap:anywhere}
.fv-delta-table :is(th,td):nth-child(2){text-align:left;min-width:180px;width:35%}
.fv-delta-axis-label{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:4px}
.fv-delta-axis-label>span:last-child{text-align:right}
.fv-delta-plot{position:relative;height:26px}
.fv-delta-zero{position:absolute;left:50%;top:0;bottom:0;border-left:1px solid var(--border)}
.fv-delta-bar{position:absolute;top:7px;height:12px;background:var(--chart-1);border-radius:2px}
.fv-delta-positive{background:var(--chart-2)}
@media(max-width:360px){.fv-comparison-grid-item{padding:12px}}
:is(.fv,.fv-dialog) .pr-table table{width:max-content;min-width:100%}
:is(.fv,.fv-dialog) .pr-table thead th{white-space:nowrap;overflow-wrap:normal;max-width:none}
.fv-table-bar{display:flex;justify-content:flex-end}
.fv-comparison-toolbar{justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
.fv-comparison-toolbar button{margin-left:auto}
${frozen}
.fv-icons{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.fv[data-resource-kind=frame] .fv-icons{border-top:1px solid var(--border);padding-top:10px;margin-top:20px}
.fv-icon{position:relative;display:inline-flex}
.fv-icon svg{flex:none}
@media(max-width:480px){.fv[data-resource-kind=frame]{--card-spacing:18px}}
.fv-code{white-space:pre;overflow:auto;max-height:50vh;user-select:text}
.fv-dev dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px}
.fv-dev dd{margin:0;overflow-wrap:anywhere}
.fv-origins{padding-left:18px;display:grid;gap:4px}
:is(.fv,.fv-dialog) .pr-cell-select{display:inline;text-align:inherit;font:inherit;font-variant-numeric:inherit}
`
