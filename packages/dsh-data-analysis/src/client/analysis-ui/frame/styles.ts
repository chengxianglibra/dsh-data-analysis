// Frame view styles. Categorical slots follow one fixed, validated order
// (adjacent CVD ΔE ≥ 8 in light and dark); Δ uses a neutral ink, never red/green.
const light =
  '--fv-s1:#2a78d6;--fv-s2:#eb6834;--fv-s3:#1baf7a;--fv-s4:#eda100;--fv-s5:#e87ba4;--fv-s6:#008300;--fv-s7:#6250d6;--fv-s8:#e34948;--fv-neutral:#6b6b70;--fv-grid:rgba(0,0,0,.12)'
const dark =
  '--fv-s1:#3987e5;--fv-s2:#d95926;--fv-s3:#199e70;--fv-s4:#c98500;--fv-s5:#d55181;--fv-s6:#008300;--fv-s7:#9085e9;--fv-s8:#e66767;--fv-neutral:#a3a3aa;--fv-grid:rgba(255,255,255,.14)'

/** Record key columns kept in view; offsets come from `--fv-k<i>` set by useFrozenColumns. */
export const MAX_FROZEN = 8
const frozen = Array.from(
  { length: MAX_FROZEN },
  (_, i) =>
    `.fv-frozen[data-frozen="${i + 1}"] :is(th,td):nth-child(-n+${i + 1}){position:sticky;background:var(--pr-bg);z-index:1}.fv-frozen :is(th,td):nth-child(${i + 1}){left:var(--fv-k${i},0)}`,
).join('\n')

export const FRAME_STYLES = `
.fv{${light};display:grid;gap:8px;border:1px solid var(--pr-border);border-radius:10px;padding:12px;background:var(--pr-bg);width:100%}
@media(prefers-color-scheme:dark){:root:where(:not([data-theme=light])) .fv{${dark}}}
.dark .fv,[data-theme=dark] .fv{${dark}}
.fv-head{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
.fv-title{font-size:15px;font-weight:600;margin:0;overflow-wrap:anywhere}
.fv-desc{margin:0;color:var(--pr-muted);font-size:13px}
.fv-chips{display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0;list-style:none}
.fv-chips li{font-size:12px;line-height:20px;padding:0 8px;border-radius:10px;background:var(--pr-soft);color:var(--pr-muted)}
.fv-numbers{display:flex;flex-wrap:wrap;gap:4px 20px;margin:0}
.fv-numbers>div{display:grid}
.fv-numbers dd{margin:0;font:600 clamp(18px,3.4vw,26px)/1.25 ui-monospace,monospace;font-variant-numeric:tabular-nums}
.fv-numbers dt{order:2;font-size:12px;color:var(--pr-muted)}
.fv-numbers small{font-size:12px;font-weight:400;color:var(--pr-muted);margin-left:4px}
.fv-cards{display:flex;flex-wrap:wrap;gap:12px 28px;padding:8px 0}
.fv-cards>div{display:grid;gap:2px}
.fv-cards span{font-size:12px;color:var(--pr-muted)}
.fv-cards strong{font:600 clamp(20px,4vw,32px)/1.25 ui-monospace,monospace;font-variant-numeric:tabular-nums}
.fv-chart{margin:0;display:grid;gap:4px}
.fv-svg{display:block;overflow:visible;font-size:11px}
.fv-svg text{fill:var(--pr-muted)}
.fv-svg .fv-strong{fill:var(--pr-text)}
.fv-grid,.fv-axis{stroke:var(--fv-grid);stroke-width:1}
.fv-axis{stroke:var(--pr-muted);stroke-opacity:.5}
.fv-line{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.fv-line[data-dashed]{stroke-dasharray:5 4;stroke-opacity:.7}
.fv-area{fill-opacity:.16;stroke:none}
.fv-hollow{fill:var(--pr-bg);stroke-width:1.8}
.fv-ref{stroke:var(--fv-neutral);stroke-width:1.2;stroke-dasharray:2 3}
.fv-connector{stroke:var(--fv-neutral);stroke-width:1;stroke-dasharray:3 2}
.fv-zero-mark{stroke-width:2}
.fv-hatch-line{stroke:var(--pr-bg);stroke-width:2.5}
.fv-diamond{fill:var(--pr-text);stroke:var(--pr-bg);stroke-width:1.5}
.fv-stem{stroke:var(--fv-neutral);stroke-width:2;stroke-opacity:.55}
.fv-track{fill:var(--pr-soft);stroke:var(--fv-grid)}
.fv-cell-empty{fill:none;stroke:var(--fv-grid);stroke-dasharray:2 2}
.fv-legend{display:flex;flex-wrap:wrap;gap:4px 14px;margin:0;padding:0;list-style:none;font-size:12px;color:var(--pr-muted)}
.fv-legend li{display:flex;align-items:center;gap:4px}
.fv-legend svg{overflow:visible}
.fv-segments{display:inline-flex;gap:0;border:1px solid var(--pr-border);border-radius:6px;overflow:hidden;width:max-content}
.fv .fv-segments button{border:0;border-radius:0;padding:2px 10px;font-size:12px}
.fv .fv-segments button[aria-pressed=true]{background:var(--pr-soft);color:var(--pr-accent)}
.fv-multiples{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.fv-multiples h4,.fv-parent h4{margin:0;font-size:12px;font-weight:500;color:var(--pr-muted)}
.fv-parent{display:grid;gap:4px}
.fv-parents{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:12px}
.fv-comparison-table{max-width:100%;overflow:auto}
.fv-comparison-table table{width:100%}
.fv-comparison-table :is(th,td){min-width:0}
.fv-comparison-table thead th{white-space:nowrap}
.fv-comparison-table td.pr-numeric{white-space:nowrap}
.fv-comparison-section th{color:var(--pr-muted);font-size:12px;text-align:left}
.fv-table summary{cursor:pointer;font-size:12px;color:var(--pr-muted)}
.fv-table-bar{display:flex;justify-content:flex-end;padding:4px 0}
${frozen}
.fv-icons{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.fv-icon{position:relative;display:inline-flex}
.fv .fv-icon>button{display:inline-flex;align-items:center;gap:4px;padding:2px 6px;font-size:12px;border-color:transparent;background:transparent;color:var(--pr-text)}
.fv .fv-icon>button:hover,.fv .fv-icon>button:focus-visible{border-color:var(--pr-border)}
.fv .fv-icon>button[aria-disabled=true]{color:var(--pr-muted);opacity:.55;cursor:default}
.fv-icon svg{flex:none}
.fv-tip{position:absolute;left:0;bottom:calc(100% + 4px);z-index:5;display:none;width:max-content;max-width:min(320px,80vw);padding:6px 8px;border-radius:6px;background:var(--pr-text);color:var(--pr-bg);font-size:12px;line-height:1.4;white-space:pre-line;pointer-events:none}
.fv-icon:hover .fv-tip,.fv-icon:focus-within .fv-tip{display:block}
.fv-dialog{max-width:min(720px,92vw);width:100%;border:1px solid var(--pr-border);border-radius:10px;padding:0;background:var(--pr-bg);color:var(--pr-text)}
.fv-dialog::backdrop{background:rgba(0,0,0,.35)}
.fv-dialog>header{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--pr-border)}
.fv-dialog>header h3{margin:0;font-size:14px}
.fv-dialog>div{padding:12px 14px;max-height:70vh;overflow:auto;display:grid;gap:8px}
.fv-dialog table{border-collapse:collapse;font-size:12px}
.fv-dialog th,.fv-dialog td{padding:4px 8px;border-bottom:1px solid var(--pr-border);text-align:left}
.fv-code{margin:0;padding:10px;border-radius:6px;background:var(--pr-soft);font:12px/1.5 ui-monospace,monospace;white-space:pre;overflow:auto;max-height:50vh;user-select:text}
.fv-dev{font-size:12px;color:var(--pr-muted)}
.fv-dev dl{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;margin:4px 0}
.fv-dev dd{margin:0;overflow-wrap:anywhere;font-family:ui-monospace,monospace}
.fv-origins{margin:0;padding-left:18px;display:grid;gap:4px}
.fv-origins code{font-size:11px;color:var(--pr-muted)}
.fv[data-density=compact]{gap:4px;padding:10px}
`
