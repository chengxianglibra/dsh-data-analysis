/** Datasource arrangement and saved-property reading; controls use shadcn primitives. */
export const credentialStyles = `
.mc-panel{min-width:0;width:100%;container-type:inline-size;--mc-accent:var(--dsw-alias-state-business-primary,#075bea)}
.mc-shell,.mc-columns,.mc-main,.mc-form{display:flex;flex-direction:column;min-width:0}
.mc-shell,.mc-columns,.mc-form-body{gap:1.5rem}
.mc-form{gap:1rem;flex:1}
.mc-form-body{display:flex;flex-direction:column;flex:1}
.mc-detail-heading,.mc-name-row,.mc-heading-actions,.mc-field-header,.mc-field-actions,.mc-test-heading,.mc-request-heading,.mc-progress{display:flex;align-items:center;flex-wrap:wrap;gap:.75rem;min-width:0}
.mc-detail-heading,.mc-name-row,.mc-field-header,.mc-test-heading{justify-content:space-between}
.mc-name-row{width:100%}
.mc-identity{display:flex;align-items:flex-start;gap:1rem;flex:1 1 180px;min-width:0}
.mc-identity-icon{width:3.375rem;height:3.375rem;display:grid;place-items:center;flex:none;background:var(--muted);border-radius:.625rem}
.mc-identity-copy{min-width:0}
.mc-identity-title{display:flex;align-items:center;flex-wrap:wrap;gap:.5rem;min-width:0}
.mc-identity-title [data-slot=card-title]{min-width:0;max-width:100%}
.mc-heading-actions{flex:none}
.mc-test-heading>.mc-heading-actions{margin-left:auto}
.mc-detail-heading{margin-bottom:.5rem}
.mc-detail-heading h3{margin:0;font-size:1.25rem;line-height:1.4;font-weight:600;overflow-wrap:anywhere}
.mc-datasource-heading [data-slot=card-title]{font-size:1.5rem;line-height:1.2;font-weight:700;letter-spacing:-.025em;overflow-wrap:anywhere}
.mc-nav{min-width:0}
.mc-nav-heading{margin-bottom:.75rem;color:var(--muted-foreground);font-size:.875rem}
.mc-nav-heading h3{font:inherit;margin:0}
.mc-datasources{width:100%;max-width:100%;height:auto;justify-content:flex-start;overflow-x:auto;border-bottom:1px solid var(--border);border-radius:0;padding:0;gap:.25rem}
.mc-datasources .mc-datasource{min-width:0;max-width:min(16rem,100%);flex:0 0 auto;border-radius:0;padding:.75rem 1.25rem;font-size:.9375rem;background:transparent;color:var(--muted-foreground);box-shadow:none;transition:none}
.mc-datasources .mc-datasource[aria-selected=true]{color:var(--mc-accent)}
.mc-datasources .mc-datasource::after{background:var(--mc-accent);bottom:0;opacity:0;transition:none}
.mc-datasources .mc-datasource[aria-selected=true]::after{opacity:1}
.mc-datasources .mc-datasource:focus-visible{outline:2px solid var(--ring);outline-offset:-2px}
.mc-datasource>svg{flex:none}
.mc-datasource-copy{min-width:0;display:flex;align-items:center;gap:.375rem}
.mc-datasource-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mc-visually-hidden{position:absolute;left:0;top:0;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.mc-dot{width:6px;height:6px;background:var(--muted-foreground);border-radius:50%;flex:none}
.mc-dot[data-ready=true]{background:var(--mv-success)}
.mc-dot[data-ready=false]{background:var(--destructive)}
.mc-properties,.mc-fields{min-width:0}
.mc-datasource-detail .mc-properties,.mc-datasource-detail .mc-fields{gap:1rem;padding:0;background:transparent;box-shadow:none;border-radius:0;overflow:visible}
.mc-datasource-detail .mc-properties>[data-slot=card-header],.mc-datasource-detail .mc-properties>[data-slot=card-content],.mc-datasource-detail .mc-fields>[data-slot=card-content]{padding:0}
.mc-credential-section{display:flex;flex-direction:column;gap:1rem;min-width:0;padding-top:1.5rem;border-top:1px solid var(--border)}
.mc-section-heading{display:flex;align-items:center;gap:.625rem;min-width:0;margin:0;font-size:1.125rem;line-height:1.4;font-weight:700}
.mc-section-heading>svg{width:1.125rem;height:1.125rem;flex:none}
.mc-fields>[data-slot=card-content]>.mc-field+.mc-field{border-top:1px solid var(--border);padding-top:1rem;margin-top:1rem}
.mc-property-list{margin:0;min-width:0}
.mc-property{display:grid;grid-template-columns:minmax(0,140px) minmax(0,1fr);gap:1rem;padding:.75rem 0}
.mc-property+.mc-property{border-top:1px solid var(--border)}
.mc-property dt{color:var(--muted-foreground);font-weight:500;overflow-wrap:anywhere}
.mc-property dd{margin:0;min-width:0;white-space:pre-wrap;overflow-wrap:anywhere}
.mc-property pre{font-family:var(--mv-font-mono,ui-monospace,monospace);tab-size:4;white-space:pre-wrap;overflow-wrap:anywhere;margin:0}
.mc-property-json{max-height:240px;overflow:auto}
.mc-field{min-width:0;margin:0;border:0;padding:0;display:flex;flex-direction:column;gap:1rem}

.mc-field-title{min-width:0;overflow-wrap:anywhere}
.mc-field-title h4,.mc-field-title p{margin:0}
.mc-field-title p,.mc-field-note,.mc-note,.mc-eyebrow{color:var(--muted-foreground);font-size:.875rem;overflow-wrap:anywhere}
.mc-eyebrow{margin:0}
.mc-confirm{margin-top:.75rem}
.mc-test{display:flex;flex-direction:column;gap:1rem;padding-top:1.5rem;border-top:1px solid var(--border)}
.mc-test-heading time{color:var(--muted-foreground);font-size:.875rem}
.mc-empty-test{margin:0;color:var(--muted-foreground);font-size:.875rem}
.mc-result-title{display:flex;align-items:center;gap:.5rem}
.mc-result pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:180px;overflow:auto}
.mc-form-footer{display:flex;align-items:center;flex-wrap:wrap;gap:.5rem}
.mc-form-footer .mc-cancel{margin-left:auto}
.mc-requests,.mc-activity-list{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
.mc-request-status,.mc-operation-note{overflow-wrap:anywhere}
.mc-request-choice{min-width:0;display:flex;flex-wrap:wrap;gap:.5rem;border:0;padding:0}
.mc-request-reason{margin-top:.75rem}
.mc-request-reason summary,.mc-reference-options summary{cursor:pointer}
.mc-request-reason p{white-space:pre-wrap;overflow-wrap:anywhere}
.mc-credential-entry,.mc-credential-group,.mc-existing-source,.mc-inline-credentials{display:flex;flex-direction:column;gap:1rem;min-width:0}
.mc-reference-options{min-width:0}
.mc-timezone-control{display:flex;gap:.375rem;align-items:center}
.mc-timezone-control input{flex:1;min-width:0}
.mc-timezone-popover{display:grid;gap:.625rem;max-width:calc(100vw - 2rem)}
.mc-timezone-select{width:100%;min-width:0;max-height:15rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--background);color:var(--foreground);font:inherit}
.mc-timezone-select:focus-visible{outline:2px solid var(--ring);outline-offset:2px}
.mc-engine-confirm{margin-top:.5rem}
.mc-scoped-actions{display:flex;flex-wrap:wrap;gap:.5rem}
.mc-activity{display:flex;flex-direction:column;gap:.75rem}
.mc-activity-heading{margin:0;color:var(--muted-foreground);font-size:.875rem}
.mc-progress button{margin-left:auto}
.mc-empty{margin:auto}
@container(max-width:650px){.mc-name-row>.mc-heading-actions{width:100%}.mc-property{grid-template-columns:minmax(0,1fr);gap:.375rem}.mc-field-actions{margin-left:auto}}
`
