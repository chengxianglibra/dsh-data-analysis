/** Semantic navigation and code/graph reading layouts; general visuals come from shadcn. */
export const browserStyles = `
.sb-panel{height:100%;min-width:0;container-type:inline-size;--sb-accent:var(--dsw-alias-state-business-primary,#075bea);--sb-accent-soft:color-mix(in srgb,var(--sb-accent) 11%,var(--background))}
.sb-shell{height:100%;display:flex;flex-direction:column;gap:0}
.sb-header{display:flex;flex-wrap:wrap;align-items:center;gap:1rem;padding:.75rem 1.5rem;border-bottom:1px solid var(--border)}
.sb-header [data-slot=card-title]{font-size:1.25rem;font-weight:700;letter-spacing:-.02em}
.sb-updated,.sb-count,.sb-muted{color:var(--muted-foreground);font-size:.875rem;overflow-wrap:anywhere}
.sb-refresh{flex:none}
.sb-status{white-space:pre-wrap;overflow-wrap:anywhere}
.sb-columns{display:grid;grid-template-columns:minmax(230px,31.7%) minmax(0,1fr);grid-template-rows:auto minmax(0,1fr);flex:1;min-height:0}
.sb-nav{grid-column:1/-1;padding:1rem 1.5rem;display:flex;flex-wrap:wrap;align-items:center;gap:.75rem 1.5rem;border-bottom:1px solid var(--border)}
.sb-domain{display:flex;align-items:center;gap:.75rem;width:fit-content;max-width:100%}
.sb-kinds,.sb-actions,.sb-pager{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
.sb-kinds button{border-radius:.625rem;min-height:2.25rem;font-weight:500}
.sb-kinds button span{color:var(--muted-foreground);font-variant-numeric:tabular-nums}
.sb-kinds button[data-state=on]{color:var(--sb-accent);background:var(--sb-accent-soft);border-color:var(--sb-accent)}
.sb-kinds button[data-state=on] span{color:inherit}
.sb-list,.sb-detail{overflow:auto;min-width:0}
.sb-list{padding:1rem 1.5rem;border-right:1px solid var(--border)}
.sb-search-wrap{position:relative}
.sb-search-wrap>svg{position:absolute;left:.75rem;top:50%;transform:translateY(-50%);width:1rem;height:1rem;color:var(--muted-foreground);pointer-events:none}
.sb-search-wrap .sb-search{padding-left:2.25rem;height:2.75rem}
.sb-count{margin:1rem 0;color:var(--muted-foreground)}
.sb-objects{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:.5rem}
.sb-objects button{position:relative;display:flex;flex-direction:column;align-items:stretch;justify-content:flex-start;text-align:left;width:100%;height:auto;padding:.625rem .875rem;white-space:normal;overflow-wrap:anywhere;border-radius:.5rem;gap:.125rem}
.sb-objects button[aria-pressed=true]{background:var(--sb-accent-soft);border-color:transparent;box-shadow:inset 3px 0 0 var(--sb-accent)}
.sb-objects strong{font-size:.9375rem;font-weight:650;line-height:1.35}
.sb-object-title{display:flex;gap:.5rem;align-items:start;justify-content:space-between}
.sb-summary{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:color-mix(in srgb,var(--foreground) 74%,var(--background));font-size:.875rem;font-weight:400;line-height:1.4;margin:0}
.sb-ref{font-family:var(--mv-font-mono,ui-monospace,monospace);font-size:.8125rem;overflow-wrap:anywhere;color:var(--muted-foreground)}
.sb-pager{justify-content:space-between;margin:1rem 0}
.sb-detail>[data-slot=card]{border-radius:0;box-shadow:none;overflow:visible;padding:0;background:transparent}
.sb-detail-content{display:flex;flex-direction:column;gap:1rem;padding:1.5rem;min-width:0}
.sb-detail-content>[data-slot=card-header]{padding-inline:0}
.sb-detail-top{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:1rem}
.sb-detail-identity{display:flex;align-items:flex-start;flex:1 1 min(100%,18rem);min-width:0;gap:1rem}
.sb-kind-icon{width:3.375rem;height:3.375rem;display:grid;place-items:center;flex:none;background:var(--muted);border-radius:.625rem;color:var(--foreground)}
.sb-kind-icon svg{width:1.4rem;height:1.4rem}
.sb-identity-text{flex:1;min-width:0;padding:0;container-type:normal}
.sb-identity-text [data-slot=card-title]{font-size:1.5rem;line-height:1.2;font-weight:700;letter-spacing:-.025em;overflow-wrap:anywhere}
.sb-identity-text .sb-ref{font-size:.875rem;margin-top:.25rem}
.sb-detail-actions{display:flex;flex:none;max-width:100%;flex-wrap:wrap;justify-content:flex-start;gap:.5rem}
.sb-detail-actions button{min-height:2.5rem}
.sb-detail-actions button:last-child{background:var(--sb-accent);color:var(--primary-foreground)}
.sb-detail-actions button:disabled{opacity:.5}
.sb-detail-navigation{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
.sb-detail-navigation:has(.sb-back-list:only-child){display:none}
.sb-detail-navigation button{padding-inline:.5rem}
.sb-kind-label{font-weight:500;white-space:nowrap}
.sb-tabs{width:100%;max-width:100%;height:auto;justify-content:flex-start;overflow-x:auto;border-bottom:1px solid var(--border);border-radius:0;padding:0;gap:.25rem}
.sb-tabs [role=tab]{min-width:0;flex:0 0 auto;border-radius:0;padding:.75rem 1.25rem;font-size:.9375rem;background:transparent;color:var(--muted-foreground);box-shadow:none;transition:none}
.sb-tabs [role=tab][aria-selected=true]{color:var(--sb-accent)}
.sb-tabs [role=tab]::after{background:var(--sb-accent);bottom:0;opacity:0;transition:none}
.sb-tabs [role=tab][aria-selected=true]::after{opacity:1}
.sb-detail-content>span[role=status]:empty,.sb-expression>span[role=status]:empty{display:none}
.sb-detail [role=tabpanel]{min-width:0}
.sb-detail [role=tabpanel][hidden]{display:none}
.sb-detail [role=tabpanel]>:first-child{margin-top:0}
.sb-detail p{white-space:pre-wrap;overflow-wrap:anywhere}
.sb-section-heading{display:flex;align-items:center;gap:.625rem;min-width:0}
.sb-section-heading>svg{width:1.125rem;height:1.125rem;flex:none;color:var(--foreground)}
.sb-overview{min-width:0}
.sb-overview-section{padding:1.5rem 0;border-bottom:1px solid var(--border)}
.sb-overview-section:last-child{border-bottom:0}
.sb-overview-section h3{margin:0 0 .875rem;font-size:1.125rem;line-height:1.4;font-weight:700}
.sb-overview-description{margin:0;font-size:1rem;line-height:1.55;color:color-mix(in srgb,var(--foreground) 82%,var(--background))}
.sb-overview-fields{margin:0}
.sb-overview-row{display:grid;grid-template-columns:minmax(12rem,30%) minmax(0,1fr);gap:1rem;align-items:start;min-height:2.625rem;border-bottom:1px solid var(--border)}
.sb-overview-key,.sb-overview-value{min-width:0;margin:0;padding:.625rem .75rem;overflow-wrap:anywhere}
.sb-overview-key{display:flex;align-items:flex-start;gap:1.5rem;font-weight:600}
.sb-overview-icon,.sb-field-icon{width:1.125rem;height:1.125rem;flex:none;color:var(--foreground)}
.sb-overview-value{font-size:.9375rem;line-height:1.45}
.sb-overview-value>.sb-value-list{list-style:none;padding-left:0}
.sb-overview-value .sb-definition-link{padding:0;justify-content:flex-start}
.sb-overview-guardrails{margin:0;padding-left:1.875rem;display:flex;flex-direction:column;gap:.5rem;font-size:.9375rem;line-height:1.5;overflow-wrap:anywhere}
.sb-fields{display:grid;grid-template-columns:minmax(100px,30%) minmax(0,1fr);margin:0}
.sb-fields>dt,.sb-fields>dd{padding:.75rem 0;border-bottom:1px solid var(--border);margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.sb-fields>dt{display:flex;align-items:flex-start;gap:.75rem;color:var(--muted-foreground);padding-right:1rem}
.sb-fields>dd>.sb-value-list{list-style:none;padding-left:0}
.sb-fields>dd>.sb-value-list>.sb-value-more{margin-left:0}
.sb-fields>dd .sb-definition-link{padding:0;justify-content:flex-start}
.sb-value-list{margin:0;padding-left:1.25rem;display:flex;flex-direction:column;gap:.375rem}
.sb-value-more{list-style:none;margin-left:-1.25rem;min-width:0}
.sb-value-more>details>summary,.sb-value-map dd>details>summary{cursor:pointer;overflow-wrap:anywhere}
.sb-value-more>details[open]>summary,.sb-value-map dd>details[open]>summary{margin-bottom:.375rem}
.sb-value-map dd>details{min-width:0;max-width:100%;overflow-wrap:anywhere}
.sb-value-map{display:grid;grid-template-columns:minmax(0,35%) minmax(0,1fr);gap:.375rem .75rem;margin:0}
.sb-value-map dt,.sb-value-map dd{margin:0;min-width:0;overflow-wrap:anywhere}
.sb-value-key{color:var(--muted-foreground)}
.sb-source{margin-top:1.5rem;border:1px solid var(--border);border-radius:.5rem;background:var(--muted)}
.sb-source summary{display:flex;align-items:center;gap:1rem;padding:.75rem 1rem;cursor:pointer;font-weight:600;list-style:none}
.sb-source summary::-webkit-details-marker{display:none}
.sb-source summary span{flex:1;min-width:0}
.sb-source-content{padding:0 1rem 1rem;overflow-wrap:anywhere}
.sb-source-content h3{margin:.75rem 0;font-size:.875rem;font-weight:600}
.sb-relations{padding:1.5rem 0;min-width:0}
.sb-relations-toolbar{display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-bottom:1rem}
.sb-relation-group-icon,.sb-relation-item-icon{width:1.125rem;height:1.125rem;flex:none;color:var(--foreground)}
.sb-relations-heading{margin:0;font-size:1.125rem;line-height:1.4;font-weight:700}
.sb-relations>.sb-graph{margin-bottom:1rem}
.sb-relation-group{margin-top:.75rem;min-width:0}
.sb-relation-group-summary{display:flex;align-items:center;gap:1rem;min-height:3rem;padding:.75rem 1rem;border:1px solid var(--border);border-radius:.5rem;background:var(--muted);cursor:pointer;font-weight:600;list-style:none;overflow-wrap:anywhere}
.sb-relation-group-summary::-webkit-details-marker{display:none}
.sb-relation-group-summary .sb-relation-count{flex:1;color:var(--muted-foreground);font-size:.875rem;font-weight:400;font-variant-numeric:tabular-nums}
.sb-relation-group .sb-relation-list{display:flex;flex-direction:column;gap:.5rem;margin:.5rem 0 0;padding:0;list-style:none}
.sb-relation-group .sb-relation-item{display:grid;grid-template-columns:1.25rem minmax(10rem,1.1fr) minmax(0,1fr) 2rem;align-items:center;gap:1rem;padding:.75rem 1rem;border:1px solid var(--border);border-radius:.5rem;min-width:0}
.sb-relation-item-body{display:flex;flex-direction:column;min-width:0;gap:.125rem}
.sb-relation-item-name{height:auto;justify-content:flex-start;padding:0;color:var(--sb-accent);font-weight:600;text-align:left;white-space:normal;overflow-wrap:anywhere}
.sb-relation-roles{display:flex;flex-wrap:wrap;gap:.25rem;margin-top:.25rem}
.sb-relation-roles [data-slot=badge]{white-space:normal;font-weight:400}
.sb-relation-item-ref{min-width:0;overflow-wrap:anywhere}
.sb-relation-copy{justify-self:end}
.sb-relation-list{list-style:none;padding:0;margin:.25rem 0 0}
.sb-graph .sb-relation-list li{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;padding:.5rem .75rem;border-top:1px solid var(--border)}
.sb-graph .sb-relation-list button{height:auto;padding:0;overflow-wrap:anywhere;text-align:left;white-space:normal}
.sb-expression,.sb-computation,.sb-temporal{min-width:0}
.sb-expression{display:flex;flex-direction:column;gap:.75rem}
.sb-expression-code{position:relative;min-width:0}
.sb-expression-copy{position:absolute;right:.5rem;top:.5rem;z-index:1}
.sb-expression pre{max-height:360px;margin:0;padding:1rem;overflow:auto;max-width:100%;white-space:pre-wrap;overflow-wrap:anywhere;font-family:var(--mv-font-mono,ui-monospace,monospace);font-size:.8125rem;line-height:1.5;tab-size:4;background:var(--muted);border:1px solid var(--border);border-radius:.5rem}
.sb-expression-code pre{padding-right:6rem}
.sb-expression-code .sb-definition-link{display:inline;padding:0;font:inherit;vertical-align:baseline}
.sb-expression-bindings{overflow-wrap:anywhere}
.sb-computation{margin:1rem 0;overflow:visible;overflow-wrap:anywhere;border-radius:0;background:transparent;box-shadow:none;padding:0;gap:0}
.sb-computation>[data-slot=card-header]{padding:0;margin:0 0 .875rem}
.sb-computation [data-slot=card-title]{font-size:1.125rem;font-weight:700;line-height:1.4}
.sb-computation-content{display:flex;flex-direction:column;gap:1.25rem;padding:0}
.sb-fact,.sb-referenced-definitions,.sb-definition-entry{min-width:0;overflow-wrap:anywhere}
.sb-fact>summary{cursor:pointer;font-weight:500;list-style:none}
.sb-fact>summary::-webkit-details-marker{display:none}
.sb-fact>summary{display:grid;grid-template-columns:1.25rem minmax(8rem,23%) minmax(0,1fr) 1rem;align-items:start;gap:1rem;padding:.65rem 1rem}
.sb-fact-row{display:grid;grid-template-columns:1.25rem minmax(8rem,23%) minmax(0,1fr);align-items:start;gap:1rem;padding:.65rem 1rem}
.sb-fact-value{min-width:0;overflow-wrap:anywhere}
.sb-fact-value .sb-definition-link{padding:0;justify-content:flex-start}
.sb-fact-icon,.sb-related-icon{width:1.15rem;height:1.15rem;color:var(--foreground);flex:none}
.sb-fact-label{font-weight:600}
.sb-fact-preview{min-width:0;color:var(--foreground);font-weight:400;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.sb-fact[open]>summary .sb-fact-preview{visibility:hidden}
.sb-disclosure-icon{width:1rem;height:1rem;color:var(--muted-foreground);transition:transform .15s ease;flex:none}
.sb-fact>summary>.sb-disclosure-icon{grid-column:4}
details[open]>summary .sb-disclosure-icon{transform:rotate(180deg)}
.sb-fact{border-top:1px solid var(--border)}
.sb-fact-content{padding:.25rem .75rem .875rem 2.5rem;min-width:0}
.sb-fact-content>.sb-value-list:has(>li:only-child){list-style:none;padding-left:0}
.sb-null-rule-summary{display:flex;flex-direction:column;gap:.375rem;margin:0;padding-left:1.125rem}
.sb-null-rule-branches{margin-top:.5rem}
.sb-null-rule-branches>summary{cursor:pointer;color:var(--muted-foreground)}
.sb-null-rule-branches>div{margin-top:.375rem}
.sb-definition-entries{display:flex;flex-direction:column;gap:.375rem;margin:.5rem 0 0;padding:0;list-style:none}
.sb-definition-entry{display:flex;align-items:center;gap:1rem;min-height:3rem;padding:.625rem 1rem;border:1px solid var(--border);border-radius:var(--radius-lg)}
.sb-referenced-definitions h3{font-size:1.125rem;line-height:1.4;font-weight:700;margin:0 0 .75rem}
.sb-related-name{height:auto;justify-content:flex-start;padding:0;color:var(--sb-accent);font-weight:600;text-align:left;white-space:normal;overflow-wrap:anywhere}
.sb-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.sb-definition-link{height:auto;white-space:normal;text-align:left;color:var(--sb-accent)}
.sb-formula-term{display:inline-block;max-width:100%}
.sb-graph>svg{width:100%;border:1px solid var(--border);background:var(--muted);border-radius:var(--radius-lg);touch-action:none}
.sb-graph [role=button]{cursor:pointer}
.sb-back-list{display:none}
@container(max-width:650px){.sb-columns{display:block;overflow:auto}.sb-nav{padding:.75rem 1rem;gap:.75rem}.sb-detail{display:none}.sb-has-selection .sb-list{display:none}.sb-has-selection .sb-detail{display:block}.sb-back-list{display:inline-flex}.sb-detail-navigation:has(.sb-back-list:only-child){display:flex}.sb-detail-content{padding:1rem}.sb-detail-top{flex-wrap:wrap}.sb-detail-identity{flex-basis:100%}.sb-detail-actions{justify-content:flex-start}.sb-kind-icon{width:2.75rem;height:2.75rem}.sb-identity-text [data-slot=card-title]{font-size:1.25rem}.sb-fields,.sb-value-map{grid-template-columns:minmax(0,1fr)}.sb-fields>dt{border-bottom:0;padding-bottom:0}.sb-fields>dd{padding-top:.25rem}.sb-value-map{gap:.125rem}.sb-value-map>dd{margin-bottom:.5rem}.sb-overview-row{grid-template-columns:minmax(0,1fr);gap:0;padding:.5rem 0}.sb-overview-key,.sb-overview-value{padding:.25rem .5rem}.sb-overview-key{gap:.75rem}.sb-overview-value{padding-left:2.375rem}.sb-relation-group .sb-relation-item{grid-template-columns:1.25rem minmax(0,1fr) 2rem;gap:.5rem .75rem}.sb-relation-item-ref{grid-column:2;grid-row:2}.sb-relation-copy{grid-column:3;grid-row:1}.sb-fact>summary{grid-template-columns:1.25rem minmax(0,1fr) 1rem;gap:.5rem}.sb-fact>summary>.sb-disclosure-icon{grid-column:3}.sb-fact-preview{grid-column:2/-1;grid-row:2}.sb-expression-code pre{padding-right:1rem;padding-top:3.25rem}.sb-list{padding:1rem;border-right:0}.sb-shell{height:auto;min-height:100%}}
@container(max-width:650px){.sb-fact-row{grid-template-columns:1.25rem minmax(0,1fr);gap:.5rem .75rem}.sb-fact-row>.sb-fact-value{grid-column:2}}
`
