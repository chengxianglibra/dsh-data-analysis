import { FRAME_CHART_DARK, FRAME_CHART_LIGHT } from './chart-palette.ts'

// Series colors follow analysis-ui's ordered eight-color palette.
const chartTheme = (colors: readonly string[]) =>
  `${Array.from({ length: 8 }, (_, index) => `--fv-s${index + 1}:${colors[index % colors.length]}`).join(';')};--fv-neutral:var(--pr-muted);--fv-grid:var(--pr-border)`
const light = chartTheme(FRAME_CHART_LIGHT)
const dark = chartTheme(FRAME_CHART_DARK)

/** Record key columns kept in view; offsets come from `--fv-k<i>` set by useFrozenColumns. */
export const MAX_FROZEN = 8
const frozen = Array.from(
  { length: MAX_FROZEN },
  (_, i) =>
    `.fv-frozen[data-frozen="${i + 1}"] :is(th,td):nth-child(-n+${i + 1}){position:sticky;background:var(--pr-bg);z-index:1}.fv-frozen :is(th,td):nth-child(${i + 1}){left:var(--fv-k${i},0)}`,
).join('\n')

export const FRAME_STYLES = `
.fv{${light};display:grid;align-content:start;gap:8px;border:1px solid var(--pr-border);border-radius:10px;padding:12px;background:var(--pr-bg);width:100%;min-width:0}
.au-result{container:mv-result / inline-size}
@media(prefers-color-scheme:dark){:root:where(:not([data-ds-theme-source])):where(:not([data-theme=light])) .fv{${dark}}}
.dark .fv,[data-theme=dark] .fv{${dark}}
.light .fv,[data-theme=light] .fv{${light}}
:root[data-ds-theme-source] body:not([data-ds-dark-theme]) .fv{${light}}
body[data-ds-dark-theme] .fv{${dark}}
.fv-head{display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px}
.fv-head button{white-space:nowrap}
.fv :is([data-icon=copy-data],[data-icon=copy-code]) .mv-icon-button,.fv-dialog :is([data-icon=copy-data],[data-icon=copy-code]) .mv-icon-button{color:var(--pr-muted)}
.fv :is([data-icon=copy-data],[data-icon=copy-code]) .mv-icon-button:is(:hover,:focus-visible),.fv-dialog :is([data-icon=copy-data],[data-icon=copy-code]) .mv-icon-button:is(:hover,:focus-visible){color:var(--pr-text)}
.au-result .fv-title{font:600 15px/22px system-ui,sans-serif;margin:0;overflow-wrap:anywhere}
.au-result .fv-desc{margin:0;color:var(--pr-muted);font:13px/20px system-ui,sans-serif}
.au-result-header-actions{display:inline-flex;align-items:center;gap:8px;flex:none}
.au-result-status{margin:0;color:var(--pr-muted);font-size:12px;line-height:18px}
.au-metric-value{display:flex;align-items:baseline;gap:4px}
.au-metric-group>div{min-width:0}
.au-result>.pr-notice{margin:0}
.fv-chips{display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0;list-style:none}
.fv-chips li{font-size:12px;line-height:20px;padding:0 8px;border-radius:10px;background:var(--pr-soft);color:var(--pr-muted)}
.fv-numbers{display:flex;flex-wrap:wrap;gap:4px 20px;margin:0}
.fv-numbers>div{display:grid}
.fv-numbers dd{margin:0;font:600 clamp(18px,3.4cqi,26px)/1.25 ui-monospace,monospace;font-variant-numeric:tabular-nums}
.fv-numbers dt{order:2;font-size:12px;color:var(--pr-muted)}
.fv-numbers small{font-size:12px;font-weight:400;color:var(--pr-muted);margin-left:4px}
.fv-cards{display:flex;flex-wrap:wrap;gap:12px 28px;padding:8px 0}
.fv-cards>div{display:grid;gap:2px}
.fv-cards span{font-size:12px;color:var(--pr-muted)}
.fv-cards strong{font:600 clamp(20px,4cqi,32px)/1.25 ui-monospace,monospace;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.fv-chart{margin:0;display:grid;gap:4px}
.fv-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.fv-scroll-hint{display:inline-flex;align-items:center;justify-content:center;color:var(--pr-muted);font-size:16px;line-height:1}
.fv-scroll-hint::before{content:'↔'}
.fv-svg{display:block;overflow:visible;font:500 12px/18px -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
.fv-svg text{fill:var(--pr-muted)}
.fv-svg .fv-strong{fill:var(--pr-text)}
.fv-plot-scrolled .fv-row-label{visibility:hidden}
.fv-grid,.fv-axis{stroke:var(--fv-grid);stroke-width:1;stroke-opacity:.65}
.fv-axis{stroke:var(--pr-muted);stroke-opacity:.5}
.fv-line{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.fv-line[data-dashed]{stroke-dasharray:5 4;stroke-opacity:.7}
.fv-area{fill-opacity:.14;stroke:none}
.fv-hollow{fill:var(--pr-bg);stroke-width:1.8}
.fv-ref{stroke:var(--fv-neutral);stroke-width:1.2;stroke-dasharray:2 3}
.fv-connector{stroke:var(--fv-neutral);stroke-width:1;stroke-dasharray:3 2}
.fv-zero-mark{stroke-width:2}
.fv-hatch-line{stroke:var(--pr-bg);stroke-width:2.5}
.fv-diamond{fill:var(--pr-text);stroke:var(--pr-bg);stroke-width:1.5}
.fv-stem{stroke:var(--fv-neutral);stroke-width:2;stroke-opacity:.55}
.fv-track{fill:var(--pr-soft);stroke:var(--fv-grid)}
.fv-cell-empty{fill:none;stroke:var(--fv-grid);stroke-dasharray:2 2}
.fv-legend{display:flex;flex-wrap:wrap;gap:4px 14px;margin:0;padding:0;list-style:none;font:500 12px/18px -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:var(--pr-muted)}
.fv-legend li{display:flex;align-items:center;gap:4px}
.fv-legend svg{overflow:visible}
.fv-segments{display:inline-flex;gap:0;border:1px solid var(--pr-border);border-radius:6px;overflow:hidden;width:max-content}
:is(.fv,.fv-dialog) .fv-segments button{border:0;border-radius:0;padding:2px 10px;font-size:12px}
:is(.fv,.fv-dialog) .fv-segments button[aria-pressed=true]{background:var(--pr-soft);color:var(--pr-accent)}
.fv-multiples{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,640px),1fr));gap:12px}
.fv-multiples h4,.fv-parent h4{margin:0;font-size:12px;font-weight:500;color:var(--pr-muted)}
.fv-parent{display:grid;gap:4px}
.fv-parents{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,640px),1fr));gap:12px}
.fv-comparison-table{max-width:100%;overflow:auto}
.fv-comparison-table table{width:max-content;min-width:100%}
.fv-comparison-table :is(th,td){min-width:0;padding:5.5px 8px}
.fv-comparison-table tbody th[scope=row]{white-space:nowrap;overflow-wrap:normal;max-width:none}
.fv-comparison-table thead th{white-space:nowrap}
.fv-comparison-table td.pr-numeric{white-space:nowrap}
.fv-comparison-section th{color:var(--pr-muted);font-size:12px;text-align:left}
.fv-comparison-details{display:grid;gap:12px}
.fv-comparison-details h4{margin:8px 0 0;font-size:12px}
:is(.fv,.fv-dialog) .pr-table table{width:max-content;min-width:100%}
:is(.fv,.fv-dialog) .pr-table thead th{white-space:nowrap;overflow-wrap:normal;max-width:none}
.fv-table-bar{display:flex;justify-content:flex-end;padding:4px 0}
.fv-comparison-toolbar{justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
.fv-comparison-toolbar span{font-size:12px;color:var(--pr-muted)}
.fv-comparison-toolbar button{margin-left:auto}
${frozen}
.fv-icons{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.fv-icon{position:relative;display:inline-flex}
.fv-icons .mv-icon-button{width:auto;min-width:32px;min-height:32px;gap:4px;font-size:12px;line-height:18px}
.fv-icon svg{flex:none}
.fv-dialog table{border-collapse:collapse;font-size:12px}
.fv-dialog th,.fv-dialog td{padding:4px 8px;border-bottom:1px solid var(--pr-border);text-align:left}
.fv-code{margin:0;padding:10px;border-radius:6px;background:var(--pr-soft);font:12px/1.5 ui-monospace,monospace;white-space:pre;overflow:auto;max-height:50vh;user-select:text}
.fv-dev{font-size:12px;color:var(--pr-muted)}
.fv-dev dl{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;margin:4px 0}
.fv-dev dd{margin:0;overflow-wrap:anywhere;font-family:ui-monospace,monospace}
.fv-origins{margin:0;padding-left:18px;display:grid;gap:4px}
.fv-origins code{font-size:12px;color:var(--pr-muted)}
.fv-point-menu{position:fixed;z-index:1000;display:grid;gap:6px;padding:6px;border:1px solid var(--pr-border);border-radius:8px;background:var(--pr-bg);box-shadow:0 4px 16px #0003}
.fv-point-menu p{margin:0;font-size:12px;color:var(--pr-muted)}
:is(.fv,.fv-dialog) .pr-cell-select{display:inline;padding:0;border:0;border-radius:0;background:transparent;color:inherit;text-align:inherit;font:inherit;font-variant-numeric:inherit;text-decoration:underline;text-decoration-color:var(--pr-border);text-underline-offset:2px}
:is(.fv,.fv-dialog) .pr-cell-select:is(:hover,:focus-visible){text-decoration-color:currentColor}
.fv[data-density=compact]{gap:4px;padding:10px}
@container mv-surface (max-width:480px){.au-result{padding:10px}}
`
