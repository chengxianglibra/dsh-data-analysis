/** Semantic navigation and code/graph reading layouts; general visuals come from shadcn. */
export const browserStyles = `
.sb-panel{height:100%;min-width:0;container-type:inline-size}
.sb-shell{height:100%;display:flex;flex-direction:column;gap:1rem}
.sb-header{display:flex;flex-wrap:wrap;align-items:center;gap:1rem;padding-inline:0}
.sb-updated,.sb-count,.sb-muted{color:var(--muted-foreground);font-size:.875rem;overflow-wrap:anywhere}
.sb-refresh{margin-left:auto;flex:none}
.sb-status{white-space:pre-wrap;overflow-wrap:anywhere}
.sb-columns{display:grid;grid-template-columns:minmax(200px,1fr) minmax(0,1.6fr);grid-template-rows:auto minmax(0,1fr);flex:1;min-height:0}
.sb-nav{grid-column:1/-1;padding-bottom:1rem;display:flex;flex-direction:column;gap:1rem}
.sb-domain{display:flex;align-items:center;gap:.75rem;width:fit-content;max-width:100%}
.sb-kinds,.sb-actions,.sb-pager{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
.sb-kinds button span{color:var(--muted-foreground);font-variant-numeric:tabular-nums}
.sb-list,.sb-detail{overflow:auto;min-width:0}
.sb-list{padding-right:1rem}
.sb-count{margin:1rem 0}
.sb-objects{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:.5rem}
.sb-objects button{display:flex;flex-direction:column;align-items:stretch;justify-content:flex-start;text-align:left;width:100%;height:auto;white-space:normal;overflow-wrap:anywhere}
.sb-object-title{display:flex;gap:.5rem;align-items:start;justify-content:space-between}
.sb-summary{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:var(--muted-foreground);font-size:.875rem;margin:.25rem 0}
.sb-ref{font-family:var(--mv-font-mono,ui-monospace,monospace);font-size:.75rem;overflow-wrap:anywhere;color:var(--muted-foreground)}
.sb-pager{justify-content:space-between;margin:1rem 0}
.sb-detail-content{display:flex;flex-direction:column;gap:1rem}
.sb-detail-content>[data-slot=card-header]{padding-inline:0}
.sb-tabs{max-width:100%;overflow-x:auto}
.sb-detail [role=tabpanel]{min-width:0}
.sb-detail [role=tabpanel][hidden]{display:none}
.sb-detail [role=tabpanel]>:first-child{margin-top:0}
.sb-detail p{white-space:pre-wrap;overflow-wrap:anywhere}
.sb-fields{display:grid;grid-template-columns:minmax(100px,30%) minmax(0,1fr);margin:0}
.sb-fields dt,.sb-fields dd{padding:.75rem 0;border-bottom:1px solid var(--border);margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.sb-fields dt{color:var(--muted-foreground);padding-right:1rem}
.sb-relation-list{list-style:none;padding:0}
.sb-relation-list li{display:flex;align-items:center;gap:.5rem;padding:.75rem 0;border-bottom:1px solid var(--border);flex-wrap:wrap}
.sb-relation-list button{overflow-wrap:anywhere;text-align:left;white-space:normal}
.sb-expression,.sb-computation,.sb-temporal{min-width:0}
.sb-expression{display:flex;flex-direction:column;gap:.75rem}
.sb-expression-code{position:relative;min-width:0}
.sb-expression-copy{position:absolute;right:.5rem;top:.5rem}
.sb-expression pre{max-height:360px;padding:1rem;overflow:auto;max-width:100%;white-space:pre;overflow-wrap:normal;font-family:var(--mv-font-mono,ui-monospace,monospace);font-size:.8125rem;tab-size:4;background:var(--muted);border-radius:var(--radius-lg)}
.sb-expression-code pre{padding-right:3rem}
.sb-expression-bindings{overflow-wrap:anywhere}
.sb-computation{margin:1rem 0;overflow-wrap:anywhere}
.sb-computation-content,.sb-referenced-definitions{display:flex;flex-direction:column;gap:1rem}
.sb-definition-entry{padding-top:1rem;border-top:1px solid var(--border)}
.sb-definition-entry h4{margin:0;min-width:0}
.sb-definition-link{height:auto;white-space:normal;text-align:left}
.sb-formula-term{display:inline-block;max-width:100%}
.sb-graph svg{width:100%;border:1px solid var(--border);background:var(--muted);border-radius:var(--radius-lg);touch-action:none}
.sb-graph [role=button]{cursor:pointer}
.sb-back-list{display:none}
@container(max-width:650px){.sb-columns{display:block;overflow:auto}.sb-detail{display:none}.sb-has-selection .sb-list{display:none}.sb-has-selection .sb-detail{display:block}.sb-back-list{display:inline-flex}.sb-fields{grid-template-columns:minmax(0,1fr)}.sb-fields dt{border-bottom:0;padding-bottom:0}.sb-fields dd{padding-top:.25rem}.sb-list{padding-right:0}.sb-shell{height:auto;min-height:100%}}
`
