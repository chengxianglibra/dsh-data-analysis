export const CHART_STYLES = `
.pr-special-frame { position:relative; min-width:0; margin:0 }
.pr-special-scroll { overflow-x:auto; padding-bottom:4px; max-width:100% }
.pr-special-chart { display:block; color:var(--pr-text); overflow:visible; font-size:12px; font-variant-numeric:tabular-nums }
.pr-special-chart text { fill:var(--pr-text) }
.pr-special-chart .pr-axis-tick { fill:var(--pr-chart-muted) }
.pr-special-chart [data-chart-mark]:focus { outline:2px solid var(--pr-accent); outline-offset:3px }
.pr-special-tooltip { position:absolute; top:0; left:0; z-index:2; max-width:100%; pointer-events:none }
.pr-chart-sparkline { height:128px }
.pr-chart-role { color:var(--pr-muted); font-size:11px }
.pr-chart-label { fill:var(--pr-text); font-size:11px }
.pr-special-chart .pr-chart-label { paint-order:stroke; stroke:var(--pr-bg); stroke-width:3px; stroke-linejoin:round }
.pr-color-key { display:flex; gap:12px; flex-wrap:wrap; font-size:12px; color:var(--pr-muted); margin:8px 0 }
.pr-color-key span { display:inline-flex; align-items:center; gap:5px }
`
