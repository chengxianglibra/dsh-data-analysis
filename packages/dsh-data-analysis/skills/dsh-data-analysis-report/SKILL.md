---
name: dsh-data-analysis-report
description: Create or revise a Workspace HTML analysis report. Use only when the user explicitly requests HTML/web output or accepts it; never use for inline, text, or other non-HTML output.
---

# DSH data-analysis report

Use this Skill only for an explicitly requested or accepted HTML report, or to revise an HTML
report created in this conversation. Otherwise keep the response in the requested medium and do
not create report files.

1. Load `marivo-analysis` and follow its live Help routes. Revalidate restored Artifacts before
   describing them as current.
2. Read only the references needed for this report:
   - audience, content, or organization: `references/report-content.md`
   - material data, quality, freshness, or evidence boundaries:
     `references/material-disclosure.md`
   - DataFrame or Artifact snapshot: `references/dataset.md`
   - built-in charts, tables, KPIs, or quality details:
     `references/starter-components.md`
   - persisted Artifact trace appendix: `references/session-trace.md`
3. Start from an empty bundle or copy `starter/basic`; add only selected components and snippets.
   The complete `starter/examples/analysis-brief` is reference-only, not a default template.
4. Keep every required resource under a new Workspace bundle root and use relative paths. Write
   resources first and `index.html` last.
5. For reports using persisted Marivo Artifacts, include a focused ancestors trace by default.
   Delete the trace path for computed-only reports. A user-requested minimal report may omit it,
   but must not claim complete traceability.
6. Run `dsh_data_analysis_report_check({ entry_path })`. On failure, read
   `references/checker.md` and only the checker-rule group named by the returned code, then fix and
   rerun. Static success is not browser or analytical validation.
7. When browser capability exists, load the exact `index.html`, check the console, keyboard,
   fallback content, and selected interactions. Any required failed check leaves the report
   incomplete.
8. Deliver the exact `index.html` path. Produced Files and Host opening are navigation only, not
   readiness, publication, immutability, or historical recovery.
