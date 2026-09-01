# Material disclosure

Disclose a boundary in the main narrative when it changes how a reader should interpret a result
or act on it. Prefer concise, decision-relevant language over dumping every machine field.

Check the applicable analysis range, metric definition, unit, time boundary, freshness,
revalidation time, coverage, null rate, sample size and coverage, zero denominators, failed or
warning checks, omitted rows, uncertainty, and counterexamples.

- `quality_summary=null` means no Artifact quality summary was supplied. It is not a pass.
- A computed dataset has no Marivo Quality or Evidence state unless the analysis explicitly
  establishes one elsewhere.
- Artifact build-time quality is not current quality. Only an identity-matched explicit
  revalidation can describe current state.
- Material warnings must appear in the report body, not only inside a chart details popover.
- Dataset and trace snapshots are display transports, not Artifact, Evidence, Finding, or semantic
  authority.
- A bounded or truncated snapshot must say what was omitted. Do not describe it as complete.

When no material issue exists, do not add a fixed quality checklist merely to fill space.
